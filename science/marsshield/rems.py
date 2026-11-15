"""REMS surface pressure for the RAD analysis (NASA PDS, MSL REMS MODRDR, data set MSL-M-REMS-5-MODRDR-V1.0).

Source: https://pds-atmospheres.nmsu.edu/PDS/data/mslrem_1001/DATA/  (one fixed-width ASCII table per sol,
5-30 MB). We do not download whole tables: each row is RECORD_BYTES long, so we request N evenly spaced
rows per sol with one HTTP multi-range request and parse
    TIMESTAMP (SCLK seconds, bytes 1-10), LMST (13-30), PRESSURE [Pa] (345-351),
    PS_CONFIDENCE_LEVEL (362-369; trailing two flag bytes = oscillator, shadow effect; shadow '0' = affected).
UTC of each row = label START_TIME + (SCLK - SPACECRAFT_CLOCK_START_COUNT) seconds (within one sol).

Note: the NASA "Mars weather" JSON feed (CAB) is explicitly for outreach only and is NOT used.
Every sol file is cached as JSON with its source URL (data/raw/rems/).
"""
from __future__ import annotations

import datetime as dt
import json
import re
import threading
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import requests

from . import config as C

BASE = "https://pds-atmospheres.nmsu.edu/PDS/data/mslrem_1001/DATA/"
UA = {"User-Agent": "MarsShield-research-pipeline/1.0"}
ROWS_PER_SOL = 180
_local = threading.local()


def _session():
    if not hasattr(_local, "s"):
        _local.s = requests.Session(); _local.s.headers.update(UA)
    return _local.s


def _get(url, **kw):
    for attempt in range(4):
        try:
            r = _session().get(url, timeout=90, **kw)
            if r.status_code in (200, 206, 404):
                return r
        except requests.RequestException:
            pass
    raise RuntimeError(f"failed: {url}")


def sol_dirs() -> dict[int, str]:
    html = _get(BASE).text
    out = {}
    for a, b in re.findall(r'href="SOL_(\d{5})_(\d{5})/"', html):
        for s in range(int(a), int(b) + 1):
            out[s] = f"{BASE}SOL_{a}_{b}/SOL{s:05d}/"
    return out


def _parse_label(txt: str) -> dict:
    g = lambda k: re.search(rf"^{k}\s*=\s*\"?([^\"\r\n]+)\"?", txt, re.M).group(1).strip()
    return dict(record_bytes=int(g("RECORD_BYTES")), records=int(g("FILE_RECORDS")),
                sclk0=int(g("SPACECRAFT_CLOCK_START_COUNT")), start=g("START_TIME"))


def parse_record(raw: bytes) -> tuple[int, float, bool] | None:
    """One MODRDR record -> (SCLK, pressure Pa, usable). PDS byte offsets (1-indexed, from the label):
    TIMESTAMP 1-10 (right-justified), PRESSURE 345-351, PS_CONFIDENCE_LEVEL 362-369 (last flag '0' = shadow-affected)."""
    s = raw.decode("ascii", "replace").strip()
    f = s.split(",")
    s = " " * (10 - len(f[0])) + s        # restore the right-justified 10-byte TIMESTAMP so PDS byte offsets apply
    try:
        sc = int(f[0]); pv = float(s[344:351]); conf = s[361:369].strip('" ')
    except (ValueError, IndexError):
        return None
    return sc, pv, bool(pv > 0 and not conf.endswith("0") and "X" not in conf[-1:])


def parse_records(rows, t0: dt.datetime, sclk0: int):
    sclk, utc, p, ok = [], [], [], []
    for ln in rows:
        r = parse_record(ln)
        if r is None:
            continue
        sc, pv, good = r
        sclk.append(sc); utc.append((t0 + dt.timedelta(seconds=sc - sclk0)).isoformat(timespec="seconds"))
        p.append(pv); ok.append(int(good))
    return sclk, utc, p, ok


def fetch_sol(sol: int, dirurl: str) -> dict | None:
    out = C.RAW / "rems" / f"sol_{sol:05d}.json"
    if out.exists():
        return json.loads(out.read_text())
    out.parent.mkdir(parents=True, exist_ok=True)
    r = _get(dirurl)
    if r.status_code == 404:
        out.write_text(json.dumps(dict(sol=sol, missing=True, source=dirurl))); return None
    m = re.findall(r'href="(RME_[^"]*RMD[^"]*\.LBL)"', r.text)
    if not m:
        out.write_text(json.dumps(dict(sol=sol, missing=True, source=dirurl, note="no MODRDR product"))); return None
    lbl_url = dirurl + m[0]; tab_url = lbl_url[:-4] + ".TAB"
    lab = _parse_label(_get(lbl_url, headers={"Range": "bytes=0-4000"}).text)
    n, rb = lab["records"], lab["record_bytes"]
    idx = np.unique(np.linspace(0, n - 1, min(ROWS_PER_SOL, n)).astype(int))
    rows = []
    for chunk in np.array_split(idx, max(1, len(idx) // 90)):   # keep the Range header < ~2 kB
        rng = ",".join(f"{i * rb}-{i * rb + rb - 1}" for i in chunk)
        rr = _get(tab_url, headers={"Range": f"bytes={rng}"})
        rows += [ln for ln in re.findall(rb"\s*\d{9,10},\"[^\r\n]{300,}", rr.content)]
    t0 = dt.datetime.fromisoformat(lab["start"][:23]).replace(tzinfo=dt.timezone.utc)
    sclk, utc, p, ok = parse_records(rows, t0, lab["sclk0"])
    rec = dict(sol=sol, source=tab_url, label=lbl_url, records=n, sampled=len(p), sclk=sclk, utc=utc, pressure_pa=p, ok=ok)
    out.write_text(json.dumps(rec))
    return rec


def fetch_range(sol_a: int, sol_b: int, workers: int = 8) -> dict:
    dirs = sol_dirs()
    sols = [s for s in range(sol_a, sol_b + 1) if s in dirs]
    with ThreadPoolExecutor(workers) as ex:
        res = list(ex.map(lambda s: fetch_sol(s, dirs[s]), sols))
    got = [r for r in res if r]
    return dict(requested=len(range(sol_a, sol_b + 1)), listed=len(sols), with_data=len(got))


def load_series(sol_a: int, sol_b: int):
    """All valid sampled pressures in [sol_a, sol_b] as (unix seconds array, pressure array)."""
    ts, ps = [], []
    for s in range(sol_a, sol_b + 1):
        f = C.RAW / "rems" / f"sol_{s:05d}.json"
        if not f.exists():
            continue
        d = json.loads(f.read_text())
        if d.get("missing"):
            continue
        for u, p, k in zip(d["utc"], d["pressure_pa"], d["ok"]):
            if k:
                ts.append(dt.datetime.fromisoformat(u).timestamp()); ps.append(p)
    o = np.argsort(ts)
    return np.asarray(ts)[o], np.asarray(ps)[o]


if __name__ == "__main__":
    import sys
    a, b = (int(x) for x in sys.argv[1:3]) if len(sys.argv) > 2 else (1720, 3895)
    print(fetch_range(a, b))

"""Solar particle events (SPEs) in the RAD record: reproducible, record-level detection windows.

Not a radiation model. This module only locates, from NASA RAD Level 2 detector-E records (about 17 min each), the time
intervals in which a documented solar particle event raised the surface dose rate, so that the terrain analysis can be
re-run with those records screened out (terrain_signal.screened_results).

Rule (per documented event, fully determined by the constants below):
  1. Search span: the documented event date +/- a few days (EVENTS).
  2. Quiet baseline: median detector-E dose rate of the QUIET_DAYS whole days at the start of the span (before onset).
  3. Smooth with a running median over SMOOTH records (about 85 min) to suppress single-record glitches.
  4. Enhancement window: the contiguous interval around the maximum in which the smoothed dose rate exceeds
     baseline * (1 + THRESHOLD). Sensitivity: THRESHOLDS.
  5. Forbush-decrease window (sensitivity only): from the end of the enhancement until the smoothed dose rate is back
     above baseline * (1 - FD_TOL) for at least FD_HOLD_H hours. A Forbush decrease lowers the dose (opposite sign).
Event chronology (documented): Hassler et al. 2018 Space Weather 16 and Zeitlin et al. 2018 GRL (10-11 Sep 2017,
GLE72, followed by a Forbush decrease from 13 Sep, Ehresmann et al. 2018 GRL); 28 Oct 2021 GLE73 (Papaioannou et al.
2022 A&A; detected by Curiosity); 15 Feb 2022 (Tianwen-1/MAVEN/TGO/Curiosity, GRL 2024, doi 10.1029/2024GL111775).
"""
from __future__ import annotations

import datetime as dt
import json

import numpy as np

from . import config as C
from . import ingest as I

EVENTS = [
    dict(id="sep2017", name="10-11 September 2017 solar particle event (GLE72 at Earth)", span=("2017-09-04", "2017-09-28"),
         refs=["Hassler et al. (2018), Space Weather 16, 'Space weather on the surface of Mars: impact of the September 2017 events'",
               "Zeitlin et al. (2018), GRL, 'Analysis of the radiation hazard observed by RAD on the surface of Mars during the September 2017 solar particle event'",
               "Ehresmann et al. (2018), GRL (Forbush decrease from 13 September 2017)"]),
    dict(id="sep2021", name="28 October 2021 solar particle event (GLE73 at Earth)", span=("2021-10-22", "2021-11-12"),
         refs=["Papaioannou et al. (2022), A&A, 'The first ground-level enhancement of solar cycle 25 on 28 October 2021'",
               "NASA (2023): Curiosity's RAD detected the 28 October 2021 event at the Martian surface"]),
    dict(id="sep2022", name="15 February 2022 solar particle event", span=("2022-02-09", "2022-02-28"),
         refs=["GRL (2024), doi 10.1029/2024GL111775: event observed by Tianwen-1, MAVEN, TGO and Curiosity"]),
]
QUIET_DAYS = 5
SMOOTH = 5
THRESHOLD = 0.10
THRESHOLDS = (0.05, 0.10, 0.20)
FD_TOL, FD_HOLD_H = 0.03, 12.0


def _records(span):
    a, b = (dt.date.fromisoformat(x) for x in span)
    paths, d = [], a
    while d <= b:
        p = I.rad_file_for_day(d)
        if p.exists():
            paths.append(p)
        d += dt.timedelta(days=1)
    if not paths:
        return None
    r = I.read_rad(paths)
    good = (r["flag"] == 0) & np.isfinite(r["E"]) & (r["E"] > 0)
    t = np.array([dt.datetime.fromisoformat(u).replace(tzinfo=dt.timezone.utc).timestamp() for u in r["utc"][good]])
    o = np.argsort(t)
    return t[o], r["E"][good][o], len(paths)


def _runmed(x, k):
    h = k // 2
    return np.array([np.median(x[max(0, i - h):i + h + 1]) for i in range(x.size)])


def _iso(ts):
    return dt.datetime.fromtimestamp(ts, dt.timezone.utc).isoformat(timespec="minutes")


def detect(ev, threshold=THRESHOLD):
    rec = _records(ev["span"])
    if rec is None:
        return dict(id=ev["id"], available=False, note="no RAD Level 2 files cached for this span (not needed by the walk-area stops)")
    t, E, nfiles = rec
    t0 = dt.datetime.fromisoformat(ev["span"][0]).replace(tzinfo=dt.timezone.utc).timestamp()
    quiet = t < t0 + QUIET_DAYS * 86400
    base = float(np.median(E[quiet]))
    s = _runmed(E, SMOOTH)
    k = int(np.argmax(s))
    hi = s > base * (1 + threshold)
    if not hi[k]:
        return dict(id=ev["id"], available=True, detected=False, baseline=base, peak=float(s[k]))
    i0 = k
    while i0 > 0 and hi[i0 - 1]:
        i0 -= 1
    i1 = k
    while i1 < s.size - 1 and hi[i1 + 1]:
        i1 += 1
    # Forbush decrease: first fall below base*(1-FD_TOL) within 3 days after the enhancement, then recovery sustained
    # for FD_HOLD_H hours above that level. None if the dose never drops below the tolerance.
    fd_start = fd_end = None
    j = i1 + 1
    while j < s.size and t[j] - t[i1] <= 3 * 86400:
        if s[j] < base * (1 - FD_TOL):
            fd_start = j; break
        j += 1
    if fd_start is not None:
        j = fd_start
        while j < s.size:
            if s[j] >= base * (1 - FD_TOL):
                k2 = j
                while k2 < s.size and s[k2] >= base * (1 - FD_TOL):
                    k2 += 1
                if k2 >= s.size or (t[k2 - 1] - t[j]) >= FD_HOLD_H * 3600:
                    fd_end = t[j]; break
                j = k2
            j += 1
    fd_min = float(s[i1 + 1:].min()) if i1 + 1 < s.size else None
    return dict(id=ev["id"], available=True, detected=True, threshold=threshold, files=nfiles, baseline_uGy_d=base,
                peak_uGy_d=float(s[k]), peak_utc=_iso(t[k]), peak_ratio=float(s[k] / base),
                enhancement=[_iso(t[i0]), _iso(t[i1])], enhancement_ts=[float(t[i0]), float(t[i1])],
                enhancement_hours=float((t[i1] - t[i0]) / 3600), records_in_enhancement=int(i1 - i0 + 1),
                forbush=[_iso(t[i1]), _iso(fd_end)] if fd_end else None, forbush_ts=[float(t[i1]), float(fd_end)] if fd_end else None,
                forbush_onset=_iso(t[fd_start]) if fd_start is not None else None,
                forbush_min_ratio=(fd_min / base) if fd_min else None)


def series(ev, step_h=1.0):
    """Hourly medians of the raw records over the search span (for the observational figure; Level A)."""
    rec = _records(ev["span"])
    if rec is None:
        return None
    t, E, _ = rec
    b = np.floor(t / (step_h * 3600)).astype(int)
    out = []
    for k in np.unique(b):
        m = b == k
        out.append([_iso(k * step_h * 3600), float(np.median(E[m])), int(m.sum())])
    return out


def run() -> dict:
    out = dict(generated_utc=I._now(), rule=dict(quiet_days=QUIET_DAYS, smooth_records=SMOOTH, threshold=THRESHOLD,
               thresholds=list(THRESHOLDS), forbush_tolerance=FD_TOL, forbush_hold_h=FD_HOLD_H),
               level="A: visualisation and screening of historically observed RAD dose; no SPE dose model", events=[])
    for ev in EVENTS:
        e = dict(id=ev["id"], name=ev["name"], span=ev["span"], refs=ev["refs"],
                 windows={f"{th:.2f}": detect(ev, th) for th in THRESHOLDS})
        e["series_hourly"] = series(ev)
        out["events"].append(e)
    (C.PROC / "sep_events.json").write_text(json.dumps(out, indent=1))
    return out


def windows(threshold=THRESHOLD, include_forbush=False, only=None):
    """[(start_ts, end_ts, event_id)] for screening; read from the processed file (run() first)."""
    d = json.loads((C.PROC / "sep_events.json").read_text())
    w = []
    for e in d["events"]:
        if only and e["id"] not in only:
            continue
        x = e["windows"].get(f"{threshold:.2f}")
        if not x or not x.get("detected"):
            continue
        a, b = x["enhancement_ts"]
        if include_forbush and x.get("forbush_ts"):
            b = x["forbush_ts"][1]
        w.append((a, b, e["id"]))
    return w


if __name__ == "__main__":
    o = run()
    for e in o["events"]:
        for th, x in e["windows"].items():
            print(e["id"], th, {k: x.get(k) for k in ("available", "detected", "baseline_uGy_d", "peak_ratio", "enhancement", "enhancement_hours", "forbush", "forbush_min_ratio", "note")})

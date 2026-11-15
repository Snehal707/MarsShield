"""Surface pressure and atmospheric column depth at Gale, Jezero and the Olympus Mons caldera.

One source for all three sites (matched assumptions): the Mars Climate Database v6.2 web interface
(LMD/OU/IAA/ESA/CNES; Millour et al.), climatology average-solar scenario, high-resolution topography,
queried as a full Ls x local-time table per site and averaged here (the interface's own diurnal-mean
option returned local-time-0 values with ls=all). MCD files are not redistributed (MCD terms); only the
derived site numbers and the query URLs are stored, in data/processed/site_atmosphere.json.

Checks, not inputs: Perseverance MEDA derived pressure (PDS Atmospheres Node, DOI 10.17189/1522849) at
Jezero, normalised to the landing elevation hydrostatically; the 82 Pa (Olympus) and 868 Pa (Gale)
values used by Zhang et al. (2022). REMS at Gale is already in the repository (rems.py).

Column depth X = P / g with g = 3.71 m/s^2 for every site, as in Zhang et al. (2022): 1 Pa = 0.026954
g/cm^2. Point-mass gravity with rotation is 3.706 (Gale), 3.708 (Jezero), 3.656-3.664 (Olympus); the
constant-g bias is under 0.1 % at Gale and Jezero and 1.3-1.5 % at Olympus, far below the pressure
uncertainty there, and identical treatment keeps the comparison consistent.

Run: python -m marsshield.atmosphere [--query]   (--query re-queries MCD: moderate use only, about 9 requests)
"""
from __future__ import annotations

import csv
import io
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request

from . import config as C

G_MARS = 3.71
PA_TO_GCM2 = 1 / (G_MARS * 10)            # 1 Pa -> g/cm^2
MCD_CGI = "https://www-mars.lmd.jussieu.fr/mcd_python/cgi-bin/mcdcgi.py"
MEDA_DER = "https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/data_derived_env/"
UA = {"User-Agent": "MarsShield-research-pipeline/1.0"}
RAW = C.RAW / "atmosphere"
OUT = C.PROC / "site_atmosphere.json"

# query points: lat, east lon, and the elevation MCD reports for that point (high-resolution topography)
SITES = {
    "gale": dict(lat=-4.59, lon=137.44, label="Gale Crater (Curiosity study area)"),
    "jezero": dict(lat=18.44, lon=77.45, label="Jezero Crater (Perseverance landing site)"),
    "oly_summit": dict(lat=17.350, lon=226.565, label="Olympus Mons summit (highest point, outside the caldera)"),
    "oly_zeus": dict(lat=18.372, lon=227.034, label="Olympus Mons caldera, Zeus Patera centre"),
    "oly_athena": dict(lat=18.723, lon=227.186, label="Olympus Mons caldera, Athena Patera"),
}
SCENARIOS = {"": 1, "_cold": 8, "_warm": 7, "_MY36": 36}   # MCD 'dust' keys: 1 climatology average solar, 8 cold, 7 warm, 36 Mars Year 36


def mcd_url(lat: float, lon: float, dust: int = 1) -> str:
    p = dict(var1="ps", var2="none", var3="none", var4="none", datekeyhtml=1, ls="all", localtime="all", year=2026, month=11, day=15,
             hours=0, minutes=0, seconds=0, julian=2461360, martianyear=38, sol=1, latitude=lat, longitude=lon, altitude="10.", zkey=3,
             spacecraft="none", isfixedlt="off", dust=dust, hrkey=1, averaging="off", dpi=80, islog="off", colorm="jet", minval="", maxval="",
             proj="cyl", palt="", plon="", plat="", trans="", iswind="off", latpoint="", lonpoint="")
    return MCD_CGI + "?" + urllib.parse.urlencode(p)


def query_mcd() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    jobs = [(k, s, "", 1) for k, s in SITES.items()] + [("jezero", SITES["jezero"], "_MY36", 36), ("gale", SITES["gale"], "_cold", 8),
                                                       ("oly_summit", SITES["oly_summit"], "_cold", 8), ("oly_summit", SITES["oly_summit"], "_warm", 7)]
    for k, s, tag, dust in jobs:
        url = mcd_url(s["lat"], s["lon"], dust)
        h = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300).read().decode("utf8", "replace")
        m = re.search(r"href='\.\./(txt/[0-9a-f]+\.txt)'", h)
        if not m:
            raise RuntimeError(f"MCD returned no table for {k}{tag}")
        t = urllib.request.urlopen("https://www-mars.lmd.jussieu.fr/mcd_python/" + m.group(1), timeout=120).read().decode()
        (RAW / f"{k}_ps_ls_x_lt{tag}.txt").write_text("### query: " + url + "\n" + t)
        time.sleep(2)


def parse_mcd(path) -> dict:
    """Ls x local-time table -> annual mean of diurnal means, seasonal extremes, diurnal range, orography."""
    rows, url, alt = [], None, None
    for ln in open(path, encoding="utf8"):
        if ln.startswith("### query:"):
            url = ln.split(":", 1)[1].strip()
        if "||" in ln and not ln.startswith("----"):
            a, b = ln.split("||")
            rows.append((float(a), [float(x) for x in b.split()]))
    rows = [r for r in rows if r[0] < 359]
    dm = [(ls, sum(v[:24]) / 24) for ls, v in rows]
    allv = [x for _, v in rows for x in v[:24]]
    amp = [max(v[:24]) - min(v[:24]) for _, v in rows]
    lo, hi = min(dm, key=lambda t: t[1]), max(dm, key=lambda t: t[1])
    return {"annual_mean_pa": round(sum(x for _, x in dm) / len(dm), 1), "season_min": {"ls": lo[0], "pa": round(lo[1], 1)},
            "season_max": {"ls": hi[0], "pa": round(hi[1], 1)}, "instantaneous_pa": [round(min(allv), 1), round(max(allv), 1)],
            "diurnal_peak_to_peak_pa": [round(min(amp), 1), round(max(amp), 1)],
            "diurnal_mean_by_ls": [[ls, round(p, 1)] for ls, p in dm], "query_url": url}


def at_ls(entry: dict, ls: float) -> float:
    return dict((round(a), b) for a, b in entry["diurnal_mean_by_ls"])[round(ls)]


def meda_check(sample_json, waypoints, z_ref: float = -2569.9, H: float = 10400.0) -> dict:
    """Hour-balanced MEDA sol means, fill values (999999999) removed, normalised to the landing elevation with
    exp((z_rover - z_ref) / H) using the rover elevation at the nearest earlier localized waypoint."""
    sols = json.loads(open(sample_json, encoding="utf8").read())
    wp = sorted((w[3], w[2]) for w in waypoints if w[2] is not None)
    out = []
    for s in sols:
        hm = s.get("hourly_mean")
        if not hm or s.get("max", 0) > 2000 or s.get("hours", 0) < 10:
            continue   # fill-value contamination or too few local hours for an unbiased sol mean
        z = next((zz for sol, zz in reversed(wp) if sol <= s["sol"]), wp[0][1])
        p = sum(hm.values()) / len(hm)
        out.append({"sol": s["sol"], "pa": round(p, 1), "rover_elev_m": z, "pa_at_landing_elev": round(p * math.exp((z - z_ref) / H), 1)})
    vals = [o["pa_at_landing_elev"] for o in out]
    return {"n_sols": len(out), "mean_pa": round(sum(vals) / len(vals), 1), "min_pa": min(vals), "max_pa": max(vals), "sols": out,
            "note": "Every 20th sol (20-1340), derived pressure product DER_PS, hour-balanced sol means; sols with fill values or <10 local hours excluded; normalised to the landing elevation (-2,570 m) with H = 10.4 km."}


def build(sample_json=None) -> dict:
    mcd = {}
    for k in SITES:
        for tag in SCENARIOS:
            f = RAW / f"{k}_ps_ls_x_lt{tag}.txt"
            if f.exists():
                mcd[k + tag] = parse_mcd(f)
    for k, v in mcd.items():
        v["column_gcm2"] = {"annual_mean": round(v["annual_mean_pa"] * PA_TO_GCM2, 3), "season_min": round(v["season_min"]["pa"] * PA_TO_GCM2, 3),
                            "season_max": round(v["season_max"]["pa"] * PA_TO_GCM2, 3)}
    out = {
        "source": "Mars Climate Database v6.2 web interface, climatology average-solar scenario, high-resolution topography (MOLA 32 ppd + Viking Lander 1 pressure); Ls x local-time tables averaged here",
        "citation": "Millour, E., Forget, F., et al., The Mars Climate Database (version 6.x). LMD/OU/IAA/ESA/CNES. https://www-mars.lmd.jussieu.fr/",
        "terms": "MCD output files are not redistributed; derived numbers only, with query URLs.",
        "g_ms2": G_MARS, "pa_to_gcm2": PA_TO_GCM2, "sites": {k: {**SITES[k.split('_cold')[0].split('_warm')[0].split('_MY36')[0]], **v} for k, v in mcd.items()},
        "matched_scenarios": {"baseline": "annual mean of diurnal means", "low": "Ls 150 diurnal mean (seasonal minimum at Gale and Jezero; within 1 % of the Olympus minimum at Ls 135)",
                              "high": "Ls 255 diurnal mean (seasonal maximum at every site)"},
        "hydrostatic_scale_height_m": {"jezero": 10400, "olympus": 10800,
                                       "note": "Effective H implied by MCD site pairs (10.8-10.9 km at Olympus); MCD near-surface scale height 9.4-10.9 km over the year. Used only to map pressure across each region's DEM (exploratory)."},
        "references": {"zhang2022_pressures_pa": {"olympus_top": 82, "gale": 868, "note": "Zhang et al. (2022), MCD at Ls 0, local midnight"},
                       "sanchez_lavega2023": "MEDA daily mean 735 Pa (sols 15-20), max 761 Pa (sol ~105), 625 Pa (sol 306); MCD minus MEDA typically 4-6 Pa, at most ~10 Pa"},
    }
    if sample_json:
        man = json.loads((C.WEB_PUBLIC / "regions" / "jezero" / "manifest.json").read_text())
        out["meda_check"] = meda_check(sample_json, man["traverse"]["waypoints"])
        out["meda_check"]["source"] = MEDA_DER
        out["meda_check"]["mcd_annual_mean_pa"] = mcd["jezero"]["annual_mean_pa"]
        out["meda_check"]["mcd_minus_meda_pct"] = round((mcd["jezero"]["annual_mean_pa"] / out["meda_check"]["mean_pa"] - 1) * 100, 2)
    OUT.write_text(json.dumps(out, indent=1))
    return out


if __name__ == "__main__":
    if "--query" in sys.argv:
        query_mcd()
    s = next((a for a in sys.argv[1:] if a.endswith(".json")), None)
    r = build(s)
    for k, v in r["sites"].items():
        print(f"{k:18s} {v['annual_mean_pa']:7.1f} Pa ({v['season_min']['pa']:.1f}-{v['season_max']['pa']:.1f})  X {v['column_gcm2']['annual_mean']:.2f} g/cm2")
    if "meda_check" in r:
        m = r["meda_check"]; print("MEDA", m["n_sols"], m["mean_pa"], m["min_pa"], m["max_pa"], "MCD-MEDA %", m["mcd_minus_meda_pct"])

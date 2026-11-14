"""Observed Curiosity RAD dose rates at every rover stop in the walk area (OBSERVATIONS layer).

For each localized waypoint we average the NASA RAD Level 2 detector-E dose rate (tissue-equivalent
plastic, uGy/day, quality-flagged records removed) over the time the rover was parked there.

Because the GCR dose rate drifts with the solar cycle and Martian season (RAD E fell from
~315 to ~215 uGy/d between early 2020 and late 2022), raw rates at different stops are NOT a
spatial map. We therefore also compute a *local anomaly*: stop mean / median of all other
observations within +/- WINDOW sols, minus 1. The same operation is applied to the modeled rate
at the stops (model anomaly), so observed and modeled anomalies are compared like for like.

Only stops with >= MIN_SOLS of quality data enter the anomaly comparison (to average over the
diurnal pressure cycle, which modulates the dose by a few percent; Rafkin et al. 2014).
"""
from __future__ import annotations

import json

import numpy as np

from . import config as C
from . import ingest as I
from .horizon import blocked_fraction_by_zenith, blocked_solid_angle_fraction, horizon_profile
from .radiation import TerrainDoseModel
from .sites import stack

WINDOW = 15.0
MIN_SOLS = 1.0


def walk_stops() -> list[dict]:
    b = C.WALK_BOUNDS
    wps = sorted(I.load_waypoints(), key=lambda p: (p["sol"], p["site"], p["drive"]))
    by_sol = {}
    for p in wps:
        by_sol[p["sol"]] = p
    seq = sorted(by_sol.values(), key=lambda p: p["sol"])
    out = []
    for i, p in enumerate(seq):
        nxt = seq[i + 1]["sol"] if i + 1 < len(seq) else p["sol"] + 1
        if b["left"] <= p["easting"] <= b["right"] and b["bottom"] <= p["northing"] <= b["top"]:
            out.append(dict(x=p["easting"], y=p["northing"], z=p["elev_geoid"], sol=p["sol"], rmc=p["RMC"],
                            sol_a=p["sol"] + 0.5, sol_b=nxt + 0.5))
    return out


def build() -> dict:
    stops = walk_stops()
    a = min(s["sol_a"] for s in stops) - WINDOW; b = max(s["sol_b"] for s in stops) + WINDOW
    r = I.read_rad(I.fetch_rad_sols(a, b))
    good = (r["flag"] == 0) & np.isfinite(r["E"]) & (r["E"] > 0)
    sol, E = r["sol"][good], r["E"][good]
    utc = r["utc"][good]
    model = TerrainDoseModel()
    st = stack()
    for s in stops:
        m = (sol >= s["sol_a"]) & (sol < s["sol_b"])
        s["n_obs"] = int(m.sum())
        s["n_flagged"] = int(((r["sol"] >= s["sol_a"]) & (r["sol"] < s["sol_b"]) & ~good).sum())
        if m.sum() >= 3:
            s["E_mean"] = float(E[m].mean()); s["E_sem"] = float(E[m].std(ddof=1) / np.sqrt(m.sum()))
            s["utc_start"], s["utc_end"] = str(utc[m][0]), str(utc[m][-1])
            s["data_sols"] = float(sol[m].max() - sol[m].min())
            mid = 0.5 * (s["sol_a"] + s["sol_b"])
            bg = (sol >= mid - WINDOW) & (sol <= mid + WINDOW) & ~m
            s["E_background_median"] = float(np.median(E[bg])) if bg.sum() > 50 else None
            s["anomaly_obs"] = s["E_mean"] / s["E_background_median"] - 1 if s["E_background_median"] else None
        hp = horizon_profile(st, s["x"], s["y"], C.RAD_HEIGHT_M, n_az=720)
        ros = blocked_fraction_by_zenith(hp["elev"])
        d = model.dose(ros, 500.0)
        s["B"] = d.B; s["rel_total_model"] = d.rel_total; s["rel_sky_model"] = d.rel_sky
    # model anomaly: same detrending as the observations, using time-weighted neighbouring stops
    for s in stops:
        mid = 0.5 * (s["sol_a"] + s["sol_b"])
        nb = [o for o in stops if o is not s and abs(0.5 * (o["sol_a"] + o["sol_b"]) - mid) <= WINDOW]
        if nb:
            w = np.array([o["sol_b"] - o["sol_a"] for o in nb]); v = np.array([o["rel_total_model"] for o in nb])
            order = np.argsort(v); cw = np.cumsum(w[order]) / w.sum()
            med = float(v[order][np.searchsorted(cw, 0.5)])
            s["anomaly_model"] = s["rel_total_model"] / med - 1
        else:
            s["anomaly_model"] = None
    sel = [s for s in stops if s.get("anomaly_obs") is not None and s.get("anomaly_model") is not None
           and s.get("data_sols", 0) >= MIN_SOLS]
    ao = np.array([s["anomaly_obs"] for s in sel]); am = np.array([s["anomaly_model"] for s in sel])
    stats = dict(n=len(sel), pearson_r=float(np.corrcoef(ao, am)[0, 1]) if len(sel) > 2 else None,
                 slope_obs_on_model=float(np.polyfit(am, ao, 1)[0]) if len(sel) > 2 else None,
                 rmse_pp=float(np.sqrt(np.mean((ao - am) ** 2)) * 100),
                 obs_anomaly_std_pp=float(ao.std() * 100), model_anomaly_std_pp=float(am.std() * 100),
                 window_sols=WINDOW, min_sols=MIN_SOLS)
    # bootstrap CI for r
    if len(sel) > 5:
        rng = np.random.default_rng(1); rs = []
        for _ in range(2000):
            i = rng.integers(0, len(sel), len(sel)); rs.append(np.corrcoef(ao[i], am[i])[0, 1])
        stats["pearson_r_95ci"] = [float(np.nanpercentile(rs, 2.5)), float(np.nanpercentile(rs, 97.5))]
    # daily RAD E time series across the walk-area period (for the time-series panel)
    days = np.floor(sol).astype(int)
    ud = np.unique(days)
    ts = [dict(sol=int(d), E=float(E[days == d].mean()), n=int((days == d).sum())) for d in ud if (days == d).sum() >= 10]
    out = dict(stops=stops, anomaly_stats=stats, daily=ts,
               note="E_mean: NASA RAD L2 DOSIMETRY_TOTAL[E] (tissue-equivalent plastic), uGy/day, FLAGGED_DATA removed.")
    C.PROC.mkdir(parents=True, exist_ok=True)
    (C.PROC / "observations.json").write_text(json.dumps(out, indent=1, default=float))
    return out


if __name__ == "__main__":
    o = build()
    print(json.dumps(o["anomaly_stats"], indent=1))

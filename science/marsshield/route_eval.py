"""Route engine evaluation (writes data/processed/route_eval.json).

R1  Random origin-destination pairs in the walk area: every objective vs. the shortest-distance
    baseline (distance, time, modeled dose).
R2  Metrication check: grid shortest path vs. straight-line length on near-flat pairs.
R3  Map fidelity: 72-azimuth / 5 m shielding map vs. 720-azimuth 1 m horizon profiles at the
    real rover stops (the map drives routing; the profile drives point analysis).
"""
from __future__ import annotations

import json

import numpy as np

from . import config as C
from . import planner
from .horizon import blocked_fraction_by_zenith, horizon_profile
from .radiation import TerrainDoseModel
from .sites import stack


def r1_random_pairs(n=150, min_sep=600.0, seed=7) -> dict:
    rt = planner.router(0.21)
    rng = np.random.default_rng(seed)
    passable = np.isfinite(rt.z)
    deg = np.bincount(rt.edges.src, minlength=rt.edges.n).reshape(rt.ny, rt.nx)
    cand = np.argwhere(passable & (deg >= 12))
    rows = []
    D0 = planner.flat_dose_rate(500.0, 0.21)
    tries = 0
    while len(rows) < n and tries < n * 20:
        tries += 1
        a, b = cand[rng.integers(len(cand))], cand[rng.integers(len(cand))]
        if np.hypot(*(a - b)) * rt.res < min_sep:
            continue
        res = {}
        for obj in planner.OBJECTIVES:
            p = rt.path(tuple(a), tuple(b), obj)
            if p is None:
                res = None; break
            m = rt.metrics(p, D0)
            res[obj] = dict(d=m["distance_m"], t=m["time_h"], dose=m["dose_uGy"], rate=m["mean_rel_rate"],
                            maxs=m["max_slope_deg"])
        if res:
            rows.append(dict(a=a.tolist(), b=b.tolist(), sep_m=float(np.hypot(*(a - b)) * rt.res), **res))
    summ = {}
    for obj in planner.OBJECTIVES:
        dd = np.array([r[obj]["d"] / r["shortest"]["d"] - 1 for r in rows]) * 100
        dt = np.array([r[obj]["t"] / r["shortest"]["t"] - 1 for r in rows]) * 100
        dq = np.array([r[obj]["dose"] / r["shortest"]["dose"] - 1 for r in rows]) * 100
        rr = np.array([r[obj]["rate"] / r["shortest"]["rate"] - 1 for r in rows]) * 100
        summ[obj] = dict(distance_pct_median=float(np.median(dd)), distance_pct_p90=float(np.percentile(dd, 90)),
                         time_pct_median=float(np.median(dt)), dose_pct_median=float(np.median(dq)),
                         dose_pct_p10=float(np.percentile(dq, 10)), dose_pct_p90=float(np.percentile(dq, 90)),
                         mean_rate_pct_median=float(np.median(rr)),
                         frac_pairs_lower_dose_than_baseline=float(np.mean(dq < -0.05)))
    # how much of low-dose's saving comes from walking faster vs. walking in shielded terrain?
    t_part = np.array([r["low_dose"]["t"] / r["shortest"]["t"] - 1 for r in rows])
    r_part = np.array([r["low_dose"]["rate"] / r["shortest"]["rate"] - 1 for r in rows])
    summ["low_dose_decomposition"] = dict(time_change_median_pct=float(np.median(t_part) * 100),
                                          rate_change_median_pct=float(np.median(r_part) * 100))
    # dose saving of low_dose vs fastest isolates the terrain-shielding contribution
    q = np.array([r["low_dose"]["dose"] / r["fastest"]["dose"] - 1 for r in rows]) * 100
    summ["low_dose_vs_fastest"] = dict(dose_pct_median=float(np.median(q)), dose_pct_p10=float(np.percentile(q, 10)),
                                       dose_pct_min=float(q.min()))
    return dict(n=len(rows), summary=summ, pairs=rows)


def r2_metrication(n=60, seed=3) -> dict:
    for thr in (3.0, 4.5, 6.0):
        out = _r2(n, seed, thr)
        if out["n"] >= 20:
            return out
    return out


def _r2(n, seed, thr) -> dict:
    rt = planner.router(0.21)
    g = planner.grid()
    rng = np.random.default_rng(seed)
    flat = np.argwhere(g["slope"] < thr)
    errs = []
    for _ in range(n * 200):
        a, b = flat[rng.integers(len(flat))], flat[rng.integers(len(flat))]
        sep = np.hypot(*(a - b)) * rt.res
        if sep < 150 or sep > 600:
            continue
        rr = np.linspace(a[0], b[0], 200).round().astype(int); cc = np.linspace(a[1], b[1], 200).round().astype(int)
        if g["slope"][rr, cc].max() > thr:
            continue
        p = rt.path(tuple(a), tuple(b), "shortest")
        m = rt.metrics(p, 1.0)
        errs.append(m["horizontal_m"] / sep - 1)
        if len(errs) >= n:
            break
    e = np.array(errs) * 100
    if e.size == 0:
        return dict(n=0, slope_threshold_deg=thr)
    return dict(n=len(e), slope_threshold_deg=thr, excess_pct_median=float(np.median(e)), excess_pct_max=float(e.max()))


def r3_map_fidelity() -> dict:
    obs = json.loads((C.PROC / "observations.json").read_text())
    g = planner.grid()
    m = TerrainDoseModel()
    st = stack()
    rows = []
    for s in obs["stops"][::3]:
        r = int(round((g["y0"] - s["y"]) / g["res"])); c = int(round((s["x"] - g["x0"]) / g["res"]))
        if not (0 <= r < g["z"].shape[0] and 0 <= c < g["z"].shape[1]):
            continue
        xc, yc = g["x0"] + c * g["res"], g["y0"] - r * g["res"]
        hp = horizon_profile(st, xc, yc, float(g["h_obs"]), n_az=720, z_ground=float(g["z"][r, c]))
        d = m.dose(blocked_fraction_by_zenith(hp["elev"]), 500.0)
        rows.append(dict(B_map=float(g["B"][r, c]), B_prof=d.B, rel_map=float(g["rel_tot"][r, c]), rel_prof=d.rel_total))
    dB = np.array([x["B_map"] - x["B_prof"] for x in rows]); dr = np.array([x["rel_map"] - x["rel_prof"] for x in rows])
    return dict(n=len(rows), B_bias=float(dB.mean()), B_mae=float(np.abs(dB).mean()), B_max=float(np.abs(dB).max()),
                rel_bias_pp=float(dr.mean() * 100), rel_mae_pp=float(np.abs(dr).mean() * 100),
                rel_max_pp=float(np.abs(dr).max() * 100))


def run() -> dict:
    out = dict(R1=r1_random_pairs(), R2=r2_metrication(), R3=r3_map_fidelity())
    (C.PROC / "route_eval.json").write_text(json.dumps(out, indent=1))
    return out


if __name__ == "__main__":
    o = run()
    print(json.dumps(o["R1"]["summary"], indent=1)); print(o["R2"]); print(o["R3"])

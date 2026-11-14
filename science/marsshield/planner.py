"""Mission planning service: multi-objective Marswalk routes with uncertainty bands."""
from __future__ import annotations

from functools import lru_cache

import numpy as np

from . import config as C
from .horizon import blocked_fraction_by_zenith, blocked_solid_angle_fraction, horizon_profile
from .radiation import ALPHA_DEFAULT, ALPHA_RANGE, TerrainDoseModel
from .routing import SUIT_FACTOR, Router

OBJECTIVES = ["shortest", "fastest", "low_dose", "shelter", "gentle"]
LABELS = {
    "shortest": "Shortest distance (baseline)",
    "fastest": "Fastest walk",
    "low_dose": "Lowest modeled dose",
    "shelter": "Maximum shielding",
    "gentle": "Gentlest slopes",
}


def rel_total_from(rel_sky: np.ndarray, B: np.ndarray, alpha: float) -> np.ndarray:
    a = alpha / (1 - alpha)
    return (rel_sky + (1 + B) * a) / (1 + a)


@lru_cache(maxsize=1)
def grid():
    from .terrain import load
    return load()


@lru_cache(maxsize=6)
def router(alpha: float = ALPHA_DEFAULT, suit: float = SUIT_FACTOR) -> Router:
    g = grid()
    rel = rel_total_from(g["rel_sky"], g["B"], alpha)
    rel = np.where(np.isfinite(g["z"]), rel, 1.0)
    return Router(g["z"], float(g["res"]), rel, float(g["x0"]), float(g["y0"]), suit_factor=suit)


@lru_cache(maxsize=1)
def model() -> TerrainDoseModel:
    return TerrainDoseModel()


def flat_dose_rate(phi: float, alpha: float) -> float:
    """Absolute modeled RAD-E-equivalent dose rate on open flat ground [uGy/d]."""
    m = TerrainDoseModel(model().zm, alpha=alpha)
    return m.dose(np.zeros(91), phi).D_total_flat


def rate_at(rt: Router, x: float, y: float) -> float:
    r, c = rt.to_rc(x, y)
    return float(rt.rate[np.clip(r, 0, rt.ny - 1), np.clip(c, 0, rt.nx - 1)])


def plan(start, end, stops=(), dwell_h=0.0, phi: float = 500.0, alpha: float = ALPHA_DEFAULT,
         objectives=OBJECTIVES) -> dict:
    """dwell_h: one value for every intermediate stop, or a list with one value per stop."""
    rt = router(round(alpha, 3))
    dw = list(dwell_h) if isinstance(dwell_h, (list, tuple)) else [float(dwell_h)] * len(stops)
    if len(dw) != len(stops):
        raise ValueError("dwell_h list must have one value per stop")
    pts = [tuple(start)] + [tuple(s) for s in stops] + [tuple(end)]
    rcs = [rt.to_rc(*p) for p in pts]
    for (r, c), p in zip(rcs, pts):
        if not (0 <= r < rt.ny and 0 <= c < rt.nx):
            raise ValueError(f"point {p} outside walk area")
    D0 = flat_dose_rate(phi, alpha)
    lo = {a: router(round(a, 3)) for a in ALPHA_RANGE}
    routes = []
    for obj in objectives:
        nodes = []
        ok = True
        for i in range(len(rcs) - 1):
            n = rt.path(rcs[i], rcs[i + 1], obj)
            if n is None:
                ok = False; break
            nodes.append(n if i == 0 else n[1:])
        if not ok:
            routes.append(dict(objective=obj, label=LABELS[obj], feasible=False)); continue
        nodes = np.concatenate(nodes)
        m = rt.metrics(nodes, D0)
        # dwell exposure at intermediate science stops
        dwell = sum(d * rate_at(rt, *p) for d, p in zip(dw, pts[1:-1])) * D0 / 24.0
        m["dwell_dose_uGy"] = float(dwell)
        m["total_dose_uGy"] = m["dose_uGy"] + m["dwell_dose_uGy"]
        # uncertainty band: albedo fraction alpha in [0.18, 0.24] at fixed phi, and phi in [400, 800]
        band = []
        for a, r2 in lo.items():
            D0a = flat_dose_rate(phi, a)
            mm = r2.metrics(nodes, D0a)
            band.append(mm["dose_uGy"] + sum(d * rate_at(r2, *p) for d, p in zip(dw, pts[1:-1])) * D0a / 24.0)
        phis = [flat_dose_rate(p, alpha) / D0 * m["total_dose_uGy"] for p in (400.0, 800.0)]
        m["dose_band_alpha_uGy"] = [float(min(band)), float(max(band))]
        m["dose_band_phi_uGy"] = [float(min(phis)), float(max(phis))]
        m.update(objective=obj, label=LABELS[obj], feasible=True)
        routes.append(m)
    base = next((r for r in routes if r["objective"] == "shortest" and r["feasible"]), None)
    if base:
        for r in routes:
            if r.get("feasible"):
                r["vs_baseline"] = dict(
                    distance_pct=100 * (r["distance_m"] / base["distance_m"] - 1),
                    time_pct=100 * (r["time_h"] / base["time_h"] - 1),
                    dose_pct=100 * (r["total_dose_uGy"] / base["total_dose_uGy"] - 1))
    return dict(start=list(start), end=list(end), stops=[list(s) for s in stops],
                dwell_h=dw[0] if dw and len(set(dw)) == 1 else (dw if dw else 0.0), dwell_per_stop_h=dw,
                phi=phi, alpha=alpha, D_flat_uGy_d=D0, routes=routes,
                assumptions=dict(suit_factor=rt.suit, max_slope_deg=float(np.degrees(np.arctan(rt.max_slope))),
                                 h_obs_m=float(grid()["h_obs"]), grid_m=float(grid()["res"]),
                                 n_az_map=int(grid()["n_az"])))


def sky_at(x: float, y: float, h_obs: float = C.ASTRONAUT_HEIGHT_M, phi: float = 500.0,
           alpha: float = ALPHA_DEFAULT) -> dict:
    """High-fidelity sky analysis at one point (720 azimuths, 1 m DEM near field)."""
    from .sites import stack
    hp = horizon_profile(stack(), x, y, h_obs, n_az=720, r_max=20000.0)
    ros = blocked_fraction_by_zenith(hp["elev"])
    m = TerrainDoseModel(model().zm, alpha=alpha)
    d = m.dose(ros, phi)
    dz = m.zenith_contribution(phi)
    return dict(x=x, y=y, h_obs=h_obs, z_ground=hp["z_obs"] - h_obs, az=hp["az"].round(2).tolist(),
                elev=hp["elev"].round(3).tolist(), dist=hp["dist"].round(1).tolist(),
                ros=ros.round(4).tolist(), zenith_dose_full=dz.round(4).tolist(),
                zenith_dose_vis=((1 - ros) * dz).round(4).tolist(),
                B=d.B, dose=d.as_dict(), phi=phi, alpha=alpha,
                blocked_solid_angle=blocked_solid_angle_fraction(ros))

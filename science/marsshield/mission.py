"""Science Marswalk: documented science objectives -> route -> per-stop radiation decision.

A mission is an ordered list of science targets (marsshield.targets). The first target is the EVA start and
the last is the end; intermediate targets are science stops. For each intermediate stop:

1. the break-even explorer runs between the previous and next waypoint, with the stop's work radius and
   planned duration range (planning assumptions from targets.ACTIVITY);
2. a stop location is chosen ONLY if the difference is resolved against validated model error and the
   choice is the same across the planned duration range; otherwise the astronaut works at the target itself;
3. the final route uses the lowest-dose path through the chosen stop locations, and doses are split into
   walking and stationary parts, with the share of each.

Endpoint activities (first and last target) are stationary at the target itself.
"""
from __future__ import annotations

import json

import numpy as np

from . import breakeven as BE
from . import config as C
from . import planner
from .radiation import ALPHA_DEFAULT
from .targets import build as build_targets

DEFAULT_MISSION = ["nontron", "mgn", "canaima"]


def workable_point(x: float, y: float, max_m: float = 40.0) -> tuple[float, float, float]:
    """Nearest cell with slope <= the workable-stop limit (same rule as the break-even explorer)."""
    g = planner.grid(); rt = planner.router()
    r0, c0 = rt.to_rc(x, y)
    k = int(np.ceil(max_m / rt.res))
    rr, cc = np.mgrid[max(0, r0 - k):min(rt.ny, r0 + k + 1), max(0, c0 - k):min(rt.nx, c0 + k + 1)]
    d = np.hypot(rr - r0, cc - c0) * rt.res
    ok = (d <= max_m) & (g["slope"][rr, cc] <= BE.STOP_MAX_SLOPE_DEG)
    if not ok.any():
        raise ValueError("no workable stop location near target")
    i = int(np.argmin(np.where(ok, d, np.inf)))
    xx, yy = rt.to_xy(rr.ravel()[i], cc.ravel()[i])
    return float(xx), float(yy), float(d.ravel()[i])


def _catalog():
    return {t["id"]: t for t in build_targets()}


def plan_mission(ids: list[str], phi: float = 500.0, alpha: float = ALPHA_DEFAULT, durations: dict | None = None) -> dict:
    cat = _catalog()
    if len(ids) < 2:
        raise ValueError("a mission needs at least a start and an end target")
    for i in ids:
        if i not in cat:
            raise ValueError(f"unknown science target {i}")
    T = [cat[i] for i in ids]
    dur = {i: (durations or {}).get(i, cat[i]["duration_h"][1]) for i in ids}
    D0 = planner.flat_dose_rate(phi, alpha)
    rt = planner.router(round(alpha, 3))
    stops = []
    ends = [workable_point(T[0]["x"], T[0]["y"]), workable_point(T[-1]["x"], T[-1]["y"])]
    chosen = [ends[0][:2]]
    at_target = [ends[0][:2]]
    for j in range(1, len(T) - 1):
        t = T[j]
        prev, nxt = (T[j - 1]["x"], T[j - 1]["y"]), (T[j + 1]["x"], T[j + 1]["y"])
        rng = list(t["duration_h"]); rng[1] = dur[t["id"]]
        be = BE.explore(prev, nxt, (t["x"], t["y"]), radius_m=t["work_radius_m"], phi=phi, alpha=alpha,
                        duration_h=rng, max_dwell_h=max(12.0, rng[2]))
        rec = be["recommendation"]
        use = next(o for o in be["options"] if "B" in o["keys"])          # default: work at the target
        if rec["status"] == "recommended":
            use = next(o for o in be["options"] if rec["preferred_nominal"] in o["keys"])
        b_opt = next(o for o in be["options"] if "B" in o["keys"])
        stops.append(dict(target=t["id"], decision=rec, used_option=use["keys"], used_xy=[use["x"], use["y"]],
                          used_flags=use["flags"], breakeven=be))
        chosen.append((use["x"], use["y"]))
        at_target.append((b_opt["x"], b_opt["y"]))
    chosen.append(ends[1][:2])
    at_target.append(ends[1][:2])
    dwell = [dur[T[j]["id"]] for j in range(1, len(T) - 1)]
    p = planner.plan(chosen[0], chosen[-1], stops=chosen[1:-1], dwell_h=dwell, phi=phi, alpha=alpha,
                     objectives=["low_dose", "shortest"])
    low = next(r for r in p["routes"] if r["objective"] == "low_dose")
    # endpoint activities at the targets themselves
    end_dose = (dur[T[0]["id"]] * planner.rate_at(rt, *ends[0][:2]) + dur[T[-1]["id"]] * planner.rate_at(rt, *ends[1][:2])) * D0 / 24.0
    stationary = low["dwell_dose_uGy"] + end_dose
    total = low["dose_uGy"] + stationary
    # same mission if every stop were done at the target itself (for comparison)
    p_tgt = planner.plan(at_target[0], at_target[-1], stops=at_target[1:-1],
                         dwell_h=dwell, phi=phi, alpha=alpha, objectives=["low_dose"])
    lt = p_tgt["routes"][0]
    total_tgt = lt["dose_uGy"] + lt["dwell_dose_uGy"] + end_dose
    hours = low["time_h"] + sum(dur.values())
    err = BE.model_error_pp()
    return dict(
        ids=ids, phi=phi, alpha=alpha, D_flat_uGy_d=D0, durations_h=dur, stops=stops, plan=p,
        endpoints=[dict(target=T[0]["id"], xy=list(ends[0][:2]), moved_m=ends[0][2]), dict(target=T[-1]["id"], xy=list(ends[1][:2]), moved_m=ends[1][2])],
        totals=dict(walk_uGy=low["dose_uGy"], stationary_uGy=stationary, total_uGy=total, walk_time_h=low["time_h"],
                    stationary_time_h=float(sum(dur.values())), eva_hours=hours, distance_m=low["distance_m"],
                    total_if_all_at_targets_uGy=total_tgt, saving_vs_targets_uGy=total_tgt - total,
                    open_flat_same_hours_uGy=hours * D0 / 24.0),
        context=dict(
            model_error_pp=err,
            fraction_of_one_sol_on_open_ground=total / D0,
            # published RAD reference values (absorbed dose, same detector family)
            curiosity_surface_mean_uGy_d=dict(value=210.0, plus_minus=40.0,
                                              cite="Hassler et al. (2014) Science 343, 1244797", url="https://doi.org/10.1126/science.1244797"),
            curiosity_cruise_mean_uGy_d=dict(value=481.0, plus_minus=80.0,
                                             cite="Zeitlin et al. (2013) Science 340, 1080-1084", url="https://doi.org/10.1126/science.1235989")),
    )


def build_default() -> dict:
    m = plan_mission(DEFAULT_MISSION)
    (C.PROC / "mission.json").write_text(json.dumps(m, default=float))
    return m


if __name__ == "__main__":
    m = build_default()
    t = m["totals"]
    print(json.dumps({k: round(v, 3) for k, v in t.items()}, indent=1))
    for s in m["stops"]:
        print(s["target"], s["decision"]["status"], s["used_option"], [round(b["t_h"], 2) for b in s["breakeven"]["breaks"]],
              [b["resolvability"] for b in s["breakeven"]["breaks"]], s["used_flags"])

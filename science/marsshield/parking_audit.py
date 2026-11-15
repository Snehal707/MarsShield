"""Audit of the eight parking-period comparisons (Guo et al. 2026 Table 1) and of the Maria Gordon Notch (P6) geometry.

Answers, with MarsShield's own inputs and with the published inputs where they are tabulated:
  1. P6 sky obstruction: MarsShield 0.332 vs published 0.379. Sensitivity to rover position, RAD height and DEM
     resolution at P6 specifically.
  2. The P6 physical-model prediction with MarsShield geometry vs the published geometry (reviewer's 13.3 % claim).
  3. Model rankings across the eight periods for four input combinations, and with the same solar-modulation factor
     applied to every model (the raw measured ratio includes the modulation difference between periods).
  4. The P7 dose-rate discrepancy.
Inputs: data/processed/validation.json (periods: B_model, ROS_pub, D_sky_model, D_sky_pub, D_RAD_pub, RAD stats) and
web/public/data/experiment_parking.json (Dfs at each period's phi, pairs). Nothing here changes those inputs.

Model (as in the app, Guo et al. 2021/2026): D_total = D_sky + (1 + B) * a * Dfs with a = alpha / (1 - alpha); change =
D_total(parking) / D_total(background) - 1. Sky only: D_sky ratio. Proportional rule: (1 - B_p) / (1 - B_g).
"""
from __future__ import annotations

import itertools
import json

import numpy as np

from . import config as C
from . import ingest as I

ALPHAS = (0.18, 0.19, 0.21, 0.24)


def _inputs():
    v = json.loads((C.PROC / "validation.json").read_text())["periods"]
    ex = json.loads((C.WEB_PUBLIC / "experiment_parking.json").read_text())
    return v, ex


def predictions(v, ex, geometry="ours", measured="ours", alpha=0.19, modulation_rule=False):
    """Per pair: measured change and the three models, for a choice of inputs."""
    a = alpha / (1 - alpha)
    out = []
    for pr in ex["pairs"]:
        P, G = pr["parking"], pr["background"]
        q = {}
        for k in (P, G):
            B = v[k]["B_model"] if geometry == "ours" else v[k]["ROS_pub"]
            Ds = v[k]["D_sky_model"] if geometry == "ours" else v[k]["D_sky_pub"]
            Dr = v[k]["rad"]["E_mean"] if measured == "ours" else v[k]["D_RAD_pub"]
            q[k] = dict(B=B, Ds=Ds, Dr=Dr, Dfs=ex["periods"][k]["Dfs"], phi=ex["periods"][k]["phi"])
        p, g = q[P], q[G]
        tot = lambda z: z["Ds"] + (1 + z["B"]) * a * z["Dfs"]
        mod = p["Dfs"] / g["Dfs"]                      # flat-ground (modulation-only) ratio between the two periods
        rule = (1 - p["B"]) / (1 - g["B"]) * (mod if modulation_rule else 1.0) - 1
        out.append(dict(pair=f"{P}/{G}", site=v[P]["site"], measured=p["Dr"] / g["Dr"] - 1, physical=tot(p) / tot(g) - 1,
                        sky_only=p["Ds"] / g["Ds"] - 1, rule=rule, modulation_only=mod - 1,
                        phi=[p["phi"], g["phi"]], B=[p["B"], g["B"]]))
    return out


def score(rows):
    res = {}
    for m in ("physical", "sky_only", "rule"):
        e = np.array([r[m] - r["measured"] for r in rows]) * 100
        res[m] = dict(mae_pp=float(np.abs(e).mean()), rmse_pp=float(np.sqrt((e ** 2).mean())),
                      closest=int(sum(all(abs(r[m] - r["measured"]) <= abs(r[o] - r["measured"]) for o in ("physical", "sky_only", "rule")) for r in rows)))
    # exact site-cluster resampling distribution (all 5^5 resamples) of RMSE(physical) - RMSE(rule)
    sites = sorted({r["site"] for r in rows})
    vals = []
    for pick in itertools.product(sites, repeat=len(sites)):
        sel = [r for s in pick for r in rows if r["site"] == s]
        ep = np.array([r["physical"] - r["measured"] for r in sel]); er = np.array([r["rule"] - r["measured"] for r in sel])
        vals.append((np.sqrt((ep ** 2).mean()) - np.sqrt((er ** 2).mean())) * 100)
    vals = np.array(vals)
    res["dRMSE_physical_minus_rule_pp"] = dict(
        point=res["physical"]["rmse_pp"] - res["rule"]["rmse_pp"], p025=float(np.percentile(vals, 2.5)), p975=float(np.percentile(vals, 97.5)),
        distinct_values=int(np.unique(np.round(vals, 9)).size), resamples=int(vals.size), sites=len(sites),
        note="Exhaustive site resampling; with 5 clusters the percentile range has no reliable 95 % coverage. Shown as a spread, not a confidence interval.")
    res["ranking_by_rmse"] = sorted(("physical", "sky_only", "rule"), key=lambda m: res[m]["rmse_pp"])
    return res


def p6_geometry(v, ex):
    out = {"B_ours": v["P6"]["B_model"], "B_published": v["P6"]["ROS_pub"], "B_BG6_ours": v["BG6"]["B_model"], "B_BG6_published": v["BG6"]["ROS_pub"],
           "D_sky_P6_ours": v["P6"]["D_sky_model"], "D_sky_P6_published": v["P6"]["D_sky_pub"],
           "D_sky_BG6_ours": v["BG6"]["D_sky_model"], "D_sky_BG6_published": v["BG6"]["D_sky_pub"],
           "measured_change_ours": v["P6"]["rad"]["E_mean"] / v["BG6"]["rad"]["E_mean"] - 1,
           "measured_change_published": v["P6"]["D_RAD_pub"] / v["BG6"]["D_RAD_pub"] - 1}
    preds = {}
    for geo in ("ours", "published"):
        for al in ALPHAS:
            r = [x for x in predictions(v, ex, geometry=geo, alpha=al) if x["pair"].startswith("P6")][0]
            preds[f"{geo}_alpha{al:.2f}"] = dict(physical=r["physical"], sky_only=r["sky_only"], rule=r["rule"])
    out["predictions"] = preds
    sens = json.loads((C.PROC / "validation.json").read_text())["sensitivity"]
    out["position_sensitivity"] = {k: sens["S4_position"][k].get("P6") for k in sens["S4_position"]}
    return out


def p6_height_resolution():
    """B at P6 for RAD heights and coarser near-field DEMs (same functions as validation.sensitivity)."""
    from . import sites as S
    from .horizon import TerrainStack, blocked_solid_angle_fraction
    from .validation import period_ros
    near, mid, far = S.grids()
    base = TerrainStack([near, mid, far])
    h = {f"{hh:.1f}": float(blocked_solid_angle_fraction(period_ros(base, "P6", h_obs=hh)[0])) for hh in (0.5, 1.0, 1.5, 2.0)}
    res = {}
    for f in (2, 4, 8):
        st = TerrainStack([near.coarsen(f, "mean"), mid, far])
        res[f"{f}m"] = float(blocked_solid_angle_fraction(period_ros(st, "P6")[0]))
    return dict(height_m=h, near_field_resolution=res, base_resolution_m=1, rad_height_used_m=C.RAD_HEIGHT_M)


def p7_investigation():
    r = I.read_rad(I.fetch_rad_sols(3558, 3568))
    good = (r["flag"] == 0) & np.isfinite(r["E"]) & (r["E"] > 0)
    s, E = r["sol"], r["E"]
    halves = []
    for a in np.arange(3559.6, 3567.6, 0.5):
        m = good & (s >= a) & (s < a + 0.5)
        if m.sum():
            halves.append(dict(sol=[float(a), float(a + 0.5)], n=int(m.sum()), mean=float(E[m].mean())))
    w = (s >= 3564.6) & (s < 3565.6)
    with_flagged = w & np.isfinite(E) & (E > 0)
    return dict(window_sols=[3564.6, 3565.6], ours_mean=float(E[w & good].mean()), ours_n=int((w & good).sum()),
                including_flagged_mean=float(E[with_flagged].mean()), flagged_in_window=int((w & (r["flag"] != 0)).sum()),
                published=190.4, half_sol_means=halves, min_half_sol=min(h["mean"] for h in halves if 3563.6 <= h["sol"][0] <= 3565.1),
                conclusion="No half-sol interval between sols 3563.6 and 3565.6 averages below 194 uGy/day, so a shifted window cannot "
                           "reproduce the published 190.4; including flagged records does not either. Unresolved without the authors' exact "
                           "time selection or processing.")


def run() -> dict:
    v, ex = _inputs()
    variants = {}
    for geo, meas in (("ours", "ours"), ("ours", "published"), ("published", "ours"), ("published", "published")):
        for modr in (False, True):
            key = f"geometry_{geo}__measured_{meas}" + ("__rule_with_modulation" if modr else "")
            rows = predictions(v, ex, geometry=geo, measured=meas, alpha=0.19, modulation_rule=modr)
            variants[key] = dict(rows=rows, score=score(rows))
    out = dict(generated_utc=I._now(), alpha=0.19, variants=variants, p6=p6_geometry(v, ex), p6_sensitivity=p6_height_resolution(),
               p7=p7_investigation(),
               modulation_only_change=[dict(pair=r["pair"], modulation_only=r["modulation_only"], measured=r["measured"], phi=r["phi"])
                                       for r in predictions(v, ex)])
    (C.PROC / "parking_audit.json").write_text(json.dumps(out, indent=1))
    return out


if __name__ == "__main__":
    o = run()
    p = o["p6"]
    print("P6 B ours/pub", round(p["B_ours"], 3), p["B_published"], "| Dsky ours/pub", round(p["D_sky_P6_ours"], 1), p["D_sky_P6_published"])
    for k, x in p["predictions"].items():
        print("  P6", k, {m: round(val * 100, 2) for m, val in x.items()})
    print("P6 height/res", o["p6_sensitivity"])
    print("P6 position", {k: (round(x["p05"], 3), round(x["p95"], 3)) for k, x in p["position_sensitivity"].items()})
    for k, x in o["variants"].items():
        s = x["score"]
        print(k, {m: (round(s[m]["mae_pp"], 2), round(s[m]["rmse_pp"], 2), s[m]["closest"]) for m in ("physical", "sky_only", "rule")},
              "rank", s["ranking_by_rmse"], "dRMSE", round(s["dRMSE_physical_minus_rule_pp"]["point"], 2),
              [round(s["dRMSE_physical_minus_rule_pp"]["p025"], 2), round(s["dRMSE_physical_minus_rule_pp"]["p975"], 2)])
    for r in o["modulation_only_change"]:
        print("  mod", r["pair"], "modulation-only %.2f %%, measured %.2f %%" % (r["modulation_only"] * 100, r["measured"] * 100), r["phi"])
    print("P7", {k: o["p7"][k] for k in ("ours_mean", "ours_n", "including_flagged_mean", "flagged_in_window", "published", "min_half_sol")})

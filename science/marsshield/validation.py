"""Scientific validation and sensitivity analysis. Writes data/processed/validation.json.

V1  Analytic horizon geometries (flat sphere, wall, cylindrical pit, half-space ridge).
V2  Reproduction of Guo et al. (2021) Zenodo intermediate products (mask -> ROS -> dose).
V3  DEM horizon at Butte M12 vs. the RAD-team horizon mask (Zenodo FIg2.txt).
V4  DEM sky obstruction and modeled sky dose vs. Guo et al. (2026) Table 1, 15 periods.
V5  Our reduction of NASA RAD L2 E-detector dose rate vs. Guo et al. (2026) Table 1 D_RAD.
V6  Predicted vs. measured dose-rate decreases for 8 parking/background pairs + M12:
      (a) naive proportional proxy  D ~ (1 - B)
      (b) downward sky dose only    D ~ D_sky(ROS, phi)
      (c) sky + terrain albedo      D ~ D_sky + (1 + B) D_alb, alpha = 0.19 from Guo et al. (2021)
          (Murray Buttes only -> independent of the 2026 sites), and the 0.18-0.24 band.
S1-S5 Sensitivity: DEM resolution, horizon radius, observer height, position error, model parameters.
"""
from __future__ import annotations

import json
import time

import numpy as np

from . import config as C
from . import ingest as I
from . import published as P
from . import sites as S
from .horizon import (Grid, TerrainStack, blocked_fraction_by_zenith, blocked_solid_angle_exact,
                      blocked_solid_angle_fraction, horizon_profile)
from .radiation import ALPHA_RANGE, TerrainDoseModel, ZenithModel


def _r(x, n=4):
    return None if x is None else float(round(float(x), n))


# --------------------------------------------------------------------------------------
def v1_analytic() -> dict:
    res = []
    R = C.MARS_RADIUS_M

    def flat_grid(z_fn, half=3000.0, res=1.0):
        n = int(2 * half / res) + 1
        xs = np.linspace(-half, half, n)
        X, Y = np.meshgrid(xs, xs[::-1])
        return Grid(z_fn(X, Y).astype("float32"), -half, half, res, "analytic")

    # (a) flat ground on a sphere -> geometric dip of the horizon sqrt(2h/R)
    big = Grid(np.zeros((3, 3), "float32"), -60000, 60000, 60000.0, "flat")
    st = TerrainStack([big])
    hp = horizon_profile(st, 0, 0, 1.0, n_az=36, r_max=20000, distances=np.linspace(10, 20000, 20000))
    exp = -np.degrees(np.sqrt(2 * 1.0 / R))
    res.append(dict(case="flat sphere, h=1 m", expected_deg=exp, got_deg=float(hp["elev"].mean()),
                    abs_err_deg=float(abs(hp["elev"].mean() - exp))))
    # (b) wall: z = 20 m for y > 100 m  (north), observer h=1 at origin: north azimuth elev = atan(19/100)
    g = flat_grid(lambda X, Y: np.where(Y >= 100.0, 20.0, 0.0))
    st = TerrainStack([g])
    hp = horizon_profile(st, 0, 0, 1.0, n_az=1440, r_max=2900, curvature=False)
    north = hp["elev"][(hp["az"] < 0.3) | (hp["az"] > 359.7)].mean()
    exp = np.degrees(np.arctan(19 / 100))
    res.append(dict(case="straight wall 20 m high, 100 m north", expected_deg=exp, got_deg=float(north),
                    abs_err_deg=float(abs(north - exp))))
    # (c) cylindrical pit radius 200 m depth 50 m: elev = atan(49/200) at all azimuths; B = sin(elev)
    g = flat_grid(lambda X, Y: np.where(np.hypot(X, Y) >= 200.0, 50.0, 0.0))
    st = TerrainStack([g])
    hp = horizon_profile(st, 0, 0, 1.0, n_az=1440, r_max=2900, curvature=False)
    exp = np.degrees(np.arctan(49 / 200))
    ros = blocked_fraction_by_zenith(hp["elev"])
    res.append(dict(case="cylindrical pit r=200 m, depth 50 m", expected_deg=exp,
                    got_deg=float(hp["elev"].mean()), abs_err_deg=float(np.abs(hp["elev"] - exp).max()),
                    expected_B=float(np.sin(np.radians(exp))), got_B_exact=blocked_solid_angle_exact(hp["elev"]),
                    got_B_1deg_rings=blocked_solid_angle_fraction(ros)))
    # (d) half-space: plane rising at 30 deg toward the east for x > 0, observer at its foot (h=0).
    # Along azimuth az the apparent slope is atan(tan30 * sin(az)) for sin(az) > 0, so
    # B = mean_az sin(elev) = (1/2pi) int_0^pi tan30 sin(az) / sqrt(1 + tan30^2 sin^2 az) d az.
    t30 = np.tan(np.radians(30))
    g = flat_grid(lambda X, Y: np.where(X > 0, X * t30, 0.0))
    st = TerrainStack([g])
    hp = horizon_profile(st, 0, 0, 0.0, n_az=1440, r_max=2900, curvature=False)
    sel = (hp["az"] > 10) & (hp["az"] < 170)
    exp_el = np.degrees(np.arctan(t30 * np.sin(np.radians(hp["az"][sel]))))
    azq = np.linspace(0, np.pi, 200001)
    B_exp = float(np.trapezoid(t30 * np.sin(azq) / np.sqrt(1 + (t30 * np.sin(azq)) ** 2), azq) / (2 * np.pi))
    res.append(dict(case="plane rising 30 deg to the east (h=0)", expected_deg=float(exp_el.mean()),
                    got_deg=float(hp["elev"][sel].mean()), abs_err_deg=float(np.abs(hp["elev"][sel] - exp_el).max()),
                    expected_B=B_exp, got_B_exact=blocked_solid_angle_exact(hp["elev"])))
    for r_ in res:
        for k, v in list(r_.items()):
            if isinstance(v, float):
                r_[k] = float(v)
    return dict(cases=res)


# --------------------------------------------------------------------------------------
def v2_zenodo(model: TerrainDoseModel) -> dict:
    d = C.RAW / "zenodo_guo2021"
    mask = np.loadtxt(d / "FIg2.txt")
    a = np.loadtxt(d / "Fig4a.txt")
    b = np.loadtxt(d / "Fig4b.txt")
    ros = blocked_fraction_by_zenith(mask[:, 1])
    ring_err = float(np.abs((1 - ros) - a[:, 3]).max())
    H, He = model.zm.curves(484.0)
    dose_err_H = float(np.abs(a[:, 3] * H - b[:, 2]).max())
    dose_err_He = float(np.abs(a[:, 3] * He - b[:, 4]).max())
    H2, He2 = model.zm.curves(384.5)
    return dict(
        ring_ratio_max_abs_err=ring_err,
        per_zenith_dose_max_abs_err_uGy_d=dict(H=dose_err_H, He=dose_err_He),
        fullsky_384MV=dict(H_model=float(model.k_radial * H2.sum()), H_pub=196.04,
                           He_model=float(model.k_radial * He2.sum()), He_pub=36.32),
        mask_blocked_solid_angle=blocked_solid_angle_exact(mask[:, 1]),
        mask_blocked_1deg_rings=blocked_solid_angle_fraction(ros),
        ehresmann2021_blocked=0.19,
    )


# --------------------------------------------------------------------------------------
def period_ros(stack: TerrainStack, period: str, h_obs=C.RAD_HEIGHT_M, r_max=20000.0, jitter=None,
               rng=None, n_az=1440):
    pos = S.period_positions(period)
    ros = np.zeros(91); W = 0.0; elevs = []
    for p in pos:
        x, y = p["x"], p["y"]
        if jitter:
            x += rng.normal(0, jitter); y += rng.normal(0, jitter)
        hp = horizon_profile(stack, x, y, h_obs, r_max=r_max, n_az=n_az)
        ros += blocked_fraction_by_zenith(hp["elev"]) * p["weight"]; W += p["weight"]
        elevs.append((p["weight"], hp["elev"]))
    return ros / W, pos, elevs


def v3_m12_mask(stack) -> dict:
    m = np.loadtxt(C.RAW / "zenodo_guo2021" / "FIg2.txt")
    p = S.period_positions("M12")[0]
    hp = horizon_profile(stack, p["x"], p["y"], C.RAD_HEIGHT_M, n_az=360)
    mine = np.interp(m[:, 0], hp["az"], hp["elev"], period=360)
    d = mine - m[:, 1]
    return dict(position=dict(x=p["x"], y=p["y"], sol=p["sol"], rmc=p["rmc"]),
                rmse_deg=float(np.sqrt(np.mean(d ** 2))), bias_deg=float(d.mean()),
                mae_deg=float(np.abs(d).mean()), max_abs_deg=float(np.abs(d).max()),
                p95_abs_deg=float(np.percentile(np.abs(d), 95)),
                B_mask=blocked_solid_angle_exact(m[:, 1]), B_dem=blocked_solid_angle_exact(hp["elev"]),
                az=m[:, 0].tolist(), elev_mask=m[:, 1].round(3).tolist(), elev_dem=mine.round(3).tolist())


def rad_period_stats(period: str) -> dict:
    if period == "M12":
        a, b = P.M12["sol_start"], P.M12["sol_end"] + 1
    else:
        t = P.table1(period); a, b = t["sol_start"], t["sol_end"]
    r = I.read_rad(I.fetch_rad_sols(a, b))
    m = (r["sol"] >= a) & (r["sol"] < b) & (r["flag"] == 0) & np.isfinite(r["E"]) & (r["E"] > 0)
    E = r["E"][m]
    return dict(n=int(m.sum()), E_mean=float(E.mean()), E_sem=float(E.std(ddof=1) / np.sqrt(len(E))),
                E_std=float(E.std(ddof=1)), utc_start=str(r["utc"][m][0]), utc_end=str(r["utc"][m][-1]),
                B_mean=float(np.nanmean(r["B"][m])), Bc_mean=float(np.nanmean(r["Bc"][m])))


def v4_v5_v6(stack, model: TerrainDoseModel) -> dict:
    rows = {}
    for k in S.ALL_PERIODS:
        t = P.table1(k)
        ros, pos, _ = period_ros(stack, k)
        B = blocked_solid_angle_fraction(ros)
        d = model.dose(ros, t["phi"])
        rad = rad_period_stats(k)
        rows[k] = dict(site=t["site"], sols=[t["sol_start"], t["sol_end"]], phi=t["phi"],
                       positions=[dict(x=p["x"], y=p["y"], sol=p["sol"], rmc=p["rmc"], w=p["weight"]) for p in pos],
                       B_model=B, ROS_pub=t["ROS_int"], D_sky_model=d.D_sky, D_sky_pub=t["D_sky"],
                       D_H_model=d.D_H, D_H_pub=t["D_GCRH"], D_He_model=d.D_He, D_He_pub=t["D_GCRHe"],
                       D_RAD_pub=t["D_RAD"], rad=rad, ros=ros.round(5).tolist())
    # V6 pairs
    pairs = []
    for p_, bg in P.PAIRS.items():
        a, b = rows[p_], rows[bg]
        meas_ours = a["rad"]["E_mean"] / b["rad"]["E_mean"] - 1
        meas_pub = -P.table1(p_)["meas_decrease"]
        prop = (1 - a["B_model"]) / (1 - b["B_model"]) - 1
        sky = a["D_sky_model"] / b["D_sky_model"] - 1
        sky_pub = a["D_sky_pub"] / b["D_sky_pub"] - 1

        def total(alpha):
            out = []
            for r_ in (a, b):
                dfs = model.sky_components(np.zeros(91), r_["phi"])[2]
                dalb = alpha / (1 - alpha) * dfs
                out.append(r_["D_sky_model"] + (1 + r_["B_model"]) * dalb)
            return out[0] / out[1] - 1
        pairs.append(dict(pair=f"{p_}/{bg}", site=a["site"], measured_ours=meas_ours, measured_pub=meas_pub,
                          pred_proportional=prop, pred_sky_only=sky, pred_sky_only_pubgeom=sky_pub,
                          pred_albedo_019=total(0.19), pred_albedo_018=total(ALPHA_RANGE[0]),
                          pred_albedo_024=total(ALPHA_RANGE[1]),
                          dB=a["B_model"] - b["B_model"]))
    def err(key, exclude=()):
        e = np.array([p[key] - p["measured_ours"] for p in pairs if p["pair"].split("/")[0] not in exclude])
        return dict(mae_pp=float(np.abs(e).mean() * 100), bias_pp=float(e.mean() * 100),
                    rmse_pp=float(np.sqrt((e ** 2).mean()) * 100), max_abs_pp=float(np.abs(e).max() * 100), n=int(e.size))
    summary = {k: err(k) for k in ("pred_proportional", "pred_sky_only", "pred_albedo_019")}
    summary_excl = {k: err(k, exclude=("P6", "P8")) for k in ("pred_proportional", "pred_sky_only", "pred_albedo_019")}
    # V4 statistics
    keys = list(rows)
    dB = np.array([rows[k]["B_model"] - rows[k]["ROS_pub"] for k in keys])
    dS = np.array([rows[k]["D_sky_model"] / rows[k]["D_sky_pub"] - 1 for k in keys])
    dR = np.array([rows[k]["rad"]["E_mean"] / rows[k]["D_RAD_pub"] - 1 for k in keys])
    good = [k for k in keys if k not in ("P6", "P8")]
    v4 = dict(B_minus_ROSpub_mean=float(dB.mean()), B_minus_ROSpub_mae=float(np.abs(dB).mean()),
              B_minus_ROSpub_max=float(np.abs(dB).max()),
              Dsky_rel_err_mae=float(np.abs(dS).mean()), Dsky_rel_err_max=float(np.abs(dS).max()),
              Dsky_rel_err_mae_excl_P6P8=float(np.mean([abs(rows[k]["D_sky_model"] / rows[k]["D_sky_pub"] - 1) for k in good])),
              outliers={k: dict(B_model=rows[k]["B_model"], ROS_pub=rows[k]["ROS_pub"]) for k in ("P6", "P8")})
    v5 = dict(rel_diff_mean=float(dR.mean()), rel_diff_median=float(np.median(dR)), rel_diff_max=float(np.abs(dR).max()),
              worst=keys[int(np.argmax(np.abs(dR)))])
    return dict(periods=rows, pairs=pairs, pair_error_summary=summary,
                pair_error_summary_excl_P6_P8=summary_excl, v4=v4, v5=v5)


# --------------------------------------------------------------------------------------
def sensitivity(model: TerrainDoseModel) -> dict:
    near, mid, far = S.grids()
    periods = S.ALL_PERIODS
    base_stack = TerrainStack([near, mid, far])
    base = {k: blocked_solid_angle_fraction(period_ros(base_stack, k)[0]) for k in periods}
    out = {}
    # S1 DEM resolution of the near-field grid (mean aggregation)
    s1 = []
    for f in (2, 4, 8, 16, 32):
        g = near.coarsen(f, "mean")
        st = TerrainStack([g, mid, far])
        Bs = {k: blocked_solid_angle_fraction(period_ros(st, k)[0]) for k in periods}
        d = np.array([Bs[k] - base[k] for k in periods])
        s1.append(dict(res_m=f, mean_dB=float(d.mean()), mae_dB=float(np.abs(d).mean()), max_abs_dB=float(np.abs(d).max())))
    out["S1_resolution"] = s1
    # S2 horizon radius (r_max) and far-field inclusion
    s2 = []
    for rmax in (500, 1000, 2000, 5000, 10000, 20000, 40000):
        Bs = {k: blocked_solid_angle_fraction(period_ros(base_stack, k, r_max=rmax)[0]) for k in periods}
        d = np.array([Bs[k] - base[k] for k in periods])
        s2.append(dict(r_max_m=rmax, mean_dB=float(d.mean()), mae_dB=float(np.abs(d).mean()), max_abs_dB=float(np.abs(d).max())))
    out["S2_radius"] = s2
    # S3 observer height
    s3 = []
    for h in (0.5, 1.0, 1.5, 2.0):
        Bs = {k: blocked_solid_angle_fraction(period_ros(base_stack, k, h_obs=h)[0]) for k in periods}
        d = np.array([Bs[k] - base[k] for k in periods])
        s3.append(dict(h_m=h, mean_dB=float(d.mean()), mae_dB=float(np.abs(d).mean()), max_abs_dB=float(np.abs(d).max())))
    out["S3_height"] = s3
    # S4 position uncertainty (Monte Carlo)
    rng = np.random.default_rng(42)
    s4 = {}
    for sig in (1.0, 3.0, 5.0):
        per = {}
        for k in periods:
            v = [blocked_solid_angle_fraction(period_ros(base_stack, k, jitter=sig, rng=rng, n_az=720)[0]) for _ in range(16)]
            per[k] = dict(mean=float(np.mean(v)), std=float(np.std(v)), p05=float(np.percentile(v, 5)), p95=float(np.percentile(v, 95)))
        s4[f"sigma_{sig:g}m"] = per
    out["S4_position"] = s4
    # S5 model parameters on the relative total dose at a strongly shielded site (P6 geometry) and the
    # median site, and on the predicted P/BG decreases.
    ros_p6 = period_ros(base_stack, "P6")[0]
    ros_bg = period_ros(base_stack, "BG45")[0]
    s5 = []
    for phi in (380, 450, 500, 600, 700, 800):
        for alpha in (0.18, 0.21, 0.24):
            for kh in (1.08, 1.10, 1.12):
                m = TerrainDoseModel(model.zm, k_heavy=kh, alpha=alpha)
                s5.append(dict(phi=phi, alpha=alpha, k_heavy=kh,
                               rel_total_P6=m.dose(ros_p6, phi).rel_total, rel_sky_P6=m.dose(ros_p6, phi).rel_sky,
                               rel_total_BG45=m.dose(ros_bg, phi).rel_total))
    rt = np.array([s["rel_total_P6"] for s in s5])
    out["S5_parameters"] = dict(grid=s5, rel_total_P6_range=[float(rt.min()), float(rt.max())])
    out["base_B"] = base
    return out


def run(fast: bool = False) -> dict:
    t0 = time.time()
    model = TerrainDoseModel()
    stack = S.stack()
    res = dict(generated_utc=I._now(), v1_analytic=v1_analytic(), v2_zenodo=v2_zenodo(model),
               v3_m12_mask=v3_m12_mask(stack))
    res.update(v4_v5_v6(stack, model))
    if not fast:
        res["sensitivity"] = sensitivity(model)
    res["runtime_s"] = time.time() - t0
    C.PROC.mkdir(parents=True, exist_ok=True)
    (C.PROC / "validation.json").write_text(json.dumps(res, indent=1, default=float))
    return res


if __name__ == "__main__":
    import sys
    r = run(fast="--fast" in sys.argv)
    print(json.dumps({k: r[k] for k in ("v2_zenodo", "v4", "v5", "pair_error_summary", "pair_error_summary_excl_P6_P8")}, indent=1, default=float))
    for p in r["pairs"]:
        print(p["pair"], {k: round(v * 100, 1) for k, v in p.items() if isinstance(v, float)})

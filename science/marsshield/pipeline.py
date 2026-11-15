"""End-to-end reproducible pipeline.

    python -m marsshield.pipeline            # everything (downloads are cached in data/raw)
    python -m marsshield.pipeline --export   # only re-export web assets from processed products

Stages: ingest -> validation (+sensitivity) -> terrain maps -> observations -> web export.
"""
from __future__ import annotations

import json
import shutil
import sys

import numpy as np

from . import config as C
from . import ingest as I
from . import published as P
from . import sites as S


def ingest():
    I.fetch_zenodo(); I.fetch_waypoints(); I.fetch_papers()
    I.fetch_far_dem(); I.fetch_near_dem(); I.fetch_mid_dem(); I.fetch_walk_ortho()


def hillshade(z: np.ndarray, res: float) -> np.ndarray:
    """Multi-directional hillshade (0..1) for visual relief on the 3-D terrain."""
    gy, gx = np.gradient(z.astype(float), res)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    out = np.zeros_like(z, dtype=float)
    for az, w in ((315, 0.45), (270, 0.2), (0, 0.2), (225, 0.15)):
        a = np.radians(az); alt = np.radians(40)
        out += w * (np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(a - aspect))
    return np.clip(out, 0, 1)


SCIENCE_TARGETS = [
    # name, description, waypoint RMC used for its position
    ("Tower Buttes", "Butte pair in Glen Torridon. RAD parking P1/P2: -4.0 % and -7.1 % dose rate (Guo et al. 2026).", "79_0"),
    ("Bloodstone Hill", "Boulder hill. RAD parking P3: -6.5 % (Guo et al. 2026).", "80_2388"),
    ("Mt Mercou", "Cliff face of the Greenheugh pediment margin. RAD P4/P5: -3.8 %, -2.1 %.", "87_834"),
    ("Maria Gordon Notch", "Narrow notch below a cliff; largest observed terrain effect on RAD: -19.4 % (P6, Guo et al. 2026 Table 1 and NASA RAD L2; the paper's Sec. 4 text states 17 %).", "92_84"),
    ("Paraitepuy", "Canyon mouth and small hill. RAD P7/P8: -9.8 %, -9.9 %.", "97_0"),
]


def export_ortho(out):
    """USGS HiRISE-based orthophoto (1 m) of the walk area as a JPEG texture, percentile-stretched for display."""
    import rasterio
    from PIL import Image
    p = C.RAW / "ortho" / "gale_ortho_1m_walk.tif"
    if not p.exists():
        return None
    with rasterio.open(p) as d:
        a = d.read(1); t = d.transform
    lo, hi = np.nanpercentile(a, [1, 99])
    img = np.clip((a - lo) / (hi - lo), 0, 1)
    img = np.where(np.isnan(img), 0, img)
    Image.fromarray((img * 255).astype("uint8")).save(out / "ortho.jpg", quality=82, optimize=True)
    meta = dict(x0=t.c + t.a / 2, y0=t.f + t.e / 2, res=t.a, shape=list(a.shape), nan_fraction=float(np.isnan(a).mean()),
                stretch=[float(lo), float(hi)], source=C.GALE_ORTHO_25CM_URL,
                product="USGS MSL Gale Merged Orthophoto Mosaic 25cm v3, 4x4 block mean to 1 m")
    (out / "ortho.json").write_text(json.dumps(meta, indent=1))
    return meta


def export_experiments(out):
    """Small, exact inputs for in-browser recalculation (the browser does arithmetic only, no physics fitting)."""
    from .radiation import TerrainDoseModel
    from .planner import sky_at
    from . import targets as TG
    m = TerrainDoseModel()
    phis = list(range(380, 901, 10))
    # full-sky downward dose (heavy-ion and radial factors applied); D_flat = Dfs / (1 - alpha)
    flat = dict(phi=phis, Dfs=[m.sky_components(np.zeros(91), p)[2] for p in phis],
                note="Downward full-sky GCR dose, RAD-E equivalent, uGy/day (Guo et al. 2021 model); open-flat total = Dfs/(1-alpha)")
    # eight parking/background pairs: everything needed to recompute the three model predictions for any alpha
    val = json.loads((C.PROC / "validation.json").read_text())
    per = {}
    for k, r in val["periods"].items():
        per[k] = dict(site=r["site"], sols=r["sols"], phi=r["phi"], B=r["B_model"], D_sky=r["D_sky_model"],
                      Dfs=m.sky_components(np.zeros(91), r["phi"])[2], D_RAD_ours=r["rad"]["E_mean"], D_RAD_sem=r["rad"]["E_sem"],
                      D_RAD_pub=r["D_RAD_pub"], utc=[r["rad"]["utc_start"], r["rad"]["utc_end"]], n_obs=r["rad"]["n"],
                      x=r["positions"][0]["x"], y=r["positions"][0]["y"])
    pairs = [dict(parking=p_, background=bg) for p_, bg in P.PAIRS.items()]
    au = json.loads((C.PROC / "audit.json").read_text())
    (out / "experiment_parking.json").write_text(json.dumps(dict(
        periods=per, pairs=pairs, alpha_prior=0.19, alpha_range=[0.18, 0.24],
        p6_alternative=dict(section4_decrease=0.17, table1_decrease=0.194),
        audit=dict(cells_checked=au["A1_table1_transcription"]["cells_checked"], mismatches=au["A1_table1_transcription"]["mismatches"]),
        provenance="NASA RAD L2 (our reduction) and Guo et al. (2026) Table 1; DEM-derived blocked sky; Guo et al. (2021) zenith model")))
    (out / "flat_dose.json").write_text(json.dumps(flat))
    # high-resolution sky profiles at the nine science targets (Python ray tracing; the browser only displays them)
    tg = TG.build()
    (out / "skies_targets.json").write_text(json.dumps({t["id"]: sky_at(t["x"], t["y"]) for t in tg}))
    # terrain-signal analysis rows (if built): observed/predictor anomalies per stop for browser cross-validation
    export_terrain_signal(out)


def export_terrain_signal(out):
    ts = C.PROC / "terrain_signal.json"
    if ts.exists():
        d = json.loads(ts.read_text())
        keep = ("rmc", "sol", "mid_sol", "x", "y", "n_obs", "data_sols", "utc_start", "utc_end", "E_mean", "P_mean", "P_bg",
                "y_obs", "x_p", "m_terrain", "g_proxy", "rel_total", "B", "block")
        (out / "terrain_signal.json").write_text(json.dumps(dict(
            rows=[{k: r[k] for k in keep} for r in d["rows"]], window_sols=d["window_sols"], k_blocks=d["k_blocks"],
            performance=d["performance"], mse_differences=d["mse_differences"], correlations=d["correlations"],
            pressure_coefficient=d["pressure_coefficient"], meta=d["meta"], predictor_spread_pp=d["predictor_spread_pp"],
            robustness=d["robustness"], disagreement_test=d["disagreement_test"], calibration=d["calibration"],
            spearman_terrain=d["spearman_terrain"], generated_utc=d["generated_utc"],
            rmse_reduction_vs_M0=d["rmse_reduction_vs_M0"], site_ci95_dMSE_vs_M0_pp2=d["site_ci95_dMSE_vs_M0_pp2"],
            influence={k: v for k, v in d["influence"].items() if k != "leave_one_site_out"} | dict(
                leave_one_site_out={k: d["influence"]["leave_one_site_out"][k] for k in ("min", "max")}),
            evaluation_overlap=d["evaluation_overlap"])))


def export_web():
    from .planner import plan, sky_at
    from .terrain import load, walk_grid
    out = C.WEB_PUBLIC
    out.mkdir(parents=True, exist_ok=True)
    g = load()
    ny, nx = g["z"].shape
    z = g["z"].astype("float32")
    zmin, zmax = float(np.nanmin(z)), float(np.nanmax(z))
    z.tofile(out / "height.f32")
    for k in ("rel_sky", "B", "slope"):
        g[k].astype("float32").tofile(out / f"{k}.f32")
    # 1 m hillshade texture (2 m sampling keeps the file small)
    from PIL import Image
    _, sub1m = walk_grid()
    hs = hillshade(sub1m.z, 1.0)[::2, ::2]
    Image.fromarray((hs * 255).astype("uint8")).save(out / "hillshade.png", optimize=True)
    # sites with published + reproduced values
    val = json.loads((C.PROC / "validation.json").read_text())
    wps = {p["RMC"]: p for p in I.load_waypoints()}
    sites = []
    for k, row in val["periods"].items():
        t = P.table1(k)
        p0 = max(row["positions"], key=lambda q: q["w"])
        sites.append(dict(id=k, site=row["site"], kind="parking" if k.startswith("P") else "background",
                          x=p0["x"], y=p0["y"], positions=row["positions"], sols=row["sols"],
                          utc=[row["rad"]["utc_start"], row["rad"]["utc_end"]],
                          rad_E_mean=row["rad"]["E_mean"], rad_E_sem=row["rad"]["E_sem"], rad_n=row["rad"]["n"],
                          pub=dict(D_RAD=t["D_RAD"], decrease=t["meas_decrease"], phi=t["phi"],
                                   ROS=t["ROS_int"], D_sky=t["D_sky"]),
                          model=dict(B=row["B_model"], D_sky=row["D_sky_model"])))
    targets = []
    for name, desc, rmc in SCIENCE_TARGETS:
        p = wps[rmc]
        targets.append(dict(name=name, description=desc, x=p["easting"], y=p["northing"], z=p["elev_geoid"], rmc=rmc, sol=p["sol"]))
    # precomputed sky analyses at the targets (fallback when the API is offline)
    skies = {t["name"]: sky_at(t["x"], t["y"], C.ASTRONAUT_HEIGHT_M) for t in targets}
    # default scenario: Tower Buttes -> Paraitepuy with stops at Mt Mercou and Maria Gordon Notch
    tb = targets[0]; pp = targets[4]
    scen = plan((tb["x"], tb["y"]), (pp["x"], pp["y"]), stops=[(targets[2]["x"], targets[2]["y"]), (targets[3]["x"], targets[3]["y"])], dwell_h=2.0)
    scen2 = plan((tb["x"], tb["y"]), (targets[3]["x"], targets[3]["y"]))
    obs = json.loads((C.PROC / "observations.json").read_text())
    meta = dict(
        shape=[ny, nx], res=float(g["res"]), x0=float(g["x0"]), y0=float(g["y0"]),
        zmin=zmin, zmax=zmax, h_obs=float(g["h_obs"]), phi=float(g["phi"]), alpha=float(g["alpha"]),
        n_az=int(g["n_az"]), hillshade_res=2.0, hillshade_shape=list(hs.shape),
        hillshade_x0=float(sub1m.x0), hillshade_y0=float(sub1m.y0),
        crs="Mars 2000 sphere equirectangular (clon 0), metres; elevations relative to the areoid",
        sources=json.loads((C.ROOT / "docs" / "sources.json").read_text()),
    )
    (out / "meta.json").write_text(json.dumps(meta, indent=1))
    (out / "sites.json").write_text(json.dumps(dict(periods=sites, targets=targets), indent=1))
    (out / "skies.json").write_text(json.dumps(skies))
    (out / "scenario.json").write_text(json.dumps(dict(multi=scen, direct=scen2)))
    (out / "observations.json").write_text(json.dumps(obs))
    (out / "validation.json").write_text(json.dumps(val))
    from . import audit, breakeven as BE
    (out / "audit.json").write_text(json.dumps(audit.run()))
    by = {t["name"]: t for t in targets}
    be = {name: BE.explore((tb["x"], tb["y"]), (pp["x"], pp["y"]), (by[name]["x"], by[name]["y"]), 150.0)
          for name in ("Maria Gordon Notch", "Mt Mercou")}
    (out / "breakeven.json").write_text(json.dumps(be))
    from . import mission as M, targets as TG
    (out / "science_targets.json").write_text(json.dumps(TG.build()))
    (out / "mission.json").write_text(json.dumps(M.build_default(), default=float))
    export_ortho(out)
    export_experiments(out)
    re = json.loads((C.PROC / "route_eval.json").read_text())
    re["R1"].pop("pairs", None)
    (out / "route_eval.json").write_text(json.dumps(re))
    print("exported web assets to", out)


def main(argv):
    if "--export" not in argv:
        ingest()
        from . import validation, terrain, observations, route_eval, rems, terrain_signal
        validation.run()
        terrain.build()
        observations.build()
        rems.fetch_range(1720, 3895)          # REMS pressure, sampled rows (NASA PDS)
        terrain_signal.run()                  # RAD + REMS + terrain: does terrain add information?
        route_eval.run()
    export_web()


if __name__ == "__main__":
    main(sys.argv[1:])

"""Three-region GCR surface dose from one published transport model (Zhang et al. 2022), at matched assumptions.

Source (model input, taken as published): Zhang, J., Guo, J., Dobynde, M. I., Wang, Y., Wimmer-Schweingruber, R. F. (2022),
"From the top of Martian Olympus to deep craters and beneath: Mars' radiation environment under different atmospheric
and surface conditions", JGR Planets 127, e2021JE007157, doi:10.1029/2021JE007157. Figure data: Zenodo
doi:10.5281/zenodo.5953666 (CC-BY-4.0), FigureData.tar. AtRIS/Geant4 (FTFP_INCLXX_HP), BON2010 GCR (H to Fe),
Mars Climate Database atmosphere, regolith 1.79 g/cm^3; surface pressures 82, 305, 529, 753, 975, 1200 Pa.

Quantities (all at the surface, height = 0 row of each table, upward albedo included by the simulation):
  effective dose E      mSv/yr, ICRP-103 phantom coefficients (Dobynde et al. 2021): 6 pressures x phi 400/700/1000 MV (Fig. 11)
  water absorbed dose   mGy/yr, 15 cm-radius water sphere, all ions: 3 pressures (82/753/1200 Pa), phi 580 MV (Fig. 7)
  dose equivalent       mSv/yr, ICRP-60 Q(L) in that sphere: 3 pressures, phi 580 MV (Fig. 8)
  H+He water dose       mGy/yr: 6 pressures, phi 580 MV (Fig. 6), shown only as the depth-shape check

This is NOT Curiosity RAD-E plastic dose and must never be compared number-to-number with the Gale RAD-E product
(radiation.py). Absorbed dose, dose equivalent and effective dose are not converted into each other here: each
comes from its own published table.

Interpolation: linear in surface pressure between published nodes; never extrapolated. Pressures below 82 Pa
(Olympus summit seasonal low) are evaluated at the 82 Pa node and flagged (the paper's 82 Pa case IS the top of
Olympus Mons). Solar modulation is offered only at the published nodes (no phi interpolation).

Monte Carlo noise: estimated from the published tables themselves as the RMS relative residual of each
effective-dose curve about a straight line in pressure (the curves are non-monotonic at the 1-2 % level), so
site differences smaller than ~2x that are not resolved by this model.

Run: python -m marsshield.regional_dose
"""
from __future__ import annotations

import hashlib
import io
import json
import tarfile

import numpy as np
import requests

from . import config as C
from .atmosphere import OUT as ATM_JSON, PA_TO_GCM2, at_ls

ZENODO_URL = "https://zenodo.org/records/5953666/files/FigureData.tar?download=1"
ZENODO_MD5 = "f65945053d690414dbbbb9481073333d"
TAR = C.RAW / "zhang2022" / "FigureData.tar"
OUT = C.WEB_PUBLIC / "regions" / "radiation.json"
SOL_DAYS = 88775.244 / 86400.0           # Earth days per sol
P6 = [82, 305, 529, 753, 975, 1200]
P3 = [82, 753, 1200]
PHIS = [400, 700, 1000]

# RAD observations used only as an independent check of the model's pressure dependence at Gale (not fitted)
RAD_SLOPE = {"value": -0.13, "sigma": 0.02, "unit": "uGy/day/Pa", "quantity": "RAD E detector (plastic) absorbed dose",
             "source": "Guo et al. (2015), ApJ 810, 24, Sec. 4.1 (diurnal pressure-dose anticorrelation at Gale)"}


def _tables() -> dict[str, np.ndarray]:
    if not TAR.exists():
        TAR.parent.mkdir(parents=True, exist_ok=True)
        r = requests.get(ZENODO_URL, timeout=600)
        r.raise_for_status()
        TAR.write_bytes(r.content)
    raw = TAR.read_bytes()
    if hashlib.md5(raw).hexdigest() != ZENODO_MD5:
        raise RuntimeError("FigureData.tar does not match the Zenodo record (md5)")
    out = {}
    with tarfile.open(fileobj=io.BytesIO(raw)) as t:
        for m in t.getmembers():
            if m.isfile() and m.name.endswith(".txt"):
                out[m.name.rsplit("/", 1)[-1][:-4]] = np.loadtxt(io.TextIOWrapper(t.extractfile(m), encoding="utf8"))
    return out


def surface(tab: np.ndarray) -> np.ndarray:
    i = int(np.argmin(np.abs(tab[:, 0])))
    assert abs(tab[i, 0]) < 1e-9, "surface row (height 0) missing"
    return tab[i, 1:]


def interp_p(nodes: list[int], vals, p: float) -> tuple[float, bool]:
    """Linear in pressure between published nodes; below/above the grid -> edge value with flag."""
    edge = p < nodes[0] or p > nodes[-1]
    return float(np.interp(p, nodes, vals)), edge


def noise_rel(nodes, vals) -> float:
    x, y = np.asarray(nodes, float), np.asarray(vals, float)
    fit = np.polyval(np.polyfit(x, y, 1), x)
    return float(np.sqrt(np.mean(((y - fit) / fit) ** 2)))


def build() -> dict:
    T = _tables()
    eff = surface(T["figure11_eff_depth"]).reshape(3, 6)                     # [phi][pressure]
    f7, f8, f6 = surface(T["figure7"]), surface(T["figure8"]), surface(T["figure6"])
    water_total, deq_total = f7[3:6], f8[3:6]
    hhe = f6[0:6] + f6[6:12]
    col = surface(T["figure6ColumnDepth"])
    # reproduction check: integrate the published 580 MV integrands (Fig. 4) and compare with the Fig. 6 surface values
    def integral(name):
        a = np.nan_to_num(T[name]); return np.trapezoid(a[:, 1:], a[:, 0], axis=0)
    repro_H = integral("figure4H")
    noise = {phi: noise_rel(P6, eff[k]) for k, phi in enumerate(PHIS)}

    atm = json.loads(ATM_JSON.read_text())
    S = atm["sites"]
    site_keys = [("gale", "Gale Crater", "gale"), ("jezero", "Jezero Crater", "jezero"), ("oly_zeus", "Olympus Mons caldera (Zeus Patera)", "olympus"),
                 ("oly_athena", "Olympus Mons caldera (Athena Patera)", "olympus"), ("oly_summit", "Olympus Mons summit (outside the caldera)", "olympus")]

    def evaluate(p):
        r = {"pressure_pa": round(p, 1), "column_gcm2": round(p * PA_TO_GCM2, 3), "at_grid_edge": p < P6[0]}
        r["effective_mSv_yr"] = {str(phi): round(interp_p(P6, eff[k], p)[0], 2) for k, phi in enumerate(PHIS)}
        r["water_absorbed_mGy_yr_580MV"] = round(interp_p(P3, water_total, p)[0], 2)
        r["dose_equivalent_mSv_yr_580MV"] = round(interp_p(P3, deq_total, p)[0], 1)
        return r

    sites = []
    for key, name, region in site_keys:
        s = S[key]
        base = evaluate(s["annual_mean_pa"])
        lo, hi = evaluate(s["season_min"]["pa"]), evaluate(s["season_max"]["pa"])
        sites.append({"id": key, "name": name, "region": region, "lat": s["lat"], "lon": s["lon"], "pressure_source": "MCD v6.2 (modeled)",
                      "baseline": base, "season_low": {**lo, "ls": s["season_min"]["ls"]}, "season_high": {**hi, "ls": s["season_max"]["ls"]},
                      "mcd_query_url": s["query_url"]})
    # hydrostatic reference for mapping pressure across each region's DEM (exploratory): the MCD site pressure at the DEM
    # elevation of the query point. MCD uses its own 32 ppd topography, so the reference elevation is ours, not MCD's.
    H = atm["hydrostatic_scale_height_m"]
    hydro = {}
    for rid, key in [("jezero", "jezero"), ("olympus", "oly_zeus")]:
        s = S[key]
        z = _grid_elev(rid, s["lat"], s["lon"])
        hydro[rid] = {"ref_site": key, "ref_pressure_pa": s["annual_mean_pa"], "ref_elev_m": round(z, 1) if z is not None else None,
                      "scale_height_m": H[rid], "season_low_factor": round(s["season_min"]["pa"] / s["annual_mean_pa"], 4),
                      "season_high_factor": round(s["season_max"]["pa"] / s["annual_mean_pa"], 4),
                      "note": "P(z) = P_ref exp(-(z - z_ref)/H): exploratory; ignores slope flows and tides; reference elevation from the exported DEM"}
    # Olympus: also the ±10 % pressure assumption (no in-situ data above ~4 km anywhere on Mars)
    for st in sites:
        if st["region"] == "olympus":
            p = st["baseline"]["pressure_pa"]
            st["pressure_assumption_band"] = {"rel": 0.10, "low": evaluate(p * 0.9), "high": evaluate(p * 1.1),
                                              "kind": "assumption", "note": "±10 % on MCD pressure: judgment of the atmospheric review; no pressure measurement above ~4 km on Mars"}

    # independent check at Gale: model pressure slope (water dose, 580 MV) vs RAD observed slope (different target!)
    i753, i1200 = 1, 2
    slope_water = (water_total[i1200] - water_total[i753]) / (P3[i1200] - P3[i753]) * 1000 / 365.25    # uGy/day/Pa
    slope_hhe = (hhe[4] - hhe[3]) / (P6[4] - P6[3]) * 1000 / 365.25

    return {
        "model": {"name": "AtRIS/Geant4 surface dose tables (Zhang et al. 2022)", "doi": "10.1029/2021JE007157", "data_doi": "10.5281/zenodo.5953666",
                  "data_md5": ZENODO_MD5, "gcr": "BON2010, H to Fe", "pressures_pa": P6, "column_gcm2_published": [round(c, 2) for c in col],
                  "phi_nodes_MV": PHIS, "phi_580_only": ["water_absorbed", "dose_equivalent"],
                  "interpolation": "linear in surface pressure between published nodes; no extrapolation; phi only at published nodes",
                  "not_rad_e": "Water-phantom and effective-dose quantities. Not comparable number-for-number with Curiosity RAD-E plastic dose rates."},
        "tables": {"effective_mSv_yr": {str(phi): [round(v, 3) for v in eff[k]] for k, phi in enumerate(PHIS)},
                   "water_absorbed_mGy_yr_580MV": {"pressures_pa": P3, "values": [round(v, 3) for v in water_total]},
                   "dose_equivalent_mSv_yr_580MV": {"pressures_pa": P3, "values": [round(v, 2) for v in deq_total]},
                   "water_HHe_mGy_yr_580MV": {"pressures_pa": P6, "values": [round(v, 3) for v in hhe]}},
        "sites": sites,
        "uncertainty": {
            "mc_noise_rel": {str(k): round(v, 4) for k, v in noise.items()},
            "mc_noise_note": "RMS relative residual of each published effective-dose curve about a straight line in pressure; a site difference smaller than about twice this is not resolved.",
            "terms": [
                {"term": "Monte Carlo statistics of the published simulation", "kind": "stat", "value": f"{max(noise.values()) * 100:.1f} % (largest of the three phi curves)", "source": "derived from Zhang et al. (2022) tables"},
                {"term": "Seasonal pressure (Ls 150 to Ls 255)", "kind": "range", "value": "per site, evaluated at the low and high pressures", "source": "MCD v6.2"},
                {"term": "Olympus pressure", "kind": "assumption", "value": "±10 %", "source": "atmospheric review judgment; no measurement"},
                {"term": "Solar modulation", "kind": "scenario", "value": "400, 700, 1000 MV (effective dose); 580 MV only for absorbed dose and dose equivalent", "source": "Zhang et al. (2022)"},
                {"term": "Transport model choice", "kind": "not quantified", "value": "AtRIS and HZETRN disagree on the sign of dose equivalent versus depth (Guo et al. 2017, JGR Planets 122, 329)", "source": "literature"},
            ]},
        "validation": {
            "reproduction": {"what": "Integrating the published 580 MV proton integrands (Fig. 4) over energy reproduces the published surface proton dose (Fig. 6)",
                             "pressures_pa": P3, "integrated_mGy_yr": [round(v, 2) for v in repro_H],
                             "published_mGy_yr": [round(f6[P6.index(p)], 2) for p in P3],
                             "rel_diff": [round(float(a / f6[P6.index(p)] - 1), 4) for a, p in zip(repro_H, P3)]},
            "rad_pressure_slope": {"model_water_total_uGy_day_Pa": round(slope_water, 4), "model_water_HHe_uGy_day_Pa": round(slope_hhe, 4), "rad_observed": RAD_SLOPE,
                                   "verdict": "The model's absorbed-dose change with pressure near Gale is far weaker than RAD observes (different target, so only the sign and order of magnitude are comparable). The small regional differences below are therefore model-dependent and not validated.",
                                   "kind": "independent check (not used for fitting)"},
            "pressure_checks": {"meda_vs_mcd_jezero_pct": atm.get("meda_check", {}).get("mcd_minus_meda_pct"),
                                "zhang_olympus_82pa_vs_mcd_summit_annual": S["oly_summit"]["annual_mean_pa"]},
            "levels": {"fitting": "none in this module (no parameter is fitted)", "reproduction": "published tables reproduced (above)",
                       "independent_validation": "impossible at Jezero and Olympus Mons: no ionizing-radiation detector has operated there"},
        },
        "hydrostatic": hydro,
        "gale_rad_measured": _rad_context(),
        "sol_days": SOL_DAYS,
        "blockers": [
            "RAD-E plastic dose at other altitudes: no published or executable model gives the RAD E detector response versus atmospheric depth; scaling the Gale RAD-E product by a water-phantom ratio would be an invented multiplier (silicon and water depth trends differ: H+He +15 % vs +9 %).",
            "Absorbed dose and dose equivalent at solar modulation other than 580 MV: the archive gives response functions but GCR spectra only at 400 and 1000 MV with heavy ions lumped; the BON2010 code is not in hand.",
            "Terrain shielding of dose at Jezero and Olympus Mons: the published tables have no angular (zenith) resolution, so blocked sky cannot be converted into dose without an invented factor.",
            "Independent rerun: the AtRIS repository host did not resolve; values are reproduced from the published tables, not recomputed.",
            "Solar particle events: no published SPE response at these pressures was reproduced; see docs/SPE_FEASIBILITY.md.",
        ],
    }


def _grid_elev(region: str, lat: float, lon_e: float) -> float | None:
    """Elevation of the exported regional grid (bilinear) at an MCD query point, for the hydrostatic map reference."""
    import math
    m = json.loads((C.WEB_PUBLIC / "regions" / region / "manifest.json").read_text())
    g, f = m["grid"], m["frame"]
    lon = lon_e if f["lon"][0] >= 0 else lon_e - 360
    R = C.MARS_RADIUS_M
    x = (lon - f["lon_c"]) * math.radians(1) * R * math.cos(math.radians(f["lat_c"]))
    y = (lat - f["lat_c"]) * math.radians(1) * R
    z = np.frombuffer((C.WEB_PUBLIC / "regions" / region / g["file"]).read_bytes(), "<i2").astype(float).reshape(g["h"], g["w"])
    z = np.where(z == g["nodata"], np.nan, z * g["scale"] + g.get("offset", 0))
    c, r = (x - g["x0"]) / g["dx"] - 0.5, (g["y0"] - y) / g["dy"] - 0.5
    if not (0 <= c <= g["w"] - 1 and 0 <= r <= g["h"] - 1):
        return None
    i, j = int(c), int(r)
    u, v = c - i, r - j
    i1, j1 = min(i + 1, g["w"] - 1), min(j + 1, g["h"] - 1)
    return float(z[j, i] * (1 - u) * (1 - v) + z[j, i1] * u * (1 - v) + z[j1, i] * (1 - u) * v + z[j1, i1] * u * v)


def _rad_context() -> dict:
    """Curiosity RAD E measurements at the 322 Gale stops: a different quantity (plastic detector, absorbed dose), shown beside
    the model comparison as measured context only, never converted or differenced against it."""
    t = json.loads((C.PROC / "terrain_signal.json").read_text())
    E = np.array([r["E_mean"] for r in t["rows"]])
    return {"quantity": "absorbed dose rate in the RAD E detector (plastic), quiet-time GCR", "unit": "uGy/day", "n_stops": int(len(E)),
            "median": round(float(np.median(E)), 1), "range": [round(float(E.min()), 1), round(float(E.max()), 1)],
            "period": [t["rows"][0]["utc_start"][:10], t["rows"][-1]["utc_end"][:10]],
            "source": "NASA PDS/SPDF MSL RAD Level 2, reduced by MarsShield (data/processed/terrain_signal.json)",
            "note": "Measured. The range spans the solar cycle (the Sun's activity changed the GCR flux) and the seasons; it is not comparable number-for-number with the water-phantom or effective-dose model values."}


def run() -> dict:
    r = build()
    OUT.write_text(json.dumps(r, indent=1))
    return r


if __name__ == "__main__":
    r = run()
    for s in r["sites"]:
        b = s["baseline"]
        print(f"{s['name'][:40]:40s} {b['pressure_pa']:7.1f} Pa X={b['column_gcm2']:.2f}  E700={b['effective_mSv_yr']['700']} water={b['water_absorbed_mGy_yr_580MV']} H={b['dose_equivalent_mSv_yr_580MV']}  edge={b['at_grid_edge']}")
    print("noise", r["uncertainty"]["mc_noise_rel"]); print("repro", r["validation"]["reproduction"]["rel_diff"]); print("slope", r["validation"]["rad_pressure_slope"]["model_water_total_uGy_day_Pa"], r["validation"]["rad_pressure_slope"]["model_water_HHe_uGy_day_Pa"])

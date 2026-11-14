"""Regression tests for the scientific engine. Run: python -m pytest science/tests -q"""
import datetime as dt
import json

import numpy as np
import pytest

from marsshield import config as C
from marsshield import ingest as I
from marsshield.horizon import (THETA, Grid, TerrainStack, blocked_fraction_by_zenith,
                                blocked_solid_angle_exact, blocked_solid_angle_fraction,
                                default_distances, horizon_map, horizon_profile)
from marsshield.radiation import TerrainDoseModel, ZenithModel
from marsshield.routing import Router
from marsshield.validation import v1_analytic

HAVE_DEM = (C.RAW / "dem" / "gale_dem_1m_near.tif").exists()


# ---------------------------------------------------------------- horizon geometry
def test_analytic_geometries():
    cases = {c["case"]: c for c in v1_analytic()["cases"]}
    assert cases["flat sphere, h=1 m"]["abs_err_deg"] < 1e-6
    assert cases["straight wall 20 m high, 100 m north"]["abs_err_deg"] < 0.01
    pit = cases["cylindrical pit r=200 m, depth 50 m"]
    assert pit["abs_err_deg"] < 0.2 and abs(pit["got_B_exact"] - pit["expected_B"]) < 0.002
    pl = cases["plane rising 30 deg to the east (h=0)"]
    assert pl["abs_err_deg"] < 1e-3 and abs(pl["got_B_exact"] - pl["expected_B"]) < 1e-4


def test_solid_angle_of_uniform_horizon():
    e = np.full(1440, 20.0)
    assert blocked_solid_angle_exact(e) == pytest.approx(np.sin(np.radians(20)), rel=1e-9)
    # 1-deg ring discretisation is within 1 % of exact
    assert blocked_solid_angle_fraction(blocked_fraction_by_zenith(e)) == pytest.approx(np.sin(np.radians(20)), abs=0.01)


def test_numba_matches_numpy_reference():
    xs = np.linspace(-500, 500, 1001)
    X, Y = np.meshgrid(xs, xs[::-1])
    Z = 30 * np.exp(-((X - 120) ** 2 + (Y + 60) ** 2) / 80 ** 2) + 0.01 * X
    st = TerrainStack([Grid(Z.astype("float32"), -500, 500, 1.0)])
    r = default_distances(r_min=1.0, r_max=480, growth=0.01, dr_min=1.0)
    hm = horizon_map(st, np.array([0.0, 50.0]), np.array([0.0, -30.0]), 1.5, n_az=90, distances=r)
    for i, (x, y) in enumerate([(0, 0), (50, -30)]):
        hp = horizon_profile(st, x, y, 1.5, n_az=90, distances=r)
        assert np.abs(hm[i] - hp["elev"]).max() < 0.01


def test_reproduces_guo2021_ring_ratio():
    d = C.RAW / "zenodo_guo2021"
    mask = np.loadtxt(d / "FIg2.txt"); a = np.loadtxt(d / "Fig4a.txt")
    ros = blocked_fraction_by_zenith(mask[:, 1])
    assert np.abs((1 - ros) - a[:, 3]).max() <= 2 / 360 + 1e-9   # <= 2 one-degree azimuth bins
    assert blocked_solid_angle_fraction(ros) == pytest.approx(0.19, abs=0.005)  # Ehresmann et al. 2021


# ---------------------------------------------------------------- radiation model
def test_zenodo_dose_reproduction():
    zm = ZenithModel.load()
    d = C.RAW / "zenodo_guo2021"
    a = np.loadtxt(d / "Fig4a.txt"); b = np.loadtxt(d / "Fig4b.txt")
    H, He = zm.curves(484.0)
    assert np.abs(a[:, 3] * H - b[:, 2]).max() < 1e-6
    assert np.abs(a[:, 3] * He - b[:, 4]).max() < 1e-6
    H, He = zm.curves(384.5)
    assert 1.015 * H.sum() == pytest.approx(196.04, rel=0.01)   # Guo et al. 2026 Sec. 4
    assert 1.015 * He.sum() == pytest.approx(36.32, rel=0.01)


def test_albedo_makes_reduction_smaller_than_sky_reduction():
    m = TerrainDoseModel()
    ros = blocked_fraction_by_zenith(np.full(1440, 15.0))
    d = m.dose(ros, 500)
    assert d.rel_sky < d.rel_total < 1.0
    assert (1 - d.rel_total) < d.B          # never a proportional reduction
    assert m.dose(np.zeros(91), 500).rel_total == pytest.approx(1.0)


def test_dose_monotone_in_phi():
    m = TerrainDoseModel()
    v = [m.dose(np.zeros(91), p).D_total_flat for p in (400, 500, 600, 800)]
    assert all(x > y for x, y in zip(v, v[1:]))


# ---------------------------------------------------------------- data handling
def test_sol_clock_against_rad_file_attributes():
    import cdflib
    files = sorted((C.RAW / "rad_l2").glob("*.cdf"))[::200][:8]
    if not files:
        pytest.skip("no RAD files")
    for f in files:
        g = cdflib.CDF(str(f)).globalattsget()
        t = dt.datetime.strptime(g["Start_time"][0], "%Y%m%d_%H:%M:%S").replace(tzinfo=dt.timezone.utc)
        assert int(I.utc_to_sol(t)) == int(g["Start_sol"][0]), f.name


# ---------------------------------------------------------------- routing
def _toy_router(rate=None):
    z = np.zeros((40, 40))
    z[10:30, 20] = 50.0     # impassable wall (cliff) with a gap
    z[18:20, 20] = 0.0
    rate = np.ones_like(z) if rate is None else rate
    return Router(z, 5.0, rate, 0.0, 0.0)


def test_router_avoids_cliffs_and_finds_gap():
    rt = _toy_router()
    p = rt.path((25, 5), (25, 35), "shortest")
    r, c = np.divmod(p, rt.nx)
    assert ((c == 20) & ((r < 18) | (r > 19))).sum() == 0   # passes only through the gap


def test_low_dose_route_detours_into_shield_only_when_worth_it():
    rate = np.ones((40, 40)); rate[:, :] = 1.0; rate[0:8, :] = 0.5   # strongly shielded band far north
    rt = Router(np.zeros((40, 40)), 5.0, rate, 0.0, 0.0)
    p_short = rt.path((20, 2), (20, 37), "shortest"); p_low = rt.path((20, 2), (20, 37), "low_dose")
    ms, ml = rt.metrics(p_short, 300.0), rt.metrics(p_low, 300.0)
    assert ml["dose_uGy"] <= ms["dose_uGy"] + 1e-9


@pytest.mark.skipif(not HAVE_DEM, reason="DEM not downloaded")
def test_validation_outputs_exist_and_are_consistent():
    v = json.loads((C.PROC / "validation.json").read_text())
    assert v["v3_m12_mask"]["rmse_deg"] < 1.5
    assert v["v5"]["rel_diff_median"] < 0.01


# ---------------------------------------------------------------- break-even explorer
@pytest.mark.skipif(not (C.PROC / "walk_grid.npz").exists(), reason="walk grid not built")
def test_breakeven_consistency():
    from marsshield import breakeven as BE
    t = json.loads((C.ROOT / "web" / "public" / "data" / "sites.json").read_text())["targets"]
    T = {x["name"]: x for x in t}
    r = BE.explore((T["Tower Buttes"]["x"], T["Tower Buttes"]["y"]), (T["Paraitepuy"]["x"], T["Paraitepuy"]["y"]),
                   (T["Maria Gordon Notch"]["x"], T["Maria Gordon Notch"]["y"]), 150.0, sensitivity=False)
    for o in r["options"]:
        # forward+reverse Dijkstra walking dose equals the dose integrated along the reconstructed path
        assert o["walk_dose_uGy"] == pytest.approx(o["walk_dose_path_uGy"], rel=1e-6)
        assert o["dist_from_target_m"] <= 150.0 + 1e-6 and o["slope_deg"] <= BE.STOP_MAX_SLOPE_DEG
    # the named-option envelope is never below the exact optimum over all candidate cells
    assert r["max_gap_named_vs_exact_uGy"] >= -1e-9
    # at each break-even time the two lines cross
    opts = {o["keys"][0]: o for o in r["options"]}
    for b in r["breaks"]:
        a, c = opts[b["less_walking"]], opts[b["more_sheltered"]]
        assert a["walk_dose_uGy"] + b["t_h"] * a["stop_rate_uGy_h"] == pytest.approx(
            c["walk_dose_uGy"] + b["t_h"] * c["stop_rate_uGy_h"], rel=1e-9)
    # break-even times do not depend on phi (D_flat cancels)
    r2 = BE.explore(r["start"], r["end"], r["target"], 150.0, phi=750.0, sensitivity=False)
    assert [b["t_h"] for b in r2["breaks"]] == pytest.approx([b["t_h"] for b in r["breaks"]], rel=1e-6)


def _walk_targets():
    t = json.loads((C.ROOT / "web" / "public" / "data" / "sites.json").read_text())["targets"]
    return {x["name"]: x for x in t}


def test_classification_thresholds():
    from marsshield import breakeven as BE
    err = dict(mae_pp=3.37, rmse_pp=5.24)
    assert BE.classify(6.0, err) == "resolved"
    assert BE.classify(4.0, err) == "marginal"
    assert BE.classify(1.2, err) == "unresolved"


@pytest.mark.skipif(not (C.PROC / "walk_grid.npz").exists(), reason="walk grid not built")
def test_mt_mercou_is_unresolved_and_notch_is_resolved():
    from marsshield import breakeven as BE
    T = _walk_targets()
    s, e = (T["Tower Buttes"]["x"], T["Tower Buttes"]["y"]), (T["Paraitepuy"]["x"], T["Paraitepuy"]["y"])
    mm = BE.explore(s, e, (T["Mt Mercou"]["x"], T["Mt Mercou"]["y"]), 150.0, duration_h=[1, 3, 6], sensitivity=False)
    ac = next(b for b in mm["breaks"] if b["less_walking"] == "A" and b["more_sheltered"] == "C")
    assert ac["resolvability"] == "unresolved" and ac["t_h_model_error_band"][1] is None
    assert mm["recommendation"]["status"] in ("unresolved", "stay")
    mg = BE.explore(s, e, (T["Maria Gordon Notch"]["x"], T["Maria Gordon Notch"]["y"]), 150.0, sensitivity=False)
    ac = next(b for b in mg["breaks"] if b["less_walking"] == "A" and b["more_sheltered"] == "C")
    assert ac["resolvability"] == "resolved"
    lo, hi = ac["t_h_model_error_band"]
    assert lo < ac["t_h"] < hi
    # the sheltered option at the notch must carry terrain flags
    c = next(o for o in mg["options"] if "C" in o["keys"])
    assert any("Rockfall" in f for f in c["flags"])


@pytest.mark.skipif(not (C.PROC / "walk_grid.npz").exists(), reason="walk grid not built")
def test_science_targets_are_documented_and_placed_by_waypoints():
    from marsshield import targets as TG
    for t in TG.build():
        assert t["sources"] and all(s["url"].startswith("https://") for s in t["sources"])
        assert t["objective_quote"] and t["objective"]
        assert t["sols"][0] <= t["waypoint"]["sol"] + 1 and t["waypoint"]["sol"] <= t["sols"][1]
        assert "assumption" in t["assumption_note"].lower()
        b = C.WALK_BOUNDS
        assert b["left"] <= t["x"] <= b["right"] and b["bottom"] <= t["y"] <= b["top"]


@pytest.mark.skipif(not (C.PROC / "mission.json").exists(), reason="mission not built")
def test_mission_accounting():
    m = json.loads((C.PROC / "mission.json").read_text())
    t = m["totals"]
    assert t["total_uGy"] == pytest.approx(t["walk_uGy"] + t["stationary_uGy"], rel=1e-9)
    assert t["total_uGy"] <= t["total_if_all_at_targets_uGy"] + 1e-6     # recommendations never add dose
    for s in m["stops"]:
        if s["decision"]["status"] != "recommended":
            assert "B" in s["used_option"]                                  # unresolved -> work at the target


def test_audit_table1_and_p6():
    from marsshield import audit
    a = audit.a1_transcription()
    assert a["rows_checked"] == 15 and a["mismatches"] == 0
    v = json.loads((C.PROC / "validation.json").read_text())
    p6 = audit.a2_p6(v)
    assert p6["table1_ratio_decrease"] == pytest.approx(0.194, abs=0.001)
    assert p6["ours_nasa_l2"]["decrease"] == pytest.approx(0.194, abs=0.002)
    assert p6["verified_in_paper_text"] == dict(section4_quote=True, table1_P6_row=True)

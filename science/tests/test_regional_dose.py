"""Three-region dose model (Zhang et al. 2022 tables at MCD pressures): reproduction, interpolation and consistency.

Reads the committed export web/public/data/regions/radiation.json (no network needed)."""
import json
from pathlib import Path

import numpy as np
import pytest

from marsshield.regional_dose import P3, P6, PHIS, interp_p, noise_rel

OUT = Path(__file__).resolve().parents[2] / "web" / "public" / "data" / "regions" / "radiation.json"
R = json.loads(OUT.read_text())


def test_reproduces_published_surface_dose_by_integration():
    """Integrating the published 580 MV proton integrands reproduces the published surface proton dose to ~1 %."""
    rep = R["validation"]["reproduction"]
    assert all(abs(d) < 0.02 for d in rep["rel_diff"]), rep


def test_interpolation_returns_published_nodes_exactly():
    tab = R["tables"]["effective_mSv_yr"]
    for phi in PHIS:
        for p, v in zip(P6, tab[str(phi)]):
            assert interp_p(P6, tab[str(phi)], p) == (pytest.approx(v), False)


def test_no_extrapolation_below_the_grid():
    vals = R["tables"]["effective_mSv_yr"]["700"]
    v, edge = interp_p(P6, vals, 60.0)
    assert edge and v == pytest.approx(vals[0])
    summit = next(s for s in R["sites"] if s["id"] == "oly_summit")
    assert summit["baseline"]["at_grid_edge"] == (summit["baseline"]["pressure_pa"] < 82)


def test_matched_assumptions_across_sites():
    sites = R["sites"]
    assert {s["pressure_source"] for s in sites} == {"MCD v6.2 (modeled)"}
    for s in sites:
        b = s["baseline"]
        assert set(b["effective_mSv_yr"]) == {"400", "700", "1000"}
        assert b["column_gcm2"] == pytest.approx(b["pressure_pa"] / 37.1, rel=1e-3)
        assert s["season_low"]["pressure_pa"] < b["pressure_pa"] < s["season_high"]["pressure_pa"]
        assert s["season_low"]["ls"] in (135.0, 150.0) and s["season_high"]["ls"] == 255.0


def test_quantities_are_not_mixed_with_rad_e():
    assert "Not comparable" in R["model"]["not_rad_e"]
    assert R["gale_rad_measured"]["unit"] == "uGy/day" and "RAD E" in R["gale_rad_measured"]["quantity"]
    for s in R["sites"]:
        assert "rad_e" not in json.dumps(s["baseline"]).lower()


def test_noise_estimate_and_resolution_claims():
    noise = R["uncertainty"]["mc_noise_rel"]
    assert all(0.002 < v < 0.03 for v in noise.values())
    vals = R["tables"]["effective_mSv_yr"]["700"]
    assert noise_rel(P6, vals) == pytest.approx(noise["700"], abs=1e-4)
    gale = next(s for s in R["sites"] if s["id"] == "gale")["baseline"]["effective_mSv_yr"]["700"]
    jez = next(s for s in R["sites"] if s["id"] == "jezero")["baseline"]["effective_mSv_yr"]["700"]
    assert abs(jez / gale - 1) < 2 * noise["700"]          # Jezero vs Gale: not resolved by this model


def test_independent_check_is_reported_not_fitted():
    chk = R["validation"]["rad_pressure_slope"]
    assert chk["kind"].startswith("limitation")
    assert chk["rad_observed"]["value"] == -0.13
    assert abs(chk["model_water_total_uGy_day_Pa"]) < abs(chk["rad_observed"]["value"])   # the documented limitation


def test_sol_conversion():
    assert R["sol_days"] == pytest.approx(1.02749, abs=1e-5)
    # 100 sols at 170 mSv/yr
    assert 170 * 100 * R["sol_days"] / 365.25 == pytest.approx(47.82, abs=0.01)


def test_blockers_are_recorded():
    text = " ".join(R["blockers"])
    for key in ("RAD-E", "580 MV", "zenith", "AtRIS"):
        assert key in text

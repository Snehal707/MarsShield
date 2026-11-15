"""Regional manifests (Phase 3): structure, honest capability labels, and consistency of the exported files.

These tests read the committed exports in web/public/data/regions, so they need no network access.
"""
import json
import math
from pathlib import Path

import numpy as np
import pytest

OUT = Path(__file__).resolve().parents[2] / "web" / "public" / "data" / "regions"
STATUSES = {"validated", "exploratory", "unavailable"}


def _index():
    return json.loads((OUT / "index.json").read_text())


def _manifest(rid):
    return json.loads((OUT / rid / "manifest.json").read_text())


def test_index_lists_regions_with_known_statuses():
    idx = _index()
    assert set(idx["status_definitions"]) == STATUSES
    ids = [r["id"] for r in idx["regions"]]
    assert ids == ["gale", "mars", "jezero", "olympus"]
    for r in idx["regions"]:
        assert r["capabilities"], r["id"]
        for c in r["capabilities"]:
            assert c["status"] in STATUSES and c["detail"], (r["id"], c)


@pytest.mark.parametrize("rid", ["mars", "jezero", "olympus"])
def test_files_exist_and_match_grid_sizes(rid):
    m = _manifest(rid)
    g = m["grid"]
    raw = (OUT / rid / g["file"]).read_bytes()
    assert len(raw) == g["w"] * g["h"] * 2
    for spec in (m.get("aux") or {}).values():
        b = (OUT / rid / spec["file"]).read_bytes()
        assert len(b) == spec["w"] * spec["h"], spec["file"]
    for lay in m["layers"]:
        assert (OUT / rid / lay["file"]).exists(), lay["file"]
    # elevation range stored in the manifest matches the grid it describes (within int16 quantisation)
    z = np.frombuffer(raw, "<i2").astype(float)
    z = z[z != g["nodata"]] * g["scale"] + g.get("offset", 0)
    lo, hi = m["elevation_range_m"]
    assert lo - 60 <= z.min() and z.max() <= hi + 60


@pytest.mark.parametrize("rid", ["mars", "jezero", "olympus"])
def test_no_radiation_validation_outside_gale(rid):
    """No radiation capability outside Gale is labelled validated, and no Curiosity RAD data are assigned there."""
    m = _manifest(rid)
    assert {c["area"] for c in m["capabilities"]} <= {"terrain", "atmosphere", "radiation"}
    for c in m["capabilities"]:
        if c["area"] == "radiation":
            assert c["status"] in ("exploratory", "unavailable"), c
    assert "RAD Level 2" not in json.dumps(m)


def test_gale_keeps_measured_radiation():
    gale = next(r for r in _index()["regions"] if r["id"] == "gale")
    meas = next(c for c in gale["capabilities"] if c["name"] == "Radiation measurements")
    assert meas["status"] == "validated" and meas["area"] == "radiation"


def test_exploratory_layers_are_labelled():
    m = _manifest("jezero")
    sky = next(l for l in m["layers"] if l["id"] == "sky")
    assert sky.get("exploratory") is True and "exploratory" in sky["name"].lower()
    assert m["aux"]["sky"].get("exploratory") is True
    cap = next(c for c in m["capabilities"] if c["name"].startswith("Sky blocked"))
    assert cap["status"] == "exploratory"


def test_jezero_frame_is_true_scale():
    """East-west cell size is the 60 m source spacing times cos(latitude) at the region centre."""
    m = _manifest("jezero")
    lat_c = m["frame"]["lat_c"]
    assert m["grid"]["dx"] == pytest.approx(60 * math.cos(math.radians(lat_c)), abs=0.05)
    assert m["grid"]["dy"] == pytest.approx(60.0)


def test_jezero_dtm_agrees_with_rover_elevations():
    chk = _manifest("jezero")["checks"][0]
    assert chk["n"] > 500
    assert abs(chk["median_m"]) < 5            # the two products are co-registered to a few metres
    wp = _manifest("jezero")["traverse"]["waypoints"]
    assert len(wp) == chk["n"] and all(len(w) == 4 for w in wp)


def test_olympus_units_and_published_reference():
    m = _manifest("olympus")
    legend = next(l for l in m["layers"] if l["id"] == "units")["legend"]
    ids = [u["id"] for u in legend]
    assert ids == ["Aoc1", "Aoc2", "Aoc3", "Aoc4", "Aoc5", "Aos1", "Aos2", "Aw", "Ap1", "Ap2"]
    units = np.frombuffer((OUT / "olympus" / "units.u8").read_bytes(), np.uint8)
    present = {ids[c - 1] for c in np.unique(units) if c > 0}
    assert {"Aoc1", "Aoc2", "Aoc3", "Aoc4", "Aoc5", "Aw"} <= present   # every patera floor and the wall rasterised
    hi = m["checks"][0]
    assert hi["reference_m"] == 21290 and abs(hi["value_m"] - 21290) < 300
    rows = {r["unit"]: r for r in m["checks"][1]["rows"]}
    assert set(rows) == {"Aoc1", "Aoc2", "Aoc3", "Aoc4", "Aoc5"}
    assert all(17000 < r["min_m"] < r["max_m"] < 21300 for r in rows.values())


def test_region_payloads_stay_small():
    for r in _index()["regions"]:
        if r["kind"] != "gale":
            assert r["bytes"] < 3_000_000, (r["id"], r["bytes"])

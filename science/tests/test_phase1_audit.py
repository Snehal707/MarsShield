"""Tests for the solar-particle-event screening and the parking/P6 audit (science/marsshield/sep_events.py, parking_audit.py).
Run: python -m pytest science/tests -q. Tests on raw RAD records skip when the cache is absent (e.g. CI)."""
import datetime as dt
import json

import pytest

from marsshield import config as C
from marsshield import ingest as I
from marsshield import parking_audit as PA
from marsshield import sep_events as SE

HAVE_RAD_2017 = I.rad_file_for_day(dt.date(2017, 9, 11)).exists() if (C.RAW / "rad_l2").exists() else False
TS = C.PROC / "terrain_signal.json"


@pytest.mark.skipif(not HAVE_RAD_2017, reason="raw RAD L2 cache not present")
def test_sep_2017_detected_in_raw_records():
    w = SE.detect(SE.EVENTS[0], 0.10)
    assert w["detected"] and w["peak_ratio"] > 2.0
    assert "2017-09-10T19" <= w["enhancement"][0] <= "2017-09-10T23:59"          # onset late on 10 September
    assert w["forbush_min_ratio"] < 0.9                                            # Forbush decrease afterwards


def test_sep_windows_are_ordered_and_stable_across_thresholds():
    d = json.loads((C.PROC / "sep_events.json").read_text())
    for e in d["events"]:
        ws = [e["windows"][k] for k in ("0.05", "0.10", "0.20")]
        if not ws[1].get("detected"):
            continue
        a = [w["enhancement_ts"] for w in ws]
        assert all(x[0] < x[1] for x in a)
        assert a[0][0] <= a[1][0] <= a[2][0] and a[2][1] <= a[1][1] <= a[0][1]    # higher threshold, narrower window


@pytest.mark.skipif(not TS.exists(), reason="processed terrain signal absent")
def test_screening_keeps_reference_and_is_record_level():
    d = json.loads(TS.read_text())
    v = {x["variant"]: x for x in d["sep_screening"]["variants"]}
    ref = v["original (historical full sample)"]
    assert ref["n_stops"] == 322 and ref["rmse_pp"]["M3"] == pytest.approx(d["performance"]["M3"]["rmse_pp"], rel=1e-12)
    both = v["excluding both SPEs"]
    assert both["n_stops"] == 321
    st = {s["stop"]: s for s in both["stops_with_records_removed"]}
    assert st["91_1544"]["change"] == "records removed" and st["91_1544"]["n_obs_after"] < st["91_1544"]["n_obs_before"]
    assert st["66_0"]["change"].startswith("removed")
    for x in d["sep_screening"]["variants"]:                                       # the terrain model vs proxy stays unresolved
        lo, hi = x["M3-M2"]["site_ci95_pp2"]
        assert lo < 0 < hi


def test_p6_published_geometry_prediction_reproduced():
    v, ex = PA._inputs()
    ours = [r for r in PA.predictions(v, ex, geometry="ours", alpha=0.19) if r["pair"].startswith("P6")][0]
    pub = [r for r in PA.predictions(v, ex, geometry="published", alpha=0.19) if r["pair"].startswith("P6")][0]
    assert ours["physical"] == pytest.approx(-0.0977, abs=5e-4)                  # the story's 9.8 %
    assert pub["physical"] == pytest.approx(-0.1333, abs=5e-4)                   # reviewer's 13.3 %, reproduced
    assert ours["measured"] == pytest.approx(-0.1939, abs=5e-4)


def test_solar_modulation_explains_p5():
    v, ex = PA._inputs()
    p5 = [r for r in PA.predictions(v, ex) if r["pair"].startswith("P5")][0]
    assert p5["modulation_only"] == pytest.approx(-0.0204, abs=5e-4)
    assert abs(p5["measured"] - p5["modulation_only"]) < 0.002                   # terrain part is tiny


def test_parking_ranking_depends_on_inputs_and_is_never_decisive():
    d = json.loads((C.PROC / "parking_audit.json").read_text())
    firsts = {k: x["score"]["ranking_by_rmse"][0] for k, x in d["variants"].items()}
    assert len(set(firsts.values())) > 1                                           # the winner changes with the inputs
    for x in d["variants"].values():
        s = x["score"]["dRMSE_physical_minus_rule_pp"]
        assert s["p025"] < 0 < s["p975"]


def test_p7_discrepancy_documented_as_unresolved():
    p7 = json.loads((C.PROC / "parking_audit.json").read_text())["p7"]
    assert p7["min_half_sol"] > p7["published"] + 3

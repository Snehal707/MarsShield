"""Tests for the RAD + REMS terrain-signal analysis. Run: python -m pytest science/tests -q

None of these needs the network or the terrain rasters: the parser is tested on synthetic PDS records, the
cross-validation on synthetic tables, and the published result is re-derived from the committed web export."""
import datetime as dt
import json
from pathlib import Path

import numpy as np
import pytest

from marsshield import rems
from marsshield import terrain_signal as T

EXPORT = Path(__file__).resolve().parents[2] / "web" / "public" / "data" / "terrain_signal.json"


# ---------------------------------------------------------------- REMS MODRDR record parser
def _record(sclk: int, pressure: str, conf: str, rb: int = 372) -> bytes:
    """A fixed-width MODRDR record with PRESSURE at bytes 345-351 and PS_CONFIDENCE_LEVEL at 362-369 (1-indexed)."""
    s = list(f"{sclk:>10d}," + "x" * (rb - 11))
    s[344:351] = list(f"{pressure:>7s}")
    s[361:369] = list(f"{conf:>8s}")
    return "".join(s).encode("ascii")


def test_parse_record_offsets():
    sc, p, ok = rems.parse_record(_record(456789012, "741.3", "11110111"))
    assert sc == 456789012 and p == pytest.approx(741.3) and ok


def test_parse_record_short_timestamp_keeps_offsets():
    # a 9-digit SCLK is right-justified in a 10-byte field; stripping the pad must not shift the columns
    raw = b"  " + _record(45678901, "803.0", "11110111")
    assert rems.parse_record(raw)[:2] == (45678901, pytest.approx(803.0))


def test_parse_record_flags():
    assert rems.parse_record(_record(456789012, "741.3", "11110110"))[2] is False   # shadow-affected
    assert rems.parse_record(_record(456789012, "741.3", "1111011X"))[2] is False   # flag unavailable
    assert rems.parse_record(_record(456789012, "0.0", "11110111"))[2] is False     # no reading
    assert rems.parse_record(b"garbage") is None


def test_parse_records_utc_from_sclk():
    t0 = dt.datetime(2017, 6, 1, tzinfo=dt.timezone.utc)
    sclk, utc, p, ok = rems.parse_records([_record(1000, "750.0", "11110111"), _record(4600, "751.0", "11110110")], t0, 1000)
    assert utc == ["2017-06-01T00:00:00+00:00", "2017-06-01T01:00:00+00:00"] and ok == [1, 0] and p == [750.0, 751.0]


# ---------------------------------------------------------------- time-blocked cross-validation
def _table(n=200, seed=0):
    rng = np.random.default_rng(seed)
    sols = np.sort(rng.uniform(1700, 3900, n))
    m = rng.normal(0, 0.03, n)
    return [dict(mid_sol=float(s), x_p=float(rng.normal(0, 2)), m_terrain=float(mi), g_proxy=float(mi * 1.4),
                 y_obs=float(mi + rng.normal(0, 0.02))) for s, mi in zip(sols, m)]


def test_cv_buffer_excludes_neighbouring_sols(monkeypatch):
    rows, seen = _table(), []
    real = T.fit_predict

    def spy(train, test, spec):
        seen.append(([r["mid_sol"] for r in train], [r["mid_sol"] for r in test]))
        return real(train, test, spec)

    monkeypatch.setattr(T, "fit_predict", spy)
    T.cross_validate(rows, k=8, window=15.0)
    assert seen
    for tr, te in seen:
        assert not set(tr) & set(te)
        lo, hi = min(te), max(te)
        assert all(s < lo - 15.0 or s > hi + 15.0 for s in tr), "a training stop shares the test block's background window"


def test_cv_prediction_does_not_see_test_outcomes():
    rows = _table()
    pred, _, b, _ = T.cross_validate(rows)
    tampered = [dict(r, y_obs=r["y_obs"] + 1.0) if b[i] == 3 else r for i, r in enumerate(rows)]
    pred2, _, _, _ = T.cross_validate(tampered)
    for m in T.MODELS:
        np.testing.assert_allclose(pred[m][b == 3], pred2[m][b == 3])


def test_bootstrap_is_reproducible(monkeypatch):
    monkeypatch.setattr(T, "BOOT", 300)
    rows = _table()
    pred, *_ = T.cross_validate(rows)
    assert T.evaluate(rows, pred, seed=11) == T.evaluate(rows, pred, seed=11)


# ---------------------------------------------------------------- the published result re-derives from its inputs
@pytest.mark.skipif(not EXPORT.exists(), reason="web export not built")
def test_published_terrain_signal_reproduces():
    d = json.loads(EXPORT.read_text())
    rows = d["rows"]
    pred, *_ = T.cross_validate(rows, k=d["k_blocks"], window=d["window_sols"])
    y = np.array([r["y_obs"] for r in rows])
    for m, v in d["performance"].items():
        assert np.sqrt(np.mean((y - pred[m]) ** 2)) * 100 == pytest.approx(v["rmse_pp"], rel=1e-9), m
    # the headline: terrain model beats time-only out of sample; pressure adds nothing measurable
    assert d["performance"]["M3"]["skill_vs_M0"] > 0.15
    assert abs(d["performance"]["M1"]["skill_vs_M0"]) < 0.02


@pytest.mark.skipif(not EXPORT.exists(), reason="web export not built")
def test_gain_concentration_and_units_reproduce():
    """The reviewed numbers: RMSE (not MSE) reduction, and the share of the gain carried by Maria Gordon Notch."""
    d = json.loads(EXPORT.read_text())
    rows = d["rows"]
    pred, *_ = T.cross_validate(rows, k=d["k_blocks"], window=d["window_sols"])
    y = np.array([r["y_obs"] for r in rows])
    site = np.array([T._site(r) for r in rows])
    rmse = lambda p: np.sqrt(np.mean((y - p) ** 2))
    assert 1 - rmse(pred["M3"]) / rmse(pred["M0"]) == pytest.approx(d["rmse_reduction_vs_M0"]["M3"], rel=1e-9)
    assert 0.11 < d["rmse_reduction_vs_M0"]["M3"] < 0.12 and 0.21 < d["performance"]["M3"]["skill_vs_M0"] < 0.23
    shares, _, _ = T.gain_shares(y, pred["M3"], pred["M0"], site)
    assert shares[0][0] == T.MGN_SITE and shares[0][1] == pytest.approx(d["influence"]["mgn_site"]["share"], rel=1e-9)
    assert 0.55 < shares[0][1] < 0.63


@pytest.mark.skipif(not EXPORT.exists(), reason="web export not built")
def test_overlap_and_robustness_are_reported_honestly():
    d = json.loads(EXPORT.read_text())
    e = d["evaluation_overlap"]
    assert e["n_in_published_periods"] == sum(T.in_published_period(r) for r in d["rows"]) == 27
    assert T.MGN_SITE in e["sites_in_published_periods"] and e["status"].startswith("partly independent")
    v = {r["variant"]: r for r in d["robustness"]}
    no_mgn = v[f"excluding site {T.MGN_SITE} (Maria Gordon Notch)"]
    assert no_mgn["dMSE_vs_M0_site_ci95_pp2"]["M3"][1] < 0          # survives removing the notch
    top10 = v["excluding the 10 % of stops with the largest modeled anomaly"]
    assert top10["dMSE_vs_M0_ci95_pp2"]["M3"][1] > 0                # but not removing the most shielded tenth

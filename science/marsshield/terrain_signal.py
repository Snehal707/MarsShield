"""Does local terrain explain Curiosity RAD dose variation after controlling for pressure and time?

Data (all NASA): RAD L2 detector-E dose rate (flagged records removed), REMS MODRDR surface pressure
(rems.py), MSL waypoints. Unit of analysis: a rover stop in the walk area with >= MIN_SOLS of RAD data.

TARGET (identical operation applied to observations and to every predictor):
    y_s   = mean_{o in s} ln E_o  -  median_{o in W_s} ln E_o
where W_s = all RAD observations at OTHER walk-area stops within +/-WINDOW sols of stop s. This removes
the solar-cycle / seasonal trend without a fitted model. Only observations with a matched REMS pressure
are used, so every model is evaluated on exactly the same observations.

PREDICTORS (same detrending):
    x_s   = mean P (stop) - median P (window)                       [Pa]       pressure anomaly
    g_s   = ln(1 - B) at stop - median over window obs              [log]      blocked-sky proxy
    m_s   = ln(rel_total) at stop - median over window obs          [log]      published terrain model
            (rel_total: Guo et al. 2021/2026 model at RAD height 1 m, phi = 500 MV, alpha = 0.21)

MODELS
    M0  time only                 y = 0
    M1  pressure                  y = k x                      (k fitted)
    M2  sky proxy                 y = g                        (fixed, no fit)
    M3  terrain model             y = m                        (fixed, no fit)
    M4  pressure + terrain model  y = k x + m                  (k fitted)
    M5  pressure + sky proxy      y = k x + g                  (k fitted)
    M6  pressure + scaled terrain y = k x + b m                (k, b fitted; tests information, not calibration)

EVALUATION: leave-one-time-block-out cross-validation (K contiguous blocks in sol). Training excludes stops
within WINDOW sols of the test block, because their targets share background observations with it.
Uncertainty: moving-block bootstrap over time-ordered stops (block lengths 10/20/40 stops) for RMSE
differences and correlations; effective sample size from the lag-1 autocorrelation.
"""
from __future__ import annotations

import datetime as dt
import json

import numpy as np

from . import config as C
from . import ingest as I
from . import rems
from .observations import walk_stops

WINDOW = 15.0
MIN_SOLS = 1.0
MAX_P_GAP_S = 3600.0
K_BLOCKS = 8
BOOT = 4000
GUO2015_KAPPA = dict(value=-0.13, err=0.02, unit="uGy/day/Pa", detector="E",
                     cite="Guo et al. (2015) ApJ 810, 24 (first Martian year, diurnal fit)", url="https://doi.org/10.1088/0004-637X/810/1/24")


def _match_pressure(t_obs: np.ndarray, ts: np.ndarray, ps: np.ndarray) -> np.ndarray:
    """Linear interpolation of REMS pressure at RAD times; NaN when no REMS sample within MAX_P_GAP_S."""
    out = np.full(t_obs.shape, np.nan)
    j = np.searchsorted(ts, t_obs)
    ok = (j > 0) & (j < ts.size)
    j0, j1 = np.clip(j - 1, 0, ts.size - 1), np.clip(j, 0, ts.size - 1)
    gap = np.minimum(np.abs(t_obs - ts[j0]), np.abs(ts[j1] - t_obs))
    w = np.where(ts[j1] > ts[j0], (t_obs - ts[j0]) / np.maximum(ts[j1] - ts[j0], 1e-9), 0.0)
    val = ps[j0] * (1 - w) + ps[j1] * w
    good = ok & (gap <= MAX_P_GAP_S) & ((ts[j1] - ts[j0]) <= 2 * MAX_P_GAP_S)
    out[good] = val[good]
    return out


def build_table(window: float = WINDOW, min_sols: float = MIN_SOLS) -> dict:
    obs_json = json.loads((C.PROC / "observations.json").read_text())
    model_by_rmc = {s["rmc"]: s for s in obs_json["stops"]}
    stops = walk_stops()
    a = min(s["sol_a"] for s in stops) - window; b = max(s["sol_b"] for s in stops) + window
    r = I.read_rad(I.fetch_rad_sols(a, b))
    good = (r["flag"] == 0) & np.isfinite(r["E"]) & (r["E"] > 0)
    sol, E, utc = r["sol"][good], r["E"][good], r["utc"][good]
    t = np.array([dt.datetime.fromisoformat(u).timestamp() for u in utc])
    ts, ps = rems.load_series(int(a) - 1, int(b) + 1)
    P = _match_pressure(t, ts, ps)
    # assign observations to stops (occupancy windows) and attach stop-level model values
    sid = np.full(sol.shape, -1)
    for k, s in enumerate(stops):
        sid[(sol >= s["sol_a"]) & (sol < s["sol_b"])] = k
    rel = np.full(sol.shape, np.nan); B = np.full(sol.shape, np.nan)
    for k, s in enumerate(stops):
        m = model_by_rmc.get(s["rmc"])
        if m:
            rel[sid == k] = m["rel_total_model"]; B[sid == k] = m["B"]
    use = (sid >= 0) & np.isfinite(P) & np.isfinite(rel)
    sol, E, P, sid, rel, B, utc = sol[use], E[use], P[use], sid[use], rel[use], B[use], utc[use]
    lnE, lnr, lng = np.log(E), np.log(rel), np.log(1 - B)
    rows = []
    for k, s in enumerate(stops):
        m = sid == k
        if m.sum() < 3:
            continue
        span = float(sol[m].max() - sol[m].min())
        if span < min_sols:
            continue
        mid = 0.5 * (s["sol_a"] + s["sol_b"])
        bg = (sid != k) & (np.abs(sol - mid) <= window)
        if bg.sum() < 50:
            continue
        rows.append(dict(
            rmc=s["rmc"], sol=s["sol"], mid_sol=mid, x=s["x"], y=s["y"], n_obs=int(m.sum()), n_bg=int(bg.sum()), data_sols=span,
            utc_start=str(utc[m][0]), utc_end=str(utc[m][-1]),
            E_mean=float(E[m].mean()), P_mean=float(P[m].mean()), P_bg=float(np.median(P[bg])),
            y_obs=float(lnE[m].mean() - np.median(lnE[bg])),
            x_p=float(P[m].mean() - np.median(P[bg])),
            m_terrain=float(lnr[m].mean() - np.median(lnr[bg])),
            g_proxy=float(lng[m].mean() - np.median(lng[bg])),
            rel_total=float(rel[m][0]), B=float(B[m][0])))
    rows.sort(key=lambda q: q["mid_sol"])
    meta = dict(n_rad_obs_total=int(good.sum()), n_rad_obs_with_pressure_at_stops=int(use.sum()),
                frac_obs_with_pressure=float(np.isfinite(_match_pressure(t, ts, ps)).mean()),
                n_rems_samples=int(ts.size), sol_range=[float(a), float(b)])
    return dict(rows=rows, meta=meta)


# ------------------------------------------------------------------ models
MODELS = {
    "M0": dict(label="Time only", fit=[], fixed=None),
    "M1": dict(label="Pressure", fit=["x_p"], fixed=None),
    "M2": dict(label="Blocked-sky proxy", fit=[], fixed="g_proxy"),
    "M3": dict(label="Terrain model", fit=[], fixed="m_terrain"),
    "M4": dict(label="Pressure + terrain model", fit=["x_p"], fixed="m_terrain"),
    "M5": dict(label="Pressure + blocked-sky proxy", fit=["x_p"], fixed="g_proxy"),
    "M6": dict(label="Pressure + scaled terrain model", fit=["x_p", "m_terrain"], fixed=None),
}


def _arr(rows, k):
    return np.array([r[k] for r in rows], float)


def fit_predict(train, test, spec):
    y_tr = _arr(train, "y_obs")
    off_tr = _arr(train, spec["fixed"]) if spec["fixed"] else np.zeros(len(train))
    off_te = _arr(test, spec["fixed"]) if spec["fixed"] else np.zeros(len(test))
    if not spec["fit"]:
        return off_te, {}
    X_tr = np.column_stack([_arr(train, f) for f in spec["fit"]])
    coef, *_ = np.linalg.lstsq(X_tr, y_tr - off_tr, rcond=None)
    X_te = np.column_stack([_arr(test, f) for f in spec["fit"]])
    return off_te + X_te @ coef, dict(zip(spec["fit"], coef.tolist()))


def blocks(rows, k=K_BLOCKS):
    sols = np.array([r["mid_sol"] for r in rows])
    edges = np.quantile(sols, np.linspace(0, 1, k + 1))
    b = np.clip(np.searchsorted(edges, sols, side="right") - 1, 0, k - 1)
    return b, edges


def cross_validate(rows, k=K_BLOCKS, window=WINDOW):
    b, edges = blocks(rows, k)
    sols = np.array([r["mid_sol"] for r in rows])
    pred = {m: np.full(len(rows), np.nan) for m in MODELS}
    coefs = {m: [] for m in MODELS}
    for j in range(k):
        te = np.flatnonzero(b == j)
        lo, hi = sols[te].min() - window, sols[te].max() + window
        tr = np.flatnonzero((b != j) & ((sols < lo) | (sols > hi)))     # buffer: no shared background
        for m, spec in MODELS.items():
            p, c = fit_predict([rows[i] for i in tr], [rows[i] for i in te], spec)
            pred[m][te] = p; coefs[m].append(c)
    return pred, coefs, b, edges


def _mbb_indices(n, L, rng):
    starts = rng.integers(0, max(1, n - L + 1), size=int(np.ceil(n / L)))
    idx = np.concatenate([np.arange(s, min(s + L, n)) for s in starts])[:n]
    return idx


def lag_autocorr(v, lag=1):
    v = np.asarray(v) - np.mean(v)
    return float(np.sum(v[lag:] * v[:-lag]) / np.sum(v * v))


def evaluate(rows, pred, seed=11):
    y = _arr(rows, "y_obs")
    n = len(y)
    rng = np.random.default_rng(seed)
    res = {}
    e0 = y - pred["M0"]
    for m in MODELS:
        e = y - pred[m]
        res[m] = dict(label=MODELS[m]["label"], rmse_pp=float(np.sqrt(np.mean(e ** 2)) * 100),
                      mae_pp=float(np.mean(np.abs(e)) * 100),
                      skill_vs_M0=float(1 - np.mean(e ** 2) / np.mean(e0 ** 2)))
    # dependence-aware CIs for MSE differences between models (moving-block bootstrap)
    pairs = [("M1", "M0"), ("M3", "M0"), ("M2", "M0"), ("M4", "M1"), ("M5", "M1"), ("M6", "M1"), ("M4", "M5"), ("M3", "M2")]
    diffs = {}
    for L in (10, 20, 40):
        for a_, b_ in pairs:
            d = (y - pred[a_]) ** 2 - (y - pred[b_]) ** 2
            bs = [np.mean(d[_mbb_indices(n, L, rng)]) for _ in range(BOOT)]
            diffs.setdefault(f"{a_}-{b_}", {})[f"L{L}"] = dict(
                mean_dMSE_pp2=float(np.mean(d) * 1e4), ci95_pp2=[float(np.percentile(bs, 2.5) * 1e4), float(np.percentile(bs, 97.5) * 1e4)],
                p_improves=float(np.mean(np.array(bs) < 0)))
    return res, diffs


def correlation_cis(rows, a="y_obs", b="m_terrain", seed=5):
    x, y = _arr(rows, a), _arr(rows, b)
    n = len(x); rng = np.random.default_rng(seed)
    r = float(np.corrcoef(x, y)[0, 1])
    out = dict(r=r, n=n)
    iid = [np.corrcoef(x[i], y[i])[0, 1] for i in (rng.integers(0, n, n) for _ in range(BOOT))]
    out["iid_ci95"] = [float(np.nanpercentile(iid, 2.5)), float(np.nanpercentile(iid, 97.5))]
    for L in (10, 20, 40):
        bs = [np.corrcoef(x[i], y[i])[0, 1] for i in (_mbb_indices(n, L, rng) for _ in range(BOOT))]
        out[f"block{L}_ci95"] = [float(np.nanpercentile(bs, 2.5)), float(np.nanpercentile(bs, 97.5))]
    rho_x, rho_y = lag_autocorr(x), lag_autocorr(y)
    out["lag1_autocorr"] = dict(observed=rho_x, predictor=rho_y)
    # effective n for a correlation between two AR(1)-like series (Bretherton et al. 1999 approximation)
    out["n_eff"] = float(n * (1 - rho_x * rho_y) / (1 + rho_x * rho_y))
    return out


def _spearman(a, b):
    ra, rb = np.argsort(np.argsort(a)), np.argsort(np.argsort(b))
    return float(np.corrcoef(ra, rb)[0, 1])


def robustness(base_rows) -> list[dict]:
    """Pre-specified robustness variants: same models, same CV, different data choices."""
    from .published import GUO2026_TABLE1
    pub_sols = [(v[1], v[2]) for v in GUO2026_TABLE1.values()] + [(1456, 1468)]
    def summ(name, rows, window=WINDOW):
        if len(rows) < 40:
            return dict(variant=name, n=len(rows), note="too few stops")
        pred, *_ = cross_validate(rows, window=window)
        y = _arr(rows, "y_obs"); mse0 = np.mean((y - pred["M0"]) ** 2)
        sk = {m: float(1 - np.mean((y - pred[m]) ** 2) / mse0) for m in ("M1", "M2", "M3", "M4")}
        rng = np.random.default_rng(23)
        ci = {}
        for m in ("M2", "M3"):
            d = (y - pred[m]) ** 2 - (y - pred["M0"]) ** 2
            bs = [np.mean(d[_mbb_indices(len(y), 20, rng)]) for _ in range(2000)]
            ci[m] = [float(np.percentile(bs, 2.5) * 1e4), float(np.percentile(bs, 97.5) * 1e4)]
        return dict(variant=name, n=len(rows), skill=sk, dMSE_vs_M0_ci95_pp2=ci,
                    r_terrain=float(np.corrcoef(y, _arr(rows, "m_terrain"))[0, 1]),
                    spearman_terrain=_spearman(y, _arr(rows, "m_terrain")))
    out = [summ("baseline (window 15 sols, >= 1 sol of data)", base_rows)]
    in_pub = lambda r: any(a - 1 <= r["mid_sol"] <= b + 1 for a, b in pub_sols)
    out.append(summ("excluding stops inside the published Guo et al. periods", [r for r in base_rows if not in_pub(r)]))
    cut = np.percentile(np.abs(_arr(base_rows, "m_terrain")), 95)
    out.append(summ("excluding the 5 % of stops with the largest modeled anomaly", [r for r in base_rows if abs(r["m_terrain"]) <= cut]))
    out.append(summ("stops with >= 2 sols of data", [r for r in base_rows if r["data_sols"] >= 2]))
    for w in (10.0, 30.0):
        out.append(summ(f"detrending window {w:.0f} sols", build_table(window=w)["rows"], window=w))
    return out


def disagreement_test(rows, tops=(10, 20, 40), B=4000, seed=31) -> dict:
    """Pre-specified test: select stops where the terrain model and the blocked-sky proxy disagree most
    (|m - g|, from model values only), then compare their errors against the measured anomaly.
    Stops are clustered by Curiosity navigation site (RMC site index), and uncertainty is a site-cluster bootstrap."""
    y, m, g = _arr(rows, "y_obs"), _arr(rows, "m_terrain"), _arr(rows, "g_proxy")
    site = np.array([int(r["rmc"].split("_")[0]) for r in rows])
    order = np.argsort(-np.abs(m - g))
    rng = np.random.default_rng(seed)
    out = []
    for top in tops:
        i = order[:top]
        em, eg = y[i] - m[i], y[i] - g[i]
        sites = np.unique(site[i])
        per_site = [(np.sqrt(np.mean(em[site[i] == s_] ** 2)), np.sqrt(np.mean(eg[site[i] == s_] ** 2))) for s_ in sites]
        bs = []
        for _ in range(B):
            pick = rng.choice(sites, size=sites.size, replace=True)
            idx = np.concatenate([np.flatnonzero(site[i] == s_) for s_ in pick])
            bs.append((np.sqrt(np.mean(em[idx] ** 2)) - np.sqrt(np.mean(eg[idx] ** 2))) * 100)
        lo, hi = float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5))
        out.append(dict(top=top, n_sites=int(sites.size), threshold_pp=float(np.abs(m - g)[i].min() * 100),
                        rmse_model_pp=float(np.sqrt(np.mean(em ** 2)) * 100), rmse_proxy_pp=float(np.sqrt(np.mean(eg ** 2)) * 100),
                        stops_model_closer=int(np.sum(np.abs(em) < np.abs(eg))),
                        sites_model_closer=int(sum(a_ < b_ for a_, b_ in per_site)),
                        dRMSE_pp=float((np.sqrt(np.mean(em ** 2)) - np.sqrt(np.mean(eg ** 2))) * 100), ci95_site_bootstrap_pp=[lo, hi],
                        verdict="favours the terrain model" if hi < 0 else "favours the proxy" if lo > 0 else "cannot distinguish"))
    return dict(selection="top-N stops by |terrain model - proxy| (model values only, chosen before comparing with RAD)",
                cluster="Curiosity navigation site (RMC site index)", results=out)


def calibration_slopes(rows, B=4000, seed=41) -> dict:
    """Slope of measured on predicted anomaly (no intercept): 1 = calibrated, >1 = model under-predicts shelter."""
    y = _arr(rows, "y_obs"); rng = np.random.default_rng(seed); out = {}
    for name, key in (("terrain_model", "m_terrain"), ("sky_proxy", "g_proxy")):
        x = _arr(rows, key)
        b = float(np.sum(x * y) / np.sum(x * x))
        bs = []
        for _ in range(B):
            i = _mbb_indices(len(y), 20, rng)
            bs.append(np.sum(x[i] * y[i]) / np.sum(x[i] * x[i]))
        site = np.array([int(r["rmc"].split("_")[0]) for r in rows]); us = np.unique(site); bc = []
        for _ in range(B):
            pick = rng.choice(us, size=us.size, replace=True)
            i = np.concatenate([np.flatnonzero(site == s_) for s_ in pick])
            bc.append(np.sum(x[i] * y[i]) / np.sum(x[i] * x[i]))
        out[name] = dict(slope=b, ci95_block20=[float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5))],
                         ci95_site_cluster=[float(np.percentile(bc, 2.5)), float(np.percentile(bc, 97.5))], n_sites=int(us.size))
    return out


def run() -> dict:
    tab = build_table()
    rows = tab["rows"]
    pred, coefs, b, edges = cross_validate(rows)
    perf, diffs = evaluate(rows, pred)
    # full-sample fits for reporting (NOT used for evaluation)
    full = {m: fit_predict(rows, rows, MODELS[m])[1] for m in ("M1", "M4", "M6")}
    Emean = float(np.mean([r["E_mean"] for r in rows]))
    kappa_rel = full["M1"].get("x_p", np.nan)
    out = dict(
        generated_utc=I._now(), meta=tab["meta"], n_stops=len(rows), window_sols=WINDOW, min_sols=MIN_SOLS,
        k_blocks=K_BLOCKS, block_edges_sol=edges.tolist(),
        performance=perf, mse_differences=diffs,
        cv_coefficients={m: coefs[m] for m in ("M1", "M4", "M5", "M6")},
        full_sample_fits=full,
        pressure_coefficient=dict(fitted_rel_per_pa=kappa_rel, fitted_uGy_d_per_pa=kappa_rel * Emean, mean_E_uGy_d=Emean,
                                  literature=GUO2015_KAPPA),
        correlations=dict(terrain_model=correlation_cis(rows, "y_obs", "m_terrain"),
                          sky_proxy=correlation_cis(rows, "y_obs", "g_proxy"),
                          pressure=correlation_cis(rows, "y_obs", "x_p"),
                          terrain_after_pressure=correlation_cis(
                              [dict(r, y_res=r["y_obs"] - kappa_rel * r["x_p"]) for r in rows], "y_res", "m_terrain")),
        predictor_spread_pp=dict(y_obs=float(np.std(_arr(rows, "y_obs")) * 100), m_terrain=float(np.std(_arr(rows, "m_terrain")) * 100),
                                 g_proxy=float(np.std(_arr(rows, "g_proxy")) * 100),
                                 pressure_term=float(np.std(kappa_rel * _arr(rows, "x_p")) * 100)),
        robustness=robustness(rows),
        disagreement_test=disagreement_test(rows),
        calibration=calibration_slopes(rows),
        spearman_terrain=_spearman(_arr(rows, 'y_obs'), _arr(rows, 'm_terrain')),
        rows=[dict(r, block=int(bb), **{f"pred_{m}": float(pred[m][i]) for m in MODELS}) for i, (r, bb) in enumerate(zip(rows, b))],
    )
    (C.PROC / "terrain_signal.json").write_text(json.dumps(out, indent=1, default=float))
    return out


if __name__ == "__main__":
    o = run()
    print(json.dumps({k: o[k] for k in ("meta", "n_stops", "pressure_coefficient", "predictor_spread_pp")}, indent=1))
    for m, v in o["performance"].items():
        print(m, v)
    for k, v in o["mse_differences"].items():
        print(k, v["L20"])
    for k, v in o["correlations"].items():
        print(k, {kk: (round(vv, 3) if isinstance(vv, float) else vv) for kk, vv in v.items()})

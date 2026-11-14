"""Radiation Break-Even Explorer.



Question: a science task near a target can be done somewhere within a work radius. Is it worth walking

farther to a more sheltered spot? Extra walking costs dose; a lower dose rate while stationary saves dose.



For every candidate stop cell c within the work radius (MODEL quantities, all in uGy of RAD-E-equivalent

absorbed dose, quiet-time GCR):



    W(c) = min walking dose  start -> c -> end      (low-dose objective, same route engine and map)

    r(c) = stationary dose rate at c                (uGy/h = rel_total(c) * D_flat / 24)

    D(c, T) = W(c) + T * r(c)                       (T = dwell time at the stop, hours)



Two options i (less walking) and j (more sheltered) break even at  T* = (W_j - W_i) / (r_i - r_j).

W uses two Dijkstra passes on the low-dose graph (forward from start, reverse from end), so the walking

dose of the best path through *every* cell is exact on the graph.



Credibility layer (what makes a break-even time usable):

* RESOLVABILITY. The rate difference between two options, in points of relative dose rate, is compared with

  the validated error of the same model on measured *differences between nearby positions* (Guo et al. 2026

  parking/background pairs, all eight; audit.json):  >= RMSE -> "resolved";  >= MAE -> "marginal";

  otherwise "unresolved" (no recommendation is made from the model).

* MODEL-ERROR BAND. T* recomputed with the rate difference shrunk/grown by the validated RMSE

  (an unbounded upper end means the shelter advantage could be zero within model error).

* SENSITIVITY. Walking-speed factor (0.4, 0.8 vs 0.6), work radius (x0.5, x2) and stop slope limit

  (10 and 20 vs 15 deg), plus the albedo band (0.18-0.24).

* SITE FLAGS. Stops with slope >= 12 deg, and stops lying below steep (>= 30 deg) terrain that rises >= 5 m

  within 40 m, are flagged. MarsShield does NOT model rockfall, slope stability or footing.



Assumptions: the task can be done anywhere within the radius; stop slope <= 15 deg; stationary rate is the

modeled total at 1.5 m height without suit or vehicle shielding; T* does not depend on phi.

"""

from __future__ import annotations



import json



import numpy as np

from scipy.sparse.csgraph import dijkstra



from . import config as C

from . import planner

from .radiation import ALPHA_DEFAULT, ALPHA_RANGE

from .routing import SUIT_FACTOR



STOP_MAX_SLOPE_DEG = 15.0

DWELL_GRID_H = np.round(np.arange(0.0, 12.0001, 0.25), 2)

STEEP_STOP_DEG = 12.0

CLIFF_SLOPE_DEG, CLIFF_RISE_M, CLIFF_RADIUS_M = 30.0, 5.0, 40.0





def model_error_pp() -> dict:

    """Validated error of the model on measured nearby-position differences (all 8 pairs), in rate points."""

    p = C.PROC / "audit.json"

    if p.exists():

        a = json.loads(p.read_text())["A3_eight_pairs"]["P6_19.4pct_table1"]["pred_albedo_019"]

        return dict(mae_pp=a["mae_pp"], rmse_pp=a["rmse_pp"], n=a["n"], source="audit.json A3 (all 8 Guo et al. 2026 pairs)")

    v = json.loads((C.PROC / "validation.json").read_text())["pair_error_summary"]["pred_albedo_019"]

    return dict(mae_pp=v["mae_pp"], rmse_pp=v["rmse_pp"], n=v["n"], source="validation.json (all 8 pairs)")





def classify(delta_pp: float, err: dict) -> str:

    if delta_pp >= err["rmse_pp"]:

        return "resolved"

    if delta_pp >= err["mae_pp"]:

        return "marginal"

    return "unresolved"





def _fields(rt, start_rc, end_rc):

    M = rt.matrix("low_dose")

    s = start_rc[0] * rt.nx + start_rc[1]

    e = end_rc[0] * rt.nx + end_rc[1]

    d_from = dijkstra(M, directed=True, indices=s)

    d_to = dijkstra(M.T.tocsr(), directed=True, indices=e)

    return d_from + d_to          # hours x relative rate, through each cell





def _candidates(rt, slope, target_rc, radius_m, stop_max_slope=STOP_MAX_SLOPE_DEG):

    r0, c0 = target_rc

    k = int(np.ceil(radius_m / rt.res))

    rr, cc = np.mgrid[max(0, r0 - k):min(rt.ny, r0 + k + 1), max(0, c0 - k):min(rt.nx, c0 + k + 1)]

    d = np.hypot(rr - r0, cc - c0) * rt.res

    m = (d <= radius_m) & (slope[rr, cc] <= stop_max_slope)

    return rr[m], cc[m], d[m]





def _observations():

    p = C.PROC / "observations.json"

    return json.loads(p.read_text())["stops"] if p.exists() else []





def _nearest_obs(stops, x, y, max_m=30.0):

    """MEASURED context: the closest Curiosity stop with RAD data (never used as a model input)."""

    best, bd = None, max_m

    for s in stops:

        d = float(np.hypot(s["x"] - x, s["y"] - y))

        if d <= bd and s.get("E_mean") is not None:

            best, bd = s, d

    if best is None:

        return None

    return dict(distance_m=bd, sol=best["sol"], rmc=best["rmc"], utc_start=best.get("utc_start"), utc_end=best.get("utc_end"),

                E_mean_uGy_d=best["E_mean"], E_sem=best.get("E_sem"), n_obs=best["n_obs"],

                local_anomaly=best.get("anomaly_obs"), data_sols=best.get("data_sols"))





def site_flags(g, r, c) -> list[str]:

    """Terrain flags for a stop cell. Descriptive only: no hazard model is implied."""

    flags = []

    sl = float(g["slope"][r, c])

    if sl >= STEEP_STOP_DEG:

        flags.append(f"Steep stop: local slope {sl:.1f}° (workable-stop limit {STOP_MAX_SLOPE_DEG:.0f}°).")

    k = int(np.ceil(CLIFF_RADIUS_M / g["res"]))

    r0, r1, c0, c1 = max(0, r - k), min(g["z"].shape[0], r + k + 1), max(0, c - k), min(g["z"].shape[1], c + k + 1)

    rr, cc = np.mgrid[r0:r1, c0:c1]

    near = np.hypot(rr - r, cc - c) * g["res"] <= CLIFF_RADIUS_M

    above = near & (g["slope"][r0:r1, c0:c1] >= CLIFF_SLOPE_DEG) & (g["z"][r0:r1, c0:c1] >= g["z"][r, c] + CLIFF_RISE_M)

    if above.any():

        rise = float(np.max(g["z"][r0:r1, c0:c1][above]) - g["z"][r, c])

        flags.append(f"Below steep terrain: slopes of {CLIFF_SLOPE_DEG:.0f}° or more rise up to {rise:.0f} m above this spot "

                     f"within {CLIFF_RADIUS_M:.0f} m. Rockfall and slope stability are not modeled.")

    return flags





def _core(start, end, target, radius_m, phi, alpha, suit, stop_max_slope, T):

    g = planner.grid()

    rt = planner.router(round(alpha, 3), suit)

    srt, ert, trc = rt.to_rc(*start), rt.to_rc(*end), rt.to_rc(*target)

    for rc, name in ((srt, "start"), (ert, "end"), (trc, "target")):

        if not (0 <= rc[0] < rt.ny and 0 <= rc[1] < rt.nx):

            raise ValueError(f"{name} outside walk area")

    D0 = planner.flat_dose_rate(phi, alpha)

    F = _fields(rt, srt, ert)

    rr, cc, dist = _candidates(rt, g["slope"], trc, radius_m, stop_max_slope)

    idx = rr * rt.nx + cc

    ok = np.isfinite(F[idx])

    if not ok.any():

        raise ValueError("no reachable stop location within the work radius")

    rr, cc, dist, idx = rr[ok], cc[ok], dist[ok], idx[ok]

    W = F[idx] * D0 / 24.0

    r = rt.rate[rr, cc] * D0 / 24.0

    best, tot = _envelope(W, r, T)

    a_i, t_i, shel = int(best[0]), int(np.argmin(dist)), int(np.argmin(r))

    return dict(g=g, rt=rt, srt=srt, ert=ert, D0=D0, rr=rr, cc=cc, dist=dist, idx=idx, W=W, r=r, best=best, tot=tot,

                named=[("A", "Least walking", a_i), ("B", "At the science target", t_i), ("C", "Most sheltered in reach", shel)])





def _pair_t(core, k1, k2):

    """Break-even time between named options k1 (less walking) and k2 (more sheltered) within one core run."""

    ids = {k: i for k, _, i in core["named"]}

    i1, i2 = ids[k1], ids[k2]

    dW = core["W"][i2] - core["W"][i1]; dr = core["r"][i1] - core["r"][i2]

    if dr <= 0:

        return None

    return float(max(dW, 0.0) / dr)





def _envelope(W, r, T):

    tot = W[None, :] + T[:, None] * r[None, :]

    return np.argmin(tot, axis=1), tot.min(axis=1)





def explore(start, end, target, radius_m: float = 150.0, phi: float = 500.0, alpha: float = ALPHA_DEFAULT,

            max_dwell_h: float = 12.0, suit: float = SUIT_FACTOR, stop_max_slope: float = STOP_MAX_SLOPE_DEG,

            duration_h: list[float] | None = None, sensitivity: bool = True) -> dict:

    T = DWELL_GRID_H[DWELL_GRID_H <= max_dwell_h + 1e-9]

    k = _core(start, end, target, radius_m, phi, alpha, suit, stop_max_slope, T)

    g, rt, D0, rr, cc, dist, W, r = k["g"], k["rt"], k["D0"], k["rr"], k["cc"], k["dist"], k["W"], k["r"]

    err = model_error_pp()

    obs = _observations()

    options, seen = [], {}

    for key, label, i in k["named"]:

        if i in seen:

            options[seen[i]]["keys"].append(key); options[seen[i]]["labels"].append(label); continue

        seen[i] = len(options)

        x, y = rt.to_xy(rr[i], cc[i])

        legs = [rt.path(k["srt"], (rr[i], cc[i]), "low_dose"), rt.path((rr[i], cc[i]), k["ert"], "low_dose")]

        nodes = np.concatenate([legs[0], legs[1][1:]])

        m = rt.metrics(nodes, D0)

        options.append(dict(

            keys=[key], labels=[label], x=float(x), y=float(y), dist_from_target_m=float(dist[i]),

            slope_deg=float(g["slope"][rr[i], cc[i]]), rel_rate=float(rt.rate[rr[i], cc[i]]), B=float(g["B"][rr[i], cc[i]]),

            walk_dose_uGy=float(W[i]), stop_rate_uGy_h=float(r[i]), distance_m=m["distance_m"], time_h=m["time_h"],

            walk_dose_path_uGy=m["dose_uGy"], xy=m["xy"][::2] + [m["xy"][-1]],

            total_uGy=[float(W[i] + t * r[i]) for t in T], nearest_rad=_nearest_obs(obs, float(x), float(y)),

            flags=site_flags(g, int(rr[i]), int(cc[i]))))

    tot_named = np.array([o["total_uGy"] for o in options])

    pref = np.argmin(tot_named, axis=0)

    for j, o in enumerate(options):

        ts = T[pref == j]

        o["preferred_dwell_h"] = [float(ts.min()), float(ts.max())] if ts.size else None



    # pairwise break-even with resolvability and model-error band

    breaks = []

    for o1 in options:

        for o2 in options:

            dW = o2["walk_dose_uGy"] - o1["walk_dose_uGy"]; dr = o1["stop_rate_uGy_h"] - o2["stop_rate_uGy_h"]

            if not (dW > 0 and dr > 0):

                continue

            delta_pp = (o1["rel_rate"] - o2["rel_rate"]) * 100

            t = float(dW / dr)

            e = err["rmse_pp"]

            lo = t * delta_pp / (delta_pp + e)

            hi = t * delta_pp / (delta_pp - e) if delta_pp > e else None

            breaks.append(dict(less_walking=o1["keys"][0], more_sheltered=o2["keys"][0], t_h=t,

                               extra_walk_dose_uGy=float(dW), rate_saving_uGy_h=float(dr), rate_difference_pp=float(delta_pp),

                               resolvability=classify(delta_pp, err), t_h_model_error_band=[float(lo), hi],

                               extra_distance_m=float(o2["distance_m"] - o1["distance_m"]),

                               extra_time_min=float((o2["time_h"] - o1["time_h"]) * 60)))

    # albedo band (map, routes and D_flat recomputed)

    for bk in breaks:

        band = []

        for a in ALPHA_RANGE:

            rt2 = planner.router(round(a, 3), suit); D0a = planner.flat_dose_rate(phi, a)

            F2 = _fields(rt2, k["srt"], k["ert"])

            cells = {}

            for o in options:

                rc = rt2.to_rc(o["x"], o["y"]); cells[o["keys"][0]] = (F2[rc[0] * rt2.nx + rc[1]] * D0a / 24, rt2.rate[rc] * D0a / 24)

            (w1, r1), (w2, r2) = cells[bk["less_walking"]], cells[bk["more_sheltered"]]

            band.append(float((w2 - w1) / (r1 - r2)) if r1 > r2 else None)

        bk["t_h_alpha_band"] = band



    # sensitivity of the headline switch (least walking -> most sheltered): walking speed, radius, stop slope limit

    sens = []

    if sensitivity:

        cases = [("Walking speed factor 0.4 (slower)", dict(suit=0.4)), ("Walking speed factor 0.8 (faster)", dict(suit=0.8)),

                 (f"Work radius {radius_m * 0.5:.0f} m", dict(radius_m=radius_m * 0.5)), (f"Work radius {radius_m * 2:.0f} m", dict(radius_m=radius_m * 2)),

                 ("Stop slope limit 10°", dict(stop_max_slope=10.0)), ("Stop slope limit 20°", dict(stop_max_slope=20.0))]

        for name, kw in cases:

            args = dict(radius_m=radius_m, suit=suit, stop_max_slope=stop_max_slope); args.update(kw)

            try:

                kk = _core(start, end, target, args["radius_m"], phi, alpha, args["suit"], args["stop_max_slope"], T)

            except ValueError as ex:

                sens.append(dict(case=name, error=str(ex))); continue

            iA = dict((kk2, i) for kk2, _, i in kk["named"])

            xC, yC = kk["rt"].to_xy(kk["rr"][iA["C"]], kk["cc"][iA["C"]])

            dpp = float((kk["rt"].rate[kk["rr"][iA["A"]], kk["cc"][iA["A"]]] - kk["rt"].rate[kk["rr"][iA["C"]], kk["cc"][iA["C"]]]) * 100)

            sens.append(dict(case=name, t_h_A_to_C=_pair_t(kk, "A", "C"), rate_difference_pp=dpp,

                             resolvability=classify(dpp, err), sheltered_spot_moved_m=float(np.hypot(xC - options[-1]["x"], yC - options[-1]["y"]))

                             if options else None))



    # duration-aware recommendation (only from resolved differences)

    rec = None

    if duration_h:

        # Default plan: work at the science target (option B). Any other stop is recommended only if

        # (1) it has the lower modeled dose at the nominal duration AND across the planned duration range, and

        # (2) its stationary-rate difference from B is resolved against validated model error.

        lo, nom, hi = duration_h

        def best_at(t):

            return options[int(np.argmin([o["walk_dose_uGy"] + t * o["stop_rate_uGy_h"] for o in options]))]

        b_lo, b_nom, b_hi = best_at(lo), best_at(nom), best_at(hi)

        tgt = next(o for o in options if "B" in o["keys"])

        name = lambda o: "/".join(o["keys"])

        if b_nom is tgt:

            status, text = "stay", "Working at the science target has the lowest modeled dose at the planned duration."

        else:

            dpp = abs(b_nom["rel_rate"] - tgt["rel_rate"]) * 100

            res = classify(dpp, err)

            gain = (tgt["walk_dose_uGy"] + nom * tgt["stop_rate_uGy_h"]) - (b_nom["walk_dose_uGy"] + nom * b_nom["stop_rate_uGy_h"])

            same = b_lo is b_nom and b_hi is b_nom

            if res == "unresolved":

                status = "unresolved"

                text = (f"Option {name(b_nom)} would save {gain:.2f} µGy at the nominal duration, but its stationary rate differs from the target "

                        f"by only {dpp:.1f} rate points, below the model's validated error ({err['mae_pp']:.1f} pp MAE). "

                        "The model cannot rank them: work at the target and decide on science and safety grounds.")

            else:

                status = "recommended" if (res == "resolved" and same) else "conditional"

                text = (f"Option {name(b_nom)} ({b_nom['labels'][0].lower()}) saves {gain:.2f} µGy against working at the target "

                        f"{'across the whole planned duration range' if same else 'at the nominal duration only'}; the "

                        f"{dpp:.1f}-point rate difference is {res} against model error.")

            rec_res = res

        rec = dict(duration_h=list(duration_h), status=status, text=text, preferred_nominal=b_nom["keys"][0],

                   preferred_low=b_lo["keys"][0], preferred_high=b_hi["keys"][0], baseline="B",

                   resolvability_vs_target=None if b_nom is tgt else rec_res)



    gap = float(np.max(tot_named.min(axis=0) - k["tot"]))

    return dict(start=list(start), end=list(end), target=list(target), radius_m=radius_m, phi=phi, alpha=alpha,

                D_flat_uGy_d=D0, dwell_h=T.tolist(), envelope_uGy=k["tot"].tolist(),

                preferred_named_by_dwell=[options[j]["keys"][0] for j in pref], options=options, breaks=breaks,

                max_gap_named_vs_exact_uGy=gap, n_candidates=int(k["idx"].size), model_error=err,

                sensitivity=sens, recommendation=rec,

                assumptions=dict(stop_max_slope_deg=stop_max_slope, objective="low_dose (time x modeled rate)",

                                 h_obs_m=float(g["h_obs"]), suit_factor=suit, max_slope_deg=float(np.degrees(np.arctan(rt.max_slope))),

                                 phi_independent="break-even times do not depend on phi; absolute doses do",

                                 not_modeled="rockfall, slope stability, footing, suit or vehicle shielding, solar particle events"))


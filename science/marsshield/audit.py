"""Audit of reported results against Guo et al. (2026). Writes data/processed/audit.json.

A1  Table 1 transcription: every numeric cell of published.GUO2026_TABLE1 vs the paper text.
A2  Internal consistency of the paper for P6/BG6 (Maria Gordon Notch): Table 1 / Sec. 3.4 / abstract give
    19.4 % (19 %), while Sec. 4 states "the observed dose drop is 17 %". We report both, and our own
    reduction of NASA RAD L2 data.
A3  Full eight-pair model errors (no subsetting), under both P6 values, with per-pair errors.
"""
from __future__ import annotations

import json
import re

import numpy as np

from . import config as C
from . import published as P

MODELS = {"pred_albedo_019": "Sky + terrain albedo (alpha = 0.19)", "pred_sky_only": "Sky only",
          "pred_proportional": "Proportional to blocked sky (1 - B)"}


def _paper() -> str:
    """Guo et al. (2026) text, extracted by ingest.fetch_papers (downloads the open-access PDF if missing)."""
    from .ingest import fetch_papers
    return fetch_papers()["guo2026"].read_text(encoding="utf-8")


def a1_transcription() -> dict:
    lines = _paper().splitlines()
    start = next(i for i, l in enumerate(lines) if re.match(r"Tower\s*Buttes\s+BG1", l))
    rows = {}
    for ln in lines[start:start + 22]:
        t = ln.split()
        if ln.strip().startswith("290.5"):
            rows["BG45"] = [x for x in t if x != "–"]
            continue
        for i, tok in enumerate(t):
            if re.fullmatch(r"(BG\d|P\d)", tok):
                rows[tok] = [x for x in t[i + 1:] if x != "–"]
                break
    out, bad = {}, 0
    for k, v in P.GUO2026_TABLE1.items():
        paper = [float(x.rstrip("%")) for x in rows[k]]
        mine = [v[3]] + ([v[4] * 100] if v[4] is not None else []) + [v[5], v[6], v[7], v[8]] + \
               ([v[9] * 100] if v[9] is not None else []) + [v[10] * 100, v[11], v[12]]
        ok = len(mine) == len(paper) and all(abs(a - b) < 0.051 for a, b in zip(mine, paper))
        bad += not ok
        out[k] = dict(ok=ok, n_values=len(paper))
    return dict(rows_checked=len(out), mismatches=bad, cells_checked=sum(r["n_values"] for r in out.values()), rows=out)


def a2_p6(val: dict) -> dict:
    t6, t_bg = P.table1("P6"), P.table1("BG6")
    flat = re.sub(r"\s+", "", _paper())
    quote_in_text = "comparingP6andBG6,themodeledtotalskydosedropis24%,whereastheobserveddosedropis17%" in flat
    table_in_text = "P6229.819.4%" in flat
    pair = next(p for p in val["pairs"] if p["pair"].startswith("P6"))
    return dict(
        table1_D_RAD=[t6["D_RAD"], t_bg["D_RAD"]],
        table1_decrease=t6["meas_decrease"],
        table1_ratio_decrease=1 - t6["D_RAD"] / t_bg["D_RAD"],
        section4_text_decrease=0.17,
        verified_in_paper_text=dict(section4_quote=quote_in_text, table1_P6_row=table_in_text),
        section4_quote="For Maria Gordon Notch, comparing P6 and BG6, the modeled total sky dose drop is 24%, whereas the observed dose drop is 17%.",
        other_statements=["Abstract: 'decreases in the dose rate reaching 19%'", "Sec. 3.4: 'we find a dose rate drop of 19% in P6'",
                          "Table 1: P6 measured decrease 19.4%", "Sec. 5: 'the decrease in the dose rate due to surface shielding can reach 19%'"],
        ours_nasa_l2=dict(P6=val["periods"]["P6"]["rad"]["E_mean"], BG6=val["periods"]["BG6"]["rad"]["E_mean"],
                          decrease=-pair["measured_ours"]),
        adopted="19.4 % (Table 1, reproduced from NASA RAD L2: see ours_nasa_l2); 17 % reported as a sensitivity case",
        model_prediction=dict(sky_albedo=-pair["pred_albedo_019"], sky_only=-pair["pred_sky_only"],
                              published_model_sky_decrease=P.table1("P6")["D_sky_decrease"]),
    )


def a3_eight_pairs(val: dict) -> dict:
    pairs = val["pairs"]
    res = {}
    for case, p6 in (("P6_19.4pct_table1", None), ("P6_17pct_section4", -0.17)):
        r = {}
        for k, name in MODELS.items():
            e = np.array([(p[k] - (p6 if (p6 is not None and p["pair"].startswith("P6")) else p["measured_ours"])) * 100 for p in pairs])
            r[k] = dict(name=name, n=int(e.size), mae_pp=float(np.abs(e).mean()), rmse_pp=float(np.sqrt((e ** 2).mean())),
                        bias_pp=float(e.mean()), max_abs_pp=float(np.abs(e).max()), median_abs_pp=float(np.median(np.abs(e))),
                        per_pair_pp={p["pair"]: float(x) for p, x in zip(pairs, e)})
        res[case] = r
    best = [min(MODELS, key=lambda k: abs(p[k] - p["measured_ours"])) for p in pairs]
    res["best_model_count"] = {k: best.count(k) for k in MODELS}
    res["note"] = ("n = 8 parking periods at 5 locations. On all 8, the sky+albedo model has the lowest MAE but not the lowest "
                   "RMSE (the proportional proxy is marginally lower), so it is not demonstrably better than the naive proxy "
                   "on this sample. Its largest errors are P8 (geometry not reproduced) and P6 (albedo assumption).")
    return res


def run() -> dict:
    val = json.loads((C.PROC / "validation.json").read_text())
    out = dict(A1_table1_transcription=a1_transcription(), A2_maria_gordon_notch=a2_p6(val), A3_eight_pairs=a3_eight_pairs(val))
    (C.PROC / "audit.json").write_text(json.dumps(out, indent=1))
    return out


if __name__ == "__main__":
    o = run()
    print(json.dumps({"A1": {k: o["A1_table1_transcription"][k] for k in ("rows_checked", "cells_checked", "mismatches")},
                      "A2": {k: o["A2_maria_gordon_notch"][k] for k in ("table1_ratio_decrease", "section4_text_decrease", "ours_nasa_l2")},
                      "A3": {c: {k: round(v["mae_pp"], 2) for k, v in o["A3_eight_pairs"][c].items()} for c in ("P6_19.4pct_table1", "P6_17pct_section4")}}, indent=1))

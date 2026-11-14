# MarsShield validation results

Generated from `data/processed/*.json` (validation run 2026-11-14T20:57:35+00:00). Regenerate with `python -m marsshield.report`. Nothing in this file is hand-entered.

Legend: **verified** = compared against an independent reference with the error reported; **reproduced** = re-derived a published intermediate value; **not reproduced** = disagreement reported as is.

## V1 Horizon engine on analytic geometries (verified)

| Geometry | Expected | Computed | Max abs. error |
|---|---|---|---|
| flat sphere, h=1 m | -0.04397° | -0.04397° | 8.14e-09° |
| straight wall 20 m high, 100 m north | 10.75797° | 10.75534° | 2.63e-03° |
| cylindrical pit r=200 m, depth 50 m | 13.76630° | 13.70294° | 1.19e-01° |
| plane rising 30 deg to the east (h=0) | 21.81146° | 21.81146° | 2.75e-06° |

Cylindrical pit blocked solid angle: expected 0.2380, exact-from-horizon 0.2369, 1° zenith rings 0.2401. The 0.12° pit error is bilinear smoothing of the vertical rim on a 1 m grid.

## V2 Reproduction of Guo et al. (2021) Zenodo products (reproduced)

* Butte M12 horizon mask -> per-zenith sky-view ratio: max abs. difference 0.0056 (= 2 one-degree azimuth bins).
* Per-zenith dose (Fig4b 'during parking'): max abs. difference H 4.4e-16, He 1.1e-16 µGy/d after applying the factor 0.5 between the Zenodo Fig1 tables and the papers' per-degree integrals (see METHODS.md).
* Full-sky dose at φ = 384.5 MV (Guo et al. 2026 §4): H 196.93 vs published 196.04; He 36.40 vs 36.32 µGy/d (φ below the 400 MV table edge is linearly extrapolated).
* Mask blocked solid angle 0.1857 (exact) / 0.1928 (1° rings) vs Ehresmann et al. (2021) '19 %'.

## V3 DEM horizon at Butte M12 vs. the RAD-team mask (verified)

Curiosity waypoint 57_2798 (sol 1455), 1 m above ground, 360 azimuths: RMSE 0.91°, bias -0.02°, MAE 0.49°, 95th percentile |error| 1.67°, max 6.70°. Blocked solid angle: DEM 0.1851, mask 0.1857.

## V4/V5 Fifteen RAD periods of Guo et al. (2026) Table 1

Positions: NASA/JPL MMGIS waypoints occupied during each sol window (time-weighted). RAD: our own reduction of NASA RAD L2 CDFs (detector E, FLAGGED_DATA removed). φ per period: Guo et al. (2026) Table 1 (derived there from TGO Liulin-MO).

| Period | Site | Blocked sky (ours) | Published ROS | D_sky ours | D_sky pub | RAD E ours (µGy/d) | RAD E pub | n obs |
|---|---|---|---|---|---|---|---|---|
| BG1 | Tower Buttes | 0.087 | 0.079 | 237.8 | 238.3 | 314.7 ± 0.2 | 313.9 | 1164 |
| P1 | Tower Buttes | 0.149 | 0.137 | 221.3 | 222.8 | 302.1 ± 0.1 | 301.3 | 2270 |
| BG2 | Tower Buttes | 0.062 | 0.054 | 243.7 | 244.2 | 324.3 ± 0.1 | 323.5 | 2274 |
| P2 | Tower Buttes | 0.155 | 0.148 | 218.7 | 219.0 | 301.5 ± 0.2 | 300.5 | 682 |
| BG3 | Bloodstone Hill | 0.080 | 0.072 | 239.6 | 240.1 | 319.4 ± 0.3 | 318.5 | 421 |
| P3 | Bloodstone Hill | 0.134 | 0.127 | 224.3 | 224.5 | 298.7 ± 0.3 | 297.8 | 250 |
| BG45 | Mt Mercou | 0.128 | 0.118 | 221.6 | 222.7 | 291.2 ± 0.1 | 290.5 | 1597 |
| P4 | Mt Mercou | 0.152 | 0.144 | 212.7 | 213.3 | 279.8 ± 0.4 | 279.3 | 162 |
| P5 | Mt Mercou | 0.121 | 0.114 | 219.0 | 218.9 | 285.1 ± 0.3 | 284.4 | 253 |
| BG6 | Maria Gordon Notch | 0.185 | 0.180 | 203.4 | 202.5 | 285.5 ± 0.4 | 285.1 | 249 |
| P6 | Maria Gordon Notch | 0.332 | 0.379 | 167.1 | 153.7 | 230.1 ± 0.4 | 229.8 | 163 |
| BG7 | Paraitepuy | 0.231 | 0.221 | 145.7 | 146.2 | 217.4 ± 0.4 | 215.5 | 168 |
| P7 | Paraitepuy | 0.333 | 0.328 | 125.6 | 124.9 | 197.5 ± 0.4 | 190.4 | 80 |
| BG8 | Paraitepuy | 0.184 | 0.178 | 161.8 | 161.7 | 224.8 ± 0.2 | 224.3 | 417 |
| P8 | Paraitepuy | 0.372 | 0.296 | 112.3 | 126.0 | 202.4 ± 0.3 | 202.0 | 249 |

* Blocked sky, ours − published: mean +0.87 pp, MAE 1.50 pp, max 7.64 pp.
* Modeled sky dose vs published: MAE 1.55 % (all 15), 0.28 % excluding P6/P8; max 10.9 %.
* **Not reproduced:** P6 blocked sky 0.332 vs 0.379; P8 0.372 vs 0.296. Both are narrow-canyon stops where a 3 m position error gives σ = 4.3 pp (P6) and 3.9 pp (P8). Positions were not tuned.
* RAD E period means vs published D_RAD: median +0.24 %, max |diff| 3.7 % (P7, a one-sol window).

## V6 Predicted vs measured dose-rate change, all 8 parking periods (P1–P8 at 5 locations)

Albedo share α = 0.19 from Guo et al. (2021), derived at Murray Buttes only, i.e. independent of these eight periods. All eight periods are the primary result; the six-period figure (excluding P6/P8) is secondary.

| Pair | Site | Measured (ours) | Proportional (1−B) | Sky only | Sky + albedo α=0.19 | α=0.18–0.24 |
|---|---|---|---|---|---|---|
| P1/BG1 | Tower Buttes | -4.0 % | -6.8 % | -7.0 % | -4.2 % | -4.3 % … -3.5 % |
| P2/BG2 | Tower Buttes | -7.0 % | -9.9 % | -10.2 % | -6.3 % | -6.5 % … -5.3 % |
| P3/BG3 | Bloodstone Hill | -6.5 % | -5.9 % | -6.4 % | -3.9 % | -4.0 % … -3.3 % |
| P4/BG45 | Mt Mercou | -3.9 % | -2.8 % | -4.1 % | -2.9 % | -2.9 % … -2.6 % |
| P5/BG45 | Mt Mercou | -2.1 % | +0.8 % | -1.2 % | -1.5 % | -1.5 % … -1.6 % |
| P6/BG6 | Maria Gordon Notch | -19.4 % | -18.1 % | -17.8 % | -9.8 % | -10.2 % … -7.9 % |
| P7/BG7 | Paraitepuy | -9.2 % | -13.3 % | -13.8 % | -7.7 % | -8.0 % … -6.3 % |
| P8/BG8 | Paraitepuy | -10.0 % | -23.1 % | -30.6 % | -20.8 % | -21.2 % … -18.4 % |

| Model | MAE all 8 (pp) | RMSE all 8 (pp) | bias (pp) | max (pp) | secondary: MAE 6 excl. P6/P8 (pp) |
|---|---|---|---|---|---|
| Sky + terrain albedo | 3.37 | 5.24 | +0.63 | 10.78 | 1.10 |
| Sky only | 4.26 | 7.66 | -3.62 | 20.62 | 1.99 |
| Proportional to blocked sky | 3.61 | 5.20 | -2.12 | 13.08 | 2.41 |

On all eight periods the sky + albedo model has the lowest MAE but not the lowest RMSE: with n = 8 it is not demonstrably better than the proportional proxy.

At P6 the sky+albedo model under-predicts the measured −19 % (it predicts about −10 %); Guo et al. (2026) report the same breakdown of the albedo assumption in this self-shielded notch.

## V7 All rover stops in the walk area (independent of the published site selection)

324 stops with ≥ 1.0 sol of RAD data. Observed and modeled local anomalies (stop vs. ±15-sol neighbourhood): Pearson r = 0.357 (bootstrap 95 % CI 0.19–0.71), slope 1.09, RMSE 4.43 pp. Observed anomaly std 4.73 pp vs modeled 1.55 pp: terrain explains a real but minor share of stop-to-stop variability at short stops.

## Sensitivity of blocked sky (15 RAD periods; reference = 1 m DEM, 20 km, 1 m height)

| Change | mean ΔB (pp) | max |ΔB| (pp) |
|---|---|---|
| near-field DEM 2 m (block mean) | -0.25 | 0.91 |
| near-field DEM 4 m (block mean) | -1.01 | 4.31 |
| near-field DEM 8 m (block mean) | -2.33 | 10.37 |
| near-field DEM 16 m (block mean) | -4.41 | 16.81 |
| near-field DEM 32 m (block mean) | -6.79 | 23.30 |
| horizon radius 0.5 km | -0.98 | 2.22 |
| horizon radius 1 km | -0.69 | 1.65 |
| horizon radius 2 km | -0.52 | 1.24 |
| horizon radius 5 km | -0.44 | 1.05 |
| horizon radius 10 km | -0.17 | 0.38 |
| horizon radius 20 km | +0.00 | 0.00 |
| horizon radius 40 km | +1.19 | 2.01 |
| observer height 0.5 m | +1.05 | 2.65 |
| observer height 1.0 m | +0.00 | 0.00 |
| observer height 1.5 m | -0.89 | 2.23 |
| observer height 2.0 m | -1.75 | 4.41 |

Model parameters (φ 380–800 MV × α 0.18–0.24 × heavy-ion factor 1.08–1.12) at the P6 geometry: total relative dose ×0.768 … ×0.829.

## Route engine vs. shortest-distance baseline

150 random start/destination pairs ≥ 600 m apart in the 3.5 × 3 km walk area (5 m grid, 16-connected).

| Strategy | distance (median) | time (median) | dose (median) | dose p10 … p90 | pairs with lower dose than baseline |
|---|---|---|---|---|---|
| fastest | +2.9 % | -3.4 % | -3.5 % | -13.2 … -0.2 % | 95 % |
| low_dose | +2.9 % | -3.3 % | -3.6 % | -13.2 … -0.2 % | 98 % |
| shelter | +15.4 % | +29.7 % | +24.8 % | +1.9 … +61.0 % | 2 % |
| gentle | +21.8 % | +3.9 % | +4.0 % | -5.5 … +20.8 % | 27 % |

Low-dose vs fastest: median -0.07 %, best -3.5 %: nearly all of the dose saving over the baseline comes from walking time, not from terrain shielding.
Grid metrication on near-flat straight corridors: median excess length 1.33 % (max 2.75 %, n = 22).
Routing map (72 azimuths, 5 m) vs 720-azimuth profiles at 176 stops: blocked-sky MAE 0.038 pp, relative dose MAE 0.024 pp (max 0.111 pp).

## Audit against Guo et al. (2026)

* Table 1 transcription: 136 numeric cells in 15 rows compared with the paper text, 0 mismatches.
* Maria Gordon Notch P6/BG6: the paper is internally inconsistent. Table 1 gives D_RAD 229.8 vs 285.1 µGy/d (19.4 %), as do Sec. 3.4, the abstract and Sec. 5 (19 %). Sec. 4 states: "For Maria Gordon Notch, comparing P6 and BG6, the modeled total sky dose drop is 24%, whereas the observed dose drop is 17%." Our NASA RAD L2 reduction gives 230.1 vs 285.5 µGy/d = 19.4 %. Adopted: 19.4 %; 17 % is reported as a sensitivity case.
* Full eight-period errors under both P6 values:

| P6 measured value | Model | MAE (pp) | RMSE (pp) | bias (pp) | max (pp) |
|---|---|---|---|---|---|
| 19.4 % (Table 1, NASA L2) | Sky + terrain albedo (alpha = 0.19) | 3.37 | 5.24 | +0.63 | 10.78 |
| 19.4 % (Table 1, NASA L2) | Sky only | 4.26 | 7.66 | -3.62 | 20.62 |
| 19.4 % (Table 1, NASA L2) | Proportional to blocked sky (1 - B) | 3.61 | 5.20 | -2.12 | 13.08 |
| 17 % (Sec. 4 text) | Sky + terrain albedo (alpha = 0.19) | 3.07 | 4.73 | +0.33 | 10.78 |
| 17 % (Sec. 4 text) | Sky only | 4.17 | 7.64 | -3.92 | 20.62 |
| 17 % (Sec. 4 text) | Proportional to blocked sky (1 - B) | 3.58 | 5.19 | -2.41 | 13.08 |

Best model per period (closest prediction): {'pred_albedo_019': 5, 'pred_sky_only': 2, 'pred_proportional': 1}. n = 8 parking periods at 5 locations. On all 8, the sky+albedo model has the lowest MAE but not the lowest RMSE (the proportional proxy is marginally lower), so it is not demonstrably better than the naive proxy on this sample. Its largest errors are P8 (geometry not reproduced) and P6 (albedo assumption).

## Radiation break-even explorer (modeled)

Walk Tower Buttes to Paraitepuy, work radius 150 m, φ = 500 MV, α = 0.21. Options: A least walking, B at the science target, C most sheltered in reach. Break-even = extra walking dose / stationary rate saved.

Resolvability: a switch is **resolved** when its stationary-rate gap exceeds the model's validated RMSE on nearby-position differences (5.24 pp, all 8 measured parking periods), **marginal** above the MAE (3.37 pp), and **unresolved** below it. Unresolved break-even times are not recommendations. The model-error band recomputes the break-even with the rate gap shifted by ±RMSE (no upper bound means the shelter advantage may be zero).

| Target | Switch | extra walk | extra walking dose (µGy) | rate gap (pp) | status | break-even | within model error | α 0.18 … 0.24 |
|---|---|---|---|---|---|---|---|---|
| Maria Gordon Notch | A to B | 70 m | 0.243 | 7.8 | resolved | 0.27 h | 0.16 h … 0.83 h | 0.24 h … 0.31 h |
| Maria Gordon Notch | A to C | 150 m | 0.524 | 12.8 | resolved | 0.36 h | 0.25 h … 0.60 h | 0.31 h … 0.41 h |
| Maria Gordon Notch | B to C | 80 m | 0.281 | 5.1 | marginal | 0.49 h | 0.24 h … unbounded | 0.42 h … 0.57 h |
| Mt Mercou | A to B | 278 m | 0.950 | 0.7 | unresolved | 12.51 h | 1.41 h … unbounded | 11.44 h … 13.78 h |
| Mt Mercou | A to C | 286 m | 0.977 | 1.2 | unresolved | 6.94 h | 1.32 h … unbounded | 6.31 h … 7.69 h |
| Mt Mercou | B to C | 7 m | 0.027 | 0.6 | unresolved | 0.42 h | 0.04 h … unbounded | 0.38 h … 0.47 h |

Sensitivity of the least-walking to most-sheltered switch:

| Target | changed assumption | break-even | rate gap (pp) | status |
|---|---|---|---|---|
| Maria Gordon Notch | Walking speed factor 0.4 (slower) | 0.54 h | 12.8 | resolved |
| Maria Gordon Notch | Walking speed factor 0.8 (faster) | 0.27 h | 12.8 | resolved |
| Maria Gordon Notch | Work radius 75 m | 0.13 h | 8.1 | resolved |
| Maria Gordon Notch | Work radius 300 m | 0.49 h | 9.3 | resolved |
| Maria Gordon Notch | Stop slope limit 10° | 0.41 h | 10.9 | resolved |
| Maria Gordon Notch | Stop slope limit 20° | 0.32 h | 13.7 | resolved |
| Mt Mercou | Walking speed factor 0.4 (slower) | 10.41 h | 1.2 | unresolved |
| Mt Mercou | Walking speed factor 0.8 (faster) | 5.21 h | 1.2 | unresolved |
| Mt Mercou | Work radius 75 m | 3.05 h | 1.5 | unresolved |
| Mt Mercou | Work radius 300 m | 3.64 h | 5.8 | resolved |
| Mt Mercou | Stop slope limit 10° | 14.57 h | 0.9 | unresolved |
| Mt Mercou | Stop slope limit 20° | 3.47 h | 2.3 | unresolved |

* Maria Gordon Notch: the three named options are within 0.138 µGy of the exact optimum over 2060 candidate stop cells.
  * Option B flag: Below steep terrain: slopes of 30° or more rise up to 9 m above this spot within 40 m. Rockfall and slope stability are not modeled.
  * Option C flag: Steep stop: local slope 14.9° (workable-stop limit 15°).
  * Option C flag: Below steep terrain: slopes of 30° or more rise up to 20 m above this spot within 40 m. Rockfall and slope stability are not modeled.
* Mt Mercou: the three named options are within 0.015 µGy of the exact optimum over 2741 candidate stop cells.
* Checks (tests/test_science.py): forward + reverse Dijkstra walking dose equals the dose integrated along the reconstructed path; option lines cross exactly at the reported break-even times; break-even times are independent of φ; Mt Mercou is unresolved and the notch is resolved with its rockfall flag present.

## Example science Marswalk (modeled)

Targets nontron, mgn, canaima (positions from NASA waypoints at the documented sols). Distance 2183 m, walking 1.01 h, planned stationary work 7.0 h (planning assumptions). Modeled dose 82.6 µGy (10.5 walking, 72.1 stationary); the same hours on open flat ground: 91.4 µGy. Stop-location choices change the total by 0.00 µGy against working at each target.

* Stop mgn: decision **unresolved**. Option C would save 0.30 µGy at the nominal duration, but its stationary rate differs from the target by only 0.9 rate points, below the model's validated error (3.4 pp MAE). The model cannot rank them: work at the target and decide on science and safety grounds.

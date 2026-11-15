# MarsShield science audit (Phase 1, November 2026)

This file responds to four independent AI-simulated reviews (not human participants). Every change to a displayed result keeps its earlier value here. No source data and no validated calculation was altered: the reference results in `data/processed/terrain_signal.json` are bit-identical to the previous version, and only new fields were added. Generated tables are in `docs/VALIDATION.md`, sections V8–V10.

## 1. Corrections with before and after values

| # | Item | Before | After | Type |
|---|---|---|---|---|
| 1 | Mission evidence, parking text | Every site with a parking pair: "deep inside against the notch mouth … the comparison in the opening story" | Site-specific positions, separation, dates, modeled sky blocked and solar-modulation share. Only P6 at Maria Gordon Notch links to the story. Example: Hutton P1/BG1 are 133 m and 22 days apart, not "consecutive days" | Confirmed defect |
| 2 | Notch target text | "RAD recorded 19.4 % lower here (P6)" at waypoint 92_0 | At P6 (stop 92_84, 1.6 m from the waypoint) against BG6, 16 m away | Confirmed defect |
| 3 | Story, model claim | "The published physical model … predicts 9.8 %"; "twice the predicted drop" | 9.8 % on MarsShield's reconstructed geometry; 13.3 % with the published geometry (reproduced, §4). Measured 19.4 % is about 2× and 1.5× those | Scientific concern, reproduced |
| 4 | Story, independence caveat | Albedo "derived from Curiosity's parking measurements, including this notch" | The story's 19 % is Guo et al. (2021), Murray Buttes. The 18–24 % range used by the map and the 322-stop test (21 %) was derived from the parking periods. The story is retrospective because the geometry was reconstructed afterwards | Inaccurate statement |
| 5 | Stop anomaly units | 100 × log ratio labelled "%": notch stops −17 / −21; event stop +48.8; five-stop mean −9.5 | Actual change 100 × (eʸ − 1): −15.9 / −19.3; +62.9; −8.7. Errors in percentage points; RMSE stays on the log scale and is labelled | Confirmed defect |
| 6 | Result sentence | "11.7 % closer to the measurements" | "11.7 % smaller typical error (RMSE of the log anomaly)", with an explicit "not percentage points of radiation" | Wording |
| 7 | Effective sample size | "effective n ≈ 294 of 322" | Removed. The formula applies to correlations, not the tested error difference, and ignores site clustering. Uncertainty is stated by resampling 35 sites | Confirmed defect |
| 8 | Pre-specification | "kept, as pre-specified" | "a choice made before this check; the analysis was not pre-registered" | Inconsistency |
| 9 | Held-out wording | "scored on 8 blocks it was not fitted to" for a model with no fitted parameters | States that the blocks matter only for models with fitted coefficients | Wording |
| 10 | Solar particle events | Only Sep 2017 named; data called quiet-time | Two events located in time-resolved RAD records; screened results added as sensitivity analyses (§2) | Scientific concern |
| 11 | Export `mid_sol` | "Midpoint of the RAD records" | Midpoint of the occupancy window (arrival to departure sol) | Confirmed defect |
| 12 | README wording for a worse model | "(-4.11 % lower RMSE)" | "4.11 % higher RMSE" | Confirmed defect |
| 13 | Export completeness | No background quantities; no source manifest | `mean_log_dose_stop`, `median_log_dose_background`, `background_records`; `input_manifest.json` (1,839 RAD files with SHA-256 and SPDF URL, 2,176 REMS sols, DEMs, waypoints, parameters). The manifest hash was checked against the live NASA file | Gap |
| 14 | Model names in exports | IDs only (M3, M0) | `model_name` and `baseline_name` columns; names in the README | Gap |
| 15 | Mission "Curiosity measured 239" | No source stop or sol | Labelled with the sol | Clarity |

**Not changed:** the 322-stop reference result (RMSE 3.95 → 3.49, −11.7 %; MSE −22.0 %), the parking-period values, the opening story's central measured value (−19.4 %) and the Mission engine.

## 2. Solar particle events (`science/marsshield/sep_events.py`)

**Rule.** The event window is where the smoothed RAD detector-E dose rate (17-minute records, 5-record running median) exceeds the median of the 5 quiet days before by 10 %. Thresholds of 5 % and 20 % are tested, plus a Forbush-decrease variant. Records are removed individually, not whole stops.

| Event | Window (10 %) | Peak / quiet | Notes |
|---|---|---|---|
| Sep 2017 (GLE72) | 2017-09-10 21:14 → 09-13 04:02 UTC (55 h) | 2.24 | Forbush decrease to 0.84, recovered about 25 Sep |
| Oct 2021 (GLE73) | 2021-10-28 17:00 → 10-29 17:11 UTC (24 h) | 2.29 | Milder Forbush decrease (0.93) |
| Feb 2022 | not in this dataset | — | No study-area stop within ±15 sols |

| Sample | Stops | RMSE time only → terrain | RMSE / MSE reduction | Site 95 % ΔMSE (pp²) |
|---|---|---|---|---|
| **Historical full sample (reference)** | 322 | 3.949 → 3.487 | 11.7 % / 22.0 % | −8.42 to −0.93 |
| Without Sep 2017 | 321 | 2.869 → 2.224 | 22.5 % / 39.9 % | −8.24 to −0.78 |
| Without Oct 2021 | 322 | 3.815 → 3.330 | 12.7 % / 23.8 % | −8.45 to −0.95 |
| Without both | 321 | 2.679 → 1.968 | 26.6 % / 46.1 % | −8.30 to −0.80 |
| Both, 20 % threshold | 322 | 2.788 → 2.103 | 24.6 % / 43.1 % | −8.33 to −0.86 |
| Both, plus Forbush windows | 318 | 2.608 → 1.852 | 29.0 % / 49.6 % | −8.42 to −0.86 |

**Interpretation:**
- The absolute gain is essentially unchanged across samples. The relative figure rises because the events inflate every model's error.
- The terrain model and the blocked-sky rule stay indistinguishable in every variant.
- The site-92 concentration (about 60 %) persists.
- The headline remains the historical full sample.
- Screening does not establish that the remaining records are free of all solar-particle effects.

## 3. Units

| Quantity | Definition | Where shown |
|---|---|---|
| Log anomaly y | ln(stop dose) − ln(background) | All statistics; CSV `*_log` |
| Actual percent | 100 × (eʸ − 1) | Every per-stop value in the app; CSV `*_pct` |
| Percentage points | Difference of two actual percentages | Table "Error" columns |
| RMSE "pp" | RMSE of y × 100 (log scale) | Results; close to percentage points at these sizes |
| Relative improvement | 1 − RMSE(model) / RMSE(baseline) | "11.7 % smaller typical error", never "11.7 percentage points" |

**Albedo settings:**

| Use | Value | Source |
|---|---|---|
| Story and parking experiment | 0.19 | Guo et al. (2021), Murray Buttes; outside the 8 periods |
| Map, Mission and 322-stop test | 0.21 | Midpoint of Guo et al. (2026)'s 18–24 %, derived from P1–P8 and backgrounds |
| Sensitivity | 0.18–0.24 | Explored in VALIDATION |

**Intervals:** the browser recomputes bootstraps with mulberry32 and Python uses NumPy, so endpoints differ by Monte Carlo error (e.g. −8.25 against −8.42). This is now stated in Evidence.

## 4. Maria Gordon Notch geometry (`science/marsshield/parking_audit.py`)

**Blocked sky at P6.** MarsShield gives 0.332; the published analysis gives 0.379. The P6 sky dose is 167.1 against 153.7 µGy/day. At BG6 the two agree (0.185 against 0.180).

| Factor | Effect on P6 blocked sky |
|---|---|
| Rover position, 1 m (1σ), 5–95 % | 0.307–0.384 (includes 0.379) |
| Rover position, 3 m (1σ), 5–95 % | 0.249–0.386 |
| RAD height 0.5 / 1.0 / 1.5 / 2.0 m | 0.358 / 0.332 / 0.310 / 0.288 |
| Near-field DEM 1 / 2 / 4 / 8 m | 0.332 / 0.323 / 0.297 / 0.228 |

**Explanation.** A coarser DEM fills in the notch, so the 1 m DEM likely still under-counts blocking. Combined with metre-level position uncertainty, that plausibly explains the gap. The published value comes from rover panoramas; it is a plausible explanation, not a proof.

| P6 prediction, same formula | Physical | Sky only | Rule |
|---|---|---|---|
| MarsShield geometry, α = 0.19 | **−9.77 %** | −17.83 % | −18.06 % |
| Published geometry, α = 0.19 | **−13.33 %** (reviewer's value, reproduced) | −24.10 % | −24.27 % |
| Measured (MarsShield / published) | **−19.39 % / −19.40 %** | | |

The model under-predicts the notch with either geometry, by a factor of about 2 or about 1.5. Neither is a blind prediction.

## 5. Parking comparisons

Full table in VALIDATION V10.

**Rankings change with the inputs:**
- **Raw:** the rule has the lowest RMSE with MarsShield inputs (5.20 against 5.24) and with all-published inputs (2.93 against 3.37).
- **Like for like:** the physical model includes solar modulation; the rule does not. Giving the rule the same flat-ground modulation factor, the physical model has the lower RMSE in all four input combinations.
- **No decision either way:** exhaustive site resampling (5 sites, 126 distinct values) never excludes zero, so the models cannot be ranked.

**Modulation:**
- **P5:** modulation alone gives −2.04 % of the measured −2.10 %.
- **P8:** −6.59 % of −9.98 %.
- **P6:** +1.55 %, so the terrain effect there is slightly larger than measured.

**P7:** MarsShield measures 197.5 µGy/day against the published 190.4. No half-sol nearby averages below 194, and including flagged records gives 195.8. **Unresolved** without the authors' time selection.

## 6. Solar particle event modelling

See [SPE_FEASIBILITY.md](SPE_FEASIBILITY.md). No SPE model is implemented: Level A (observed series and screening) only.

## 7. Unresolved

- The cause of the P7 discrepancy.
- Exact reconciliation of the P6 geometry. The Guo et al. (2026) panoramic method was not reproduced; the paper's full text was read from the open DLR copy for Table 1 and equation 5 only.
- Whether Feb 2022 or smaller events affect stops outside this study area (not relevant here).
- Real-device timing and human usability testing (`docs/USABILITY_TEST.md` not yet run).

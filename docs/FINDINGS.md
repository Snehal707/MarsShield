# MarsShield: scientific findings and limitations

NASA Space Apps Challenge 2026, *Interplanetary Survival Guide: Martian Map*.
Study area: Gale Crater, from Glen Torridon to the Paraitepuy canyon.

Numbers below come from `docs/VALIDATION.md`, which is generated from the result files, and from `data/processed/*.json`.

Each statement carries one of these labels:
- **[Measured]:** from NASA mission data.
- **[Modeled]:** from the re-implemented published dose model or the route engine.
- **[Assumption]:** a planning choice made by MarsShield.

## Mission datasets integrated

| Mission and instrument | Product | Role |
|---|---|---|
| MSL Curiosity RAD (NASA) | Level 2 dosimetry, detector E, NASA SPDF (1,839 daily files) | Measured dose rates at 322 rover stops and 15 published periods; tests every model claim |
| MSL Curiosity REMS (NASA/CAB) | MODRDR surface pressure, PDS (about 2 170 sols, 180 samples per sol) | Pressure control for the 322-stop analysis |
| MSL Curiosity navigation (NASA/JPL) | Localised waypoints (MMGIS) | Where RAD was; where each science target lies |
| MRO HiRISE and CTX (NASA) | Stereo DEMs inside the USGS Gale merged 1 m DEM | Terrain, slopes, horizons, 3D view |
| MRO HiRISE (NASA) | USGS Gale merged orthophoto mosaic, 25 cm, averaged to 1 m | Orbital image layer |
| Mars Express HRSC (ESA) and MGS MOLA (NASA) | DEM gap fill and control; 200 m blended DEM | Far-field horizon (crater rim, Mount Sharp) |
| MSL science team publications | Bennett et al. 2023; NASA MSL blogs; NASA/JPL release | Objectives, what to look for and Curiosity results at nine stops |
| TGO Liulin-MO (ESA/Roscosmos), via Guo et al. 2026 | Published solar modulation φ per RAD period (not ingested) | Model input for the 15 validation periods only |
| Guo et al. 2021 GEANT4 zenith-angle model | Zenodo 10.5281/zenodo.4701689 | Downward dose by sky direction |

## Three regions (added November 2026)

MarsShield now compares Gale, Jezero and the Olympus Mons caldera using published AtRIS/Geant4 surface tables (Zhang et al. 2022) at Mars Climate Database pressures. Full details are in [REGIONAL_RADIATION.md](REGIONAL_RADIATION.md).

- **Olympus Mons [Modeled]:**
  - Effective dose about 4 % lower than Gale at 700 MV, about 7 % lower at 1000 MV, and no difference at 400 MV.
  - Dose equivalent about 5.5 % lower at 580 MV.
  - Water absorbed dose essentially unchanged.
- **Jezero [Modeled]:** within the roughly 1 % point-to-point scatter of the published tables, so the model gives no meaningful difference from Gale. That scatter is an empirical indicator, not a verified uncertainty interval.
- **Pressure [Measured at Jezero only]:**
  - Gale 851 Pa, Jezero 723 Pa (MEDA agrees to 0.5 %), Olympus Mons caldera 103–110 Pa (model only).
- **Limitation:**
  - The model's dose responds to pressure about 50× less than Curiosity's RAD plastic detector does over the day at Gale.
  - The detector materials and observing conditions differ, so this is not a like-for-like validation test, but it leaves the regional differences uncertain.
  - Nothing outside Gale is validated, and these values are not astronaut risk assessments.

## Findings

**1. Martian terrain measurably lowers the cosmic-ray dose rate, by up to about a fifth. [Measured]**
- At eight parking periods beside buttes, hills and cliffs (P1–P8, at five locations), Curiosity's RAD dose rate fell by 2.1–19.4 % against nearby background periods. These raw changes include differences in solar modulation between periods: at P5 modulation alone accounts for −2.0 of the −2.1 %, and at P8 for −6.6 of −10.0 % (docs/VALIDATION.md, V10).
- Our reduction of the raw NASA RAD L2 files agrees with Guo et al. (2026) Table 1 to a median of +0.24 %. 13 of 15 periods lie within +0.13 to +0.32 %; BG7 differs by +0.9 % and P7 (one sol) by +3.7 %.

**2. We reproduce the terrain geometry behind those measurements, with two exceptions. [Measured terrain, our computation]**
- Ray tracing on the USGS 1 m DEM matches the RAD team's Butte M12 horizon mask with 0.91° RMSE.
- It reproduces published sky blocking at 13 of 15 periods (mean absolute difference 1.5 pp over all 15).
- It does **not** reproduce P6 (33.2 % vs 37.9 %) or P8 (37.2 % vs 29.6 %). These are narrow-canyon stops where a 3 m position error alone gives ±4.3 and ±3.9 pp.

**3. Blocking sky is not blocking dose, and with eight periods the physical model is not proven better than a naive proxy. [Modeled vs Measured]**

Against **all eight** measured drops:

| Model | MAE | RMSE |
|---|---|---|
| Sky + terrain albedo | 3.37 pp | 5.24 pp |
| Proportional to blocked sky | 3.61 pp | 5.20 pp |
| Sky only | 4.26 pp | 7.66 pp |

- The physical model is closest at 5 of 8 periods, but it does not have the lowest RMSE.
- Its largest misses are P8 (−10.8 pp: geometry over-counts blocking) and P6 (+9.6 pp: RAD measured −19.4 %; with MarsShield's reconstructed geometry the model predicts −9.8 %, with the published geometry −13.3 %; V10).

**4. For a walking astronaut, time outside sets the dose. [Modeled]**
- Over 150 random walks, the lowest-dose route matches the fastest route to within a median of 0.07 %.
- Routes that hug cliffs for shade raise dose by a median of +24.8 % and beat the shortest route in only 2 % of cases.
- This follows from the size of the effects: modeled rates differ by a few points along a route, while route times differ by tens of percent.

**5. Where you stop can matter, but only where the model can resolve it. [Modeled]**

A break-even time is reported as usable only when the stationary-rate gap between two stop options exceeds the model's validated error on nearby-position differences (RMSE 5.24 pp, all eight periods).
- **Maria Gordon Notch, 150 m work radius: resolved.**
  - The most sheltered spot is 12.8 rate points below the least-walking spot.
  - Walking the extra 150 m costs 0.52 µGy and is repaid after **0.36 h** of work: 0.25–0.60 h within model error, 0.31–0.41 h across the albedo range.
  - Under the walking-speed, radius and slope-limit sensitivities it stays between 0.13 and 0.54 h, and remains resolved.
  - Observations support a strong shelter effect here: RAD measured −19.4 % in the notch.
  - **But** that spot is on a 14.9° slope with terrain rising 20 m above it within 40 m. MarsShield does not model rockfall and makes no safety claim.
- **Mt Mercou, 150 m work radius: unresolved.**
  - The same comparison differs by only 1.2 rate points, below the model's mean error (3.37 pp).
  - The earlier "6.9 h" figure is therefore not a recommendation; within model error the break-even ranges from 1.3 h to unbounded.
  - It becomes resolved only if the work radius is doubled to 300 m.
- **Example Science Marswalk (Nontron → Maria Gordon Notch → Canaima).**
  - At the notch's own work radius (30 m, a planning assumption) the best alternative differs from working at the target by 0.9 points.
  - That is unresolved, so the plan keeps the astronaut at the target. The stop choice changes the 82.6 µGy total by 0.00 µGy.

**6. Across 322 rover stops, terrain helps reconstruct where Curiosity's dose was locally lower, but the gain is concentrated at one notch, the test is only partly independent, and the two terrain models cannot be told apart. [Measured vs Modeled]**

This is a new analysis combining RAD with REMS surface pressure (`science/marsshield/terrain_signal.py`; full tables in `docs/VALIDATION.md`, section V8).
- **Design.**
  - Each stop's mean ln dose rate is compared with the median at other walk-area stops within ±15 sols. The identical operation is applied to pressure and to both terrain predictors.
  - Seven models are scored on held-out time blocks: 8 blocks, with training stops within ±15 sols of the test block removed.
  - Intervals come from a moving-block bootstrap (10/20/40 stops) and, for model-versus-model questions, from resampling whole Curiosity sites.
- **Pressure: no measurable gain.**
  - Adding pressure changes the held-out skill by −0.1 %.
  - After whole-stop averaging and detrending, pressure differences are a few pascals, worth 0.04 pp of dose rate against an observed spread of 3.95 pp.
  - The fitted coefficient (−0.035 µGy/day/Pa) is poorly constrained and does not test Guo et al. (2015)'s −0.13 ± 0.02. This is a limit of the design, not evidence against the pressure effect.
- **What is tested.** Each stop's *local anomaly*: how much its dose differs from Curiosity's other stops at about the same time (a few percent). This reconstructs past anomalies along the traverse. It does not test absolute dose predictions at new locations.
- **Terrain: real, but concentrated.**
  - Against time only, the published terrain model lowers held-out **RMSE by 11.7 %** (3.95 → 3.49 pp). Equivalently, mean squared error falls by 22 % (−3.44 pp²).
  - 95 % intervals of the MSE change: −8.4 to −0.9 pp² resampling whole sites, and −8.2 to −0.8 pp² resampling time blocks.
  - **Six stops at Maria Gordon Notch (site 92) carry 59 % of the improvement.** Two of them (sols 3322 and 3324) carry 58 %.
  - Robustness, as RMSE change with site-resampled interval:

    | Excluding | RMSE change | Site-resampled interval |
    |---|---|---|
    | Site 92 | −5.5 % | −2.1 to −0.8 pp² |
    | Site 92 and the published periods | −3.2 % | −1.5 to −0.3 pp² |
    | The 5 % strongest modeled anomalies | −1.5 % | −0.70 to −0.05 pp² |
    | **The 10 % strongest modeled anomalies** | **−1.1 %** | **−0.66 to +0.08 pp² (includes zero)** |

  - The signal survives removing the notch, but not removing the most strongly shielded tenth of stops.
  - Two solar particle events lie inside the stops (10–13 Sep 2017; 28–29 Oct 2021), located in the time-resolved RAD records (V9). Stop 66_0 (sol 1812) changes by +62.9 % (actual; +48.8 on the log scale) and stop 91_1544 by +20.4 %. Removing the event records (sensitivity analysis) raises the relative improvement to 26.6 % RMSE while the absolute gain barely changes; the historical full sample stays the reference.
- **Only partly independent.**
  - The terrain model is not fitted in this cross-validation.
  - However, its one free parameter, the flat-terrain albedo share (18–24 %), was derived by Guo et al. (2026, Eq. 5) from RAD measurements at P1–P8 and BG1–BG8, which include the notch.
  - 27 of the 322 stops lie inside those periods, and stop 92_0 is the day before P6 at the same notch.
  - The model-error threshold behind "model cannot tell" comes from the same eight periods.
  - Our analysis settings were reused from the earlier analysis rather than tuned, but the analysis was not pre-registered.
- **Terrain model vs blocked-sky proxy: cannot distinguish.**
  - Head to head, the difference is −0.53 pp² [−2.27, +0.64].
  - At the stops where the two models disagree most, selected before looking at RAD, the terrain model is closer at 14 of 20 stops, but at only 6 of 11 sites. The site-resampled interval is −3.44 to +1.42 pp.
  - Stops at one site are not independent, so the stop count overstates the evidence.
- **Scaling.**
  - Measured anomalies are 0.70× the proxy's prediction (site-cluster 95 %: 0.48–0.87), so the proxy overstates shielding.
  - For the terrain model the factor is 1.25× (0.86–1.53), consistent with 1.
- **Correlation, corrected.**
  - The earlier figure (r = 0.36 at 324 stops) detrended observations and model differently. Under identical detrending, r = 0.48 (block-bootstrap 95 %: 0.26–0.77).
  - The evidence clusters in 35 Curiosity navigation sites; intervals resample whole sites. (An earlier 'effective n ≈ 294' was removed: that formula applies to correlations, not to the tested error difference.)

## Radiation magnitudes in context

- **Example Science Marswalk:** 82.6 µGy modeled for 1.0 h of walking and 7 h of planned work, i.e. 30 % of one full day on open ground (274 µGy/day at φ = 500 MV). [Modeled]
- **Curiosity's measured averages:** 210 ± 40 µGy/day on the surface (Hassler et al. 2014) and 481 ± 80 µGy/day inside the spacecraft during cruise (Zeitlin et al. 2013). [Measured]
- These are absorbed doses in a plastic detector, not effective doses.

## Which conclusions rest on observations?

| Conclusion | Basis |
|---|---|
| Terrain lowers the dose rate, by up to 19.4 % | Measured: NASA RAD L2, reproduced |
| Our terrain geometry matches published geometry at 13 of 15 periods | Measured comparison |
| Terrain albedo offsets part of the sky shielding | Published model; measured drops are smaller than published sky-dose drops at 6 of 8 periods |
| Time outside dominates walking dose | Model, structural |
| Moving to shelter near Maria Gordon Notch pays back within about half an hour | Model, resolved; direction supported by the measured −19.4 % |
| Stop choice at Mt Mercou | Model, unresolved: no conclusion |
| Terrain adds information on held-out rover stops beyond pressure and time | Measured vs model, 322 stops, interval excludes zero; concentrated in a few stops |
| Pressure control improves the stop-level comparison | Measured: no measurable gain |
| Terrain model better than the blocked-sky rule | Measured comparison: cannot distinguish (8 periods, and 322 stops at site level) |
| Safety, hazard or effective dose | Not modeled: no claim |

## Audit against Guo et al. (2026)

- **Table 1 transcription:** all 136 numeric cells match the paper text (0 mismatches). The check runs on text extracted by the pipeline itself from the open-access PDF.
- **Maria Gordon Notch (P6 vs BG6):** the paper is internally inconsistent.
  - Table 1, Sec. 3.4, the abstract and the conclusions give 19.4 % (19 %).
  - Sec. 4 says the observed drop is 17 %. Both statements are machine-verified in the extracted text.
  - NASA RAD L2 data reproduce **19.4 %**, which we use.
  - With 17 %, the albedo model's eight-period MAE becomes 3.07 pp (RMSE 4.73).

## Limitations

- **Dose type.** All doses are absorbed dose in RAD's tissue-equivalent plastic detector from quiet-time galactic cosmic rays. They are not an astronaut's effective dose (Sv).
- **Not modeled:** solar particle events, the neutron energy response (Charpentier et al. 2026), regolith composition, suit or vehicle shielding, rockfall, slope stability, footing, life support and EVA-duration limits.
- **Albedo assumption.** It fails in deep notches, and the most sheltered stops sit on steep ground below cliffs.
- **Terrain resolution.** Coarser DEMs undercount shielding (−2.3 pp mean at 8 m), and the DEM falls back to CTX/HRSC where HiRISE stereo is missing.
- **Statistics.** The parking-period validation has eight periods at five sites. The 322-stop analysis has more stops but only about 35 independent sites. No ranking of the two terrain models is claimed.
- **[Assumption] Planning choices:**
  - walking speed (Tobler's Earth hiking function × 0.6)
  - 25° walking slope limit
  - 15° workable-stop limit
  - work radii (20, 30 and 75 m by activity)
  - activity durations
  - astronaut reference height of 1.5 m

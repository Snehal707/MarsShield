# MarsShield methods

## 1. Study area

Gale Crater, from Glen Torridon across the Greenheugh pediment margin to the Paraitepuy canyon
(walk area E 8 142 400–8 145 900 m, N −282 700 to −279 700 m in the Mars 2000 sphere equirectangular
projection, about 4.80–4.83° S, 137.36–137.42° E). Curiosity drove through it between sols 1737 and 3878.
It contains five of the six sites where RAD recorded terrain-induced dose drops: Tower Buttes,
Bloodstone Hill, Mt Mercou, Maria Gordon Notch and Paraitepuy (Guo et al. 2026). Butte M12
(Murray Buttes; Ehresmann et al. 2021) lies 2 km north and is covered by the 1 m near-field crop
used for validation.

## 2. Terrain

* **Near field:** USGS MSL Gale Merged DEM 1 m v3, 5.8 × 5.9 km crop at full resolution.
  The file is a 3.87 GB strip TIFF. Only the 5 900 needed rows are fetched (GDAL `/vsicurl/` byte ranges).
* **Mid field:** the same DEM point-sampled every 8 px within ±25 km (5 872 rows fetched in parallel).
* **Far field:** HRSC/MOLA blended DEM 200 m (degrees converted exactly to metres on the 3 396 190 m sphere).
* All three DEMs use the same areoid. The DEM elevation matches the NASA waypoint elevation to 0.1 m at every validation stop.

## 3. Horizon ray tracing

For an observer at height *h* above ground, along each azimuth (1 440 bins of 0.25°, as in Guo et al. 2026):

    h(az) = max_r atan( (z(r) − z_obs − r²/2R) / r ),   r ≤ 20 km

* Samples are bilinear on the finest DEM tier with data at that point.
* Steps are dr = max(0.5 m, 0.004 r), giving 2 000 samples per ray.
* The spherical drop r²/2R is included.

A Numba-parallel version (72 azimuths, dr = max(1 m, 0.01 r)) computes the 420 000-cell routing map.
It is tested against the NumPy reference (max difference 0.001°) and against 720-azimuth profiles at 176 rover stops.

**Sky obstruction.** For each zenith ring θ = 0…90° (1° steps), ROS(θ) is the fraction of azimuths with h(az) > 90° − θ.
This rule reproduces the Guo et al. (2021) Zenodo ring ratios from their horizon mask.

The blocked solid-angle fraction is

    B = Σ ROS(θ) sin θ / Σ sin θ

It reproduces Ehresmann et al.'s "19 % of the sky" for Butte M12 (0.193) and tracks Guo et al.'s integrated ROS (Table 1)
with a +0.9 pp mean offset.

## 4. Radiation model (MODELED, not measured)

Re-implementation of Guo et al. (2021, 2026), Eqs. 2–5:

    D_sky   = 1.1 × 1.015 × Σθ (1 − ROS(θ)) [d_H(θ, φ) + d_He(θ, φ)]
    D_total = D_sky + (1 + B) × D_alb,FT,      D_alb,FT = α/(1 − α) × D_sky,fullsky

| Symbol | Meaning | Source |
|---|---|---|
| d_H, d_He | GEANT4 downward dose per 1° zenith bin in RAD detector E, primary GCR protons/helium, BON2014 at modulation φ | Zenodo 10.5281/zenodo.4701689 Fig1_a/Fig1_b; ×0.5 normalisation (below); linear in θ and φ, linear extrapolation outside 400–800 MV |
| 1.1 | heavier-ion contribution (8–12 % depending on pressure) | Guo et al. 2026 Eq. 4 |
| 1.015 | GCR radial gradient, 1 AU to Mars | Guo et al. 2026 §2.2 |
| α | flat-terrain albedo share of total dose: 0.18–0.24, default 0.21 | Guo et al. 2026 (derived from RAD) |

**Normalisation factor 0.5.** The published per-zenith dose of Guo et al. (2021) Fig. 4b equals
0.5 × Fig1_a(484 MV) × sky ratio at every zenith angle, to 1e-16 µGy/d. With the same factor the full-sky totals
reproduce Guo et al. (2026) to 0.5 %. We treat it as a binning convention of the tabulated figure data.
Ratios such as rel_sky and rel_total do not depend on it.

**The albedo term** encodes the key physics: blocking terrain is itself a source of secondary (albedo) radiation.
Blocking a fraction B of the sky adds B × the flat-ground albedo dose, so blocking sky never reduces dose proportionally.
This is the assumption the challenge asks us to account for. It is known to break down in deep, self-shielded notches.

**Not modeled:**
* effective dose or dose equivalent (RAD's LET cone is unaffected by terrain, so ⟨Q⟩ under shielding is unknown)
* solar particle events
* the energy-dependent neutron response (Charpentier et al. 2026: terrain raises the thermal-neutron albedo and lowers >1 MeV neutrons)
* subsurface composition
* atmospheric attenuation of albedo between a distant obstructor and the observer

**Pure geometric proxy.** Blocked solid angle B is also reported on its own, so the difference between "sky blocked" and "dose reduced" stays visible.

## 5. Observations (MEASURED)

* NASA RAD Level 2 daily CDFs (SPDF), `DOSIMETRY_TOTAL[:, 2]` = detector E (tissue-equivalent plastic), µGy/day.
  Records with a non-empty `FLAGGED_DATA` field are removed.
* UTC is converted to MSL sol with sol 0 starting at 2012-08-05 13:49:59 UTC and 88 775.244 s per sol.
  This conversion is checked against each file's `Start_sol` attribute in the tests.
* Per-stop means use waypoint occupancy windows; dates are preserved in UTC.
* The *local anomaly* is the stop mean divided by the median of all other quality data within ±15 sols, minus 1.
  It removes the solar-cycle and seasonal trend. The modeled rate at the stops goes through the identical operation.

## 6. Routing

* **Graph:** 5 m grid, 16-connected (metrication error 1.3 % median). Edges steeper than 25° are removed (assumption).
* **Walking speed:** Tobler's hiking function × 0.6 for a pressurised suit (assumption; Earth-derived).
* **Objectives:**
  * shortest: 3-D length (the baseline)
  * fastest: time
  * lowest dose: time × relative rate
  * maximum shielding: length × rate¹²
  * gentlest: time × (1 + (grade / tan 8°)²)
* **Dose:** rate × time integrated along the path, plus dwell × rate at each science stop.
* **Uncertainty bands:** α from 0.18 to 0.24 (recomputed on the map), and φ from 400 to 800 MV.

## 7. Radiation break-even explorer (MODELED)

A science task near a target can be done anywhere within a work radius (an assumption, for example along one outcrop).
For every candidate stop cell c within that radius:

    W(c) = minimum walking dose start -> c -> end    [µGy]
    r(c) = rel_total(c) × D_flat / 24                [µGy/h, stationary, 1.5 m height]
    D(c, T) = W(c) + T × r(c)                         [µGy, whole walk with T hours at the stop]

* **W(c):** computed for *every* cell at once with two Dijkstra passes on the lowest-dose route graph:
  forward from the start, and on the transposed graph from the end. The test suite checks it equals the dose
  integrated along the reconstructed path.
* **Named options:** A (least walking, the optimum at T = 0), B (at the science target) and C (lowest stationary rate in reach).
  They are reported with pairwise break-even times T* = (W_more_sheltered − W_less_walking) / (r_less_walking − r_more_sheltered).
  The exact optimum over all candidate cells is also shown; the named options are within 0.14 µGy of it in both precomputed cases.
* **Uncertainty:** each break-even time is recomputed for albedo α = 0.18 and 0.24 (map, routes and D_flat all recomputed).
  T* does not depend on solar modulation φ, because D_flat scales walking and stopping dose equally.
* **Stop limit:** workable stops need local slope ≤ 15° (assumption).
* **Measured context:** the nearest Curiosity RAD measurement (within 30 m) is shown beside each option.
  It is never used as an input to the calculation.

## 8. Audit

`python -m marsshield.audit` re-checks every numeric cell of the transcribed Guo et al. (2026) Table 1 against the paper text.
It also records the paper's two statements of the P6 drop (19.4 % in Table 1, Sec. 3.4, the abstract and Sec. 5; 17 % in Sec. 4)
and computes the full eight-period model errors under both values.

## 9. Break-even credibility layer (added for submission)

* **Resolvability.** The stationary-rate gap between two stop options, in rate points, is compared with the model's validated error on
  measured differences between nearby positions: all eight Guo et al. (2026) parking/background pairs, MAE 3.37 pp, RMSE 5.24 pp.
  A gap ≥ RMSE is *resolved*, ≥ MAE is *marginal*, otherwise *unresolved*. Unresolved break-even times are shown struck through and never produce a recommendation.
* **Model-error band.** The break-even time is recomputed with the rate gap shrunk and grown by the RMSE.
  An unbounded upper end means the shelter advantage could be zero within model error.
* **Sensitivity.** Walking-speed factor 0.4 and 0.8 (vs 0.6); work radius ×0.5 and ×2; workable-stop slope limit 10° and 20° (vs 15°);
  albedo share 18–24 %. Break-even times do not depend on solar modulation φ.
* **Site flags (descriptive, not a hazard model).**
  * *Steep stop:* local slope ≥ 12°.
  * *Below steep terrain:* cells with slope ≥ 30° rising ≥ 5 m above the stop within 40 m.
  * Rockfall, slope stability and footing are not modeled.
* **Default for decisions.** Work at the science target (option B). Another stop is recommended only if its rate gap to B is resolved and it
  is preferred across the whole planned duration range.

## 10. Science Marswalk

* **Targets.** `marsshield/targets.py` lists nine documented Curiosity targets in the walk area. Objectives, "look for" text and results are
  quoted or closely paraphrased from Bennett et al. (2023, JGR Planets), NASA MSL mission blogs and a NASA/JPL release, with links.
  Each target is placed at the NASA/JPL waypoint Curiosity occupied longest during the documented sol range; nothing is hand-placed.
  The Maria Gordon drill site was excluded because no objective for it is documented in the sources we could verify.
* **Activity assumptions** (MarsShield, labelled in the app):

  | Activity | Duration: nominal (range) | Work radius |
  |---|---|---|
  | Sample collection | 2 h (1–3 h) | 20 m |
  | Outcrop documentation | 1 h (0.5–2 h) | 75 m |
  | Stationary instrument measurement | 3 h (1–6 h) | 30 m |

* **Mission** (`marsshield/mission.py`).
  * The first target is the start and the last is the end. For each intermediate stop, the break-even explorer runs between the
    neighbouring targets with that stop's radius and duration range.
  * The route uses the lowest-dose path through the chosen stop locations.
  * Doses are split into walking and stationary parts and compared with working exactly at each (workable) target and with open flat ground.
* **Context values (measured, published).**
  * Curiosity surface average 210 ± 40 µGy/day (Hassler et al. 2014, Science 343, 1244797).
  * Cruise average 481 ± 80 µGy/day (Zeitlin et al. 2013, Science 340, 1080).

## 11. Orbital image layer

The USGS MSL Gale Merged Orthophoto Mosaic (25 cm, built from HiRISE and co-registered with the DEM) is read for the walk area only.
Only the intersecting 128-pixel tiles of the 24 GB file are fetched. It is block-averaged to 1 m and percentile-stretched for display only.

## 12. RAD + REMS terrain-signal analysis (`rems.py`, `terrain_signal.py`)

**Question.** After controlling for atmospheric pressure and time, does local terrain explain additional variation in Curiosity's measured dose rate?

**Pressure data (MEASURED).**
- Source: REMS MODRDR (MSL-M-REMS-5-MODRDR-V1.0) from the PDS Atmospheres node, sols 1720–3895.
- Format: fixed-width ASCII, 372-byte records. PRESSURE is read from bytes 345–351 and PS_CONFIDENCE_LEVEL from bytes 362–369, both 1-indexed as in the PDS label.
- Quality: records whose last confidence flag is `0` (shadow-affected) or unavailable are dropped.
- Sampling: 180 evenly spaced records per sol, fetched with HTTP range requests and cached in `data/raw/rems/`.
- Time: UTC = label START_TIME + (SCLK − SCLK at start).
- Matching: each RAD record takes the mean REMS pressure inside its time span. Records with no REMS sample within an hour are excluded from every model, so all models are scored on the same observations (96.8 % retained).

**Target and predictors.**
- Target y: the stop mean of ln E minus the median ln E of RAD records at *other* walk-area stops within ±15 sols.
- Predictors, built with the identical operation:
  - pressure x (Pa)
  - blocked-sky proxy g = ln(1 − B)
  - published terrain model m = ln(relative total dose), with φ = 500 MV and α = 0.21 at 1 m height

**Models.**
- M0: time only (y = 0).
- M1: pressure (fitted coefficient).
- M2: proxy; M3: terrain model. Both are fixed, with no fitted parameter.
- M4 and M5: pressure + terrain model and pressure + proxy.
- M6: pressure + scaled terrain model.

**Validation.**
- Leave-one-time-block-out with 8 contiguous blocks in sol.
- Training excludes stops within ±15 sols of the test block, because their targets share background observations.
- A test (`tests/test_terrain_signal.py`) checks that held-out predictions are unchanged when the test block's outcomes are altered.

**Uncertainty.**
- MSE differences and correlations: moving-block bootstrap over time-ordered stops (block lengths 10, 20 and 40; 4 000 resamples).
- Effective sample size: Bretherton et al. (1999), from the lag-1 autocorrelations of observation and predictor.
- Model-versus-model tests: resample whole Curiosity sites (RMC site index), because stops at one site share terrain and time.

**Disagreement test.** The 10, 20 and 40 stops with the largest |m − g| are selected from model values alone, then compared with RAD.

**Robustness.** Detrending windows of 10 and 30 sols; ≥ 2 sols of data; excluding stops inside the published Guo et al. periods; excluding the 5 % largest modeled anomalies.

## 13. Browser engine (public site)

The static site recalculates without a server:
- **Routes:** a TypeScript port of `routing.py`, with the same 16-connected grid, Tobler × suit factor, 25° walking limit and cost functions, and a binary-heap Dijkstra.
- **Break-even:** a port of `breakeven.py` (forward and reverse Dijkstra over every candidate stop cell).
- **Experiment statistics:** a port of the cross-validation and bootstrap above.

The dose-rate map is recomputed in float32 to match the Python arrays. `web/scripts/verify-engine.mts` and `verify-stats.mts` compare the ports with the committed Python outputs, and CI runs both.

Horizon ray tracing, the dose-model fits, the RAD and REMS reduction and the 4 000-resample site bootstraps are *not* recomputed in the browser. Their outputs are precomputed by the Python pipeline and loaded as data.

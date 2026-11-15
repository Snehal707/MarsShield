# Space Apps 2026 submission

**Challenge:** Interplanetary Survival Guide: Martian Map

**Project name:** MarsShield

**Live application:** https://marsshield.vercel.app (primary). GitHub Pages mirror: https://snehal707.github.io/MarsShield/ (slower to load).

**Code:** https://github.com/Snehal707/MarsShield

**30-second demo script:** [DEMO_30S.md](DEMO_30S.md). Full walkthrough: [DEMO.md](DEMO.md).

## Summary

Mars has no global magnetic field and only a thin atmosphere, so galactic cosmic rays reach its surface. How much radiation an explorer receives depends on where they stand: on the air overhead and on the terrain around them.

MarsShield turns that question into a map you can investigate. It covers three regions, each with a different kind of evidence:
- **Gale Crater.** NASA's Curiosity rover measured the radiation directly. MarsShield reduces those measurements, tests terrain-shielding models against them, and turns the results into an honest Marswalk planner.
- **Jezero Crater.** Perseverance's landing site.
- **Olympus Mons caldera.** The summit of the tallest volcano on Mars, with about an eighth of Gale's atmosphere overhead.

No radiation detector has ever operated at Jezero or Olympus Mons, so MarsShield estimates their dose from published radiation-transport simulations at climate-model pressures. It states plainly that those estimates are unvalidated there.

The guiding principle is to separate what was measured, what was modeled and what was assumed. MarsShield says "the model cannot tell" when that is the answer.

## What we built

1. **Reproduced and audited the published Gale physics.**
   - Re-implemented the Guo et al. (2021, 2026) terrain-dose method and checked it against raw NASA RAD Level 2 data: 15 published periods and 322 rover stops.
   - Audited 136 cells of the paper's Table 1, with 0 transcription errors. Found the paper's two different P6 drops (19.4 % and 17 %); NASA data reproduce 19.4 %.
   - Reproduced the paper's Maria Gordon Notch prediction (13.3 %) when using its own geometry.
2. **Built a terrain-horizon engine** on the USGS 1 m DEM. It is verified on analytic shapes and against the RAD team's own horizon mask (0.91° RMSE).
3. **Tested terrain against pressure and time at 322 rover stops** (RAD + REMS):
   - Held-out typical error is 11.7 % smaller than time alone, with an interval that excludes zero when resampling whole sites.
   - 59 % of the gain comes from six notch stops. Without the 10 % most shielded stops, it is not distinguishable from zero.
   - Two solar particle events (Sep 2017, Oct 2021) were located in the RAD records and screened as a sensitivity analysis.
4. **Built a Marswalk planner.**
   - Routes with four strategies and a "where to stand" break-even analysis, computed in the browser.
   - Each recommendation is classified against the model's validated error, and flagged for steep or cliff-base terrain.
5. **Built the three-region radiation comparison.**
   - **Model:** published AtRIS/Geant4 surface tables (Zhang et al. 2022) at Mars Climate Database v6.2 pressures, checked against Perseverance MEDA at Jezero (0.5 %).
   - **Outputs:** effective dose, dose equivalent and water-phantom absorbed dose. The assumptions (solar modulation, season, mission duration) are set once and apply to every site.
   - **Verification:** the published values are reproduced to about 1 %. There is no extrapolation beyond the published grid and no conversion between dose quantities.
6. **Built regional terrain workspaces from authentic data.**
   - MOLA global elevation.
   - The USGS Mars 2020 CTX DTM, with Perseverance's 708 localized waypoints. The DTM agrees with the rover elevations to a median of 1.1 m.
   - The HRSC/MOLA 200 m blend with the USGS SIM 3470 geologic map of the Olympus Mons caldera.
7. **Made it a research tool.**
   - Every experiment and comparison exports CSV and a research package: data, model settings, seeds, schema, SHA-256 provenance and source URLs.
   - Browser calculations are checked against the Python pipeline in CI.
   - The app works as a static site, on phones and without WebGL, and is keyboard accessible.

## Findings

- **Gale, measured:** terrain lowers the cosmic-ray dose rate measurably, by up to about a fifth beside cliffs (19.4 % at Maria Gordon Notch).
- **Gale, models:** with eight measured parking periods, the physical model is **not demonstrably better** than a simple blocked-sky rule.
- **Marswalk planning:** rerouting a walk to hug cliffs almost never lowers dose, because the extra time outside costs more than the shade saves. Where an astronaut stands while working can matter. At the notch the difference is below model error, and MarsShield says so.
- **Three regions:**
  - Olympus Mons has an effective dose about 4 % lower than Gale at moderate solar activity, rising to about 7 % at solar maximum and vanishing at solar minimum.
  - Jezero is not meaningfully different from Gale.
  - The model's pressure response is about 50× weaker than RAD's at Gale, for different detector materials and observing conditions. This limitation leaves those small differences uncertain.

## Space agency and scientific data

| Source | Data | Use |
|---|---|---|
| NASA MSL Curiosity RAD (SPDF) | Level 2 dosimetry, detector E, 1,839 daily files | Measured dose rates |
| NASA MSL REMS (PDS Atmospheres) | MODRDR surface pressure, about 2,170 sols | Pressure control |
| NASA/JPL MMGIS | MSL and Mars 2020 localized waypoints | Rover positions and elevations |
| NASA Mars 2020 MEDA (PDS4) | Derived surface pressure | Jezero atmosphere check |
| NASA MRO HiRISE and CTX, ESA Mars Express HRSC, NASA MGS MOLA | Via USGS Astrogeology: Gale merged DEM 1 m and orthophoto 25 cm, Mars 2020 TRN CTX DTM 20 m, HRSC/MOLA blend 200 m | Terrain, imagery, horizons |
| NASA MGS MOLA (PDS Geosciences) | MEGDR global elevation, 4 pixels per degree | Mars overview |
| USGS | SIM 3470, Geologic map of Olympus Mons caldera (Mouginis-Mark 2021) | Caldera units |
| ESA/CNES/LMD | Mars Climate Database v6.2 | Site pressures (derived values only) |
| Published model data (Zenodo) | Guo et al. (2021) zenith-angle tables; Zhang et al. (2022) AtRIS/Geant4 surface tables | Dose models |
| Literature | Guo et al. (2015, 2026), Bennett et al. (2023), Sánchez-Lavega et al. (2023), NASA MSL blogs | Validation, science targets, context |

Full provenance is in [DATA_SOURCES.md](DATA_SOURCES.md). Downloaded files are recorded with SHA-256 hashes.

## Scientific limitations

- **What the Gale doses are:** absorbed dose in RAD's plastic detector from quiet-time galactic cosmic rays. They are not an astronaut's effective dose.
- **What the regional values are:** model estimates from one transport model, not validated at Jezero or Olympus Mons, since no measurement exists there. They are not astronaut health-risk or safety assessments.
- **Not modeled:**
  - solar particle events (screened in the Gale data only)
  - terrain shielding of dose outside Gale
  - RAD-type dose outside Gale
  - rockfall and footing
  - suits and habitats
  - life support
- **Decision thresholds:** "model cannot tell" and similar thresholds are screening heuristics based on eight measured periods, not certified safety criteria.
- **Assumptions:** walking speeds, activity durations and the EVA time cap are labelled planning assumptions.
- **Blockers:** every open item, with the evidence it would need, is listed in [REGIONAL_RADIATION.md](REGIONAL_RADIATION.md) and [SCIENCE_AUDIT.md](SCIENCE_AUDIT.md).

## Use of AI

MarsShield was developed with substantial help from an AI coding assistant, Anthropic's Claude in Claude Code, directed by the team member.

**What the assistant did:**
- wrote most of the code: the Python pipeline, the TypeScript web app and the tests
- ran the data downloads and analyses
- drafted the documentation and this text

**Reviews by AI agents, not people:**
- During development, independent AI agents reviewed the work in several roles: radiation transport, atmosphere and terrain, numerical validation, scientific UX, first-time visitor, judge, and accessibility.
- **These were AI-simulated reviews, not human expert review or human usability testing.** No external user testing has been done; the script for it is in [USABILITY_TEST.md](USABILITY_TEST.md).

**How the outputs were checked:**
- Every scientific number in the app is computed from the cited data and models by code in this repository, and checked by automated tests and cross-language verifiers.
- AI-written statements were checked against those outputs and against the cited papers. Corrections, with their earlier values, are recorded in [SCIENCE_AUDIT.md](SCIENCE_AUDIT.md).

**What AI did not do:** generate any measurement, dataset or image of Mars. All imagery and terrain come from the cited space agency products.

# Space Apps 2026 submission text

**Challenge:** Interplanetary Survival Guide: Martian Map

**Project name:** MarsShield

**Demo:** https://snehal707.github.io/MarsShield/

**Code:** https://github.com/Snehal707/MarsShield

## Short description (one paragraph)

MarsShield plans a science Marswalk through real Gale Crater terrain, at the sites NASA's Curiosity rover actually studied. It asks a question existing Mars maps do not answer: how does the land around an astronaut change cosmic-ray exposure, and does that change what the astronaut should do?

It combines several sources:
- Curiosity's radiation measurements (RAD) at 322 rover stops, with its surface-pressure record (REMS)
- Curiosity's navigation data
- 1 m terrain and imagery from NASA's Mars Reconnaissance Orbiter (HiRISE, CTX), plus MGS MOLA and Mars Express HRSC
- the published Curiosity science record for nine stops: objective, what to look for, what Curiosity found
- a published, validated model of how terrain blocks the sky and re-emits radiation

The result is a clear rule: rerouting a walk to hug cliffs almost never lowers dose, because the extra time outside costs more than the shade saves. Where an astronaut stands while working can matter. MarsShield reports such recommendations only when the difference exceeds its model's validated error, and says plainly when it cannot tell.

## What we did

1. **Re-implemented and tested the published physics.** We re-implemented the Guo et al. (2021, 2026) terrain-dose method and validated it against raw NASA RAD data at the 15 published periods and at the rover stops in the area.
   - We audited the paper's table against its own text and found an internal inconsistency (19.4 % vs 17 % at Maria Gordon Notch).
   - We report honestly that, with eight measured periods, the physical model is not demonstrably better than a naive proxy.
2. **Built a terrain horizon engine.** It uses the USGS 1 m DEM and is verified on analytic shapes and against the RAD team's own horizon mask (0.91° RMSE).
3. **Built a route engine and a break-even analysis.** The route engine compares five strategies against a shortest-distance baseline over 150 random walks. The break-even analysis is computed exactly for every candidate stop location. Each recommendation is classified as resolved, marginal or unresolved against validated model error, and flagged for steep or cliff-base terrain (rockfall is not modeled).
4. **Tested terrain against pressure and time at 322 rover stops (RAD + REMS).**
   - Terrain adds out-of-sample information: +22 % skill over time alone on held-out time blocks, with a block-bootstrap interval that excludes zero.
   - Pressure control adds no measurable gain at stop level.
   - At the level of independent sites, the physical model and a blocked-sky rule cannot be distinguished. We report this as found.
5. **Built an interactive 3D app** that works as a static public demo, on phones, and without WebGL. Measured data, model outputs and planning assumptions are labelled differently everywhere.
   - It has three modes: Mission (plan a walk and its trade-offs), Experiment (predict, then reveal Curiosity's measurements) and Evidence.
   - Routes, break-even and the experiment statistics are recalculated in the browser by ports of the Python engine, checked against it in CI.

## Space agency data used

- NASA MSL RAD Level 2 dosimetry (SPDF)
- NASA MSL REMS MODRDR surface pressure (PDS Atmospheres node)
- NASA/JPL MSL localized waypoints (MMGIS)
- USGS MSL Gale Merged DEM 1 m and Orthophoto Mosaic 25 cm (MRO HiRISE, CTX; Mars Express HRSC; MGS MOLA)
- USGS HRSC/MOLA blended DEM 200 m
- Guo et al. 2021 model data (Zenodo)
- Curiosity science publications and NASA mission blogs

## Scientific scope

- All doses are absorbed dose in RAD's plastic detector from galactic cosmic rays in quiet solar conditions, not an astronaut's effective dose.
- Solar particle events, rockfall, footing, life support and physiological EVA limits are not modeled. The EVA limit in the app is a user-set time cap.
- Thresholds such as "model cannot tell" are screening heuristics based on eight measured periods, not certified safety criteria.
- Walking speeds and activity durations are labelled planning assumptions.

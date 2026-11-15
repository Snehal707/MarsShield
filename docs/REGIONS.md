# Mars regions (Phase 3, November 2026)

MarsShield now opens on a region menu: **Gale Crater** (the full radiation experience, unchanged), a **Mars overview**, **Jezero Crater** and the **Olympus Mons caldera**. The new regions are terrain views. Since the radiation phase they also carry model dose estimates. See [REGIONAL_RADIATION.md](REGIONAL_RADIATION.md); no local radiation measurement exists there. Curiosity's RAD data and every radiation result stay in Gale.

## Architecture

```
science/marsshield/regions.py      python -m marsshield.regions   (about 12 MB of downloads plus range reads)
web/public/data/regions/
  index.json                       regions, capability matrices, label definitions, raw inputs with SHA-256
  <id>/manifest.json               sources, frame, grid, layers, landmarks, profiles, checks
  <id>/elev.i16                    int16 little-endian elevation grid (scale/offset in the manifest)
  <id>/*.u8                        auxiliary grids for readouts (slope, sky blocked, geologic unit codes)
  <id>/*.jpg                       draped layers at source detail (relief, slope, sky blocked, units)
web/src/lib/regions.ts             loader, bilinear sampling, profiles
web/src/components/RegionView.tsx  Mars overview (2D) and the generic regional 3D view
```

**Adding a region** means adding one function that writes these files. The browser needs no change unless the region needs a new kind of layer.

**Progressive loading:**
- The app loads `index.json` (a few kB) at start.
- A region's files load only when it is opened.
- Opening Gale requests no regional file; the browser probe verified this.

| Region | Payload | Grid | Layers |
|---|---|---|---|
| Mars overview | 0.69 MB | 720 × 360 (0.5°) | MOLA relief 1440 × 720 |
| Jezero | 1.8 MB | 532 × 504 at 57 × 60 m | Relief and slope at 20 m, sky blocked (exploratory) at 60 m |
| Olympus Mons caldera | 2.2 MB | 593 × 652 at 190 × 200 m | Relief, slope, geologic units; whole-volcano context image |

## Capability labels

| Label | Meaning |
|---|---|
| **Validated** | An authentic data product, or a direct geometric derivative of one (slope, profile), at a scale the data resolve, with a published accuracy assessment |
| **Exploratory model** | Computed by MarsShield with a model that has not been tested against measurements in that region |
| **Unavailable** | Not offered; the reason is stated |

Gale's own entries use the same labels:
- The 1 m DEM and the RAD measurements are **validated**.
- Sky blocking, the dose model and the route planner are **exploratory models**. The dose model was tested retrospectively against RAD, but its albedo share came from the same data, so this is not independent validation.

| Capability | Mars | Jezero | Olympus Mons |
|---|---|---|---|
| Elevation and 3D terrain | Validated (MOLA, about 15 km) | Validated (CTX DTM, 20 m) | Validated (HRSC/MOLA blend, 200 m) |
| Slope | — | Validated over 20 m | Validated over 200 m |
| Elevation profiles | — | Validated (60 m grid) | Validated (200 m grid) |
| Rover traverse | — | Validated (708 waypoints) | — |
| Geologic units | — | — | Validated (USGS SIM 3470) |
| Sky blocked by terrain | — | Exploratory model (60 m grid) | Unavailable (a 200 m grid cannot resolve it) |
| Radiation dose | Exploratory model (three-region comparison) | Exploratory model (no dosimeter on Perseverance) | Exploratory model (no measurement) |
| Terrain shielding of dose | — | Unavailable (no angular data in the published tables) | Unavailable |
| Walking routes | — | Unavailable (the DTM cannot see walking-scale hazards) | Unavailable |

## Sources

| Region | Data | Producer |
|---|---|---|
| Mars | MGS MOLA MEGDR, 4 pixels per degree (`megt90n000cb.img`) | NASA PDS Geosciences Node (Smith et al., 2003) |
| Jezero | Mars 2020 TRN CTX DTM mosaic, 20 m (`JEZ_ctx_B_soc_008`) | USGS Astrogeology (Fergason et al., 2020) |
| Jezero | Mars 2020 localized waypoints | NASA/JPL MMGIS |
| Olympus Mons | Mars HRSC MOLA Blended DEM Global 200 m v2 (window reads) | USGS Astrogeology (Fergason et al., 2018) |
| Olympus Mons | Geologic map of Olympus Mons caldera, SIM 3470, 1:200,000 | Mouginis-Mark (2021), USGS, https://doi.org/10.3133/sim3470 |

**Provenance:** `index.json` records the size and SHA-256 of every downloaded file.

**Geologic map sources:**
- Unit names and descriptions follow the SIM 3470 pamphlet: Aoc1–Aoc5 are the patera floors (Zeus, Hera, Hermes and Dionysus, Athena, Apollo); Aos1 and Aos2 are the lava flows; Aw is wall material; Ap1 and Ap2 are Pangboche crater.
- Polygons were read directly from the map's shapefiles. They were converted from its transverse Mercator projection (central meridian 134° W, Mars 2000 sphere) with the exact spherical inverse, then rasterized respecting the polygon holes.

## Horizontal frames and scale

Both source products use equidistant cylindrical coordinates with the standard parallel at the equator, or plain degrees. These stretch east–west distances by 1 / cos(latitude): 5.4 % at Jezero and 5.6 % at Olympus Mons.

**Correction:**
- Grids are exported in a local true-scale frame: x = R cos(lat_c) Δlon, y = R Δlat on the 3,396,190 m sphere.
- Slopes use each row's exact east–west spacing.
- The residual scale error is within ±0.3 % across Jezero and ±0.6 % across the caldera.

**Gale:** the existing study area lies at 4.7° S, where the same effect is 0.3 %. It is not changed.

## Checks (consistency, not validation)

**Jezero, DTM against rover elevations.**
- Method: DTM elevation at each of 708 localized waypoints minus the waypoint's own elevation (both relative to the areoid).
- Result: median −1.1 m, 5–95 % range −6.2 to +4.8 m.
- The two products are co-registered to a few metres. This shows agreement, not the accuracy of either.

**Olympus Mons, highest point.**
- Blend: 21,226 m.
- SIM 3470: 21,290 m from MOLA, for the volcano's high point south of the caldera.
- The −64 m difference is consistent with averaging to 200 m posts.

**Olympus Mons, patera floors (blend):**

| Patera | Floor |
|---|---|
| Zeus | 17,784–19,866 m |
| Hera | 18,106–19,095 m |
| Hermes and Dionysus | 17,754–18,984 m |
| Athena | 17,626–18,209 m |
| Apollo | 17,735–18,447 m |

SIM 3470 describes Zeus Patera's floor as about 18,000 m in the centre and 19,500 m near the east wall. The blend's upper end includes wall-adjacent cells smoothed by the 200 m grid.

## Analysis only at supported scales

- **Jezero slope** is computed over 20 m. It cannot see steps, boulders or scarps narrower than about 40 m, so it does not judge traversability, and no routes are offered.
- **Olympus Mons slope** is computed over 200 m. Caldera walls 1–3 km high are steeper over shorter distances than this shows; the steepest step on the west–east profile is 37.7° over 190 m.
- **Jezero sky blocked** uses the Gale definition (mean over azimuth of the sine of the horizon angle, with Mars curvature, within 15 km). It runs on the 60 m grid, misses walls narrower than about 100 m, and is labelled exploratory everywhere it appears.

## Evaluated, not used

**Mars 2020 TRN HiRISE DTM mosaic (1 m, Jezero).**
- Status: reachable by range requests, but 1.8 GB.
- Why not now: a 1 m inset is only useful for a defined study site. Without a local radiation measurement there is no analysis for it to support yet.
- To add it: one more manifest and its layers.

**HRSC single-orbit DTMs (50–75 m) for Olympus Mons.**
- Why not used: the 200 m blend already includes HRSC over the caldera and is readable by range requests.
- The single-orbit products would need ESA PSA downloads and reprojection.

## Verification

**Browser probe** `p3`, at 1440 × 900, 1024 × 768 and 390 × 844, zero console errors. It verified:
- the region options;
- `?region=` URLs;
- no regional requests while in Gale;
- the overview readout over Olympus Mons (19,617 m, 0.5° MOLA cell);
- Jezero loading (1.8 MB in 38 ms from a local server);
- the traverse profile with 708 rover elevations;
- cursor readouts for elevation, slope, sky blocked (exploratory) and geologic unit ("Aoc1, Zeus Patera floor");
- the caldera profile (112 km, 17,846–20,424 m);
- a drawn two-click profile;
- the return to Gale with its three modes;
- no horizontal overflow on tablet and phone.

**Tests:** `science/tests/test_regions.py` checks:
- grid and file sizes against the manifests;
- valid labels;
- no radiation capability other than "unavailable" outside Gale;
- the exploratory labelling;
- the true-scale frame;
- the Jezero co-registration;
- the rasterization of every patera;
- the published-reference check;
- payload sizes.

**Screenshots:** `docs/img/phase3/`.

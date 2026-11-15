# Three-region radiation analysis: Gale, Jezero, Olympus Mons (November 2026)

MarsShield now estimates the galactic cosmic ray (GCR) surface dose at Gale Crater, Jezero Crater and the Olympus Mons caldera. It uses one published transport model, one atmosphere source and the same assumptions for every site.

**Status.** These are model estimates. No ionizing-radiation detector has operated at Jezero or Olympus Mons, so they cannot be validated there. Curiosity RAD is shown separately as measured context at Gale and is never converted into these quantities.

**Code:**
- `science/marsshield/atmosphere.py`: site pressures and column depth
- `science/marsshield/regional_dose.py`: dose model, uncertainty, validation and blockers
- `web/src/lib/radiation.ts`: the same interpolation in the browser
- `web/src/components/RadiationLab.tsx`: comparison workspace

**Exports:**
- `data/processed/site_atmosphere.json`
- `web/public/data/regions/radiation.json`

## 1. How the design was chosen

Four independent reviews were run before implementation: radiation transport, atmosphere and terrain, numerical validation, and scientific UX. Where they conflicted, the evidence decided.

| Question | Proposals | Decision and evidence |
|---|---|---|
| How to get dose at other altitudes | Numerical review: scale the Gale RAD-E model by R(depth)/R(21 g/cm²) from a published table. Transport review: no published model gives RAD-E plastic dose against depth. | **Not scaled.** In Zhang et al. (2022), H+He dose rises 15 % in silicon but 9 % in water over the same pressure range, so the target material changes the depth trend. A water ratio applied to plastic would be an invented multiplier. All three sites are instead computed in the paper's own quantities. |
| Source paper | The brief cited "Guo et al. (2022)" for doi:10.1029/2021JE007157 | That DOI is **Zhang, Guo, Dobynde, Wang & Wimmer-Schweingruber (2022)**, confirmed independently by two reviews. |
| Olympus Mons sky blocking | Atmosphere review: resolvable at landscape scale | The geometry is resolvable, but the published dose tables have no zenith-angle resolution, so **blocked sky cannot become dose**. Terrain shielding of dose is Unavailable. |
| Site pressures | MCD, MEDA, REMS, or hydrostatic extrapolation | **MCD v6.2 for all three sites.** MEDA serves as a check at Jezero (0.5 % agreement). Hydrostatic extrapolation from Gale to Olympus has about ±22 % error, so it is used only to map pressure within a region. |

## 2. Equations and parameters

**Column depth:**
- X = P / g, with g = 3.71 m/s², as in Zhang et al. (2022). So 1 Pa = 0.02695 g/cm².
- Point-mass gravity would give 3.706 (Gale), 3.708 (Jezero) and 3.656–3.664 (Olympus). The constant-g bias is under 0.1 % at Gale and Jezero and 1.3–1.5 % at Olympus.

**Dose:**
- Surface dose is D(P, φ), interpolated linearly in surface pressure between the published nodes (82, 305, 529, 753, 975 and 1200 Pa; 2.2–32.2 g/cm²).
- **No extrapolation.** Below 82 Pa the value is held at the 82 Pa node and flagged. Only the Olympus summit's seasonal low reaches this, and the paper's own 82 Pa case is the top of Olympus Mons.

| Quantity | Phantom or definition | Published grid |
|---|---|---|
| Effective dose (mSv/yr) | ICRP-103, Dobynde et al. (2021) coefficients | 6 pressures × φ = 400, 700, 1000 MV |
| Dose equivalent (mSv/yr) | ICRP-60 Q(L), 15 cm water sphere | 3 pressures (82, 753, 1200 Pa), φ = 580 MV |
| Absorbed dose, water (mGy/yr) | 15 cm water sphere, all ions | 3 pressures, φ = 580 MV |

- Solar modulation is offered only at the published nodes, never interpolated. Absorbed dose, dose equivalent and effective dose are never converted into one another.

**Cumulative dose:**
- dose = rate (per Earth year) × sols × 1.02749 / 365.25.
- 1 sol = 88,775.244 s.

**Within-region pressure map (exploratory):**
- P(z) = P_ref exp(−(z − z_ref) / H).
- H is 10.4 km at Jezero and 10.8 km at Olympus Mons, the effective values implied by MCD site pairs.
- z_ref comes from the exported regional DEM at the MCD query point: −2,569 m at Jezero and 18,412 m at Zeus Patera.

**Sources:**
- **Transport model:** Zhang et al. (2022), JGR Planets 127, e2021JE007157. Data: Zenodo doi:10.5281/zenodo.5953666 (CC-BY-4.0), md5 `f65945053d690414dbbbb9481073333d`. AtRIS/Geant4, BON2010 GCR (H to Fe), MCD atmosphere, regolith 1.79 g/cm³.
- **Atmosphere:** Mars Climate Database v6.2 web interface (LMD/OU/IAA/ESA/CNES), climatology average-solar scenario, high-resolution topography. Ls × local-time tables are averaged diurnally in our code. Query URLs are stored per site; MCD files are not redistributed, under its terms.
- **Jezero check:** Perseverance MEDA derived pressure (PDS4, doi:10.17189/1522849). Every 20th sol from 20 to 1340; fill values and sols with fewer than 10 local hours excluded; normalised to the landing elevation. Sánchez-Lavega et al. (2023) used for comparison.

## 3. Site inputs (MCD v6.2)

| Site | Annual mean | Ls 150 | Ls 255 | Column (annual mean) |
|---|---|---|---|---|
| Gale | 851 Pa | 739 | 935 | 22.95 g/cm² |
| Jezero | 723 Pa | 624 | 808 | 19.49 g/cm² |
| Olympus caldera, Zeus Patera | 103 Pa | 84 (Ls 135) | 123 | 2.77 g/cm² |
| Olympus caldera, Athena Patera | 110 Pa | 90 (Ls 135) | 131 | 2.95 g/cm² |
| Olympus summit, outside the caldera | 81 Pa | 66 (Ls 135) | 99 | 2.19 g/cm² |

**Checks:**
- **Jezero:** MEDA (55 clean sols, normalised) averages 719 Pa, a 0.5 % difference.
- **Olympus summit:** Zhang et al. use 82 Pa from MCD at Ls 0 and local midnight; the same conditions in MCD v6.2 give 79.3 Pa.
- **Gale:** Zhang et al. use 868 Pa; we get 869.3 at the same conditions.

## 4. Results (annual mean, flat open ground, no habitat or suit)

| Site | Effective dose, 400 MV | Effective dose, 700 MV | Effective dose, 1000 MV | Dose equivalent, 580 MV | Water absorbed dose, 580 MV |
|---|---|---|---|---|---|
| Gale | 246.0 | 168.9 | 127.6 | 248.4 mSv/yr | 61.97 mGy/yr |
| Jezero | 245.9 (−0.0 %) | 167.8 (−0.7 %) | 126.3 (−1.0 %) | 247.5 (−0.3 %) | 62.09 |
| Olympus, Zeus Patera | 245.5 (−0.2 %) | 161.8 (−4.2 %) | 118.6 (−7.0 %) | 234.7 (−5.5 %) | 62.53 (+0.9 %) |

**Comparison threshold.** The published curves scatter by 0.9–1.2 % point to point, measured as the RMS residual of each effective-dose curve about a straight line in pressure. This is an empirical indicator of the simulation's Monte Carlo statistics, not a verified uncertainty interval. A difference is labelled "beyond table scatter" when it exceeds twice that. The label is a model comparison, not a statistical significance test.

**Findings:**
- **Jezero against Gale:** within table scatter for every quantity, so the model gives no meaningful difference.
- **Olympus Mons:** about 4 % lower effective dose and about 5.5 % lower dose equivalent than Gale at 700 MV and 580 MV. This is beyond table scatter in the model, which is not a statistical confirmation, and it has not been independently checked.
- **Solar activity:** the Olympus difference grows with solar activity. It disappears at solar minimum (400 MV) and reaches −7.0 % at 1000 MV.
- **Absorbed dose:** essentially independent of the column. As the atmosphere thins, heavy-ion dose rises while proton and helium dose falls.
- **Within a region:**
  - Across Jezero's 1.2 km of relief and the caldera's 3.6 km, the modeled effective dose changes by 0.4–0.5 %. That is within table scatter, so the model gives no meaningful distinction between locations.
  - The app states this rather than drawing a dose map.

## 5. Verification and validation, kept separate

**Fitting:** none. No parameter in this module is fitted to observations.

**Reproduction of published results:** achieved.
- Integrating the published 580 MV proton integrands (Fig. 4) over energy reproduces the published surface proton dose (Fig. 6) to within 1.1–1.2 % at 82, 753 and 1200 Pa.
- The browser reproduces the Python export at every site, quantity and season (`web/scripts/verify-radiation.mts`).

**Pressure response at Gale:** a limitation, not a like-for-like validation test.
- RAD's dose falls as pressure rises: −0.13 ± 0.02 µGy/day/Pa in the E detector (Guo et al. 2015).
- The model's water-phantom absorbed dose changes by −0.0026 µGy/day/Pa near Gale, about 50× weaker, and its H+He part has the opposite sign.
- The comparison is between different detector materials (RAD E plastic inside the rover against a 15 cm water sphere), geometries and observing conditions (diurnal pressure changes against whole-year simulations at fixed pressures). So it is **not a direct validation failure**. It is a limitation: the model's small pressure dependence, and with it the small regional differences, is model-dependent and not validated.
- HZETRN (Guo et al. 2017) gives a stronger dependence than AtRIS and the opposite sign for dose equivalent against depth.

**Independent predictive validation at Jezero or Olympus Mons:** impossible. No ionizing-radiation detector has operated there. Perseverance's MEDA Radiation and Dust Sensor measures sunlight, not particles.

Agreement at Gale does not make the Jezero or Olympus Mons values accurate predictions.

## 6. Uncertainty budget (each term with its kind and source)

| Term | Kind | Value | Source |
|---|---|---|---|
| Scatter of the published curves | indicator (not a verified interval) | 0.9–1.2 % | derived from the tables |
| Seasonal pressure (Ls 150–255) | range | evaluated per site across the whole seasonal span | MCD v6.2 |
| Olympus pressure | assumption | ±10 % | atmosphere review judgment; no measurement above about 4 km on Mars |
| Solar modulation | scenario | 400/700/1000 MV, or 580 MV only | Zhang et al. (2022) |
| Transport model choice | not quantified | AtRIS and HZETRN disagree on the sign of dose equivalent against depth | Guo et al. (2017) |

Ranges and assumptions are never added in quadrature or relabelled as 1σ.

## 7. Blockers: what is not calculated, and what would be needed

1. **RAD-E plastic dose at Jezero and Olympus Mons.** Needs a transport calculation of the RAD E detector response against atmospheric depth, for example an AtRIS or Geant4 run with the RAD geometry at 2–30 g/cm².
2. **Absorbed dose and dose equivalent at φ ≠ 580 MV.** Needs per-species BON2010 spectra at arbitrary φ (the archive has 400 and 1000 MV only, with heavy ions lumped) or the BON2010 code.
3. **Terrain shielding of dose outside Gale.** Needs zenith-angle-resolved surface tables at those pressures. The Gale tables (Zenodo 4701689) exist only for a 21 g/cm² column.
4. **Independent rerun of the transport model.** The AtRIS repository host did not resolve; values are reproduced from published tables, not recomputed.
5. **Regional solar particle events.** No SPE response at these pressures was reproduced; see [SPE_FEASIBILITY.md](SPE_FEASIBILITY.md). Steady GCR and SPE remain separate, and the GCR terrain factor is not used for storms.
6. **Olympus pressure validation.** Needs any in-situ pressure measurement above about 4 km.
7. **Walking routes at Jezero and Olympus Mons.** Needs metre-scale DEMs; the 1.8 GB HiRISE Jezero mosaic would serve a defined study site.

## 8. Findings about the existing Gale model (documented, not changed)

The numerical review found no bug affecting the Gale relative (terrain) results. It found three issues affecting absolute values. Because verified Gale calculations are not changed without need, they are recorded here with their size rather than applied silently.

| Issue | Location | Effect |
|---|---|---|
| Plain sum instead of trapezoid rule over zenith nodes | `radiation.py` | Absolute full-sky dose is 0.45 % high (H) and 0.22 % high (He); relative results are unaffected. A test at 1 % tolerance hides it. |
| Solar modulation extrapolated linearly outside 400–800 MV | `radiation.py` | The API accepts 350–900 MV. Against a power-law fit, extrapolation is 3.6 % low at 350 MV and 3.4 % low at 900 MV. |
| Gale zenith tables are for one atmosphere (21 g/cm²) | — | Now recorded here and in the radiation module. |
| Stale test references in comments | `radiation.py`, `horizon.py`, `ingest.py` | Fixed. |

## 9. Interface

- **Entry.** MarsShield now opens on the Mars overview: radiation framing, three region cards stating each region's radiation evidence, and the comparison.
- **Case study.** The Maria Gordon Notch story is an optional Gale case study, from the Gale card or the top bar in Gale. It is never forced.
- **Shared assumptions.** The quantity, solar modulation, season and mission duration are set once and apply to every site and every region view.
- **Analysis dock:**
  - dose against pressure, with the published nodes and a ±2× table-scatter band (not a confidence interval);
  - a comparison table with seasonal and assumption ranges and a beyond- or within-table-scatter label against Gale;
  - CSV and research-package downloads (README, comparison.csv, model_tables.json, scenario.json).
- **Jezero and Olympus Mons workspaces:** tabbed (Radiation, Terrain, Sources and limits), one scroll level each. The radiation tab shows the atmosphere overhead, the shared assumptions, and a click-to-evaluate location dose (exploratory). The comparison sits in the dock and the profiles in the Terrain tab.
- **Capability matrices:** grouped into Radiation evidence, Atmosphere and Terrain data, so a validated elevation model is never read as validated radiation.

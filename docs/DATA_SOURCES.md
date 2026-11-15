# Data sources and provenance

Every downloaded file sits under `data/raw/` with a `.json` sidecar giving its URL, read window and retrieval time.
Rerun everything with `python -m marsshield.pipeline` from `science/`. Downloads are cached.

| Data | Type | Access | What we used |
|---|---|---|---|
| [USGS MSL Gale Merged DEM 1 m v3](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m) | terrain | `asc-pds-services` S3 object (redirect target of planetarymaps.usgs.gov), byte ranges | 1 m crop, 5.8 × 5.9 km (46 MB); 8 m point-sampled mid field, ±25 km (28 MB) |
| [USGS HRSC/MOLA blended DEM 200 m v2](https://astrogeology.usgs.gov/search/map/mars_mgs_mola_mex_hrsc_blended_dem_global_200m) | terrain | same, byte ranges | 2° × 2.6° window (0.5 MB) |
| [NASA MSL RAD Level 2 observation dosimetry](https://data.nasa.gov/dataset/mars-science-laboratory-msl-radiation-assessment-detector-rad-level-2-observation-dosimetr-e2695) | **observation** | SPDF `pub/data/aaa_planetary/msl/rad/cdf/obs-l2/` daily CDF v04 | detector E dose rate, µGy/day; sols 1430–1475 and 1730–3885 (about 2 200 files) |
| [NASA PDS MSL REMS MODRDR v1](https://pds-atmospheres.nmsu.edu/PDS/data/mslrem_1001/DATA/) (MSL-M-REMS-5-MODRDR-V1.0, Gómez-Elvira et al. 2012) | **observation** | PDS Atmospheres node, per-sol `.LBL`/`.TAB`, HTTP multi-range requests (`science/marsshield/rems.py`) | surface PRESSURE and PS_CONFIDENCE_LEVEL, 180 records per sol, sols 1720–3895; cached as `data/raw/rems/sol_XXXXX.json` with source URLs. The CAB outreach weather JSON was rejected as unsuitable for science use |
| [NASA/JPL MMGIS MSL waypoints](https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json) | rover localisation | JSON | positions for each RAD period and every stop |
| [Guo et al. 2021 Zenodo data](https://doi.org/10.5281/zenodo.4701689) | published model + mask | Zenodo API | zenith-angle dose curves (Fig1_a/b), Butte M12 horizon mask (FIg2), ring ratios (Fig4a), per-zenith dose (Fig4b) |
| [Guo et al. 2026, JGR Planets](https://doi.org/10.1029/2026JE009704) | published analysis (CC-BY) | open copy on DLR eLib | method; Table 1 used for validation only (`science/marsshield/published.py`) |
| [Charpentier et al. 2026, JGR Planets](https://doi.org/10.1029/2025JE009336) | published analysis | abstract (OpenAlex), HAL preprint (download incomplete) | context on neutron response; not used numerically |
| [Guo et al. 2015, ApJ 810, 24](https://doi.org/10.1088/0004-637X/810/1/24) | published observation | — | RAD dose-rate vs pressure coefficient (−0.13 ± 0.02 µGy/day/Pa, detector E), used for comparison only |
| [Ehresmann et al. 2021, JGR Planets](https://doi.org/10.1029/2021JE006851) | published observation | abstract (OpenAlex) | Butte M12: 19 % of sky blocked, −4 % dose rate |
| [NASA Mars Trek](https://trek.nasa.gov/mars/) | context | — | no data ingested; the USGS DEM is the authoritative terrain product |

## Access notes and blockers

* Wiley returns HTTP 403 to automated clients. Guo et al. (2026) was read from the open DLR eLib copy.
  The Charpentier et al. (2026) HAL PDF arrived truncated, so only its abstract informed this work.
* `planetarymaps.usgs.gov` redirects to S3, and GDAL's curl driver failed on the redirect.
  The pipeline reads the S3 URL directly. It is the same object.
* The φ (modulation potential) for each RAD period is taken from Guo et al. (2026) Table 1, who derived it from TGO Liulin-MO.
  We did not ingest TGO data. For route planning, φ is a user parameter (400–800 MV).

## Added for the science Marswalk and imagery

| Data | Type | Used for |
|---|---|---|
| [USGS MSL Gale Merged Orthophoto Mosaic 25 cm v3](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_orthophoto_mosaic_25cm) | imagery (MRO HiRISE) | Orbital image layer and WebGL fallback; walk area only, 4×4 averaged to 1 m |
| [Bennett et al. (2023) JGR Planets 128, e2022JE007185](https://doi.org/10.1029/2022JE007185), open copy on NASA NTRS (fetched by the pipeline) | published science | Objectives, sol ranges and results for Hutton, Edinburgh, Glasgow, Bloodstone Hill, Mary Anning, Groken, Nontron |
| [Fraeman (2021) Sols 3323-3325: In the Shadow of Maria Gordon Notch](https://science.nasa.gov/blogs/sols-3323-3325-in-the-shadow-of-maria-gordon-notch) | NASA MSL blog | Maria Gordon Notch objective (DAN) and what to look for |
| [Guzewich (2021) Sol 3060: The Vastness of Time](https://science.nasa.gov/missions/mars-science-laboratory/sol-3060-the-vastness-of-time/) | NASA MSL blog | ChemCam study of the Mont Mercou cliff |
| [NASA/JPL (2022) Curiosity reaches long-awaited salty region](https://www.jpl.nasa.gov/news/nasas-curiosity-mars-rover-reaches-long-awaited-salty-region/) | NASA/JPL release | Canaima sample (sol 3612) and Paraitepuy Pass |
| [Hassler et al. (2014) Science 343, 1244797](https://doi.org/10.1126/science.1244797); [Zeitlin et al. (2013) Science 340, 1080](https://doi.org/10.1126/science.1235989) | published RAD measurements | Dose-magnitude context (surface and cruise averages) |

The open-access PDFs of Guo et al. (2026) and Bennett et al. (2023) are downloaded and converted to text by
`ingest.fetch_papers()` (pypdf, pinned in requirements.txt). The audit runs on that text. The paper texts are not committed.

"""Central configuration: data sources, study-area geometry, physical constants.

Every external input used by the pipeline is listed here with its provenance so the
whole analysis can be re-run from scratch (`python -m marsshield.pipeline`).
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
RAW = DATA / "raw"
PROC = DATA / "processed"
WEB_PUBLIC = ROOT / "web" / "public" / "data"

# --------------------------------------------------------------------------------------
# Source data (all public; see docs/DATA_SOURCES.md)
# --------------------------------------------------------------------------------------
# USGS Astrogeology: "Mars MSL Gale Merged DEM 1m" (v3). Landing page:
#   https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m
# planetarymaps.usgs.gov redirects to this S3 object; we read byte ranges with GDAL /vsicurl/.
GALE_DEM_1M_URL = (
    "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSL/"
    "MSL_Gale_DEM_Mosaic_1m_v3.tif"
)
# USGS Astrogeology: "Mars MSL Gale Merged Orthophoto Mosaic 25cm" (v3), co-registered with the DEM.
#   https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_orthophoto_mosaic_25cm
GALE_ORTHO_25CM_URL = (
    "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSL/"
    "MSL_Gale_Orthophoto_Mosaic_25cm_v3.tif"
)
# USGS Astrogeology: Mars HRSC MOLA Blended DEM Global 200m v2 (far-field horizon only).
HRSC_MOLA_200M_URL = (
    "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/HRSC_MOLA_Blend/"
    "Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif"
)
# NASA/JPL MMGIS Curiosity localized waypoints (easting/northing in the same Mars 2000
# sphere equirectangular projection as the Gale DEM).
MSL_WAYPOINTS_URL = "https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json"
# NASA SPDF: MSL RAD Level 2 observation dosimetry (daily CDF files).
RAD_L2_BASE = "https://spdf.gsfc.nasa.gov/pub/data/aaa_planetary/msl/rad/cdf/obs-l2"
# Zenodo: Guo (2021) data for "Directionality of the Martian surface radiation and
# derivation of the upward albedo radiation" (GRL 48, e2021GL093912), doi:10.5281/zenodo.4701689
ZENODO_GUO2021 = "https://zenodo.org/api/records/4701689/files/{name}/content"
ZENODO_FILES = ["Fig1_a.txt", "Fig1_b.txt", "FIg2.txt", "Fig4a.txt", "Fig4b.txt"]

# --------------------------------------------------------------------------------------
# Geometry
# --------------------------------------------------------------------------------------
MARS_RADIUS_M = 3396190.0  # Mars 2000 sphere (IAU/IAG), radius of the DEM's datum

# Study area: Glen Torridon / Greenheugh pediment / Mt Mercou / Maria Gordon Notch /
# Paraitepuy, plus Butte M12 (Murray Buttes). Bounds in DEM projected metres.
NEAR_BOUNDS = dict(left=8140600.0, right=8146400.0, bottom=-283200.0, top=-277300.0)
# Mid-field: 1 m DEM decimated to 8 m within +/-25 km of the study centre.
MID_STEP = 8
MID_HALF_SIZE_M = 25000.0
STUDY_CENTRE = (8143500.0, -280250.0)
# Far-field: HRSC/MOLA blend window (degrees).
FAR_LON = (136.6, 138.6)
FAR_LAT = (-6.2, -3.6)

# Terrain-visualisation / routing subregion (the astronaut walk area).
WALK_BOUNDS = dict(left=8142400.0, right=8145900.0, bottom=-282700.0, top=-279700.0)

# RAD sensor height above ground used by Guo et al. (2026) for their sky maps.
RAD_HEIGHT_M = 1.0
# Default astronaut "dose reference point" height (approx. chest height of a suited human).
ASTRONAUT_HEIGHT_M = 1.5

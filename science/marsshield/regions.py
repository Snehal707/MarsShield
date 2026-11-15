"""Regional Mars terrain beyond Gale: a global overview and two regions, described by manifests.

Run: python -m marsshield.regions  (downloads about 12 MB plus window reads of the 200 m blend)

Every region is exported as the same small set of static files under web/public/data/regions/<id>/:
  manifest.json    sources, capability matrix, grid description, layers, landmarks, checks
  elev.i16         little-endian int16 elevation grid (scale/offset in the manifest), nodata -32768
  *.jpg / *.png    draped layers (relief, slope, sky blocked, geologic units), same footprint as the grid
plus aux grids (slope, units) where a readout needs them. The browser loads a region only when opened.

Capability labels (one definition everywhere):
  validated   an authentic data product, or a direct geometric derivative of one (slope, profile) at a
              scale the data resolve, with a published accuracy assessment
  exploratory computed by MarsShield with a model that has not been tested against measurements here
  unavailable not offered; the reason is stated

Nothing here assigns Curiosity RAD data, or any radiation validation, to a region other than Gale.

Horizontal frames. Both source products use equidistant cylindrical coordinates with the standard
parallel at the equator (or plain degrees), which stretch east-west distances by 1/cos(latitude):
5.4 % at Jezero (18.4 deg N) and 5.6 % at Olympus Mons (18.6 deg N). Grids here are exported in a local
true-scale frame x = R cos(lat_c) dlon, y = R dlat (residual scale error +/-0.3 % across Jezero,
+/-0.6 % across the Olympus caldera), and slopes use the exact east-west spacing of each row.
"""
from __future__ import annotations

import datetime as dt
import io
import json
import math
import struct
import zipfile
from pathlib import Path

import numpy as np
import rasterio
import requests
from PIL import Image, ImageDraw
from rasterio.windows import from_bounds
from scipy import ndimage

from . import config as C

R = C.MARS_RADIUS_M
RAW = C.RAW / "regions"
OUT = C.WEB_PUBLIC / "regions"
UA = {"User-Agent": "MarsShield-research-pipeline/1.0"}

MOLA_MEGDR_4PPD = "https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg004/megt90n000cb.img"
JEZ_CTX_DTM = ("https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/CTX/"
               "JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif")
JEZ_HIRISE_DTM = ("https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/HiRISE/"
                  "JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif")
M20_WAYPOINTS = "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json"
SIM3470_GIS = "https://pubs.usgs.gov/sim/3470/sim3470_gis_files.zip"
SIM3470_CITE = ("Mouginis-Mark, P.J., 2021, Geologic map of Olympus Mons caldera, Mars: U.S. Geological Survey "
                "Scientific Investigations Map 3470, scale 1:200,000, https://doi.org/10.3133/sim3470")

STATUS_DEF = {
    "validated": "An authentic data product, or a direct geometric derivative of one (slope, profile) at a scale the data resolve, with a published accuracy assessment.",
    "exploratory": "Computed by MarsShield with a model that has not been tested against measurements in this region.",
    "unavailable": "Not offered here; the reason is stated.",
}


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def _get(url: str, path: Path) -> Path:
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        r = requests.get(url, headers=UA, timeout=600)
        r.raise_for_status()
        path.write_bytes(r.content)
    return path


# --------------------------------------------------------------------------------------
# raster helpers
# --------------------------------------------------------------------------------------
def slope_deg(z: np.ndarray, dx_rows: np.ndarray, dy: float) -> np.ndarray:
    """Slope in degrees by central differences; dx_rows is the true east-west spacing of each row."""
    gy, gx = np.gradient(z)
    return np.degrees(np.arctan(np.hypot(gx / dx_rows[:, None], gy / dy)))


def hillshade(z: np.ndarray, dx_rows: np.ndarray, dy: float, exag: float = 1.0, az: float = 315.0, alt: float = 40.0) -> np.ndarray:
    gy, gx = np.gradient(z * exag)
    sx, sy = gx / dx_rows[:, None], -gy / dy        # rows run north to south
    a, e = math.radians(az), math.radians(alt)
    n = np.sqrt(1 + sx**2 + sy**2)
    lx, ly, lz = math.sin(a) * math.cos(e), math.cos(a) * math.cos(e), math.sin(e)
    return np.clip((-sx * lx - sy * ly + lz) / n, 0, 1)


# one warm ramp for elevation (low umber to pale tan), shared by every region
HYPSO = np.array([[58, 38, 30], [104, 66, 46], [150, 98, 64], [186, 140, 98], [214, 186, 150], [236, 222, 200]], float)


def ramp(v: np.ndarray, stops: np.ndarray) -> np.ndarray:
    v = np.clip(np.nan_to_num(v, nan=0.0), 0, 1) * (len(stops) - 1)
    i = np.minimum(v.astype(int), len(stops) - 2)
    f = (v - i)[..., None]
    return stops[i] * (1 - f) + stops[i + 1] * f


def relief_rgb(z: np.ndarray, hs: np.ndarray, lo: float, hi: float) -> np.ndarray:
    rgb = ramp((z - lo) / (hi - lo), HYPSO) * (0.35 + 0.75 * hs[..., None])
    rgb[np.isnan(z)] = [23, 19, 16]
    return np.clip(rgb, 0, 255).astype(np.uint8)


SLOPE_STOPS = np.array([[44, 36, 30], [96, 112, 92], [201, 168, 74], [214, 120, 52], [190, 50, 40]], float)


def slope_rgb(s: np.ndarray, hs: np.ndarray, smax: float) -> np.ndarray:
    rgb = ramp(s / smax, SLOPE_STOPS) * (0.55 + 0.5 * hs[..., None])
    rgb[np.isnan(s)] = [23, 19, 16]
    return np.clip(rgb, 0, 255).astype(np.uint8)


def save_jpg(path: Path, rgb: np.ndarray, max_px: int = 2048, q: int = 84) -> dict:
    im = Image.fromarray(rgb)
    if max(im.size) > max_px:
        k = max_px / max(im.size)
        im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, quality=q, optimize=True, progressive=True)
    return {"file": path.name, "px": [im.width, im.height], "bytes": path.stat().st_size}


def save_grid_i16(path: Path, z: np.ndarray, scale: float, offset: float) -> dict:
    q = np.round((z - offset) / scale)
    q[np.isnan(z)] = -32768
    q = np.clip(q, -32768, 32767).astype("<i2")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(q.tobytes())
    return {"file": path.name, "w": int(z.shape[1]), "h": int(z.shape[0]), "dtype": "int16le", "scale": scale, "offset": offset,
            "nodata": -32768, "bytes": path.stat().st_size}


def save_grid_u8(path: Path, a: np.ndarray, scale: float) -> dict:
    q = np.clip(np.round(np.nan_to_num(a, nan=255 * scale) / scale), 0, 255).astype(np.uint8)
    path.write_bytes(q.tobytes())
    return {"file": path.name, "w": int(a.shape[1]), "h": int(a.shape[0]), "dtype": "uint8", "scale": scale, "nodata": 255, "bytes": path.stat().st_size}


def block_mean(a: np.ndarray, k: int) -> np.ndarray:
    h, w = (a.shape[0] // k) * k, (a.shape[1] // k) * k
    return np.nanmean(a[:h, :w].reshape(h // k, k, w // k, k), axis=(1, 3))


def sky_blocked(z: np.ndarray, dx: float, dy: float, n_az: int = 32, r_max: float = 15000.0, h_obs: float = 1.0) -> np.ndarray:
    """Exploratory: fraction of the upper-hemisphere solid angle hidden by terrain, mean_az sin(max horizon angle),
    the definition used for Gale (horizon.blocked_solid_angle_exact), with Mars curvature. Grid-scale only."""
    hgt, wid = z.shape
    rr, cc = np.mgrid[0:hgt, 0:wid].astype(np.float32)
    zf = np.where(np.isnan(z), np.nanmin(z), z).astype(np.float32)
    dists = np.unique(np.round(np.geomspace(min(dx, dy), r_max, 70), 1))
    out = np.zeros_like(zf)
    for k in range(n_az):
        a = 2 * math.pi * k / n_az
        best = np.zeros_like(zf)
        for r in dists:
            c = cc + (r * math.sin(a)) / dx
            q = rr - (r * math.cos(a)) / dy
            zz = ndimage.map_coordinates(zf, [q, c], order=1, mode="nearest")
            inside = (c >= 0) & (c <= wid - 1) & (q >= 0) & (q <= hgt - 1)
            ang = (zz - (zf + h_obs) - r * r / (2 * R)) / r
            best = np.where(inside, np.maximum(best, ang), best)
        out += np.sin(np.arctan(best))
    b = out / n_az
    b[np.isnan(z)] = np.nan
    return b


# --------------------------------------------------------------------------------------
# shapefile reader (polygons and polylines; enough for the SIM 3470 layers)
# --------------------------------------------------------------------------------------
def read_shp(shp: bytes, dbf: bytes) -> list[dict]:
    nrec, hlen, rlen = struct.unpack("<IHH", dbf[4:12])
    fields = []
    for i in range(32, hlen - 1, 32):
        f = dbf[i:i + 32]
        fields.append((f[:11].split(b"\0")[0].decode(), f[16]))
    recs = []
    for r in range(nrec):
        rec, off, row = dbf[hlen + r * rlen: hlen + (r + 1) * rlen], 1, {}
        for name, ln in fields:
            row[name] = rec[off:off + ln].decode("latin1").strip()
            off += ln
        recs.append(row)
    feats, pos, i = [], 100, 0
    while pos < len(shp):
        _, clen = struct.unpack(">ii", shp[pos:pos + 8])
        body = shp[pos + 8: pos + 8 + clen * 2]
        pos += 8 + clen * 2
        st = struct.unpack("<i", body[:4])[0]
        if st in (3, 5, 13, 15):
            nparts, npts = struct.unpack("<ii", body[36:44])
            parts = list(struct.unpack(f"<{nparts}i", body[44:44 + 4 * nparts])) + [npts]
            pts = np.frombuffer(body[44 + 4 * nparts: 44 + 4 * nparts + 16 * npts], "<f8").reshape(-1, 2)
            feats.append({"type": "polygon" if st in (5, 15) else "line", "rings": [pts[parts[j]:parts[j + 1]] for j in range(nparts)], **recs[i]})
        i += 1
    return feats


def tm_inverse(x: np.ndarray, y: np.ndarray, lon0: float, k0: float = 1.0) -> tuple[np.ndarray, np.ndarray]:
    """Inverse transverse Mercator on a sphere of radius R (degrees)."""
    D, Y = x / (k0 * R), y / (k0 * R)
    lat = np.degrees(np.arcsin(np.sin(Y) / np.cosh(D)))
    lon = lon0 + np.degrees(np.arctan2(np.sinh(D), np.cos(Y)))
    return lon, lat


def simplify(pts: np.ndarray, tol: float) -> np.ndarray:
    """Douglas-Peucker on an (n, 2) array."""
    if len(pts) < 3:
        return pts
    keep = np.zeros(len(pts), bool)
    keep[[0, -1]] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        p, q = pts[a], pts[b]
        d = q - p
        seg = pts[a + 1:b] - p
        L = math.hypot(*d)
        dist = np.abs(d[0] * seg[:, 1] - d[1] * seg[:, 0]) / L if L > 0 else np.hypot(seg[:, 0], seg[:, 1])
        k = int(np.argmax(dist))
        if dist[k] > tol:
            keep[a + 1 + k] = True
            stack += [(a, a + 1 + k), (a + 1 + k, b)]
    return pts[keep]


# --------------------------------------------------------------------------------------
# regions
# --------------------------------------------------------------------------------------
def local_frame(lon_c: float, lat_c: float):
    k = math.radians(1) * R
    def to_xy(lon, lat):
        return (np.asarray(lon) - lon_c) * k * math.cos(math.radians(lat_c)), (np.asarray(lat) - lat_c) * k
    return to_xy


def mars_overview() -> dict:
    """MOLA MEGDR 4 pixels/degree (PDS), recentred on 0 deg longitude."""
    img = _get(MOLA_MEGDR_4PPD, RAW / "mars" / "megt90n000cb.img")
    z = np.frombuffer(img.read_bytes(), ">i2").reshape(720, 1440).astype(np.float32)
    z = np.roll(z, 720, axis=1)                           # 0..360 E  ->  -180..180
    lat = 90 - (np.arange(720) + 0.5) / 4
    dy = R * math.radians(0.25)
    dx_rows = np.maximum(dy * np.cos(np.radians(lat)), 1000.0)
    hs = hillshade(z, dx_rows, dy, exag=12)
    out = OUT / "mars"
    lo, hi = float(np.percentile(z, 0.5)), float(np.percentile(z, 99.5))
    relief = save_jpg(out / "relief.jpg", relief_rgb(z, hs, lo, hi), max_px=1440, q=82)
    grid = save_grid_i16(out / "elev.i16", block_mean(z, 2), 1.0, 0.0)
    return {
        "id": "mars", "name": "Mars", "kind": "global", "summary": "Global elevation from the Mars Global Surveyor laser altimeter.",
        "frame": {"type": "lonlat", "lon": [-180, 180], "lat": [-90, 90]},
        "grid": {**grid, "cell_deg": 0.5, "note": "MOLA 4 pixels/degree averaged to 0.5 degree for the cursor readout"},
        "layers": [{"id": "relief", "name": "Relief", "kind": "image", **relief, "note": "Hillshade with 12x vertical exaggeration over hypsometric colour"}],
        "elevation_range_m": [round(float(np.nanmin(z))), round(float(np.nanmax(z)))],
        "sources": [{"name": "MGS MOLA Mission Experiment Gridded Data Record (MEGDR), 4 pixels per degree", "url": MOLA_MEGDR_4PPD,
                     "producer": "NASA PDS Geosciences Node (Smith et al., 2003)", "role": "Elevation relative to the areoid"}],
        "capabilities": CAPABILITIES["mars"],
    }


def jezero() -> dict:
    tif = _get(JEZ_CTX_DTM, RAW / "jezero" / "JEZ_ctx_B_soc_008_DTM_20m.tif")
    wp_path = _get(M20_WAYPOINTS, RAW / "jezero" / "M20_waypoints.json")
    with rasterio.open(tif) as d:
        z = d.read(1).astype(np.float32)
        z[(z < -1e30) | (z == d.nodata)] = np.nan
        b, res = d.bounds, d.res[0]
    lon = lambda x: np.degrees(np.asarray(x) / R)
    lat_top, lat_bot = float(lon(b.top)), float(lon(b.bottom))
    lon_l, lon_r = float(lon(b.left)), float(lon(b.right))
    lat_c, lon_c = (lat_top + lat_bot) / 2, (lon_l + lon_r) / 2
    lat_rows = np.degrees((b.top - (np.arange(z.shape[0]) + 0.5) * res) / R)
    dx_rows = res * np.cos(np.radians(lat_rows))          # true east-west spacing per row
    s20 = slope_deg(z, dx_rows, res)
    hs = hillshade(z, dx_rows, res, exag=2)
    out = OUT / "jezero"
    lo, hi = float(np.nanpercentile(z, 0.5)), float(np.nanpercentile(z, 99.5))
    layers = [
        {"id": "relief", "name": "Relief", "kind": "drape", **save_jpg(out / "relief.jpg", relief_rgb(z, hs, lo, hi)), "note": "CTX DTM 20 m, hillshade (2x) over elevation colour"},
        {"id": "slope", "name": "Slope", "kind": "drape", **save_jpg(out / "slope.jpg", slope_rgb(s20, hs, 35)), "ramp": {"lo": "0°", "hi": "35°+", "stops": SLOPE_STOPS.astype(int).tolist()},
         "note": "Slope over 20 m (one DTM post); steps and boulders smaller than about 40 m are not resolved"},
    ]
    k = 3                                                   # 60 m grid for the mesh and readouts
    zg = block_mean(z, k)
    sg = block_mean(s20, k)
    to_xy = local_frame(lon_c, lat_c)
    gx0, gy0 = to_xy(lon_l, lat_top)
    cell_x, cell_y = res * k * math.cos(math.radians(lat_c)), res * k
    grid = save_grid_i16(out / "elev.i16", zg, 0.1, float(np.nanmin(zg)) - 1)
    slope_grid = save_grid_u8(out / "slope.u8", sg, 0.5)
    # exploratory: sky blocked at the 60 m grid scale
    sky = sky_blocked(zg, cell_x, cell_y)
    hs_g = block_mean(hs, k)
    sky_stops = np.array([[217, 217, 217], [140, 150, 180], [38, 56, 115]], float)
    sky_rgb = np.clip(ramp(sky / 0.25, sky_stops) * (0.6 + 0.45 * hs_g[..., None]), 0, 255).astype(np.uint8)
    layers.append({"id": "sky", "name": "Sky blocked (exploratory)", "kind": "drape", **save_jpg(out / "sky.jpg", sky_rgb),
                   "ramp": {"lo": "0 %", "hi": "25 %+", "stops": sky_stops.astype(int).tolist()}, "exploratory": True,
                   "note": "Share of the sky hidden by terrain within 15 km, computed on the 60 m grid: walls narrower than about 100 m are missed"})
    sky_grid = save_grid_u8(out / "sky.u8", sky * 100, 0.5)

    # Perseverance localized waypoints (NASA/JPL MMGIS), converted from lon/lat
    feats = json.loads(wp_path.read_text())["features"]
    wps = sorted(({"sol": f["properties"]["sol"], "rmc": f["properties"]["RMC"], "lon": f["properties"]["lon"], "lat": f["properties"]["lat"],
                   "z": f["properties"].get("elev_geoid"),
                   "km": f["properties"].get("dist_total_m", 0) / 1000} for f in feats), key=lambda w: (w["sol"], w["rmc"]))
    inside = [w for w in wps if lon_l <= w["lon"] <= lon_r and lat_bot <= w["lat"] <= lat_top]
    px, py = to_xy([w["lon"] for w in inside], [w["lat"] for w in inside])
    # co-registration check: DTM elevation (20 m posts, bilinear) at each waypoint against its localized elevation
    cols = (np.radians([w["lon"] for w in inside]) * R - b.left) / res - 0.5
    rows = (b.top - np.radians([w["lat"] for w in inside]) * R) / res - 0.5
    zd = ndimage.map_coordinates(np.nan_to_num(z, nan=np.nanmin(z)), [rows, cols], order=1)
    dz = np.array([zd[i] - w["z"] for i, w in enumerate(inside) if w["z"] is not None and w["z"] > -9000])
    trav = np.column_stack([px, py])
    trav_s = simplify(trav, 8.0)
    first, last = inside[0], inside[-1]
    lm = lambda name, w, kind, note: {"name": name, "kind": kind, "x": round(float(to_xy(w["lon"], w["lat"])[0]), 1),
                                       "y": round(float(to_xy(w["lon"], w["lat"])[1]), 1), "lon": w["lon"], "lat": w["lat"], "note": note}
    zmax_i = np.unravel_index(np.nanargmax(zg), zg.shape)
    zmin_i = np.unravel_index(np.nanargmin(zg), zg.shape)
    cell = lambda ij: (gx0 + (ij[1] + 0.5) * cell_x, gy0 - (ij[0] + 0.5) * cell_y)
    return {
        "id": "jezero", "name": "Jezero Crater", "kind": "regional",
        "summary": "Perseverance's landing site and traverse on the USGS Mars 2020 CTX elevation model.",
        "frame": {"type": "local", "lon_c": lon_c, "lat_c": lat_c, "lon": [lon_l, lon_r], "lat": [lat_bot, lat_top],
                  "note": "x = R cos(lat_c) dlon, y = R dlat on the 3,396,190 m sphere; east-west scale error within +/-0.3 % across the region"},
        "grid": {**grid, "x0": round(gx0, 1), "y0": round(gy0, 1), "dx": round(cell_x, 2), "dy": cell_y, "source_res_m": res,
                 "note": "20 m DTM averaged to 60 m for the 3D mesh and readouts; layers keep 20 m detail"},
        "aux": {"slope": {**slope_grid, "unit": "deg", "note": "20 m slope averaged over 60 m cells"},
                "sky": {**sky_grid, "unit": "%", "exploratory": True}},
        "layers": layers,
        "elevation_range_m": [round(float(np.nanmin(z))), round(float(np.nanmax(z)))],
        "traverse": {"name": "Perseverance traverse", "sol_range": [first["sol"], last["sol"]], "n_waypoints": len(inside),
                     "xy": [[round(float(x), 1), round(float(y), 1)] for x, y in trav_s],
                     "waypoints": [[round(float(x), 1), round(float(y), 1), (round(w["z"], 1) if w["z"] is not None and w["z"] > -9000 else None), w["sol"]]
                                   for x, y, w in zip(px, py, inside)],
                     "waypoint_fields": ["x_m", "y_m", "elev_m (rover, areoid)", "sol"],
                     "source": "NASA/JPL MMGIS Mars 2020 localized waypoints"},
        "landmarks": [
            lm("First localized position", first, "rover", f"Sol {first['sol']}, waypoint {first['rmc']}: {first.get('z') or 0:.0f} m. The rover had not moved since landing (waypoint note)."),
            lm(f"Latest waypoint, sol {last['sol']}", last, "rover", f"Waypoint {last['rmc']}, {last['z']:.0f} m, after {last['km']:.1f} km of driving since landing."),
            {"name": "Highest point in this DTM", "kind": "terrain", "x": round(cell(zmax_i)[0], 1), "y": round(cell(zmax_i)[1], 1),
             "note": f"{np.nanmax(zg):.0f} m (60 m cell mean)"},
            {"name": "Lowest point in this DTM", "kind": "terrain", "x": round(cell(zmin_i)[0], 1), "y": round(cell(zmin_i)[1], 1),
             "note": f"{np.nanmin(zg):.0f} m (60 m cell mean)"},
        ],
        "checks": [{"name": "DTM against rover elevations", "n": int(len(dz)), "median_m": round(float(np.median(dz)), 1),
                    "p05_p95_m": [round(float(np.percentile(dz, 5)), 1), round(float(np.percentile(dz, 95)), 1)],
                    "note": "DTM elevation at each localized waypoint minus the waypoint's elevation (both relative to the areoid). A consistency check of the two products, not an accuracy assessment of either."}],
        "sources": [
            {"name": "Mars 2020 Terrain Relative Navigation CTX DTM mosaic, 20 m (JEZ_ctx_B_soc_008)", "url": JEZ_CTX_DTM,
             "producer": "USGS Astrogeology (Fergason et al., 2020)", "role": "Elevation"},
            {"name": "Mars 2020 localized waypoints", "url": M20_WAYPOINTS, "producer": "NASA/JPL MMGIS", "role": "Rover positions and elevations"},
            {"name": "Mars 2020 TRN HiRISE DTM mosaic, 1 m", "url": JEZ_HIRISE_DTM, "producer": "USGS Astrogeology",
             "role": "Evaluated, not used: 1.8 GB; a 1 m inset needs a defined study site (see docs/REGIONS.md)"},
        ],
        "capabilities": CAPABILITIES["jezero"],
    }


def olympus() -> dict:
    zpath = _get(SIM3470_GIS, RAW / "olympus" / "sim3470_gis_files.zip")
    url = "/vsicurl/" + C.HRSC_MOLA_200M_URL
    W, E, S, N = -134.1, -132.1, 17.0, 19.2                 # SIM 3470 map bounds
    with rasterio.open(url) as d:
        win = from_bounds(W, S, E, N, d.transform).round_offsets().round_lengths()
        z = d.read(1, window=win).astype(np.float32)
        z[z == d.nodata] = np.nan
        tr = d.window_transform(win)
        # whole volcano at 1.6 km cells, from the product's internal overview
        ow, oe, os_, on = -140.0, -127.0, 12.0, 25.0
        vwin = from_bounds(ow, os_, oe, on, d.transform).round_offsets().round_lengths()
        zv = d.read(1, window=vwin, out_shape=(int(vwin.height // 8), int(vwin.width // 8))).astype(np.float32)
        zv[zv == d.nodata] = np.nan
    lon_l, lat_t, deg = tr.c, tr.f, tr.a
    lon_r, lat_b = lon_l + deg * z.shape[1], lat_t - deg * z.shape[0]
    lat_c, lon_c = (lat_t + lat_b) / 2, (lon_l + lon_r) / 2
    dy = R * math.radians(deg)
    lat_rows = lat_t - (np.arange(z.shape[0]) + 0.5) * deg
    dx_rows = dy * np.cos(np.radians(lat_rows))
    s = slope_deg(z, dx_rows, dy)
    hs = hillshade(z, dx_rows, dy, exag=3)
    out = OUT / "olympus"
    lo, hi = float(np.nanpercentile(z, 0.5)), float(np.nanpercentile(z, 99.5))
    to_xy = local_frame(lon_c, lat_c)
    gx0, gy0 = to_xy(lon_l, lat_t)
    cell_x = dy * math.cos(math.radians(lat_c))

    # geologic map: units rasterised onto the grid (for the readout) and drawn as a draped layer
    zf = zipfile.ZipFile(zpath)
    base = "sim3470_OlympusMons_GISFiles/Shapefiles/"
    units = read_shp(zf.read(base + "sim3470_GeoUnits.shp"), zf.read(base + "sim3470_GeoUnits.dbf"))
    lines = read_shp(zf.read(base + "sim3470_LinearFeatures.shp"), zf.read(base + "sim3470_LinearFeatures.dbf"))
    UNIT = {  # names and descriptions follow the SIM 3470 pamphlet
        "Aoc1": ("Zeus Patera floor", "Caldera floor; highest near the east wall, lowest in the centre"),
        "Aoc2": ("Hera Patera floor", "Caldera floor; formed after Zeus Patera"),
        "Aoc3": ("Hermes and Dionysus Paterae floor", "Two connected depressions west of Zeus Patera; radial ridges"),
        "Aoc4": ("Athena Patera floor", "Near-circular 20 × 22 km pit at the northeast of the caldera"),
        "Aoc5": ("Apollo Patera floor", "12 × 16 km pit at the southwest end; the deepest wall (about 2.9 km)"),
        "Aos1": ("Undifferentiated summit lava flows", "Oldest surface unit, covering most of the summit"),
        "Aos2": ("Differentiated lava flows", "A few hundred flows with mappable lobate margins radiating from the caldera"),
        "Aw": ("Caldera wall material", "Layered rock exposed in the caldera walls (unit Aow in the pamphlet)"),
        "Ap1": ("Pangboche crater floor", "Hummocky floor with blocks up to about 150 m"),
        "Ap2": ("Pangboche crater wall and rim", "Layered upper walls; ejecta blocks up to about 70 m on the rim"),
    }
    COLORS = {"Aoc1": (196, 120, 92), "Aoc2": (214, 150, 104), "Aoc3": (178, 98, 82), "Aoc4": (226, 176, 128), "Aoc5": (160, 84, 74),
              "Aos1": (128, 140, 104), "Aos2": (150, 168, 120), "Aw": (110, 92, 120), "Ap1": (98, 128, 160), "Ap2": (128, 156, 186)}
    order = list(UNIT)
    scale_px = 3                                              # unit raster at 3x the 200 m grid for the drape
    Hh, Ww = z.shape[0] * scale_px, z.shape[1] * scale_px
    img = Image.new("RGB", (Ww, Hh), (23, 19, 16))
    ids = Image.new("L", (z.shape[1], z.shape[0]), 0)
    dr, di = ImageDraw.Draw(img), ImageDraw.Draw(ids)
    to_px = lambda lon, lat, k: list(zip(((lon - lon_l) / deg * k).tolist(), ((lat_t - lat) / deg * k).tolist()))
    # draw larger polygons first so pits and small units stay on top
    area = lambda f: abs(float(f.get("SHAPE_Area") or 0))
    unit_counts = {}
    def feature_mask(rings_px: list, size: tuple) -> Image.Image:
        # shapefile rings: clockwise = outer boundary, counter-clockwise = hole (y up in map coordinates)
        m = Image.new("L", size, 0)
        md = ImageDraw.Draw(m)
        for pts, outer in rings_px:
            md.polygon(pts, fill=255 if outer else 0)
        return m

    for f in sorted(units, key=area, reverse=True):
        lab = f["Unit_label"]
        unit_counts[lab] = unit_counts.get(lab, 0) + 1
        rings_ll = []
        for ring in f["rings"]:
            x, y = ring[:, 0], ring[:, 1]
            signed = 0.5 * float(np.sum(x[:-1] * y[1:] - x[1:] * y[:-1]))
            lon, lat = tm_inverse(x, y, -134.0)
            rings_ll.append((lon, lat, signed < 0))
        col = COLORS.get(lab, (90, 90, 90))
        code = order.index(lab) + 1 if lab in order else 0
        m_big = feature_mask([(to_px(lo_, la_, scale_px), o) for lo_, la_, o in rings_ll], (Ww, Hh))
        img.paste(col, (0, 0, Ww, Hh), m_big)
        m_small = feature_mask([(to_px(lo_, la_, 1), o) for lo_, la_, o in rings_ll], (z.shape[1], z.shape[0]))
        ids.paste(code, (0, 0, z.shape[1], z.shape[0]), m_small)
        for lo_, la_, _ in rings_ll:
            dr.line(to_px(lo_, la_, scale_px), fill=(40, 32, 26), width=1)
    geo = np.asarray(img).astype(float) * (0.55 + 0.5 * np.repeat(np.repeat(hs, scale_px, 0), scale_px, 1)[..., None])
    gimg = Image.fromarray(np.clip(geo, 0, 255).astype(np.uint8))
    gd = ImageDraw.Draw(gimg)
    for f in lines:
        t = f.get("TYPE", "")
        col = (40, 30, 26) if "fault" in t else (230, 210, 170) if "ridge" in t else None
        if col is None:
            continue
        for ring in f["rings"]:
            lon, lat = tm_inverse(ring[:, 0], ring[:, 1], -134.0)
            gd.line(to_px(lon, lat, scale_px), fill=col, width=2)
    units_grid = np.asarray(ids)
    out.mkdir(parents=True, exist_ok=True)
    gimg.save(out / "units.jpg", quality=84, optimize=True, progressive=True)
    (out / "units.u8").write_bytes(units_grid.astype(np.uint8).tobytes())

    layers = [
        {"id": "relief", "name": "Relief", "kind": "drape", **save_jpg(out / "relief.jpg", relief_rgb(z, hs, lo, hi)), "note": "HRSC/MOLA blend 200 m, hillshade (3x) over elevation colour"},
        {"id": "slope", "name": "Slope", "kind": "drape", **save_jpg(out / "slope.jpg", slope_rgb(s, hs, 30)), "ramp": {"lo": "0°", "hi": "30°+", "stops": SLOPE_STOPS.astype(int).tolist()},
         "note": "Slope over 200 m; caldera walls are steeper over shorter distances than this grid can show"},
        {"id": "units", "name": "Geologic units (USGS SIM 3470)", "kind": "drape", "file": "units.jpg", "px": [Ww, Hh], "bytes": (out / "units.jpg").stat().st_size,
         "note": "Unit polygons from the 1:200,000 map; dark lines are mapped faults, pale lines ridge crests",
         "legend": [{"id": k, "name": UNIT[k][0], "desc": UNIT[k][1], "color": list(COLORS[k]), "polygons": unit_counts.get(k, 0)} for k in order]},
    ]
    grid = save_grid_i16(out / "elev.i16", z, 1.0, 0.0)
    slope_grid = save_grid_u8(out / "slope.u8", s, 0.5)

    # landmarks and checks derived from the DEM and the map
    zmax_i = np.unravel_index(np.nanargmax(z), z.shape)
    cell = lambda ij: (gx0 + (ij[1] + 0.5) * cell_x, gy0 - (ij[0] + 0.5) * dy)
    landmarks = [{"name": "Highest DEM cell", "kind": "terrain", "x": round(cell(zmax_i)[0], 1), "y": round(cell(zmax_i)[1], 1),
                  "note": f"{np.nanmax(z):,.0f} m in the 200 m blend (SIM 3470 gives 21,290 m from MOLA for the volcano's high point, south of the caldera)"}]
    floor_stats = []
    for k in ["Aoc1", "Aoc2", "Aoc3", "Aoc4", "Aoc5"]:
        m = units_grid == order.index(k) + 1
        if not m.any():
            continue
        zz = np.where(m, z, np.nan)
        ij = np.unravel_index(np.nanargmin(zz), z.shape)
        cy_, cx_ = np.argwhere(m).mean(axis=0)
        landmarks.append({"name": UNIT[k][0].replace(" floor", ""), "kind": "unit", "unit": k, "x": round(gx0 + (cx_ + 0.5) * cell_x, 1), "y": round(gy0 - (cy_ + 0.5) * dy, 1),
                          "note": f"Floor {np.nanmin(zz):,.0f} to {np.nanmax(zz):,.0f} m in the blend; centre of the mapped unit"})
        floor_stats.append({"unit": k, "name": UNIT[k][0], "min_m": round(float(np.nanmin(zz))), "max_m": round(float(np.nanmax(zz))), "cells": int(m.sum())})
    caldera = np.isin(units_grid, [order.index(k) + 1 for k in ["Aoc1", "Aoc2", "Aoc3", "Aoc4", "Aoc5", "Aw"]])
    rr, cc = np.argwhere(caldera).T
    ccy, ccx = rr.mean(), cc.mean()
    cxy = (gx0 + (ccx + 0.5) * cell_x, gy0 - (ccy + 0.5) * dy)
    profiles = [{"name": "West to east through the caldera", "a": [round(gx0 + 2 * cell_x, 1), round(cxy[1], 1)], "b": [round(gx0 + (z.shape[1] - 3) * cell_x, 1), round(cxy[1], 1)]},
                {"name": "North to south through the caldera", "a": [round(cxy[0], 1), round(gy0 - 2 * dy, 1)], "b": [round(cxy[0], 1), round(gy0 - (z.shape[0] - 3) * dy, 1)]}]

    # whole-volcano overview (1.6 km cells) as a context image
    vlat = np.linspace(on, os_, zv.shape[0])
    vdy = R * math.radians((on - os_) / zv.shape[0])
    vhs = hillshade(zv, vdy * np.cos(np.radians(vlat)), vdy, exag=6)
    vlo, vhi = float(np.nanpercentile(zv, 1)), float(np.nanpercentile(zv, 99.8))
    ctx = save_jpg(out / "context.jpg", relief_rgb(zv, vhs, vlo, vhi), max_px=900, q=82)
    return {
        "id": "olympus", "name": "Olympus Mons caldera", "kind": "regional",
        "summary": "The summit caldera of the largest volcano on Mars, with the USGS geologic map of its six paterae.",
        "frame": {"type": "local", "lon_c": lon_c, "lat_c": lat_c, "lon": [lon_l, lon_r], "lat": [lat_b, lat_t],
                  "note": "x = R cos(lat_c) dlon, y = R dlat on the 3,396,190 m sphere; east-west scale error within +/-0.6 % across the map"},
        "grid": {**grid, "x0": round(gx0, 1), "y0": round(gy0, 1), "dx": round(cell_x, 2), "dy": round(dy, 2), "source_res_m": round(dy, 1),
                 "note": "HRSC/MOLA blended DEM at its native 0.0034 degree (about 200 m) posts"},
        "aux": {"slope": {**slope_grid, "unit": "deg", "note": "slope over one 200 m post"},
                "units": {"file": "units.u8", "w": int(units_grid.shape[1]), "h": int(units_grid.shape[0]), "dtype": "uint8", "codes": order}},
        "layers": layers,
        "context": {**ctx, "lon": [ow, oe], "lat": [os_, on], "note": "Whole volcano, HRSC/MOLA blend overview at about 1.6 km per pixel; the box is the caldera map"},
        "elevation_range_m": [round(float(np.nanmin(z))), round(float(np.nanmax(z)))],
        "landmarks": landmarks,
        "profiles": profiles,
        "checks": [{"name": "Highest point against the published MOLA value", "value_m": round(float(np.nanmax(z))), "reference_m": 21290,
                    "note": "SIM 3470 (MOLA): the volcano's highest point is 21,290 m and lies outside the caldera; this compares the blend with that value, it does not validate either."},
                   {"name": "Caldera floor elevations by patera", "rows": floor_stats,
                    "note": "From the blend within each mapped unit; SIM 3470 describes Zeus Patera's floor as about 18,000 m at its centre and 19,500 m near the east wall."}],
        "sources": [
            {"name": "Mars HRSC MOLA Blended DEM Global 200 m v2", "url": C.HRSC_MOLA_200M_URL, "producer": "USGS Astrogeology (Fergason et al., 2018), from Mars Express HRSC and MGS MOLA", "role": "Elevation"},
            {"name": "Geologic map of Olympus Mons caldera (SIM 3470)", "url": "https://doi.org/10.3133/sim3470", "producer": SIM3470_CITE, "role": "Geologic units, faults and ridges"},
        ],
        "capabilities": CAPABILITIES["olympus"],
    }


def gale_entry() -> dict:
    """The existing Gale experience, described in the same manifest format (no new data)."""
    return {
        "id": "gale", "name": "Gale Crater", "kind": "gale", "summary": "Curiosity's radiation measurements and the terrain around Mount Sharp.",
        "frame": {"type": "lonlat_box", "lon": [round(math.degrees(C.NEAR_BOUNDS["left"] / R), 4), round(math.degrees(C.NEAR_BOUNDS["right"] / R), 4)],
                  "lat": [round(math.degrees(C.NEAR_BOUNDS["bottom"] / R), 4), round(math.degrees(C.NEAR_BOUNDS["top"] / R), 4)]},
        "capabilities": CAPABILITIES["gale"],
    }


# Capability matrix: one list per region, split into terrain data and radiation evidence so that a "validated" elevation
# model is never read as validated radiation. Labels follow STATUS_DEF.
def _c(area, name, status, detail):
    return {"area": area, "name": name, "status": status, "detail": detail}


CAPABILITIES = {
    "mars": [
        _c("terrain", "Global elevation", "validated", "MOLA gridded elevations at about 15 km per pixel; finer features are not resolved."),
        _c("radiation", "Three-region dose comparison", "exploratory",
           "Effective dose, dose equivalent and water-phantom absorbed dose at Gale, Jezero and Olympus Mons from one published transport model (Zhang et al. 2022) and one atmosphere source (Mars Climate Database v6.2), at matched assumptions. Reproduced from published tables; not validated outside Gale."),
        _c("radiation", "Global radiation map", "unavailable", "Only three sites have matched atmospheric inputs here; a global map would need the full MCD and transport tables over every location."),
    ],
    "jezero": [
        _c("terrain", "Elevation, 3D terrain", "validated", "USGS Mars 2020 CTX DTM, 20 m posts."),
        _c("terrain", "Slope and elevation profiles", "validated", "Over 20 m (profiles on the 60 m grid). Steps, boulders and scarps narrower than about 40 m are not resolved, so this cannot judge traversability."),
        _c("terrain", "Perseverance traverse", "validated", "Localized waypoints (NASA/JPL); the DTM agrees with the rover elevations to a median of about 1 m."),
        _c("terrain", "Sky blocked by terrain", "exploratory", "Same definition as Gale, on the 60 m grid; misses walls narrower than about 100 m."),
        _c("atmosphere", "Surface pressure", "validated", "MEDA pressure (PDS), normalised to the landing elevation, agrees with the Mars Climate Database annual mean to about 0.5 %; the model uses MCD for consistency with the other sites."),
        _c("radiation", "GCR dose estimate", "exploratory",
           "Effective dose, dose equivalent and water-phantom absorbed dose from published AtRIS/Geant4 tables at the MCD pressure. No ionizing-radiation detector has operated at Jezero, so the estimate cannot be validated here."),
        _c("radiation", "Dose differences across the region", "exploratory", "Hydrostatic pressure from the DTM; the modeled change across the region is far smaller than the model's Monte Carlo noise, so locations are not distinguished."),
        _c("radiation", "Terrain shielding of dose", "unavailable", "The published tables have no zenith-angle resolution, so blocked sky cannot be turned into dose without an invented factor."),
        _c("radiation", "RAD-E comparison, walking routes", "unavailable", "No RAD-equivalent measurement or detector model exists for Jezero; the 20 m DTM cannot represent walking-scale hazards."),
    ],
    "olympus": [
        _c("terrain", "Elevation, 3D caldera", "validated", "HRSC/MOLA blend at 200 m posts over the 1:200,000 map area."),
        _c("terrain", "Slope and elevation profiles", "validated", "Over 200 m only. Caldera walls 1–3 km high are steeper over shorter distances than this shows."),
        _c("terrain", "Geologic units", "validated", "USGS SIM 3470 polygons (Mouginis-Mark, 2021), 1:200,000."),
        _c("atmosphere", "Surface pressure", "exploratory", "Mars Climate Database v6.2 only; no pressure has been measured above about 4 km anywhere on Mars. A ±10 % assumption band is shown."),
        _c("radiation", "GCR dose estimate", "exploratory",
           "Effective dose, dose equivalent and water-phantom absorbed dose from published AtRIS/Geant4 tables; the paper's 82 Pa case is the top of Olympus Mons. No measurement exists here."),
        _c("radiation", "Dose differences across the caldera", "exploratory", "Hydrostatic pressure from the DEM; the modeled change across the caldera is below the model's Monte Carlo noise."),
        _c("radiation", "Terrain shielding of dose", "unavailable", "No zenith-angle resolution in the published tables, and a 200 m grid cannot locate person-scale shelter."),
        _c("radiation", "RAD-E comparison, walking routes", "unavailable", "No RAD-equivalent model at 2–3 g/cm2; the 200 m grid cannot represent hazards at the scale of a person."),
    ],
    "gale": [
        _c("terrain", "Elevation, 3D terrain", "validated", "USGS MSL Gale merged DEM, 1 m."),
        _c("radiation", "Radiation measurements", "validated", "Curiosity RAD Level 2 dose rates (NASA PDS/SPDF) at 322 stops."),
        _c("radiation", "Terrain shielding model (RAD-E)", "exploratory", "Tested retrospectively against RAD (322 stops, 8 parking periods). Its albedo share was derived from the same data, so this is not independent validation."),
        _c("radiation", "Three-region dose comparison", "exploratory", "The same published-table model as Jezero and Olympus Mons, at the MCD pressure; a different quantity from the RAD-E product above."),
        _c("radiation", "Routes and where to stand", "exploratory", "Planning illustration from the RAD-E model; not validated for astronaut dose and not for operational use."),
    ],
}


def run() -> dict:
    OUT.mkdir(parents=True, exist_ok=True)
    regions = [gale_entry(), mars_overview(), jezero(), olympus()]
    for r in regions:
        if r["kind"] in ("global", "regional"):
            r["generated_utc"] = _now()
            (OUT / r["id"] / "manifest.json").write_text(json.dumps(r, indent=1))
    import hashlib
    raw_files = [{"file": str(p.relative_to(C.ROOT)).replace("\\", "/"), "bytes": p.stat().st_size, "sha256": hashlib.sha256(p.read_bytes()).hexdigest(), "url": u}
                 for p, u in [(RAW / "mars" / "megt90n000cb.img", MOLA_MEGDR_4PPD), (RAW / "jezero" / "JEZ_ctx_B_soc_008_DTM_20m.tif", JEZ_CTX_DTM),
                              (RAW / "jezero" / "M20_waypoints.json", M20_WAYPOINTS), (RAW / "olympus" / "sim3470_gis_files.zip", SIM3470_GIS)] if p.exists()]
    raw_files.append({"file": "(window reads)", "url": C.HRSC_MOLA_200M_URL, "note": "Olympus Mons caldera window at native resolution and a 1/8 overview of the volcano, read by HTTP range requests"})
    index = {"generated_utc": _now(), "status_definitions": STATUS_DEF, "raw_inputs": raw_files,
             "regions": [{k: r[k] for k in ("id", "name", "kind", "summary", "frame", "capabilities")} |
                         ({"manifest": f"regions/{r['id']}/manifest.json",
                           "bytes": sum(p.stat().st_size for p in (OUT / r["id"]).iterdir())} if r["kind"] != "gale" else {}) for r in regions]}
    (OUT / "index.json").write_text(json.dumps(index, indent=1))
    return index


if __name__ == "__main__":
    idx = run()
    for r in idx["regions"]:
        print(r["id"], r.get("bytes"), [(c["name"], c["status"]) for c in r["capabilities"]])

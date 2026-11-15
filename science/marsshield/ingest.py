"""Data ingestion: regional DEM crops, rover traverse, RAD L2 dosimetry, published model data.

Nothing here downloads a global product. The 1 m Gale DEM (3.87 GB) is stored as one-row
LZW strips; we fetch only the rows that intersect our windows through GDAL /vsicurl/ byte
ranges. The 200 m HRSC/MOLA blend is uncompressed, so a window read costs only kilobytes.

Every output file gets a JSON sidecar recording URL, window, and retrieval time.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import rasterio
import requests
from rasterio.transform import Affine
from rasterio.windows import Window, from_bounds

from . import config as C

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")
os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "5")
os.environ.setdefault("GDAL_HTTP_RETRY_DELAY", "2")

UA = {"User-Agent": "MarsShield-research-pipeline/1.0"}


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def _sidecar(path: Path, meta: dict) -> None:
    meta = {"retrieved_utc": _now(), **meta}
    path.with_suffix(path.suffix + ".json").write_text(json.dumps(meta, indent=2))


def _write_tif(path: Path, arr: np.ndarray, transform: Affine, crs, nodata=np.nan) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        path, "w", driver="GTiff", height=arr.shape[0], width=arr.shape[1], count=1,
        dtype="float32", crs=crs, transform=transform, nodata=nodata,
        compress="deflate", predictor=3, tiled=True, blockxsize=256, blockysize=256,
    ) as dst:
        dst.write(arr.astype("float32"), 1)


# --------------------------------------------------------------------------------------
# DEM
# --------------------------------------------------------------------------------------
def fetch_near_dem(out: Path | None = None) -> Path:
    """1 m crop of the USGS Gale merged DEM over NEAR_BOUNDS (full resolution)."""
    out = out or C.RAW / "dem" / "gale_dem_1m_near.tif"
    if out.exists():
        return out
    url = "/vsicurl/" + C.GALE_DEM_1M_URL
    with rasterio.open(url) as d:
        b = C.NEAR_BOUNDS
        win = from_bounds(b["left"], b["bottom"], b["right"], b["top"], d.transform)
        win = win.round_offsets().round_lengths()
        # read in row blocks so a transient HTTP failure only costs one block
        rows = []
        for r0 in range(0, int(win.height), 500):
            h = min(500, int(win.height) - r0)
            rows.append(d.read(1, window=Window(win.col_off, win.row_off + r0, win.width, h)))
            print(f"  near DEM rows {r0 + h}/{int(win.height)}", flush=True)
        a = np.vstack(rows).astype("float32")
        a[a <= -30000] = np.nan
        tr = d.window_transform(win)
        _write_tif(out, a, tr, d.crs)
        _sidecar(out, dict(source=C.GALE_DEM_1M_URL, window=[win.col_off, win.row_off, win.width, win.height],
                           resolution_m=1.0, product="MSL Gale Merged DEM 1m v3 (USGS Astrogeology)"))
    return out


def fetch_mid_dem(out: Path | None = None, step: int = C.MID_STEP) -> Path:
    """Gale 1 m DEM point-sampled every `step` pixels within +/-MID_HALF_SIZE_M (horizon mid-field).

    Point sampling (not averaging) preserves ridge-crest heights better than block means;
    the effect of this choice is evaluated in the sensitivity analysis.
    """
    out = out or C.RAW / "dem" / f"gale_dem_{step}m_mid.tif"
    if out.exists():
        return out
    url = "/vsicurl/" + C.GALE_DEM_1M_URL
    with rasterio.open(url) as d:
        cx, cy = C.STUDY_CENTRE
        hs = C.MID_HALF_SIZE_M
        win = from_bounds(cx - hs, cy - hs, cx + hs, cy + hs, d.transform)
        win = win.intersection(Window(0, 0, d.width, d.height)).round_offsets().round_lengths()
        r_idx = np.arange(int(win.row_off), int(win.row_off + win.height), step)
        c0, c1 = int(win.col_off), int(win.col_off + win.width)
        crs, base_tr = d.crs, d.transform
    loc = threading.local()

    def rd(r):
        if not hasattr(loc, "d"):
            loc.d = rasterio.open(url)
        for attempt in range(4):
            try:
                return loc.d.read(1, window=Window(c0, int(r), c1 - c0, 1))[0, ::step]
            except Exception:  # transient network error: reopen and retry
                loc.d = rasterio.open(url)
        raise RuntimeError(f"row {r} failed")

    with ThreadPoolExecutor(16) as ex:
        rows = list(ex.map(rd, r_idx))
    a = np.vstack(rows).astype("float32")
    a[a <= -30000] = np.nan
    tr = base_tr * Affine.translation(c0, int(r_idx[0])) * Affine.scale(step, step)
    _write_tif(out, a, tr, crs)
    _sidecar(out, dict(source=C.GALE_DEM_1M_URL, sampling=f"point sample every {step} px",
                       rows=[int(r_idx[0]), int(r_idx[-1])], cols=[c0, c1]))
    return out


def fetch_far_dem(out: Path | None = None) -> Path:
    """HRSC/MOLA 200 m blend window reprojected (nearest) into the Gale DEM projection."""
    out = out or C.RAW / "dem" / "hrsc_mola_200m_far.tif"
    if out.exists():
        return out
    url = "/vsicurl/" + C.HRSC_MOLA_200M_URL
    with rasterio.open(url) as d:
        win = from_bounds(C.FAR_LON[0], C.FAR_LAT[0], C.FAR_LON[1], C.FAR_LAT[1], d.transform)
        win = win.round_offsets().round_lengths()
        a = d.read(1, window=win).astype("float32")
        a[a == d.nodata] = np.nan
        tr = d.window_transform(win)
    # Geographic (deg) on the Mars sphere -> equirectangular metres (clon=0, std parallel 0):
    # x = R*lon_rad, y = R*lat_rad. This is an exact affine map, so no resampling is needed.
    k = np.pi / 180.0 * C.MARS_RADIUS_M
    tr_m = Affine(tr.a * k, 0, tr.c * k, 0, tr.e * k, tr.f * k)
    with rasterio.open("/vsicurl/" + C.GALE_DEM_1M_URL) as g:
        crs = g.crs
    _write_tif(out, a, tr_m, crs)
    _sidecar(out, dict(source=C.HRSC_MOLA_200M_URL, window_deg=[C.FAR_LON, C.FAR_LAT],
                       note="exact affine conversion deg->m on 3396190 m sphere; values are areoid heights"))
    return out


def fetch_walk_ortho(out: Path | None = None, factor: int = 4) -> Path:
    """USGS MSL Gale Merged Orthophoto Mosaic 25 cm v3 (HiRISE-based), walk area only, block-averaged
    `factor`x to 1 m. The source is a 24 GB tiled GeoTIFF; only tiles intersecting WALK_BOUNDS are read."""
    out = out or C.RAW / "ortho" / "gale_ortho_1m_walk.tif"
    if out.exists():
        return out
    url = "/vsicurl/" + C.GALE_ORTHO_25CM_URL
    b = C.WALK_BOUNDS
    with rasterio.open(url) as d:
        win = from_bounds(b["left"], b["bottom"], b["right"], b["top"], d.transform).round_offsets().round_lengths()
        crs, tr0 = d.crs, d.window_transform(win)
    H, W = int(win.height) // factor * factor, int(win.width) // factor * factor
    bands = list(range(0, H, 512))
    loc = threading.local()

    def rd(r0):
        if not hasattr(loc, "d"):
            loc.d = rasterio.open(url)
        h = min(512, H - r0)
        for attempt in range(4):
            try:
                a = loc.d.read(1, window=Window(win.col_off, win.row_off + r0, W, h)).astype("float32")
                return a.reshape(h // factor, factor, W // factor, factor).mean(axis=(1, 3))
            except Exception:
                loc.d = rasterio.open(url)
        raise RuntimeError(f"ortho band {r0} failed")

    with ThreadPoolExecutor(8) as ex:
        parts = list(ex.map(rd, bands))
    a = np.vstack(parts)
    a[a == 0] = np.nan          # 0 = no data in the mosaic
    tr = tr0 * Affine.scale(factor, factor)
    _write_tif(out, a, tr, crs)
    _sidecar(out, dict(source=C.GALE_ORTHO_25CM_URL, product="MSL Gale Merged Orthophoto Mosaic 25cm v3 (USGS Astrogeology)",
                       window=[win.col_off, win.row_off, W, H], aggregation=f"{factor}x{factor} block mean -> 1 m"))
    return out


# --------------------------------------------------------------------------------------
# Open-access paper texts (used by the audit and the science-target catalogue)
# --------------------------------------------------------------------------------------
PAPERS = {
    # Guo et al. (2026) JGR Planets, CC-BY; open copy on the DLR electronic library
    "guo2026": "https://elib.dlr.de/224554/1/ME-SBA-2026-Guo...Matth%C3%A4_Berger_Reitz%20Influence%20of%20Mars%20Topography"
               "%20on%20Radiation%20Dose%20Detected%20by%20the%20Mars%20Science%20Laboratory_JGR%20Planets.pdf",
    # Bennett et al. (2023) JGR Planets, open copy on NASA NTRS
    "bennett2023": "https://ntrs.nasa.gov/api/citations/20230001618/downloads/JGR%20Planets%20-%202022%20-%20Bennett%20-%20The%20Curiosity"
                   "%20Rover%20s%20Exploration%20of%20.pdf",
}


def fetch_papers() -> dict[str, Path]:
    """Download the open-access PDFs and extract plain text with pypdf (deterministic for a given pypdf version)."""
    import pypdf
    d = C.RAW / "papers"
    d.mkdir(parents=True, exist_ok=True)
    out = {}
    for name, url in PAPERS.items():
        pdf, txt = d / f"{name}.pdf", d / f"{name}.txt"
        if not pdf.exists():
            r = requests.get(url, timeout=180, headers=UA)
            r.raise_for_status()
            if not r.content.startswith(b"%PDF"):
                raise RuntimeError(f"{name}: response is not a PDF")
            pdf.write_bytes(r.content)
            _sidecar(pdf, dict(source=url))
        if not txt.exists():
            reader = pypdf.PdfReader(str(pdf))
            txt.write_text("\n".join(p.extract_text() or "" for p in reader.pages), encoding="utf-8")
        out[name] = txt
    return out


# --------------------------------------------------------------------------------------
# Rover traverse
# --------------------------------------------------------------------------------------
def fetch_waypoints(out: Path | None = None) -> Path:
    out = out or C.RAW / "traverse" / "MSL_waypoints.json"
    if not out.exists():
        out.parent.mkdir(parents=True, exist_ok=True)
        r = requests.get(C.MSL_WAYPOINTS_URL, timeout=120, headers=UA)
        r.raise_for_status()
        out.write_bytes(r.content)
        _sidecar(out, dict(source=C.MSL_WAYPOINTS_URL))
    return out


def load_waypoints() -> list[dict]:
    feats = json.loads(fetch_waypoints().read_text())["features"]
    return [f["properties"] for f in feats]


# --------------------------------------------------------------------------------------
# Published model data (Guo 2021 Zenodo)
# --------------------------------------------------------------------------------------
def fetch_zenodo() -> Path:
    d = C.RAW / "zenodo_guo2021"
    d.mkdir(parents=True, exist_ok=True)
    for name in C.ZENODO_FILES:
        p = d / name
        if not p.exists():
            r = requests.get(C.ZENODO_GUO2021.format(name=name), timeout=120, headers=UA)
            r.raise_for_status()
            p.write_bytes(r.content)
    _sidecar(d / "Fig1_a.txt", dict(source="https://doi.org/10.5281/zenodo.4701689", files=C.ZENODO_FILES))
    return d


# --------------------------------------------------------------------------------------
# RAD Level 2 dosimetry
# --------------------------------------------------------------------------------------
# MSL sol <-> UTC. Curiosity's sol count is local mean solar time at the landing site.
# Calibrated against the `Start_sol`/`Start_time` attributes of the RAD CDF files
# (see tests/test_science.py); a Mars solar day is 88775.244 s.
SOL_SECONDS = 88775.244
MSL_SOL0_UTC = dt.datetime(2012, 8, 5, 13, 49, 59, tzinfo=dt.timezone.utc)


def sol_to_utc(sol: float) -> dt.datetime:
    return MSL_SOL0_UTC + dt.timedelta(seconds=sol * SOL_SECONDS)


def utc_to_sol(t: dt.datetime) -> float:
    return (t - MSL_SOL0_UTC).total_seconds() / SOL_SECONDS


def rad_file_for_day(day: dt.date) -> Path:
    doy = day.timetuple().tm_yday
    name = f"msl_rad_obs-l2_{day.year}{doy:03d}_v04.cdf"
    p = C.RAW / "rad_l2" / name
    if not p.exists():
        p.parent.mkdir(parents=True, exist_ok=True)
        url = f"{C.RAD_L2_BASE}/{day.year}/{name}"
        for attempt in range(4):
            try:
                r = requests.get(url, timeout=60, headers=UA)
                if r.status_code == 404:
                    return p  # no file for that day: caller checks existence
                r.raise_for_status()
                p.write_bytes(r.content)
                break
            except requests.RequestException as e:
                if attempt == 3:
                    print(f"WARNING: RAD file {name} unavailable ({e.__class__.__name__}); day skipped")
                    return p
    return p


def fetch_rad_sols(sol_a: float, sol_b: float) -> list[Path]:
    t0, t1 = sol_to_utc(sol_a - 1).date(), sol_to_utc(sol_b + 1).date()
    days = [t0 + dt.timedelta(days=i) for i in range((t1 - t0).days + 1)]
    with ThreadPoolExecutor(8) as ex:
        paths = list(ex.map(rad_file_for_day, days))
    return [p for p in paths if p.exists()]


def read_rad(paths: list[Path]) -> dict[str, np.ndarray]:
    """Return per-observation arrays: sol (fractional), utc (ISO), dose_B, dose_B_corr, dose_E [uGy/day], flag."""
    import cdflib

    out = {k: [] for k in ("epoch", "B", "Bc", "E", "flag", "alive")}
    for p in paths:
        c = cdflib.CDF(str(p))
        ep = c.varget("EPOCH")
        if ep is None or len(np.atleast_1d(ep)) == 0:
            continue
        tot = np.atleast_2d(c.varget("DOSIMETRY_TOTAL")).astype(float)
        out["epoch"].append(np.atleast_1d(ep))
        out["B"].append(tot[:, 0]); out["Bc"].append(tot[:, 1]); out["E"].append(tot[:, 2])
        # FLAGGED_DATA is CDF_CHAR: '' = good, otherwise the reason (e.g. 'Cmds', 'DAN')
        fl = np.char.strip(np.atleast_1d(c.varget("FLAGGED_DATA")).astype(str))
        out["flag"].append((fl != "").astype(int))
        out["alive"].append(np.atleast_1d(c.varget("ALIVE_TIME")).astype(float))
    if not out["epoch"]:
        return {}
    res = {k: np.concatenate(v) for k, v in out.items()}
    import cdflib.epochs as E
    dts = E.CDFepoch.to_datetime(res["epoch"])  # numpy datetime64 (TT2000 -> UTC)
    utc = [dt.datetime.fromisoformat(str(t)[:26]).replace(tzinfo=dt.timezone.utc) for t in dts]
    res["sol"] = np.array([utc_to_sol(t) for t in utc])
    res["utc"] = np.array([t.isoformat(timespec="seconds") for t in utc])
    order = np.argsort(res["sol"])
    res = {k: v[order] for k, v in res.items()}
    # de-duplicate observations that appear in two adjacent daily files
    _, uniq = np.unique(res["epoch"], return_index=True)
    return {k: v[np.sort(uniq)] for k, v in res.items()}


def labels_check(path: Path) -> list[str]:
    import cdflib
    c = cdflib.CDF(str(path))
    return [str(x) for x in np.atleast_1d(c.varget("DOSIMETRY_DOSE_LABEL")).ravel()]

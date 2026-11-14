"""Gridded terrain products for the walk area: elevation, slope, horizon-derived shielding maps.

Outputs data/processed/walk_grid.npz with
  z        5 m elevation (mean of 1 m DEM), areoid metres
  slope    terrain slope [deg] (central differences on the 5 m grid)
  horizon  (ny, nx, n_az) horizon elevation [deg] at astronaut reference height
  B        blocked solid-angle fraction
  rel_sky  modeled downward (sky) dose rate relative to open flat terrain
  rel_tot  modeled total (sky + terrain albedo) dose rate relative to open flat terrain
"""
from __future__ import annotations

import json
import time

import numpy as np

from . import config as C
from . import sites as S
from .horizon import THETA, Grid, horizon_map
from .radiation import TerrainDoseModel

CELL = 5.0
N_AZ = 72


def walk_grid(cell: float = CELL) -> Grid:
    near, _, _ = S.grids()
    b = C.WALK_BOUNDS
    f = int(round(cell / near.res))
    # crop the 1 m grid to the walk bounds, then block-mean
    r0 = int(round((near.y0 - b["top"]) / near.res)); r1 = int(round((near.y0 - b["bottom"]) / near.res))
    c0 = int(round((b["left"] - near.x0) / near.res)); c1 = int(round((b["right"] - near.x0) / near.res))
    sub = Grid(near.z[r0:r1, c0:c1], near.x0 + c0 * near.res, near.y0 - r0 * near.res, near.res, "walk1m")
    return sub.coarsen(f, "mean"), sub


def slope_deg(g: Grid) -> np.ndarray:
    gy, gx = np.gradient(g.z.astype(float), g.res)
    return np.degrees(np.arctan(np.hypot(gx, gy))).astype("float32")


def ros_from_horizon(h: np.ndarray) -> np.ndarray:
    """(N, n_az) horizon -> (N, 91) blocked fraction per zenith ring (same rule as profile)."""
    thr = 90.0 - THETA  # (91,)
    out = np.empty((h.shape[0], THETA.size), dtype="float32")
    for i, t in enumerate(thr):
        out[:, i] = np.mean(h > t, axis=1)
    return out


def build(h_obs: float = C.ASTRONAUT_HEIGHT_M, phi: float = 500.0) -> dict:
    t0 = time.time()
    g, sub1m = walk_grid()
    ny, nx = g.z.shape
    X, Y = np.meshgrid(g.x0 + np.arange(nx) * g.res, g.y0 - np.arange(ny) * g.res)
    stack = S.stack()
    print(f"walk grid {ny}x{nx} @ {g.res} m; horizon map with {N_AZ} azimuths ...", flush=True)
    hz = horizon_map(stack, X, Y, h_obs, n_az=N_AZ, r_max=20000.0, z_ground=g.z)
    print(f"  horizon map {time.time() - t0:.1f}s", flush=True)
    ros = ros_from_horizon(hz)
    model = TerrainDoseModel()
    rel_tot, rel_sky, B = model.rel_total_map(ros.astype(float), phi)
    out = dict(z=g.z, slope=slope_deg(g), horizon=hz.reshape(ny, nx, N_AZ).astype("float16"),
               B=B.reshape(ny, nx).astype("float32"), rel_sky=rel_sky.reshape(ny, nx).astype("float32"),
               rel_tot=rel_tot.reshape(ny, nx).astype("float32"),
               x0=g.x0, y0=g.y0, res=g.res, h_obs=h_obs, phi=phi, alpha=model.alpha, n_az=N_AZ)
    C.PROC.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(C.PROC / "walk_grid.npz", **out)
    meta = {k: out[k] for k in ("x0", "y0", "res", "h_obs", "phi", "alpha", "n_az")}
    meta.update(shape=[ny, nx], runtime_s=time.time() - t0)
    (C.PROC / "walk_grid.json").write_text(json.dumps(meta, indent=1, default=float))
    print(f"done in {time.time() - t0:.1f}s", flush=True)
    return out


def load() -> dict:
    d = np.load(C.PROC / "walk_grid.npz")
    return {k: d[k] for k in d.files}


if __name__ == "__main__":
    build()

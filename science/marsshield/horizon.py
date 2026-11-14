"""Terrain horizon ray tracing and directional sky-obstruction analysis.

Conventions
-----------
* Projected coordinates: Mars 2000 sphere equirectangular metres (the USGS Gale DEM CRS).
  Grid north == geographic north to within the tiny meridian convergence of a 0-centred
  equirectangular projection at 5 deg S (< 0.01 deg over the study area).
* Azimuth: degrees clockwise from north, bin centres at (i + 0.5) * d_az.
* Horizon elevation angle h(az): max over distance r of atan((z(r) - z_obs - r^2/2R) / r),
  i.e. including the drop of a spherical surface of radius R = 3396190 m.
* Zenith angle theta = 90 deg - elevation. A sky ring at zenith theta is *blocked* in
  azimuth az when h(az) > 90 - theta (the definition reproduced exactly from the
  Guo et al. (2021) Zenodo data, see tests/test_horizon.py::test_reproduces_guo2021_ring_ratio).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import rasterio
from scipy.ndimage import map_coordinates

from . import config as C


@dataclass
class Grid:
    z: np.ndarray            # elevation [m], NaN = no data
    x0: float                # x of pixel (0,0) *centre*
    y0: float                # y of pixel (0,0) *centre*
    res: float               # pixel size [m] (square pixels, north-up)
    name: str = ""

    @classmethod
    def from_tif(cls, path, name: str = "") -> "Grid":
        with rasterio.open(path) as d:
            z = d.read(1).astype("float32")
            if d.nodata is not None and not np.isnan(d.nodata):
                z[z == d.nodata] = np.nan
            t = d.transform
            assert abs(t.a + t.e) < 1e-6 * abs(t.a), "expects square north-up pixels"
            return cls(z, t.c + t.a / 2, t.f + t.e / 2, float(t.a), name)

    @property
    def shape(self):
        return self.z.shape

    def extent(self):
        h, w = self.z.shape
        return (self.x0, self.x0 + (w - 1) * self.res, self.y0 - (h - 1) * self.res, self.y0)

    def to_pix(self, x, y):
        return (self.y0 - np.asarray(y)) / self.res, (np.asarray(x) - self.x0) / self.res

    def sample(self, x, y, order: int = 1) -> np.ndarray:
        """Bilinear sample; NaN outside the grid or where any contributing cell is NaN."""
        r, c = self.to_pix(x, y)
        h, w = self.z.shape
        inside = (r >= 0) & (r <= h - 1) & (c >= 0) & (c <= w - 1)
        out = np.full(np.shape(r), np.nan, dtype="float64")
        if np.any(inside):
            out[inside] = map_coordinates(self.z, [r[inside], c[inside]], order=order,
                                          mode="nearest", prefilter=False)
        return out

    def coarsen(self, factor: int, how: str = "mean") -> "Grid":
        h, w = (s // factor * factor for s in self.z.shape)
        a = self.z[:h, :w].reshape(h // factor, factor, w // factor, factor)
        with np.errstate(all="ignore"):
            if how == "max":
                z = np.nanmax(a, axis=(1, 3))
            elif how == "point":
                z = self.z[:h:factor, :w:factor]
            else:
                z = np.nanmean(a, axis=(1, 3))
        off = (factor - 1) / 2 * self.res if how != "point" else 0.0
        return Grid(z.astype("float32"), self.x0 + off, self.y0 - off, self.res * factor,
                    f"{self.name}/{how}{factor}")


@dataclass
class TerrainStack:
    """Fine-to-coarse DEM stack. Each sample uses the finest grid with valid data there."""
    grids: list[Grid] = field(default_factory=list)

    def sample(self, x, y) -> np.ndarray:
        x = np.asarray(x, float); y = np.asarray(y, float)
        out = np.full(x.shape, np.nan)
        todo = np.ones(x.shape, bool)
        for g in self.grids:
            if not todo.any():
                break
            v = g.sample(x[todo], y[todo])
            idx = np.flatnonzero(todo)
            ok = ~np.isnan(v)
            out.flat[idx[ok]] = v[ok]
            todo.flat[idx[ok]] = False
        return out

    def ground(self, x, y) -> float:
        return float(self.sample(np.array([x]), np.array([y]))[0])


def default_distances(r_min=0.5, r_max=20000.0, growth=0.004, dr_min=0.5) -> np.ndarray:
    """Ray sample distances: dr = max(dr_min, growth*r) (fine near the observer)."""
    r = [r_min]
    while r[-1] < r_max:
        r.append(r[-1] + max(dr_min, growth * r[-1]))
    return np.array(r[:-1] + [r_max])


def horizon_profile(stack: TerrainStack, x: float, y: float, h_obs: float = C.RAD_HEIGHT_M,
                    n_az: int = 1440, r_max: float = 20000.0, distances: np.ndarray | None = None,
                    curvature: bool = True, z_ground: float | None = None) -> dict:
    """Horizon elevation angle (deg) for n_az azimuth bins around (x, y)."""
    az = (np.arange(n_az) + 0.5) * 360.0 / n_az
    r = default_distances(r_max=r_max) if distances is None else distances
    z0 = (stack.ground(x, y) if z_ground is None else z_ground) + h_obs
    a = np.radians(az)[:, None]
    X = x + r[None, :] * np.sin(a)
    Y = y + r[None, :] * np.cos(a)
    Z = stack.sample(X.ravel(), Y.ravel()).reshape(X.shape)
    drop = r ** 2 / (2 * C.MARS_RADIUS_M) if curvature else 0.0
    ang = np.degrees(np.arctan2(Z - z0 - drop, r[None, :]))
    ang = np.where(np.isnan(ang), -90.0, ang)
    k = np.argmax(ang, axis=1)
    h = ang[np.arange(n_az), k]
    coverage = float(np.mean(~np.isnan(Z)))
    return dict(az=az, elev=h, dist=r[k], z_obs=z0, coverage=coverage)


# --------------------------------------------------------------------------------------
# Sky obstruction metrics
# --------------------------------------------------------------------------------------
THETA = np.arange(0, 91, 1.0)  # zenith-angle nodes, deg (Guo et al.: sum over 0..90 with dtheta = 1 deg)


def blocked_fraction_by_zenith(elev_deg: np.ndarray, theta: np.ndarray = THETA) -> np.ndarray:
    """ROS(theta): fraction of azimuths in which the ring at zenith theta is blocked."""
    e = np.asarray(elev_deg)[None, :]
    return np.mean(e > (90.0 - theta[:, None]), axis=1)


def blocked_solid_angle_fraction(ros: np.ndarray, theta: np.ndarray = THETA) -> float:
    """Fraction of the upper-hemisphere solid angle that is blocked by terrain."""
    w = np.sin(np.radians(theta))
    return float(np.sum(ros * w) / np.sum(w))


def blocked_solid_angle_exact(elev_deg: np.ndarray) -> float:
    """Exact solid-angle fraction for a piecewise-constant horizon: mean_az(sin(max(h,0)))."""
    return float(np.mean(np.sin(np.radians(np.clip(elev_deg, 0, 90)))))


def sky_view_factor(elev_deg: np.ndarray) -> float:
    """Cosine-weighted sky view factor (used in radiative transfer; reported for reference)."""
    return float(np.mean(np.cos(np.radians(np.clip(elev_deg, 0, 90))) ** 2))


# --------------------------------------------------------------------------------------
# Horizon *maps* for routing (many observers, fewer azimuths)
# --------------------------------------------------------------------------------------
try:
    import numba as nb
except ImportError:  # pragma: no cover
    nb = None


def _make_kernel():
    @nb.njit(cache=True, inline="always")
    def _bil(z, x0, y0, res, x, y):
        c = (x - x0) / res
        r = (y0 - y) / res
        h, w = z.shape
        if r < 0 or c < 0 or r > h - 1 or c > w - 1:
            return np.nan
        i = min(int(r), h - 2); j = min(int(c), w - 2)
        fr = r - i; fc = c - j
        return ((z[i, j] * (1 - fc) + z[i, j + 1] * fc) * (1 - fr)
                + (z[i + 1, j] * (1 - fc) + z[i + 1, j + 1] * fc) * fr)

    @nb.njit(cache=True, parallel=True)
    def kernel(xs, ys, z0s, r, drop, sa, ca, z1, a1, z2, a2, z3, a3):
        n = xs.size; m = sa.size
        out = np.empty((n, m), np.float32)
        for i in nb.prange(n):
            for j in range(m):
                best = -1e30
                for k in range(r.size):
                    x = xs[i] + r[k] * sa[j]; y = ys[i] + r[k] * ca[j]
                    v = _bil(z1, a1[0], a1[1], a1[2], x, y)
                    if np.isnan(v):
                        v = _bil(z2, a2[0], a2[1], a2[2], x, y)
                        if np.isnan(v):
                            v = _bil(z3, a3[0], a3[1], a3[2], x, y)
                    if not np.isnan(v):
                        t = (v - z0s[i] - drop[k]) / r[k]
                        if t > best:
                            best = t
                out[i, j] = np.degrees(np.arctan(best)) if best > -1e29 else -90.0
        return out
    return kernel


_KERNEL = None


def horizon_map(stack: TerrainStack, xs: np.ndarray, ys: np.ndarray, h_obs: float,
                n_az: int = 72, r_max: float = 20000.0, growth: float = 0.01,
                dr_min: float = 1.0, z_ground: np.ndarray | None = None,
                distances: np.ndarray | None = None) -> np.ndarray:
    """Horizon elevation [deg] for every observer in (xs, ys) (flattened), shape (N, n_az).

    Numba-parallel implementation of exactly the geometry in `horizon_profile` (bilinear
    sampling, finest-valid-grid fallback, spherical drop). Equivalence to the NumPy
    reference is asserted in tests/test_horizon.py. Supports a stack of up to 3 grids.
    """
    global _KERNEL
    if _KERNEL is None:
        _KERNEL = _make_kernel()
    xs = np.ascontiguousarray(np.ravel(xs), dtype=np.float64)
    ys = np.ascontiguousarray(np.ravel(ys), dtype=np.float64)
    r = default_distances(r_min=min(1.0, dr_min), r_max=r_max, growth=growth, dr_min=dr_min) \
        if distances is None else np.asarray(distances, float)
    drop = r ** 2 / (2 * C.MARS_RADIUS_M)
    az = np.radians((np.arange(n_az) + 0.5) * 360.0 / n_az)
    zg = stack.sample(xs, ys) if z_ground is None else np.ravel(z_ground).astype(float)
    gs = list(stack.grids)[:3]
    dummy = Grid(np.full((2, 2), np.nan, np.float32), 0.0, 0.0, 1.0)
    while len(gs) < 3:
        gs.append(dummy)
    args = []
    for g in gs:
        args += [np.ascontiguousarray(g.z, dtype=np.float32), np.array([g.x0, g.y0, g.res])]
    return _KERNEL(xs, ys, zg + h_obs, r, drop, np.sin(az), np.cos(az), *args)

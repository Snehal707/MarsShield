"""Marswalk route optimisation on the 5 m walk grid.

Graph: 16-connected grid (orthogonal, diagonal and knight moves), which keeps the
metrication error of grid paths small (< ~1-2 %) compared with 8-connectivity (~8 %).

Walking-speed model (ASSUMPTION, documented): Tobler's hiking function
    v(s) = 6 * exp(-3.5 * |s + 0.05|) km/h,  s = dz/dx
scaled by SUIT_FACTOR for a pressurised-suit EVA. Tobler (1993) is derived from Earth
hiking data; no validated Mars-suit locomotion function exists, so absolute times are
indicative only. Edges steeper than MAX_SLOPE_DEG are impassable.

Route objectives
  shortest  - minimum 3-D length (the baseline required by the challenge)
  fastest   - minimum walking time
  low_dose  - minimum modeled integrated GCR dose (time x relative dose rate)
  shelter   - maximum shielding: walk where the modeled rate is lowest
              (cost = length x rel_rate^12); shows that hugging shelter != lowest dose
  gentle    - penalises slope quadratically (safety-oriented)
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra

SUIT_FACTOR = 0.6         # suited EVA speed / Tobler speed (assumption; flat-ground ~3.4 km/h)
MAX_SLOPE_DEG = 25.0      # traversability limit (assumption)
# 'In terrain shade': modeled rate below x0.93, i.e. > 2 points below the walk-area median (x0.947).
# (Even open ground in Gale sits below x1 because the distant crater rim and Mt Sharp block the horizon.)
SHADE_RATE = 0.93
OFFSETS = [(dy, dx) for dy in range(-2, 3) for dx in range(-2, 3)
           if (dy, dx) != (0, 0) and np.gcd(abs(dy), abs(dx)) == 1]  # 16 moves


def tobler_kmh(s: np.ndarray) -> np.ndarray:
    return 6.0 * np.exp(-3.5 * np.abs(s + 0.05))


@dataclass
class EdgeSet:
    src: np.ndarray
    dst: np.ndarray
    length: np.ndarray       # 3-D length [m]
    hlen: np.ndarray         # horizontal length [m]
    time_h: np.ndarray       # walking time [h]
    slope: np.ndarray        # signed grade dz/dx
    rate: np.ndarray         # mean relative dose rate of endpoints
    n: int


class Router:
    def __init__(self, z: np.ndarray, res: float, rel_rate: np.ndarray, x0: float, y0: float,
                 suit_factor: float = SUIT_FACTOR, max_slope_deg: float = MAX_SLOPE_DEG):
        self.z = z.astype(float); self.res = res; self.rate = rel_rate.astype(float)
        self.x0, self.y0 = x0, y0
        self.ny, self.nx = z.shape
        self.suit = suit_factor; self.max_slope = np.tan(np.radians(max_slope_deg))
        self.edges = self._edges()
        self._mats: dict[str, csr_matrix] = {}

    # grid <-> map coordinates (cell centres)
    def to_rc(self, x, y):
        return int(round((self.y0 - y) / self.res)), int(round((x - self.x0) / self.res))

    def to_xy(self, r, c):
        return self.x0 + np.asarray(c) * self.res, self.y0 - np.asarray(r) * self.res

    def _edges(self) -> EdgeSet:
        ny, nx = self.ny, self.nx
        idx = np.arange(ny * nx).reshape(ny, nx)
        S, D, L, H, T, G, R = [], [], [], [], [], [], []
        for dy, dx in OFFSETS:
            ys = slice(max(0, -dy), ny - max(0, dy)); xs = slice(max(0, -dx), nx - max(0, dx))
            yd = slice(max(0, dy), ny - max(0, -dy)); xd = slice(max(0, dx), nx - max(0, -dx))
            a = idx[ys, xs].ravel(); b = idx[yd, xd].ravel()
            za = self.z[ys, xs].ravel(); zb = self.z[yd, xd].ravel()
            h = self.res * np.hypot(dy, dx)
            dz = zb - za
            s = dz / h
            ok = np.isfinite(dz) & (np.abs(s) <= self.max_slope)
            a, b, dz, s = a[ok], b[ok], dz[ok], s[ok]
            l3 = np.hypot(h, dz)
            t = (h / 1000.0) / (tobler_kmh(s) * self.suit)
            r = 0.5 * (self.rate.ravel()[a] + self.rate.ravel()[b])
            S.append(a); D.append(b); L.append(l3); H.append(np.full(a.size, h)); T.append(t); G.append(s); R.append(r)
        cat = np.concatenate
        return EdgeSet(cat(S), cat(D), cat(L), cat(H), cat(T), cat(G), cat(R), ny * nx)

    def weights(self, objective: str) -> np.ndarray:
        e = self.edges
        if objective == "shortest":
            return e.length
        if objective == "fastest":
            return e.time_h
        if objective == "low_dose":
            return e.time_h * e.rate
        if objective == "shelter":
            return e.length * e.rate ** 12
        if objective == "gentle":
            return e.time_h * (1.0 + (np.abs(e.slope) / np.tan(np.radians(8.0))) ** 2)
        raise ValueError(objective)

    def matrix(self, objective: str) -> csr_matrix:
        if objective not in self._mats:
            e = self.edges
            self._mats[objective] = csr_matrix((self.weights(objective), (e.src, e.dst)), shape=(e.n, e.n))
        return self._mats[objective]

    def path(self, start_rc, end_rc, objective: str) -> np.ndarray | None:
        s = start_rc[0] * self.nx + start_rc[1]; t = end_rc[0] * self.nx + end_rc[1]
        dist, pred = dijkstra(self.matrix(objective), directed=True, indices=s, return_predecessors=True)
        if not np.isfinite(dist[t]):
            return None
        out = [t]
        while out[-1] != s:
            out.append(pred[out[-1]])
        return np.array(out[::-1])

    def metrics(self, nodes: np.ndarray, D_flat_uGy_d: float, dwell: list[tuple[int, float]] = ()) -> dict:
        r, c = np.divmod(nodes, self.nx)
        z = self.z[r, c]
        dxy = self.res * np.hypot(np.diff(r), np.diff(c))
        dz = np.diff(z)
        s = dz / dxy
        t = (dxy / 1000.0) / (tobler_kmh(s) * self.suit)
        rate = self.rate[r, c]
        seg_rate = 0.5 * (rate[1:] + rate[:-1])
        dose_walk = float(np.sum(t * seg_rate) * D_flat_uGy_d / 24.0)
        dose_walk_flat = float(np.sum(t) * D_flat_uGy_d / 24.0)
        x, y = self.to_xy(r, c)
        cum = np.concatenate([[0], np.cumsum(np.hypot(dxy, dz))])
        return dict(
            distance_m=float(np.sum(np.hypot(dxy, dz))), horizontal_m=float(dxy.sum()),
            time_h=float(t.sum()), ascent_m=float(dz[dz > 0].sum()), descent_m=float(-dz[dz < 0].sum()),
            max_slope_deg=float(np.degrees(np.arctan(np.abs(s).max()))) if s.size else 0.0,
            mean_slope_deg=float(np.degrees(np.arctan(np.average(np.abs(s), weights=dxy)))) if s.size else 0.0,
            mean_rel_rate=float(np.sum(t * seg_rate) / max(t.sum(), 1e-12)), min_rel_rate=float(rate.min()),
            frac_time_shielded=float(np.sum(t[seg_rate < SHADE_RATE]) / max(t.sum(), 1e-12)),
            dose_uGy=dose_walk, dose_if_open_flat_uGy=dose_walk_flat,
            profile=dict(s_m=cum.round(1).tolist(), z=z.round(2).tolist(), rel_rate=rate.round(4).tolist()),
            xy=np.stack([x, y], 1).round(2).tolist(),
        )


def simplify(nodes: np.ndarray, every: int = 1) -> np.ndarray:
    return nodes[::every] if every > 1 else nodes

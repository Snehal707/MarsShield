"""Terrain-aware GCR dose-rate model (RAD E detector equivalent), after Guo et al. (2021, 2026).

What this model IS
------------------
A transparent re-implementation of the published method of
  Guo et al. (2021) GRL 48, e2021GL093912 and Guo et al. (2026) JGR Planets 131, e2026JE009704:

  D_sky   = k_heavy * k_rad * sum_{theta=0..90} (1 - ROS(theta)) * [d_H(theta, phi) + d_He(theta, phi)]   (Eq. 2-4)
  D_total = D_sky + (1 + B) * D_albedo_FT                                                     (Eq. 5)

with
  d_H, d_He  GEANT4 zenith-angle-dependent *downward* dose rate in the RAD E (plastic) detector
             per 1 deg zenith bin, for primary GCR protons / helium, BON2014 input at solar
             modulation potential phi.  Published numerically on Zenodo (doi:10.5281/zenodo.4701689,
             files Fig1_a.txt / Fig1_b.txt).  [MODEL INPUT, taken as published]
  k_heavy    = 1.1   heavier-ion contribution (Guo et al. 2026 Eq. 4; ~8-12 % per Zhang et al. 2022)
  k_rad      = 1.015 GCR radial-gradient adjustment 1 AU -> Mars (Guo et al. 2026 Sec. 2.2)
  ROS(theta) fraction of the azimuth ring at zenith theta that is blocked by terrain   [FROM DEM]
  B          blocked fraction of the upper-hemisphere solid angle                       [FROM DEM]
  D_albedo_FT  upward (albedo) dose on flat terrain.  Guo et al. (2026) derive it from RAD data
             as 18-24 % of the total flat-terrain dose; we parameterise it by that fraction alpha.

The albedo term encodes the paper's key assumption: terrain that blocks sky is itself an albedo
source equivalent to the regolith underfoot, so blocking a fraction B of the sky *adds* B times the
flat-ground albedo dose. That is why blocking sky never reduces dose proportionally.

What this model is NOT
----------------------
* Not an effective dose (Sv) or a dose equivalent: it is absorbed dose in a tissue-equivalent plastic
  detector, quiet-time GCR only. RAD's LET cone (<=36 deg) is unaffected by terrain, so the quality
  factor under shielding cannot be inferred from RAD data (Guo et al. 2026 Sec. 5).
* Not valid for solar energetic particle events (different spectra and angular distributions).
* The albedo-from-obstructor assumption is known to degrade in narrow, self-shielded canyons
  (Maria Gordon Notch; Guo et al. 2026 Sec. 4-5).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from . import config as C
from .horizon import THETA, blocked_fraction_by_zenith, blocked_solid_angle_fraction

K_HEAVY = 1.1
K_RADIAL = 1.015
# The Zenodo Fig1 tables are exactly 2x the per-degree dose used in the papers' integrals:
# Guo et al. (2021) Zenodo Fig4b 'during parking' proton column == 0.5 * Fig1_a(484 MV) * Fig4a
# sky ratio at every zenith angle (max abs deviation < 1e-6, tests/test_science.py).
FIG1_NORM = 0.5
ALPHA_RANGE = (0.18, 0.24)    # albedo / total on flat terrain (Guo et al. 2026)
ALPHA_DEFAULT = 0.21          # mid-range value


@dataclass
class ZenithModel:
    thH: np.ndarray               # zenith nodes for protons [deg]
    thHe: np.ndarray              # zenith nodes for helium [deg] (differ from protons)
    phis: np.ndarray              # MV
    dH: np.ndarray                # (n_nodes_H, n_phi) uGy/d per deg
    dHe: np.ndarray

    @classmethod
    def load(cls, folder=None) -> "ZenithModel":
        folder = folder or (C.RAW / "zenodo_guo2021")
        def read(name):
            with open(folder / name) as f:
                head = f.readline().split()
            a = np.loadtxt(folder / name, skiprows=1)
            cols = head[1:]
            # value columns alternate with their std columns: 400MV 400_std 484_2016 484_2016_sed ...
            vals = [i for i, c in enumerate(cols) if not (c.endswith("_std") or c.endswith("_sed"))]
            phis = np.array([float(cols[i].replace("MV", "").split("_")[0]) for i in vals])
            return a[:, 0], phis, a[:, [i + 1 for i in vals]]
        th, ph, H = read("Fig1_a.txt")
        th2, ph2, He = read("Fig1_b.txt")
        assert np.allclose(ph, ph2)
        return cls(th, th2, ph, H, He)

    def curves(self, phi: float, theta: np.ndarray = THETA) -> tuple[np.ndarray, np.ndarray]:
        """d_H(theta), d_He(theta) at modulation phi [MV] on integer-degree zenith nodes.

        Linear interpolation in theta (as plotted by the authors) and in phi; linear
        extrapolation outside 400-800 MV (Guo et al. 2026 sites go down to 381.9 MV).
        """
        def at_phi(M, nodes):
            p = self.phis
            if phi <= p[0]:
                i0, i1 = 0, 1
            elif phi >= p[-1]:
                i0, i1 = len(p) - 2, len(p) - 1
            else:
                i1 = int(np.searchsorted(p, phi)); i0 = i1 - 1
            w = (phi - p[i0]) / (p[i1] - p[i0])
            col = FIG1_NORM * (M[:, i0] * (1 - w) + M[:, i1] * w)
            return np.interp(theta, nodes, col)
        return at_phi(self.dH, self.thH), at_phi(self.dHe, self.thHe)


@dataclass
class DoseResult:
    D_H: float
    D_He: float
    D_sky: float
    D_sky_fullsky: float
    B: float                 # blocked solid-angle fraction
    D_albedo_FT: float
    D_total: float
    D_total_flat: float

    @property
    def rel_total(self) -> float:          # modeled total relative to flat open terrain
        return self.D_total / self.D_total_flat

    @property
    def rel_sky(self) -> float:            # sky (downward) component only, relative to full sky
        return self.D_sky / self.D_sky_fullsky

    def as_dict(self):
        d = {k: float(getattr(self, k)) for k in self.__dataclass_fields__}
        d.update(rel_total=self.rel_total, rel_sky=self.rel_sky)
        return d


class TerrainDoseModel:
    def __init__(self, zm: ZenithModel | None = None, k_heavy=K_HEAVY, k_radial=K_RADIAL,
                 alpha=ALPHA_DEFAULT):
        self.zm = zm or ZenithModel.load()
        self.k_heavy, self.k_radial, self.alpha = k_heavy, k_radial, alpha

    def sky_components(self, ros: np.ndarray, phi: float):
        dH, dHe = self.zm.curves(phi)
        vis = 1.0 - ros
        DH = self.k_radial * float(np.sum(vis * dH))
        DHe = self.k_radial * float(np.sum(vis * dHe))
        return DH, DHe, self.k_heavy * (DH + DHe)

    def dose(self, ros: np.ndarray, phi: float = 500.0, B: float | None = None,
             D_albedo_FT: float | None = None) -> DoseResult:
        B = blocked_solid_angle_fraction(ros) if B is None else B
        DH, DHe, Dsky = self.sky_components(ros, phi)
        _, _, Dfs = self.sky_components(np.zeros_like(THETA), phi)
        if D_albedo_FT is None:
            # alpha = Dalb / (Dsky_fullsky + Dalb)  ->  Dalb = alpha/(1-alpha) * Dsky_fullsky
            D_albedo_FT = self.alpha / (1 - self.alpha) * Dfs
        Dtot = Dsky + (1 + B) * D_albedo_FT
        return DoseResult(DH, DHe, Dsky, Dfs, B, D_albedo_FT, Dtot, Dfs + D_albedo_FT)

    def dose_from_horizon(self, elev_deg: np.ndarray, phi: float = 500.0, **kw) -> DoseResult:
        return self.dose(blocked_fraction_by_zenith(elev_deg), phi, **kw)

    def zenith_contribution(self, phi: float = 500.0) -> np.ndarray:
        """Full-sky downward dose per 1 deg zenith bin (uGy/d), heavy-ion & radial factors applied."""
        dH, dHe = self.zm.curves(phi)
        return self.k_heavy * self.k_radial * (dH + dHe)

    # vectorised for maps: ros has shape (N, 91)
    def rel_total_map(self, ros: np.ndarray, phi: float = 500.0) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        w = np.sin(np.radians(THETA))
        B = ros @ w / w.sum()
        dz = self.zenith_contribution(phi)
        Dfs = dz.sum()
        Dsky = (1 - ros) @ dz
        Dalb = self.alpha / (1 - self.alpha) * Dfs
        tot = Dsky + (1 + B) * Dalb
        return tot / (Dfs + Dalb), Dsky / Dfs, B


def obstruction_proxy(ros: np.ndarray) -> float:
    """Pure geometric proxy (no radiation physics): blocked solid-angle fraction. Reported
    alongside the model so users can see the difference between 'sky blocked' and 'dose reduced'."""
    return blocked_solid_angle_fraction(ros)

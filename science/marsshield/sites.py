"""Curiosity positions during published RAD periods, and terrain loading helpers."""
from __future__ import annotations

from functools import lru_cache

import numpy as np

from . import config as C
from .horizon import Grid, TerrainStack
from .ingest import load_waypoints
from .published import GUO2026_TABLE1, M12, table1


@lru_cache(maxsize=1)
def grids() -> tuple[Grid, Grid, Grid]:
    near = Grid.from_tif(C.RAW / "dem" / "gale_dem_1m_near.tif", "gale1m")
    mid = Grid.from_tif(C.RAW / "dem" / f"gale_dem_{C.MID_STEP}m_mid.tif", f"gale{C.MID_STEP}m")
    far = Grid.from_tif(C.RAW / "dem" / "hrsc_mola_200m_far.tif", "hrscmola200m")
    return near, mid, far


def stack(include_far: bool = True) -> TerrainStack:
    n, m, f = grids()
    return TerrainStack([n, m, f] if include_far else [n, m])


def positions_during(sol_a: float, sol_b: float) -> list[dict]:
    """Waypoints occupied during [sol_a, sol_b), with occupancy weights (sols).

    MMGIS waypoints are end-of-drive localisations tagged with the sol of the drive. The
    rover occupies a waypoint from its drive sol until the next drive. Drives happen in the
    afternoon, so a waypoint tagged sol s is assumed occupied from s + 0.5.
    """
    wps = sorted(load_waypoints(), key=lambda p: (p["sol"], p["site"], p["drive"]))
    # collapse multiple waypoints on the same sol to the last one (final position that sol)
    by_sol: dict[int, dict] = {}
    for p in wps:
        by_sol[p["sol"]] = p
    seq = sorted(by_sol.values(), key=lambda p: p["sol"])
    starts = np.array([p["sol"] + 0.5 for p in seq])
    out = []
    for i, p in enumerate(seq):
        a = starts[i]
        b = starts[i + 1] if i + 1 < len(seq) else np.inf
        ov = min(b, sol_b) - max(a, sol_a)
        if ov > 0:
            out.append(dict(x=p["easting"], y=p["northing"], z=p["elev_geoid"], sol=p["sol"],
                            rmc=p["RMC"], weight=float(ov)))
    return out


def period_positions(period: str) -> list[dict]:
    if period == "M12":
        return positions_during(M12["sol_start"], M12["sol_end"] + 1)
    t = table1(period)
    return positions_during(t["sol_start"], t["sol_end"])


ALL_PERIODS = list(GUO2026_TABLE1.keys())

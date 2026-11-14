"""FastAPI service: live route planning and point sky analysis.

Run:  uvicorn marsshield.api:app --port 8765   (from the science/ directory)
"""
from __future__ import annotations

import json

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import config as C
from . import planner

from contextlib import asynccontextmanager  # noqa: E402

app = FastAPI(title="MarsShield science API", version="1.1", lifespan=lambda a: lifespan(a))
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class RouteRequest(BaseModel):
    start: tuple[float, float]
    end: tuple[float, float]
    stops: list[tuple[float, float]] = Field(default_factory=list)
    dwell_h: float = Field(0.0, ge=0, le=12)
    phi: float = Field(500.0, ge=350, le=900)
    alpha: float = Field(0.21, ge=0.18, le=0.24)


@asynccontextmanager
async def lifespan(_app):
    planner.router(0.21)          # warm the routing graph before the first request
    yield


@app.get("/api/health")
def health():
    g = planner.grid()
    return dict(ok=True, grid=list(g["z"].shape), res=float(g["res"]))


@app.post("/api/routes")
def routes(req: RouteRequest):
    try:
        return planner.plan(req.start, req.end, req.stops, req.dwell_h, req.phi, req.alpha)
    except ValueError as e:
        raise HTTPException(400, str(e))


class BreakEvenRequest(BaseModel):
    start: tuple[float, float]
    end: tuple[float, float]
    target: tuple[float, float]
    radius_m: float = Field(150.0, ge=20, le=400)
    phi: float = Field(500.0, ge=350, le=900)
    alpha: float = Field(0.21, ge=0.18, le=0.24)
    duration_h: list[float] | None = Field(None, min_length=3, max_length=3)


class MissionRequest(BaseModel):
    ids: list[str] = Field(..., min_length=2, max_length=6)
    phi: float = Field(500.0, ge=350, le=900)
    alpha: float = Field(0.21, ge=0.18, le=0.24)
    durations: dict[str, float] | None = None


@app.post("/api/mission")
def mission(req: MissionRequest):
    from . import mission as M
    try:
        return M.plan_mission(req.ids, req.phi, req.alpha, req.durations)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/targets")
def targets():
    from .targets import build
    return build()


@app.post("/api/breakeven")
def breakeven(req: BreakEvenRequest):
    from . import breakeven as BE
    try:
        return BE.explore(req.start, req.end, req.target, req.radius_m, req.phi, req.alpha, duration_h=req.duration_h)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/sky")
def sky(x: float, y: float, h: float = C.ASTRONAUT_HEIGHT_M, phi: float = 500.0, alpha: float = 0.21):
    b = C.NEAR_BOUNDS
    if not (b["left"] <= x <= b["right"] and b["bottom"] <= y <= b["top"]):
        raise HTTPException(400, "point outside 1 m DEM coverage")
    return planner.sky_at(x, y, h, phi, alpha)


@app.get("/api/validation")
def validation():
    return json.loads((C.PROC / "validation.json").read_text())

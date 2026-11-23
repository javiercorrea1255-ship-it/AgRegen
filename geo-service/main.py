"""
AgRegen – Geo-Service (FastAPI) v3.1.1
Microservicio geoestadístico para el Módulo de Manejo Variable por Zonas.

F2-09: main.py refactored into modular routers:
  routers/sampling.py      — health, grid, sample-size, diagnose
  routers/interpolation.py — interpolate, variogram-lags
  routers/zones.py         — zonify
  routers/raster.py        — geotiff
  routers/prescription.py  — VRA prescriptions (Fase 3 placeholder)

All endpoints are registered under BOTH short paths (for local dev) and the
canonical /api/geo/* prefix (as per the AgRegen API contract):

  GET  /health              →  GET  /api/geo/health
  POST /grid                →  POST /api/geo/sampling-grid
  POST /sample-size         →  POST /api/geo/sample-size
  POST /interpolate         →  POST /api/geo/interpolate
  POST /zonify              →  POST /api/geo/zonify
  POST /variogram-lags      →  POST /api/geo/variogram-lags
  POST /diagnose            →  POST /api/geo/diagnose
  POST /geotiff             →  POST /api/geo/geotiff
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import sampling, interpolation, zones, raster, prescription, drone

app = FastAPI(title="AgRegen Geo-Service", version="3.2.0")

# F2-10: CORS configurable via ALLOWED_ORIGINS env var.
# Development (default): no env var → permissive wildcard "*".
# Production: set ALLOWED_ORIGINS="https://app.example.com" (comma-separated for multiple origins).
_origins_env = os.environ.get("ALLOWED_ORIGINS", "*")
_origins = [o.strip() for o in _origins_env.split(",")] if _origins_env != "*" else ["*"]
# allow_credentials requires explicit origins (browsers block credentials + wildcard).
_allow_credentials = _origins != ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=_allow_credentials,
)

# ─── Short paths (local dev / legacy) ─────────────────────────────────────────
app.include_router(sampling.router)
app.include_router(interpolation.router)
app.include_router(zones.router)
app.include_router(raster.router)
app.include_router(prescription.router)
app.include_router(drone.router)

# ─── Canonical /api/geo/* prefix paths ────────────────────────────────────────
app.include_router(sampling.router, prefix="/api/geo", include_in_schema=False)
app.include_router(interpolation.router, prefix="/api/geo", include_in_schema=False)
app.include_router(zones.router, prefix="/api/geo", include_in_schema=False)
app.include_router(raster.router, prefix="/api/geo", include_in_schema=False)
app.include_router(prescription.router, prefix="/api/geo", include_in_schema=False)
app.include_router(drone.router, prefix="/api/geo", include_in_schema=False)

"""
Shared models, helpers, and utilities used across multiple routers.
F2-09: Extracted from main.py to support modularization.
"""
import numpy as np
import shapely
from shapely.geometry import Polygon as ShapelyPolygon
from fastapi import HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any


class SamplingPoint(BaseModel):
    lon: float
    lat: float
    value: float
    composite_n: int = Field(default=5, ge=1, le=20,
                             description="F2-07: Number of sub-samples mixed at this GPS point")
    composite_radius_m: float = Field(default=3.0, ge=0.5, le=10.0,
                                      description="F2-07: Radius of sub-sampling circle in metres")


class HealthResponse(BaseModel):
    status: str
    version: str


def _safe_error(e: Exception, context: str = "") -> str:
    return f"{context}: {type(e).__name__}: {str(e)[:200]}" if context else f"{type(e).__name__}: {str(e)[:200]}"


def _validate_polygon_or_400(polygon_coords: List[List[float]], context: str = "polygon") -> ShapelyPolygon:
    if not polygon_coords or len(polygon_coords) < 3:
        raise HTTPException(status_code=400, detail=f"{context}: se requieren al menos 3 vértices")
    try:
        poly = ShapelyPolygon(polygon_coords)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"{context}: geometría inválida ({type(e).__name__})")
    if not poly.is_valid:
        raise HTTPException(
            status_code=400,
            detail=f"{context}: polígono inválido (probablemente vértices duplicados o área cero)",
        )
    if not poly.is_simple:
        raise HTTPException(
            status_code=400,
            detail=f"{context}: el polígono se auto-intersecta. Corrige los vértices para que los lados no se crucen.",
        )
    if poly.area <= 0:
        raise HTTPException(status_code=400, detail=f"{context}: área del polígono es cero")
    return poly


def _mask_outside_polygon(
    z: np.ndarray,
    grid_x: np.ndarray,
    grid_y: np.ndarray,
    polygon_coords: List[List[float]],
    cell_coverage: bool = False,
) -> np.ndarray:
    try:
        poly = ShapelyPolygon(polygon_coords)
        shapely.prepare(poly)
        flat_x = grid_x.ravel().astype(float)
        flat_y = grid_y.ravel().astype(float)
        inside = shapely.intersects_xy(poly, flat_x, flat_y) if cell_coverage else shapely.contains_xy(poly, flat_x, flat_y)
        if cell_coverage and grid_x.shape[1] > 1 and grid_y.shape[0] > 1:
            dx = float(np.median(np.diff(grid_x[0]))) / 2
            dy = float(np.median(np.diff(grid_y[:, 0]))) / 2
            cells = shapely.box(flat_x - dx, flat_y - dy, flat_x + dx, flat_y + dy)
            inside |= shapely.area(shapely.intersection(cells, poly)) > 0
        z_masked = z.copy().astype(float)
        z_masked.ravel()[~inside] = np.nan
        return z_masked
    except Exception:
        return z


def _forward_transform(val: float, transform: str, shift: float = 0.0, lambda_: float = 1.0) -> float:
    if transform in (None, "none"):
        return val
    if transform == "log1p":
        return float(np.log1p(max(val + shift, 0.0)))
    if transform == "sqrt":
        return float(np.sqrt(max(val + shift, 0.0)))
    if transform == "boxcox":
        v = max(val + shift, 1e-10)
        if abs(lambda_) < 1e-10:
            return float(np.log(v))
        return float((v ** lambda_ - 1.0) / lambda_)
    return val


def _percentile_bounds(z_masked: np.ndarray, p_low: float = 2.0, p_high: float = 98.0):
    valid = z_masked.ravel()
    valid = valid[~np.isnan(valid)]
    if len(valid) < 2:
        center = float(np.nanmean(z_masked)) if not np.all(np.isnan(z_masked)) else 0.0
        half = max(1e-3, abs(center) * 0.05)
        return center - half, center + half, True
    vmin = float(np.percentile(valid, p_low))
    vmax = float(np.percentile(valid, p_high))
    center = (vmin + vmax) / 2.0
    relative_range = (vmax - vmin) / max(abs(center), 1e-6)
    near_constant = vmax - vmin < 1e-9 or relative_range < 0.01
    if near_constant:
        half = max(1e-3, abs(center) * 0.05)
        vmin, vmax = center - half, center + half
    return vmin, vmax, near_constant

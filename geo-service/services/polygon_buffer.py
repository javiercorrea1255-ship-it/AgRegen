"""Interior polygon buffer — F1-01.

Applies a negative (inward) buffer to a WGS84 polygon to prevent sampling
points from falling too close to field boundaries.

Algorithm:
  1. Project polygon vertices to local Cartesian space using Bowring WGS84 formulas.
  2. Apply Shapely negative buffer (in metres).
  3. Reproject back to geographic degrees.

Returns the original polygon unchanged when:
  - buffer_m <= 0
  - the buffered polygon is empty or degenerate (< 3 vertices)
  - any internal error occurs (fail-safe)
"""
import numpy as np
from typing import List, Tuple, Dict, Any
from shapely.geometry import Polygon as ShapelyPolygon


def _bowring_deg_to_m(lat_deg: float) -> tuple:
    """WGS84 metres-per-degree at *lat_deg* using Bowring (1985) series expansions.

    Returns (metres_per_degree_lat, metres_per_degree_lon).
    Accurate to ~1 cm for parcels up to ~50 km at any non-polar latitude.
    Latitude is clamped to ±89.9° to avoid the longitude singularity at the poles.
    """
    lat_safe = max(min(float(lat_deg), 89.9), -89.9)
    phi = np.radians(lat_safe)
    lat_m = 111132.954 - 559.822 * np.cos(2.0 * phi) + 1.175 * np.cos(4.0 * phi)
    lon_m = (
        111412.84 * np.cos(phi)
        - 93.5 * np.cos(3.0 * phi)
        + 0.118 * np.cos(5.0 * phi)
    )
    lon_m = max(lon_m, 1e-3)
    return float(lat_m), float(lon_m)


def _do_buffer(polygon: List[List[float]], buffer_m: float):
    """Internal shared buffer logic. Returns (result_coords, meta_dict) or raises."""
    lons = [p[0] for p in polygon]
    lats = [p[1] for p in polygon]
    cx = float(np.mean(lons))
    cy = float(np.mean(lats))
    lat_m_per_deg, lon_m_per_deg = _bowring_deg_to_m(cy)

    coords_m = [
        (
            (p[0] - cx) * lon_m_per_deg,
            (p[1] - cy) * lat_m_per_deg,
        )
        for p in polygon
    ]

    poly_m = ShapelyPolygon(coords_m)
    if not poly_m.is_valid:
        poly_m = poly_m.buffer(0)

    if poly_m.is_empty or poly_m.area <= 0:
        return None, {"reason": "área del polígono es cero"}

    original_area_m2 = poly_m.area
    buffered_m = poly_m.buffer(-abs(buffer_m))

    if buffered_m.is_empty or buffered_m.area < 1.0:
        return None, {
            "reason": "parcela demasiado pequeña para el buffer solicitado",
            "min_width_m_approx": float(2 * buffer_m),
        }

    if buffered_m.geom_type == "MultiPolygon":
        buffered_m = max(buffered_m.geoms, key=lambda g: g.area)

    if buffered_m.geom_type != "Polygon" or buffered_m.is_empty:
        return None, {"reason": "resultado no es un polígono simple"}

    result = []
    for mx, my in buffered_m.exterior.coords:
        lon = mx / lon_m_per_deg + cx
        lat = my / lat_m_per_deg + cy
        result.append([round(lon, 8), round(lat, 8)])

    if len(result) < 3:
        return None, {"reason": "polígono erosionado degenerado"}

    area_ratio = float(buffered_m.area / original_area_m2)
    meta = {
        "buffer_applied_m": float(buffer_m),
        "buffer_skipped": False,
        "area_ratio": round(area_ratio, 4),
        "polygon_buffered": result,
    }
    return result, meta


def apply_interior_buffer(
    polygon: List[List[float]],
    buffer_m: float,
) -> List[List[float]]:
    """Apply an interior (negative) buffer of *buffer_m* metres to a WGS84 polygon.

    Returns the buffered polygon as a list of [lon, lat] pairs.
    Falls back to the original polygon on any failure.

    This is the backward-compatible version used by generate_grid().
    For the version that also returns buffer metadata, use apply_interior_buffer_with_meta().
    """
    if buffer_m <= 0.0:
        return polygon
    if len(polygon) < 3:
        return polygon
    try:
        result, meta = _do_buffer(polygon, buffer_m)
        if result is None:
            return polygon
        return result
    except Exception:
        return polygon


def apply_interior_buffer_with_meta(
    polygon: List[List[float]],
    buffer_m: float,
) -> Tuple[List[List[float]], Dict[str, Any]]:
    """Apply an interior (negative) buffer and return (coords, meta) tuple.

    F1-01: meta dict contains:
      - buffer_applied_m  : float — actual buffer applied (0 if skipped)
      - buffer_skipped    : bool — True when buffer was not applied
      - area_ratio        : float — buffered_area / original_area (absent when skipped)
      - polygon_buffered  : list — the buffered polygon coordinates

    Falls back to the original polygon on any failure.
    """
    if buffer_m <= 0.0:
        meta: Dict[str, Any] = {
            "buffer_applied_m": 0.0,
            "buffer_skipped": False,
            "polygon_buffered": polygon,
        }
        return polygon, meta

    if len(polygon) < 3:
        meta = {
            "buffer_applied_m": 0.0,
            "buffer_skipped": True,
            "reason": "polígono inválido (<3 vértices)",
            "polygon_buffered": polygon,
        }
        return polygon, meta

    try:
        result, meta = _do_buffer(polygon, buffer_m)
        if result is None:
            fallback_meta: Dict[str, Any] = {
                "buffer_applied_m": 0.0,
                "buffer_skipped": True,
                "polygon_buffered": polygon,
                **meta,
            }
            return polygon, fallback_meta
        return result, meta
    except Exception as exc:
        meta = {
            "buffer_applied_m": 0.0,
            "buffer_skipped": True,
            "reason": str(exc)[:80],
            "polygon_buffered": polygon,
        }
        return polygon, meta

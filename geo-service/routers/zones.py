"""
Zones router — /zonify, /zonify-from-raster, /zones-export-shp, /zones-export-geotiff.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import io
import json
import tempfile
import zipfile
from typing import List, Optional, Dict, Any

import numpy as np
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from services.zonify import create_zones
from services.interpolation import _back_transform, _back_transform_std
from routers.shared import _safe_error, _validate_polygon_or_400, _mask_outside_polygon

router = APIRouter()


class ZonifyRequest(BaseModel):
    # Accept None for masked / cloudy / out-of-polygon pixels — the JS client
    # serializes JS NaN as JSON null, and pydantic must not reject those.
    # The endpoint converts None → np.nan before zonification.
    grid_values: List[List[Optional[float]]] = Field(..., description="Raster como lista 2D de valores (None = pixel enmascarado)")
    bbox: Dict[str, float] = Field(..., description="{minx, miny, maxx, maxy}")
    n_zones: int = Field(default=3, ge=1, le=6)
    grid_layout: str = Field(default="legacy_endpoints", pattern="^(legacy_endpoints|cell_centers)$")
    method: str = Field(default="spatial_kmeans")
    variable_code: Optional[str] = Field(default="default")
    auto_k: Optional[bool] = Field(default=False)
    polygon: Optional[List[List[float]]] = Field(default=None, description="Parcel boundary [[lon,lat],...] for masking and clipping zones to the field boundary")
    min_zone_area_ha: float = Field(default=0.25, ge=0.01, le=10.0,
                                    description="F2-05: Minimum operable zone area in hectares")
    apply_mode_filter: bool = Field(default=True,
                                    description="F2-05: Apply 3×3 mode filter to remove salt-and-pepper noise")
    # Transform params: the raster may be in transformed space (Box-Cox/log1p/sqrt).
    # When provided, zone statistics are back-transformed to original agronomic units.
    transform_type: Optional[str] = Field(default="none",
                                          description="Transform applied to raster: none | log1p | sqrt | boxcox")
    transform_shift: Optional[float] = Field(default=0.0,
                                             description="Shift added before forward transform (for non-negative guarantee)")
    transform_lambda: Optional[float] = Field(default=None,
                                              description="Box-Cox lambda (required when transform_type='boxcox')")


@router.post("/zonify")
def handle_zonify(req: ZonifyRequest):
    """Re-zonification of an existing interpolation result (2D value list)."""
    try:
        z = np.array(req.grid_values, dtype=float)
        if z.ndim != 2 or z.shape[0] == 0 or z.shape[1] == 0:
            raise ValueError(f"grid_values debe ser una matriz 2D no vacía, shape: {z.shape}")

        rows, cols = z.shape
        bbox = req.bbox
        minx, miny = bbox["minx"], bbox["miny"]
        maxx, maxy = bbox["maxx"], bbox["maxy"]

        xs = minx + (np.arange(cols) + .5) * (maxx - minx) / cols
        ys = miny + (np.arange(rows) + .5) * (maxy - miny) / rows
        if req.grid_layout == "legacy_endpoints":
            xs, ys = np.linspace(minx, maxx, cols), np.linspace(miny, maxy, rows)
        grid_x, grid_y = np.meshgrid(xs, ys)

        parcel_geom = None
        if req.polygon and len(req.polygon) >= 3:
            parcel_geom = _validate_polygon_or_400(req.polygon, context="polygon")
            z = _mask_outside_polygon(z, grid_x, grid_y, req.polygon, cell_coverage=req.grid_layout == "cell_centers")

        cell_size = (maxx - minx) / max(cols, 1)
        zone_labels, zone_features, zone_membership_u = create_zones(
            grid_x, grid_y, z,
            n_zones=req.n_zones,
            cell_size_deg=cell_size,
            method=req.method or "spatial_kmeans",
            variable_code=req.variable_code or "default",
            auto_k=req.auto_k or False,
            parcel_polygon_geom=parcel_geom,
            min_zone_area_ha=req.min_zone_area_ha,
            apply_mode_filter=req.apply_mode_filter,
        )

        # Back-transform zone statistics to original agronomic units when the raster
        # was produced with a non-identity transform. _back_transform is a no-op for
        # transform_type="none", so this is always safe to apply.
        ttype = req.transform_type or "none"
        tshift = float(req.transform_shift or 0.0)
        tlam = float(req.transform_lambda) if req.transform_lambda is not None else 0.0
        _applying = ttype not in ("none", "identity")
        for _feat in zone_features:
            # Capture mean in transformed space before overwriting (needed by delta method).
            _mean_t = _feat.get("value_mean")
            for _stat in ("value_mean", "value_min", "value_max"):
                _v = _feat.get(_stat)
                if _v is not None:
                    try:
                        _bt = _back_transform(np.array([float(_v)]), ttype, tshift, tlam)
                        _feat[_stat] = max(float(_bt[0]), 0.0) if _applying else float(_bt[0])
                    except Exception:
                        pass  # leave in transformed space if inversion fails
            # Back-transform value_std via delta method.
            _std_t = _feat.get("value_std")
            if _std_t is not None and _mean_t is not None:
                try:
                    _feat["value_std"] = _back_transform_std(
                        float(_std_t), float(_mean_t), ttype, tshift, tlam
                    )
                except Exception:
                    pass  # safe fallback: leave in transformed space

        resp: Dict[str, Any] = {
            "zones": zone_features,
            "n_zones_actual": len(zone_features),
            "method": req.method,
            "auto_k": req.auto_k,
        }
        if zone_membership_u is not None:
            resp["membership_u"] = zone_membership_u.tolist()
        return resp

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=_safe_error(e, "zonify"))


@router.post("/zonify-from-raster")
def handle_zonify_from_raster(req: ZonifyRequest):
    """Explicit alias for /zonify, exposed under the name documented in the
    satellite-zonification spec. Both endpoints share the same request shape
    and behaviour — the alias exists so callers can reference the contract by
    its documented path. Behaviourally identical to /zonify."""
    return handle_zonify(req)


# ─── Vector + raster export of saved zones ──────────────────────────────────

class ZoneExportFeature(BaseModel):
    zone_index: int
    zone_label: Optional[str] = None
    category: Optional[str] = None
    color_hex: Optional[str] = None
    area_ha: Optional[float] = None
    value_mean: Optional[float] = None
    value_std: Optional[float] = None
    value_min: Optional[float] = None
    value_max: Optional[float] = None
    polygon_geojson: Dict[str, Any] = Field(..., description="GeoJSON Polygon or MultiPolygon")


class ZoneExportShpRequest(BaseModel):
    zones: List[ZoneExportFeature]
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Free-form metadata embedded as zones_metadata.json")
    base_filename: str = Field(default="zonas_satelite")


class ZoneExportGeotiffRequest(BaseModel):
    zones: List[ZoneExportFeature]
    bbox: Dict[str, float] = Field(..., description="{minx, miny, maxx, maxy} in EPSG:4326")
    cell_size_deg: Optional[float] = Field(default=None, description="Pixel size in degrees; if omitted, derived from bbox to ~10 m at parcel latitude")
    metadata: Dict[str, Any] = Field(default_factory=dict)
    base_filename: str = Field(default="zonas_satelite")


def _normalize_geom(g: Any) -> Dict[str, Any]:
    if isinstance(g, str):
        g = json.loads(g)
    if isinstance(g, dict) and g.get("type") == "Feature":
        g = g.get("geometry")
    if not isinstance(g, dict) or g.get("type") not in ("Polygon", "MultiPolygon"):
        raise ValueError(f"Geometría inválida (se esperaba Polygon o MultiPolygon): {type(g).__name__}")
    return g


@router.post("/zones-export-shp")
def handle_zones_export_shp(req: ZoneExportShpRequest):
    """Export a list of polygon zones as an ESRI Shapefile ZIP (EPSG:4326).

    Falls back to GeoJSON inside the ZIP if fiona is not installed.
    """
    if not req.zones:
        raise HTTPException(status_code=400, detail="Se requiere al menos una zona.")
    try:
        import fiona
        from fiona.crs import from_epsg
    except ImportError:
        # Fallback: GeoJSON-in-ZIP, with a header so the caller can warn the user.
        fc = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {
                        "zone_id": z.zone_index,
                        "zone_label": z.zone_label or f"Zona {z.zone_index + 1}",
                        "category": z.category,
                        "color": z.color_hex,
                        "area_ha": z.area_ha,
                        "value_mean": z.value_mean,
                        "value_std": z.value_std,
                        "value_min": z.value_min,
                        "value_max": z.value_max,
                    },
                    "geometry": _normalize_geom(z.polygon_geojson),
                }
                for z in req.zones
            ],
        }
        return Response(
            content=json.dumps(fc, ensure_ascii=False).encode("utf-8"),
            media_type="application/geo+json",
            headers={
                "Content-Disposition": f'attachment; filename="{req.base_filename}.geojson"',
                "X-Export-Warning": "fiona no disponible — exportación devuelta como GeoJSON.",
            },
        )

    schema = {
        "geometry": "Polygon",
        "properties": {
            "zone_id":    "int",
            "zone_label": "str:80",
            "category":   "str:40",
            "color":      "str:9",
            "area_ha":    "float",
            "v_mean":     "float",
            "v_std":      "float",
            "v_min":      "float",
            "v_max":      "float",
        },
    }

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            shp_path = os.path.join(tmpdir, f"{req.base_filename}.shp")
            with fiona.open(
                shp_path, mode="w", driver="ESRI Shapefile",
                schema=schema, crs=from_epsg(4326), encoding="utf-8",
            ) as out:
                for z in req.zones:
                    geom = _normalize_geom(z.polygon_geojson)
                    # Shapefile schema only supports Polygon → flatten MultiPolygon to first ring set.
                    if geom["type"] == "MultiPolygon":
                        for poly_coords in geom["coordinates"]:
                            out.write({
                                "geometry": {"type": "Polygon", "coordinates": poly_coords},
                                "properties": _shp_props(z),
                            })
                    else:
                        out.write({"geometry": geom, "properties": _shp_props(z)})

            buf = io.BytesIO()
            with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
                for ext in (".shp", ".shx", ".dbf", ".prj", ".cpg"):
                    p = shp_path.replace(".shp", ext)
                    if os.path.exists(p):
                        zf.write(p, arcname=f"{req.base_filename}{ext}")
                if req.metadata:
                    zf.writestr("zones_metadata.json", json.dumps(req.metadata, ensure_ascii=False, indent=2).encode("utf-8"))
            buf.seek(0)
            return Response(
                content=buf.read(),
                media_type="application/zip",
                headers={"Content-Disposition": f'attachment; filename="{req.base_filename}.zip"'},
            )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=_safe_error(e, "zones-export-shp"))


def _shp_props(z: ZoneExportFeature) -> Dict[str, Any]:
    return {
        "zone_id":    int(z.zone_index),
        "zone_label": (z.zone_label or f"Zona {z.zone_index + 1}")[:80],
        "category":   (z.category or "")[:40],
        "color":      (z.color_hex or "")[:9],
        "area_ha":    float(z.area_ha) if z.area_ha is not None else 0.0,
        "v_mean":     float(z.value_mean) if z.value_mean is not None else 0.0,
        "v_std":      float(z.value_std) if z.value_std is not None else 0.0,
        "v_min":      float(z.value_min) if z.value_min is not None else 0.0,
        "v_max":      float(z.value_max) if z.value_max is not None else 0.0,
    }


@router.post("/zones-export-geotiff")
def handle_zones_export_geotiff(req: ZoneExportGeotiffRequest):
    """Rasterize the zone polygons into a single-band GeoTIFF (EPSG:4326).

    Pixel value = ``zone_index + 1``; 0 means "outside any zone".
    Cell size defaults to ~10 m projected at the parcel latitude when not
    provided explicitly.
    """
    if not req.zones:
        raise HTTPException(status_code=400, detail="Se requiere al menos una zona.")
    try:
        import rasterio
        from rasterio.transform import from_bounds
        from rasterio.features import rasterize
        from shapely.geometry import shape
    except ImportError as e:
        raise HTTPException(status_code=500, detail=f"Dependencias faltantes para GeoTIFF: {e}")

    minx, miny = float(req.bbox["minx"]), float(req.bbox["miny"])
    maxx, maxy = float(req.bbox["maxx"]), float(req.bbox["maxy"])
    if maxx <= minx or maxy <= miny:
        raise HTTPException(status_code=400, detail="bbox inválido (maxx>minx, maxy>miny requerido).")

    if req.cell_size_deg and req.cell_size_deg > 0:
        cell = float(req.cell_size_deg)
    else:
        # ~10 m at the parcel latitude. 1° lat ≈ 111_320 m.
        lat_mean = (miny + maxy) / 2.0
        lat_rad = np.deg2rad(lat_mean)
        meters_per_deg_lon = 111_320.0 * max(np.cos(lat_rad), 1e-6)
        meters_per_deg_lat = 110_540.0
        cell_lon = 10.0 / meters_per_deg_lon
        cell_lat = 10.0 / meters_per_deg_lat
        cell = float(min(cell_lon, cell_lat))

    width = max(1, min(8000, int(np.ceil((maxx - minx) / cell))))
    height = max(1, min(8000, int(np.ceil((maxy - miny) / cell))))
    transform = from_bounds(minx, miny, maxx, maxy, width, height)

    shapes = []
    for z in req.zones:
        try:
            geom = shape(_normalize_geom(z.polygon_geojson))
            if not geom.is_empty:
                shapes.append((geom.__geo_interface__, int(z.zone_index) + 1))
        except Exception:
            continue
    if not shapes:
        raise HTTPException(status_code=422, detail="Ninguna geometría válida para rasterizar.")

    raster = rasterize(
        shapes=shapes,
        out_shape=(height, width),
        transform=transform,
        fill=0,
        dtype="uint8",
        all_touched=True,
    )

    buf = io.BytesIO()
    with rasterio.MemoryFile(buf) as memfile:
        with memfile.open(
            driver="GTiff",
            height=height,
            width=width,
            count=1,
            dtype="uint8",
            crs="EPSG:4326",
            transform=transform,
            nodata=0,
            compress="deflate",
        ) as dst:
            dst.write(raster, 1)
            tags = {f"ZONE_{z.zone_index + 1}": (z.zone_label or f"Zona {z.zone_index + 1}") for z in req.zones}
            tags.update({k: str(v) for k, v in (req.metadata or {}).items()})
            dst.update_tags(**tags)
        out_bytes = memfile.read()

    return Response(
        content=out_bytes,
        media_type="image/tiff",
        headers={"Content-Disposition": f'attachment; filename="{req.base_filename}.tif"'},
    )

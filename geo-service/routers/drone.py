"""
Drone imagery router — POST /drone-zonify

Accepts a multispectral GeoTIFF upload (output from DJI Terra, Pix4D,
Agisoft Metashape or similar photogrammetry software), calculates a
vegetation/soil index from the bands, and runs the same spatial zonification
pipeline used by the satellite module.

Supported DJI multispectral cameras (band layout):
  dji_p4m       — DJI P4 Multispectral:  Blue=1, Green=2, Red=3, RedEdge=4, NIR=5
  dji_mavic3m   — DJI Mavic 3M:          Green=1, Red=2, RedEdge=3, NIR=4
  dji_phantom4  — DJI Phantom 4 RTK + MicaSense RedEdge-MX: same as P4M
  generic       — user specifies each band number via form fields
  precalculated — single-band GeoTIFF already containing the index value

Supported indices: ndvi, ndre, ndmi, evi, gndvi, msavi
"""
import io
import json
import math
from typing import Optional

import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.warp import calculate_default_transform, reproject

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from routers.shared import _safe_error, _validate_polygon_or_400, _mask_outside_polygon
from services.zonify import create_zones

router = APIRouter()

# ── Camera band presets ────────────────────────────────────────────────────────
CAMERA_PRESETS: dict[str, dict[str, int]] = {
    "dji_p4m": {
        "blue": 1, "green": 2, "red": 3, "rededge": 4, "nir": 5,
    },
    "dji_phantom4": {
        "blue": 1, "green": 2, "red": 3, "rededge": 4, "nir": 5,
    },
    "dji_mavic3m": {
        "green": 1, "red": 2, "rededge": 3, "nir": 4,
    },
}

# ── Index metadata (for result annotation) ────────────────────────────────────
INDEX_META: dict[str, dict] = {
    "ndvi":  {"name": "Vigor (NDVI)",                    "unit": "índice", "min": 0.55, "max": 0.85, "code": "NDVI"},
    "ndre":  {"name": "Estado nitrogenado (NDRE)",       "unit": "índice", "min": 0.30, "max": 0.55, "code": "NDRE"},
    "ndmi":  {"name": "Humedad foliar (NDMI)",           "unit": "índice", "min": 0.20, "max": 0.50, "code": "NDMI"},
    "evi":   {"name": "Vigor mejorado (EVI)",            "unit": "índice", "min": 0.40, "max": 0.70, "code": "EVI"},
    "gndvi": {"name": "Verdor / clorofila (GNDVI)",      "unit": "índice", "min": 0.40, "max": 0.70, "code": "GNDVI"},
    "msavi": {"name": "Vigor con suelo desnudo (MSAVI)", "unit": "índice", "min": 0.30, "max": 0.65, "code": "MSAVI"},
}


def _read_band(src: rasterio.DatasetReader, band_num: int) -> np.ndarray:
    """Read a band as float32, converting NoData to NaN."""
    data = src.read(band_num).astype(np.float64)
    nd = src.nodata
    if nd is not None:
        data[data == nd] = np.nan
    data[~np.isfinite(data)] = np.nan
    return data


def _compute_index(
    index_type: str,
    bands: dict[str, np.ndarray],
) -> np.ndarray:
    """Calculate vegetation index from band arrays. Returns float64 array with NaN for invalid pixels."""
    eps = 1e-9
    t = index_type.lower()

    def get(name: str) -> np.ndarray:
        if name not in bands:
            raise HTTPException(status_code=400, detail=f"Banda '{name}' requerida para {t.upper()} no está disponible. Verifica el tipo de cámara y los números de banda.")
        return bands[name]

    if t == "ndvi":
        nir, red = get("nir"), get("red")
        return (nir - red) / (nir + red + eps)
    if t == "ndre":
        nir, re = get("nir"), get("rededge")
        return (nir - re) / (nir + re + eps)
    if t == "ndmi":
        nir, re = get("nir"), get("rededge")
        return (nir - re) / (nir + re + eps)
    if t == "evi":
        nir, red, blue = get("nir"), get("red"), get("blue")
        return 2.5 * (nir - red) / (nir + 6.0 * red - 7.5 * blue + 1.0 + eps)
    if t == "gndvi":
        nir, grn = get("nir"), get("green")
        return (nir - grn) / (nir + grn + eps)
    if t == "msavi":
        nir, red = get("nir"), get("red")
        inner = (2.0 * nir + 1.0) ** 2 - 8.0 * (nir - red)
        inner = np.where(inner < 0, 0.0, inner)
        return (2.0 * nir + 1.0 - np.sqrt(inner)) / 2.0
    raise HTTPException(status_code=400, detail=f"Índice '{index_type}' no reconocido. Valores válidos: ndvi, ndre, ndmi, evi, gndvi, msavi.")


def _reproject_to_wgs84(src: rasterio.DatasetReader) -> tuple[np.ndarray, dict]:
    """Reproject dataset to EPSG:4326 and return (data[bands,H,W], transform_dict)."""
    dst_crs = CRS.from_epsg(4326)
    transform, width, height = calculate_default_transform(
        src.crs, dst_crs, src.width, src.height, *src.bounds
    )
    out = np.zeros((src.count, height, width), dtype=np.float32)
    for b in range(1, src.count + 1):
        reproject(
            source=rasterio.band(src, b),
            destination=out[b - 1],
            src_transform=src.transform,
            src_crs=src.crs,
            dst_transform=transform,
            dst_crs=dst_crs,
            resampling=Resampling.bilinear,
            src_nodata=src.nodata,
            dst_nodata=np.nan,
        )
    left = transform.c
    top = transform.f
    right = left + transform.a * width
    bottom = top + transform.e * height
    info = {"transform": transform, "width": width, "height": height,
            "left": left, "bottom": bottom, "right": right, "top": top}
    return out, info


@router.post("/drone-zonify")
async def handle_drone_zonify(
    file: UploadFile = File(..., description="GeoTIFF ortofosmosaico multispectral (DJI Terra / Pix4D / Metashape)"),
    index_type: str = Form("ndvi", description="Índice: ndvi | ndre | ndmi | evi | gndvi | msavi | precalculated"),
    camera_type: str = Form("dji_p4m", description="Tipo de cámara: dji_p4m | dji_mavic3m | dji_phantom4 | generic | precalculated"),
    n_zones: int = Form(3, ge=2, le=6),
    method: str = Form("spatial_kmeans", description="Método: spatial_kmeans | jenks | quantiles | fuzzy"),
    auto_k: bool = Form(False),
    red_band: Optional[int] = Form(None, description="Número de banda Red (solo camera_type=generic)"),
    nir_band: Optional[int] = Form(None, description="Número de banda NIR (solo camera_type=generic)"),
    rededge_band: Optional[int] = Form(None, description="Número de banda Red Edge (solo camera_type=generic)"),
    green_band: Optional[int] = Form(None, description="Número de banda Green (solo camera_type=generic)"),
    blue_band: Optional[int] = Form(None, description="Número de banda Blue (solo camera_type=generic)"),
    polygon: Optional[str] = Form(None, description='Polígono de parcela JSON: [[lon,lat],...]'),
    max_side: int = Form(200, ge=50, le=500, description="Píxeles máximos por lado del raster de salida"),
    min_zone_area_ha: float = Form(0.1, ge=0.01, le=10.0),
) -> JSONResponse:
    """Process a drone multispectral GeoTIFF and return management zones."""
    # ── Validate content type ─────────────────────────────────────────────────
    ct = (file.content_type or "").lower()
    fname = (file.filename or "").lower()
    if not (ct in ("image/tiff", "image/geotiff", "application/octet-stream")
            or fname.endswith((".tif", ".tiff"))):
        raise HTTPException(
            status_code=400,
            detail="El archivo debe ser un GeoTIFF (.tif / .tiff). Exporta el ortomosaico desde DJI Terra, Pix4D o Metashape.",
        )

    # ── Read uploaded bytes ───────────────────────────────────────────────────
    raw = await file.read()
    if len(raw) < 100:
        raise HTTPException(status_code=400, detail="El archivo GeoTIFF está vacío o corrupto.")
    if len(raw) > 500 * 1024 * 1024:  # 500 MB
        raise HTTPException(status_code=413, detail="El archivo supera el límite de 500 MB. Reduce la resolución al exportar desde DJI Terra.")

    try:
        with rasterio.open(io.BytesIO(raw)) as src:
            n_bands = src.count

            # ── Validate CRS ──────────────────────────────────────────────────
            if src.crs is None:
                raise HTTPException(
                    status_code=400,
                    detail="El GeoTIFF no tiene sistema de referencia (CRS). Asegúrate de exportarlo georreferenciado desde DJI Terra o Pix4D.",
                )

            # ── Reproject to WGS84 if needed ──────────────────────────────────
            needs_reproject = src.crs.to_epsg() != 4326
            if needs_reproject:
                data_arr, info = _reproject_to_wgs84(src)
                left, bottom, right, top = info["left"], info["bottom"], info["right"], info["top"]
                # Rebuild band reader from reprojected data
                def read_band_idx(b_idx: int) -> np.ndarray:
                    arr = data_arr[b_idx - 1].astype(np.float64)
                    arr[arr == 0.0] = np.nan  # rasterio fills masked with 0 when nodata=nan
                    return arr
            else:
                left, bottom = src.bounds.left, src.bounds.bottom
                right, top = src.bounds.right, src.bounds.top

                def read_band_idx(b_idx: int) -> np.ndarray:
                    return _read_band(src, b_idx)

            # ── Determine band mapping ─────────────────────────────────────────
            ct_lower = camera_type.lower()
            if ct_lower == "precalculated" or index_type.lower() == "precalculated":
                if n_bands < 1:
                    raise HTTPException(status_code=400, detail="El GeoTIFF no contiene ninguna banda.")
                raw_index = read_band_idx(1).astype(np.float64)
            else:
                if ct_lower in CAMERA_PRESETS:
                    preset = CAMERA_PRESETS[ct_lower]
                elif ct_lower == "generic":
                    preset = {}
                    if red_band:
                        preset["red"] = red_band
                    if nir_band:
                        preset["nir"] = nir_band
                    if rededge_band:
                        preset["rededge"] = rededge_band
                    if green_band:
                        preset["green"] = green_band
                    if blue_band:
                        preset["blue"] = blue_band
                    if not preset:
                        raise HTTPException(status_code=400, detail="Para camera_type=generic, especifica al menos red_band y nir_band.")
                else:
                    raise HTTPException(status_code=400, detail=f"camera_type '{camera_type}' no reconocido.")

                # Read only the bands needed for this index
                needed: set[str] = {"nir", "red"}
                it = index_type.lower()
                if it in ("ndre", "ndmi"):
                    needed = {"nir", "rededge"}
                elif it == "evi":
                    needed = {"nir", "red", "blue"}
                elif it == "gndvi":
                    needed = {"nir", "green"}
                elif it == "msavi":
                    needed = {"nir", "red"}

                bands: dict[str, np.ndarray] = {}
                for band_name in needed:
                    if band_name not in preset:
                        raise HTTPException(
                            status_code=400,
                            detail=f"La banda '{band_name}' es necesaria para {index_type.upper()} pero no está definida en el preset '{camera_type}'. "
                                   f"Usa camera_type=generic y especifica los números de banda manualmente.",
                        )
                    b_num = preset[band_name]
                    if b_num > n_bands:
                        raise HTTPException(
                            status_code=400,
                            detail=f"El GeoTIFF tiene {n_bands} banda(s), pero se solicitó la banda {b_num} para '{band_name}'. "
                                   f"Verifica que el ortomosaico exportado tenga todas las bandas espectrales.",
                        )
                    bands[band_name] = read_band_idx(b_num)

                raw_index = _compute_index(index_type, bands)

        # ── Clip & downsample ─────────────────────────────────────────────────
        # Parse polygon
        parcel_poly: Optional[list] = None
        parcel_geom = None
        if polygon:
            try:
                parcel_poly = json.loads(polygon)
            except Exception:
                raise HTTPException(status_code=400, detail="polygon no es JSON válido.")
            if len(parcel_poly) >= 3:
                parcel_geom = _validate_polygon_or_400(parcel_poly, context="polygon")

        # Clamp index to [-1, 1] (spectral indices range)
        raw_index = np.clip(raw_index, -1.0, 1.0)

        # Downsample to max_side x max_side via block averaging
        H, W = raw_index.shape
        step_r = max(1, math.ceil(H / max_side))
        step_c = max(1, math.ceil(W / max_side))
        grid = raw_index[::step_r, ::step_c]
        rows_g, cols_g = grid.shape

        # Build coordinate grids matching the downsampled raster
        xs = np.linspace(left, right, cols_g)
        ys = np.linspace(top, bottom, rows_g)
        grid_x, grid_y = np.meshgrid(xs, ys)

        # Mask pixels outside parcel polygon
        if parcel_poly and parcel_geom is not None:
            grid = _mask_outside_polygon(grid, grid_x, grid_y, parcel_poly)

        # ── Zonify ─────────────────────────────────────────────────────────────
        cell_size = (right - left) / max(cols_g, 1)
        zone_labels, zone_features, zone_membership_u = create_zones(
            grid_x, grid_y, grid,
            n_zones=n_zones,
            cell_size_deg=cell_size,
            method=method,
            variable_code=INDEX_META.get(index_type.lower(), {}).get("code", "NDVI"),
            auto_k=auto_k,
            parcel_polygon_geom=parcel_geom,
            min_zone_area_ha=min_zone_area_ha,
            apply_mode_filter=True,
        )

        meta = INDEX_META.get(index_type.lower(), {})
        result = {
            "zones": zone_features,
            "n_zones_actual": len(zone_features),
            "method": method,
            "index_type": index_type.lower(),
            "index_name": meta.get("name", index_type.upper()),
            "index_unit": meta.get("unit", "índice"),
            "bbox": {"minx": left, "miny": bottom, "maxx": right, "maxy": top},
            "raster_shape": [rows_g, cols_g],
            "camera_type": camera_type,
            "n_bands_in_file": n_bands,
        }
        return JSONResponse(content=result)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=_safe_error(e, "drone-zonify"))


@router.get("/drone-zonify/info")
def drone_info():
    """Returns supported cameras, indices and band mappings."""
    return {
        "cameras": {
            "dji_p4m": {"label": "DJI P4 Multispectral", "bands": CAMERA_PRESETS["dji_p4m"]},
            "dji_mavic3m": {"label": "DJI Mavic 3 Multispectral", "bands": CAMERA_PRESETS["dji_mavic3m"]},
            "dji_phantom4": {"label": "DJI Phantom 4 RTK + MicaSense", "bands": CAMERA_PRESETS["dji_phantom4"]},
            "generic": {"label": "Genérico (especificar bandas manualmente)", "bands": {}},
            "precalculated": {"label": "Índice pre-calculado (1 banda)", "bands": {}},
        },
        "indices": {k: {"name": v["name"], "unit": v["unit"]} for k, v in INDEX_META.items()},
    }

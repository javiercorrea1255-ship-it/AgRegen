"""
F2-09: Raster router — /geotiff endpoint.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import numpy as np
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from typing import List, Optional, Dict

from routers.shared import _safe_error

router = APIRouter()


class GeoTiffRequest(BaseModel):
    grid_values: List[List[Optional[float]]] = Field(..., description="Raster 2D (None = NoData)")
    bbox: Dict[str, float] = Field(..., description="{minx, miny, maxx, maxy}")
    projection: str = Field(default="wgs84", description="F2-06: 'wgs84' | 'utm' — CRS for GeoTIFF export")


@router.post("/geotiff")
async def handle_geotiff(req: GeoTiffRequest) -> Response:
    """Genera y retorna un archivo GeoTIFF Float32. F2-06: soporta projection='utm'."""
    from services.raster import values_to_geotiff_bytes
    try:
        grid = req.grid_values
        if not grid or not grid[0]:
            raise HTTPException(status_code=400, detail="grid_values vacío o malformado")

        z = np.array(
            [[float("nan") if v is None else float(v) for v in row] for row in grid],
            dtype=np.float64,
        )
        if z.ndim != 2 or z.size == 0:
            raise HTTPException(status_code=400, detail="grid_values debe ser una matriz 2D no vacía")

        projection = getattr(req, "projection", "wgs84") or "wgs84"
        tif_bytes = values_to_geotiff_bytes(z, req.bbox, projection=projection)
        fname = "interpolation_utm.tif" if projection == "utm" else "interpolation.tif"
        return Response(
            content=tif_bytes,
            media_type="image/tiff",
            headers={"Content-Disposition": f"attachment; filename={fname}"},
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=_safe_error(e, "geotiff"))

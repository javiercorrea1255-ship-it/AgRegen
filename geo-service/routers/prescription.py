"""
AgRegen – Prescription Router (Fase 3)

Endpoints:
  POST /prescription              → compute zone doses (F3-02)
  POST /prescription-export-shp  → ZIP Shapefile or GeoJSON download (F3-05)
  GET  /prescription/catalog      → available crops and products

All endpoints are also registered under /api/geo/* prefix via main.py.
"""
from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from services.ndvi_nitrogen import ndvi_nitrogen_rule

from services.prescription import (
    compute_prescription,
    export_prescription_shp_zip,
    export_prescription_geojson,
    CROP_NUTRIENT_DEMAND,
    CROP_LABELS,
    PRODUCTS,
    PRODUCT_LABELS,
    NUTRIENT_LABELS,
    DEFAULT_EFFICIENCY,
)

router = APIRouter()


# ─── Request / Response models ─────────────────────────────────────────────────

class PrescriptionRequest(BaseModel):
    zones: List[Dict[str, Any]] = Field(
        ...,
        description="List of zone objects from /zonify — each must have value_mean (or valueMean) and area_ha.",
    )
    target_nutrient: str = Field(..., description='"N", "P2O5" or "K2O"')
    crop_code: str = Field(..., description="Crop identifier: maize, wheat, soybean, …")
    yield_target_t_ha: float = Field(..., gt=0, le=100, description="Target yield [t/ha]")
    product_code: str = Field(..., description="Commercial product: urea, dap, map, kcl, …")
    soil_depth_cm: float = Field(default=30.0, ge=5.0, le=100.0)
    bulk_density: float = Field(default=1.3, ge=0.8, le=2.0, description="Soil bulk density [g/cm³]")
    efficiency: Optional[float] = Field(default=None, ge=0.05, le=1.0,
                                        description="Nutrient use efficiency (None → agr. default)")
    min_dose_kg_ha: float = Field(default=0.0, ge=0.0)
    max_dose_kg_ha: float = Field(default=500.0, le=2000.0)
    budget_limit_mxn: Optional[float] = Field(default=None, ge=0.0,
                                              description="Budget cap in MXN; None → unconstrained")


class PrescriptionExportRequest(PrescriptionRequest):
    projection: str = Field(default="wgs84", description='"wgs84" | "utm"')
    format: str = Field(default="shapefile", description='"shapefile" | "geojson"')


# ─── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/prescription/ndvi-nitrogen")
def handle_ndvi_nitrogen(mean: float = Query(..., ge=-1, le=1)):
    """Return the fixed nitrogen dose for a zone's mean NDVI."""
    return ndvi_nitrogen_rule(mean)


@router.get("/prescription/catalog")
def handle_catalog():
    """Return available crops, products, and nutrients with human-readable labels."""
    crops = [
        {
            "code": code,
            "label": CROP_LABELS.get(code, code),
            "nutrients": {k: v for k, v in data.items() if k in ("N", "P2O5", "K2O")},
            "source": data.get("source", ""),
        }
        for code, data in CROP_NUTRIENT_DEMAND.items()
    ]
    products = [
        {
            "code": code,
            "label": PRODUCT_LABELS.get(code, code),
            "N_pct": round(data.get("N_pct", 0.0), 3),
            "P2O5_pct": round(data.get("P2O5_pct", 0.0), 3),
            "K2O_pct": round(data.get("K2O_pct", 0.0), 3),
            "price_mxn_t": data.get("price_mxn_t", 0),
        }
        for code, data in PRODUCTS.items()
    ]
    nutrients = [
        {"code": code, "label": label, "default_efficiency": DEFAULT_EFFICIENCY.get(code)}
        for code, label in NUTRIENT_LABELS.items()
    ]
    return {"crops": crops, "products": products, "nutrients": nutrients}


@router.post("/prescription")
def handle_prescription(req: PrescriptionRequest):
    """Compute VRA fertilizer doses for each management zone.

    Input: zones from /zonify + agronomic parameters.
    Output: zone doses, totals, cost, and constraints applied.
    """
    if not req.zones:
        raise HTTPException(status_code=400, detail="Se requiere al menos una zona.")

    try:
        result = compute_prescription(
            zones=req.zones,
            target_nutrient=req.target_nutrient,
            crop_code=req.crop_code,
            yield_target_t_ha=req.yield_target_t_ha,
            product_code=req.product_code,
            soil_depth_cm=req.soil_depth_cm,
            bulk_density=req.bulk_density,
            efficiency=req.efficiency,
            min_dose_kg_ha=req.min_dose_kg_ha,
            max_dose_kg_ha=req.max_dose_kg_ha,
            budget_limit_mxn=req.budget_limit_mxn,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error en prescripción: {type(e).__name__}: {e}")

    return result


@router.post("/prescription-export-shp")
def handle_export_shp(req: PrescriptionExportRequest):
    """Compute prescription and export as Shapefile ZIP (or GeoJSON fallback).

    Returns a downloadable file:
    - Content-Type: application/zip (Shapefile)
    - Content-Disposition: attachment; filename="prescription_vra.zip"
    """
    if not req.zones:
        raise HTTPException(status_code=400, detail="Se requiere al menos una zona.")

    try:
        result = compute_prescription(
            zones=req.zones,
            target_nutrient=req.target_nutrient,
            crop_code=req.crop_code,
            yield_target_t_ha=req.yield_target_t_ha,
            product_code=req.product_code,
            soil_depth_cm=req.soil_depth_cm,
            bulk_density=req.bulk_density,
            efficiency=req.efficiency,
            min_dose_kg_ha=req.min_dose_kg_ha,
            max_dose_kg_ha=req.max_dose_kg_ha,
            budget_limit_mxn=req.budget_limit_mxn,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    zones_with_doses = result["zones_with_doses"]
    params = result["params_used"]

    want_geojson = (req.format or "shapefile").lower() == "geojson"

    if want_geojson:
        content = export_prescription_geojson(zones_with_doses, params)
        return Response(
            content=content,
            media_type="application/geo+json",
            headers={"Content-Disposition": 'attachment; filename="prescription_vra.geojson"'},
        )

    # Shapefile ZIP (with GeoJSON fallback if fiona is missing)
    zip_bytes, warnings = export_prescription_shp_zip(zones_with_doses, params)

    if warnings:
        # fiona missing — return GeoJSON inside a ZIP for transparency
        return Response(
            content=zip_bytes,
            media_type="application/geo+json",
            headers={
                "Content-Disposition": 'attachment; filename="prescription_vra.geojson"',
                "X-Export-Warning": warnings[0],
            },
        )

    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="prescription_vra.zip"'},
    )

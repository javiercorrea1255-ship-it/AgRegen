"""
AgRegen – Prescription Service v4.0.0 (Task #99 — Fase 3)

Implements the VRA (Variable Rate Application) prescription engine:
  F3-01: Crop and commercial-product data tables
  F3-02: calculate_zone_dose() — agronomic balance formula per zone
  F3-03: rebalance_doses_under_budget() — greedy proportional rebalancing
  F3-04: feather_doses() — continuous doses via fuzzy membership matrix
  F3-05: export_prescription_shp() — ESRI Shapefile ZIP export (requires fiona)
           export_prescription_geojson() — GeoJSON fallback (no extra deps)

References:
  INIFAP FertiRed (nutrient demand tables)
  CIMMYT BT3 (wheat demand)
  Hengl 2007 (geostatistical framework context)
"""
import io
import os
import json
import zipfile
import tempfile
from typing import Dict, List, Optional, Any, Tuple

import numpy as np


# ─── F3-01: Crop & product data tables ────────────────────────────────────────

CROP_NUTRIENT_DEMAND: Dict[str, Dict[str, Any]] = {
    "maize":   {"N": 24.0, "P2O5": 10.0, "K2O": 22.0, "source": "INIFAP FertiRed"},
    "wheat":   {"N": 30.0, "P2O5": 12.0, "K2O": 20.0, "source": "CIMMYT BT3"},
    "bean":    {"N": 50.0, "P2O5": 10.0, "K2O": 40.0, "source": "INIFAP (descontar 30 kg N/ha por fijación)"},
    "sorghum": {"N": 22.0, "P2O5":  9.0, "K2O": 25.0, "source": "IMTA / FIRA"},
    "tomato":  {"N":  3.5, "P2O5":  1.2, "K2O":  5.5, "unit": "kg/t_fruto", "source": "Steiner modif."},
    "chile":   {"N":  3.0, "P2O5":  1.0, "K2O":  5.0, "unit": "kg/t_fruto", "source": "CICTAMEX"},
    "onion":   {"N":  3.5, "P2O5":  1.5, "K2O":  4.0, "unit": "kg/t_bulbo", "source": "INIFAP V.Altos"},
    "avocado": {"N": 0.125, "P2O5": 0.065, "K2O": 0.175, "unit": "kg/arbol_ano", "source": "Fdción. Salvador Sánchez Colín"},
    "soybean": {"N": 60.0, "P2O5": 15.0, "K2O": 40.0, "source": "INIFAP / CIMMYT"},
    "sugarcane": {"N": 1.5, "P2O5": 0.5, "K2O": 2.0, "unit": "kg/t_caña", "source": "INIFAP Veracruz"},
    "sunflower": {"N": 40.0, "P2O5": 15.0, "K2O": 35.0, "source": "INIFAP Norte"},
}

DEFAULT_EFFICIENCY: Dict[str, float] = {
    "N":    0.65,   # Nitrogen use efficiency (NUE)
    "P2O5": 0.35,   # P: low efficiency due to soil fixation
    "K2O":  0.70,
}

PRODUCTS: Dict[str, Dict[str, Any]] = {
    "urea":       {"N_pct": 0.46, "P2O5_pct": 0.00, "K2O_pct": 0.00, "price_mxn_t": 12000},
    "dap":        {"N_pct": 0.18, "P2O5_pct": 0.46, "K2O_pct": 0.00, "price_mxn_t": 16500},
    "map":        {"N_pct": 0.11, "P2O5_pct": 0.52, "K2O_pct": 0.00, "price_mxn_t": 17000},
    "kcl":        {"N_pct": 0.00, "P2O5_pct": 0.00, "K2O_pct": 0.60, "price_mxn_t": 13500},
    "sulpomag":   {"N_pct": 0.00, "P2O5_pct": 0.00, "K2O_pct": 0.22, "price_mxn_t": 14000},
    "nitrato_ca": {"N_pct": 0.155,"P2O5_pct": 0.00, "K2O_pct": 0.00, "price_mxn_t": 11000},
    "superfosfato_simple": {"N_pct": 0.00, "P2O5_pct": 0.20, "K2O_pct": 0.00, "price_mxn_t": 8000},
    "superfosfato_triple": {"N_pct": 0.00, "P2O5_pct": 0.46, "K2O_pct": 0.00, "price_mxn_t": 14000},
    "sulfato_amonio":      {"N_pct": 0.21, "P2O5_pct": 0.00, "K2O_pct": 0.00, "price_mxn_t": 10000},
    "nitrato_amonio":      {"N_pct": 0.34, "P2O5_pct": 0.00, "K2O_pct": 0.00, "price_mxn_t": 13500},
}

# Human-readable labels
CROP_LABELS: Dict[str, str] = {
    "maize": "Maíz", "wheat": "Trigo", "bean": "Frijol", "sorghum": "Sorgo",
    "tomato": "Tomate", "chile": "Chile", "onion": "Cebolla", "avocado": "Aguacate",
    "soybean": "Soya", "sugarcane": "Caña de azúcar", "sunflower": "Girasol",
}
PRODUCT_LABELS: Dict[str, str] = {
    "urea": "Urea (46-0-0)", "dap": "DAP (18-46-0)", "map": "MAP (11-52-0)",
    "kcl": "KCl (0-0-60)", "sulpomag": "Sulpomag (0-0-22+Mg+S)",
    "nitrato_ca": "Nitrato de calcio (15.5-0-0)",
    "superfosfato_simple": "Superfosfato simple (0-20-0)",
    "superfosfato_triple": "Superfosfato triple (0-46-0)",
    "sulfato_amonio": "Sulfato de amonio (21-0-0)",
    "nitrato_amonio": "Nitrato de amonio (34-0-0)",
}
NUTRIENT_LABELS: Dict[str, str] = {"N": "Nitrógeno", "P2O5": "Fósforo (P₂O₅)", "K2O": "Potasio (K₂O)"}


# ─── F3-02: Per-zone dose calculation ─────────────────────────────────────────

def calculate_zone_dose(
    zone_value_ppm: float,
    crop_code: str,
    yield_target_t_ha: float,
    target_nutrient: str,
    product_code: str,
    soil_depth_cm: float = 30.0,
    bulk_density: float = 1.3,
    efficiency: Optional[float] = None,
    min_dose: float = 0.0,
    max_dose: float = 500.0,
) -> Dict[str, Any]:
    """Compute fertilizer dose for a single zone using agronomic balance.

    Formula (INIFAP / FAO notation):
      nutrient_available  = ppm × bulk_density × depth_cm × 0.1   [kg/ha]
      nutrient_demand     = yield_target × k_crop                  [kg/ha]
      nutrient_required   = max(0, (demand − available) / efficiency)
      dose_product        = nutrient_required / nutrient_pct_in_product

    Parameters
    ----------
    zone_value_ppm : float
        Mean nutrient concentration in the zone [ppm].
    crop_code : str
        Crop identifier (key in CROP_NUTRIENT_DEMAND).
    yield_target_t_ha : float
        Target yield [t/ha].
    target_nutrient : str
        Nutrient code: "N", "P2O5", or "K2O".
    product_code : str
        Commercial product identifier (key in PRODUCTS).
    soil_depth_cm : float
        Sampling depth [cm], default 30.
    bulk_density : float
        Soil bulk density [g/cm³], default 1.3.
    efficiency : float or None
        Nutrient use efficiency (0–1). None → DEFAULT_EFFICIENCY.
    min_dose, max_dose : float
        Dose bounds [kg/ha product].
    """
    if crop_code not in CROP_NUTRIENT_DEMAND:
        raise ValueError(f"Cultivo desconocido: '{crop_code}'. Opciones: {list(CROP_NUTRIENT_DEMAND)}")
    if target_nutrient not in DEFAULT_EFFICIENCY:
        raise ValueError(f"Nutriente no soportado: '{target_nutrient}'. Use N, P2O5 o K2O.")
    if product_code not in PRODUCTS:
        raise ValueError(f"Producto desconocido: '{product_code}'. Opciones: {list(PRODUCTS)}")

    demand_per_t = CROP_NUTRIENT_DEMAND[crop_code].get(target_nutrient, 0.0)
    nutrient_demand = float(yield_target_t_ha) * float(demand_per_t)

    nutrient_available = float(zone_value_ppm) * float(bulk_density) * float(soil_depth_cm) * 0.1

    eff = float(efficiency) if efficiency is not None else DEFAULT_EFFICIENCY[target_nutrient]
    nutrient_required = max(0.0, (nutrient_demand - nutrient_available) / eff)

    pct_key = f"{target_nutrient}_pct"
    pct = float(PRODUCTS[product_code].get(pct_key, 0.0))
    if pct < 1e-6:
        raise ValueError(
            f"Producto '{product_code}' no contiene {target_nutrient} "
            f"({pct_key}=0). Elige un producto que aporte {NUTRIENT_LABELS.get(target_nutrient, target_nutrient)}."
        )

    dose_kg_ha = nutrient_required / pct

    constraints: List[str] = []
    if dose_kg_ha < min_dose:
        dose_kg_ha = min_dose
        constraints.append("clamped_to_min")
    if dose_kg_ha > max_dose:
        dose_kg_ha = max_dose
        constraints.append("clamped_to_max")

    price_mxn_t = float(PRODUCTS[product_code].get("price_mxn_t", 0))

    return {
        "dose_kg_ha": round(dose_kg_ha, 2),
        "nutrient_demand_kg_ha": round(nutrient_demand, 2),
        "nutrient_available_kg_ha": round(nutrient_available, 2),
        "nutrient_deficit_kg_ha": round(max(0.0, nutrient_demand - nutrient_available), 2),
        "nutrient_required_kg_ha": round(nutrient_required, 2),
        "efficiency_used": round(eff, 3),
        "price_mxn_t": price_mxn_t,
        "constraints": constraints,
    }


def compute_prescription(
    zones: List[Dict[str, Any]],
    target_nutrient: str,
    crop_code: str,
    yield_target_t_ha: float,
    product_code: str,
    soil_depth_cm: float = 30.0,
    bulk_density: float = 1.3,
    efficiency: Optional[float] = None,
    min_dose_kg_ha: float = 0.0,
    max_dose_kg_ha: float = 500.0,
    budget_limit_mxn: Optional[float] = None,
) -> Dict[str, Any]:
    """Full prescription pipeline for a set of zones.

    Returns aggregated PrescriptionResponse-compatible dict.
    """
    zones_with_doses: List[Dict[str, Any]] = []
    constraints_global: List[str] = []

    for z in zones:
        mean_val = float(z.get("value_mean") or z.get("valueMean") or z.get("mean", 0.0))
        area_ha = float(z.get("area_ha") or z.get("areaHa") or 0.0)

        dose_info = calculate_zone_dose(
            zone_value_ppm=mean_val,
            crop_code=crop_code,
            yield_target_t_ha=yield_target_t_ha,
            target_nutrient=target_nutrient,
            product_code=product_code,
            soil_depth_cm=soil_depth_cm,
            bulk_density=bulk_density,
            efficiency=efficiency,
            min_dose=min_dose_kg_ha,
            max_dose=max_dose_kg_ha,
        )

        price_mxn_t = dose_info["price_mxn_t"]
        total_kg = round(dose_info["dose_kg_ha"] * area_ha, 2) if area_ha > 0 else 0.0
        cost_mxn = round(total_kg * price_mxn_t / 1000.0, 2)

        entry = {
            **z,
            **dose_info,
            "area_ha": area_ha,
            "total_kg_product": total_kg,
            "cost_mxn": cost_mxn,
            "crop_code": crop_code,
            "product_code": product_code,
            "target_nutrient": target_nutrient,
        }
        zones_with_doses.append(entry)
        constraints_global.extend(dose_info["constraints"])

    # F3-03: Budget rebalancing
    if budget_limit_mxn is not None:
        price_mxn_t = float(PRODUCTS[product_code].get("price_mxn_t", 0))
        zones_with_doses = rebalance_doses_under_budget(
            zones_with_doses, budget_limit_mxn, price_mxn_t,
        )
        if any(z.get("budget_rebalanced") for z in zones_with_doses):
            constraints_global.append("budget_rebalanced")

    # Aggregates
    total_kg = sum(z.get("total_kg_product", 0.0) for z in zones_with_doses)
    total_cost = sum(z.get("cost_mxn", 0.0) for z in zones_with_doses)
    total_area = sum(z.get("area_ha", 0.0) for z in zones_with_doses)
    avg_dose = (
        sum(z.get("dose_kg_ha", 0.0) * z.get("area_ha", 0.0) for z in zones_with_doses) / total_area
        if total_area > 0 else 0.0
    )

    return {
        "zones_with_doses": zones_with_doses,
        "total_kg_product": round(total_kg, 2),
        "total_cost_mxn": round(total_cost, 2),
        "avg_dose_kg_ha": round(avg_dose, 2),
        "total_area_ha": round(total_area, 4),
        "constraints_applied": list(set(constraints_global)),
        "params_used": {
            "crop_code": crop_code,
            "crop_label": CROP_LABELS.get(crop_code, crop_code),
            "product_code": product_code,
            "product_label": PRODUCT_LABELS.get(product_code, product_code),
            "target_nutrient": target_nutrient,
            "nutrient_label": NUTRIENT_LABELS.get(target_nutrient, target_nutrient),
            "yield_target_t_ha": yield_target_t_ha,
            "soil_depth_cm": soil_depth_cm,
            "bulk_density": bulk_density,
            "efficiency": efficiency if efficiency is not None else DEFAULT_EFFICIENCY.get(target_nutrient),
            "min_dose_kg_ha": min_dose_kg_ha,
            "max_dose_kg_ha": max_dose_kg_ha,
            "budget_limit_mxn": budget_limit_mxn,
        },
    }


# ─── F3-03: Budget rebalancing (greedy proportional) ──────────────────────────

def rebalance_doses_under_budget(
    zones: List[Dict[str, Any]],
    budget_mxn: float,
    product_price_mxn_t: float,
) -> List[Dict[str, Any]]:
    """Proportionally rescale doses so total cost fits within budget.

    Zones are sorted by nutrient_deficit descending (prioritise highest response)
    before computing the scale factor.

    Returns the (sorted) zones list with adjusted dose_kg_ha and cost_mxn.
    """
    sorted_z = sorted(
        zones,
        key=lambda z: float(z.get("nutrient_deficit_kg_ha", 0.0)),
        reverse=True,
    )

    total_cost = sum(
        float(z.get("dose_kg_ha", 0.0)) * float(z.get("area_ha", 0.0)) * product_price_mxn_t / 1000.0
        for z in sorted_z
    )

    if total_cost <= budget_mxn:
        return sorted_z

    scale = budget_mxn / total_cost
    for z in sorted_z:
        z["dose_kg_ha"] = round(float(z.get("dose_kg_ha", 0.0)) * scale, 2)
        z["total_kg_product"] = round(z["dose_kg_ha"] * float(z.get("area_ha", 0.0)), 2)
        z["cost_mxn"] = round(z["total_kg_product"] * product_price_mxn_t / 1000.0, 2)
        z["budget_rebalanced"] = True

    return sorted_z


# ─── F3-04: Feathering — continuous doses via fuzzy membership ────────────────

def feather_doses(
    membership_U: np.ndarray,
    zone_doses: Dict[int, float],
) -> np.ndarray:
    """Compute per-pixel continuous dose using fuzzy membership weights.

    Formula: dose(x_i) = Σ_k U_ki × dose_k

    Parameters
    ----------
    membership_U : np.ndarray, shape (n_zones, n_valid_cells)
        Fuzzy membership matrix from fuzzy_cmeans(); rows = zones, cols = pixels.
    zone_doses : dict {zone_index: dose_kg_ha}
        Dose per zone.

    Returns
    -------
    np.ndarray of shape (n_valid_cells,) — continuous dose field.
    """
    n_zones, n_cells = membership_U.shape
    doses_field = np.zeros(n_cells, dtype=float)
    for k in range(n_zones):
        doses_field += membership_U[k] * float(zone_doses.get(k, 0.0))
    return doses_field


# ─── F3-05: Export — GeoJSON (no-dependency fallback) ─────────────────────────

def export_prescription_geojson(
    zones_with_doses: List[Dict[str, Any]],
    params: Dict[str, Any],
) -> bytes:
    """Serialize prescription result as GeoJSON FeatureCollection.

    Each zone becomes a Feature with geometry from zone['polygon_geojson']
    (or 'polygonGeojson'). Properties include dose_kg_ha and metadata.
    Returns UTF-8 encoded bytes.
    """
    features = []
    for z in zones_with_doses:
        geom = z.get("polygon_geojson") or z.get("polygonGeojson")
        if geom is None:
            continue
        if isinstance(geom, str):
            geom = json.loads(geom)

        props = {
            "zone_id":             int(z.get("zone_index", z.get("zoneIndex", 0))),
            "zone_label":          str(z.get("zone_label", z.get("zoneLabel", ""))),
            "dose_kg_ha":          float(z.get("dose_kg_ha", 0.0)),
            "area_ha":             float(z.get("area_ha", z.get("areaHa", 0.0))),
            "product":             str(z.get("product_code", "")),
            "crop":                str(z.get("crop_code", "")),
            "total_kg":            float(z.get("total_kg_product", 0.0)),
            "cost_mxn":            float(z.get("cost_mxn", 0.0)),
            "nutrient_deficit":    float(z.get("nutrient_deficit_kg_ha", 0.0)),
            "nutrient_available":  float(z.get("nutrient_available_kg_ha", 0.0)),
            "nutrient_demand":     float(z.get("nutrient_demand_kg_ha", 0.0)),
            "target_nutrient":     str(z.get("target_nutrient", "")),
            "budget_rebalanced":   bool(z.get("budget_rebalanced", False)),
        }
        features.append({"type": "Feature", "geometry": geom, "properties": props})

    fc = {
        "type": "FeatureCollection",
        "name": "VRA_Prescription",
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
        "prescription_params": params,
        "features": features,
    }
    return json.dumps(fc, ensure_ascii=False, indent=2).encode("utf-8")


# ─── F3-05: Export — ESRI Shapefile ZIP ───────────────────────────────────────

def export_prescription_shp_zip(
    zones_with_doses: List[Dict[str, Any]],
    params: Dict[str, Any],
    crs_epsg: int = 4326,
) -> Tuple[bytes, List[str]]:
    """Export prescription as an ESRI Shapefile packaged in a ZIP.

    Returns (zip_bytes, warnings_list).
    zip_bytes contains the 4 required files: .shp, .shx, .dbf, .prj.

    If fiona is unavailable, returns GeoJSON bytes with a warning instead
    so the endpoint always delivers *something* usable.
    """
    warnings: List[str] = []
    try:
        import fiona
        from fiona.crs import from_epsg as fiona_from_epsg
        return _shp_via_fiona(zones_with_doses, params, crs_epsg), warnings
    except ImportError:
        warnings.append("fiona no disponible — exportando como GeoJSON (abrir con QGIS o importar a SHP con ogr2ogr)")
        return export_prescription_geojson(zones_with_doses, params), warnings


def _shp_via_fiona(
    zones_with_doses: List[Dict[str, Any]],
    params: Dict[str, Any],
    crs_epsg: int = 4326,
) -> bytes:
    """Build a 4-file Shapefile ZIP using fiona."""
    import fiona
    from fiona.crs import from_epsg as fiona_from_epsg

    schema = {
        "geometry": "Polygon",
        "properties": {
            "zone_id":    "int",
            "zone_label": "str:80",
            "dose_kg_ha": "float",
            "area_ha":    "float",
            "product":    "str:30",
            "crop":       "str:30",
            "total_kg":   "float",
            "cost_mxn":   "float",
            "deficit":    "float",
            "available":  "float",
            "demand":     "float",
            "nutrient":   "str:10",
            "rebalanced": "int",
        },
    }

    with tempfile.TemporaryDirectory() as tmpdir:
        shp_path = os.path.join(tmpdir, "prescription.shp")
        with fiona.open(
            shp_path,
            mode="w",
            driver="ESRI Shapefile",
            schema=schema,
            crs=fiona_from_epsg(crs_epsg),
            encoding="utf-8",
        ) as out:
            for z in zones_with_doses:
                geom = z.get("polygon_geojson") or z.get("polygonGeojson")
                if geom is None:
                    continue
                if isinstance(geom, str):
                    geom = json.loads(geom)
                # Ensure fiona-compatible geometry (must be dict, not Shapely)
                if hasattr(geom, "__geo_interface__"):
                    geom = geom.__geo_interface__

                out.write({
                    "geometry": geom,
                    "properties": {
                        "zone_id":    int(z.get("zone_index", z.get("zoneIndex", 0))),
                        "zone_label": str(z.get("zone_label", z.get("zoneLabel", "")))[:80],
                        "dose_kg_ha": round(float(z.get("dose_kg_ha", 0.0)), 4),
                        "area_ha":    round(float(z.get("area_ha", z.get("areaHa", 0.0))), 4),
                        "product":    str(z.get("product_code", ""))[:30],
                        "crop":       str(z.get("crop_code", ""))[:30],
                        "total_kg":   round(float(z.get("total_kg_product", 0.0)), 2),
                        "cost_mxn":   round(float(z.get("cost_mxn", 0.0)), 2),
                        "deficit":    round(float(z.get("nutrient_deficit_kg_ha", 0.0)), 2),
                        "available":  round(float(z.get("nutrient_available_kg_ha", 0.0)), 2),
                        "demand":     round(float(z.get("nutrient_demand_kg_ha", 0.0)), 2),
                        "nutrient":   str(z.get("target_nutrient", ""))[:10],
                        "rebalanced": int(bool(z.get("budget_rebalanced", False))),
                    },
                })

        # Pack all shapefile components into a ZIP in memory
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
            for ext in (".shp", ".shx", ".dbf", ".prj"):
                p = shp_path.replace(".shp", ext)
                if os.path.exists(p):
                    zf.write(p, arcname=f"prescription{ext}")
            # Embed params JSON as metadata
            meta_bytes = json.dumps(params, ensure_ascii=False, indent=2).encode("utf-8")
            zf.writestr("prescription_params.json", meta_bytes)
        buf.seek(0)
        return buf.read()

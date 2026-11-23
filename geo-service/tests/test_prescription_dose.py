"""
Tests for services/prescription.py (Task #99 — Fase 3)

Coverage:
  - F3-01: CROP_NUTRIENT_DEMAND / PRODUCTS / DEFAULT_EFFICIENCY data integrity
  - F3-02: calculate_zone_dose() — canonical INIFAP cases + clamp logic
  - F3-03: rebalance_doses_under_budget() — greedy rescaling
  - F3-04: feather_doses() — continuous dose via fuzzy membership
  - compute_prescription() — aggregate pipeline
  - export_prescription_geojson() — valid FeatureCollection bytes
"""
import json
import math
import numpy as np
import pytest

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.prescription import (
    calculate_zone_dose,
    compute_prescription,
    rebalance_doses_under_budget,
    feather_doses,
    export_prescription_geojson,
    CROP_NUTRIENT_DEMAND,
    PRODUCTS,
    DEFAULT_EFFICIENCY,
    NUTRIENT_LABELS,
)


# ─── F3-01: Data table integrity ──────────────────────────────────────────────

def test_crop_nutrient_demand_complete():
    """All crops must have N, P2O5, K2O keys."""
    for crop, data in CROP_NUTRIENT_DEMAND.items():
        for nutrient in ("N", "P2O5", "K2O"):
            assert nutrient in data, f"Crop '{crop}' missing nutrient '{nutrient}'"
            assert data[nutrient] > 0, f"Crop '{crop}' nutrient '{nutrient}' must be > 0"


def test_products_pct_sum_reasonable():
    """Each product's nutrient percentages should sum to ≤ 1.0 (≤ 100%)."""
    for prod, data in PRODUCTS.items():
        total = data.get("N_pct", 0) + data.get("P2O5_pct", 0) + data.get("K2O_pct", 0)
        assert total <= 1.01, f"Product '{prod}' pct sum {total:.3f} > 1.0"
        assert data.get("price_mxn_t", 0) > 0, f"Product '{prod}' must have a price"


def test_default_efficiency_values():
    for nutrient, eff in DEFAULT_EFFICIENCY.items():
        assert 0 < eff <= 1.0, f"Efficiency for {nutrient} must be (0, 1]"


# ─── F3-02: calculate_zone_dose ───────────────────────────────────────────────

def test_inifap_canonical_maize_urea():
    """Canonical INIFAP case: maize 8 t/ha, N-inorg 20 ppm, urea → ~200 kg/ha.

    Manual check:
      nutrient_demand     = 8 × 24 = 192 kg N/ha
      nutrient_available  = 20 × 1.3 × 30 × 0.1 = 78 kg N/ha
      nutrient_required   = (192 - 78) / 0.65 ≈ 175.38 kg N/ha
      dose_urea           = 175.38 / 0.46 ≈ 381.3 kg/ha urea
    """
    result = calculate_zone_dose(
        zone_value_ppm=20.0,
        crop_code="maize",
        yield_target_t_ha=8.0,
        target_nutrient="N",
        product_code="urea",
        soil_depth_cm=30.0,
        bulk_density=1.3,
    )
    # Allow ±5 % tolerance around the expected value
    expected_dose = 381.3
    assert abs(result["dose_kg_ha"] - expected_dose) / expected_dose < 0.05, (
        f"Expected ~{expected_dose} kg/ha urea, got {result['dose_kg_ha']}"
    )
    assert result["nutrient_demand_kg_ha"] == pytest.approx(192.0, rel=1e-3)
    assert result["nutrient_available_kg_ha"] == pytest.approx(78.0, rel=1e-3)
    assert len(result["constraints"]) == 0


def test_clamp_to_min():
    result = calculate_zone_dose(
        zone_value_ppm=200.0,  # very high — dose would go negative before clamp
        crop_code="maize",
        yield_target_t_ha=8.0,
        target_nutrient="N",
        product_code="urea",
        min_dose=50.0,
    )
    assert result["dose_kg_ha"] == pytest.approx(50.0), "Should be clamped to min_dose"
    assert "clamped_to_min" in result["constraints"]


def test_clamp_to_max():
    result = calculate_zone_dose(
        zone_value_ppm=0.0,  # completely deficient — dose explodes without max
        crop_code="maize",
        yield_target_t_ha=10.0,
        target_nutrient="N",
        product_code="urea",
        max_dose=200.0,
    )
    assert result["dose_kg_ha"] == pytest.approx(200.0)
    assert "clamped_to_max" in result["constraints"]


def test_zero_value_gives_positive_dose():
    result = calculate_zone_dose(
        zone_value_ppm=0.0,
        crop_code="wheat",
        yield_target_t_ha=5.0,
        target_nutrient="N",
        product_code="urea",
    )
    assert result["dose_kg_ha"] > 0


def test_high_ppm_gives_zero_dose():
    """If available nutrient >> demand, nutrient_required = 0 → dose = 0 (clamped to min=0)."""
    result = calculate_zone_dose(
        zone_value_ppm=5000.0,
        crop_code="maize",
        yield_target_t_ha=8.0,
        target_nutrient="N",
        product_code="urea",
    )
    assert result["dose_kg_ha"] == pytest.approx(0.0, abs=1.0)


def test_phosphorus_dap():
    """Verify P calculation with DAP (18-46-0)."""
    result = calculate_zone_dose(
        zone_value_ppm=5.0,
        crop_code="maize",
        yield_target_t_ha=8.0,
        target_nutrient="P2O5",
        product_code="dap",
        soil_depth_cm=30.0,
        bulk_density=1.3,
    )
    expected_demand = 8.0 * 10.0  # 80 kg P2O5/ha
    expected_available = 5.0 * 1.3 * 30.0 * 0.1  # 19.5 kg P2O5/ha
    expected_required = max(0.0, (expected_demand - expected_available) / 0.35)
    expected_dose = expected_required / 0.46
    assert result["dose_kg_ha"] == pytest.approx(expected_dose, rel=1e-3)


def test_unknown_crop_raises():
    with pytest.raises(ValueError, match="Cultivo desconocido"):
        calculate_zone_dose(
            zone_value_ppm=10.0,
            crop_code="unicorn",
            yield_target_t_ha=5.0,
            target_nutrient="N",
            product_code="urea",
        )


def test_product_not_containing_nutrient_raises():
    with pytest.raises(ValueError, match="no contiene"):
        calculate_zone_dose(
            zone_value_ppm=10.0,
            crop_code="maize",
            yield_target_t_ha=8.0,
            target_nutrient="K2O",
            product_code="urea",  # urea has 0 K2O
        )


def test_custom_efficiency():
    r_default = calculate_zone_dose(
        zone_value_ppm=10.0, crop_code="maize", yield_target_t_ha=8.0,
        target_nutrient="N", product_code="urea",
    )
    r_custom = calculate_zone_dose(
        zone_value_ppm=10.0, crop_code="maize", yield_target_t_ha=8.0,
        target_nutrient="N", product_code="urea",
        efficiency=0.90,  # higher efficiency → less fertilizer needed
    )
    assert r_custom["dose_kg_ha"] < r_default["dose_kg_ha"]


# ─── compute_prescription (aggregate) ─────────────────────────────────────────

def _make_zones(n=3, value_ppm=15.0, area_ha=10.0):
    """Helper: build a list of simple zone dicts."""
    return [
        {
            "zone_index": i,
            "zone_label": f"Zona {i+1}",
            "value_mean": value_ppm - i * 3,  # decreasing ppm per zone
            "area_ha": area_ha,
            "polygon_geojson": {
                "type": "Polygon",
                "coordinates": [[[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]]],
            },
        }
        for i in range(n)
    ]


def test_compute_prescription_returns_totals():
    zones = _make_zones(n=3, value_ppm=20.0, area_ha=10.0)
    result = compute_prescription(
        zones=zones,
        target_nutrient="N",
        crop_code="maize",
        yield_target_t_ha=8.0,
        product_code="urea",
    )
    assert len(result["zones_with_doses"]) == 3
    assert result["total_kg_product"] > 0
    assert result["avg_dose_kg_ha"] > 0
    assert result["total_area_ha"] == pytest.approx(30.0)
    assert isinstance(result["params_used"], dict)


def test_compute_prescription_no_budget():
    zones = _make_zones(n=2, value_ppm=10.0, area_ha=5.0)
    result = compute_prescription(
        zones=zones,
        target_nutrient="N",
        crop_code="maize",
        yield_target_t_ha=8.0,
        product_code="urea",
        budget_limit_mxn=None,  # unconstrained
    )
    assert "budget_rebalanced" not in result["constraints_applied"]


# ─── F3-03: rebalance_doses_under_budget ──────────────────────────────────────

def test_no_rebalance_when_under_budget():
    zones = _make_zones(n=2, value_ppm=10.0, area_ha=5.0)
    for z in zones:
        z["dose_kg_ha"] = 100.0
        z["nutrient_deficit_kg_ha"] = 50.0
    # Price = 12,000 MXN/t; dose = 100 kg/ha × 5 ha × 2 zones = 1000 kg = 1 t → 12,000 MXN
    result = rebalance_doses_under_budget(zones, budget_mxn=100_000, product_price_mxn_t=12_000)
    # Should not rebalance — budget is sufficient
    for z in result:
        assert z.get("budget_rebalanced") is None or z["dose_kg_ha"] == pytest.approx(100.0, rel=1e-6)


def test_rebalance_scales_proportionally():
    zones = _make_zones(n=2, value_ppm=10.0, area_ha=10.0)
    for z in zones:
        z["dose_kg_ha"] = 200.0
        z["nutrient_deficit_kg_ha"] = 80.0
    # Total cost = 200 × 10 × 2 zones × 12000/1000 = 48,000 MXN
    half_budget = 24_000.0  # exactly 50 %
    result = rebalance_doses_under_budget(zones, half_budget, product_price_mxn_t=12_000)
    for z in result:
        assert z["dose_kg_ha"] == pytest.approx(100.0, rel=1e-3)
        assert z.get("budget_rebalanced") is True


# ─── F3-04: feather_doses ─────────────────────────────────────────────────────

def test_feather_doses_weighted_average():
    """With U = [[1, 0], [0, 1]] (hard membership) → dose = zone dose directly."""
    U = np.array([[1.0, 0.0], [0.0, 1.0]])  # 2 zones, 2 cells; perfect separation
    zone_doses = {0: 100.0, 1: 200.0}
    result = feather_doses(U, zone_doses)
    assert result[0] == pytest.approx(100.0)
    assert result[1] == pytest.approx(200.0)


def test_feather_doses_soft_membership():
    """50/50 membership → average of zone doses."""
    U = np.array([[0.5, 0.5], [0.5, 0.5]])  # 2 zones, 2 cells
    zone_doses = {0: 100.0, 1: 200.0}
    result = feather_doses(U, zone_doses)
    assert result[0] == pytest.approx(150.0)
    assert result[1] == pytest.approx(150.0)


def test_feather_doses_shape():
    n_zones, n_cells = 4, 1000
    U = np.random.dirichlet(np.ones(n_zones), size=n_cells).T  # shape (n_zones, n_cells)
    zone_doses = {k: float(k * 50) for k in range(n_zones)}
    result = feather_doses(U, zone_doses)
    assert result.shape == (n_cells,)
    assert np.all(result >= 0)


def test_feather_doses_missing_zone_key():
    """Missing zone key → treated as dose 0."""
    U = np.array([[0.6], [0.4]])
    zone_doses = {0: 100.0}  # zone 1 missing
    result = feather_doses(U, zone_doses)
    assert result[0] == pytest.approx(60.0)  # 0.6 × 100 + 0.4 × 0


# ─── F3-05: export_prescription_geojson ───────────────────────────────────────

def test_export_geojson_valid_featurecollection():
    zones = _make_zones(n=2, value_ppm=15.0, area_ha=5.0)
    for z in zones:
        z["dose_kg_ha"] = 150.0
        z["product_code"] = "urea"
        z["crop_code"] = "maize"
        z["target_nutrient"] = "N"
        z["total_kg_product"] = 750.0
        z["cost_mxn"] = 9000.0
        z["nutrient_deficit_kg_ha"] = 60.0
        z["nutrient_available_kg_ha"] = 30.0
        z["nutrient_demand_kg_ha"] = 90.0

    params = {"crop_code": "maize", "product_code": "urea", "target_nutrient": "N"}
    geojson_bytes = export_prescription_geojson(zones, params)
    fc = json.loads(geojson_bytes.decode("utf-8"))

    assert fc["type"] == "FeatureCollection"
    assert len(fc["features"]) == 2
    for feat in fc["features"]:
        assert feat["type"] == "Feature"
        assert "geometry" in feat
        assert "dose_kg_ha" in feat["properties"]
        assert feat["properties"]["dose_kg_ha"] == pytest.approx(150.0)


def test_export_geojson_empty_zones_no_geometry():
    """Zones without polygon_geojson are silently skipped."""
    zones = [{"zone_index": 0, "dose_kg_ha": 100.0}]  # no geom
    geojson_bytes = export_prescription_geojson(zones, {})
    fc = json.loads(geojson_bytes.decode("utf-8"))
    assert len(fc["features"]) == 0


# ─── N, P, K balance integrity ────────────────────────────────────────────────

@pytest.mark.parametrize("nutrient,product", [
    ("N", "urea"),
    ("P2O5", "dap"),
    ("K2O", "kcl"),
])
def test_nutrient_balance(nutrient, product):
    """Check dose is positive and finite for all nutrient/product combos."""
    result = calculate_zone_dose(
        zone_value_ppm=5.0,
        crop_code="maize",
        yield_target_t_ha=8.0,
        target_nutrient=nutrient,
        product_code=product,
        soil_depth_cm=30.0,
        bulk_density=1.3,
    )
    assert math.isfinite(result["dose_kg_ha"])
    assert result["dose_kg_ha"] >= 0
    assert result["nutrient_demand_kg_ha"] > 0

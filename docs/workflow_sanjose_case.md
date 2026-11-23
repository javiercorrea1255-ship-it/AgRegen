# Workflow Documentation — Case 02: San José Soil IDW Interpolation

## Overview

This document describes the complete workflow for spatial interpolation of soil
pH and electrical conductivity (CE) from georeferenced field sampling data using
the AgRegen 5.0 platform. The case study uses 21 sampling points collected from
the San José field in Jalisco, México.

## Scientific Background

Spatial interpolation of soil properties enables precision agriculture
practitioners to convert discrete point measurements into continuous spatial
maps that support variable-rate application of amendments. IDW (Inverse Distance
Weighting) is the standard baseline method recommended by FAO (2006) and is
widely used when sample sizes are small (n < 30) and spatial autocorrelation
cannot be reliably modelled.

## Field Data

| Attribute | Value |
|---|---|
| Location | Jalisco, México (~20.38°N, 102.98°W) |
| Area | ~3.24 ha |
| Sampling points | 21 |
| Variable 1 | Soil pH (1:2 water suspension) |
| Variable 2 | Electrical conductivity, CE (dS/m) |
| Lab standard | NOM-021-SEMARNAT-2000 |

## IDW Algorithm

### Mathematical formulation

```
z(x) = Σᵢ [ wᵢ · zᵢ ] / Σᵢ wᵢ

where:
  wᵢ  = 1 / dᵢᵖ   (distance weight)
  dᵢ  = Euclidean distance from prediction point x to sample i
  zᵢ  = measured value at sample i
  p   = power parameter (p = 2 in this study)
```

When the prediction point coincides with a sample location (dᵢ → 0),
the algorithm returns the exact observed value.

### Parameters

| Parameter | Value | Justification |
|---|---|---|
| Power (p) | 2 | Standard Shepard (1968) exponent |
| Neighbourhood | All 21 points | Small dataset — global IDW |
| Grid resolution | 30 × 36 cells | ~30 m cell size |
| Boundary masking | Yes | Cells outside polygon set to null |
| Zone method | Quantile (3 zones) | Equal-area allocation |

### Distance computation

The demo implements geodetic distances using degree-to-metre conversion factors:
- Longitude: 1° ≈ 104,380 m at latitude 20°N (= 111,320 × cos(20°))
- Latitude:  1° ≈ 111,320 m (meridional arc)

## Results

### Observed statistics (21 points)

| Variable | Min | Max | Mean | SD |
|---|---|---|---|---|
| pH | 4.13 | 5.03 | 4.430 | 0.204 |
| CE (dS/m) | 0.11 | 0.87 | 0.193 | 0.160 |

**Key finding:** All 21 points show strongly to very strongly acidic pH
(< 5.5 per NOM-021-SEMARNAT-2000). Electrical conductivity is non-saline
throughout, with one notable outlier at point 13 (CE = 0.87 dS/m).

### IDW interpolated grid (1080 cells)

| Variable | Min | Max | Mean |
|---|---|---|---|
| pH (IDW) | 4.149 | 5.015 | 4.432 |
| CE (IDW) | 0.115 | 0.821 | 0.193 |

The IDW mean is nearly identical to the observed mean — a sign of stable
interpolation with no edge distortion.

### pH Management zones

| Zone | pH range | Area (ha) | CaCO₃ dose (t/ha) | Total CaCO₃ (t) |
|---|---|---|---|---|
| 1 — Muy ácido | < 4.30 | 1.08 | 4.5 | 4.9 |
| 2 — Ácido moderado | 4.30–4.55 | 1.08 | 3.0 | 3.2 |
| 3 — Menos ácido | > 4.55 | 1.08 | 1.5 | 1.6 |
| **Total** | | **3.24** | | **9.7 t** |

## Platform Integration

### UI Workflow

1. **Parcel registration** → enter field boundary coordinates or upload KML/SHP
2. **Sampling design** → generate optimal grid via `POST /api/geo/sampling-grid`
3. **Field data entry** → upload CSV or enter values in the mobile interface
4. **Interpolation** → select IDW/Kriging/RBF via the MVZ module
5. **Zone generation** → choose number of zones and classification method
6. **Prescription** → AI-generated variable-rate application map
7. **Export** → GeoJSON, KML, or Shapefile. ISO-XML/ISOBUS requires external conversion and verification with the application equipment.

### API Call (IDW)

```http
POST /api/geo/interpolate
Content-Type: application/json

{
  "method": "idw",
  "power": 2,
  "n_zones": 3,
  "zone_method": "quantiles",
  "variable_code": "pH",
  "resolution": 30,
  "polygon": [[-102.9806, 20.3787], ..., [-102.9806, 20.3787]],
  "points": [
    {"lon": -102.979851, "lat": 20.380928, "value": 4.42},
    ...
  ]
}
```

### Response schema

```json
{
  "grid": [{"lon": ..., "lat": ..., "value": ...}],
  "zones": [{"id": 1, "color": "#...", "range": [4.13, 4.30], "area_ha": 1.08}],
  "statistics": {"min": 4.149, "max": 5.015, "mean": 4.432}
}
```

## Reproducibility

```bash
# Self-contained demo (pure Node.js, no dependencies)
node demo/run_sanjose_workflow.js

# Automated test suite (59 assertions)
node tests/sanjose_workflow.test.js

# Live API call (requires running platform)
curl -s -X POST http://localhost:5000/api/geo/interpolate \
  -H "Content-Type: application/json" \
  -d @data/case_02_sanjose_soil/idw_config.json | jq .
```

## References

- Shepard, D. (1968). A two-dimensional interpolation function for
  irregularly-spaced data. *Proc. 23rd ACM national conference*, 517–524.
  https://doi.org/10.1145/800186.810616
- FAO (2006). *Guidelines for soil description* (4th ed.). Rome: Food and
  Agriculture Organization of the United Nations.
- NOM-021-SEMARNAT-2000. *Especificaciones de fertilidad, salinidad y
  clasificación de suelos*. Diario Oficial de la Federación.

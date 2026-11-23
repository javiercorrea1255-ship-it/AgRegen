# Case 02 — San José Soil Sampling: pH & CE IDW Interpolation

## Overview

This dataset contains 21 georeferenced soil sampling points from the San José
field (Jalisco, México). Variables measured: **soil pH** (1:2 water suspension)
and **electrical conductivity** (CE, dS/m). The dataset demonstrates the
AgRegen 5.0 workflow for spatial interpolation of soil properties using
**IDW (Inverse Distance Weighting)** and subsequent management zone generation.

## Field Summary

| Attribute | Value |
|---|---|
| Field | San José pilot field |
| Location | Jalisco, México |
| Area | ~3.24 ha (approx.) |
| Sampling points | 21 |
| Variables | pH, CE (dS/m) |
| Lab method | 1:2 soil:water suspension |
| Standard | NOM-021-SEMARNAT-2000 |

## Descriptive Statistics

| Variable | Min | Max | Mean | SD | Interpretation |
|---|---|---|---|---|---|
| pH | 4.13 | 5.03 | 4.430 | 0.204 | Strongly acidic throughout |
| CE (dS/m) | 0.11 | 0.87 | 0.193 | 0.160 | Non-saline (point 13 outlier) |

> **Agronomic note:** The entire field shows strongly acidic pH (< 5.5).
> According to NOM-021-SEMARNAT-2000, liming with agricultural CaCO₃ is
> indicated. The IDW map identifies zones of priority intervention.

## Files

| File | Description |
|---|---|
| `sampling_points.csv` | Raw 21-point data (Longitud, Latitud, pH, Method, CE_dSm) |
| `sampling_points.geojson` | Same data as GeoJSON FeatureCollection (EPSG:4326) |
| `field_boundary.geojson` | Approximate field polygon (EPSG:4326) |
| `idw_config.json` | Full API request bodies for pH and CE interpolation |
| `metadata.json` | Dataset metadata (SoftwareX format) |
| `provenance.json` | Data origin, transformations, quality notes |

## IDW Algorithm

The platform implements Shepard's (1968) method:

```
z(x) = Σ(w_i · z_i) / Σ(w_i)
where  w_i = 1 / d_i^p
```

- **p = 2** (standard power parameter)
- **Grid**: 30 × 36 cells at ~30 m spacing
- **Masking**: grid cells outside field polygon set to transparent
- **Zones**: 3 zones by quantile classification of interpolated values

## Quick Start

```bash
node demo/run_sanjose_workflow.js
```

No API access required. The demo implements IDW in pure Node.js.

## Reference

Shepard, D. (1968). A two-dimensional interpolation function for
irregularly-spaced data. *Proceedings of the 1968 23rd ACM national conference*,
517–524. https://doi.org/10.1145/800186.810616

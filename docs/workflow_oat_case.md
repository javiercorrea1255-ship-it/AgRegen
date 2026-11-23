# Workflow Documentation: Oat Field NDVI Zoning & Variable-Rate Prescription

## Case Study Description

This document describes the complete computational workflow executed by **AgRegen 5.0**
on a real 12.73 ha irrigated oat field (*Avena sativa* L.) located in
Ejido Miguel Auza, Municipio Juan Aldama, Zacatecas, México (24.123°N, 103.432°W).

The analysis was carried out on 4 May 2026 using a cloud-free Sentinel-2 image
acquired on 26 April 2026. Reapplying the versioned rules to the six original
zones yields **599.13 kg N** (estimated cost **$449.35 USD**), **41.15%** below
the uniform 80 kg N/ha baseline of 1,018.1040 kg N.

---

## Data Sources

| Source | Description | Privacy |
|---|---|---|
| Sentinel-2 SR (ESA Copernicus) | Surface reflectance image, 10 m, 2026-04-26 | Public satellite data |
| AgRegen 5.0 production DB | Historical field boundary and zone polygons | Public dataset uses a substitute parcel name |
| Google Earth Engine | Image acquisition and NDVI computation | Public API |
| `shared/ndvi-nitrogen-rules.json` | Deterministic prescription, version 1.0.0 | Versioned configuration |

> **Privacy note:** The producer name was replaced with “Parcela piloto avena,
> Miguel Auza” and the account identifier was omitted. The geometry was preserved.

---

## Pipeline Executed

### Step 1 — Satellite Image Acquisition

The geo-service (Python FastAPI, port 8000) queries Google Earth Engine:

```python
collection = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED") \
    .filterBounds(field_geometry) \
    .filterDate("2026-04-01", "2026-04-30") \
    .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 5)) \
    .sort("CLOUDY_PIXEL_PERCENTAGE")

image = collection.first()
```

Selected image: acquired **2026-04-26**, cloud cover **0.001 %** (virtually zero).

### Step 2 — NDVI Computation

```python
ndvi = image.normalizedDifference(["B8", "B4"]).rename("NDVI")
# B8 = NIR (~833 nm), B4 = Red (~665 nm)
# NDVI = (B8 - B4) / (B8 + B4)
```

Result: 2,352 valid pixels covering 12.73 ha at 10 m resolution.
Field NDVI range: **0.116 – 0.671**.

### Step 3 — Spatial K-Means Clustering (k = 6)

The NDVI raster is sampled at pixel centroids and clustered using
`scipy.cluster.vq.kmeans2` with spatial coordinates as co-features
(ensuring geographic contiguity). Zones are ordered by mean NDVI (ascending).

```python
from scipy.cluster.vq import kmeans2
features = np.column_stack([X_norm, Y_norm, ndvi_values])
centroids, labels = kmeans2(features, k=6, minit="points", seed=42)
```

### Step 4 — Zone Statistics

For each cluster, compute:

- `area_ha`: pixel count × pixel area (10 m × 10 m × 1e-4)
- `ndvi_mean`: arithmetic mean of pixel NDVI values in zone
- `ndvi_sd`: standard deviation of pixel NDVI values in zone

Results stored in `management_zones` table with
`zone_set_id = sat_1777860307998_v65y0g`, `source = satellite_index`.

### Step 5 — Deterministic Variable-Rate Prescription

Both Node and Python read `shared/ndvi-nitrogen-rules.json`. Each zone is
classified using its stored mean NDVI without rounding it again.

| Mean NDVI | Rate (kg N/ha) |
|---|---:|
| < 0.20 | 80 |
| ≥ 0.20 and < 0.40 | 50 |
| ≥ 0.40 and < 0.50 | 40 |
| ≥ 0.50 and < 0.55 | 30 |
| ≥ 0.55 | 20 |

Cost uses the case-study price of **$0.75 USD/kg N**. Rates describe a
methodological scenario, not a nitrogen diagnosis or a field-validated optimum.
`NDVI_NITROGEN_AI_EXPLANATION=true` enables optional prose in the web application;
unset it or set it to `false` for the deterministic explanation. The model
cannot set a dose. Rates in kg N/ha require conversion to the selected
commercial fertilizer before loading into application machinery.

### Step 6 — Storage

All outputs stored in PostgreSQL:

- `management_zones` — zone polygons + statistics
- `zone_prescriptions` — per-zone rates and cost

---

## Zone Results

| Zone | Area (ha) | NDVI mean | NDVI SD | N rate (kg/ha) | Total N (kg) | Cost (USD) |
|---|---|---|---|---|---|---|
| Zona 1 | 1.3775 | 0.1600 | 0.052 | 80 | 110.2000 | 82.65 |
| Zona 2 | 1.3932 | 0.1626 | 0.044 | 80 | 111.4560 | 83.59 |
| Zona 3 | 2.5285 | 0.4351 | 0.027 | 40 | 101.1400 | 75.86 |
| Zona 4 | 3.2430 | 0.4658 | 0.031 | 40 | 129.7200 | 97.29 |
| Zona 5 | 2.1091 | 0.4852 | 0.028 | 40 | 84.3640 | 63.27 |
| Zona 6 | 2.0750 | 0.5316 | 0.032 | 30 | 62.2500 | 46.69 |
| **Total** | **12.7263** | **0.407** | — | — | **599.1300** | **449.35** |

---

## Expected Outputs

Running `node demo/run_oat_workflow.js` produces:

```
outputs/sample_pilot_oat/run_report.json
```

Containing:

```json
{
  "dataset_id": "sample_pilot_oat_20260504",
  "ndvi": {
    "ndvi_mean_weighted": 0.4074,
    "n_zones": 6
  },
  "prescription": {
    "total_fertilizer_kg": 599.13,
    "total_cost_usd": 449.35
  },
  "validation": {
    "all_passed": true,
    "n_checks": 6
  }
}
```

---

## Reproducibility and Data Provenance

This dataset fulfils the reproducibility requirements of SoftwareX (Elsevier):

1. **No external dependencies at runtime.** All files are static exports.
   No database connection, no API key, no internet access required.

2. **Deterministic outputs.** Given the same input files, `node demo/run_oat_workflow.js`
   and `node tests/oat_workflow.test.js` always produce identical results.

3. **Full traceability.** `provenance.json` records:
   - Original database IDs (field, zone set, per-zone, per-prescription)
   - SQL queries used for extraction
   - Satellite pipeline parameters (collection, date filter, cloud threshold)
   - The configuration and generator used to recompute doses

4. **No synthetic zoning inputs.** Zones, areas and NDVI are historical exports.
   Prescriptions are derived from those inputs; the original doses are in each
   dataset's `legacy/` directory.

5. **Validation suite.** `tests/oat_workflow.test.js` runs 10 test groups
   (69 assertions) covering zone count, area balance, NDVI statistics,
   prescription totals, inverse-rate rule, and GeoJSON validity.

---

## Commands

```bash
# Install dependencies (Node.js ≥ 18 required — no npm packages needed)
node demo/run_oat_workflow.js   # Run full demo and validation report
node tests/oat_workflow.test.js # Run automated test suite (69 assertions)
python script/regenerate-oat-ndvi.py # Recompute both public datasets
```

---

## Software and Environment

| Component | Version / Details |
|---|---|
| AgRegen 5.0 | v5.0.0 |
| Node.js | ≥ 18 (ESM modules) |
| PostgreSQL | 15, production server |
| Sentinel-2 | SR Harmonized, ESA Copernicus |
| Google Earth Engine | Python API v0.1.x |
| Zoning algorithm | spatial_kmeans (scipy 1.x) |
| Prescription rules | Configuration v1.0.0, shared by Node and Python |

#!/usr/bin/env node
/**
 * AgRegen 5.0 — Demo: Oat Field NDVI Zoning & Variable-Rate Prescription
 *
 * Loads the reproducible snapshot from data/sample_pilot_oat/ and validates
 * internal consistency, then prints a summary report.
 *
 * Usage:
 *   node demo/run_oat_workflow.js
 *   npm run demo
 *
 * No external API calls required. Fully self-contained.
 */

import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../data/sample_pilot_oat");
const OUTPUT_DIR = resolve(__dirname, "../outputs/sample_pilot_oat");

// ─── Load dataset files ───────────────────────────────────────────────────────
function load(filename) {
  const p = resolve(DATA_DIR, filename);
  const raw = readFileSync(p, "utf-8");
  if (filename.endsWith(".json") || filename.endsWith(".geojson")) {
    return JSON.parse(raw);
  }
  // CSV → array of objects
  const lines = raw.trim().split("\n");
  const headers = lines[0].split(",");
  return lines.slice(1).map(line => {
    const vals = [];
    let cur = "";
    let inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === "," && !inQ) { vals.push(cur.trim()); cur = ""; }
      else { cur += ch; }
    }
    vals.push(cur.trim());
    return Object.fromEntries(headers.map((h, i) => [h.trim(), vals[i] ?? ""]));
  });
}

console.log("\n═══════════════════════════════════════════════════════════════");
console.log("  AgRegen 5.0 — Oat Field Case Study: Reproducibility Demo");
console.log("═══════════════════════════════════════════════════════════════\n");

// ─── Load files ───────────────────────────────────────────────────────────────
const metadata      = load("metadata.json");
const provenance    = load("provenance.json");
const boundary      = load("field_boundary.geojson");
const zones         = load("zones.geojson");
const prescription  = load("prescription.geojson");
const ndviSeries    = load("ndvi_timeseries.csv");
const zoneStats     = load("zone_statistics.csv");
const rxTable       = load("prescription_table.csv");

console.log("✓ All dataset files loaded.\n");

// ─── 1. Field Summary ─────────────────────────────────────────────────────────
const fieldProps = boundary.features[0].properties;
console.log("┌─ FIELD SUMMARY ─────────────────────────────────────────────┐");
console.log(`│  Name      : ${fieldProps.name}`);
console.log(`│  Location  : ${fieldProps.location}`);
console.log(`│  Crop      : ${metadata.crop}`);
console.log(`│  Area (ha) : ${fieldProps.area_ha_computed} ha  (registered: ${fieldProps.area_ha_registered} ha)`);
console.log(`│  Soil      : ${fieldProps.soil_type}`);
console.log(`│  Irrigation: ${fieldProps.irrigation_system}`);
console.log(`│  Phenology : ${fieldProps.phenological_stage}`);
console.log(`│  Planted   : ${fieldProps.planting_date}`);
console.log("└─────────────────────────────────────────────────────────────┘\n");

// ─── 2. Satellite / NDVI ──────────────────────────────────────────────────────
console.log("┌─ SATELLITE ANALYSIS ────────────────────────────────────────┐");
console.log(`│  Satellite      : ${metadata.satellite_source}`);
console.log(`│  Image date     : ${metadata.satellite_image_date}`);
console.log(`│  Resolution     : ${metadata.spatial_resolution_m} m`);
console.log(`│  Cloud cover    : ${(metadata.cloudy_pixel_percentage * 100).toFixed(4)} %`);
console.log(`│  Valid pixels   : ${metadata.valid_pixels.toLocaleString()}`);
console.log(`│  NDVI range     : ${metadata.ndvi_field_min} – ${metadata.ndvi_field_max}`);
console.log(`│  NDVI mean (wt) : ${metadata.ndvi_mean_weighted_by_zone}`);
console.log(`│  Zoning method  : ${metadata.zoning_method}`);
console.log(`│  Zones          : ${metadata.number_of_zones}`);
console.log("└─────────────────────────────────────────────────────────────┘\n");

// ─── 3. Zone Statistics ───────────────────────────────────────────────────────
console.log("┌─ MANAGEMENT ZONES ──────────────────────────────────────────┐");
console.log("│  Zone    Area(ha)  NDVI_mean  NDVI_sd  Color");
let computedArea = 0;
let computedNdviWeighted = 0;
for (const z of zoneStats) {
  const area = parseFloat(z.area_ha);
  const ndvi = parseFloat(z.ndvi_mean);
  computedArea += area;
  computedNdviWeighted += ndvi * area;
  console.log(`│  ${z.zone_label.padEnd(8)} ${String(area.toFixed(4)).padStart(8)}  ${String(ndvi.toFixed(4)).padStart(9)}  ${String(parseFloat(z.ndvi_sd).toFixed(4)).padStart(7)}  ${z.color_hex.trim()}`);
}
const ndviMean = computedNdviWeighted / computedArea;
console.log(`│  ${"─".repeat(57)}`);
console.log(`│  ${"TOTAL".padEnd(8)} ${String(computedArea.toFixed(4)).padStart(8)}  ${String(ndviMean.toFixed(4)).padStart(9)} (weighted)`);
console.log("└─────────────────────────────────────────────────────────────┘\n");

// ─── 4. Prescription ──────────────────────────────────────────────────────────
console.log("┌─ VARIABLE-RATE PRESCRIPTION ────────────────────────────────┐");
console.log("│  Zone    Rate(kg/ha)  Total(kg)  Cost(USD)");
let totalKg = 0;
let totalCost = 0;
for (const r of rxTable) {
  const kg = parseFloat(r.total_kg);
  const cost = parseFloat(r.cost_usd);
  totalKg += kg;
  totalCost += cost;
  console.log(`│  ${r.zone_label.padEnd(8)} ${String(parseFloat(r.rate_kg_ha).toFixed(1)).padStart(10)}  ${String(kg.toFixed(2)).padStart(9)}  ${String(cost.toFixed(2)).padStart(9)}`);
}
console.log(`│  ${"─".repeat(57)}`);
console.log(`│  ${"TOTAL".padEnd(8)} ${"".padStart(10)}  ${String(totalKg.toFixed(2)).padStart(9)}  ${String(totalCost.toFixed(2)).padStart(9)}`);
console.log("└─────────────────────────────────────────────────────────────┘\n");

// ─── 5. Validation ────────────────────────────────────────────────────────────
console.log("┌─ CONSISTENCY VALIDATION ────────────────────────────────────┐");
const TOLERANCE = 0.01;

function check(label, actual, expected, tol = TOLERANCE) {
  const pass = Math.abs(actual - expected) <= tol;
  console.log(`│  [${pass ? "PASS" : "FAIL"}] ${label}`);
  console.log(`│        expected: ${expected.toFixed(4)}  got: ${actual.toFixed(4)}`);
  return pass;
}

const n_zones_zones = zones.features.length;
const n_zones_rx = prescription.features.length;
const pass1 = n_zones_zones === 6 && n_zones_rx === 6;
console.log(`│  [${pass1 ? "PASS" : "FAIL"}] zones.geojson has 6 features: ${n_zones_zones}, prescription.geojson: ${n_zones_rx}`);

const pass2 = check("Total area (ha)",    computedArea, 12.7263, 0.001);
const pass3 = check("NDVI mean (weighted)", ndviMean,   0.4074, 0.001);
const pass4 = check("Total nitrogen (kg)", totalKg, metadata.total_fertilizer_kg, 0.0001);
const pass5 = check("Total cost (USD)", totalCost, metadata.total_cost_usd, 0.0001);

const ndviObs = ndviSeries[0];
const pass6 = ndviObs?.date === "2026-04-26";
console.log(`│  [${pass6 ? "PASS" : "FAIL"}] NDVI timeseries date = ${ndviObs?.date}`);

const allPass = pass1 && pass2 && pass3 && pass4 && pass5 && pass6;
console.log(`│  ${"─".repeat(57)}`);
console.log(`│  ${allPass ? "✓ ALL CHECKS PASSED" : "✗ SOME CHECKS FAILED"}`);
console.log("└─────────────────────────────────────────────────────────────┘\n");

// ─── 6. Write outputs ─────────────────────────────────────────────────────────
mkdirSync(OUTPUT_DIR, { recursive: true });

const report = {
  run_timestamp: new Date().toISOString(),
  dataset_id: metadata.dataset_id,
  field: {
    name: fieldProps.name,
    area_ha: computedArea,
    crop: metadata.crop,
    phenological_stage: fieldProps.phenological_stage
  },
  ndvi: {
    image_date: metadata.satellite_image_date,
    satellite: metadata.satellite_source,
    spatial_resolution_m: metadata.spatial_resolution_m,
    ndvi_field_min: metadata.ndvi_field_min,
    ndvi_field_max: metadata.ndvi_field_max,
    ndvi_mean_weighted: parseFloat(ndviMean.toFixed(4)),
    n_zones: n_zones_zones
  },
  prescription: {
    amendment: metadata.amendment,
    rule_version: metadata.prescription_rule_version,
    dose_unit: metadata.dose_unit,
    total_fertilizer_kg: parseFloat(totalKg.toFixed(2)),
    total_cost_usd: parseFloat(totalCost.toFixed(2)),
    uniform_total_kg_n: metadata.uniform_total_kg_n,
    reduction_vs_uniform_pct: metadata.reduction_vs_uniform_pct,
  },
  validation: {
    all_passed: allPass,
    n_checks: 6
  }
};

writeFileSync(
  resolve(OUTPUT_DIR, "run_report.json"),
  JSON.stringify(report, null, 2)
);

console.log(`✓ Report saved → outputs/sample_pilot_oat/run_report.json`);
console.log("\nTo reproduce this case: npm run demo");
console.log("To validate:            npm run test:oat\n");

if (!allPass) process.exit(1);

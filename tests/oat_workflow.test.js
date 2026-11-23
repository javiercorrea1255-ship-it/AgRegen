#!/usr/bin/env node
/**
 * AgRegen 5.0 — Test Suite: Oat Field Reproducibility
 *
 * Validates internal consistency of the sample_pilot_oat dataset.
 * All assertions must pass for the dataset to be considered reproducible.
 *
 * Usage:
 *   node tests/oat_workflow.test.js
 *   npm run test:oat
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(__dirname, "../data/sample_pilot_oat");

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.log(`  ✗  ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

function assertApprox(label, actual, expected, tol = 0.01) {
  const ok = Math.abs(actual - expected) <= tol;
  assert(label, ok, `expected ${expected}, got ${actual}`);
}

function loadJSON(f, root = DATA) { return JSON.parse(readFileSync(resolve(root, f), "utf-8")); }
function loadCSV(f, root = DATA) {
  const lines = readFileSync(resolve(root, f), "utf-8").trim().split("\n");
  const headers = lines[0].split(",").map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = []; let cur = ""; let inQ = false;
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (ch === "," && !inQ) { vals.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    vals.push(cur.trim());
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""]));
  });
}

// ─── Load ─────────────────────────────────────────────────────────────────────
const metadata   = loadJSON("metadata.json");
const provenance = loadJSON("provenance.json");
const boundary   = loadJSON("field_boundary.geojson");
const zones      = loadJSON("zones.geojson");
const rx         = loadJSON("prescription.geojson");
const zoneStats  = loadCSV("zone_statistics.csv");
const rxTable    = loadCSV("prescription_table.csv");
const ndviTs     = loadCSV("ndvi_timeseries.csv");

console.log("\n═══════════════════════════════════════════════════════════════");
console.log("  AgRegen 5.0 — Oat Workflow Test Suite");
console.log("═══════════════════════════════════════════════════════════════\n");

// ─── T01: File structure ──────────────────────────────────────────────────────
console.log("T01 — File structure");
assert("metadata.json loaded",        !!metadata.dataset_id);
assert("provenance.json loaded",      !!provenance.extraction_timestamp);
assert("field_boundary.geojson has 1 feature", boundary.features.length === 1);
assert("zones.geojson loaded",        !!zones.features);
assert("prescription.geojson loaded", !!rx.features);
assert("ndvi_timeseries.csv loaded",  ndviTs.length > 0);
assert("zone_statistics.csv loaded",  zoneStats.length > 0);
assert("prescription_table.csv loaded", rxTable.length > 0);

// ─── T02: Zone count ──────────────────────────────────────────────────────────
console.log("\nT02 — Zone count");
assert("zones.geojson: exactly 6 features", zones.features.length === 6,
  `got ${zones.features.length}`);
assert("prescription.geojson: exactly 6 features", rx.features.length === 6,
  `got ${rx.features.length}`);
assert("zone_statistics.csv: 6 rows", zoneStats.length === 6,
  `got ${zoneStats.length}`);
assert("prescription_table.csv: 6 rows", rxTable.length === 6,
  `got ${rxTable.length}`);

// ─── T03: Area consistency ────────────────────────────────────────────────────
console.log("\nT03 — Area consistency");
const totalAreaFromCSV = zoneStats.reduce((s, z) => s + parseFloat(z.area_ha), 0);
const totalAreaFromGeoJSON = zones.features.reduce((s, f) => s + parseFloat(f.properties.area_ha), 0);
assertApprox("Total area from CSV ≈ 12.7263 ha", totalAreaFromCSV, 12.7263, 0.001);
assertApprox("Total area from GeoJSON ≈ 12.7263 ha", totalAreaFromGeoJSON, 12.7263, 0.001);
assertApprox("CSV and GeoJSON areas match", totalAreaFromCSV, totalAreaFromGeoJSON, 0.001);

// ─── T04: NDVI statistics ─────────────────────────────────────────────────────
console.log("\nT04 — NDVI statistics");
const ndviMean = zoneStats.reduce((s, z) => s + parseFloat(z.ndvi_mean) * parseFloat(z.area_ha), 0) / totalAreaFromCSV;
assertApprox("NDVI weighted mean ≈ 0.4074", ndviMean, 0.4074, 0.001);
assert("NDVI field min in metadata ≤ min zone NDVI",
  metadata.ndvi_field_min <= Math.min(...zoneStats.map(z => parseFloat(z.ndvi_mean))));
assert("NDVI field max in metadata ≥ max zone NDVI",
  metadata.ndvi_field_max >= Math.max(...zoneStats.map(z => parseFloat(z.ndvi_mean))));
assert("Zones ordered by NDVI (ascending)", (() => {
  const ndvis = zoneStats.map(z => parseFloat(z.ndvi_mean));
  return ndvis.every((v, i) => i === 0 || v >= ndvis[i - 1]);
})());

// ─── T05: Prescription totals ─────────────────────────────────────────────────
console.log("\nT05 — Prescription totals");
const totalKg   = rxTable.reduce((s, r) => s + parseFloat(r.total_kg), 0);
const totalCost = rxTable.reduce((s, r) => s + parseFloat(r.cost_usd), 0);
assertApprox("Total nitrogen ≈ 599.13 kg", totalKg, 599.13, 0.0001);
assertApprox("Total cost ≈ 449.35 USD", totalCost, 449.35, 0.0001);
assertApprox("Uniform 80 kg N/ha baseline ≈ 1018.1040 kg", metadata.uniform_total_kg_n, 80 * totalAreaFromCSV, 0.0001);
assertApprox("Reduction vs. uniform ≈ 41.15%", metadata.reduction_vs_uniform_pct, (1 - totalKg / (80 * totalAreaFromCSV)) * 100, 0.005);

// Cross-check: total_kg ≈ rate_kg_ha × area_ha for each zone
for (const r of rxTable) {
  const computed = parseFloat(r.rate_kg_ha) * parseFloat(r.area_ha);
  assertApprox(
    `${r.zone_label}: total_kg = rate × area`,
    parseFloat(r.total_kg), computed, 0.00001
  );
}

// ─── T06: Prescription inverse-NDVI rule ─────────────────────────────────────
console.log("\nT06 — Prescription inverse-NDVI rule");
const rates = rxTable.map(r => parseFloat(r.rate_kg_ha));
assert("N rates are non-increasing (higher NDVI → lower dose)",
  rates.every((v, i) => i === 0 || v <= rates[i - 1]),
  JSON.stringify(rates));
const ruleTable = loadJSON("shared/ndvi-nitrogen-rules.json", resolve(__dirname, ".."));
for (const dir of ["sample_pilot_oat", "case_01_oat_satellite"]) {
  const root = resolve(__dirname, "../data", dir);
  const prescriptions = loadCSV("prescription_table.csv", root);
  const features = loadJSON("prescription.geojson", root).features;
  const historical = loadCSV("legacy/prescription_table.csv", root);
  assert(`${dir}: 6 prescriptions; legacy rates unchanged`,
    prescriptions.length === 6 && features.length === 6 &&
    historical.map(row => Number(row.rate_kg_ha)).join(",") === "80,80,50,40,30,20");
  for (const original of historical) {
    const row = prescriptions.find(p => p.zone_id === original.zone_id);
    const geo = features.find(f => String(f.properties.zone_id) === original.zone_id)?.properties;
    const band = ruleTable.bands.find(b => b.upperExclusive === null || Number(original.ndvi_mean) < b.upperExclusive);
    const expectedKg = Number(original.area_ha) * band.dose;
    assert(`${dir}: ${original.zone_label} matches its exact NDVI rule in CSV and GeoJSON`,
      row && geo && row.ndvi_mean === original.ndvi_mean && row.area_ha === original.area_ha &&
      Number(row.rate_kg_ha) === band.dose && geo.rate_kg_ha === band.dose &&
      Math.abs(Number(row.total_kg) - expectedKg) < 0.00001 && geo.total_kg === Number(row.total_kg) &&
      geo.cost_usd === Number(row.cost_usd) && Math.abs(geo.cost_usd - expectedKg * 0.75) <= 0.0050001 &&
      geo.ndvi_mean === Number(row.ndvi_mean) && geo.area_ha === Number(row.area_ha) &&
      geo.rule_version === ruleTable.version && row.rationale.startsWith("Motor determinista NDVI"));
  }
}

// ─── T07: GeoJSON validity ────────────────────────────────────────────────────
console.log("\nT07 — GeoJSON validity");
assert("field_boundary is a Polygon",
  boundary.features[0].geometry.type === "Polygon");
assert("All zone geometries present",
  zones.features.every(f => f.geometry !== null && f.geometry.type !== undefined));
assert("All prescription geometries present",
  rx.features.every(f => f.geometry !== null && f.geometry.type !== undefined));
assert("Zone and prescription zones match by zone_id",
  zones.features.every((zf, i) => zf.properties.zone_id === rx.features[i]?.properties.zone_id));

// ─── T08: NDVI timeseries ─────────────────────────────────────────────────────
console.log("\nT08 — NDVI timeseries");
assert("ndvi_timeseries.csv has at least 1 row", ndviTs.length >= 1);
assert("NDVI observation date = 2026-04-26", ndviTs[0].date === "2026-04-26");
const tsNdvi = parseFloat(ndviTs[0].ndvi_mean);
assertApprox("NDVI mean in timeseries ≈ 0.4074", tsNdvi, 0.4074, 0.01);

// ─── T09: Provenance fields ───────────────────────────────────────────────────
console.log("\nT09 — Provenance");
assert("field_id present in provenance", !!provenance.original_ids?.field_id);
assert("zone_set_id present in provenance", !!provenance.original_ids?.zone_set_id);
assert("6 zone IDs in provenance", provenance.original_ids?.zone_ids?.length === 6);
assert("6 historical prescription IDs in provenance", provenance.original_ids?.historical_prescription_ids?.length === 6);
assert("extraction_timestamp present", !!provenance.extraction_timestamp);
assert("queries_used non-empty", Array.isArray(provenance.queries_used) && provenance.queries_used.length > 0);

// ─── T10: Metadata completeness ───────────────────────────────────────────────
console.log("\nT10 — Metadata completeness");
const requiredFields = [
  "crop", "area_ha", "analysis_date", "satellite_source", "spatial_resolution_m",
  "ndvi_mean_weighted_by_zone", "zoning_method", "number_of_zones",
  "prescription_model", "software_name", "software_version", "pipeline_version"
];
for (const f of requiredFields) {
  assert(`metadata.json has '${f}'`, metadata[f] !== undefined && metadata[f] !== null);
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log("\n═══════════════════════════════════════════════════════════════");
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log("═══════════════════════════════════════════════════════════════\n");

if (failed > 0) {
  console.error(`✗ ${failed} test(s) failed.`);
  process.exit(1);
} else {
  console.log("✓ All tests passed — dataset is internally consistent and reproducible.");
}

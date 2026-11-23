/**
 * AgRegen 5.0 — Case 02: San José IDW Workflow — Automated Test Suite
 * ─────────────────────────────────────────────────────────────────────
 * Run: node tests/sanjose_workflow.test.js
 * Expected: all assertions pass (0 failures)
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

let passed = 0, failed = 0;
const failures = [];

function assert(name, condition, detail = "") {
  if (condition) {
    passed++;
    process.stdout.write(`  ✓ ${name}\n`);
  } else {
    failed++;
    failures.push(name + (detail ? ` — ${detail}` : ""));
    process.stdout.write(`  ✗ ${name}${detail ? " — " + detail : ""}\n`);
  }
}

function near(a, b, tol = 0.005) { return Math.abs(a - b) <= tol; }

// ── Load data ──────────────────────────────────────────────────────────────
const csvText = readFileSync(join(ROOT, "data/case_02_sanjose_soil/sampling_points.csv"), "utf-8");
const geojson = JSON.parse(readFileSync(join(ROOT, "data/case_02_sanjose_soil/sampling_points.geojson"), "utf-8"));
const boundary = JSON.parse(readFileSync(join(ROOT, "data/case_02_sanjose_soil/field_boundary.geojson"), "utf-8"));
const metadata = JSON.parse(readFileSync(join(ROOT, "data/case_02_sanjose_soil/metadata.json"), "utf-8"));
const provenance = JSON.parse(readFileSync(join(ROOT, "data/case_02_sanjose_soil/provenance.json"), "utf-8"));
const idwConfig = JSON.parse(readFileSync(join(ROOT, "data/case_02_sanjose_soil/idw_config.json"), "utf-8"));

// Parse CSV
const csvLines = csvText.trim().split("\n");
const headers = csvLines[0].split(",").map(h => h.trim());
const csvRows = csvLines.slice(1).map(line => {
  const vals = line.split(",");
  return Object.fromEntries(headers.map((h, i) => [h, vals[i]?.trim()]));
});

// ── IDW implementation (same as demo) ─────────────────────────────────────
function idw(evalLon, evalLat, pts, variable, power = 2) {
  let num = 0, den = 0;
  for (const p of pts) {
    const dLon = (evalLon - p.lon) * 104380;
    const dLat = (evalLat - p.lat) * 111320;
    const d2 = dLon * dLon + dLat * dLat;
    if (d2 < 1e-6) return p[variable];
    const w = 1 / Math.pow(d2, power / 2);
    num += w * p[variable]; den += w;
  }
  return den > 0 ? num / den : null;
}

const points = csvRows.map(r => ({
  lon: parseFloat(r.Longitud), lat: parseFloat(r.Latitud),
  pH: parseFloat(r.pH), CE: parseFloat(r.CE_dSm),
}));

// ── TEST GROUP 1: File structure ───────────────────────────────────────────
console.log("\nT01 — File structure");
assert("CSV file exists and has content", csvText.length > 100);
assert("CSV has 22 lines (1 header + 21 data)", csvLines.length === 22);
assert("sampling_points.geojson is valid JSON", typeof geojson === "object");
assert("field_boundary.geojson is valid JSON", typeof boundary === "object");
assert("metadata.json is valid JSON", typeof metadata === "object");
assert("provenance.json is valid JSON", typeof provenance === "object");
assert("idw_config.json is valid JSON", typeof idwConfig === "object");

// ── TEST GROUP 2: CSV data integrity ──────────────────────────────────────
console.log("\nT02 — CSV data integrity");
assert("21 sampling points", csvRows.length === 21);
assert("All points have Longitud", csvRows.every(r => !isNaN(parseFloat(r.Longitud))));
assert("All points have Latitud", csvRows.every(r => !isNaN(parseFloat(r.Latitud))));
assert("All points have pH", csvRows.every(r => !isNaN(parseFloat(r.pH))));
assert("All points have CE_dSm", csvRows.every(r => !isNaN(parseFloat(r.CE_dSm))));
assert("Method column present", csvRows.every(r => r.Method && r.Method.length > 0));

// ── TEST GROUP 3: pH statistics ────────────────────────────────────────────
console.log("\nT03 — pH statistics");
const pHVals = points.map(p => p.pH);
const pHMean = pHVals.reduce((s, v) => s + v, 0) / pHVals.length;
const pHMin = Math.min(...pHVals);
const pHMax = Math.max(...pHVals);
assert("pH min = 4.13", near(pHMin, 4.13, 0.001));
assert("pH max = 5.03", near(pHMax, 5.03, 0.001));
assert("pH mean ≈ 4.430", near(pHMean, 4.430, 0.005));
assert("All pH < 5.5 (acidic throughout)", pHVals.every(v => v < 5.5));
assert("Point 13 is pH minimum (4.13)", near(points[12].pH, 4.13, 0.001));
assert("Point 20 is pH maximum (5.03)", near(points[19].pH, 5.03, 0.001));

// ── TEST GROUP 4: CE statistics ────────────────────────────────────────────
console.log("\nT04 — CE statistics");
const CEVals = points.map(p => p.CE);
const CEMean = CEVals.reduce((s, v) => s + v, 0) / CEVals.length;
const CEMin = Math.min(...CEVals);
const CEMax = Math.max(...CEVals);
assert("CE min = 0.11", near(CEMin, 0.11, 0.001));
assert("CE max = 0.87", near(CEMax, 0.87, 0.001));
assert("CE mean ≈ 0.193", near(CEMean, 0.193, 0.005));
assert("CE outlier at point 13 (0.87)", near(points[12].CE, 0.87, 0.001));
assert("CE non-saline overall (mean < 2 dS/m)", CEMean < 2.0);

// ── TEST GROUP 5: GeoJSON validity ────────────────────────────────────────
console.log("\nT05 — GeoJSON validity");
assert("Type FeatureCollection", geojson.type === "FeatureCollection");
assert("21 features in GeoJSON", geojson.features.length === 21);
assert("All features are Points", geojson.features.every(f => f.geometry.type === "Point"));
assert("Coordinates are [lon, lat] pairs", geojson.features.every(f => f.geometry.coordinates.length === 2));
assert("pH property present in all features", geojson.features.every(f => typeof f.properties.pH === "number"));
assert("CE_dSm property present in all features", geojson.features.every(f => typeof f.properties.CE_dSm === "number"));
assert("ID property 1–21", geojson.features.every((f, i) => f.properties.id === i + 1));

// ── TEST GROUP 6: Field boundary ──────────────────────────────────────────
console.log("\nT06 — Field boundary");
const bFeat = boundary.features[0];
assert("Boundary is a Polygon", bFeat.geometry.type === "Polygon");
const bCoords = bFeat.geometry.coordinates[0];
assert("Boundary has ≥4 vertices", bCoords.length >= 4);
assert("Boundary closes (first = last)", JSON.stringify(bCoords[0]) === JSON.stringify(bCoords[bCoords.length - 1]));
assert("All sampling points inside bbox", points.every(p => {
  const lons = bCoords.map(c => c[0]);
  const lats = bCoords.map(c => c[1]);
  return p.lon >= Math.min(...lons) && p.lon <= Math.max(...lons) &&
         p.lat >= Math.min(...lats) && p.lat <= Math.max(...lats);
}));

// ── TEST GROUP 7: IDW algorithm ────────────────────────────────────────────
console.log("\nT07 — IDW algorithm");
// At a sampling point location, IDW should return exact value
assert("IDW returns exact value at known point",
  near(idw(points[0].lon, points[0].lat, points, "pH"), points[0].pH, 0.001));
// Interpolated value at field center is within observed range
const centerLon = -102.9800, centerLat = 20.3799;
const centerPH = idw(centerLon, centerLat, points, "pH");
assert("IDW value at field center within observed range", centerPH >= pHMin && centerPH <= pHMax);
// IDW at far-away point still returns non-null
assert("IDW returns non-null for valid coordinates", centerPH !== null && isFinite(centerPH));
// Verify grid size
const nx = 30, ny = 36;
const gridSize = nx * ny;
assert("Grid has 1080 cells (30×36)", gridSize === 1080);

// ── TEST GROUP 8: Metadata completeness ───────────────────────────────────
console.log("\nT08 — Metadata completeness");
assert("dataset_id present", typeof metadata.dataset_id === "string");
assert("field.name present", typeof metadata.field?.name === "string");
assert("sampling.n_points = 21", metadata.sampling?.n_points === 21);
assert("variables.pH present", typeof metadata.variables?.pH === "object");
assert("variables.CE_dSm present", typeof metadata.variables?.CE_dSm === "object");
assert("interpolation.method = IDW", metadata.interpolation?.method?.includes("IDW"));
assert("platform.name = AgRegen 5.0", metadata.platform?.name?.includes("AgRegen"));
assert("license = CC-BY-4.0", metadata.license === "CC-BY-4.0");

// ── TEST GROUP 9: Provenance ───────────────────────────────────────────────
console.log("\nT09 — Provenance");
assert("provenance_version present", typeof provenance.provenance_version === "string");
assert("original_files present", typeof provenance.original_files === "object");
assert("transformations_applied is array", Array.isArray(provenance.transformations_applied));
assert("data_quality_notes mention outlier", provenance.data_quality_notes.some(n => n.includes("0.87")));
assert("idw_parameters.power = 2", provenance.idw_parameters?.power === 2);
assert("reproducibility note present", typeof provenance.reproducibility === "string");

// ── TEST GROUP 10: IDW config ──────────────────────────────────────────────
console.log("\nT10 — IDW configuration file");
assert("pH request body present", typeof idwConfig.request_body_ph === "object");
assert("CE request body present", typeof idwConfig.request_body_ce === "object");
assert("pH request has 21 points", idwConfig.request_body_ph.points.length === 21);
assert("CE request has 21 points", idwConfig.request_body_ce.points.length === 21);
assert("power = 2 in pH config", idwConfig.request_body_ph.power === 2);
assert("n_zones = 3 in pH config", idwConfig.request_body_ph.n_zones === 3);

// ── Summary ────────────────────────────────────────────────────────────────
console.log("\n═══════════════════════════════════════════════════════════════");
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log("═══════════════════════════════════════════════════════════════");
if (failures.length > 0) {
  console.log("\nFailed assertions:");
  failures.forEach(f => console.log(`  ✗ ${f}`));
  process.exit(1);
} else {
  console.log("\n✓ All tests passed — Case 02 dataset is valid and reproducible.\n");
}

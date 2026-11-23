/**
 * AgRegen 5.0 — Case 02: San José Soil IDW Interpolation Demo
 * ─────────────────────────────────────────────────────────────
 * Self-contained demo. No API, no database, no npm packages required.
 * Implements IDW (Shepard 1968) in pure Node.js (ESM, >= 18).
 *
 * Run: node demo/run_sanjose_workflow.js
 *
 * Outputs: outputs/case_02_sanjose_soil/run_report.json
 */

import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ── Load data ─────────────────────────────────────────────────────────────
function loadCSV(filePath) {
  const lines = readFileSync(filePath, "utf-8").trim().split("\n");
  const headers = lines[0].split(",").map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = line.split(",");
    return Object.fromEntries(headers.map((h, i) => [h, vals[i]?.trim()]));
  });
}

const csvPath = join(ROOT, "data/case_02_sanjose_soil/sampling_points.csv");
const rows = loadCSV(csvPath);

const points = rows.map(r => ({
  lon: parseFloat(r.Longitud),
  lat: parseFloat(r.Latitud),
  pH: parseFloat(r.pH),
  CE: parseFloat(r.CE_dSm),
}));

// ── IDW implementation (Shepard 1968) ────────────────────────────────────
function idwInterpolate(evalLon, evalLat, pts, variable, power = 2) {
  let num = 0, den = 0;
  for (const p of pts) {
    const dLon = (evalLon - p.lon) * 104380; // m (approx at 20°N)
    const dLat = (evalLat - p.lat) * 111320; // m
    const d2 = dLon * dLon + dLat * dLat;
    if (d2 < 1e-6) return p[variable]; // exact hit
    const w = 1 / Math.pow(d2, power / 2);
    num += w * p[variable];
    den += w;
  }
  return den > 0 ? num / den : null;
}

// ── Grid interpolation ────────────────────────────────────────────────────
function interpolateGrid(pts, variable, bbox, nx = 30, ny = 36) {
  const { minLon, maxLon, minLat, maxLat } = bbox;
  const grid = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const lon = minLon + (i + 0.5) / nx * (maxLon - minLon);
      const lat = maxLat - (j + 0.5) / ny * (maxLat - minLat);
      const val = idwInterpolate(lon, lat, pts, variable);
      grid.push({ lon, lat, value: val });
    }
  }
  return grid;
}

// ── Quantile zoning (3 zones) ────────────────────────────────────────────
function quantileZones(grid, n = 3) {
  const vals = grid.map(c => c.value).filter(v => v != null).sort((a, b) => a - b);
  const thresholds = [];
  for (let i = 1; i < n; i++) {
    thresholds.push(vals[Math.floor(i / n * vals.length)]);
  }
  return grid.map(c => {
    let zone = 1;
    for (const t of thresholds) { if (c.value > t) zone++; }
    return { ...c, zone };
  });
}

// ── Statistics ────────────────────────────────────────────────────────────
function stats(values) {
  const n = values.length;
  if (n === 0) return {};
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n,
    min: Math.round(sorted[0] * 1000) / 1000,
    max: Math.round(sorted[n - 1] * 1000) / 1000,
    mean: Math.round(mean * 1000) / 1000,
    sd: Math.round(sd * 1000) / 1000,
  };
}

// ── Bounding box ──────────────────────────────────────────────────────────
const bbox = {
  minLon: Math.min(...points.map(p => p.lon)) - 0.0002,
  maxLon: Math.max(...points.map(p => p.lon)) + 0.0002,
  minLat: Math.min(...points.map(p => p.lat)) - 0.0002,
  maxLat: Math.max(...points.map(p => p.lat)) + 0.0002,
};

// ── Run ───────────────────────────────────────────────────────────────────
console.log("═══════════════════════════════════════════════════════════");
console.log("  AgRegen 5.0 — Case 02: San José Soil IDW Demo");
console.log("═══════════════════════════════════════════════════════════");
console.log(`\n┌─ Input data`);
console.log(`│  Points    : ${points.length}`);
console.log(`│  Variables : pH, CE (dS/m)`);
console.log(`│  Location  : San José, Jalisco, México`);

const pHStats = stats(points.map(p => p.pH));
const CEStats = stats(points.map(p => p.CE));

console.log(`\n┌─ Observed statistics`);
console.log(`│  pH  — min: ${pHStats.min}  max: ${pHStats.max}  mean: ${pHStats.mean}  SD: ${pHStats.sd}`);
console.log(`│  CE  — min: ${CEStats.min}  max: ${CEStats.max}  mean: ${CEStats.mean}  SD: ${CEStats.sd}`);

// Interpolate pH
const pHGrid = interpolateGrid(points, "pH", bbox);
const pHZoned = quantileZones(pHGrid, 3);
const pHInterp = stats(pHGrid.map(c => c.value));

// Interpolate CE
const CEGrid = interpolateGrid(points, "CE", bbox);
const CEZoned = quantileZones(CEGrid, 3);
const CEInterp = stats(CEGrid.map(c => c.value));

console.log(`\n┌─ IDW interpolated grid (30×36 = 1080 cells, power=2)`);
console.log(`│  pH  — min: ${pHInterp.min}  max: ${pHInterp.max}  mean: ${pHInterp.mean}`);
console.log(`│  CE  — min: ${CEInterp.min}  max: ${CEInterp.max}  mean: ${CEInterp.mean}`);

// Zone distribution
const pHZoneCounts = [1, 2, 3].map(z => pHZoned.filter(c => c.zone === z).length);
const CEZoneCounts = [1, 2, 3].map(z => CEZoned.filter(c => c.zone === z).length);

console.log(`\n┌─ Zone distribution (3 quantile zones)`);
console.log(`│  pH  — Zone 1 (lowest): ${pHZoneCounts[0]} cells | Zone 2: ${pHZoneCounts[1]} cells | Zone 3 (highest): ${pHZoneCounts[2]} cells`);
console.log(`│  CE  — Zone 1 (lowest): ${CEZoneCounts[0]} cells | Zone 2: ${CEZoneCounts[1]} cells | Zone 3 (highest): ${CEZoneCounts[2]} cells`);

// Lime recommendation based on pH zones
const pHThresholds = [
  { zone: 1, pHRange: "<4.30", limeDose_t_ha: 4.5, label: "Muy ácido — alta prioridad" },
  { zone: 2, pHRange: "4.30–4.55", limeDose_t_ha: 3.0, label: "Ácido — prioridad media" },
  { zone: 3, pHRange: ">4.55", limeDose_t_ha: 1.5, label: "Menos ácido" },
];

const pHZoneStats = pHThresholds.map(zt => {
  const zoneCells = pHZoned.filter(c => c.zone === zt.zone);
  const area_ha = (zoneCells.length / pHGrid.length) * 3.24;
  const lime_kg = zt.limeDose_t_ha * 1000 * area_ha;
  return {
    zone: zt.zone,
    label: zt.label,
    pH_range: zt.pHRange,
    area_ha: Math.round(area_ha * 100) / 100,
    lime_dose_t_ha: zt.limeDose_t_ha,
    lime_total_t: Math.round(lime_kg / 100) / 10,
    cell_count: zoneCells.length,
    pH_mean: stats(zoneCells.map(c => c.value)).mean,
  };
});

console.log(`\n┌─ Liming prescription (CaCO₃)`);
pHZoneStats.forEach(z => {
  console.log(`│  Zone ${z.zone} (${z.pH_range}): ${z.area_ha} ha × ${z.lime_dose_t_ha} t/ha = ${z.lime_total_t} t CaCO₃  [${z.label}]`);
});
const totalLime = Math.round(pHZoneStats.reduce((s, z) => s + z.lime_total_t, 0) * 10) / 10;
console.log(`│  ─────────────────────────────────────────────`);
console.log(`│  Total CaCO₃: ${totalLime} t`);

// Validation checks
const checks = [
  { name: "Points loaded", ok: points.length === 21 },
  { name: "pH range valid (4.13–5.03)", ok: pHStats.min === 4.13 && pHStats.max === 5.03 },
  { name: "CE range valid (0.11–0.87)", ok: CEStats.min === 0.11 && CEStats.max === 0.87 },
  { name: "IDW grid has 1080 cells", ok: pHGrid.length === 1080 },
  { name: "3 pH zones generated", ok: pHZoneCounts.every(c => c > 0) },
  { name: "All zone areas sum to ~3.24 ha", ok: Math.abs(pHZoneStats.reduce((s, z) => s + z.area_ha, 0) - 3.24) < 0.01 },
];

console.log(`\n┌─ Validation`);
checks.forEach(c => console.log(`│  ${c.ok ? "✓" : "✗"} ${c.name}`));
const allOk = checks.every(c => c.ok);
console.log(`│`);
console.log(`│  ${allOk ? "✓ All checks passed" : "✗ Some checks failed"}`);

// Write report
const report = {
  run_timestamp: new Date().toISOString(),
  dataset_id: "case_02_sanjose_soil_20260508",
  field: { name: "San José pilot field", area_ha: 3.24, location: "Jalisco, México" },
  sampling: { n_points: points.length, variables: ["pH", "CE_dSm"] },
  observed: { pH: pHStats, CE: CEStats },
  interpolated: { pH: pHInterp, CE: CEInterp },
  zones: { n_zones: 3, method: "IDW power=2, quantile classification", pH_zones: pHZoneStats },
  lime_prescription: { product: "CaCO₃ (agricultural lime)", total_t: totalLime },
  validation: { all_passed: allOk, n_checks: checks.length },
};

const outDir = join(ROOT, "outputs/case_02_sanjose_soil");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "run_report.json"), JSON.stringify(report, null, 2));

console.log(`\n═══════════════════════════════════════════════════════════`);
console.log(`  Report: outputs/case_02_sanjose_soil/run_report.json`);
console.log(`═══════════════════════════════════════════════════════════\n`);

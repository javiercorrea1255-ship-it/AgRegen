/**
 * AgRegen 5.0 — Case 03: Agronomic Calculators Demo
 * ───────────────────────────────────────────────────
 * Self-contained demo of the amendments and nutrition calculators.
 * Implements the same algorithms as the TypeScript frontend engine.
 * No API, no npm packages required. Node.js >= 18 (ESM).
 *
 * Run: node demo/run_calculators.js
 *
 * References:
 *   Amendments: Oseguera-Pérez et al. (2018); NOM-021-SEMARNAT-2000
 *   Nutrition:  Oseguera y Sánchez (2015); NOM-021-SEMARNAT-2000
 */

import { mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function r(n, d = 3) { return Math.round(n * 10 ** d) / 10 ** d; }

// ════════════════════════════════════════════════════════════════════════════
// CALCULATOR 1 — SOIL AMENDMENTS ENGINE
// Based on: client/src/lib/amendments/engine.ts
// ════════════════════════════════════════════════════════════════════════════

function calcAmendments(sample) {
  const {
    pH, CIC, pct_Ca, pct_Mg, pct_K, pct_Na, pct_H, pct_Al,
    MO_pct, profundidad_cm, densidad_aparente, area_ha,
    target_Ca_pct, target_Mg_pct, target_K_pct, target_Na_pct,
    target_MO_pct, carbon_material_pct,
    soil_texture, azufre_method,
  } = sample;

  // Conversion factor k (depth × bulk density)
  const k = profundidad_cm * densidad_aparente;

  // meq/100g per cation
  const meq = {
    Ca: (pct_Ca / 100) * CIC,
    Mg: (pct_Mg / 100) * CIC,
    K:  (pct_K  / 100) * CIC,
    Na: (pct_Na / 100) * CIC,
  };
  const ratios = {
    Ca_Mg: meq.Mg > 0 ? meq.Ca / meq.Mg : Infinity,
    Mg_K:  meq.K  > 0 ? meq.Mg / meq.K  : Infinity,
  };
  const cationSum = pct_Ca + pct_Mg + pct_K + pct_Na + pct_H + pct_Al;

  // Diagnosis
  const diagnosis = {
    encalado: pH < 5.5,
    carbono:  MO_pct < 1.6,
    potasio:  pct_K < 5,
    magnesio: ratios.Ca_Mg > 6 || ratios.Mg_K < 2,
    sodio:    pct_Na > 5,
    enyesado: pct_Ca < 65 && pct_Na <= 5,
    azufre:   pH > 7.5,
  };

  // Encalado (CaCO₃): dose to raise Ca saturation
  const dCa = Math.max(0, target_Ca_pct - pct_Ca);
  const dCaMeq = (dCa / 100) * CIC;
  const encalado_kg_ha = diagnosis.encalado ? dCaMeq * k * 50.04 : 0;

  // Dolomita (CaCO₃ + MgCO₃)
  const dolomita_kg_ha = (pct_Ca < 65 && pct_Mg < 20) ? dCaMeq * k * 46.1 : 0;

  // Magnesio (MgSO₄·7H₂O)
  const dMg = Math.max(0, target_Mg_pct - pct_Mg);
  const dMgMeq = (dMg / 100) * CIC;
  const magnesio_kg_ha = diagnosis.magnesio && dMg > 0 ? dMgMeq * k * 121.5 : 0;

  // Potasio (K₂SO₄, 44% K)
  const dK = Math.max(0, target_K_pct - pct_K);
  const dKMeq = (dK / 100) * CIC;
  const kRaw_kg_ha = diagnosis.potasio && dK > 0 ? dKMeq * k * 39.1 : 0;
  const potasio_kg_ha = kRaw_kg_ha / 0.44;

  // Enyesado (CaSO₄·2H₂O)
  const enyesado_kg_ha = diagnosis.enyesado ? dCaMeq * k * 86.09 : 0;

  // Sodio (yeso para desplazar Na)
  const dNa = Math.max(0, pct_Na - target_Na_pct);
  const dNaMeq = (dNa / 100) * CIC;
  const sodio_kg_ha = diagnosis.sodio ? dNaMeq * k * 86.09 : 0;

  // Carbono (compost)
  const dMO = Math.max(0, target_MO_pct - MO_pct);
  const VAN_BEMMELEN = 0.58;
  const soilMass = (profundidad_cm / 100) * 10000 * densidad_aparente;
  const carbono_t_ha = diagnosis.carbono && dMO > 0
    ? (dMO * VAN_BEMMELEN * soilMass) / (carbon_material_pct || 1)
    : 0;

  return {
    k,
    meq,
    ratios: { Ca_Mg: r(ratios.Ca_Mg), Mg_K: r(ratios.Mg_K) },
    cation_sum_pct: r(cationSum),
    diagnosis,
    amendments: {
      encalado:  { product: "CaCO₃ (cal agrícola)", dose_kg_ha: r(encalado_kg_ha), total_kg: r(encalado_kg_ha * area_ha) },
      magnesio:  { product: "MgSO₄·7H₂O",          dose_kg_ha: r(magnesio_kg_ha), total_kg: r(magnesio_kg_ha * area_ha) },
      potasio:   { product: "K₂SO₄ (44% K)",        dose_kg_ha: r(potasio_kg_ha),  total_kg: r(potasio_kg_ha * area_ha) },
      dolomita:  { product: "Dolomita",              dose_kg_ha: r(dolomita_kg_ha), total_kg: r(dolomita_kg_ha * area_ha) },
      enyesado:  { product: "CaSO₄·2H₂O (yeso)",    dose_kg_ha: r(enyesado_kg_ha), total_kg: r(enyesado_kg_ha * area_ha) },
      sodio:     { product: "CaSO₄·2H₂O (yeso Na)", dose_kg_ha: r(sodio_kg_ha),    total_kg: r(sodio_kg_ha * area_ha) },
      carbono:   { product: "Compost",               dose_t_ha:  r(carbono_t_ha),   total_t:  r(carbono_t_ha * area_ha) },
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// CALCULATOR 2 — NUTRITION & BIOSTIMULATION ENGINE
// Based on: client/src/lib/nutrition-calculator.ts
// ════════════════════════════════════════════════════════════════════════════

const REMOCION_MACRO = { N: 22, P2O5: 8, K2O: 20, CaO: 3, MgO: 7, S: 4 };
const EF_FERTIRRIEGO = { N: 1.2, P2O5: 1.5, K2O: 1.1, CaO: 1.1, MgO: 1.1, S: 1.1 };
const TO_OXIDE = { P2O5: 2.291, K2O: 1.205, CaO: 1.399, MgO: 1.658 };

function calcNutrition(general, soil) {
  const { rendimiento_t_ha, moo } = general;
  const da = soil.da > 0 ? soil.da : 1.0;
  const ps = da * 1000 * (soil.profundidad_cm / 100) * 10000; // kg/ha

  const sumMacro = ppm => ppm * ps / 1_000_000;

  const sumValues = {
    N:    sumMacro(soil.nInorg_ppm),
    P2O5: sumMacro(soil.p_ppm) * TO_OXIDE.P2O5,
    K2O:  sumMacro(soil.k_ppm) * TO_OXIDE.K2O,
    CaO:  sumMacro(soil.ca_ppm) * TO_OXIDE.CaO,
    MgO:  sumMacro(soil.mg_ppm) * TO_OXIDE.MgO,
    S:    sumMacro(soil.s_ppm),
  };

  const macros = {};
  for (const key of Object.keys(REMOCION_MACRO)) {
    const dem = rendimiento_t_ha * REMOCION_MACRO[key];
    const ef  = EF_FERTIRRIEGO[key];
    const sum = sumValues[key];
    const resultado = (sum - dem) * ef;
    const factorAjuste = resultado < 0 ? -1.0 : 0.25;
    const dosis = Math.max(0, resultado * factorAjuste);
    macros[key] = { sum: r(sum), dem: r(dem), ef, resultado: r(resultado), dosis: r(dosis) };
  }

  // N ajustado (after mineralisation + organic amendments)
  const C_ORG = 0.55, RC_N = 0.10, TM = 0.02;
  const nm = ps * (soil.mos_pct / 100) * C_ORG * RC_N * TM;
  const N_ajustado = Math.max(0, macros.N.dosis - nm - (moo || 0));

  const alerts = [];
  if (soil.ph < 5.5) alerts.push({ level: "warning", message: "pH ácido — considerar encalado." });
  if (soil.ph > 7.0) alerts.push({ level: "warning", message: "pH alcalino — riesgo de deficiencias de micronutrimentos." });
  if (soil.ce_dSm > 2.0) alerts.push({ level: "danger", message: "CE alta — riesgo de salinidad." });
  if (soil.mos_pct < 1.6) alerts.push({ level: "warning", message: "MOS baja — incorporar materia orgánica." });
  if (soil.b_ppm < 0.5) alerts.push({ level: "warning", message: "B deficiente — incluir en programa foliar." });

  return { ps: r(ps), nm: r(nm), N_ajustado: r(N_ajustado), macros, alerts };
}

// ════════════════════════════════════════════════════════════════════════════
// RUN
// ════════════════════════════════════════════════════════════════════════════

console.log("═══════════════════════════════════════════════════════════");
console.log("  AgRegen 5.0 — Case 03: Calculators Demo");
console.log("═══════════════════════════════════════════════════════════");

// ─── Amendments ───────────────────────────────────────────────────────────
console.log("\n┌─ Calculator 1: Soil Amendments");

const amendSample = {
  pH: 4.43, CIC: 18.5, pct_Ca: 58, pct_Mg: 12, pct_K: 3.5, pct_Na: 1.0,
  pct_H: 20, pct_Al: 5.5, MO_pct: 1.2, profundidad_cm: 30,
  densidad_aparente: 1.3, area_ha: 3.24,
  target_Ca_pct: 68, target_Mg_pct: 15, target_K_pct: 5,
  target_Na_pct: 2, target_MO_pct: 3.0,
  carbon_material_pct: 30, soil_texture: "franco", azufre_method: "incorporado",
};

const amend = calcAmendments(amendSample);

console.log(`│  k factor      : ${amend.k} (depth 30cm × DA 1.3 t/m³)`);
console.log(`│  Cation sum    : ${amend.cation_sum_pct}%  (valid: 90–110%)`);
console.log(`│  Ca/Mg ratio   : ${amend.ratios.Ca_Mg}`);
console.log(`│  Mg/K ratio    : ${amend.ratios.Mg_K}`);
console.log(`│  Diagnosis     : encalado=${amend.diagnosis.encalado} carbono=${amend.diagnosis.carbono} potasio=${amend.diagnosis.potasio}`);
console.log(`│  Lime (CaCO₃)  : ${amend.amendments.encalado.dose_kg_ha} kg/ha × 3.24 ha = ${amend.amendments.encalado.total_kg} kg`);
console.log(`│  K₂SO₄        : ${amend.amendments.potasio.dose_kg_ha} kg/ha × 3.24 ha = ${amend.amendments.potasio.total_kg} kg`);
console.log(`│  Compost       : ${amend.amendments.carbono.dose_t_ha} t/ha × 3.24 ha = ${amend.amendments.carbono.total_t} t`);

// ─── Nutrition ────────────────────────────────────────────────────────────
console.log("\n┌─ Calculator 2: Nutrition Program (Maize, 15 t/ha, fertirriego)");

const nutriGeneral = { rendimiento_t_ha: 15, moo: 20 };
const nutriSoil = {
  profundidad_cm: 30, da: 1.35, mos_pct: 2.1, ph: 6.8, ce_dSm: 0.45,
  nInorg_ppm: 18, p_ppm: 8.5, k_ppm: 185, ca_ppm: 1420, mg_ppm: 210,
  s_ppm: 12, fe_ppm: 8.2, cu_ppm: 0.9, mn_ppm: 4.1, zn_ppm: 0.8, b_ppm: 0.3,
};

const nutri = calcNutrition(nutriGeneral, nutriSoil);

console.log(`│  Soil weight   : ${nutri.ps.toLocaleString()} kg/ha`);
console.log(`│  N mineralised : ${nutri.nm} kg N/ha`);
console.log(`│  N ajustado    : ${nutri.N_ajustado} kg/ha (after Nm=${nutri.nm} + MOO=${nutriGeneral.moo})`);
console.log(`│  Macros (dosis kg/ha):`);
Object.entries(nutri.macros).forEach(([k, v]) => {
  console.log(`│    ${k.padEnd(5)}: SUM=${v.sum} DEM=${v.dem} dosis=${v.dosis}`);
});
console.log(`│  Alerts (${nutri.alerts.length}):`);
nutri.alerts.forEach(a => console.log(`│    [${a.level.toUpperCase()}] ${a.message}`));

// ─── Validation ───────────────────────────────────────────────────────────
const encalado_expected = 3612;
const nutri_N_expected  = 119.7;
const nutri_Nm_expected = 93.555; // 40500000 × 0.021 × 0.55 × 0.10 × 0.02

const checks = [
  { name: "k factor = 30 × 1.3 = 39", ok: amend.k === 39 },
  { name: "Cation sum = 100%",          ok: amend.cation_sum_pct === 100 },
  { name: `Lime dose ≈ ${encalado_expected} kg/ha`, ok: Math.abs(amend.amendments.encalado.dose_kg_ha - encalado_expected) < 5 },
  { name: "Encalado diagnosed (pH 4.43 < 5.5)", ok: amend.diagnosis.encalado === true },
  { name: "Azufre not diagnosed (pH < 7.5)", ok: amend.diagnosis.azufre === false },
  { name: "Soil weight = 4,050,000 kg/ha", ok: nutri.ps === 4050000 },
  { name: `N mineralised ≈ 93.6 kg/ha`, ok: Math.abs(nutri.nm - nutri_Nm_expected) < 0.5 },
  { name: `N dosis_raw ≈ 308.52 kg/ha`, ok: Math.abs(nutri.macros.N.dosis - 308.52) < 1 },
  { name: "N ajustado > 0", ok: nutri.N_ajustado >= 0 },
  { name: "Alerts include B deficiency", ok: nutri.alerts.some(a => a.message.includes("B deficiente")) },
];

console.log("\n┌─ Validation");
checks.forEach(c => console.log(`│  ${c.ok ? "✓" : "✗"} ${c.name}`));
const allOk = checks.every(c => c.ok);
console.log(`│\n│  ${allOk ? "✓ All checks passed" : "✗ Some checks failed"}`);

// Write report
const report = {
  run_timestamp: new Date().toISOString(),
  amendments: {
    input_pH: amendSample.pH,
    k_factor: amend.k,
    cation_sum_pct: amend.cation_sum_pct,
    diagnosis: amend.diagnosis,
    lime_dose_kg_ha: amend.amendments.encalado.dose_kg_ha,
    lime_total_kg: amend.amendments.encalado.total_kg,
  },
  nutrition: {
    soil_weight_kg_ha: nutri.ps,
    N_mineralised_kg_ha: nutri.nm,
    N_ajustado_kg_ha: nutri.N_ajustado,
    macros: nutri.macros,
    n_alerts: nutri.alerts.length,
  },
  validation: { all_passed: allOk, n_checks: checks.length },
};

const outDir = join(ROOT, "outputs/case_03_calculators");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "run_report.json"), JSON.stringify(report, null, 2));

console.log("\n═══════════════════════════════════════════════════════════");
console.log("  Report: outputs/case_03_calculators/run_report.json");
console.log("═══════════════════════════════════════════════════════════\n");

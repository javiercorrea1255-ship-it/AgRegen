/**
 * AgRegen 5.0 — Case 03: Calculators — Automated Test Suite
 * ───────────────────────────────────────────────────────────
 * Run: node tests/calculators.test.js
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
function near(a, b, tol = 0.5) { return Math.abs(a - b) <= tol; }

// ── Load example data ──────────────────────────────────────────────────────
const amendEx = JSON.parse(readFileSync(join(ROOT, "data/case_03_calculators/amendments_example.json"), "utf-8"));
const nutriEx = JSON.parse(readFileSync(join(ROOT, "data/case_03_calculators/nutrition_example.json"), "utf-8"));

// ── Replicate amendments engine ────────────────────────────────────────────
const sample = amendEx.input;
const k = sample.profundidad_cm * sample.densidad_aparente_t_m3;
const CIC = sample.CIC_meq_100g;
const meq_Ca = (sample.pct_Ca / 100) * CIC;
const meq_Mg = (sample.pct_Mg / 100) * CIC;
const meq_K  = (sample.pct_K  / 100) * CIC;
const ratio_Ca_Mg = meq_Ca / meq_Mg;
const ratio_Mg_K  = meq_Mg / meq_K;
const cation_sum  = sample.pct_Ca + sample.pct_Mg + sample.pct_K +
                    sample.pct_Na + (sample.targets ? 0 : 0) + 25.5; // H+Al
const dCa = Math.max(0, sample.targets.Ca_pct - sample.pct_Ca);
const dCaMeq = (dCa / 100) * CIC;
const encalado_kg_ha = dCaMeq * k * 50.04;
const dK = Math.max(0, sample.targets.K_pct - sample.pct_K);
const dKMeq = (dK / 100) * CIC;
const potasio_kg_ha = (dKMeq * k * 39.1) / 0.44;

// ── Replicate nutrition engine ─────────────────────────────────────────────
const soilN = nutriEx.input.soil;
const genN  = nutriEx.input.general;
const da_n = soilN.da_g_cm3;
const ps = da_n * 1000 * (soilN.profundidad_cm / 100) * 10000;
const TO_P2O5 = 2.291, EF_N = 1.2;
const sum_N = soilN.nInorg_ppm * ps / 1_000_000;
const dem_N = genN.rendimiento_meta_t_ha * 22;
const resultado_N = (sum_N - dem_N) * EF_N;
const factorAjuste_N = resultado_N < 0 ? -1.0 : 0.25;
const dosis_N = Math.max(0, resultado_N * factorAjuste_N);
const C_ORG = 0.55, RC_N = 0.10, TM = 0.02;
const nm = ps * (soilN.mos_pct / 100) * C_ORG * RC_N * TM;
const N_ajustado = Math.max(0, dosis_N - nm - genN.moo_kgN_ha);

// ── TEST GROUP 1: Amendments data file ────────────────────────────────────
console.log("\nT01 — Amendments example file structure");
assert("amendments_example.json valid JSON", typeof amendEx === "object");
assert("input section present", typeof amendEx.input === "object");
assert("intermediate_calculations present", typeof amendEx.intermediate_calculations === "object");
assert("diagnosis section present", typeof amendEx.diagnosis === "object");
assert("amendments section present", typeof amendEx.amendments === "object");
assert("validation section present", typeof amendEx.validation === "object");

// ── TEST GROUP 2: Amendments k factor ─────────────────────────────────────
console.log("\nT02 — k factor calculation");
assert("k = profundidad × DA = 30 × 1.3 = 39", near(k, 39, 0.001));
assert("CIC = 18.5 meq/100g", near(CIC, 18.5, 0.001));
assert("meq Ca = 10.73", near(meq_Ca, 10.73, 0.05));
assert("meq Mg = 2.22",  near(meq_Mg, 2.22, 0.05));
assert("Ca/Mg ratio ≈ 4.83", near(ratio_Ca_Mg, 4.83, 0.05));
assert("Mg/K ratio ≈ 3.43",  near(ratio_Mg_K, 3.43, 0.05));

// ── TEST GROUP 3: Amendments diagnosis ────────────────────────────────────
console.log("\nT03 — Amendments diagnosis");
assert("encalado active (pH 4.43 < 5.5)", amendEx.diagnosis.encalado.active === true);
assert("carbono active (MO 1.2% < 1.6%)", amendEx.diagnosis.carbono.active === true);
assert("potasio active (K 3.5% < 5%)",    amendEx.diagnosis.potasio.active === true);
assert("azufre NOT active (pH < 7.5)",    amendEx.diagnosis.azufre.active === false);
assert("sodio NOT active (Na 1% < 5%)",   amendEx.diagnosis.sodio.active === false);
assert("overall status = deficiente",     amendEx.diagnosis.overall_status === "deficiente");
assert("3 active modules",               amendEx.diagnosis.active_modules === 3);

// ── TEST GROUP 4: Amendments doses ────────────────────────────────────────
console.log("\nT04 — Lime dose calculation");
assert("Δ%Ca = target - actual = 68 - 58 = 10%", near(dCa, 10, 0.001));
assert("Δmeq Ca = (10/100) × 18.5 = 1.85", near(dCaMeq, 1.85, 0.01));
assert("Lime dose = 1.85 × 39 × 50.04 ≈ 3,612 kg/ha", near(encalado_kg_ha, 3612, 5));
assert("Total lime = 3,612 × 3.24 ≈ 11,703 kg", near(encalado_kg_ha * 3.24, 11703, 20));

console.log("\nT05 — K₂SO₄ dose calculation");
assert("Δ%K = 5 - 3.5 = 1.5%", near(dK, 1.5, 0.001));
assert("K₂SO₄ dose ≈ 962 kg/ha", near(potasio_kg_ha, 962, 10));
assert("Total K₂SO₄ ≈ 3,117 kg", near(potasio_kg_ha * 3.24, 3117, 40));

// ── TEST GROUP 6: Nutrition data file ────────────────────────────────────
console.log("\nT06 — Nutrition example file structure");
assert("nutrition_example.json valid JSON", typeof nutriEx === "object");
assert("input.general present", typeof nutriEx.input.general === "object");
assert("input.soil present", typeof nutriEx.input.soil === "object");
assert("input.water present", typeof nutriEx.input.water === "object");
assert("results.macros present", typeof nutriEx.results.macros === "object");
assert("results.alerts is array", Array.isArray(nutriEx.results.alerts));
assert("validation section present", typeof nutriEx.validation === "object");

// ── TEST GROUP 7: Soil weight calculation ─────────────────────────────────
console.log("\nT07 — Soil weight (PS)");
assert("PS = da × 1000 × (depth/100) × 10000 = 4,050,000 kg/ha",
  near(ps, 4_050_000, 1000));

// ── TEST GROUP 8: N nutrition calculation ─────────────────────────────────
console.log("\nT08 — Nitrogen demand and dose");
assert("dem_N = 15 t/ha × 22 kg/t = 330 kg/ha", near(dem_N, 330, 0.1));
assert("sum_N = 18 ppm × 4,050,000 / 1e6 = 72.9 kg/ha", near(sum_N, 72.9, 0.5));
assert("resultado_N = (72.9-330) × 1.2 = -308.52", near(resultado_N, -308.52, 1));
assert("dosis_N = |-308.52| × 1.0 = 308.52 kg/ha", near(dosis_N, 308.52, 0.5));
assert("N_mineralised ≈ 93.6 kg/ha", near(nm, 93.5, 1));
assert("N_ajustado = 308.52 - 93.6 - 20 = 194.96 kg/ha", near(N_ajustado, 194.96, 1));

// ── TEST GROUP 9: Water analysis ──────────────────────────────────────────
console.log("\nT09 — Water analysis derived values");
const w = nutriEx.input.water;
const sumCat = w.ca_meq + w.mg_meq + w.k_meq + w.na_meq;
const sumAni = w.no3_meq + w.so4_meq + w.hco3_meq + w.cl_meq;
const SAR_calc = w.na_meq / Math.sqrt((w.ca_meq + w.mg_meq) / 2);
const dureza = (w.ca_meq + w.mg_meq) * 5;
assert("Sum cations ≈ 4.95 meq/L", near(sumCat, 4.95, 0.05));
assert("Sum anions ≈ 5.5 meq/L",   near(sumAni, 5.50, 0.05));
assert("SAR ≈ 0.65 (non-sodic)",   near(SAR_calc, 0.65, 0.05));
assert("Hardness = 19.5 °f",       near(dureza, 19.5, 0.1));

// ── TEST GROUP 10: Agronomic alerts ───────────────────────────────────────
console.log("\nT10 — Agronomic alerts");
const alerts = nutriEx.results.alerts;
assert("At least 2 alerts generated", alerts.length >= 2);
assert("HCO3 alert present", alerts.some(a => a.message.includes("HCO₃")));
assert("B deficiency alert present", alerts.some(a => a.message.includes("B deficiente")));
assert("No dangerous saliniy alert (CE < 2)", !alerts.some(a => a.message.includes("CE alta") && a.level === "danger"));

// ── Summary ────────────────────────────────────────────────────────────────
console.log("\n═══════════════════════════════════════════════════════════════");
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log("═══════════════════════════════════════════════════════════════");
if (failures.length > 0) {
  console.log("\nFailed assertions:");
  failures.forEach(f => console.log(`  ✗ ${f}`));
  process.exit(1);
} else {
  console.log("\n✓ All tests passed — Case 03 calculators are internally consistent.\n");
}

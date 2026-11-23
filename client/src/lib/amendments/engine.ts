import {
  AZUFRE_TABLE,
  MODULE_NOTES_ES,
  MODULE_PRODUCTS_ES,
  VAN_BEMMELEN,
} from "./constants";
import type {
  AmendmentResult,
  AmendmentResults,
  AzufreAmendmentResult,
  AzufreMethod,
  CarbonAmendmentResult,
  CationBalanceCheck,
  CationRatios,
  ComputedSample,
  DiagnosisResult,
  MeqValues,
  SoilSample,
  SoilTexture,
} from "./types";

// ----- Step 1: meq / 100 g -----
export function calculateMeq(sample: SoilSample): MeqValues {
  const { CIC, pct_Ca, pct_Mg, pct_K, pct_Na, pct_H, pct_Al } = sample;
  const c = CIC || 0;
  return {
    Ca: (pct_Ca / 100) * c,
    Mg: (pct_Mg / 100) * c,
    K: (pct_K / 100) * c,
    Na: (pct_Na / 100) * c,
    H: (pct_H / 100) * c,
    Al: (pct_Al / 100) * c,
  };
}

// ----- Step 2: cation ratios -----
export function calculateRatios(meq: MeqValues): CationRatios {
  return {
    Ca_Mg: meq.Mg > 0 ? meq.Ca / meq.Mg : Infinity,
    Mg_K: meq.K > 0 ? meq.Mg / meq.K : Infinity,
    CaMg_K: meq.K > 0 ? (meq.Ca + meq.Mg) / meq.K : Infinity,
    Ca_K: meq.K > 0 ? meq.Ca / meq.K : Infinity,
  };
}

// ----- conversion factor k = depth(cm) × bulk density (t/m3) -----
export function getK(sample: SoilSample): number {
  return (sample.profundidad_cm || 0) * (sample.densidad_aparente || 0);
}

// ----- Cation balance check -----
export function checkCationBalance(sample: SoilSample): CationBalanceCheck {
  const sum =
    sample.pct_Ca + sample.pct_Mg + sample.pct_K + sample.pct_Na + sample.pct_H + sample.pct_Al;
  if (sum < 90 || sum > 110) {
    return {
      sum,
      valid: false,
      severity: "error",
      message: `La suma de cationes es ${sum.toFixed(1)} %. Debe estar entre 90 % y 110 %.`,
    };
  }
  if (sum < 95 || sum > 105) {
    return {
      sum,
      valid: true,
      severity: "warning",
      message: `Advertencia: la suma de cationes es ${sum.toFixed(1)} %. Verifique los datos del análisis.`,
    };
  }
  return { sum, valid: true, severity: "ok" };
}

// ----- Diagnosis -----
export function diagnose(sample: SoilSample): DiagnosisResult {
  const ratios = calculateRatios(calculateMeq(sample));
  const pH = sample.pH ?? 7;
  const mo = sample.MO_pct ?? 100;

  const diag: DiagnosisResult = {
    magnesio: {
      active: ratios.Ca_Mg > 6 || ratios.Mg_K < 2,
      reason: [
        ratios.Ca_Mg > 6 ? `Relación Ca/Mg = ${fmt(ratios.Ca_Mg)} (óptimo 2 – 6).` : null,
        ratios.Mg_K < 2 ? `Relación Mg/K = ${fmt(ratios.Mg_K)} (óptimo 2 – 3).` : null,
      ].filter(Boolean).join(" "),
      severity: "moderado",
    },
    sodio: {
      active: sample.pct_Na > 5,
      reason: `%Na = ${fmt(sample.pct_Na)} % supera el límite de 5 %.`,
      severity: sample.pct_Na > 10 ? "critico" : "moderado",
    },
    azufre: {
      active: pH > 7.5,
      reason: `pH = ${fmt(pH)} (alcalino, > 7.5).`,
      severity: pH > 8.5 ? "critico" : "moderado",
    },
    encalado: {
      active: pH < 5.5,
      reason: `pH = ${fmt(pH)} (muy ácido, < 5.5).`,
      severity: pH < 4.5 ? "critico" : "moderado",
    },
    dolomita: {
      active: sample.pct_Ca < 65 && sample.pct_Mg < 20,
      reason: `%Ca = ${fmt(sample.pct_Ca)} % y %Mg = ${fmt(sample.pct_Mg)} % por debajo del óptimo.`,
      severity: "moderado",
    },
    carbono: {
      active: mo < 1.6,
      reason: `%MO = ${fmt(mo)} % bajo el umbral crítico (1.6 %).`,
      severity: mo < 1 ? "critico" : "moderado",
    },
    potasio: {
      active: sample.pct_K < 5,
      reason: `%K = ${fmt(sample.pct_K)} % por debajo del óptimo (5 – 7 %).`,
      severity: sample.pct_K < 2 ? "critico" : "leve",
    },
    enyesado: {
      active: sample.pct_Ca < 65 && sample.pct_Na <= 5,
      reason: `%Ca = ${fmt(sample.pct_Ca)} % bajo, sin exceso de sodio.`,
      severity: "leve",
    },
    status: "optimo",
    activeCount: 0,
  };

  const active = (
    ["magnesio", "sodio", "azufre", "encalado", "dolomita", "carbono", "potasio", "enyesado"] as const
  ).filter((k) => diag[k].active).length;
  diag.activeCount = active;
  if (active === 0) diag.status = "optimo";
  else if (active <= 2) diag.status = "aceptable";
  else if (active <= 4) diag.status = "deficiente";
  else diag.status = "critico";

  return diag;
}

// ----- Module: Magnesio -----
function calcMagnesio(sample: SoilSample, k: number, ratios: CationRatios): AmendmentResult {
  const delta_pct = sample.target_Mg_pct - sample.pct_Mg;
  const delta_meq = (delta_pct / 100) * sample.CIC;
  // kg MgSO4·7H2O / ha = Δmeq × k × (24.3/2) / 0.10 = Δmeq × k × 121.5
  const dose_kg_ha = delta_meq > 0 ? delta_meq * k * 121.5 : 0;
  const warn = dose_kg_ha > 5000 ? "Dosis elevada. Verificar datos de CIC y %Mg." : undefined;
  // Activate only when Mg is diagnostically off-balance AND there is a positive delta.
  const triggered = ratios.Ca_Mg > 6 || ratios.Mg_K < 2;
  return {
    active: triggered && delta_pct > 0,
    product_name: MODULE_PRODUCTS_ES.magnesio,
    formula: "MgSO₄·7H₂O",
    nutrient_content_pct: 10,
    delta_pct,
    delta_meq,
    dose_kg_ha,
    dose_ton_ha: dose_kg_ha / 1000,
    total_kg: dose_kg_ha * sample.area_ha,
    total_ton: (dose_kg_ha / 1000) * sample.area_ha,
    notes: MODULE_NOTES_ES.magnesio,
    warning: warn,
  };
}

// ----- Module: Sodio (yeso para desplazar Na) -----
function calcSodio(sample: SoilSample, k: number): AmendmentResult {
  const delta_pct = sample.pct_Na - sample.target_Na_pct;
  const delta_meq = (delta_pct / 100) * sample.CIC;
  const dose_kg_ha = delta_meq > 0 ? delta_meq * k * 86.09 : 0;
  return {
    active: sample.pct_Na > 5 && delta_pct > 0,
    product_name: MODULE_PRODUCTS_ES.sodio,
    formula: "CaSO₄·2H₂O",
    nutrient_content_pct: 100,
    delta_pct,
    delta_meq,
    dose_kg_ha,
    dose_ton_ha: dose_kg_ha / 1000,
    total_kg: dose_kg_ha * sample.area_ha,
    total_ton: (dose_kg_ha / 1000) * sample.area_ha,
    notes: MODULE_NOTES_ES.sodio,
  };
}

// ----- Module: Encalado (cal agrícola) -----
function calcEncalado(sample: SoilSample, k: number): AmendmentResult {
  const delta_pct = sample.target_Ca_pct - sample.pct_Ca;
  const delta_meq = (delta_pct / 100) * sample.CIC;
  const dose_kg_ha = delta_meq > 0 ? delta_meq * k * 50.04 : 0;
  const dose_ton_ha = dose_kg_ha / 1000;
  const warn = dose_ton_ha > 10 ? "Dosis muy alta. Considerar aplicación fraccionada en 2 – 3 años." : undefined;
  const phLow = (sample.pH ?? 7) < 5.5;
  return {
    active: phLow && delta_pct > 0,
    product_name: MODULE_PRODUCTS_ES.encalado,
    formula: "CaCO₃",
    nutrient_content_pct: 100,
    delta_pct,
    delta_meq,
    dose_kg_ha,
    dose_ton_ha,
    total_kg: dose_kg_ha * sample.area_ha,
    total_ton: dose_ton_ha * sample.area_ha,
    notes: MODULE_NOTES_ES.encalado,
    warning: warn,
  };
}

// ----- Module: Dolomita -----
function calcDolomita(sample: SoilSample, k: number): AmendmentResult {
  const delta_pct = sample.target_Ca_pct - sample.pct_Ca;
  const delta_meq = (delta_pct / 100) * sample.CIC;
  const dose_kg_ha = delta_meq > 0 ? delta_meq * k * 46.1 : 0;
  const dose_ton_ha = dose_kg_ha / 1000;
  const warn = dose_ton_ha > 10 ? "Dosis muy alta. Considerar aplicación fraccionada en 2 – 3 años." : undefined;
  const active = sample.pct_Ca < 65 && sample.pct_Mg < 20 && delta_pct > 0;
  return {
    active,
    product_name: MODULE_PRODUCTS_ES.dolomita,
    formula: "CaCO₃ + MgCO₃",
    nutrient_content_pct: 100,
    delta_pct,
    delta_meq,
    dose_kg_ha,
    dose_ton_ha,
    total_kg: dose_kg_ha * sample.area_ha,
    total_ton: dose_ton_ha * sample.area_ha,
    notes: MODULE_NOTES_ES.dolomita,
    warning: warn,
  };
}

// ----- Module: Potasio -----
function calcPotasio(sample: SoilSample, k: number): AmendmentResult {
  const delta_pct = sample.target_K_pct - sample.pct_K;
  const delta_meq = (delta_pct / 100) * sample.CIC;
  const kg_K_ha = delta_meq > 0 ? delta_meq * k * 39.1 : 0;
  const kg_K2SO4 = kg_K_ha / 0.44;
  const kg_KCl = kg_K_ha / 0.61;
  const warn = kg_K2SO4 > 3000 ? "Dosis alta de K. Verificar % de saturación y CIC." : undefined;
  return {
    active: sample.pct_K < 5 && delta_pct > 0,
    product_name: "Sulfato de potasio (K₂SO₄)",
    formula: "K₂SO₄",
    nutrient_content_pct: 44,
    delta_pct,
    delta_meq,
    dose_kg_ha: kg_K2SO4,
    dose_ton_ha: kg_K2SO4 / 1000,
    total_kg: kg_K2SO4 * sample.area_ha,
    total_ton: (kg_K2SO4 / 1000) * sample.area_ha,
    notes: MODULE_NOTES_ES.potasio,
    warning: warn,
    alt_product_name: "Cloruro de potasio (KCl, 61 % K)",
    alt_dose_kg_ha: kg_KCl,
    alt_total_kg: kg_KCl * sample.area_ha,
  };
}

// ----- Module: Enyesado (yeso para incrementar Ca) -----
function calcEnyesado(sample: SoilSample, k: number): AmendmentResult {
  const delta_pct = sample.target_Ca_pct - sample.pct_Ca;
  const delta_meq = (delta_pct / 100) * sample.CIC;
  const dose_kg_ha = delta_meq > 0 ? delta_meq * k * 86.09 : 0;
  return {
    active: sample.pct_Ca < 65 && sample.pct_Na <= 5 && delta_pct > 0,
    product_name: MODULE_PRODUCTS_ES.enyesado,
    formula: "CaSO₄·2H₂O",
    nutrient_content_pct: 100,
    delta_pct,
    delta_meq,
    dose_kg_ha,
    dose_ton_ha: dose_kg_ha / 1000,
    total_kg: dose_kg_ha * sample.area_ha,
    total_ton: (dose_kg_ha / 1000) * sample.area_ha,
    notes: MODULE_NOTES_ES.enyesado,
  };
}

// ----- Module: Carbono / Materia orgánica -----
function calcCarbono(sample: SoilSample): CarbonAmendmentResult {
  const moActual = sample.MO_pct ?? 0;
  const target = sample.target_MO_pct;
  const delta = target - moActual;
  const soilMass = (sample.profundidad_cm / 100) * 10000 * sample.densidad_aparente;
  const cPct = sample.carbon_material_pct || 1;
  const dose_ton_ha = delta > 0 ? (delta * VAN_BEMMELEN * soilMass) / cPct : 0;
  // simplification: t_material/ha = ΔMO × 0.58 × soilMass / %C
  // (units: ΔMO and %C both in %, soilMass in t/ha → result in t/ha)
  const warn = dose_ton_ha > 50 ? "Dosis elevada. Verificar el % de carbono del material o fraccionar." : undefined;
  return {
    active: moActual < 1.6 && delta > 0,
    product_name: sample.carbon_material_name,
    material_name: sample.carbon_material_name,
    material_carbon_pct: sample.carbon_material_pct,
    current_MO_pct: moActual,
    target_MO_pct: target,
    delta_MO_pct: delta,
    soil_mass_t_ha: soilMass,
    dose_ton_ha,
    total_ton: dose_ton_ha * sample.area_ha,
    notes: MODULE_NOTES_ES.carbono,
    warning: warn,
  };
}

// ----- Module: Azufre -----
function calcAzufre(sample: SoilSample): AzufreAmendmentResult {
  const pH = sample.pH ?? 7;
  const texture: SoilTexture = sample.soil_texture;
  const method: AzufreMethod = sample.azufre_method;
  const row = AZUFRE_TABLE.find((r) => pH >= r.pH_min && pH < r.pH_max);
  let dose_kg_ha = 0;
  if (row) {
    if (texture === "pesado") {
      dose_kg_ha = method === "incorporado" ? row.pesado_incorporado : row.pesado_bandeo;
    } else {
      dose_kg_ha = method === "incorporado" ? row.ligero_incorporado : row.ligero_bandeo;
    }
  }
  return {
    active: pH > 7.5,
    product_name: MODULE_PRODUCTS_ES.azufre,
    formula: "S",
    pH,
    texture,
    method,
    dose_kg_ha,
    dose_ton_ha: dose_kg_ha / 1000,
    total_kg: dose_kg_ha * sample.area_ha,
    total_ton: (dose_kg_ha / 1000) * sample.area_ha,
    notes: MODULE_NOTES_ES.azufre,
  };
}

// ----- Compose all amendments -----
export function calculateAmendments(sample: SoilSample): AmendmentResults {
  const k = getK(sample);
  const ratios = calculateRatios(calculateMeq(sample));
  return {
    magnesio: calcMagnesio(sample, k, ratios),
    sodio: calcSodio(sample, k),
    azufre: calcAzufre(sample),
    encalado: calcEncalado(sample, k),
    dolomita: calcDolomita(sample, k),
    carbono: calcCarbono(sample),
    potasio: calcPotasio(sample, k),
    enyesado: calcEnyesado(sample, k),
  };
}

export function computeSample(sample: SoilSample): ComputedSample {
  const meq = calculateMeq(sample);
  const ratios = calculateRatios(meq);
  const diagnosis = diagnose(sample);
  const amendments = calculateAmendments(sample);
  const balance = checkCationBalance(sample);
  return { sample, meq, ratios, diagnosis, amendments, balance };
}

function fmt(n: number): string {
  if (!isFinite(n)) return "—";
  return n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

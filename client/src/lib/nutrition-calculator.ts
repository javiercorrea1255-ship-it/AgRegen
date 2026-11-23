// Pure-frontend nutrition & bioestimulation calculator engine.
// Based on Oseguera y Sánchez (2015), NOM-021-SEMARNAT-2000.
// Reference crop: Maíz blanco grano. All formulas come from
// `attached_assets/SPEC_Calculadora_Nutricion_Bioestimulacion_*.md`.

export type ProductionSystem = "riego_rodado" | "fertirriego";

export type MacroKey = "N" | "P2O5" | "K2O" | "CaO" | "MgO" | "S";
export type MicroKey = "Fe" | "Cu" | "Mn" | "Zn" | "B";

export interface SoilInputs {
  profundidadCm: number;
  da: number; // g/cm³ (default 1.0 si no reporta lab)
  mosPct: number;
  ph: number;
  ce: number; // dS/m
  textura?: string;
  nInorgPpm: number;
  pPpm: number;
  kPpm: number;
  caPpm: number;
  mgPpm: number;
  sPpm: number;
  fePpm: number;
  cuPpm: number;
  mnPpm: number;
  znPpm: number;
  bPpm: number;
  cic?: number;
  pctCa?: number;
  pctMg?: number;
  pctK?: number;
  pctNa?: number;
}

export interface WaterInputs {
  ph?: number;
  ce?: number;
  caMeq?: number;
  mgMeq?: number;
  kMeq?: number;
  naMeq?: number;
  nh4Meq?: number;
  no3Meq?: number;
  so4Meq?: number;
  h2po4Meq?: number;
  co3Meq?: number;
  hco3Meq?: number;
  clMeq?: number;
  fePpm?: number;
  cuPpm?: number;
  mnPpm?: number;
  znPpm?: number;
  bPpm?: number;
}

export interface GeneralInputs {
  rendimientoMeta: number; // ton/ha
  superficieHas: number;
  productionSystem: ProductionSystem;
  moo: number; // kg N/ha aportados por materia orgánica externa
}

// ---------- Constants from spec ----------

// Bloque B - remoción nutrimental por tonelada de grano
const REMOCION_MACRO: Record<MacroKey, number> = {
  N: 22,
  P2O5: 8,
  K2O: 20,
  CaO: 3,
  MgO: 7,
  S: 4,
};

// mg/ton -> divididos por 1000 para llegar a g/ha cuando se multiplica por ton/ha
const REMOCION_MICRO_MG_TON: Record<MicroKey, number> = {
  Fe: 125,
  Cu: 13,
  Mn: 189,
  Zn: 53,
  B: 20,
};

// Bloque E - eficiencia del fertilizante (multiplicador)
const EF: Record<ProductionSystem, Record<MacroKey | MicroKey, number>> = {
  riego_rodado: {
    N: 1.4, P2O5: 1.9, K2O: 1.3, CaO: 1.3, MgO: 1.3, S: 1.3,
    Fe: 1.3, Cu: 1.3, Mn: 1.3, Zn: 1.3, B: 1.3,
  },
  fertirriego: {
    N: 1.2, P2O5: 1.5, K2O: 1.1, CaO: 1.1, MgO: 1.1, S: 1.1,
    Fe: 1.1, Cu: 1.1, Mn: 1.1, Zn: 1.1, B: 1.1,
  },
};

// Bloque H - distribución fenológica (% por etapa)
export const ETAPAS = [
  "Siembra a 9na hoja",
  "Formación de panícula",
  "Floración",
  "Madurez - Estado lechoso",
] as const;
export type Etapa = typeof ETAPAS[number];

const DISTRIBUCION_PCT: Record<MacroKey | "MICRO", [number, number, number, number]> = {
  N: [4, 18, 28, 50],
  P2O5: [3, 30, 28, 39],
  K2O: [4, 65, 10, 21],
  CaO: [10, 15, 40, 35],
  MgO: [40, 40, 10, 10],
  S: [25, 25, 25, 25],
  MICRO: [25, 25, 25, 25],
};

// Bloque I - constantes de mineralización
const C_ORG = 0.55;
const RC_N = 0.10;
const TM = 0.02;

// Pesos equivalentes (Apéndice B)
const PE = {
  Ca: 20.04, Mg: 12.16, K: 39.10, Na: 22.99, NH4: 18.04,
  NO3: 62.00, SO4: 48.03, H2PO4: 97.00, CO3: 30.00, HCO3: 61.02, Cl: 35.45,
};

// Conversiones P/P2O5 etc. (Apéndice C)
const TO_OXIDE = { P2O5: 2.291, K2O: 1.205, CaO: 1.399, MgO: 1.658 };

// ---------- Outputs ----------

export interface MacroResult {
  sum: number;
  dem: number;
  ef: number;
  resultado: number; // (SUM - DEM) * EF
  factorAjuste: number; // -1 o +0.25
  dosis: number; // resultado * factorAjuste (siempre >= 0)
  distribucion: Record<Etapa, number>;
}

export interface MicroResult {
  sumGHa: number;
  demGHa: number;
  ef: number;
  resultado: number;
  factorAjuste: number;
  dosis: number;
  foliarRecomendado: boolean;
}

export interface WaterDerived {
  sumCationes: number;
  sumAniones: number;
  balanceErrorPct: number;
  sar: number;
  durezaGhf: number;
  ceSalesNocivas: number;
  ceSalesNutrientes: number;
  acidoSulfuricoMlM3: number;
  ppm: Record<string, number>;
}

export interface AlertItem {
  level: "warning" | "info" | "danger";
  message: string;
}

export interface CalculationResult {
  ps: number; // peso del suelo kg/ha
  nm: number; // N mineralizado kg/ha
  nAjustado: number; // formula_N - Nm - MOO
  macros: Record<MacroKey, MacroResult>;
  micros: Record<MicroKey, MicroResult>;
  alerts: AlertItem[];
  water?: WaterDerived;
}

// ---------- Helpers ----------

function pct(v: number, p: number): number {
  return (p / 100) * v;
}

function distribucion(macroKey: MacroKey, total: number): Record<Etapa, number> {
  const pcts = DISTRIBUCION_PCT[macroKey];
  return {
    [ETAPAS[0]]: pct(total, pcts[0]),
    [ETAPAS[1]]: pct(total, pcts[1]),
    [ETAPAS[2]]: pct(total, pcts[2]),
    [ETAPAS[3]]: pct(total, pcts[3]),
  } as Record<Etapa, number>;
}

// ---------- Main calculation ----------

export function calculateNutritionProgram(
  general: GeneralInputs,
  soil: SoilInputs,
  water?: WaterInputs,
): CalculationResult {
  // Bloque D - Peso del Suelo
  const da = soil.da > 0 ? soil.da : 1.0;
  const ps = (da * 1000) * (soil.profundidadCm / 100) * 10000; // kg/ha

  // Helper to compute SUM macro (kg/ha)
  const sumMacro = (ppm: number) => (ppm * ps) / 1_000_000;
  // SUM micro (g/ha): ppm * PS / 1000
  const sumMicro = (ppm: number) => (ppm * ps) / 1000;

  const efTable = EF[general.productionSystem];

  // SUM por nutrimento. Para macros usamos: N -> N inorg; P -> convertir a P2O5;
  // K -> K2O; Ca -> CaO; Mg -> MgO; S -> S.
  // El spec mide rendimientos en kg de óxido (P2O5, K2O, CaO, MgO).
  // Ajustamos los SUM del suelo a la unidad de óxido para comparar peras con peras.
  const sumValues: Record<MacroKey, number> = {
    N: sumMacro(soil.nInorgPpm),
    P2O5: sumMacro(soil.pPpm) * TO_OXIDE.P2O5,
    K2O: sumMacro(soil.kPpm) * TO_OXIDE.K2O,
    CaO: sumMacro(soil.caPpm) * TO_OXIDE.CaO,
    MgO: sumMacro(soil.mgPpm) * TO_OXIDE.MgO,
    S: sumMacro(soil.sPpm),
  };

  const emptyMacro = (): MacroResult => ({
    sum: 0, dem: 0, ef: 0, resultado: 0, factorAjuste: 0, dosis: 0,
    distribucion: ETAPAS.reduce((a, e) => ({ ...a, [e]: 0 }), {} as Record<Etapa, number>),
  });
  const macros: Record<MacroKey, MacroResult> = {
    N: emptyMacro(), P2O5: emptyMacro(), K2O: emptyMacro(),
    CaO: emptyMacro(), MgO: emptyMacro(), S: emptyMacro(),
  };
  (Object.keys(REMOCION_MACRO) as MacroKey[]).forEach((k) => {
    const dem = general.rendimientoMeta * REMOCION_MACRO[k];
    const ef = efTable[k];
    const sum = sumValues[k];
    const resultado = (sum - dem) * ef;
    const factorAjuste = resultado < 0 ? -1.0 : 0.25;
    const dosis = Math.max(0, resultado * factorAjuste); // siempre >= 0
    macros[k] = {
      sum,
      dem,
      ef,
      resultado,
      factorAjuste,
      dosis,
      distribucion: distribucion(k, dosis),
    };
  });

  // Micros (g/ha)
  const emptyMicro = (): MicroResult => ({
    sumGHa: 0, demGHa: 0, ef: 0, resultado: 0, factorAjuste: 0, dosis: 0, foliarRecomendado: false,
  });
  const micros: Record<MicroKey, MicroResult> = {
    Fe: emptyMicro(), Cu: emptyMicro(), Mn: emptyMicro(), Zn: emptyMicro(), B: emptyMicro(),
  };
  const microPpms: Record<MicroKey, number> = {
    Fe: soil.fePpm, Cu: soil.cuPpm, Mn: soil.mnPpm, Zn: soil.znPpm, B: soil.bPpm,
  };
  (Object.keys(REMOCION_MICRO_MG_TON) as MicroKey[]).forEach((k) => {
    const sumGHa = sumMicro(microPpms[k]);
    // mg/ton * ton/ha / 1000 = g/ha (spec ej: Fe 15 * 125/1000 = 1.875 g/ha)
    const demGHa = general.rendimientoMeta * REMOCION_MICRO_MG_TON[k] / 1000;
    const ef = efTable[k];
    const resultado = (sumGHa - demGHa) * ef;
    const factorAjuste = resultado < 0 ? -1.0 : 0.25;
    const dosis = Math.max(0, resultado * factorAjuste);
    micros[k] = {
      sumGHa,
      demGHa,
      ef,
      resultado,
      factorAjuste,
      dosis,
      foliarRecomendado: resultado < 0,
    };
  });

  // Bloque I - Nm y N_ajustado
  const mosFrac = soil.mosPct / 100;
  const nm = ps * mosFrac * C_ORG * RC_N * TM; // kg N/ha
  const nAjustado = Math.max(0, macros.N.dosis - nm - (general.moo || 0));

  // Reemplazamos la distribución de N para reflejar el N_ajustado
  macros.N.distribucion = distribucion("N", nAjustado);

  // ---------- Water analysis (opcional) ----------
  let waterDerived: WaterDerived | undefined;
  if (water) {
    const ca = water.caMeq || 0, mg = water.mgMeq || 0, k = water.kMeq || 0,
          na = water.naMeq || 0, nh4 = water.nh4Meq || 0,
          no3 = water.no3Meq || 0, so4 = water.so4Meq || 0,
          h2po4 = water.h2po4Meq || 0, co3 = water.co3Meq || 0,
          hco3 = water.hco3Meq || 0, cl = water.clMeq || 0;
    const sumCat = ca + mg + k + na + nh4;
    const sumAni = no3 + so4 + h2po4 + co3 + hco3 + cl;
    const denom = (sumCat + sumAni) / 2;
    const balanceErrorPct = denom > 0 ? Math.abs(sumCat - sumAni) / denom * 100 : 0;
    const sar = (ca + mg) > 0 ? na / Math.sqrt((ca + mg) / 2) : 0;
    const durezaGhf = (ca + mg) * 5;

    // Ácido sulfúrico para neutralizar HCO3 (ml/m³)
    const acidoSulfuricoMlM3 = hco3 > 0 ? (hco3 * 49) / (1.83 * 0.98) : 0;

    // CE estimada por sales nocivas (aproximación: meq * 0.1)
    const ceSalesNocivas = (na + cl + hco3) * 0.1;
    const ceTotal = water.ce || 0;
    const ceSalesNutrientes = ceTotal - ceSalesNocivas;

    waterDerived = {
      sumCationes: sumCat,
      sumAniones: sumAni,
      balanceErrorPct,
      sar,
      durezaGhf,
      ceSalesNocivas,
      ceSalesNutrientes,
      acidoSulfuricoMlM3,
      ppm: {
        Ca: ca * PE.Ca, Mg: mg * PE.Mg, K: k * PE.K, Na: na * PE.Na,
        NH4: nh4 * PE.NH4, NO3: no3 * PE.NO3, SO4: so4 * PE.SO4,
        H2PO4: h2po4 * PE.H2PO4, CO3: co3 * PE.CO3, HCO3: hco3 * PE.HCO3,
        Cl: cl * PE.Cl,
      },
    };
  }

  // ---------- Alertas agronómicas ----------
  const alerts: AlertItem[] = [];
  if (soil.ph < 5.5) alerts.push({ level: "warning", message: "pH ácido — considerar encalado." });
  else if (soil.ph > 7.0) alerts.push({ level: "warning", message: "pH alcalino — riesgo de deficiencias de micronutrimentos." });
  if (soil.ce > 2.0) alerts.push({ level: "danger", message: "CE alta del suelo — riesgo de salinidad." });
  if (soil.mosPct < 1.6) alerts.push({ level: "warning", message: "MOS baja — incorporar materia orgánica (rastrojos, composta)." });
  if (soil.znPpm < 1.0) alerts.push({ level: "warning", message: "Zn deficiente — incluir en programa foliar." });
  if (soil.bPpm < 0.5) alerts.push({ level: "warning", message: "B deficiente — incluir en programa foliar." });
  if (soil.pPpm < 5.5) alerts.push({ level: "info", message: "P bajo — fertilización fosfatada prioritaria." });

  if (waterDerived) {
    if (waterDerived.sar > 3) alerts.push({ level: "warning", message: `SAR ${waterDerived.sar.toFixed(2)} — agua sódica, riesgo de sodificación del suelo.` });
    if (waterDerived.durezaGhf > 32) alerts.push({ level: "warning", message: `Agua dura (${waterDerived.durezaGhf.toFixed(1)} °f) — puede precipitar carbonatos en emisores.` });
    if ((water?.hco3Meq || 0) > 2.5) alerts.push({ level: "info", message: "HCO₃⁻ alto — aplicar ácido para corrección de pH." });
    if ((water?.ce || 0) > 1.5) alerts.push({ level: "danger", message: "CE alta del agua — riesgo de toxicidad por sales." });
    if (waterDerived.balanceErrorPct > 5) alerts.push({ level: "info", message: `Balance iónico dudoso (${waterDerived.balanceErrorPct.toFixed(1)} %) — verificar el análisis.` });
  }

  // Foliar para micros deficientes
  (Object.keys(micros) as MicroKey[]).forEach((k) => {
    if (micros[k].foliarRecomendado) {
      alerts.push({ level: "info", message: `${k} deficiente — incluir en programa de fertilización foliar.` });
    }
  });

  return { ps, nm, nAjustado, macros, micros, alerts, water: waterDerived };
}

export function getDefaultProducts(): Array<{
  productName: string; unit: string; e1Kg: number; e2Kg: number; e3Kg: number; e4Kg: number; priceUnit: number;
}> {
  // Productos sugeridos del spec ejemplo (Sección 7.2). El usuario puede editar.
  return [
    { productName: "AP BASE (Ca(NO₃)₂)", unit: "kg", e1Kg: 550, e2Kg: 0, e3Kg: 0, e4Kg: 0, priceUnit: 13 },
    { productName: "AP 30 (K₂HPO₄)", unit: "kg", e1Kg: 0, e2Kg: 550, e3Kg: 0, e4Kg: 0, priceUnit: 14.5 },
    { productName: "Sulfato de amonio", unit: "kg", e1Kg: 0, e2Kg: 0, e3Kg: 0, e4Kg: 0, priceUnit: 9.5 },
    { productName: "Fosfonitrato", unit: "kg", e1Kg: 0, e2Kg: 0, e3Kg: 350, e4Kg: 0, priceUnit: 14 },
    { productName: "TIO K AP", unit: "kg", e1Kg: 0, e2Kg: 20, e3Kg: 20, e4Kg: 0, priceUnit: 70 },
    { productName: "Sulfato de magnesio", unit: "kg", e1Kg: 0, e2Kg: 0, e3Kg: 0, e4Kg: 0, priceUnit: 8 },
    { productName: "Sulfato de zinc", unit: "kg", e1Kg: 2, e2Kg: 0, e3Kg: 2, e4Kg: 0, priceUnit: 50 },
    { productName: "Ácido bórico", unit: "kg", e1Kg: 1, e2Kg: 0, e3Kg: 1, e4Kg: 0, priceUnit: 80 },
  ];
}

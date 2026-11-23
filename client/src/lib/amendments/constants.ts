import type { ModuleKey, SoilSample } from "./types";

export const OPTIMAL_RANGES = {
  Ca: { min: 65, max: 75 },
  Mg: { min: 10, max: 20 },
  K: { min: 5, max: 7 },
  Na: { min: 0, max: 5 },
  H: { min: 0, max: 5 },
  Al: { min: 0, max: 5 },
  CIC: { min: 0, max: 25 },
};

export const OPTIMAL_RATIOS = {
  Ca_Mg: { min: 2, max: 6 },
  Mg_K: { min: 2, max: 3 },
  CaMg_K: { min: 20, max: 30 },
  Ca_K: { min: 10, max: 15 },
};

export const DEFAULT_TARGETS = {
  Ca: 70,
  Mg: 15,
  K: 5,
  Na: 5,
  MO: 3,
};

export const DEFAULT_SOIL_PARAMS = {
  profundidad_cm: 20,
  densidad_aparente: 1.5,
};

export const ORGANIC_MATERIALS: Array<{ name: string; carbon_pct: number }> = [
  { name: "BIO FACTOR AP", carbon_pct: 28.4 },
  { name: "Composta madura", carbon_pct: 20.0 },
  { name: "Vermicomposta", carbon_pct: 22.0 },
  { name: "Estiércol bovino seco", carbon_pct: 17.0 },
  { name: "Estiércol porcino seco", carbon_pct: 14.0 },
  { name: "Paja de trigo", carbon_pct: 38.0 },
  { name: "Bagazo de caña", carbon_pct: 35.0 },
  { name: "Humus de lombriz", carbon_pct: 25.0 },
];

export const VAN_BEMMELEN = 0.58;

export const AZUFRE_TABLE: Array<{
  pH_min: number;
  pH_max: number;
  pesado_incorporado: number;
  pesado_bandeo: number;
  ligero_incorporado: number;
  ligero_bandeo: number;
}> = [
  { pH_min: 7.5, pH_max: 8.25, pesado_incorporado: 1645, pesado_bandeo: 2193, ligero_incorporado: 548, ligero_bandeo: 877 },
  { pH_min: 8.25, pH_max: 8.75, pesado_incorporado: 2193, pesado_bandeo: 2193, ligero_incorporado: 877, ligero_bandeo: 877 },
  { pH_min: 8.75, pH_max: 9.25, pesado_incorporado: 3289, pesado_bandeo: 2193, ligero_incorporado: 877, ligero_bandeo: 877 },
  { pH_min: 9.25, pH_max: 14, pesado_incorporado: 3289, pesado_bandeo: 2193, ligero_incorporado: 877, ligero_bandeo: 877 },
];

export const MODULE_COLORS: Record<ModuleKey, string> = {
  magnesio: "#6A994E",
  sodio: "#E9C46A",
  azufre: "#F4D35E",
  encalado: "#A8C5A0",
  dolomita: "#B7B7A4",
  carbono: "#8B5E3C",
  potasio: "#6D6875",
  enyesado: "#CDB4DB",
};

export const MODULE_LABELS_ES: Record<ModuleKey, string> = {
  magnesio: "Magnesio",
  sodio: "Sodio",
  azufre: "Azufre",
  encalado: "Encalado",
  dolomita: "Dolomita",
  carbono: "Carbono / MO",
  potasio: "Potasio",
  enyesado: "Enyesado",
};

export const MODULE_PRODUCTS_ES: Record<ModuleKey, string> = {
  magnesio: "Sulfato de magnesio (MgSO₄·7H₂O)",
  sodio: "Yeso agrícola (CaSO₄·2H₂O)",
  azufre: "Azufre elemental (S)",
  encalado: "Cal agrícola (CaCO₃)",
  dolomita: "Cal dolomítica (CaCO₃ + MgCO₃)",
  carbono: "Material orgánico",
  potasio: "Sulfato de potasio (K₂SO₄)",
  enyesado: "Yeso agrícola (CaSO₄·2H₂O)",
};

export const MODULE_NOTES_ES: Record<ModuleKey, string> = {
  magnesio:
    "Aplicar al voleo y mezclar con el suelo antes de la siembra. Riego posterior para favorecer la disolución.",
  sodio:
    "El Ca²⁺ del yeso desplaza al Na⁺ del complejo de intercambio. Requiere drenaje adecuado y lavado posterior para evacuar las sales.",
  azufre:
    "Acidifica suelos alcalinos por oxidación biológica. Incorporar al suelo, no aplicar superficial. Requiere humedad y temperatura > 15 °C.",
  encalado:
    "Neutraliza acidez y desplaza Al³⁺ intercambiable. Aplicar 2–3 meses antes de la siembra; mezclar con el suelo. Si Al > 1 % considerar aumentar la dosis.",
  dolomita:
    "Aporta Ca y Mg simultáneamente. Reacción más lenta que la cal viva. Aplicar al voleo e incorporar.",
  carbono:
    "El material orgánico mejora estructura, retención de agua y CIC. Para dosis altas (> 50 t/ha) considerar aplicación fraccionada en 2–3 ciclos.",
  potasio:
    "Usar K₂SO₄ en cultivos sensibles al cloro (tabaco, papa, frutales). Usar KCl en cultivos tolerantes (maíz, soya, caña) por menor costo.",
  enyesado:
    "Yeso para incrementar Ca cuando no hay exceso de Na. No alcaliniza ni acidifica el suelo. Compatible con la mayoría de fertilizantes.",
};

/** Sample seed for demo button — covers the 8 cases referenced in the spec. */
export function buildDemoSamples(): SoilSample[] {
  const base = (over: Partial<SoilSample>): SoilSample => ({
    id: crypto.randomUUID(),
    name: "Muestra",
    pct_Ca: 70,
    pct_Mg: 15,
    pct_K: 5,
    pct_Na: 3,
    pct_H: 5,
    pct_Al: 2,
    CIC: 20,
    pH: 6.5,
    MO_pct: 3,
    area_ha: 1,
    profundidad_cm: DEFAULT_SOIL_PARAMS.profundidad_cm,
    densidad_aparente: DEFAULT_SOIL_PARAMS.densidad_aparente,
    target_Ca_pct: DEFAULT_TARGETS.Ca,
    target_Mg_pct: DEFAULT_TARGETS.Mg,
    target_K_pct: DEFAULT_TARGETS.K,
    target_Na_pct: DEFAULT_TARGETS.Na,
    target_MO_pct: DEFAULT_TARGETS.MO,
    carbon_material_name: ORGANIC_MATERIALS[0].name,
    carbon_material_pct: ORGANIC_MATERIALS[0].carbon_pct,
    soil_texture: "pesado",
    azufre_method: "incorporado",
    ...over,
  });

  return [
    base({ name: "Bajo en magnesio", pct_Ca: 76, pct_Mg: 7, pct_K: 5, pct_Na: 3, pct_H: 5, pct_Al: 4, CIC: 22 }),
    base({ name: "Alto en sodio", pct_Ca: 60, pct_Mg: 13, pct_K: 4, pct_Na: 12, pct_H: 6, pct_Al: 5, CIC: 18 }),
    base({ name: "Suelo alcalino", pct_Ca: 68, pct_Mg: 14, pct_K: 5, pct_Na: 4, pct_H: 4, pct_Al: 5, CIC: 20, pH: 8.3 }),
    base({ name: "Suelo ácido", pct_Ca: 50, pct_Mg: 10, pct_K: 4, pct_Na: 3, pct_H: 18, pct_Al: 15, CIC: 14, pH: 5.0 }),
    base({ name: "Bajo Ca y Mg", pct_Ca: 55, pct_Mg: 8, pct_K: 6, pct_Na: 3, pct_H: 16, pct_Al: 12, CIC: 16, pH: 5.7 }),
    base({ name: "Bajo en MO", pct_Ca: 70, pct_Mg: 15, pct_K: 5, pct_Na: 3, pct_H: 4, pct_Al: 3, CIC: 18, MO_pct: 1.0 }),
    base({ name: "Bajo en potasio", pct_Ca: 72, pct_Mg: 16, pct_K: 2.5, pct_Na: 4, pct_H: 4, pct_Al: 1.5, CIC: 22 }),
    base({ name: "Bajo Ca sin sodio", pct_Ca: 58, pct_Mg: 18, pct_K: 6, pct_Na: 4, pct_H: 8, pct_Al: 6, CIC: 19 }),
  ];
}

export function blankSample(name = "Nueva muestra"): SoilSample {
  return {
    id: crypto.randomUUID(),
    name,
    pct_Ca: 70,
    pct_Mg: 15,
    pct_K: 5,
    pct_Na: 3,
    pct_H: 5,
    pct_Al: 2,
    CIC: 20,
    pH: 6.5,
    MO_pct: 3,
    area_ha: 1,
    profundidad_cm: DEFAULT_SOIL_PARAMS.profundidad_cm,
    densidad_aparente: DEFAULT_SOIL_PARAMS.densidad_aparente,
    target_Ca_pct: DEFAULT_TARGETS.Ca,
    target_Mg_pct: DEFAULT_TARGETS.Mg,
    target_K_pct: DEFAULT_TARGETS.K,
    target_Na_pct: DEFAULT_TARGETS.Na,
    target_MO_pct: DEFAULT_TARGETS.MO,
    carbon_material_name: ORGANIC_MATERIALS[0].name,
    carbon_material_pct: ORGANIC_MATERIALS[0].carbon_pct,
    soil_texture: "pesado",
    azufre_method: "incorporado",
  };
}

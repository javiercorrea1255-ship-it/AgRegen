export type SoilTexture = "pesado" | "ligero";
export type AzufreMethod = "incorporado" | "bandeo";
export type DiagnosisStatus = "optimo" | "aceptable" | "deficiente" | "critico";
export type Severity = "critico" | "moderado" | "leve";

export type ModuleKey =
  | "magnesio"
  | "sodio"
  | "azufre"
  | "encalado"
  | "dolomita"
  | "carbono"
  | "potasio"
  | "enyesado";

export interface SoilSample {
  id: string;
  name: string;

  pct_Ca: number;
  pct_Mg: number;
  pct_K: number;
  pct_Na: number;
  pct_H: number;
  pct_Al: number;
  CIC: number;

  pH?: number;
  MO_pct?: number;
  area_ha: number;

  profundidad_cm: number;
  densidad_aparente: number;

  target_Ca_pct: number;
  target_Mg_pct: number;
  target_K_pct: number;
  target_Na_pct: number;
  target_MO_pct: number;

  carbon_material_name: string;
  carbon_material_pct: number;

  soil_texture: SoilTexture;
  azufre_method: AzufreMethod;
}

export interface MeqValues {
  Ca: number;
  Mg: number;
  K: number;
  Na: number;
  H: number;
  Al: number;
}

export interface CationRatios {
  Ca_Mg: number;
  Mg_K: number;
  CaMg_K: number;
  Ca_K: number;
}

export interface DiagnosisFlag {
  active: boolean;
  reason: string;
  severity: Severity;
}

export interface DiagnosisResult {
  magnesio: DiagnosisFlag;
  sodio: DiagnosisFlag;
  azufre: DiagnosisFlag;
  encalado: DiagnosisFlag;
  dolomita: DiagnosisFlag;
  carbono: DiagnosisFlag;
  potasio: DiagnosisFlag;
  enyesado: DiagnosisFlag;
  status: DiagnosisStatus;
  activeCount: number;
}

export interface AmendmentResult {
  active: boolean;
  product_name: string;
  formula: string;
  nutrient_content_pct: number;
  delta_pct: number;
  delta_meq: number;
  dose_kg_ha: number;
  dose_ton_ha: number;
  total_kg: number;
  total_ton: number;
  notes?: string;
  warning?: string;
  /** For potasio: alternate product (KCl) */
  alt_product_name?: string;
  alt_dose_kg_ha?: number;
  alt_total_kg?: number;
}

export interface CarbonAmendmentResult {
  active: boolean;
  product_name: string;
  material_name: string;
  material_carbon_pct: number;
  current_MO_pct: number;
  target_MO_pct: number;
  delta_MO_pct: number;
  soil_mass_t_ha: number;
  dose_ton_ha: number;
  total_ton: number;
  notes?: string;
  warning?: string;
}

export interface AzufreAmendmentResult {
  active: boolean;
  product_name: string;
  formula: string;
  pH: number;
  texture: SoilTexture;
  method: AzufreMethod;
  dose_kg_ha: number;
  dose_ton_ha: number;
  total_kg: number;
  total_ton: number;
  notes?: string;
  warning?: string;
}

export interface AmendmentResults {
  magnesio: AmendmentResult;
  sodio: AmendmentResult;
  azufre: AzufreAmendmentResult;
  encalado: AmendmentResult;
  dolomita: AmendmentResult;
  carbono: CarbonAmendmentResult;
  potasio: AmendmentResult;
  enyesado: AmendmentResult;
}

export interface CationBalanceCheck {
  sum: number;
  valid: boolean;
  severity: "ok" | "warning" | "error";
  message?: string;
}

export interface ComputedSample {
  sample: SoilSample;
  meq: MeqValues;
  ratios: CationRatios;
  diagnosis: DiagnosisResult;
  amendments: AmendmentResults;
  balance: CationBalanceCheck;
}

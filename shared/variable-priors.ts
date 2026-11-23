/**
 * Variable-specific agronomic priors for the MVZ sampling wizard.
 *
 * These values come from peer-reviewed precision-agriculture literature
 * (Webster & Oliver 2007, Cambardella et al. 1994, Mallarino et al. 2011)
 * and are used to:
 *  1. Justify the minimum sample size per variable (variable-aware Cochran).
 *  2. Recommend a distribution transform before interpolation.
 *  3. Warn the user when the observed CV exceeds the typical range.
 */

export interface VariablePrior {
  /** Short agronomic code. Should match MasterVariable.code. */
  code: string;
  /** Human-readable Spanish label */
  label: string;
  /** Typical coefficient of variation (%) in agricultural soils */
  typicalCvPct: number;
  /** Expected spatial range of autocorrelation (metres) */
  spatialRangeM: number;
  /** Typical skewness category: "low" | "moderate" | "high" */
  typicalSkewness: "low" | "moderate" | "high";
  /**
   * Recommended distribution transform before interpolation.
   * "auto" lets the system detect from skewness at run-time.
   */
  transformHint: "none" | "sqrt" | "log1p" | "auto";
  /**
   * Minimum points recommended for geostatistical interpolation
   * beyond the absolute minimum of 3 (IDW).
   */
  minRecommendedPoints: number;
  /** One-sentence agronomic justification shown in the UI */
  agronNote: string;
  /** Allowable relative error (%) used in Cochran formula */
  allowableErrorPct: number;
}

const PRIORS: VariablePrior[] = [
  {
    code: "P",
    label: "Fósforo disponible",
    typicalCvPct: 85,
    spatialRangeM: 150,
    typicalSkewness: "high",
    transformHint: "log1p",
    minRecommendedPoints: 20,
    agronNote: "El P muestra la mayor variabilidad espacial de todos los macronutrientes (CV 60–120 %). Se requiere log(x+1) para normalizar la distribución sesgada.",
    allowableErrorPct: 15,
  },
  {
    code: "K",
    label: "Potasio intercambiable",
    typicalCvPct: 30,
    spatialRangeM: 300,
    typicalSkewness: "low",
    transformHint: "none",
    minRecommendedPoints: 12,
    agronNote: "El K tiene variabilidad moderada (CV 20–45 %). Su distribución es generalmente simétrica; no suele necesitar transformación.",
    allowableErrorPct: 10,
  },
  {
    code: "Ca",
    label: "Calcio intercambiable",
    typicalCvPct: 25,
    spatialRangeM: 400,
    typicalSkewness: "low",
    transformHint: "none",
    minRecommendedPoints: 10,
    agronNote: "Calcio muestra baja variabilidad espacial (CV 15–35 %). Distribución cercana a normal.",
    allowableErrorPct: 10,
  },
  {
    code: "Mg",
    label: "Magnesio intercambiable",
    typicalCvPct: 30,
    spatialRangeM: 350,
    typicalSkewness: "low",
    transformHint: "none",
    minRecommendedPoints: 10,
    agronNote: "Variabilidad similar al K (CV 20–40 %). Suele no requerir transformación.",
    allowableErrorPct: 10,
  },
  {
    code: "pH",
    label: "pH del suelo",
    typicalCvPct: 7,
    spatialRangeM: 500,
    typicalSkewness: "low",
    transformHint: "none",
    minRecommendedPoints: 8,
    agronNote: "El pH es la variable de menor variabilidad relativa (CV 4–10 %). Su escala logarítmica intrínseca hace innecesaria cualquier transformación adicional.",
    allowableErrorPct: 5,
  },
  {
    code: "MOS",
    label: "Materia orgánica del suelo",
    typicalCvPct: 40,
    spatialRangeM: 250,
    typicalSkewness: "moderate",
    transformHint: "sqrt",
    minRecommendedPoints: 15,
    agronNote: "MOS muestra sesgo moderado-alto (CV 30–60 %). La raíz cuadrada suele normalizar la distribución en suelos sin gradiente extremo.",
    allowableErrorPct: 12,
  },
  {
    code: "N",
    label: "Nitrógeno total",
    typicalCvPct: 40,
    spatialRangeM: 200,
    typicalSkewness: "moderate",
    transformHint: "sqrt",
    minRecommendedPoints: 15,
    agronNote: "N total correlaciona con MOS y exhibe variabilidad y sesgo similares (CV 30–55 %).",
    allowableErrorPct: 12,
  },
  {
    code: "CEC",
    label: "Capacidad de intercambio catiónico",
    typicalCvPct: 25,
    spatialRangeM: 400,
    typicalSkewness: "low",
    transformHint: "none",
    minRecommendedPoints: 10,
    agronNote: "CIC es un indicador integrador de textura y MOS; su variabilidad es moderada (CV 15–35 %).",
    allowableErrorPct: 10,
  },
  {
    code: "Zn",
    label: "Zinc disponible",
    typicalCvPct: 90,
    spatialRangeM: 120,
    typicalSkewness: "high",
    transformHint: "log1p",
    minRecommendedPoints: 20,
    agronNote: "El Zn es uno de los micronutrientes más variables espacialmente (CV 60–130 %). Requiere log(x+1).",
    allowableErrorPct: 15,
  },
  {
    code: "Cu",
    label: "Cobre disponible",
    typicalCvPct: 80,
    spatialRangeM: 130,
    typicalSkewness: "high",
    transformHint: "log1p",
    minRecommendedPoints: 20,
    agronNote: "El Cu es altamente variable y sesgado (CV 50–110 %). La transformación logarítmica es esencial.",
    allowableErrorPct: 15,
  },
  {
    code: "B",
    label: "Boro disponible",
    typicalCvPct: 75,
    spatialRangeM: 140,
    typicalSkewness: "high",
    transformHint: "log1p",
    minRecommendedPoints: 18,
    agronNote: "El B presenta alta variabilidad y sesgo positivo (CV 50–100 %).",
    allowableErrorPct: 15,
  },
  {
    code: "Mn",
    label: "Manganeso disponible",
    typicalCvPct: 70,
    spatialRangeM: 150,
    typicalSkewness: "high",
    transformHint: "log1p",
    minRecommendedPoints: 18,
    agronNote: "El Mn es fuertemente afectado por el pH; alta variabilidad (CV 50–100 %).",
    allowableErrorPct: 15,
  },
  {
    code: "S",
    label: "Azufre disponible",
    typicalCvPct: 50,
    spatialRangeM: 200,
    typicalSkewness: "moderate",
    transformHint: "sqrt",
    minRecommendedPoints: 15,
    agronNote: "El S tiene variabilidad moderada-alta (CV 35–70 %). La raíz cuadrada suele ser suficiente.",
    allowableErrorPct: 12,
  },
  {
    code: "CE",
    label: "Conductividad eléctrica",
    typicalCvPct: 60,
    spatialRangeM: 180,
    typicalSkewness: "moderate",
    transformHint: "auto",
    minRecommendedPoints: 15,
    agronNote: "La CE refleja salinidad y textura; variabilidad moderada-alta (CV 40–80 %).",
    allowableErrorPct: 12,
  },
];

const BY_CODE: Map<string, VariablePrior> = new Map(
  PRIORS.map(p => [p.code.toLowerCase(), p])
);

/** Returns the prior for the given variable code (case-insensitive), or null. */
export function getVariablePrior(code: string): VariablePrior | null {
  return BY_CODE.get(code.toLowerCase()) ?? null;
}

/** Returns all priors (used to seed UI lists). */
export function getAllPriors(): VariablePrior[] {
  return PRIORS;
}

export default PRIORS;

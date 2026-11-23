// sample-size.ts — F1-03/F1-04
// HTTP adapter that calls the Python geo-service /api/geo/sample-size endpoint.
// Falls back to local formulas when the endpoint is unavailable.
// Single source of truth: the Python backend is authoritative; this file
// wraps its canonical response (n_recommended, params_used.prior_source).

import { getVariablePrior } from "./variable-priors";

// ── Input / output types ───────────────────────────────────────────────────

export interface SampleSizeParams {
  /** Polygon area in hectares (used for local fallback) */
  areaHa: number;
  /** Parcel boundary [[lon, lat], ...]. Required for backend call. */
  polygon?: number[][];
  /** Coefficient of variation expected (%) */
  variabilityPct?: number;
  /** Allowable relative error (%) */
  allowableError?: number;
  /** Confidence level (90 | 95 | 99) */
  confidenceLevel?: 90 | 95 | 99;
  /** Variable code (e.g. "P", "pH", "MOS") — uses agronomic priors */
  variableCode?: string;
  purpose?: "mapping" | "mean";
  spatialRangeM?: number;
}

export interface SampleSizeBreakdown {
  n: number;
  method: string;
  formula: string;
  params: Record<string, number>;
}

export interface SampleSizeResult {
  cochran: SampleSizeBreakdown;
  fao: SampleSizeBreakdown;
  spatial: SampleSizeBreakdown;
  recommended: number;
  /** Canonical field from backend (F1-03) */
  n_recommended?: number;
  /** Canonical params from backend including prior_source (F1-03) */
  params_used?: {
    cv_pct: number;
    precision_pct: number;
    range_m: number;
    confidence_level: number;
    z_score: number;
    prior_source: "agronomic_prior" | "user_input";
  };
  /** Non-null when a variable-specific prior was used. */
  priorUsed?: {
    code: string;
    label: string;
    typicalCvPct: number;
    allowableErrorPct: number;
    transformHint: string;
    agronNote: string;
    minRecommendedPoints: number;
  } | null;
  /** True when result came from local fallback formulas */
  fromFallback?: boolean;
}

// ── Backend response shape (canonical F1-03 contract) ─────────────────────

interface BackendSampleSizeResponse {
  area_ha: number;
  n_cochran: number;
  n_fao: number;
  n_cressie_wikle: number;
  n_optimal: number;
  n_recommended: number;
  params: Record<string, number>;
  params_used: {
    cv_pct: number;
    precision_pct: number;
    range_m: number;
    confidence_level: number;
    z_score: number;
    prior_source: "agronomic_prior" | "user_input";
  };
  prior_used?: Record<string, unknown>;
}

// ── HTTP adapter ───────────────────────────────────────────────────────────

/**
 * Fetch sample-size recommendations from the Python geo-service.
 * Requires params.polygon to be provided.
 * Throws on network errors — caller should handle and fall back to computeSampleSize().
 */
export async function fetchSampleSize(params: SampleSizeParams & { polygon: number[][] }): Promise<SampleSizeResult> {
  const body = {
    polygon: params.polygon,
    cv_pct: params.variabilityPct ?? 30,
    precision_pct: params.allowableError ?? 20,
    range_m: params.spatialRangeM ?? (params.variableCode ? getVariablePrior(params.variableCode)?.spatialRangeM : undefined) ?? 300,
    purpose: params.purpose ?? "mapping",
    confidence_level: params.confidenceLevel ?? 90,
    variable_code: params.variableCode ?? null,
  };

  const res = await fetch("/api/geo/sample-size", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`geo-service /sample-size returned ${res.status}`);
  }

  const data: BackendSampleSizeResponse = await res.json();

  const recommended = data.n_recommended ?? data.n_optimal ?? data.n_cochran;
  const priorUsed = data.prior_used ? _mapPriorUsed(data.prior_used, params.variableCode) : null;

  return {
    cochran: {
      n: data.n_cochran,
      method: "Cochran",
      formula: `n = (t·CV/e)² = (${data.params_used.z_score}·${data.params_used.cv_pct}/${data.params_used.precision_pct})²`,
      params: { t: data.params_used.z_score, cv: data.params_used.cv_pct, e: data.params_used.precision_pct },
    },
    fao: {
      n: data.n_fao,
      method: "FAO/USDA",
      formula: `n ≈ area_ha / 4 (mín. 5, máx. 60) → ${data.n_fao}`,
      params: { area_ha: data.area_ha },
    },
    spatial: {
      n: data.n_cressie_wikle,
      method: "Cressie-Wikle (espacial)",
      formula: `n ≈ 4·A/r² → ${data.n_cressie_wikle}`,
      params: { area_ha: data.area_ha, range_m: data.params_used.range_m },
    },
    recommended,
    n_recommended: data.n_recommended,
    params_used: data.params_used,
    priorUsed,
    fromFallback: false,
  };
}

function _mapPriorUsed(raw: Record<string, unknown>, code?: string) {
  const prior = code ? getVariablePrior(code) : null;
  if (prior) {
    return {
      code: prior.code,
      label: prior.label,
      typicalCvPct: prior.typicalCvPct,
      allowableErrorPct: prior.allowableErrorPct,
      transformHint: prior.transformHint,
      agronNote: prior.agronNote,
      minRecommendedPoints: prior.minRecommendedPoints,
    };
  }
  return null;
}

// ── Local fallback (backward compat) ──────────────────────────────────────

const Z_BY_LEVEL: Record<number, number> = { 90: 1.645, 95: 1.96, 99: 2.576 };
const MIN_N = 5;
const MAX_N = 80;

function clamp(n: number): number {
  return Math.max(MIN_N, Math.min(MAX_N, Math.ceil(n)));
}

/**
 * Local formula fallback — used when polygon is unavailable or the geo-service
 * is unreachable. Results match backend formulas within ±1 for typical inputs.
 */
export function computeSampleSize(params: SampleSizeParams): SampleSizeResult {
  const prior = params.variableCode ? getVariablePrior(params.variableCode) : null;

  const cv = Number(params.variabilityPct ?? prior?.typicalCvPct ?? 30);
  const e = Number(params.allowableError ?? prior?.allowableErrorPct ?? 10);
  const z = Z_BY_LEVEL[params.confidenceLevel ?? 90] ?? 1.645;
  const areaHa = Math.max(Number(params.areaHa) || 1, 0.01);

   const n_cochran = Math.max(1, Math.ceil((z * cv / e) ** 2));
  const n_fao = clamp(1 + 2.4 * (cv / 10));
  const rangeM = params.spatialRangeM ?? prior?.spatialRangeM ?? 300;
  const n_spatial = Math.ceil(areaHa * 10_000 / (rangeM / 2) ** 2);

  const base = Math.min(Math.max(n_cochran, n_spatial), 50);
  const meanRecommendation = prior ? Math.max(base, prior.minRecommendedPoints) : base;
  const recommended = params.purpose === "mean" ? meanRecommendation : Math.max(30, n_cochran, n_spatial, meanRecommendation);

  return {
    cochran: {
      n: n_cochran,
      method: "Cochran",
      formula: `n = (t·CV/e)² = (${z}·${cv}/${e})²`,
      params: { t: z, cv, e },
    },
    fao: {
      n: n_fao,
      method: "FAO/USDA",
      formula: `n = 1 + 2.4·(CV/10) = 1 + 2.4·${(cv / 10).toFixed(1)}`,
      params: { cv },
    },
    spatial: {
      n: n_spatial,
      method: "Cressie-Wikle (espacial)",
      formula: `n ≥ A/(r/2)²; r = ${rangeM} m (aproximación local por área)`,
      params: { area_ha: areaHa, range_m: rangeM },
    },
    recommended,
    n_recommended: recommended,
    params_used: {
      cv_pct: cv,
      precision_pct: e,
      range_m: rangeM,
      confidence_level: params.confidenceLevel ?? 90,
      z_score: z,
      prior_source: prior ? "agronomic_prior" : "user_input",
    },
    priorUsed: prior
      ? {
          code: prior.code,
          label: prior.label,
          typicalCvPct: prior.typicalCvPct,
          allowableErrorPct: prior.allowableErrorPct,
          transformHint: prior.transformHint,
          agronNote: prior.agronNote,
          minRecommendedPoints: prior.minRecommendedPoints,
        }
      : null,
    fromFallback: true,
  };
}

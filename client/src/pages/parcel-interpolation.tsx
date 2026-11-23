import { useParams, useLocation, useSearch } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect, useRef } from "react";
import { associateResiduals, linearQuantile, normalizeMvzZones, sampleCoordinates, variogramCurve, type FittedVariogram } from "@/lib/mvz-results";
import { useInterpolationReadiness } from "@/hooks/useInterpolationReadiness";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, Loader2, Zap, BarChart3, Layers, ChevronRight, TrendingUp, Activity, AlertTriangle, AlertCircle, ChevronDown, ChevronUp, Eye, EyeOff, CheckCircle2, XCircle, Pencil, RefreshCw, Ban, ExternalLink, Download, Stethoscope, Wand2, Settings2, BarChart2, Trash2, MapPin } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  MapContainer, TileLayer, Polygon, ImageOverlay, CircleMarker, Tooltip as LeafletTooltip, useMap,
} from "react-leaflet";
import {
  ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, CartesianGrid, ReferenceLine, Cell,
} from "recharts";
import "leaflet/dist/leaflet.css";
import type { SamplingCampaign, SamplingPoint, InterpolationResult, ManagementZone } from "@shared/schema";

const METHODS = [
  {
    value: "idw",
    label: "IDW",
    subtitle: "Distancia Inversa Ponderada",
    desc: "Funciona con cualquier número de puntos. Cada predicción pondera los valores medidos por la inversa de la distancia.",
    hint: "Recomendado para < 8 puntos o cuando no hay patrón espacial claro.",
    minPoints: 3,
  },
  {
    value: "kriging",
    label: "Kriging",
    subtitle: "Geoestadístico Ordinario",
    desc: "Modela la estructura espacial del suelo con un variograma. Produce estimaciones de incertidumbre (σ) por celda.",
    hint: "Más preciso cuando los datos muestran continuidad espacial. Requiere ≥ 8 puntos.",
    minPoints: 8,
  },
  {
    value: "svr",
    label: "SVR",
    subtitle: "Regresión de Soporte Vectorial",
    desc: "Ajusta una función no lineal (kernel RBF, lineal o polinómico) en el espacio de coordenadas. Auto-calibra el parámetro C por validación cruzada.",
    hint: "Buena alternativa cuando IDW suaviza demasiado o Kriging no converge. Requiere ≥ 5 puntos.",
    minPoints: 5,
  },
];

const TRANSFORMS = [
  { value: "auto", label: "Auto", desc: "Detecta sesgo automáticamente (log1p si sesgo>1, sqrt si sesgo>0.5)" },
  { value: "none", label: "Sin transformar", desc: "Datos originales (sin transformación de distribución)" },
  { value: "log1p", label: "Log(x+1)", desc: "Logarítmica — recomendada para sesgo alto (>1)" },
  { value: "sqrt", label: "Raíz cuadrada", desc: "Suaviza sesgo moderado (0.5–1.0)" },
  { value: "boxcox", label: "Box-Cox", desc: "Transformación óptima — estima λ por máxima verosimilitud" },
];

const ZONE_COLORS = ["#d73027", "#fdae61", "#a6d96a", "#1a9850", "#2166ac"];
const ZONE_LABELS = ["Zona Baja", "Zona Media-Baja", "Zona Media", "Zona Media-Alta", "Zona Alta"];

const KRIGING_VARIOGRAM_MODELS = [
  { value: "auto", label: "Auto (LOOCV)" },
  { value: "spherical", label: "Esférico" },
  { value: "exponential", label: "Exponencial" },
  { value: "gaussian", label: "Gaussiano" },
  { value: "power", label: "Potencia" },
];

interface VariogramLag { h: number; gamma: number; gamma_fit?: number; }
interface VariogramData {
  model: string | null;
  range: string | null;
  sill: string | null;
  nugget: string | null;
  lags: VariogramLag[];
  rmse: string | null;
  mae: string | null;
  r2: string | null;
}

interface ComparisonEntry {
  id: string;
  method: string;
  rmseCv: string | null;
  maeCv: string | null;
  r2Cv: string | null;
  variogramModel: string | null;
  createdAt: string;
  isFallback?: boolean;
  fallbackReason?: string | null;
}

interface LoocvResidual {
  original_index?: number;
  excluded?: boolean;
  lat: number;
  lon: number;
  actual: number;
  predicted: number;
  error: number;
  pointId?: string;
}

interface CovariateInfo {
  selected: string[];
  pearson_r: Record<string, number>;
  fallback: boolean;
  fallback_reason?: string;
}

interface RunResult {
  interpolation?: InterpolationResult;
  method?: string;
  zones: ManagementZone[];
  metrics?: { rmse?: number; mae?: number; r2?: number; r2_loocv?: number; msdr?: number; kriging_msdr?: number; mse_ratio?: number; variogram?: FittedVariogram; params?: Record<string, unknown> };
  warnings?: (string | { code: string; message: string; indices?: number[] })[];
  grid_stats?: { min?: number; max?: number; mean?: number; std?: number };
  raster_png_b64?: string;
  raster_url?: string;
  raster_vmin?: number;
  raster_vmax?: number;
  display_vmin?: number;
  display_vmax?: number;
  near_constant_grid?: boolean;
  loocv_residuals?: LoocvResidual[];
  transform_type?: string;
  transform_shift?: number;
  transform_lambda?: number | null;
  covariate_info?: CovariateInfo | null;
  input_stats?: { n: number; min: number; max: number; mean: number; std: number; range: number; cv_pct: number } | null;
  low_variance_warning?: string | null;
}

interface TransformDiagnostic {
  name: string;       // "none" | "sqrt" | "log1p" | "boxcox"
  skewness: number;
  feasible: boolean;
}
interface TransformRecommendation {
  suggested: string;
  needs_transform: boolean;
  reason: string;
}
interface DiagnosisResult {
  n: number;
  mean: number;
  std: number;
  min: number;
  max: number;
  median: number;
  q1: number;
  q3: number;
  iqr: number;
  has_non_positive: boolean;
  cv_pct: number;
  skewness: number;
  skewness_level: "low" | "moderate" | "high";
  outlier_count: number;
  outlier_pct: number;
  nn_ratio: number | null;
  clustering_level: "good" | "moderate" | "clustered";
  zero_variance: boolean;
  duplicate_coords: boolean;
  duplicate_point_pairs?: number[][];
  duplicate_point_ids?: string[][];
  recommended_transform: string;
  recommended_method: string;
  transform_recommendation: TransformRecommendation;
  transform_diagnostics: TransformDiagnostic[];
  warnings: string[];
  ok_to_interpolate: boolean;
}

function clientBackTransform(val: number, transformType: string, shift: number, lam: number): number {
  if (transformType === "log1p") return Math.exp(val) - 1 - shift;
  if (transformType === "sqrt") return Math.max(val, 0) ** 2 - shift;
  if (transformType === "boxcox") {
    if (Math.abs(lam) < 1e-9) return Math.exp(val) - shift;
    const inner = val * lam + 1;
    return (inner > 0 ? inner ** (1 / lam) : 0) - shift;
  }
  return val;
}

function haversineDistM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pointInPolygon(lat: number, lon: number, polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

interface SuggestedPoint { lat: number; lon: number; score: number; }
interface UncertaintyCell { lat: number; lon: number; value: number; }

function computeSuggestedPoints(
  residuals: LoocvResidual[],
  existing: { lat: number; lon: number }[],
  polygon: [number, number][],
  n: number,
): SuggestedPoint[] {
  if (polygon.length < 3 || existing.length === 0) return [];

  // Build candidate grid inside polygon bounding box
  const lats = polygon.map(p => p[0]);
  const lons = polygon.map(p => p[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const GRID = 25;
  const candidates: { lat: number; lon: number }[] = [];
  for (let i = 0; i <= GRID; i++) {
    for (let j = 0; j <= GRID; j++) {
      const lat = minLat + (i / GRID) * (maxLat - minLat);
      const lon = minLon + (j / GRID) * (maxLon - minLon);
      if (pointInPolygon(lat, lon, polygon)) candidates.push({ lat, lon });
    }
  }
  if (candidates.length === 0) return [];

  // Pre-compute max abs error for normalization
  const maxErr = Math.max(...residuals.map(r => Math.abs(r.error)), 1e-9);

  // Compute per-candidate error weight (IDW of LOOCV errors)
  function errorWeight(lat: number, lon: number): number {
    if (residuals.length === 0) return 0;
    let sumW = 0, sumWE = 0;
    for (const r of residuals) {
      const d = Math.max(1, haversineDistM(lat, lon, r.lat, r.lon));
      const w = 1 / (d * d);
      sumW += w;
      sumWE += w * Math.abs(r.error);
    }
    return sumW > 0 ? sumWE / sumW : 0;
  }

  // Greedy farthest-point sampling weighted by error
  const selected: SuggestedPoint[] = [];
  const pool = [...existing];
  const used = new Set<number>();

  for (let s = 0; s < n; s++) {
    let bestIdx = -1, bestScore = -1;
    for (let c = 0; c < candidates.length; c++) {
      if (used.has(c)) continue;
      const { lat, lon } = candidates[c];
      const minDist = Math.min(...pool.map(p => haversineDistM(lat, lon, p.lat, p.lon)));
      const ew = errorWeight(lat, lon);
      const score = minDist * (1 + ew / maxErr);
      if (score > bestScore) { bestScore = score; bestIdx = c; }
    }
    if (bestIdx < 0) break;
    used.add(bestIdx);
    const pt = candidates[bestIdx];
    selected.push({ ...pt, score: bestScore });
    pool.push(pt);
  }
  return selected;
}

function polygonAreaHa(polygon: [number, number][]): number {
  if (polygon.length < 3) return 0;
  const R = 6371000;
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    const lat1 = (polygon[i][0] * Math.PI) / 180;
    const lat2 = (polygon[j][0] * Math.PI) / 180;
    const dLon = ((polygon[j][1] - polygon[i][1]) * Math.PI) / 180;
    area += dLon * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  return Math.abs(area * R * R * 0.5) / 10000; // m² to ha
}

function computeUncertaintyGrid(
  residuals: LoocvResidual[],
  existing: { lat: number; lon: number }[],
  polygon: [number, number][],
): UncertaintyCell[] {
  if (polygon.length < 3 || residuals.length === 0) return [];
  const lats = polygon.map(p => p[0]);
  const lons = polygon.map(p => p[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const GRID = 15;
  const maxErr = Math.max(...residuals.map(r => Math.abs(r.error)), 1e-9);
  const maxDist = existing.length > 0
    ? Math.max(...existing.flatMap(p => existing.map(q => haversineDistM(p.lat, p.lon, q.lat, q.lon))))
    : 1;
  const cells: UncertaintyCell[] = [];
  for (let i = 0; i <= GRID; i++) {
    for (let j = 0; j <= GRID; j++) {
      const lat = minLat + (i / GRID) * (maxLat - minLat);
      const lon = minLon + (j / GRID) * (maxLon - minLon);
      if (!pointInPolygon(lat, lon, polygon)) continue;
      // IDW of |error| from residuals
      let sumW = 0, sumWE = 0;
      for (const r of residuals) {
        const d = Math.max(1, haversineDistM(lat, lon, r.lat, r.lon));
        const w = 1 / (d * d);
        sumW += w; sumWE += w * Math.abs(r.error);
      }
      const errComponent = sumW > 0 ? sumWE / sumW / maxErr : 0;
      // Distance to nearest existing point (coverage gap)
      const minDist = existing.length > 0
        ? Math.min(...existing.map(p => haversineDistM(lat, lon, p.lat, p.lon)))
        : 0;
      const distComponent = maxDist > 0 ? minDist / maxDist : 0;
      cells.push({ lat, lon, value: Math.min(1, 0.5 * errComponent + 0.5 * distComponent) });
    }
  }
  return cells;
}

function FitBounds({ coords }: { coords: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (coords.length > 0) map.fitBounds(coords, { padding: [30, 30] });
  }, [coords, map]);
  return null;
}

export default function ParcelInterpolation() {
  const { id } = useParams<{ id: string }>();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const preselected = new URLSearchParams(search).get("campaign") ?? "";
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>(preselected);
  const [method, setMethod] = useState("idw");
  const [nZones, setNZones] = useState("3");
  const [opacity, setOpacity] = useState(0.75);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [clientRasterSrc, setClientRasterSrc] = useState<string | null>(null);
  const [clientVminmax, setClientVminmax] = useState<[number, number] | null>(null);
  const [loocvResiduals, setLoocvResiduals] = useState<LoocvResidual[]>([]);
  const [showResiduals, setShowResiduals] = useState(true);
  const [showConfidenceMap, setShowConfidenceMap] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [diagnosisOpen, setDiagnosisOpen] = useState(true);
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  const [winsorize, setWinsorize] = useState(false);
  const [transform, setTransform] = useState("auto");
  const [rerunResult, setRerunResult] = useState<{ rmse?: number; mae?: number; r2?: number } | null>(null);
  const [rerunning, setRerunning] = useState(false);
  const requestState = useRef({ sequence: 0, scope: "" });
  const viewScope = `${id}:${selectedCampaignId}:${method}:${transform}`;
  const viewScopeRef = useRef(viewScope);
  viewScopeRef.current = viewScope;
  useEffect(() => {
    if (requestState.current.scope !== viewScope) {
      requestState.current.sequence++;
      setRunning(false);
      setRerunning(false);
      setRerunResult(null);
      setLoocvResiduals([]);
    }
  }, [viewScope]);
  const beginResultRequest = (scope = viewScope) => {
    const sequence = ++requestState.current.sequence;
    requestState.current.scope = scope;
    return () => requestState.current.sequence === sequence && viewScopeRef.current === scope;
  };
  const [geoServiceBannerDismissed, setGeoServiceBannerDismissed] = useState(false);
  const [legacyInterp, setLegacyInterp] = useState(false);

  // Hyperparameter state (null = auto)
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [idwPower, setIdwPower] = useState<number | null>(null);
  const [idwK, setIdwK] = useState<number | null>(null);
  const [krigVariogramModel, setKrigVariogramModel] = useState<string>("auto");
  const [svrKernel, setSvrKernel] = useState<string>("rbf");
  const [svrC, setSvrC] = useState<number | null>(null);
  const [prevRmse, setPrevRmse] = useState<number | null>(null);

  const hasCustomHyperparams =
    idwPower !== null || idwK !== null || krigVariogramModel !== "auto" ||
    svrKernel !== "rbf" || svrC !== null;

  // Adaptive sampling state
  const [adaptiveN, setAdaptiveN] = useState(5);
  const [suggestedPoints, setSuggestedPoints] = useState<SuggestedPoint[] | null>(null);
  const [showAdaptive, setShowAdaptive] = useState(true);
  const [addingAdaptive, setAddingAdaptive] = useState(false);
  const [showUncertainty, setShowUncertainty] = useState(false);
  const [uncertaintyGrid, setUncertaintyGrid] = useState<UncertaintyCell[]>([]);
  const [addedAdaptiveCount, setAddedAdaptiveCount] = useState<number | null>(null);

  const resetHyperparams = () => {
    setIdwPower(null); setIdwK(null);
    setKrigVariogramModel("auto");
    setSvrKernel("rbf"); setSvrC(null);
  };

  // ── Wizard state ────────────────────────────────────────────────────────────
  const [wizardStep, setWizardStep] = useState<0 | 1 | 2 | 3>(0);
  const [diagnosisResult, setDiagnosisResult] = useState<DiagnosisResult | null>(null);
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);
  const [diagnosisError, setDiagnosisError] = useState<string | null>(null);
  const [deletingPointIds, setDeletingPointIds] = useState<string[]>([]);

  const runDiagnosis = async (campaignId: string) => {
    setDiagnosisLoading(true);
    setDiagnosisError(null);
    setDiagnosisResult(null);
    try {
      const r = await fetch(`/api/sampling-campaigns/${campaignId}/diagnose`, {
        method: "POST",
        credentials: "include",
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message ?? "Error en diagnóstico");
      setDiagnosisResult(data);
      if (data.recommended_transform && data.recommended_transform !== "none") {
        setTransform(data.recommended_transform);
      }
      if (data.recommended_method) {
        const rec = data.recommended_method;
        const clamped = METHODS.some(m => m.value === rec)
          ? rec
          : data.n >= 8 ? "kriging" : "idw";
        data.recommended_method = clamped;
        const methodMeta = METHODS.find(m => m.value === clamped);
        if (methodMeta && measuredPoints.length >= methodMeta.minPoints) {
          setMethod(clamped);
        }
      }
    } catch (e: unknown) {
      setDiagnosisError((e as Error).message);
    } finally {
      setDiagnosisLoading(false);
    }
  };

  const runAdaptiveAnalysis = () => {
    const existing = measuredPoints.map(p => ({
      lat: Number(p.latActual ?? p.latPlanned),
      lon: Number(p.lonActual ?? p.lonPlanned),
    }));
    const pts = computeSuggestedPoints(loocvResiduals, existing, polygonCoords, adaptiveN);
    setSuggestedPoints(pts);
    const grid = computeUncertaintyGrid(loocvResiduals, existing, polygonCoords);
    setUncertaintyGrid(grid);
    if (grid.length > 0) setShowUncertainty(true);
  };

  // Uses /points/bulk (multi-point creation API) intentionally — same API as field-capture bulk import
  const addAdaptivePoints = async () => {
    if (!suggestedPoints || !selectedCampaignId) return;
    setAddingAdaptive(true);
    try {
      const maxIdx = points.reduce((acc, p) => Math.max(acc, p.pointIndex), -1);
      const payload = suggestedPoints.map((pt, i) => ({
        latPlanned: pt.lat,
        lonPlanned: pt.lon,
        pointIndex: maxIdx + 1 + i,
        notes: "[ADAPTATIVO] Alta incertidumbre LOOCV",
        nSubsamples: 1,
      }));
      const r = await fetch(`/api/sampling-campaigns/${selectedCampaignId}/points/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ points: payload }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message ?? "Error");
      toast({
        title: `${data.created} puntos adaptativos añadidos`,
        description: "Aparecerán en la captura de campo como puntos pendientes.",
      });
      qc.invalidateQueries({ queryKey: ["sampling-points", selectedCampaignId] });
      setAddedAdaptiveCount(data.created);
      setSuggestedPoints(null);
    } catch (e: unknown) {
      toast({ title: "Error al añadir puntos", description: (e as Error).message, variant: "destructive" });
    } finally {
      setAddingAdaptive(false);
    }
  };

  const { data: campaigns = [] } = useQuery<SamplingCampaign[]>({
    queryKey: ["sampling-campaigns", id],
    queryFn: async () => {
      const r = await fetch(`/api/parcels/${id}/sampling-campaigns`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!id,
  });

  useEffect(() => {
    if (!selectedCampaignId && campaigns.length > 0) {
      const completed = campaigns.find(c => c.status === "completed" || c.status === "interpolated");
      setSelectedCampaignId(completed?.id ?? campaigns[0].id);
    }
  }, [campaigns, selectedCampaignId]);

  const { data: parcel } = useQuery({
    queryKey: ["parcel-mvz", id],
    queryFn: async () => {
      const r = await fetch(`/api/parcels/${id}`, { credentials: "include" });
      if (!r.ok) throw new Error("Error");
      const data = await r.json();
      return data.parcel ?? data;
    },
    enabled: !!id,
  });

  const { data: points = [] } = useQuery<SamplingPoint[]>({
    queryKey: ["sampling-points", selectedCampaignId],
    queryFn: async () => {
      const r = await fetch(`/api/sampling-campaigns/${selectedCampaignId}/points`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!selectedCampaignId,
  });

  const { data: prevInterpolations = [] } = useQuery<InterpolationResult[]>({
    queryKey: ["interpolations", selectedCampaignId],
    queryFn: async () => {
      const r = await fetch(`/api/sampling-campaigns/${selectedCampaignId}/interpolations`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!selectedCampaignId,
  });

  const { data: comparison } = useQuery<{ comparison: ComparisonEntry[]; best: ComparisonEntry | null }>({
    queryKey: ["compare", selectedCampaignId],
    queryFn: async () => {
      const r = await fetch(`/api/sampling-campaigns/${selectedCampaignId}/compare`, { credentials: "include" });
      if (!r.ok) return { comparison: [], best: null };
      return r.json();
    },
    enabled: !!selectedCampaignId && prevInterpolations.length > 0,
  });

  const latestInterpId = runResult?.interpolation?.id ?? prevInterpolations[0]?.id ?? null;

  const { data: historicalVariogramData } = useQuery<VariogramData>({
    queryKey: ["variogram", latestInterpId],
    queryFn: async () => {
      const r = await fetch(`/api/interpolations/${latestInterpId}/variogram`, { credentials: "include" });
      if (!r.ok) throw new Error("Error");
      return r.json();
    },
    enabled: !!latestInterpId && !runResult?.metrics?.variogram,
  });
  const fittedVariogram = runResult?.metrics?.variogram;
  const variogramData = fittedVariogram ? {
    ...fittedVariogram,
    lags: (fittedVariogram.empirical ?? []).map(b => ({ h: b.distance, gamma: b.semivariance, n_pairs: b.n_pairs })),
  } : historicalVariogramData;
  const resultUsesKriging = !!fittedVariogram || (runResult?.method ?? runResult?.interpolation?.method) === "kriging";

  const measuredPoints = useMemo(() => points.filter(p => p.value != null), [points]);
  const completionPct = points.length > 0 ? Math.round((measuredPoints.length / points.length) * 100) : 0;

  /** Per-transform mini histogram bins (6 bars) — computed client-side for Step 1 comparison */
  const transformHistograms = useMemo(() => {
    const rawVals = measuredPoints.map(p => Number(p.value)).filter(v => Number.isFinite(v));
    if (rawVals.length < 3) return null;
    const min = Math.min(...rawVals);
    const applyT = (vals: number[], t: string): number[] | null => {
      try {
        const hasNonPos = vals.some(v => v <= 0);
        const shift = hasNonPos && (t === "log1p" || t === "boxcox") ? Math.abs(min) + 1 : 0;
        const shifted = shift > 0 ? vals.map(v => v + shift) : vals;
        if (t === "none") return rawVals;
        if (t === "sqrt") return shifted.map(v => Math.sqrt(Math.max(v, 0)));
        if (t === "log1p") return shifted.map(v => Math.log1p(v));
        if (t === "boxcox") {
          const lam = 0.2; // reasonable default when backend lambda unavailable client-side
          return shifted.map(v => Math.abs(lam) < 1e-9 ? Math.log(v + 1e-9) : (Math.pow(Math.max(v, 1e-9), lam) - 1) / lam);
        }
        return null;
      } catch { return null; }
    };
    const bins6 = (vals: number[]) => {
      const lo = Math.min(...vals), hi = Math.max(...vals);
      if (hi - lo < 1e-12) return Array(6).fill({ count: vals.length, lo, hi });
      const w = (hi - lo) / 6;
      const b = Array.from({ length: 6 }, (_, i) => ({ lo: lo + i * w, hi: lo + (i + 1) * w, count: 0 }));
      for (const v of vals) b[Math.min(5, Math.floor((v - lo) / w))].count++;
      return b;
    };
    return (["none", "sqrt", "log1p", "boxcox"] as const).map(t => ({
      name: t,
      bins: (() => { const v = applyT(rawVals, t); return v ? bins6(v) : null; })(),
    }));
  }, [measuredPoints]);
  const { ready: interpReady, reasons: interpReasons, geoHealthy, geoChecking } = useInterpolationReadiness(measuredPoints);

  // Auto-reset wizard step and clear state when campaign changes
  useEffect(() => {
    if (!selectedCampaignId) return;
    setWizardStep(0);
    setDiagnosisResult(null);
    setDiagnosisError(null);
    setRunResult(null);
  }, [selectedCampaignId]);

  // Auto-run diagnosis when we have enough points and no result yet
  // (diagnosisResult in the dep array ensures we re-run after a campaign reset clears it)
  useEffect(() => {
    if (selectedCampaignId && measuredPoints.length >= 3 && !diagnosisResult && !diagnosisLoading) {
      runDiagnosis(selectedCampaignId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCampaignId, measuredPoints.length, diagnosisResult]);

  const polygonCoords = useMemo((): [number, number][] => {
    if (!Array.isArray(parcel?.polygonCoordinates)) return [];
    return parcel.polygonCoordinates as [number, number][];
  }, [parcel]);

  const mapBounds = useMemo((): [[number, number], [number, number]] | undefined => {
    if (polygonCoords.length < 2) return undefined;
    const lats = polygonCoords.map(p => p[0]);
    const lngs = polygonCoords.map(p => p[1]);
    return [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]];
  }, [polygonCoords]);

  const rasterSrc = useMemo(() => {
    if (runResult?.raster_url) return runResult.raster_url;
    if (runResult?.raster_png_b64) return `data:image/png;base64,${runResult.raster_png_b64}`;
    return clientRasterSrc;
  }, [runResult, clientRasterSrc]);

  // F1-05: Confidence raster — build from kriging_std_grid stored in paramsJson
  const confidenceRasterSrc = useMemo((): string | null => {
    const p = runResult?.interpolation?.paramsJson as Record<string, unknown> | null | undefined;
    const grid = p?.kriging_std_grid as number[][] | null | undefined;
    if (!grid || !Array.isArray(grid) || grid.length === 0) return null;
    try {
      const H = grid.length;
      const W = grid[0].length;
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      const imgData = ctx.createImageData(W, H);
      // Find min/max (ignoring nulls)
      let vMin = Infinity, vMax = -Infinity;
      for (const row of grid) {
        for (const v of row) {
          if (v != null && Number.isFinite(v)) {
            if (v < vMin) vMin = v;
            if (v > vMax) vMax = v;
          }
        }
      }
      const vRange = vMax - vMin;
      for (let r = 0; r < H; r++) {
        for (let c = 0; c < W; c++) {
          const idx = (r * W + c) * 4;
          const v = grid[r][c];
          if (v == null || !Number.isFinite(v) || vRange < 1e-12) {
            imgData.data[idx + 3] = 0;
            continue;
          }
          const t = (v - vMin) / vRange;
          // Blues scale: low std = deep blue (confident), high std = light (uncertain)
          const r_ = Math.round(5 + t * 240);
          const g_ = Math.round(48 + t * 200);
          const b_ = Math.round(97 + t * 150);
          imgData.data[idx] = r_;
          imgData.data[idx + 1] = g_;
          imgData.data[idx + 2] = b_;
          imgData.data[idx + 3] = 200;
        }
      }
      ctx.putImageData(imgData, 0, 0);
      return canvas.toDataURL("image/png");
    } catch {
      return null;
    }
  }, [runResult]);

  useEffect(() => {
    setClientRasterSrc(null);
    setClientVminmax(null);
    if (!runResult) return;
    if (runResult.raster_url || runResult.raster_png_b64) return;
    if (measuredPoints.length < 3) return;
    if (polygonCoords.length < 3 || !mapBounds) return;

    const W = 80, H = 80;
    const [[minLat, minLng], [maxLat, maxLng]] = mapBounds;

    const pts = measuredPoints.map(p => ({
      pointId: p.id,
      lat: sampleCoordinates(p).lat,
      lng: sampleCoordinates(p).lon,
      v: Number(p.value),
    })).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Number.isFinite(p.v));
    if (pts.length < 3) return;
    const vVals = pts.map(p => p.v);
    const vMin = Math.min(...vVals);
    const vMax = Math.max(...vVals);

    const colorStops: [number, number, number][] = [
      [215, 48, 39], [244, 109, 67], [253, 174, 97], [255, 255, 191], [166, 217, 106], [26, 152, 80],
    ];
    function lerpColor(t: number): [number, number, number] {
      const c = Math.max(0, Math.min(1, t));
      const n = colorStops.length - 1;
      const idx = c * n;
      const lo = Math.floor(idx);
      const hi = Math.min(lo + 1, n);
      const f = idx - lo;
      const [r1, g1, b1] = colorStops[lo];
      const [r2, g2, b2] = colorStops[hi];
      return [Math.round(r1 + f * (r2 - r1)), Math.round(g1 + f * (g2 - g1)), Math.round(b1 + f * (b2 - b1))];
    }

    function pipLatLng(lat: number, lng: number, poly: [number, number][]): boolean {
      let inside = false;
      const n = poly.length;
      let j = n - 1;
      for (let i = 0; i < n; i++) {
        const [yi, xi] = poly[i];
        const [yj, xj] = poly[j];
        if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
        j = i;
      }
      return inside;
    }

    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = ctx.createImageData(W, H);
    for (let row = 0; row < H; row++) {
      for (let col = 0; col < W; col++) {
        const lat = maxLat - (row + 0.5) / H * (maxLat - minLat);
        const lng = minLng + (col + 0.5) / W * (maxLng - minLng);
        const pidx = (row * W + col) * 4;
        if (!pipLatLng(lat, lng, polygonCoords)) {
          img.data[pidx + 3] = 0;
          continue;
        }
        let num = 0, den = 0;
        for (const pt of pts) {
          const dlat = lat - pt.lat;
          const dlng = lng - pt.lng;
          const d2 = dlat * dlat + dlng * dlng;
          if (d2 < 1e-16) { num = pt.v; den = 1; break; }
          const w = 1 / d2;
          num += w * pt.v;
          den += w;
        }
        const v = num / den;
        const t = vMax === vMin ? 0.5 : (v - vMin) / (vMax - vMin);
        const [r, g, b] = lerpColor(t);
        img.data[pidx] = r;
        img.data[pidx + 1] = g;
        img.data[pidx + 2] = b;
        img.data[pidx + 3] = 200;
      }
    }
    ctx.putImageData(img, 0, 0);
    setClientRasterSrc(canvas.toDataURL("image/png"));
    setClientVminmax([vMin, vMax]);
  }, [runResult, measuredPoints, polygonCoords, mapBounds]);

  const histogramData = useMemo(() => {
    const vals = measuredPoints.map(p => Number(p.value));
    if (vals.length === 0) return [];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min;
    if (range === 0) return [{ bin: min.toFixed(2), count: vals.length }];
    const bins = Math.min(8, vals.length);
    const step = range / bins;
    const counts = Array(bins).fill(0);
    vals.forEach(v => {
      const idx = Math.min(Math.floor((v - min) / step), bins - 1);
      counts[idx]++;
    });
    return counts.map((count, i) => ({
      bin: `${(min + i * step).toFixed(2)}`,
      count,
    }));
  }, [measuredPoints]);

  const variogramChartData = useMemo(() => {
    if (!resultUsesKriging) return [];
    if (!variogramData?.lags) return [];
    return (variogramData.lags as VariogramLag[]).map(l => ({
      h: l.h, gamma: l.gamma, n_pairs: (l as VariogramLag & { n_pairs?: number }).n_pairs,
      fitted: l.gamma_fit,
    }));
  }, [variogramData, resultUsesKriging]);

  const variogramFittedData = useMemo(
    () => fittedVariogram ? variogramCurve(fittedVariogram) : variogramChartData.filter(d => d.fitted != null).map(d => ({ h: d.h, gamma: d.fitted })),
    [variogramChartData, fittedVariogram],
  );

  const zoneBarData = useMemo(
    () =>
      (runResult?.zones ?? []).map((z: ManagementZone, i: number) => ({
        name: z.zoneLabel ?? ZONE_LABELS[z.zoneIndex] ?? `Zona ${i + 1}`,
        mean: z.valueMean != null ? Number(z.valueMean) : 0,
        area: z.areaHa != null ? Number(z.areaHa) : 0,
        fill: z.colorHex ?? ZONE_COLORS[i] ?? "#888",
      })),
    [runResult],
  );

  const dataQuality = useMemo(() => {
    const vals = measuredPoints.map(p => Number(p.value));
    if (vals.length < 3) return null;
    const sorted = [...vals].sort((a, b) => a - b);
    const q1 = linearQuantile(sorted, .25);
    const q3 = linearQuantile(sorted, .75);
    const iqr = q3 - q1;
    const outlierCount = vals.filter(v => v < q1 - 3 * iqr || v > q3 + 3 * iqr).length;
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const std = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
    const cv = mean !== 0 ? (std / Math.abs(mean)) * 100 : 0;
    const pts = measuredPoints.map(p => ({
      lat: sampleCoordinates(p).lat,
      lng: sampleCoordinates(p).lon,
    })).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    let nnRatio: number | null = null;
    if (pts.length >= 3 && polygonCoords.length >= 3) {
      let totalNN = 0;
      for (const pt of pts) {
        let minD = Infinity;
        for (const other of pts) {
          if (pt === other) continue;
          const dlat = (pt.lat - other.lat) * 111320;
          const dlng = (pt.lng - other.lng) * 111320 * Math.cos((pt.lat * Math.PI) / 180);
          const d = Math.sqrt(dlat * dlat + dlng * dlng);
          if (d < minD) minD = d;
        }
        totalNN += minD;
      }
      const observedMean = totalNN / pts.length;
      const lats = polygonCoords.map(p => p[0]);
      const lngs = polygonCoords.map(p => p[1]);
      const areaLat = (Math.max(...lats) - Math.min(...lats)) * 111320;
      const midLat = (Math.max(...lats) + Math.min(...lats)) / 2;
      const areaLng = (Math.max(...lngs) - Math.min(...lngs)) * 111320 * Math.cos((midLat * Math.PI) / 180);
      const areaM2 = areaLat * areaLng;
      if (areaM2 > 0) {
        const density = pts.length / areaM2;
        const expectedMean = 1 / (2 * Math.sqrt(density));
        nnRatio = observedMean / expectedMean;
      }
    }
    // 6-bin histogram with quartile-based coloring
    const vmin = Math.min(...vals);
    const vmax = Math.max(...vals);
    const range = vmax - vmin;
    const sorted2 = [...vals].sort((a, b) => a - b);
    const q1Val = linearQuantile(sorted2, .25);
    const q2Val = sorted2[Math.floor(vals.length * 0.50)];
    const q3Val = linearQuantile(sorted2, .75);
    const histBins = range > 1e-9 ? Array.from({ length: 6 }, (_, i) => {
      const lo = vmin + i * range / 6;
      const hi = vmin + (i + 1) * range / 6;
      const mid = (lo + hi) / 2;
      const count = vals.filter(v => v >= lo && (i === 5 ? v <= hi : v < hi)).length;
      let color = "#a6d96a";
      if (mid < q1Val) color = "#d73027";
      else if (mid < q2Val) color = "#fdae61";
      else if (mid < q3Val) color = "#a6d96a";
      else color = "#1a9850";
      return { lo: lo.toFixed(2), hi: hi.toFixed(2), count, color };
    }) : [];

    // Skewness (Pearson's moment coefficient)
    const skewMean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const skewM3 = vals.reduce((s, v) => s + (v - skewMean) ** 3, 0) / vals.length;
    const skewM2 = vals.reduce((s, v) => s + (v - skewMean) ** 2, 0) / vals.length;
    const skewness = skewM2 > 1e-12 ? skewM3 / Math.pow(skewM2, 1.5) : 0;

    // Non-positive values flag (affects log-based transforms)
    const minVal = Math.min(...vals);
    const hasNonPositive = minVal <= 0;
    const shift = Math.max(0, -minVal + 1e-3);

    // Client-side Box-Cox λ estimation via brute-force MLE over [-2, 2]
    const computeBoxCoxLam = (v: number[]): number => {
      const sv = v.map(x => x + shift); // shift to positive
      const logSum = sv.reduce((s, x) => s + Math.log(x), 0);
      let bestLam = 0;
      let bestLL = -Infinity;
      for (let lam = -2; lam <= 2.001; lam += 0.05) {
        const tv = Math.abs(lam) < 1e-6 ? sv.map(x => Math.log(x)) : sv.map(x => (Math.pow(x, lam) - 1) / lam);
        const tm = tv.reduce((s, x) => s + x, 0) / tv.length;
        const tvar = tv.reduce((s, x) => s + (x - tm) ** 2, 0) / tv.length;
        if (tvar <= 1e-12) continue;
        const ll = -(tv.length / 2) * Math.log(tvar) + (lam - 1) * logSum;
        if (ll > bestLL) { bestLL = ll; bestLam = lam; }
      }
      return bestLam;
    };

    // Compute the Box-Cox lambda once (only if boxcox transform is active)
    const boxCoxLam = (transform === "boxcox") ? computeBoxCoxLam(vals) : 0;

    // Helper to apply the selected transform to a single value
    const applyTransform = (v: number, t: string): number => {
      if (t === "log1p") return Math.log1p(v + shift);
      if (t === "sqrt") return Math.sqrt(Math.max(0, v + shift));
      if (t === "boxcox") {
        const sv = v + shift;
        return Math.abs(boxCoxLam) < 1e-6 ? Math.log(sv) : (Math.pow(sv, boxCoxLam) - 1) / boxCoxLam;
      }
      return v;
    };

    // Compute skewness AFTER the selected transform (client-side preview)
    let transformedSkewness: number | null = null;
    const computeSkew = (tv: number[]) => {
      const tm = tv.reduce((s, v) => s + v, 0) / tv.length;
      const tm3 = tv.reduce((s, v) => s + (v - tm) ** 3, 0) / tv.length;
      const tm2 = tv.reduce((s, v) => s + (v - tm) ** 2, 0) / tv.length;
      return tm2 > 1e-12 ? tm3 / Math.pow(tm2, 1.5) : 0;
    };

    // Determine the effective transform for "auto" mode (mirrors server's positive-skew-only logic)
    const autoEffectiveTransform = skewness > 1.0 ? "log1p" : skewness > 0.5 ? "sqrt" : "none";

    if (transform === "log1p" || transform === "sqrt" || transform === "boxcox") {
      transformedSkewness = computeSkew(vals.map(v => applyTransform(v, transform)));
    } else if (transform === "auto" && autoEffectiveTransform !== "none") {
      transformedSkewness = computeSkew(vals.map(v => applyTransform(v, autoEffectiveTransform)));
    }

    // Histogram bins using the selected transform (for preview)
    // For "auto", show the transform that would actually be applied by the server
    let transformedHistBins: { bin: string; count: number; color: string }[] = [];
    const histTransform = transform === "auto" ? autoEffectiveTransform : transform;
    if (histTransform !== "none") {
      const tv = vals.map(v => applyTransform(v, histTransform));
      const tmin = Math.min(...tv);
      const tmax = Math.max(...tv);
      const trange = tmax - tmin;
      if (trange > 1e-9 && tv.length >= 3) {
        const nbins = Math.min(6, tv.length);
        const step = trange / nbins;
        const tcounts = Array(nbins).fill(0);
        tv.forEach(v => { const idx = Math.min(Math.floor((v - tmin) / step), nbins - 1); tcounts[idx]++; });
        const sortedTv = [...tv].sort((a, b) => a - b);
        const tq1 = linearQuantile(sortedTv, .25);
        const tq3 = linearQuantile(sortedTv, .75);
        transformedHistBins = tcounts.map((count, i) => {
          const lo = tmin + i * step;
          const hi = tmin + (i + 1) * step;
          const mid = (lo + hi) / 2;
          let color = "#a6d96a";
          if (mid < tq1) color = "#d73027";
          else if (mid < (tq1 + tq3) / 2) color = "#fdae61";
          else if (mid < tq3) color = "#a6d96a";
          else color = "#1a9850";
          return { bin: `${lo.toFixed(2)}`, count, color };
        });
      }
    }

    return { outlierCount, cv: Math.round(cv * 10) / 10, n: vals.length, nnRatio: nnRatio !== null ? Math.round(nnRatio * 100) / 100 : null, histBins, std, range, skewness: Math.round(skewness * 100) / 100, transformedSkewness: transformedSkewness !== null ? Math.round(transformedSkewness * 100) / 100 : null, transformedHistBins, hasNonPositive, boxCoxLam: Math.round(boxCoxLam * 1000) / 1000 };
  }, [measuredPoints, polygonCoords, transform]);

  const computeClientLoocv = (): LoocvResidual[] => {
    const pts = measuredPoints.map(p => ({
      pointId: p.id,
      lat: sampleCoordinates(p).lat,
      lng: sampleCoordinates(p).lon,
      v: Number(p.value),
    })).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Number.isFinite(p.v));
    if (pts.length < 3) return [];
    return pts.map((pt, i) => {
      const rest = pts.filter((_, j) => j !== i);
      let num = 0, den = 0;
      for (const r of rest) {
        const dlat = (pt.lat - r.lat) * 111320;
        const dlng = (pt.lng - r.lng) * 111320 * Math.cos((pt.lat * Math.PI) / 180);
        const d2 = dlat * dlat + dlng * dlng;
        if (d2 < 1e-10) { num = r.v; den = 1; break; }
        const w = 1 / d2;
        num += w * r.v;
        den += w;
      }
      const predicted = den > 0 ? num / den : pt.v;
      return { lat: pt.lat, lon: pt.lng, actual: pt.v, predicted, error: pt.v - predicted, pointId: pt.pointId };
    });
  };

  const selectedCampaign = campaigns.find(c => c.id === selectedCampaignId);

  const runInterpolation = async (methodOverride?: string) => {
    if (!selectedCampaignId) return;
    // Guard: event objects (from bare onClick={runInterpolation}) must not be
    // treated as the method override — only accept plain strings.
    const safeOverride = typeof methodOverride === "string" ? methodOverride : undefined;
    const activeMethod = safeOverride ?? method;
    if (safeOverride && safeOverride !== method) setMethod(safeOverride);
    // Client-side guard: if points dropped below the method's minimum after
    // selection, block the request and prompt a method switch (backend rejects
    // too, but this avoids a round-trip and gives cleaner UX).
    const methodMeta = METHODS.find(m => m.value === activeMethod);
    if (methodMeta && measuredPoints.length < methodMeta.minPoints) {
      toast({
        title: "Método no disponible",
        description: `${methodMeta.label} requiere ≥ ${methodMeta.minPoints} puntos medidos (tienes ${measuredPoints.length}). Cambia a IDW o agrega más puntos.`,
        variant: "destructive",
      });
      return;
    }
    const isCurrentRequest = beginResultRequest(`${id}:${selectedCampaignId}:${activeMethod}:${transform}`);
    setPrevRmse(runResult?.metrics?.rmse ?? null);
    setSuggestedPoints(null);
    setUncertaintyGrid([]);
    setAddedAdaptiveCount(null);
    setLegacyInterp(false);
    setRunning(true);
    setRunResult(null);
    setRerunResult(null);
    setExcludedIds(new Set());
    try {
      const body: Record<string, unknown> = { method: activeMethod, n_zones: Number(nZones), transform };
      if (activeMethod === "idw") {
        if (idwPower !== null) body.power = idwPower;
        if (idwK !== null) body.k = idwK;
      } else if (activeMethod === "kriging") {
        if (krigVariogramModel !== "auto") body.variogram_model = krigVariogramModel;
      } else if (activeMethod === "svr") {
        body.svr_kernel = svrKernel;
        if (svrC !== null) body.svr_C = svrC;
      }
      const r = await fetch(`/api/sampling-campaigns/${selectedCampaignId}/interpolate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!isCurrentRequest()) return;
      if (!r.ok) throw new Error(data.message ?? "Error");
      // Defensive: ensure zones is always an array to avoid render crashes if
      // the server response is missing the field (e.g. DB error swallowed).
      const safeZones = normalizeMvzZones(data.zones);
      setRunResult({
        ...(data as RunResult),
        zones: safeZones,
        raster_vmin: typeof data.raster_vmin === "number" ? data.raster_vmin : undefined,
        raster_vmax: typeof data.raster_vmax === "number" ? data.raster_vmax : undefined,
        // display_vmin/vmax are server-side back-transform of raster_vmin/vmax → original units for legend
        display_vmin: typeof data.display_vmin === "number" ? data.display_vmin : undefined,
        display_vmax: typeof data.display_vmax === "number" ? data.display_vmax : undefined,
        transform_type: typeof data.transform_type === "string" ? data.transform_type : undefined,
        transform_shift: typeof data.transform_shift === "number" ? data.transform_shift : undefined,
        transform_lambda: typeof data.transform_lambda === "number" ? data.transform_lambda : null,
      });
      if (Array.isArray(data.loocv_residuals) && data.loocv_residuals.length > 0) {
        const residualsWithIds = associateResiduals(data.loocv_residuals as LoocvResidual[], measuredPoints);
        setLoocvResiduals(residualsWithIds);
      } else {
        setLoocvResiduals(computeClientLoocv());
      }
      qc.invalidateQueries({ queryKey: ["interpolations", selectedCampaignId] });
      qc.invalidateQueries({ queryKey: ["compare", selectedCampaignId] });
      qc.invalidateQueries({ queryKey: ["sampling-campaigns", id] });
      toast({ title: "Interpolación completada", description: `${safeZones.length} zonas generadas` });
      setWizardStep(3);
    } catch (e: unknown) {
      if (!isCurrentRequest()) return;
      console.error("[interpolation] failed:", e);
      toast({ title: "Error de interpolación", description: (e as Error).message ?? "Error desconocido", variant: "destructive" });
    } finally {
      if (isCurrentRequest()) setRunning(false);
    }
  };

  const handleGoToZones = () => {
    const interpId = runResult?.interpolation?.id ?? prevInterpolations[0]?.id;
    if (interpId) {
      setLocation(`/parcel/${id}/zones?interpolation=${interpId}`);
    }
  };

  // Compute outlier point IDs from measured values using IQR method
  const outlierPointIds = useMemo((): Set<string> => {
    if (!measuredPoints.length) return new Set();
    const vals = measuredPoints.map(p => Number(p.value));
    const sorted = [...vals].sort((a, b) => a - b);
    const n = sorted.length;
    const q1 = linearQuantile(sorted, .25);
    const q3 = linearQuantile(sorted, .75);
    const iqr = q3 - q1;
    const lo = q1 - 3 * iqr;
    const hi = q3 + 3 * iqr;
    const ids = new Set<string>();
    measuredPoints.forEach((p, _i) => { if (Number(p.value) < lo || Number(p.value) > hi) ids.add(p.id); });
    return ids;
  }, [measuredPoints]);

  // Compute winsorization info for the pre-flight panel
  const winsorizeInfo = useMemo(() => {
    if (!measuredPoints.length) return null;
    const vals = measuredPoints.map(p => Number(p.value));
    const sorted = [...vals].sort((a, b) => a - b);
    const n = sorted.length;
    const q1 = linearQuantile(sorted, .25);
    const q3 = linearQuantile(sorted, .75);
    const iqr = q3 - q1;
    const lo = q1 - 3 * iqr;
    const hi = q3 + 3 * iqr;
    const clampedCount = vals.filter(v => v < lo || v > hi).length;
    return { clampedCount, lo: lo.toFixed(3), hi: hi.toFixed(3) };
  }, [measuredPoints]);

  const runRerun = async () => {
    const isCurrentRequest = beginResultRequest();
    if (!polygonCoords.length) return;
    setRerunning(true);
    setRerunResult(null);
    try {
      let pts = measuredPoints
        .filter(p => !excludedIds.has(p.id))
        .map(p => ({
          lat: sampleCoordinates(p).lat,
          lon: sampleCoordinates(p).lon,
          value: Number(p.value),
        }))
        .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Number.isFinite(p.value));
      if (pts.length < 3) {
        toast({ title: "Pocos puntos", description: "Se necesitan al menos 3 puntos para interpolar.", variant: "destructive" });
        return;
      }
      if (winsorize) {
        const vals = pts.map(p => p.value);
        const sorted = [...vals].sort((a, b) => a - b);
        const n = sorted.length;
        const q1 = linearQuantile(sorted, .25);
        const q3 = linearQuantile(sorted, .75);
        const iqr = q3 - q1;
        const lo = q1 - 3 * iqr;
        const hi = q3 + 3 * iqr;
        pts = pts.map(p => ({ ...p, value: Math.min(hi, Math.max(lo, p.value)) }));
      }
      const polygon = polygonCoords.map(([lat, lng]) => [lng, lat]);
      const body = { points: pts, method, polygon, resolution: 80, transform };

      setPrevRmse(runResult?.metrics?.rmse ?? null);

      const r = await fetch("/api/geo/interpolate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!isCurrentRequest()) return;
      if (!r.ok) throw new Error(data.detail ?? data.message ?? "Error en re-run");

      const safeZones = normalizeMvzZones(data.zones);
      setRunResult({
        ...(data as RunResult),
        interpolation:   runResult?.interpolation,
        zones: safeZones,
        raster_vmin:     typeof data.raster_vmin === "number" ? data.raster_vmin : undefined,
        raster_vmax:     typeof data.raster_vmax === "number" ? data.raster_vmax : undefined,
        display_vmin:    typeof data.display_vmin === "number" ? data.display_vmin : undefined,
        display_vmax:    typeof data.display_vmax === "number" ? data.display_vmax : undefined,
        transform_type:  typeof data.transform_type === "string" ? data.transform_type : undefined,
        transform_shift: typeof data.transform_shift === "number" ? data.transform_shift : undefined,
        transform_lambda: typeof data.transform_lambda === "number" ? data.transform_lambda : null,
      });
      setRerunResult({
        rmse: data.metrics?.rmse,
        mae: data.metrics?.mae,
        r2: data.metrics?.r2_loocv ?? data.metrics?.r2,
      });
      if (Array.isArray(data.loocv_residuals) && data.loocv_residuals.length > 0) {
        const filteredPoints = measuredPoints.filter(p => !excludedIds.has(p.id)).filter(p => {
          const c = sampleCoordinates(p);
          return Number.isFinite(c.lat) && Number.isFinite(c.lon) && Number.isFinite(Number(p.value));
        });
        const residualsWithIds = associateResiduals(data.loocv_residuals as LoocvResidual[], filteredPoints);
        setLoocvResiduals(residualsWithIds);
      }
      toast({ title: "Re-run completado", description: `${pts.length} puntos procesados` });
    } catch (e: unknown) {
      if (!isCurrentRequest()) return;
      toast({ title: "Error en re-run", description: (e as Error).message, variant: "destructive" });
    } finally {
      if (isCurrentRequest()) setRerunning(false);
    }
  };

  const loadSavedInterp = async (interp: InterpolationResult) => {
    const isCurrentRequest = beginResultRequest();
    try {
      const r = await fetch(`/api/interpolations/${interp.id}`, { credentials: "include" });
      if (!r.ok) throw new Error("Error al cargar interpolación");
      const data = await r.json();
      if (!isCurrentRequest()) return;
      const loadedZones: ManagementZone[] = data.zones ?? [];
      const savedParams = (interp.paramsJson ?? {}) as Record<string, unknown>;
      const savedB64 = typeof savedParams.raster_png_b64 === "string" ? savedParams.raster_png_b64 : undefined;
      const savedGridStats = savedParams.grid_stats && typeof savedParams.grid_stats === "object"
        ? (savedParams.grid_stats as { min?: number; max?: number; mean?: number; std?: number })
        : undefined;
      const savedVmin = typeof savedParams.raster_vmin === "number" ? savedParams.raster_vmin : undefined;
      const savedVmax = typeof savedParams.raster_vmax === "number" ? savedParams.raster_vmax : undefined;
      const savedDisplayVmin = typeof savedParams.display_vmin === "number" ? savedParams.display_vmin : undefined;
      const savedDisplayVmax = typeof savedParams.display_vmax === "number" ? savedParams.display_vmax : undefined;
      const hasTransformType = typeof savedParams.transform_type === "string";
      const hasLegacyTransform = typeof (savedParams as Record<string, unknown>).transform === "string";
      const savedTransformType = hasTransformType
        ? savedParams.transform_type as string
        : hasLegacyTransform
          ? (savedParams as Record<string, unknown>).transform as string
          : "none";
      if (!hasTransformType && !hasLegacyTransform) setLegacyInterp(true);
      else setLegacyInterp(false);
      const savedTransformShift = typeof savedParams.transform_shift === "number" ? savedParams.transform_shift : 0;
      const savedTransformLambda = typeof savedParams.transform_lambda === "number" ? savedParams.transform_lambda : 0;
      const savedCovariateInfo = savedParams.covariate_info && typeof savedParams.covariate_info === "object"
        ? (savedParams.covariate_info as CovariateInfo)
        : null;
      const savedLowVarianceWarning = typeof savedParams.low_variance_warning === "string"
        ? savedParams.low_variance_warning : null;
      const savedInputStats = savedParams.input_stats && typeof savedParams.input_stats === "object"
        ? (savedParams.input_stats as RunResult["input_stats"])
        : null;
      const savedNearConstantGrid = savedParams.near_constant_grid === true;

      const effectiveDisplayVmin = savedDisplayVmin ??
        (savedVmin != null ? clientBackTransform(savedVmin, savedTransformType, savedTransformShift, savedTransformLambda) : undefined);
      const effectiveDisplayVmax = savedDisplayVmax ??
        (savedVmax != null ? clientBackTransform(savedVmax, savedTransformType, savedTransformShift, savedTransformLambda) : undefined);

      setRunResult({
        method: interp.method,
        interpolation: interp,
        zones: loadedZones,
        metrics: {
          ...(savedParams.metrics as RunResult["metrics"]),
          rmse: interp.rmseCv != null ? Number(interp.rmseCv) : undefined,
          mae: interp.maeCv != null ? Number(interp.maeCv) : undefined,
          r2: interp.r2Cv != null ? Number(interp.r2Cv) : undefined,
        },
        warnings: (savedParams.warnings as RunResult["warnings"]) ?? [],
        raster_url: interp.rasterUrl ?? undefined,
        raster_png_b64: savedB64,
        grid_stats: savedGridStats,
        raster_vmin: savedVmin,
        raster_vmax: savedVmax,
        display_vmin: effectiveDisplayVmin,
        display_vmax: effectiveDisplayVmax,
        near_constant_grid: savedNearConstantGrid,
        transform_type: savedTransformType,
        transform_shift: savedTransformShift,
        transform_lambda: savedTransformLambda,
        covariate_info: savedCovariateInfo,
        low_variance_warning: savedLowVarianceWarning,
        input_stats: savedInputStats,
      });
      setLoocvResiduals(Array.isArray(savedParams.loocv_residuals)
        ? associateResiduals(savedParams.loocv_residuals as LoocvResidual[], measuredPoints)
        : computeClientLoocv());
      setWizardStep(3);
    } catch (e: unknown) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="border-b bg-card px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <Button variant="ghost" size="icon" onClick={() => setLocation(`/parcel/${id}`)} data-testid="btn-back">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold truncate">Mapa de Variabilidad</h1>
          <p className="text-xs text-muted-foreground truncate">{parcel?.name ?? "Parcela"}</p>
        </div>
        <Badge variant="outline" className="text-purple-700 border-purple-200 bg-purple-50 shrink-0">
          Interpolación
        </Badge>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-3xl mx-auto w-full">
        {/* Campaign selector */}
        <Card data-testid="card-campaign-select">
          <CardContent className="pt-4 space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Campaña</Label>
              <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId} data-testid="select-campaign">
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar campaña..." />
                </SelectTrigger>
                <SelectContent>
                  {campaigns.map((c: SamplingCampaign) => (
                    <SelectItem key={c.id} value={c.id} data-testid={`option-campaign-${c.id}`}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedCampaign && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{measuredPoints.length} / {points.length} puntos</span>
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-purple-500 rounded-full transition-all"
                    style={{ width: `${completionPct}%` }}
                  />
                </div>
                <span className={completionPct >= 80 ? "text-green-600 font-medium" : ""}>{completionPct}%</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Wizard stepper ─────────────────────────────────────────────── */}
        {selectedCampaignId && (
          <div className="flex items-center gap-1 overflow-x-auto py-1" data-testid="wizard-stepper">
            {[
              { step: 0, label: "Diagnóstico", icon: <Stethoscope className="w-3 h-3" />, wizardIdx: 0 },
              { step: 2, label: "Configuración", icon: <Settings2 className="w-3 h-3" />, wizardIdx: 2 },
              { step: 3, label: "Resultados", icon: <BarChart2 className="w-3 h-3" />, wizardIdx: 3 },
            ].map(({ step, label, icon }, i) => (
              <div key={step} className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => {
                    const canStep2 = !!diagnosisResult && diagnosisResult.ok_to_interpolate !== false;
                    if (step < wizardStep || (step === 2 && canStep2) || step === 3) {
                      setWizardStep(step as 0 | 1 | 2 | 3);
                    }
                  }}
                  disabled={(() => {
                    const canStep2 = !!diagnosisResult && diagnosisResult.ok_to_interpolate !== false;
                    const canStep3 = !!runResult;
                    return step > wizardStep && !(step === 2 && canStep2) && !(step === 3 && canStep3);
                  })()}
                  data-testid={`wizard-step-${step}`}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition-all ${
                    wizardStep === step
                      ? "bg-purple-600 text-white shadow-sm"
                      : step < wizardStep
                        ? "bg-purple-100 text-purple-700 cursor-pointer hover:bg-purple-200"
                        : "bg-muted text-muted-foreground cursor-default opacity-60"
                  }`}
                >
                  {icon}
                  {label}
                </button>
                {i < 3 && <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />}
              </div>
            ))}
          </div>
        )}

        {/* ── Step 0: Diagnóstico automático ─────────────────────────────── */}
        {selectedCampaignId && wizardStep === 0 && (
          <Card data-testid="card-diagnosis">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Stethoscope className="w-4 h-4 text-purple-600" /> Diagnóstico Automático
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {measuredPoints.length < 3 ? (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200" data-testid="diag-not-enough-points">
                  <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-amber-800">Pocos puntos medidos</p>
                    <p className="text-xs text-amber-700 mt-0.5">Se necesitan al menos 3 puntos con valores para diagnosticar. Actualmente: {measuredPoints.length}.</p>
                  </div>
                </div>
              ) : diagnosisLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2" data-testid="diag-loading">
                  <Loader2 className="w-4 h-4 animate-spin text-purple-500" />
                  Analizando distribución y espacialidad de los datos…
                </div>
              ) : diagnosisError ? (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200" data-testid="diag-error">
                  <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-red-800">Error en diagnóstico</p>
                    <p className="text-xs text-red-700 mt-0.5">{diagnosisError}</p>
                    <button onClick={() => runDiagnosis(selectedCampaignId)} className="mt-1 text-xs text-red-600 underline hover:text-red-800" data-testid="btn-retry-diagnosis">
                      Reintentar
                    </button>
                  </div>
                </div>
              ) : diagnosisResult ? (
                <>
                  {/* Summary metrics grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { label: "Puntos", value: String(diagnosisResult.n), ok: diagnosisResult.n >= 10, warn: diagnosisResult.n < 10 },
                      { label: "CV", value: `${diagnosisResult.cv_pct.toFixed(0)}%`, ok: diagnosisResult.cv_pct < 60, warn: diagnosisResult.cv_pct >= 60 },
                      {
                        label: "Sesgo",
                        value: `${diagnosisResult.skewness > 0 ? "+" : ""}${diagnosisResult.skewness.toFixed(2)}`,
                        ok: diagnosisResult.skewness_level === "low",
                        warn: diagnosisResult.skewness_level !== "low",
                      },
                      {
                        label: "Atípicos",
                        value: String(diagnosisResult.outlier_count),
                        ok: diagnosisResult.outlier_count === 0,
                        warn: diagnosisResult.outlier_count > 0,
                      },
                    ].map(({ label, value, ok, warn }) => (
                      <div key={label} className={`p-2 rounded-lg border text-center ${ok ? "bg-green-50 border-green-200" : warn ? "bg-amber-50 border-amber-200" : "bg-muted border-border"}`} data-testid={`diag-metric-${label.toLowerCase()}`}>
                        <p className={`text-sm font-bold font-mono ${ok ? "text-green-700" : warn ? "text-amber-700" : ""}`}>{value}</p>
                        <p className="text-[10px] text-muted-foreground">{label}</p>
                      </div>
                    ))}
                  </div>

                  {/* Compact descriptive stats row: mean±std + range */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" data-testid="diag-stats-compact">
                    <div className="p-2 rounded-lg border border-border bg-muted/30 text-center">
                      <p className="text-sm font-bold font-mono text-foreground">
                        {diagnosisResult.mean.toFixed(2)}<span className="text-muted-foreground text-xs">±{diagnosisResult.std.toFixed(2)}</span>
                      </p>
                      <p className="text-[10px] text-muted-foreground">Media ± DE</p>
                    </div>
                    <div className="p-2 rounded-lg border border-border bg-muted/30 text-center">
                      <p className="text-sm font-bold font-mono text-foreground">
                        {diagnosisResult.min.toFixed(2)}–{diagnosisResult.max.toFixed(2)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">Rango</p>
                    </div>
                    <div className="p-2 rounded-lg border border-border bg-muted/30 text-center">
                      <p className="text-sm font-bold font-mono text-foreground">
                        {diagnosisResult.median.toFixed(2)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">Mediana</p>
                    </div>
                  </div>

                  {/* Original distribution histogram (client-side) */}
                  {(() => {
                    const origHist = transformHistograms?.find(h => h.name === "none");
                    return origHist?.bins ? (
                      <div data-testid="diag-original-histogram">
                        <p className="text-[10px] text-muted-foreground mb-1">Distribución original ({diagnosisResult.n} pts)</p>
                        <div className="flex items-end gap-0.5 h-10">
                          {origHist.bins.map((b, i) => {
                            const maxC = Math.max(...origHist.bins!.map((x: { count: number }) => x.count), 1);
                            return (
                              <div key={i} className="flex-1" title={`${b.count} pts`}>
                                <div
                                  className="w-full rounded-sm"
                                  style={{ height: `${Math.max(8, (b.count / maxC) * 100)}%`, background: "#7c3aed", opacity: 0.6 }}
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null;
                  })()}

                  {/* Spatial clustering */}
                  {diagnosisResult.nn_ratio != null && (
                    <div className={`flex items-start gap-2 p-2.5 rounded-lg border text-xs ${
                      diagnosisResult.clustering_level === "good"
                        ? "bg-green-50 border-green-200 text-green-800"
                        : diagnosisResult.clustering_level === "moderate"
                          ? "bg-amber-50 border-amber-200 text-amber-800"
                          : "bg-red-50 border-red-200 text-red-800"
                    }`} data-testid="diag-clustering">
                      {diagnosisResult.clustering_level === "good"
                        ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        : <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
                      <span>Distribución espacial: NN-Ratio = {diagnosisResult.nn_ratio.toFixed(2)} — {
                        diagnosisResult.clustering_level === "good" ? "aceptable" : diagnosisResult.clustering_level === "moderate" ? "agrupamiento moderado" : "muy agrupado"
                      }</span>
                    </div>
                  )}

                  {/* Warnings */}
                  {diagnosisResult.warnings.length + (runResult?.warnings?.length ?? 0) > 0 && (
                    <div className="space-y-1.5" data-testid="diag-warnings">
                      {[...diagnosisResult.warnings, ...(runResult?.warnings ?? []).map(w => typeof w === "string" ? w : w.message)].map((w, i) => (
                        <div key={i} className="flex items-start gap-2 p-2 rounded border border-amber-200 bg-amber-50 text-xs text-amber-800">
                          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-600" />
                          {w}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Dedup repair panel */}
                  {diagnosisResult.duplicate_coords && diagnosisResult.duplicate_point_ids && diagnosisResult.duplicate_point_ids.length > 0 && (() => {
                    const pairs = diagnosisResult.duplicate_point_ids!;
                    const deleteOne = async (pointId: string) => {
                      setDeletingPointIds(prev => [...prev, pointId]);
                      try {
                        const r = await fetch(`/api/sampling-points/${pointId}`, { method: "DELETE" });
                        if (!r.ok) throw new Error("Error al eliminar");
                        qc.invalidateQueries({ queryKey: ["sampling-points", selectedCampaignId] });
                        await runDiagnosis(selectedCampaignId!);
                      } catch {
                        toast({ title: "Error", description: "No se pudo eliminar el punto", variant: "destructive" });
                      } finally {
                        setDeletingPointIds(prev => prev.filter(id => id !== pointId));
                      }
                    };
                    const deleteAll = async () => {
                      const allSecond = pairs.map(p => p[1]);
                      const toDelete = allSecond.filter((v, i) => allSecond.indexOf(v) === i);
                      for (const pid of toDelete) await deleteOne(pid);
                    };
                    const anyDeleting = pairs.some(p => p.some(pid => deletingPointIds.includes(pid)));
                    return (
                      <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 space-y-2" data-testid="dedup-repair-panel">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold text-red-800 flex items-center gap-1.5">
                            <Trash2 className="w-3 h-3" /> Reparar puntos duplicados ({pairs.length})
                          </p>
                          <a href={`/parcel/${id}/sampling/design?campaign=${selectedCampaignId ?? ""}`} className="text-[10px] text-red-700 underline flex items-center gap-0.5">
                            <MapPin className="w-2.5 h-2.5" /> Ver en mapa
                          </a>
                        </div>
                        <div className="space-y-1">
                          {pairs.filter(pair => pair.length === 2 && pair[0] && pair[1]).slice(0, 8).map((pair, i) => {
                            const ptA = measuredPoints.find(p => p.id === pair[0]);
                            const ptB = measuredPoints.find(p => p.id === pair[1]);
                            const isDeleting = pair.some(pid => deletingPointIds.includes(pid));
                            return (
                              <div key={i} className="flex items-center gap-2 text-[11px] bg-white border border-red-100 rounded px-2 py-1">
                                <span className="flex-1 text-red-900 font-mono">
                                  {ptA ? Number(ptA.value).toFixed(2) : "?"} ↔ {ptB ? Number(ptB.value).toFixed(2) : "?"}
                                  <span className="text-[9px] text-red-400 ml-1">(par {i + 1})</span>
                                </span>
                                <button
                                  onClick={() => deleteOne(pair[1])}
                                  disabled={isDeleting || anyDeleting}
                                  className="flex items-center gap-1 text-red-700 hover:text-red-900 disabled:opacity-50 disabled:cursor-not-allowed"
                                  data-testid={`btn-delete-dup-${i}`}
                                >
                                  {isDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                                  Eliminar duplicado
                                </button>
                              </div>
                            );
                          })}
                          {pairs.length > 8 && (
                            <p className="text-[10px] text-red-600 text-center">+{pairs.length - 8} pares más</p>
                          )}
                        </div>
                        {pairs.length > 1 && (
                          <button
                            onClick={deleteAll}
                            disabled={anyDeleting}
                            className="w-full text-[11px] text-center text-red-800 bg-red-100 hover:bg-red-200 rounded py-1 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                            data-testid="btn-delete-all-dups"
                          >
                            {anyDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                            Eliminar todos los duplicados ({pairs.length})
                          </button>
                        )}
                      </div>
                    );
                  })()}

                  {/* Recommendations */}
                  <div className="p-2.5 rounded-lg bg-purple-50 border border-purple-200 space-y-1.5" data-testid="diag-recommendations">
                    <p className="text-xs font-semibold text-purple-800">Recomendaciones automáticas</p>
                    <div className="flex flex-wrap gap-2 text-[11px]">
                      <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-800">
                        Método sugerido: <strong>{diagnosisResult.recommended_method.toUpperCase()}</strong>
                      </span>
                      <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-800">
                        Transformación: <strong>{diagnosisResult.recommended_transform === "none" ? "No necesaria" : diagnosisResult.recommended_transform}</strong>
                      </span>
                    </div>
                    {!diagnosisResult.ok_to_interpolate && (
                      <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
                        ✗ Corrija los errores indicados antes de interpolar.
                      </p>
                    )}
                  </div>

                  {/* Transform recommendation rationale */}
                  {diagnosisResult.transform_recommendation && (
                    <div className="text-[11px] text-muted-foreground bg-muted/40 rounded px-2.5 py-1.5 border" data-testid="diag-transform-reason">
                      <span className="font-semibold text-foreground">Transformación: </span>
                      {diagnosisResult.transform_recommendation.reason}
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs"
                      onClick={() => runDiagnosis(selectedCampaignId)}
                      data-testid="btn-rerun-diagnosis"
                    >
                      <RefreshCw className="w-3 h-3" /> Re-diagnosticar
                    </Button>
                      <Button
                        size="sm"
                        className="flex-1 gap-1.5 bg-purple-600 hover:bg-purple-700 text-xs"
                        onClick={() => setWizardStep(2)}
                        disabled={!diagnosisResult.ok_to_interpolate}
                        data-testid="btn-diagnosis-next"
                      >
                        Siguiente: Configurar <ChevronRight className="w-3 h-3" />
                      </Button>
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>
        )}


        {/* ── Step 2: Configuración ──────────────────────────────────────── */}
        {wizardStep === 2 && (
        <Card data-testid="card-interp-config">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-purple-600" /> Paso 2 — Configurar Interpolación
              <button
                onClick={() => setWizardStep(0)}
                className="ml-auto text-[10px] text-muted-foreground hover:text-purple-700 underline"
                data-testid="btn-config-back"
              >
                ← Atrás
              </button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {diagnosisResult?.ok_to_interpolate === false && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg border border-red-300 bg-red-50 text-red-800 text-xs" data-testid="config-blocked-banner">
                <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <div>
                  <span className="font-semibold">Interpolación bloqueada — </span>
                  el diagnóstico detectó menos de tres ubicaciones distintas utilizables.
                  Corrígelos en la campaña de muestreo y vuelve a diagnosticar antes de continuar.
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Método de interpolación</Label>
                <div className="flex flex-col gap-2">
                  {METHODS.map(m => {
                    const insufficient = measuredPoints.length < m.minPoints;
                    const isRecommended = m.value === diagnosisResult?.recommended_method;
                    return (
                      <button
                        key={m.value}
                        onClick={() => !insufficient && setMethod(m.value)}
                        disabled={insufficient}
                        data-testid={`btn-method-${m.value}`}
                        className={`p-3 rounded-lg border text-left transition-colors relative ${
                          insufficient
                            ? "border-border bg-muted/30 text-muted-foreground opacity-50 cursor-not-allowed"
                            : method === m.value
                              ? "border-purple-500 bg-purple-50 ring-1 ring-purple-400"
                              : "border-border hover:bg-muted/50"
                        }`}
                      >
                        {isRecommended && (
                          <span className="absolute top-2 right-2 text-[9px] bg-green-600 text-white px-1.5 py-0.5 rounded-full leading-none font-medium" data-testid={`badge-recommended-${m.value}`}>
                            Sugerido
                          </span>
                        )}
                        <div className="font-bold text-sm text-purple-900 pr-14">{m.label}</div>
                        <div className="text-[11px] font-medium text-muted-foreground mb-1">{m.subtitle}</div>
                        <div className="text-[10px] text-muted-foreground leading-snug">{m.desc}</div>
                        <div className={`text-[10px] mt-1.5 font-medium ${insufficient ? "text-red-500" : "text-purple-700"}`}>
                          {insufficient ? `Requiere ≥ ${m.minPoints} puntos (tienes ${measuredPoints.length})` : m.hint}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Número de zonas</Label>
                <Select value={nZones} onValueChange={setNZones} data-testid="select-n-zones">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[2, 3, 4, 5].map(n => (
                      <SelectItem key={n} value={String(n)}>{n} zonas de manejo</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="pt-2 space-y-1.5">
                  <Label className="text-xs">Opacidad del raster: {Math.round(opacity * 100)}%</Label>
                  <Slider
                    value={[opacity]}
                    onValueChange={([v]) => setOpacity(v)}
                    min={0.1}
                    max={1}
                    step={0.05}
                    className="w-full"
                    data-testid="slider-opacity"
                  />
                </div>
              </div>
            </div>

            {measuredPoints.length < 3 && (
              <p className="text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded p-2" data-testid="warn-not-enough-points">
                ⚠ Se necesitan mínimo 3 puntos medidos. Actualmente: {measuredPoints.length}
              </p>
            )}
            {completionPct < 80 && measuredPoints.length >= 3 && (
              <p className="text-xs text-orange-500 bg-orange-50 border border-orange-200 rounded p-2" data-testid="warn-completion">
                ⚠ Completitud: {completionPct}%. Se requiere ≥80% de puntos medidos para interpolar.
              </p>
            )}

            {/* Transform summary pill (read-only — always Auto) */}
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-purple-50 border border-purple-200" data-testid="transform-summary-step2">
              <Wand2 className="w-3.5 h-3.5 text-purple-600 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <span className="text-xs text-purple-800">
                  <strong>Transformación automática</strong>
                  {diagnosisResult?.recommended_transform && diagnosisResult.recommended_transform !== "none"
                    ? ` — ${diagnosisResult.recommended_transform} aplicada para normalizar la distribución`
                    : " — datos con distribución normal, sin transformación necesaria"}
                </span>
                {diagnosisResult?.transform_recommendation?.reason && (
                  <p className="text-[10px] text-purple-700 mt-0.5 leading-snug">{diagnosisResult.transform_recommendation.reason}</p>
                )}
              </div>
            </div>

            {/* Advanced hyperparameter panel — hidden for "auto" method */}
            {method !== "auto" && (
              <div className="border rounded-lg overflow-hidden" data-testid="card-advanced-hyperparams">
                <button
                  className="w-full flex items-center justify-between px-3 py-2 bg-muted/40 hover:bg-muted/60 transition-colors text-left"
                  onClick={() => setShowAdvanced(o => !o)}
                  data-testid="btn-toggle-advanced"
                >
                  <span className="flex items-center gap-2 text-xs font-medium">
                    <Activity className="w-3.5 h-3.5 text-purple-500" />
                    Configuración avanzada
                    {hasCustomHyperparams && (
                      <Badge className="text-[9px] px-1.5 py-0 h-4 bg-purple-100 text-purple-800 border-purple-300" data-testid="badge-custom-hyperparams">
                        Personalizado
                      </Badge>
                    )}
                  </span>
                  {showAdvanced ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                </button>

                {showAdvanced && (
                  <div className="px-3 py-2 space-y-3 bg-background text-xs">
                    <p className="text-[10px] text-muted-foreground leading-tight">
                      Ajusta los hiperparámetros del algoritmo seleccionado. Deja en "Auto" para que el sistema elija por validación cruzada (LOOCV).
                    </p>

                    {/* IDW controls */}
                    {method === "idw" && (
                      <div className="space-y-2.5" data-testid="panel-idw-params">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <Label className="text-[11px]">Potencia (p): {idwPower !== null ? idwPower.toFixed(1) : "Auto (LOOCV)"}</Label>
                            {idwPower !== null && (
                              <button onClick={() => setIdwPower(null)} className="text-[10px] text-muted-foreground hover:text-foreground underline" data-testid="btn-reset-idw-power">Auto</button>
                            )}
                          </div>
                          <Slider
                            value={[idwPower ?? 2]}
                            onValueChange={([v]) => setIdwPower(v)}
                            min={1}
                            max={5}
                            step={0.5}
                            className="w-full"
                            data-testid="slider-idw-power"
                          />
                          <p className="text-[9px] text-muted-foreground">Valores altos → mayor influencia de puntos cercanos. Rango típico: 1–3.</p>
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <Label className="text-[11px]">Vecinos k: {idwK !== null ? idwK : "Auto (LOOCV)"}</Label>
                            {idwK !== null && (
                              <button onClick={() => setIdwK(null)} className="text-[10px] text-muted-foreground hover:text-foreground underline" data-testid="btn-reset-idw-k">Auto</button>
                            )}
                          </div>
                          <Slider
                            value={[idwK ?? 8]}
                            onValueChange={([v]) => setIdwK(Math.round(v))}
                            min={3}
                            max={20}
                            step={1}
                            className="w-full"
                            data-testid="slider-idw-k"
                          />
                          <p className="text-[9px] text-muted-foreground">Número de vecinos más cercanos usados en cada predicción.</p>
                        </div>
                      </div>
                    )}

                    {/* Kriging controls */}
                    {method === "kriging" && (
                      <div className="space-y-2.5" data-testid="panel-kriging-params">
                        <div className="space-y-1">
                          <Label className="text-[11px]">Modelo de variograma</Label>
                          <p className="text-[9px] text-muted-foreground">En "Auto" el sistema elige el modelo con menor RMSE por validación cruzada.</p>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                            {KRIGING_VARIOGRAM_MODELS.map(m => (
                              <button
                                key={m.value}
                                onClick={() => setKrigVariogramModel(m.value)}
                                data-testid={`btn-krig-model-${m.value}`}
                                className={`p-1.5 rounded border text-[10px] text-center transition-colors ${
                                  krigVariogramModel === m.value
                                    ? "border-purple-500 bg-purple-50 text-purple-800 font-semibold"
                                    : "border-border hover:bg-muted/50"
                                }`}
                              >
                                {m.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* SVR controls */}
                    {method === "svr" && (
                      <div className="space-y-2.5" data-testid="panel-svr-params">
                        <div className="space-y-1">
                          <Label className="text-[11px]">Kernel SVR</Label>
                          <p className="text-[9px] text-muted-foreground">RBF captura relaciones no lineales; Lineal es más rápido con muchos puntos; Polinómico para gradientes suaves.</p>
                          <div className="grid grid-cols-3 gap-1">
                            {[
                              { value: "rbf", label: "RBF" },
                              { value: "linear", label: "Lineal" },
                              { value: "poly", label: "Polinómico" },
                            ].map(k => (
                              <button
                                key={k.value}
                                onClick={() => setSvrKernel(k.value)}
                                data-testid={`btn-svr-kernel-${k.value}`}
                                className={`p-1.5 rounded border text-[10px] text-center transition-colors ${
                                  svrKernel === k.value
                                    ? "border-violet-500 bg-violet-50 text-violet-800 font-semibold"
                                    : "border-border hover:bg-muted/50"
                                }`}
                              >
                                {k.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <Label className="text-[11px]">Regularización (C): {svrC !== null ? svrC.toFixed(1) : "Auto (LOOCV)"}</Label>
                            {svrC !== null && (
                              <button onClick={() => setSvrC(null)} className="text-[10px] text-muted-foreground hover:text-foreground underline" data-testid="btn-reset-svr-c">Auto</button>
                            )}
                          </div>
                          <Slider
                            value={[svrC ?? 1]}
                            onValueChange={([v]) => setSvrC(parseFloat(v.toFixed(1)))}
                            min={0.1}
                            max={100}
                            step={0.1}
                            className="w-full"
                            data-testid="slider-svr-c"
                          />
                          <p className="text-[9px] text-muted-foreground">C alto → menos regularización, más ajuste a los datos. Rango típico: 1–100.</p>
                        </div>
                      </div>
                    )}


                    {/* Reset to auto button */}
                    {hasCustomHyperparams && (
                      <button
                        onClick={resetHyperparams}
                        className="flex items-center gap-1.5 text-[10px] text-purple-700 hover:text-purple-900 underline mt-1"
                        data-testid="btn-reset-all-hyperparams"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Restaurar configuración óptima automática
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Delta RMSE indicator after re-run */}
            {runResult?.metrics?.rmse !== undefined && prevRmse !== null && (
              <div className={`text-[10px] flex items-center gap-1.5 rounded px-2 py-1 border ${
                runResult.metrics.rmse < prevRmse
                  ? "bg-green-50 border-green-200 text-green-700"
                  : runResult.metrics.rmse > prevRmse
                    ? "bg-red-50 border-red-200 text-red-700"
                    : "bg-muted/40 border-border text-muted-foreground"
              }`} data-testid="delta-rmse-indicator">
                <TrendingUp className="w-3 h-3" />
                RMSE anterior: {prevRmse.toFixed(4)} →{" "}
                <strong>{runResult.metrics.rmse.toFixed(4)}</strong>{" "}
                {runResult.metrics.rmse < prevRmse
                  ? `(−${(prevRmse - runResult.metrics.rmse).toFixed(4)} mejor)`
                  : runResult.metrics.rmse > prevRmse
                    ? `(+${(runResult.metrics.rmse - prevRmse).toFixed(4)} peor)`
                    : "(sin cambio)"}
              </div>
            )}

            {/* Geo-service down banner — shown when health check fails, dismissible */}
            {geoHealthy === false && !geoServiceBannerDismissed && (
              <div className="flex items-start gap-2 rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800" data-testid="banner-geo-service-down">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-yellow-600" />
                <div className="flex-1">
                  <p className="font-medium">Servicio de mapas no disponible</p>
                  <p className="text-xs text-yellow-700 mt-0.5">Los resultados de interpolación pueden fallar. Verifica que el geo-servicio esté activo o inténtalo más tarde.</p>
                </div>
                <button onClick={() => setGeoServiceBannerDismissed(true)} className="text-yellow-600 hover:text-yellow-800 shrink-0" data-testid="btn-dismiss-geo-banner">
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
            )}

            {completionPct >= 80 ? (
              <div title={!interpReady && !running ? interpReasons[0] : undefined}>
                <Button
                  className="w-full gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-60"
                  onClick={() => runInterpolation()}
                  disabled={running || !interpReady || !selectedCampaignId || geoChecking || diagnosisResult?.ok_to_interpolate === false}
                  data-testid="btn-run-interpolation"
                >
                  {running ? <Loader2 className="w-4 h-4 animate-spin" /> : geoChecking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  {running ? "Procesando…" : geoChecking ? "Verificando servicio…" : "Ejecutar Interpolación"}
                </Button>
                {!interpReady && !running && interpReasons.length > 0 && (
                  <p className="text-[11px] text-amber-700 mt-1 text-center" data-testid="preflight-reason">{interpReasons[0]}</p>
                )}
              </div>
            ) : (
              <Button
                className="w-full gap-2"
                disabled
                variant="outline"
                data-testid="btn-run-interpolation-disabled"
              >
                <Zap className="w-4 h-4" />
                Ejecutar Interpolación ({completionPct}% / 80% requerido)
              </Button>
            )}
          </CardContent>
        </Card>
        )}

        {/* ── Step 3: Resultados ─────────────────────────────────────────── */}
        {runResult && wizardStep === 3 && (
          <div className="flex items-center gap-2 px-1 py-0.5" data-testid="results-step-header">
            <BarChart2 className="w-4 h-4 text-purple-600" />
            <span className="text-sm font-semibold text-purple-800">Paso 3 — Resultados de interpolación</span>
            <button
              onClick={() => setWizardStep(2)}
              className="ml-auto text-[10px] text-muted-foreground hover:text-purple-700 underline"
              data-testid="btn-results-back"
            >
              ← Reconfigurar
            </button>
          </div>
        )}

        {/* Result: map + overlay */}
        {runResult && wizardStep === 3 && (
          <>
            {(() => {
              const p = runResult.interpolation?.paramsJson as Record<string, unknown> | null;
              return p?.fallback === true ? (
                <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800" data-testid="alert-fallback-mode">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
                  <div>
                    <p className="font-medium">Modo estadístico activo</p>
                    <p className="text-xs text-amber-700 mt-0.5">El servicio de interpolación avanzada no está disponible en producción. Se muestra una estimación IDW calculada localmente desde los valores medidos. Las zonas son estadísticas basadas en terciles.</p>
                  </div>
                </div>
              ) : null;
            })()}


            <Card className="overflow-hidden" data-testid="card-raster-map">
              <CardHeader className="pb-1">
                <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
                  <Layers className="w-4 h-4 text-purple-600" /> Mapa de Variabilidad
                  <span className="text-xs text-muted-foreground font-normal ml-auto">
                    {runResult.interpolation?.method?.toUpperCase() ?? runResult.method?.toUpperCase()} · {runResult.interpolation?.createdAt ? new Date(runResult.interpolation.createdAt).toLocaleDateString("es-MX") : "—"}
                  </span>
                  {loocvResiduals.length > 0 && (
                    <button
                      className={`ml-1 p-1 rounded border text-[10px] flex items-center gap-1 transition-colors ${showResiduals ? "bg-purple-50 border-purple-300 text-purple-700" : "border-border text-muted-foreground"}`}
                      onClick={() => setShowResiduals(v => !v)}
                      data-testid="btn-toggle-residuals"
                      title="Mostrar/ocultar residuos LOOCV"
                    >
                      {showResiduals ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                      Residuos
                    </button>
                  )}
                  {/* F1-05: Confidence map toggle — only for kriging with std grid */}
                  {confidenceRasterSrc && (
                    <button
                      className={`ml-1 p-1 rounded border text-[10px] flex items-center gap-1 transition-colors ${showConfidenceMap ? "bg-blue-50 border-blue-300 text-blue-700" : "border-border text-muted-foreground"}`}
                      onClick={() => setShowConfidenceMap(v => !v)}
                      data-testid="btn-toggle-confidence-map"
                      title="Mapa de incertidumbre Kriging (σ)"
                    >
                      {showConfidenceMap ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                      Incertidumbre σ
                    </button>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div style={{ height: 320 }}>
                  <MapContainer
                    center={mapBounds ? [(mapBounds[0][0] + mapBounds[1][0]) / 2, (mapBounds[0][1] + mapBounds[1][1]) / 2] : [20, -99]}
                    zoom={14}
                    style={{ height: "100%", width: "100%" }}
                    data-testid="map-raster"
                  >
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    {polygonCoords.length >= 3 && (
                      <>
                        <FitBounds coords={polygonCoords} />
                        <Polygon positions={polygonCoords} color="#7c3aed" fillOpacity={0} weight={2} />
                      </>
                    )}
                    {rasterSrc && mapBounds && (
                      <ImageOverlay url={rasterSrc} bounds={mapBounds} opacity={opacity} data-testid="raster-overlay" />
                    )}
                    {/* F1-05: Kriging uncertainty overlay */}
                    {showConfidenceMap && confidenceRasterSrc && mapBounds && (
                      <ImageOverlay url={confidenceRasterSrc} bounds={mapBounds} opacity={0.65} data-testid="confidence-overlay" />
                    )}
                    {showResiduals && loocvResiduals.length > 0 && (() => {
                      const maxErr = Math.max(...loocvResiduals.map(r => Math.abs(r.error)));
                      return loocvResiduals.map((r, i) => {
                        const errNorm = maxErr > 1e-9 ? Math.abs(r.error) / maxErr : 0;
                        const radius = Math.max(4, Math.min(14, 4 + errNorm * 10));
                        const hue = Math.round((1 - errNorm) * 120);
                        const color = `hsl(${hue},80%,40%)`;
                        return (
                          <CircleMarker
                            key={`res-${i}`}
                            center={[r.lat, r.lon]}
                            radius={radius}
                            color={color}
                            fillColor={color}
                            fillOpacity={0.75}
                            weight={1.5}
                          >
                            <LeafletTooltip>
                              <div className="text-xs space-y-0.5">
                                <div>Real: <b>{r.actual.toFixed(3)}</b></div>
                                <div>Predicho: {r.predicted.toFixed(3)}</div>
                                <div>Error absoluto: {Math.abs(r.error).toFixed(3)}</div>
                              </div>
                            </LeafletTooltip>
                          </CircleMarker>
                        );
                      });
                    })()}
                    {measuredPoints.map((p: SamplingPoint) => {
                      const isExcludedPt = excludedIds.has(p.id);
                      return (
                        <CircleMarker
                          key={p.id}
                          center={[Number(p.latActual ?? p.latPlanned), Number(p.lonActual ?? p.lonPlanned)]}
                          radius={isExcludedPt ? 5 : 4}
                          color={isExcludedPt ? "#6b7280" : "#fff"}
                          fillColor={isExcludedPt ? "#d1d5db" : "#4f46e5"}
                          fillOpacity={isExcludedPt ? 0.5 : 0.9}
                          weight={isExcludedPt ? 2 : 1.5}
                          dashArray={isExcludedPt ? "3,3" : undefined}
                        >
                          <LeafletTooltip>
                            <span className="text-xs">
                              P{p.pointIndex + 1} · {Number(p.value).toFixed(3)}
                              {isExcludedPt ? " (excluido)" : ""}
                            </span>
                          </LeafletTooltip>
                        </CircleMarker>
                      );
                    })}
                    {/* Uncertainty heatmap: IDW(|LOOCV error|) × coverage-gap grid */}
                    {showUncertainty && uncertaintyGrid.map((cell, i) => {
                      const r = Math.round(255 * cell.value);
                      const g = Math.round(180 * (1 - cell.value));
                      const color = `rgb(${r},${g},30)`;
                      return (
                        <CircleMarker
                          key={`unc-${i}`}
                          center={[cell.lat, cell.lon]}
                          radius={18}
                          color="transparent"
                          fillColor={color}
                          fillOpacity={0.28}
                          weight={0}
                        />
                      );
                    })}
                    {showAdaptive && suggestedPoints?.map((sp, i) => (
                      <CircleMarker
                        key={`adap-${i}`}
                        center={[sp.lat, sp.lon]}
                        radius={8}
                        color="#ea580c"
                        fillColor="#fb923c"
                        fillOpacity={0.9}
                        weight={2}
                        data-testid={`map-adaptive-${i}`}
                      >
                        <LeafletTooltip>
                          <div className="text-xs space-y-0.5">
                            <div className="font-semibold text-orange-700">+ Punto Sugerido {i + 1}</div>
                            <div>{sp.lat.toFixed(6)}, {sp.lon.toFixed(6)}</div>
                            <div className="text-muted-foreground">Score: {sp.score.toFixed(1)} m</div>
                          </div>
                        </LeafletTooltip>
                      </CircleMarker>
                    ))}
                  </MapContainer>
                </div>
                {/* Color scale legend — display_vmin/vmax are in original units (server back-transforms) */}
                {rasterSrc && (() => {
                  const lo = runResult.display_vmin ?? runResult.raster_vmin ?? clientVminmax?.[0];
                  const hi = runResult.display_vmax ?? runResult.raster_vmax ?? clientVminmax?.[1];
                  if (lo == null || hi == null) return null;
                  const center = (lo + hi) / 2;
                  const relRange = Math.abs(hi - lo) / Math.max(Math.abs(center), 1);
                  const dec = relRange < 0.005 ? 5 : relRange < 0.05 ? 4 : 3;
                  const fmt = (v: number) => v.toFixed(dec);
                  return (
                    <div className="px-4 py-2 border-t bg-muted/30" data-testid="color-legend">
                      <p className="text-[10px] text-muted-foreground mb-1 font-medium">Escala de valores interpolados</p>
                      <div
                        className="w-full h-4 rounded"
                        style={{ background: "linear-gradient(to right, #d73027, #fdae61, #ffffbf, #a6d96a, #1a9850)" }}
                      />
                      <div className="flex justify-between mt-0.5">
                        <span className="text-[10px] font-mono text-muted-foreground">{fmt(lo)}</span>
                        <span className="text-[10px] font-mono text-muted-foreground">{fmt(center)}</span>
                        <span className="text-[10px] font-mono text-muted-foreground">{fmt(hi)}</span>
                      </div>
                      {(!!runResult.low_variance_warning || runResult.near_constant_grid) && (
                        <p className="text-[9px] text-amber-700 mt-0.5 italic" data-testid="legend-near-constant">
                          Campo casi uniforme — escala visual expandida
                        </p>
                      )}
                      {legacyInterp && (
                        <p className="text-[9px] text-blue-600 mt-0.5 italic" data-testid="legend-legacy-interp">
                          Datos históricos — escala en unidades originales sin transformación
                        </p>
                      )}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>

            {/* Metrics */}
            {(runResult.warnings?.length ?? 0) > 0 && (
              <Alert data-testid="mvz-service-warnings">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Diagnóstico del servicio</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4">
                    {runResult.warnings!.map((warning, i) => <li key={i}>{typeof warning === "string" ? warning : warning.message}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" data-testid="section-metrics">
              {[
                { label: "RMSE (CV)", value: runResult.metrics?.rmse, good: (runResult.metrics?.rmse ?? 999) < 1 },
                { label: "MAE (CV)", value: runResult.metrics?.mae, good: (runResult.metrics?.mae ?? 999) < 1 },
                { label: "R² (CV)", value: runResult.metrics?.r2_loocv ?? runResult.metrics?.r2, good: (runResult.metrics?.r2_loocv ?? runResult.metrics?.r2 ?? 0) > 0.6 },
              ].map(m => (
                <Card key={m.label}>
                  <CardContent className="p-3 text-center">
                    <p className={`text-xl font-bold font-mono ${m.value != null ? (m.good ? "text-green-600" : "text-orange-500") : "text-muted-foreground"}`} data-testid={`metric-${m.label}`}>
                      {m.value != null ? Number(m.value).toFixed(3) : "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">{m.label}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
            {/* F1-05: MSDR badge — Kriging variance calibration indicator */}
            {(() => {
              const p = runResult?.interpolation?.paramsJson as Record<string, unknown> | null | undefined;
              const msdr = runResult.metrics?.kriging_msdr ?? runResult.metrics?.msdr ?? p?.kriging_msdr as number | null | undefined;
              if (msdr == null) return null;
              const good = msdr > 0.5 && msdr < 2.0;
              return (
                <div className="flex items-center gap-2 flex-wrap px-1" data-testid="section-msdr">
                  <span className="text-[11px] text-muted-foreground">Calibración de varianza Kriging:</span>
                  <Badge
                    variant="outline"
                    className={`text-[10px] px-2 py-0 h-5 font-mono ${good ? "border-green-400 text-green-700 bg-green-50" : "border-amber-400 text-amber-700 bg-amber-50"}`}
                    data-testid="badge-msdr"
                    title="MSDR ≈ 1 indica varianza bien calibrada. < 0.5 sub-estimada, > 2 sobre-estimada."
                  >
                    MSDR = {Number(msdr).toFixed(3)} {good ? "✓" : "⚠"}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">{good ? "varianza bien calibrada" : "revisar modelo de variograma"}</span>
                </div>
              );
            })()}

            {/* Transform applied info */}
            {runResult.transform_type && runResult.transform_type !== "none" && (
              <div className="flex items-center gap-2 flex-wrap px-1" data-testid="transform-applied-info">
                <span className="text-[11px] text-muted-foreground">Transformación aplicada:</span>
                <Badge variant="outline" className="text-[10px] px-2 py-0 h-5 border-purple-300 text-purple-700 bg-purple-50" data-testid="badge-transform-applied">
                  {TRANSFORMS.find(t => t.value === runResult.transform_type)?.label ?? runResult.transform_type}
                  {runResult.transform_lambda != null && ` (λ=${Number(runResult.transform_lambda).toFixed(3)})`}
                </Badge>
                {runResult.transform_type !== "none" && (
                  <span className="text-[10px] text-muted-foreground">· escala de color en unidades originales</span>
                )}
              </div>
            )}

            {/* Auto-diagnosis panel — triggers when R² < 0 OR RMSE > std(values) */}
            {(() => {
              const r2 = runResult.metrics?.r2;
              const rmse = runResult.metrics?.rmse;
              const valStd = dataQuality?.std ?? 0;
              const valRange = dataQuality?.range ?? 0;
              const rmseOverRange = valRange > 1e-9 && rmse != null ? rmse / valRange : null;
              const shouldShow = (r2 != null && r2 < 0) || (rmse != null && valStd > 1e-9 && rmse > valStd);
              if (!shouldShow) return null;
              const severity = rmseOverRange != null
                ? rmseOverRange > 0.3 ? "alto" : rmseOverRange > 0.15 ? "moderado" : "bajo"
                : r2 != null && r2 < 0 ? "alto" : "moderado";
              const isRed = severity === "alto";
              const borderCls = isRed ? "border-red-300 bg-red-50" : "border-amber-300 bg-amber-50";
              const textCls = isRed ? "text-red-800" : "text-amber-800";
              const listCls = isRed ? "text-red-700" : "text-amber-700";
              // Build ordered recommendations by priority
              type Rec = { priority: number; text: string; action?: React.ReactNode };
              const recs: Rec[] = [];
              if (r2 != null && r2 < 0)
                recs.push({ priority: 10, text: "R² negativo: el modelo predice peor que la media. El mapa es ilustrativo, no prescriptivo." });
              if (rmseOverRange != null && rmseOverRange > 0.3)
                recs.push({ priority: 9, text: `Error alto (RMSE/rango=${rmseOverRange.toFixed(2)}). Revisa los datos antes de generar prescripciones.` });
              if (dataQuality?.n != null && dataQuality.n < 10)
                recs.push({ priority: 8, text: `Solo ${dataQuality.n} puntos medidos. Agrega más puntos de muestreo (≥10) para resultados confiables.` });
              if (dataQuality?.outlierCount != null && dataQuality.outlierCount > 0)
                recs.push({
                  priority: 7,
                  text: `${dataQuality.outlierCount} valor${dataQuality.outlierCount > 1 ? "es" : ""} atípico detectado.`,
                  action: (
                    <div className="flex gap-1.5 flex-wrap mt-0.5">
                      <button
                        className={`text-[10px] px-2 py-0.5 rounded font-medium border ${isRed ? "border-red-400 text-red-700 hover:bg-red-100" : "border-amber-400 text-amber-700 hover:bg-amber-100"}`}
                        onClick={() => setExcludedIds(new Set(outlierPointIds))}
                        data-testid="btn-preselect-outliers"
                      >
                        <Ban className="w-3 h-3 inline mr-1" />
                        Pre-seleccionar atípicos ({outlierPointIds.size})
                      </button>
                      <button
                        className={`text-[10px] px-2 py-0.5 rounded font-medium border ${isRed ? "border-red-400 text-red-700 hover:bg-red-100" : "border-amber-400 text-amber-700 hover:bg-amber-100"}`}
                        onClick={() => setLocation(`/parcel/${id}/sampling/capture`)}
                        data-testid="btn-go-capture"
                      >
                        <ExternalLink className="w-3 h-3 inline mr-1" />
                        Ver en campo →
                      </button>
                    </div>
                  ),
                });
              if (dataQuality?.nnRatio != null && dataQuality.nnRatio < 0.5)
                recs.push({ priority: 6, text: `Puntos muy agrupados (NN-ratio=${dataQuality.nnRatio.toFixed(2)}). Redistribuye el muestreo espacialmente.` });
              if (measuredPoints.length < 8)
                recs.push({ priority: 5, text: `Con ≥8 puntos medidos el método Kriging mejora significativamente la precisión.` });
              recs.push({ priority: 1, text: "Prueba otro método de interpolación (IDW suele ser más robusto con datos dispersos)." });
              recs.sort((a, b) => b.priority - a.priority);
              return (
                <Card className={`border-2 ${borderCls}`} data-testid="card-diagnosis">
                  <CardContent className="p-3 space-y-1.5">
                    <button
                      className="w-full flex items-center gap-2 text-left"
                      onClick={() => setDiagnosisOpen(o => !o)}
                      data-testid="btn-diagnosis-toggle"
                    >
                      <XCircle className={`w-4 h-4 shrink-0 ${isRed ? "text-red-500" : "text-amber-500"}`} />
                      <p className={`text-sm font-semibold flex-1 ${textCls}`}>
                        <span
                          className={`mr-2 inline-block text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${isRed ? "bg-red-600 text-white" : "bg-amber-600 text-white"}`}
                          title="El modelo no superó los umbrales mínimos (R² ≥ 0 y RMSE ≤ desviación estándar). El mapa es ilustrativo y no debería usarse para generar prescripciones de manejo."
                          data-testid="badge-no-concluyente"
                        >
                          No concluyente
                        </span>
                        {r2 != null && r2 < 0
                          ? "Mapa no predictivo (R² negativo)"
                          : `Ajuste débil — RMSE supera la variabilidad de los datos`}
                        {rmseOverRange != null && (
                          <span className={`ml-2 text-[10px] font-normal px-1.5 py-0.5 rounded ${isRed ? "bg-red-200" : "bg-amber-200"}`}>
                            Severidad {severity}
                          </span>
                        )}
                      </p>
                      <span className={`text-xs ${textCls}`}>{diagnosisOpen ? "▲" : "▼"}</span>
                    </button>
                    {diagnosisOpen && (
                      <ul className={`text-xs space-y-1.5 pl-4 list-disc ${listCls}`}>
                        {recs.map((rec, i) => (
                          <li key={i}>
                            {rec.text}
                            {rec.action}
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              );
            })()}

            {/* LOOCV residuals table */}
            {loocvResiduals.length > 0 && (
              <Card data-testid="card-loocv-residuals">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Activity className="w-4 h-4 text-purple-600" /> Residuos de Validación Cruzada (LOOCV)
                    {excludedIds.size > 0 && (
                      <span className="ml-auto text-[10px] font-normal px-2 py-0.5 bg-red-100 text-red-700 rounded-full">
                        {excludedIds.size} excluido{excludedIds.size > 1 ? "s" : ""}
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0 space-y-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="px-2 py-1.5 w-6" title="Excluir del re-run" />
                          <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">Punto</th>
                          <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">Real</th>
                          <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">Predicho</th>
                          <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">Error</th>
                          <th className="px-3 py-1.5 w-20" />
                          <th className="px-2 py-1.5 w-6" title="Editar en campo" />
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const maxErr = Math.max(...loocvResiduals.map(r => Math.abs(r.error)));
                          return loocvResiduals.map((r, i) => {
                            const pid = r.pointId ?? String(i);
                            const isExcluded = excludedIds.has(pid);
                            const errNorm = maxErr > 1e-9 ? Math.abs(r.error) / maxErr : 0;
                            const barW = Math.round(errNorm * 100);
                            const isHigh = errNorm > 0.7;
                            return (
                              <tr
                                key={i}
                                className={`border-b last:border-0 hover:bg-muted/20 transition-opacity ${isExcluded ? "opacity-40 line-through" : ""}`}
                                data-testid={`row-residual-${i}`}
                              >
                                <td className="px-2 py-1.5">
                                  <input
                                    type="checkbox"
                                    checked={isExcluded}
                                    onChange={e => {
                                      setExcludedIds(prev => {
                                        const next = new Set(prev);
                                        if (e.target.checked) next.add(pid); else next.delete(pid);
                                        return next;
                                      });
                                    }}
                                    className="rounded"
                                    title="Excluir del re-run"
                                    data-testid={`chk-exclude-${i}`}
                                  />
                                </td>
                                <td className="text-right px-3 py-1.5 text-muted-foreground">#{i + 1}</td>
                                <td className="text-right px-3 py-1.5 font-mono">{r.actual.toFixed(3)}</td>
                                <td className="text-right px-3 py-1.5 font-mono">{r.predicted.toFixed(3)}</td>
                                <td className={`text-right px-3 py-1.5 font-mono font-semibold ${isHigh ? "text-red-600" : r.error > 0 ? "text-blue-600" : "text-orange-600"}`}>
                                  {r.error > 0 ? "+" : ""}{r.error.toFixed(3)}
                                </td>
                                <td className="px-3 py-1.5">
                                  <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                                    <div
                                      className="h-full rounded-full transition-all"
                                      style={{
                                        width: `${barW}%`,
                                        background: `hsl(${Math.round((1 - errNorm) * 120)},70%,45%)`,
                                      }}
                                    />
                                  </div>
                                </td>
                                <td className="px-2 py-1.5">
                                  <button
                                    title="Editar en campo"
                                    className="text-muted-foreground hover:text-blue-600 transition-colors"
                                    onClick={() => setLocation(`/parcel/${id}/sampling/capture${r.pointId ? `?point=${r.pointId}` : ""}`)}
                                    data-testid={`btn-edit-point-${i}`}
                                  >
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                </td>
                              </tr>
                            );
                          });
                        })()}
                      </tbody>
                    </table>
                  </div>

                  {/* Re-run controls */}
                  {(excludedIds.size > 0 || winsorize) && (
                    <div className="px-3 pb-3 pt-2 border-t space-y-2" data-testid="rerun-controls">
                      <div className="flex items-center gap-2 flex-wrap">
                        {excludedIds.size > 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1 text-red-700 border-red-300 hover:bg-red-50"
                            onClick={() => setExcludedIds(new Set())}
                            data-testid="btn-clear-exclusions"
                          >
                            <XCircle className="w-3 h-3" />
                            Limpiar exclusiones
                          </Button>
                        )}
                        <Button
                          size="sm"
                          className="h-7 text-xs gap-1 bg-purple-600 hover:bg-purple-700 ml-auto"
                          onClick={runRerun}
                          disabled={rerunning}
                          data-testid="btn-rerun"
                        >
                          <RefreshCw className={`w-3 h-3 ${rerunning ? "animate-spin" : ""}`} />
                          {rerunning ? "Calculando…" : `Re-ejecutar sin ${excludedIds.size} excluido${excludedIds.size !== 1 ? "s" : ""}${winsorize ? " + wins." : ""}`}
                        </Button>
                      </div>

                      {/* Metrics comparison */}
                      {rerunResult && runResult.metrics && (
                        <div className="rounded border bg-muted/20 p-2 space-y-1" data-testid="rerun-metrics-compare">
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Comparativa de métricas</p>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-center">
                            {[
                              { key: "rmse", label: "RMSE", lowerBetter: true },
                              { key: "mae", label: "MAE", lowerBetter: true },
                              { key: "r2", label: "R²", lowerBetter: false },
                            ].map(({ key, label, lowerBetter }) => {
                              const before = rerunResult[key as keyof typeof rerunResult] as number | undefined;
                              const after = runResult.metrics?.[key as keyof typeof runResult.metrics] as number | undefined;
                              const delta = before != null && after != null ? after - before : undefined;
                              const improved = delta != null && (lowerBetter ? delta < 0 : delta > 0);
                              return (
                                <div key={key} className="text-xs">
                                  <p className="text-[9px] text-muted-foreground">{label}</p>
                                  <p className="font-mono text-[11px]">{before != null ? before.toFixed(3) : "—"} → <span className={improved ? "text-green-600 font-semibold" : "text-red-600 font-semibold"}>{after != null ? after.toFixed(3) : "—"}</span></p>
                                  {delta != null && (
                                    <p className={`text-[9px] ${improved ? "text-green-600" : "text-red-500"}`}>
                                      {improved ? "▲" : "▼"} {Math.abs(delta).toFixed(3)}
                                    </p>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Adaptive sampling card */}
            {loocvResiduals.length > 0 && (
              <Card data-testid="card-adaptive-sampling">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-orange-500" />
                    Muestreo Adaptativo
                    {suggestedPoints && suggestedPoints.length > 0 && (
                      <button
                        className="ml-1 flex items-center gap-1 text-[10px] text-orange-700 hover:text-orange-900 underline"
                        onClick={() => setShowAdaptive(a => !a)}
                        data-testid="btn-toggle-adaptive-overlay"
                      >
                        {showAdaptive ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                        {showAdaptive ? "Ocultar" : "Ver"}
                      </button>
                    )}
                    {uncertaintyGrid.length > 0 && (
                      <button
                        className="ml-1 flex items-center gap-1 text-[10px] text-red-700 hover:text-red-900 underline"
                        onClick={() => setShowUncertainty(u => !u)}
                        data-testid="btn-toggle-uncertainty-layer"
                      >
                        {showUncertainty ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                        Incertidumbre
                      </button>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    Basado en los errores LOOCV, sugiere nuevos puntos de muestreo en las zonas de mayor incertidumbre espacial usando un algoritmo de maximización de distancia ponderada por error.
                  </p>

                  {/* Spatial diagnostics: high-error hotspots + coverage stats */}
                  {(() => {
                    const top3 = [...loocvResiduals]
                      .sort((a, b) => Math.abs(b.error) - Math.abs(a.error))
                      .slice(0, 3);
                    const existing = measuredPoints.map(p => ({
                      lat: Number(p.latActual ?? p.latPlanned),
                      lon: Number(p.lonActual ?? p.lonPlanned),
                    }));
                    const dists = existing.flatMap((p, i) =>
                      existing.slice(i + 1).map(q => haversineDistM(p.lat, p.lon, q.lat, q.lon))
                    );
                    const avgDist = dists.length > 0 ? dists.reduce((s, d) => s + d, 0) / dists.length : 0;
                    const areaHa = polygonAreaHa(polygonCoords);
                    const recommendedN = Math.max(10, Math.ceil(areaHa / 2));
                    return (
                      <div className="rounded-md border border-orange-200 bg-orange-50/60 p-2 space-y-2" data-testid="adaptive-diagnostics">
                        <p className="text-[10px] font-semibold text-orange-800 uppercase tracking-wide">Diagnóstico de cobertura</p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 text-center">
                          <div className="bg-white rounded p-1 border border-orange-100">
                            <p className="text-sm font-bold text-orange-700">{existing.length}</p>
                            <p className="text-[9px] text-muted-foreground">Pts medidos</p>
                          </div>
                          <div className="bg-white rounded p-1 border border-orange-100">
                            <p className="text-sm font-bold text-orange-700">{avgDist > 0 ? `${Math.round(avgDist)} m` : "—"}</p>
                            <p className="text-[9px] text-muted-foreground">Dist. media</p>
                          </div>
                          <div className="bg-white rounded p-1 border border-orange-100">
                            <p className="text-sm font-bold text-orange-700">{areaHa.toFixed(1)} ha</p>
                            <p className="text-[9px] text-muted-foreground">Área parcela</p>
                          </div>
                        </div>
                        {top3.length > 0 && (() => {
                          // Simple proximity clustering: group residuals within 30m of each hotspot
                          const CLUSTER_RADIUS_M = 30;
                          const clusterSizes = top3.map(r =>
                            loocvResiduals.filter(q =>
                              haversineDistM(r.lat, r.lon, q.lat, q.lon) <= CLUSTER_RADIUS_M
                            ).length
                          );
                          return (
                            <div>
                              <p className="text-[9px] text-orange-800 font-medium mb-0.5">Zonas con mayor error LOOCV (clusters de alta incertidumbre):</p>
                              <div className="space-y-0.5">
                                {top3.map((r, i) => (
                                  <div key={i} className="flex items-center justify-between text-[9px] font-mono text-muted-foreground">
                                    <span>{r.lat.toFixed(5)}, {r.lon.toFixed(5)}</span>
                                    <div className="flex items-center gap-1.5">
                                      {clusterSizes[i] > 1 && (
                                        <span className="text-orange-600">{clusterSizes[i]} pts/30m</span>
                                      )}
                                      <span className="font-bold text-red-600">Err: {Math.abs(r.error).toFixed(3)}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()}
                        <div className="flex items-center justify-between text-[9px] pt-0.5 border-t border-orange-200">
                          <span className="text-muted-foreground">N recomendado (1 pt/2 ha):</span>
                          <span className={`font-bold ${existing.length >= recommendedN ? "text-green-700" : "text-amber-700"}`}>
                            {existing.length}/{recommendedN} {existing.length >= recommendedN ? "✓" : "↑"}
                          </span>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Puntos a sugerir: <span className="font-bold">{adaptiveN}</span></Label>
                    </div>
                    <Slider
                      value={[adaptiveN]}
                      onValueChange={([v]) => { setAdaptiveN(v); setSuggestedPoints(null); }}
                      min={3}
                      max={10}
                      step={1}
                      className="w-full"
                      data-testid="slider-adaptive-n"
                    />
                    <p className="text-[9px] text-muted-foreground">Rango: 3–10 puntos adicionales</p>
                  </div>

                  <Button
                    size="sm"
                    className="w-full gap-2 bg-orange-500 hover:bg-orange-600 text-white"
                    onClick={runAdaptiveAnalysis}
                    data-testid="btn-run-adaptive"
                  >
                    <Activity className="w-3.5 h-3.5" />
                    Calcular {adaptiveN} puntos sugeridos
                  </Button>

                  {suggestedPoints && suggestedPoints.length > 0 && (
                    <div className="space-y-2 border rounded-lg overflow-hidden" data-testid="adaptive-results">
                      <div className="bg-orange-50 px-3 py-2 border-b">
                        <p className="text-[11px] font-medium text-orange-800">{suggestedPoints.length} puntos sugeridos — alta incertidumbre de interpolación</p>
                      </div>
                      <div className="px-3 pb-2 space-y-1.5">
                        {(() => {
                          const existingPts = measuredPoints.map(p => ({
                            lat: Number(p.latActual ?? p.latPlanned),
                            lon: Number(p.lonActual ?? p.lonPlanned),
                          }));
                          return suggestedPoints.map((sp, i) => {
                            const nearestDist = existingPts.length > 0
                              ? Math.min(...existingPts.map(p => haversineDistM(sp.lat, sp.lon, p.lat, p.lon)))
                              : null;
                            return (
                              <div key={i} className="flex items-center justify-between text-xs border-b last:border-0 pb-1 last:pb-0" data-testid={`adaptive-point-${i}`}>
                                <div className="flex items-center gap-2">
                                  <div className="w-5 h-5 rounded-full bg-orange-400 text-white flex items-center justify-center text-[9px] font-bold shrink-0">+{i + 1}</div>
                                  <div>
                                    <p className="font-mono text-[10px]">{sp.lat.toFixed(6)}, {sp.lon.toFixed(6)}</p>
                                    <div className="flex items-center gap-2">
                                      {nearestDist !== null && (
                                        <p className="text-[9px] text-muted-foreground">
                                          Dist. al más cercano: {nearestDist > 1000 ? `${(nearestDist / 1000).toFixed(2)} km` : `${Math.round(nearestDist)} m`}
                                        </p>
                                      )}
                                      <p className="text-[9px] text-muted-foreground">
                                        Score: {sp.score > 1000 ? `${(sp.score / 1000).toFixed(2)} km` : `${Math.round(sp.score)} m`}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          });
                        })()}
                      </div>

                      {/* Export CSV */}
                      <div className="px-3 pb-3 flex gap-2">
                        <button
                          className="flex items-center gap-1 text-[10px] text-blue-700 hover:text-blue-900 underline"
                          onClick={() => {
                            const lines = ["No,Latitud,Longitud,Razon"];
                            suggestedPoints.forEach((sp, i) => {
                              lines.push(`${i + 1},${sp.lat.toFixed(7)},${sp.lon.toFixed(7)},Alta incertidumbre LOOCV`);
                            });
                            const blob = new Blob([lines.join("\n")], { type: "text/csv" });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url; a.download = `puntos_adaptativos.csv`; a.click();
                            URL.revokeObjectURL(url);
                          }}
                          data-testid="btn-export-adaptive-csv"
                        >
                          <ExternalLink className="w-3 h-3" /> Exportar CSV
                        </button>
                      </div>

                      <div className="px-3 pb-3">
                        <Button
                          size="sm"
                          className="w-full gap-2 bg-orange-600 hover:bg-orange-700 text-white"
                          onClick={addAdaptivePoints}
                          disabled={addingAdaptive}
                          data-testid="btn-add-adaptive-to-campaign"
                        >
                          {addingAdaptive ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <TrendingUp className="w-3.5 h-3.5" />}
                          {addingAdaptive ? "Añadiendo…" : `Agregar ${suggestedPoints.length} puntos a la campaña`}
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Post-addition N threshold status — based on total planned campaign points */}
                  {addedAdaptiveCount !== null && (() => {
                    // Use total planned (all campaign points) as the denominator for confidence
                    const totalPlannedBefore = points.length - addedAdaptiveCount;
                    const totalPlannedAfter = points.length; // query was invalidated; points includes new
                    const areaHa = polygonAreaHa(polygonCoords);
                    const recommended = Math.max(10, Math.ceil(areaHa / 2));
                    const meetsThreshold = totalPlannedAfter >= recommended;
                    return (
                      <div
                        className={`rounded-md border p-2.5 text-[11px] space-y-0.5 ${meetsThreshold ? "border-green-300 bg-green-50" : "border-amber-300 bg-amber-50"}`}
                        data-testid="adaptive-n-threshold"
                      >
                        <p className={`font-semibold ${meetsThreshold ? "text-green-800" : "text-amber-800"}`}>
                          {meetsThreshold ? "✓ N óptimo alcanzado" : "⚠ Aún por debajo del N óptimo recomendado"}
                        </p>
                        <div className="flex items-center gap-3 font-mono text-[10px] flex-wrap">
                          <span>Puntos planif. antes: <b>{totalPlannedBefore}</b></span>
                          <span>+ Adaptativos: <b>{addedAdaptiveCount}</b></span>
                          <span>→ Total planif.: <b>{totalPlannedAfter}</b></span>
                          <span className="text-muted-foreground">/ {recommended} recomendados (1pt/2ha)</span>
                        </div>
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            )}

            {/* Low-variance warning — when input has very low variability,
                ALL methods correctly converge to ~mean. This warning prevents
                the user from thinking the algorithms are broken when they all
                produce near-identical near-constant grids. */}
            {runResult.low_variance_warning && (
              <Alert className="border-amber-300 bg-amber-50" data-testid="alert-low-variance">
                <AlertCircle className="w-4 h-4 text-amber-700" />
                <AlertTitle className="text-amber-900">Variabilidad insuficiente en los datos</AlertTitle>
                <AlertDescription className="text-amber-800 text-xs space-y-1">
                  <p>{runResult.low_variance_warning}</p>
                  {runResult.input_stats && (
                    <p className="font-mono">
                      n={runResult.input_stats.n} · min={runResult.input_stats.min.toFixed(3)} ·
                      máx={runResult.input_stats.max.toFixed(3)} ·
                      σ={runResult.input_stats.std.toFixed(4)} ·
                      CV={runResult.input_stats.cv_pct != null ? runResult.input_stats.cv_pct.toFixed(2) : "∞"}%
                    </p>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {/* Collapse recovery banner — grid is flat but input has real variability,
                so the current method failed to resolve spatial structure. Offer direct
                one-click retry with methods that handle correlated variability better. */}
            {runResult.near_constant_grid === true &&
              runResult.input_stats?.cv_pct != null &&
              (runResult.input_stats.cv_pct as number) > 5 && (
              <div className="rounded-lg border border-orange-300 bg-orange-50 p-3 space-y-2" data-testid="banner-collapse-recovery">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-orange-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-orange-900">El mapa quedó plano</p>
                    <p className="text-xs text-orange-700 mt-0.5">
                      Los datos tienen variabilidad (CV {(runResult.input_stats!.cv_pct as number).toFixed(1)}%) pero el método actual colapsó a un valor constante.
                      Prueba con un método que modele correlación espacial.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 pl-6">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs border-orange-400 text-orange-800 hover:bg-orange-100"
                    onClick={() => runInterpolation("kriging")}
                    disabled={running}
                    data-testid="btn-recover-kriging"
                  >
                    <Zap className="w-3 h-3 mr-1" />
                    Reintentar con Kriging
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs border-orange-400 text-orange-800 hover:bg-orange-100"
                    onClick={() => runInterpolation("idw")}
                    disabled={running}
                    data-testid="btn-recover-idw"
                  >
                    <Zap className="w-3 h-3 mr-1" />
                    Reintentar con IDW
                  </Button>
                </div>
              </div>
            )}

            {/* Grid stats */}
            {runResult.grid_stats && (
              <Card data-testid="card-grid-stats">
                <CardContent className="p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  {[
                    { label: "Mín", value: runResult.grid_stats.min },
                    { label: "Máx", value: runResult.grid_stats.max },
                    { label: "Media", value: runResult.grid_stats.mean },
                    { label: "Desv.Est.", value: runResult.grid_stats.std },
                  ].map(s => (
                    <div key={s.label}>
                      <p className="text-sm font-bold font-mono text-purple-700">{s.value != null ? Number(s.value).toFixed(2) : "—"}</p>
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Zone histogram */}
            {histogramData.length > 0 && (
              <Card data-testid="card-histogram">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Activity className="w-4 h-4 text-purple-600" /> Distribución de Valores Medidos
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-36">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={histogramData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="bin" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip formatter={(v: number) => [v, "Frecuencia"]} />
                        <Bar dataKey="count" fill="#7c3aed" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Variogram chart */}
            {variogramChartData.length > 0 && (
              <Card data-testid="card-variogram">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-purple-600" /> Semivariograma empírico y modelo ajustado
                    {variogramData?.model && (
                      <span className="text-xs font-normal text-muted-foreground ml-auto">Modelo: {variogramData.model}</span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {fittedVariogram && <p className="text-xs text-muted-foreground mb-2" data-testid="variogram-fit-status">
                    Estado: {fittedVariogram.fit_status ?? fittedVariogram.status}. Distancias en metros; semivarianzas en la escala de ajuste ({runResult.transform_type ?? "none"}).
                    {fittedVariogram.fallback_reason && ` Motivo: ${fittedVariogram.fallback_reason}.`}
                    {" "}No se estimaron intervalos de confianza del ajuste.
                  </p>}
                  <div className="h-44">
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" dataKey="h" name="Distancia (m)" tick={{ fontSize: 10 }} label={{ value: "m", position: "insideBottomRight", offset: 0, fontSize: 11 }} />
                        <YAxis type="number" dataKey="gamma" name="γ(h)" tick={{ fontSize: 10 }} />
                        <Tooltip cursor={{ strokeDasharray: "3 3" }} formatter={(v: number) => Number(v).toFixed(5)} />
                        <Scatter name="Experimental" data={variogramChartData} fill="#7c3aed" opacity={0.8} />
                        {variogramFittedData.length > 0 && (
                          <Scatter
                            name="Modelo"
                            data={variogramFittedData}
                            fill="#f59e0b"
                            opacity={0.9}
                            line={{ stroke: "#f59e0b", strokeWidth: 1.5 }}
                            lineType="joint"
                          />
                        )}
                        {variogramData?.range && (
                          <ReferenceLine x={Number(variogramData.range)} stroke="#10b981" strokeDasharray="4 4" label={{ value: "rango", fontSize: 10 }} />
                        )}
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                  {fittedVariogram?.empirical && (
                    <details className="text-xs mt-2" data-testid="variogram-pair-counts">
                      <summary>Pares por clase de distancia</summary>
                      <table className="w-full mt-2"><thead><tr><th>Distancia (m)</th><th>γ(h)</th><th>Pares</th></tr></thead>
                        <tbody>{fittedVariogram.empirical.map((b, i) => <tr key={i}><td>{b.distance.toFixed(1)}</td><td>{b.semivariance.toFixed(4)}</td><td>{b.n_pairs}</td></tr>)}</tbody>
                      </table>
                    </details>
                  )}
                  {(variogramData?.range || variogramData?.sill) && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2 text-center">
                      {[
                        { label: "Rango", value: variogramData.range },
                        { label: "Sill", value: variogramData.sill },
                        { label: "Nugget", value: variogramData.nugget },
                      ].map(v => (
                        <div key={v.label} className="bg-muted/40 rounded p-1.5">
                          <p className="text-xs font-mono font-semibold">{v.value ? Number(v.value).toFixed(3) : "—"}</p>
                          <p className="text-[10px] text-muted-foreground">{v.label}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Zones bar chart */}
            {(runResult.zones?.length ?? 0) > 0 && (
              <Card data-testid="card-zone-bars">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Layers className="w-4 h-4 text-purple-600" /> Zonas de Manejo ({runResult.zones?.length ?? 0})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-36">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={zoneBarData}
                        margin={{ top: 5, right: 5, left: -20, bottom: 5 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip />
                        <Bar dataKey="mean" name="Media" radius={[4, 4, 0, 0]}>
                          {(runResult.zones ?? []).map((_: ManagementZone, i: number) => (
                            <Cell key={i} fill={runResult.zones?.[i]?.colorHex ?? ZONE_COLORS[i] ?? "#888"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* GeoTIFF download + Go to zones */}
            <div className="flex gap-2">
              {latestInterpId && (
                <a
                  href={`/api/interpolations/${latestInterpId}/geotiff`}
                  download={`interpolation-${latestInterpId}.tif`}
                  data-testid="link-download-geotiff"
                  className="flex-none"
                >
                  <Button variant="outline" size="sm" className="gap-1 h-full" title="Descargar raster GeoTIFF Float32 (EPSG:4326)">
                    <Download className="w-4 h-4" /> GeoTIFF
                  </Button>
                </a>
              )}
              <Button
                className="flex-1 gap-2 bg-purple-600 hover:bg-purple-700"
                onClick={handleGoToZones}
                data-testid="btn-go-zones"
              >
                Ver Zonas de Manejo <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </>
        )}

        {/* Comparison table */}
        {comparison && comparison.comparison.length > 0 && wizardStep === 3 && (
          <Card data-testid="card-comparison">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-purple-600" /> Comparación de Métodos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-1 pr-2 font-medium text-muted-foreground">Método</th>
                      <th className="text-right py-1 pr-2 font-medium text-muted-foreground">RMSE</th>
                      <th className="text-right py-1 pr-2 font-medium text-muted-foreground">MAE</th>
                      <th className="text-right py-1 font-medium text-muted-foreground">R²</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.comparison.map((c: ComparisonEntry) => {
                      const isBest = comparison.best?.id === c.id;
                      const rowBg = isBest
                        ? (c.isFallback ? "bg-amber-50" : "bg-green-50")
                        : c.isFallback ? "bg-amber-50/40" : "";
                      return (
                      <tr key={c.id} className={`border-b last:border-0 ${isBest ? "font-semibold" : ""} ${rowBg}`} data-testid={`row-compare-${c.method}`}>
                        <td className="py-1.5 pr-2">
                          <span title={c.isFallback && c.fallbackReason ? c.fallbackReason : undefined}>
                            {c.method.toUpperCase()}
                            {c.isFallback && <span className="text-muted-foreground font-normal"> → IDW</span>}
                          </span>
                          {isBest && !c.isFallback && <Badge className="ml-1 text-[9px] py-0 px-1 bg-green-100 text-green-700 border-green-200">Mejor</Badge>}
                          {isBest && c.isFallback && <Badge className="ml-1 text-[9px] py-0 px-1 bg-amber-100 text-amber-700 border-amber-200">Mejor</Badge>}
                          {c.isFallback && <Badge className="ml-1 text-[9px] py-0 px-1 bg-amber-100 text-amber-600 border-amber-200">fallback</Badge>}
                        </td>
                        <td className="text-right py-1.5 pr-2 font-mono">{c.rmseCv != null ? Number(c.rmseCv).toFixed(3) : "—"}</td>
                        <td className="text-right py-1.5 pr-2 font-mono">{c.maeCv != null ? Number(c.maeCv).toFixed(3) : "—"}</td>
                        <td className="text-right py-1.5 font-mono">{c.r2Cv != null ? Number(c.r2Cv).toFixed(3) : "—"}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Previous interpolations list — shown when no fresh run result is loaded */}
        {!runResult && prevInterpolations.length > 0 && (
          <Card data-testid="card-prev-interpolations">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Interpolaciones Anteriores</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {prevInterpolations.map((interp: InterpolationResult) => (
                <div key={interp.id} className="flex items-center justify-between p-2.5 rounded-lg bg-muted/40 hover:bg-muted/60 transition-colors" data-testid={`card-prev-${interp.id}`}>
                  <div>
                    <p className="text-xs font-semibold">{interp.method.toUpperCase()}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(interp.createdAt).toLocaleDateString("es-MX")}
                      {interp.r2Cv ? ` · R²=${Number(interp.r2Cv).toFixed(2)}` : ""}
                      {interp.rasterUrl ? " · 🗺" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-purple-700 hover:bg-purple-50"
                      onClick={() => loadSavedInterp(interp)}
                      data-testid={`btn-load-interp-${interp.id}`}
                    >
                      Cargar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-muted-foreground hover:bg-muted"
                      onClick={() => setLocation(`/parcel/${id}/zones?interpolation=${interp.id}`)}
                      data-testid={`btn-view-zones-${interp.id}`}
                    >
                      Zonas <ChevronRight className="w-3 h-3 ml-1" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {!runResult && prevInterpolations.length === 0 && measuredPoints.length >= 3 && (
          <div className="text-center py-6 text-muted-foreground text-sm" data-testid="text-no-interpolations">
            Ejecuta la primera interpolación con el botón de arriba.
          </div>
        )}
      </div>
    </div>
  );
}

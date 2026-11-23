import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Loader2, Trash2, Microscope, Calendar, FlaskConical, Info, TrendingUp, Download, AlertTriangle, Satellite, Leaf, Droplets, BarChart2, ChevronRight, ClipboardCheck } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { MICROBIOLOGY_CAVEAT, microbiologyEvidence } from "@shared/agronomic-evidence";
import { formatMexicoDate, mexicoDateKey } from "@shared/civil-date";

interface SoilBiology {
  id: string;
  parcelId: string;
  userId: string;
  sampleDate: string;
  depthCm: number;
  dataSource: string;
  mbc: string | null;
  mr: string | null;
  bg: string | null;
  nag: string | null;
  dnaYield: string | null;
  labFolio: string | null;
  labName: string | null;
  microbiologyMethod: string | null;
  trichodermaCfu: string | null;
  fusariumCfu: string | null;
  bacillusCfu: string | null;
  metarhiziumCfu: string | null;
  metarhiziumStatus: "counted" | "not_detected" | "not_analyzed" | null;
  beauveriaCfu: string | null;
  beauveriaStatus: "counted" | "not_detected" | "not_analyzed" | null;
  nitrogenFixersStatus: "detected" | "not_detected" | "not_analyzed" | null;
  notes: string | null;
  aiInterpretation: string | null;
  createdAt: string;
}

type ManualBiologyForm = {
  sampleDate: string;
  depthCm: string;
  dataSource: string;
  mbc: string;
  mr: string;
  bg: string;
  nag: string;
  dnaYield: string;
  notes: string;
  labFolio: string;
  labName: string;
  microbiologyMethod: string;
  trichodermaCfu: string;
  fusariumCfu: string;
  bacillusCfu: string;
  metarhiziumCfu: string;
  metarhiziumStatus: "counted" | "not_detected" | "not_analyzed" | "";
  beauveriaCfu: string;
  beauveriaStatus: "counted" | "not_detected" | "not_analyzed" | "";
  nitrogenFixersStatus: "detected" | "not_detected" | "not_analyzed" | "";
};

interface SatelliteResult {
  mode: "single";
  record: SoilBiology;
  satellite: { date: string; ndvi: number; evi: number; ndmi: number; source: string };
}

interface PeriodResult {
  mode: "period";
  count: number;
  records: SoilBiology[];
  summary: { dateFrom: string; dateTo: string; imagesFound: number; source: string };
}

interface ReferenceRange {
  low: number;
  medium: number;
  high: number;
  unit: string;
  label: string;
  description: string;
}

const REFERENCE_RANGES: Record<string, ReferenceRange> = {
  mbc: {
    low: 100, medium: 300, high: 600,
    unit: "μg C g⁻¹",
    label: "Biomasa Microbiana (MBC)",
    description: "Carbono de la biomasa microbiana: mide la masa total de microorganismos vivos. Valores altos indican suelo biológicamente activo.",
  },
  mr: {
    low: 0.5, medium: 2.0, high: 5.0,
    unit: "μg C g⁻¹ d⁻¹",
    label: "Respiración Microbiana (MR)",
    description: "CO₂ liberado por los microorganismos. Indica actividad metabólica y descomposición de materia orgánica.",
  },
  bg: {
    low: 50, medium: 150, high: 400,
    unit: "nmol g⁻¹ h⁻¹",
    label: "β-Glucosidasa (BG)",
    description: "Enzima clave en el ciclo del carbono. Degrada celulosa en glucosa disponible para microorganismos.",
  },
  nag: {
    low: 20, medium: 80, high: 200,
    unit: "nmol g⁻¹ h⁻¹",
    label: "N-Acetil-Glucosaminidasa (NAG)",
    description: "Enzima del ciclo del nitrógeno. Libera N de quitina fúngica y peptidoglicano bacteriano.",
  },
  dnaYield: {
    low: 10, medium: 30, high: 60,
    unit: "μg ADN g⁻¹",
    label: "Rendimiento de ADN",
    description: "ADN metagenómico extraído. Refleja diversidad y abundancia de la comunidad microbiana.",
  },
};

function getHealthStatus(value: number, ranges: ReferenceRange) {
  if (value >= ranges.high)   return { label: "Excelente", color: "text-emerald-700", bg: "bg-emerald-100", bar: "bg-emerald-500" };
  if (value >= ranges.medium) return { label: "Bueno",     color: "text-green-700",   bg: "bg-green-100",   bar: "bg-green-500"   };
  if (value >= ranges.low)    return { label: "Moderado",  color: "text-amber-700",   bg: "bg-amber-100",   bar: "bg-amber-500"   };
  return                             { label: "Bajo",      color: "text-red-700",     bg: "bg-red-100",     bar: "bg-red-500"     };
}

function HealthBar({ value, ranges }: { value: number; ranges: ReferenceRange }) {
  const max = ranges.high * 1.5;
  const pct = Math.min((value / max) * 100, 100);
  const { bar } = getHealthStatus(value, ranges);
  return (
    <div className="mt-1">
      <div className="w-full bg-muted rounded-full h-1.5 relative overflow-hidden">
        <div className={`h-1.5 rounded-full transition-all ${bar}`} style={{ width: `${pct}%` }} />
        <div className="absolute top-0 h-1.5 w-px bg-amber-400" style={{ left: `${Math.min((ranges.low / max) * 100, 100)}%` }} />
        <div className="absolute top-0 h-1.5 w-px bg-green-500" style={{ left: `${Math.min((ranges.medium / max) * 100, 100)}%` }} />
        <div className="absolute top-0 h-1.5 w-px bg-emerald-600" style={{ left: `${Math.min((ranges.high / max) * 100, 100)}%` }} />
      </div>
    </div>
  );
}

function MetricCard({ metricKey, value, ranges }: { metricKey: string; value: string | null | undefined; ranges: ReferenceRange }) {
  if (!value) return null;
  const num = parseFloat(value);
  if (isNaN(num)) return null;
  const status = getHealthStatus(num, ranges);
  return (
    <div className="p-3 rounded-lg border bg-card" data-testid={`metric-card-${metricKey}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-muted-foreground truncate pr-1">{ranges.label}</span>
        <Badge className={`text-xs shrink-0 ${status.bg} ${status.color} border-0`} data-testid={`badge-health-${metricKey}`}>
          {status.label}
        </Badge>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-xl font-bold" data-testid={`value-${metricKey}`}>
          {num.toFixed(metricKey === "mr" ? 3 : metricKey === "dnaYield" ? 2 : 1)}
        </span>
        <span className="text-xs text-muted-foreground">{ranges.unit}</span>
      </div>
      <HealthBar value={num} ranges={ranges} />
    </div>
  );
}

const dataSourceLabels: Record<string, string> = {
  satellite: "Satélite Sentinel-2",
  lab: "Laboratorio convencional",
  nir: "Espectroscopía NIR",
  mir: "Espectroscopía MIR",
  estimated: "Estimado por plataforma",
};

const dataSourceColors: Record<string, string> = {
  satellite: "bg-sky-100 text-sky-800",
  lab: "bg-blue-100 text-blue-800",
  nir: "bg-purple-100 text-purple-800",
  mir: "bg-violet-100 text-violet-800",
  estimated: "bg-gray-100 text-gray-800",
};

const dataSourceReliability: Record<string, { level: string; note: string }> = {
  satellite: {
    level: "orientativa",
    note: "Estimado desde índices de vegetación Sentinel-2 aplicando funciones de pedotransferencia (Sainju 2014; Jin 2020; García-Ruiz 2008). Incertidumbre típica ±30%. Usar como diagnóstico inicial; validar con laboratorio cuando sea posible.",
  },
  lab: {
    level: "alta",
    note: "Método de referencia. Resultados cuantitativos con alta precisión analítica.",
  },
  nir: {
    level: "moderada",
    note: "Confiabilidad moderada. Depende de la calibración local del equipo y la humedad de la muestra.",
  },
  mir: {
    level: "moderada",
    note: "Confiabilidad moderada-alta con buena calibración.",
  },
  estimated: {
    level: "orientativa",
    note: "Estimación con baja confiabilidad. Usar únicamente como referencia orientativa.",
  },
};

interface SoilBiologyTabProps {
  parcelId: string;
  crop: string;
  onOpenFieldAssessment?: () => void;
}

// Config for the time-series chart tabs
const CHART_METRICS = [
  { key: "MBC",  label: "MBC",  unit: "μg C g⁻¹",      color: "#16a34a", refLow: 100, refMed: 300, refHigh: 600 },
  { key: "MR",   label: "MR",   unit: "μg C g⁻¹ d⁻¹",  color: "#2563eb", refLow: 0.5, refMed: 2.0, refHigh: 5.0 },
  { key: "BG",   label: "BG",   unit: "nmol g⁻¹ h⁻¹",  color: "#d97706", refLow: 50,  refMed: 150, refHigh: 400 },
  { key: "NAG",  label: "NAG",  unit: "nmol g⁻¹ h⁻¹",  color: "#7c3aed", refLow: 20,  refMed: 80,  refHigh: 200 },
  { key: "DNA",  label: "ADN",  unit: "μg g⁻¹",         color: "#0891b2", refLow: 10,  refMed: 30,  refHigh: 60  },
] as const;

type ChartKey = typeof CHART_METRICS[number]["key"];

export default function SoilBiologyTab({ parcelId, crop, onOpenFieldAssessment }: SoilBiologyTabProps) {
  const queryClient = useQueryClient();
  const [showManualForm, setShowManualForm] = useState(false);
  const [satMode, setSatMode] = useState<"single" | "period">("single");
  const [satelliteResult, setSatelliteResult] = useState<SatelliteResult | null>(null);
  const [periodResult, setPeriodResult] = useState<PeriodResult | null>(null);
  const [targetDate, setTargetDate] = useState(mexicoDateKey(new Date()));
  const today = mexicoDateKey(new Date());
  const threeMonthsAgo = mexicoDateKey(new Date(Date.now() - 90 * 86_400_000));
  const [dateFrom, setDateFrom] = useState(threeMonthsAgo);
  const [dateTo, setDateTo] = useState(today);
  const [chartMetric, setChartMetric] = useState<ChartKey>("MBC");
  const [formData, setFormData] = useState<ManualBiologyForm>({
    sampleDate: mexicoDateKey(new Date()),
    depthCm: "20", dataSource: "lab",
    mbc: "", mr: "", bg: "", nag: "", dnaYield: "", notes: "",
    labFolio: "", labName: "", microbiologyMethod: "",
    trichodermaCfu: "", fusariumCfu: "", bacillusCfu: "",
    metarhiziumCfu: "", metarhiziumStatus: "",
    beauveriaCfu: "", beauveriaStatus: "",
    nitrogenFixersStatus: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["soil-biology", parcelId],
    queryFn: async () => {
      const res = await fetch(`/api/parcels/${parcelId}/soil-biology`, { credentials: "include" });
      if (!res.ok) return { records: [] };
      return res.json();
    },
    enabled: !!parcelId,
  });

  const records: SoilBiology[] = data?.records || [];

  // Single-date estimation
  const satelliteMutation = useMutation({
    mutationFn: async (date: string) => {
      const res = await fetch(`/api/parcels/${parcelId}/soil-biology/estimate-from-satellite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ targetDate: date }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Error al estimar parámetros");
      }
      return res.json() as Promise<SatelliteResult>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["soil-biology", parcelId] });
      setSatelliteResult(result);
    },
  });

  // Period estimation
  const periodMutation = useMutation({
    mutationFn: async ({ from, to }: { from: string; to: string }) => {
      const res = await fetch(`/api/parcels/${parcelId}/soil-biology/estimate-from-satellite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ dateFrom: from, dateTo: to }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Error al analizar el período");
      }
      return res.json() as Promise<PeriodResult>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["soil-biology", parcelId] });
      setPeriodResult(result);
    },
  });

  // Manual creation
  const createMutation = useMutation({
    mutationFn: async (payload: typeof formData) => {
      const microbialFields = payload.dataSource === "lab" ? {
        labFolio: payload.labFolio.trim() || null,
        labName: payload.labName.trim() || null,
        microbiologyMethod: payload.microbiologyMethod.trim() || null,
        trichodermaCfu: payload.trichodermaCfu === "" ? null : payload.trichodermaCfu,
        fusariumCfu: payload.fusariumCfu === "" ? null : payload.fusariumCfu,
        bacillusCfu: payload.bacillusCfu === "" ? null : payload.bacillusCfu,
        ...(payload.metarhiziumStatus === "counted" && payload.metarhiziumCfu !== "" ? { metarhiziumCfu: payload.metarhiziumCfu } : {}),
        metarhiziumStatus: payload.metarhiziumStatus || null,
        ...(payload.beauveriaStatus === "counted" && payload.beauveriaCfu !== "" ? { beauveriaCfu: payload.beauveriaCfu } : {}),
        beauveriaStatus: payload.beauveriaStatus || null,
        nitrogenFixersStatus: payload.nitrogenFixersStatus || null,
      } : {};
      const res = await fetch(`/api/parcels/${parcelId}/soil-biology`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          sampleDate: payload.sampleDate,
          depthCm: parseInt(payload.depthCm) || 20,
          dataSource: payload.dataSource,
          mbc: payload.mbc || null, mr: payload.mr || null,
          bg: payload.bg || null, nag: payload.nag || null,
          dnaYield: payload.dnaYield || null, notes: payload.notes || null,
          ...microbialFields,
        }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message || error.error || "Error al guardar registro");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["soil-biology", parcelId] });
      setShowManualForm(false);
      setFormData({
        sampleDate: mexicoDateKey(new Date()), depthCm: "20", dataSource: "lab",
        mbc: "", mr: "", bg: "", nag: "", dnaYield: "", notes: "",
        labFolio: "", labName: "", microbiologyMethod: "", trichodermaCfu: "", fusariumCfu: "", bacillusCfu: "",
        metarhiziumCfu: "", metarhiziumStatus: "", beauveriaCfu: "", beauveriaStatus: "",
        nitrogenFixersStatus: "",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/parcels/${parcelId}/soil-biology/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Error al eliminar");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["soil-biology", parcelId] }),
  });

  const latest = records[0];
  const reliability = latest ? dataSourceReliability[latest.dataSource] : null;
  const latestMicrobiology = latest ? microbiologyEvidence(latest) : null;
  const formatMicrobeStatus = (status: string) => ({
    counted: "Conteo registrado",
    not_detected: "No detectado",
    not_analyzed: "No analizado",
    detected: "Detectado",
  }[status] || status);

  // Chart data — chronological order, all 5 metrics
  const chartData = [...records].reverse().map((r) => ({
    fecha: formatMexicoDate(r.sampleDate, { month: "short", day: "numeric", year: "2-digit" }),
    fullDate: mexicoDateKey(r.sampleDate),
    source: r.dataSource,
    MBC: r.mbc ? parseFloat(r.mbc) : null,
    MR:  r.mr  ? parseFloat(r.mr)  : null,
    BG:  r.bg  ? parseFloat(r.bg)  : null,
    NAG: r.nag ? parseFloat(r.nag) : null,
    DNA: r.dnaYield ? parseFloat(r.dnaYield) : null,
  }));

  const hasChartData = chartData.length >= 2;
  const activeMeta = CHART_METRICS.find(m => m.key === chartMetric)!;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2" data-testid="text-biology-title">
            <Microscope className="w-5 h-5 text-green-700" /> Biología del Suelo
          </h3>
          <p className="text-sm text-muted-foreground">
            Estimación satelital de actividad microbiana mediante índices Sentinel-2 · seguimiento histórico.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {onOpenFieldAssessment && <Button variant="outline" size="sm" onClick={onOpenFieldAssessment} data-testid="button-open-field-assessment"><ClipboardCheck className="mr-1.5 h-4 w-4" /> Evaluación de campo</Button>}
          {records.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => window.open(`/api/parcels/${parcelId}/soil-biology/export`, "_blank")} data-testid="button-export-biology-csv">
              <Download className="w-4 h-4 mr-1" /> CSV
            </Button>
          )}
        </div>
      </div>

      {/* Satellite estimation card */}
      <Card className="border-sky-200 bg-sky-50/50" data-testid="card-satellite-action">
        <CardContent className="pt-5 pb-4">
          <div className="flex items-start gap-4">
            <div className="rounded-full bg-sky-100 p-3 shrink-0">
              <Satellite className="w-6 h-6 text-sky-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="font-semibold text-sm mb-1">Estimación satelital</h4>

              {/* Mode toggle */}
              <div className="flex gap-1 mb-3 p-1 bg-white rounded-lg border border-sky-200 w-fit" data-testid="sat-mode-toggle">
                <button
                  onClick={() => { setSatMode("single"); setSatelliteResult(null); setPeriodResult(null); }}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${satMode === "single" ? "bg-sky-600 text-white" : "text-muted-foreground hover:text-foreground"}`}
                  data-testid="mode-single"
                >
                  Fecha puntual
                </button>
                <button
                  onClick={() => { setSatMode("period"); setSatelliteResult(null); setPeriodResult(null); }}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${satMode === "period" ? "bg-sky-600 text-white" : "text-muted-foreground hover:text-foreground"}`}
                  data-testid="mode-period"
                >
                  Período de tiempo
                </button>
              </div>

              {satMode === "single" ? (
                <>
                  <p className="text-xs text-muted-foreground mb-3">
                    El sistema busca la imagen Sentinel-2 más cercana a la fecha elegida (±20 días).
                  </p>
                  <div className="flex items-end gap-2 flex-wrap mb-3">
                    <div>
                      <Label htmlFor="sat-date" className="text-xs text-muted-foreground mb-1 block">Fecha de imagen</Label>
                      <Input
                        id="sat-date" type="date" value={targetDate} max={today}
                        onChange={(e) => { setTargetDate(e.target.value); setSatelliteResult(null); }}
                        className="h-8 text-sm w-40" data-testid="input-sat-date"
                      />
                    </div>
                    <Button size="sm" className="bg-sky-600 hover:bg-sky-700 text-white h-8"
                      onClick={() => { setSatelliteResult(null); satelliteMutation.mutate(targetDate); }}
                      disabled={satelliteMutation.isPending || !targetDate} data-testid="button-estimate-satellite">
                      {satelliteMutation.isPending
                        ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Analizando…</>
                        : <><Satellite className="w-4 h-4 mr-2" />Estimar</>}
                    </Button>
                    <Button variant="ghost" size="sm" className="text-xs text-muted-foreground h-8" onClick={() => setShowManualForm(true)} data-testid="button-manual-entry">
                      <Plus className="w-3.5 h-3.5 mr-1" /> Manual
                    </Button>
                  </div>

                  {/* Single result preview */}
                  {satelliteResult && !satelliteMutation.isPending && (
                    <div className="p-3 rounded-lg bg-white border border-sky-200" data-testid="card-satellite-preview">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <Badge className="bg-sky-100 text-sky-800 border-0 text-xs">
                          <Satellite className="w-3 h-3 mr-1" />
                          {satelliteResult.satellite.source === "sentinel2" ? "Sentinel-2" : "Simulado"}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          Imagen: <strong>{formatMexicoDate(satelliteResult.satellite.date)}</strong>
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 mb-2">
                        <div className="text-center">
                          <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground mb-0.5">
                            <Leaf className="w-3 h-3 text-green-600" /> NDVI
                          </div>
                          <span className="text-sm font-bold text-green-700" data-testid="value-sat-ndvi">{satelliteResult.satellite.ndvi.toFixed(3)}</span>
                        </div>
                        <div className="text-center">
                          <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground mb-0.5">
                            <BarChart2 className="w-3 h-3 text-emerald-600" /> EVI
                          </div>
                          <span className="text-sm font-bold text-emerald-700" data-testid="value-sat-evi">{satelliteResult.satellite.evi.toFixed(3)}</span>
                        </div>
                        <div className="text-center">
                          <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground mb-0.5">
                            <Droplets className="w-3 h-3 text-blue-500" /> NDMI
                          </div>
                          <span className="text-sm font-bold text-blue-600" data-testid="value-sat-ndmi">{satelliteResult.satellite.ndmi.toFixed(3)}</span>
                        </div>
                      </div>
                      <p className="text-xs text-emerald-700 font-medium flex items-center gap-1">
                        <ChevronRight className="w-3 h-3" /> Guardado · Incertidumbre ±30%
                      </p>
                    </div>
                  )}
                  {satelliteMutation.isError && (
                    <div className="flex items-start gap-2 text-xs text-destructive bg-red-50 border border-red-200 rounded-md p-2">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>{(satelliteMutation.error as Error)?.message}</span>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground mb-3">
                    Analizá <strong>todas</strong> las imágenes Sentinel-2 disponibles entre dos fechas.
                    Cada imagen genera un registro automático — ideal para ver la evolución de un ciclo completo.
                  </p>
                  <div className="flex items-end gap-2 flex-wrap mb-3">
                    <div>
                      <Label htmlFor="date-from" className="text-xs text-muted-foreground mb-1 block">Desde</Label>
                      <Input
                        id="date-from" type="date" value={dateFrom} max={dateTo}
                        onChange={(e) => { setDateFrom(e.target.value); setPeriodResult(null); }}
                        className="h-8 text-sm w-36" data-testid="input-date-from"
                      />
                    </div>
                    <div>
                      <Label htmlFor="date-to" className="text-xs text-muted-foreground mb-1 block">Hasta</Label>
                      <Input
                        id="date-to" type="date" value={dateTo} min={dateFrom} max={today}
                        onChange={(e) => { setDateTo(e.target.value); setPeriodResult(null); }}
                        className="h-8 text-sm w-36" data-testid="input-date-to"
                      />
                    </div>
                    <Button size="sm" className="bg-sky-600 hover:bg-sky-700 text-white h-8"
                      onClick={() => { setPeriodResult(null); periodMutation.mutate({ from: dateFrom, to: dateTo }); }}
                      disabled={periodMutation.isPending || !dateFrom || !dateTo} data-testid="button-estimate-period">
                      {periodMutation.isPending
                        ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Analizando período…</>
                        : <><Satellite className="w-4 h-4 mr-2" />Analizar período</>}
                    </Button>
                    <Button variant="ghost" size="sm" className="text-xs text-muted-foreground h-8" onClick={() => setShowManualForm(true)} data-testid="button-manual-entry">
                      <Plus className="w-3.5 h-3.5 mr-1" /> Manual
                    </Button>
                  </div>

                  {/* Period result banner */}
                  {periodResult && !periodMutation.isPending && (
                    <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200" data-testid="card-period-preview">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Badge className="bg-emerald-100 text-emerald-800 border-0 text-xs">
                          <TrendingUp className="w-3 h-3 mr-1" />
                          {periodResult.count} registro{periodResult.count !== 1 ? "s" : ""} creados
                        </Badge>
                        <Badge className="bg-sky-100 text-sky-800 border-0 text-xs">
                          {periodResult.summary.source === "sentinel2" ? "Sentinel-2" : "Simulado"}
                        </Badge>
                      </div>
                      <p className="text-xs text-emerald-800 font-medium">
                        {formatMexicoDate(periodResult.summary.dateFrom, { month: "short", day: "numeric", year: "numeric" })}
                        {" — "}
                        {formatMexicoDate(periodResult.summary.dateTo, { month: "short", day: "numeric", year: "numeric" })}
                        {" · "}{periodResult.summary.imagesFound} imagen{periodResult.summary.imagesFound !== 1 ? "es" : ""} Sentinel-2
                      </p>
                      <p className="text-xs text-emerald-700 mt-1 flex items-center gap-1">
                        <ChevronRight className="w-3 h-3" /> Ver la evolución en el gráfico de abajo · Incertidumbre ±30%
                      </p>
                    </div>
                  )}
                  {periodMutation.isError && (
                    <div className="flex items-start gap-2 text-xs text-destructive bg-red-50 border border-red-200 rounded-md p-2">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>{(periodMutation.error as Error)?.message}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Latest indicators */}
      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : latest ? (
        <>
          <div>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Último registro</h4>
              <Badge variant="outline" className="text-xs">
                <Calendar className="w-3 h-3 mr-1" />
                {formatMexicoDate(latest.sampleDate)}
              </Badge>
              <Badge className={`text-xs ${dataSourceColors[latest.dataSource] || "bg-gray-100 text-gray-800"} border-0`}>
                {dataSourceLabels[latest.dataSource] || latest.dataSource}
              </Badge>
            </div>
            {reliability && reliability.level !== "alta" && (
              <div className="mb-3 p-2 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2" data-testid="alert-source-reliability">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span><strong>Confiabilidad {reliability.level}:</strong> {reliability.note}</span>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="grid-indicators">
              {Object.entries(REFERENCE_RANGES).map(([key, ranges]) => (
                <MetricCard key={key} metricKey={key} value={latest[key as keyof SoilBiology] as string | null} ranges={ranges} />
              ))}
            </div>
            {latestMicrobiology && latest.dataSource === "lab" && (
              <div className="mt-3 rounded-lg border p-3 space-y-2" data-testid="latest-microbiology-evidence">
                <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Evidencia microbiológica del laboratorio</h5>
                {(latestMicrobiology.lab || latestMicrobiology.folio || latestMicrobiology.method) && (
                  <p className="text-xs text-muted-foreground">
                    {[latestMicrobiology.lab, latestMicrobiology.folio && `Folio ${latestMicrobiology.folio}`, latestMicrobiology.method && `Método: ${latestMicrobiology.method}`].filter(Boolean).join(" · ")}
                  </p>
                )}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {latestMicrobiology.trichodermaCfu !== null && <span>Trichoderma: <strong>{latestMicrobiology.trichodermaCfu.toLocaleString("es-MX")} UFC/g</strong></span>}
                  {latestMicrobiology.fusariumCfu !== null && <span>Fusarium: <strong>{latestMicrobiology.fusariumCfu.toLocaleString("es-MX")} UFC/g</strong></span>}
                  {latestMicrobiology.bacillusCfu !== null && <span>Bacillus: <strong>{latestMicrobiology.bacillusCfu.toLocaleString("es-MX")} UFC/g</strong></span>}
                  <span>Metarhizium: <strong>{latestMicrobiology.metarhiziumStatus === "counted" ? `${latestMicrobiology.metarhiziumCfu?.toLocaleString("es-MX") ?? "—"} UFC/g` : formatMicrobeStatus(latestMicrobiology.metarhiziumStatus)}</strong></span>
                  <span>Beauveria: <strong>{latestMicrobiology.beauveriaStatus === "counted" ? `${latestMicrobiology.beauveriaCfu?.toLocaleString("es-MX") ?? "—"} UFC/g` : formatMicrobeStatus(latestMicrobiology.beauveriaStatus)}</strong></span>
                  <span>Fijadores de N: <strong>{formatMicrobeStatus(latestMicrobiology.nitrogenFixersStatus)}</strong></span>
                  <span>Relación Trichoderma/Fusarium: <strong>{latestMicrobiology.trichodermaFusariumRatio === null ? "No calculable" : latestMicrobiology.trichodermaFusariumRatio.toFixed(2)}</strong>{latestMicrobiology.ratioCaveat && <span className="ml-1 text-muted-foreground">({latestMicrobiology.ratioCaveat})</span>}</span>
                </div>
                <p className="text-xs text-muted-foreground">{MICROBIOLOGY_CAVEAT}</p>
              </div>
            )}
          </div>

          {/* Time-series chart — tabbed by indicator */}
          {hasChartData && (
            <Card data-testid="card-time-series">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" /> Evolución Temporal
                </CardTitle>
                <CardDescription>{records.length} medición{records.length !== 1 ? "es" : ""} · selecciona el indicador a graficar</CardDescription>
              </CardHeader>
              <CardContent>
                {/* Metric tabs */}
                <div className="flex gap-1 flex-wrap mb-4" data-testid="chart-metric-tabs">
                  {CHART_METRICS.map((m) => (
                    <button
                      key={m.key}
                      onClick={() => setChartMetric(m.key)}
                      data-testid={`tab-chart-${m.key}`}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors border ${
                        chartMetric === m.key
                          ? "text-white border-transparent"
                          : "bg-muted text-muted-foreground border-transparent hover:bg-muted/80"
                      }`}
                      style={chartMetric === m.key ? { backgroundColor: m.color, borderColor: m.color } : {}}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="fecha" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 11 }} unit="" width={50} />
                    <Tooltip
                      formatter={(value: number) => [
                        `${value.toFixed(activeMeta.key === "MR" ? 3 : 1)} ${activeMeta.unit}`,
                        activeMeta.label,
                      ]}
                      labelFormatter={(label) => `Fecha: ${label}`}
                    />
                    <ReferenceLine
                      y={activeMeta.refLow}
                      stroke="#f59e0b" strokeDasharray="3 3"
                      label={{ value: "bajo", position: "insideTopRight", fontSize: 9, fill: "#f59e0b" }}
                    />
                    <ReferenceLine
                      y={activeMeta.refMed}
                      stroke="#22c55e" strokeDasharray="3 3"
                      label={{ value: "bueno", position: "insideTopRight", fontSize: 9, fill: "#22c55e" }}
                    />
                    <ReferenceLine
                      y={activeMeta.refHigh}
                      stroke="#10b981" strokeDasharray="3 3"
                      label={{ value: "excel.", position: "insideTopRight", fontSize: 9, fill: "#10b981" }}
                    />
                    <Line
                      type="monotone"
                      dataKey={chartMetric}
                      stroke={activeMeta.color}
                      strokeWidth={2}
                      dot={{ r: 5, fill: activeMeta.color }}
                      activeDot={{ r: 7 }}
                      name={`${activeMeta.label} (${activeMeta.unit})`}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
                <p className="text-xs text-muted-foreground text-center mt-1">
                  Líneas de referencia: amarilla = umbral bajo · verde claro = bueno · verde = excelente
                </p>
              </CardContent>
            </Card>
          )}

          {/* Prompt to add more points */}
          {records.length === 1 && (
            <div className="text-xs text-muted-foreground text-center py-1 italic">
              Estima en otra fecha para ver la evolución en el tiempo.
            </div>
          )}
        </>
      ) : (
        <Card className="border-dashed" data-testid="card-empty-biology">
          <CardContent className="py-10 text-center">
            <Satellite className="w-10 h-10 mx-auto mb-3 text-sky-400 opacity-70" />
            <p className="text-sm font-medium text-muted-foreground">Sin registros de biología del suelo</p>
            <p className="text-xs text-muted-foreground mt-1">
              Elige una fecha y haz clic en <strong>Estimar</strong> para comenzar tu serie histórica.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Reference ranges */}
      <Card className="border-dashed" data-testid="card-reference-info">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
            <Info className="w-4 h-4" /> Rangos de referencia
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {Object.entries(REFERENCE_RANGES).map(([key, r]) => (
              <div key={key} className="text-xs text-muted-foreground">
                <span className="font-medium">{r.label}</span> ({r.unit}):{"  "}
                &lt;{r.low} bajo · {r.low}–{r.medium} moderado · {r.medium}–{r.high} bueno · &gt;{r.high} excelente
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2 italic">
            Rangos orientativos para suelos agrícolas. Estimación satelital con incertidumbre ±30%.
          </p>
        </CardContent>
      </Card>

      {/* History list */}
      {records.length > 0 && (
        <Card data-testid="card-history">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FlaskConical className="w-4 h-4" /> Historial de registros
            </CardTitle>
            <CardDescription>{records.length} medición{records.length !== 1 ? "es" : ""}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2" data-testid="list-biology-records">
              {records.map((r) => (
                <div key={r.id} className="flex items-start justify-between p-3 rounded-lg border bg-card hover:bg-muted/40 transition-colors" data-testid={`biology-record-${r.id}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">
                        {formatMexicoDate(r.sampleDate, { year: "numeric", month: "short", day: "numeric" })}
                      </span>
                      <Badge className={`text-xs ${dataSourceColors[r.dataSource] || ""} border-0`}>
                        {dataSourceLabels[r.dataSource] || r.dataSource}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                      {r.mbc && <span className="text-xs text-muted-foreground">MBC: {parseFloat(r.mbc).toFixed(1)}</span>}
                      {r.mr  && <span className="text-xs text-muted-foreground">MR: {parseFloat(r.mr).toFixed(3)}</span>}
                      {r.bg  && <span className="text-xs text-muted-foreground">BG: {parseFloat(r.bg).toFixed(1)}</span>}
                      {r.nag && <span className="text-xs text-muted-foreground">NAG: {parseFloat(r.nag).toFixed(1)}</span>}
                      {r.dnaYield && <span className="text-xs text-muted-foreground">ADN: {parseFloat(r.dnaYield).toFixed(2)}</span>}
                    </div>
                    {r.dataSource === "lab" && (() => {
                      const evidence = microbiologyEvidence(r);
                      if (!evidence) return null;
                      const hasEvidence = evidence.lab || evidence.folio || evidence.method ||
                        [evidence.trichodermaCfu, evidence.fusariumCfu, evidence.bacillusCfu, evidence.metarhiziumCfu, evidence.beauveriaCfu].some(v => v !== null) ||
                        evidence.metarhiziumStatus !== "not_analyzed" || evidence.beauveriaStatus !== "not_analyzed" || evidence.nitrogenFixersStatus !== "not_analyzed";
                      if (!hasEvidence) return null;
                      return <div className="mt-2 space-y-1">
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          {evidence.lab && <span>Laboratorio: {evidence.lab}</span>}
                          {evidence.folio && <span>Folio: {evidence.folio}</span>}
                          {evidence.method && <span>Método: {evidence.method}</span>}
                          {evidence.trichodermaCfu !== null && <span>Trichoderma: {evidence.trichodermaCfu.toLocaleString("es-MX")} UFC/g</span>}
                          {evidence.fusariumCfu !== null && <span>Fusarium: {evidence.fusariumCfu.toLocaleString("es-MX")} UFC/g</span>}
                          {evidence.bacillusCfu !== null && <span>Bacillus: {evidence.bacillusCfu.toLocaleString("es-MX")} UFC/g</span>}
                          <span>Metarhizium: {evidence.metarhiziumStatus === "counted" ? `${evidence.metarhiziumCfu?.toLocaleString("es-MX") ?? "—"} UFC/g` : formatMicrobeStatus(evidence.metarhiziumStatus)}</span>
                          <span>Beauveria: {evidence.beauveriaStatus === "counted" ? `${evidence.beauveriaCfu?.toLocaleString("es-MX") ?? "—"} UFC/g` : formatMicrobeStatus(evidence.beauveriaStatus)}</span>
                          <span>Fijadores de N: {formatMicrobeStatus(evidence.nitrogenFixersStatus)}</span>
                          <span>Relación T/F: {evidence.trichodermaFusariumRatio === null ? `No calculable${evidence.ratioCaveat ? ` (${evidence.ratioCaveat})` : ""}` : evidence.trichodermaFusariumRatio.toFixed(2)}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground">{MICROBIOLOGY_CAVEAT}</p>
                      </div>;
                    })()}
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive ml-2 shrink-0"
                    onClick={() => { if (window.confirm("¿Eliminar este registro de biología del suelo? Esta acción no se puede deshacer.")) deleteMutation.mutate(r.id); }} disabled={deleteMutation.isPending}
                    title="Eliminar" data-testid={`button-delete-biology-${r.id}`}>
                    {deleteMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Manual entry dialog */}
      <Dialog open={showManualForm} onOpenChange={setShowManualForm}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-add-biology">
          <DialogHeader>
            <DialogTitle>Ingreso Manual de Laboratorio</DialogTitle>
            <DialogDescription>
              Ingresa los resultados de tu análisis biológico de suelo. Todos los campos de medición son opcionales salvo la fecha.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {createMutation.isError && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" data-testid="error-save-biology">{(createMutation.error as Error).message}</div>}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="bio-date">Fecha de muestreo *</Label>
                <Input id="bio-date" type="date" value={formData.sampleDate}
                  onChange={(e) => setFormData({ ...formData, sampleDate: e.target.value })} data-testid="input-bio-date" />
              </div>
              <div>
                <Label htmlFor="bio-depth">Profundidad (cm)</Label>
                <Input id="bio-depth" type="number" min="1" max="200" value={formData.depthCm}
                  onChange={(e) => setFormData({ ...formData, depthCm: e.target.value })} data-testid="input-bio-depth" />
              </div>
            </div>
            <div>
              <Label htmlFor="bio-source">Fuente de datos</Label>
              <Select value={formData.dataSource} onValueChange={(v) => setFormData({ ...formData, dataSource: v })}>
                <SelectTrigger data-testid="select-bio-source"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lab">Laboratorio convencional</SelectItem>
                  <SelectItem value="nir">Espectroscopía NIR</SelectItem>
                  <SelectItem value="mir">Espectroscopía MIR</SelectItem>
                  <SelectItem value="estimated">Estimado (otro método)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {formData.dataSource === "lab" && <div className="border rounded-lg p-3 space-y-3">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Microbiología cultivable</h4>
                <p className="text-xs text-muted-foreground mt-1">Registra únicamente resultados reportados por el laboratorio. Un campo vacío no representa cero.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><Label htmlFor="bio-lab-folio" className="text-xs">Folio del laboratorio</Label><Input id="bio-lab-folio" value={formData.labFolio} onChange={(e) => setFormData({ ...formData, labFolio: e.target.value })} data-testid="input-bio-lab-folio" /></div>
                <div><Label htmlFor="bio-lab-name" className="text-xs">Laboratorio</Label><Input id="bio-lab-name" value={formData.labName} onChange={(e) => setFormData({ ...formData, labName: e.target.value })} data-testid="input-bio-lab-name" /></div>
                <div className="sm:col-span-2"><Label htmlFor="bio-method" className="text-xs">Método microbiológico</Label><Input id="bio-method" value={formData.microbiologyMethod} onChange={(e) => setFormData({ ...formData, microbiologyMethod: e.target.value })} data-testid="input-bio-microbiology-method" /></div>
                {([
                  ["trichodermaCfu", "Trichoderma (UFC/g)"],
                  ["fusariumCfu", "Fusarium (UFC/g)"],
                  ["bacillusCfu", "Bacillus (UFC/g)"],
                ] as const).map(([key, label]) => <div key={key}><Label htmlFor={`bio-${key}`} className="text-xs">{label}</Label><Input id={`bio-${key}`} type="number" min="0" step="any" value={formData[key]} onChange={(e) => setFormData({ ...formData, [key]: e.target.value })} data-testid={`input-bio-${key}`} /></div>)}
                {([
                  ["metarhizium", "Metarhizium"],
                  ["beauveria", "Beauveria"],
                ] as const).map(([name, label]) => {
                  const statusKey = `${name}Status` as "metarhiziumStatus" | "beauveriaStatus";
                  const countKey = `${name}Cfu` as "metarhiziumCfu" | "beauveriaCfu";
                  return <div key={name} className="space-y-1">
                    <Label htmlFor={`bio-${name}-status`} className="text-xs">{label}</Label>
                    <Select value={formData[statusKey]} onValueChange={(value: "counted" | "not_detected" | "not_analyzed") => setFormData({ ...formData, [statusKey]: value, [countKey]: value === "counted" ? formData[countKey] : "" })}>
                      <SelectTrigger id={`bio-${name}-status`} data-testid={`select-bio-${name}-status`}><SelectValue placeholder="Selecciona estado" /></SelectTrigger>
                      <SelectContent><SelectItem value="counted">Conteo registrado</SelectItem><SelectItem value="not_detected">No detectado</SelectItem><SelectItem value="not_analyzed">No analizado</SelectItem></SelectContent>
                    </Select>
                    {formData[statusKey] === "counted" && <Input aria-label={`${label} UFC/g`} type="number" min="0" step="any" placeholder="UFC/g" value={formData[countKey]} onChange={(e) => setFormData({ ...formData, [countKey]: e.target.value })} data-testid={`input-bio-${name}-cfu`} />}
                  </div>;
                })}
                <div className="sm:col-span-2">
                  <Label htmlFor="bio-nitrogen-fixers" className="text-xs">Fijadores de nitrógeno</Label>
                  <Select value={formData.nitrogenFixersStatus} onValueChange={(value: "detected" | "not_detected" | "not_analyzed") => setFormData({ ...formData, nitrogenFixersStatus: value })}>
                    <SelectTrigger id="bio-nitrogen-fixers" data-testid="select-bio-nitrogen-fixers"><SelectValue placeholder="Selecciona estado" /></SelectTrigger>
                    <SelectContent><SelectItem value="detected">Detectado</SelectItem><SelectItem value="not_detected">No detectado</SelectItem><SelectItem value="not_analyzed">No analizado</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{MICROBIOLOGY_CAVEAT}</p>
            </div>}
            <div className="border rounded-lg p-3 space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Biomasa y Actividad</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="bio-mbc" className="text-xs">MBC (μg C g⁻¹)</Label>
                  <Input id="bio-mbc" type="number" step="0.01" min="0" placeholder="ej. 285.4"
                    value={formData.mbc} onChange={(e) => setFormData({ ...formData, mbc: e.target.value })} data-testid="input-bio-mbc" />
                </div>
                <div>
                  <Label htmlFor="bio-mr" className="text-xs">MR (μg C g⁻¹ d⁻¹)</Label>
                  <Input id="bio-mr" type="number" step="0.001" min="0" placeholder="ej. 1.820"
                    value={formData.mr} onChange={(e) => setFormData({ ...formData, mr: e.target.value })} data-testid="input-bio-mr" />
                </div>
              </div>
            </div>
            <div className="border rounded-lg p-3 space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Enzimas Hidrolíticas</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="bio-bg" className="text-xs">β-Glucosidasa (nmol g⁻¹ h⁻¹)</Label>
                  <Input id="bio-bg" type="number" step="0.01" min="0" placeholder="ej. 142.0"
                    value={formData.bg} onChange={(e) => setFormData({ ...formData, bg: e.target.value })} data-testid="input-bio-bg" />
                </div>
                <div>
                  <Label htmlFor="bio-nag" className="text-xs">NAG (nmol g⁻¹ h⁻¹)</Label>
                  <Input id="bio-nag" type="number" step="0.01" min="0" placeholder="ej. 65.3"
                    value={formData.nag} onChange={(e) => setFormData({ ...formData, nag: e.target.value })} data-testid="input-bio-nag" />
                </div>
              </div>
            </div>
            <div className="border rounded-lg p-3">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground block mb-2">ADN Metagenómico</Label>
              <Label htmlFor="bio-dna" className="text-xs">Rendimiento ADN (μg g⁻¹)</Label>
              <Input id="bio-dna" type="number" step="0.001" min="0" placeholder="ej. 28.5"
                value={formData.dnaYield} onChange={(e) => setFormData({ ...formData, dnaYield: e.target.value })} data-testid="input-bio-dna" />
            </div>
            <div>
              <Label htmlFor="bio-notes">Notas</Label>
              <Textarea id="bio-notes" placeholder="Observaciones adicionales, condiciones de muestreo..."
                value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={2} data-testid="input-bio-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowManualForm(false)} data-testid="button-cancel-biology">Cancelar</Button>
            <Button onClick={() => createMutation.mutate(formData)}
              disabled={createMutation.isPending || !formData.sampleDate ||
                (formData.metarhiziumStatus === "counted" && formData.metarhiziumCfu === "") ||
                (formData.beauveriaStatus === "counted" && formData.beauveriaCfu === "")} data-testid="button-save-biology">
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

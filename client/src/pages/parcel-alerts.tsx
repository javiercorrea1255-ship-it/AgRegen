import { useState } from "react";
import { formatMexicoDate } from "@shared/civil-date";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft, AlertTriangle, AlertCircle, Info, CheckCircle, Leaf,
  Droplets, Bug, Thermometer, Loader2, FlaskConical, ChevronDown,
  ChevronUp, Calendar, Building2, Sprout, TrendingUp, ExternalLink,
  RefreshCw, Beaker, Microscope, Bot, CheckCheck, X, ChevronRight,
} from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

// ── Types ──────────────────────────────────────────────────────────────────────
interface ApiAlert {
  id: string;
  parcelId: string;
  severity: "high" | "medium" | "low";
  title: string;
  description: string;
  isRead: boolean;
  createdAt: string | Date;
  source?: string;
  dataValue?: number;
  threshold?: number;
  isDynamic?: boolean;
  type?: "standard" | "ai_proactive";
  actionStatus?: "applied" | "dismissed" | null;
  reasoningBullets?: string[] | null;
  eventType?: string | null;
}

interface SoilAnalysis {
  id: string;
  analysisDate: string;
  labName?: string | null;
  ph?: string | null;
  organicMatter?: string | null;
  totalCarbon?: string | null;
  nitrogenTotal?: string | null;
  phosphorus?: string | null;
  potassium?: string | null;
  calcium?: string | null;
  magnesium?: string | null;
  sulfur?: string | null;
  iron?: string | null;
  zinc?: string | null;
  manganese?: string | null;
  copper?: string | null;
  boron?: string | null;
  electricConductivity?: string | null;
  cec?: string | null;
  sand?: string | null;
  silt?: string | null;
  clay?: string | null;
  notes?: string | null;
  createdAt: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function getSeverityConfig(severity: string) {
  switch (severity) {
    case "high":
      return { Icon: AlertTriangle, color: "text-red-600",   bg: "bg-red-50",   border: "border-red-200",   badge: "bg-red-500",   label: "Alta" };
    case "medium":
      return { Icon: AlertCircle,  color: "text-amber-600",  bg: "bg-amber-50", border: "border-amber-200", badge: "bg-amber-500", label: "Media" };
    default:
      return { Icon: Info,         color: "text-blue-600",   bg: "bg-blue-50",  border: "border-blue-200",  badge: "bg-blue-500",  label: "Baja" };
  }
}

function isSoilAlert(a: ApiAlert): boolean {
  const src = a.source || "";
  if (src.startsWith("soil_") || src === "ph" || src === "organic_matter") return true;
  const t = a.title.toLowerCase();
  return (
    t.includes("suelo") || t.includes("ph ") || t.includes("ph:") || t.startsWith("ph") ||
    t.includes("nitrógeno") || t.includes("nitrogeno") ||
    t.includes("fósforo") || t.includes("fosforo") ||
    t.includes("potasio") || t.includes("materia orgánica") || t.includes("materia organica") ||
    t.includes("hierro") || t.includes("zinc") || t.includes("boro") || t.includes("cobre") ||
    t.includes("manganeso") || t.includes("calcio") || t.includes("magnesio") ||
    t.includes("azufre") || t.includes("salinidad") || t.includes("cic") ||
    t.includes("arcilla") || t.includes("arena") || t.includes("compactación") ||
    t.includes("textura") || t.includes("lixiviación") || t.includes("ca/mg")
  );
}

function getAlertSourceIcon(a: ApiAlert) {
  if (isSoilAlert(a)) return FlaskConical;
  const t = a.title.toLowerCase();
  if (t.includes("ndvi") || t.includes("ndmi") || t.includes("satélite") || t.includes("índice")) return TrendingUp;
  if (t.includes("agua") || t.includes("hídrico") || t.includes("lluvia") || t.includes("riego")) return Droplets;
  if (t.includes("temperatura") || t.includes("clima") || t.includes("helada")) return Thermometer;
  if (t.includes("plaga") || t.includes("enfermedad") || t.includes("pulgón")) return Bug;
  if (t.includes("cultivo") || t.includes("fenolo") || t.includes("ciclo")) return Sprout;
  return AlertCircle;
}

// ── Soil health score ──────────────────────────────────────────────────────────
interface SoilIndicator {
  name: string;
  value: number;
  valueStr: string;
  unit: string;
  optimal: number;
  optimalLabel: string;
  score: number; // 0–100
  pct: number;   // progress bar %
  group: "main" | "secondary" | "micro" | "physical" | "texture";
}

function computeSoilIndicators(s: SoilAnalysis): SoilIndicator[] {
  const out: SoilIndicator[] = [];
  const add = (
    name: string, raw: string | null | undefined, unit: string,
    optimal: number, optimalLabel: string,
    scoreFn: (n: number) => number, pctFn: (n: number) => number,
    group: SoilIndicator["group"]
  ) => {
    if (raw == null || raw === "") return;
    const n = Number(raw);
    if (isNaN(n)) return;
    out.push({ name, value: n, valueStr: unit === "%" ? n.toFixed(1) : n.toFixed(unit === "ppm" ? 0 : 2), unit, optimal, optimalLabel, score: Math.round(scoreFn(n) * 100), pct: Math.min(100, pctFn(n) * 100), group });
  };

  // main
  add("pH del suelo",       s.ph,             "",    6.5, "6.2–7.2",
    n => n < 5.0 || n > 8.5 ? 0.15 : n < 5.5 ? 0.30 : n < 6.0 ? 0.60 : n < 6.2 ? 0.80 : n <= 7.2 ? 1.0 : n <= 7.5 ? 0.85 : n <= 8.0 ? 0.60 : 0.30,
    n => Math.min(1, n / 14), "main");
  add("Materia orgánica",   s.organicMatter,  "%",   3.0, "> 3%",
    n => n < 1.0 ? 0.10 : n < 2.0 ? 0.40 : n < 3.0 ? 0.70 : n <= 5.0 ? 1.0 : 0.90,
    n => Math.min(1, n / 6), "main");
  add("Nitrógeno total",    s.nitrogenTotal,  "%",   0.20, "0.15–0.30%",
    n => n < 0.05 ? 0.10 : n < 0.10 ? 0.50 : n < 0.15 ? 0.75 : n <= 0.30 ? 1.0 : 0.90,
    n => Math.min(1, n / 0.4), "main");
  add("Fósforo disponible", s.phosphorus,     "ppm", 25,  "> 20 ppm",
    n => n < 8 ? 0.15 : n < 15 ? 0.50 : n < 20 ? 0.75 : n <= 40 ? 1.0 : 0.90,
    n => Math.min(1, n / 50), "main");
  add("Potasio",            s.potassium,      "ppm", 180, "> 150 ppm",
    n => n < 60 ? 0.10 : n < 120 ? 0.50 : n < 150 ? 0.75 : n <= 250 ? 1.0 : 0.90,
    n => Math.min(1, n / 300), "main");
  // secondary macros
  add("Calcio",             s.calcium,        "ppm", 1200, "> 1000 ppm",
    n => n < 300 ? 0.20 : n < 500 ? 0.50 : n < 1000 ? 0.80 : 1.0,
    n => Math.min(1, n / 2000), "secondary");
  add("Magnesio",           s.magnesium,      "ppm", 160, "> 120 ppm",
    n => n < 40 ? 0.20 : n < 80 ? 0.50 : n < 120 ? 0.80 : 1.0,
    n => Math.min(1, n / 300), "secondary");
  add("Azufre",             s.sulfur,         "ppm", 20,  "> 15 ppm",
    n => n < 5 ? 0.20 : n < 8 ? 0.50 : n < 15 ? 0.80 : 1.0,
    n => Math.min(1, n / 40), "secondary");
  // micronutrients
  add("Hierro (Fe)",        s.iron,           "ppm", 20,  "4–200 ppm",
    n => n < 4 ? 0.30 : n > 200 ? 0.50 : 1.0,
    n => Math.min(1, n / 200), "micro");
  add("Zinc (Zn)",          s.zinc,           "ppm", 1.5, "> 1 ppm",
    n => n < 0.3 ? 0.15 : n < 0.5 ? 0.50 : n < 1.0 ? 0.75 : 1.0,
    n => Math.min(1, n / 3), "micro");
  add("Manganeso (Mn)",     s.manganese,      "ppm", 10,  "1–50 ppm",
    n => n < 1 ? 0.30 : n > 50 ? 0.50 : 1.0,
    n => Math.min(1, n / 50), "micro");
  add("Cobre (Cu)",         s.copper,         "ppm", 1.0, "> 0.5 ppm",
    n => n < 0.2 ? 0.20 : n < 0.5 ? 0.60 : 1.0,
    n => Math.min(1, n / 3), "micro");
  add("Boro (B)",           s.boron,          "ppm", 0.8, "0.5–2 ppm",
    n => n < 0.2 ? 0.20 : n > 2 ? 0.20 : n < 0.5 ? 0.60 : 1.0,
    n => Math.min(1, n / 3), "micro");
  // physical
  add("Cond. eléctrica",    s.electricConductivity, "dS/m", 1, "< 1 dS/m",
    n => n <= 1 ? 1.0 : n <= 2 ? 0.80 : n <= 4 ? 0.50 : 0.20,
    n => Math.min(1, n / 6), "physical");
  add("CIC",                s.cec,            "meq/100g", 20, "10–40 meq/100g",
    n => n < 5 ? 0.20 : n < 10 ? 0.60 : n <= 40 ? 1.0 : 0.70,
    n => Math.min(1, n / 50), "physical");
  add("Carbono total",      s.totalCarbon,    "%",   1.8, "≈ MO × 0.58",
    n => n < 0.5 ? 0.20 : n < 1.0 ? 0.60 : n < 1.5 ? 0.80 : 1.0,
    n => Math.min(1, n / 4), "physical");
  // texture
  add("Arena",              s.sand,           "%",   40,  "< 70%",
    n => n > 80 ? 0.40 : n > 70 ? 0.70 : 1.0,
    n => Math.min(1, n / 100), "texture");
  add("Limo",               s.silt,           "%",   35,  "20–60%",
    n => n < 10 || n > 70 ? 0.60 : 1.0,
    n => Math.min(1, n / 100), "texture");
  add("Arcilla",            s.clay,           "%",   25,  "< 55%",
    n => n > 65 ? 0.40 : n > 50 ? 0.70 : 1.0,
    n => Math.min(1, n / 100), "texture");
  return out;
}

function computeOverallHealth(indicators: SoilIndicator[]): number {
  const weights: Record<SoilIndicator["group"], number> = { main: 3, secondary: 1.5, micro: 1, physical: 1.5, texture: 1 };
  const mainIndicators = indicators.filter(i => ["main", "secondary"].includes(i.group));
  if (mainIndicators.length === 0) return 0;
  const total = mainIndicators.reduce((s, i) => s + weights[i.group], 0);
  const weighted = mainIndicators.reduce((s, i) => s + i.score * weights[i.group], 0);
  return Math.round(weighted / total);
}

function scoreColor(score: number) {
  if (score >= 80) return "#22c55e";
  if (score >= 60) return "#eab308";
  if (score >= 40) return "#f97316";
  return "#ef4444";
}
function scoreLabel(score: number) {
  if (score >= 85) return "Excelente";
  if (score >= 70) return "Bueno";
  if (score >= 55) return "Moderado";
  if (score >= 40) return "Requiere Atención";
  return "Crítico";
}
function indicatorBarColor(score: number) {
  if (score >= 80) return "bg-green-500";
  if (score >= 60) return "bg-lime-500";
  if (score >= 40) return "bg-amber-500";
  return "bg-red-500";
}
function indicatorDotColor(score: number) {
  if (score >= 80) return "bg-green-500";
  if (score >= 60) return "bg-lime-500";
  if (score >= 40) return "bg-amber-500";
  return "bg-red-500";
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function ParcelAlerts() {
  const params = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showMicro, setShowMicro] = useState(false);
  const [showTexture, setShowTexture] = useState(false);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());

  const { data: parcelData, isLoading: parcelLoading } = useQuery({
    queryKey: ["parcel", params.id],
    queryFn: async () => {
      const r = await fetch(`/api/parcels/${params.id}`, { credentials: "include" });
      if (!r.ok) throw new Error("Error al cargar parcela");
      return r.json();
    },
  });

  const { data: alertsData, isLoading: alertsLoading, refetch: refetchAlerts } = useQuery({
    queryKey: ["alerts", params.id],
    queryFn: async () => {
      const r = await fetch(`/api/parcels/${params.id}/alerts`, { credentials: "include" });
      if (!r.ok) throw new Error("Error al cargar alertas");
      return r.json() as Promise<{ alerts: ApiAlert[]; recommendedActions: any[]; dataSource: { hasParcelData: boolean; hasSoilAnalysis: boolean; hasWeatherData: boolean } }>;
    },
    staleTime: 60_000,
  });

  const { data: soilData, isLoading: soilLoading } = useQuery({
    queryKey: ["soil-analysis", params.id],
    queryFn: async () => {
      const r = await fetch(`/api/parcels/${params.id}/soil-analysis`, { credentials: "include" });
      if (!r.ok) return { analyses: [] };
      return r.json() as Promise<{ analyses: SoilAnalysis[] }>;
    },
  });

  const markReadMutation = useMutation({
    mutationFn: async (alertId: string) => {
      const r = await fetch(`/api/alerts/${alertId}/read`, { method: "PATCH", credentials: "include" });
      if (!r.ok) throw new Error("Error al marcar alerta");
      return r.json();
    },
    onSuccess: (_, alertId) => {
      setReadIds(prev => new Set(Array.from(prev).concat(alertId)));
      queryClient.invalidateQueries({ queryKey: ["alerts", params.id] });
    },
    onError: () => toast({ title: "Error", description: "No se pudo marcar la alerta como leída.", variant: "destructive" }),
  });

  const actionMutation = useMutation({
    mutationFn: async ({ alertId, actionStatus }: { alertId: string; actionStatus: "applied" | "dismissed" }) => {
      const r = await fetch(`/api/alerts/${alertId}/action`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionStatus }),
      });
      if (!r.ok) throw new Error("Error al actualizar alerta");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts", params.id] });
      queryClient.invalidateQueries({ queryKey: ["user-alerts"] });
      toast({ title: "Alerta actualizada", description: "Estado de recomendación guardado." });
    },
    onError: () => toast({ title: "Error", description: "No se pudo actualizar el estado.", variant: "destructive" }),
  });

  const frequencyMutation = useMutation({
    mutationFn: async (hours: number) => {
      const r = await fetch(`/api/parcels/${params.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proactiveAlertFrequencyHours: hours }),
      });
      if (!r.ok) throw new Error("Error al guardar frecuencia");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["parcel", params.id] });
      toast({ title: "Frecuencia guardada", description: "Las alertas IA respetarán la nueva frecuencia mínima." });
    },
    onError: () => toast({ title: "Error", description: "No se pudo guardar la frecuencia.", variant: "destructive" }),
  });

  const parcel = parcelData?.parcel;
  const alerts: ApiAlert[] = alertsData?.alerts || [];
  const recommendedActions: any[] = alertsData?.recommendedActions || [];
  const dataSource = alertsData?.dataSource;

  const latestSoil: SoilAnalysis | null = (soilData?.analyses || []).sort((a: SoilAnalysis, b: SoilAnalysis) =>
    new Date(b.analysisDate || b.createdAt).getTime() - new Date(a.analysisDate || a.createdAt).getTime()
  )[0] || null;

  const soilIndicators = latestSoil ? computeSoilIndicators(latestSoil) : [];
  const overallHealth = soilIndicators.length > 0 ? computeOverallHealth(soilIndicators) : 0;

  const mainIndicators      = soilIndicators.filter(i => i.group === "main");
  const secondaryIndicators = soilIndicators.filter(i => i.group === "secondary");
  const microIndicators     = soilIndicators.filter(i => i.group === "micro");
  const physicalIndicators  = soilIndicators.filter(i => i.group === "physical");
  const textureIndicators   = soilIndicators.filter(i => i.group === "texture");

  const proactiveAlerts = alerts.filter(a => a.type === "ai_proactive");
  const standardAlerts  = alerts.filter(a => a.type !== "ai_proactive");
  const soilAlerts  = standardAlerts.filter(a => isSoilAlert(a));
  const otherAlerts = standardAlerts.filter(a => !isSoilAlert(a));

  const isLoading = parcelLoading || alertsLoading || soilLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  function AlertCard({ alert }: { alert: ApiAlert }) {
    const cfg = getSeverityConfig(alert.severity);
    const isAI = alert.type === "ai_proactive";
    const SourceIcon = isAI ? Bot : getAlertSourceIcon(alert);
    const isRead = alert.isRead || readIds.has(alert.id);
    const [showReasoning, setShowReasoning] = useState(false);
    const bullets: string[] = Array.isArray(alert.reasoningBullets) ? alert.reasoningBullets as string[] : [];

    const eventLabel: Record<string, string> = {
      ndvi_drop: "Caída NDVI",
      frost: "Helada",
      drought: "Sequía",
      excess_water: "Exceso hídrico",
    };

    return (
      <div className={`p-4 rounded-lg border ${isAI ? "border-violet-200 bg-violet-50" : `${cfg.bg} ${cfg.border}`} transition-opacity ${isRead && !isAI ? "opacity-60" : ""}`}
        data-testid={`alert-card-${alert.id}`}>
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 p-1.5 rounded-md ${isAI ? "bg-violet-100" : (isRead ? "bg-muted" : cfg.bg)}`}>
            <SourceIcon className={`w-4 h-4 ${isAI ? "text-violet-600" : cfg.color}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h4 className="font-semibold text-sm leading-tight">{alert.title}</h4>
                {isAI && (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-100 text-violet-700 border border-violet-200">
                    <Bot className="w-2.5 h-2.5" /> IA Proactiva
                  </span>
                )}
                {alert.eventType && eventLabel[alert.eventType] && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                    {eventLabel[alert.eventType]}
                  </span>
                )}
              </div>
              <Badge className={`${isAI ? "bg-violet-500" : cfg.badge} text-white text-xs shrink-0`}>{cfg.label}</Badge>
            </div>
            <p className="text-sm text-muted-foreground mb-2 leading-relaxed">{alert.description}</p>

            {/* Reasoning bullets (collapsible) */}
            {isAI && bullets.length > 0 && (
              <div className="mb-2">
                <button
                  className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800 font-medium mb-1"
                  onClick={() => setShowReasoning(v => !v)}
                  data-testid={`btn-toggle-reasoning-${alert.id}`}
                >
                  {showReasoning ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  {showReasoning ? "Ocultar razonamiento" : "Ver razonamiento IA"}
                </button>
                {showReasoning && (
                  <ul className="space-y-1 pl-4 border-l-2 border-violet-200">
                    {bullets.map((b, i) => (
                      <li key={i} className="text-xs text-slate-600 leading-snug">{b}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-xs text-muted-foreground">
                {new Date(alert.createdAt).toLocaleDateString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>

              {/* AI proactive actions */}
              {isAI && !alert.actionStatus && (
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-green-300 text-green-700 hover:bg-green-50"
                    onClick={() => actionMutation.mutate({ alertId: alert.id, actionStatus: "applied" })}
                    disabled={actionMutation.isPending}
                    data-testid={`btn-applied-${alert.id}`}>
                    <CheckCheck className="w-3 h-3" /> Aplicada
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-slate-300 text-slate-600 hover:bg-slate-50"
                    onClick={() => actionMutation.mutate({ alertId: alert.id, actionStatus: "dismissed" })}
                    disabled={actionMutation.isPending}
                    data-testid={`btn-dismissed-${alert.id}`}>
                    <X className="w-3 h-3" /> Descartada
                  </Button>
                </div>
              )}
              {isAI && alert.actionStatus === "applied" && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 border border-green-200 text-xs font-medium text-green-700">
                  <CheckCheck className="w-3 h-3" /> Aplicada
                </span>
              )}
              {isAI && alert.actionStatus === "dismissed" && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-xs font-medium text-slate-600">
                  <X className="w-3 h-3" /> Descartada
                </span>
              )}

              {/* Standard alert read button */}
              {!isAI && !isRead && !alert.isDynamic && (
                <Button size="sm" variant="ghost" className="text-xs h-7"
                  onClick={() => markReadMutation.mutate(alert.id)}
                  disabled={markReadMutation.isPending}
                  data-testid={`btn-mark-read-${alert.id}`}>
                  Marcar como leída
                </Button>
              )}
              {!isAI && !isRead && alert.isDynamic && (
                <span className="text-xs text-muted-foreground italic">Alerta dinámica</span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function IndicatorRow({ ind }: { ind: SoilIndicator }) {
    return (
      <div className="space-y-1.5" data-testid={`indicator-${ind.name.toLowerCase().replace(/\s/g, "-")}`}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{ind.name}</span>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold font-mono">{ind.valueStr}{ind.unit}</span>
            <div className={`w-2.5 h-2.5 rounded-full ${indicatorDotColor(ind.score)}`} />
          </div>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${indicatorBarColor(ind.score)}`}
            style={{ width: `${ind.pct}%` }} />
        </div>
        <p className="text-[10px] text-muted-foreground">Óptimo: {ind.optimalLabel}</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 space-y-6 max-w-6xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard" className="hover:text-primary flex items-center gap-1" data-testid="link-back-dashboard">
          <ArrowLeft className="w-4 h-4" /> Volver
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">{parcel?.name || "Parcela"}</span>
        <span>/</span>
        <span className="text-foreground">Alertas y Salud del Suelo</span>
        <Button size="sm" variant="ghost" className="ml-auto gap-1.5 text-xs" onClick={() => refetchAlerts()} data-testid="btn-refresh-alerts">
          <RefreshCw className="w-3 h-3" /> Actualizar
        </Button>
      </div>

      <Link href={`/parcel/${params.id}?tab=soil`} className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-[#f4f7ee] p-4 transition-colors hover:bg-[#edf2e4] sm:flex-row sm:items-center sm:justify-between" data-testid="link-field-soil-assessment">
        <span><span className="block font-semibold text-emerald-950">Evaluación de salud del suelo en campo</span><span className="mt-1 block text-sm text-emerald-900/80">Registra observaciones por visita sin mezclar con el análisis de laboratorio.</span></span>
        <span className="shrink-0 rounded-md bg-emerald-800 px-3 py-2 text-sm font-medium text-white">Abrir evaluación</span>
      </Link>

      {/* ── Proactive alert frequency setting ────────────────────────────────── */}
      <Card className="border-violet-200 bg-violet-50/40" data-testid="card-alert-frequency">
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2 flex-1">
              <div className="p-1.5 bg-violet-100 rounded-md">
                <Bot className="w-4 h-4 text-violet-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-violet-900">Frecuencia mínima de alertas IA</p>
                <p className="text-xs text-violet-600">Máximo una alerta por evento en el período seleccionado</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={String(parcel?.proactiveAlertFrequencyHours ?? 24)}
                onValueChange={(v) => frequencyMutation.mutate(Number(v))}
                disabled={frequencyMutation.isPending || !parcel}
              >
                <SelectTrigger className="w-40 h-8 text-xs border-violet-300" data-testid="select-alert-frequency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="24">Cada 24 horas</SelectItem>
                  <SelectItem value="48">Cada 48 horas</SelectItem>
                  <SelectItem value="72">Cada 72 horas</SelectItem>
                  <SelectItem value="168">Una vez por semana</SelectItem>
                </SelectContent>
              </Select>
              {frequencyMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-500" />}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── CTA: no soil data ─────────────────────────────────────────────────── */}
      {!latestSoil && (
        <div className="p-4 rounded-xl border-2 border-amber-300 bg-amber-50 flex items-center justify-between gap-4" data-testid="banner-no-soil">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-lg">
              <FlaskConical className="w-6 h-6 text-amber-700" />
            </div>
            <div>
              <p className="font-semibold text-amber-900">Sin análisis de suelo registrado</p>
              <p className="text-sm text-amber-700">Carga un análisis para activar alertas de nutrientes y ver la salud real de tu suelo.</p>
            </div>
          </div>
          <Link href={`/parcel/${params.id}/setup`}>
            <Button className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white shrink-0" size="sm" data-testid="btn-go-setup">
              <FlaskConical className="w-3.5 h-3.5" /> Cargar análisis
            </Button>
          </Link>
        </div>
      )}

      {/* ── Soil analysis header card (when data exists) ──────────────────────── */}
      {latestSoil && (
        <div className="rounded-xl border-2 border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 p-5 flex flex-col sm:flex-row items-start sm:items-center gap-5"
          data-testid="banner-soil-analysis">
          {/* Donut */}
          <div className="relative flex items-center justify-center shrink-0">
            <svg className="w-28 h-28 -rotate-90">
              <circle cx="56" cy="56" r="48" fill="none" stroke="#e5e7eb" strokeWidth="10" />
              <circle cx="56" cy="56" r="48" fill="none"
                stroke={scoreColor(overallHealth)} strokeWidth="10"
                strokeDasharray={`${(overallHealth / 100) * 301.6} 301.6`} strokeLinecap="round" />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold leading-none">{overallHealth}%</span>
              <span className="text-[10px] font-medium text-muted-foreground mt-0.5">{scoreLabel(overallHealth)}</span>
            </div>
          </div>
          {/* Metadata */}
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <FlaskConical className="w-5 h-5 text-green-700" />
              <h2 className="text-lg font-bold text-green-900">Salud General del Suelo</h2>
              {soilAlerts.filter(a => a.severity === "high").length > 0 && (
                <Badge className="bg-red-500 text-white text-xs gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  {soilAlerts.filter(a => a.severity === "high").length} crítica{soilAlerts.filter(a => a.severity === "high").length !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-4 text-sm text-green-800 mb-3">
              <span className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                Análisis: {formatMexicoDate(latestSoil.analysisDate)}
              </span>
              {latestSoil.labName && (
                <span className="flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5" /> {latestSoil.labName}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <FlaskConical className="w-3.5 h-3.5" />
                {soilIndicators.length} parámetro{soilIndicators.length !== 1 ? "s" : ""} registrado{soilIndicators.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {soilAlerts.length > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-100 border border-amber-200 text-xs font-medium text-amber-800">
                  <AlertTriangle className="w-3 h-3" /> {soilAlerts.length} alerta{soilAlerts.length !== 1 ? "s" : ""} de suelo
                </span>
              )}
              {soilAlerts.length === 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-green-100 border border-green-200 text-xs font-medium text-green-800">
                  <CheckCircle className="w-3 h-3" /> Todos los parámetros en rango
                </span>
              )}
              <Link href={`/parcel/${params.id}/setup`}>
                <button className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-green-100 border border-green-200 text-xs font-medium text-green-800 hover:bg-green-200 transition-colors" data-testid="btn-update-soil">
                  <RefreshCw className="w-3 h-3" /> Actualizar análisis
                </button>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* ── Main grid ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left: Alerts ──────────────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">

          {/* ── AI Proactive Alerts ───────────────────────────────────────── */}
          {proactiveAlerts.length > 0 && (
            <Card className="border-2 border-violet-200" data-testid="card-proactive-alerts">
              <CardHeader className="pb-3 bg-violet-50 rounded-t-xl">
                <CardTitle className="flex items-center gap-2 text-violet-900">
                  <Bot className="w-5 h-5 text-violet-600" />
                  Alertas IA Proactivas
                  <Badge className="bg-violet-500 text-white ml-auto">{proactiveAlerts.length}</Badge>
                </CardTitle>
                <CardDescription className="text-violet-700">
                  Detectadas automáticamente por la IA a partir de cambios satelitales y condiciones climáticas.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 pt-4">
                {proactiveAlerts.map(alert => (
                  <AlertCard key={alert.id} alert={alert} />
                ))}
              </CardContent>
            </Card>
          )}

          {/* Soil alerts subsection */}
          {soilAlerts.length > 0 && (
            <Card className="border-2 border-amber-200" data-testid="card-soil-alerts">
              <CardHeader className="pb-3 bg-amber-50 rounded-t-xl">
                <CardTitle className="flex items-center gap-2 text-amber-900">
                  <FlaskConical className="w-5 h-5 text-amber-600" />
                  Alertas de Suelo
                  <Badge className="bg-amber-500 text-white ml-auto">{soilAlerts.length}</Badge>
                </CardTitle>
                <CardDescription className="text-amber-700">
                  Basadas en el análisis de suelo del {latestSoil ? formatMexicoDate(latestSoil.analysisDate) : "—"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 pt-4">
                {soilAlerts.map(alert => (
                  <AlertCard key={alert.id} alert={alert} />
                ))}
              </CardContent>
            </Card>
          )}

          {/* Other alerts */}
          <Card data-testid="card-other-alerts">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                {soilAlerts.length > 0 ? "Otras Alertas" : "Alertas Activas"}
                {otherAlerts.length > 0 && (
                  <Badge variant="secondary" className="ml-auto">{otherAlerts.length}</Badge>
                )}
              </CardTitle>
              <CardDescription>
                {dataSource?.hasParcelData
                  ? "Basadas en índices satelitales, clima y monitoreo"
                  : "Sin datos satelitales disponibles aún"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {otherAlerts.length === 0 && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  <CheckCircle className="w-8 h-8 text-green-400 mx-auto mb-2" />
                  No hay alertas activas en este momento.
                </div>
              )}
              {otherAlerts.map(alert => (
                <AlertCard key={alert.id} alert={alert} />
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Right: sidebar ────────────────────────────────────────────────────── */}
        <div className="space-y-4">
          {/* Data source status */}
          <Card data-testid="card-data-sources">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Estado de datos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                { label: "Análisis de suelo", ok: !!latestSoil, icon: FlaskConical },
                { label: "Índices satelitales", ok: dataSource?.hasParcelData, icon: TrendingUp },
                { label: "Datos climáticos", ok: dataSource?.hasWeatherData, icon: Thermometer },
              ].map(({ label, ok, icon: Icon }) => (
                <div key={label} className="flex items-center gap-2 text-xs">
                  <Icon className={`w-3.5 h-3.5 ${ok ? "text-green-600" : "text-muted-foreground"}`} />
                  <span className={ok ? "text-foreground" : "text-muted-foreground"}>{label}</span>
                  <span className={`ml-auto font-medium ${ok ? "text-green-600" : "text-amber-600"}`}>
                    {ok ? "✓ Disponible" : "Pendiente"}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Recommended actions */}
          {recommendedActions.length > 0 && (
            <Card data-testid="card-recommendations">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Acciones Recomendadas</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {recommendedActions.slice(0, 5).map((rec: any, i: number) => (
                  <div key={i} className={`p-3 rounded-lg border text-sm ${
                    rec.priority === "alta" || rec.urgency === "alta"
                      ? "bg-red-50 border-red-200"
                      : rec.priority === "media" || rec.urgency === "media"
                      ? "bg-amber-50 border-amber-200"
                      : "bg-blue-50 border-blue-200"
                  }`} data-testid={`recommendation-${i}`}>
                    <p className="font-medium mb-0.5 leading-tight">{rec.action || rec.title}</p>
                    <p className="text-xs text-muted-foreground">{rec.reason || rec.description}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Quick soil summary */}
          {latestSoil && mainIndicators.length > 0 && (
            <Card data-testid="card-soil-quick">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <Leaf className="w-4 h-4 text-green-600" /> Resumen de suelo
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {mainIndicators.slice(0, 5).map(ind => (
                  <div key={ind.name} className="flex items-center justify-between text-xs gap-2">
                    <span className="text-muted-foreground truncate">{ind.name}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="font-mono font-bold">{ind.valueStr}{ind.unit}</span>
                      <div className={`w-2 h-2 rounded-full ${indicatorDotColor(ind.score)}`} />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* ── Full soil indicators ─────────────────────────────────────────────── */}
      {latestSoil && soilIndicators.length > 0 && (
        <Card data-testid="card-soil-indicators">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <FlaskConical className="w-5 h-5 text-amber-600" />
                  Indicadores de Salud del Suelo
                </CardTitle>
                <CardDescription>
                  Análisis del {formatMexicoDate(latestSoil.analysisDate)}
                  {latestSoil.labName ? ` · ${latestSoil.labName}` : ""}
                </CardDescription>
              </div>
              <Link href={`/parcel/${params.id}/setup`}>
                <Button variant="outline" size="sm" className="gap-1.5 text-xs" data-testid="btn-update-soil-full">
                  <ExternalLink className="w-3 h-3" /> Actualizar
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">

            {/* Main indicators */}
            {mainIndicators.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">pH, Materia Orgánica y Macronutrientes principales</p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {mainIndicators.map(ind => <IndicatorRow key={ind.name} ind={ind} />)}
                </div>
              </div>
            )}

            {/* Secondary macros */}
            {secondaryIndicators.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Macronutrientes secundarios (Ca · Mg · S)</p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {secondaryIndicators.map(ind => <IndicatorRow key={ind.name} ind={ind} />)}
                </div>
              </div>
            )}

            {/* Physical properties */}
            {physicalIndicators.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Propiedades físico-químicas (CE · CIC · C)</p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {physicalIndicators.map(ind => <IndicatorRow key={ind.name} ind={ind} />)}
                </div>
              </div>
            )}

            {/* Micronutrients (collapsible) */}
            {microIndicators.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowMicro(v => !v)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg border bg-muted/40 hover:bg-muted/60 transition-colors mb-3"
                  data-testid="toggle-micronutrients">
                  <span className="flex items-center gap-2 text-xs font-semibold">
                    <Microscope className="w-3.5 h-3.5 text-purple-600" />
                    Micronutrientes (Fe · Zn · Mn · Cu · B)
                    {microIndicators.some(i => i.score < 60) && (
                      <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-amber-700 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded-full">
                        <AlertTriangle className="w-2.5 h-2.5" /> {microIndicators.filter(i => i.score < 60).length} fuera de rango
                      </span>
                    )}
                  </span>
                  {showMicro ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                </button>
                {showMicro && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {microIndicators.map(ind => <IndicatorRow key={ind.name} ind={ind} />)}
                  </div>
                )}
              </div>
            )}

            {/* Texture (collapsible) */}
            {textureIndicators.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowTexture(v => !v)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg border bg-muted/40 hover:bg-muted/60 transition-colors mb-3"
                  data-testid="toggle-texture">
                  <span className="flex items-center gap-2 text-xs font-semibold">
                    <span className="text-orange-600">🪨</span>
                    Textura del suelo (Arena · Limo · Arcilla)
                  </span>
                  {showTexture ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                </button>
                {showTexture && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                      {textureIndicators.map(ind => <IndicatorRow key={ind.name} ind={ind} />)}
                    </div>
                    {(() => {
                      const s = Number(latestSoil.sand)||0, si = Number(latestSoil.silt)||0, c = Number(latestSoil.clay)||0;
                      const total = s + si + c;
                      if (total < 1) return null;
                      return (
                        <div className="space-y-1">
                          <div className="flex gap-0 h-4 rounded-full overflow-hidden text-[9px] font-bold">
                            {s > 0 && <div className="flex items-center justify-center text-white bg-yellow-400" style={{ width: `${(s/total)*100}%` }}>{s > 15 ? `${s.toFixed(0)}%` : ""}</div>}
                            {si > 0 && <div className="flex items-center justify-center text-white bg-stone-400" style={{ width: `${(si/total)*100}%` }}>{si > 15 ? `${si.toFixed(0)}%` : ""}</div>}
                            {c > 0 && <div className="flex items-center justify-center text-white bg-orange-500" style={{ width: `${(c/total)*100}%` }}>{c > 15 ? `${c.toFixed(0)}%` : ""}</div>}
                          </div>
                          <div className="flex gap-3 text-[10px] text-muted-foreground">
                            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400 inline-block"/>Arena {s.toFixed(0)}%</span>
                            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-stone-400 inline-block"/>Limo {si.toFixed(0)}%</span>
                            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500 inline-block"/>Arcilla {c.toFixed(0)}%</span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* Notes */}
            {latestSoil.notes && (
              <div className="p-3 rounded-lg bg-muted/40 border">
                <p className="text-xs font-semibold text-muted-foreground mb-1">Observaciones del análisis</p>
                <p className="text-sm text-foreground">{latestSoil.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Historical interventions (static placeholder) ─────────────────────── */}
      <Card data-testid="card-interventions">
        <CardHeader>
          <CardTitle>Historial de Intervenciones</CardTitle>
          <CardDescription>Registro de acciones realizadas en el lote</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {alerts.filter(a => a.isRead || readIds.has(a.id)).slice(0, 3).map(a => (
              <div key={a.id} className="flex items-start gap-3 p-3 bg-secondary/30 rounded-lg">
                <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">{a.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(a.createdAt).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })} — Alerta revisada
                  </p>
                </div>
              </div>
            ))}
            {alerts.filter(a => a.isRead || readIds.has(a.id)).length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">Sin intervenciones registradas aún.</p>
            )}
          </div>
          <Link href={`/parcel/${params.id}/setup`}>
            <Button variant="outline" className="w-full mt-4 gap-1.5" data-testid="btn-new-intervention">
              <FlaskConical className="w-4 h-4" /> Actualizar datos de suelo
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

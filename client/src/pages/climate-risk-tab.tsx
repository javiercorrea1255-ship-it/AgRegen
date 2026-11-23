import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartTooltip, ResponsiveContainer, Legend, ReferenceLine,
} from "recharts";
import {
  Thermometer, Droplets, AlertTriangle, Bot, Loader2,
  CloudRain, Sun, Snowflake, TrendingDown, Waves, Info,
  HelpCircle,
} from "lucide-react";

// ── TypeScript interfaces matching server response ─────────────────────────────

interface CropImpact {
  cropKey: string;
  label: string;
  yieldChange: number;
  uncertaintyLow: number;
  uncertaintyHigh: number;
  riskLevel: string;
}

interface RiskMetrics {
  heatDays: number;
  heatLevel: string;
  frostDays: number;
  frostLevel: string;
  annualPrecip: number;
  precipDelta: number;
  tempDelta: number;
  tempDeltaLevel: string;
  waterDeficit: number;
  waterDeficitLevel: string;
  spi: number;
  spiLevel: string;
}

interface ScenarioDataPoint {
  year: number;
  ssp126: number;
  ssp245: number;
  ssp370: number;
  ssp585: number;
}

interface PrecipByScenarioPoint {
  horizon: number;
  ssp126: number;
  ssp245: number;
  ssp370: number;
  ssp585: number;
}

interface MonthlyPrecipPoint {
  month: string;
  baseline: number;
  projected: number;
}

interface ClimateRiskData {
  parcelId: string;
  scenario: string;
  horizon: number;
  baselineWindow: string;
  baselineTemp: number;
  baselinePrecipMm: number;
  apiDataAvailable: boolean;
  climateApiUsed: boolean;
  risks: RiskMetrics;
  cropImpact: CropImpact | null;
  allCropImpacts: CropImpact[];
  allScenarios: ScenarioDataPoint[];
  precipByScenario: PrecipByScenarioPoint[];
  precipitationByMonth: MonthlyPrecipPoint[];
}

// ── Scenario configuration ─────────────────────────────────────────────────────

const SCENARIOS = [
  {
    value:   "ssp126",
    label:   "SSP1-2.6 (optimista)",
    rcpLabel:"RCP 2.6",
    color:   "#22c55e",
    tooltip: "Calentamiento limitado a ~1.5°C para 2100. Requiere reducciones drásticas de emisiones y neutralidad de carbono antes de 2050.",
  },
  {
    value:   "ssp245",
    label:   "SSP2-4.5 (moderado)",
    rcpLabel:"RCP 4.5",
    color:   "#eab308",
    tooltip: "Calentamiento de ~2.7°C para 2100. Escenario de políticas climáticas parciales con transición energética incompleta.",
  },
  {
    value:   "ssp370",
    label:   "SSP3-7.0 / RCP 6.0",
    rcpLabel:"RCP 6.0",
    color:   "#f97316",
    tooltip: "Calentamiento de ~3.0°C para 2100 (equivalente a RCP 6.0). Fragmentación geopolítica, alta dependencia de combustibles fósiles en países en desarrollo.",
  },
  {
    value:   "ssp585",
    label:   "SSP5-8.5 (extremo)",
    rcpLabel:"RCP 8.5",
    color:   "#ef4444",
    tooltip: "Calentamiento de ~4.4°C para 2100. Combustibles fósiles sin restricción, crecimiento económico intensivo en carbono.",
  },
] as const;

type ScenarioValue = typeof SCENARIOS[number]["value"];

const HORIZONS = [
  { value: "2030", label: "2030 (~10 años)" },
  { value: "2050", label: "2050 (~25 años)" },
  { value: "2070", label: "2070 (~45 años)" },
  { value: "2100", label: "2100 (fin siglo)" },
] as const;

// ── Static fallback data (IPCC AR6 global medians) shown when API fails ────────
// Indexed by [scenario][horizon]
const FALLBACK_RISKS: Record<string, Record<string, Partial<RiskMetrics>>> = {
  ssp126: {
    "2030": { tempDelta: 0.4, precipDelta: -1, heatDays: 35, frostDays: 10, waterDeficit: 120, spi: -0.2 },
    "2050": { tempDelta: 0.8, precipDelta: -1, heatDays: 40, frostDays:  8, waterDeficit: 150, spi: -0.3 },
    "2070": { tempDelta: 1.0, precipDelta: -2, heatDays: 42, frostDays:  6, waterDeficit: 170, spi: -0.4 },
    "2100": { tempDelta: 1.0, precipDelta: -2, heatDays: 42, frostDays:  6, waterDeficit: 170, spi: -0.4 },
  },
  ssp245: {
    "2030": { tempDelta: 0.6, precipDelta: -2, heatDays: 37, frostDays:  9, waterDeficit: 160, spi: -0.3 },
    "2050": { tempDelta: 1.2, precipDelta: -3, heatDays: 44, frostDays:  6, waterDeficit: 210, spi: -0.5 },
    "2070": { tempDelta: 1.7, precipDelta: -4, heatDays: 50, frostDays:  4, waterDeficit: 260, spi: -0.7 },
    "2100": { tempDelta: 2.1, precipDelta: -5, heatDays: 55, frostDays:  2, waterDeficit: 300, spi: -0.8 },
  },
  ssp370: {
    "2030": { tempDelta: 0.7, precipDelta: -2, heatDays: 38, frostDays:  9, waterDeficit: 175, spi: -0.3 },
    "2050": { tempDelta: 1.4, precipDelta: -5, heatDays: 47, frostDays:  5, waterDeficit: 250, spi: -0.6 },
    "2070": { tempDelta: 2.2, precipDelta: -8, heatDays: 56, frostDays:  2, waterDeficit: 350, spi: -1.0 },
    "2100": { tempDelta: 3.0, precipDelta:-11, heatDays: 66, frostDays:  0, waterDeficit: 480, spi: -1.4 },
  },
  ssp585: {
    "2030": { tempDelta: 0.8, precipDelta: -3, heatDays: 40, frostDays:  8, waterDeficit: 200, spi: -0.4 },
    "2050": { tempDelta: 1.8, precipDelta: -7, heatDays: 52, frostDays:  4, waterDeficit: 330, spi: -0.9 },
    "2070": { tempDelta: 2.8, precipDelta:-12, heatDays: 64, frostDays:  1, waterDeficit: 500, spi: -1.5 },
    "2100": { tempDelta: 3.8, precipDelta:-18, heatDays: 76, frostDays:  0, waterDeficit: 700, spi: -2.0 },
  },
};

const FALLBACK_CROP_IMPACTS: CropImpact[] = [
  { cropKey:"maiz",  label:"Maíz",  yieldChange:-5.4,  uncertaintyLow:-8.4,  uncertaintyHigh:-2.4,  riskLevel:"moderado" },
  { cropKey:"trigo", label:"Trigo", yieldChange:-4.2,  uncertaintyLow:-6.6,  uncertaintyHigh:-1.8,  riskLevel:"moderado" },
  { cropKey:"frijol",label:"Frijol",yieldChange:-6.0,  uncertaintyLow:-9.6,  uncertaintyHigh:-2.4,  riskLevel:"moderado" },
  { cropKey:"soya",  label:"Soya",  yieldChange:-4.8,  uncertaintyLow:-7.8,  uncertaintyHigh:-1.8,  riskLevel:"moderado" },
  { cropKey:"sorgo", label:"Sorgo", yieldChange:-2.4,  uncertaintyLow:-4.4,  uncertaintyHigh:-0.4,  riskLevel:"bajo"     },
  { cropKey:"papa",  label:"Papa",  yieldChange:-4.8,  uncertaintyLow:-7.8,  uncertaintyHigh:-1.8,  riskLevel:"moderado" },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function getRiskBadgeClass(level: string): string {
  if (level === "alto")     return "bg-red-100 text-red-800 border-red-200";
  if (level === "moderado") return "bg-orange-100 text-orange-800 border-orange-200";
  return "bg-yellow-100 text-yellow-800 border-yellow-200";
}

function getYieldChangeClass(val: number): string {
  if (val <= -25) return "text-red-700 font-bold";
  if (val <= -15) return "text-red-600 font-semibold";
  if (val <= -8)  return "text-orange-600 font-semibold";
  if (val <= -3)  return "text-yellow-600";
  return "text-green-600";
}

function formatPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n}%`;
}

function formatDeltaC(n: number): string {
  return `${n >= 0 ? "+" : ""}${n}°C`;
}

// ── Component ──────────────────────────────────────────────────────────────────

interface ClimateRiskTabProps {
  parcelId: string;
  crop: string;
  parcelName: string;
  latitude: string;
  longitude: string;
}

export default function ClimateRiskTab({
  parcelId,
  crop,
  parcelName,
}: ClimateRiskTabProps) {
  const [scenario, setScenario] = useState<ScenarioValue>("ssp245");
  const [horizon,  setHorizon]  = useState("2050");
  const [aiText,   setAiText]   = useState<string | null>(null);

  const scenarioInfo = SCENARIOS.find(s => s.value === scenario) ?? SCENARIOS[1];

  const { data, isLoading, error } = useQuery<ClimateRiskData>({
    queryKey: ["climate-risk", parcelId, scenario, horizon],
    queryFn: async () => {
      const res = await fetch(
        `/api/parcels/${parcelId}/climate-risk?scenario=${scenario}&horizon=${horizon}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Error al obtener datos climáticos");
      return res.json() as Promise<ClimateRiskData>;
    },
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  const interpretMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/parcels/${parcelId}/climate-risk/interpret`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ scenario, horizon, climateData: data }),
      });
      if (!res.ok) throw new Error("Error al interpretar datos");
      return res.json() as Promise<{ interpretation: string }>;
    },
    onSuccess: (r) => setAiText(r.interpretation),
  });

  const risks = data?.risks;

  // Precipitation % change chart — grouped by horizon, 4 bars per group (one per scenario)
  const precipChartData = (data?.precipByScenario ?? []).map(pt => ({
    horizon: String(pt.horizon),
    "RCP 2.6": pt.ssp126,
    "RCP 4.5": pt.ssp245,
    "RCP 6.0": pt.ssp370,
    "RCP 8.5": pt.ssp585,
  }));

  // Temperature anomaly chart — Δ°C vs baseline; allScenarios already contains delta values
  const tempAnomalyData = data?.allScenarios ?? [];

  // Fallback risks shown when the API call fails
  const fbRisks = FALLBACK_RISKS[scenario]?.[horizon] ?? {};

  return (
    <div className="space-y-6" data-testid="content-climate-risk">
      <TooltipProvider>

        {/* ── Header + Selectors ──────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Thermometer className="w-5 h-5 text-orange-500" />
              Riesgo Climático RCP/SSP
            </h3>
            <p className="text-sm text-muted-foreground">
              Proyecciones CMIP6 para {parcelName} — línea base{" "}
              {data?.baselineWindow ?? "1981-2010"}
              {data && data.climateApiUsed && (
                <span className="ml-1 text-green-600 text-xs">(calibrado con ensemble CMIP6)</span>
              )}
              {data && !data.climateApiUsed && (
                <span className="ml-1 text-amber-600 text-xs">(medianas IPCC AR6)</span>
              )}
            </p>
          </div>

          <div className="flex gap-3 flex-wrap items-center">
            {/* Scenario selector with tooltips on options */}
            <div className="flex items-center gap-1.5">
              <Select value={scenario} onValueChange={(v) => setScenario(v as ScenarioValue)}>
                <SelectTrigger className="w-[220px]" data-testid="select-scenario">
                  <SelectValue placeholder="Escenario" />
                </SelectTrigger>
                <SelectContent>
                  {SCENARIOS.map(s => (
                    <SelectItem key={s.value} value={s.value}>
                      <span className="flex items-center gap-1.5">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ background: s.color }}
                        />
                        {s.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* Scenario description tooltip */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="text-muted-foreground hover:text-foreground" data-testid="tooltip-scenario-info">
                    <HelpCircle className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[280px] text-xs">
                  <p className="font-semibold mb-1">{scenarioInfo.label}</p>
                  <p>{scenarioInfo.tooltip}</p>
                </TooltipContent>
              </Tooltip>
            </div>

            <Select value={horizon} onValueChange={setHorizon}>
              <SelectTrigger className="w-[160px]" data-testid="select-horizon">
                <SelectValue placeholder="Horizonte" />
              </SelectTrigger>
              <SelectContent>
                {HORIZONS.map(h => (
                  <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Active scenario pill */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge style={{ background: scenarioInfo.color, color: "#fff" }} className="text-xs px-3 py-1">
            {scenarioInfo.rcpLabel}
          </Badge>
          <span className="text-sm text-muted-foreground">{scenarioInfo.tooltip.slice(0, 80)}…</span>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="flex justify-center items-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            <span className="ml-3 text-muted-foreground">Consultando proyecciones climáticas…</span>
          </div>
        )}

        {/* ── Error state with IPCC fallback data ─────────────────────────── */}
        {error && !isLoading && (
          <div className="space-y-4">
            <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
              <CardContent className="pt-4 pb-3">
                <div className="flex items-start gap-2 text-amber-700 dark:text-amber-400 text-sm">
                  <Info className="w-4 h-4 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold">No se pudo conectar con el servicio climático</p>
                    <p className="text-xs mt-0.5">
                      Se muestran estimaciones basadas en los valores medianos IPCC AR6 para el escenario{" "}
                      <strong>{scenarioInfo.rcpLabel}</strong> en el horizonte <strong>{horizon}</strong>.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Fallback risk cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Card className="border-red-200">
                <CardContent className="pt-3 pb-3 px-3">
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><Thermometer className="w-3 h-3" /> Δ Temperatura</p>
                  <p className="text-2xl font-bold text-red-700">{fbRisks.tempDelta !== undefined ? formatDeltaC(fbRisks.tempDelta) : "—"}</p>
                  <p className="text-xs text-muted-foreground">vs 1981-2010 (IPCC)</p>
                </CardContent>
              </Card>
              <Card className="border-sky-200">
                <CardContent className="pt-3 pb-3 px-3">
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><CloudRain className="w-3 h-3" /> Δ Precipitación</p>
                  <p className="text-2xl font-bold text-sky-700">{fbRisks.precipDelta !== undefined ? formatPct(fbRisks.precipDelta) : "—"}</p>
                  <p className="text-xs text-muted-foreground">cambio anual (IPCC)</p>
                </CardContent>
              </Card>
              <Card className="border-orange-200">
                <CardContent className="pt-3 pb-3 px-3">
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><Sun className="w-3 h-3" /> Calor extremo</p>
                  <p className="text-2xl font-bold text-orange-700">{fbRisks.heatDays !== undefined ? `~${fbRisks.heatDays}` : "—"}</p>
                  <p className="text-xs text-muted-foreground">días/año &gt;35°C (est.)</p>
                </CardContent>
              </Card>
            </div>

            {/* Fallback crop impact table */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Impacto estimado en rendimiento (IPCC AR6)</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-xs">
                  <thead><tr className="border-b"><th className="text-left py-1 pr-3">Cultivo</th><th className="text-center py-1">Impacto</th><th className="text-center py-1">Rango</th></tr></thead>
                  <tbody>
                    {FALLBACK_CROP_IMPACTS.map(ci => (
                      <tr key={ci.cropKey} className="border-b last:border-0">
                        <td className="py-1 pr-3">{ci.label}</td>
                        <td className={`text-center py-1 ${getYieldChangeClass(ci.yieldChange)}`}>{formatPct(ci.yieldChange)}</td>
                        <td className="text-center py-1 text-muted-foreground">[{formatPct(ci.uncertaintyLow)}; {formatPct(ci.uncertaintyHigh)}]</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-muted-foreground mt-2">* Valores medianos IPCC AR6 WG2, no calibrados a tu parcela.</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── Main content when data is available ─────────────────────────── */}
        {data && (
          <>
            {/* Info banner: calibrated vs pure IPCC */}
            {data.climateApiUsed ? (
              <Card className="border-green-200 bg-green-50 dark:bg-green-950/20">
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-start gap-2 text-green-700 dark:text-green-400 text-sm">
                    <Info className="w-4 h-4 mt-0.5 shrink-0" />
                    <div>
                      <span className="font-semibold">Proyecciones calibradas localmente — </span>
                      los deltas de temperatura y precipitación se ajustaron con el ensemble de 3 modelos
                      HighResMIP (EC-Earth3P, CMCC-CM2, MRI-AGCM3) para tu ubicación específica.
                      Línea base: {data.baselineWindow}.
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-start gap-2 text-amber-700 dark:text-amber-400 text-sm">
                    <Info className="w-4 h-4 mt-0.5 shrink-0" />
                    <div>
                      <span className="font-semibold">Medianas globales IPCC AR6 — </span>
                      {parseInt(String(horizon)) > 2050
                        ? `El horizonte ${horizon} supera el rango de los modelos HighResMIP (hasta 2050). `
                        : "Los modelos de proyección climática no respondieron. "}
                      Los valores son los medianos del Panel Intergubernamental aplicados
                      a los datos históricos de tu parcela ({data.baselineWindow}).
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ── 6-card risk summary ───────────────────────────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3" data-testid="risk-summary-cards">

              <Card className="border-orange-200">
                <CardHeader className="pb-1 pt-3 px-3">
                  <CardTitle className="text-xs flex items-center gap-1 text-orange-700">
                    <Sun className="w-3.5 h-3.5" /> Calor extremo
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3">
                  <p className="text-2xl font-bold text-orange-700" data-testid="text-heat-days">{risks?.heatDays ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">días/año &gt;35°C</p>
                  {risks?.heatLevel && (
                    <Badge variant="outline" className={`text-xs mt-1 ${getRiskBadgeClass(risks.heatLevel)}`}>
                      {risks.heatLevel}
                    </Badge>
                  )}
                </CardContent>
              </Card>

              <Card className="border-blue-200">
                <CardHeader className="pb-1 pt-3 px-3">
                  <CardTitle className="text-xs flex items-center gap-1 text-blue-700">
                    <Snowflake className="w-3.5 h-3.5" /> Heladas
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3">
                  <p className="text-2xl font-bold text-blue-700" data-testid="text-frost-days">{risks?.frostDays ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">días/año &lt;0°C</p>
                  {risks?.frostLevel && (
                    <Badge variant="outline" className={`text-xs mt-1 ${getRiskBadgeClass(risks.frostLevel)}`}>
                      {risks.frostLevel}
                    </Badge>
                  )}
                </CardContent>
              </Card>

              <Card className="border-sky-200">
                <CardHeader className="pb-1 pt-3 px-3">
                  <CardTitle className="text-xs flex items-center gap-1 text-sky-700">
                    <CloudRain className="w-3.5 h-3.5" /> Precipitación
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3">
                  <p className="text-2xl font-bold text-sky-700" data-testid="text-precip">{risks?.annualPrecip ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">mm/año proyectado</p>
                  {risks?.precipDelta !== undefined && (
                    <p className="text-xs mt-0.5 font-medium" style={{ color: risks.precipDelta >= 0 ? "#16a34a" : "#dc2626" }}>
                      {formatPct(risks.precipDelta)} vs base
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card className="border-red-200">
                <CardHeader className="pb-1 pt-3 px-3">
                  <CardTitle className="text-xs flex items-center gap-1 text-red-700">
                    <Thermometer className="w-3.5 h-3.5" /> Δ Temperatura
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3">
                  <p className="text-2xl font-bold text-red-700" data-testid="text-temp-delta">
                    {risks?.tempDelta !== undefined ? `+${risks.tempDelta}°C` : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">vs {data.baselineWindow}</p>
                  {risks?.tempDeltaLevel && (
                    <Badge variant="outline" className={`text-xs mt-1 ${getRiskBadgeClass(risks.tempDeltaLevel)}`}>
                      {risks.tempDeltaLevel}
                    </Badge>
                  )}
                </CardContent>
              </Card>

              <Card className="border-amber-200">
                <CardHeader className="pb-1 pt-3 px-3">
                  <CardTitle className="text-xs flex items-center gap-1 text-amber-700">
                    <Droplets className="w-3.5 h-3.5" /> Déficit hídrico
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3">
                  <p className="text-2xl font-bold text-amber-700" data-testid="text-water-deficit">{risks?.waterDeficit ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">mm/año (ET0 − P)</p>
                  {risks?.waterDeficitLevel && (
                    <Badge variant="outline" className={`text-xs mt-1 ${getRiskBadgeClass(risks.waterDeficitLevel)}`}>
                      {risks.waterDeficitLevel}
                    </Badge>
                  )}
                </CardContent>
              </Card>

              <Card className="border-violet-200">
                <CardHeader className="pb-1 pt-3 px-3">
                  <CardTitle className="text-xs flex items-center gap-1 text-violet-700">
                    <Waves className="w-3.5 h-3.5" /> SPI-Sequía
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3">
                  <p className="text-2xl font-bold text-violet-700" data-testid="text-spi">{risks?.spi ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">índice estandarizado</p>
                  {risks?.spiLevel && (
                    <Badge variant="outline" className={`text-xs mt-1 ${getRiskBadgeClass(risks.spiLevel)}`}>
                      {risks.spiLevel}
                    </Badge>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* ── Temperature ANOMALY chart (Δ°C vs 1981-2010) ──────────────── */}
            <Card data-testid="card-temp-scenarios">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Thermometer className="w-4 h-4 text-orange-500" />
                  Anomalía de Temperatura — 4 Escenarios (2025–2100)
                </CardTitle>
                <CardDescription>
                  Δ°C vs línea base {data.baselineWindow} ({data.baselineTemp}°C).
                  Valores positivos indican calentamiento respecto al período histórico.
                  {data.climateApiUsed
                    ? " Δ anclado con datos reales del modelo CMIP6."
                    : " Δ calculado con valores medianos IPCC AR6."}
                </CardDescription>
              </CardHeader>
              <CardContent className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={tempAnomalyData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="year" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={11}
                      tickLine={false}
                      unit="°C"
                      label={{ value: "Δ°C", angle: -90, position: "insideLeft", offset: 15, fontSize: 11 }}
                    />
                    <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
                    <RechartTooltip
                      contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                      formatter={(value: number, name: string): [string, string] => [
                        `${value >= 0 ? "+" : ""}${value.toFixed(2)}°C`,
                        name,
                      ]}
                    />
                    <Legend />
                    {SCENARIOS.map(s => (
                      <Area
                        key={s.value}
                        type="monotone"
                        dataKey={s.value}
                        name={s.rcpLabel}
                        stroke={s.color}
                        fill={s.color}
                        fillOpacity={0.07}
                        strokeWidth={2}
                        dot={false}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* ── Precipitation % change by scenario × horizon ──────────────── */}
            <Card data-testid="card-precip-scenarios">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <CloudRain className="w-4 h-4 text-blue-500" />
                  Cambio en Precipitación por Escenario (% vs {data.baselineWindow})
                </CardTitle>
                <CardDescription>
                  Cambio porcentual proyectado en precipitación anual. Línea base: {data.baselinePrecipMm} mm/año.
                  Barras negativas indican reducción de lluvia.
                </CardDescription>
              </CardHeader>
              <CardContent className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={precipChartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="horizon"
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={11}
                      tickLine={false}
                    />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} unit="%" />
                    <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
                    <RechartTooltip
                      contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                      formatter={(value: number, name: string): [string, string] => [
                        `${value >= 0 ? "+" : ""}${value}%`,
                        name,
                      ]}
                    />
                    <Legend />
                    {SCENARIOS.map(s => (
                      <Bar key={s.value} dataKey={s.rcpLabel} fill={s.color} radius={[3, 3, 0, 0]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* ── Crop yield impact table (backend-computed) ────────────────── */}
            <Card data-testid="card-yield-impact">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingDown className="w-4 h-4 text-red-500" />
                  Impacto en Rendimiento — IPCC AR6 WG2 Cap. 5
                </CardTitle>
                <CardDescription>
                  Cambio proyectado bajo {scenarioInfo.rcpLabel} en {horizon}.
                  Calentamiento local: +{data.risks.tempDelta}°C.
                  Rango de incertidumbre ±1σ entre corchetes.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 pr-4 font-semibold text-muted-foreground">Cultivo</th>
                        <th className="text-center py-2 px-3 font-semibold text-muted-foreground">Impacto</th>
                        <th className="text-center py-2 px-3 font-semibold text-muted-foreground">Rango</th>
                        <th className="text-left py-2 pl-2 font-semibold text-muted-foreground">Riesgo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.allCropImpacts.map(ci => {
                        const isCurrentCrop = crop?.toLowerCase()
                          .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                          .includes(ci.cropKey);
                        return (
                          <tr
                            key={ci.cropKey}
                            className={`border-b last:border-0 ${isCurrentCrop ? "bg-blue-50 dark:bg-blue-950/20" : ""}`}
                            data-testid={`yield-row-${ci.cropKey}`}
                          >
                            <td className="py-2 pr-4 font-medium">
                              {ci.label}
                              {isCurrentCrop && (
                                <Badge className="ml-2 text-xs bg-blue-100 text-blue-700 hover:bg-blue-100">
                                  Tu cultivo
                                </Badge>
                              )}
                            </td>
                            <td className={`text-center py-2 px-3 font-bold ${getYieldChangeClass(ci.yieldChange)}`}>
                              {formatPct(ci.yieldChange)}
                            </td>
                            <td className="text-center py-2 px-3 text-xs text-muted-foreground whitespace-nowrap">
                              [{formatPct(ci.uncertaintyLow)}; {formatPct(ci.uncertaintyHigh)}]
                            </td>
                            <td className="py-2 pl-2">
                              <Badge variant="outline" className={`text-xs ${getRiskBadgeClass(ci.riskLevel)}`}>
                                {ci.riskLevel}
                              </Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  * Coeficientes de sensibilidad por °C (IPCC AR6 WG2, 2022). Rango = ±1σ aplicado al calentamiento proyectado.
                </p>

                {data.cropImpact && (
                  <div className="mt-4 p-3 rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/20">
                    <p className="text-sm font-semibold text-blue-800 dark:text-blue-200">
                      Impacto para tu cultivo ({data.cropImpact.label}):
                      <span className={`ml-2 ${getYieldChangeClass(data.cropImpact.yieldChange)}`}>
                        {formatPct(data.cropImpact.yieldChange)}
                      </span>
                      <span className="text-xs font-normal text-muted-foreground ml-1">
                        [{formatPct(data.cropImpact.uncertaintyLow)}; {formatPct(data.cropImpact.uncertaintyHigh)}]
                      </span>
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── AI Interpretation ─────────────────────────────────────────── */}
            <Card data-testid="card-ai-climate-interpretation">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Bot className="w-4 h-4 text-violet-600" />
                      Interpretación con IA
                    </CardTitle>
                    <CardDescription>
                      Análisis de riesgos y estrategias de adaptación personalizadas.
                    </CardDescription>
                  </div>
                  <Button
                    onClick={() => interpretMutation.mutate()}
                    disabled={interpretMutation.isPending}
                    variant="outline"
                    size="sm"
                    data-testid="button-ai-interpret"
                  >
                    {interpretMutation.isPending ? (
                      <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Analizando…</>
                    ) : (
                      <><Bot className="w-4 h-4 mr-2" /> Generar análisis</>
                    )}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {aiText ? (
                  <div
                    className="p-4 rounded-lg bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800 text-sm whitespace-pre-line leading-relaxed"
                    data-testid="text-ai-climate-interpretation"
                  >
                    {aiText}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
                    <Bot className="w-4 h-4 opacity-40" />
                    <span>
                      Haz clic en &quot;Generar análisis&quot; para obtener recomendaciones de adaptación personalizadas.
                    </span>
                  </div>
                )}
                {interpretMutation.isError && (
                  <p className="text-xs text-red-600 mt-2">No se pudo generar el análisis. Intenta de nuevo.</p>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </TooltipProvider>
    </div>
  );
}

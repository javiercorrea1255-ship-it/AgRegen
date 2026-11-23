import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, isQueued } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip,
} from "recharts";
import {
  Plus, Trash2, Copy, FlaskConical, AlertTriangle, CheckCircle2, Printer, FileDown,
  Sparkles, Eraser, ListChecks, Sprout, Beaker, Info, Check, ChevronLeft, ChevronRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useAmendmentsCalculator } from "@/lib/amendments/state";
import {
  MODULE_COLORS, MODULE_LABELS_ES, MODULE_NOTES_ES, OPTIMAL_RANGES, OPTIMAL_RATIOS,
  ORGANIC_MATERIALS, DEFAULT_TARGETS,
} from "@/lib/amendments/constants";
import type {
  AmendmentResult, AzufreAmendmentResult, CarbonAmendmentResult, ComputedSample,
  DiagnosisStatus, ModuleKey, SoilSample,
} from "@/lib/amendments/types";
import { downloadAmendmentsPdf } from "@/lib/amendments/export";

// ----- helpers -----
function fmt(n: number, dec = 2): string {
  if (!isFinite(n)) return "—";
  return n.toLocaleString("es-MX", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function pctClass(value: number, range: { min: number; max: number }): string {
  if (value >= range.min && value <= range.max) return "text-emerald-700 bg-emerald-50";
  const slack = (range.max - range.min) * 0.5;
  if (value < range.min - slack || value > range.max + slack) return "text-rose-700 bg-rose-50";
  return "text-amber-700 bg-amber-50";
}

function ratioClass(value: number, range: { min: number; max: number }): string {
  if (!isFinite(value)) return "text-slate-500";
  if (value >= range.min && value <= range.max) return "text-emerald-700 bg-emerald-50";
  return "text-amber-700 bg-amber-50";
}

const STATUS_LABEL: Record<DiagnosisStatus, string> = {
  optimo: "Óptimo",
  aceptable: "Aceptable",
  deficiente: "Deficiente",
  critico: "Crítico",
};

const STATUS_COLOR: Record<DiagnosisStatus, string> = {
  optimo: "bg-emerald-600 text-white",
  aceptable: "bg-emerald-300 text-emerald-900",
  deficiente: "bg-amber-500 text-white",
  critico: "bg-rose-600 text-white",
};

// Map a stored SoilAnalysis row to first-sample defaults.
// NOTE: the `soil_analysis` table does NOT have a `sodium` column.
type SoilAnalysisRow = {
  id?: string;
  analysisDate?: string | null;
  organicMatter?: string | null;
  ph?: string | null;
  cec?: string | null;
  calcium?: string | null;
  magnesium?: string | null;
  potassium?: string | null;
};

// Direct ppm → meq/100 g divisors (already include the 1 ppm = 0.1 mg/100 g factor):
//   Ca: eq weight 20 mg/meq → 1 ppm = 1/200 meq/100 g
//   Mg: eq weight 12.156 mg/meq → 1 ppm = 1/121.56 meq/100 g
//   K:  eq weight 39.1 mg/meq → 1 ppm = 1/391 meq/100 g
const PPM_TO_MEQ_DIVISOR = { Ca: 200, Mg: 121.56, K: 391 } as const;

/**
 * Convert a raw cation lab value to % saturation of the CIC.
 * The schema documents Ca/Mg/K as "ppm or meq/100 g" without a unit flag, so
 * we use a magnitude heuristic:
 *   - value < 50  → assume meq/100 g (typical range 0.1–40)
 *   - value ≥ 50  → assume ppm        (typical range 50–4000)
 * Returns undefined if the resulting saturation falls outside (0, 100].
 */
function cationToSaturationPct(
  rawValue: number,
  cec: number,
  cation: keyof typeof PPM_TO_MEQ_DIVISOR,
): number | undefined {
  if (!isFinite(rawValue) || !isFinite(cec) || cec <= 0) return undefined;
  const meq = rawValue < 50 ? rawValue : rawValue / PPM_TO_MEQ_DIVISOR[cation];
  const pct = (meq / cec) * 100;
  if (!isFinite(pct) || pct <= 0 || pct > 100) return undefined;
  return pct;
}

function num(s?: string | null): number | undefined {
  if (s == null) return undefined;
  const n = parseFloat(s);
  return isFinite(n) ? n : undefined;
}

// ===================================================================
// Page
// ===================================================================

interface Props {
  params?: { id?: string };
  /** When true, render without page chrome (no <h1>, no container padding) — used inside the parcel tab. */
  embedded?: boolean;
}

export default function AmendmentsCalculator({ params: _params, embedded = false }: Props = {}) {
  const routeParams = useParams<{ id?: string }>();
  const effectiveParcelId = _params?.id ?? routeParams?.id;
  const calc = useAmendmentsCalculator({ scopeId: effectiveParcelId });
  const [step, setStep] = useState(0);
  const [unitWarning, setUnitWarning] = useState<string | null>(null);
  const { toast } = useToast();

  // ── Offline-safe server snapshot ──────────────────────────────────────────
  // localStorage already persists the state on every change (source of truth).
  // This mutation additionally syncs the state to the server so it survives
  // device changes and localStorage clears. When offline it enqueues via the
  // outbox and syncs automatically on reconnection.
  const snapshotMutation = useMutation({
    mutationFn: async () => {
      if (!effectiveParcelId) return;
      const stateJson = JSON.stringify({
        projectName: calc.projectName,
        samples: calc.samples,
      });
      const res = await apiRequest(
        "POST",
        `/api/parcels/${effectiveParcelId}/amendments-snapshot`,
        { stateJson },
        {
          offlineSafe: true,
          offlineLabel: "Enmiendas de suelo",
          invalidateOnSync: [[`/api/parcels/${effectiveParcelId}/amendments-snapshot`]],
        },
      );
      if (isQueued(res)) return { queued: true };
      return { queued: false };
    },
    onSuccess: (result) => {
      if (result?.queued) {
        toast({
          title: "Guardado sin conexión",
          description: "Las enmiendas se sincronizarán cuando haya conexión.",
          duration: 3000,
        });
      }
    },
  });

  // Debounce: sync to server 3 s after the last change. Uses a ref to always
  // capture the latest samples/projectName without re-registering the effect.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapshotMutateRef = useRef(snapshotMutation.mutate);
  snapshotMutateRef.current = snapshotMutation.mutate;

  useEffect(() => {
    if (!effectiveParcelId) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      snapshotMutateRef.current();
    }, 3000);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [calc.samples, calc.projectName, effectiveParcelId]);

  const WIZARD_STEPS = [
    { label: "Captura", icon: Beaker },
    { label: "Diagnóstico", icon: ListChecks },
    { label: "Módulos", icon: Sprout },
    { label: "Resumen", icon: ListChecks },
  ];

  // Pre-fill first sample from latest soil analysis when entering via parcel route
  const { data: soilData } = useQuery<{ analyses: SoilAnalysisRow[] }>({
    queryKey: [`/api/parcels/${effectiveParcelId}/soil-analysis`],
    enabled: !!effectiveParcelId,
  });

  // Track which analysis we have already applied so a new lab upload re-runs the prefill.
  const lastAppliedAnalysisIdRef = useRef<string | null>(null);
  // Snapshot of the values we wrote on the last prefill — lets us detect manual edits.
  const lastPrefillSnapshotRef = useRef<Partial<SoilSample> | null>(null);

  const applyPrefillFromAnalysis = useCallback(
    (latest: SoilAnalysisRow): { updates: Partial<SoilSample>; warning: string | null } => {
      const updates: Partial<SoilSample> = {};
      let warning: string | null = null;
      const ph = num(latest.ph);
      const mo = num(latest.organicMatter);
      const cec = num(latest.cec);
      if (ph != null) updates.pH = ph;
      if (mo != null) updates.MO_pct = mo;
      if (cec != null) updates.CIC = cec;
      const first = calc.samples[0];
      const effectiveCec = cec ?? first?.CIC ?? 0;
      const ca = num(latest.calcium);
      const mg = num(latest.magnesium);
      const k = num(latest.potassium);
      const caPct = ca != null ? cationToSaturationPct(ca, effectiveCec, "Ca") : undefined;
      const mgPct = mg != null ? cationToSaturationPct(mg, effectiveCec, "Mg") : undefined;
      const kPct = k != null ? cationToSaturationPct(k, effectiveCec, "K") : undefined;
      if (caPct != null) updates.pct_Ca = caPct;
      if (mgPct != null) updates.pct_Mg = mgPct;
      if (kPct != null) updates.pct_K = kPct;
      const skipped: string[] = [];
      if (ca != null && caPct == null) skipped.push("Ca");
      if (mg != null && mgPct == null) skipped.push("Mg");
      if (k != null && kPct == null) skipped.push("K");
      if (skipped.length > 0) {
        warning =
          `No se pudo prellenar ${skipped.join(", ")}: la unidad de los cationes en el análisis es ` +
          `ambigua (ppm vs meq/100 g) y la conversión quedó fuera de rango. Verificá manualmente.`;
      }
      return { updates, warning };
    },
    [calc.samples],
  );

  useEffect(() => {
    if (!calc.hydrated || !effectiveParcelId) return;
    const latest = soilData?.analyses?.[0];
    if (!latest) return;
    const analysisId = latest.id ?? latest.analysisDate ?? null;
    if (!analysisId) return;
    if (lastAppliedAnalysisIdRef.current === analysisId) return;
    const first = calc.samples[0];
    if (!first) return;

    // Respect manual edits: if any field we previously prefilled has been modified by the user,
    // skip overwriting it.
    const prevSnap = lastPrefillSnapshotRef.current;
    const { updates, warning } = applyPrefillFromAnalysis(latest);
    let safeUpdates: Partial<SoilSample> = updates;
    if (prevSnap) {
      // Whitelist of numeric fields that the prefill writes. Keeps the reconciliation type-safe.
      const PREFILL_KEYS = ["pH", "MO_pct", "CIC", "pct_Ca", "pct_Mg", "pct_K"] as const;
      type PrefillKey = (typeof PREFILL_KEYS)[number];
      const next: Partial<Pick<SoilSample, PrefillKey>> = {};
      for (const key of PREFILL_KEYS) {
        const incoming = updates[key];
        if (incoming === undefined) continue;
        const previous = prevSnap[key];
        const currentInSample = first[key];
        // Only overwrite if the user has not changed the value since the last prefill.
        if (previous == null || previous === currentInSample) {
          next[key] = incoming;
        }
      }
      safeUpdates = next;
    }
    if (Object.keys(safeUpdates).length > 0) {
      calc.updateSample(first.id, safeUpdates);
    }
    lastAppliedAnalysisIdRef.current = analysisId;
    lastPrefillSnapshotRef.current = updates;
    setUnitWarning(warning);
  }, [calc, soilData, effectiveParcelId, applyPrefillFromAnalysis]);

  const reloadParcelData = useCallback(() => {
    const latest = soilData?.analyses?.[0];
    const first = calc.samples[0];
    if (!latest || !first) return;
    const { updates, warning } = applyPrefillFromAnalysis(latest);
    if (Object.keys(updates).length > 0) {
      calc.updateSample(first.id, updates);
    }
    lastPrefillSnapshotRef.current = updates;
    setUnitWarning(warning);
  }, [applyPrefillFromAnalysis, calc, soilData]);

  // Reset internal step and prefill bookkeeping when scope changes
  // (so each parcel opens on Captura and re-prefills cleanly without stale snapshots).
  useEffect(() => {
    setStep(0);
    lastAppliedAnalysisIdRef.current = null;
    lastPrefillSnapshotRef.current = null;
    setUnitWarning(null);
  }, [effectiveParcelId]);

  const wrapperClass = embedded
    ? "space-y-4"
    : "container mx-auto px-4 py-6 max-w-7xl";

  return (
    <div className={wrapperClass}>
      <PrintStyles />
      {!embedded && (
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6 no-print">
          <div className="flex items-center gap-3">
            <FlaskConical className="w-7 h-7 text-emerald-700" />
            <div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
                Calculadora de enmiendas de suelo
              </h1>
              <p className="text-sm text-muted-foreground">
                Diagnóstico catiónico y dosis recomendadas (kg/ha y t/ha) para 8 enmiendas químicas y orgánicas.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={calc.loadDemo} data-testid="btn-load-demo">
              <Sparkles className="w-4 h-4 mr-2" /> Cargar demo
            </Button>
            <Button variant="outline" size="sm" onClick={calc.clearAll} data-testid="btn-clear-all">
              <Eraser className="w-4 h-4 mr-2" /> Nuevo proyecto
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()} data-testid="btn-print">
              <Printer className="w-4 h-4 mr-2" /> Imprimir
            </Button>
            <Button
              size="sm"
              onClick={() => downloadAmendmentsPdf(calc.projectName, calc.computed)}
              data-testid="btn-download-pdf"
            >
              <FileDown className="w-4 h-4 mr-2" /> Descargar PDF
            </Button>
          </div>
        </div>
      )}

      {embedded && (
        <div className="flex flex-wrap items-center justify-end gap-2 no-print">
          <Button
            variant="outline"
            size="sm"
            onClick={reloadParcelData}
            disabled={!soilData?.analyses?.[0]}
            data-testid="btn-reload-parcel-data"
          >
            <Sparkles className="w-4 h-4 mr-2" /> Recargar datos de la parcela
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()} data-testid="btn-print">
            <Printer className="w-4 h-4 mr-2" /> Imprimir
          </Button>
          <Button
            size="sm"
            onClick={() => downloadAmendmentsPdf(calc.projectName, calc.computed)}
            data-testid="btn-download-pdf"
          >
            <FileDown className="w-4 h-4 mr-2" /> Descargar PDF
          </Button>
        </div>
      )}

      {unitWarning && (
        <Alert variant="default" className="no-print" data-testid="alert-unit-warning">
          <AlertTriangle className="w-4 h-4" />
          <AlertDescription>{unitWarning}</AlertDescription>
        </Alert>
      )}

      {/* Wizard header: project name + step indicator */}
      <div className="no-print mb-6">
        <div className="mb-4">
          <Label htmlFor="project-name">Nombre del proyecto</Label>
          <Input
            id="project-name"
            value={calc.projectName}
            onChange={(e) => calc.setProjectName(e.target.value)}
            data-testid="input-project-name"
            className="max-w-sm"
          />
        </div>

        {/* Step indicator */}
        <div className="flex items-center overflow-x-auto pb-2">
          {WIZARD_STEPS.map((s, i) => (
            <Fragment key={i}>
              <div className="flex flex-col items-center flex-shrink-0">
                <button
                  onClick={() => setStep(i)}
                  className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all shadow-sm ${
                    i < step
                      ? "bg-emerald-600 border-emerald-600 text-white"
                      : i === step
                      ? "bg-primary border-primary text-primary-foreground ring-4 ring-primary/20"
                      : "bg-background border-muted-foreground/30 text-muted-foreground hover:border-muted-foreground/60"
                  }`}
                  data-testid={`step-${i}`}
                >
                  {i < step ? <Check className="w-4 h-4" /> : i + 1}
                </button>
                <span className={`text-xs mt-1.5 whitespace-nowrap font-medium ${
                  i === step ? "text-primary" : i < step ? "text-emerald-600" : "text-muted-foreground"
                }`}>
                  {s.label}
                </span>
              </div>
              {i < WIZARD_STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 min-w-[2rem] mx-2 mb-5 transition-colors ${
                  i < step ? "bg-emerald-400" : "bg-muted-foreground/20"
                }`} />
              )}
            </Fragment>
          ))}
        </div>
      </div>

      {/* Step content */}
      {step === 0 && (
        <div className="space-y-4">
          <GlobalSoilParams calc={calc} />
          <CaptureTable calc={calc} />
        </div>
      )}
      {step === 1 && <DiagnosisView computed={calc.computed} />}
      {step === 2 && <ModulesView computed={calc.computed} updateAll={calc.updateAllSamples} />}
      {step === 3 && <SummaryView projectName={calc.projectName} computed={calc.computed} />}

      {/* Wizard navigation */}
      <div className="flex items-center justify-between mt-6 no-print pt-4 border-t">
        <Button
          variant="outline"
          onClick={() => setStep(Math.max(0, step - 1))}
          disabled={step === 0}
          data-testid="button-prev-step"
        >
          <ChevronLeft className="w-4 h-4 mr-1" /> Anterior
        </Button>
        <span className="text-xs text-muted-foreground flex items-center gap-2">
          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
          Guardado automáticamente · Paso {step + 1} de {WIZARD_STEPS.length}
        </span>
        <div className="flex gap-2">
          {step === WIZARD_STEPS.length - 1 && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.print()}
                data-testid="btn-print-wizard"
              >
                <Printer className="w-4 h-4 mr-2" /> Imprimir
              </Button>
              <Button
                size="sm"
                onClick={() => downloadAmendmentsPdf(calc.projectName, calc.computed)}
                data-testid="btn-download-pdf-wizard"
              >
                <FileDown className="w-4 h-4 mr-2" /> Descargar PDF
              </Button>
            </>
          )}
          {step < WIZARD_STEPS.length - 1 && (
            <Button
              onClick={() => setStep(step + 1)}
              data-testid="button-next-step"
            >
              Siguiente <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          )}
        </div>
      </div>

      {/* Print-only: render full report */}
      <div className="print-only">
        <PrintReport projectName={calc.projectName} computed={calc.computed} />
      </div>
    </div>
  );
}

// ===================================================================
// Global soil params
// ===================================================================
function GlobalSoilParams({ calc }: { calc: ReturnType<typeof useAmendmentsCalculator> }) {
  const first = calc.samples[0];
  if (!first) return null;
  const apply = (updates: Partial<SoilSample>) => calc.updateAllSamples(updates);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        <Label htmlFor="profundidad">Profundidad (cm)</Label>
        <Input
          id="profundidad"
          type="number"
          min={5} max={60} step={1}
          value={first.profundidad_cm}
          onChange={(e) => apply({ profundidad_cm: parseFloat(e.target.value) || 0 })}
          data-testid="input-profundidad"
        />
      </div>
      <div>
        <Label htmlFor="densidad">Densidad aparente (t/m³)</Label>
        <Input
          id="densidad"
          type="number"
          min={0.5} max={2.5} step={0.05}
          value={first.densidad_aparente}
          onChange={(e) => apply({ densidad_aparente: parseFloat(e.target.value) || 0 })}
          data-testid="input-densidad"
        />
      </div>
      <p className="col-span-2 text-xs text-muted-foreground">
        Factor de conversión universal <span className="font-mono">k = profundidad × densidad = {fmt(first.profundidad_cm * first.densidad_aparente, 1)}</span>.
        Se aplica a todas las muestras.
      </p>
    </div>
  );
}

// ===================================================================
// Capture (Pantalla 1)
// ===================================================================
type FieldKey =
  | "name" | "pct_Ca" | "pct_Mg" | "pct_K" | "pct_Na" | "pct_H" | "pct_Al"
  | "CIC" | "pH" | "MO_pct" | "area_ha";

const COLUMNS: Array<{ key: FieldKey; label: string; min?: number; max?: number; step?: number; range?: { min: number; max: number }; nullable?: boolean }> = [
  { key: "name", label: "Nombre" },
  { key: "pct_Ca", label: "%Ca", min: 0, max: 100, step: 0.1, range: OPTIMAL_RANGES.Ca },
  { key: "pct_Mg", label: "%Mg", min: 0, max: 100, step: 0.1, range: OPTIMAL_RANGES.Mg },
  { key: "pct_K", label: "%K", min: 0, max: 100, step: 0.1, range: OPTIMAL_RANGES.K },
  { key: "pct_Na", label: "%Na", min: 0, max: 100, step: 0.1, range: OPTIMAL_RANGES.Na },
  { key: "pct_H", label: "%H", min: 0, max: 100, step: 0.1, range: OPTIMAL_RANGES.H },
  { key: "pct_Al", label: "%Al", min: 0, max: 100, step: 0.1, range: OPTIMAL_RANGES.Al },
  { key: "CIC", label: "CIC", min: 1, max: 100, step: 0.1 },
  { key: "pH", label: "pH", min: 3, max: 11, step: 0.1, nullable: true },
  { key: "MO_pct", label: "%MO", min: 0, max: 30, step: 0.1, nullable: true },
  { key: "area_ha", label: "Área (ha)", min: 0.01, max: 10000, step: 0.1 },
];

function CaptureTable({ calc }: { calc: ReturnType<typeof useAmendmentsCalculator> }) {
  const balances = useMemo(() => calc.computed.map((c) => c.balance), [calc.computed]);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          Muestras de suelo <Badge variant="secondary">{calc.samples.length}/10</Badge>
        </CardTitle>
        <CardDescription>
          Capture hasta 10 muestras. Los valores en verde están en rango óptimo; ámbar = advertencia; rojo = fuera de rango.
          La suma de cationes (%Ca + %Mg + %K + %Na + %H + %Al) debe estar entre 95 % y 105 %.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b bg-muted/30 text-xs">
                <th className="text-left p-2 font-medium">#</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} className="text-left p-2 font-medium whitespace-nowrap">
                    {c.label}
                  </th>
                ))}
                <th className="text-left p-2 font-medium">Σ%</th>
                <th className="text-right p-2 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {calc.samples.map((s, idx) => {
                const bal = balances[idx];
                return (
                  <tr key={s.id} className="border-b hover:bg-muted/20" data-testid={`row-sample-${idx}`}>
                    <td className="p-2 align-top text-xs text-muted-foreground">{idx + 1}</td>
                    {COLUMNS.map((c) => {
                      const v = (s as any)[c.key];
                      if (c.key === "name") {
                        return (
                          <td key={c.key} className="p-1 min-w-[160px]">
                            <Input
                              value={s.name}
                              onChange={(e) => calc.updateSample(s.id, { name: e.target.value })}
                              className="h-8 text-sm"
                              data-testid={`input-name-${idx}`}
                            />
                          </td>
                        );
                      }
                      // nullable columns (pH, MO_pct) may hold undefined — show blank, store undefined on clear
                      const isNullable = !!c.nullable;
                      const numV = v == null ? (isNullable ? undefined : 0) : (typeof v === "number" ? v : Number(v));
                      const displayVal = numV == null ? "" : (isFinite(numV) ? numV : "");
                      const cls = c.range && numV != null ? pctClass(numV, c.range) : "";
                      return (
                        <td key={c.key} className="p-1">
                          <Input
                            type="number"
                            value={displayVal}
                            min={c.min}
                            max={c.max}
                            step={c.step}
                            onChange={(e) => {
                              if (e.target.value === "") {
                                calc.updateSample(s.id, { [c.key]: isNullable ? undefined : 0 } as Partial<SoilSample>);
                              } else {
                                const nv = parseFloat(e.target.value);
                                calc.updateSample(s.id, { [c.key]: isFinite(nv) ? nv : (isNullable ? undefined : 0) } as Partial<SoilSample>);
                              }
                            }}
                            className={`h-8 text-sm w-20 font-mono ${cls}`}
                            data-testid={`input-${c.key}-${idx}`}
                          />
                        </td>
                      );
                    })}
                    <td className="p-2 text-xs">
                      <span
                        className={
                          bal.severity === "ok"
                            ? "text-emerald-700"
                            : bal.severity === "warning"
                              ? "text-amber-700"
                              : "text-rose-700"
                        }
                        data-testid={`text-sum-${idx}`}
                      >
                        {fmt(bal.sum, 1)}
                      </span>
                    </td>
                    <td className="p-2 text-right whitespace-nowrap">
                      <Button
                        variant="ghost" size="icon"
                        onClick={() => calc.duplicateSample(s.id)}
                        title="Duplicar"
                        data-testid={`btn-duplicate-${idx}`}
                        disabled={!calc.canAdd}
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost" size="icon"
                        onClick={() => calc.deleteSample(s.id)}
                        title="Eliminar"
                        data-testid={`btn-delete-${idx}`}
                      >
                        <Trash2 className="w-4 h-4 text-rose-600" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {/* Optimal-range row */}
              <tr className="bg-emerald-50/60 text-xs font-medium">
                <td className="p-2 text-emerald-700">Óptimo</td>
                <td className="p-2"></td>
                <td className="p-2 text-emerald-700">{OPTIMAL_RANGES.Ca.min}–{OPTIMAL_RANGES.Ca.max}</td>
                <td className="p-2 text-emerald-700">{OPTIMAL_RANGES.Mg.min}–{OPTIMAL_RANGES.Mg.max}</td>
                <td className="p-2 text-emerald-700">{OPTIMAL_RANGES.K.min}–{OPTIMAL_RANGES.K.max}</td>
                <td className="p-2 text-emerald-700">0–{OPTIMAL_RANGES.Na.max}</td>
                <td className="p-2 text-emerald-700">0–{OPTIMAL_RANGES.H.max}</td>
                <td className="p-2 text-emerald-700">0–{OPTIMAL_RANGES.Al.max}</td>
                <td className="p-2 text-emerald-700">&lt; 25</td>
                <td className="p-2 text-emerald-700">5.5–7.5</td>
                <td className="p-2 text-emerald-700">&gt; 1.6</td>
                <td className="p-2"></td>
                <td className="p-2 text-emerald-700">100</td>
                <td className="p-2"></td>
              </tr>
            </tbody>
          </table>
        </div>

        {balances.some((b) => b.severity !== "ok") && (
          <Alert className="mt-4 border-amber-300">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <AlertDescription className="text-xs">
              {balances
                .map((b, i) => (b.message ? `${calc.samples[i].name}: ${b.message}` : null))
                .filter(Boolean)
                .join(" — ")}
            </AlertDescription>
          </Alert>
        )}

        <div className="flex items-center justify-between mt-4">
          <Button
            onClick={calc.addSample}
            disabled={!calc.canAdd}
            variant="outline"
            data-testid="btn-add-sample"
          >
            <Plus className="w-4 h-4 mr-2" /> Agregar muestra
          </Button>
          <p className="text-xs text-muted-foreground">
            Los datos se guardan automáticamente en este navegador.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ===================================================================
// Diagnosis (Pantalla 2)
// ===================================================================
function DiagnosisView({ computed }: { computed: ComputedSample[] }) {
  if (computed.length === 0) {
    return <Alert><AlertDescription>Agregue al menos una muestra.</AlertDescription></Alert>;
  }
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      {computed.map((c) => (
        <DiagnosisCard key={c.sample.id} c={c} />
      ))}
    </div>
  );
}

function DiagnosisCard({ c }: { c: ComputedSample }) {
  const { sample, ratios, diagnosis } = c;
  const radarData = [
    { axis: "Ca", actual: sample.pct_Ca, optimo: 70 },
    { axis: "Mg", actual: sample.pct_Mg, optimo: 15 },
    { axis: "K", actual: sample.pct_K, optimo: 6 },
    { axis: "Na", actual: sample.pct_Na, optimo: 3 },
    { axis: "H", actual: sample.pct_H, optimo: 3 },
    { axis: "Al", actual: sample.pct_Al, optimo: 3 },
  ];

  const moduleKeys = Object.keys(MODULE_LABELS_ES) as ModuleKey[];

  return (
    <Card data-testid={`card-diagnosis-${sample.id}`}>
      <CardHeader className="flex flex-row items-start justify-between pb-3">
        <div>
          <CardTitle className="text-base">{sample.name}</CardTitle>
          <CardDescription className="text-xs">
            CIC = {fmt(sample.CIC)} meq/100 g · pH = {sample.pH != null ? fmt(sample.pH) : "—"} · MO = {sample.MO_pct != null ? fmt(sample.MO_pct) : "—"} %
          </CardDescription>
        </div>
        <Badge className={STATUS_COLOR[diagnosis.status]} data-testid={`badge-status-${sample.id}`}>
          {STATUS_LABEL[diagnosis.status]}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData}>
                <PolarGrid />
                <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11 }} />
                <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 9 }} />
                <Radar name="Actual" dataKey="actual" stroke="#2D6A4F" fill="#2D6A4F" fillOpacity={0.35} />
                <Radar name="Óptimo" dataKey="optimo" stroke="#52B788" fill="#52B788" fillOpacity={0.1} strokeDasharray="4 3" />
                <Tooltip />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <div>
            <p className="text-xs uppercase font-semibold text-muted-foreground mb-2">Módulos activados</p>
            <ul className="space-y-1.5 text-sm">
              {moduleKeys.map((k) => {
                const flag = diagnosis[k];
                return (
                  <li key={k} className="flex items-start gap-2">
                    {flag.active ? (
                      <span
                        className="inline-block w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                        style={{ background: MODULE_COLORS[k] }}
                      />
                    ) : (
                      <span className="inline-block w-2 h-2 rounded-full mt-1.5 bg-slate-300 flex-shrink-0" />
                    )}
                    <span className={flag.active ? "text-slate-900" : "text-muted-foreground line-through"}>
                      <span className="font-medium">{MODULE_LABELS_ES[k]}</span>
                      {flag.active && <span className="text-xs text-muted-foreground"> — {flag.reason}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <div>
          <p className="text-xs uppercase font-semibold text-muted-foreground mb-2">Relaciones catiónicas</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <RatioCell label="Ca/Mg" value={ratios.Ca_Mg} range={OPTIMAL_RATIOS.Ca_Mg} />
            <RatioCell label="Mg/K" value={ratios.Mg_K} range={OPTIMAL_RATIOS.Mg_K} />
            <RatioCell label="(Ca+Mg)/K" value={ratios.CaMg_K} range={OPTIMAL_RATIOS.CaMg_K} />
            <RatioCell label="Ca/K" value={ratios.Ca_K} range={OPTIMAL_RATIOS.Ca_K} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RatioCell({ label, value, range }: { label: string; value: number; range: { min: number; max: number } }) {
  return (
    <div className={`rounded p-2 ${ratioClass(value, range)}`}>
      <div className="font-medium">{label}</div>
      <div className="font-mono text-sm">{fmt(value)}</div>
      <div className="text-[10px] opacity-70">óptimo {range.min}–{range.max}</div>
    </div>
  );
}

// ===================================================================
// Modules (Pantalla 3 — per-module panels)
// ===================================================================
function ModulesView({
  computed,
  updateAll,
}: {
  computed: ComputedSample[];
  updateAll: (updates: Partial<SoilSample>) => void;
}) {
  const moduleKeys = Object.keys(MODULE_LABELS_ES) as ModuleKey[];
  const [active, setActive] = useState<ModuleKey>("magnesio");
  const anyActive = (k: ModuleKey) =>
    computed.some((c) => c.diagnosis[k].active);
  const conflictNotes = useMemo(() => buildConflictNotes(computed), [computed]);

  return (
    <div className="space-y-4">
      {conflictNotes.length > 0 && (
        <Alert className="border-amber-300">
          <Info className="w-4 h-4 text-amber-600" />
          <AlertDescription className="text-xs">
            {conflictNotes.join(" · ")}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2 no-print">
        {moduleKeys.map((k) => (
          <Button
            key={k}
            variant={active === k ? "default" : "outline"}
            size="sm"
            onClick={() => setActive(k)}
            className="gap-2"
            style={active === k ? { backgroundColor: MODULE_COLORS[k], borderColor: MODULE_COLORS[k] } : undefined}
            data-testid={`btn-module-${k}`}
          >
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: MODULE_COLORS[k] }}
            />
            {MODULE_LABELS_ES[k]}
            {anyActive(k) && <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">activo</Badge>}
          </Button>
        ))}
      </div>

      <ModulePanel moduleKey={active} computed={computed} updateAll={updateAll} />
    </div>
  );
}

function buildConflictNotes(computed: ComputedSample[]): string[] {
  const notes: string[] = [];
  for (const c of computed) {
    const d = c.diagnosis;
    if (d.dolomita.active && d.enyesado.active) {
      notes.push(`${c.sample.name}: Dolomita + Enyesado activos. La dolomita ya aporta Ca; evaluar si se requiere yeso adicional.`);
    }
    if (d.encalado.active && d.enyesado.active) {
      notes.push(`${c.sample.name}: Encalado + Enyesado activos. No usar ambos; preferir cal si la causa es pH bajo.`);
    }
  }
  return notes;
}

function ModulePanel({
  moduleKey,
  computed,
  updateAll,
}: {
  moduleKey: ModuleKey;
  computed: ComputedSample[];
  updateAll: (updates: Partial<SoilSample>) => void;
}) {
  if (moduleKey === "carbono") return <CarbonPanel computed={computed} updateAll={updateAll} />;
  if (moduleKey === "azufre") return <AzufrePanel computed={computed} updateAll={updateAll} />;
  return <GenericPanel moduleKey={moduleKey} computed={computed} updateAll={updateAll} />;
}

function GenericPanel({
  moduleKey,
  computed,
  updateAll,
}: {
  moduleKey: Exclude<ModuleKey, "carbono" | "azufre">;
  computed: ComputedSample[];
  updateAll: (updates: Partial<SoilSample>) => void;
}) {
  const label = MODULE_LABELS_ES[moduleKey];
  const targetField = TARGET_FIELDS[moduleKey];
  const targetValue = computed[0]?.sample[targetField.key] as number | undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-full" style={{ background: MODULE_COLORS[moduleKey] }} />
          Módulo: {label}
        </CardTitle>
        <CardDescription className="text-xs">{MODULE_NOTES_ES[moduleKey]}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-end gap-3 mb-4 p-3 rounded border bg-muted/20">
          <div>
            <Label htmlFor={`target-${moduleKey}`} className="text-xs">
              {targetField.label}
            </Label>
            <Input
              id={`target-${moduleKey}`}
              type="number"
              min={targetField.min}
              max={targetField.max}
              step={targetField.step}
              value={targetValue ?? 0}
              onChange={(e) =>
                updateAll({ [targetField.key]: parseFloat(e.target.value) || 0 } as Partial<SoilSample>)
              }
              className="h-8 w-28"
              data-testid={`input-target-${moduleKey}`}
            />
            <p className="text-[10px] text-muted-foreground mt-1">{targetField.help}</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b bg-muted/30 text-xs">
                <th className="text-left p-2">Muestra</th>
                <th className="text-left p-2">Producto</th>
                <th className="text-left p-2">Δ% objetivo</th>
                <th className="text-left p-2">Δmeq/100g</th>
                <th className="text-left p-2">Dosis (kg/ha)</th>
                <th className="text-left p-2">Dosis (t/ha)</th>
                <th className="text-left p-2">Total ({"area × dosis"})</th>
              </tr>
            </thead>
            <tbody>
              {computed.map((c) => {
                const a = c.amendments[moduleKey] as AmendmentResult;
                return (
                  <tr key={c.sample.id} className="border-b">
                    <td className="p-2 font-medium">{c.sample.name}</td>
                    <td className="p-2 text-xs text-muted-foreground">
                      {a.product_name}
                      {a.alt_product_name && <div className="opacity-70">o {a.alt_product_name}</div>}
                    </td>
                    {a.active ? (
                      <>
                        <td className="p-2 font-mono">{fmt(a.delta_pct)} %</td>
                        <td className="p-2 font-mono">{fmt(a.delta_meq, 3)}</td>
                        <td className="p-2 font-mono font-semibold bg-amber-50 text-amber-900">
                          {fmt(a.dose_kg_ha, 0)}
                          {a.alt_dose_kg_ha != null && (
                            <div className="text-xs opacity-70 font-normal">o {fmt(a.alt_dose_kg_ha, 0)} (KCl)</div>
                          )}
                        </td>
                        <td className="p-2 font-mono">{fmt(a.dose_ton_ha, 2)}</td>
                        <td className="p-2 font-mono">
                          {fmt(a.total_kg, 0)} kg / {fmt(a.total_ton, 2)} t
                          {a.alt_total_kg != null && (
                            <div className="text-xs opacity-70">o {fmt(a.alt_total_kg, 0)} kg (KCl)</div>
                          )}
                        </td>
                      </>
                    ) : (
                      <td colSpan={5} className="p-2 text-muted-foreground italic line-through">
                        no aplica para esta muestra
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {computed.flatMap((c) => {
          const a = c.amendments[moduleKey] as AmendmentResult;
          return a.active && a.warning
            ? [
                <Alert key={c.sample.id} className="mt-3 border-amber-300">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <AlertDescription className="text-xs">
                    <strong>{c.sample.name}:</strong> {a.warning}
                  </AlertDescription>
                </Alert>,
              ]
            : [];
        })}
      </CardContent>
    </Card>
  );
}

const TARGET_FIELDS: Record<Exclude<ModuleKey, "carbono" | "azufre">, {
  key: keyof SoilSample;
  label: string;
  min: number;
  max: number;
  step: number;
  help: string;
}> = {
  magnesio: { key: "target_Mg_pct", label: "% Mg objetivo", min: 10, max: 30, step: 0.1, help: "Default: 15 % (rango óptimo 10–20 %)" },
  sodio:    { key: "target_Na_pct", label: "% Na máximo aceptable", min: 0, max: 5, step: 0.1, help: "Default: 5 % (límite agronómico)" },
  encalado: { key: "target_Ca_pct", label: "% Ca objetivo", min: 65, max: 90, step: 0.1, help: "Default: 70 % (rango óptimo 65–75 %)" },
  dolomita: { key: "target_Ca_pct", label: "% Ca objetivo", min: 65, max: 90, step: 0.1, help: "Default: 70 % (rango óptimo 65–75 %)" },
  potasio:  { key: "target_K_pct",  label: "% K objetivo", min: 5, max: 10, step: 0.1, help: "Default: 5 % (rango óptimo 5–7 %)" },
  enyesado: { key: "target_Ca_pct", label: "% Ca objetivo", min: 65, max: 90, step: 0.1, help: "Default: 70 % (rango óptimo 65–75 %)" },
};

function AzufrePanel({
  computed,
  updateAll,
}: {
  computed: ComputedSample[];
  updateAll: (updates: Partial<SoilSample>) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-full" style={{ background: MODULE_COLORS.azufre }} />
          Módulo: Azufre elemental
        </CardTitle>
        <CardDescription className="text-xs">{MODULE_NOTES_ES.azufre}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid md:grid-cols-2 gap-3 mb-4 p-3 rounded border bg-muted/20">
          <div>
            <Label htmlFor="azufre-texture" className="text-xs">Textura del suelo</Label>
            <Select
              value={computed[0]?.sample.soil_texture}
              onValueChange={(v) => updateAll({ soil_texture: v as "pesado" | "ligero" })}
            >
              <SelectTrigger id="azufre-texture" className="h-8" data-testid="select-azufre-texture">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pesado">Pesado (arcilloso/limoso)</SelectItem>
                <SelectItem value="ligero">Ligero (arenoso)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="azufre-method" className="text-xs">Método de aplicación</Label>
            <Select
              value={computed[0]?.sample.azufre_method}
              onValueChange={(v) => updateAll({ azufre_method: v as "incorporado" | "bandeo" })}
            >
              <SelectTrigger id="azufre-method" className="h-8" data-testid="select-azufre-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="incorporado">Incorporado al suelo</SelectItem>
                <SelectItem value="bandeo">En bandeo</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b bg-muted/30 text-xs">
                <th className="text-left p-2">Muestra</th>
                <th className="text-left p-2">pH</th>
                <th className="text-left p-2">Textura</th>
                <th className="text-left p-2">Método</th>
                <th className="text-left p-2">Dosis S (kg/ha)</th>
                <th className="text-left p-2">Total (kg)</th>
              </tr>
            </thead>
            <tbody>
              {computed.map((c) => {
                const a = c.amendments.azufre as AzufreAmendmentResult;
                return (
                  <tr key={c.sample.id} className="border-b">
                    <td className="p-2 font-medium">{c.sample.name}</td>
                    <td className="p-2 font-mono">{fmt(a.pH)}</td>
                    <td className="p-2 text-xs">{a.texture === "pesado" ? "Pesado" : "Ligero"}</td>
                    <td className="p-2 text-xs">{a.method === "incorporado" ? "Incorporado" : "Bandeo"}</td>
                    {a.active ? (
                      <>
                        <td className="p-2 font-mono font-semibold bg-amber-50 text-amber-900">
                          {fmt(a.dose_kg_ha, 0)}
                        </td>
                        <td className="p-2 font-mono">{fmt(a.total_kg, 0)}</td>
                      </>
                    ) : (
                      <td colSpan={2} className="p-2 text-muted-foreground italic line-through">
                        no aplica (pH ≤ 7.5)
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function CarbonPanel({
  computed,
  updateAll,
}: {
  computed: ComputedSample[];
  updateAll: (updates: Partial<SoilSample>) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-full" style={{ background: MODULE_COLORS.carbono }} />
          Módulo: Carbono / Materia orgánica
        </CardTitle>
        <CardDescription className="text-xs">
          {MODULE_NOTES_ES.carbono} Factor de Van Bemmelen: %C = %MO × 0.58.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b bg-muted/30 text-xs">
                <th className="text-left p-2">Muestra</th>
                <th className="text-left p-2">MO actual</th>
                <th className="text-left p-2">MO objetivo</th>
                <th className="text-left p-2">ΔMO</th>
                <th className="text-left p-2">Material</th>
                <th className="text-left p-2">%C material</th>
                <th className="text-left p-2">Dosis (t/ha)</th>
                <th className="text-left p-2">Total (t)</th>
              </tr>
            </thead>
            <tbody>
              {computed.map((c) => {
                const a = c.amendments.carbono as CarbonAmendmentResult;
                return (
                  <tr key={c.sample.id} className="border-b">
                    <td className="p-2 font-medium">{c.sample.name}</td>
                    <td className="p-2 font-mono">{fmt(a.current_MO_pct)} %</td>
                    <td className="p-2 font-mono">{fmt(a.target_MO_pct)} %</td>
                    <td className="p-2 font-mono">{fmt(a.delta_MO_pct)} %</td>
                    <td className="p-2 text-xs">{a.material_name}</td>
                    <td className="p-2 font-mono">{fmt(a.material_carbon_pct)} %</td>
                    {a.active ? (
                      <>
                        <td className="p-2 font-mono font-semibold bg-amber-50 text-amber-900">
                          {fmt(a.dose_ton_ha, 1)}
                        </td>
                        <td className="p-2 font-mono">{fmt(a.total_ton, 1)}</td>
                      </>
                    ) : (
                      <td colSpan={2} className="p-2 text-muted-foreground italic line-through">
                        no aplica (MO ≥ 1.6 %)
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <CarbonMaterialPicker computed={computed} updateAll={updateAll} />
      </CardContent>
    </Card>
  );
}

function CarbonMaterialPicker({
  computed,
  updateAll,
}: {
  computed: ComputedSample[];
  updateAll: (updates: Partial<SoilSample>) => void;
}) {
  const first = computed[0]?.sample;
  if (!first) return null;
  return (
    <div className="grid md:grid-cols-3 gap-3 mt-4 p-3 rounded border bg-muted/20">
      <div>
        <Label htmlFor="mat-name" className="text-xs">Material orgánico</Label>
        <Select
          value={ORGANIC_MATERIALS.find((m) => m.name === first.carbon_material_name)?.name ?? first.carbon_material_name}
          onValueChange={(name) => {
            const m = ORGANIC_MATERIALS.find((x) => x.name === name);
            if (m) updateAll({ carbon_material_name: m.name, carbon_material_pct: m.carbon_pct });
          }}
        >
          <SelectTrigger id="mat-name" className="h-8" data-testid="select-carbon-material">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ORGANIC_MATERIALS.map((m) => (
              <SelectItem key={m.name} value={m.name}>
                {m.name} ({m.carbon_pct} % C)
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="mat-c" className="text-xs">% Carbono del material</Label>
        <Input
          id="mat-c"
          type="number"
          min={1} max={60} step={0.1}
          value={first.carbon_material_pct}
          onChange={(e) => updateAll({ carbon_material_pct: parseFloat(e.target.value) || 1 })}
          className="h-8"
          data-testid="input-carbon-pct"
        />
      </div>
      <div>
        <Label htmlFor="mo-target" className="text-xs">% MO objetivo</Label>
        <Input
          id="mo-target"
          type="number"
          min={1} max={20} step={0.1}
          value={first.target_MO_pct}
          onChange={(e) => updateAll({ target_MO_pct: parseFloat(e.target.value) || DEFAULT_TARGETS.MO })}
          className="h-8"
          data-testid="input-mo-target"
        />
      </div>
    </div>
  );
}

// ===================================================================
// Summary (Pantalla 4)
// ===================================================================
function SummaryView({ projectName, computed }: { projectName: string; computed: ComputedSample[] }) {
  const totals = useMemo(() => computeTotals(computed), [computed]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Resumen consolidado de enmiendas</CardTitle>
        <CardDescription className="text-xs">
          Todas las muestras × todas las enmiendas. Las celdas con dosis representan recomendaciones activas para ese diagnóstico.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/40 text-xs">
                <th className="text-left p-2">Muestra</th>
                <th className="text-left p-2">Estado</th>
                <th className="text-left p-2">Área (ha)</th>
                <th className="text-right p-2">MgSO₄ (kg/ha)</th>
                <th className="text-right p-2">Yeso-Na (t/ha)</th>
                <th className="text-right p-2">Cal (t/ha)</th>
                <th className="text-right p-2">Dolomita (t/ha)</th>
                <th className="text-right p-2">K₂SO₄ (kg/ha)</th>
                <th className="text-right p-2">MO (t/ha)</th>
                <th className="text-right p-2">Yeso-Ca (t/ha)</th>
                <th className="text-right p-2">S (kg/ha)</th>
              </tr>
            </thead>
            <tbody>
              {computed.map((c) => {
                const a = c.amendments;
                return (
                  <tr key={c.sample.id} className="border-b">
                    <td className="p-2 font-medium">{c.sample.name}</td>
                    <td className="p-2">
                      <Badge className={STATUS_COLOR[c.diagnosis.status]}>
                        {STATUS_LABEL[c.diagnosis.status]}
                      </Badge>
                    </td>
                    <td className="p-2 font-mono text-xs">{fmt(c.sample.area_ha)}</td>
                    <DoseCell active={a.magnesio.active} value={fmt(a.magnesio.dose_kg_ha, 0)} />
                    <DoseCell active={a.sodio.active} value={fmt(a.sodio.dose_ton_ha, 2)} />
                    <DoseCell active={a.encalado.active} value={fmt(a.encalado.dose_ton_ha, 2)} />
                    <DoseCell active={a.dolomita.active} value={fmt(a.dolomita.dose_ton_ha, 2)} />
                    <DoseCell active={a.potasio.active} value={fmt(a.potasio.dose_kg_ha, 0)} />
                    <DoseCell active={a.carbono.active} value={fmt(a.carbono.dose_ton_ha, 2)} />
                    <DoseCell active={a.enyesado.active} value={fmt(a.enyesado.dose_ton_ha, 2)} />
                    <DoseCell active={a.azufre.active} value={fmt(a.azufre.dose_kg_ha, 0)} />
                  </tr>
                );
              })}
              <tr className="bg-emerald-50/50 font-semibold text-xs">
                <td className="p-2" colSpan={3}>Total ({fmt(totals.area, 1)} ha)</td>
                <td className="p-2 text-right font-mono">{fmt(totals.mg_kg, 0)} kg</td>
                <td className="p-2 text-right font-mono">{fmt(totals.na_t, 2)} t</td>
                <td className="p-2 text-right font-mono">{fmt(totals.cal_t, 2)} t</td>
                <td className="p-2 text-right font-mono">{fmt(totals.dol_t, 2)} t</td>
                <td className="p-2 text-right font-mono">{fmt(totals.k_kg, 0)} kg</td>
                <td className="p-2 text-right font-mono">{fmt(totals.mo_t, 2)} t</td>
                <td className="p-2 text-right font-mono">{fmt(totals.ca_t, 2)} t</td>
                <td className="p-2 text-right font-mono">{fmt(totals.s_kg, 0)} kg</td>
              </tr>
            </tbody>
          </table>
        </div>

        <Separator className="my-4" />

        <div className="grid md:grid-cols-2 gap-4 text-xs">
          <Alert>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <AlertDescription>
              Proyecto: <strong>{projectName}</strong>. {computed.length} muestra{computed.length === 1 ? "" : "s"} analizadas.
            </AlertDescription>
          </Alert>
          <Alert>
            <Info className="w-4 h-4" />
            <AlertDescription>
              Use <strong>Imprimir</strong> o <strong>Descargar PDF</strong> para generar el reporte técnico completo.
            </AlertDescription>
          </Alert>
        </div>
      </CardContent>
    </Card>
  );
}

function DoseCell({ active, value }: { active: boolean; value: string }) {
  return (
    <td
      className={`p-2 text-right font-mono ${active ? "bg-amber-50 text-amber-900 font-semibold" : "text-muted-foreground line-through"}`}
    >
      {active ? value : "—"}
    </td>
  );
}

function computeTotals(computed: ComputedSample[]) {
  const acc = { area: 0, mg_kg: 0, na_t: 0, cal_t: 0, dol_t: 0, k_kg: 0, mo_t: 0, ca_t: 0, s_kg: 0 };
  for (const c of computed) {
    const a = c.amendments;
    acc.area += c.sample.area_ha;
    if (a.magnesio.active) acc.mg_kg += a.magnesio.total_kg;
    if (a.sodio.active) acc.na_t += a.sodio.total_ton;
    if (a.encalado.active) acc.cal_t += a.encalado.total_ton;
    if (a.dolomita.active) acc.dol_t += a.dolomita.total_ton;
    if (a.potasio.active) acc.k_kg += a.potasio.total_kg;
    if (a.carbono.active) acc.mo_t += a.carbono.total_ton;
    if (a.enyesado.active) acc.ca_t += a.enyesado.total_ton;
    if (a.azufre.active) acc.s_kg += a.azufre.total_kg;
  }
  return acc;
}

// ===================================================================
// Print
// ===================================================================
function PrintStyles() {
  return (
    <style>{`
      .print-only { display: none; }
      @media print {
        .no-print { display: none !important; }
        .print-only { display: block !important; }
        body { background: white; }
      }
    `}</style>
  );
}

function PrintReport({ projectName, computed }: { projectName: string; computed: ComputedSample[] }) {
  return (
    <div className="text-sm">
      <header className="mb-4">
        <h1 className="text-xl font-bold">Calculadora de enmiendas de suelo</h1>
        <p>{projectName} — {new Date().toLocaleDateString("es-MX")}</p>
      </header>
      <SummaryView projectName={projectName} computed={computed} />
    </div>
  );
}

import { Fragment, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, isQueued } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Save, Plus, Trash2, ChevronLeft, ChevronRight, Printer, FileText, Calculator, AlertTriangle, CheckCircle2, FileSpreadsheet, FileDown, Check } from "lucide-react";
import { downloadProgramPdf, downloadProductsCsv } from "@/lib/nutrition-export";
import {
  calculateNutritionProgram,
  getDefaultProducts,
  ETAPAS,
  type SoilInputs,
  type WaterInputs,
  type ProductionSystem,
  type CalculationResult,
  type MacroKey,
  type MicroKey,
} from "@/lib/nutrition-calculator";
import type { NutritionProgram, NutritionProgramProduct } from "@shared/schema";

interface SoilAnalysisRow {
  organicMatter?: string | null;
  ph?: string | null;
  electricConductivity?: string | null;
  nitrogenTotal?: string | null;
  phosphorus?: string | null;
  potassium?: string | null;
  calcium?: string | null;
  magnesium?: string | null;
  sulfur?: string | null;
  iron?: string | null;
  copper?: string | null;
  manganese?: string | null;
  zinc?: string | null;
  boron?: string | null;
  cec?: string | null;
}

interface Props {
  parcelId: string;
  parcelName?: string;
  parcelArea?: string | number | null;
  parcelCrop?: string | null;
  ownerName?: string;
}

interface ProductRow {
  id?: string;
  productName: string;
  unit: string;
  e1Kg: number;
  e2Kg: number;
  e3Kg: number;
  e4Kg: number;
  priceUnit: number;
}

const STEPS = [
  { id: 0, label: "Datos generales" },
  { id: 1, label: "Análisis de suelo" },
  { id: 2, label: "Análisis de agua" },
  { id: 3, label: "Resultados y programa" },
];

const macroLabels: Record<MacroKey, string> = {
  N: "N",
  P2O5: "P₂O₅",
  K2O: "K₂O",
  CaO: "CaO",
  MgO: "MgO",
  S: "S",
};

const microLabels: Record<MicroKey, string> = {
  Fe: "Fe",
  Cu: "Cu",
  Mn: "Mn",
  Zn: "Zn",
  B: "B",
};

function emptySoil(): SoilInputs {
  return {
    profundidadCm: 30,
    da: 1.0,
    mosPct: 0,
    ph: 7,
    ce: 0,
    nInorgPpm: 0,
    pPpm: 0,
    kPpm: 0,
    caPpm: 0,
    mgPpm: 0,
    sPpm: 0,
    fePpm: 0,
    cuPpm: 0,
    mnPpm: 0,
    znPpm: 0,
    bPpm: 0,
  };
}

function emptyWater(): WaterInputs {
  return {
    ph: 7,
    ce: 0,
    caMeq: 0, mgMeq: 0, kMeq: 0, naMeq: 0, nh4Meq: 0,
    no3Meq: 0, so4Meq: 0, h2po4Meq: 0, co3Meq: 0, hco3Meq: 0, clMeq: 0,
    fePpm: 0, cuPpm: 0, mnPpm: 0, znPpm: 0, bPpm: 0,
  };
}

function fmt(n: number, dec = 2): string {
  if (!isFinite(n)) return "—";
  return n.toLocaleString("es-MX", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export default function NutritionCalculatorTab({ parcelId, parcelName, parcelArea, parcelCrop, ownerName }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [view, setView] = useState<"list" | "wizard">("list");
  const [activeProgramId, setActiveProgramId] = useState<string | null>(null);
  const [step, setStep] = useState(0);

  // Form state
  const [name, setName] = useState("Programa de nutrición");
  const [cropName, setCropName] = useState(parcelCrop || "Maíz blanco grano");
  const [variety, setVariety] = useState("");
  const [productionSystem, setProductionSystem] = useState<ProductionSystem>("riego_rodado");
  const [rendimientoMeta, setRendimientoMeta] = useState<number>(15);
  const [superficieHas, setSuperficieHas] = useState<number>(
    parcelArea ? parseFloat(String(parcelArea)) || 1 : 1,
  );
  const [moo, setMoo] = useState<number>(0);
  const [notes, setNotes] = useState("");
  const [soil, setSoil] = useState<SoilInputs>(emptySoil());
  const [water, setWater] = useState<WaterInputs>(emptyWater());
  const [includeWater, setIncludeWater] = useState(false);
  const [products, setProducts] = useState<ProductRow[]>(() => getDefaultProducts());

  // Load saved programs
  const { data: programsData } = useQuery<{ programs: NutritionProgram[] }>({
    queryKey: [`/api/parcels/${parcelId}/nutrition-programs`],
  });
  const programs = programsData?.programs || [];

  // On first load, if there are saved programs, jump straight to the most recent
  // active one so the user sees their latest work instead of an empty list.
  const [autoOpened, setAutoOpened] = useState(false);
  useEffect(() => {
    if (autoOpened || view !== "list") return;
    if (programs.length === 0) return;
    const latest = [...programs].sort(
      (a, b) =>
        new Date(b.updatedAt ?? b.createdAt ?? 0).getTime() -
        new Date(a.updatedAt ?? a.createdAt ?? 0).getTime(),
    )[0];
    if (latest) {
      loadProgram(latest);
    }
    setAutoOpened(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programs, view, autoOpened]);

  // Pre-fill from latest soil analysis
  const { data: soilData } = useQuery<{ analyses: SoilAnalysisRow[] }>({
    queryKey: [`/api/parcels/${parcelId}/soil-analysis`],
  });

  useEffect(() => {
    // Only auto-prefill when creating a NEW program (not editing a saved one)
    // to avoid clobbering loaded values.
    if (
      view === "wizard" &&
      step === 1 &&
      activeProgramId === null &&
      soilData?.analyses?.length
    ) {
      const latest = soilData.analyses[0];
      const num = (v: string | null | undefined): number => parseFloat(v ?? "") || 0;
      setSoil((prev) => ({
        ...prev,
        mosPct: num(latest.organicMatter) || prev.mosPct,
        ph: num(latest.ph) || prev.ph,
        ce: num(latest.electricConductivity) || prev.ce,
        nInorgPpm: num(latest.nitrogenTotal) || prev.nInorgPpm,
        pPpm: num(latest.phosphorus) || prev.pPpm,
        kPpm: num(latest.potassium) || prev.kPpm,
        caPpm: num(latest.calcium) || prev.caPpm,
        mgPpm: num(latest.magnesium) || prev.mgPpm,
        sPpm: num(latest.sulfur) || prev.sPpm,
        fePpm: num(latest.iron) || prev.fePpm,
        cuPpm: num(latest.copper) || prev.cuPpm,
        mnPpm: num(latest.manganese) || prev.mnPpm,
        znPpm: num(latest.zinc) || prev.znPpm,
        bPpm: num(latest.boron) || prev.bPpm,
        cic: num(latest.cec) || prev.cic,
      }));
    }
  }, [view, step, soilData]);

  // Per-step validation gates
  const stepErrors = useMemo<Record<number, string[]>>(() => {
    const errs: Record<number, string[]> = { 0: [], 1: [], 2: [], 3: [] };
    if (!name.trim()) errs[0].push("El nombre del programa es obligatorio.");
    if (!cropName.trim()) errs[0].push("El cultivo es obligatorio.");
    if (!(rendimientoMeta > 0)) errs[0].push("Rendimiento meta debe ser mayor a 0.");
    if (!(superficieHas > 0)) errs[0].push("Superficie debe ser mayor a 0.");
    if (moo < 0) errs[0].push("MOO no puede ser negativo.");

    if (!(soil.profundidadCm > 0)) errs[1].push("Profundidad debe ser > 0 cm.");
    if (!(soil.da > 0)) errs[1].push("Densidad aparente debe ser > 0.");
    if (soil.ph <= 0 || soil.ph > 14) errs[1].push("pH debe estar entre 0 y 14.");
    if (soil.mosPct < 0) errs[1].push("MOS no puede ser negativo.");
    (["nInorgPpm","pPpm","kPpm","caPpm","mgPpm","sPpm"] as const).forEach((k) => {
      if (soil[k] < 0) errs[1].push(`${k} no puede ser negativo.`);
    });

    if (includeWater) {
      if (water.ph !== undefined && (water.ph <= 0 || water.ph > 14)) {
        errs[2].push("pH del agua debe estar entre 0 y 14.");
      }
      if (water.ce !== undefined && water.ce < 0) errs[2].push("CE del agua no puede ser negativa.");
    }
    return errs;
  }, [name, cropName, rendimientoMeta, superficieHas, moo, soil, water, includeWater]);

  const canAdvance = (stepErrors[step] || []).length === 0;
  const canSave = STEPS.every((_, i) => (stepErrors[i] || []).length === 0);

  // Compute results live
  const results: CalculationResult | null = useMemo(() => {
    try {
      return calculateNutritionProgram(
        { rendimientoMeta, superficieHas, productionSystem, moo },
        soil,
        includeWater ? water : undefined,
      );
    } catch {
      return null;
    }
  }, [rendimientoMeta, superficieHas, productionSystem, moo, soil, water, includeWater]);

  // Cost calculations
  const productRows = useMemo(() => {
    return products.map((p) => {
      const total = (p.e1Kg || 0) + (p.e2Kg || 0) + (p.e3Kg || 0) + (p.e4Kg || 0);
      const costHa = total * (p.priceUnit || 0);
      return { ...p, totalKgLHa: total, costHa };
    });
  }, [products]);

  const totalCostHa = useMemo(() => productRows.reduce((s, p) => s + p.costHa, 0), [productRows]);
  const totalCostSup = totalCostHa * superficieHas;

  const saveMutation = useMutation({
    mutationFn: async (): Promise<{ id: string } | { queued: true }> => {
      const programId = activeProgramId;
      const method = programId ? "PATCH" : "POST";
      const url = programId
        ? `/api/nutrition-programs/${programId}`
        : `/api/parcels/${parcelId}/nutrition-programs`;

      // Products are included in the same payload so a single enqueued operation
      // preserves the full save (program + products) even when offline.
      const combinedPayload = {
        name,
        cropName,
        variety: variety || null,
        productionSystem,
        rendimientoMeta,
        superficieHas,
        moo,
        soilData: soil,
        waterData: includeWater ? water : null,
        results: results,
        status: "active",
        notes: notes || null,
        products: productRows.map((p, i) => ({
          productName: p.productName,
          unit: p.unit,
          totalKgLHa: p.totalKgLHa,
          e1Kg: p.e1Kg,
          e2Kg: p.e2Kg,
          e3Kg: p.e3Kg,
          e4Kg: p.e4Kg,
          priceUnit: p.priceUnit,
          costHa: p.costHa,
          sortOrder: i,
        })),
      };

      const programRes = await apiRequest(method, url, combinedPayload, {
        offlineSafe: true,
        offlineLabel: `Programa de nutrición: ${name}`,
        invalidateOnSync: [[`/api/parcels/${parcelId}/nutrition-programs`]],
      });

      if (isQueued(programRes)) {
        return { queued: true };
      }

      const programJson = await programRes.json();
      return { id: programJson.program.id };
    },
    onSuccess: (result) => {
      if ("queued" in result) {
        toast({
          title: "Guardado sin conexión",
          description: "El programa se enviará al servidor cuando vuelva la señal.",
        });
        return;
      }
      setActiveProgramId(result.id);
      qc.invalidateQueries({ queryKey: [`/api/parcels/${parcelId}/nutrition-programs`] });
      toast({
        title: "Programa guardado",
        description: "Los cambios se guardaron correctamente.",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/nutrition-programs/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Error al eliminar");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/parcels/${parcelId}/nutrition-programs`] });
    },
  });

  function loadProgram(p: NutritionProgram) {
    setActiveProgramId(p.id);
    setName(p.name);
    setCropName(p.cropName);
    setVariety(p.variety || "");
    setProductionSystem(p.productionSystem as ProductionSystem);
    setRendimientoMeta(parseFloat(String(p.rendimientoMeta)));
    setSuperficieHas(parseFloat(String(p.superficieHas)));
    setMoo(parseFloat(String(p.moo ?? 0)) || 0);
    setNotes(p.notes || "");
    setSoil((p.soilData as SoilInputs) || emptySoil());
    setWater((p.waterData as WaterInputs | null) || emptyWater());
    setIncludeWater(!!p.waterData);
    // Load products
    fetch(`/api/nutrition-programs/${p.id}`)
      .then((r) => r.json())
      .then((data: { products?: NutritionProgramProduct[] }) => {
        if (data.products?.length) {
          setProducts(
            data.products.map((pp) => ({
              id: pp.id,
              productName: pp.productName,
              unit: pp.unit ?? "kg",
              e1Kg: parseFloat(String(pp.e1Kg ?? 0)) || 0,
              e2Kg: parseFloat(String(pp.e2Kg ?? 0)) || 0,
              e3Kg: parseFloat(String(pp.e3Kg ?? 0)) || 0,
              e4Kg: parseFloat(String(pp.e4Kg ?? 0)) || 0,
              priceUnit: parseFloat(String(pp.priceUnit ?? 0)) || 0,
            })),
          );
        }
      });
    setView("wizard");
    setStep(3);
  }

  function startNew() {
    setActiveProgramId(null);
    setName(`Programa ${new Date().toLocaleDateString("es-MX")}`);
    setCropName(parcelCrop || "Maíz blanco grano");
    setVariety("");
    setProductionSystem("riego_rodado");
    setRendimientoMeta(15);
    setSuperficieHas(parcelArea ? parseFloat(String(parcelArea)) || 1 : 1);
    setMoo(0);
    setNotes("");
    setSoil(emptySoil());
    setWater(emptyWater());
    setIncludeWater(false);
    setProducts(getDefaultProducts());
    setStep(0);
    setView("wizard");
  }

  // ============ Render ============

  if (view === "list") {
    return (
      <Card data-testid="card-nutrition-list">
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Calculator className="w-5 h-5 text-green-700" /> Calculadora de Nutrición y Bioestimulación
              </CardTitle>
              <CardDescription>
                Basada en Oseguera y Sánchez (2015) y NOM-021-SEMARNAT-2000
              </CardDescription>
            </div>
            <Button onClick={startNew} data-testid="button-new-nutrition-program">
              <Plus className="w-4 h-4 mr-2" /> Nuevo programa
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {programs.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <FileSpreadsheet className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No hay programas de nutrición guardados.</p>
              <p className="text-sm">Crea uno nuevo a partir del análisis de suelo y agua de tu parcela.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {programs.map((p) => (
                <div
                  key={p.id}
                  className="border rounded-lg p-3 flex items-center justify-between gap-3 hover:bg-muted/50"
                  data-testid={`row-program-${p.id}`}
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.cropName} • {p.productionSystem === "fertirriego" ? "Fertirriego" : "Riego rodado"} •{" "}
                      Meta: {fmt(parseFloat(String(p.rendimientoMeta)), 1)} ton/ha •{" "}
                      {new Date(p.createdAt).toLocaleDateString("es-MX")}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <Button size="sm" variant="outline" onClick={() => loadProgram(p)} data-testid={`button-load-${p.id}`}>
                      Abrir
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm("¿Eliminar programa?")) deleteMutation.mutate(p.id);
                      }}
                      data-testid={`button-delete-${p.id}`}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // ============ Wizard ============

  return (
    <Card data-testid="card-nutrition-wizard">
      <CardHeader className="print:hidden">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="w-5 h-5 text-green-700" /> {name || "Programa de nutrición"}
            </CardTitle>
            <CardDescription>
              Paso {step + 1} de {STEPS.length}: {STEPS[step].label}
            </CardDescription>
          </div>
          <Button variant="ghost" onClick={() => setView("list")} data-testid="button-back-list">
            ← Volver a la lista
          </Button>
        </div>
        {/* Step indicator */}
        <div className="flex items-center mt-4 overflow-x-auto pb-2">
          {STEPS.map((s, i) => (
            <Fragment key={s.id}>
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
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 min-w-[2rem] mx-2 mb-5 transition-colors ${
                  i < step ? "bg-emerald-400" : "bg-muted-foreground/20"
                }`} />
              )}
            </Fragment>
          ))}
        </div>
      </CardHeader>

      <CardContent>
        {(stepErrors[step] || []).length > 0 && (
          <Alert variant="destructive" className="mb-4 print:hidden" data-testid="alert-step-errors">
            <AlertTriangle className="w-4 h-4" />
            <AlertDescription>
              <ul className="list-disc list-inside text-sm">
                {stepErrors[step].map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {/* Step 0 - General */}
        {step === 0 && (
          <div className="grid gap-4 sm:grid-cols-2" data-testid="step-content-general">
            <div>
              <Label>Nombre del programa</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-name" />
            </div>
            <div>
              <Label>Cultivo</Label>
              <Input value={cropName} onChange={(e) => setCropName(e.target.value)} data-testid="input-crop" />
            </div>
            <div>
              <Label>Variedad / Híbrido (opcional)</Label>
              <Input value={variety} onChange={(e) => setVariety(e.target.value)} data-testid="input-variety" />
            </div>
            <div>
              <Label>Sistema de producción</Label>
              <Select value={productionSystem} onValueChange={(v) => setProductionSystem(v as ProductionSystem)}>
                <SelectTrigger data-testid="select-system"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="riego_rodado">Riego rodado</SelectItem>
                  <SelectItem value="fertirriego">Fertirriego</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Rendimiento meta (ton/ha)</Label>
              <Input
                type="number" step="0.1" min="0"
                value={rendimientoMeta}
                onChange={(e) => setRendimientoMeta(parseFloat(e.target.value) || 0)}
                data-testid="input-rendimiento"
              />
            </div>
            <div>
              <Label>Superficie (ha)</Label>
              <Input
                type="number" step="0.01" min="0"
                value={superficieHas}
                onChange={(e) => setSuperficieHas(parseFloat(e.target.value) || 0)}
                data-testid="input-superficie"
              />
            </div>
            <div>
              <Label>MOO – N orgánico externo (kg N/ha)</Label>
              <Input
                type="number" step="1" min="0"
                value={moo}
                onChange={(e) => setMoo(parseFloat(e.target.value) || 0)}
                data-testid="input-moo"
              />
              <p className="text-xs text-muted-foreground mt-1">
                N aportado por rastrojos, estiércol o composta incorporados.
              </p>
            </div>
            <div className="sm:col-span-2">
              <Label>Notas del técnico (opcional)</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} data-testid="input-notes" />
            </div>
          </div>
        )}

        {/* Step 1 - Soil */}
        {step === 1 && (
          <div data-testid="step-content-soil">
            {soilData?.analyses?.length ? (
              <Alert className="mb-4">
                <CheckCircle2 className="w-4 h-4" />
                <AlertDescription>
                  Se pre-llenaron los campos con el análisis de suelo más reciente de la parcela.
                  Puedes ajustar manualmente cualquier valor.
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ["profundidadCm", "Profundidad (cm)"],
                ["da", "Densidad aparente Da (g/cm³)"],
                ["mosPct", "MOS (%)"],
                ["ph", "pH"],
                ["ce", "CE (dS/m)"],
                ["nInorgPpm", "N inorgánico (ppm)"],
                ["pPpm", "P (ppm)"],
                ["kPpm", "K (ppm)"],
                ["caPpm", "Ca (ppm)"],
                ["mgPpm", "Mg (ppm)"],
                ["sPpm", "S (ppm)"],
                ["fePpm", "Fe (ppm)"],
                ["cuPpm", "Cu (ppm)"],
                ["mnPpm", "Mn (ppm)"],
                ["znPpm", "Zn (ppm)"],
                ["bPpm", "B (ppm)"],
                ["cic", "CIC (meq/100g)"],
                ["pctCa", "% Ca (saturación)"],
                ["pctMg", "% Mg (saturación)"],
                ["pctK", "% K (saturación)"],
                ["pctNa", "% Na (saturación)"],
              ].map(([key, label]) => {
                const k = key as keyof SoilInputs;
                const current = soil[k];
                return (
                  <div key={key}>
                    <Label className="text-xs">{label}</Label>
                    <Input
                      type="number" step="0.01"
                      value={typeof current === "number" ? current : ""}
                      onChange={(e) =>
                        setSoil({ ...soil, [k]: parseFloat(e.target.value) || 0 } as SoilInputs)
                      }
                      data-testid={`input-soil-${key}`}
                    />
                  </div>
                );
              })}
            </div>
            <div className="mt-4">
              <Label>Textura (descripción libre)</Label>
              <Input
                value={soil.textura || ""}
                onChange={(e) => setSoil({ ...soil, textura: e.target.value })}
                placeholder="p. ej. Franco, Franco-arcilloso"
                data-testid="input-soil-texture"
              />
            </div>
            <div className="mt-4 p-3 bg-muted rounded-lg text-sm">
              <strong>Peso del suelo (PS):</strong> {fmt(results?.ps || 0, 0)} kg/ha
              <span className="text-xs text-muted-foreground ml-2">
                (Da × profundidad × 10 000)
              </span>
            </div>
          </div>
        )}

        {/* Step 2 - Water */}
        {step === 2 && (
          <div data-testid="step-content-water">
            <div className="flex items-center gap-3 mb-4">
              <input
                type="checkbox"
                id="includeWater"
                checked={includeWater}
                onChange={(e) => setIncludeWater(e.target.checked)}
                className="w-4 h-4"
                data-testid="checkbox-include-water"
              />
              <Label htmlFor="includeWater" className="cursor-pointer">
                Incluir análisis de agua de riego (genera diagnóstico de calidad y dosis de ácido).
              </Label>
            </div>
            {includeWater && (
              <>
                <h4 className="font-semibold text-sm mt-4 mb-2">Cationes y aniones (meq/L)</h4>
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    ["caMeq", "Ca²⁺"],
                    ["mgMeq", "Mg²⁺"],
                    ["kMeq", "K⁺"],
                    ["naMeq", "Na⁺"],
                    ["nh4Meq", "NH₄⁺"],
                    ["no3Meq", "NO₃⁻"],
                    ["so4Meq", "SO₄²⁻"],
                    ["h2po4Meq", "H₂PO₄⁻"],
                    ["co3Meq", "CO₃²⁻"],
                    ["hco3Meq", "HCO₃⁻"],
                    ["clMeq", "Cl⁻"],
                  ].map(([key, label]) => {
                    const k = key as keyof WaterInputs;
                    const current = water[k];
                    return (
                      <div key={key}>
                        <Label className="text-xs">{label}</Label>
                        <Input
                          type="number" step="0.001"
                          value={typeof current === "number" ? current : ""}
                          onChange={(e) =>
                            setWater({ ...water, [k]: parseFloat(e.target.value) || 0 } as WaterInputs)
                          }
                          data-testid={`input-water-${key}`}
                        />
                      </div>
                    );
                  })}
                </div>
                <h4 className="font-semibold text-sm mt-4 mb-2">Físico-químicos y micros (ppm)</h4>
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    ["ph", "pH"],
                    ["ce", "CE (dS/m)"],
                    ["fePpm", "Fe (ppm)"],
                    ["cuPpm", "Cu (ppm)"],
                    ["mnPpm", "Mn (ppm)"],
                    ["znPpm", "Zn (ppm)"],
                    ["bPpm", "B (ppm)"],
                  ].map(([key, label]) => {
                    const k = key as keyof WaterInputs;
                    const current = water[k];
                    return (
                      <div key={key}>
                        <Label className="text-xs">{label}</Label>
                        <Input
                          type="number" step="0.01"
                          value={typeof current === "number" ? current : ""}
                          onChange={(e) =>
                            setWater({ ...water, [k]: parseFloat(e.target.value) || 0 } as WaterInputs)
                          }
                          data-testid={`input-water-${key}`}
                        />
                      </div>
                    );
                  })}
                </div>
                {results?.water && (
                  <div className="mt-4 grid gap-2 sm:grid-cols-2 text-sm">
                    <div className="p-3 bg-muted rounded">
                      <strong>SAR:</strong> {fmt(results.water.sar, 2)}
                      <span className="text-xs text-muted-foreground ml-2">
                        ({results.water.sar < 3 ? "OK" : results.water.sar < 9 ? "Riesgo bajo" : "Riesgo alto"})
                      </span>
                    </div>
                    <div className="p-3 bg-muted rounded">
                      <strong>Dureza:</strong> {fmt(results.water.durezaGhf, 1)} °f
                    </div>
                    <div className="p-3 bg-muted rounded">
                      <strong>Σ cationes:</strong> {fmt(results.water.sumCationes, 2)} meq/L
                    </div>
                    <div className="p-3 bg-muted rounded">
                      <strong>Σ aniones:</strong> {fmt(results.water.sumAniones, 2)} meq/L
                    </div>
                    <div className="p-3 bg-muted rounded sm:col-span-2">
                      <strong>Dosis ácido sulfúrico (98%, 1.83 g/cm³):</strong>{" "}
                      {fmt(results.water.acidoSulfuricoMlM3, 2)} ml/m³
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Step 3 - Results */}
        {step === 3 && results && (
          <div data-testid="step-content-results" className="space-y-6">
            {/* Print header (only print) */}
            <div className="hidden print:block mb-4">
              <h2 className="text-xl font-bold">{name}</h2>
              <p className="text-sm">
                {parcelName} • {cropName}
                {variety ? ` (${variety})` : ""} •{" "}
                {productionSystem === "fertirriego" ? "Fertirriego" : "Riego rodado"}
              </p>
              <p className="text-xs">
                Meta: {fmt(rendimientoMeta, 1)} ton/ha • Superficie: {fmt(superficieHas, 2)} ha •{" "}
                Fecha: {new Date().toLocaleDateString("es-MX")}
              </p>
            </div>

            {/* Alerts */}
            {results.alerts.length > 0 && (
              <div className="space-y-2 print:hidden">
                {results.alerts.map((a, i) => (
                  <Alert key={i} variant={a.level === "danger" ? "destructive" : "default"}>
                    <AlertTriangle className="w-4 h-4" />
                    <AlertDescription>{a.message}</AlertDescription>
                  </Alert>
                ))}
              </div>
            )}

            {/* Macros formula */}
            <div>
              <h4 className="font-semibold mb-2 flex items-center gap-2">
                <FileText className="w-4 h-4" /> Fórmula de fertilización (kg/ha)
              </h4>
              <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
                {(Object.keys(results.macros) as MacroKey[]).map((k) => {
                  const m = results.macros[k];
                  const isDeficit = m.factorAjuste < 0;
                  const isN = k === "N";
                  const value = isN ? results.nAjustado : m.dosis;
                  return (
                    <div
                      key={k}
                      className={`border rounded-lg p-3 text-center ${
                        isDeficit ? "border-amber-300 bg-amber-50" : "border-emerald-200 bg-emerald-50"
                      }`}
                      data-testid={`badge-macro-${k}`}
                    >
                      <div className="text-xs text-muted-foreground">{macroLabels[k]}</div>
                      <div className="text-lg font-bold">{fmt(value, 1)}</div>
                      <Badge variant={isDeficit ? "secondary" : "outline"} className="text-[10px] mt-1">
                        {isDeficit ? "Déficit" : "Mantenim."}
                      </Badge>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Nm (N mineralizado por MOS): {fmt(results.nm, 1)} kg/ha • MOO: {fmt(moo, 0)} kg/ha •{" "}
                N bruto: {fmt(results.macros.N.dosis, 1)} kg/ha → <strong>N ajustado: {fmt(results.nAjustado, 1)} kg/ha</strong>
              </p>
            </div>

            {/* Micros */}
            <div>
              <h4 className="font-semibold mb-2">Micronutrimentos (g/ha)</h4>
              <div className="grid gap-2 grid-cols-3 sm:grid-cols-5">
                {(Object.keys(results.micros) as MicroKey[]).map((k) => {
                  const m = results.micros[k];
                  return (
                    <div
                      key={k}
                      className={`border rounded p-2 text-center text-sm ${
                        m.foliarRecomendado ? "border-amber-300 bg-amber-50" : ""
                      }`}
                      data-testid={`badge-micro-${k}`}
                    >
                      <div className="text-xs text-muted-foreground">{microLabels[k]}</div>
                      <div className="font-semibold">{fmt(m.dosis, 2)}</div>
                      {m.foliarRecomendado && <div className="text-[10px] text-amber-700">Foliar</div>}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Phenological distribution */}
            <div>
              <h4 className="font-semibold mb-2">Distribución fenológica (kg/ha por etapa)</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-muted">
                      <th className="text-left p-2 border">Nutrimento</th>
                      {ETAPAS.map((e) => (
                        <th key={e} className="text-right p-2 border text-xs">{e}</th>
                      ))}
                      <th className="text-right p-2 border">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(Object.keys(results.macros) as MacroKey[]).map((k) => {
                      const m = results.macros[k];
                      const total = ETAPAS.reduce((s, e) => s + (m.distribucion[e] || 0), 0);
                      return (
                        <tr key={k} data-testid={`row-distribution-${k}`}>
                          <td className="p-2 border font-medium">{macroLabels[k]}</td>
                          {ETAPAS.map((e) => (
                            <td key={e} className="text-right p-2 border tabular-nums">
                              {fmt(m.distribucion[e] || 0, 1)}
                            </td>
                          ))}
                          <td className="text-right p-2 border font-semibold tabular-nums">{fmt(total, 1)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Products program */}
            <div>
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <h4 className="font-semibold">Programa de productos comerciales</h4>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setProducts([
                      ...products,
                      { productName: "Nuevo producto", unit: "kg", e1Kg: 0, e2Kg: 0, e3Kg: 0, e4Kg: 0, priceUnit: 0 },
                    ])
                  }
                  className="print:hidden"
                  data-testid="button-add-product"
                >
                  <Plus className="w-4 h-4 mr-1" /> Producto
                </Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-muted text-xs">
                      <th className="text-left p-2 border">Producto</th>
                      <th className="p-2 border">Unidad</th>
                      <th className="p-2 border">{ETAPAS[0]}</th>
                      <th className="p-2 border">{ETAPAS[1]}</th>
                      <th className="p-2 border">{ETAPAS[2]}</th>
                      <th className="p-2 border">{ETAPAS[3]}</th>
                      <th className="p-2 border">Total/ha</th>
                      <th className="p-2 border">$ unit.</th>
                      <th className="p-2 border">Costo/ha</th>
                      <th className="p-2 border print:hidden"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {productRows.map((p, idx) => (
                      <tr key={idx} data-testid={`row-product-${idx}`}>
                        <td className="border p-1">
                          <Input
                            value={p.productName}
                            onChange={(e) => {
                              const next = [...products];
                              next[idx] = { ...next[idx], productName: e.target.value };
                              setProducts(next);
                            }}
                            className="h-8 text-xs print:border-none"
                          />
                        </td>
                        <td className="border p-1">
                          <Input
                            value={p.unit}
                            onChange={(e) => {
                              const next = [...products];
                              next[idx] = { ...next[idx], unit: e.target.value };
                              setProducts(next);
                            }}
                            className="h-8 text-xs w-16 print:border-none"
                          />
                        </td>
                        {(["e1Kg", "e2Kg", "e3Kg", "e4Kg"] as const).map((field) => (
                          <td key={field} className="border p-1">
                            <Input
                              type="number" step="0.1" min="0"
                              value={p[field] ?? 0}
                              onChange={(e) => {
                                const next = [...products];
                                next[idx] = { ...next[idx], [field]: parseFloat(e.target.value) || 0 };
                                setProducts(next);
                              }}
                              className="h-8 text-xs w-20 tabular-nums print:border-none"
                            />
                          </td>
                        ))}
                        <td className="border p-1 text-right tabular-nums font-medium">
                          {fmt(p.totalKgLHa, 2)}
                        </td>
                        <td className="border p-1">
                          <Input
                            type="number" step="0.01" min="0"
                            value={p.priceUnit ?? 0}
                            onChange={(e) => {
                              const next = [...products];
                              next[idx] = { ...next[idx], priceUnit: parseFloat(e.target.value) || 0 };
                              setProducts(next);
                            }}
                            className="h-8 text-xs w-20 tabular-nums print:border-none"
                          />
                        </td>
                        <td className="border p-1 text-right tabular-nums font-medium">
                          ${fmt(p.costHa, 2)}
                        </td>
                        <td className="border p-1 print:hidden">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setProducts(products.filter((_, i) => i !== idx))}
                            data-testid={`button-remove-product-${idx}`}
                          >
                            <Trash2 className="w-3 h-3 text-destructive" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-muted font-semibold">
                      <td colSpan={8} className="border p-2 text-right">Total por hectárea</td>
                      <td className="border p-2 text-right tabular-nums">${fmt(totalCostHa, 2)}</td>
                      <td className="border print:hidden"></td>
                    </tr>
                    <tr className="bg-muted/70 font-semibold">
                      <td colSpan={8} className="border p-2 text-right">
                        Total para {fmt(superficieHas, 2)} ha
                      </td>
                      <td className="border p-2 text-right tabular-nums">${fmt(totalCostSup, 2)}</td>
                      <td className="border print:hidden"></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {notes && (
              <div className="border-l-4 border-primary pl-3 py-2 bg-muted/30 text-sm">
                <strong>Notas:</strong> {notes}
              </div>
            )}
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between mt-6 print:hidden">
          <Button
            variant="outline"
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={step === 0}
            data-testid="button-prev-step"
          >
            <ChevronLeft className="w-4 h-4 mr-1" /> Anterior
          </Button>
          <div className="flex gap-2">
            {step === 3 && (
              <>
                <Button
                  variant="outline"
                  onClick={() => window.print()}
                  data-testid="button-print"
                >
                  <Printer className="w-4 h-4 mr-1" /> Imprimir
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (!results) return;
                    downloadProgramPdf({
                      programName: name,
                      parcelName,
                      ownerName,
                      cropName,
                      variety,
                      productionSystem,
                      rendimientoMeta,
                      superficieHas,
                      moo,
                      notes,
                      soil,
                      water: includeWater ? water : undefined,
                      results,
                      products: productRows.map((p) => ({
                        productName: p.productName,
                        unit: p.unit,
                        e1Kg: p.e1Kg,
                        e2Kg: p.e2Kg,
                        e3Kg: p.e3Kg,
                        e4Kg: p.e4Kg,
                        totalKgLHa: p.totalKgLHa,
                        priceUnit: p.priceUnit,
                        costHa: p.costHa,
                      })),
                      totalCostHa,
                      totalCostSup,
                    });
                  }}
                  disabled={!results}
                  data-testid="button-download-pdf"
                >
                  <FileDown className="w-4 h-4 mr-1" /> Descargar PDF
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (!results) return;
                    downloadProductsCsv({
                      programName: name,
                      parcelName,
                      ownerName,
                      cropName,
                      variety,
                      productionSystem,
                      rendimientoMeta,
                      superficieHas,
                      moo,
                      notes,
                      soil,
                      water: includeWater ? water : undefined,
                      results,
                      products: productRows.map((p) => ({
                        productName: p.productName,
                        unit: p.unit,
                        e1Kg: p.e1Kg,
                        e2Kg: p.e2Kg,
                        e3Kg: p.e3Kg,
                        e4Kg: p.e4Kg,
                        totalKgLHa: p.totalKgLHa,
                        priceUnit: p.priceUnit,
                        costHa: p.costHa,
                      })),
                      totalCostHa,
                      totalCostSup,
                    });
                  }}
                  disabled={!results}
                  data-testid="button-download-csv"
                >
                  <FileSpreadsheet className="w-4 h-4 mr-1" /> Descargar CSV
                </Button>
                <Button
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending || !canSave}
                  data-testid="button-save-program"
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4 mr-1" />
                  )}
                  {activeProgramId ? "Actualizar programa" : "Guardar programa"}
                </Button>
              </>
            )}
            {step < 3 && (
              <Button
                onClick={() => setStep(step + 1)}
                disabled={!canAdvance}
                data-testid="button-next-step"
              >
                Siguiente <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}
          </div>
        </div>
        {saveMutation.isSuccess && saveMutation.data && !("queued" in saveMutation.data) && (
          <div className="mt-2 text-sm text-emerald-700 flex items-center gap-2 print:hidden">
            <CheckCircle2 className="w-4 h-4" /> Programa guardado correctamente.
          </div>
        )}
        {saveMutation.isSuccess && saveMutation.data && "queued" in saveMutation.data && (
          <div className="mt-2 text-sm text-amber-700 flex items-center gap-2 print:hidden">
            <CheckCircle2 className="w-4 h-4" /> Guardado localmente — se enviará cuando vuelva la señal.
          </div>
        )}
        {saveMutation.isError && (
          <div className="mt-2 text-sm text-destructive print:hidden">
            Error al guardar: {(saveMutation.error as Error).message}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

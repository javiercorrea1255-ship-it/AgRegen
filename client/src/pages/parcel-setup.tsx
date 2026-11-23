import { useState, useEffect, useRef } from "react";
import { formatMexicoDate, mexicoDateKey } from "@shared/civil-date";
import { getParcelSetupCompletion } from "@shared/parcel-setup-progress";
import { hasSoilBiologyIndicator, sameSoilBiologyInput } from "@shared/soil-biology-input";
import {
  createEmptySoilBiologyForm, hasSoilBiologyPlateInputs, selectSoilBiologyPrefillRecord,
  serializeSoilBiologyForm, soilBiologyRecordToForm, soilBiologySaveTarget,
  type SoilBiologyForm,
} from "@shared/soil-biology-form";
import { useParams, useLocation, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Check, ChevronRight, Sprout, FlaskConical, DollarSign, Leaf,
  Loader2, ArrowLeft, ArrowRight, CheckCircle2, Circle, TrendingUp,
  AlertTriangle, AlertCircle, ChevronDown, ChevronUp, Info,
  Microscope, Droplets, Dna, SkipForward, Plus
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STEPS = [
  { id: "cycle",     label: "Ciclo",          icon: Sprout,      color: "text-green-600",   bg: "bg-green-100",   optional: false },
  { id: "soil",      label: "Suelo",          icon: FlaskConical,color: "text-amber-600",   bg: "bg-amber-100",   optional: false },
  { id: "economy",   label: "Economía",       icon: DollarSign,  color: "text-emerald-600", bg: "bg-emerald-100", optional: false },
  { id: "practices", label: "Prácticas",      icon: Leaf,        color: "text-teal-600",    bg: "bg-teal-100",    optional: false },
  { id: "microbio",  label: "Microbiología",  icon: Microscope,  color: "text-purple-600",  bg: "bg-purple-100",  optional: true  },
  { id: "tejidos",   label: "Tejidos",        icon: Dna,         color: "text-pink-600",    bg: "bg-pink-100",    optional: true  },
  { id: "agua",      label: "Agua",           icon: Droplets,    color: "text-blue-600",    bg: "bg-blue-100",    optional: true  },
];

const MAIN_STEPS = STEPS.filter(s => !s.optional);
const OPTIONAL_STEPS_IDS = new Set(STEPS.filter(s => s.optional).map(s => s.id));

type StepKey = "cycle" | "soil" | "economy" | "practices" | "microbio" | "tejidos" | "agua";

function stepToProgressKey(step: StepKey): string {
  return { cycle: "stepCycle", soil: "stepSoil", economy: "stepEconomy", practices: "stepPractices", microbio: "", tejidos: "", agua: "" }[step];
}

function biologyNumber(value: string) {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
interface ParcelSetupProps {
  params?: { id?: string };
}

export default function ParcelSetup({ params }: ParcelSetupProps) {
  const routeParams = useParams<{ id: string }>();
  const parcelId = params?.id || routeParams.id;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Parse query params for cycleId (edit mode) and step (jump to tab)
  const searchParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const editingCycleId = searchParams.get("cycleId") || null;
  const initialStep = parseInt(searchParams.get("step") || "0", 10) || 0;

  const [currentStep, setCurrentStep] = useState<number>(initialStep);

  // --- Form state ---
  const [cycleYear, setCycleYear] = useState(new Date().getFullYear().toString());
  const [cycleSeason, setCycleSeason] = useState("primavera-verano");
  const [expectedYield, setExpectedYield] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [actualYield, setActualYield] = useState("");
  const [actualPrice, setActualPrice] = useState("");
  const [cycleVariety, setCycleVariety] = useState("");
  const [cycleDensity, setCycleDensity] = useState("");
  const [cycleDuration, setCycleDuration] = useState("");
  const [cycleHarvestDate, setCycleHarvestDate] = useState("");
  const [cycleNotes, setCycleNotes] = useState("");
  // Soil step state (direct capture)
  const [soilPh, setSoilPh] = useState("");
  const [soilMo, setSoilMo] = useState("");
  const [soilTotalCarbon, setSoilTotalCarbon] = useState("");
  const [soilN, setSoilN] = useState("");
  const [soilP, setSoilP] = useState("");
  const [soilK, setSoilK] = useState("");
  const [soilCa, setSoilCa] = useState("");
  const [soilMg, setSoilMg] = useState("");
  const [soilS, setSoilS] = useState("");
  const [soilFe, setSoilFe] = useState("");
  const [soilZn, setSoilZn] = useState("");
  const [soilMn, setSoilMn] = useState("");
  const [soilCu, setSoilCu] = useState("");
  const [soilB, setSoilB] = useState("");
  const [soilEc, setSoilEc] = useState("");
  const [soilCec, setSoilCec] = useState("");
  const [soilSand, setSoilSand] = useState("");
  const [soilSilt, setSoilSilt] = useState("");
  const [soilClay, setSoilClay] = useState("");
  const [soilCompaction, setSoilCompaction] = useState("");
  const [soilCoverage, setSoilCoverage] = useState("");
  const [soilLabName, setSoilLabName] = useState("");
  const [soilDate, setSoilDate] = useState(new Date().toISOString().slice(0, 10));
  const [soilNotes, setSoilNotes] = useState("");
  // Economy step state — direct capture
  const [saleChannel, setSaleChannel] = useState("");
  const [financingType, setFinancingType] = useState("");
  const [economyNotes, setEconomyNotes] = useState("");
  const [costSemillas, setCostSemillas] = useState("");
  const [costFertilizantes, setCostFertilizantes] = useState("");
  const [costAgroquimicos, setCostAgroquimicos] = useState("");
  const [costMaquinaria, setCostMaquinaria] = useState("");
  const [costManoDeObra, setCostManoDeObra] = useState("");
  const [costOtros, setCostOtros] = useState("");
  const [econExpectedYield, setEconExpectedYield] = useState("");
  const [econTargetPrice, setEconTargetPrice] = useState("");
  // Practices step state — structured required fields
  const [labranzaType, setLabranzaType] = useState("");
  const [fertilizerSynthetic, setFertilizerSynthetic] = useState<boolean | null>(null);
  const [fertilizerDose, setFertilizerDose] = useState("");
  const [pestManagement, setPestManagement] = useState("");
  const [irrigationType, setIrrigationType] = useState("");
  const [selectedPractices, setSelectedPractices] = useState<Set<string>>(new Set());
  const [practicesNotes, setPracticesNotes] = useState("");

  // Optional step: keep the loaded record attached to this form until an explicit new analysis.
  const [microForm, setMicroForm] = useState<SoilBiologyForm>(() => createEmptySoilBiologyForm(mexicoDateKey(new Date())));
  const [microRecordId, setMicroRecordId] = useState<string | null>(null);
  const [microError, setMicroError] = useState("");
  const [savingStep, setSavingStep] = useState(false);
  const savingStepRef = useRef(false);
  const microInitialized = useRef(false);
  const microInitializedParcelId = useRef<string | undefined>(undefined);

  // Optional step: Análisis de tejidos vegetales (plantTissueAnalysis)
  const [tejidoDate, setTejidoDate] = useState(new Date().toISOString().slice(0, 10));
  const [tejidoPart, setTejidoPart] = useState("hoja");
  const [tejidoStage, setTejidoStage] = useState("");
  const [tejidoLabName, setTejidoLabName] = useState("");
  const [tejidoN, setTejidoN] = useState("");
  const [tejidoP, setTejidoP] = useState("");
  const [tejidoK, setTejidoK] = useState("");
  const [tejidoCa, setTejidoCa] = useState("");
  const [tejidoMg, setTejidoMg] = useState("");
  const [tejidoS, setTejidoS] = useState("");
  const [tejidoFe, setTejidoFe] = useState("");
  const [tejidoZn, setTejidoZn] = useState("");
  const [tejidoMn, setTejidoMn] = useState("");
  const [tejidoCu, setTejidoCu] = useState("");
  const [tejidoB, setTejidoB] = useState("");
  const [tejidoNotes, setTejidoNotes] = useState("");

  // Optional step: Análisis de agua (waterAnalysis)
  const [aguaDate, setAguaDate] = useState(new Date().toISOString().slice(0, 10));
  const [aguaSource, setAguaSource] = useState("");
  const [aguaLabName, setAguaLabName] = useState("");
  const [aguaPh, setAguaPh] = useState("");
  const [aguaEc, setAguaEc] = useState("");
  const [aguaTds, setAguaTds] = useState("");
  const [aguaSar, setAguaSar] = useState("");
  const [aguaRsc, setAguaRsc] = useState("");
  const [aguaNa, setAguaNa] = useState("");
  const [aguaCa, setAguaCa] = useState("");
  const [aguaMg, setAguaMg] = useState("");
  const [aguaHco3, setAguaHco3] = useState("");
  const [aguaCl, setAguaCl] = useState("");
  const [aguaSo4, setAguaSo4] = useState("");
  const [aguaNo3, setAguaNo3] = useState("");
  const [aguaB, setAguaB] = useState("");
  const [aguaNotes, setAguaNotes] = useState("");

  const { data: parcelData } = useQuery({
    queryKey: ["parcel", parcelId],
    queryFn: async () => {
      const res = await fetch(`/api/parcels/${parcelId}`, { credentials: "include" });
      if (!res.ok) throw new Error("No se pudo cargar la parcela");
      return res.json();
    },
    enabled: !!parcelId,
  });

  const { data: progressData, isLoading: progressLoading } = useQuery({
    queryKey: ["setup-progress", parcelId],
    queryFn: async () => {
      const res = await fetch(`/api/parcels/${parcelId}/setup-progress`, { credentials: "include" });
      if (!res.ok) return { progress: null };
      return res.json();
    },
    enabled: !!parcelId,
  });

  const { data: soilBiologyData, isLoading: biologyLoading, isError: biologyError, refetch: refetchBiology } = useQuery({
    queryKey: ["soil-biology", parcelId],
    queryFn: async () => {
      const res = await fetch(`/api/parcels/${parcelId}/soil-biology`, { credentials: "include" });
      if (!res.ok) throw new Error("No se pudieron cargar los análisis microbiológicos");
      return res.json();
    },
    enabled: !!parcelId,
  });

  const { data: existingCycleData } = useQuery({
    queryKey: ["cycle-detail", parcelId],
    queryFn: async () => {
      const res = await fetch(`/api/parcels/${parcelId}/cycle-detail`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!parcelId,
  });

  const { data: existingSoilData } = useQuery({
    queryKey: ["soil-analysis", parcelId],
    queryFn: async () => {
      const res = await fetch(`/api/parcels/${parcelId}/soil-analysis`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!parcelId,
  });

  const { data: existingCostsData } = useQuery({
    queryKey: ["costs", parcelId],
    queryFn: async () => {
      const res = await fetch(`/api/parcels/${parcelId}/costs`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!parcelId,
  });

  const parcel = parcelData?.parcel;
  const setupCompletion = getParcelSetupCompletion(progressData);
  const completedSteps: Record<StepKey, boolean> = {
    cycle: setupCompletion.flags.stepCycle,
    soil: setupCompletion.flags.stepSoil,
    economy: setupCompletion.flags.stepEconomy,
    practices: setupCompletion.flags.stepPractices,
    microbio: setupCompletion.flags.stepSoilBio,
    tejidos: setupCompletion.flags.stepTissue,
    agua: setupCompletion.flags.stepWater,
  };
  const completionCount = setupCompletion.completedCount;
  const completionPct = setupCompletion.percentage;

  useEffect(() => {
    if (microInitializedParcelId.current === parcelId) return;
    microInitializedParcelId.current = parcelId;
    microInitialized.current = false;
    setMicroRecordId(null);
    setMicroForm(createEmptySoilBiologyForm(mexicoDateKey(new Date())));
    setMicroError("");
  }, [parcelId]);

  useEffect(() => {
    if (biologyLoading || biologyError || microInitialized.current) return;
    microInitialized.current = true;
    const records = Array.isArray(soilBiologyData?.records) ? soilBiologyData.records : [];
    const latest = selectSoilBiologyPrefillRecord(records);
    if (!latest) return;
    setMicroRecordId(String(latest.id));
    setMicroForm(soilBiologyRecordToForm(latest));
  }, [biologyLoading, biologyError, soilBiologyData, parcelId]);

  // extraFields can override any cycle detail field when called from later wizard steps
  type CycleExtraFields = {
    saleChannel?: string;
    financingType?: string;
    practicesJson?: string;
    expectedYieldTon?: number | null;
    targetPricePerTon?: number | null;
    totalPlannedCost?: number | null;
  };

  // Tracks the ID of a newly-created cycle within this wizard session so that
  // steps economy/practices update that same record (PATCH) instead of inserting more rows.
  const newCycleIdRef = useRef<string | null>(null);

  const saveCycleDetailMutation = useMutation({
    mutationFn: async (extraFields: CycleExtraFields = {}) => {
      // Priority: explicit edit URL param > session-created cycle > new POST
      const targetId = editingCycleId ?? newCycleIdRef.current;
      const isEditMode = !!targetId;

      // Core cycle fields always included
      const bodyObj: Record<string, unknown> = {
        cycleYear: parseInt(cycleYear),
        cycleSeason,
        variety: cycleVariety || null,
        density: cycleDensity ? parseFloat(cycleDensity) : null,
        cycleDurationDays: cycleDuration ? parseInt(cycleDuration) : null,
        estimatedHarvestDate: cycleHarvestDate || null,
        // Use extraFields value if explicitly provided; otherwise fall back to cycle-step state
        expectedYieldTon: "expectedYieldTon" in extraFields
          ? extraFields.expectedYieldTon
          : (expectedYield ? parseFloat(expectedYield) : null),
        targetPricePerTon: "targetPricePerTon" in extraFields
          ? extraFields.targetPricePerTon
          : (targetPrice ? parseFloat(targetPrice) : null),
        actualYieldTon: actualYield ? parseFloat(actualYield) : null,
        actualPricePerTon: actualPrice ? parseFloat(actualPrice) : null,
        notes: cycleNotes || null,
      };

      // Economy/practices fields: always include on POST (new cycle) to persist all steps;
      // on PATCH (edit), only include when explicitly provided to avoid wiping existing data.
      if (!isEditMode || "totalPlannedCost" in extraFields) {
        bodyObj.totalPlannedCost = extraFields.totalPlannedCost ?? null;
      }
      if (!isEditMode || "saleChannel" in extraFields) {
        bodyObj.saleChannel = extraFields.saleChannel || null;
      }
      if (!isEditMode || "financingType" in extraFields) {
        bodyObj.financingType = extraFields.financingType || null;
      }
      if (!isEditMode || "practicesJson" in extraFields) {
        bodyObj.practicesJson = extraFields.practicesJson || null;
      }

      const url = targetId
        ? `/api/parcels/${parcelId}/cycle-detail/${targetId}`
        : `/api/parcels/${parcelId}/cycle-detail`;
      const method = targetId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(bodyObj),
      });
      if (!res.ok) throw new Error("Error al guardar ciclo");
      const data = await res.json();
      // After first POST, capture the returned ID so subsequent steps use PATCH
      if (method === "POST" && data?.record?.id) {
        newCycleIdRef.current = String(data.record.id);
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cycle-detail", parcelId] });
    },
  });

  const updateProgressMutation = useMutation({
    mutationFn: async (stepData: Record<string, boolean>) => {
      const res = await fetch(`/api/parcels/${parcelId}/setup-progress`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(stepData),
      });
      if (!res.ok) throw new Error("Error al guardar progreso");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setup-progress", parcelId] });
      queryClient.invalidateQueries({ queryKey: ["parcels"] });
    },
  });

  // Pre-populate cycle, economy and practices fields — only when EDITING a specific cycle
  const cycleInitialized = useRef(false);
  useEffect(() => {
    // New cycle → leave form blank (show only year/season defaults). Do not preload latest.
    if (!editingCycleId || !existingCycleData || cycleInitialized.current) return;
    const cd = existingCycleData?.details?.find((d: any) => d.id === editingCycleId);
    if (!cd) return;
    cycleInitialized.current = true;
    if (cd.cycleYear) setCycleYear(String(cd.cycleYear));
    if (cd.cycleSeason) setCycleSeason(cd.cycleSeason);
    if (cd.variety) setCycleVariety(cd.variety);
    if (cd.density != null) setCycleDensity(String(cd.density));
    if (cd.cycleDurationDays != null) setCycleDuration(String(cd.cycleDurationDays));
    if (cd.estimatedHarvestDate) setCycleHarvestDate(cd.estimatedHarvestDate);
    if (cd.notes) setCycleNotes(cd.notes);
    if (cd.expectedYieldTon != null) {
      setExpectedYield(String(cd.expectedYieldTon));
      setEconExpectedYield(String(cd.expectedYieldTon));
    }
    if (cd.targetPricePerTon != null) {
      setTargetPrice(String(cd.targetPricePerTon));
      setEconTargetPrice(String(cd.targetPricePerTon));
    }
    if (cd.actualYieldTon != null) setActualYield(String(cd.actualYieldTon));
    if (cd.actualPricePerTon != null) setActualPrice(String(cd.actualPricePerTon));
    if (cd.saleChannel) setSaleChannel(cd.saleChannel);
    if (cd.financingType) setFinancingType(cd.financingType);
    if (cd.practicesJson) {
      try {
        const pr = JSON.parse(cd.practicesJson);
        if (pr.labranzaType) setLabranzaType(pr.labranzaType);
        if (pr.fertilizerSynthetic != null) setFertilizerSynthetic(pr.fertilizerSynthetic);
        if (pr.fertilizerDose != null) setFertilizerDose(String(pr.fertilizerDose));
        if (pr.pestManagement) setPestManagement(pr.pestManagement);
        if (pr.irrigationType) setIrrigationType(pr.irrigationType);
        if (Array.isArray(pr.regenerativePractices)) setSelectedPractices(new Set(pr.regenerativePractices));
      } catch { /* practicesJson malformed */ }
    }
  }, [existingCycleData]);

  // Pre-populate soil fields from latest soil analysis (fires once)
  const soilInitialized = useRef(false);
  useEffect(() => {
    const analyses = existingSoilData?.analyses;
    if (!analyses?.length || soilInitialized.current) return;
    soilInitialized.current = true;
    const sa = analyses[0];
    if (sa.ph != null) setSoilPh(String(sa.ph));
    if (sa.organicMatter != null) setSoilMo(String(sa.organicMatter));
    if (sa.totalCarbon != null) setSoilTotalCarbon(String(sa.totalCarbon));
    if (sa.nitrogenTotal != null) setSoilN(String(sa.nitrogenTotal));
    if (sa.phosphorus != null) setSoilP(String(sa.phosphorus));
    if (sa.potassium != null) setSoilK(String(sa.potassium));
    if (sa.calcium != null) setSoilCa(String(sa.calcium));
    if (sa.magnesium != null) setSoilMg(String(sa.magnesium));
    if (sa.sulfur != null) setSoilS(String(sa.sulfur));
    if (sa.iron != null) setSoilFe(String(sa.iron));
    if (sa.zinc != null) setSoilZn(String(sa.zinc));
    if (sa.manganese != null) setSoilMn(String(sa.manganese));
    if (sa.copper != null) setSoilCu(String(sa.copper));
    if (sa.boron != null) setSoilB(String(sa.boron));
    if (sa.electricConductivity != null) setSoilEc(String(sa.electricConductivity));
    if (sa.cec != null) setSoilCec(String(sa.cec));
    if (sa.sand != null) setSoilSand(String(sa.sand));
    if (sa.silt != null) setSoilSilt(String(sa.silt));
    if (sa.clay != null) setSoilClay(String(sa.clay));
    if (sa.analysisDate) setSoilDate(sa.analysisDate.slice(0, 10));
    if (sa.labName) setSoilLabName(sa.labName);
    if (sa.notes) setSoilNotes(sa.notes);
  }, [existingSoilData]);

  // Pre-populate cost fields from existing costs (fires once, edit mode only)
  const costsInitialized = useRef(false);
  useEffect(() => {
    const costs = existingCostsData?.costs;
    // In new-cycle mode don't preload any costs (leave blank for the new campaign).
    // In edit mode, filter costs that match the specific cycle being edited.
    if (!editingCycleId || !costs?.length || costsInitialized.current) return;
    const cd = existingCycleData?.details?.find((d: any) => d.id === editingCycleId) ?? existingCycleData?.latest;
    costsInitialized.current = true;
    const targetYear = cd?.cycleYear ?? new Date().getFullYear();
    const targetSeason = cd?.cycleSeason ?? null;
    const filtered = costs.filter((c: any) =>
      c.cycleYear === targetYear && (!targetSeason || c.cycleSeason === targetSeason)
    );
    for (const c of filtered) {
      const v = String(c.totalCost ?? "");
      if (c.category === "semillas") setCostSemillas(v);
      else if (c.category === "fertilizantes") setCostFertilizantes(v);
      else if (c.category === "otros_insumos") setCostAgroquimicos(v);
      else if (c.category === "maquinaria_renta") setCostMaquinaria(v);
      else if (c.category === "mano_obra_otros") setCostManoDeObra(v);
      else if (c.category === "otros_gastos") setCostOtros(v);
    }
  }, [existingCostsData, existingCycleData]);

  const handleStepComplete = async (step: StepKey) => {
    if (savingStepRef.current) return;
    savingStepRef.current = true;
    setSavingStep(true);
    setMicroError("");
    try {
      if (step === "cycle") {
        await saveCycleDetailMutation.mutateAsync({});
      } else if (step === "soil") {
        const hasSoilData = soilPh || soilMo || soilN || soilP || soilK ||
          soilCa || soilMg || soilS || soilFe || soilZn || soilMn || soilCu || soilB ||
          soilEc || soilCec || soilSand || soilSilt || soilClay || soilTotalCarbon ||
          soilCompaction || soilCoverage;
        if (hasSoilData) {
          const soilRes = await fetch(`/api/parcels/${parcelId}/soil-analysis`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              analysisDate: soilDate,
              labName: soilLabName || null,
              ph: soilPh ? parseFloat(soilPh) : null,
              organicMatter: soilMo ? parseFloat(soilMo) : null,
              totalCarbon: soilTotalCarbon ? parseFloat(soilTotalCarbon) : null,
              nitrogenTotal: soilN ? parseFloat(soilN) : null,
              phosphorus: soilP ? parseFloat(soilP) : null,
              potassium: soilK ? parseFloat(soilK) : null,
              calcium: soilCa ? parseFloat(soilCa) : null,
              magnesium: soilMg ? parseFloat(soilMg) : null,
              sulfur: soilS ? parseFloat(soilS) : null,
              iron: soilFe ? parseFloat(soilFe) : null,
              zinc: soilZn ? parseFloat(soilZn) : null,
              manganese: soilMn ? parseFloat(soilMn) : null,
              copper: soilCu ? parseFloat(soilCu) : null,
              boron: soilB ? parseFloat(soilB) : null,
              electricConductivity: soilEc ? parseFloat(soilEc) : null,
              cec: soilCec ? parseFloat(soilCec) : null,
              sand: soilSand ? parseFloat(soilSand) : null,
              silt: soilSilt ? parseFloat(soilSilt) : null,
              clay: soilClay ? parseFloat(soilClay) : null,
              notes: soilNotes
                ? soilNotes + (soilCompaction ? `\nCompactación: ${soilCompaction} MPa` : "") + (soilCoverage ? ` | Cobertura: ${soilCoverage}%` : "")
                : (soilCompaction || soilCoverage)
                  ? `${soilCompaction ? `Compactación: ${soilCompaction} MPa` : ""}${soilCoverage ? ` Cobertura: ${soilCoverage}%` : ""}`.trim()
                  : null,
            }),
          });
          if (!soilRes.ok) throw new Error("Error al guardar análisis de suelo");
          queryClient.invalidateQueries({ queryKey: ["soil-analysis", parcelId] });
        }
      } else if (step === "economy") {
        // Save cycle detail with expected yield + target price + sale channel + financing
        await saveCycleDetailMutation.mutateAsync({
          expectedYieldTon: econExpectedYield ? parseFloat(econExpectedYield) : undefined,
          targetPricePerTon: econTargetPrice ? parseFloat(econTargetPrice) : undefined,
          saleChannel: saleChannel || undefined,
          financingType: financingType || undefined,
        });
        // Idempotent cost save: delete existing wizard-category costs for this cycle,
        // then insert fresh rows. This prevents duplication on repeated wizard visits.
        // Categories use exact enum values from shared/schema.ts costCategories.
        const wizardCategories = [
          "semillas", "fertilizantes", "otros_insumos",
          "maquinaria_renta", "mano_obra_otros", "otros_gastos",
        ];
        const existingCostsRes = await fetch(`/api/parcels/${parcelId}/costs`, { credentials: "include" });
        if (existingCostsRes.ok) {
          const { costs: existingCosts }: { costs: Array<{ id: string; category: string; cycleYear: number; cycleSeason: string }> } = await existingCostsRes.json();
          const toDelete = existingCosts.filter(
            c => wizardCategories.includes(c.category) &&
                 c.cycleYear === parseInt(cycleYear) &&
                 c.cycleSeason === cycleSeason
          );
          await Promise.all(
            toDelete.map(c =>
              fetch(`/api/parcels/${parcelId}/costs/${c.id}`, { method: "DELETE", credentials: "include" })
            )
          );
        }
        // Insert fresh cost rows with required schema fields (cycleYear, cycleSeason, concept).
        // category keys must be valid costCategories enum values (shared/schema.ts).
        const costCategories = [
          { key: "semillas",         label: "Semillas",       value: costSemillas },
          { key: "fertilizantes",    label: "Fertilizantes",  value: costFertilizantes },
          { key: "otros_insumos",    label: "Agroquímicos",   value: costAgroquimicos },
          { key: "maquinaria_renta", label: "Maquinaria",     value: costMaquinaria },
          { key: "mano_obra_otros",  label: "Mano de Obra",   value: costManoDeObra },
          { key: "otros_gastos",     label: "Otros",          value: costOtros },
        ] as const;
        for (const cat of costCategories) {
          if (cat.value && parseFloat(cat.value) > 0) {
            const catRes = await fetch(`/api/parcels/${parcelId}/costs`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                category: cat.key,
                concept: cat.label,
                cycleYear: parseInt(cycleYear),
                cycleSeason,
                totalCost: parseFloat(cat.value),
                unit: "ha",
                notes: economyNotes || null,
              }),
            });
            if (!catRes.ok) throw new Error(`Error al guardar costo ${cat.label}`);
          }
        }
        queryClient.invalidateQueries({ queryKey: ["costs", parcelId] });
      } else if (step === "practices") {
        // Build structured practices JSON including all required fields
        const practiceKeys = Array.from(selectedPractices);
        const structuredPractices = {
          labranzaType: labranzaType || null,
          fertilizerSynthetic,
          fertilizerDose: fertilizerDose ? parseFloat(fertilizerDose) : null,
          pestManagement: pestManagement || null,
          irrigationType: irrigationType || null,
          regenerativePractices: practiceKeys,
        };
        await saveCycleDetailMutation.mutateAsync({
          practicesJson: JSON.stringify(structuredPractices),
        });
        // practicesJson already stores all practice info; no separate tillage POST needed
      } else if (step === "microbio") {
        if (biologyLoading || biologyError) {
          setMicroError("Espera a que los análisis existentes carguen correctamente para evitar duplicados.");
          return;
        }
        const payload = serializeSoilBiologyForm(microForm);
        if (!hasSoilBiologyIndicator(payload)) {
          setMicroError("Agrega al menos un indicador reportado por el laboratorio antes de guardar.");
          return;
        }
        if (microForm.dataSource !== "lab" && hasSoilBiologyPlateInputs(microForm)) {
          setMicroError("Este registro proviene de una estimación. Para agregar conteos de placas, inicia un nuevo análisis de laboratorio.");
          return;
        }
        if ((microForm.metarhiziumStatus === "counted" && biologyNumber(microForm.metarhiziumCfu) === null) ||
            (microForm.beauveriaStatus === "counted" && biologyNumber(microForm.beauveriaCfu) === null)) {
          setMicroError("Para un organismo con conteo, captura su valor en UFC/g.");
          return;
        }
        if (!microRecordId) {
          const records = Array.isArray(soilBiologyData?.records) ? soilBiologyData.records : [];
          const duplicate = records.some((record: any) => sameSoilBiologyInput(payload, record));
          if (duplicate) {
            setMicroError("Este análisis ya está registrado. Abre el registro existente para editarlo o inicia un análisis nuevo con datos distintos.");
            return;
          }
        }
        const saveTarget = soilBiologySaveTarget(parcelId!, microRecordId);
        const res = await fetch(saveTarget.url, {
            method: saveTarget.method,
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(payload),
          });
        if (!res.ok) {
          const error = await res.json().catch(() => ({}));
          throw new Error(error.message || error.error || "Error al guardar análisis microbiológico");
        }
        const saved = await res.json().catch(() => null);
        if (!microRecordId && (saved?.record?.id ?? saved?.id)) setMicroRecordId(String(saved.record?.id ?? saved.id));
        await queryClient.invalidateQueries({ queryKey: ["soil-biology", parcelId] });
        await queryClient.invalidateQueries({ queryKey: ["setup-progress", parcelId] });
      } else if (step === "tejidos") {
        const hasTejidoData = tejidoN || tejidoP || tejidoK || tejidoCa || tejidoMg || tejidoS ||
          tejidoFe || tejidoZn || tejidoMn || tejidoCu || tejidoB;
        if (hasTejidoData) {
          const res = await fetch(`/api/parcels/${parcelId}/tissue-analysis`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              analysisDate: tejidoDate,
              labName: tejidoLabName || null,
              samplePart: tejidoPart || null,
              phenologicalStage: tejidoStage || null,
              nitrogen:   tejidoN  ? parseFloat(tejidoN)  : null,
              phosphorus: tejidoP  ? parseFloat(tejidoP)  : null,
              potassium:  tejidoK  ? parseFloat(tejidoK)  : null,
              calcium:    tejidoCa ? parseFloat(tejidoCa) : null,
              magnesium:  tejidoMg ? parseFloat(tejidoMg) : null,
              sulfur:     tejidoS  ? parseFloat(tejidoS)  : null,
              iron:   tejidoFe ? parseFloat(tejidoFe) : null,
              zinc:   tejidoZn ? parseFloat(tejidoZn) : null,
              manganese: tejidoMn ? parseFloat(tejidoMn) : null,
              copper: tejidoCu ? parseFloat(tejidoCu) : null,
              boron:  tejidoB  ? parseFloat(tejidoB)  : null,
              notes: tejidoNotes || null,
            }),
          });
          if (!res.ok) throw new Error("Error al guardar análisis de tejidos vegetales");
        }
      } else if (step === "agua") {
        const hasAguaData = aguaPh || aguaEc || aguaTds || aguaSar || aguaNa || aguaCa || aguaMg ||
          aguaHco3 || aguaCl || aguaSo4 || aguaNo3 || aguaB;
        if (hasAguaData) {
          const res = await fetch(`/api/parcels/${parcelId}/water-analysis`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              analysisDate: aguaDate,
              source: aguaSource || null,
              labName: aguaLabName || null,
              ph: aguaPh ? parseFloat(aguaPh) : null,
              electricConductivity: aguaEc ? parseFloat(aguaEc) : null,
              tds: aguaTds ? parseFloat(aguaTds) : null,
              sar: aguaSar ? parseFloat(aguaSar) : null,
              rsc: aguaRsc ? parseFloat(aguaRsc) : null,
              sodium: aguaNa ? parseFloat(aguaNa) : null,
              calcium: aguaCa ? parseFloat(aguaCa) : null,
              magnesium: aguaMg ? parseFloat(aguaMg) : null,
              bicarbonates: aguaHco3 ? parseFloat(aguaHco3) : null,
              chlorides: aguaCl ? parseFloat(aguaCl) : null,
              sulfates: aguaSo4 ? parseFloat(aguaSo4) : null,
              nitrates: aguaNo3 ? parseFloat(aguaNo3) : null,
              boron: aguaB ? parseFloat(aguaB) : null,
              notes: aguaNotes || null,
            }),
          });
          if (!res.ok) throw new Error("Error al guardar análisis de agua");
          queryClient.invalidateQueries({ queryKey: ["water-analysis", parcelId] });
        }
      }

      // Only update parcel_setup_progress for the 4 main mandatory steps
      if (!OPTIONAL_STEPS_IDS.has(step)) {
        const progressKey = stepToProgressKey(step);
        await updateProgressMutation.mutateAsync({ [progressKey]: true });
        toast({ title: "Paso completado", description: `"${STEPS[currentStep].label}" guardado correctamente.` });
      } else {
        toast({ title: "Análisis guardado", description: `El análisis de ${STEPS[currentStep].label} fue registrado.` });
      }

      if (currentStep < STEPS.length - 1) {
        setCurrentStep(currentStep + 1);
      } else {
        toast({ title: "¡Configuración completa!", description: "Tu parcela está lista para el monitoreo integrado." });
        navigate(`/parcel/${parcelId}`);
      }
    } catch (e: any) {
      if (step === "microbio") setMicroError(e.message || "Error al guardar análisis microbiológico");
      toast({ title: "Error al guardar", description: e.message, variant: "destructive" });
    } finally {
      savingStepRef.current = false;
      setSavingStep(false);
    }
  };

  const handleSkipAndFinish = () => {
    navigate(`/parcel/${parcelId}`);
  };

  if (progressLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const stepDef = STEPS[currentStep];
  const StepIcon = stepDef.icon;

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href={`/parcel/${parcelId}`}>
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="w-4 h-4" /> Ir a la parcela
          </Button>
        </Link>
      </div>

      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-lg bg-primary/10">
            <Sprout className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold font-heading">Configuración Inicial</h1>
            <p className="text-sm text-muted-foreground">
              {parcel?.name || "Cargando..."} · {completionPct}% completado
            </p>
          </div>
        </div>
        {/* Progress bar */}
        <div className="w-full h-2 bg-muted rounded-full overflow-hidden mt-4">
          <div
            className="h-full bg-primary transition-all duration-500"
            style={{ width: `${completionPct}%` }}
          />
        </div>
      </div>

      {/* Single unified step indicator — 7 pasos en un solo flujo */}
      <div className="flex items-start justify-between mb-6">
        {STEPS.map((step, idx) => {
          const isCompleted = completedSteps[step.id as StepKey];
          const isCurrent = idx === currentStep;
          const Icon = step.icon;
          return (
            <button
              key={step.id}
              className="flex flex-col items-center gap-1 cursor-pointer"
              onClick={() => setCurrentStep(idx)}
              data-testid={`step-btn-${step.id}`}
            >
              <div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all
                ${isCompleted
                  ? "bg-primary border-primary text-primary-foreground"
                  : isCurrent
                  ? `${step.bg} border-current ${step.color}`
                  : "bg-muted border-muted-foreground/30 text-muted-foreground"}`}>
                {isCompleted ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
              </div>
              <span className={`text-[10px] font-medium text-center leading-tight
                ${isCurrent ? step.color : isCompleted ? "text-primary" : "text-muted-foreground"}`}>
                {step.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Step content */}
      <Card data-testid={`card-step-${stepDef.id}`}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className={`p-1.5 rounded-md ${stepDef.bg}`}>
              <StepIcon className={`w-5 h-5 ${stepDef.color}`} />
            </div>
            {stepDef.label}
            {completedSteps[stepDef.id as StepKey] && (
              <Badge variant="secondary" className="ml-2 text-xs">
                <CheckCircle2 className="w-3 h-3 mr-1 text-primary" /> Completado
              </Badge>
            )}
          </CardTitle>
          <CardDescription>{getStepDescription(stepDef.id as StepKey)}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {stepDef.id === "cycle" && (
            <CycleStepContent
              cycleYear={cycleYear} setCycleYear={setCycleYear}
              cycleSeason={cycleSeason} setCycleSeason={setCycleSeason}
              expectedYield={expectedYield} setExpectedYield={setExpectedYield}
              targetPrice={targetPrice} setTargetPrice={setTargetPrice}
              actualYield={actualYield} setActualYield={setActualYield}
              actualPrice={actualPrice} setActualPrice={setActualPrice}
              isEditing={!!editingCycleId}
              variety={cycleVariety} setVariety={setCycleVariety}
              density={cycleDensity} setDensity={setCycleDensity}
              duration={cycleDuration} setDuration={setCycleDuration}
              harvestDate={cycleHarvestDate} setHarvestDate={setCycleHarvestDate}
              notes={cycleNotes} setNotes={setCycleNotes}
              parcelCrop={parcel?.crop}
              parcelId={parcelId}
            />
          )}
          {stepDef.id === "soil" && (
            <SoilStepContent
              parcelId={parcelId!}
              ph={soilPh} setPh={setSoilPh}
              mo={soilMo} setMo={setSoilMo}
              totalCarbon={soilTotalCarbon} setTotalCarbon={setSoilTotalCarbon}
              nitrogenTotal={soilN} setNitrogenTotal={setSoilN}
              phosphorus={soilP} setPhosphorus={setSoilP}
              potassium={soilK} setPotassium={setSoilK}
              calcium={soilCa} setCalcium={setSoilCa}
              magnesium={soilMg} setMagnesium={setSoilMg}
              sulfur={soilS} setSulfur={setSoilS}
              iron={soilFe} setIron={setSoilFe}
              zinc={soilZn} setZinc={setSoilZn}
              manganese={soilMn} setManganese={setSoilMn}
              copper={soilCu} setCopper={setSoilCu}
              boron={soilB} setBoron={setSoilB}
              electricConductivity={soilEc} setElectricConductivity={setSoilEc}
              cec={soilCec} setCec={setSoilCec}
              sand={soilSand} setSand={setSoilSand}
              silt={soilSilt} setSilt={setSoilSilt}
              clay={soilClay} setClay={setSoilClay}
              compaction={soilCompaction} setCompaction={setSoilCompaction}
              coverage={soilCoverage} setCoverage={setSoilCoverage}
              labName={soilLabName} setLabName={setSoilLabName}
              analysisDate={soilDate} setAnalysisDate={setSoilDate}
              notes={soilNotes} setNotes={setSoilNotes}
            />
          )}
          {stepDef.id === "economy" && (
            <EconomyStepContent
              parcelId={parcelId!}
              saleChannel={saleChannel} setSaleChannel={setSaleChannel}
              financingType={financingType} setFinancingType={setFinancingType}
              notes={economyNotes} setNotes={setEconomyNotes}
              costSemillas={costSemillas} setCostSemillas={setCostSemillas}
              costFertilizantes={costFertilizantes} setCostFertilizantes={setCostFertilizantes}
              costAgroquimicos={costAgroquimicos} setCostAgroquimicos={setCostAgroquimicos}
              costMaquinaria={costMaquinaria} setCostMaquinaria={setCostMaquinaria}
              costManoDeObra={costManoDeObra} setCostManoDeObra={setCostManoDeObra}
              costOtros={costOtros} setCostOtros={setCostOtros}
              expectedYield={econExpectedYield} setExpectedYield={setEconExpectedYield}
              targetPrice={econTargetPrice} setTargetPrice={setEconTargetPrice}
            />
          )}
          {stepDef.id === "practices" && (
            <PracticesStepContent
              parcelId={parcelId!}
              labranzaType={labranzaType} setLabranzaType={setLabranzaType}
              fertilizerSynthetic={fertilizerSynthetic} setFertilizerSynthetic={setFertilizerSynthetic}
              fertilizerDose={fertilizerDose} setFertilizerDose={setFertilizerDose}
              pestManagement={pestManagement} setPestManagement={setPestManagement}
              irrigationType={irrigationType} setIrrigationType={setIrrigationType}
              selected={selectedPractices} setSelected={setSelectedPractices}
              notes={practicesNotes} setNotes={setPracticesNotes}
            />
          )}
          {stepDef.id === "microbio" && (
            <MicrobioStepContent
              form={microForm}
              setField={(field, value) => setMicroForm(current => ({ ...current, [field]: value }))}
              activeRecordId={microRecordId}
              error={microError}
              loading={biologyLoading}
              loadError={biologyError}
              records={soilBiologyData?.records || []}
              onRetry={() => { void refetchBiology(); }}
              onNewAnalysis={() => {
                setMicroRecordId(null);
                setMicroForm(createEmptySoilBiologyForm(mexicoDateKey(new Date())));
                setMicroError("");
              }}
            />
          )}
          {stepDef.id === "tejidos" && (
            <TejidosStepContent
              analysisDate={tejidoDate} setAnalysisDate={setTejidoDate}
              samplePart={tejidoPart} setSamplePart={setTejidoPart}
              phenologicalStage={tejidoStage} setPhenologicalStage={setTejidoStage}
              labName={tejidoLabName} setLabName={setTejidoLabName}
              n={tejidoN} setN={setTejidoN}
              p={tejidoP} setP={setTejidoP}
              k={tejidoK} setK={setTejidoK}
              ca={tejidoCa} setCa={setTejidoCa}
              mg={tejidoMg} setMg={setTejidoMg}
              s={tejidoS} setS={setTejidoS}
              fe={tejidoFe} setFe={setTejidoFe}
              zn={tejidoZn} setZn={setTejidoZn}
              mn={tejidoMn} setMn={setTejidoMn}
              cu={tejidoCu} setCu={setTejidoCu}
              b={tejidoB} setB={setTejidoB}
              notes={tejidoNotes} setNotes={setTejidoNotes}
            />
          )}
          {stepDef.id === "agua" && (
            <AguaStepContent
              analysisDate={aguaDate} setAnalysisDate={setAguaDate}
              source={aguaSource} setSource={setAguaSource}
              labName={aguaLabName} setLabName={setAguaLabName}
              ph={aguaPh} setPh={setAguaPh}
              ec={aguaEc} setEc={setAguaEc}
              tds={aguaTds} setTds={setAguaTds}
              sar={aguaSar} setSar={setAguaSar}
              rsc={aguaRsc} setRsc={setAguaRsc}
              na={aguaNa} setNa={setAguaNa}
              ca={aguaCa} setCa={setAguaCa}
              mg={aguaMg} setMg={setAguaMg}
              hco3={aguaHco3} setHco3={setAguaHco3}
              cl={aguaCl} setCl={setAguaCl}
              so4={aguaSo4} setSo4={setAguaSo4}
              no3={aguaNo3} setNo3={setAguaNo3}
              b={aguaB} setB={setAguaB}
              notes={aguaNotes} setNotes={setAguaNotes}
            />
          )}

          <div className="flex gap-3 pt-2">
            {currentStep > 0 && (
              <Button
                variant="outline"
                onClick={() => setCurrentStep(currentStep - 1)}
                data-testid="btn-prev-step"
              >
                <ArrowLeft className="w-4 h-4 mr-2" /> Anterior
              </Button>
            )}
            <Button
              className="flex-1"
              onClick={() => handleStepComplete(stepDef.id as StepKey)}
                disabled={savingStep || updateProgressMutation.isPending || saveCycleDetailMutation.isPending}
              data-testid="btn-complete-step"
            >
              {(savingStep || updateProgressMutation.isPending || saveCycleDetailMutation.isPending) ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : OPTIONAL_STEPS_IDS.has(stepDef.id) ? (
                currentStep < STEPS.length - 1 ? (
                  <><Check className="w-4 h-4 mr-2" /> Guardar análisis <ChevronRight className="w-4 h-4 ml-1" /></>
                ) : (
                  <><CheckCircle2 className="w-4 h-4 mr-2" /> Guardar y finalizar</>
                )
              ) : (
                currentStep < STEPS.length - 1 ? (
                  <><Check className="w-4 h-4 mr-2" /> Guardar y Continuar <ChevronRight className="w-4 h-4 ml-1" /></>
                ) : (
                  <><CheckCircle2 className="w-4 h-4 mr-2" /> Finalizar Configuración</>
                )
              )}
            </Button>
            {OPTIONAL_STEPS_IDS.has(stepDef.id) ? (
              <Button
                variant="outline"
                onClick={() => {
                  if (currentStep < STEPS.length - 1) setCurrentStep(currentStep + 1);
                  else navigate(`/parcel/${parcelId}`);
                }}
                data-testid="btn-skip-optional"
              >
                <SkipForward className="w-4 h-4 mr-1" /> Omitir
              </Button>
            ) : (
              <Button variant="ghost" onClick={handleSkipAndFinish} data-testid="btn-skip-setup">
                Omitir todo
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Tips / finish shortcut for optional steps */}
      {OPTIONAL_STEPS_IDS.has(stepDef.id) ? (
        <div className="mt-4 p-4 rounded-lg bg-purple-50 dark:bg-purple-950/20 border border-dashed border-purple-200 dark:border-purple-800 text-sm">
          <p className="font-medium text-purple-700 dark:text-purple-300 mb-1">Análisis opcional</p>
          <p className="text-purple-600 dark:text-purple-400 text-xs mb-3">
            Estos análisis enriquecen el diagnóstico pero no son obligatorios. Puedes guardar los datos si los tienes, u omitir el paso.
          </p>
          <Button variant="outline" size="sm" onClick={() => navigate(`/parcel/${parcelId}`)} data-testid="btn-finish-early">
            Ver mi parcela →
          </Button>
        </div>
      ) : (
        <div className="mt-6 p-4 rounded-lg bg-muted/50 text-sm text-muted-foreground">
          <p className="font-medium text-foreground mb-1">¿Por qué configurar la parcela?</p>
          <ul className="space-y-1 list-disc list-inside">
            <li>El ciclo económico permite calcular el margen bruto y ROI en tiempo real.</li>
            <li>El perfil de suelo activa alertas de nutrientes personalizadas.</li>
            <li>Las prácticas regenerativas contribuyen al puntaje de regeneración.</li>
          </ul>
        </div>
      )}
    </div>
  );
}

function getStepDescription(step: StepKey): string {
  return ({
    cycle:    "Define el ciclo agrícola actual, el cultivo esperado y los datos económicos de referencia.",
    soil:     "Vincula o confirma el análisis de suelo más reciente para activar alertas de nutrientes.",
    economy:  "Registra los costos de producción planificados para este ciclo.",
    practices:"Confirma las prácticas regenerativas que aplicarás en esta campaña.",
    microbio: "Registra indicadores de vida microbiana: biomasa, respiración y actividad enzimática del suelo.",
    tejidos:  "Analiza la concentración de nutrientes en hojas o tallos para detectar deficiencias en planta.",
    agua:     "Evalúa la calidad del agua de riego: pH, conductividad, sodio, cloruros y más.",
  } as Record<string, string>)[step] ?? "";
}

function CycleStepContent({
  cycleYear, setCycleYear, cycleSeason, setCycleSeason,
  expectedYield, setExpectedYield, targetPrice, setTargetPrice,
  actualYield, setActualYield, actualPrice, setActualPrice, isEditing,
  variety, setVariety, density, setDensity, duration, setDuration,
  harvestDate, setHarvestDate, notes, setNotes, parcelCrop, parcelId,
}: any) {
  const [sniimSuggestion, setSniimSuggestion] = useState<{ price: number; crop: string; plaza: string; date: string } | null>(null);
  const [sniimLoading, setSniimLoading] = useState(false);

  useEffect(() => {
    if (!parcelId || !parcelCrop) return;
    setSniimLoading(true);
    fetch(`/api/parcels/${parcelId}/market-prices`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then((data: any) => {
        if (data?.sniim) {
          setSniimSuggestion(data.sniim);
          if (!targetPrice || targetPrice === "") {
            setTargetPrice(String(Math.round(data.sniim.price)));
          }
        }
      })
      .catch(() => {})
      .finally(() => setSniimLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcelId, parcelCrop]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Año de campaña</Label>
          <Input
            type="number"
            value={cycleYear}
            onChange={e => setCycleYear(e.target.value)}
            min={2020} max={2030}
            data-testid="input-cycle-year"
          />
        </div>
        <div className="space-y-2">
          <Label>Temporada</Label>
          <Select value={cycleSeason} onValueChange={setCycleSeason}>
            <SelectTrigger data-testid="select-cycle-season">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="primavera-verano">Primavera-Verano</SelectItem>
              <SelectItem value="otono-invierno">Otoño-Invierno</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {parcelCrop && (
        <div className="p-3 bg-green-50 dark:bg-green-950/20 rounded-lg text-sm">
          <span className="font-medium text-green-700 dark:text-green-300">Cultivo registrado:</span>{" "}
          <span className="text-green-600 dark:text-green-400">{parcelCrop}</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Variedad / Híbrido</Label>
          <Input
            placeholder="ej. DM 6.2i, AW 190"
            value={variety}
            onChange={e => setVariety(e.target.value)}
            data-testid="input-variety"
          />
        </div>
        <div className="space-y-2">
          <Label>Densidad de siembra (kg/ha)</Label>
          <Input
            type="number"
            placeholder="ej. 80"
            value={density}
            onChange={e => setDensity(e.target.value)}
            min={0}
            data-testid="input-density"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Rendimiento esperado (tn/ha)</Label>
          <Input
            type="number"
            placeholder="ej. 3.5"
            value={expectedYield}
            onChange={e => setExpectedYield(e.target.value)}
            min={0}
            data-testid="input-expected-yield"
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Precio objetivo ($/tn)</Label>
            {sniimLoading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
            {sniimSuggestion && !sniimLoading && (
              <Badge
                variant="outline"
                className="text-[10px] border-emerald-300 text-emerald-700 dark:text-emerald-400 cursor-pointer hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                title={`Precio SNIIM: ${sniimSuggestion.plaza} · ${sniimSuggestion.date}`}
                onClick={() => setTargetPrice(String(Math.round(sniimSuggestion.price)))}
                data-testid="badge-sniim-suggestion"
              >
                <TrendingUp className="w-2.5 h-2.5 mr-1" />
                SNIIM ${sniimSuggestion.price.toLocaleString("es-MX")}
              </Badge>
            )}
          </div>
          <Input
            type="number"
            placeholder="ej. 280"
            value={targetPrice}
            onChange={e => setTargetPrice(e.target.value)}
            min={0}
            data-testid="input-target-price"
          />
          {sniimSuggestion && (
            <p className="text-[11px] text-muted-foreground">
              Sugerido desde SNIIM hoy · {sniimSuggestion.plaza}
            </p>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Duración estimada del ciclo (días)</Label>
          <Input
            type="number"
            placeholder="ej. 120"
            value={duration}
            onChange={e => setDuration(e.target.value)}
            min={30} max={365}
            data-testid="input-duration"
          />
          <p className="text-[11px] text-muted-foreground leading-tight">
            Ajustá según la variedad. Las fechas de las etapas fenológicas se escalan automáticamente a esta duración.
          </p>
        </div>
        <div className="space-y-2">
          <Label>Fecha estimada de cosecha</Label>
          <Input
            type="date"
            value={harvestDate}
            onChange={e => setHarvestDate(e.target.value)}
            data-testid="input-harvest-date"
          />
        </div>
      </div>
      {expectedYield && targetPrice && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg text-sm">
          <span className="font-medium text-emerald-700 dark:text-emerald-300">Ingreso proyectado/ha:</span>{" "}
          <span className="font-mono text-emerald-600 dark:text-emerald-400">
            ${(parseFloat(expectedYield) * parseFloat(targetPrice)).toLocaleString("es-AR", { maximumFractionDigits: 0 })}
          </span>
        </div>
      )}
      {/* Cierre de ciclo: rendimiento y precio reales — solo en modo edición */}
      {isEditing && (
        <div className="border rounded-lg p-3 space-y-3 bg-amber-50 dark:bg-amber-950/20">
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
            Cierre de ciclo (opcional) — completar al terminar la cosecha
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Rendimiento real (tn/ha)</Label>
              <Input
                type="number"
                placeholder="ej. 3.2"
                value={actualYield}
                onChange={e => setActualYield(e.target.value)}
                min={0}
                data-testid="input-actual-yield"
              />
            </div>
            <div className="space-y-2">
              <Label>Precio real obtenido ($/tn)</Label>
              <Input
                type="number"
                placeholder="ej. 295"
                value={actualPrice}
                onChange={e => setActualPrice(e.target.value)}
                min={0}
                data-testid="input-actual-price"
              />
            </div>
          </div>
          {actualYield && actualPrice && (
            <div className="text-xs text-amber-700 dark:text-amber-400">
              Ingreso real/ha:{" "}
              <strong className="font-mono">
                ${(parseFloat(actualYield) * parseFloat(actualPrice)).toLocaleString("es-MX", { maximumFractionDigits: 0 })}
              </strong>
            </div>
          )}
        </div>
      )}
      <div className="space-y-2">
        <Label>Notas adicionales (opcional)</Label>
        <Textarea
          placeholder="Fuente de semilla, tratamiento, observaciones de lote..."
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          data-testid="textarea-cycle-notes"
        />
      </div>
    </div>
  );
}

// ── Soil alert evaluation helpers ─────────────────────────────────────────────
type AlertSeverity = "high" | "medium" | "low";
interface SoilAlert { severity: AlertSeverity; field: string; msg: string }

function evalField(
  val: string,
  checks: Array<{ severity: AlertSeverity; cond: (n: number) => boolean; msg: string }>,
): SoilAlert | null {
  const n = parseFloat(val);
  if (!val || isNaN(n)) return null;
  for (const c of checks) {
    if (c.cond(n)) return { severity: c.severity, field: "", msg: c.msg };
  }
  return null;
}

function computeSoilAlerts(vals: Record<string, string>): SoilAlert[] {
  const alerts: SoilAlert[] = [];
  const add = (field: string, val: string, checks: Parameters<typeof evalField>[1]) => {
    const r = evalField(val, checks);
    if (r) alerts.push({ ...r, field });
  };

  add("pH", vals.ph, [
    { severity: "high",   cond: n => n < 5.0 || n > 8.5, msg: `pH ${vals.ph} — muy fuera de rango (crítico). Corrección urgente.` },
    { severity: "high",   cond: n => n < 5.5,             msg: `pH ${vals.ph} — suelo muy ácido. Considerar encalado.` },
    { severity: "medium", cond: n => n < 6.0,             msg: `pH ${vals.ph} — ácido. Puede limitar disponibilidad de nutrientes.` },
    { severity: "medium", cond: n => n > 7.5,             msg: `pH ${vals.ph} — alcalino. Puede bloquear micronutrientes.` },
    { severity: "low",    cond: n => n < 6.2 || n > 7.2,  msg: `pH ${vals.ph} — en borde del rango óptimo (6.2–7.2).` },
  ]);
  add("Materia orgánica", vals.mo, [
    { severity: "high",   cond: n => n < 1.0, msg: `MO ${vals.mo}% — muy baja. Riesgo severo de degradación del suelo.` },
    { severity: "medium", cond: n => n < 2.0, msg: `MO ${vals.mo}% — baja. Incorporar compost o abonos verdes.` },
    { severity: "low",    cond: n => n < 3.0, msg: `MO ${vals.mo}% — en límite inferior. Continuar con prácticas regenerativas.` },
  ]);
  add("Nitrógeno total", vals.nitrogenTotal, [
    { severity: "high",   cond: n => n < 0.05, msg: `N ${vals.nitrogenTotal}% — muy bajo. Riesgo de limitación severa.` },
    { severity: "medium", cond: n => n < 0.10, msg: `N ${vals.nitrogenTotal}% — bajo. Planificar fertilización nitrogenada.` },
    { severity: "low",    cond: n => n < 0.15, msg: `N ${vals.nitrogenTotal}% — en límite inferior del óptimo.` },
  ]);
  add("Fósforo disponible", vals.phosphorus, [
    { severity: "high",   cond: n => n < 8,  msg: `P ${vals.phosphorus} ppm — muy deficiente. Riesgo severo de rendimiento.` },
    { severity: "medium", cond: n => n < 15, msg: `P ${vals.phosphorus} ppm — deficiente. Fertilizar antes de siembra.` },
    { severity: "low",    cond: n => n < 20, msg: `P ${vals.phosphorus} ppm — próximo al límite mínimo recomendado.` },
  ]);
  add("Potasio", vals.potassium, [
    { severity: "high",   cond: n => n < 60,  msg: `K ${vals.potassium} ppm — muy bajo. Riesgo de deficiencia severa.` },
    { severity: "medium", cond: n => n < 120, msg: `K ${vals.potassium} ppm — bajo. Puede afectar resistencia a enfermedades.` },
    { severity: "low",    cond: n => n < 150, msg: `K ${vals.potassium} ppm — en límite inferior del óptimo.` },
  ]);
  add("Calcio", vals.calcium, [
    { severity: "medium", cond: n => n < 500,  msg: `Ca ${vals.calcium} ppm — bajo. Puede afectar estructura del suelo.` },
    { severity: "low",    cond: n => n < 1000, msg: `Ca ${vals.calcium} ppm — en límite inferior del óptimo (>1000 ppm).` },
  ]);
  add("Magnesio", vals.magnesium, [
    { severity: "medium", cond: n => n < 60,  msg: `Mg ${vals.magnesium} ppm — bajo. Puede causar clorosis intervenal.` },
    { severity: "low",    cond: n => n < 120, msg: `Mg ${vals.magnesium} ppm — en límite inferior (óptimo >120 ppm).` },
  ]);
  add("Azufre", vals.sulfur, [
    { severity: "medium", cond: n => n < 8,  msg: `S ${vals.sulfur} ppm — deficiente. Importante para síntesis de proteínas.` },
    { severity: "low",    cond: n => n < 15, msg: `S ${vals.sulfur} ppm — en borde del óptimo (>15 ppm).` },
  ]);
  // Micronutrientes
  add("Hierro (Fe)", vals.iron, [
    { severity: "medium", cond: n => n < 4,   msg: `Fe ${vals.iron} ppm — deficiente. Puede causar clorosis foliar.` },
    { severity: "medium", cond: n => n > 200, msg: `Fe ${vals.iron} ppm — elevado. En suelos ácidos puede ser tóxico.` },
  ]);
  add("Zinc (Zn)", vals.zinc, [
    { severity: "high",   cond: n => n < 0.3, msg: `Zn ${vals.zinc} ppm — muy deficiente. Afecta síntesis de auxinas.` },
    { severity: "medium", cond: n => n < 0.5, msg: `Zn ${vals.zinc} ppm — deficiente. Umbral crítico: 0.5 ppm.` },
    { severity: "low",    cond: n => n < 1.0, msg: `Zn ${vals.zinc} ppm — en límite inferior (óptimo >1 ppm).` },
  ]);
  add("Manganeso (Mn)", vals.manganese, [
    { severity: "medium", cond: n => n < 1,  msg: `Mn ${vals.manganese} ppm — deficiente. Esencial para la fotosíntesis.` },
    { severity: "medium", cond: n => n > 50, msg: `Mn ${vals.manganese} ppm — elevado. En suelos ácidos puede ser tóxico.` },
  ]);
  add("Cobre (Cu)", vals.copper, [
    { severity: "medium", cond: n => n < 0.2, msg: `Cu ${vals.copper} ppm — deficiente. Puede reducir formación de lignina.` },
    { severity: "low",    cond: n => n < 0.5, msg: `Cu ${vals.copper} ppm — en límite inferior (óptimo >0.5 ppm).` },
  ]);
  add("Boro (B)", vals.boron, [
    { severity: "high",   cond: n => n > 2,   msg: `B ${vals.boron} ppm — tóxico. Exceso fitotóxico, puede quemar foliar.` },
    { severity: "medium", cond: n => n < 0.2, msg: `B ${vals.boron} ppm — deficiente. Afecta polinización y fructificación.` },
    { severity: "low",    cond: n => n < 0.5, msg: `B ${vals.boron} ppm — en límite inferior (óptimo 0.5–2 ppm).` },
  ]);
  // Propiedades físico-químicas
  add("Conductividad eléctrica", vals.electricConductivity, [
    { severity: "high",   cond: n => n > 4, msg: `CE ${vals.electricConductivity} dS/m — salinidad severa. Riesgo de toxicidad iónica.` },
    { severity: "medium", cond: n => n > 2, msg: `CE ${vals.electricConductivity} dS/m — salinidad moderada. Monitorear evolución.` },
    { severity: "low",    cond: n => n > 1, msg: `CE ${vals.electricConductivity} dS/m — salinidad leve. Sin impacto severo aún.` },
  ]);
  add("CIC", vals.cec, [
    { severity: "high",   cond: n => n < 5,  msg: `CIC ${vals.cec} meq/100g — muy baja. Alta lixiviación de nutrientes.` },
    { severity: "medium", cond: n => n < 10, msg: `CIC ${vals.cec} meq/100g — baja. Incorporar materia orgánica.` },
    { severity: "low",    cond: n => n > 40, msg: `CIC ${vals.cec} meq/100g — muy alta. Posible riesgo de compactación.` },
  ]);
  add("Compactación", vals.compaction, [
    { severity: "high",   cond: n => n > 2.5, msg: `Compactación ${vals.compaction} MPa — crítica. Impide elongación radical.` },
    { severity: "medium", cond: n => n > 2.0, msg: `Compactación ${vals.compaction} MPa — elevada. Planificar labranza descompactadora.` },
    { severity: "low",    cond: n => n > 1.8, msg: `Compactación ${vals.compaction} MPa — en límite. Monitorear evolución.` },
  ]);
  // Textura
  add("Textura (Arena)", vals.sand, [
    { severity: "medium", cond: n => n > 80, msg: `Arena ${vals.sand}% — excesiva. Drenaje rápido, baja retención de agua y nutrientes.` },
    { severity: "low",    cond: n => n > 70, msg: `Arena ${vals.sand}% — alta. Vigilar lixiviación de nutrientes.` },
  ]);
  add("Textura (Arcilla)", vals.clay, [
    { severity: "medium", cond: n => n > 65, msg: `Arcilla ${vals.clay}% — excesiva. Riesgo de compactación y drenaje deficiente.` },
    { severity: "low",    cond: n => n > 50, msg: `Arcilla ${vals.clay}% — alta. Vigilar compactación y planificar drenaje.` },
  ]);
  return alerts;
}

const SEVERITY_STYLE: Record<AlertSeverity, { bg: string; text: string; border: string; icon: React.ReactNode }> = {
  high:   { bg: "bg-red-50",    text: "text-red-700",    border: "border-red-200",    icon: <AlertCircle className="w-3 h-3 text-red-600 flex-shrink-0" /> },
  medium: { bg: "bg-amber-50",  text: "text-amber-700",  border: "border-amber-200",  icon: <AlertTriangle className="w-3 h-3 text-amber-600 flex-shrink-0" /> },
  low:    { bg: "bg-blue-50",   text: "text-blue-700",   border: "border-blue-200",   icon: <Info className="w-3 h-3 text-blue-600 flex-shrink-0" /> },
};
function AlertBadge({ severity }: { severity: AlertSeverity }) {
  const colors = { high: "bg-red-500", medium: "bg-amber-500", low: "bg-blue-400" };
  const labels = { high: "Alto riesgo", medium: "Deficiente", low: "Límite" };
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-semibold text-white px-1.5 py-0.5 rounded-full ${colors[severity]}`}>
      {labels[severity]}
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
function SoilStepContent({
  parcelId, ph, setPh, mo, setMo, totalCarbon, setTotalCarbon,
  nitrogenTotal, setNitrogenTotal, phosphorus, setPhosphorus, potassium, setPotassium,
  calcium, setCalcium, magnesium, setMagnesium, sulfur, setSulfur,
  iron, setIron, zinc, setZinc, manganese, setManganese, copper, setCopper, boron, setBoron,
  electricConductivity, setElectricConductivity, cec, setCec,
  sand, setSand, silt, setSilt, clay, setClay,
  compaction, setCompaction, coverage, setCoverage,
  labName, setLabName,
  analysisDate, setAnalysisDate, notes, setNotes,
}: {
  parcelId: string;
  ph: string; setPh: (v: string) => void;
  mo: string; setMo: (v: string) => void;
  totalCarbon: string; setTotalCarbon: (v: string) => void;
  nitrogenTotal: string; setNitrogenTotal: (v: string) => void;
  phosphorus: string; setPhosphorus: (v: string) => void;
  potassium: string; setPotassium: (v: string) => void;
  calcium: string; setCalcium: (v: string) => void;
  magnesium: string; setMagnesium: (v: string) => void;
  sulfur: string; setSulfur: (v: string) => void;
  iron: string; setIron: (v: string) => void;
  zinc: string; setZinc: (v: string) => void;
  manganese: string; setManganese: (v: string) => void;
  copper: string; setCopper: (v: string) => void;
  boron: string; setBoron: (v: string) => void;
  electricConductivity: string; setElectricConductivity: (v: string) => void;
  cec: string; setCec: (v: string) => void;
  sand: string; setSand: (v: string) => void;
  silt: string; setSilt: (v: string) => void;
  clay: string; setClay: (v: string) => void;
  compaction: string; setCompaction: (v: string) => void;
  coverage: string; setCoverage: (v: string) => void;
  labName: string; setLabName: (v: string) => void;
  analysisDate: string; setAnalysisDate: (v: string) => void;
  notes: string; setNotes: (v: string) => void;
}) {
  const [showSecondary, setShowSecondary] = useState(false);
  const [showMicro, setShowMicro] = useState(false);
  const [showPhysical, setShowPhysical] = useState(false);
  const [showTexture, setShowTexture] = useState(false);

  const { data } = useQuery({
    queryKey: ["soil-analysis", parcelId],
    queryFn: async () => {
      const res = await fetch(`/api/parcels/${parcelId}/soil-analysis`, { credentials: "include" });
      if (!res.ok) return { analyses: [] };
      return res.json();
    },
  });
  const latest = (data?.analyses || []).sort((a: any, b: any) =>
    new Date(b.analysisDate || b.createdAt).getTime() - new Date(a.analysisDate || a.createdAt).getTime()
  )[0];

  const allVals = {
    ph, mo, totalCarbon, nitrogenTotal, phosphorus, potassium,
    calcium, magnesium, sulfur, iron, zinc, manganese, copper, boron,
    electricConductivity, cec, sand, silt, clay, compaction,
  };
  const hasNewData = Object.values(allVals).some(Boolean) || coverage;
  const previewAlerts = computeSoilAlerts(allVals);
  const highAlerts   = previewAlerts.filter(a => a.severity === "high");
  const mediumAlerts = previewAlerts.filter(a => a.severity === "medium");
  const lowAlerts    = previewAlerts.filter(a => a.severity === "low");

  // Per-field alert indicator
  const fieldAlertMap: Record<string, SoilAlert> = {};
  for (const a of previewAlerts) fieldAlertMap[a.field] = a;

  function FieldAlert({ field }: { field: string }) {
    const a = fieldAlertMap[field];
    if (!a) return null;
    return <AlertBadge severity={a.severity} />;
  }

  function SectionToggle({ label, icon, open, onToggle, alertCount }: {
    label: string; icon: React.ReactNode; open: boolean; onToggle: () => void; alertCount: number;
  }) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg border bg-muted/40 hover:bg-muted/60 transition-colors"
        data-testid={`toggle-section-${label.toLowerCase().replace(/\s/g, "-")}`}
      >
        <span className="flex items-center gap-2 text-xs font-semibold text-foreground">
          {icon}
          {label}
          {alertCount > 0 && (
            <span className="ml-1 inline-flex items-center gap-0.5 text-[9px] font-bold text-amber-700 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded-full">
              <AlertTriangle className="w-2.5 h-2.5" /> {alertCount} alerta{alertCount !== 1 ? "s" : ""}
            </span>
          )}
        </span>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>
    );
  }

  return (
    <div className="space-y-4">
      {/* Previous analysis banner */}
      {latest && !hasNewData && (
        <div className="p-3 rounded-lg border bg-emerald-50 dark:bg-emerald-950/20 flex items-start gap-2 text-xs text-emerald-700 dark:text-emerald-300">
          <Check className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            Análisis previo del {formatMexicoDate(latest.analysisDate || latest.createdAt)} disponible
            {latest.ph != null ? ` — pH ${latest.ph}` : ""}
            {latest.organicMatter != null ? `, MO ${latest.organicMatter}%` : ""}
            {latest.phosphorus != null ? `, P ${latest.phosphorus} ppm` : ""}.
            Completa el formulario para actualizar con datos de esta campaña.
          </span>
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        Ingresa los valores del análisis de suelo. Campos opcionales — completa los que tengas disponibles. El sistema generará alertas automáticamente si algún parámetro está fuera de rango.
      </p>

      {/* ── Datos del análisis ── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">Fecha del análisis</Label>
          <Input type="date" value={analysisDate} onChange={e => setAnalysisDate(e.target.value)} data-testid="input-soil-date" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">Laboratorio (opcional)</Label>
          <Input type="text" placeholder="ej. INTA, Lab Agronomía..." value={labName} onChange={e => setLabName(e.target.value)} data-testid="input-soil-lab" />
        </div>
      </div>

      {/* ── Propiedades básicas ── */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">pH y Materia Orgánica</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">pH del suelo</Label>
              <FieldAlert field="pH" />
            </div>
            <Input type="number" placeholder="ej. 6.5" step="0.1" min={0} max={14}
              value={ph} onChange={e => setPh(e.target.value)} data-testid="input-soil-ph" />
            <p className="text-[10px] text-muted-foreground">Óptimo: 6.2–7.2 | Crítico: &lt;5.5 o &gt;8.0</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Materia orgánica (%)</Label>
              <FieldAlert field="Materia orgánica" />
            </div>
            <Input type="number" placeholder="ej. 3.2" step="0.1" min={0} max={20}
              value={mo} onChange={e => setMo(e.target.value)} data-testid="input-soil-mo" />
            <p className="text-[10px] text-muted-foreground">Óptimo: &gt;3% | Bajo: &lt;2%</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Carbono total (%)</Label>
            <Input type="number" placeholder="ej. 1.8" step="0.1" min={0}
              value={totalCarbon} onChange={e => setTotalCarbon(e.target.value)} data-testid="input-soil-tc" />
            <p className="text-[10px] text-muted-foreground">≈ MO × 0.58</p>
          </div>
        </div>
      </div>

      {/* ── Macronutrientes principales ── */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Macronutrientes principales (N–P–K)</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Nitrógeno total (%)</Label>
              <FieldAlert field="Nitrógeno total" />
            </div>
            <Input type="number" placeholder="ej. 0.15" step="0.01" min={0}
              value={nitrogenTotal} onChange={e => setNitrogenTotal(e.target.value)} data-testid="input-soil-n" />
            <p className="text-[10px] text-muted-foreground">Óptimo: 0.15–0.30% | Bajo: &lt;0.10%</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Fósforo disponible (ppm)</Label>
              <FieldAlert field="Fósforo disponible" />
            </div>
            <Input type="number" placeholder="ej. 20" min={0}
              value={phosphorus} onChange={e => setPhosphorus(e.target.value)} data-testid="input-soil-p" />
            <p className="text-[10px] text-muted-foreground">Óptimo: &gt;20 | Crítico: &lt;8 ppm</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Potasio (ppm)</Label>
              <FieldAlert field="Potasio" />
            </div>
            <Input type="number" placeholder="ej. 150" min={0}
              value={potassium} onChange={e => setPotassium(e.target.value)} data-testid="input-soil-k" />
            <p className="text-[10px] text-muted-foreground">Óptimo: &gt;150 | Bajo: &lt;120 ppm</p>
          </div>
        </div>
      </div>

      {/* ── Macronutrientes secundarios (colapsable) ── */}
      <div className="space-y-2">
        <SectionToggle
          label="Macronutrientes secundarios (Ca · Mg · S)"
          icon={<span className="text-amber-600">⚗</span>}
          open={showSecondary}
          onToggle={() => setShowSecondary(v => !v)}
          alertCount={["Calcio","Magnesio","Azufre"].filter(f => fieldAlertMap[f]).length}
        />
        {showSecondary && (
          <div className="grid grid-cols-2 gap-3 pl-1">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Calcio (ppm)</Label>
                <FieldAlert field="Calcio" />
              </div>
              <Input type="number" placeholder="ej. 1500" min={0}
                value={calcium} onChange={e => setCalcium(e.target.value)} data-testid="input-soil-ca" />
              <p className="text-[10px] text-muted-foreground">Óptimo: &gt;1000 ppm</p>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Magnesio (ppm)</Label>
                <FieldAlert field="Magnesio" />
              </div>
              <Input type="number" placeholder="ej. 200" min={0}
                value={magnesium} onChange={e => setMagnesium(e.target.value)} data-testid="input-soil-mg" />
              <p className="text-[10px] text-muted-foreground">Óptimo: &gt;120 ppm | Rel. Ca/Mg: 5–7:1</p>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Azufre (ppm)</Label>
                <FieldAlert field="Azufre" />
              </div>
              <Input type="number" placeholder="ej. 20" min={0}
                value={sulfur} onChange={e => setSulfur(e.target.value)} data-testid="input-soil-s" />
              <p className="text-[10px] text-muted-foreground">Óptimo: &gt;15 ppm | Crítico: &lt;8 ppm</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Micronutrientes (colapsable) ── */}
      <div className="space-y-2">
        <SectionToggle
          label="Micronutrientes (Fe · Zn · Mn · Cu · B)"
          icon={<span className="text-purple-600">🔬</span>}
          open={showMicro}
          onToggle={() => setShowMicro(v => !v)}
          alertCount={["Hierro (Fe)","Zinc (Zn)","Manganeso (Mn)","Cobre (Cu)","Boro (B)"].filter(f => fieldAlertMap[f]).length}
        />
        {showMicro && (
          <div className="space-y-3 pl-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Hierro — Fe (ppm)</Label>
                  <FieldAlert field="Hierro (Fe)" />
                </div>
                <Input type="number" placeholder="ej. 20" step="0.1" min={0}
                  value={iron} onChange={e => setIron(e.target.value)} data-testid="input-soil-fe" />
                <p className="text-[10px] text-muted-foreground">Crítico: &lt;4 ppm | Alto: &gt;200 ppm</p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Zinc — Zn (ppm)</Label>
                  <FieldAlert field="Zinc (Zn)" />
                </div>
                <Input type="number" placeholder="ej. 1.5" step="0.1" min={0}
                  value={zinc} onChange={e => setZinc(e.target.value)} data-testid="input-soil-zn" />
                <p className="text-[10px] text-muted-foreground">Crítico: &lt;0.5 ppm | Óptimo: &gt;1 ppm</p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Manganeso — Mn (ppm)</Label>
                  <FieldAlert field="Manganeso (Mn)" />
                </div>
                <Input type="number" placeholder="ej. 10" step="0.1" min={0}
                  value={manganese} onChange={e => setManganese(e.target.value)} data-testid="input-soil-mn" />
                <p className="text-[10px] text-muted-foreground">Crítico: &lt;1 ppm | Alto: &gt;50 ppm</p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Cobre — Cu (ppm)</Label>
                  <FieldAlert field="Cobre (Cu)" />
                </div>
                <Input type="number" placeholder="ej. 1.0" step="0.1" min={0}
                  value={copper} onChange={e => setCopper(e.target.value)} data-testid="input-soil-cu" />
                <p className="text-[10px] text-muted-foreground">Crítico: &lt;0.2 ppm | Óptimo: &gt;0.5 ppm</p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Boro — B (ppm)</Label>
                  <FieldAlert field="Boro (B)" />
                </div>
                <Input type="number" placeholder="ej. 0.8" step="0.1" min={0}
                  value={boron} onChange={e => setBoron(e.target.value)} data-testid="input-soil-b" />
                <p className="text-[10px] text-muted-foreground">Crítico: &lt;0.2 | Tóxico: &gt;2 ppm</p>
              </div>
            </div>
            <div className="p-2 rounded bg-purple-50 border border-purple-100 text-[10px] text-purple-700">
              Los micronutrientes son esenciales en bajas concentraciones. Deficiencias afectan floración, fijación de N y rendimiento.
            </div>
          </div>
        )}
      </div>

      {/* ── Propiedades físico-químicas (colapsable) ── */}
      <div className="space-y-2">
        <SectionToggle
          label="Propiedades físico-químicas (CE · CIC · Compactación)"
          icon={<span className="text-blue-600">📊</span>}
          open={showPhysical}
          onToggle={() => setShowPhysical(v => !v)}
          alertCount={["Conductividad eléctrica","CIC","Compactación"].filter(f => fieldAlertMap[f]).length}
        />
        {showPhysical && (
          <div className="grid grid-cols-2 gap-3 pl-1">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Conductividad eléctrica (dS/m)</Label>
                <FieldAlert field="Conductividad eléctrica" />
              </div>
              <Input type="number" placeholder="ej. 0.5" step="0.1" min={0}
                value={electricConductivity} onChange={e => setElectricConductivity(e.target.value)} data-testid="input-soil-ec" />
              <p className="text-[10px] text-muted-foreground">Normal: &lt;1 | Moderado: 1–2 | Severo: &gt;4 dS/m</p>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">CIC — Cap. Intercambio Catiónico (meq/100g)</Label>
                <FieldAlert field="CIC" />
              </div>
              <Input type="number" placeholder="ej. 20" step="0.5" min={0}
                value={cec} onChange={e => setCec(e.target.value)} data-testid="input-soil-cec" />
              <p className="text-[10px] text-muted-foreground">Baja: &lt;10 | Media: 10–20 | Alta: &gt;20 meq/100g</p>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Compactación (MPa)</Label>
                <FieldAlert field="Compactación" />
              </div>
              <Input type="number" placeholder="ej. 1.8" step="0.1" min={0} max={10}
                value={compaction} onChange={e => setCompaction(e.target.value)} data-testid="input-soil-compaction" />
              <p className="text-[10px] text-muted-foreground">Límite: 1.8 | Crítico: &gt;2.0 MPa</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Textura (colapsable) ── */}
      <div className="space-y-2">
        <SectionToggle
          label="Textura del suelo (Arena · Limo · Arcilla)"
          icon={<span className="text-orange-600">🪨</span>}
          open={showTexture}
          onToggle={() => setShowTexture(v => !v)}
          alertCount={["Textura (Arena)","Textura (Arcilla)"].filter(f => fieldAlertMap[f]).length}
        />
        {showTexture && (
          <div className="space-y-3 pl-1">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Arena (%)</Label>
                  <FieldAlert field="Textura (Arena)" />
                </div>
                <Input type="number" placeholder="ej. 40" min={0} max={100}
                  value={sand} onChange={e => setSand(e.target.value)} data-testid="input-soil-sand" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Limo (%)</Label>
                <Input type="number" placeholder="ej. 35" min={0} max={100}
                  value={silt} onChange={e => setSilt(e.target.value)} data-testid="input-soil-silt" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Arcilla (%)</Label>
                  <FieldAlert field="Textura (Arcilla)" />
                </div>
                <Input type="number" placeholder="ej. 25" min={0} max={100}
                  value={clay} onChange={e => setClay(e.target.value)} data-testid="input-soil-clay" />
              </div>
            </div>
            {(sand || silt || clay) && (() => {
              const s = parseFloat(sand)||0, si = parseFloat(silt)||0, c = parseFloat(clay)||0;
              const total = s + si + c;
              return (
                <div className="space-y-1">
                  <div className="flex gap-0 h-3 rounded-full overflow-hidden text-[8px] font-bold">
                    {s > 0 && <div className="flex items-center justify-center text-white bg-yellow-400" style={{ width: `${(s/total)*100}%` }}>{s > 12 ? `${s}%` : ""}</div>}
                    {si > 0 && <div className="flex items-center justify-center text-white bg-stone-400" style={{ width: `${(si/total)*100}%` }}>{si > 12 ? `${si}%` : ""}</div>}
                    {c > 0 && <div className="flex items-center justify-center text-white bg-orange-500" style={{ width: `${(c/total)*100}%` }}>{c > 12 ? `${c}%` : ""}</div>}
                  </div>
                  <div className="flex gap-3 text-[9px] text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400 inline-block"/>Arena</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-stone-400 inline-block"/>Limo</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500 inline-block"/>Arcilla</span>
                    {Math.abs(total - 100) > 2 && <span className="text-amber-600 font-semibold">⚠ Suma: {total.toFixed(0)}% (debe ser ~100%)</span>}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* ── Cobertura vegetal ── */}
      <div className="space-y-1.5">
        <Label className="text-xs">Cobertura vegetal (%)</Label>
        <div className="flex items-center gap-3">
          <Input type="number" placeholder="ej. 60" min={0} max={100}
            value={coverage} onChange={e => setCoverage(e.target.value)}
            className="w-28" data-testid="input-soil-coverage" />
          {coverage && (
            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-green-500 rounded-full transition-all"
                style={{ width: `${Math.min(100, parseFloat(coverage) || 0)}%` }} />
            </div>
          )}
          {coverage && <span className="text-sm font-mono">{coverage}%</span>}
        </div>
      </div>

      {/* ── Observaciones ── */}
      <div className="space-y-1.5">
        <Label className="text-xs">Observaciones (opcional)</Label>
        <Textarea
          placeholder="Textura, salinidad, historial de labranza, problemas recurrentes..."
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          data-testid="textarea-soil-notes"
        />
      </div>

      {/* ── Panel de alertas en tiempo real ── */}
      {previewAlerts.length > 0 && (
        <div className="space-y-2" data-testid="soil-alert-preview">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            Vista previa de alertas que se generarán al guardar
          </p>
          <div className="space-y-1.5">
            {[...highAlerts, ...mediumAlerts, ...lowAlerts].map((a, i) => {
              const s = SEVERITY_STYLE[a.severity];
              return (
                <div key={i} className={`flex items-start gap-2 p-2 rounded-lg border text-xs ${s.bg} ${s.border}`} data-testid={`preview-alert-${a.severity}-${i}`}>
                  {s.icon}
                  <div className="flex-1 min-w-0">
                    <span className={`font-semibold ${s.text}`}>{a.field}: </span>
                    <span className={s.text}>{a.msg}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground">
            {previewAlerts.length} alerta{previewAlerts.length !== 1 ? "s" : ""} detectada{previewAlerts.length !== 1 ? "s" : ""}
            {highAlerts.length > 0 ? ` — ${highAlerts.length} crítica${highAlerts.length !== 1 ? "s" : ""}` : ""}
            . Se guardarán en el sistema de alertas al confirmar este paso.
          </p>
        </div>
      )}

      {hasNewData && previewAlerts.length === 0 && (
        <div className="p-2 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700 flex items-center gap-2">
          <Check className="w-3.5 h-3.5 text-green-600" />
          Todos los parámetros ingresados están dentro de rangos aceptables. Al confirmar se guardará el análisis.
        </div>
      )}
    </div>
  );
}

const COST_CATEGORIES = [
  { key: "semillas",     label: "Semillas" },
  { key: "fertilizantes", label: "Fertilizantes" },
  { key: "agroquimicos", label: "Agroquímicos" },
  { key: "maquinaria",   label: "Maquinaria" },
  { key: "mano_de_obra", label: "Mano de Obra" },
];

function EconomyStepContent({
  parcelId,
  saleChannel, setSaleChannel,
  financingType, setFinancingType,
  notes, setNotes,
  costSemillas, setCostSemillas,
  costFertilizantes, setCostFertilizantes,
  costAgroquimicos, setCostAgroquimicos,
  costMaquinaria, setCostMaquinaria,
  costManoDeObra, setCostManoDeObra,
  costOtros, setCostOtros,
  expectedYield, setExpectedYield,
  targetPrice, setTargetPrice,
}: {
  parcelId: string;
  saleChannel: string; setSaleChannel: (v: string) => void;
  financingType: string; setFinancingType: (v: string) => void;
  notes: string; setNotes: (v: string) => void;
  costSemillas: string; setCostSemillas: (v: string) => void;
  costFertilizantes: string; setCostFertilizantes: (v: string) => void;
  costAgroquimicos: string; setCostAgroquimicos: (v: string) => void;
  costMaquinaria: string; setCostMaquinaria: (v: string) => void;
  costManoDeObra: string; setCostManoDeObra: (v: string) => void;
  costOtros: string; setCostOtros: (v: string) => void;
  expectedYield: string; setExpectedYield: (v: string) => void;
  targetPrice: string; setTargetPrice: (v: string) => void;
}) {
  const costEntries = [
    { key: "semillas",      label: "Semillas ($/ha)",        value: costSemillas,      set: setCostSemillas },
    { key: "fertilizantes", label: "Fertilizantes ($/ha)",   value: costFertilizantes, set: setCostFertilizantes },
    { key: "agroquimicos",  label: "Agroquímicos ($/ha)",    value: costAgroquimicos,  set: setCostAgroquimicos },
    { key: "maquinaria",    label: "Maquinaria ($/ha)",      value: costMaquinaria,    set: setCostMaquinaria },
    { key: "mano_de_obra",  label: "Mano de Obra ($/ha)",    value: costManoDeObra,    set: setCostManoDeObra },
    { key: "otros",         label: "Otros ($/ha)",           value: costOtros,         set: setCostOtros },
  ];

  const totalCost = costEntries.reduce((s, e) => s + (parseFloat(e.value) || 0), 0);
  const projRevenue = (parseFloat(expectedYield) || 0) * (parseFloat(targetPrice) || 0);
  const margin = projRevenue - totalCost;

  return (
    <div className="space-y-4">
      {/* Rendimiento y precio */}
      <div>
        <p className="text-sm font-medium mb-2">Proyección de ingresos</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Rendimiento esperado (tn/ha)</Label>
            <Input type="number" placeholder="ej. 3.5" step="0.1" min={0}
              value={expectedYield} onChange={e => setExpectedYield(e.target.value)}
              data-testid="input-econ-yield" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Precio objetivo ($/tn)</Label>
            <Input type="number" placeholder="ej. 280" min={0}
              value={targetPrice} onChange={e => setTargetPrice(e.target.value)}
              data-testid="input-econ-price" />
          </div>
        </div>
      </div>

      {/* 5-category cost breakdown */}
      <div>
        <p className="text-sm font-medium mb-2">Costos estimados por categoría ($/ha)</p>
        <div className="grid grid-cols-2 gap-2">
          {costEntries.map(entry => (
            <div key={entry.key} className="space-y-1">
              <Label className="text-xs text-muted-foreground">{entry.label}</Label>
              <Input type="number" placeholder="0" min={0}
                value={entry.value} onChange={e => entry.set(e.target.value)}
                data-testid={`input-cost-${entry.key}`} />
            </div>
          ))}
        </div>
      </div>

      {/* Live margin preview */}
      {(totalCost > 0 || projRevenue > 0) && (
        <div className={`p-3 rounded-lg text-sm grid grid-cols-3 gap-2 text-center
          ${margin >= 0 ? "bg-emerald-50 dark:bg-emerald-950/20" : "bg-red-50 dark:bg-red-950/20"}`}>
          <div>
            <p className="text-xs text-muted-foreground">Ingreso proy.</p>
            <p className="font-mono font-bold text-emerald-700 dark:text-emerald-300">
              ${projRevenue.toLocaleString("es-AR", { maximumFractionDigits: 0 })}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Costo total</p>
            <p className="font-mono font-bold text-red-600 dark:text-red-400">
              ${totalCost.toLocaleString("es-AR", { maximumFractionDigits: 0 })}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Margen</p>
            <p className={`font-mono font-bold ${margin >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-600"}`}>
              {margin >= 0 ? "+" : ""}${margin.toLocaleString("es-AR", { maximumFractionDigits: 0 })}
            </p>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Canal de venta</Label>
          <Select value={saleChannel} onValueChange={setSaleChannel}>
            <SelectTrigger data-testid="select-sale-channel"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
            <SelectContent>
              <SelectItem value="cooperativa">Cooperativa</SelectItem>
              <SelectItem value="exportador">Exportador</SelectItem>
              <SelectItem value="mercado_local">Mercado local</SelectItem>
              <SelectItem value="acopio">Acopio</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Financiamiento</Label>
          <Select value={financingType} onValueChange={setFinancingType}>
            <SelectTrigger data-testid="select-financing"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
            <SelectContent>
              <SelectItem value="propio">Capital propio</SelectItem>
              <SelectItem value="credito_banco">Crédito bancario</SelectItem>
              <SelectItem value="credito_proveedor">Crédito proveedor</SelectItem>
              <SelectItem value="leasing">Leasing maquinaria</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label>Observaciones económicas (opcional)</Label>
        <Textarea
          placeholder="Precio de insumos locales, condiciones de venta, subsidios, otros costos..."
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          data-testid="textarea-economy-notes"
        />
      </div>
    </div>
  );
}

function PracticesStepContent({
  parcelId,
  labranzaType, setLabranzaType,
  fertilizerSynthetic, setFertilizerSynthetic,
  fertilizerDose, setFertilizerDose,
  pestManagement, setPestManagement,
  irrigationType, setIrrigationType,
  selected, setSelected,
  notes, setNotes,
}: {
  parcelId: string;
  labranzaType: string; setLabranzaType: (v: string) => void;
  fertilizerSynthetic: boolean | null; setFertilizerSynthetic: (v: boolean | null) => void;
  fertilizerDose: string; setFertilizerDose: (v: string) => void;
  pestManagement: string; setPestManagement: (v: string) => void;
  irrigationType: string; setIrrigationType: (v: string) => void;
  selected: Set<string>; setSelected: (v: Set<string>) => void;
  notes: string; setNotes: (v: string) => void;
}) {
  const practicesList = [
    { key: "siembra_directa", label: "Siembra directa", desc: "Sin remoción del suelo" },
    { key: "cobertura_vegetal", label: "Cobertura vegetal", desc: "Cultivos de cobertura entre ciclos" },
    { key: "rotacion", label: "Rotación de cultivos", desc: "Al menos 2 cultivos diferentes por año" },
    { key: "compostaje", label: "Compostaje / abono orgánico", desc: "Incorporación de materia orgánica" },
    { key: "integracion_animal", label: "Integración ganadería", desc: "Pastoreo rotativo u otras integraciones" },
  ];

  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key); else next.add(key);
    setSelected(next);
  };

  return (
    <div className="space-y-5">
      {/* Required structured fields */}
      <div className="space-y-3">
        <p className="text-sm font-medium">Manejo del suelo y cultivo</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Tipo de labranza</Label>
            <Select value={labranzaType} onValueChange={setLabranzaType}>
              <SelectTrigger data-testid="select-labranza-type">
                <SelectValue placeholder="Seleccionar..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="siembra_directa">Siembra directa</SelectItem>
                <SelectItem value="labranza_reducida">Labranza reducida</SelectItem>
                <SelectItem value="labranza_convencional">Labranza convencional</SelectItem>
                <SelectItem value="labranza_profunda">Labranza profunda (subsolado)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Tipo de riego</Label>
            <Select value={irrigationType} onValueChange={setIrrigationType}>
              <SelectTrigger data-testid="select-irrigation-type">
                <SelectValue placeholder="Seleccionar..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="secano">Secano (sin riego)</SelectItem>
                <SelectItem value="goteo">Goteo</SelectItem>
                <SelectItem value="aspersion">Aspersión / pivote</SelectItem>
                <SelectItem value="surcos">Surcos / manto</SelectItem>
                <SelectItem value="microaspersion">Microaspersión</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Manejo de plagas y enfermedades</Label>
          <Select value={pestManagement} onValueChange={setPestManagement}>
            <SelectTrigger data-testid="select-pest-management">
              <SelectValue placeholder="Seleccionar..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mip">MIP — Manejo integrado de plagas</SelectItem>
              <SelectItem value="quimico">Control químico convencional</SelectItem>
              <SelectItem value="biologico">Control biológico</SelectItem>
              <SelectItem value="organico">Orgánico certificado</SelectItem>
              <SelectItem value="ninguno">Sin tratamiento previsto</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Fertilización sintética</Label>
          <div className="flex gap-2">
            {[{ v: true, label: "Sí" }, { v: false, label: "No" }].map(opt => (
              <button
                key={String(opt.v)}
                type="button"
                onClick={() => setFertilizerSynthetic(opt.v)}
                className={`flex-1 py-1.5 rounded-md border text-sm font-medium transition-colors
                  ${fertilizerSynthetic === opt.v
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted/50"}`}
                data-testid={`btn-fertilizer-${opt.v}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        {fertilizerSynthetic === true && (
          <div className="space-y-1.5">
            <Label className="text-xs">Dosis de fertilizante (kg/ha)</Label>
            <Input
              type="number"
              placeholder="ej. 150"
              min={0}
              value={fertilizerDose}
              onChange={e => setFertilizerDose(e.target.value)}
              data-testid="input-fertilizer-dose"
            />
          </div>
        )}
      </div>

      {/* Regenerative practices checklist */}
      <div className="space-y-2">
        <p className="text-sm font-medium">Prácticas regenerativas (opcional)</p>
        <p className="text-xs text-muted-foreground">Marca las que aplicarás en esta campaña para calcular el puntaje regenerativo:</p>
        {practicesList.map(p => (
          <button
            key={p.key}
            type="button"
            className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors
              ${selected.has(p.key) ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}
            onClick={() => toggle(p.key)}
            data-testid={`practice-toggle-${p.key}`}
          >
            <div className={`w-5 h-5 rounded flex items-center justify-center border flex-shrink-0
              ${selected.has(p.key) ? "bg-primary border-primary" : "border-muted-foreground"}`}>
              {selected.has(p.key) && <Check className="w-3 h-3 text-primary-foreground" />}
            </div>
            <div>
              <p className="text-sm font-medium">{p.label}</p>
              <p className="text-xs text-muted-foreground">{p.desc}</p>
            </div>
          </button>
        ))}
        {selected.size > 0 && (
          <div className="p-2 bg-teal-50 dark:bg-teal-950/20 rounded-lg text-xs text-teal-700 dark:text-teal-300">
            ✓ {selected.size} práctica{selected.size > 1 ? "s" : ""} regenerativa{selected.size > 1 ? "s" : ""} seleccionada{selected.size > 1 ? "s" : ""}
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Notas adicionales (opcional)</Label>
        <Textarea
          placeholder="Otras prácticas, condiciones especiales de este ciclo..."
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          data-testid="textarea-practices-notes"
        />
      </div>
    </div>
  );
}

// ── Paso opcional: Análisis Microbiológico ──────────────────────────────────
function MicrobioStepContent({
  form, setField, activeRecordId, error, loading, loadError, records, onRetry, onNewAnalysis,
}: {
  form: SoilBiologyForm;
  setField: (field: keyof SoilBiologyForm, value: string) => void;
  activeRecordId: string | null;
  error: string;
  loading: boolean;
  loadError: boolean;
  records: any[];
  onRetry: () => void;
  onNewAnalysis: () => void;
}) {
  const ratioNumerator = biologyNumber(form.trichodermaCfu);
  const ratioDenominator = biologyNumber(form.fusariumCfu);
  const ratio = ratioNumerator !== null && ratioDenominator !== null && ratioDenominator > 0
    ? ratioNumerator / ratioDenominator
    : null;
  const sortedRecords = [...records].sort((a, b) =>
    new Date(b.sampleDate || b.createdAt).getTime() - new Date(a.sampleDate || a.createdAt).getTime()
  );
  const sourceLabels: Record<string, string> = {
    lab: "Laboratorio",
    nir: "NIR",
    mir: "MIR",
    estimated: "Estimación",
    satellite: "Satélite",
  };
  const numericFields = [
    ["Trichoderma", "trichodermaCfu", "input-micro-trichoderma"],
    ["Fusarium", "fusariumCfu", "input-micro-fusarium"],
    ["Bacillus", "bacillusCfu", "input-micro-bacillus"],
    ["Metarhizium · UFC/g", "metarhiziumCfu", "input-micro-metarhizium"],
    ["Beauveria · UFC/g", "beauveriaCfu", "input-micro-beauveria"],
  ] as const;
  const legacyFields = [
    ["MBC — Biomasa microbiana C (μg C/g)", "mbc", "input-micro-mbc", "0.01"],
    ["MR — Respiración microbiana (μg C/g/d)", "mr", "input-micro-mr", "0.001"],
    ["BG — β-glucosidasa (nmol/g/h)", "bg", "input-micro-bg", "0.01"],
    ["NAG — N-acetil-glucosaminidasa (nmol/g/h)", "nag", "input-micro-nag", "0.01"],
    ["ADN metagenómico (μg ADN/g suelo)", "dnaYield", "input-micro-dna", "0.001"],
  ] as const;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="p-3 bg-purple-50 dark:bg-purple-950/20 rounded-lg text-xs text-purple-700 dark:text-purple-300 flex-1">
          Captura exactamente los resultados del informe. Los campos vacíos se conservan como “sin dato”; no equivalen a cero.
        </div>
        {records.length > 0 && <Button type="button" variant="outline" size="sm" onClick={onNewAnalysis} data-testid="btn-new-micro-analysis">
          <Plus className="mr-1.5 h-4 w-4" /> Nuevo análisis
        </Button>}
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {activeRecordId
          ? <>Editando análisis existente · {activeRecordId.slice(0, 8)} <Badge variant="outline">{sourceLabels[form.dataSource] || form.dataSource}</Badge></>
          : <Badge variant="outline">Nuevo análisis · Laboratorio</Badge>}
      </div>
      {loadError && <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
        <span>No se pudieron cargar los análisis existentes; no guardaremos sobre datos que no se han podido revisar.</span>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>Reintentar</Button>
      </div>}
      {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Fecha de muestreo</Label>
          <Input type="date" value={form.sampleDate} onChange={e => setField("sampleDate", e.target.value)} data-testid="input-micro-date" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Profundidad (cm)</Label>
          <Input type="number" placeholder="20" min={1} max={200}
            value={form.depthCm} onChange={e => setField("depthCm", e.target.value)} data-testid="input-micro-depth" />
        </div>
      </div>

      <div>
        <p className="text-sm font-medium mb-2">Referencia del laboratorio</p>
        <div className="grid grid-cols-2 gap-3">
          {([
            ["Laboratorio", "labName", "Nombre del laboratorio", "input-micro-lab"],
            ["Folio del informe", "labFolio", "Folio o identificador", "input-micro-folio"],
            ["Método microbiológico", "microbiologyMethod", "Método indicado en el informe", "input-micro-method"],
          ] as const).map(([label, field, placeholder, testId]) => <div key={field} className="space-y-1">
            <Label className="text-xs">{label}</Label>
            <Input value={form[field]} onChange={e => setField(field, e.target.value)} placeholder={placeholder} data-testid={testId} />
          </div>)}
        </div>
      </div>

      <div>
        <p className="text-sm font-medium mb-2">Organismos cultivables (UFC/g)</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {numericFields.map(([label, field, testId]) => <div key={field} className="space-y-1">
            <Label className="text-xs">{label}</Label>
            <Input type="number" min={0} step="any" value={form[field]} onChange={e => setField(field, e.target.value)} data-testid={testId} />
          </div>)}
          <div className="sm:col-span-2 rounded-md border bg-muted/30 p-3 text-xs">
            <span className="font-medium">Relación Trichoderma / Fusarium: </span>
            {ratio === null ? "No calculable — falta un conteo o Fusarium es cero." : ratio.toLocaleString("es-MX", { maximumFractionDigits: 3 })}
          </div>
        </div>
        <p className="text-sm font-medium mt-4 mb-2">Estado reportado</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {([
            ["Metarhizium", "metarhiziumStatus", ["counted", "not_detected", "not_analyzed"]],
            ["Beauveria", "beauveriaStatus", ["counted", "not_detected", "not_analyzed"]],
            ["Fijadores de nitrógeno", "nitrogenFixersStatus", ["detected", "not_detected", "not_analyzed"]],
          ] as const).map(([label, field, options]) => <div key={field} className="space-y-1">
            <Label className="text-xs">{label}</Label>
            <Select value={form[field]} onValueChange={value => setField(field, value)}>
              <SelectTrigger data-testid={`select-micro-${field}`}><SelectValue placeholder="Seleccionar resultado" /></SelectTrigger>
              <SelectContent>
                {options.map(option => <SelectItem key={option} value={option}>
                  {option === "counted" ? "Conteo registrado" : option === "detected" ? "Detectado" : option === "not_detected" ? "No detectado" : "No analizado"}
                </SelectItem>)}
              </SelectContent>
            </Select>
          </div>)}
        </div>
      </div>

      <div>
        <p className="text-sm font-medium mb-2">Biomasa, actividad y análisis heredados</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {legacyFields.map(([label, field, testId, step]) => <div key={field} className="space-y-1">
            <Label className="text-xs">{label}</Label>
            <Input type="number" min={0} step={step} value={form[field]} onChange={e => setField(field, e.target.value)} data-testid={testId} />
          </div>)}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Observaciones (opcional)</Label>
        <Textarea placeholder="Laboratorio, metodología, condiciones de muestreo..."
          value={form.notes} onChange={e => setField("notes", e.target.value)} rows={2} data-testid="textarea-micro-notes" />
      </div>

      <div className="space-y-2 border-t pt-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium">Análisis guardados</p>
          {loading && <span className="text-xs text-muted-foreground">Cargando registros…</span>}
        </div>
        {!loading && sortedRecords.length === 0
          ? <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">Aún no hay análisis microbiológicos registrados.</p>
          : <div className="space-y-2">{sortedRecords.slice(0, 5).map(record => (
            <div key={record.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-xs ${String(record.id) === activeRecordId ? "border-primary bg-primary/5" : "bg-card"}`}>
              <div>
                <p className="font-medium">{formatMexicoDate(record.sampleDate)}{record.labFolio ? ` · Folio ${record.labFolio}` : ""}</p>
                <p className="text-muted-foreground">{record.labName || "Laboratorio sin especificar"} · {record.depthCm ?? 20} cm</p>
              </div>
              {record.trichodermaFusariumRatio != null && <Badge variant="outline">Trich/Fus {Number(record.trichodermaFusariumRatio).toLocaleString("es-MX", { maximumFractionDigits: 3 })}</Badge>}
            </div>
          ))}</div>}
      </div>
    </div>
  );
}

// ── Paso opcional: Análisis de Tejidos Vegetales ───────────────────────────
function TejidosStepContent({
  analysisDate, setAnalysisDate,
  samplePart, setSamplePart,
  phenologicalStage, setPhenologicalStage,
  labName, setLabName,
  n, setN, p, setP, k, setK, ca, setCa, mg, setMg, s, setS,
  fe, setFe, zn, setZn, mn, setMn, cu, setCu, b, setB,
  notes, setNotes,
}: {
  analysisDate: string; setAnalysisDate: (v: string) => void;
  samplePart: string; setSamplePart: (v: string) => void;
  phenologicalStage: string; setPhenologicalStage: (v: string) => void;
  labName: string; setLabName: (v: string) => void;
  n: string; setN: (v: string) => void;
  p: string; setP: (v: string) => void;
  k: string; setK: (v: string) => void;
  ca: string; setCa: (v: string) => void;
  mg: string; setMg: (v: string) => void;
  s: string; setS: (v: string) => void;
  fe: string; setFe: (v: string) => void;
  zn: string; setZn: (v: string) => void;
  mn: string; setMn: (v: string) => void;
  cu: string; setCu: (v: string) => void;
  b: string; setB: (v: string) => void;
  notes: string; setNotes: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="p-3 bg-pink-50 dark:bg-pink-950/20 rounded-lg text-xs text-pink-700 dark:text-pink-300">
        Ingresa los resultados del análisis foliar o de tejido. Los macronutrientes van en % y los micronutrientes en ppm.
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Fecha del análisis</Label>
          <Input type="date" value={analysisDate} onChange={e => setAnalysisDate(e.target.value)} data-testid="input-tej-date" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Parte de la planta</Label>
          <Select value={samplePart} onValueChange={setSamplePart}>
            <SelectTrigger data-testid="select-tej-part"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="hoja">Hoja</SelectItem>
              <SelectItem value="peciolo">Pecíolo</SelectItem>
              <SelectItem value="tallo">Tallo</SelectItem>
              <SelectItem value="raiz">Raíz</SelectItem>
              <SelectItem value="grano">Grano</SelectItem>
              <SelectItem value="fruto">Fruto</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Etapa fenológica</Label>
          <Input placeholder="ej. V6, R1, floración..."
            value={phenologicalStage} onChange={e => setPhenologicalStage(e.target.value)} data-testid="input-tej-stage" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Laboratorio</Label>
          <Input placeholder="Nombre del laboratorio"
            value={labName} onChange={e => setLabName(e.target.value)} data-testid="input-tej-lab" />
        </div>
      </div>

      <div>
        <p className="text-sm font-medium mb-2">Macronutrientes (%)</p>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "N — Nitrógeno", val: n, set: setN, id: "n", ph: "ej. 3.5" },
            { label: "P — Fósforo",   val: p, set: setP, id: "p", ph: "ej. 0.4" },
            { label: "K — Potasio",   val: k, set: setK, id: "k", ph: "ej. 2.8" },
            { label: "Ca — Calcio",   val: ca, set: setCa, id: "ca", ph: "ej. 1.2" },
            { label: "Mg — Magnesio", val: mg, set: setMg, id: "mg", ph: "ej. 0.3" },
            { label: "S — Azufre",   val: s,  set: setS,  id: "s",  ph: "ej. 0.2" },
          ].map(f => (
            <div key={f.id} className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">{f.label}</Label>
              <Input type="number" placeholder={f.ph} step="0.001" min={0}
                value={f.val} onChange={e => f.set(e.target.value)} data-testid={`input-tej-${f.id}`} />
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-sm font-medium mb-2">Micronutrientes (ppm)</p>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Fe — Hierro",    val: fe, set: setFe, id: "fe", ph: "ej. 120" },
            { label: "Zn — Zinc",      val: zn, set: setZn, id: "zn", ph: "ej. 25"  },
            { label: "Mn — Manganeso", val: mn, set: setMn, id: "mn", ph: "ej. 80"  },
            { label: "Cu — Cobre",     val: cu, set: setCu, id: "cu", ph: "ej. 8"   },
            { label: "B — Boro",       val: b,  set: setB,  id: "b",  ph: "ej. 35"  },
          ].map(f => (
            <div key={f.id} className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">{f.label}</Label>
              <Input type="number" placeholder={f.ph} step="0.01" min={0}
                value={f.val} onChange={e => f.set(e.target.value)} data-testid={`input-tej-${f.id}`} />
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Observaciones (opcional)</Label>
        <Textarea placeholder="Síntomas visibles, condiciones del cultivo, tipo de análisis..."
          value={notes} onChange={e => setNotes(e.target.value)} rows={2} data-testid="textarea-tej-notes" />
      </div>
    </div>
  );
}

// ── Paso opcional: Análisis de Agua ────────────────────────────────────────
function AguaStepContent({
  analysisDate, setAnalysisDate,
  source, setSource, labName, setLabName,
  ph, setPh, ec, setEc, tds, setTds,
  sar, setSar, rsc, setRsc,
  na, setNa, ca, setCa, mg, setMg,
  hco3, setHco3, cl, setCl, so4, setSo4,
  no3, setNo3, b, setB,
  notes, setNotes,
}: {
  analysisDate: string; setAnalysisDate: (v: string) => void;
  source: string; setSource: (v: string) => void;
  labName: string; setLabName: (v: string) => void;
  ph: string; setPh: (v: string) => void;
  ec: string; setEc: (v: string) => void;
  tds: string; setTds: (v: string) => void;
  sar: string; setSar: (v: string) => void;
  rsc: string; setRsc: (v: string) => void;
  na: string; setNa: (v: string) => void;
  ca: string; setCa: (v: string) => void;
  mg: string; setMg: (v: string) => void;
  hco3: string; setHco3: (v: string) => void;
  cl: string; setCl: (v: string) => void;
  so4: string; setSo4: (v: string) => void;
  no3: string; setNo3: (v: string) => void;
  b: string; setB: (v: string) => void;
  notes: string; setNotes: (v: string) => void;
}) {
  const phVal = parseFloat(ph) || 0;
  const ecVal = parseFloat(ec) || 0;
  const sarVal = parseFloat(sar) || 0;

  const phClass = phVal > 0
    ? phVal < 6.5 ? "text-amber-600" : phVal > 8.0 ? "text-red-600" : "text-green-600"
    : "";
  const ecClass = ecVal > 0
    ? ecVal > 3 ? "text-red-600" : ecVal > 0.75 ? "text-amber-600" : "text-green-600"
    : "";
  const sarClass = sarVal > 0
    ? sarVal > 18 ? "text-red-600" : sarVal > 9 ? "text-amber-600" : "text-green-600"
    : "";

  return (
    <div className="space-y-4">
      <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg text-xs text-blue-700 dark:text-blue-300">
        Ingresa los parámetros del análisis de agua de riego. Se alertará si la CE o el RAS superan los rangos recomendados para cultivos.
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Fecha del análisis</Label>
          <Input type="date" value={analysisDate} onChange={e => setAnalysisDate(e.target.value)} data-testid="input-agua-date" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Fuente de agua</Label>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger data-testid="select-agua-source"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pozo">Pozo profundo</SelectItem>
              <SelectItem value="rio">Río / canal</SelectItem>
              <SelectItem value="presa">Presa / lago</SelectItem>
              <SelectItem value="red">Red municipal</SelectItem>
              <SelectItem value="lluvia">Captación de lluvia</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Laboratorio</Label>
        <Input placeholder="Nombre del laboratorio"
          value={labName} onChange={e => setLabName(e.target.value)} data-testid="input-agua-lab" />
      </div>

      <div>
        <p className="text-sm font-medium mb-2">Parámetros generales</p>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">pH</Label>
            <div className="relative">
              <Input type="number" placeholder="ej. 7.2" step="0.01" min={0} max={14}
                value={ph} onChange={e => setPh(e.target.value)} data-testid="input-agua-ph" />
              {ph && <span className={`absolute right-2 top-2 text-xs font-bold ${phClass}`}>{phVal.toFixed(1)}</span>}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">CE (dS/m)</Label>
            <div className="relative">
              <Input type="number" placeholder="ej. 0.8" step="0.01" min={0}
                value={ec} onChange={e => setEc(e.target.value)} data-testid="input-agua-ec" />
              {ec && <span className={`absolute right-2 top-2 text-xs font-bold ${ecClass}`}>{ecVal.toFixed(2)}</span>}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">TDS (mg/L)</Label>
            <Input type="number" placeholder="ej. 512" min={0}
              value={tds} onChange={e => setTds(e.target.value)} data-testid="input-agua-tds" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">RAS (SAR)</Label>
            <div className="relative">
              <Input type="number" placeholder="ej. 5" step="0.01" min={0}
                value={sar} onChange={e => setSar(e.target.value)} data-testid="input-agua-sar" />
              {sar && <span className={`absolute right-2 top-2 text-xs font-bold ${sarClass}`}>{sarVal.toFixed(1)}</span>}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">RSC (meq/L)</Label>
            <Input type="number" placeholder="ej. 1.2" step="0.01"
              value={rsc} onChange={e => setRsc(e.target.value)} data-testid="input-agua-rsc" />
          </div>
        </div>
        {(ph || ec || sar) && (
          <div className="mt-2 flex gap-3 text-xs">
            {ph && <span className={phClass}>pH: {phVal < 6.5 ? "Ácido ⚠" : phVal > 8.0 ? "Alcalino ⚠" : "OK ✓"}</span>}
            {ec && <span className={ecClass}>CE: {ecVal > 3 ? "Alta salinidad ⚠" : ecVal > 0.75 ? "Moderada" : "Apta ✓"}</span>}
            {sar && <span className={sarClass}>RAS: {sarVal > 18 ? "Riesgo sódico alto ⚠" : sarVal > 9 ? "Moderado" : "Bajo ✓"}</span>}
          </div>
        )}
      </div>

      <div>
        <p className="text-sm font-medium mb-2">Cationes y aniones (mg/L)</p>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Na — Sodio",       val: na,   set: setNa,   id: "na",   ph: "ej. 120" },
            { label: "Ca — Calcio",      val: ca,   set: setCa,   id: "ca",   ph: "ej. 80"  },
            { label: "Mg — Magnesio",    val: mg,   set: setMg,   id: "mg",   ph: "ej. 24"  },
            { label: "HCO₃ — Bicarb.",  val: hco3, set: setHco3, id: "hco3", ph: "ej. 250" },
            { label: "Cl — Cloruros",    val: cl,   set: setCl,   id: "cl",   ph: "ej. 150" },
            { label: "SO₄ — Sulfatos",   val: so4,  set: setSo4,  id: "so4",  ph: "ej. 90"  },
            { label: "NO₃ — Nitratos",   val: no3,  set: setNo3,  id: "no3",  ph: "ej. 10"  },
            { label: "B — Boro (mg/L)",  val: b,    set: setB,    id: "b",    ph: "ej. 0.5" },
          ].map(f => (
            <div key={f.id} className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">{f.label}</Label>
              <Input type="number" placeholder={f.ph} step="0.01" min={0}
                value={f.val} onChange={e => f.set(e.target.value)} data-testid={`input-agua-${f.id}`} />
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Observaciones (opcional)</Label>
        <Textarea placeholder="Color, turbidez, olor, periodicidad del análisis..."
          value={notes} onChange={e => setNotes(e.target.value)} rows={2} data-testid="textarea-agua-notes" />
      </div>
    </div>
  );
}

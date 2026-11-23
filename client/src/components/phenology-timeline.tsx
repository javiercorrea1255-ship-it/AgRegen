import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, Camera, Thermometer, Droplets, BarChart3, CheckCircle2, Circle, Clock, ChevronDown, ChevronUp, Sprout, Leaf, Flower2, Apple, Wheat, Tractor, ArrowRight, RefreshCw, Check, ClipboardList } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { es } from "date-fns/locale";

// ── Stage configuration ─────────────────────────────────────────────────────
type StageKey = "siembra" | "germinacion" | "crecimiento" | "floracion" | "fructificacion" | "cosecha";

interface StageConfig {
  key: StageKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bgColor: string;
  borderColor: string;
  activeBg: string;
  description: string;
}

const STAGE_CONFIG: StageConfig[] = [
  {
    key: "siembra",
    label: "Siembra",
    icon: Tractor,
    color: "text-amber-700",
    bgColor: "bg-amber-50",
    borderColor: "border-amber-300",
    activeBg: "bg-amber-100",
    description: "Preparación del suelo y colocación de semillas.",
  },
  {
    key: "germinacion",
    label: "Germinación",
    icon: Sprout,
    color: "text-lime-700",
    bgColor: "bg-lime-50",
    borderColor: "border-lime-300",
    activeBg: "bg-lime-100",
    description: "Emergencia de la semilla y establecimiento de plántulas.",
  },
  {
    key: "crecimiento",
    label: "Crecimiento",
    icon: Leaf,
    color: "text-green-700",
    bgColor: "bg-green-50",
    borderColor: "border-green-300",
    activeBg: "bg-green-100",
    description: "Desarrollo vegetativo activo, expansión de biomasa.",
  },
  {
    key: "floracion",
    label: "Floración",
    icon: Flower2,
    color: "text-pink-700",
    bgColor: "bg-pink-50",
    borderColor: "border-pink-300",
    activeBg: "bg-pink-100",
    description: "Apertura de flores, polinización y cuaje de frutos.",
  },
  {
    key: "fructificacion",
    label: "Fructificación",
    icon: Apple,
    color: "text-orange-700",
    bgColor: "bg-orange-50",
    borderColor: "border-orange-300",
    activeBg: "bg-orange-100",
    description: "Llenado y maduración de granos o frutos.",
  },
  {
    key: "cosecha",
    label: "Cosecha",
    icon: Wheat,
    color: "text-yellow-700",
    bgColor: "bg-yellow-50",
    borderColor: "border-yellow-300",
    activeBg: "bg-yellow-100",
    description: "Recolección del cultivo y fin del ciclo.",
  },
];

const STAGE_ORDER: StageKey[] = ["siembra", "germinacion", "crecimiento", "floracion", "fructificacion", "cosecha"];

// Maps prompt stage names (from phenology_prompts table) to timeline StageKeys.
// Multiple prompt stages can map to the same StageKey.
const STAGE_PROMPT_NAMES: Record<StageKey, string[]> = {
  siembra:        [],
  germinacion:    ["Germinación"],
  crecimiento:    ["Crecimiento Vegetativo", "Crecimiento", "Macollaje", "Encañado"],
  floracion:      ["Floración", "Espigado"],
  fructificacion: ["Llenado de Grano", "Máximo Desarrollo"],
  cosecha:        ["Madurez", "Senescencia"],
};

// Maps calculated stage names (returned by getCurrentStage / NDVI curve) → StageKey
const CALCULATED_STAGE_TO_KEY: Record<string, StageKey> = {
  "Germinación":          "germinacion",
  "Crecimiento Vegetativo": "crecimiento",
  "Crecimiento":          "crecimiento",
  "Macollaje":            "crecimiento",
  "Encañado":             "crecimiento",
  "Floración":            "floracion",
  "Espigado":             "floracion",
  "Llenado de Grano":     "fructificacion",
  "Máximo Desarrollo":    "fructificacion",
  "Senescencia":          "cosecha",
  "Madurez":              "cosecha",
};

// ── Types ───────────────────────────────────────────────────────────────────
interface StageObservation {
  id: string;
  parcelId: string;
  stage: string;
  observedAt: string;
  notes: string | null;
  avgTemperature: string | null;
  precipitationMm: string | null;
  ndviObserved: string | null;
  photoUrl: string | null;
  createdAt: string;
}

interface PhenologyPrompt {
  id: string;
  parcelId: string;
  stage: string;
  promptText: string;
  isCompleted: boolean;
  dueDate: string | null;
  completedAt: string | null;
}

interface GroupedResponse {
  grouped: true;
  stages: Record<string, StageObservation[]>;
  total: number;
}

interface Props {
  parcelId: string;
  currentStage?: string | null;
  calculatedStage?: string | null;
  plantingDate?: string | null;
  crop?: string | null;
  onAdvanceStage?: (stage: StageKey) => void;
  canEdit?: boolean;
}

// ── Observation card ─────────────────────────────────────────────────────────
function ObservationCard({
  obs,
  onDelete,
  canEdit,
}: {
  obs: StageObservation;
  onDelete: () => void;
  canEdit: boolean;
}) {
  return (
    <div className="rounded-lg border bg-background p-3 space-y-2 text-sm" data-testid={`observation-card-${obs.id}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">
          {format(new Date(obs.observedAt), "d 'de' MMMM yyyy", { locale: es })}
        </span>
        {canEdit && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-destructive hover:text-destructive"
            onClick={onDelete}
            data-testid={`btn-delete-obs-${obs.id}`}
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        )}
      </div>
      {(obs.avgTemperature || obs.precipitationMm || obs.ndviObserved) && (
        <div className="flex flex-wrap gap-3">
          {obs.avgTemperature && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <Thermometer className="w-3 h-3" />
              <span>{parseFloat(obs.avgTemperature).toFixed(1)} °C</span>
            </div>
          )}
          {obs.precipitationMm && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <Droplets className="w-3 h-3" />
              <span>{parseFloat(obs.precipitationMm).toFixed(0)} mm</span>
            </div>
          )}
          {obs.ndviObserved && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <BarChart3 className="w-3 h-3" />
              <span>NDVI {parseFloat(obs.ndviObserved).toFixed(3)}</span>
            </div>
          )}
        </div>
      )}
      {obs.notes && <p className="text-foreground leading-relaxed">{obs.notes}</p>}
      {obs.photoUrl && (
        <a href={obs.photoUrl} target="_blank" rel="noopener noreferrer" className="block">
          <img
            src={obs.photoUrl}
            alt="Foto de campo"
            className="rounded-md max-h-40 object-cover border w-full"
            data-testid={`obs-photo-${obs.id}`}
          />
        </a>
      )}
    </div>
  );
}

// ── Prompt checklist for a stage ─────────────────────────────────────────────
function PromptChecklist({
  prompts,
  onComplete,
  canEdit,
}: {
  prompts: PhenologyPrompt[];
  onComplete: (id: string) => void;
  canEdit: boolean;
}) {
  if (prompts.length === 0) return null;
  return (
    <div className="space-y-1.5" data-testid="prompt-checklist">
      <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
        <ClipboardList className="w-3 h-3" /> Tareas de esta etapa
      </p>
      {prompts.map((p) => (
        <div
          key={p.id}
          className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-xs ${
            p.isCompleted ? "bg-green-50 border border-green-200" : "bg-muted/40 border border-border"
          }`}
          data-testid={`prompt-item-${p.id}`}
        >
          {canEdit && !p.isCompleted ? (
            <button
              type="button"
              onClick={() => onComplete(p.id)}
              className="shrink-0 w-4 h-4 mt-0.5 rounded-full border-2 border-primary hover:bg-primary/10 transition-colors"
              data-testid={`btn-complete-prompt-${p.id}`}
              title="Marcar como completada"
            />
          ) : (
            <CheckCircle2 className={`w-4 h-4 shrink-0 mt-0.5 ${p.isCompleted ? "text-green-600" : "text-muted-foreground/30"}`} />
          )}
          <span className={`leading-relaxed ${p.isCompleted ? "line-through text-muted-foreground" : "text-foreground"}`}>
            {p.promptText}
          </span>
          {p.dueDate && !p.isCompleted && (
            <span className="ml-auto shrink-0 text-muted-foreground">
              {format(new Date(p.dueDate), "d MMM", { locale: es })}
            </span>
          )}
          {p.isCompleted && (
            <Check className="w-3 h-3 shrink-0 ml-auto text-green-600 mt-0.5" />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Add Observation Dialog ───────────────────────────────────────────────────
function AddObservationDialog({
  open,
  onClose,
  parcelId,
  stage,
}: {
  open: boolean;
  onClose: () => void;
  parcelId: string;
  stage: StageKey;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [notes, setNotes] = useState("");
  const [avgTemperature, setAvgTemperature] = useState("");
  const [precipitationMm, setPrecipitationMm] = useState("");
  const [ndviObserved, setNdviObserved] = useState("");
  const [observedAt, setObservedAt] = useState(format(new Date(), "yyyy-MM-dd"));
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  const stageCfg = STAGE_CONFIG.find((s) => s.key === stage)!;

  const mutation = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("stage", stage);
      fd.append("parcelId", parcelId);
      fd.append("observedAt", `${observedAt}T12:00:00.000Z`);
      if (notes.trim()) fd.append("notes", notes.trim());
      if (avgTemperature) fd.append("avgTemperature", avgTemperature);
      if (precipitationMm) fd.append("precipitationMm", precipitationMm);
      if (ndviObserved) fd.append("ndviObserved", ndviObserved);
      if (photo) fd.append("photo", photo);
      const res = await fetch(`/api/parcels/${parcelId}/stage-observations`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).message || "Error al guardar");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stage-observations", parcelId] });
      toast({ title: "Observación guardada", description: `Etapa ${stageCfg.label} registrada.` });
      handleClose();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function handleClose() {
    setNotes(""); setAvgTemperature(""); setPrecipitationMm(""); setNdviObserved("");
    setObservedAt(format(new Date(), "yyyy-MM-dd"));
    setPhoto(null); setPhotoPreview(null);
    onClose();
  }

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhoto(file);
    const reader = new FileReader();
    reader.onloadend = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(file);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <stageCfg.icon className={`w-5 h-5 ${stageCfg.color}`} />
            Observación — {stageCfg.label}
          </DialogTitle>
          <DialogDescription>Registra condiciones de campo, métricas y una foto opcional.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="obs-date">Fecha de observación</Label>
            <Input id="obs-date" type="date" value={observedAt} onChange={(e) => setObservedAt(e.target.value)} data-testid="input-obs-date" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="obs-temp" className="text-xs flex items-center gap-1"><Thermometer className="w-3 h-3" /> Temp. (°C)</Label>
              <Input id="obs-temp" type="number" placeholder="22.5" value={avgTemperature} onChange={(e) => setAvgTemperature(e.target.value)} data-testid="input-obs-temp" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="obs-precip" className="text-xs flex items-center gap-1"><Droplets className="w-3 h-3" /> Lluvia (mm)</Label>
              <Input id="obs-precip" type="number" placeholder="15" value={precipitationMm} onChange={(e) => setPrecipitationMm(e.target.value)} data-testid="input-obs-precip" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="obs-ndvi" className="text-xs flex items-center gap-1"><BarChart3 className="w-3 h-3" /> NDVI campo</Label>
              <Input id="obs-ndvi" type="number" step="0.001" placeholder="0.65" min="-1" max="1" value={ndviObserved} onChange={(e) => setNdviObserved(e.target.value)} data-testid="input-obs-ndvi" />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="obs-notes">Notas de campo</Label>
            <Textarea id="obs-notes" placeholder="Estado del cultivo, plagas detectadas, intervenciones..." value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} data-testid="textarea-obs-notes" />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground flex items-center gap-1"><Camera className="w-3 h-3" /> Foto de campo (opcional, máx. 5 MB)</Label>
            {photoPreview ? (
              <div className="relative">
                <img src={photoPreview} alt="Preview" className="rounded-md max-h-40 object-cover border w-full" />
                <Button type="button" variant="destructive" size="icon" className="absolute top-1 right-1 h-6 w-6"
                  onClick={() => { setPhoto(null); setPhotoPreview(null); if (fileRef.current) fileRef.current.value = ""; }}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            ) : (
              <Button type="button" variant="outline" className="w-full border-dashed" onClick={() => fileRef.current?.click()} data-testid="btn-upload-photo">
                <Camera className="w-4 h-4 mr-2" /> Subir foto
              </Button>
            )}
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handlePhotoChange} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={mutation.isPending}>Cancelar</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} data-testid="btn-save-observation">
            {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Guardar observación
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Stage Detail Panel (shown in expanded view) ──────────────────────────────
function StageDetailPanel({
  config,
  status,
  observations,
  prompts,
  parcelId,
  onDelete,
  onAdvance,
  onCompletePrompt,
  canEdit,
  isLast,
}: {
  config: StageConfig;
  status: "completed" | "active" | "pending";
  observations: StageObservation[];
  prompts: PhenologyPrompt[];
  parcelId: string;
  onDelete: (id: string) => void;
  onAdvance: () => void;
  onCompletePrompt: (id: string) => void;
  canEdit: boolean;
  isLast: boolean;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const Icon = config.icon;

  const pendingPrompts = prompts.filter((p) => !p.isCompleted).length;

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${
      status === "active" ? `${config.borderColor} ${config.activeBg}` :
      status === "completed" ? "border-green-200 bg-green-50/30" :
      "border-border bg-muted/20 opacity-70"
    }`} data-testid={`stage-detail-${config.key}`}>
      <div className="flex items-center gap-2">
        <div className={`p-1.5 rounded-full ${config.bgColor}`}>
          <Icon className={`w-4 h-4 ${config.color}`} />
        </div>
        <span className="font-semibold text-sm">{config.label}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {pendingPrompts > 0 && (
            <Badge variant="outline" className="text-xs border-amber-300 text-amber-700 bg-amber-50">
              {pendingPrompts} tarea{pendingPrompts > 1 ? "s" : ""}
            </Badge>
          )}
          {observations.length > 0 && (
            <Badge variant="secondary" className="text-xs">{observations.length}</Badge>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">{config.description}</p>

      {/* Prompt checklist */}
      {prompts.length > 0 && (
        <PromptChecklist prompts={prompts} onComplete={onCompletePrompt} canEdit={canEdit} />
      )}

      {/* Observations */}
      {observations.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">Sin observaciones.</p>
      ) : (
        <div className="space-y-2">
          {observations.map((obs) => (
            <ObservationCard key={obs.id} obs={obs} onDelete={() => onDelete(obs.id)} canEdit={canEdit} />
          ))}
        </div>
      )}

      {canEdit && (status === "active" || status === "completed") && (
        <div className="flex flex-col gap-2">
          <Button size="sm" variant="outline" className={`border-dashed ${config.borderColor} w-full`} onClick={() => setAddOpen(true)} data-testid={`btn-add-obs-${config.key}`}>
            <Plus className="w-3 h-3 mr-1" /> Agregar observación
          </Button>
          {status === "active" && !isLast && (
            <Button size="sm" className="w-full" onClick={onAdvance} data-testid={`btn-advance-${config.key}`}>
              Avanzar etapa <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          )}
        </div>
      )}
      {canEdit && status === "pending" && (
        <Button size="sm" variant="ghost" className="text-muted-foreground border-dashed border w-full" onClick={() => setAddOpen(true)} data-testid={`btn-add-obs-pending-${config.key}`}>
          <Plus className="w-3 h-3 mr-1" /> Registrar por adelantado
        </Button>
      )}

      <AddObservationDialog open={addOpen} onClose={() => setAddOpen(false)} parcelId={parcelId} stage={config.key} />
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export function PhenologyTimeline({
  parcelId,
  currentStage,
  calculatedStage,
  plantingDate,
  crop,
  onAdvanceStage,
  canEdit = false,
}: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedStageIdx, setSelectedStageIdx] = useState<number | null>(null);
  const [mobileAddStage, setMobileAddStage] = useState<StageKey | null>(null);

  const { data: groupedData, isLoading } = useQuery<GroupedResponse>({
    queryKey: ["stage-observations", parcelId],
    queryFn: async () => {
      const res = await fetch(`/api/parcels/${parcelId}/stage-observations`, { credentials: "include" });
      if (!res.ok) throw new Error("Error al cargar observaciones");
      return res.json();
    },
  });

  const { data: promptsData } = useQuery<{ prompts: PhenologyPrompt[] }>({
    queryKey: ["phenology-prompts", parcelId],
    queryFn: async () => {
      const res = await fetch(`/api/parcels/${parcelId}/phenology-prompts`, { credentials: "include" });
      if (!res.ok) return { prompts: [] };
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (obsId: string) => {
      const res = await fetch(`/api/parcels/${parcelId}/stage-observations/${obsId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).message || "Error al eliminar");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stage-observations", parcelId] });
      toast({ title: "Observación eliminada" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const completePromptMutation = useMutation({
    mutationFn: async (promptId: string) => {
      const res = await fetch(`/api/parcels/${parcelId}/prompts/${promptId}/complete`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).message || "Error al completar tarea");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["phenology-prompts", parcelId] });
      toast({ title: "Tarea completada" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const currentStageKey = (currentStage || "siembra") as StageKey;
  const currentIdx = STAGE_ORDER.indexOf(currentStageKey);
  const obsByStage = groupedData?.stages ?? {};
  const allPrompts: PhenologyPrompt[] = promptsData?.prompts ?? [];

  // Group prompts by timeline StageKey using the name→key mapping
  const promptsByStage: Record<StageKey, PhenologyPrompt[]> = {
    siembra: [], germinacion: [], crecimiento: [],
    floracion: [], fructificacion: [], cosecha: [],
  };
  for (const prompt of allPrompts) {
    for (const [stageKey, names] of Object.entries(STAGE_PROMPT_NAMES) as [StageKey, string[]][]) {
      if (names.includes(prompt.stage)) {
        promptsByStage[stageKey].push(prompt);
        break;
      }
    }
  }

  // Detect mismatch between manual stage and satellite-calculated stage
  const calculatedStageKey = calculatedStage ? CALCULATED_STAGE_TO_KEY[calculatedStage] : null;
  const stagesMismatch = calculatedStageKey && calculatedStageKey !== currentStageKey;

  // Auto-expand current stage on first load
  const effectiveSelected = selectedStageIdx ?? currentIdx;

  function getStatus(idx: number): "completed" | "active" | "pending" {
    if (idx < currentIdx) return "completed";
    if (idx === currentIdx) return "active";
    return "pending";
  }

  const allObs = Object.values(obsByStage).flat();
  const pendingPromptsTotal = allPrompts.filter((p) => !p.isCompleted).length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="text-base">Línea de tiempo fenológica</CardTitle>
              <CardDescription>
                {crop ? `Cultivo: ${crop}` : "Cultivo no configurado"}
                {plantingDate ? ` · Siembra: ${format(new Date(plantingDate), "d MMM yyyy", { locale: es })}` : ""}
                {pendingPromptsTotal > 0 && ` · ${pendingPromptsTotal} tarea${pendingPromptsTotal > 1 ? "s" : ""} pendiente${pendingPromptsTotal > 1 ? "s" : ""}`}
              </CardDescription>
            </div>
            {currentStage && (
              <Badge className="bg-primary text-primary-foreground text-sm px-3 py-1">
                {STAGE_CONFIG.find((s) => s.key === currentStageKey)?.label ?? currentStage}
              </Badge>
            )}
          </div>
        </CardHeader>

        {/* Stage mismatch warning + sync button */}
        {stagesMismatch && canEdit && calculatedStageKey && (
          <CardContent className="pt-0">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm" data-testid="stage-mismatch-banner">
              <div className="flex-1 text-blue-800">
                <span className="font-medium">Etapa registrada:</span>{" "}
                <span>{STAGE_CONFIG.find((s) => s.key === currentStageKey)?.label ?? currentStageKey}</span>
                <span className="mx-2 text-blue-400">·</span>
                <span className="font-medium">Satélite calcula:</span>{" "}
                <span>{calculatedStage}</span>
              </div>
              {onAdvanceStage && (
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 border-blue-300 text-blue-700 hover:bg-blue-100"
                  onClick={() => onAdvanceStage(calculatedStageKey)}
                  data-testid="btn-sync-stage"
                >
                  <RefreshCw className="w-3 h-3 mr-1.5" />
                  Sincronizar etapa
                </Button>
              )}
            </div>
          </CardContent>
        )}

        {!plantingDate && (
          <CardContent className="pt-0">
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              Configura la fecha de siembra para activar el seguimiento temporal.
            </p>
          </CardContent>
        )}
      </Card>

      {/* ── Desktop: horizontal node rail (md+) ── */}
      <div className="hidden md:block" data-testid="timeline-desktop">
        {/* Node rail */}
        <div className="relative flex items-start">
          {STAGE_CONFIG.map((cfg, idx) => {
            const status = getStatus(idx);
            const Icon = cfg.icon;
            const obsCount = obsByStage[cfg.key]?.length ?? 0;
            const promptPending = promptsByStage[cfg.key].filter((p) => !p.isCompleted).length;
            const isSelected = effectiveSelected === idx;

            return (
              <div key={cfg.key} className="flex-1 flex flex-col items-center relative" data-testid={`stage-node-${cfg.key}`}>
                {/* Connector line left */}
                {idx > 0 && (
                  <div className={`absolute top-5 right-1/2 w-full h-0.5 ${
                    getStatus(idx - 1) === "completed" ? "bg-green-400" : "bg-muted-foreground/20"
                  }`} style={{ left: "-50%" }} />
                )}

                {/* Node button */}
                <button
                  type="button"
                  onClick={() => setSelectedStageIdx(isSelected ? null : idx)}
                  className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    status === "completed"
                      ? "bg-green-100 border-green-400 hover:bg-green-200"
                      : status === "active"
                      ? `${cfg.activeBg} ${cfg.borderColor} hover:brightness-95 ring-2 ring-primary/30`
                      : "bg-muted border-muted-foreground/30 hover:border-muted-foreground/60"
                  } ${isSelected ? "ring-2 ring-primary shadow-md" : ""}`}
                  data-testid={`btn-node-${cfg.key}`}
                >
                  {status === "completed" ? (
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                  ) : status === "active" ? (
                    <Icon className={`w-5 h-5 ${cfg.color}`} />
                  ) : (
                    <Icon className="w-5 h-5 text-muted-foreground/40" />
                  )}
                  {/* Badge: show obs count or pending prompts */}
                  {(obsCount > 0 || promptPending > 0) && (
                    <span className={`absolute -top-1 -right-1 text-primary-foreground text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center ${
                      promptPending > 0 ? "bg-amber-500" : "bg-primary"
                    }`}>
                      {promptPending > 0 ? promptPending : obsCount}
                    </span>
                  )}
                </button>

                {/* Label below node */}
                <div className="mt-2 text-center px-1">
                  <p className={`text-xs font-semibold leading-tight ${
                    status === "pending" ? "text-muted-foreground/50" : "text-foreground"
                  }`}>
                    {cfg.label}
                  </p>
                  {status === "active" && (
                    <p className="text-[10px] text-primary mt-0.5">En curso</p>
                  )}
                  {status === "completed" && (
                    <p className="text-[10px] text-green-600 mt-0.5">✓</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Expanded panel below rail */}
        {effectiveSelected !== null && (
          <div className="mt-6">
            <StageDetailPanel
              config={STAGE_CONFIG[effectiveSelected]}
              status={getStatus(effectiveSelected)}
              observations={obsByStage[STAGE_CONFIG[effectiveSelected].key] ?? []}
              prompts={promptsByStage[STAGE_CONFIG[effectiveSelected].key]}
              parcelId={parcelId}
              onDelete={(id) => deleteMutation.mutate(id)}
              onAdvance={() => {
                const next = STAGE_CONFIG[effectiveSelected + 1];
                if (next && onAdvanceStage) onAdvanceStage(next.key);
              }}
              onCompletePrompt={(id) => completePromptMutation.mutate(id)}
              canEdit={canEdit}
              isLast={effectiveSelected === STAGE_CONFIG.length - 1}
            />
          </div>
        )}
      </div>

      {/* ── Mobile: vertical accordion stack ── */}
      <div className="md:hidden space-y-2" data-testid="timeline-mobile">
        {STAGE_CONFIG.map((cfg, idx) => {
          const status = getStatus(idx);
          const Icon = cfg.icon;
          const observations = obsByStage[cfg.key] ?? [];
          const stagePrompts = promptsByStage[cfg.key];
          const isExpanded = effectiveSelected === idx;
          const isLast = idx === STAGE_CONFIG.length - 1;
          const promptPending = stagePrompts.filter((p) => !p.isCompleted).length;

          const statusIcon =
            status === "completed" ? <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" /> :
            status === "active" ? <Clock className="w-5 h-5 text-primary shrink-0 animate-pulse" /> :
            <Circle className="w-5 h-5 text-muted-foreground/30 shrink-0" />;

          return (
            <div key={cfg.key} className="relative" data-testid={`stage-row-${cfg.key}`}>
              {!isLast && (
                <div className={`absolute left-[19px] top-[44px] w-0.5 z-0 ${
                  status === "completed" ? "bg-green-300" : "bg-muted-foreground/20"
                }`} style={{ height: "calc(100% + 8px)" }} />
              )}
              <div className={`relative z-10 rounded-xl border transition-all ${
                status === "active" ? `${cfg.borderColor} ${cfg.activeBg} shadow-sm` :
                status === "completed" ? "border-green-200 bg-green-50/30" :
                "border-border bg-background opacity-70"
              }`}>
                <button
                  type="button"
                  className="w-full flex items-center gap-3 p-3 text-left"
                  onClick={() => setSelectedStageIdx(isExpanded ? null : idx)}
                  data-testid={`btn-expand-stage-${cfg.key}`}
                >
                  {statusIcon}
                  <div className={`p-1.5 rounded-full ${cfg.bgColor}`}>
                    <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`font-semibold text-sm ${status === "pending" ? "text-muted-foreground" : ""}`}>
                        {cfg.label}
                      </span>
                      {promptPending > 0 && (
                        <Badge variant="outline" className="text-xs border-amber-300 text-amber-700 bg-amber-50">{promptPending}</Badge>
                      )}
                      {observations.length > 0 && (
                        <Badge variant="secondary" className="text-xs">{observations.length}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{cfg.description}</p>
                  </div>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
                </button>

                {isExpanded && (
                  <div className="px-3 pb-3 border-t border-inherit pt-3 space-y-3">
                    {/* Prompts checklist */}
                    {stagePrompts.length > 0 && (
                      <PromptChecklist prompts={stagePrompts} onComplete={(id) => completePromptMutation.mutate(id)} canEdit={canEdit} />
                    )}
                    {observations.length === 0 ? (
                      <p className="text-sm text-muted-foreground italic">Sin observaciones registradas.</p>
                    ) : (
                      <div className="space-y-2">
                        {observations.map((obs) => (
                          <ObservationCard key={obs.id} obs={obs} onDelete={() => deleteMutation.mutate(obs.id)} canEdit={canEdit} />
                        ))}
                      </div>
                    )}
                    {canEdit && (status === "active" || status === "completed") && (
                      <div className="flex flex-col gap-2">
                        <Button size="sm" variant="outline" className={`border-dashed ${cfg.borderColor} w-full`}
                          onClick={() => setMobileAddStage(cfg.key)}
                          data-testid={`btn-add-obs-mobile-${cfg.key}`}>
                          <Plus className="w-3 h-3 mr-1" /> Agregar observación
                        </Button>
                        {status === "active" && !isLast && onAdvanceStage && (
                          <Button size="sm" className="w-full"
                            onClick={() => { const next = STAGE_CONFIG[idx + 1]; if (next) onAdvanceStage(next.key); }}
                            data-testid={`btn-advance-mobile-${cfg.key}`}>
                            Avanzar etapa <ArrowRight className="w-3 h-3 ml-1" />
                          </Button>
                        )}
                      </div>
                    )}
                    {canEdit && status === "pending" && (
                      <Button size="sm" variant="ghost" className="text-muted-foreground border-dashed border w-full"
                        onClick={() => setMobileAddStage(cfg.key)}
                        data-testid={`btn-add-obs-pending-mobile-${cfg.key}`}>
                        <Plus className="w-3 h-3 mr-1" /> Registrar por adelantado
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Mobile add observation dialog — shared across all stage rows */}
        {mobileAddStage && (
          <AddObservationDialog
            open={true}
            onClose={() => setMobileAddStage(null)}
            parcelId={parcelId}
            stage={mobileAddStage}
          />
        )}
      </div>

      {/* Summary stats */}
      {allObs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Resumen del ciclo</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-primary">{allObs.length}</div>
                <div className="text-xs text-muted-foreground">Observaciones</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-green-600">
                  {STAGE_ORDER.filter((_, i) => i < currentIdx).length}
                </div>
                <div className="text-xs text-muted-foreground">Etapas completadas</div>
              </div>
              {(() => {
                const temps = allObs.filter((o) => o.avgTemperature).map((o) => parseFloat(o.avgTemperature!));
                const avg = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null;
                return avg !== null ? (
                  <div>
                    <div className="text-2xl font-bold text-orange-600">{avg.toFixed(1)}°</div>
                    <div className="text-xs text-muted-foreground">Temp. media</div>
                  </div>
                ) : <div />;
              })()}
              {(() => {
                const ndvis = allObs.filter((o) => o.ndviObserved).map((o) => parseFloat(o.ndviObserved!));
                const avg = ndvis.length ? ndvis.reduce((a, b) => a + b, 0) / ndvis.length : null;
                return avg !== null ? (
                  <div>
                    <div className="text-2xl font-bold text-emerald-600">{avg.toFixed(3)}</div>
                    <div className="text-xs text-muted-foreground">NDVI promedio</div>
                  </div>
                ) : <div />;
              })()}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

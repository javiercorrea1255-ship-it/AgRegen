import { useEffect, useMemo, useRef, useState, type ReactNode, type Dispatch, type SetStateAction } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { soilHealthQueryKey, soilHealthQueryOptions } from "@/lib/soil-health-query";
import { soilHealthIndicators, soilHealthSummary, chronologicalSoilHealth, compareSoilHealth, SOIL_HEALTH_SOURCE, type SoilHealthAssessment, type SoilHealthInput, type SoilHealthList, type SoilHealthIndicatorId, type SoilHealthAnswers } from "@shared/soil-health";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Check, ChevronDown, ChevronUp, ClipboardCheck, FileImage, Loader2, Plus, Save, Trash2, Upload, X } from "lucide-react";

const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
const emptyInput = (): SoilHealthInput => ({
  assessmentDate: localToday(), responsible: "", crop: "", stage: "",
  area: "", moisture: "", recentWater: "", answers: {},
});
const answerLabel = (a: string) => a === "yes" ? "Sí" : a === "no" ? "No" : "No evaluado";
const dateLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });

export function SoilHealthSummary({ parcelId, userId, onOpen }: { parcelId: string; userId: string; onOpen?: () => void }) {
  const { data, isLoading, isError, refetch } = useQuery(soilHealthQueryOptions(userId, parcelId));
  const latest = data?.assessments ? chronologicalSoilHealth(data.assessments).at(-1) : undefined;
  const summary = latest ? soilHealthSummary(latest.answers) : null;
  return (
    <section className="rounded-xl border border-emerald-200 bg-[#f4f7ee] p-4 sm:p-5" data-testid="soil-health-summary">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="rounded-lg bg-emerald-100 p-2 text-emerald-800"><ClipboardCheck className="h-5 w-5" /></span>
          <div>
            <p className="font-semibold text-emerald-950">Evaluación de campo</p>
            {isLoading ? <div className="mt-2 h-4 w-44 animate-pulse rounded bg-emerald-100" /> :
              isError ? <p className="mt-1 text-sm text-rose-700">No se pudo cargar el resumen. <button className="underline" onClick={() => refetch()}>Reintentar</button></p> :
              latest && summary ? <p className="mt-1 text-sm text-emerald-900">
                Última visita · {dateLabel(latest.assessmentDate)} · {summary.fulfilled}/{summary.evaluated} cumplidos · {summary.unevaluated} sin evaluar · cobertura {summary.evaluated}/19 ({Math.round(summary.coverage * 100)}%)
              </p> : <p className="mt-1 text-sm text-emerald-900">Aún no hay visitas registradas.</p>}
          </div>
        </div>
        <Button size="sm" variant="outline" className="border-emerald-300 text-emerald-900 hover:bg-emerald-100" onClick={onOpen}>
          {latest ? "Ver evaluación" : "Iniciar evaluación"}
        </Button>
      </div>
    </section>
  );
}

type AssessmentProps = { parcelId: string; userId: string; onDirtyChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void };
export default function SoilHealthAssessment(props: AssessmentProps) {
  return <SoilHealthAssessmentSession key={`${props.userId}:${props.parcelId}`} {...props} />;
}
function SoilHealthAssessmentSession({ parcelId, userId, onDirtyChange, onBusyChange }: AssessmentProps) {
  const queryClient = useQueryClient();
  const url = `/api/parcels/${parcelId}/soil-health`;
  const queryKey = soilHealthQueryKey(userId, parcelId);
  const { data, isLoading, isError, refetch } = useQuery(soilHealthQueryOptions(userId, parcelId));
  const [draft, setDraft] = useState<SoilHealthInput | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [evidenceError, setEvidenceError] = useState("");
  const [uploading, setUploading] = useState<SoilHealthIndicatorId | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);
  useEffect(() => {
    if (!draft) return;
    const protectUnsaved = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectUnsaved);
    return () => window.removeEventListener("beforeunload", protectUnsaved);
  }, [draft]);
  const records = useMemo(() => chronologicalSoilHealth(data?.assessments ?? []), [data?.assessments]);
  const current = records.find(r => r.id === selected) ?? records.at(-1);
  const canEdit = data?.canEdit === true;
  const saving = useMutation({
    mutationFn: async ({ id, input }: { id: string | null; input: SoilHealthInput }) => {
      const res = await apiRequest(id ? "PUT" : "POST", id ? `${url}/${id}` : url, input);
      return res.json() as Promise<SoilHealthAssessment>;
    },
    onSuccess: async (record) => {
      await queryClient.invalidateQueries({ queryKey });
      setSelected(record.id); setDraft(null); setEditingId(null);
    },
  });
  const deleting = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `${url}/${id}`); },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      setSelected(null); setDraft(null); setEditingId(null);
    },
  });
  const removeEvidence = useMutation({
    mutationFn: async ({ assessmentId, evidenceId }: { assessmentId: string; evidenceId: string }) => {
      await apiRequest("DELETE", `${url}/${assessmentId}/evidence/${evidenceId}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (error) => setEvidenceError(error.message || "No se pudo eliminar la evidencia."),
  });
  const dirtyCallback = useRef(onDirtyChange);
  const busyCallback = useRef(onBusyChange);
  dirtyCallback.current = onDirtyChange;
  busyCallback.current = onBusyChange;
  const busy = saving.isPending || deleting.isPending || removeEvidence.isPending || uploading !== null;
  useEffect(() => { dirtyCallback.current?.(!!draft); }, [draft]);
  useEffect(() => { busyCallback.current?.(busy); }, [busy]);
  const mayReplaceDraft = () => {
    if (busy) return false;
    return !draft || window.confirm("Hay cambios sin guardar. ¿Descartarlos?");
  };
  const startNew = () => { if (!mayReplaceDraft()) return; setSelected(null); setEditingId(null); setDraft(emptyInput()); };
  const startEdit = (record: SoilHealthAssessment) => {
    if (!mayReplaceDraft()) return;
    setSelected(record.id); setEditingId(record.id);
    setDraft({ assessmentDate: record.assessmentDate, responsible: record.responsible, crop: record.crop, stage: record.stage, area: record.area, moisture: record.moisture, recentWater: record.recentWater, answers: structuredClone(record.answers) });
  };
  const cancelDraft = () => {
    if (busy) return;
    if (draft && !window.confirm("¿Descartar los cambios sin guardar?")) return;
    setDraft(null); setEditingId(null);
  };
  const uploadPhoto = async (record: SoilHealthAssessment, indicatorId: SoilHealthIndicatorId, file?: File) => {
    if (!file) return;
    setEvidenceError("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024) {
      setEvidenceError("Usa una foto JPEG, PNG o WEBP de máximo 8 MB."); return;
    }
    busyCallback.current?.(true);
    setUploading(indicatorId);
    setUploadProgress(0);
    try {
      const form = new FormData(); form.append("photo", file);
      await new Promise<void>((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open("POST", `${url}/${record.id}/evidence/${indicatorId}`);
        request.withCredentials = true;
        request.upload.onprogress = event => {
          if (event.lengthComputable) setUploadProgress(Math.round(event.loaded / event.total * 100));
        };
        request.onload = () => request.status >= 200 && request.status < 300 ? resolve() : reject(new Error(request.responseText || "No se pudo subir la evidencia."));
        request.onerror = () => reject(new Error("Error de conexión al subir la evidencia."));
        request.send(form);
      });
      await queryClient.invalidateQueries({ queryKey });
    } catch (e) { setEvidenceError(e instanceof Error ? e.message : "Error al subir la foto."); }
    finally { setUploading(null); }
  };
  const openPhoto = async (record: SoilHealthAssessment, evidenceId: string) => {
    setEvidenceError("");
    try {
      const response = await fetch(`${url}/${record.id}/evidence/${evidenceId}`, { credentials: "include" });
      if (!response.ok) throw new Error("No se pudo abrir la foto.");
      const blob = await response.blob();
      setViewingPhoto(URL.createObjectURL(blob));
    } catch (e) { setEvidenceError(e instanceof Error ? e.message : "No se pudo abrir la foto."); }
  };

  return (
    <div className="space-y-5" data-testid="soil-health-assessment">
      <header className="rounded-2xl bg-[#234a3a] p-5 text-[#f3f1df] sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#c7d5a9]">Suelo · seguimiento en campo</p>
            <h2 className="mt-2 text-2xl font-semibold">Salud del suelo</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#e0e8d6]">Registra lo que observas en cada visita. La primera evaluación queda como línea base para comparar las siguientes.</p>
          </div>
          {canEdit && <Button onClick={startNew} disabled={busy} className="shrink-0 bg-[#d2df9b] text-[#203e31] hover:bg-[#e1e9bb]"><Plus className="mr-2 h-4 w-4" /> Nueva visita</Button>}
        </div>
        <p className="mt-4 border-t border-white/20 pt-3 text-xs leading-relaxed text-[#dce5d3]">Esta herramienta organiza observaciones de campo; no calcula un índice científico ni reemplaza análisis de laboratorio o biología del suelo.</p>
      </header>

      {isLoading ? <div className="space-y-3 rounded-xl border bg-card p-5"><div className="h-5 w-48 animate-pulse rounded bg-muted" /><div className="h-20 animate-pulse rounded bg-muted" /><div className="h-20 animate-pulse rounded bg-muted" /></div> :
        isError ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900"><p>No fue posible cargar las evaluaciones.</p><Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>Reintentar</Button></div> : null}

      {!isLoading && !isError && records.length === 0 && !draft && <div className="rounded-xl border border-dashed border-emerald-300 bg-[#f7f8ef] px-5 py-10 text-center">
        <ClipboardCheck className="mx-auto h-9 w-9 text-emerald-700" /><h3 className="mt-3 font-semibold text-emerald-950">Sin visitas de campo</h3>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Comienza una evaluación para documentar observaciones de esta parcela. Las respuestas vacías permanecerán como no evaluadas.</p>
        {canEdit && <Button className="mt-4 bg-emerald-800 hover:bg-emerald-900" onClick={startNew}><Plus className="mr-2 h-4 w-4" /> Iniciar primera visita</Button>}
      </div>}
      {data && !canEdit && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Tienes acceso de consulta. Solo la persona propietaria o administración puede modificar evaluaciones.</p>}

      {draft && <AssessmentForm draft={draft} setDraft={setDraft} isSaving={saving.isPending} error={saving.isError ? (saving.error as Error).message : ""} onCancel={cancelDraft} onSave={() => {
        const answers = Object.fromEntries(soilHealthIndicators.map(i => [i.id, { answer: draft.answers[i.id]?.answer ?? "unevaluated", notes: draft.answers[i.id]?.notes ?? "" }])) as SoilHealthAnswers;
        busyCallback.current?.(true);
        saving.mutate({ id: editingId, input: { ...draft, answers } });
      }} />}

      {!isLoading && !isError && records.length > 0 && <div className="grid gap-4 lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="rounded-xl border bg-card p-3">
          <div className="flex items-center justify-between px-2 py-1"><h3 className="font-semibold">Visitas</h3><span className="text-xs text-muted-foreground">{records.length}</span></div>
          <div className="mt-2 space-y-1">{records.map((record, idx) => {
            const sum = soilHealthSummary(record.answers);
            const active = current?.id === record.id;
            return <button key={record.id} disabled={busy} onClick={() => { if (!mayReplaceDraft()) return; setSelected(record.id); setDraft(null); setEditingId(null); }} className={`w-full rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${active ? "border-emerald-600 bg-emerald-50" : "border-transparent hover:bg-muted/60"}`}>
              <span className="flex items-center justify-between gap-2"><span className="font-medium">{dateLabel(record.assessmentDate)}</span>{idx === 0 && <span className="rounded-full bg-[#e9ebd8] px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-900">Base</span>}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{sum.fulfilled}/{sum.evaluated} cumplidos · {sum.unevaluated} sin evaluar</span>
            </button>;
          })}</div>
        </aside>
        {current && <AssessmentDetail record={current} baseline={records[0]} canEdit={canEdit} busy={busy} onEdit={() => startEdit(current)} onDelete={() => {
          if (window.confirm(`¿Eliminar la evaluación del ${dateLabel(current.assessmentDate)}? Esta acción no se puede deshacer.`) && mayReplaceDraft()) {
            setDraft(null);
            busyCallback.current?.(true);
            deleting.mutate(current.id);
          }
        }} onPhoto={openPhoto} onRemoveEvidence={(id) => {
          if (window.confirm("¿Eliminar esta foto de evidencia?")) {
            busyCallback.current?.(true);
            removeEvidence.mutate({ assessmentId: current.id, evidenceId: id });
          }
        }} onUpload={uploadPhoto} uploading={uploading} uploadProgress={uploadProgress} evidenceError={evidenceError} deletePending={deleting.isPending} />}
      </div>}
      {saving.isError && !draft && <p role="alert" className="text-sm text-rose-700">{(saving.error as Error).message}</p>}
      {deleting.isError && <p role="alert" className="text-sm text-rose-700">{(deleting.error as Error).message || "No se pudo eliminar la evaluación."}</p>}
      {viewingPhoto && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => { URL.revokeObjectURL(viewingPhoto); setViewingPhoto(null); }}><button aria-label="Cerrar foto" className="absolute right-4 top-4 rounded-full bg-white p-2"><X className="h-5 w-5" /></button><img src={viewingPhoto} alt="Evidencia de campo" className="max-h-[90dvh] max-w-full rounded-lg object-contain" /></div>}
    </div>
  );
}

function AssessmentForm({ draft, setDraft, isSaving, error, onCancel, onSave }: { draft: SoilHealthInput; setDraft: Dispatch<SetStateAction<SoilHealthInput | null>>; isSaving: boolean; error: string; onCancel: () => void; onSave: () => void }) {
  const setField = (key: keyof SoilHealthInput, value: string) => setDraft(v => v ? ({ ...v, [key]: value }) : v);
  const incomplete = !draft.assessmentDate || !draft.responsible.trim();
  return <div className="rounded-xl border border-emerald-200 bg-card p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">Ficha de visita</p><h3 className="mt-1 text-xl font-semibold">{draft.responsible ? "Editar evaluación" : "Nueva evaluación"}</h3></div><span className="text-xs text-muted-foreground">Los criterios sin respuesta se guardan como No evaluado.</span></div>
    <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field id="assessment-date" label="Fecha de evaluación" required><Input id="assessment-date" type="date" value={draft.assessmentDate} disabled={isSaving} onChange={e => setField("assessmentDate", e.target.value)} /></Field>
      <Field id="assessment-responsible" label="Responsable" required><Input id="assessment-responsible" maxLength={200} value={draft.responsible} disabled={isSaving} onChange={e => setField("responsible", e.target.value)} placeholder="Nombre de quien observa" /></Field>
      <Field id="assessment-crop" label="Cultivo"><Input id="assessment-crop" maxLength={200} value={draft.crop} disabled={isSaving} onChange={e => setField("crop", e.target.value)} placeholder="Cultivo presente" /></Field>
      <Field id="assessment-stage" label="Etapa del cultivo"><Input id="assessment-stage" maxLength={200} value={draft.stage} disabled={isSaving} onChange={e => setField("stage", e.target.value)} placeholder="Ej. crecimiento vegetativo" /></Field>
      <Field id="assessment-area" label="Área o punto evaluado"><Input id="assessment-area" maxLength={500} value={draft.area} disabled={isSaving} onChange={e => setField("area", e.target.value)} placeholder="Lote, zona o referencia" /></Field>
      <Field id="assessment-moisture" label="Humedad observada"><Input id="assessment-moisture" maxLength={500} value={draft.moisture} disabled={isSaving} onChange={e => setField("moisture", e.target.value)} placeholder="Condición del suelo" /></Field>
      <Field id="assessment-water" label="Lluvia o riego reciente" wide><Textarea id="assessment-water" maxLength={1000} value={draft.recentWater} disabled={isSaving} onChange={e => setField("recentWater", e.target.value)} placeholder="Cuándo ocurrió y cuánto tiempo antes de observar…" rows={2} /></Field>
    </div>
    <div className="mt-7 flex items-end justify-between gap-3 border-b pb-2"><div><h4 className="font-semibold">19 criterios de observación</h4><p className="text-xs text-muted-foreground">Selecciona Sí, No o No evaluado; registra notas si aportan contexto.</p></div><span className="text-xs text-muted-foreground">{soilHealthIndicators.length} criterios</span></div>
    <div className="mt-3 space-y-2">{soilHealthIndicators.map((indicator, index) => {
      const value = draft.answers[indicator.id] ?? { answer: "unevaluated" as const, notes: "" };
      return <article key={indicator.id} className="rounded-lg border bg-[#fbfbf5] p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="flex-1"><p className="text-[11px] font-mono text-emerald-800">CRITERIO {String(index + 1).padStart(2, "0")}</p><h5 className="mt-0.5 font-semibold">{indicator.name}</h5><p className="mt-1 text-sm leading-relaxed text-foreground/85">{indicator.criterion}</p><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span><strong>Evalúa:</strong> {indicator.problem ?? "Observación general"}</span>{indicator.timing && <span><strong>Momento:</strong> {indicator.timing}</span>}</div></div>
          <div className="flex shrink-0 gap-1" role="group" aria-label={`Respuesta: ${indicator.name}`}>{(["yes", "no", "unevaluated"] as const).map(answer => <button type="button" key={answer} disabled={isSaving} onClick={() => setDraft(v => v ? ({ ...v, answers: { ...v.answers, [indicator.id]: { ...value, answer } } }) : v)} className={`rounded-md border px-2.5 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 ${value.answer === answer ? answer === "yes" ? "border-emerald-700 bg-emerald-700 text-white" : answer === "no" ? "border-rose-700 bg-rose-700 text-white" : "border-slate-500 bg-slate-600 text-white" : "bg-white text-muted-foreground hover:bg-muted"}`}>{answerLabel(answer)}</button>)}</div>
        </div>
        <div className="mt-3"><Label htmlFor={`note-${indicator.id}`} className="text-xs text-muted-foreground">Notas de observación</Label><Textarea id={`note-${indicator.id}`} maxLength={4000} rows={2} disabled={isSaving} value={value.notes} onChange={e => setDraft(v => v ? ({ ...v, answers: { ...v.answers, [indicator.id]: { ...value, notes: e.target.value } } }) : v)} placeholder="Observaciones, ubicación o contexto…" className="mt-1 min-h-16 bg-white" /></div>
      </article>;
    })}</div>
    {error && <p role="alert" className="mt-4 flex items-center gap-2 text-sm text-rose-700"><AlertTriangle className="h-4 w-4" />{error}</p>}
    <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="outline" onClick={onCancel} disabled={isSaving}>Cancelar</Button><Button onClick={onSave} disabled={isSaving || incomplete} className="bg-emerald-800 hover:bg-emerald-900">{isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}{isSaving ? "Guardando…" : "Guardar evaluación"}</Button></div>
  </div>;
}
function Field({ id, label, required, wide, children }: { id: string; label: string; required?: boolean; wide?: boolean; children: ReactNode }) {
  return <div className={wide ? "sm:col-span-2 lg:col-span-3" : ""}><Label htmlFor={id} className="mb-1.5 block">{label}{required && <span className="text-rose-700"> *</span>}</Label>{children}</div>;
}
function AssessmentDetail({ record, baseline, canEdit, busy, onEdit, onDelete, onPhoto, onRemoveEvidence, onUpload, uploading, uploadProgress, evidenceError, deletePending }: { record: SoilHealthAssessment; baseline: SoilHealthAssessment; canEdit: boolean; busy: boolean; onEdit: () => void; onDelete: () => void; onPhoto: (record: SoilHealthAssessment, evidenceId: string) => void; onRemoveEvidence: (id: string) => void; onUpload: (record: SoilHealthAssessment, indicator: SoilHealthIndicatorId, file?: File) => void; uploading: SoilHealthIndicatorId | null; uploadProgress: number; evidenceError: string; deletePending: boolean }) {
  const [expandedRow, setExpandedRow] = useState<SoilHealthIndicatorId | null>(null);
  const summary = soilHealthSummary(record.answers);
  const comparison = record.id === baseline.id ? null : compareSoilHealth(baseline.answers, record.answers);
  const attention = soilHealthIndicators.filter(i => record.answers[i.id]?.answer === "no");
  const changes: Record<string, string> = { improved: "Mejoró", worsened: "Empeoró", unchanged: "Sin cambio", "not-comparable": "No comparable" };
  const color: Record<string, string> = { improved: "text-emerald-800", worsened: "text-rose-800", unchanged: "text-slate-700", "not-comparable": "text-muted-foreground" };
  return <section className="min-w-0 rounded-xl border bg-card p-4 sm:p-5">
    <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">{record.id === baseline.id ? "Línea base" : "Visita de campo"}</p><h3 className="mt-1 text-xl font-semibold">{dateLabel(record.assessmentDate)}</h3><p className="mt-1 text-sm text-muted-foreground">{record.responsible}{record.crop ? ` · ${record.crop}` : ""}{record.stage ? ` · ${record.stage}` : ""}</p></div>{canEdit && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={onEdit} disabled={busy}>Editar</Button><Button size="sm" variant="outline" className="text-rose-700 hover:bg-rose-50" onClick={onDelete} disabled={busy}><Trash2 className="mr-1.5 h-4 w-4" />Eliminar</Button></div>}</div>
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{[[`${summary.fulfilled} / ${summary.evaluated}`, "Cumplidos / evaluados"], [summary.unevaluated, "Sin evaluar"], [`${Math.round(summary.coverage * 100)}%`, "Cobertura"], [summary.percentage === null ? "—" : `${Math.round(summary.percentage)}%`, "Cumplimiento evaluado"]].map(([value, label]) => <div key={label} className="rounded-lg bg-[#f3f5eb] p-3"><p className="text-xl font-semibold text-emerald-950">{value}</p><p className="text-[11px] text-muted-foreground">{label}</p></div>)}</div>
    {record.area || record.moisture || record.recentWater ? <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">{record.area && <span><b>Área:</b> {record.area}</span>}{record.moisture && <span><b>Humedad:</b> {record.moisture}</span>}{record.recentWater && <span><b>Lluvia/riego:</b> {record.recentWater}</span>}</div> : null}
    {attention.length > 0 && <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3"><h4 className="flex items-center gap-2 text-sm font-semibold text-amber-950"><AlertTriangle className="h-4 w-4" />Aspectos que requieren atención</h4><ul className="mt-2 flex flex-wrap gap-2">{attention.map(i => <li key={i.id} className="rounded-full bg-white px-2.5 py-1 text-xs text-amber-950">{i.name}</li>)}</ul></div>}
    <div className="mt-5 space-y-2">{soilHealthIndicators.map(i => {
      const answer = record.answers[i.id]?.answer ?? "unevaluated";
      const evidence = record.evidence.filter(e => e.indicatorId === i.id);
      const comparisonRow = comparison?.find(c => c.indicatorId === i.id);
      const open = expandedRow === i.id;
      return <article key={i.id} className="rounded-lg border">
        <button type="button" onClick={() => setExpandedRow(open ? null : i.id)} className="flex w-full items-center gap-3 p-3 text-left">
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${answer === "yes" ? "bg-emerald-100 text-emerald-900" : answer === "no" ? "bg-rose-100 text-rose-900" : "bg-slate-100 text-slate-600"}`}>{answer === "yes" ? <Check className="h-4 w-4" /> : answer === "no" ? <X className="h-4 w-4" /> : "—"}</span>
          <span className="min-w-0 flex-1"><span className="block font-medium">{i.name}</span><span className="block truncate text-xs text-muted-foreground">{i.criterion}</span></span>
          {comparisonRow && <span className={`hidden shrink-0 text-xs sm:block ${color[comparisonRow.change]}`}>{changes[comparisonRow.change]}</span>}
          {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>
        {open && <div className="space-y-3 border-t bg-[#fbfbf7] p-3 sm:p-4">
          <p className="text-sm leading-relaxed">{i.criterion}</p><p className="text-xs text-muted-foreground"><b>Problema:</b> {i.problem ?? "Observación general"}{i.timing && <> · <b>Momento:</b> {i.timing}</>}</p>
          <div className="flex flex-wrap gap-3 text-xs"><span>Respuesta: <b>{answerLabel(answer)}</b></span>{comparisonRow && <span className={color[comparisonRow.change]}>Comparación con línea base: <b>{changes[comparisonRow.change]}</b></span>}</div>
          {record.answers[i.id]?.notes && <p className="whitespace-pre-wrap rounded-md bg-white p-3 text-sm">{record.answers[i.id]?.notes}</p>}
          {evidence.length > 0 && <div className="flex flex-wrap gap-2">{evidence.map(item => <div key={item.id} className="flex items-center gap-1 rounded-md border bg-white pl-2"><button className="flex items-center gap-1.5 py-1 text-xs text-emerald-900 underline" onClick={() => onPhoto(record, item.id)}><FileImage className="h-3.5 w-3.5" />{item.filename}</button>{canEdit && <button className="p-1 text-rose-700 disabled:cursor-not-allowed disabled:opacity-50" aria-label="Eliminar evidencia" onClick={() => onRemoveEvidence(item.id)} disabled={busy}><X className="h-3.5 w-3.5" /></button>}</div>)}</div>}
          {canEdit && <label className={`inline-flex items-center gap-2 rounded-md border border-emerald-300 bg-white px-3 py-2 text-xs font-medium text-emerald-900 ${busy ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-emerald-50"}`}>{uploading === i.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}Subir foto <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e => { onUpload(record, i.id, e.target.files?.[0]); e.currentTarget.value = ""; }} /></label>}
          {uploading === i.id && <span className="text-xs text-muted-foreground">Subiendo evidencia… {uploadProgress}%</span>}
        </div>}
      </article>;
    })}</div>
    {comparison && <div className="mt-5 overflow-hidden rounded-lg border"><h4 className="px-3 py-2 text-sm font-semibold">Comparación con línea base · {dateLabel(baseline.assessmentDate)}</h4><div className="overflow-x-auto"><table className="w-full min-w-[450px] text-left text-xs"><thead className="bg-muted/60 text-muted-foreground"><tr><th className="px-3 py-2">Indicador</th><th className="px-3 py-2">Base</th><th className="px-3 py-2">Visita</th><th className="px-3 py-2">Cambio</th></tr></thead><tbody>{comparison.map(row => <tr key={row.indicatorId} className="border-t"><td className="px-3 py-2">{soilHealthIndicators.find(i => i.id === row.indicatorId)?.name}</td><td className="px-3 py-2">{answerLabel(row.before)}</td><td className="px-3 py-2">{answerLabel(row.after)}</td><td className={`px-3 py-2 font-medium ${color[row.change]}`}>{changes[row.change]}</td></tr>)}</tbody></table></div></div>}
    {evidenceError && <p role="alert" className="mt-3 text-sm text-rose-700">{evidenceError}</p>}
    <p className="mt-4 border-t pt-3 text-[11px] leading-relaxed text-muted-foreground">Fuente: {SOIL_HEALTH_SOURCE}</p>
  </section>;
}
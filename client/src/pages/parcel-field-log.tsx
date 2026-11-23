import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { Activity, ArrowLeft, CalendarDays, Check, ChevronRight, CircleAlert, Download, FileAudio, FileText, Filter, Loader2, Search, SlidersHorizontal, Sprout, X, RefreshCw, History, PencilLine } from "lucide-react";
import { downloadFieldLogPdf } from "../lib/export-field-log";
import { fieldLogOrigin, fieldLogOriginLabels, fieldLogOccurredOn, canApplyFieldLogAction } from "@shared/field-log-policy";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Separator } from "../components/ui/separator";
import { Skeleton } from "../components/ui/skeleton";
import { Textarea } from "../components/ui/textarea";
import { FieldLogImport } from "../components/field-log-import";
import { formatMexicoDate, mexicoDateKey } from "@shared/civil-date";

type Item = { category?: string; name?: string; quantity?: number; unit?: string; personnel?: string; machinery?: string; cost?: number; currency?: string };
type Entry = {
  id: string; parcelId: string; cycleDetailId?: string; status: string; originalText?: string; transcription?: string;
   activityType?: string; occurredAt: string | null; structuredData?: { occurredOn?: string; items?: Item[]; observations?: string; totalsByCurrency?: Record<string, number> };
  evidence?: { kind: string; path: string; mimeType?: string; size?: number }[]; confidence?: number | string; missingFields?: string[];
  currentRevision?: number; confirmedAt?: string; rejectedAt?: string; createdAt?: string;
};
type Summary = { totalEntries: number; statusCounts?: Record<string, number>; activityCounts?: Record<string, number>; categoryCounts?: Record<string, number>; totalsByCurrency?: Record<string, number>; quantitiesByUnit?: Record<string, number> };
type Payload = { entries: Entry[]; total: number; page: number; limit: number; summary: Summary; cycles?: { id: string; name?: string }[] };

const statusLabel: Record<string, string> = { draft: "Borrador", pending: "Por revisar", confirmed: "Vigente", rejected: "Anulada", corrected: "Corregida, por confirmar" };
const activityLabel: Record<string, string> = { fertilization: "Fertilización", irrigation: "Riego", application: "Aplicación", harvest: "Cosecha", labor: "Jornal", scouting: "Recorrido", other: "Otro" };
const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(" ");
const money = (n: number, currency = "MXN") => new Intl.NumberFormat("es-MX", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
const dateLabel = (date: string | null | undefined) => formatMexicoDate(mexicoDateKey(date), { day: "2-digit", month: "short", year: "numeric" });

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  if (!response.ok) throw new Error(await response.text() || "No se pudo completar la solicitud");
  return response.json();
}

function Stat({ title, value, note, tone = "green" }: { title: string; value: string | number; note: string; tone?: "green" | "ochre" | "blue" }) {
  return <div className={cx("rounded-xl border p-4", tone === "green" ? "border-[#cbd9c7] bg-[#f3f6ed]" : tone === "ochre" ? "border-[#dfd5b6] bg-[#faf6e8]" : "border-[#c7d9d7] bg-[#eef6f4]")}>
    <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-[#687366]">{title}</p>
    <p className="mt-2 font-mono text-2xl font-semibold text-[#243b2a]">{value}</p>
    <p className="mt-1 text-xs text-[#768076]">{note}</p>
  </div>;
}

function EntryCard({ entry, onOpen }: { entry: Entry; onOpen: (entry: Entry) => void }) {
  const items = entry.structuredData?.items || [];
  const quantityText = items.slice(0, 2).map((item) => `${item.name || item.category || "Insumo"}${item.quantity != null ? ` · ${item.quantity} ${item.unit || ""}` : ""}`).join("  /  ");
  return <button onClick={() => onOpen(entry)} className="group grid w-full grid-cols-[88px_10px_1fr_auto] gap-3 border-b border-[#e1e3d7] px-4 py-4 text-left transition-colors hover:bg-[#f6f6ed] sm:grid-cols-[110px_10px_1fr_190px_auto]">
    <div><p className="font-mono text-xs font-semibold text-[#3f5d43]">{dateLabel(fieldLogOccurredOn(entry))}</p><p className="mt-1 text-[11px] text-[#899187]">Rev. {entry.currentRevision || 1}</p></div>
    <div className="relative flex justify-center"><span className="mt-1 h-2.5 w-2.5 rounded-full border-2 border-[#6b8b66] bg-[#f8f8ef] group-hover:bg-[#d6e5c8]" /><span className="absolute top-3 h-full w-px bg-[#d7ded0]" /></div>
    <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-[#263a2a]">{activityLabel[entry.activityType || ""] || entry.activityType || "Actividad sin clasificar"}</span><StatusBadge status={entry.status} /><Badge variant="outline">{fieldLogOriginLabels[fieldLogOrigin(entry)]}</Badge></div><p className="mt-1 truncate text-sm text-[#637064]">{entry.transcription || entry.originalText || "Sin transcripción disponible"}</p><p className="mt-2 truncate font-mono text-[11px] text-[#8a9185]">{quantityText || entry.structuredData?.observations || "Sin datos estructurados"}</p></div>
    <div className="hidden self-center text-right text-xs text-[#687366] sm:block">{entry.confidence != null && <><span className="font-mono text-[#49664d]">{Math.round(Number(entry.confidence) * 100)}%</span><span className="ml-1">confianza</span></>}</div>
    <ChevronRight className="mt-1 h-4 w-4 text-[#a1aa9d] transition-transform group-hover:translate-x-0.5" />
  </button>;
}
function StatusBadge({ status }: { status: string }) {
  return <Badge className={cx("border font-medium", status === "confirmed" || status === "corrected" ? "border-[#b9d3b4] bg-[#e6f1df] text-[#38613c]" : status === "rejected" ? "border-[#e5c4bc] bg-[#f9e9e3] text-[#9a493e]" : "border-[#ddd0a7] bg-[#f8f0d6] text-[#79642b]")}>{statusLabel[status] || status}</Badge>;
}

export default function ParcelFieldLog() {
  const { id = "" } = useParams<{ id: string }>();
  const conversationId = new URLSearchParams(window.location.search).get("conversationId");
  const openHarvestOnLoad = new URLSearchParams(window.location.search).get("harvest") === "1";
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({ search: "", status: "", activity: "", category: "", cycleDetailId: "", from: "", to: "" });
  const [page, setPage] = useState(1);
  const [selectedState, setSelectedState] = useState<Entry | null>(null);
  const setSelected = setSelectedState;
  const [review, setReview] = useState<{ action: "correct" | "confirm" | "reject"; entry: Entry } | null>(null);
  const [correction, setCorrection] = useState({ activityType: "", occurredAt: "", observations: "" });
  const [actionError, setActionError] = useState("");
  const queryString = useMemo(() => new URLSearchParams({ ...filters, page: String(page), limit: "30" }).toString(), [filters, page]);
  const logs = useQuery<Payload>({ queryKey: ["/api/parcels", id, "field-logs", queryString], queryFn: () => api<Payload>(`/api/parcels/${id}/field-logs?${queryString}`), enabled: Boolean(id) });
  const detail = useQuery<{ entry: Entry; revisions: any[] }>({ queryKey: ["/api/field-logs", selectedState?.id], queryFn: () => api(`/api/field-logs/${selectedState?.id}`), enabled: Boolean(selectedState?.id) });
  const mutate = useMutation({
    mutationFn: ({ entryId, action, correction: data }: { entryId: string; action: string; correction?: unknown }) =>
      api(`/api/field-logs/${entryId}`, { method: "PATCH", body: JSON.stringify({ action, correction: data }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/parcels", id, "field-logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/field-logs", selectedState?.id] });
      queryClient.invalidateQueries({ queryKey: ["costs", id] });
      queryClient.invalidateQueries({ queryKey: ["production-costs", id] });
      setReview(null); setActionError("");
    },
    onError: (error: Error) => setActionError(error.message || "No se pudo guardar la decisión."),
  });
  const data = logs.data;
  const summary = data?.summary;
  const entries = data?.entries || [];
  const selected = detail.data?.entry || selectedState;
  const activityOptions = Object.entries(summary?.activityCounts || {});
  const currentStatus = detail.data?.entry.status || "";
  const canConfirm = canApplyFieldLogAction(currentStatus, "confirm");
  const canCorrect = canApplyFieldLogAction(currentStatus, "correct");
  const canReject = canApplyFieldLogAction(currentStatus, "reject");
  const quantitySummary = Object.entries(summary?.quantitiesByUnit || {});
  const toExportRows = (source: Entry[]) => source.map((entry) => ({ date: dateLabel(fieldLogOccurredOn(entry)), activity: activityLabel[entry.activityType || ""] || entry.activityType || "Sin clasificar", status: statusLabel[entry.status] || entry.status, detail: entry.transcription || entry.originalText || "", quantities: (entry.structuredData?.items || []).map((item) => `${item.name || item.category}: ${item.quantity ?? ""} ${item.unit || ""}`).join("; "), cost: (entry.structuredData?.items || []).filter((item) => item.cost != null).map((item) => money(item.cost || 0, item.currency)).join("; ") }));
  const applyReview = () => {
    if (!review) return;
    const status = detail.data?.entry.status || review.entry.status;
    const allowed = canApplyFieldLogAction(status, review.action);
    if (!allowed) {
      setReview(null);
      setActionError("Este registro ya no admite esa acción porque su estado cambió.");
      return;
    }
    mutate.mutate({ entryId: detail.data?.entry.id || review.entry.id, action: review.action, correction: review.action === "correct" ? { activityType: correction.activityType, occurredAt: correction.occurredAt, structuredData: { ...(detail.data?.entry.structuredData || review.entry.structuredData), observations: correction.observations } } : undefined });
  };
  const downloadCsv = async () => { try { setActionError(""); const response = await fetch(`/api/parcels/${id}/field-logs/export.csv?${queryString}`, { credentials: "include" }); if (!response.ok) throw new Error(await response.text() || `No se pudo exportar (${response.status})`); const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `bitacora-${id}.csv`; anchor.click(); URL.revokeObjectURL(url); } catch (error) { setActionError(error instanceof Error ? error.message : "No se pudo descargar el CSV."); } };
  const downloadPdf = async () => {
    try {
      setActionError("");
      const result = await api<{ entries: Entry[]; total: number; truncated?: boolean }>(`/api/parcels/${id}/field-logs/export.json?${queryString}`);
      if (result.truncated) {
        setActionError("La exportación PDF fue limitada por el servidor. Ajusta los filtros para exportar el conjunto completo.");
        return;
      }
      downloadFieldLogPdf({ parcelName: `Parcela ${id}`, filters: "Filtros actuales", rows: toExportRows(result.entries), summary: `${result.total} registros` });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "No se pudo preparar el PDF.");
    }
  };

  return <main className="min-h-[100dvh] bg-[#f7f7ee] text-[#29372b]">
    {actionError && <div role="alert" className="mx-auto max-w-[1500px] px-4 pt-4 text-sm text-[#9a493e] sm:px-8">{actionError}</div>}
    {quantitySummary.length > 0 && <div className="mx-auto flex max-w-[1500px] flex-wrap gap-2 px-4 pt-3 sm:px-8">{quantitySummary.map(([unit, quantity]) => <span key={unit} className="rounded-full border border-[#c7d9d7] bg-[#eef6f4] px-3 py-1 font-mono text-xs text-[#486b62]">{quantity} {unit}</span>)}</div>}
    <header className="border-b border-[#dfe2d4] bg-[#fbfbf4]"><div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-4 sm:px-8">
      <div className="flex items-center gap-3"><Link href={`/parcel/${id}`} className="rounded-lg p-2 text-[#667364] hover:bg-[#edf0e6]"><ArrowLeft className="h-5 w-5" /></Link><div className="h-8 w-px bg-[#d9dfd3]" /><div><div className="flex items-center gap-2"><Sprout className="h-4 w-4 text-[#52794d]" /><span className="text-[11px] font-semibold uppercase tracking-[0.17em] text-[#698064]">AgRegen · Operación</span></div><h1 className="mt-1 text-xl font-semibold tracking-tight text-[#263b2b] sm:text-2xl">Bitácora de campo</h1></div></div>
      <div className="flex flex-wrap items-center justify-end gap-2"><FieldLogImport parcelId={id} conversationId={conversationId} openHarvestOnLoad={openHarvestOnLoad} /><Button variant="outline" className="hidden border-[#ccd5c5] bg-transparent text-[#486048] sm:flex" onClick={downloadCsv}><Download className="mr-2 h-4 w-4" />CSV</Button><Button className="bg-[#3f6746] text-[#f8f8ef] hover:bg-[#315538]" onClick={downloadPdf}><FileText className="mr-2 h-4 w-4" />PDF</Button></div>
    </div></header>
    <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-8">
      <div className="mb-6 flex flex-col justify-between gap-3 md:flex-row md:items-end"><div><p className="font-mono text-xs uppercase tracking-[0.16em] text-[#879080]">Registro operativo · parcela {id}</p><h2 className="mt-2 text-3xl font-semibold text-[#263b2b]">Lo que pasó en el campo</h2><p className="mt-1 text-sm text-[#768076]">Revisa, confirma y conserva el contexto de cada jornada.</p></div><div className="flex items-center gap-2 text-xs text-[#7c8779]"><CalendarDays className="h-4 w-4" />Actualización en tiempo real</div></div>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat title="Registros" value={summary?.totalEntries ?? "—"} note="en el filtro actual" /><Stat title="Por revisar" value={(summary?.statusCounts?.pending || 0) + (summary?.statusCounts?.draft || 0) + (summary?.statusCounts?.corrected || 0)} note="requieren criterio" tone="ochre" /><Stat title="Confirmadas" value={summary?.statusCounts?.confirmed || 0} note="fuente operativa válida" /><Stat title="Actividades" value={Object.keys(summary?.activityCounts || {}).length || "—"} note="tipos confirmados" tone="blue" /></div>
      <div className="grid gap-5 lg:grid-cols-[290px_1fr]">
        <Card className="h-fit border-[#dde1d4] bg-[#fbfbf4] shadow-none"><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm text-[#3c503e]"><SlidersHorizontal className="h-4 w-4" />Filtros de lectura</CardTitle></CardHeader><CardContent className="space-y-4"><div><Label className="text-xs text-[#778176]">Buscar en transcripción</Label><div className="relative mt-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-[#a1a99f]" /><Input value={filters.search} onChange={(e) => { setFilters({ ...filters, search: e.target.value }); setPage(1); }} placeholder="fertilizante, riego..." className="border-[#d6ddd0] bg-[#f8f8f1] pl-9 text-sm" /></div></div><div className="grid grid-cols-2 gap-2"><div><Label className="text-xs text-[#778176]">Estado</Label><select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="mt-1 h-9 w-full rounded-md border border-[#d6ddd0] bg-[#f8f8f1] px-2 text-xs"><option value="">Todos</option><option value="pending">Por revisar</option><option value="confirmed">Confirmada</option><option value="corrected">Corregida</option><option value="rejected">Rechazada</option></select></div><div><Label className="text-xs text-[#778176]">Actividad</Label><select value={filters.activity} onChange={(e) => setFilters({ ...filters, activity: e.target.value })} className="mt-1 h-9 w-full rounded-md border border-[#d6ddd0] bg-[#f8f8f1] px-2 text-xs"><option value="">Todas</option>{Object.entries(activityLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div></div><div><Label className="text-xs text-[#778176]">Categoría</Label><select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} className="mt-1 h-9 w-full rounded-md border border-[#d6ddd0] bg-[#f8f8f1] px-2 text-xs"><option value="">Todas las categorías</option>{Object.keys(summary?.categoryCounts || {}).map((category) => <option key={category} value={category}>{category}</option>)}</select></div><div><Label className="text-xs text-[#778176]">Ciclo</Label><select value={filters.cycleDetailId} onChange={(e) => setFilters({ ...filters, cycleDetailId: e.target.value })} className="mt-1 h-9 w-full rounded-md border border-[#d6ddd0] bg-[#f8f8f1] px-2 text-xs"><option value="">Todos los ciclos</option>{data?.cycles?.map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.name || cycle.id}</option>)}</select></div><div className="grid grid-cols-2 gap-2"><div><Label className="text-xs text-[#778176]">Desde</Label><Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} className="mt-1 border-[#d6ddd0] bg-[#f8f8f1] px-2 text-xs" /></div><div><Label className="text-xs text-[#778176]">Hasta</Label><Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} className="mt-1 border-[#d6ddd0] bg-[#f8f8f1] px-2 text-xs" /></div></div><Separator className="bg-[#e1e4d9]" /><div><p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8a9385]">Resumen monetario</p>{Object.entries(summary?.totalsByCurrency || {}).length ? Object.entries(summary?.totalsByCurrency || {}).map(([currency, value]) => <div className="flex justify-between text-sm" key={currency}><span className="text-[#687366]">{currency}</span><span className="font-mono text-[#3b573f]">{money(value, currency)}</span></div>) : <p className="text-xs text-[#9aa297]">Sin costos en este filtro</p>}</div><Button variant="ghost" className="w-full text-xs text-[#62715f] hover:bg-[#eef1e7]" onClick={() => setFilters({ search: "", status: "", activity: "", category: "", cycleDetailId: "", from: "", to: "" })}><RefreshCw className="mr-2 h-3.5 w-3.5" />Limpiar filtros</Button></CardContent></Card>
        <Card className="overflow-hidden border-[#dde1d4] bg-[#fbfbf4] shadow-none"><CardHeader className="flex flex-row items-center justify-between border-b border-[#e1e3d7] pb-4"><div><CardTitle className="text-base text-[#334735]">Línea de tiempo</CardTitle><p className="mt-1 text-xs text-[#8a9385]">{data?.total ?? 0} registros · ordenados por fecha de ocurrencia</p></div><Badge variant="outline" className="border-[#d6ddd0] font-mono text-[10px] text-[#71806f]"><Filter className="mr-1 h-3 w-3" />{page} / {Math.max(1, Math.ceil((data?.total || 0) / 30))}</Badge></CardHeader><CardContent className="p-0">{logs.isLoading ? <div className="space-y-4 p-5">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 bg-[#edf0e6]" />)}</div> : logs.isError ? <div className="flex flex-col items-center gap-3 p-14 text-center"><CircleAlert className="h-8 w-8 text-[#a66d4f]" /><p className="font-medium text-[#526153]">No se pudo cargar la bitácora</p><Button variant="outline" onClick={() => logs.refetch()}>Intentar de nuevo</Button></div> : entries.length === 0 ? <div className="flex flex-col items-center gap-3 p-16 text-center"><Activity className="h-9 w-9 text-[#a6b19f]" /><p className="font-medium text-[#526153]">No hay registros con estos filtros</p><p className="max-w-sm text-sm text-[#899287]">Prueba con otro periodo, actividad o estado.</p></div> : <>{entries.map((entry) => <EntryCard key={entry.id} entry={entry} onOpen={setSelected} />)}<div className="flex items-center justify-between px-4 py-3"><span className="text-xs text-[#8a9385]">Mostrando {entries.length} de {data?.total || 0}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button><Button size="sm" variant="outline" disabled={page >= Math.ceil((data?.total || 0) / 30)} onClick={() => setPage(page + 1)}>Siguiente</Button></div></div></>}</CardContent></Card>
      </div>
    </div>
    <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto border-[#d8dfd2] bg-[#fbfbf4]">
        <DialogHeader><div className="flex items-start justify-between gap-3"><div>
          <DialogTitle className="text-xl text-[#2e4431]">{activityLabel[detail.data?.entry.activityType || selected?.activityType || ""] || selected?.activityType || "Actividad de campo"}</DialogTitle>
          <DialogDescription className="mt-1 font-mono text-xs">{selected && dateLabel(fieldLogOccurredOn(detail.data?.entry || selected))} · registro {selected?.id}</DialogDescription>
        </div>{selected && <StatusBadge status={detail.data?.entry.status || selected.status} />}</div></DialogHeader>
        {detail.isLoading ? <Skeleton className="h-40 bg-[#edf0e6]" /> : detail.data?.entry && <div className="space-y-5">
          <div className="rounded-lg border border-[#e0e4d9] bg-[#f3f5eb] p-4 text-sm text-[#526153]"><p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8a9385]">Transcripción</p>{detail.data.entry.transcription || detail.data.entry.originalText || "Sin texto disponible."}</div>
          <div><p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8a9385]">Datos estructurados</p><div className="overflow-hidden rounded-lg border border-[#e0e4d9]"><table className="w-full text-left text-xs">
            <thead className="bg-[#eef1e7] text-[#697565]"><tr><th className="px-3 py-2">Elemento</th><th className="px-3 py-2">Cantidad</th><th className="px-3 py-2">Costo</th></tr></thead>
            <tbody>{(detail.data.entry.structuredData?.items || []).map((item, index) => <tr className="border-t border-[#e5e7dd]" key={index}><td className="px-3 py-2 font-medium">{item.name || item.category || "—"}</td><td className="px-3 py-2 font-mono">{item.quantity ?? "—"} {item.unit || ""}</td><td className="px-3 py-2 font-mono">{item.cost != null ? money(item.cost, item.currency) : "—"}</td></tr>)}</tbody>
          </table></div></div>
          {detail.data.entry.structuredData?.observations && <p className="text-sm text-[#687366]"><strong>Observaciones:</strong> {detail.data.entry.structuredData.observations}</p>}
          <div><p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8a9385]">Evidencia</p><div className="flex flex-wrap gap-2">
            {(detail.data.entry.evidence || []).map((evidence, index) => <Button key={index} variant="outline" size="sm" className="border-[#d6ddd0] text-xs" onClick={() => window.open(`/api/field-logs/${selected?.id}/evidence/${index}`, "_blank")}><FileAudio className="mr-2 h-3.5 w-3.5" />{evidence.kind || "Archivo"} {evidence.size ? `· ${(evidence.size / 1024).toFixed(0)} KB` : ""}</Button>)}
            {!detail.data.entry.evidence?.length && <span className="text-xs text-[#929b90]">Sin archivos adjuntos</span>}
          </div></div>
          <div className="rounded-lg border border-[#e0e4d9] p-3"><p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8a9385]"><History className="h-3.5 w-3.5" />Historial de revisiones</p>
            {(detail.data.revisions || []).map((revision, index) => <div className="flex justify-between border-t border-[#edf0e6] py-2 text-xs" key={revision.id || index}><span>Revisión {revision.revision || index + 1}</span><span className="text-[#899287]">{revision.createdAt ? dateLabel(revision.createdAt) : "—"}</span></div>)}
          </div>
        </div>}
        <DialogFooter className="gap-2 sm:justify-between"><div className="flex gap-2">
          {canConfirm && <Button className="bg-[#3f6746] hover:bg-[#315538]" onClick={() => setReview({ action: "confirm", entry: detail.data?.entry || selected! })}><Check className="mr-2 h-4 w-4" />Confirmar</Button>}
          {canReject && <Button variant="outline" className="border-[#e3c9be] text-[#9a493e]" onClick={() => setReview({ action: "reject", entry: detail.data?.entry || selected! })}><X className="mr-2 h-4 w-4" />Rechazar</Button>}
          {canCorrect && <Button variant="outline" className="border-[#cbd9c7] text-[#486048]" onClick={() => {
            const entry = detail.data?.entry || selected;
            setCorrection({ activityType: entry?.activityType || "", occurredAt: entry ? fieldLogOccurredOn(entry) : "", observations: entry?.structuredData?.observations || "" });
            setReview({ action: "correct", entry: entry! });
          }}><PencilLine className="mr-2 h-4 w-4" />Corregir</Button>}
        </div></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(review)} onOpenChange={(open) => !open && setReview(null)}>
      <DialogContent className="border-[#d8dfd2] bg-[#fbfbf4]">
        <DialogHeader><DialogTitle>{review?.action === "correct" ? "Corregir registro" : review?.action === "confirm" ? "Confirmar registro" : "Rechazar registro"}</DialogTitle><DialogDescription>{review?.action === "correct" ? "Ajusta los campos que necesitan precisión antes de guardar." : "Esta acción quedará registrada en el historial de auditoría."}</DialogDescription></DialogHeader>
        {review?.action === "correct" ? <div className="space-y-4">
          <div><Label>Tipo de actividad</Label><Input value={correction.activityType} onChange={(e) => setCorrection({ ...correction, activityType: e.target.value })} className="mt-1 bg-[#f8f8f1]" /></div>
          <div><Label>Fecha del hecho (México)</Label><Input type="date" value={correction.occurredAt} onChange={(e) => setCorrection({ ...correction, occurredAt: e.target.value })} className="mt-1 bg-[#f8f8f1]" /></div>
          <div><Label>Observaciones</Label><Textarea value={correction.observations} onChange={(e) => setCorrection({ ...correction, observations: e.target.value })} className="mt-1 bg-[#f8f8f1]" /></div>
        </div> : <div className="rounded-lg bg-[#f1f3e9] p-4 text-sm text-[#5f6d60]">¿Quieres {review?.action === "confirm" ? "confirmar" : "rechazar"} este registro? Podrás consultar esta decisión en sus revisiones.</div>}
        <DialogFooter><Button variant="outline" onClick={() => setReview(null)}>Cancelar</Button><Button disabled={mutate.isPending} className={review?.action === "reject" ? "bg-[#9a493e] hover:bg-[#813b33]" : "bg-[#3f6746] hover:bg-[#315538]"} onClick={applyReview}>{mutate.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Guardar decisión</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </main>;
}
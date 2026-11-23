import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Check, ClipboardPaste, Loader2, Plus, Sprout, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatMexicoDate } from "@shared/civil-date";

type ImportItem = { category: string; name: string; quantity: number | null; unit: string | null; cost: number | null; currency: string };
type ImportRecord = { activityType: string; occurredAt: string | null; datePrecision: "exact" | "unknown"; items: ImportItem[]; observations: string; selected: boolean };
type Source = { id: string; title: string | null; createdAt: string };
const blankItem = (): ImportItem => ({ category: "input", name: "", quantity: null, unit: null, cost: null, currency: "MXN" });
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) throw new Error(await response.text() || `La solicitud falló (${response.status})`);
  return response.json();
}

export function FieldLogImport({ parcelId, conversationId, openHarvestOnLoad = false }: { parcelId: string; conversationId?: string | null; openHarvestOnLoad?: boolean }) {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(Boolean(openHarvestOnLoad));
  const [mode, setMode] = useState<"import" | "harvest">(openHarvestOnLoad ? "harvest" : "import");
  const [text, setText] = useState("");
  const [sourceChoice, setSourceChoice] = useState(conversationId || "text");
  const [source, setSource] = useState(conversationId || "text");
  const [records, setRecords] = useState<ImportRecord[]>([]);
  const [previewText, setPreviewText] = useState("");
  const [, setRequestId] = useState("");
  const requestIdRef = useRef("");
  const [error, setError] = useState("");
  const [harvest, setHarvest] = useState({ crop: "", cycle: "", date: "", quantity: "", price: "", cost: "", notes: "" });
  useEffect(() => {
    if (openHarvestOnLoad) { setMode("harvest"); setOpen(true); }
  }, [openHarvestOnLoad]);
  const sourcesQuery = useQuery<{ conversations: Source[] }>({
    queryKey: ["/api/parcels", parcelId, "field-logs", "import-sources"],
    queryFn: () => request(`/api/parcels/${parcelId}/field-logs/import-sources`),
    enabled: open && mode === "import",
  });
  const previewMutation = useMutation({
    mutationFn: () => request<{ text: string; records: Omit<ImportRecord, "selected">[]; source: string }>(`/api/parcels/${parcelId}/field-logs/import-preview`, {
      method: "POST", body: JSON.stringify({ text: text.trim() || undefined, conversationId: sourceChoice !== "text" ? sourceChoice : undefined }),
    }),
    onSuccess: data => {
      setPreviewText(data.text || text);
      setSource(data.source || source);
      setRecords(data.records.map(record => ({ ...record, occurredAt: record.occurredAt || null, datePrecision: record.datePrecision || "unknown", observations: record.observations || "", items: (record.items || []).map(item => ({ ...blankItem(), ...item })), selected: true })));
      setRequestId("");
      requestIdRef.current = "";
      setError("");
    },
    onError: (cause: Error) => setError(cause.message || "No se pudo preparar la vista previa."),
  });
  const saveMutation = useMutation({
    mutationFn: () => request<{ entries: unknown[] }>(`/api/parcels/${parcelId}/field-logs/import`, {
      method: "POST", body: JSON.stringify({ requestId: requestIdRef.current, source, text: previewText, records: records.filter(record => record.selected).map(({ selected: _selected, ...record }) => record) }),
    }),
    onSuccess: result => {
      queryClient.invalidateQueries({ queryKey: ["/api/parcels", parcelId, "field-logs"] });
      queryClient.invalidateQueries({ queryKey: ["costs", parcelId] });
      queryClient.invalidateQueries({ queryKey: ["production-costs", parcelId] });
      setRecords([]);
      setText("");
      setRequestId("");
      requestIdRef.current = "";
      setOpen(false);
      setError("");
      window.history.replaceState({}, "", `/parcel/${parcelId}/field-log`);
      if (!result.entries?.length) setError("La solicitud se guardó, pero no se recibieron registros en la respuesta.");
    },
    onError: (cause: Error) => setError(cause.message || "No se pudieron guardar los registros. Puedes reintentar sin cambiar la solicitud."),
  });
  const recordsLocked = saveMutation.isPending || saveMutation.isError;
  const harvestTotals = useMemo(() => {
    const q = Number(harvest.quantity);
    const price = Number(harvest.price);
    const cost = Number(harvest.cost);
    return { income: Number.isFinite(q * price) ? q * price : 0, margin: Number.isFinite(q * price - cost) ? q * price - cost : 0 };
  }, [harvest.quantity, harvest.price, harvest.cost]);
  const hasHarvestAmounts = harvest.quantity.trim() !== "" && harvest.price.trim() !== "" && harvest.cost.trim() !== "" &&
    [harvest.quantity, harvest.price, harvest.cost].every(value => Number.isFinite(Number(value)));
  const displayAmount = (amount: number) => hasHarvestAmounts
    ? amount.toLocaleString("es-MX", { style: "currency", currency: "MXN" })
    : "—";
  const harvestValid = Boolean(
    harvest.crop.trim() && harvest.date &&
    harvest.quantity.trim() !== "" && Number.isFinite(Number(harvest.quantity)) && Number(harvest.quantity) > 0 &&
    harvest.price.trim() !== "" && Number.isFinite(Number(harvest.price)) && Number(harvest.price) >= 0 &&
    harvest.cost.trim() !== "" && Number.isFinite(Number(harvest.cost)) && Number(harvest.cost) >= 0
  );
  const saveHarvest = () => {
    if (!harvestValid) { setError("Completa cultivo, fecha, cantidad, precio por kg y costo con valores válidos."); return; }
    setSource("field-entry");
    setPreviewText(`Cosecha y venta: ${harvest.crop.trim()}${harvest.cycle.trim() ? ` · ciclo ${harvest.cycle.trim()}` : ""}`);
    setRecords([{
      activityType: "cosecha y venta", occurredAt: harvest.date, datePrecision: "exact",
      items: [
        { category: "sale", name: `${harvest.crop.trim()}${harvest.cycle.trim() ? ` ${harvest.cycle.trim()}` : ""}`, quantity: Number(harvest.quantity), unit: "kg", cost: Number(harvest.quantity) * Number(harvest.price), currency: "MXN" },
        { category: "labor", name: "Costo del cultivo anterior", quantity: null, unit: null, cost: Number(harvest.cost), currency: "MXN" },
      ],
      observations: [harvest.notes.trim(), `Precio de venta: ${Number(harvest.price)} MXN/kg`].filter(Boolean).join(" · "), selected: true,
    }]);
    requestIdRef.current = crypto.randomUUID();
    setRequestId(requestIdRef.current);
    setError("");
    setMode("harvest");
  };
  const beginSave = () => {
    if (!records.some(record => record.selected)) { setError("Selecciona al menos un registro para guardar."); return; }
    const invalid = records.some(record => record.selected && (
      !record.activityType.trim() ||
      (Boolean(record.occurredAt) && !/^\d{4}-\d{2}-\d{2}$/.test(record.occurredAt || "")) ||
      record.items.some(item =>
        (item.quantity !== null && (!Number.isFinite(Number(item.quantity)) || Number(item.quantity) < 0)) ||
        (item.cost !== null && (!Number.isFinite(Number(item.cost)) || Number(item.cost) < 0))
      )
    ));
    if (invalid) {
      setError("Revisa actividad, fechas y cantidades/costos: deben ser válidos y no negativos."); return;
    }
    if (!requestIdRef.current) {
      requestIdRef.current = crypto.randomUUID();
      setRequestId(requestIdRef.current);
    }
    setError("");
    saveMutation.mutate();
  };
  const patchRecord = (index: number, patch: Partial<ImportRecord>) => setRecords(current => current.map((record, i) => i === index ? { ...record, ...patch } : record));
  const patchItem = (recordIndex: number, itemIndex: number, patch: Partial<ImportItem>) => setRecords(current => current.map((record, i) => i === recordIndex ? { ...record, items: record.items.map((item, j) => j === itemIndex ? { ...item, ...patch } : item) } : record));
  const close = (next: boolean) => { setOpen(next); if (!next) { setError(""); setLocation(`/parcel/${parcelId}/field-log`); } };
  return <>
    <Button variant="outline" className="border-[#ccd5c5] bg-transparent text-[#486048]" onClick={() => { if (records.length === 0) setMode("import"); setOpen(true); }}>
      <ClipboardPaste className="mr-2 h-4 w-4" />Importar
    </Button>
    <Button variant="outline" className="border-[#dfd5b6] bg-[#faf6e8] text-[#715c2e]" onClick={() => { if (records.length === 0) setMode("harvest"); setOpen(true); }}>
      <Sprout className="mr-2 h-4 w-4" />Cosecha anterior
    </Button>
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92dvh] max-w-3xl overflow-y-auto border-[#d8dfd2] bg-[#fbfbf4]">
        <DialogHeader><DialogTitle className="text-[#2e4431]">{mode === "harvest" ? "Registrar cosecha y venta anterior" : "Importar a la bitácora"}</DialogTitle><DialogDescription>{mode === "harvest" ? "Captura datos reales del ciclo anterior. Revisa el ingreso y margen antes de confirmar el registro." : "Prepara un borrador desde texto o una conversación. Revisa, edita y selecciona qué guardar."}</DialogDescription></DialogHeader>
        <div className="mb-2 flex gap-2 border-b border-[#e1e3d7] pb-3">
          <Button size="sm" variant={mode === "import" ? "default" : "outline"} disabled={records.length > 0} onClick={() => setMode("import")}>Importar texto o chat</Button>
          <Button size="sm" variant={mode === "harvest" ? "default" : "outline"} disabled={records.length > 0} onClick={() => setMode("harvest")}>Cosecha / venta</Button>
        </div>
        {mode === "harvest" ? <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label htmlFor="harvest-crop">Cultivo *</Label><Input id="harvest-crop" disabled={records.length > 0} value={harvest.crop} onChange={e => setHarvest({ ...harvest, crop: e.target.value })} placeholder="p. ej. frijol" /></div>
            <div><Label htmlFor="harvest-cycle">Ciclo / año (opcional)</Label><Input id="harvest-cycle" disabled={records.length > 0} value={harvest.cycle} onChange={e => setHarvest({ ...harvest, cycle: e.target.value })} placeholder="p. ej. primavera 2025" /></div>
            <div><Label htmlFor="harvest-date">Fecha de cosecha *</Label><Input id="harvest-date" type="date" disabled={records.length > 0} value={harvest.date} onChange={e => setHarvest({ ...harvest, date: e.target.value })} /></div>
            <div><Label htmlFor="harvest-quantity">Cantidad vendida (kg) *</Label><Input id="harvest-quantity" type="number" min="0" step="any" disabled={records.length > 0} value={harvest.quantity} onChange={e => setHarvest({ ...harvest, quantity: e.target.value })} /></div>
            <div><Label htmlFor="harvest-price">Precio de venta (MXN/kg) *</Label><Input id="harvest-price" type="number" min="0" step="any" disabled={records.length > 0} value={harvest.price} onChange={e => setHarvest({ ...harvest, price: e.target.value })} /></div>
            <div><Label htmlFor="harvest-cost">Costo total del cultivo (MXN) *</Label><Input id="harvest-cost" type="number" min="0" step="any" disabled={records.length > 0} value={harvest.cost} onChange={e => setHarvest({ ...harvest, cost: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-[#dfd5b6] bg-[#faf6e8] p-4 text-sm"><div><span className="block text-xs text-[#786c4d]">Ingreso estimado</span><strong className="font-mono text-lg">{displayAmount(harvestTotals.income)}</strong></div><div><span className="block text-xs text-[#786c4d]">Margen estimado</span><strong className="font-mono text-lg">{displayAmount(harvestTotals.margin)}</strong></div></div>
          <div><Label htmlFor="harvest-notes">Notas (opcional)</Label><Textarea id="harvest-notes" disabled={records.length > 0} value={harvest.notes} onChange={e => setHarvest({ ...harvest, notes: e.target.value })} placeholder="Comprador, condiciones o contexto de la venta" /></div>
          {records.length > 0 && <p className="rounded-md border border-[#cbd9c7] bg-[#f3f6ed] p-3 text-sm text-[#49634b]">Revisión inmutable: {records[0].items[0].name}, {records[0].items[0].quantity} kg, cosecha {records[0].occurredAt}. Ingreso {displayAmount(harvestTotals.income)}; margen {displayAmount(harvestTotals.margin)}. Para ajustar antes de guardar, vuelve a editar los datos.</p>}
          {records.length === 0 && <Button onClick={saveHarvest} disabled={!harvestValid}>Revisar registro</Button>}
        </> : <>
          {records.length === 0 ? <div className="space-y-4">
            <div><Label htmlFor="import-source">Origen</Label><select id="import-source" value={sourceChoice} onChange={e => setSourceChoice(e.target.value)} className="mt-1 h-10 w-full rounded-md border border-[#d6ddd0] bg-[#f8f8f1] px-3 text-sm"><option value="text">Pegar texto</option>{(sourcesQuery.data?.conversations || []).map(conversation => <option key={conversation.id} value={conversation.id}>{conversation.title || "Conversación"} · {formatMexicoDate(conversation.createdAt)}</option>)}</select>{sourcesQuery.isError && <div role="alert" className="mt-1 flex items-center justify-between gap-2 text-xs text-red-700"><span>No se pudieron cargar conversaciones.</span><Button size="sm" variant="outline" onClick={() => sourcesQuery.refetch()}>Reintentar</Button></div>}</div>
            {sourceChoice === "text" ? <div><Label htmlFor="import-text">Notas o texto de campo</Label><Textarea id="import-text" value={text} onChange={e => setText(e.target.value)} rows={6} placeholder="Pega aquí el registro que quieres incorporar…" /></div> : <p className="rounded-md border border-[#d8dfd2] bg-[#f3f5eb] p-3 text-sm text-[#526153]">Se analizará la conversación seleccionada. Puedes revisar cada dato antes de guardarlo.</p>}
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            {previewMutation.isError && <Button variant="outline" onClick={() => previewMutation.mutate()}>Reintentar vista previa</Button>}
            <DialogFooter><Button onClick={() => previewMutation.mutate()} disabled={previewMutation.isPending || (sourceChoice === "text" && !text.trim())}>{previewMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Preparar vista previa</Button></DialogFooter>
          </div> : <div className="space-y-4">
            <div className="flex items-center justify-between"><p className="text-sm text-[#687366]">{records.length} registro{records.length === 1 ? "" : "s"} propuesto{records.length === 1 ? "" : "s"} · ninguno se guardará hasta confirmar</p><Button variant="ghost" size="sm" disabled={recordsLocked} onClick={() => { setRecords([]); setRequestId(""); requestIdRef.current = ""; }}><X className="mr-1 h-4 w-4" />Volver</Button></div>
            {records.map((record, index) => <section key={index} className={`space-y-3 rounded-lg border p-4 ${record.selected ? "border-[#ccd8c7] bg-[#f8f8f1]" : "border-[#e1e3d7] opacity-60"}`}>
              <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={record.selected} disabled={recordsLocked} onChange={e => patchRecord(index, { selected: e.target.checked })} />Incluir registro {index + 1}</label>
              <div className="grid gap-3 sm:grid-cols-2"><div><Label>Actividad</Label><Input disabled={recordsLocked} value={record.activityType} onChange={e => patchRecord(index, { activityType: e.target.value })} /></div><div><Label>Fecha {record.datePrecision === "unknown" && <span className="text-xs text-[#8b7b4f]">· no identificada</span>}</Label><Input disabled={recordsLocked} type="date" value={record.occurredAt || ""} onChange={e => patchRecord(index, { occurredAt: e.target.value || null, datePrecision: e.target.value ? "exact" : "unknown" })} /></div></div>
              {record.items.map((item, itemIndex) => <div key={itemIndex} className="grid gap-2 rounded-md border border-[#e3e6db] bg-[#fcfcf6] p-3 sm:grid-cols-6">
                <div className="sm:col-span-2"><Label>Elemento</Label><Input disabled={recordsLocked} value={item.name} onChange={e => patchItem(index, itemIndex, { name: e.target.value })} /></div>
                <div><Label>Categoría</Label><Input disabled={recordsLocked} value={item.category} onChange={e => patchItem(index, itemIndex, { category: e.target.value })} /></div>
                <div><Label>Cantidad</Label><Input disabled={recordsLocked} type="number" value={item.quantity ?? ""} onChange={e => patchItem(index, itemIndex, { quantity: e.target.value === "" ? null : Number(e.target.value) })} /></div>
                <div><Label>Unidad</Label><Input disabled={recordsLocked} value={item.unit ?? ""} onChange={e => patchItem(index, itemIndex, { unit: e.target.value || null })} /></div>
                <div><Label>Costo (MXN)</Label><Input disabled={recordsLocked} type="number" value={item.cost ?? ""} onChange={e => patchItem(index, itemIndex, { cost: e.target.value === "" ? null : Number(e.target.value) })} /></div>
                <div className="sm:col-span-6 flex justify-end"><Button disabled={recordsLocked} size="sm" variant="ghost" onClick={() => patchRecord(index, { items: record.items.filter((_, j) => j !== itemIndex) })}><Trash2 className="mr-1 h-3.5 w-3.5" />Quitar elemento</Button></div>
              </div>)}
              <Button disabled={recordsLocked} size="sm" variant="outline" onClick={() => patchRecord(index, { items: [...record.items, blankItem()] })}><Plus className="mr-1 h-4 w-4" />Agregar elemento</Button>
              <div><Label>Observaciones</Label><Textarea disabled={recordsLocked} rows={2} value={record.observations} onChange={e => patchRecord(index, { observations: e.target.value })} /></div>
            </section>)}
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            {saveMutation.isError && <p role="alert" className="text-sm text-red-700">Error al guardar. Se bloquea la edición porque la solicitud pudo haberse aplicado parcialmente. Reintenta sin cambiar datos: se reutilizará el mismo identificador.</p>}
            <DialogFooter><Button variant="outline" disabled={recordsLocked} onClick={() => { setRecords([]); setRequestId(""); requestIdRef.current = ""; setError(""); }}>Cancelar revisión</Button><Button disabled={saveMutation.isPending || records.filter(r => r.selected).length === 0} onClick={beginSave}>{saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}{saveMutation.isError ? "Reintentar con el mismo ID" : "Confirmar y guardar"}</Button></DialogFooter>
          </div>}
        </>}
        {mode === "harvest" && records.length > 0 && <div className="space-y-3"><div className="rounded-lg border border-[#e1e3d7] bg-[#f8f8f1] p-4 text-sm"><p className="font-semibold">{records[0].activityType} · {records[0].occurredAt}</p><p className="mt-1">{records[0].items[0].name} · {records[0].items[0].quantity} kg · ingreso {displayAmount(harvestTotals.income)}</p><p className="mt-1">Costo del cultivo: {displayAmount(Number(harvest.cost))} · margen {displayAmount(harvestTotals.margin)}</p></div>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}{saveMutation.isError && <p role="alert" className="text-sm text-red-700">No se guardó. Los datos quedan bloqueados para reintentar exactamente con el mismo identificador, evitando duplicados parciales.</p>}<DialogFooter><Button variant="outline" disabled={recordsLocked} onClick={() => { setRecords([]); requestIdRef.current = ""; setRequestId(""); setError(""); saveMutation.reset(); }}>Editar datos</Button><Button disabled={saveMutation.isPending} onClick={() => { if (!requestIdRef.current) { requestIdRef.current = crypto.randomUUID(); setRequestId(requestIdRef.current); } saveMutation.mutate(); }}>{saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{saveMutation.isError ? "Reintentar con el mismo ID" : "Confirmar y guardar"}</Button></DialogFooter></div>}
      </DialogContent>
    </Dialog>
  </>;
}

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatMexicoDate } from "@shared/civil-date";

type Proposal = {
  id: string;
  date: string;
  before: { nitrogenTotal: string | null; nitrogenInorganic: string | null };
  changes: { nitrogenTotal?: null; nitrogenInorganic?: string };
  notes: string;
};
type RepairPayload = { proposals: Proposal[] };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.message || body?.error || "No se pudo completar la reparación.");
  }
  return response.json();
}

function value(value: string | null | undefined) {
  return value == null || value.trim() === "" ? "Sin dato" : `${value}${value === "0" ? " (reportado)" : ""}`;
}

export function SoilReportRepairs({ parcelId }: { parcelId: string }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Proposal | null>(null);
  const queryKey = ["/api/parcels", parcelId, "soil-analysis", "report-repairs"];
  const proposalsQuery = useQuery<RepairPayload>({
    queryKey,
    queryFn: () => api(`/api/parcels/${parcelId}/soil-analysis/report-repairs`),
    enabled: Boolean(parcelId),
  });
  const repairMutation = useMutation({
    mutationFn: (proposal: Proposal) => api<unknown>(`/api/parcels/${parcelId}/soil-analysis/report-repairs`, {
      method: "POST",
      body: JSON.stringify({ analysisId: proposal.id, before: proposal.before }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/parcels", parcelId, "soil-analysis"] });
      queryClient.invalidateQueries({ queryKey: ["soil-analysis", parcelId] });
      queryClient.invalidateQueries({ queryKey: ["parcel-alerts", parcelId] });
      queryClient.invalidateQueries({ queryKey });
      setSelected(null);
    },
  });

  if (proposalsQuery.isLoading) return <Card className="border-[#dce4d7] bg-[#fbfbf4]"><CardContent className="flex items-center gap-2 py-4 text-sm text-[#687366]"><Loader2 className="h-4 w-4 animate-spin" />Revisando correcciones de informes…</CardContent></Card>;
  if (proposalsQuery.isError) return <Card className="border-[#e5c9bd] bg-[#fbf4ef]"><CardContent className="flex flex-wrap items-center justify-between gap-3 py-4"><p role="alert" className="text-sm text-[#914c3d]">No se pudieron consultar las propuestas de reparación.</p><Button variant="outline" size="sm" onClick={() => proposalsQuery.refetch()}><RotateCcw className="mr-2 h-3.5 w-3.5" />Reintentar</Button></CardContent></Card>;
  const proposals = proposalsQuery.data?.proposals || [];
  if (proposals.length === 0) return null;

  return <>
    <Card className="border-amber-300 bg-amber-50/60" data-testid="soil-report-repairs">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base text-amber-950"><AlertTriangle className="h-4 w-4" />Revisiones sugeridas desde informes</CardTitle>
        <CardDescription>Solo se aplicarán correcciones respaldadas por evidencia explícita del informe. Nada cambia hasta que confirmes cada propuesta.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {repairMutation.isError && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{(repairMutation.error as Error).message}</p>}
        {proposals.map(proposal => <article key={proposal.id} className="rounded-lg border border-amber-200 bg-background/80 p-4" data-testid={`soil-report-repair-${proposal.id}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[#344536]">Análisis del {formatMexicoDate(proposal.date, { day: "numeric", month: "short", year: "numeric" })}</p>
              <p className="mt-1 text-xs text-[#786b4b]">Fuente: informe del laboratorio · evidencia explícita</p>
            </div>
            <Button size="sm" className="bg-[#806526] text-white hover:bg-[#6b541e]" onClick={() => { setSelected(proposal); repairMutation.reset(); }}>
              <Check className="mr-1.5 h-4 w-4" />Revisar y confirmar
            </Button>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-md border border-[#e1e3d7] bg-[#fbfbf4] p-3 text-xs">
              <p className="mb-1 font-semibold text-[#536052]">Antes · registro guardado</p>
              <p>N total: <span className="font-mono">{value(proposal.before.nitrogenTotal)}</span></p>
              <p>N inorgánico: <span className="font-mono">{value(proposal.before.nitrogenInorganic)}</span></p>
            </div>
            <div className="rounded-md border border-[#dfd5b6] bg-[#faf6e8] p-3 text-xs">
              <p className="mb-1 font-semibold text-[#786b4b]">Después · informe</p>
              <p>N total: <span className="font-mono">{Object.prototype.hasOwnProperty.call(proposal.changes, "nitrogenTotal") ? "Sin dato reportado" : value(proposal.before.nitrogenTotal)}</span></p>
              <p>N inorgánico: <span className="font-mono">{proposal.changes.nitrogenInorganic !== undefined ? value(proposal.changes.nitrogenInorganic) : value(proposal.before.nitrogenInorganic)}</span></p>
            </div>
          </div>
          {proposal.notes && <p className="mt-3 text-sm text-[#687366]">{proposal.notes}</p>}
        </article>)}
      </CardContent>
    </Card>
    <Dialog open={Boolean(selected)} onOpenChange={open => !open && !repairMutation.isPending && setSelected(null)}>
      <DialogContent className="border-[#d8dfd2] bg-[#fbfbf4]">
        <DialogHeader>
          <DialogTitle className="text-[#2e4431]">Confirmar corrección del informe</DialogTitle>
          <DialogDescription>Se actualizará únicamente la evidencia de N indicada, y quedará registrada en auditoría. La acción no se ejecuta hasta confirmar.</DialogDescription>
        </DialogHeader>
        {selected && <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-4 text-sm">
          <p className="font-semibold">Análisis del {formatMexicoDate(selected.date)}</p>
          <p className="mt-2 text-xs text-[#786b4b]">Informe de laboratorio · {selected.notes || "Cambios propuestos para corregir el registro existente."}</p>
        </div>}
        {repairMutation.isError && <p role="alert" className="text-sm text-red-700">{(repairMutation.error as Error).message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setSelected(null)} disabled={repairMutation.isPending}>Cancelar</Button>
          <Button className="bg-[#806526] text-white hover:bg-[#6b541e]" disabled={!selected || repairMutation.isPending} onClick={() => selected && repairMutation.mutate(selected)}>
            {repairMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}Confirmar reparación
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

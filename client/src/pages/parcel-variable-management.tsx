import { useParams, Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Plus, Map, TestTube, Activity, ChevronRight, Trash2, Loader2, BarChart3, FlaskConical, Layers, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n-context";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  designing: { label: "Diseñando", color: "bg-blue-100 text-blue-700" },
  active: { label: "En campo", color: "bg-yellow-100 text-yellow-700" },
  completed: { label: "Completada", color: "bg-green-100 text-green-700" },
  interpolated: { label: "Interpolada", color: "bg-purple-100 text-purple-700" },
};

export default function ParcelVariableManagement() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    variableId: "",
    name: "",
    gridType: "regular",
    nPointsPlanned: "25",
    samplingDepth: "20",
    notes: "",
  });

  const { data: parcel } = useQuery({
    queryKey: ["parcel-mvz", id],
    queryFn: async () => {
      const r = await fetch(`/api/parcels/${id}`);
      if (!r.ok) throw new Error("Error");
      const data = await r.json();
      return data.parcel ?? data;
    },
  });

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ["sampling-campaigns", id],
    queryFn: async () => {
      const r = await fetch(`/api/parcels/${id}/sampling-campaigns`);
      if (!r.ok) throw new Error("Error");
      return r.json();
    },
  });

  const { data: variables = [] } = useQuery({
    queryKey: ["master-variables"],
    queryFn: async () => {
      const r = await fetch("/api/master-variables");
      if (!r.ok) throw new Error("Error");
      return r.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const r = await fetch(`/api/parcels/${id}/sampling-campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          nPointsPlanned: Number(data.nPointsPlanned),
          samplingDepth: data.samplingDepth,
        }),
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.message);
      }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sampling-campaigns", id] });
      setShowCreate(false);
      toast({ title: "Campaña creada", description: "Ahora diseña la cuadrícula de muestreo" });
      setLocation(`/parcel/${id}/sampling/design`);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (cid: string) => {
      const r = await fetch(`/api/sampling-campaigns/${cid}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Error al eliminar");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sampling-campaigns", id] }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const hasPolygon = Array.isArray(parcel?.polygonCoordinates) && parcel.polygonCoordinates.length >= 3;

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href={`/parcel/${id}`}>
          <Button variant="ghost" size="icon" data-testid="btn-back-parcel">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Layers className="w-5 h-5 text-primary" />
            Manejo Variable por Zonas
          </h1>
          {parcel && (
            <p className="text-sm text-muted-foreground">{parcel.name} · {parcel.crop}</p>
          )}
        </div>
        <Button className="ml-auto gap-2" onClick={() => setShowCreate(true)} data-testid="btn-new-campaign">
          <Plus className="w-4 h-4" /> Nueva Campaña
        </Button>
      </div>

      {/* No polygon warning */}
      {!hasPolygon && (
        <Card className="border-yellow-200 bg-yellow-50 mb-4">
          <CardContent className="p-4 flex gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-yellow-800">Polígono no definido</p>
              <p className="text-xs text-yellow-700 mt-1">
                Para generar cuadrículas de muestreo necesitas dibujar el polígono de tu parcela.
                <Link href={`/parcel/${id}`}>
                  <span className="underline ml-1 cursor-pointer">Editar parcela →</span>
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-primary">{campaigns.length}</p>
            <p className="text-xs text-muted-foreground mt-1">Campañas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-yellow-600">
              {campaigns.filter((c: any) => c.status === "active").length}
            </p>
            <p className="text-xs text-muted-foreground mt-1">En campo</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-purple-600">
              {campaigns.filter((c: any) => c.status === "interpolated").length}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Interpoladas</p>
          </CardContent>
        </Card>
      </div>

      {/* Campaigns list */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : campaigns.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-12 flex flex-col items-center text-center gap-4">
            <FlaskConical className="w-12 h-12 text-muted-foreground/40" />
            <div>
              <p className="font-medium text-muted-foreground">No hay campañas de muestreo</p>
              <p className="text-sm text-muted-foreground/60 mt-1">
                Crea una campaña para comenzar el análisis de variabilidad espacial
              </p>
            </div>
            <Button variant="outline" onClick={() => setShowCreate(true)} className="gap-2">
              <Plus className="w-4 h-4" /> Crear primera campaña
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c: any) => {
            const st = STATUS_LABELS[c.status] || { label: c.status, color: "bg-gray-100 text-gray-700" };
            const progress = c.nPointsPlanned > 0 ? Math.round((c.nPointsDone / c.nPointsPlanned) * 100) : 0;
            return (
              <Card key={c.id} className="hover:shadow-md transition-shadow" data-testid={`campaign-card-${c.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-primary/10 rounded-lg flex-shrink-0">
                      <TestTube className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold truncate">{c.name}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.color}`}>
                          {st.label}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {c.nPointsDone}/{c.nPointsPlanned} puntos · {c.gridType || "regular"} · Prof. {c.samplingDepth}cm
                      </p>
                      {/* Progress bar */}
                      <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                      {/* Action buttons based on status */}
                      {c.status === "designing" && (
                        <Link href={`/parcel/${id}/sampling/design`}>
                          <Button size="sm" variant="outline" className="gap-1 text-xs" data-testid={`btn-design-${c.id}`}>
                            <Map className="w-3 h-3" /> Diseñar
                          </Button>
                        </Link>
                      )}
                      {(c.status === "active" || c.status === "designing") && c.nPointsPlanned > 0 && (
                        <Link href={`/parcel/${id}/sampling/capture`}>
                          <Button size="sm" variant="outline" className="gap-1 text-xs" data-testid={`btn-capture-${c.id}`}>
                            <Activity className="w-3 h-3" /> Campo
                          </Button>
                        </Link>
                      )}
                      {(c.status === "completed" || c.status === "interpolated") && (
                        <Link href={`/parcel/${id}/sampling/maps`}>
                          <Button size="sm" variant="default" className="gap-1 text-xs" data-testid={`btn-interpolate-${c.id}`}>
                            <BarChart3 className="w-3 h-3" /> Analizar
                          </Button>
                        </Link>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive hover:bg-destructive/10"
                        onClick={() => {
                          if (confirm("¿Eliminar esta campaña?")) deleteMutation.mutate(c.id);
                        }}
                        data-testid={`btn-delete-campaign-${c.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create campaign dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nueva Campaña de Muestreo</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="var">Variable a medir *</Label>
              <Select value={form.variableId} onValueChange={v => setForm(f => ({ ...f, variableId: v }))}>
                <SelectTrigger id="var" data-testid="select-variable">
                  <SelectValue placeholder="Selecciona una variable" />
                </SelectTrigger>
                <SelectContent>
                  {variables.map((v: any) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name} ({v.unit})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cname">Nombre de la campaña *</Label>
              <Input
                id="cname"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Ej: pH Ciclo 2025 - Maíz"
                data-testid="input-campaign-name"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="grid">Tipo de grilla</Label>
                <Select value={form.gridType} onValueChange={v => setForm(f => ({ ...f, gridType: v }))}>
                  <SelectTrigger id="grid" data-testid="select-grid-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="regular">Regular</SelectItem>
                    <SelectItem value="hexagonal">Hexagonal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="npts">N° de puntos *</Label>
                <Input
                  id="npts"
                  type="number"
                  min={3}
                  max={200}
                  value={form.nPointsPlanned}
                  onChange={e => setForm(f => ({ ...f, nPointsPlanned: e.target.value }))}
                  data-testid="input-n-points"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="depth">Profundidad de muestreo (cm)</Label>
              <Input
                id="depth"
                type="number"
                min={1}
                max={100}
                value={form.samplingDepth}
                onChange={e => setForm(f => ({ ...f, samplingDepth: e.target.value }))}
                data-testid="input-depth"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">Notas</Label>
              <Textarea
                id="notes"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={2}
                placeholder="Contexto adicional..."
                data-testid="textarea-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button>
            <Button
              onClick={() => createMutation.mutate(form)}
              disabled={!form.variableId || !form.name || !form.nPointsPlanned || createMutation.isPending}
              data-testid="btn-submit-campaign"
            >
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Crear campaña
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

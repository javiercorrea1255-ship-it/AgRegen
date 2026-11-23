import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, AlertTriangle, RotateCcw, CheckCircle2, Circle, Edit2, Lightbulb } from "lucide-react";

// ─── Crop family classification ─────────────────────────────────────────────
interface CropFamily {
  name: string;
  color: string;     // bg color class
  textColor: string; // text color class
  border: string;    // border color class
}

const CROP_FAMILIES: Record<string, CropFamily> = {
  graminea: { name: "Gramínea", color: "bg-yellow-100", textColor: "text-yellow-800", border: "border-yellow-300" },
  leguminosa: { name: "Leguminosa", color: "bg-green-100", textColor: "text-green-800", border: "border-green-300" },
  crucifera: { name: "Crucífera", color: "bg-blue-100", textColor: "text-blue-800", border: "border-blue-300" },
  tubérculo: { name: "Tubérculo", color: "bg-orange-100", textColor: "text-orange-800", border: "border-orange-300" },
  cucurbitácea: { name: "Cucurbitácea", color: "bg-teal-100", textColor: "text-teal-800", border: "border-teal-300" },
  solanácea: { name: "Solanácea", color: "bg-red-100", textColor: "text-red-800", border: "border-red-300" },
  forrajera: { name: "Forrajera", color: "bg-lime-100", textColor: "text-lime-800", border: "border-lime-300" },
  otro: { name: "Otro", color: "bg-slate-100", textColor: "text-slate-700", border: "border-slate-300" },
};

const CROP_TO_FAMILY: Record<string, keyof typeof CROP_FAMILIES> = {
  maíz: "graminea", maiz: "graminea", trigo: "graminea", sorgo: "graminea",
  arroz: "graminea", cebada: "graminea", avena: "graminea", centeno: "graminea",
  mijo: "graminea", triticale: "graminea",
  frijol: "leguminosa", soya: "leguminosa", garbanzo: "leguminosa",
  lenteja: "leguminosa", "chícharo": "leguminosa", alfalfa: "leguminosa",
  veza: "leguminosa", trébol: "leguminosa", "frijol de terciopelo": "leguminosa",
  col: "crucifera", brócoli: "crucifera", coliflor: "crucifera",
  rábano: "crucifera", nabo: "crucifera", mostaza: "crucifera", canola: "crucifera",
  papa: "tubérculo", camote: "tubérculo", yuca: "tubérculo",
  zanahoria: "tubérculo", betabel: "tubérculo", cebolla: "tubérculo",
  calabaza: "cucurbitácea", pepino: "cucurbitácea", sandía: "cucurbitácea",
  melón: "cucurbitácea", chayote: "cucurbitácea",
  jitomate: "solanácea", chile: "solanácea", berenjena: "solanácea",
  tomate: "solanácea",
  pasto: "forrajera", zacate: "forrajera", ray_grass: "forrajera",
  sudangrass: "forrajera",
  girasol: "otro", amaranto: "otro", quinoa: "otro", ajonjolí: "otro",
  descanso: "otro",
};

function getCropFamily(crop: string): CropFamily {
  const normalized = crop.toLowerCase().trim();
  const key = Object.keys(CROP_TO_FAMILY).find((k) => normalized.includes(k));
  const familyKey = key ? CROP_TO_FAMILY[key] : "otro";
  return CROP_FAMILIES[familyKey];
}

// ─── Regenerative recommendation logic ─────────────────────────────────────
interface Recommendation {
  crop: string;
  family: string;
  reason: string;
  benefit: string;
}

function getRecommendations(sequence: RotationRecord[]): Recommendation[] {
  if (sequence.length === 0) {
    return [
      { crop: "Maíz", family: "Gramínea", reason: "Punto de partida clásico", benefit: "Alta biomasa que mejora la materia orgánica del suelo al incorporarse." },
      { crop: "Frijol", family: "Leguminosa", reason: "Fijación de nitrógeno", benefit: "Fija N₂ atmosférico, reduce el uso de fertilizantes sintéticos." },
      { crop: "Trigo", family: "Gramínea", reason: "Estructura del suelo", benefit: "Raíces profundas que rompen compactación y aumentan la infiltración." },
    ];
  }

  const sorted = [...sequence].sort((a, b) => b.year - a.year);
  const last = sorted[0];
  const lastCropRaw = getLabelForRecord(last);
  const lastFamily = getCropFamilyKey(lastCropRaw);

  const recs: Recommendation[] = [];

  if (lastFamily === "graminea") {
    recs.push(
      { crop: "Frijol / Soya", family: "Leguminosa", reason: "Rotación gramínea → leguminosa", benefit: "Fija nitrógeno y rompe ciclos de plagas de gramíneas. Incrementa materia orgánica." },
      { crop: "Veza + centeno (cobertura)", family: "Leguminosa + Gramínea", reason: "Cultivo de cobertura mixto", benefit: "Suprime malezas, fija N₂ y aporta carbono. Ideal para suelos en recuperación." },
      { crop: "Garbanzo", family: "Leguminosa", reason: "Diversificación regenerativa", benefit: "Tolera sequía y deja el suelo con mayor disponibilidad de fósforo." },
    );
  } else if (lastFamily === "leguminosa") {
    recs.push(
      { crop: "Brócoli / Canola", family: "Crucífera", reason: "Rotación leguminosa → crucífera", benefit: "Las crucíferas aprovechan el N fijado por leguminosas y controlan patógenos del suelo." },
      { crop: "Trigo / Cebada", family: "Gramínea", reason: "Alternancia clásica regenerativa", benefit: "Gramíneas aportan gran volumen de rastrojo que alimenta la biota del suelo." },
      { crop: "Amaranto", family: "Otro", reason: "Alta diversidad de secuencia", benefit: "Raíces profundas, tolera estrés, y su rastrojo aporta nutrientes minerales." },
    );
  } else if (lastFamily === "crucifera") {
    recs.push(
      { crop: "Maíz / Sorgo", family: "Gramínea", reason: "Rotación crucífera → gramínea", benefit: "Gramíneas cierran el ciclo de la secuencia regenerativa gramínea-leguminosa-crucífera." },
      { crop: "Frijol de terciopelo", family: "Leguminosa", reason: "Abono verde", benefit: "Cobertura total del suelo, suprime malezas y aporta hasta 200 kg N/ha." },
      { crop: "Papa", family: "Tubérculo", reason: "Variación de familia", benefit: "Rompe ciclos de enfermedades foliares y aporta diversidad de exudados radiculares." },
    );
  } else {
    recs.push(
      { crop: "Maíz", family: "Gramínea", reason: "Reinicio de secuencia regenerativa", benefit: "Gramíneas aportan alta biomasa y estructura al suelo." },
      { crop: "Frijol", family: "Leguminosa", reason: "Fijación de nitrógeno", benefit: "Reduce dependencia de fertilizantes sintéticos y mejora la microbiota." },
      { crop: "Veza (cobertura)", family: "Leguminosa", reason: "Cultivo de cobertura", benefit: "Protege el suelo desnudo entre campañas y aporta nitrógeno disponible." },
    );
  }

  return recs;
}

function getCropFamilyKey(crop: string): keyof typeof CROP_FAMILIES {
  const normalized = crop.toLowerCase().trim();
  const key = Object.keys(CROP_TO_FAMILY).find((k) => normalized.includes(k));
  return key ? CROP_TO_FAMILY[key] : "otro";
}

// ─── Types ─────────────────────────────────────────────────────────────────
interface CropSequenceEntry {
  year?: number;
  crop: string;
  season?: "pv" | "oi";
  notes?: string;
}

interface RotationRecord {
  id: string;
  parcelId: string;
  year: number;
  springCrops: string | null;
  fallCrops: string | null;
  rotationSystem: string | null;
  cropSequence: CropSequenceEntry[] | null;
  monocultivo?: boolean;
  createdAt: string;
}

function getLabelForRecord(r: RotationRecord): string {
  const seq = r.cropSequence ?? [];
  if (seq.length > 0) return seq.map((e) => e.crop).join(", ");
  const parts = [r.springCrops, r.fallCrops].filter(Boolean);
  return parts.join(" / ") || "Sin cultivo";
}

// ─── Status icon ─────────────────────────────────────────────────────────────
function StatusIcon({ status }: { status: string }) {
  if (status === "verde") return <CheckCircle2 className="w-5 h-5 text-green-600" />;
  if (status === "amarillo") return <Circle className="w-5 h-5 text-yellow-500 fill-yellow-200" />;
  return <AlertTriangle className="w-5 h-5 text-red-600" />;
}

function StatusLabel({ status }: { status: string }) {
  if (status === "verde") return <span className="text-green-700 font-medium">Rotación saludable</span>;
  if (status === "amarillo") return <span className="text-yellow-700 font-medium">Riesgo de monocultivo</span>;
  return <span className="text-red-700 font-medium">Monocultivo confirmado</span>;
}

// ─── Main component ──────────────────────────────────────────────────────────
interface RotacionTabProps {
  parcelId: string;
}

const CURRENT_YEAR = new Date().getFullYear();
const GRID_YEARS = Array.from({ length: 7 }, (_, i) => CURRENT_YEAR - 4 + i); // last 5 + next 2

const COMMON_CROPS = [
  "Maíz", "Trigo", "Sorgo", "Cebada", "Avena", "Centeno",
  "Frijol", "Soya", "Garbanzo", "Alfalfa", "Veza", "Trébol",
  "Brócoli", "Canola", "Rábano", "Col", "Nabo",
  "Papa", "Camote", "Zanahoria", "Cebolla",
  "Calabaza", "Pepino", "Sandía", "Melón",
  "Jitomate", "Chile", "Tomate",
  "Pasto", "Zacate",
  "Girasol", "Amaranto", "Quinoa",
  "Descanso",
];

export function RotacionTab({ parcelId }: RotacionTabProps) {
  const queryClient = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [editRecord, setEditRecord] = useState<RotationRecord | null>(null);
  const [form, setForm] = useState({
    year: CURRENT_YEAR,
    pvCrop: "",
    oiCrop: "",
    rotationSystem: "",
    notes: "",
  });

  const { data: seqData, isLoading } = useQuery({
    queryKey: ["rotation-sequence", parcelId],
    queryFn: async () => {
      const r = await fetch(`/api/parcels/${parcelId}/rotation/sequence`, { credentials: "include" });
      if (!r.ok) throw new Error("Error al obtener secuencia");
      return r.json() as Promise<{ sequence: RotationRecord[]; status: string }>;
    },
    enabled: !!parcelId,
  });

  const sequence: RotationRecord[] = seqData?.sequence ?? [];
  const status: string = seqData?.status ?? "verde";

  // Map year → record for O(1) lookup
  const recordByYear = useMemo(() => {
    const m: Record<number, RotationRecord> = {};
    for (const r of sequence) m[r.year] = r;
    return m;
  }, [sequence]);

  const monocultivoYears = useMemo(() => new Set(sequence.filter((r) => r.monocultivo).map((r) => r.year)), [sequence]);

  const recommendations = useMemo(() => getRecommendations(sequence), [sequence]);

  const openCreate = (year: number) => {
    setEditRecord(null);
    setForm({ year, pvCrop: "", oiCrop: "", rotationSystem: "none", notes: "" });
    setShowDialog(true);
  };

  const openEdit = (rec: RotationRecord) => {
    const seq = rec.cropSequence ?? [];
    const pv = seq.find((e) => e.season === "pv");
    const oi = seq.find((e) => e.season === "oi");
    setEditRecord(rec);
    setForm({
      year: rec.year,
      pvCrop: pv?.crop ?? rec.springCrops ?? "",
      oiCrop: oi?.crop ?? rec.fallCrops ?? "",
      rotationSystem: rec.rotationSystem ?? "none",
      notes: pv?.notes ?? "",
    });
    setShowDialog(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const cropSequence: CropSequenceEntry[] = [];
      if (form.pvCrop.trim()) cropSequence.push({ year: form.year, crop: form.pvCrop.trim(), season: "pv", notes: form.notes || undefined });
      if (form.oiCrop.trim()) cropSequence.push({ year: form.year, crop: form.oiCrop.trim(), season: "oi" });

      const body = {
        year: form.year,
        campaignYear: form.year,
        springCrops: form.pvCrop.trim() || null,
        fallCrops: form.oiCrop.trim() || null,
        rotationSystem: form.rotationSystem === "none" ? null : (form.rotationSystem || null),
        cropSequence: cropSequence.length > 0 ? cropSequence : null,
      };

      if (editRecord) {
        const r = await fetch(`/api/parcels/${parcelId}/rotation/${editRecord.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error("Error al guardar");
        return r.json();
      } else {
        const r = await fetch(`/api/parcels/${parcelId}/rotation`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error("Error al guardar");
        return r.json();
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rotation-sequence", parcelId] });
      queryClient.invalidateQueries({ queryKey: ["rotation", parcelId] });
      setShowDialog(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/parcels/${parcelId}/rotation/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) throw new Error("Error al eliminar");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rotation-sequence", parcelId] });
      queryClient.invalidateQueries({ queryKey: ["rotation", parcelId] });
    },
  });

  const isFormValid = form.pvCrop.trim() || form.oiCrop.trim();

  return (
    <TabsContent value="rotation" className="space-y-5 animate-in fade-in slide-in-from-bottom-2" data-testid="content-rotacion">

      {/* Header with semaphore status */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold" data-testid="text-rotacion-title">Planificador de Rotación de Cultivos</h3>
              {!isLoading && <span data-testid="icon-status"><StatusIcon status={status} /></span>}
            </div>
            {!isLoading && (
              <p className="text-sm text-muted-foreground flex items-center gap-1" data-testid="text-status-label">
                <StatusLabel status={status} />
                <span className="mx-1">·</span>
                {sequence.length} año{sequence.length !== 1 ? "s" : ""} registrado{sequence.length !== 1 ? "s" : ""}
              </p>
            )}
          </div>
        </div>
        <Button onClick={() => openCreate(CURRENT_YEAR)} data-testid="button-add-rotation">
          <Plus className="w-4 h-4 mr-2" /> Agregar Campaña
        </Button>
      </div>

      {/* Monoculture alert banner */}
      {!isLoading && monocultivoYears.size > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-orange-300 bg-orange-50 dark:bg-orange-950/20 p-4" data-testid="banner-monocultivo">
          <AlertTriangle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-orange-800 dark:text-orange-300">Alerta de Monocultivo</p>
            <p className="text-sm text-orange-700 dark:text-orange-400 mt-0.5">
              Se detectó el mismo cultivo principal durante <strong>3 o más años consecutivos</strong> en los años:{" "}
              <strong>{Array.from(monocultivoYears).sort((a, b) => a - b).join(", ")}</strong>.
              El monocultivo continuado aumenta la presión de plagas, agota nutrientes específicos y reduce la microbiodiversidad del suelo.
              Se recomienda implementar la secuencia <em>gramínea → leguminosa → crucífera</em> para restaurar la salud del sistema.
            </p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

          {/* Visual grid */}
          <div className="xl:col-span-2">
            <Card data-testid="card-rotation-grid">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <RotateCcw className="w-4 h-4" /> Grilla de Rotación (últimos 5 + próximas 2 campañas)
                </CardTitle>
                <CardDescription>
                  Haz clic en una celda para editar · Colores por familia de cultivo
                </CardDescription>
                {/* Legend */}
                <div className="flex flex-wrap gap-2 mt-2">
                  {Object.entries(CROP_FAMILIES).slice(0, 6).map(([key, fam]) => (
                    <span key={key} className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${fam.color} ${fam.textColor} ${fam.border}`}>
                      {fam.name}
                    </span>
                  ))}
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="table-rotation-grid">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left py-2 px-3 font-medium w-20">Año</th>
                        <th className="text-left py-2 px-3 font-medium">Primavera-Verano (P-V)</th>
                        <th className="text-left py-2 px-3 font-medium">Otoño-Invierno (O-I)</th>
                        <th className="py-2 px-3 w-20"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {GRID_YEARS.map((year) => {
                        const rec = recordByYear[year];
                        const isFuture = year > CURRENT_YEAR;
                        const isMonocultivo = monocultivoYears.has(year);
                        const seq = rec?.cropSequence ?? [];
                        const pvEntry = seq.find((e) => e.season === "pv");
                        const oiEntry = seq.find((e) => e.season === "oi");
                        const pvLabel = pvEntry?.crop ?? rec?.springCrops ?? null;
                        const oiLabel = oiEntry?.crop ?? rec?.fallCrops ?? null;

                        return (
                          <tr
                            key={year}
                            className={`border-b transition-colors ${isMonocultivo ? "bg-orange-50 dark:bg-orange-950/20" : isFuture ? "bg-blue-50/40 dark:bg-blue-950/10" : "hover:bg-muted/30"}`}
                            data-testid={`row-rotation-${year}`}
                          >
                            <td className="py-2 px-3">
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold">{year}</span>
                                {isFuture && <Badge variant="outline" className="text-xs py-0 px-1 text-blue-600 border-blue-300">Planif.</Badge>}
                                {isMonocultivo && <AlertTriangle className="w-3.5 h-3.5 text-orange-500" />}
                              </div>
                            </td>
                            <td className="py-2 px-3">
                              {pvLabel ? (
                                <CropChip crop={pvLabel} />
                              ) : (
                                <button
                                  className="text-xs text-muted-foreground/50 hover:text-muted-foreground border border-dashed rounded px-2 py-1 transition-colors"
                                  onClick={() => openCreate(year)}
                                  data-testid={`btn-add-pv-${year}`}
                                >
                                  + Agregar
                                </button>
                              )}
                            </td>
                            <td className="py-2 px-3">
                              {oiLabel ? (
                                <CropChip crop={oiLabel} />
                              ) : (
                                rec ? (
                                  <span className="text-xs text-muted-foreground">—</span>
                                ) : (
                                  <span className="text-xs text-muted-foreground/40">—</span>
                                )
                              )}
                            </td>
                            <td className="py-2 px-3 text-right">
                              {rec ? (
                                <div className="flex items-center justify-end gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                    onClick={() => openEdit(rec)}
                                    data-testid={`btn-edit-rotation-${year}`}
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-destructive hover:bg-destructive/10"
                                    onClick={() => deleteMutation.mutate(rec.id)}
                                    disabled={deleteMutation.isPending}
                                    data-testid={`btn-delete-rotation-${year}`}
                                  >
                                    {deleteMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                  </Button>
                                </div>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recommendations panel */}
          <div>
            <Card data-testid="card-rotation-recommendations">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-yellow-500" /> Recomendaciones
                </CardTitle>
                <CardDescription>
                  Cultivos sugeridos para la próxima campaña basados en la secuencia regenerativa
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {recommendations.map((rec, i) => {
                  const fam = getCropFamily(rec.crop.split("/")[0].trim());
                  return (
                    <div
                      key={i}
                      className={`rounded-lg border p-3 ${fam.color} ${fam.border}`}
                      data-testid={`card-recommendation-${i}`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`font-semibold text-sm ${fam.textColor}`}>{rec.crop}</span>
                        <Badge variant="outline" className={`text-xs py-0 px-1 ${fam.textColor} ${fam.border}`}>{rec.family}</Badge>
                      </div>
                      <p className={`text-xs font-medium ${fam.textColor} mb-0.5`}>{rec.reason}</p>
                      <p className="text-xs text-muted-foreground">{rec.benefit}</p>
                    </div>
                  );
                })}
                <div className="rounded-lg border border-muted p-3 bg-muted/30">
                  <p className="text-xs text-muted-foreground">
                    <strong>Principio regenerativo:</strong> La secuencia ideal es{" "}
                    <em>Gramínea → Leguminosa → Crucífera</em>. Cada familia aporta distintos exudados
                    radiculares, diversifica la biota del suelo y rompe ciclos de plagas y enfermedades.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Year-over-year crop sequence list */}
            {sequence.length > 0 && (
              <Card className="mt-4" data-testid="card-rotation-history">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Historial completo</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs" data-testid="table-rotation-history">
                      <tbody>
                        {[...sequence].sort((a, b) => b.year - a.year).map((r) => (
                          <tr key={r.id} className={`border-b last:border-0 ${r.monocultivo ? "bg-orange-50" : ""}`} data-testid={`row-history-${r.year}`}>
                            <td className="py-1.5 px-3 font-medium w-16">{r.year}</td>
                            <td className="py-1.5 px-3 text-muted-foreground">{getLabelForRecord(r)}</td>
                            {r.monocultivo && (
                              <td className="py-1.5 px-3">
                                <AlertTriangle className="w-3 h-3 text-orange-500" />
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* Add/Edit dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md" data-testid="dialog-rotation">
          <DialogHeader>
            <DialogTitle>{editRecord ? "Editar campaña" : "Agregar campaña"}</DialogTitle>
            <DialogDescription>
              Registra los cultivos sembrados en la campaña. Primavera-Verano (marzo-oct) y Otoño-Invierno (nov-feb).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="rot-year">Año de campaña</Label>
              <Input
                id="rot-year"
                type="number"
                min={2000}
                max={2100}
                value={form.year}
                onChange={(e) => setForm((f) => ({ ...f, year: parseInt(e.target.value) || CURRENT_YEAR }))}
                data-testid="input-rotation-year"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="rot-pv">Cultivo Primavera-Verano (P-V)</Label>
              <div className="flex gap-2">
                <Select
                  value={form.pvCrop || "__none__"}
                  onValueChange={(v) => setForm((f) => ({ ...f, pvCrop: v === "__none__" ? "" : v }))}
                >
                  <SelectTrigger className="flex-1" data-testid="select-pv-crop">
                    <SelectValue placeholder="Seleccionar cultivo..." />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    <SelectItem value="__none__">— Sin cultivo —</SelectItem>
                    {COMMON_CROPS.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  placeholder="O escribe..."
                  value={form.pvCrop}
                  onChange={(e) => setForm((f) => ({ ...f, pvCrop: e.target.value }))}
                  className="flex-1"
                  data-testid="input-pv-crop"
                />
              </div>
              {form.pvCrop && (
                <div className="mt-1">
                  <CropChip crop={form.pvCrop} />
                </div>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="rot-oi">Cultivo Otoño-Invierno (O-I)</Label>
              <div className="flex gap-2">
                <Select
                  value={form.oiCrop || "__none__"}
                  onValueChange={(v) => setForm((f) => ({ ...f, oiCrop: v === "__none__" ? "" : v }))}
                >
                  <SelectTrigger className="flex-1" data-testid="select-oi-crop">
                    <SelectValue placeholder="Seleccionar cultivo..." />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    <SelectItem value="__none__">— Sin cultivo —</SelectItem>
                    {COMMON_CROPS.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  placeholder="O escribe..."
                  value={form.oiCrop}
                  onChange={(e) => setForm((f) => ({ ...f, oiCrop: e.target.value }))}
                  className="flex-1"
                  data-testid="input-oi-crop"
                />
              </div>
              {form.oiCrop && (
                <div className="mt-1">
                  <CropChip crop={form.oiCrop} />
                </div>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="rot-system">Sistema de rotación</Label>
              <Select
                value={form.rotationSystem || "none"}
                onValueChange={(v) => setForm((f) => ({ ...f, rotationSystem: v }))}
              >
                <SelectTrigger id="rot-system" data-testid="select-rotation-system">
                  <SelectValue placeholder="Seleccionar..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Sin especificar —</SelectItem>
                  <SelectItem value="rotacion_descanso">Rotación con descanso</SelectItem>
                  <SelectItem value="agroforestal">Sistema agroforestal</SelectItem>
                  <SelectItem value="monocultivo">Monocultivo</SelectItem>
                  <SelectItem value="policultivo">Policultivo</SelectItem>
                  <SelectItem value="cobertura">Cultivo de cobertura</SelectItem>
                  <SelectItem value="otro">Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="rot-notes">Notas (opcional)</Label>
              <Input
                id="rot-notes"
                placeholder="Observaciones de la campaña..."
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                data-testid="input-rotation-notes"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)} data-testid="button-cancel-rotation">
              Cancelar
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !isFormValid}
              data-testid="button-save-rotation"
            >
              {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TabsContent>
  );
}

function CropChip({ crop }: { crop: string }) {
  const fam = getCropFamily(crop);
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${fam.color} ${fam.textColor} ${fam.border}`}>
      {crop}
    </span>
  );
}

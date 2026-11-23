import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, AlertTriangle, BarChart3, MapPin, TrendingUp, TrendingDown, Minus, Award, Leaf } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { MapContainer, TileLayer, GeoJSON } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { Layer } from "leaflet";

interface YieldRecord {
  id: string;
  parcelId: string;
  userId: string;
  campaignYear: number;
  crop: string;
  harvestDate: string;
  yieldTotalTon: string | null;
  yieldAvgTonHa: string;
  yieldByZone: Record<string, number> | null;
  zoneSetId: string | null;
  notes: string | null;
  createdAt: string;
}

interface ManagementZone {
  id: string;
  zoneIndex: number;
  zoneLabel: string | null;
  areaHa: string | null;
  colorHex: string | null;
  polygonGeojson: any;
  zoneSetId: string | null;
}

interface ZonePrescription {
  id: string;
  zoneId: string;
  amendment: string;
  dosePerHa: string | null;
  doseUnit: string | null;
}

interface RendimientoTabProps {
  parcelId: string;
}

const ALERT_THRESHOLD = 0.20;

function getYieldColor(tonHa: number, avgTonHa: number): string {
  const ratio = avgTonHa > 0 ? tonHa / avgTonHa : 1;
  if (ratio >= 1.1) return "#22c55e";
  if (ratio >= 0.9) return "#86efac";
  if (ratio >= 0.8) return "#fbbf24";
  if (ratio >= 0.6) return "#f97316";
  return "#ef4444";
}

function DeltaBadge({ delta }: { delta: number }) {
  if (delta > 5) return <Badge className="bg-green-100 text-green-800 text-xs gap-1"><TrendingUp className="w-3 h-3" />+{delta.toFixed(1)}%</Badge>;
  if (delta < -5) return <Badge className="bg-red-100 text-red-800 text-xs gap-1"><TrendingDown className="w-3 h-3" />{delta.toFixed(1)}%</Badge>;
  return <Badge variant="secondary" className="text-xs gap-1"><Minus className="w-3 h-3" />{delta.toFixed(1)}%</Badge>;
}

export function RendimientoTab({ parcelId }: RendimientoTabProps) {
  const queryClient = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [compareYear1, setCompareYear1] = useState<string>("");
  const [compareYear2, setCompareYear2] = useState<string>("");

  const currentYear = new Date().getFullYear();
  const [form, setForm] = useState({
    campaignYear: String(currentYear),
    crop: "",
    harvestDate: new Date().toISOString().split("T")[0],
    yieldAvgTonHa: "",
    yieldTotalTon: "",
    notes: "",
    yieldByZone: {} as Record<string, string>,
    zoneSetId: "",
  });

  const { data: recordsData, isLoading: recordsLoading } = useQuery({
    queryKey: ["yield-records", parcelId],
    queryFn: async () => {
      const r = await fetch(`/api/parcels/${parcelId}/yield-records`, { credentials: "include" });
      if (!r.ok) throw new Error("Error al obtener registros");
      return r.json() as Promise<{ records: YieldRecord[] }>;
    },
    enabled: !!parcelId,
  });

  const { data: zonesData } = useQuery({
    queryKey: ["parcel-management-zones", parcelId],
    queryFn: async () => {
      const r = await fetch(`/api/parcels/${parcelId}/management-zones`, { credentials: "include" });
      if (!r.ok) return { zones: [] };
      return r.json() as Promise<{ zones: ManagementZone[] }>;
    },
    enabled: !!parcelId,
  });

  const records: YieldRecord[] = recordsData?.records ?? [];
  const allZones: ManagementZone[] = zonesData?.zones ?? [];

  const selectedRecord = useMemo(
    () => records.find((r) => r.id === selectedRecordId) ?? records[0] ?? null,
    [records, selectedRecordId]
  );

  // Auto-select the first record when records load
  useEffect(() => {
    if (!selectedRecordId && records.length > 0) {
      setSelectedRecordId(records[0].id);
    }
  }, [records, selectedRecordId]);

  // Zones scoped to the selected record's zoneSetId (or all if no zoneSetId)
  const zonesForRecord = useMemo(() => {
    if (!selectedRecord?.zoneSetId) return allZones;
    return allZones.filter((z) => z.zoneSetId === selectedRecord.zoneSetId);
  }, [allZones, selectedRecord]);

  // Fetch prescriptions for the selected record's zone set
  // SIAP benchmark — updates when the selected yield record changes
  const { data: benchmarkData, isLoading: benchmarkLoading } = useQuery({
    queryKey: ["yield-benchmark", parcelId, selectedRecord?.crop, selectedRecord?.campaignYear],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedRecord?.crop) params.set("crop", selectedRecord.crop);
      if (selectedRecord?.campaignYear) params.set("year", String(selectedRecord.campaignYear));
      const r = await fetch(`/api/parcels/${parcelId}/yield-benchmark?${params}`, { credentials: "include" });
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!parcelId,
    staleTime: 7 * 24 * 60 * 60 * 1000,
  });

  const { data: prescriptionsData } = useQuery({
    queryKey: ["zone-prescriptions", selectedRecord?.zoneSetId],
    queryFn: async () => {
      const r = await fetch(`/api/zone-sets/${selectedRecord!.zoneSetId}/prescriptions`, { credentials: "include" });
      if (!r.ok) return { prescriptions: [] };
      return r.json() as Promise<{ prescriptions: ZonePrescription[] }>;
    },
    enabled: !!selectedRecord?.zoneSetId,
  });

  const prescriptions: ZonePrescription[] = prescriptionsData?.prescriptions ?? [];

  // Map zoneId → first prescription for quick lookup
  const prescriptionByZone = useMemo(() => {
    const map: Record<string, ZonePrescription | undefined> = {};
    for (const p of prescriptions) {
      if (!map[p.zoneId]) map[p.zoneId] = p;
    }
    return map;
  }, [prescriptions]);

  const avgTonHaForSelected = selectedRecord ? parseFloat(selectedRecord.yieldAvgTonHa) : 0;

  // Zones for the form (scoped to selected zone set, defaulting to latest)
  const availableZoneSets = useMemo(() => {
    const sets = Array.from(new Set(allZones.map((z) => z.zoneSetId).filter(Boolean))) as string[];
    return sets;
  }, [allZones]);

  // Default form zone set to the most recent (first) available
  useEffect(() => {
    if (!form.zoneSetId && availableZoneSets.length > 0) {
      setForm((f) => ({ ...f, zoneSetId: availableZoneSets[0] }));
    }
  }, [availableZoneSets, form.zoneSetId]);

  const zonesForForm = useMemo(() => {
    if (!form.zoneSetId) return allZones;
    return allZones.filter((z) => z.zoneSetId === form.zoneSetId);
  }, [allZones, form.zoneSetId]);

  const availableYears = useMemo(
    () => Array.from(new Set(records.map((r) => String(r.campaignYear)))).sort((a, b) => Number(b) - Number(a)),
    [records]
  );

  const comparisonChartData = useMemo(() => {
    const y1 = records.find((r) => String(r.campaignYear) === compareYear1);
    const y2 = records.find((r) => String(r.campaignYear) === compareYear2);
    if (!y1 && !y2) return [];

    const allZoneIds = new Set<string>([
      ...Object.keys(y1?.yieldByZone ?? {}),
      ...Object.keys(y2?.yieldByZone ?? {}),
    ]);

    if (allZoneIds.size === 0) {
      return [
        {
          zona: "Parcela",
          [compareYear1 || "—"]: y1 ? parseFloat(y1.yieldAvgTonHa) : undefined,
          [compareYear2 || "—"]: y2 ? parseFloat(y2.yieldAvgTonHa) : undefined,
        },
      ];
    }

    return Array.from(allZoneIds).map((zoneId) => {
      const zone = allZones.find((z) => z.id === zoneId);
      const label = zone?.zoneLabel ?? `Zona ${zone?.zoneIndex ?? zoneId.slice(0, 6)}`;
      return {
        zona: label,
        [compareYear1 || "—"]: y1?.yieldByZone?.[zoneId],
        [compareYear2 || "—"]: y2?.yieldByZone?.[zoneId],
      };
    });
  }, [compareYear1, compareYear2, records, allZones]);

  const comparisonTableRows = useMemo(() => {
    if (!selectedRecord) return [];
    const yieldByZone = selectedRecord.yieldByZone ?? {};
    const avg = avgTonHaForSelected;

    return zonesForRecord.map((zone) => {
      const actual = yieldByZone[zone.id];
      const pct = actual !== undefined && avg > 0 ? ((actual - avg) / avg) * 100 : null;
      const belowAlert = actual !== undefined && avg > 0 && actual < avg * (1 - ALERT_THRESHOLD);
      const prescription = prescriptionByZone[zone.id];
      return { zone, actual, pct, belowAlert, prescription };
    });
  }, [selectedRecord, zonesForRecord, avgTonHaForSelected, prescriptionByZone]);

  const alertZones = comparisonTableRows.filter((r) => r.belowAlert);

  const geoJsonData = useMemo(() => {
    if (!selectedRecord || zonesForRecord.length === 0) return null;
    const yieldByZone = selectedRecord.yieldByZone ?? {};
    const avg = avgTonHaForSelected;

    const features = zonesForRecord
      .filter((z) => z.polygonGeojson)
      .map((zone) => {
        const actual = yieldByZone[zone.id];
        const color = actual !== undefined ? getYieldColor(actual, avg) : "#94a3b8";
        const geom = zone.polygonGeojson as any;
        const feat = geom?.type === "Feature" ? geom : { type: "Feature", geometry: geom, properties: {} };
        return {
          ...feat,
          properties: {
            ...feat.properties,
            zoneLabel: zone.zoneLabel ?? `Zona ${zone.zoneIndex}`,
            yieldTonHa: actual,
            color,
          },
        };
      });

    return { type: "FeatureCollection" as const, features };
  }, [selectedRecord, zonesForRecord, avgTonHaForSelected]);

  const mapCenter: [number, number] = useMemo(() => {
    if (!geoJsonData || geoJsonData.features.length === 0) return [23.5, -102.0];
    try {
      const coords: number[][] = [];
      geoJsonData.features.forEach((f: any) => {
        const geom = f.geometry;
        if (geom?.type === "Polygon") coords.push(...geom.coordinates[0]);
        else if (geom?.type === "MultiPolygon") geom.coordinates.forEach((poly: any) => coords.push(...poly[0]));
      });
      if (coords.length === 0) return [23.5, -102.0];
      const lats = coords.map((c) => c[1]);
      const lngs = coords.map((c) => c[0]);
      return [
        (Math.min(...lats) + Math.max(...lats)) / 2,
        (Math.min(...lngs) + Math.max(...lngs)) / 2,
      ];
    } catch {
      return [23.5, -102.0];
    }
  }, [geoJsonData]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const yieldByZone: Record<string, number> = {};
      for (const [zoneId, val] of Object.entries(form.yieldByZone)) {
        const n = parseFloat(val);
        if (!isNaN(n)) yieldByZone[zoneId] = n;
      }
      const body: any = {
        campaignYear: parseInt(form.campaignYear),
        crop: form.crop,
        harvestDate: form.harvestDate,
        yieldAvgTonHa: parseFloat(form.yieldAvgTonHa),
        notes: form.notes || null,
      };
      if (form.yieldTotalTon) body.yieldTotalTon = parseFloat(form.yieldTotalTon);
      if (Object.keys(yieldByZone).length > 0) body.yieldByZone = yieldByZone;
      if (form.zoneSetId) body.zoneSetId = form.zoneSetId;

      const r = await fetch(`/api/parcels/${parcelId}/yield-records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as any).message ?? "Error al guardar");
      }
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["yield-records", parcelId] });
      setShowDialog(false);
      setForm({
        campaignYear: String(currentYear),
        crop: "",
        harvestDate: new Date().toISOString().split("T")[0],
        yieldAvgTonHa: "",
        yieldTotalTon: "",
        notes: "",
        yieldByZone: {},
        zoneSetId: availableZoneSets[0] ?? "",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/parcels/${parcelId}/yield-records/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) throw new Error("Error al eliminar");
      return r.json();
    },
    onSuccess: (_data, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ["yield-records", parcelId] });
      if (selectedRecordId === deletedId) setSelectedRecordId(null);
    },
  });

  const isFormValid = form.campaignYear && form.crop && form.harvestDate && form.yieldAvgTonHa;

  return (
    <TabsContent value="rendimiento" className="space-y-6 animate-in fade-in slide-in-from-bottom-2" data-testid="content-rendimiento">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold" data-testid="text-rendimiento-title">Rendimiento y Cosecha por Zona</h3>
          <p className="text-sm text-muted-foreground">
            Registra cosechas, compara rendimiento real con prescripciones y visualiza la variación por zona de manejo.
          </p>
        </div>
        <Button onClick={() => setShowDialog(true)} data-testid="button-add-yield">
          <Plus className="w-4 h-4 mr-2" /> Nueva Cosecha
        </Button>
      </div>

      {/* ── SIAP Benchmark Widget — "¿Cómo te comparas?" ── */}
      {/* Show when: loading, or data has crop context (available or not).
          Hide only when there is no crop info at all for the parcel. */}
      {(benchmarkLoading || (benchmarkData && (benchmarkData.available || benchmarkData.crop))) && (
        <Card data-testid="card-siap-benchmark" className="border-emerald-200 dark:border-emerald-800">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Award className="w-4 h-4 text-emerald-600" />
                ¿Cómo te comparas?
              </CardTitle>
              {benchmarkData?.available && benchmarkData.aboveStateAvg && (
                <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200 gap-1 text-xs" data-testid="badge-above-state-avg">
                  <Leaf className="w-3 h-3" />
                  Sobre la media estatal
                </Badge>
              )}
            </div>
            {benchmarkData?.available && (
              <CardDescription className="text-xs">
                {benchmarkData.crop} · {benchmarkData.state}
                {benchmarkData.cycleYear ? ` · ${benchmarkData.cycleYear}` : ""}
                {" · "}
                <span className="opacity-70">{benchmarkData.source ?? "SIAP — Cierre Agrícola 2022"}</span>
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {benchmarkLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : !benchmarkData || !benchmarkData.available ? (
              <p className="text-sm text-muted-foreground text-center py-3" data-testid="text-siap-no-data">
                Sin datos de referencia disponibles para este cultivo o estado.
              </p>
            ) : (
              <div className="space-y-4" data-testid="siap-bars">
                {/* Determine scale max */}
                {(() => {
                  const values: number[] = [
                    benchmarkData.producerYield,
                    benchmarkData.stateAvg,
                    benchmarkData.nationalAvg,
                  ].filter((v): v is number => v != null);
                  const maxVal = values.length > 0 ? Math.max(...values) * 1.15 : 10;

                  const rows: { label: string; value: number | null; color: string; testId: string }[] = [
                    {
                      label: "Tu rendimiento",
                      value: benchmarkData.producerYield,
                      color: benchmarkData.aboveStateAvg
                        ? "bg-emerald-500"
                        : benchmarkData.producerYield != null && benchmarkData.stateAvg != null && benchmarkData.producerYield >= benchmarkData.stateAvg * 0.85
                        ? "bg-amber-400"
                        : "bg-red-400",
                      testId: "bar-producer-yield",
                    },
                    {
                      label: `Media ${benchmarkData.state !== "Nacional" ? benchmarkData.state : "Nacional"}`,
                      value: benchmarkData.stateAvg,
                      color: "bg-blue-400",
                      testId: "bar-state-avg",
                    },
                    {
                      label: "Media Nacional",
                      value: benchmarkData.nationalAvg,
                      color: "bg-slate-400",
                      testId: "bar-national-avg",
                    },
                  ];

                  return rows.map(({ label, value, color, testId }) => (
                    <div key={label} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground font-medium">{label}</span>
                        <span className="font-semibold tabular-nums" data-testid={`text-${testId}`}>
                          {value != null ? `${value.toFixed(2)} t/ha` : "Sin dato"}
                        </span>
                      </div>
                      <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden" data-testid={testId}>
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${color}`}
                          style={{ width: value != null ? `${Math.min((value / maxVal) * 100, 100)}%` : "0%" }}
                        />
                      </div>
                    </div>
                  ));
                })()}

                {/* Delta badges row */}
                <div className="flex flex-wrap gap-3 pt-1 text-xs text-muted-foreground" data-testid="siap-deltas">
                  {benchmarkData.producerYield != null && benchmarkData.stateAvg != null && (
                    <span>
                      vs. media estatal:{" "}
                      {(() => {
                        const delta = ((benchmarkData.producerYield - benchmarkData.stateAvg) / benchmarkData.stateAvg) * 100;
                        return (
                          <span className={delta >= 0 ? "text-emerald-600 font-semibold" : "text-red-500 font-semibold"}>
                            {delta >= 0 ? "+" : ""}{delta.toFixed(1)}%
                          </span>
                        );
                      })()}
                    </span>
                  )}
                  {benchmarkData.producerYield != null && benchmarkData.nationalAvg != null && (
                    <span>
                      vs. media nacional:{" "}
                      {(() => {
                        const delta = ((benchmarkData.producerYield - benchmarkData.nationalAvg) / benchmarkData.nationalAvg) * 100;
                        return (
                          <span className={delta >= 0 ? "text-emerald-600 font-semibold" : "text-red-500 font-semibold"}>
                            {delta >= 0 ? "+" : ""}{delta.toFixed(1)}%
                          </span>
                        );
                      })()}
                    </span>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Alert badges for zones below threshold */}
      {alertZones.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid="alert-zones-below">
          {alertZones.map(({ zone }) => (
            <Badge key={zone.id} className="bg-red-100 text-red-800 gap-1 text-xs" data-testid={`badge-alert-zone-${zone.id}`}>
              <AlertTriangle className="w-3 h-3" />
              {zone.zoneLabel ?? `Zona ${zone.zoneIndex}`}: &gt;20% bajo promedio
            </Badge>
          ))}
        </div>
      )}

      {recordsLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : records.length === 0 ? (
        <Card data-testid="card-yield-empty">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <BarChart3 className="w-12 h-12 text-muted-foreground/40 mb-4" />
            <p className="text-sm font-medium text-muted-foreground">Sin registros de cosecha</p>
            <p className="text-xs text-muted-foreground mt-1">
              Haz clic en "Nueva Cosecha" para registrar el rendimiento de la campaña.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Record selector */}
          <div className="flex items-center gap-3 flex-wrap">
            <Label className="text-sm whitespace-nowrap">Campaña activa:</Label>
            <Select
              value={selectedRecord?.id ?? ""}
              onValueChange={(v) => setSelectedRecordId(v)}
            >
              <SelectTrigger className="w-72" data-testid="select-yield-record">
                <SelectValue placeholder="Seleccionar campaña" />
              </SelectTrigger>
              <SelectContent>
                {records.map((r) => (
                  <SelectItem key={r.id} value={r.id} data-testid={`option-yield-${r.id}`}>
                    {r.campaignYear} — {r.crop} ({parseFloat(r.yieldAvgTonHa).toFixed(2)} t/ha)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedRecord && (
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive hover:bg-destructive/10"
                onClick={() => deleteMutation.mutate(selectedRecord.id)}
                disabled={deleteMutation.isPending}
                data-testid="button-delete-yield"
              >
                {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              </Button>
            )}
          </div>

          {selectedRecord && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {/* Choropleth map */}
              <Card data-testid="card-yield-map">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <MapPin className="w-4 h-4" /> Mapa de Rendimiento por Zona
                  </CardTitle>
                  <CardDescription>
                    {selectedRecord.campaignYear} — {selectedRecord.crop} &bull; promedio: {parseFloat(selectedRecord.yieldAvgTonHa).toFixed(2)} t/ha
                    {selectedRecord.zoneSetId && <span className="ml-1 text-xs text-muted-foreground">(conjunto: {selectedRecord.zoneSetId.slice(0, 8)}…)</span>}
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0 overflow-hidden rounded-b-lg">
                  {geoJsonData && geoJsonData.features.length > 0 ? (
                    <div style={{ height: 300 }}>
                      <MapContainer
                        center={mapCenter}
                        zoom={14}
                        style={{ width: "100%", height: "100%" }}
                        scrollWheelZoom={false}
                      >
                        <TileLayer
                          attribution="&copy; Esri"
                          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                        />
                        <GeoJSON
                          key={selectedRecord.id}
                          data={geoJsonData as any}
                          style={(feature: any) => ({
                            color: "#fff",
                            weight: 1.5,
                            fillColor: feature?.properties?.color ?? "#94a3b8",
                            fillOpacity: 0.75,
                          })}
                          onEachFeature={(feature: any, layer: Layer) => {
                            const p = feature?.properties;
                            if (p) {
                              layer.bindTooltip(
                                `<strong>${p.zoneLabel}</strong><br/>${p.yieldTonHa !== undefined ? `${Number(p.yieldTonHa).toFixed(2)} t/ha` : "Sin dato"}`,
                                { sticky: true }
                              );
                            }
                          }}
                        />
                      </MapContainer>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-48 text-muted-foreground text-sm gap-2">
                      <MapPin className="w-8 h-8 opacity-30" />
                      <span>Sin zonas de manejo vinculadas a esta cosecha</span>
                    </div>
                  )}
                  {/* Legend */}
                  <div className="flex items-center gap-3 p-3 text-xs flex-wrap">
                    {[
                      { color: "#22c55e", label: ">10% sobre prom." },
                      { color: "#86efac", label: "±10% del prom." },
                      { color: "#fbbf24", label: "10-20% bajo" },
                      { color: "#f97316", label: "20-40% bajo" },
                      { color: "#ef4444", label: ">40% bajo" },
                    ].map(({ color, label }) => (
                      <span key={color} className="flex items-center gap-1">
                        <span className="w-3 h-3 rounded-sm inline-block" style={{ background: color }} />
                        {label}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Comparison table: prescription vs actual */}
              <Card data-testid="card-yield-table">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <BarChart3 className="w-4 h-4" /> Prescripción vs Rendimiento Real
                  </CardTitle>
                  <CardDescription>
                    Zona · prescripción aplicada · rendimiento real · diferencia — umbral de alerta: 20% bajo promedio
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  {comparisonTableRows.length === 0 ? (
                    <div className="text-center py-10 text-sm text-muted-foreground">
                      Sin zonas de manejo disponibles para comparar.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm" data-testid="table-yield-comparison">
                        <thead>
                          <tr className="border-b bg-muted/50">
                            <th className="text-left py-2 px-3 font-medium">Zona</th>
                            <th className="text-right py-2 px-3 font-medium">Prescripción</th>
                            <th className="text-right py-2 px-3 font-medium">Real (t/ha)</th>
                            <th className="text-right py-2 px-3 font-medium">vs. Promedio</th>
                            <th className="py-2 px-3"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {comparisonTableRows.map(({ zone, actual, pct, belowAlert, prescription }) => (
                            <tr
                              key={zone.id}
                              className={`border-b transition-colors ${belowAlert ? "bg-red-50 dark:bg-red-950/20" : "hover:bg-muted/30"}`}
                              data-testid={`row-yield-zone-${zone.id}`}
                            >
                              <td className="py-2 px-3">
                                <div className="flex items-center gap-2">
                                  {zone.colorHex && (
                                    <span className="w-3 h-3 rounded-sm inline-block border border-muted flex-shrink-0" style={{ background: zone.colorHex }} />
                                  )}
                                  <span>{zone.zoneLabel ?? `Zona ${zone.zoneIndex}`}</span>
                                </div>
                                {zone.areaHa && <div className="text-xs text-muted-foreground ml-5">{parseFloat(zone.areaHa).toFixed(2)} ha</div>}
                              </td>
                              <td className="py-2 px-3 text-right text-xs text-muted-foreground">
                                {prescription ? (
                                  <span>
                                    {prescription.dosePerHa ? `${Number(prescription.dosePerHa).toFixed(1)}` : "—"}
                                    {prescription.doseUnit ? ` ${prescription.doseUnit}` : ""}
                                    <div className="text-xs opacity-70 truncate max-w-[100px] ml-auto">{prescription.amendment}</div>
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground/50">Sin prescripción</span>
                                )}
                              </td>
                              <td className="py-2 px-3 text-right font-medium">
                                {actual !== undefined ? `${actual.toFixed(2)} t/ha` : <span className="text-muted-foreground">Sin dato</span>}
                              </td>
                              <td className="py-2 px-3 text-right">
                                {pct !== null ? <DeltaBadge delta={pct} /> : <span className="text-muted-foreground text-xs">—</span>}
                              </td>
                              <td className="py-2 px-3">
                                {belowAlert && (
                                  <AlertTriangle className="w-4 h-4 text-red-500" data-testid={`icon-alert-${zone.id}`} />
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Campaign comparison bar chart */}
          {availableYears.length >= 2 && (
            <Card data-testid="card-yield-compare">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" /> Comparar Campañas
                </CardTitle>
                <div className="flex items-center gap-3 mt-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs whitespace-nowrap">Campaña 1</Label>
                    <Select value={compareYear1} onValueChange={setCompareYear1}>
                      <SelectTrigger className="w-32 h-8 text-xs" data-testid="select-compare-year1">
                        <SelectValue placeholder="Año 1" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableYears.map((y) => (
                          <SelectItem key={y} value={y}>{y}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs whitespace-nowrap">Campaña 2</Label>
                    <Select value={compareYear2} onValueChange={setCompareYear2}>
                      <SelectTrigger className="w-32 h-8 text-xs" data-testid="select-compare-year2">
                        <SelectValue placeholder="Año 2" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableYears.map((y) => (
                          <SelectItem key={y} value={y}>{y}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {compareYear1 && compareYear2 && compareYear1 !== compareYear2 ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={comparisonChartData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="zona" tick={{ fontSize: 11 }} />
                      <YAxis unit=" t/ha" tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: any) => [`${Number(v).toFixed(2)} t/ha`]} />
                      <Legend />
                      <Bar dataKey={compareYear1} fill="#22c55e" radius={[4, 4, 0, 0]} data-testid="bar-year1" />
                      <Bar dataKey={compareYear2} fill="#60a5fa" radius={[4, 4, 0, 0]} data-testid="bar-year2" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    Selecciona dos campañas distintas para comparar el rendimiento por zona.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Records list */}
          <Card data-testid="card-yield-list">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Historial de Cosechas</CardTitle>
              <CardDescription>{records.length} campaña{records.length !== 1 ? "s" : ""} registrada{records.length !== 1 ? "s" : ""}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-yield-list">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left py-2 px-3 font-medium">Año</th>
                      <th className="text-left py-2 px-3 font-medium">Cultivo</th>
                      <th className="text-left py-2 px-3 font-medium">Fecha cosecha</th>
                      <th className="text-right py-2 px-3 font-medium">Rendimiento prom.</th>
                      <th className="text-right py-2 px-3 font-medium">Total (ton)</th>
                      <th className="py-2 px-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((rec) => (
                      <tr
                        key={rec.id}
                        className={`border-b cursor-pointer transition-colors ${selectedRecord?.id === rec.id ? "bg-primary/5" : "hover:bg-muted/40"}`}
                        onClick={() => setSelectedRecordId(rec.id)}
                        data-testid={`row-yield-${rec.id}`}
                      >
                        <td className="py-2 px-3 font-semibold">{rec.campaignYear}</td>
                        <td className="py-2 px-3">{rec.crop}</td>
                        <td className="py-2 px-3 text-muted-foreground">
                          {new Date(rec.harvestDate).toLocaleDateString("es-MX")}
                        </td>
                        <td className="py-2 px-3 text-right font-medium">
                          {parseFloat(rec.yieldAvgTonHa).toFixed(2)} t/ha
                        </td>
                        <td className="py-2 px-3 text-right text-muted-foreground">
                          {rec.yieldTotalTon ? `${parseFloat(rec.yieldTotalTon).toFixed(1)} t` : "—"}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:bg-destructive/10"
                            onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(rec.id); }}
                            disabled={deleteMutation.isPending}
                            data-testid={`button-delete-yield-${rec.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* New yield record dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-add-yield">
          <DialogHeader>
            <DialogTitle>Registrar Nueva Cosecha</DialogTitle>
            <DialogDescription>
              Ingresa los datos de rendimiento para esta campaña. Si tienes zonas de manejo, puedes ingresar el rendimiento por zona.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="yr-year">Año de campaña *</Label>
                <Input
                  id="yr-year"
                  type="number"
                  min={2000}
                  max={2100}
                  value={form.campaignYear}
                  onChange={(e) => setForm((f) => ({ ...f, campaignYear: e.target.value }))}
                  data-testid="input-yield-year"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="yr-date">Fecha de cosecha *</Label>
                <Input
                  id="yr-date"
                  type="date"
                  value={form.harvestDate}
                  onChange={(e) => setForm((f) => ({ ...f, harvestDate: e.target.value }))}
                  data-testid="input-yield-date"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="yr-crop">Cultivo *</Label>
              <Input
                id="yr-crop"
                placeholder="ej: Maíz blanco, Trigo, Sorgo"
                value={form.crop}
                onChange={(e) => setForm((f) => ({ ...f, crop: e.target.value }))}
                data-testid="input-yield-crop"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="yr-avg">Rendimiento promedio (t/ha) *</Label>
                <Input
                  id="yr-avg"
                  type="number"
                  step="0.01"
                  min={0}
                  placeholder="ej: 6.5"
                  value={form.yieldAvgTonHa}
                  onChange={(e) => setForm((f) => ({ ...f, yieldAvgTonHa: e.target.value }))}
                  data-testid="input-yield-avg"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="yr-total">Total cosechado (ton)</Label>
                <Input
                  id="yr-total"
                  type="number"
                  step="0.01"
                  min={0}
                  placeholder="ej: 150"
                  value={form.yieldTotalTon}
                  onChange={(e) => setForm((f) => ({ ...f, yieldTotalTon: e.target.value }))}
                  data-testid="input-yield-total"
                />
              </div>
            </div>

            {allZones.length > 0 && (
              <>
                <div className="space-y-1">
                  <Label htmlFor="yr-zoneset">Conjunto de zonas</Label>
                  <Select value={form.zoneSetId} onValueChange={(v) => setForm((f) => ({ ...f, zoneSetId: v, yieldByZone: {} }))}>
                    <SelectTrigger id="yr-zoneset" data-testid="select-yield-zoneset">
                      <SelectValue placeholder="Seleccionar conjunto de zonas" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Sin conjunto específico</SelectItem>
                      {availableZoneSets.map((s) => (
                        <SelectItem key={s} value={s}>{s.slice(0, 20)}{s.length > 20 ? "…" : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {zonesForForm.length > 0 && (
                  <div className="space-y-2">
                    <Label>Rendimiento por zona (t/ha)</Label>
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                      {zonesForForm.map((zone) => (
                        <div key={zone.id} className="flex items-center gap-3">
                          {zone.colorHex && (
                            <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: zone.colorHex }} />
                          )}
                          <Label className="flex-1 text-xs font-normal">
                            {zone.zoneLabel ?? `Zona ${zone.zoneIndex}`}
                            {zone.areaHa && <span className="text-muted-foreground ml-1">({parseFloat(zone.areaHa).toFixed(1)} ha)</span>}
                          </Label>
                          <Input
                            type="number"
                            step="0.01"
                            min={0}
                            placeholder="t/ha"
                            className="w-24 h-7 text-xs"
                            value={form.yieldByZone[zone.id] ?? ""}
                            onChange={(e) => setForm((f) => ({
                              ...f,
                              yieldByZone: { ...f.yieldByZone, [zone.id]: e.target.value },
                            }))}
                            data-testid={`input-zone-yield-${zone.id}`}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="space-y-1">
              <Label htmlFor="yr-notes">Notas</Label>
              <Input
                id="yr-notes"
                placeholder="Observaciones adicionales..."
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                data-testid="input-yield-notes"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)} data-testid="button-cancel-yield">
              Cancelar
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !isFormValid}
              data-testid="button-save-yield"
            >
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TabsContent>
  );
}

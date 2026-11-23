import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/hooks/use-toast";
import {
  Users, MapPin, Shield, Loader2, UserCheck, UserX, GraduationCap,
  Plus, Edit, Trash2, Star, Eye, Upload, Image, X, ChevronRight, Leaf,
  Droplets, Activity, Search, Filter, AlertTriangle, CheckCircle2,
  Map, ExternalLink, BarChart3, Layers, Download, Clock, UserPlus,
  TrendingUp, Globe, Lock, FileText, Phone, Building2, Cpu,
  MessageSquare, Bell, Tractor, FlaskConical, BadgeCheck, Wifi,
} from "lucide-react";
import { Redirect } from "wouter";
import { useI18n } from "@/lib/i18n-context";
import { MapContainer, TileLayer, Polygon, CircleMarker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AdminUser {
  id: string; name: string; email: string;
  role: "admin" | "farmer" | "researcher";
  isActive: boolean; createdAt: string;
  phone?: string; age?: number; gender?: string;
  schoolingYears?: number; farmingExperienceYears?: number;
  state?: string; municipality?: string; locality?: string;
  producerType?: string; techLevel?: string;
  farmingTypes?: string[]; currentPractices?: string[];
  avatarUrl?: string;
}

interface AdminParcel {
  id: string; name: string; location: string; crop: string;
  area: string; status: string; isPublic: boolean;
  phenologicalStage?: string; soilType?: string; irrigationSystem?: string;
  createdAt: string; userId: string; ownerName: string; ownerEmail: string;
  latestNdvi: string | null; latestEvi: string | null;
  latestSoilMoisture: string | null; latestDataDate: string | null;
  latitude: string; longitude: string;
  polygonCoordinates: [number, number][] | null;
}

interface AdminStats {
  totalUsers: number; activeUsers: number;
  usersByRole: { admin: number; farmer: number; researcher: number };
  totalParcels: number; publicParcels: number;
  parcelsByStatus: { active: number; warning: number; inactive: number };
}

interface Conference {
  id: number; title: string; description: string;
  videoUrl?: string; thumbnailUrl?: string; speaker?: string;
  speakerBio?: string; eventDate?: string; tags?: string[];
  status: "draft" | "published" | "archived";
  isFeatured: boolean; viewsCount: number; createdAt: string;
}

interface ActivityItem {
  type: "user" | "parcel"; id: string; label: string; sub: string;
  role?: string; crop?: string; date: string;
}

interface WhatsappEscalation {
  id: string;
  userId: string;
  parcelId?: string | null;
  prompt?: string | null;
  payload?: {
    reason?: string;
    parcelName?: string;
    handoffSummary?: string;
  };
  createdAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const NDVI_COLORS = { good: "#16a34a", moderate: "#ca8a04", bad: "#dc2626", none: "#9CA3AF" };
const CHART_COLORS = ["#16a34a","#2563eb","#7c3aed","#ea580c","#0891b2","#be185d","#854d0e","#166534","#1d4ed8","#6d28d9"];

function ndviMapColor(val: string | null) {
  if (!val) return NDVI_COLORS.none;
  const n = parseFloat(val);
  return n >= 0.6 ? NDVI_COLORS.good : n >= 0.4 ? NDVI_COLORS.moderate : NDVI_COLORS.bad;
}

function ndviTextColor(val: string | null) {
  if (!val) return "text-muted-foreground";
  const n = parseFloat(val);
  return n >= 0.6 ? "text-green-600 font-semibold" : n >= 0.4 ? "text-yellow-600 font-semibold" : "text-red-600 font-semibold";
}

function isSyntheticEntry(name: string): boolean {
  const n = (name || "").toUpperCase();
  return n.includes("SYNTHETIC") || n.includes("DO_NOT_USE") || n.includes("SECURITY_TEST");
}

function fmt(val: string | null, dec = 3) {
  if (!val) return "—";
  const n = parseFloat(val);
  return isNaN(n) ? "—" : n.toFixed(dec);
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

function exportCSV(filename: string, rows: string[][], headers: string[]) {
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function ProfileField({ label, value, testId }: { label: string; value?: string | number | null; testId?: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="font-medium" data-testid={testId}>{value ?? "—"}</p>
    </div>
  );
}

function WhatsappEscalationInbox() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const { data, isLoading } = useQuery<{ escalations: WhatsappEscalation[] }>({
    queryKey: ["admin-whatsapp-escalations"],
    queryFn: async () => {
      const response = await fetch("/api/whatsapp/escalations?status=pending", { credentials: "include" });
      if (!response.ok) throw new Error("No se pudo cargar la bandeja");
      return response.json();
    },
    refetchInterval: 30_000,
  });
  const resolveMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "resolved" | "cancelled" }) => {
      const response = await fetch(`/api/whatsapp/escalations/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note: notes[id]?.trim() || undefined }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || "No se pudo actualizar la solicitud");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-whatsapp-escalations"] });
      toast({ title: "Solicitud actualizada", description: "El productor recibió la resolución por WhatsApp." });
    },
    onError: (error: Error) => toast({ title: "No se pudo atender", description: error.message, variant: "destructive" }),
  });
  const escalations = data?.escalations || [];
  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin" /></div>;
  if (!escalations.length) return (
    <div className="py-12 text-center text-muted-foreground">
      <CheckCircle2 className="mx-auto mb-3 h-9 w-9 text-green-600" />
      No hay solicitudes técnicas pendientes.
    </div>
  );
  return (
    <div className="space-y-4">
      {escalations.map((item) => (
        <div key={item.id} className="rounded-lg border p-4 space-y-3" data-testid={`whatsapp-escalation-${item.id}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-medium">{item.payload?.parcelName || "Parcela sin nombre"}</p>
              <p className="text-xs text-muted-foreground">Solicitada {new Date(item.createdAt).toLocaleString("es-MX")}</p>
            </div>
            <Badge variant="secondary">WhatsApp</Badge>
          </div>
          <p className="text-sm">{item.payload?.handoffSummary || item.prompt || "Revisión técnica solicitada"}</p>
          <Textarea
            value={notes[item.id] || ""}
            onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value.slice(0, 1000) }))}
            placeholder="Respuesta o conclusión para el productor"
            maxLength={1000}
            data-testid={`input-escalation-note-${item.id}`}
          />
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => resolveMutation.mutate({ id: item.id, status: "cancelled" })} disabled={resolveMutation.isPending}>
              Cerrar sin respuesta
            </Button>
            <Button onClick={() => resolveMutation.mutate({ id: item.id, status: "resolved" })} disabled={resolveMutation.isPending}>
              {resolveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MessageSquare className="mr-2 h-4 w-4" />}
              Responder por WhatsApp
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── FlyTo for Leaflet ─────────────────────────────────────────────────────────

function FlyTo({ target }: { target: { lat: number; lng: number; zoom?: number } | null }) {
  const map = useMap();
  const prev = useRef<typeof target>(null);
  if (target && target !== prev.current) {
    prev.current = target;
    map.flyTo([target.lat, target.lng], target.zoom ?? 15, { duration: 1 });
  }
  return null;
}

// ── Community Map Tab ─────────────────────────────────────────────────────────

function CommunityMapTab({ parcels }: { parcels: AdminParcel[] }) {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterCrop, setFilterCrop] = useState("all");
  const [flyTarget, setFlyTarget] = useState<{ lat: number; lng: number; zoom?: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const crops = Array.from(new Set(parcels.map(p => p.crop).filter(Boolean))).sort();

  const filtered = parcels.filter(p => {
    const q = search.toLowerCase();
    return (!q || p.name.toLowerCase().includes(q) || p.ownerName.toLowerCase().includes(q) || p.crop.toLowerCase().includes(q) || p.location.toLowerCase().includes(q))
      && (filterStatus === "all" || p.status === filterStatus)
      && (filterCrop === "all" || p.crop === filterCrop);
  });

  const valid = filtered.filter(p => { const lat = parseFloat(p.latitude), lng = parseFloat(p.longitude); return !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0; });
  const cLat = valid.length > 0 ? valid.reduce((s, p) => s + parseFloat(p.latitude), 0) / valid.length : 20.0;
  const cLng = valid.length > 0 ? valid.reduce((s, p) => s + parseFloat(p.longitude), 0) / valid.length : -100.0;

  function flyTo(p: AdminParcel) {
    const lat = parseFloat(p.latitude), lng = parseFloat(p.longitude);
    if (isNaN(lat) || isNaN(lng)) return;
    setSelectedId(p.id); setFlyTarget({ lat, lng, zoom: 15 });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar predio, productor, cultivo..." value={search} onChange={e => setSearch(e.target.value)} data-testid="input-map-search" />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[140px]" data-testid="select-map-status">
            <Filter className="w-3 h-3 mr-1" /><SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="active">Activo</SelectItem>
            <SelectItem value="warning">Alerta</SelectItem>
            <SelectItem value="inactive">Inactivo</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterCrop} onValueChange={setFilterCrop}>
          <SelectTrigger className="w-[150px]" data-testid="select-map-crop">
            <Leaf className="w-3 h-3 mr-1" /><SelectValue placeholder="Cultivo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los cultivos</SelectItem>
            {crops.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground ml-auto">{filtered.length} predio{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        <div className="lg:w-72 shrink-0 flex flex-col border rounded-lg overflow-hidden bg-background h-56 lg:h-[540px]">
          <div className="px-3 py-2 border-b bg-muted/30">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Predios en mapa</p>
          </div>
          <div className="flex-1 overflow-y-auto divide-y">
            {filtered.length === 0 ? (
              <p className="text-center text-muted-foreground text-sm py-8">Sin resultados</p>
            ) : filtered.map(p => (
              <div key={p.id} className={`px-3 py-2.5 cursor-pointer transition-colors hover:bg-accent ${selectedId === p.id ? "bg-accent border-l-2 border-primary" : ""}`} onClick={() => flyTo(p)} data-testid={`map-list-item-${p.id}`}>
                <div className="flex items-center justify-between gap-1">
                  <p className="font-medium text-sm truncate">{p.name}</p>
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: ndviMapColor(p.latestNdvi) }} />
                </div>
                <p className="text-xs text-muted-foreground truncate">{p.ownerName}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-xs text-muted-foreground">{p.crop}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-xs text-muted-foreground">{parseFloat(p.area).toFixed(1)} ha</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex-1 rounded-lg overflow-hidden border h-[340px] lg:h-[540px]">
          <MapContainer center={[cLat, cLng]} zoom={valid.length > 0 ? 11 : 6} style={{ height: "100%", width: "100%" }}>
            <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="Tiles © Esri" />
            <FlyTo target={flyTarget} />
            {valid.map(p => {
              const lat = parseFloat(p.latitude), lng = parseFloat(p.longitude);
              const color = ndviMapColor(p.latestNdvi);
              const isSel = selectedId === p.id;
              const popup = (
                <div style={{ minWidth: 200 }}>
                  <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{p.name}</p>
                  <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>{p.ownerName}</p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px", fontSize: 12, marginBottom: 8 }}>
                    <span style={{ color: "#6b7280" }}>Cultivo</span><span style={{ fontWeight: 500 }}>{p.crop}</span>
                    <span style={{ color: "#6b7280" }}>Área</span><span style={{ fontWeight: 500 }}>{parseFloat(p.area).toFixed(1)} ha</span>
                    <span style={{ color: "#6b7280" }}>Suelo</span><span style={{ fontWeight: 500 }}>{p.soilType || "—"}</span>
                    <span style={{ color: "#6b7280" }}>Riego</span><span style={{ fontWeight: 500 }}>{p.irrigationSystem || "—"}</span>
                    <span style={{ color: "#6b7280" }}>NDVI</span><span style={{ fontWeight: 600, color }}>{p.latestNdvi ? parseFloat(p.latestNdvi).toFixed(3) : "—"}</span>
                    <span style={{ color: "#6b7280" }}>EVI</span><span style={{ fontWeight: 500 }}>{p.latestEvi ? parseFloat(p.latestEvi).toFixed(3) : "—"}</span>
                    <span style={{ color: "#6b7280" }}>Humedad</span><span style={{ fontWeight: 500 }}>{p.latestSoilMoisture ? `${parseFloat(p.latestSoilMoisture).toFixed(1)}%` : "—"}</span>
                  </div>
                  {p.latestDataDate && <p style={{ fontSize: 11, color: "#9ca3af", marginBottom: 8 }}>Actualizado: {fmtDate(p.latestDataDate)}</p>}
                  <a href={`/parcel/${p.id}`} style={{ fontSize: 12, fontWeight: 600, color: "#166534", textDecoration: "underline" }}>Ver predio →</a>
                </div>
              );
              if (p.polygonCoordinates && p.polygonCoordinates.length >= 3) {
                return (
                  <Polygon key={p.id} positions={p.polygonCoordinates} pathOptions={{ color: isSel ? "#1d4ed8" : color, fillColor: color, fillOpacity: 0.45, weight: isSel ? 3 : 2 }} eventHandlers={{ click: () => setSelectedId(p.id) }}>
                    <Popup>{popup}</Popup>
                  </Polygon>
                );
              }
              return (
                <CircleMarker key={p.id} center={[lat, lng]} radius={isSel ? 12 : 9} pathOptions={{ color: isSel ? "#1d4ed8" : "#fff", fillColor: color, fillOpacity: 0.85, weight: isSel ? 3 : 1.5 }} eventHandlers={{ click: () => setSelectedId(p.id) }}>
                  <Popup>{popup}</Popup>
                </CircleMarker>
              );
            })}
          </MapContainer>
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
        <span className="font-medium text-foreground">Índice NDVI:</span>
        {[{ color: NDVI_COLORS.good, label: "Óptimo (≥ 0.6)" }, { color: NDVI_COLORS.moderate, label: "Moderado (0.4–0.6)" }, { color: NDVI_COLORS.bad, label: "Bajo (< 0.4)" }, { color: NDVI_COLORS.none, label: "Sin datos" }].map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full inline-block" style={{ background: color }} />{label}</span>
        ))}
      </div>
    </div>
  );
}

// ── Analytics Tab ─────────────────────────────────────────────────────────────

function AnalyticsTab({ parcels: rawParcels, users, activity: rawActivity }: { parcels: AdminParcel[]; users: AdminUser[]; activity: ActivityItem[] }) {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

  // Exclude synthetic/test entries from analytics
  const parcels = rawParcels.filter(p => !isSyntheticEntry(p.name) && !isSyntheticEntry(p.ownerName || ""));
  const activity = rawActivity.filter(item => !isSyntheticEntry(item.label) && !isSyntheticEntry(item.sub || ""));

  // Crop distribution
  const cropMap: Record<string, number> = {};
  for (const p of parcels) cropMap[p.crop] = (cropMap[p.crop] || 0) + 1;
  const cropData = Object.entries(cropMap).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }));

  // NDVI health breakdown
  let ndviGood = 0, ndviMod = 0, ndviBad = 0, ndviNone = 0;
  for (const p of parcels) {
    if (!p.latestNdvi) { ndviNone++; continue; }
    const n = parseFloat(p.latestNdvi);
    if (n >= 0.6) ndviGood++; else if (n >= 0.4) ndviMod++; else ndviBad++;
  }
  const parcelsWithNdvi = ndviGood + ndviMod + ndviBad;
  const ndviData = [
    { name: "Óptimo ≥ 0.6", value: ndviGood, color: NDVI_COLORS.good },
    { name: "Moderado 0.4–0.6", value: ndviMod, color: NDVI_COLORS.moderate },
    { name: "Bajo < 0.4", value: ndviBad, color: NDVI_COLORS.bad },
  ].filter(d => d.value > 0);

  // Area by crop (top 8)
  const areaMap: Record<string, number> = {};
  for (const p of parcels) areaMap[p.crop] = (areaMap[p.crop] || 0) + parseFloat(p.area || "0");
  const areaData = Object.entries(areaMap).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, value]) => ({ name, value: Math.round(value * 10) / 10 }));

  // Parcels at risk: only flag parcels that HAD data but it's now stale, NDVI crítico, or explicit warning
  // (excludes parcels that never had any data — likely new or inactive)
  const atRisk = parcels.filter(p => {
    const hadData = !!p.latestDataDate;
    const dataStale = hadData && new Date(p.latestDataDate!).getTime() < thirtyDaysAgo;
    const criticalNdvi = p.latestNdvi !== null && parseFloat(p.latestNdvi) < 0.3;
    return p.status === "warning" || criticalNdvi || dataStale;
  }).sort((a, b) => {
    const aN = a.latestNdvi ? parseFloat(a.latestNdvi) : 999;
    const bN = b.latestNdvi ? parseFloat(b.latestNdvi) : 999;
    return aN - bN;
  });

  // Total hectares
  const totalHa = parcels.reduce((s, p) => s + parseFloat(p.area || "0"), 0);

  // "Predios en óptimo" KPI: percentage relative to parcels WITH NDVI data
  const optimalLabel = parcelsWithNdvi > 0
    ? `${ndviGood} (${Math.round(ndviGood / parcelsWithNdvi * 100)}%)`
    : "Sin datos NDVI";

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Hectáreas totales", value: `${totalHa.toFixed(1)} ha`, icon: <MapPin className="w-4 h-4 text-green-600" />, bg: "bg-green-50" },
          { label: "Predios en óptimo", value: optimalLabel, icon: <CheckCircle2 className="w-4 h-4 text-green-600" />, bg: "bg-green-50" },
          { label: "Predios en riesgo", value: atRisk.length, icon: <AlertTriangle className="w-4 h-4 text-amber-600" />, bg: "bg-amber-50" },
          { label: "Cultivos distintos", value: cropData.length, icon: <Leaf className="w-4 h-4 text-blue-600" />, bg: "bg-blue-50" },
        ].map(({ label, value, icon, bg }) => (
          <div key={label} className={`${bg} rounded-xl p-4 flex items-center gap-3`}>
            <div className="shrink-0">{icon}</div>
            <div>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-lg font-bold">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Crop distribution */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Distribución por cultivo</CardTitle>
          </CardHeader>
          <CardContent>
            {cropData.length === 0 ? (
              <p className="text-center text-muted-foreground text-sm py-8">Sin datos</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={cropData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                    {cropData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => [`${v} predios`, ""]} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* NDVI health */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Salud NDVI de la comunidad</CardTitle>
          </CardHeader>
          <CardContent>
            {ndviData.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
                <div className="w-16 h-16 rounded-full border-4 border-dashed border-muted-foreground/30 flex items-center justify-center">
                  <Leaf className="w-6 h-6 text-muted-foreground/40" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Sin lecturas satelitales aún</p>
                  <p className="text-xs text-muted-foreground/70 mt-0.5">{parcels.length > 0 ? `${parcels.length} predios pendientes de primera lectura` : "No hay predios registrados"}</p>
                </div>
              </div>
            ) : (
              <div>
                <ResponsiveContainer width="100%" height={190}>
                  <PieChart>
                    <Pie data={ndviData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={({ percent }) => `${(percent * 100).toFixed(0)}%`} fontSize={11}>
                      {ndviData.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip formatter={(v: any, name: any) => [`${v} predios`, name]} />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
                {ndviNone > 0 && (
                  <p className="text-center text-xs text-muted-foreground mt-1">{ndviNone} predio{ndviNone !== 1 ? "s" : ""} sin lectura satelital</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Area by crop */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Área por cultivo (ha)</CardTitle>
          </CardHeader>
          <CardContent>
            {areaData.length === 0 ? (
              <p className="text-center text-muted-foreground text-sm py-8">Sin datos</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={areaData} layout="vertical" margin={{ left: 8, right: 8, top: 4, bottom: 4 }}>
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v} ha`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={70} />
                  <Tooltip formatter={(v: any) => [`${v} ha`, "Área"]} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {areaData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Parcels at risk + Activity feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* At risk */}
        <Card className="border-amber-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Predios que necesitan atención
              {atRisk.length > 0 && <Badge className="bg-amber-100 text-amber-800 ml-1">{atRisk.length}</Badge>}
            </CardTitle>
            <CardDescription className="text-xs">NDVI crítico (&lt;0.3), sin datos recientes o en estado de alerta</CardDescription>
          </CardHeader>
          <CardContent>
            {atRisk.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center gap-2">
                <CheckCircle2 className="w-8 h-8 text-green-500" />
                <p className="text-sm text-muted-foreground">Todos los predios están en buen estado</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {atRisk.map(p => {
                  const noData = !p.latestDataDate || new Date(p.latestDataDate).getTime() < thirtyDaysAgo;
                  const critNdvi = p.latestNdvi !== null && parseFloat(p.latestNdvi) < 0.3;
                  return (
                    <div key={p.id} className="flex items-center justify-between p-2.5 border border-amber-100 rounded-lg bg-amber-50/50 gap-2" data-testid={`risk-parcel-${p.id}`}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-medium truncate">{p.name}</p>
                          {p.status === "warning" && <Badge className="text-[10px] bg-yellow-100 text-yellow-800 py-0">Alerta</Badge>}
                          {critNdvi && <Badge className="text-[10px] bg-red-100 text-red-800 py-0">NDVI crítico</Badge>}
                          {noData && <Badge className="text-[10px] bg-gray-100 text-gray-700 py-0">Sin datos recientes</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground">{p.ownerName} · {p.crop}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-sm font-bold ${ndviTextColor(p.latestNdvi)}`}>{fmt(p.latestNdvi)}</span>
                        <a href={`/parcel/${p.id}`} className="text-primary hover:underline" data-testid={`link-risk-parcel-${p.id}`}>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Activity feed */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              Actividad reciente
            </CardTitle>
            <CardDescription className="text-xs">Últimos registros de usuarios y predios</CardDescription>
          </CardHeader>
          <CardContent>
            {activity.length === 0 ? (
              <p className="text-center text-muted-foreground text-sm py-8">Sin actividad reciente</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {activity.map((item, i) => (
                  <div key={`${item.type}-${item.id}-${i}`} className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                    <div className={`p-1.5 rounded-full shrink-0 ${item.type === "user" ? "bg-violet-100" : "bg-green-100"}`}>
                      {item.type === "user" ? <UserPlus className="w-3.5 h-3.5 text-violet-600" /> : <MapPin className="w-3.5 h-3.5 text-green-600" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{item.label}</p>
                      <p className="text-xs text-muted-foreground truncate">{item.sub}</p>
                    </div>
                    <p className="text-xs text-muted-foreground shrink-0">{fmtDate(item.date)}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── Expediente Digital Tab ────────────────────────────────────────────────────

const POST_TYPE_LABELS: Record<string, string> = {
  experience: "Experiencia", parcel_results: "Resultado", question: "Pregunta", tip: "Consejo",
};
const POST_TYPE_COLORS: Record<string, string> = {
  experience: "bg-blue-100 text-blue-700", parcel_results: "bg-green-100 text-green-700",
  question: "bg-amber-100 text-amber-700", tip: "bg-purple-100 text-purple-700",
};

function DossierStat({ icon: Icon, label, value, sub, color = "bg-primary/10 text-primary" }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="flex items-center gap-3 p-3 border rounded-xl bg-card">
      <div className={`p-2 rounded-lg shrink-0 ${color}`}><Icon className="w-4 h-4" /></div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-bold text-lg leading-tight">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

function DossierField({ label, value, icon: Icon }: { label: string; value?: string | number | null; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        {Icon && <Icon className="w-3 h-3" />}{label}
      </p>
      <p className="text-sm font-medium">{value ?? <span className="text-muted-foreground italic">—</span>}</p>
    </div>
  );
}

function ExpedienteTab({ allUsers }: { allUsers: AdminUser[] }) {
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");

  const { data: dossierData, isLoading: dossierLoading } = useQuery({
    queryKey: ["admin-dossier", selectedUserId],
    queryFn: async () => {
      const r = await fetch(`/api/admin/users/${selectedUserId}/dossier`, { credentials: "include" });
      if (!r.ok) throw new Error("Error al cargar expediente");
      return r.json();
    },
    enabled: !!selectedUserId,
    staleTime: 1000 * 60 * 5,
  });

  const filtered = allUsers.filter(u => {
    const q = search.toLowerCase();
    return (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      && (roleFilter === "all" || u.role === roleFilter);
  });

  const roleBadgeColors: Record<string, string> = { admin: "bg-purple-100 text-purple-800", farmer: "bg-green-100 text-green-800", researcher: "bg-blue-100 text-blue-800" };
  const roleLabels: Record<string, string> = { admin: "Administrador", farmer: "Técnico", researcher: "Investigador" };
  const genderLabels: Record<string, string> = { masculino: "Masculino", femenino: "Femenino", otro: "Otro", prefiero_no_decir: "Prefiero no decir" };
  const producerTypeLabels: Record<string, string> = { pequeno: "Pequeño productor", mediano: "Mediano productor", grande: "Gran productor" };
  const techLevelLabels: Record<string, string> = { basico: "Básico", intermedio: "Intermedio", avanzado: "Avanzado" };
  const parcelStatusColors: Record<string, string> = { active: "bg-green-100 text-green-800", warning: "bg-yellow-100 text-yellow-800", inactive: "bg-gray-100 text-gray-800" };
  const parcelStatusLabels: Record<string, string> = { active: "Activo", warning: "Alerta", inactive: "Inactivo" };
  const irrigationLabels: Record<string, string> = { temporal: "Temporal", goteo: "Goteo", aspersion: "Aspersión", gravedad: "Gravedad", pivote: "Pivote central", ninguno: "Sin riego" };
  const soilTypeLabels: Record<string, string> = { arcilloso: "Arcilloso", arenoso: "Arenoso", limoso: "Limoso", franco: "Franco", "franco-arcilloso": "Franco-arcilloso", "franco-arenoso": "Franco-arenoso" };

  const dossier = dossierData;

  return (
    <div className="flex flex-col lg:flex-row gap-4 min-h-[600px]">
      {/* ── Left panel: user list ── */}
      <div className="lg:w-72 shrink-0 flex flex-col border rounded-xl overflow-hidden bg-background">
        <div className="p-3 border-b bg-muted/30 space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              className="w-full pl-8 pr-3 py-1.5 text-sm border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Buscar usuario..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              data-testid="input-dossier-search"
            />
          </div>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="h-8 text-xs" data-testid="select-dossier-role"><SelectValue placeholder="Todos los roles" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los roles</SelectItem>
              <SelectItem value="admin">Administrador</SelectItem>
              <SelectItem value="farmer">Técnico</SelectItem>
              <SelectItem value="researcher">Investigador</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 overflow-y-auto divide-y">
          {filtered.length === 0 ? (
            <p className="text-center text-muted-foreground text-sm py-8">Sin resultados</p>
          ) : filtered.map(u => (
            <button
              key={u.id}
              onClick={() => setSelectedUserId(u.id)}
              className={`w-full text-left px-3 py-2.5 transition-colors hover:bg-accent flex items-center gap-2.5 ${selectedUserId === u.id ? "bg-accent border-l-2 border-primary" : ""}`}
              data-testid={`dossier-user-item-${u.id}`}
            >
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 border border-primary/20">
                {u.avatarUrl
                  ? <img src={u.avatarUrl} alt={u.name} className="w-8 h-8 rounded-full object-cover" />
                  : <span className="text-xs font-bold text-primary">{u.name.charAt(0).toUpperCase()}</span>}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{u.name}</p>
                <p className="text-xs text-muted-foreground truncate">{u.email}</p>
              </div>
              <Badge className={`text-[10px] px-1.5 py-0 shrink-0 ${roleBadgeColors[u.role]}`}>{roleLabels[u.role]?.charAt(0)}</Badge>
            </button>
          ))}
        </div>
        <div className="px-3 py-2 border-t bg-muted/20 text-xs text-muted-foreground text-center">
          {filtered.length} de {allUsers.length} usuarios
        </div>
      </div>

      {/* ── Right panel: dossier ── */}
      <div className="flex-1 overflow-y-auto">
        {!selectedUserId ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3 py-20">
            <FileText className="w-12 h-12 text-muted-foreground/40" />
            <p className="font-medium">Selecciona un usuario</p>
            <p className="text-sm text-center max-w-xs">Elige un usuario de la lista para ver su expediente digital completo.</p>
          </div>
        ) : dossierLoading ? (
          <div className="h-full flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : dossier ? (
          <div className="space-y-5">
            {/* ── 1. Portada ── */}
            <div className="border rounded-xl p-5 bg-gradient-to-br from-primary/5 to-background">
              <div className="flex items-start gap-4 flex-wrap">
                <div className="w-16 h-16 rounded-full bg-primary/10 border-2 border-primary/30 flex items-center justify-center shrink-0 overflow-hidden">
                  {dossier.user.avatarUrl
                    ? <img src={dossier.user.avatarUrl} alt={dossier.user.name} className="w-16 h-16 object-cover" />
                    : <span className="text-2xl font-bold text-primary">{dossier.user.name.charAt(0).toUpperCase()}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-xl font-bold" data-testid="dossier-name">{dossier.user.name}</h2>
                    <Badge className={roleBadgeColors[dossier.user.role]}>{roleLabels[dossier.user.role]}</Badge>
                    <Badge variant={dossier.user.isActive ? "default" : "secondary"} className={dossier.user.isActive ? "bg-green-100 text-green-800" : ""}>
                      {dossier.user.isActive ? <><BadgeCheck className="w-3 h-3 mr-1" />Activo</> : "Inactivo"}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5" data-testid="dossier-email">{dossier.user.email}</p>
                  <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5" data-testid="dossier-phone">
                    <Phone className="w-3 h-3" />
                    {dossier.user.phone ?? <span className="italic">No registrado</span>}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Registrado el {new Date(dossier.user.createdAt).toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" })}
                  </p>
                </div>
                <a href={`/parcel`} className="shrink-0">
                  <Button size="sm" variant="outline" className="gap-1.5" data-testid="dossier-link-dashboard">
                    <ExternalLink className="w-3.5 h-3.5" />Ver en plataforma
                  </Button>
                </a>
              </div>
            </div>

            {/* ── 2. Resumen estadístico ── */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">Resumen de la plataforma</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <DossierStat icon={MapPin} label="Predios registrados" value={dossier.stats.totalParcels} color="bg-green-100 text-green-700" />
                <DossierStat icon={Tractor} label="Área total" value={`${dossier.stats.totalArea} ha`} color="bg-amber-100 text-amber-700" />
                <DossierStat icon={Leaf} label="NDVI promedio" value={dossier.stats.avgNdvi !== null ? dossier.stats.avgNdvi.toFixed(3) : "—"} sub="Salud vegetal" color={dossier.stats.avgNdvi !== null && dossier.stats.avgNdvi >= 0.6 ? "bg-green-100 text-green-700" : dossier.stats.avgNdvi !== null && dossier.stats.avgNdvi >= 0.4 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"} />
                <DossierStat icon={Bell} label="Alertas activas" value={dossier.stats.alertCount} color={dossier.stats.alertCount > 0 ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"} />
                <DossierStat icon={MessageSquare} label="Posts comunidad" value={dossier.stats.communityPostsCount} color="bg-blue-100 text-blue-700" />
                <DossierStat icon={Leaf} label="Cultivos distintos" value={dossier.stats.uniqueCrops.length} sub={dossier.stats.uniqueCrops.slice(0, 2).join(", ") || "—"} color="bg-emerald-100 text-emerald-700" />
              </div>
            </div>

            {/* ── 3. Datos de contacto y ubicación ── */}
            <div className="border rounded-xl p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5" />Contacto y ubicación
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <DossierField label="Correo electrónico" value={dossier.user.email} icon={undefined} />
                <DossierField label="Teléfono" value={dossier.user.phone} icon={Phone} />
                <DossierField label="Estado / Región" value={dossier.user.state} icon={MapPin} />
                <DossierField label="Municipio" value={dossier.user.municipality} />
                <DossierField label="Localidad" value={dossier.user.locality} />
              </div>
            </div>

            {/* ── 4. Perfil del productor ── */}
            <div className="border rounded-xl p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" />Perfil del productor
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <DossierField label="Edad" value={dossier.user.age != null ? `${dossier.user.age} años` : null} />
                <DossierField label="Género" value={dossier.user.gender ? genderLabels[dossier.user.gender] || dossier.user.gender : null} />
                <DossierField label="Años de escolaridad" value={dossier.user.schoolingYears != null ? `${dossier.user.schoolingYears} años` : null} icon={GraduationCap} />
                <DossierField label="Exp. agrícola" value={dossier.user.farmingExperienceYears != null ? `${dossier.user.farmingExperienceYears} años` : null} />
                <DossierField label="Tipo de productor" value={dossier.user.producerType ? producerTypeLabels[dossier.user.producerType] || dossier.user.producerType : null} />
                <DossierField label="Nivel tecnológico" value={dossier.user.techLevel ? techLevelLabels[dossier.user.techLevel] || dossier.user.techLevel : null} icon={Cpu} />
              </div>
              <div className="mt-4 flex gap-4 flex-wrap">
                <div className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border ${dossier.user.hasDrones ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-muted/30 text-muted-foreground"}`}>
                  <Tractor className="w-3.5 h-3.5" />
                  Drones: {dossier.user.hasDrones ? "Sí" : "No"}
                </div>
                <div className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border ${dossier.user.hasIoT ? "bg-cyan-50 border-cyan-200 text-cyan-700" : "bg-muted/30 text-muted-foreground"}`}>
                  <Wifi className="w-3.5 h-3.5" />
                  IoT: {dossier.user.hasIoT ? "Sí" : "No"}
                </div>
              </div>
            </div>

            {/* ── 5. Sistema de producción ── */}
            {((dossier.user.farmingTypes?.length > 0) || (dossier.user.currentPractices?.length > 0)) && (
              <div className="border rounded-xl p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                  <Leaf className="w-3.5 h-3.5" />Sistema de producción
                </p>
                {dossier.user.farmingTypes?.length > 0 && (
                  <div className="mb-3">
                    <p className="text-xs text-muted-foreground mb-1.5">Tipos de agricultura</p>
                    <div className="flex flex-wrap gap-1.5">
                      {dossier.user.farmingTypes.map((ft: string) => (
                        <Badge key={ft} variant="secondary" className="text-xs">{ft}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {dossier.user.currentPractices?.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5">Prácticas actuales</p>
                    <div className="flex flex-wrap gap-1.5">
                      {dossier.user.currentPractices.map((pr: string) => (
                        <Badge key={pr} variant="outline" className="text-xs border-green-300 text-green-700 bg-green-50">{pr}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── 6. Predios ── */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" />Predios ({dossier.parcels.length})
              </p>
              {dossier.parcels.length === 0 ? (
                <div className="border rounded-xl p-6 text-center text-muted-foreground text-sm">
                  Este usuario no tiene predios registrados.
                </div>
              ) : (
                <div className="space-y-3">
                  {dossier.parcels.map((parcel: any) => (
                    <div key={parcel.id} className="border rounded-xl p-4 hover:bg-accent/20 transition-colors" data-testid={`dossier-parcel-${parcel.id}`}>
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold">{parcel.name}</p>
                            <Badge className={`text-xs ${parcelStatusColors[parcel.status] || "bg-gray-100 text-gray-700"}`}>{parcelStatusLabels[parcel.status] || parcel.status}</Badge>
                            {parcel.isPublic && <Badge variant="outline" className="text-xs border-blue-300 text-blue-600">Pública</Badge>}
                          </div>
                          <p className="text-sm text-muted-foreground mt-0.5">{parcel.location}</p>
                        </div>
                        <a href={`/parcel/${parcel.id}`} data-testid={`dossier-parcel-link-${parcel.id}`}>
                          <Button size="icon" variant="ghost" className="w-7 h-7 shrink-0"><ExternalLink className="w-3.5 h-3.5" /></Button>
                        </a>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-3">
                        <div>
                          <p className="text-xs text-muted-foreground">Cultivo</p>
                          <p className="font-medium">{parcel.crop || "—"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Área</p>
                          <p className="font-medium">{parseFloat(parcel.area || "0").toFixed(1)} ha</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Tipo de suelo</p>
                          <p className="font-medium">{parcel.soilType ? soilTypeLabels[parcel.soilType] || parcel.soilType : "—"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Riego</p>
                          <p className="font-medium">{parcel.irrigationSystem ? irrigationLabels[parcel.irrigationSystem] || parcel.irrigationSystem : "—"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Etapa</p>
                          <p className="font-medium capitalize">{parcel.phenologicalStage || "—"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Coordenadas</p>
                          <p className="font-medium text-xs">{parcel.latitude && parcel.longitude ? `${parseFloat(parcel.latitude).toFixed(4)}, ${parseFloat(parcel.longitude).toFixed(4)}` : "—"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">IoT / Drones</p>
                          <p className="font-medium">{parcel.iotDeviceCount} disp. · {parcel.droneFlightCount} vuelos</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Alertas</p>
                          <p className={`font-medium ${parcel.alertCount > 0 ? "text-red-600" : "text-muted-foreground"}`}>{parcel.alertCount > 0 ? `${parcel.alertCount} activas` : "Sin alertas"}</p>
                        </div>
                      </div>

                      {/* Satellite indices */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {[
                          { label: "NDVI", value: parcel.latestNdvi, color: "text-green-700 bg-green-50 border-green-200" },
                          { label: "EVI", value: parcel.latestEvi, color: "text-emerald-700 bg-emerald-50 border-emerald-200" },
                          { label: "Hum. suelo", value: parcel.latestSoilMoisture ? `${parseFloat(parcel.latestSoilMoisture).toFixed(1)}%` : null, raw: true, color: "text-blue-700 bg-blue-50 border-blue-200" },
                          { label: "pH suelo", value: parcel.latestSoilPh ? parseFloat(parcel.latestSoilPh).toFixed(1) : null, raw: true, color: "text-amber-700 bg-amber-50 border-amber-200" },
                        ].map(idx => (
                          <div key={idx.label} className={`flex items-center justify-between px-3 py-1.5 rounded-lg border text-xs ${idx.color}`}>
                            <span className="font-medium">{idx.label}</span>
                            <span className="font-bold">{idx.value !== null && idx.value !== undefined ? (idx.raw ? idx.value : parseFloat(idx.value as string).toFixed(3)) : "—"}</span>
                          </div>
                        ))}
                      </div>
                      {parcel.latestDataDate && (
                        <p className="text-xs text-muted-foreground mt-2 text-right">
                          Última lectura satelital: {new Date(parcel.latestDataDate).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── 7. Actividad en la comunidad ── */}
            {dossier.recentPosts?.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1 flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5" />Actividad reciente en la comunidad
                </p>
                <div className="space-y-2">
                  {dossier.recentPosts.map((post: any) => (
                    <div key={post.id} className="border rounded-xl px-4 py-3 flex items-start gap-3" data-testid={`dossier-post-${post.id}`}>
                      <Badge className={`text-xs mt-0.5 shrink-0 ${POST_TYPE_COLORS[post.type] || "bg-gray-100 text-gray-700"}`}>{POST_TYPE_LABELS[post.type] || post.type}</Badge>
                      <p className="text-sm flex-1 text-muted-foreground line-clamp-2">{post.content || "—"}</p>
                      <div className="shrink-0 text-right">
                        <p className="text-xs text-muted-foreground">{new Date(post.createdAt).toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}</p>
                        {post.likesCount > 0 && <p className="text-xs text-muted-foreground">♥ {post.likesCount}</p>}
                      </div>
                    </div>
                  ))}
                </div>
                {dossier.stats.communityPostsCount > 5 && (
                  <p className="text-xs text-muted-foreground text-center mt-2">
                    Mostrando 5 de {dossier.stats.communityPostsCount} publicaciones totales.
                  </p>
                )}
              </div>
            )}

            {/* Footer */}
            <div className="border-t pt-3 text-xs text-muted-foreground flex items-center justify-between flex-wrap gap-1">
              <span>ID: <code className="bg-muted px-1 rounded text-xs">{dossier.user.id}</code></span>
              <span>Generado el {new Date().toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center py-20 text-muted-foreground text-sm">
            Error al cargar el expediente.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AdminPanel() {
  const { user, isAdmin, isLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useI18n();

  const [conferenceForm, setConferenceForm] = useState({ title: "", description: "", videoUrl: "", thumbnailUrl: "", speaker: "", speakerBio: "", eventDate: "", tags: "", status: "draft", isFeatured: false });
  const [editingConference, setEditingConference] = useState<any>(null);
  const [showConferenceDialog, setShowConferenceDialog] = useState(false);
  const [thumbnailUploading, setThumbnailUploading] = useState(false);
  const [thumbnailDetecting, setThumbnailDetecting] = useState(false);
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null);
  const thumbnailInputRef = useRef<HTMLInputElement>(null);

  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [showUserProfileDialog, setShowUserProfileDialog] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [passwordTargetUser, setPasswordTargetUser] = useState<AdminUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [userSearch, setUserSearch] = useState("");
  const [userRoleFilter, setUserRoleFilter] = useState("all");
  const [parcelSearch, setParcelSearch] = useState("");
  const [parcelStatusFilter, setParcelStatusFilter] = useState("all");

  // ── Queries ──

  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => { const r = await fetch("/api/admin/stats", { credentials: "include" }); if (!r.ok) throw new Error(); return r.json(); },
  });
  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => { const r = await fetch("/api/admin/users", { credentials: "include" }); if (!r.ok) throw new Error(); return r.json(); },
  });
  const { data: parcelsData, isLoading: parcelsLoading } = useQuery({
    queryKey: ["admin-parcels"],
    queryFn: async () => { const r = await fetch("/api/admin/parcels", { credentials: "include" }); if (!r.ok) throw new Error(); return r.json(); },
  });
  const { data: conferencesData, isLoading: conferencesLoading } = useQuery({
    queryKey: ["admin-conferences"],
    queryFn: async () => { const r = await fetch("/api/admin/conferences", { credentials: "include" }); if (!r.ok) throw new Error(); return r.json(); },
  });
  const { data: activityData } = useQuery({
    queryKey: ["admin-activity"],
    queryFn: async () => { const r = await fetch("/api/admin/activity", { credentials: "include" }); if (!r.ok) return { activity: [] }; return r.json(); },
  });

  // User parcels (fetched when profile dialog opens)
  const { data: userParcelsData } = useQuery({
    queryKey: ["admin-user-parcels", selectedUser?.id],
    queryFn: async () => {
      if (!selectedUser) return { parcels: [] };
      const r = await fetch(`/api/admin/users/${selectedUser.id}/parcels`, { credentials: "include" });
      if (!r.ok) return { parcels: [] };
      return r.json();
    },
    enabled: !!selectedUser && showUserProfileDialog,
  });

  // ── Mutations ──

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const r = await fetch(`/api/admin/users/${userId}/role`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ role }) });
      if (!r.ok) throw new Error("Error al actualizar rol");
      return r.json();
    },
    onSuccess: (data) => { queryClient.invalidateQueries({ queryKey: ["admin-users"] }); queryClient.invalidateQueries({ queryKey: ["admin-stats"] }); toast({ title: t("admin.roleUpdated"), description: data.message }); },
    onError: (e: any) => toast({ title: t("admin.error"), description: e.message, variant: "destructive" }),
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ userId, isActive }: { userId: string; isActive: boolean }) => {
      const r = await fetch(`/api/admin/users/${userId}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ isActive }) });
      if (!r.ok) throw new Error("Error al actualizar estado");
      return r.json();
    },
    onSuccess: (data) => { queryClient.invalidateQueries({ queryKey: ["admin-users"] }); queryClient.invalidateQueries({ queryKey: ["admin-stats"] }); toast({ title: t("admin.statusUpdated"), description: data.message }); },
    onError: (e: any) => toast({ title: t("admin.error"), description: e.message, variant: "destructive" }),
  });

  const changePasswordMutation = useMutation({
    mutationFn: async ({ userId, password }: { userId: string; password: string }) => {
      const r = await fetch(`/api/admin/users/${userId}/password`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ password }) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.message); }
      return r.json();
    },
    onSuccess: (data) => {
      toast({ title: "Contraseña actualizada", description: data.message });
      setShowPasswordDialog(false);
      setNewPassword("");
      setConfirmPassword("");
      setPasswordTargetUser(null);
    },
    onError: (e: any) => toast({ title: t("admin.error"), description: e.message, variant: "destructive" }),
  });

  const updateParcelMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Record<string, any> }) => {
      const r = await fetch(`/api/admin/parcels/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(updates) });
      if (!r.ok) throw new Error("Error al actualizar predio");
      return r.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["admin-parcels"] }); toast({ title: "Predio actualizado" }); },
    onError: (e: any) => toast({ title: t("admin.error"), description: e.message, variant: "destructive" }),
  });

  const createConferenceMutation = useMutation({
    mutationFn: async (data: any) => { const r = await fetch("/api/conferences", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(data) }); if (!r.ok) { const e = await r.json(); throw new Error(e.message); } return r.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["admin-conferences"] }); setShowConferenceDialog(false); resetConferenceForm(); toast({ title: "Conferencia creada" }); },
    onError: (e: any) => toast({ title: t("admin.error"), description: e.message, variant: "destructive" }),
  });
  const updateConferenceMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => { const r = await fetch(`/api/conferences/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(data) }); if (!r.ok) { const e = await r.json(); throw new Error(e.message); } return r.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["admin-conferences"] }); setShowConferenceDialog(false); setEditingConference(null); resetConferenceForm(); toast({ title: "Conferencia actualizada" }); },
    onError: (e: any) => toast({ title: t("admin.error"), description: e.message, variant: "destructive" }),
  });
  const deleteConferenceMutation = useMutation({
    mutationFn: async (id: number) => { const r = await fetch(`/api/conferences/${id}`, { method: "DELETE", credentials: "include" }); if (!r.ok) { const e = await r.json(); throw new Error(e.message); } return r.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["admin-conferences"] }); toast({ title: "Conferencia eliminada" }); },
    onError: (e: any) => toast({ title: t("admin.error"), description: e.message, variant: "destructive" }),
  });
  const toggleFeaturedMutation = useMutation({
    mutationFn: async ({ id, isFeatured }: { id: number; isFeatured: boolean }) => { const r = await fetch(`/api/conferences/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ isFeatured }) }); if (!r.ok) throw new Error(); return r.json(); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-conferences"] }),
    onError: (e: any) => toast({ title: t("admin.error"), description: e.message, variant: "destructive" }),
  });
  const toggleStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => { const r = await fetch(`/api/conferences/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ status }) }); if (!r.ok) throw new Error(); return r.json(); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-conferences"] }),
    onError: (e: any) => toast({ title: t("admin.error"), description: e.message, variant: "destructive" }),
  });

  // ── Conference helpers ──

  async function handleThumbnailUpload(file: File) {
    setThumbnailUploading(true);
    try {
      const res = await fetch("/api/uploads/conference-thumbnail", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      const { uploadURL, objectPath } = await res.json();
      await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      setConferenceForm(prev => ({ ...prev, thumbnailUrl: objectPath }));
      setThumbnailPreview(URL.createObjectURL(file));
      toast({ title: "Miniatura subida correctamente" });
    } catch (e: any) {
      toast({ title: "Error al subir miniatura", description: e.message, variant: "destructive" });
    } finally { setThumbnailUploading(false); }
  }

  async function handleAutoDetectThumbnail() {
    if (!conferenceForm.videoUrl) return;
    setThumbnailDetecting(true);
    try {
      const res = await fetch("/api/conferences/fetch-og-image", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ videoUrl: conferenceForm.videoUrl }) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      const { imageUrl } = await res.json();
      setConferenceForm(prev => ({ ...prev, thumbnailUrl: imageUrl }));
      setThumbnailPreview(imageUrl);
      toast({ title: "Miniatura detectada automáticamente" });
    } catch (e: any) {
      toast({ title: "No se pudo detectar miniatura", description: e.message || "Sube una imagen manualmente.", variant: "destructive" });
    } finally { setThumbnailDetecting(false); }
  }

  function resetConferenceForm() { setConferenceForm({ title: "", description: "", videoUrl: "", thumbnailUrl: "", speaker: "", speakerBio: "", eventDate: "", tags: "", status: "draft", isFeatured: false }); setThumbnailPreview(null); }
  function openCreateDialog() { setEditingConference(null); resetConferenceForm(); setShowConferenceDialog(true); }
  function openEditDialog(conf: Conference) {
    setEditingConference(conf);
    setConferenceForm({ title: conf.title, description: conf.description, videoUrl: conf.videoUrl || "", thumbnailUrl: conf.thumbnailUrl || "", speaker: conf.speaker || "", speakerBio: conf.speakerBio || "", eventDate: conf.eventDate ? conf.eventDate.split("T")[0] : "", tags: conf.tags ? conf.tags.join(", ") : "", status: conf.status, isFeatured: conf.isFeatured });
    setThumbnailPreview(conf.thumbnailUrl || null);
    setShowConferenceDialog(true);
  }
  function handleConferenceSubmit() {
    const payload: any = { title: conferenceForm.title, description: conferenceForm.description, videoUrl: conferenceForm.videoUrl || undefined, thumbnailUrl: conferenceForm.thumbnailUrl || undefined, speaker: conferenceForm.speaker || undefined, speakerBio: conferenceForm.speakerBio || undefined, eventDate: conferenceForm.eventDate || undefined, tags: conferenceForm.tags ? conferenceForm.tags.split(",").map((t: string) => t.trim()).filter(Boolean) : [], status: conferenceForm.status, isFeatured: conferenceForm.isFeatured };
    if (editingConference) updateConferenceMutation.mutate({ id: editingConference.id, data: payload });
    else createConferenceMutation.mutate(payload);
  }
  function handleDeleteConference(conf: Conference) { if (window.confirm(t("conferences.deleteConfirm"))) deleteConferenceMutation.mutate(conf.id); }
  function openUserProfile(u: AdminUser) { setSelectedUser(u); setShowUserProfileDialog(true); }

  // ── Guards ──

  if (isLoading) return <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
  if (!isAdmin) return <Redirect to="/dashboard" />;

  // ── Derived ──

  const stats: AdminStats = statsData?.stats || { totalUsers: 0, activeUsers: 0, usersByRole: { admin: 0, farmer: 0, researcher: 0 }, totalParcels: 0, publicParcels: 0, parcelsByStatus: { active: 0, warning: 0, inactive: 0 } };
  const allUsers: AdminUser[] = usersData?.users || [];
  const allParcels: AdminParcel[] = parcelsData?.parcels || [];
  const conferences: Conference[] = conferencesData?.conferences || conferencesData || [];
  const activity: ActivityItem[] = activityData?.activity || [];
  const userParcels: any[] = userParcelsData?.parcels || [];

  const users = allUsers.filter(u => {
    const q = userSearch.toLowerCase();
    return (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) && (userRoleFilter === "all" || u.role === userRoleFilter);
  });
  const parcels = allParcels.filter(p => {
    const q = parcelSearch.toLowerCase();
    return (!q || p.name.toLowerCase().includes(q) || p.ownerName.toLowerCase().includes(q) || p.crop.toLowerCase().includes(q) || p.location.toLowerCase().includes(q)) && (parcelStatusFilter === "all" || p.status === parcelStatusFilter);
  });

  const roleLabels: Record<string, string> = { admin: t("admin.administrator"), farmer: t("admin.technicians"), researcher: t("admin.researchers") };
  const roleBadgeColors: Record<string, string> = { admin: "bg-purple-100 text-purple-800", farmer: "bg-green-100 text-green-800", researcher: "bg-blue-100 text-blue-800" };
  const parcelStatusColors: Record<string, string> = { active: "bg-green-100 text-green-800", warning: "bg-yellow-100 text-yellow-800", inactive: "bg-gray-100 text-gray-800" };
  const parcelStatusLabels: Record<string, string> = { active: "Activo", warning: "Alerta", inactive: "Inactivo" };
  const statusBadgeColors: Record<string, string> = { draft: "bg-yellow-100 text-yellow-800", published: "bg-green-100 text-green-800", archived: "bg-gray-100 text-gray-800" };
  const statusLabels: Record<string, string> = { draft: "Borrador", published: "Publicada", archived: "Archivada" };
  const genderLabels: Record<string, string> = { masculino: "Masculino", femenino: "Femenino", otro: "Otro", prefiero_no_decir: "Prefiero no decir" };
  const producerTypeLabels: Record<string, string> = { pequeno: "Pequeño productor", mediano: "Mediano productor", grande: "Gran productor" };
  const techLevelLabels: Record<string, string> = { basico: "Básico", intermedio: "Intermedio", avanzado: "Avanzado" };

  const activeRatio = stats.totalUsers > 0 ? (stats.activeUsers / stats.totalUsers) * 100 : 0;
  const activeParcelRatio = stats.totalParcels > 0 ? (stats.parcelsByStatus.active / stats.totalParcels) * 100 : 0;
  const alertParcelRatio = stats.totalParcels > 0 ? (stats.parcelsByStatus.warning / stats.totalParcels) * 100 : 0;

  // CSV exports
  function exportUsers() {
    exportCSV("usuarios_agregen.csv", allUsers.map(u => [u.name, u.email, u.role, u.isActive ? "Activo" : "Inactivo", u.state || "", u.municipality || "", u.locality || "", u.producerType || "", new Date(u.createdAt).toLocaleDateString("es-MX")]), ["Nombre", "Correo", "Rol", "Estado", "Estado/Región", "Municipio", "Localidad", "Tipo de productor", "Fecha registro"]);
    toast({ title: "Exportación completada", description: `${allUsers.length} usuarios descargados` });
  }
  function exportParcels() {
    exportCSV("predios_agregen.csv", allParcels.map(p => [p.name, p.ownerName, p.ownerEmail, p.crop, p.area, p.status, p.isPublic ? "Sí" : "No", p.location, p.soilType || "", p.irrigationSystem || "", fmt(p.latestNdvi), fmt(p.latestEvi), p.latestDataDate ? fmtDate(p.latestDataDate) : "", new Date(p.createdAt).toLocaleDateString("es-MX")]), ["Nombre", "Propietario", "Correo propietario", "Cultivo", "Área (ha)", "Estado", "Público", "Ubicación", "Tipo suelo", "Riego", "NDVI", "EVI", "Última lectura", "Fecha registro"]);
    toast({ title: "Exportación completada", description: `${allParcels.length} predios descargados` });
  }

  // ── Render ──

  return (
    <div className="container mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="bg-primary/10 p-2.5 rounded-xl"><Shield className="h-5 w-5 sm:h-6 sm:w-6 text-primary" /></div>
          <div>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-heading font-bold">{t("admin.title")}</h1>
            <p className="text-muted-foreground text-xs sm:text-sm">{t("admin.subtitle")}</p>
          </div>
        </div>
        <Badge variant="outline" className="gap-1.5 text-xs sm:text-sm px-2 sm:px-3 py-1">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />Sistema activo
        </Badge>
      </div>

      {/* Stats */}
      {statsLoading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card data-testid="card-stat-total-users" className="border-0 shadow-sm bg-gradient-to-br from-slate-50 to-white">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-start justify-between mb-3">
                <div><p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("admin.totalUsers")}</p><p className="text-4xl font-bold mt-1" data-testid="text-total-users">{stats.totalUsers}</p></div>
                <div className="bg-violet-100 p-2 rounded-lg"><Users className="h-5 w-5 text-violet-600" /></div>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground"><span data-testid="text-active-users">{stats.activeUsers} activos</span><span>{activeRatio.toFixed(0)}%</span></div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden"><div className="h-full bg-violet-500 rounded-full" style={{ width: `${activeRatio}%` }} /></div>
                <div className="flex gap-2 text-xs mt-2 flex-wrap">
                  <span className="bg-green-50 text-green-700 px-1.5 py-0.5 rounded">{stats.usersByRole.farmer} técnicos</span>
                  <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">{stats.usersByRole.researcher} invest.</span>
                  <span className="bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded">{stats.usersByRole.admin} admin</span>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card data-testid="card-stat-parcels" className="border-0 shadow-sm bg-gradient-to-br from-green-50 to-white">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-start justify-between mb-3">
                <div><p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("admin.totalParcels")}</p><p className="text-4xl font-bold mt-1" data-testid="text-total-parcels">{stats.totalParcels}</p></div>
                <div className="bg-green-100 p-2 rounded-lg"><MapPin className="h-5 w-5 text-green-600" /></div>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground"><span>{stats.parcelsByStatus.active} activos</span><span>{activeParcelRatio.toFixed(0)}%</span></div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden flex"><div className="h-full bg-green-500 rounded-l-full" style={{ width: `${activeParcelRatio}%` }} /><div className="h-full bg-yellow-400" style={{ width: `${alertParcelRatio}%` }} /></div>
                <div className="flex gap-2 text-xs mt-2 flex-wrap">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" />{stats.parcelsByStatus.active} activos</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400" />{stats.parcelsByStatus.warning} alertas</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300" />{stats.parcelsByStatus.inactive} inactivos</span>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card data-testid="card-stat-farmers" className="border-0 shadow-sm bg-gradient-to-br from-emerald-50 to-white">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-start justify-between mb-3">
                <div><p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("admin.technicians")}</p><p className="text-4xl font-bold mt-1" data-testid="text-farmers-count">{stats.usersByRole.farmer}</p></div>
                <div className="bg-emerald-100 p-2 rounded-lg"><UserCheck className="h-5 w-5 text-emerald-600" /></div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">Productores y técnicos de campo registrados</p>
            </CardContent>
          </Card>
          <Card data-testid="card-stat-researchers" className="border-0 shadow-sm bg-gradient-to-br from-blue-50 to-white">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-start justify-between mb-3">
                <div><p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("admin.researchers")}</p><p className="text-4xl font-bold mt-1" data-testid="text-researchers-count">{stats.usersByRole.researcher}</p></div>
                <div className="bg-blue-100 p-2 rounded-lg"><BarChart3 className="h-5 w-5 text-blue-600" /></div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">{stats.publicParcels} predio{stats.publicParcels !== 1 ? "s" : ""} público{stats.publicParcels !== 1 ? "s" : ""} para investigación</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="analytics" className="space-y-6">
        <TabsList className="w-full overflow-x-auto flex-nowrap justify-start h-auto gap-0.5 p-1">
          <TabsTrigger value="analytics" data-testid="tab-analytics" className="gap-1.5 shrink-0 text-xs sm:text-sm">
            <TrendingUp className="w-4 h-4 shrink-0" /><span className="hidden sm:inline">Analítica</span><span className="sm:hidden">Stats</span>
          </TabsTrigger>
          <TabsTrigger value="map" data-testid="tab-map" className="gap-1.5 shrink-0 text-xs sm:text-sm">
            <Map className="w-4 h-4 shrink-0" /><span className="hidden sm:inline">Mapa comunidad</span><span className="sm:hidden">Mapa</span>
          </TabsTrigger>
          <TabsTrigger value="users" data-testid="tab-users" className="gap-1.5 shrink-0 text-xs sm:text-sm">
            <Users className="w-4 h-4 shrink-0" />Usuarios
          </TabsTrigger>
          <TabsTrigger value="parcels" data-testid="tab-parcels" className="gap-1.5 shrink-0 text-xs sm:text-sm">
            <Layers className="w-4 h-4 shrink-0" />Predios
          </TabsTrigger>
          <TabsTrigger value="conferences" data-testid="tab-conferences" className="gap-1.5 shrink-0 text-xs sm:text-sm">
            <GraduationCap className="w-4 h-4 shrink-0" /><span className="hidden sm:inline">{t("conferences.title")}</span><span className="sm:hidden">Conf.</span>
          </TabsTrigger>
          <TabsTrigger value="expediente" data-testid="tab-expediente" className="gap-1.5 shrink-0 text-xs sm:text-sm">
            <FileText className="w-4 h-4 shrink-0" /><span className="hidden sm:inline">Expediente</span><span className="sm:hidden">Exp.</span>
          </TabsTrigger>
          <TabsTrigger value="whatsapp-support" data-testid="tab-whatsapp-support" className="gap-1.5 shrink-0 text-xs sm:text-sm">
            <MessageSquare className="w-4 h-4 shrink-0" /><span className="hidden sm:inline">Soporte WhatsApp</span><span className="sm:hidden">WA</span>
          </TabsTrigger>
        </TabsList>

        {/* ── Analytics Tab ── */}
        <TabsContent value="analytics">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2"><TrendingUp className="w-5 h-5 text-primary" />Analítica de la plataforma</CardTitle>
              <CardDescription>Distribución de cultivos, salud del suelo, predios en riesgo y actividad reciente.</CardDescription>
            </CardHeader>
            <CardContent>
              {parcelsLoading || usersLoading ? (
                <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
              ) : (
                <AnalyticsTab parcels={allParcels} users={allUsers} activity={activity} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Map Tab ── */}
        <TabsContent value="map">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2"><Map className="w-5 h-5 text-primary" />Mapa de la comunidad</CardTitle>
              <CardDescription>Todos los predios georreferenciados con indicadores satelitales y navegación rápida.</CardDescription>
            </CardHeader>
            <CardContent>
              {parcelsLoading ? <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div> : <CommunityMapTab parcels={allParcels} />}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Users Tab ── */}
        <TabsContent value="users">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div><CardTitle>{t("admin.userManagement")}</CardTitle><CardDescription>{t("admin.userManagementDesc")}</CardDescription></div>
                <Button variant="outline" size="sm" onClick={exportUsers} data-testid="button-export-users">
                  <Download className="w-4 h-4 mr-2" />Exportar CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input className="pl-9" placeholder="Buscar por nombre o correo..." value={userSearch} onChange={e => setUserSearch(e.target.value)} data-testid="input-user-search" />
                </div>
                <Select value={userRoleFilter} onValueChange={setUserRoleFilter}>
                  <SelectTrigger className="w-[160px]" data-testid="select-user-role-filter">
                    <Filter className="w-3 h-3 mr-1" /><SelectValue placeholder="Rol" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos los roles</SelectItem>
                    <SelectItem value="admin">{t("admin.administrator")}</SelectItem>
                    <SelectItem value="farmer">{t("auth.technician")}</SelectItem>
                    <SelectItem value="researcher">{t("auth.researcher")}</SelectItem>
                  </SelectContent>
                </Select>
                <span className="flex items-center text-sm text-muted-foreground">{users.length} de {allUsers.length} usuarios</span>
              </div>
              {usersLoading ? <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                : users.length === 0 ? <p className="text-center text-muted-foreground py-8">{t("admin.noUsers")}</p>
                : (
                  <div className="space-y-2">
                    {users.map(u => (
                      <div key={u.id} className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 border rounded-xl transition-colors hover:bg-accent/30 ${!u.isActive ? "opacity-60" : ""}`} data-testid={`user-row-${u.id}`}>
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0 border-2 border-primary/20">
                            {u.avatarUrl ? <img src={u.avatarUrl} alt={u.name} className="w-10 h-10 rounded-full object-cover" /> : <span className="font-bold text-primary">{u.name.charAt(0).toUpperCase()}</span>}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold truncate">{u.name}</p>
                              <Badge className={`text-xs ${roleBadgeColors[u.role]}`}>{roleLabels[u.role]}</Badge>
                              {!u.isActive && <Badge variant="secondary" className="text-xs">{t("admin.inactiveLabel")}</Badge>}
                              {u.id === user?.id && <Badge variant="outline" className="text-xs">{t("admin.youLabel")}</Badge>}
                            </div>
                            <p className="text-sm text-muted-foreground">{u.email}</p>
                            {u.locality && <p className="text-xs text-muted-foreground">{u.locality}, {u.municipality}</p>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap sm:justify-end shrink-0">
                          <Button variant="ghost" size="sm" onClick={() => openUserProfile(u)} data-testid={`button-view-profile-${u.id}`}>
                            <ChevronRight className="w-4 h-4 mr-1" />Ver perfil
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => { setPasswordTargetUser(u); setNewPassword(""); setConfirmPassword(""); setShowPasswordDialog(true); }} data-testid={`button-change-password-${u.id}`}>
                            <Lock className="w-3.5 h-3.5 mr-1" />Contraseña
                          </Button>
                          <Select value={u.role} onValueChange={value => updateRoleMutation.mutate({ userId: u.id, role: value })} disabled={u.id === user?.id}>
                            <SelectTrigger className="w-[130px] text-xs h-8" data-testid={`select-role-${u.id}`}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">{t("admin.administrator")}</SelectItem>
                              <SelectItem value="farmer">{t("auth.technician")}</SelectItem>
                              <SelectItem value="researcher">{t("auth.researcher")}</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button variant={u.isActive ? "outline" : "default"} size="sm" className="h-8 text-xs" onClick={() => updateStatusMutation.mutate({ userId: u.id, isActive: !u.isActive })} disabled={u.id === user?.id} data-testid={`button-toggle-status-${u.id}`}>
                            {u.isActive ? <><UserX className="w-3.5 h-3.5 mr-1" />{t("admin.deactivate")}</> : <><UserCheck className="w-3.5 h-3.5 mr-1" />{t("admin.activate")}</>}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Parcels Tab ── */}
        <TabsContent value="parcels">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div><CardTitle>Predios registrados</CardTitle><CardDescription>Todos los predios con indicadores satelitales. Puedes cambiar estado y visibilidad directamente.</CardDescription></div>
                <Button variant="outline" size="sm" onClick={exportParcels} data-testid="button-export-parcels">
                  <Download className="w-4 h-4 mr-2" />Exportar CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input className="pl-9" placeholder="Buscar por nombre, productor, cultivo..." value={parcelSearch} onChange={e => setParcelSearch(e.target.value)} data-testid="input-parcel-search" />
                </div>
                <Select value={parcelStatusFilter} onValueChange={setParcelStatusFilter}>
                  <SelectTrigger className="w-[150px]" data-testid="select-parcel-status-filter">
                    <Filter className="w-3 h-3 mr-1" /><SelectValue placeholder="Estado" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="active">Activo</SelectItem>
                    <SelectItem value="warning">Alerta</SelectItem>
                    <SelectItem value="inactive">Inactivo</SelectItem>
                  </SelectContent>
                </Select>
                <span className="flex items-center text-sm text-muted-foreground">{parcels.length} de {allParcels.length} predios</span>
              </div>
              {parcelsLoading ? <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                : parcels.length === 0 ? <p className="text-center text-muted-foreground py-8">No hay predios registrados.</p>
                : (
                  <div className="space-y-3">
                    {parcels.map(p => {
                      const ndviVal = p.latestNdvi ? parseFloat(p.latestNdvi) : null;
                      const ndviLabel = ndviVal === null ? null : ndviVal >= 0.6 ? "óptimo" : ndviVal >= 0.4 ? "moderado" : "bajo";
                      return (
                        <div key={p.id} className="border rounded-xl p-4 space-y-3 hover:shadow-sm transition-shadow" data-testid={`parcel-row-${p.id}`}>
                          <div className="flex items-start justify-between gap-4 flex-wrap">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-semibold">{p.name}</p>
                                <Badge className={parcelStatusColors[p.status] || "bg-gray-100 text-gray-800"}>
                                  {p.status === "active" && <CheckCircle2 className="w-3 h-3 mr-1" />}
                                  {p.status === "warning" && <AlertTriangle className="w-3 h-3 mr-1" />}
                                  {parcelStatusLabels[p.status] || p.status}
                                </Badge>
                                {p.isPublic && <Badge variant="outline" className="text-xs border-blue-300 text-blue-700 flex items-center gap-1"><Globe className="w-3 h-3" />Público</Badge>}
                              </div>
                              <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1"><MapPin className="w-3 h-3 shrink-0" />{p.location}</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0 flex-wrap">
                              <div>
                                <p className="text-xs text-muted-foreground">Propietario</p>
                                <p className="text-sm font-medium">{p.ownerName}</p>
                              </div>
                              {/* Admin controls */}
                              <Select value={p.status} onValueChange={val => updateParcelMutation.mutate({ id: p.id, updates: { status: val } })}>
                                <SelectTrigger className="w-[100px] h-8 text-xs" data-testid={`select-parcel-status-${p.id}`}><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="active">Activo</SelectItem>
                                  <SelectItem value="warning">Alerta</SelectItem>
                                  <SelectItem value="inactive">Inactivo</SelectItem>
                                </SelectContent>
                              </Select>
                              <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => updateParcelMutation.mutate({ id: p.id, updates: { isPublic: !p.isPublic } })} data-testid={`button-toggle-public-${p.id}`}>
                                {p.isPublic ? <><Lock className="w-3 h-3" />Privar</> : <><Globe className="w-3 h-3" />Publicar</>}
                              </Button>
                              <a href={`/parcel/${p.id}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium" data-testid={`link-parcel-detail-${p.id}`}>
                                Ver <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                            <div><span className="text-muted-foreground">Cultivo: </span><span className="font-medium">{p.crop}</span></div>
                            <div><span className="text-muted-foreground">Área: </span><span className="font-medium">{parseFloat(p.area).toFixed(1)} ha</span></div>
                            <div><span className="text-muted-foreground">Suelo: </span><span className="font-medium">{p.soilType || "—"}</span></div>
                            <div><span className="text-muted-foreground">Riego: </span><span className="font-medium">{p.irrigationSystem || "—"}</span></div>
                          </div>
                          <div className="bg-muted/30 rounded-lg p-3 border border-muted/60">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Indicadores satelitales</p>
                              {p.latestDataDate && <span className="text-xs text-muted-foreground">{fmtDate(p.latestDataDate)}</span>}
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                              <div className="flex items-center gap-2"><div className="p-1.5 bg-green-100 rounded"><Leaf className="w-3.5 h-3.5 text-green-600" /></div><div><p className="text-xs text-muted-foreground">NDVI</p><p className={`text-sm ${ndviTextColor(p.latestNdvi)}`} data-testid={`text-ndvi-${p.id}`}>{fmt(p.latestNdvi)}{ndviLabel && <span className="text-xs font-normal ml-1 opacity-70">({ndviLabel})</span>}</p></div></div>
                              <div className="flex items-center gap-2"><div className="p-1.5 bg-blue-100 rounded"><Activity className="w-3.5 h-3.5 text-blue-600" /></div><div><p className="text-xs text-muted-foreground">EVI</p><p className="text-sm font-medium" data-testid={`text-evi-${p.id}`}>{fmt(p.latestEvi)}</p></div></div>
                              <div className="flex items-center gap-2"><div className="p-1.5 bg-sky-100 rounded"><Droplets className="w-3.5 h-3.5 text-sky-600" /></div><div><p className="text-xs text-muted-foreground">Humedad suelo</p><p className="text-sm font-medium" data-testid={`text-soil-moisture-${p.id}`}>{p.latestSoilMoisture !== null ? `${fmt(p.latestSoilMoisture, 1)}%` : "—"}</p></div></div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Conferences Tab ── */}
        <TabsContent value="conferences">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div><CardTitle>{t("conferences.title")}</CardTitle><CardDescription>Administra conferencias, charlas y eventos</CardDescription></div>
                <Button onClick={openCreateDialog} data-testid="button-new-conference"><Plus className="w-4 h-4 mr-2" />Nueva Conferencia</Button>
              </div>
            </CardHeader>
            <CardContent>
              {conferencesLoading ? <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                : conferences.length === 0 ? <p className="text-center text-muted-foreground py-8">{t("conferences.noConferences")}</p>
                : (
                  <div className="space-y-3">
                    {conferences.map(conf => (
                      <div key={conf.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 border rounded-xl hover:bg-accent/20 transition-colors" data-testid={`conference-row-${conf.id}`}>
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          {conf.thumbnailUrl && <img src={conf.thumbnailUrl} alt={conf.title} className="w-12 h-9 object-cover rounded-lg shrink-0 border" />}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold truncate">{conf.title}</p>
                              <Badge className={statusBadgeColors[conf.status]}>{statusLabels[conf.status]}</Badge>
                              {conf.isFeatured && <Badge variant="outline" className="text-yellow-600 border-yellow-400"><Star className="w-3 h-3 mr-1 fill-yellow-400" />{t("conferences.featured")}</Badge>}
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
                              {conf.speaker && <span>{t("conferences.speaker")}: {conf.speaker}</span>}
                              {conf.eventDate && <span>{t("conferences.date")}: {new Date(conf.eventDate).toLocaleDateString()}</span>}
                              <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{conf.viewsCount || 0} {t("conferences.views")}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0 flex-wrap">
                          <Button variant="ghost" size="icon" onClick={() => toggleFeaturedMutation.mutate({ id: conf.id, isFeatured: !conf.isFeatured })} data-testid={`button-toggle-featured-${conf.id}`}>
                            <Star className={`w-4 h-4 ${conf.isFeatured ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`} />
                          </Button>
                          <Select value={conf.status} onValueChange={value => toggleStatusMutation.mutate({ id: conf.id, status: value })}>
                            <SelectTrigger className="w-[110px] text-xs h-8" data-testid={`select-status-${conf.id}`}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="draft">Borrador</SelectItem>
                              <SelectItem value="published">Publicada</SelectItem>
                              <SelectItem value="archived">Archivada</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button variant="ghost" size="icon" onClick={() => openEditDialog(conf)} data-testid={`button-edit-conference-${conf.id}`}><Edit className="w-4 h-4" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDeleteConference(conf)} data-testid={`button-delete-conference-${conf.id}`}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Expediente Digital Tab ── */}
        <TabsContent value="expediente">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" />Expediente Digital del Usuario
              </CardTitle>
              <CardDescription>Ficha completa con todos los datos personales, agrícolas, satelitales y de actividad de cada usuario registrado en la plataforma.</CardDescription>
            </CardHeader>
            <CardContent>
              {usersLoading ? (
                <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
              ) : (
                <ExpedienteTab allUsers={allUsers} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="whatsapp-support">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><MessageSquare className="h-5 w-5 text-green-600" />Solicitudes de revisión técnica</CardTitle>
              <CardDescription>Atiende solicitudes creadas desde WhatsApp. La resolución se envía al productor y queda registrada.</CardDescription>
            </CardHeader>
            <CardContent><WhatsappEscalationInbox /></CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── User Profile Dialog ── */}
      <Dialog open={showUserProfileDialog} onOpenChange={setShowUserProfileDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-testid="text-user-profile-dialog-title">Perfil del productor</DialogTitle>
          </DialogHeader>
          {selectedUser && (
            <div className="space-y-5">
              {/* Identity */}
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center shrink-0 border-2 border-primary/20">
                  {selectedUser.avatarUrl ? <img src={selectedUser.avatarUrl} alt={selectedUser.name} className="w-16 h-16 rounded-full object-cover" /> : <span className="text-2xl font-bold text-primary">{selectedUser.name.charAt(0).toUpperCase()}</span>}
                </div>
                <div>
                  <p className="text-lg font-semibold" data-testid="text-profile-name">{selectedUser.name}</p>
                  <p className="text-sm text-muted-foreground" data-testid="text-profile-email">{selectedUser.email}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge className={roleBadgeColors[selectedUser.role]}>{roleLabels[selectedUser.role]}</Badge>
                    {!selectedUser.isActive && <Badge variant="secondary">Inactivo</Badge>}
                  </div>
                </div>
              </div>

              {/* Fields */}
              <div className="border-t pt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <ProfileField label="Teléfono" value={selectedUser.phone} testId="text-profile-phone" />
                <ProfileField label="Edad" value={selectedUser.age != null ? `${selectedUser.age} años` : undefined} testId="text-profile-age" />
                <ProfileField label="Género" value={selectedUser.gender ? genderLabels[selectedUser.gender] || selectedUser.gender : undefined} testId="text-profile-gender" />
                <ProfileField label="Estado" value={selectedUser.state} testId="text-profile-state" />
                <ProfileField label="Municipio" value={selectedUser.municipality} testId="text-profile-municipality" />
                <ProfileField label="Localidad" value={selectedUser.locality} testId="text-profile-locality" />
                <ProfileField label="Escolaridad" value={selectedUser.schoolingYears != null ? `${selectedUser.schoolingYears} años` : undefined} testId="text-profile-schooling" />
                <ProfileField label="Experiencia agrícola" value={selectedUser.farmingExperienceYears != null ? `${selectedUser.farmingExperienceYears} años` : undefined} testId="text-profile-experience" />
                <ProfileField label="Tipo de productor" value={selectedUser.producerType ? producerTypeLabels[selectedUser.producerType] || selectedUser.producerType : undefined} testId="text-profile-producer-type" />
                <ProfileField label="Nivel tecnológico" value={selectedUser.techLevel ? techLevelLabels[selectedUser.techLevel] || selectedUser.techLevel : undefined} testId="text-profile-tech-level" />
              </div>
              {selectedUser.farmingTypes && selectedUser.farmingTypes.length > 0 && (
                <div className="text-sm"><p className="text-muted-foreground mb-1">Tipos de agricultura</p><div className="flex flex-wrap gap-1" data-testid="text-profile-farming-types">{selectedUser.farmingTypes.map(ft => <Badge key={ft} variant="secondary" className="text-xs">{ft}</Badge>)}</div></div>
              )}
              {selectedUser.currentPractices && selectedUser.currentPractices.length > 0 && (
                <div className="text-sm"><p className="text-muted-foreground mb-1">Prácticas actuales</p><div className="flex flex-wrap gap-1" data-testid="text-profile-practices">{selectedUser.currentPractices.map(pr => <Badge key={pr} variant="outline" className="text-xs">{pr}</Badge>)}</div></div>
              )}

              {/* User's parcels */}
              <div className="border-t pt-4">
                <p className="text-sm font-semibold mb-3 flex items-center gap-2"><MapPin className="w-4 h-4 text-primary" />Predios de este usuario ({userParcels.length})</p>
                {userParcels.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Este usuario no tiene predios registrados.</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {userParcels.map((up: any) => (
                      <div key={up.id} className="flex items-center justify-between p-3 border rounded-lg bg-muted/20" data-testid={`profile-parcel-${up.id}`}>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{up.name}</p>
                          <p className="text-xs text-muted-foreground">{up.crop} · {parseFloat(up.area).toFixed(1)} ha · {up.location}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge className={parcelStatusColors[up.status] || "bg-gray-100 text-gray-800"} >{parcelStatusLabels[up.status] || up.status}</Badge>
                          <a href={`/parcel/${up.id}`} className="text-primary hover:underline" data-testid={`link-profile-parcel-${up.id}`}><ExternalLink className="w-3.5 h-3.5" /></a>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <p className="text-xs text-muted-foreground border-t pt-3">
                Registrado el {fmtDate(selectedUser.createdAt)}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUserProfileDialog(false)} data-testid="button-close-user-profile">Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Change Password Dialog ── */}
      <Dialog open={showPasswordDialog} onOpenChange={(open) => { setShowPasswordDialog(open); if (!open) { setNewPassword(""); setConfirmPassword(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-primary" />
              Cambiar contraseña
            </DialogTitle>
          </DialogHeader>
          {passwordTargetUser && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 bg-muted/40 rounded-lg">
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  {passwordTargetUser.avatarUrl
                    ? <img src={passwordTargetUser.avatarUrl} alt={passwordTargetUser.name} className="w-9 h-9 rounded-full object-cover" />
                    : <span className="font-bold text-primary text-sm">{passwordTargetUser.name.charAt(0).toUpperCase()}</span>}
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{passwordTargetUser.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{passwordTargetUser.email}</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="new-password">Nueva contraseña</Label>
                <Input
                  id="new-password"
                  type="password"
                  placeholder="Mínimo 8 caracteres"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  data-testid="input-new-password"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirmar contraseña</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  placeholder="Repite la contraseña"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  data-testid="input-confirm-password"
                />
              </div>

              {confirmPassword.length > 0 && newPassword !== confirmPassword && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Las contraseñas no coinciden
                </p>
              )}
              {newPassword.length > 0 && newPassword.length < 8 && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> La contraseña debe tener al menos 8 caracteres
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPasswordDialog(false)} data-testid="button-cancel-password">Cancelar</Button>
            <Button
              onClick={() => passwordTargetUser && changePasswordMutation.mutate({ userId: passwordTargetUser.id, password: newPassword })}
              disabled={!newPassword || newPassword.length < 8 || newPassword !== confirmPassword || changePasswordMutation.isPending}
              data-testid="button-confirm-change-password"
            >
              {changePasswordMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Lock className="w-4 h-4 mr-2" />}
              Guardar contraseña
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Conference Dialog ── */}
      <Dialog open={showConferenceDialog} onOpenChange={setShowConferenceDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-testid="text-conference-dialog-title">{editingConference ? "Editar Conferencia" : "Nueva Conferencia"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div><Label htmlFor="conf-title">Título *</Label><Input id="conf-title" value={conferenceForm.title} onChange={e => setConferenceForm({ ...conferenceForm, title: e.target.value })} placeholder="Título de la conferencia" data-testid="input-conference-title" /></div>
            <div><Label htmlFor="conf-description">Descripción *</Label><Textarea id="conf-description" value={conferenceForm.description} onChange={e => setConferenceForm({ ...conferenceForm, description: e.target.value })} placeholder="Descripción de la conferencia" rows={3} data-testid="input-conference-description" /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="conf-videoUrl">URL del Video</Label>
                <Input id="conf-videoUrl" value={conferenceForm.videoUrl} onChange={e => setConferenceForm({ ...conferenceForm, videoUrl: e.target.value })} placeholder="https://youtube.com/..." data-testid="input-conference-videoUrl" />
                {conferenceForm.videoUrl && conferenceForm.videoUrl.includes("facebook.com") && !(thumbnailPreview || conferenceForm.thumbnailUrl) && (
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-[11px] text-amber-600 flex-1" data-testid="text-facebook-thumbnail-hint">
                      ⚠ Video de Facebook: sin miniatura automática.
                    </p>
                    <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={thumbnailDetecting} data-testid="button-auto-detect-thumbnail" onClick={handleAutoDetectThumbnail}>
                      {thumbnailDetecting ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                      Auto-detectar
                    </Button>
                  </div>
                )}
              </div>
              <div>
                <Label>Miniatura</Label>
                <input ref={thumbnailInputRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="hidden" data-testid="input-conference-thumbnail-file" onChange={e => { const f = e.target.files?.[0]; if (f) handleThumbnailUpload(f); e.target.value = ""; }} />
                {thumbnailPreview || conferenceForm.thumbnailUrl ? (
                  <div className="relative mt-1 rounded-md overflow-hidden border" style={{ maxHeight: 120 }}>
                    <img src={thumbnailPreview || conferenceForm.thumbnailUrl} alt="Miniatura" className="w-full h-28 object-cover" data-testid="img-conference-thumbnail-preview" />
                    <div className="absolute top-1 right-1 flex gap-1">
                      <Button type="button" size="sm" variant="secondary" className="h-7 px-2" disabled={thumbnailUploading} data-testid="button-change-thumbnail" onClick={() => thumbnailInputRef.current?.click()}>{thumbnailUploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}</Button>
                      <Button type="button" size="sm" variant="destructive" className="h-7 px-2" data-testid="button-remove-thumbnail" onClick={() => { setConferenceForm(p => ({ ...p, thumbnailUrl: "" })); setThumbnailPreview(null); }}><X className="w-3 h-3" /></Button>
                    </div>
                  </div>
                ) : (
                  <Button type="button" variant="outline" className="w-full mt-1 h-28 border-dashed flex flex-col gap-1" disabled={thumbnailUploading} data-testid="button-upload-thumbnail" onClick={() => thumbnailInputRef.current?.click()}>
                    {thumbnailUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Image className="w-5 h-5 text-muted-foreground" /><span className="text-xs text-muted-foreground">Subir miniatura</span><span className="text-[10px] text-muted-foreground">JPG, PNG, GIF, WebP</span></>}
                  </Button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><Label htmlFor="conf-speaker">Ponente</Label><Input id="conf-speaker" value={conferenceForm.speaker} onChange={e => setConferenceForm({ ...conferenceForm, speaker: e.target.value })} placeholder="Nombre del ponente" data-testid="input-conference-speaker" /></div>
              <div><Label htmlFor="conf-eventDate">Fecha del Evento</Label><Input id="conf-eventDate" type="date" value={conferenceForm.eventDate} onChange={e => setConferenceForm({ ...conferenceForm, eventDate: e.target.value })} data-testid="input-conference-eventDate" /></div>
            </div>
            <div><Label htmlFor="conf-speakerBio">Biografía del Ponente</Label><Textarea id="conf-speakerBio" value={conferenceForm.speakerBio} onChange={e => setConferenceForm({ ...conferenceForm, speakerBio: e.target.value })} placeholder="Breve biografía" rows={2} data-testid="input-conference-speakerBio" /></div>
            <div><Label htmlFor="conf-tags">Etiquetas (separadas por comas)</Label><Input id="conf-tags" value={conferenceForm.tags} onChange={e => setConferenceForm({ ...conferenceForm, tags: e.target.value })} placeholder="agricultura, suelo, tecnología" data-testid="input-conference-tags" /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><Label>Estado</Label><Select value={conferenceForm.status} onValueChange={value => setConferenceForm({ ...conferenceForm, status: value })}><SelectTrigger data-testid="select-conference-status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="draft">Borrador</SelectItem><SelectItem value="published">Publicada</SelectItem><SelectItem value="archived">Archivada</SelectItem></SelectContent></Select></div>
              <div className="flex items-center gap-2 pt-6">
                <input type="checkbox" id="conf-featured" checked={conferenceForm.isFeatured} onChange={e => setConferenceForm({ ...conferenceForm, isFeatured: e.target.checked })} className="h-4 w-4 rounded border-gray-300" data-testid="checkbox-conference-featured" />
                <Label htmlFor="conf-featured" className="cursor-pointer"><Star className="w-4 h-4 inline mr-1 text-yellow-500" />Destacada</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConferenceDialog(false)} data-testid="button-cancel-conference">{t("common.cancel")}</Button>
            <Button onClick={handleConferenceSubmit} disabled={!conferenceForm.title || !conferenceForm.description || createConferenceMutation.isPending || updateConferenceMutation.isPending} data-testid="button-save-conference">
              {(createConferenceMutation.isPending || updateConferenceMutation.isPending) && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              {editingConference ? "Actualizar" : "Crear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

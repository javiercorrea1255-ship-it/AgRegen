import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { CloudRain, MapPin, ArrowUpRight, Leaf, Droplets, Sun, Plus, Loader2, Activity, Thermometer, AlertTriangle, BarChart3, Satellite, Plane, Cpu, Target, Settings, DollarSign, TrendingUp, CheckCircle2, Circle, Map, ScanLine } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n-context";
import { MapContainer, TileLayer, Polygon } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useMemo } from "react";
import { getActiveModules, moduleDefinitions, HIDE_DRONES, HIDE_IOT, type ToolModule } from "@shared/tool-modules";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";

interface Parcel {
  id: string;
  name: string;
  location: string;
  area: string;
  crop: string;
  status: string;
  isPublic: boolean;
  latitude?: number;
  longitude?: number;
  polygonCoordinates?: [number, number][];
}

function ParcelMiniMap({ lat, lng, polygon }: { lat?: number; lng?: number; polygon?: [number, number][] }) {
  const hasValidCoords = lat != null && lng != null && isFinite(lat) && isFinite(lng);
  const hasPolygon = polygon && polygon.length > 0;

  const center = useMemo(() => {
    if (hasPolygon) {
      const avgLat = polygon!.reduce((s, c) => s + c[0], 0) / polygon!.length;
      const avgLng = polygon!.reduce((s, c) => s + c[1], 0) / polygon!.length;
      return [avgLat, avgLng] as [number, number];
    }
    if (hasValidCoords) return [lat!, lng!] as [number, number];
    return null;
  }, [lat, lng, polygon, hasValidCoords, hasPolygon]);

  if (!center) {
    return (
      <div className="w-full h-full bg-muted flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <MapPin className="w-8 h-8 mx-auto mb-1 opacity-40" />
          <span className="text-xs">Sin ubicación</span>
        </div>
      </div>
    );
  }

  const zoom = hasPolygon ? 15 : 14;

  return (
    <MapContainer
      center={center}
      zoom={zoom}
      scrollWheelZoom={false}
      dragging={false}
      zoomControl={false}
      attributionControl={false}
      doubleClickZoom={false}
      touchZoom={false}
      className="w-full h-full"
      style={{ cursor: "pointer" }}
    >
      <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
      {hasPolygon && (
        <Polygon
          positions={polygon!}
          pathOptions={{ color: "#22c55e", weight: 2, fillColor: "#22c55e", fillOpacity: 0.15 }}
        />
      )}
    </MapContainer>
  );
}

interface Alert {
  id: string;
  parcelId: string;
  severity: "high" | "medium" | "low";
  title: string;
  description: string;
  isRead: boolean;
  createdAt: string;
}

// --- Active cycle chip ---
function ActiveCycleChip({ parcelId }: { parcelId: string }) {
  const { data } = useQuery({
    queryKey: ["cycle-detail", parcelId],
    queryFn: async () => {
      const res = await fetch(`/api/parcels/${parcelId}/cycle-detail`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 60_000,
  });
  const latest = data?.latest;
  if (!latest) return null;
  const seasonLabel = latest.cycleSeason === "primavera-verano" ? "P-V" : latest.cycleSeason === "otono-invierno" ? "O-I" : latest.cycleSeason;
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-green-100 text-green-800 border border-green-200"
      data-testid={`chip-cycle-${parcelId}`}
    >
      <Leaf className="w-2.5 h-2.5" />
      {latest.cycleYear} · {seasonLabel}
      {latest.variety ? ` · ${latest.variety}` : ""}
    </span>
  );
}

// --- Completeness badge based on setup progress ---
function SetupProgressBadge({ parcelId }: { parcelId: string }) {
  const { data } = useQuery({
    queryKey: ["setup-progress", parcelId],
    queryFn: async () => {
      const res = await fetch(`/api/parcels/${parcelId}/setup-progress`, { credentials: "include" });
      if (!res.ok) return { progress: null };
      return res.json();
    },
    staleTime: 60_000,
  });

  const progress = data?.progress;
  if (!progress) {
    return (
      <Link href={`/parcel/${parcelId}/setup`} onClick={(e) => e.stopPropagation()}>
        <Badge variant="outline" className="text-xs gap-1 border-amber-400 text-amber-600 hover:bg-amber-50 cursor-pointer" data-testid={`badge-setup-${parcelId}`}>
          <Circle className="w-2.5 h-2.5" /> Configurar
        </Badge>
      </Link>
    );
  }

  const steps = [progress.stepCycle, progress.stepSoil, progress.stepEconomy, progress.stepPractices];
  const completed = steps.filter(Boolean).length;
  const pct = Math.round((completed / 4) * 100);

  if (pct === 100) {
    return (
      <Badge variant="secondary" className="text-xs gap-1 text-green-600 bg-green-100" data-testid={`badge-setup-${parcelId}`}>
        <CheckCircle2 className="w-2.5 h-2.5" /> Completo
      </Badge>
    );
  }

  return (
    <Link href={`/parcel/${parcelId}/setup`} onClick={(e) => e.stopPropagation()}>
      <Badge variant="outline" className="text-xs gap-1 border-amber-400 text-amber-600 hover:bg-amber-50 cursor-pointer" data-testid={`badge-setup-${parcelId}`}>
        <Circle className="w-2.5 h-2.5" /> {pct}% config.
      </Badge>
    </Link>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [, navigate] = useLocation();

  const { data: parcelsData, isLoading: parcelsLoading } = useQuery({
    queryKey: ["parcels"],
    queryFn: async () => {
      const response = await fetch("/api/parcels", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Error al cargar lotes");
      return response.json();
    },
  });

  const { data: alertsData, isLoading: alertsLoading } = useQuery({
    queryKey: ["alerts"],
    queryFn: async () => {
      const response = await fetch("/api/alerts", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Error al cargar alertas");
      return response.json();
    },
  });

  const parcels = parcelsData?.parcels || [];
  const alerts = alertsData?.alerts || [];

  // Check if any parcel has economic data (costs or cycle detail with yield/price)
  // to conditionally show Rentabilidad tab
  const { data: economicCheckData } = useQuery({
    queryKey: ["economic-check", parcels.map((p: any) => p.id).join(",")],
    queryFn: async () => {
      if (parcels.length === 0) return false;
      const results = await Promise.all(
        parcels.map((p: any) =>
          fetch(`/api/parcels/${p.id}/profitability`, { credentials: "include" })
            .then(r => r.ok ? r.json() : null)
            .catch(() => null)
        )
      );
      return results.some(r => r != null && (r.totalCost > 0 || r.projectedRevenue > 0));
    },
    enabled: parcels.length > 0,
    staleTime: 300_000,
  });
  const hasEconomicData = !!economicCheckData;

  const calculateStats = () => {
    if (parcels.length === 0) {
      return {
        avgHealth: 0,
        activeCount: 0,
        totalArea: 0,
      };
    }

    const activeCount = parcels.filter((p: any) => p.status === "active").length;
    const totalArea = parcels.reduce((sum: number, p: any) => sum + parseFloat(p.area || "0"), 0);

    return {
      avgHealth: 78,
      activeCount,
      totalArea: totalArea.toFixed(1),
    };
  };

  const stats = calculateStats();

  return (
    <div className="container mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-heading font-bold text-foreground">
            {user?.role === "admin" ? t("dashboard.adminBoard") : user?.role === "farmer" ? t("dashboard.techBoard") : t("dashboard.researcherBoard")}
          </h1>
          <p className="text-sm md:text-base text-muted-foreground">{t("dashboard.welcome", { name: user?.name || "" })}</p>
        </div>
        <div className="flex gap-2 md:gap-3">
          <Button variant="outline" className="gap-2 text-sm" size="sm" data-testid="btn-forecast" disabled>
            <CloudRain className="w-4 h-4" />
            <span className="hidden sm:inline">{t("dashboard.forecast")}</span>
          </Button>
          <Link href="/parcel/new">
            <Button className="gap-2 text-sm" size="sm" data-testid="button-new-parcel">
              <Plus className="w-4 h-4" />
              <span className="hidden xs:inline">{t("dashboard.newWord")}</span> {t("dashboard.newParcel")}
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <StatCard 
          title={t("dashboard.avgSoilHealth")} 
          value={`${stats.avgHealth}/100`} 
          change="+2.4%" 
          icon={Leaf} 
          trend="up"
        />
        <StatCard 
          title={t("dashboard.activeParcels")} 
          value={stats.activeCount.toString()} 
          change={`${parcels.length} ${t("dashboard.totalWord")}`}
          icon={MapPin} 
          trend="neutral"
        />
        <StatCard 
          title={t("dashboard.totalArea")} 
          value={`${stats.totalArea} ha`}
          change={t("dashboard.monitored")} 
          icon={ArrowUpRight} 
          trend="up"
        />
        <StatCard 
          title={t("dashboard.pendingAlerts")} 
          value={alerts.filter((a: Alert) => !a.isRead).length.toString()} 
          change={t("dashboard.unread")} 
          icon={Sun} 
          trend="neutral"
        />
      </div>

      {/* Tech Profile Summary */}
      <TechProfileCard user={user} />

      {/* Quick Access: Atlas de Suelos */}
      <Card
        className="border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 hover:from-green-100 hover:to-emerald-100 transition-colors cursor-pointer"
        onClick={() => navigate("/mapa-suelo-mexico")}
        data-testid="link-mexico-soil-map"
      >
        <CardContent className="p-4 flex items-center gap-4">
          <div className="rounded-full bg-green-600 p-2.5 shrink-0">
            <Map className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-green-900">Atlas de Suelos de México</p>
            <p className="text-xs text-green-700">Mapas interpolados de 14,942 muestras INIFAP · pH, MO, P, K, Fe, Zn y más</p>
          </div>
          <ArrowUpRight className="w-4 h-4 text-green-600 shrink-0" />
        </CardContent>
      </Card>

      {/* Main Content Area */}
      <Tabs defaultValue="parcels" className="space-y-4 md:space-y-6">
        <TabsList className="w-full justify-start overflow-x-auto flex-nowrap">
          <TabsTrigger value="parcels" className="text-xs md:text-sm" data-testid="tab-my-parcels">{t("dashboard.myParcels")}</TabsTrigger>
          <TabsTrigger value="alerts" className="text-xs md:text-sm" data-testid="tab-alerts">{t("dashboard.alerts")}</TabsTrigger>
          {hasEconomicData && (
            <TabsTrigger value="rentabilidad" className="text-xs md:text-sm" data-testid="tab-rentabilidad">
              <DollarSign className="w-3.5 h-3.5 mr-1" />Rentabilidad
            </TabsTrigger>
          )}
          <TabsTrigger value="public" className="text-xs md:text-sm" data-testid="tab-public">{t("dashboard.public")}</TabsTrigger>
        </TabsList>

        <TabsContent value="parcels" className="space-y-6">
          {parcelsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {parcels.map((parcel: any) => {
                const health = Math.floor(Math.random() * 30 + 70);
                return (
                  <div
                    key={parcel.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/parcel/${parcel.id}`)}
                  >
                    <Card 
                      className="overflow-hidden hover:shadow-lg transition-all duration-300 group border-border/60"
                      data-testid={`card-parcel-${parcel.id}`}
                    >
                      <div className="relative h-48 overflow-hidden">
                        <ParcelMiniMap
                          lat={Number(parcel.latitude)}
                          lng={Number(parcel.longitude)}
                          polygon={parcel.polygonCoordinates as [number, number][] | undefined}
                        />
                        <div className="absolute top-3 right-3 z-[500] flex gap-1.5 flex-wrap justify-end">
                          <Badge 
                            variant={parcel.status === "active" ? "default" : parcel.status === "warning" ? "destructive" : "secondary"} 
                            className="shadow-sm"
                            data-testid={`badge-status-${parcel.id}`}
                          >
                            {parcel.status === "active" ? t("dashboard.active") : parcel.status === "warning" ? t("dashboard.warning") : t("dashboard.inactive")}
                          </Badge>
                        </div>
                        <div className="absolute bottom-3 left-3 z-[500] bg-black/60 backdrop-blur-sm text-white px-3 py-1 rounded-full text-xs font-mono">
                          NDVI: 0.{health}
                        </div>
                        <div className="absolute top-3 left-3 z-[500]">
                          <SetupProgressBadge parcelId={parcel.id} />
                        </div>
                        <button
                          data-testid={`btn-edit-polygon-${parcel.id}`}
                          onClick={(e) => { e.stopPropagation(); navigate(`/parcel/${parcel.id}?editPolygon=true`); }}
                          className="absolute bottom-3 right-3 z-[500] flex items-center gap-1.5 bg-primary text-white px-2.5 py-1 rounded-full text-xs font-medium shadow-md hover:bg-primary/80 active:scale-95 transition-all"
                        >
                          <ScanLine className="w-3 h-3" />
                          Editar límite
                        </button>
                      </div>
                      <CardContent className="pt-6">
                        <div className="flex justify-between items-start mb-2">
                          <h3 
                            className="font-heading font-semibold text-lg group-hover:text-primary transition-colors"
                            data-testid={`text-parcel-name-${parcel.id}`}
                          >
                            {parcel.name}
                          </h3>
                          <span className="text-sm font-mono text-muted-foreground">{parcel.area} ha</span>
                        </div>
                        <div className="flex items-center text-sm text-muted-foreground mb-4 gap-2">
                          <MapPin className="w-3 h-3" /> {parcel.location}
                        </div>
                        <div className="flex justify-between items-center text-sm mb-2">
                          <span className="font-medium text-foreground">{parcel.crop}</span>
                          <span className={`font-bold ${health > 80 ? 'text-green-600' : 'text-yellow-600'}`}>
                            {health}% {t("dashboard.health")}
                          </span>
                        </div>
                        <div className="mb-3">
                          <ActiveCycleChip parcelId={parcel.id} />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-3 border-t">
                          <Button variant="ghost" size="sm" className="w-full h-auto flex flex-col gap-1 p-2" data-testid={`btn-indices-${parcel.id}`} onClick={(e) => { e.stopPropagation(); navigate(`/parcel/${parcel.id}/indices`); }}>
                            <BarChart3 className="w-4 h-4 text-green-600" />
                            <span className="text-xs">{t("dashboard.indices")}</span>
                          </Button>
                          <Button variant="ghost" size="sm" className="w-full h-auto flex flex-col gap-1 p-2" data-testid={`btn-climate-${parcel.id}`} onClick={(e) => { e.stopPropagation(); navigate(`/parcel/${parcel.id}/climate`); }}>
                            <Thermometer className="w-4 h-4 text-blue-600" />
                            <span className="text-xs">{t("dashboard.climate")}</span>
                          </Button>
                          <Button variant="ghost" size="sm" className="w-full h-auto flex flex-col gap-1 p-2" data-testid={`btn-alerts-${parcel.id}`} onClick={(e) => { e.stopPropagation(); navigate(`/parcel/${parcel.id}/alerts`); }}>
                            <AlertTriangle className="w-4 h-4 text-amber-600" />
                            <span className="text-xs">{t("dashboard.alerts")}</span>
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                );
              })}
              
              {/* Add New Card Placeholder */}
              <Link href="/parcel/new">
                <Card className="border-dashed border-2 border-border/60 bg-transparent flex items-center justify-center min-h-[300px] hover:bg-secondary/20 transition-colors cursor-pointer group">
                  <div className="text-center">
                    <div className="w-12 h-12 rounded-full bg-secondary/50 flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                      <Plus className="w-6 h-6 text-secondary-foreground" />
                    </div>
                    <h3 className="font-medium text-foreground">{t("dashboard.addNewParcel")}</h3>
                    <p className="text-sm text-muted-foreground">{t("dashboard.mapNewField")}</p>
                  </div>
                </Card>
              </Link>

            </div>
          )}

          {/* ── T176: Próximas Actualizaciones Fenológicas ───────────────── */}
          {parcels.length > 0 && <PhenologyTasksCard parcels={parcels} />}
        </TabsContent>

        <TabsContent value="alerts">
          <Card>
            <CardHeader>
              <CardTitle>{t("dashboard.activeAlerts")}</CardTitle>
              <CardDescription>{t("dashboard.alertsDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              {alertsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : alerts.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">{t("dashboard.noAlerts")}</p>
              ) : (
                <div className="space-y-4">
                  {alerts.map((alert: Alert) => (
                    <AlertItem 
                      key={alert.id}
                      severity={alert.severity} 
                      title={alert.title} 
                      description={alert.description}
                      date={new Date(alert.createdAt).toLocaleDateString('es-AR')}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {parcels.length > 0 && (
          <TabsContent value="rentabilidad" className="space-y-6">
            <RentabilidadTab parcels={parcels} />
          </TabsContent>
        )}

        <TabsContent value="public">
          <PublicExplorer />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Rentabilidad Tab ──────────────────────────────────────────────────────────
const COST_CATEGORY_COLORS: Record<string, string> = {
  semillas: "#22c55e",
  fertilizantes: "#3b82f6",
  agroquimicos: "#f59e0b",
  maquinaria: "#8b5cf6",
  mano_de_obra: "#ec4899",
  arrendamiento: "#06b6d4",
  seguros: "#f97316",
  otros: "#6b7280",
};

function KpiCard({ title, value, sub, trend, icon: Icon, color }: {
  title: string; value: string; sub?: string; trend?: "up" | "down" | "neutral";
  icon: React.ElementType; color: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground truncate">{title}</p>
            <p className={`text-xl font-bold font-mono mt-1 ${color}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className={`p-2 rounded-lg flex-shrink-0 ${color === "text-green-600" ? "bg-green-100" : color === "text-red-600" ? "bg-red-100" : color === "text-amber-600" ? "bg-amber-100" : color === "text-blue-600" ? "bg-blue-100" : "bg-muted"}`}>
            <Icon className={`w-4 h-4 ${color}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Conventional cost benchmark per crop ($/ha) for regenerative savings comparison
const CONVENTIONAL_COST_BENCHMARK: Record<string, number> = {
  soja: 320,
  maiz: 450,
  "maíz": 450,
  trigo: 280,
  girasol: 260,
};

function getConventionalBenchmark(crop: string): number {
  const accentMap: Record<string, string> = {á:"a",é:"e",í:"i",ó:"o",ú:"u"};
  const key = (crop || "").toLowerCase().replace(/[áéíóú]/g, (c) => accentMap[c] || c);
  return Object.entries(CONVENTIONAL_COST_BENCHMARK).find(([k]) => key.includes(k))?.[1] ?? 350;
}

function ParcelProfitabilityRow({ parcel }: { parcel: any }) {
  const { data, isLoading } = useQuery({
    queryKey: ["profitability", parcel.id],
    queryFn: async () => {
      const res = await fetch(`/api/parcels/${parcel.id}/profitability`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 120_000,
  });
  const [, navigate] = useLocation();

  if (isLoading) {
    return (
      <div className="p-3 rounded-lg border flex items-center gap-3 animate-pulse">
        <div className="h-4 bg-muted rounded w-32" />
        <div className="h-4 bg-muted rounded w-20 ml-auto" />
      </div>
    );
  }

  const fmt = (n: number | null | undefined) =>
    n == null ? "—" : `$${Math.abs(n).toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;

  const grossMargin = data?.grossMargin;
  const roi = data?.roi;
  const costPerTon = data?.costPerTon;
  const breakEven = data?.breakEvenTon;
  const hasData = grossMargin != null;

  return (
    <div
      className="p-3 rounded-lg border hover:bg-muted/30 transition-colors cursor-pointer"
      onClick={() => navigate(`/parcel/${parcel.id}`)}
      data-testid={`profitability-row-${parcel.id}`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <p className="font-medium text-sm">{parcel.name}</p>
          <p className="text-xs text-muted-foreground">{parcel.crop} · {parcel.area} ha</p>
        </div>
        {hasData ? (
          <Badge
            variant="secondary"
            className={`text-xs ${grossMargin! >= 0 ? "text-green-600 bg-green-100" : "text-red-600 bg-red-100"}`}
          >
            {grossMargin! >= 0 ? "+" : "-"}{fmt(grossMargin)}
          </Badge>
        ) : (
          <Link href={`/parcel/${parcel.id}/setup`} onClick={(e) => e.stopPropagation()}>
            <Badge variant="outline" className="text-xs text-amber-600 border-amber-400 cursor-pointer">
              Configurar
            </Badge>
          </Link>
        )}
      </div>
      {hasData && (
        <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
          <div>
            <span className="block text-[10px] uppercase tracking-wide">ROI</span>
            <span className={`font-mono font-medium ${roi != null && roi >= 0 ? "text-green-600" : "text-red-600"}`}>
              {roi != null ? `${roi.toFixed(1)}%` : "—"}
            </span>
          </div>
          <div>
            <span className="block text-[10px] uppercase tracking-wide">Costo/tn</span>
            <span className="font-mono font-medium text-foreground">{fmt(costPerTon)}</span>
          </div>
          <div>
            <span className="block text-[10px] uppercase tracking-wide">P. equil.</span>
            <span className="font-mono font-medium text-foreground">{breakEven != null ? `${breakEven.toFixed(2)} tn` : "—"}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function RentabilidadTab({ parcels }: { parcels: any[] }) {
  // Aggregate profitability across all parcels (uses first parcel for chart demo)
  const firstParcel = parcels[0];

  const { data: aggData } = useQuery({
    queryKey: ["profitability-agg", parcels.map((p: any) => p.id).join(",")],
    queryFn: async () => {
      if (parcels.length === 0) return null;
      const results = await Promise.all(
        parcels.map((p: any) =>
          fetch(`/api/parcels/${p.id}/profitability`, { credentials: "include" }).then(r => r.ok ? r.json() : null)
        )
      );
      const valid = results.filter(Boolean);
      const totalGrossMargin = valid.reduce((s, r) => s + (r.grossMargin ?? 0), 0);
      const totalCost = valid.reduce((s, r) => s + (r.totalCost ?? 0), 0);
      const totalRevenue = valid.reduce((s, r) => s + (r.projectedRevenue ?? 0), 0);
      const avgRoi = valid.filter(r => r.roi != null).reduce((s, r) => s + r.roi, 0) / (valid.filter(r => r.roi != null).length || 1);

      // Aggregate cost breakdown
      const breakdown: Record<string, number> = {};
      for (const r of valid) {
        if (r.costBreakdown) {
          for (const item of r.costBreakdown) {
            breakdown[item.category] = (breakdown[item.category] || 0) + item.totalCost;
          }
        }
      }

      // Per-parcel rows with margin $/ha and $/ciclo, sorted by grossMargin desc
      const perParcel = parcels.map((p: any, i: number) => {
        const r = results[i];
        const area = parseFloat(p.area || "1") || 1;
        const grossMarginCycle = r?.grossMargin ?? null;   // $/ciclo (total)
        const grossMarginHa = grossMarginCycle != null ? grossMarginCycle / area : null; // $/ha
        return {
          parcel: p,
          grossMarginCycle,
          grossMarginHa,
          roi: r?.roi ?? null,
          totalCost: r?.totalCost ?? null,
          projectedRevenue: r?.projectedRevenue ?? null,
          hasData: grossMarginCycle != null,
        };
      }).sort((a, b) => {
        if (a.grossMarginCycle == null && b.grossMarginCycle == null) return 0;
        if (a.grossMarginCycle == null) return 1;
        if (b.grossMarginCycle == null) return -1;
        return b.grossMarginCycle - a.grossMarginCycle; // desc by margin
      });

      return { totalGrossMargin, totalCost, totalRevenue, avgRoi, breakdown, count: valid.length, perParcel };
    },
    enabled: parcels.length > 0,
    staleTime: 120_000,
  });

  const fmt = (n: number | null | undefined) =>
    n == null ? "—" : `$${Math.abs(n).toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;

  const breakdownData = aggData?.breakdown
    ? Object.entries(aggData.breakdown).map(([name, value]) => ({ name: name.replace(/_/g, " "), value: value as number }))
    : [];

  if (parcels.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <DollarSign className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-muted-foreground">No hay lotes registrados.</p>
        </CardContent>
      </Card>
    );
  }

  // Show empty state when data has loaded but no parcels have economic data
  if (aggData && aggData.count === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-4">
          <DollarSign className="w-12 h-12 mx-auto opacity-20" />
          <div>
            <p className="font-semibold text-foreground">Sin datos económicos aún</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
              Para ver KPIs de rentabilidad, configura el ciclo económico (rendimiento esperado + precio objetivo) y registra costos en al menos un lote.
            </p>
          </div>
          <div className="flex gap-2 justify-center flex-wrap">
            {parcels.slice(0, 3).map((p: any) => (
              <Link key={p.id} href={`/parcel/${p.id}/setup`}>
                <Button variant="outline" size="sm" data-testid={`btn-setup-${p.id}`}>
                  <Settings className="w-3.5 h-3.5 mr-1" />
                  Configurar {p.name}
                </Button>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          title="Margen Bruto Total"
          value={fmt(aggData?.totalGrossMargin)}
          sub={aggData?.count ? `${aggData.count} lotes con datos` : "Sin datos de ciclo"}
          icon={TrendingUp}
          color={aggData?.totalGrossMargin != null ? (aggData.totalGrossMargin >= 0 ? "text-green-600" : "text-red-600") : "text-muted-foreground"}
        />
        <KpiCard
          title="Ingresos Proyectados"
          value={fmt(aggData?.totalRevenue)}
          sub="Rendimiento × Precio obj."
          icon={ArrowUpRight}
          color="text-blue-600"
        />
        <KpiCard
          title="Costos Totales"
          value={fmt(aggData?.totalCost)}
          sub="Todos los lotes"
          icon={DollarSign}
          color="text-amber-600"
        />
        <KpiCard
          title="ROI Promedio"
          value={aggData?.avgRoi != null ? `${aggData.avgRoi.toFixed(1)}%` : "—"}
          sub="Retorno sobre inversión"
          icon={Activity}
          color={aggData?.avgRoi != null ? (aggData.avgRoi >= 0 ? "text-green-600" : "text-red-600") : "text-muted-foreground"}
        />
      </div>

      {/* Cost breakdown chart + per-parcel list */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Distribución de Costos</CardTitle>
            <CardDescription>Por categoría, todos los lotes</CardDescription>
          </CardHeader>
          <CardContent>
            {breakdownData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={breakdownData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {breakdownData.map((entry, index) => (
                      <Cell
                        key={entry.name}
                        fill={COST_CATEGORY_COLORS[entry.name.replace(/ /g, "_")] || `hsl(${index * 40}, 60%, 55%)`}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => [`$${value.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`, ""]}
                  />
                  <Legend
                    iconSize={8}
                    formatter={(value) => <span className="text-xs capitalize">{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex flex-col items-center justify-center h-[220px] text-muted-foreground text-sm gap-2">
                <DollarSign className="w-8 h-8 opacity-30" />
                <p>Sin costos registrados.</p>
                <p className="text-xs">Agrega costos desde la pestaña Costos de cada parcela.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Ranking por Margen Bruto</CardTitle>
            <CardDescription>Ordenado de mayor a menor margen — $/ha y $/ciclo</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(aggData?.perParcel || parcels.map((p: any) => ({ parcel: p, grossMarginCycle: null, grossMarginHa: null, roi: null, hasData: false }))).map((row: any, idx: number) => {
              const { parcel, grossMarginCycle, grossMarginHa, roi, hasData } = row;
              const isPositive = grossMarginCycle != null && grossMarginCycle >= 0;
              return (
                <div
                  key={parcel.id}
                  className="p-3 rounded-lg border hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={() => window.location.href = `/parcel/${parcel.id}`}
                  data-testid={`profitability-row-${parcel.id}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-mono text-muted-foreground w-5 flex-shrink-0">
                        #{idx + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{parcel.name}</p>
                        <p className="text-xs text-muted-foreground">{parcel.crop} · {parcel.area} ha</p>
                      </div>
                    </div>
                    {hasData ? (
                      <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                        <Badge
                          variant="secondary"
                          className={`text-xs ${isPositive ? "text-green-600 bg-green-100" : "text-red-600 bg-red-100"}`}
                        >
                          {isPositive ? "+" : ""}{fmt(grossMarginHa)}/ha
                        </Badge>
                        <span className={`text-[10px] font-mono ${isPositive ? "text-green-600" : "text-red-500"}`}>
                          {isPositive ? "+" : ""}{fmt(grossMarginCycle)} ciclo
                        </span>
                      </div>
                    ) : (
                      <Link href={`/parcel/${parcel.id}/setup`} onClick={(e) => e.stopPropagation()}>
                        <Badge variant="outline" className="text-xs text-amber-600 border-amber-400 cursor-pointer flex-shrink-0">
                          Configurar
                        </Badge>
                      </Link>
                    )}
                  </div>
                  {hasData && roi != null && (
                    <div className="mt-1.5 text-[10px] text-muted-foreground flex gap-3">
                      <span>ROI: <span className={`font-medium ${roi >= 0 ? "text-green-600" : "text-red-500"}`}>{roi.toFixed(1)}%</span></span>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* Cycle Objectives Chart */}
      <CycleComparisonChart parcels={parcels} />

      {/* Regenerative Savings Benchmark */}
      <RegenerativeSavingsPanel parcels={parcels} />

      <Card className="bg-amber-50 dark:bg-amber-950/20 border-amber-200">
        <CardContent className="py-3 px-4">
          <p className="text-xs text-amber-700 dark:text-amber-300">
            <strong>Para activar KPIs:</strong> Configura el ciclo económico (rendimiento esperado + precio objetivo) y registra los costos de producción desde cada lote.
            <Link href="/parcel/new" className="ml-2 underline">Crear nuevo lote →</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── T176: Phenology Tasks Card ───────────────────────────────────────────────
function PhenologyTasksCard({ parcels }: { parcels: any[] }) {
  const queryClient = useQueryClient();
  const { data: promptsData } = useQuery({
    queryKey: ["phenology-prompts-all", parcels.map((p: any) => p.id).join(",")],
    queryFn: async () => {
      const results = await Promise.all(
        parcels.map((p: any) =>
          fetch(`/api/parcels/${p.id}/phenology-prompts`, { credentials: "include" })
            .then(r => r.ok ? r.json() : { prompts: [] })
            .then(d => (d.prompts || []).map((pr: any) => ({ ...pr, parcelName: p.name, parcelId: p.id })))
        )
      );
      return results.flat();
    },
    enabled: parcels.length > 0,
    staleTime: 60_000,
  });

  const completePromptMutation = useMutation({
    mutationFn: async ({ parcelId, promptId }: { parcelId: string; promptId: string }) => {
      const res = await fetch(`/api/parcels/${parcelId}/prompts/${promptId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ completionNote: "Registrado desde panel de seguimiento" }),
      });
      if (!res.ok) throw new Error("Error al marcar tarea completada");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["phenology-prompts-all"] });
    },
  });

  const now = Date.now();
  const allPrompts = promptsData || [];
  const pending = allPrompts
    .filter((p: any) => !p.isCompleted && p.dueDate)
    .sort((a: any, b: any) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
    .slice(0, 5);

  if (pending.length === 0) return null;

  const overdue = pending.filter((p: any) => new Date(p.dueDate).getTime() < now);

  return (
    <Card className={overdue.length > 0 ? "border-amber-200" : ""}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-teal-600" />
            Próximas Actualizaciones Fenológicas
          </CardTitle>
          {overdue.length > 0 && (
            <Badge variant="secondary" className="text-amber-700 bg-amber-100 text-xs">
              {overdue.length} vencida{overdue.length > 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        <CardDescription>Tareas pendientes de campo para esta semana</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {pending.map((p: any) => {
          const dueMs = new Date(p.dueDate).getTime();
          const daysLeft = Math.round((dueMs - now) / 86400_000);
          const isOverdue = daysLeft < 0;
          return (
            <div
              key={p.id}
              className={`flex items-center gap-3 p-2.5 rounded-lg border text-sm
                ${isOverdue ? "border-amber-200 bg-amber-50/50 dark:bg-amber-950/10" : "border-border bg-muted/20"}`}
              data-testid={`phenology-task-${p.id}`}
            >
              <Circle className={`w-4 h-4 flex-shrink-0 ${isOverdue ? "text-amber-500" : "text-teal-500"}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-xs">{p.parcelName}</span>
                  <Badge variant="outline" className="text-[10px] px-1 py-0">{p.stage}</Badge>
                </div>
                <p className="text-xs text-muted-foreground truncate">{p.promptText}</p>
              </div>
              <div className="flex-shrink-0 text-right flex flex-col items-end gap-1">
                <span className={`text-xs font-medium ${isOverdue ? "text-amber-600" : "text-muted-foreground"}`}>
                  {isOverdue ? `${Math.abs(daysLeft)}d vencida` : daysLeft === 0 ? "Hoy" : `${daysLeft}d`}
                </span>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] px-2"
                    disabled={completePromptMutation.isPending}
                    onClick={() => completePromptMutation.mutate({ parcelId: p.parcelId, promptId: p.id })}
                    data-testid={`btn-complete-${p.id}`}
                  >
                    {completePromptMutation.isPending ? "..." : "✓ Listo"}
                  </Button>
                  <Link href={`/parcel/${p.parcelId}?tab=asistente`}>
                    <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" data-testid={`btn-record-${p.id}`}>
                      Registrar
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ─── T176: Cycle Comparison Chart ─────────────────────────────────────────────
// Shows current cycle vs previous cycle per parcel (rendimiento real vs esperado)
function CycleComparisonChart({ parcels }: { parcels: any[] }) {
  const { data } = useQuery({
    queryKey: ["cycle-history-all", parcels.map((p: any) => p.id).join(",")],
    queryFn: async () => {
      const results = await Promise.all(
        parcels.map((p: any) =>
          fetch(`/api/parcels/${p.id}/cycle-detail`, { credentials: "include" })
            .then(r => r.ok ? r.json() : null)
            .catch(() => null)
        )
      );
      return parcels.map((p: any, i: number) => ({ parcel: p, detail: results[i] }));
    },
    enabled: parcels.length > 0,
    staleTime: 120_000,
  });

  // Build per-parcel comparison rows: current cycle vs previous cycle
  // detail.details is the full history array sorted desc by createdAt
  const rows = (data || []).flatMap(({ parcel, detail }: any) => {
    const history: any[] = detail?.details || [];
    if (history.length === 0) return [];
    const current = history[0];
    const prev = history[1];
    const hasAny = current.expectedYieldTon || current.actualYieldTon ||
      (prev && (prev.expectedYieldTon || prev.actualYieldTon));
    if (!hasAny) return [];
    return [{
      name: parcel.name.length > 12 ? parcel.name.slice(0, 12) + "…" : parcel.name,
      crop: parcel.crop || "",
      "Ciclo actual (esp.)": current.expectedYieldTon ? parseFloat(current.expectedYieldTon) : null,
      "Ciclo actual (real)": current.actualYieldTon ? parseFloat(current.actualYieldTon) : null,
      "Ciclo anterior (esp.)": prev?.expectedYieldTon ? parseFloat(prev.expectedYieldTon) : null,
      "Ciclo anterior (real)": prev?.actualYieldTon ? parseFloat(prev.actualYieldTon) : null,
      currentSeason: current.cycleSeason ? `${current.cycleYear} ${current.cycleSeason}` : String(current.cycleYear),
      prevSeason: prev ? (prev.cycleSeason ? `${prev.cycleYear} ${prev.cycleSeason}` : String(prev.cycleYear)) : null,
    }];
  });

  if (rows.length === 0) return null;

  const hasPrevData = rows.some((r: any) => r["Ciclo anterior (esp.)"] != null || r["Ciclo anterior (real)"] != null);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Target className="w-4 h-4 text-blue-600" />
          Comparativa de Ciclos por Lote
        </CardTitle>
        <CardDescription>
          Rendimiento esperado vs real — ciclo actual{hasPrevData ? " y ciclo anterior" : ""}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={rows} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} unit=" tn" />
            <Tooltip
              formatter={(value, name) =>
                typeof value === "number" ? [`${value.toFixed(2)} tn/ha`, String(name)] : ["—", String(name)]
              }
            />
            <Legend iconSize={8} formatter={(v) => <span className="text-xs">{v}</span>} />
            <Bar dataKey="Ciclo actual (esp.)" fill="#3b82f6" radius={[3, 3, 0, 0]} />
            <Bar dataKey="Ciclo actual (real)" fill="#22c55e" radius={[3, 3, 0, 0]} />
            {hasPrevData && <Bar dataKey="Ciclo anterior (esp.)" fill="#93c5fd" radius={[3, 3, 0, 0]} />}
            {hasPrevData && <Bar dataKey="Ciclo anterior (real)" fill="#86efac" radius={[3, 3, 0, 0]} />}
          </BarChart>
        </ResponsiveContainer>
        <p className="text-[10px] text-muted-foreground mt-1">
          Barras sólidas = ciclo actual · Barras claras = ciclo anterior. "Real" se completa al cierre del ciclo.
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Regenerative Savings Panel ────────────────────────────────────────────────
function RegenerativeSavingsPanel({ parcels }: { parcels: any[] }) {
  const { data: allProfitData } = useQuery({
    queryKey: ["profitability-all", parcels.map((p: any) => p.id).join(",")],
    queryFn: async () => {
      const results = await Promise.all(
        parcels.map((p: any) =>
          fetch(`/api/parcels/${p.id}/profitability`, { credentials: "include" }).then(r => r.ok ? r.json() : null)
        )
      );
      return parcels.map((p: any, i: number) => ({ parcel: p, data: results[i] })).filter(r => r.data?.totalCost != null);
    },
    enabled: parcels.length > 0,
    staleTime: 120_000,
  });

  if (!allProfitData || allProfitData.length === 0) return null;

  const chartData = allProfitData.map(({ parcel, data }: any) => {
    const area = parseFloat(parcel.area || "1") || 1;
    const regenCostPerHa = (data.totalCost || 0) / area;
    const conventionalCostPerHa = getConventionalBenchmark(parcel.crop);
    const saving = conventionalCostPerHa - regenCostPerHa;
    return {
      name: parcel.name.length > 10 ? parcel.name.slice(0, 10) + "…" : parcel.name,
      "Costo Regen.": Math.round(regenCostPerHa),
      "Benchmark Conv.": conventionalCostPerHa,
      "Ahorro": Math.round(saving),
      isPositiveSaving: saving >= 0,
    };
  });

  const totalSaving = chartData.reduce((s: number, d: any) => s + (d["Ahorro"] > 0 ? d["Ahorro"] : 0), 0);
  const totalArea = allProfitData.reduce((s: number, { parcel }: any) => s + parseFloat(parcel.area || "1"), 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-green-600" />
          Ahorro Regenerativo vs. Convencional
        </CardTitle>
        <CardDescription>
          Comparación de costo real vs. benchmark convencional por cultivo.
          {totalSaving > 0 && (
            <span className="text-green-600 font-medium ml-1">
              Ahorro estimado: ${totalSaving.toLocaleString("es-AR", { maximumFractionDigits: 0 })}/ha promedio
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
            <Tooltip
              formatter={(value: number, name: string) => [`$${value.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`, name]}
            />
            <Legend iconSize={8} formatter={(v) => <span className="text-xs">{v}</span>} />
            <Bar dataKey="Costo Regen." fill="#22c55e" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Benchmark Conv." fill="#e2e8f0" stroke="#94a3b8" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <p className="text-xs text-muted-foreground mt-2">
          * Benchmark convencional basado en costos promedio por cultivo (datos de referencia INTA/Bolsa de Cereales).
          Un costo regenerativo menor al benchmark indica mayor eficiencia.
        </p>
      </CardContent>
    </Card>
  );
}

function PublicExplorer() {
  const { t } = useI18n();

  const { data: publicData, isLoading } = useQuery({
    queryKey: ["public-parcels"],
    queryFn: async () => {
      const response = await fetch("/api/parcels/public");
      if (!response.ok) throw new Error("Error al cargar lotes públicos");
      return response.json();
    },
  });

  const publicParcels = publicData?.parcels || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (publicParcels.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">{t("dashboard.noPublicParcels")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {publicParcels.map((parcel: any) => {
        const health = Math.floor(Math.random() * 30 + 70);
        return (
          <Link key={parcel.id} href={`/parcel/${parcel.id}`}>
            <Card className="overflow-hidden hover:shadow-lg transition-all duration-300 cursor-pointer group border-border/60">
              <div className="relative h-48 overflow-hidden">
                <ParcelMiniMap
                  lat={Number(parcel.latitude)}
                  lng={Number(parcel.longitude)}
                  polygon={parcel.polygonCoordinates as [number, number][] | undefined}
                />
                <div className="absolute top-3 right-3 z-[500]">
                  <Badge variant="secondary" className="shadow-sm">{t("dashboard.public")}</Badge>
                </div>
                <div className="absolute bottom-3 left-3 z-[500] bg-black/60 backdrop-blur-sm text-white px-3 py-1 rounded-full text-xs font-mono">
                  NDVI: 0.{health}
                </div>
              </div>
              <CardContent className="pt-6">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-heading font-semibold text-lg group-hover:text-primary transition-colors">
                    {parcel.name}
                  </h3>
                  <span className="text-sm font-mono text-muted-foreground">{parcel.area} ha</span>
                </div>
                <div className="flex items-center text-sm text-muted-foreground mb-4 gap-2">
                  <MapPin className="w-3 h-3" /> {parcel.location}
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="font-medium text-foreground">{parcel.crop}</span>
                  <span className={`font-bold ${health > 80 ? 'text-green-600' : 'text-yellow-600'}`}>
                    {health}% {t("dashboard.health")}
                  </span>
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}

const moduleLabels: Record<string, string> = {
  base: "Satélite",
  drones: "Drones",
  iot: "IoT",
  "riego-inteligente": "Riego Inteligente",
  precision: "Agricultura de Precisión",
};

const moduleIcons: Record<string, React.ElementType> = {
  base: Satellite,
  drones: Plane,
  iot: Cpu,
  "riego-inteligente": Droplets,
  precision: Target,
};

const moduleColors: Record<string, string> = {
  base: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  drones: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  iot: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  "riego-inteligente": "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  precision: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
};

function TechProfileCard({ user }: { user: any }) {
  const activeModules = getActiveModules({
    producerType: user?.producerType,
    hasDrones: user?.hasDrones,
    hasIoT: user?.hasIoT,
    techLevel: user?.techLevel,
  });

  return (
    <Card data-testid="card-tech-profile">
      <CardContent className="p-4 md:p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm md:text-base font-semibold text-foreground" data-testid="text-tech-profile-title">Mi Perfil Tecnológico</h3>
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs h-7" data-testid="link-configure-tech-profile" asChild>
            <Link href="/tech-profile">
              <Settings className="w-3.5 h-3.5" />
              Configurar
            </Link>
          </Button>
        </div>
        <div className="flex flex-wrap gap-2" data-testid="tech-modules-list">
          {moduleDefinitions.filter(mod =>
            !(HIDE_DRONES && mod.id === "drones") && !(HIDE_IOT && mod.id === "iot")
          ).map((mod) => {
            const isActive = activeModules.includes(mod.id);
            const Icon = moduleIcons[mod.id];
            const label = moduleLabels[mod.id];
            const colorClass = moduleColors[mod.id];

            return (
              <div
                key={mod.id}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  isActive ? colorClass : "bg-muted text-muted-foreground opacity-60"
                }`}
                data-testid={`badge-module-${mod.id}`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{label}</span>
                {!isActive && <span className="text-[10px] ml-0.5 opacity-70">· Disponible</span>}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function StatCard({ title, value, change, icon: Icon, trend }: any) {
  return (
    <Card>
      <CardContent className="p-3 md:pt-6 md:px-6">
        <div className="flex justify-between items-start mb-1 md:mb-2">
          <p className="text-xs md:text-sm font-medium text-muted-foreground line-clamp-1">{title}</p>
          <Icon className="w-3 h-3 md:w-4 md:h-4 text-muted-foreground flex-shrink-0" />
        </div>
        <div className="flex flex-col md:flex-row md:items-baseline gap-0 md:gap-2">
          <h2 className="text-lg md:text-2xl font-bold font-mono">{value}</h2>
          <span className={`text-xs font-medium ${
            trend === 'up' ? 'text-green-600' : 
            trend === 'down' ? 'text-red-600' : 
            'text-muted-foreground'
          }`}>
            {change}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function AlertItem({ severity, title, description, date }: any) {
  const colors = {
    high: "border-l-red-500 bg-red-50 dark:bg-red-950/20",
    medium: "border-l-yellow-500 bg-yellow-50 dark:bg-yellow-950/20",
    low: "border-l-blue-500 bg-blue-50 dark:bg-blue-950/20"
  };

  return (
    <div className={`p-4 rounded-r-md border-l-4 ${colors[severity as keyof typeof colors]} flex justify-between items-start`}>
      <div>
        <h4 className="font-semibold text-foreground text-sm mb-1">{title}</h4>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <span className="text-xs text-muted-foreground whitespace-nowrap ml-4">{date}</span>
    </div>
  );
}

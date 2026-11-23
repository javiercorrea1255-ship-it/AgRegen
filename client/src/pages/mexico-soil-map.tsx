import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { ArrowLeft, Map as MapIcon, Loader2, Eye, EyeOff, Layers, ChevronDown, ChevronUp, Zap, X, FlaskConical } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import { MapContainer, TileLayer, ImageOverlay, CircleMarker, Tooltip as LeafletTooltip, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";

const VARIABLES = [
  { value: "pH",  label: "pH",         unit: "pH",       desc: "Reacción del suelo" },
  { value: "MO",  label: "Mat. Org.",  unit: "%",        desc: "Materia orgánica" },
  { value: "P",   label: "Fósforo",    unit: "ppm",      desc: "Fósforo disponible" },
  { value: "K",   label: "Potasio",    unit: "ppm",      desc: "Potasio disponible" },
  { value: "Ca",  label: "Calcio",     unit: "ppm",      desc: "Calcio" },
  { value: "Mg",  label: "Magnesio",   unit: "ppm",      desc: "Magnesio" },
  { value: "Fe",  label: "Hierro",     unit: "ppm",      desc: "Hierro disponible" },
  { value: "Zn",  label: "Zinc",       unit: "ppm",      desc: "Zinc disponible" },
  { value: "Cu",  label: "Cobre",      unit: "ppm",      desc: "Cobre disponible" },
  { value: "Mn",  label: "Manganeso",  unit: "ppm",      desc: "Manganeso" },
  { value: "B",   label: "Boro",       unit: "ppm",      desc: "Boro disponible" },
  { value: "CIC", label: "CIC",        unit: "meq/100g", desc: "Intercambio catiónico" },
  { value: "CE",  label: "CE",         unit: "dS/m",     desc: "Conductividad eléctrica" },
  { value: "N",   label: "Nitrógeno",  unit: "%",        desc: "Nitrógeno total" },
  { value: "Na",  label: "Sodio",      unit: "ppm",      desc: "Sodio disponible" },
];

// All states with INIFAP soil data (26 states)
const DB_STATES = [
  "AGUASCALIENTES","CAMPECHE","CDMX","CHIAPAS","CHIHUAHUA",
  "COAHUILA","COLIMA","DURANGO","GUANAJUATO","GUERRERO",
  "HIDALGO","JALISCO","MEXICO","MICHOACAN","MORELOS",
  "NUEVO LEON","OAXACA","PUEBLA","QUERETARO","QUINTANAROO",
  "SAN LUIS POTOSI","SINALOA","SONORA","TLAXCALA","YUCATAN","ZACATECAS",
];

// Short display labels for tight chips
const STATE_LABELS: Record<string, string> = {
  AGUASCALIENTES: "AGS", CAMPECHE: "CAM", CDMX: "CDMX", CHIAPAS: "CHIS",
  CHIHUAHUA: "CHIH", COAHUILA: "COAH", COLIMA: "COL", DURANGO: "DGO",
  GUANAJUATO: "GTO", GUERRERO: "GRO", HIDALGO: "HGO", JALISCO: "JAL",
  MEXICO: "MEX", MICHOACAN: "MICH", MORELOS: "MOR", "NUEVO LEON": "NL",
  OAXACA: "OAX", PUEBLA: "PUE", QUERETARO: "QRO", QUINTANAROO: "QROO",
  "SAN LUIS POTOSI": "SLP", SINALOA: "SIN", SONORA: "SON", TLAXCALA: "TLAX",
  YUCATAN: "YUC", ZACATECAS: "ZAC",
};

const MEXICO_CENTER: [number, number] = [20.5, -98.5];
const MEXICO_ZOOM = 6;

const COLOR_STOPS: [number, number, number][] = [
  [215, 48, 39], [244, 109, 67], [253, 174, 97], [255, 255, 191], [166, 217, 106], [26, 152, 80],
];

function lerpColor(t: number): string {
  const c = Math.max(0, Math.min(1, t));
  const n = COLOR_STOPS.length - 1;
  const idx = c * n;
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, n);
  const f = idx - lo;
  const [r1, g1, b1] = COLOR_STOPS[lo];
  const [r2, g2, b2] = COLOR_STOPS[hi];
  return `rgb(${Math.round(r1 + f*(r2-r1))},${Math.round(g1 + f*(g2-g1))},${Math.round(b1 + f*(b2-b1))})`;
}

function fmt(v: number | null | undefined, dec = 2): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toFixed(dec);
}

function ResetView({ trigger }: { trigger: number }) {
  const map = useMap();
  useEffect(() => { map.setView(MEXICO_CENTER, MEXICO_ZOOM); }, [map, trigger]);
  return null;
}

interface StateRaster {
  variable: string;
  method: string;       // "rfk" | "kriging" | "idw"
  estado: string;
  n: number;            // raw state-only points
  nUsed: number;        // points sent to geo-service after decimation
  neighborCount?: number; // neighbor points blended in (sparse states)
  stats: { min: number; max: number; mean: number; std: number; median: number };
  rasterPng: string;
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  displayVmin: number;
  displayVmax: number;
  // Numeric grid for hover — 80×80 values in transformed space (null = outside polygon)
  gridValues?: (number | null)[][] | null;
  rasterVmin?: number;
  rasterVmax?: number;
}

function methodLabel(method: string): string {
  if (method === "rfk") return "RF+Kriging";
  if (method === "kriging") return "Kriging";
  if (method === "idw") return "IDW";
  return method.toUpperCase();
}

function dominantMethod(rasters: StateRaster[]): string {
  if (rasters.length === 0) return "Adaptativo";
  const counts: Record<string, number> = {};
  for (const r of rasters) counts[r.method] = (counts[r.method] ?? 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  return Object.keys(counts).length > 1 ? "Adaptativo" : methodLabel(top);
}

interface HoverInfo {
  x: number;          // container pixel X
  y: number;          // container pixel Y
  value: number;      // display-unit value at cursor
  estado: string;
}

// Bilinear interpolation into a 2-D grid given fractional row/col indices
function bilinearSample(
  grid: (number | null)[][],
  rowF: number,
  colF: number,
): number | null {
  const nR = grid.length;
  const nC = grid[0]?.length ?? 0;
  if (!nR || !nC) return null;
  const r0 = Math.max(0, Math.min(nR - 1, Math.floor(rowF)));
  const r1 = Math.min(nR - 1, r0 + 1);
  const c0 = Math.max(0, Math.min(nC - 1, Math.floor(colF)));
  const c1 = Math.min(nC - 1, c0 + 1);
  const fr = rowF - r0;
  const fc = colF - c0;
  const v00 = grid[r0][c0]; const v01 = grid[r0][c1];
  const v10 = grid[r1][c0]; const v11 = grid[r1][c1];
  // Require at least one valid neighbour
  const top  = v00 != null ? (v01 != null ? v00 * (1 - fc) + v01 * fc : v00)
                           : (v01 != null ? v01 : null);
  const bot  = v10 != null ? (v11 != null ? v10 * (1 - fc) + v11 * fc : v10)
                           : (v11 != null ? v11 : null);
  if (top == null && bot == null) return null;
  if (top == null) return bot;
  if (bot == null) return top;
  return top * (1 - fr) + bot * fr;
}

// Leaflet inner component: tracks mouse and reports hover info to parent
function MapHoverTracker({
  rasters,
  onHover,
}: {
  rasters: StateRaster[];
  onHover: (info: HoverInfo | null) => void;
}) {
  useMapEvents({
    mousemove(e) {
      const { lat, lng } = e.latlng;
      const cp = e.containerPoint;
      // Find the first visible raster whose bbox contains (lat, lng)
      const raster = rasters.find(r =>
        r.gridValues && r.gridValues.length > 0 &&
        lat >= r.bbox.minLat && lat <= r.bbox.maxLat &&
        lng >= r.bbox.minLng && lng <= r.bbox.maxLng,
      );
      if (!raster || !raster.gridValues) { onHover(null); return; }

      const { minLat, maxLat, minLng, maxLng } = raster.bbox;
      const grid = raster.gridValues;
      const nR = grid.length;
      const nC = (grid[0]?.length) ?? 0;
      if (!nR || !nC) { onHover(null); return; }

      // Row 0 = minLat (south), row nR-1 = maxLat (north)
      const rowF = (lat - minLat) / (maxLat - minLat) * (nR - 1);
      const colF = (lng - minLng) / (maxLng - minLng) * (nC - 1);
      const gridVal = bilinearSample(grid, rowF, colF);
      if (gridVal == null) { onHover(null); return; }

      // Convert from transformed space to approximate display units (linear interp)
      const vMin = raster.rasterVmin ?? 0;
      const vMax = raster.rasterVmax ?? 1;
      const t = vMax > vMin ? (gridVal - vMin) / (vMax - vMin) : 0.5;
      const value = (raster.displayVmin ?? vMin) +
                    t * ((raster.displayVmax ?? vMax) - (raster.displayVmin ?? vMin));

      onHover({ x: cp.x, y: cp.y, value, estado: raster.estado });
    },
    mouseout() { onHover(null); },
  });
  return null;
}

interface SamplePoint {
  lat: number;
  lng: number;
  value: number;
  municipio?: string | null;
  estado?: string | null;
  labNumber?: string | null;
  localidad?: string | null;
  loteu?: string | null;
  ph?: number | null;
  ce?: number | null;
  dap?: number | null;
  mo?: number | null;
  n?: number | null;
  p?: number | null;
  k?: number | null;
  ca?: number | null;
  mg?: number | null;
  fe?: number | null;
  zn?: number | null;
  b?: number | null;
  mn?: number | null;
  cu?: number | null;
  na?: number | null;
  cic?: number | null;
  arcilla?: number | null;
  limo?: number | null;
  arena?: number | null;
  textura?: string | null;
}

export default function MexicoSoilMap() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === "admin";

  const [activeVar, setActiveVar] = useState<string>("pH");
  const [estado, setEstado] = useState(""); // "" = all states
  const [opacity, setOpacity] = useState(0.80);
  const [showPoints, setShowPoints] = useState(true);
  const [resetView, setResetView] = useState(0);
  // States hidden from the map (toggled off by the user)
  const [hiddenStates, setHiddenStates] = useState<Set<string>>(new Set());
  // Whether the states panel section is expanded
  const [statesExpanded, setStatesExpanded] = useState(true);
  // Background pre-warm state
  const [isWarming, setIsWarming] = useState(false);
  // Hover tooltip info from MapHoverTracker
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  // Clicked point — shows full analysis panel
  const [selectedPoint, setSelectedPoint] = useState<SamplePoint | null>(null);

  // Per-state raster cache: "${variable}:${estado}" → StateRaster
  const rasterCacheRef = useRef<Map<string, StateRaster>>(new Map());
  // Currently displayed rasters
  const [stateRasters, setStateRasters] = useState<StateRaster[]>([]);
  // Which states are still being fetched
  const [loadingStates, setLoadingStates] = useState<Set<string>>(new Set());
  // Variable currently triggering loads
  const [loadingVar, setLoadingVar] = useState<string | null>(null);

  const { data: estadosData } = useQuery<{ estados: string[] }>({
    queryKey: ["mexico-estados"],
    queryFn: async () => {
      const r = await fetch("/api/mexico-estados");
      if (!r.ok) return { estados: [] };
      return r.json();
    },
  });
  const estadosList = estadosData?.estados ?? [];

  // DB cache status — how many of the 390 slots are pre-computed
  const { data: cacheStatus, refetch: refetchCacheStatus } = useQuery<{ cached: number; total: number }>({
    queryKey: ["mexico-raster-cache-status"],
    queryFn: async () => {
      const r = await fetch("/api/mexico-soil-raster-cache/status");
      if (!r.ok) return { cached: 0, total: 390 };
      return r.json();
    },
    staleTime: 60_000,
    refetchInterval: isWarming ? 10_000 : false,
  });

  const handleWarmCache = async () => {
    setIsWarming(true);
    try {
      const r = await fetch("/api/mexico-soil-raster-cache/warm", { method: "POST" });
      const data = await r.json();
      toast({ title: "Pre-generando caché", description: data.message, duration: 6000 });
      // Poll until complete
      const poll = setInterval(async () => {
        const s = await fetch("/api/mexico-soil-raster-cache/status").then(r => r.json());
        queryClient.setQueryData(["mexico-raster-cache-status"], s);
        if (s.cached >= s.total) { clearInterval(poll); setIsWarming(false);
          toast({ title: "Caché completo", description: `${s.cached} rásteres listos`, duration: 5000 }); }
      }, 15_000);
    } catch {
      toast({ title: "Error", description: "No se pudo iniciar pre-generación", variant: "destructive" });
      setIsWarming(false);
    }
  };

  const { data: samplesData, isLoading: samplesLoading } = useQuery<{ points: SamplePoint[] }>({
    queryKey: ["mexico-soil-map-points", activeVar, estado],
    queryFn: async () => {
      const params = new URLSearchParams({ variable: activeVar });
      if (estado) params.set("estado", estado);
      const r = await fetch(`/api/mexico-soil-map-points?${params}`);
      if (!r.ok) return { points: [] };
      return r.json();
    },
    enabled: showPoints,
    staleTime: 5 * 60 * 1000,
  });
  const samplePoints = samplesData?.points ?? [];

  // Fetch a single state's raster — updates stateRasters progressively
  const fetchStateRaster = useCallback(async (variable: string, est: string) => {
    const cacheKey = `${variable}:${est}`;
    const cached = rasterCacheRef.current.get(cacheKey);
    if (cached) {
      setStateRasters(prev => {
        const others = prev.filter(r => r.estado !== est);
        return [...others, cached];
      });
      return;
    }
    setLoadingStates(prev => new Set(Array.from(prev).concat(est)));
    try {
      const params = new URLSearchParams({ variable, estado: est });
      const r = await fetch(`/api/mexico-soil-raster-by-state?${params}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || `Error en ${est}`);
      const raster = data as StateRaster;
      rasterCacheRef.current.set(cacheKey, raster);
      setStateRasters(prev => {
        const others = prev.filter(r => r.estado !== est);
        return [...others, raster];
      });
    } catch (e: unknown) {
      const msg = (e as Error).message || "";
      const silent = msg.includes("Insuficientes") || msg.includes("Sin polígono") || msg.includes("requiere");
      if (!silent) {
        toast({ title: `Error — ${est}`, description: msg, variant: "destructive" });
      }
    } finally {
      setLoadingStates(prev => { const s = new Set(prev); s.delete(est); return s; });
    }
  }, [toast]);

  // Trigger fetches whenever variable or estado filter changes
  useEffect(() => {
    // Raster overlays temporarily disabled — only sample points are shown
    return;
    const targets = estado ? [estado] : DB_STATES;
    setStateRasters([]);
    setLoadingVar(activeVar);
    let allCached = true;
    for (const est of targets) {
      if (!rasterCacheRef.current.has(`${activeVar}:${est}`)) { allCached = false; break; }
    }
    if (allCached) {
      const restored = targets
        .map(est => rasterCacheRef.current.get(`${activeVar}:${est}`)!)
        .filter(Boolean);
      setStateRasters(restored);
      setLoadingVar(null);
      return;
    }
    // Throttle to max 3 concurrent geo-service fetches to avoid timeouts
    // (geo-service is CPU-bound Python; too many concurrent requests queue up and expire)
    const queue = [...targets];
    const CONCURRENCY = 3;
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length > 0) {
        const est = queue.shift();
        if (est) await fetchStateRaster(activeVar, est);
      }
    });
    Promise.all(workers).finally(() => {
      setLoadingVar(null);
    });
  }, [activeVar, estado]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEstadoChange = (v: string) => {
    const newEstado = v === "__all__" ? "" : v;
    setEstado(newEstado);
    setStateRasters([]);
    setHiddenStates(new Set()); // reset hidden states when switching filter
    setResetView(n => n + 1);
  };

  const toggleState = (est: string) => {
    setHiddenStates(prev => {
      const next = new Set(prev);
      if (next.has(est)) next.delete(est);
      else next.add(est);
      return next;
    });
  };

  const showAllStates = () => setHiddenStates(new Set());
  const hideAllStates = () => {
    const loaded = new Set(stateRasters.map(r => r.estado));
    setHiddenStates(loaded);
  };

  // Computed values — only over visible (non-hidden) rasters
  const varMeta = VARIABLES.find(v => v.value === activeVar)!;
  const visibleRasters = stateRasters.filter(r => !hiddenStates.has(r.estado));
  const globalVmin = visibleRasters.length > 0
    ? Math.min(...visibleRasters.map(r => r.displayVmin ?? r.stats.min))
    : 0;
  const globalVmax = visibleRasters.length > 0
    ? Math.max(...visibleRasters.map(r => r.displayVmax ?? r.stats.max))
    : 1;
  const totalN = visibleRasters.reduce((s, r) => s + r.n, 0);
  const totalUsed = visibleRasters.reduce((s, r) => s + r.nUsed, 0);
  const allMins = visibleRasters.map(r => r.stats.min);
  const allMaxs = visibleRasters.map(r => r.stats.max);
  const globalMin = allMins.length ? Math.min(...allMins) : null;
  const globalMax = allMaxs.length ? Math.max(...allMaxs) : null;
  const globalMean = visibleRasters.length > 0
    ? visibleRasters.reduce((s, r) => s + r.stats.mean * r.n, 0) / Math.max(totalN, 1)
    : null;

  const isLoading = loadingStates.size > 0;
  const targetCount = estado ? 1 : DB_STATES.length;
  const loadedCount = stateRasters.length;

  const varHasCache = (v: string) => {
    const targets = estado ? [estado] : DB_STATES;
    return targets.some(est => rasterCacheRef.current.has(`${v}:${est}`));
  };

  // States to show in the toggle panel (loaded or currently loading)
  const toggleableStates = estado ? [estado] : DB_STATES;

  return (
    <div className="min-h-screen bg-background flex flex-col" style={{ height: "100vh", overflow: "hidden" }}>
      {/* Header */}
      <div className="border-b bg-card px-4 py-2.5 flex items-center gap-3 shrink-0 z-10">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setLocation("/dashboard")} data-testid="btn-back">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <MapIcon className="w-4 h-4 text-green-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-sm">Atlas de Suelos de México</h1>
        </div>
        <div className="flex items-center gap-2">
          <Select value="__all__" disabled>
            <SelectTrigger className="h-8 w-44 text-xs opacity-40 cursor-not-allowed" data-testid="select-estado">
              <SelectValue placeholder="Todo México" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">🇲🇽 Todo México</SelectItem>
            </SelectContent>
          </Select>
          <Badge variant="outline" className="shrink-0 text-blue-700 border-blue-200 bg-blue-50 text-xs">
            Puntos de muestreo
          </Badge>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Layer panel */}
        <div className="w-56 border-r bg-card flex flex-col overflow-y-auto shrink-0">
          <div className="p-3 space-y-1">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 pb-1 flex items-center gap-1 opacity-40">
              <Layers className="w-3 h-3" /> Capas de variables
            </p>
            <div className="pointer-events-none opacity-35 select-none">
            {VARIABLES.map(v => (
              <button
                key={v.value}
                disabled
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs text-muted-foreground cursor-not-allowed"
              >
                <EyeOff className="w-3.5 h-3.5 shrink-0 opacity-40" />
                <span className="flex-1 truncate">{v.label}</span>
                <span className="text-[10px] opacity-60">{v.unit}</span>
              </button>
            ))}
            </div>

            {/* Sampling points toggle */}
            <div className="pt-2 border-t">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 pb-1 flex items-center gap-1">
                Puntos de muestreo
              </p>
              <button
                data-testid="btn-toggle-points"
                onClick={() => setShowPoints(p => !p)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors text-xs ${
                  showPoints
                    ? "bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 font-semibold"
                    : "hover:bg-muted text-muted-foreground"
                }`}
              >
                {samplesLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600 shrink-0" />
                ) : showPoints ? (
                  <Eye className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5 shrink-0 opacity-40" />
                )}
                <span>
                  {showPoints && samplePoints.length > 0
                    ? `${samplePoints.length.toLocaleString()} puntos`
                    : "Mostrar puntos"}
                </span>
              </button>
            </div>

            {/* States visibility toggles */}
            {stateRasters.length > 0 && (
              <div className="pt-2 border-t">
                <button
                  data-testid="btn-toggle-states-section"
                  onClick={() => setStatesExpanded(e => !e)}
                  className="w-full flex items-center justify-between px-1 pb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
                >
                  <span className="flex items-center gap-1">
                    <Eye className="w-3 h-3" />
                    Estados visibles
                    {hiddenStates.size > 0 && (
                      <span className="ml-1 px-1 py-0 rounded-full bg-amber-100 text-amber-700 text-[9px] font-bold">
                        {hiddenStates.size} oculto{hiddenStates.size !== 1 ? "s" : ""}
                      </span>
                    )}
                  </span>
                  {statesExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>

                {statesExpanded && (
                  <>
                    {/* Quick actions */}
                    <div className="flex gap-1 mb-1.5">
                      <button
                        data-testid="btn-show-all-states"
                        onClick={showAllStates}
                        disabled={hiddenStates.size === 0}
                        className="flex-1 text-[10px] px-1.5 py-1 rounded bg-green-50 hover:bg-green-100 text-green-700 disabled:opacity-40 disabled:cursor-default transition-colors"
                      >
                        Mostrar todos
                      </button>
                      <button
                        data-testid="btn-hide-all-states"
                        onClick={hideAllStates}
                        disabled={hiddenStates.size === stateRasters.length}
                        className="flex-1 text-[10px] px-1.5 py-1 rounded bg-red-50 hover:bg-red-100 text-red-700 disabled:opacity-40 disabled:cursor-default transition-colors"
                      >
                        Ocultar todos
                      </button>
                    </div>

                    {/* State chips grid */}
                    <div className="flex flex-wrap gap-1">
                      {toggleableStates.map(est => {
                        const loaded = stateRasters.some(r => r.estado === est);
                        const loading = loadingStates.has(est);
                        const hidden = hiddenStates.has(est);
                        return (
                          <button
                            key={est}
                            data-testid={`btn-state-toggle-${est}`}
                            title={est}
                            disabled={!loaded && !loading}
                            onClick={() => loaded && toggleState(est)}
                            className={`text-[10px] px-1.5 py-0.5 rounded-md font-mono transition-all border ${
                              loading
                                ? "border-purple-200 bg-purple-50 text-purple-400 cursor-wait"
                                : !loaded
                                ? "border-border/30 bg-muted/30 text-muted-foreground/40 cursor-default"
                                : hidden
                                ? "border-border bg-muted/60 text-muted-foreground line-through opacity-60"
                                : "border-green-200 bg-green-50 text-green-800 hover:bg-green-100"
                            }`}
                          >
                            {loading ? (
                              <span className="flex items-center gap-0.5">
                                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                {STATE_LABELS[est] ?? est}
                              </span>
                            ) : (
                              STATE_LABELS[est] ?? est
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Legend */}
          {visibleRasters.length > 0 && (
            <div className="px-3 pb-3 space-y-1.5">
              <div className="border-t pt-3">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                  Leyenda — {varMeta.label} ({varMeta.unit})
                </p>
                <div
                  className="h-4 w-full rounded"
                  style={{
                    background: `linear-gradient(to right, ${COLOR_STOPS.map((_, i) =>
                      lerpColor(i / (COLOR_STOPS.length - 1))).join(", ")})`,
                  }}
                />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>{fmt(globalVmin)}</span>
                  <span>{fmt((globalVmin + globalVmax) / 2)}</span>
                  <span>{fmt(globalVmax)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Opacity control */}
          {stateRasters.length > 0 && (
            <div className="px-3 pb-3">
              <div className="flex items-center justify-between mb-1">
                <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Opacidad</Label>
                <span className="text-[10px] text-muted-foreground">{Math.round(opacity * 100)}%</span>
              </div>
              <Slider
                min={20}
                max={100}
                step={5}
                value={[Math.round(opacity * 100)]}
                onValueChange={([v]) => setOpacity(v / 100)}
                data-testid="slider-opacity"
              />
            </div>
          )}

          {/* Aggregate stats */}
          {visibleRasters.length > 0 && (
            <div className="px-3 pb-4 border-t pt-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                Estadísticas {isLoading
                  ? `(${loadedCount}/${targetCount} estados)`
                  : `— ${visibleRasters.length} estado${visibleRasters.length !== 1 ? "s" : ""}`}
              </p>
              <table className="w-full text-[11px]">
                <tbody>
                  {[
                    ["Muestras", totalN.toLocaleString()],
                    ["Usadas", totalUsed.toLocaleString()],
                    ["Mín", globalMin != null ? `${fmt(globalMin)} ${varMeta.unit}` : "—"],
                    ["Máx", globalMax != null ? `${fmt(globalMax)} ${varMeta.unit}` : "—"],
                    ["Media", globalMean != null ? `${fmt(globalMean)} ${varMeta.unit}` : "—"],
                  ].map(([label, value]) => (
                    <tr key={label as string} className="border-b border-border/40 last:border-0">
                      <td className="py-0.5 text-muted-foreground pr-1">{label}</td>
                      <td className="py-0.5 font-mono text-right text-foreground">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Loading state in panel */}
          {isLoading && (
            <div className="px-3 pb-3">
              <Card className="bg-purple-50 dark:bg-purple-900/20 border-purple-200">
                <CardContent className="p-3 flex items-center gap-2 text-xs text-purple-800 dark:text-purple-200">
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  <span>
                    {loadedCount}/{targetCount} estados · interpolando…
                  </span>
                </CardContent>
              </Card>
            </div>
          )}

          {/* DB Raster cache status */}
          <div className="px-3 pb-3 border-t pt-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <Zap className="w-3 h-3" /> Caché persistente
            </p>
            {cacheStatus ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">Generados</span>
                  <span className={`font-mono font-semibold ${cacheStatus.cached === cacheStatus.total ? "text-green-700" : "text-amber-700"}`}>
                    {cacheStatus.cached}/{cacheStatus.total}
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${cacheStatus.cached === cacheStatus.total ? "bg-green-500" : "bg-amber-400"}`}
                    style={{ width: `${(cacheStatus.cached / cacheStatus.total) * 100}%` }}
                  />
                </div>
                {isAdmin && cacheStatus.cached < cacheStatus.total && (
                  <button
                    data-testid="btn-warm-cache"
                    onClick={handleWarmCache}
                    disabled={isWarming}
                    className="w-full flex items-center justify-center gap-1.5 text-[10px] px-2 py-1.5 rounded-md bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 disabled:opacity-50 disabled:cursor-wait transition-colors"
                  >
                    {isWarming ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                    {isWarming ? "Pre-generando…" : "Pre-generar todo"}
                  </button>
                )}
                {cacheStatus.cached === cacheStatus.total && (
                  <p className="text-[10px] text-green-700 text-center">✓ Todos los rásteres guardados</p>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" /> Verificando…
              </div>
            )}
          </div>
        </div>

        {/* Map */}
        <div className="flex-1 relative">
          <MapContainer
            center={MEXICO_CENTER}
            zoom={MEXICO_ZOOM}
            className="w-full h-full"
            style={{ height: "100%" }}
            scrollWheelZoom
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {/* Per-state raster overlays — skip hidden states */}
            {visibleRasters.map(r => (
              <ImageOverlay
                key={`${r.variable}:${r.estado}`}
                url={`data:image/png;base64,${r.rasterPng}`}
                bounds={[[r.bbox.minLat, r.bbox.minLng], [r.bbox.maxLat, r.bbox.maxLng]]}
                opacity={opacity}
                zIndex={10}
              />
            ))}
            <MapHoverTracker rasters={visibleRasters} onHover={setHoverInfo} />
            {showPoints && samplePoints.map((pt, i) => {
              const t = isFinite(globalVmax - globalVmin) && globalVmax > globalVmin
                ? (pt.value - globalVmin) / (globalVmax - globalVmin)
                : 0.5;
              const color = lerpColor(Math.max(0, Math.min(1, t)));
              const isSelected = selectedPoint === pt;
              return (
                <CircleMarker
                  key={i}
                  center={[pt.lat, pt.lng]}
                  radius={isSelected ? 6 : 3}
                  pathOptions={{
                    fillColor: color,
                    fillOpacity: 0.95,
                    color: isSelected ? "#1e40af" : "#fff",
                    weight: isSelected ? 2 : 0.5,
                  }}
                  eventHandlers={{
                    click: () => setSelectedPoint(prev => prev === pt ? null : pt),
                  }}
                >
                  <LeafletTooltip>
                    <div className="text-xs">
                      {(pt.municipio || pt.estado) && (
                        <div className="font-semibold">{[pt.municipio, pt.estado].filter(Boolean).join(", ")}</div>
                      )}
                      <div>{varMeta.label}: <strong>{fmt(pt.value)} {varMeta.unit}</strong></div>
                      <div className="text-muted-foreground mt-0.5">Clic para ver análisis completo</div>
                    </div>
                  </LeafletTooltip>
                </CircleMarker>
              );
            })}
            <ResetView trigger={resetView} />
          </MapContainer>

          {/* Full analysis panel — shown on point click */}
          {selectedPoint && (
            <div className="absolute top-3 right-3 z-30 w-72 bg-card border shadow-xl rounded-xl overflow-hidden flex flex-col max-h-[calc(100%-24px)]">
              {/* Header */}
              <div className="flex items-center gap-2 px-3 py-2.5 bg-green-700 text-white shrink-0">
                <FlaskConical className="w-4 h-4 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">
                    {[selectedPoint.municipio, selectedPoint.estado].filter(Boolean).join(", ") || "Punto de muestreo"}
                  </div>
                  {selectedPoint.localidad && (
                    <div className="text-[11px] opacity-80 truncate">{selectedPoint.localidad}</div>
                  )}
                </div>
                <button
                  onClick={() => setSelectedPoint(null)}
                  className="shrink-0 p-0.5 rounded hover:bg-white/20 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Meta */}
              {(selectedPoint.labNumber || selectedPoint.loteu) && (
                <div className="px-3 py-1.5 bg-muted/40 border-b flex gap-3 text-[10px] text-muted-foreground shrink-0">
                  {selectedPoint.labNumber && <span>Lab: <span className="font-mono text-foreground">{selectedPoint.labNumber}</span></span>}
                  {selectedPoint.loteu && <span>Lote: <span className="font-mono text-foreground">{selectedPoint.loteu}</span></span>}
                </div>
              )}

              {/* Scrollable body */}
              <div className="overflow-y-auto flex-1 p-3 space-y-3">
                {/* Chemical parameters */}
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Parámetros químicos</p>
                  <table className="w-full text-xs">
                    <tbody>
                      {([
                        ["pH", selectedPoint.ph, "pH"],
                        ["Mat. Orgánica", selectedPoint.mo, "%"],
                        ["CE", selectedPoint.ce, "dS/m"],
                        ["Nitrógeno", selectedPoint.n, "%"],
                        ["Fósforo", selectedPoint.p, "ppm"],
                        ["Potasio", selectedPoint.k, "ppm"],
                        ["Calcio", selectedPoint.ca, "ppm"],
                        ["Magnesio", selectedPoint.mg, "ppm"],
                        ["Sodio", selectedPoint.na, "ppm"],
                        ["CIC", selectedPoint.cic, "meq/100g"],
                      ] as [string, number | null | undefined, string][]).map(([label, val, unit]) => (
                        <tr key={label} className="border-b border-border/30 last:border-0">
                          <td className="py-0.5 text-muted-foreground pr-2 w-1/2">{label}</td>
                          <td className="py-0.5 font-mono text-right">
                            {val != null ? <><span className="font-semibold">{fmt(val)}</span> <span className="text-[10px] text-muted-foreground">{unit}</span></> : <span className="opacity-30">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Micronutrients */}
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Micronutrimentos</p>
                  <table className="w-full text-xs">
                    <tbody>
                      {([
                        ["Hierro", selectedPoint.fe, "ppm"],
                        ["Zinc", selectedPoint.zn, "ppm"],
                        ["Cobre", selectedPoint.cu, "ppm"],
                        ["Manganeso", selectedPoint.mn, "ppm"],
                        ["Boro", selectedPoint.b, "ppm"],
                      ] as [string, number | null | undefined, string][]).map(([label, val, unit]) => (
                        <tr key={label} className="border-b border-border/30 last:border-0">
                          <td className="py-0.5 text-muted-foreground pr-2 w-1/2">{label}</td>
                          <td className="py-0.5 font-mono text-right">
                            {val != null ? <><span className="font-semibold">{fmt(val)}</span> <span className="text-[10px] text-muted-foreground">{unit}</span></> : <span className="opacity-30">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Physical / texture */}
                {(selectedPoint.arcilla != null || selectedPoint.limo != null || selectedPoint.arena != null || selectedPoint.textura || selectedPoint.dap != null) && (
                  <div>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Propiedades físicas</p>
                    <table className="w-full text-xs">
                      <tbody>
                        {([
                          ["Arcilla", selectedPoint.arcilla, "%"],
                          ["Limo", selectedPoint.limo, "%"],
                          ["Arena", selectedPoint.arena, "%"],
                          ["D.A.P.", selectedPoint.dap, "g/cm³"],
                        ] as [string, number | null | undefined, string][]).filter(([, v]) => v != null).map(([label, val, unit]) => (
                          <tr key={label} className="border-b border-border/30 last:border-0">
                            <td className="py-0.5 text-muted-foreground pr-2 w-1/2">{label}</td>
                            <td className="py-0.5 font-mono text-right">
                              <span className="font-semibold">{fmt(val as number)}</span> <span className="text-[10px] text-muted-foreground">{unit}</span>
                            </td>
                          </tr>
                        ))}
                        {selectedPoint.textura && (
                          <tr>
                            <td className="py-0.5 text-muted-foreground pr-2">Textura</td>
                            <td className="py-0.5 text-right font-semibold capitalize">{selectedPoint.textura}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Coordinates */}
                <div className="text-[10px] text-muted-foreground font-mono text-center pt-1 border-t">
                  {selectedPoint.lat.toFixed(5)}, {selectedPoint.lng.toFixed(5)}
                </div>
              </div>
            </div>
          )}

          {/* Hover tooltip */}
          {hoverInfo && (
            <div
              className="absolute z-30 pointer-events-none"
              style={{ left: hoverInfo.x + 14, top: hoverInfo.y - 12 }}
            >
              <div className="bg-gray-900/90 text-white text-xs rounded-lg px-2.5 py-1.5 shadow-xl backdrop-blur-sm flex flex-col gap-0.5 min-w-[110px]">
                <span className="font-semibold text-[11px] text-green-300">{varMeta.label}</span>
                <span className="font-mono text-sm font-bold">
                  {fmt(hoverInfo.value, varMeta.unit === "pH" ? 2 : 1)} <span className="text-[10px] font-normal opacity-70">{varMeta.unit}</span>
                </span>
                <span className="text-[9px] opacity-50">{hoverInfo.estado}</span>
              </div>
            </div>
          )}

          {/* Progressive loading overlay */}
          {isLoading && (
            <div className="absolute inset-0 flex items-end justify-center pb-10 z-20 pointer-events-none">
              <div className="bg-card border shadow-lg rounded-xl px-6 py-3 flex items-center gap-3">
                <Loader2 className="w-5 h-5 animate-spin text-purple-600" />
                <div>
                  <p className="font-semibold text-sm">
                    Interpolando {varMeta.label} por estado…
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Interpolación adaptativa · {loadedCount} de {targetCount} estados listos
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

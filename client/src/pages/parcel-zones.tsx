import { useParams, useLocation, useSearch } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, ChevronDown, ChevronUp, ChevronRight, Bot, Loader2, Layers, MapPin, Sparkles, Satellite, Download, Trash2, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { MapContainer, TileLayer, Polygon, ImageOverlay, Tooltip as LeafletTooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { SamplingCampaign, InterpolationResult, ManagementZone, SamplingPoint } from "@shared/schema";

const EMPTY_CAMPAIGNS: SamplingCampaign[] = [];
const EMPTY_INTERPOLATIONS: InterpolationResult[] = [];

const ZONE_COLORS = ["#d73027", "#fdae61", "#a6d96a", "#1a9850", "#2166ac"];
const ZONE_LABELS = ["Baja", "Media-Baja", "Media", "Media-Alta", "Alta"];

const SATELLITE_INDICES = [
  { value: "ndvi", label: "NDVI", desc: "Vigor / cobertura vegetal" },
  { value: "ndre", label: "NDRE", desc: "Borde rojo · clorofila / N" },
  { value: "ndmi", label: "NDMI", desc: "Humedad del dosel" },
  { value: "evi", label: "EVI", desc: "Vigor mejorado (suelo bajo)" },
  { value: "msavi", label: "MSAVI", desc: "Vigor con suelo desnudo" },
  { value: "gndvi", label: "GNDVI", desc: "Verdor / clorofila" },
] as const;

const ZONIFY_METHODS = [
  { value: "spatial_kmeans", label: "K-means espacial (recomendado)" },
  { value: "jenks", label: "Jenks (cortes naturales)" },
  { value: "quantiles", label: "Cuantiles (zonas de igual área)" },
  { value: "fuzzy", label: "Fuzzy C-means" },
] as const;

interface InterpolationWithZones {
  interpolation: InterpolationResult;
  zones: ManagementZone[];
}

interface SatelliteZoneSet {
  zoneSetId: string;
  createdAt: string;
  metadata: {
    indexType?: string;
    imageDate?: string;
    scaleM?: number;
    rows?: number;
    cols?: number;
    validPixels?: number;
    bbox?: { minx: number; miny: number; maxx: number; maxy: number };
    vmin?: number;
    vmax?: number;
    cloudyPixelPercentage?: number | null;
    method?: string;
    nZonesActual?: number;
  } | null;
  zones: ManagementZone[];
}

function coordsFromGeojson(geojson: unknown): [number, number][][] {
  if (!geojson || typeof geojson !== "object") return [];
  const g = geojson as { type?: string; coordinates?: unknown };
  if (g.type === "Polygon" && Array.isArray(g.coordinates)) {
    return (g.coordinates as number[][][]).map(ring => ring.map(c => [c[1], c[0]] as [number, number]));
  }
  if (g.type === "MultiPolygon" && Array.isArray(g.coordinates)) {
    return (g.coordinates as number[][][][]).flatMap(poly => poly.map(ring => ring.map(c => [c[1], c[0]] as [number, number])));
  }
  if (g.type === "Feature") {
    const f = geojson as { geometry?: unknown };
    return coordsFromGeojson(f.geometry);
  }
  return [];
}

function FitBounds({ coords }: { coords: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    const valid = coords.filter(c => Number.isFinite(c[0]) && Number.isFinite(c[1]));
    if (valid.length === 0) return;
    try {
      map.stop();
      map.fitBounds(valid as [number, number][], { padding: [30, 30] });
    } catch (_) {}
  }, [coords, map]);
  return null;
}

function MapCleanup() {
  const map = useMap();
  useEffect(() => () => { try { map.stop(); } catch (_) {} }, [map]);
  return null;
}

export default function ParcelZones() {
  const { id } = useParams<{ id: string }>();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const searchParams = new URLSearchParams(search);
  const interpFromUrl = searchParams.get("interpolation") ?? "";
  const campaignFromUrl = searchParams.get("campaign") ?? "";

  const [selectedCampaignId, setSelectedCampaignId] = useState<string>(campaignFromUrl);
  const [selectedInterpId, setSelectedInterpId] = useState<string>(interpFromUrl);
  const [expandedZone, setExpandedZone] = useState<string | null>(null);
  const [generatingAI, setGeneratingAI] = useState<string | null>(null);
  const [zonifying, setZonifying] = useState(false);
  const [clientRasterSrc, setClientRasterSrc] = useState<string | null>(null);
  const [clientVminmax, setClientVminmax] = useState<[number, number] | null>(null);

  // ── Satellite-zonification mode ─────────────────────────────────────
  const initialMode = (searchParams.get("mode") === "satellite" ? "satellite" : "kriging") as "kriging" | "satellite";
  const [mode, setMode] = useState<"kriging" | "satellite">(initialMode);
  const [satIndex, setSatIndex] = useState<string>("ndvi");
  // Date selection mode: 'recent' = use daysBack window; 'specific' = single day; 'range' = dateFrom..dateTo.
  const [satDateMode, setSatDateMode] = useState<"recent" | "specific" | "range">("recent");
  const [satDate, setSatDate] = useState<string>("");
  const [satDateFrom, setSatDateFrom] = useState<string>("");
  const [satDateTo, setSatDateTo] = useState<string>("");
  const [satDaysBack, setSatDaysBack] = useState<string>("30");
  const [satNZones, setSatNZones] = useState<string>("3");
  const [satMethod, setSatMethod] = useState<string>("spatial_kmeans");
  const [satMaxCloud, setSatMaxCloud] = useState<string>("20");
  const [satGenerating, setSatGenerating] = useState(false);
  const [selectedSatSetId, setSelectedSatSetId] = useState<string>("");
  const [deletingSatSetId, setDeletingSatSetId] = useState<string | null>(null);

  const { data: campaigns = EMPTY_CAMPAIGNS } = useQuery<SamplingCampaign[]>({
    queryKey: ["sampling-campaigns", id],
    queryFn: async () => {
      const r = await fetch(`/api/parcels/${id}/sampling-campaigns`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!id,
  });

  useEffect(() => {
    if (!selectedCampaignId && campaigns.length > 0) {
      const interpolated = campaigns.find(c => c.status === "interpolated") ?? campaigns[0];
      setSelectedCampaignId(interpolated.id);
    }
  }, [campaigns, selectedCampaignId]);

  const { data: parcel } = useQuery({
    queryKey: ["parcel-mvz", id],
    queryFn: async () => {
      const r = await fetch(`/api/parcels/${id}`, { credentials: "include" });
      if (!r.ok) throw new Error("Error");
      const data = await r.json();
      return data.parcel ?? data;
    },
    enabled: !!id,
  });

  const { data: prevInterpolations = EMPTY_INTERPOLATIONS } = useQuery<InterpolationResult[]>({
    queryKey: ["interpolations", selectedCampaignId],
    queryFn: async () => {
      const r = await fetch(`/api/sampling-campaigns/${selectedCampaignId}/interpolations`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!selectedCampaignId,
  });

  useEffect(() => {
    if (!selectedInterpId && prevInterpolations.length > 0) {
      setSelectedInterpId(prevInterpolations[0].id);
    }
  }, [prevInterpolations, selectedInterpId]);

  const { data: interpData, isLoading: interpLoading } = useQuery<InterpolationWithZones>({
    queryKey: ["interpolation-zones", selectedInterpId],
    queryFn: async () => {
      const r = await fetch(`/api/interpolations/${selectedInterpId}`, { credentials: "include" });
      if (!r.ok) throw new Error("Error");
      return r.json();
    },
    enabled: !!selectedInterpId,
  });

  const { data: rawPoints = [] } = useQuery<SamplingPoint[]>({
    queryKey: ["sampling-points", selectedCampaignId],
    queryFn: async () => {
      const r = await fetch(`/api/sampling-campaigns/${selectedCampaignId}/points`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!selectedCampaignId,
  });

  // ── Satellite zone-sets query ─────────────────────────────────────────
  const { data: satData, isLoading: satLoading } = useQuery<{ zoneSets: SatelliteZoneSet[] }>({
    queryKey: ["satellite-zone-sets", id],
    queryFn: async () => {
      const r = await fetch(`/api/parcels/${id}/zones/from-satellite`, { credentials: "include" });
      if (!r.ok) return { zoneSets: [] };
      return r.json();
    },
    enabled: !!id,
  });

  const satZoneSets = satData?.zoneSets ?? [];

  useEffect(() => {
    if (mode === "satellite" && !selectedSatSetId && satZoneSets.length > 0) {
      setSelectedSatSetId(satZoneSets[0].zoneSetId);
    }
  }, [mode, selectedSatSetId, satZoneSets]);

  const selectedSatSet = useMemo(
    () => satZoneSets.find(s => s.zoneSetId === selectedSatSetId),
    [satZoneSets, selectedSatSetId],
  );

  const krigingZones: ManagementZone[] = interpData?.zones ?? [];
  const interp: InterpolationResult | undefined = interpData?.interpolation;
  const zones: ManagementZone[] = mode === "satellite" ? (selectedSatSet?.zones ?? []) : krigingZones;

  const lowVigorZoneIds = useMemo(() => {
    const withValues = zones.filter(z => z.valueMean != null);
    if (withValues.length === 0) return new Set<string>();
    const minValue = Math.min(...withValues.map(z => Number(z.valueMean)));
    return new Set(withValues.filter(z => Number(z.valueMean) === minValue).map(z => z.id));
  }, [zones]);

  const polygonCoords = useMemo((): [number, number][] => {
    if (!Array.isArray(parcel?.polygonCoordinates)) return [];
    return parcel.polygonCoordinates as [number, number][];
  }, [parcel]);

  const measuredPoints = useMemo(
    () => rawPoints.filter(p => p.value != null),
    [rawPoints],
  );

  const mapBounds = useMemo((): [[number, number], [number, number]] | undefined => {
    if (polygonCoords.length < 2) return undefined;
    const lats = polygonCoords.map(p => p[0]);
    const lngs = polygonCoords.map(p => p[1]);
    return [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]];
  }, [polygonCoords]);

  // Server-side raster from the stored interpolation result (preferred over client IDW)
  const interpRasterSrc = useMemo(() => {
    if (mode !== "kriging" || !interp) return null;
    if (interp.rasterUrl) return interp.rasterUrl;
    const p = interp.paramsJson as Record<string, unknown> | null;
    if (p && typeof p.raster_png_b64 === "string") return `data:image/png;base64,${p.raster_png_b64}`;
    return null;
  }, [interp, mode]);

  const interpRasterBounds = useMemo((): [[number, number], [number, number]] | undefined => {
    if (mode === "satellite" && selectedSatSet?.metadata?.bbox) {
      const b = selectedSatSet.metadata.bbox;
      return [[b.miny, b.minx], [b.maxy, b.maxx]];
    }
    const p = interp?.paramsJson as Record<string, unknown> | null;
    if (!p) return mapBounds;
    const bbox = p.raster_bbox as { minx?: number; miny?: number; maxx?: number; maxy?: number } | undefined;
    if (bbox?.minx != null && bbox.miny != null && bbox.maxx != null && bbox.maxy != null) {
      return [[bbox.miny, bbox.minx], [bbox.maxy, bbox.maxx]];
    }
    return mapBounds;
  }, [interp, mapBounds, mode, selectedSatSet]);

  const interpVminmax = useMemo((): [number, number] | null => {
    if (mode === "satellite") {
      const m = selectedSatSet?.metadata;
      if (m && typeof m.vmin === "number" && typeof m.vmax === "number") return [m.vmin, m.vmax];
      return null;
    }
    const p = interp?.paramsJson as Record<string, unknown> | null;
    if (!p) return clientVminmax;
    const vmin = typeof p.raster_vmin === "number" ? p.raster_vmin : null;
    const vmax = typeof p.raster_vmax === "number" ? p.raster_vmax : null;
    return vmin != null && vmax != null ? [vmin, vmax] : clientVminmax;
  }, [interp, clientVminmax, mode, selectedSatSet]);

  const allZoneCoords = useMemo(() => {
    return zones.flatMap(z => coordsFromGeojson(z.polygonGeojson));
  }, [zones]);

  const allPoints = useMemo(() => [...polygonCoords, ...allZoneCoords.flat()], [polygonCoords, allZoneCoords]);

  // Client-side IDW heatmap (same algorithm as interpolation page)
  useEffect(() => {
    setClientRasterSrc(null);
    setClientVminmax(null);
    if (measuredPoints.length < 3 || polygonCoords.length < 3 || !mapBounds) return;

    const W = 80, H = 80;
    const [[minLat, minLng], [maxLat, maxLng]] = mapBounds;

    const pts = measuredPoints.map(p => ({
      lat: Number(p.latPlanned ?? p.latActual),
      lng: Number(p.lonPlanned ?? p.lonActual),
      v: Number(p.value),
    })).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Number.isFinite(p.v));
    if (pts.length < 3) return;

    const vVals = pts.map(p => p.v);
    const vMin = Math.min(...vVals);
    const vMax = Math.max(...vVals);

    const colorStops: [number, number, number][] = [
      [215, 48, 39], [244, 109, 67], [253, 174, 97], [255, 255, 191], [166, 217, 106], [26, 152, 80],
    ];
    function lerpColor(t: number): [number, number, number] {
      const c = Math.max(0, Math.min(1, t));
      const n = colorStops.length - 1;
      const idx = c * n;
      const lo = Math.floor(idx);
      const hi = Math.min(lo + 1, n);
      const f = idx - lo;
      const [r1, g1, b1] = colorStops[lo];
      const [r2, g2, b2] = colorStops[hi];
      return [Math.round(r1 + f * (r2 - r1)), Math.round(g1 + f * (g2 - g1)), Math.round(b1 + f * (b2 - b1))];
    }
    function pipLatLng(lat: number, lng: number, poly: [number, number][]): boolean {
      let inside = false;
      const n = poly.length;
      let j = n - 1;
      for (let i = 0; i < n; i++) {
        const [yi, xi] = poly[i];
        const [yj, xj] = poly[j];
        if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
        j = i;
      }
      return inside;
    }

    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(W, H);
    for (let row = 0; row < H; row++) {
      for (let col = 0; col < W; col++) {
        const lat = maxLat - (row + 0.5) / H * (maxLat - minLat);
        const lng = minLng + (col + 0.5) / W * (maxLng - minLng);
        const pidx = (row * W + col) * 4;
        if (!pipLatLng(lat, lng, polygonCoords)) { img.data[pidx + 3] = 0; continue; }
        let num = 0, den = 0;
        for (const pt of pts) {
          const dlat = lat - pt.lat, dlng = lng - pt.lng;
          const d2 = dlat * dlat + dlng * dlng;
          if (d2 < 1e-16) { num = pt.v; den = 1; break; }
          const w = 1 / d2; num += w * pt.v; den += w;
        }
        const v = num / den;
        const t = vMax === vMin ? 0.5 : (v - vMin) / (vMax - vMin);
        const [r, g, b] = lerpColor(t);
        img.data[pidx] = r; img.data[pidx + 1] = g; img.data[pidx + 2] = b; img.data[pidx + 3] = 200;
      }
    }
    ctx.putImageData(img, 0, 0);
    setClientRasterSrc(canvas.toDataURL("image/png"));
    setClientVminmax([vMin, vMax]);
  }, [measuredPoints, polygonCoords, mapBounds]);

  const generateZones = async () => {
    if (!selectedInterpId) return;
    setZonifying(true);
    try {
      const r = await fetch(`/api/interpolations/${selectedInterpId}/zonify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message ?? "Error al zonificar");
      qc.invalidateQueries({ queryKey: ["interpolation-zones", selectedInterpId] });
      toast({ title: "Zonas generadas", description: `${(data.zones as ManagementZone[]).length} zonas de manejo creadas` });
    } catch (e: unknown) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" });
    } finally {
      setZonifying(false);
    }
  };

  const generateSatelliteZones = async () => {
    if (!id) return;
    const nz = parseInt(satNZones, 10);
    if (!Number.isFinite(nz) || nz < 2 || nz > 6) {
      toast({ title: "Nº de zonas inválido", description: "Debe estar entre 2 y 6", variant: "destructive" });
      return;
    }
    setSatGenerating(true);
    try {
      // Build the date payload according to the selected mode.
      const datePayload: Record<string, string | number | undefined> = {};
      if (satDateMode === "specific" && satDate) {
        datePayload.date = satDate;
      } else if (satDateMode === "range" && satDateFrom && satDateTo) {
        if (satDateFrom > satDateTo) {
          throw new Error("La fecha inicial debe ser anterior o igual a la final");
        }
        datePayload.dateFrom = satDateFrom;
        datePayload.dateTo = satDateTo;
      } else {
        const days = parseInt(satDaysBack, 10);
        datePayload.daysBack = Number.isFinite(days) && days > 0 ? days : 30;
      }
      const r = await fetch(`/api/parcels/${id}/zones/from-satellite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          indexType: satIndex,
          ...datePayload,
          nZones: nz,
          method: satMethod,
          maxCloudPct: parseFloat(satMaxCloud) || 20,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message ?? "Error al zonificar");
      await qc.invalidateQueries({ queryKey: ["satellite-zone-sets", id] });
      setSelectedSatSetId(data.zoneSetId);
      const meta = data.raster ?? {};
      toast({
        title: "Zonas satelitales generadas",
        description: `${data.nZones} zonas a partir de ${(meta.indexType ?? satIndex).toUpperCase()} (imagen ${meta.imageDate ?? "—"}, ${meta.scaleM ?? "?"} m/px).`,
      });
    } catch (e: unknown) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSatGenerating(false);
    }
  };

  const deleteSatelliteSet = async (zoneSetId: string) => {
    if (!id) return;
    if (!window.confirm("¿Eliminar este conjunto de zonas satelitales? Esta acción no se puede deshacer.")) return;
    setDeletingSatSetId(zoneSetId);
    try {
      const r = await fetch(`/api/parcels/${id}/zones/from-satellite/${zoneSetId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message ?? "Error");
      if (selectedSatSetId === zoneSetId) setSelectedSatSetId("");
      await qc.invalidateQueries({ queryKey: ["satellite-zone-sets", id] });
      toast({ title: "Eliminado", description: `${data.deleted} zonas eliminadas.` });
    } catch (e: unknown) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" });
    } finally {
      setDeletingSatSetId(null);
    }
  };

  const exportSatelliteSet = (zoneSetId: string, format: "geojson" | "kml" | "shapefile" | "geotiff") => {
    if (!id) return;
    window.open(
      `/api/parcels/${id}/zones/from-satellite/${zoneSetId}/export?format=${format}`,
      "_blank",
    );
  };

  const generateZoneAI = useCallback(async (zoneId: string) => {
    setGeneratingAI(zoneId);
    try {
      const r = await fetch(`/api/management-zones/${zoneId}/interpret`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message ?? "Error");
      qc.invalidateQueries({ queryKey: ["interpolation-zones", selectedInterpId] });
      toast({ title: "Interpretación generada" });
    } catch (e: unknown) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" });
    } finally {
      setGeneratingAI(null);
    }
  }, [selectedInterpId, qc, toast]);

  if (mode === "kriging" && interpLoading && selectedInterpId) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="border-b bg-card px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <Button variant="ghost" size="icon" onClick={() => setLocation(`/parcel/${id}/sampling/maps`)} data-testid="btn-back">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold truncate">Zonas de Manejo</h1>
          <p className="text-xs text-muted-foreground truncate">{parcel?.name ?? "Parcela"}</p>
        </div>
        <Badge variant="outline" className="text-purple-700 border-purple-200 bg-purple-50 shrink-0">
          {zones.length} zonas
        </Badge>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-3xl mx-auto w-full">
        {/* Mode tabs: Kriging from sampling vs Satellite */}
        <Tabs value={mode} onValueChange={v => { setMode(v as "kriging" | "satellite"); setExpandedZone(null); }} data-testid="tabs-zone-mode">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="kriging" data-testid="tab-kriging" className="gap-2">
              <Layers className="w-3.5 h-3.5" /> Muestreo + Kriging
            </TabsTrigger>
            <TabsTrigger value="satellite" data-testid="tab-satellite" className="gap-2">
              <Satellite className="w-3.5 h-3.5" /> Satélite
            </TabsTrigger>
          </TabsList>

          {/* ─── Kriging mode: campaign + interpolation selectors ───────── */}
          <TabsContent value="kriging" className="mt-3">
            <Card data-testid="card-selectors">
              <CardContent className="pt-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Campaña</p>
                    <Select value={selectedCampaignId} onValueChange={v => { setSelectedCampaignId(v); setSelectedInterpId(""); }} data-testid="select-campaign">
                      <SelectTrigger className="text-sm">
                        <SelectValue placeholder="Seleccionar..." />
                      </SelectTrigger>
                      <SelectContent>
                        {campaigns.map((c: SamplingCampaign) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Interpolación</p>
                    <Select value={selectedInterpId} onValueChange={setSelectedInterpId} disabled={prevInterpolations.length === 0} data-testid="select-interpolation">
                      <SelectTrigger className="text-sm">
                        <SelectValue placeholder="Seleccionar..." />
                      </SelectTrigger>
                      <SelectContent>
                        {prevInterpolations.map((interp: InterpolationResult) => (
                          <SelectItem key={interp.id} value={interp.id}>
                            {interp.method.toUpperCase()} · {new Date(interp.createdAt).toLocaleDateString("es-MX")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {interp && (
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>Método: <strong className="text-foreground">{interp.method.toUpperCase()}</strong></span>
                    {interp.r2Cv && <span>R²: <strong className="text-foreground">{Number(interp.r2Cv).toFixed(3)}</strong></span>}
                    {interp.rmseCv && <span>RMSE: <strong className="text-foreground">{Number(interp.rmseCv).toFixed(3)}</strong></span>}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ─── Satellite mode: index/date/method selectors + history ─── */}
          <TabsContent value="satellite" className="mt-3 space-y-3">
            <Card data-testid="card-satellite-form">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Satellite className="w-4 h-4 text-blue-600" /> Generar zonas desde índice satelital
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Crea zonas de manejo (VRA) a partir de la imagen Sentinel-2 más reciente — sin necesidad de muestrear.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="sat-index" className="text-xs uppercase tracking-wide text-muted-foreground">Índice</Label>
                    <Select value={satIndex} onValueChange={setSatIndex}>
                      <SelectTrigger id="sat-index" className="text-sm" data-testid="select-sat-index">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SATELLITE_INDICES.map(idx => (
                          <SelectItem key={idx.value} value={idx.value}>
                            <div>
                              <div className="font-medium">{idx.label}</div>
                              <div className="text-[10px] text-muted-foreground">{idx.desc}</div>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sat-method" className="text-xs uppercase tracking-wide text-muted-foreground">Método</Label>
                    <Select value={satMethod} onValueChange={setSatMethod}>
                      <SelectTrigger id="sat-method" className="text-sm" data-testid="select-sat-method">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ZONIFY_METHODS.map(m => (
                          <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sat-date-mode" className="text-xs uppercase tracking-wide text-muted-foreground">Selección de fecha</Label>
                    <Select value={satDateMode} onValueChange={(v) => setSatDateMode(v as "recent" | "specific" | "range")}>
                      <SelectTrigger id="sat-date-mode" className="text-sm" data-testid="select-sat-date-mode">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="recent">Más reciente (ventana en días)</SelectItem>
                        <SelectItem value="specific">Día específico</SelectItem>
                        <SelectItem value="range">Rango de fechas</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {satDateMode === "recent" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="sat-daysback" className="text-xs uppercase tracking-wide text-muted-foreground">Días hacia atrás</Label>
                      <Input
                        id="sat-daysback"
                        type="number"
                        min={1}
                        max={365}
                        value={satDaysBack}
                        onChange={e => setSatDaysBack(e.target.value)}
                        className="text-sm"
                        data-testid="input-sat-daysback"
                      />
                    </div>
                  )}
                  {satDateMode === "specific" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="sat-date" className="text-xs uppercase tracking-wide text-muted-foreground">Fecha exacta</Label>
                      <Input
                        id="sat-date"
                        type="date"
                        value={satDate}
                        onChange={e => setSatDate(e.target.value)}
                        className="text-sm"
                        data-testid="input-sat-date"
                      />
                    </div>
                  )}
                  {satDateMode === "range" && (
                    <>
                      <div className="space-y-1.5">
                        <Label htmlFor="sat-date-from" className="text-xs uppercase tracking-wide text-muted-foreground">Fecha inicial</Label>
                        <Input
                          id="sat-date-from"
                          type="date"
                          value={satDateFrom}
                          onChange={e => setSatDateFrom(e.target.value)}
                          className="text-sm"
                          data-testid="input-sat-date-from"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="sat-date-to" className="text-xs uppercase tracking-wide text-muted-foreground">Fecha final</Label>
                        <Input
                          id="sat-date-to"
                          type="date"
                          value={satDateTo}
                          onChange={e => setSatDateTo(e.target.value)}
                          className="text-sm"
                          data-testid="input-sat-date-to"
                        />
                      </div>
                    </>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="sat-nzones" className="text-xs uppercase tracking-wide text-muted-foreground">Nº de zonas</Label>
                    <Select value={satNZones} onValueChange={setSatNZones}>
                      <SelectTrigger id="sat-nzones" className="text-sm" data-testid="select-sat-nzones">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[2, 3, 4, 5, 6].map(n => (
                          <SelectItem key={n} value={String(n)}>{n} zonas</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <Label htmlFor="sat-cloud" className="text-xs uppercase tracking-wide text-muted-foreground">Tolerancia de nubes (%)</Label>
                    <Input
                      id="sat-cloud"
                      type="number"
                      min={0}
                      max={100}
                      step={5}
                      value={satMaxCloud}
                      onChange={e => setSatMaxCloud(e.target.value)}
                      className="text-sm"
                      data-testid="input-sat-cloud"
                    />
                  </div>
                </div>
                <Button
                  onClick={generateSatelliteZones}
                  disabled={satGenerating || polygonCoords.length < 3}
                  className="w-full gap-2 bg-blue-600 hover:bg-blue-700"
                  data-testid="btn-generate-satellite"
                >
                  {satGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {satGenerating ? "Procesando imagen y zonificando…" : "Generar zonas satelitales"}
                </Button>
                {polygonCoords.length < 3 && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                    La parcela no tiene polígono. Edítala primero para definir su contorno.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* History of generated satellite zone-sets */}
            {satZoneSets.length > 0 && (
              <Card data-testid="card-satellite-history">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Conjuntos generados ({satZoneSets.length})</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {satZoneSets.map(s => {
                    const isSel = s.zoneSetId === selectedSatSetId;
                    const m = s.metadata ?? {};
                    return (
                      <div
                        key={s.zoneSetId}
                        className={`border rounded p-2 ${isSel ? "border-blue-500 bg-blue-50" : "border-border bg-background"}`}
                        data-testid={`row-sat-set-${s.zoneSetId}`}
                      >
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedSatSetId(s.zoneSetId)}
                            className="flex-1 text-left text-xs"
                            data-testid={`btn-select-sat-set-${s.zoneSetId}`}
                          >
                            <div className="font-medium">
                              {(m.indexType ?? "—").toUpperCase()} · {m.imageDate ?? "sin fecha"}
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              {s.zones.length} zonas · {m.method ?? "spatial_kmeans"} · {m.scaleM ?? "?"} m/px
                              {m.cloudyPixelPercentage != null && ` · ${m.cloudyPixelPercentage.toFixed(0)}% nubes`}
                            </div>
                          </button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => exportSatelliteSet(s.zoneSetId, "geojson")} title="Descargar GeoJSON" data-testid={`btn-export-geojson-${s.zoneSetId}`}>
                            <Download className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => exportSatelliteSet(s.zoneSetId, "kml")} title="Descargar KML" data-testid={`btn-export-kml-${s.zoneSetId}`}>
                            <span className="text-[10px] font-bold">KML</span>
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => exportSatelliteSet(s.zoneSetId, "shapefile")} title="Descargar Shapefile (.zip)" data-testid={`btn-export-shp-${s.zoneSetId}`}>
                            <span className="text-[10px] font-bold">SHP</span>
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => exportSatelliteSet(s.zoneSetId, "geotiff")} title="Descargar GeoTIFF (.tif)" data-testid={`btn-export-tif-${s.zoneSetId}`}>
                            <span className="text-[10px] font-bold">TIF</span>
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => deleteSatelliteSet(s.zoneSetId)}
                            disabled={deletingSatSetId === s.zoneSetId}
                            title="Eliminar"
                            data-testid={`btn-delete-sat-set-${s.zoneSetId}`}
                          >
                            {deletingSatSetId === s.zoneSetId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

            {satLoading && (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </TabsContent>
        </Tabs>


        {/* Zone map */}
        {zones.length > 0 && (
          <Card className="overflow-hidden" data-testid="card-zone-map">
            <CardHeader className="pb-1">
              <CardTitle className="text-sm flex items-center gap-2">
                <Layers className="w-4 h-4 text-purple-600" /> Mapa de Zonas de Manejo
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div style={{ height: 320 }}>
                <MapContainer
                  center={polygonCoords.length > 0 ? polygonCoords[0] : [20, -99]}
                  zoom={14}
                  style={{ height: "100%", width: "100%" }}
                  data-testid="map-zones"
                >
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  <MapCleanup />
                  {allPoints.length > 0 && <FitBounds coords={allPoints} />}
                  {/* Use the actual interpolation raster; fall back to client IDW */}
                  {/* Raster overlay: only show kriging-derived rasters in kriging mode.
                      Satellite mode currently has no raster preview; showing the IDW
                      surrogate from soil samples would be misleading. */}
                  {mode === "kriging" && (interpRasterSrc ?? clientRasterSrc) && (interpRasterBounds ?? mapBounds) && (
                    <ImageOverlay
                      url={(interpRasterSrc ?? clientRasterSrc)!}
                      bounds={(interpRasterBounds ?? mapBounds)!}
                      opacity={0.6}
                    />
                  )}
                  {polygonCoords.length >= 3 && (
                    <Polygon positions={polygonCoords} color="#7c3aed" fillOpacity={0} weight={2} dashArray="6 4" />
                  )}
                  {zones.map((zone: ManagementZone, i: number) => {
                    const rings = coordsFromGeojson(zone.polygonGeojson);
                    const color = zone.colorHex ?? ZONE_COLORS[i] ?? "#888";
                    const label = zone.zoneLabel ?? ZONE_LABELS[zone.zoneIndex] ?? `Zona ${i + 1}`;
                    return rings.map((ring, ri) => (
                      <Polygon
                        key={`${zone.id}-${ri}`}
                        positions={ring}
                        color={color}
                        fillColor={color}
                        fillOpacity={0.45}
                        weight={2.5}
                        data-testid={`polygon-zone-${i}`}
                      >
                        <LeafletTooltip sticky>
                          <div className="text-xs">
                            <strong>{label}</strong>
                            {lowVigorZoneIds.has(zone.id) && (
                              <div className="text-red-600 font-semibold">⚠ Menor vigor</div>
                            )}
                            {zone.valueMean != null && <div>Media: {Number(zone.valueMean).toFixed(3)}</div>}
                            {zone.areaHa != null && <div>Área: {Number(zone.areaHa).toFixed(2)} ha</div>}
                          </div>
                        </LeafletTooltip>
                      </Polygon>
                    ));
                  })}
                </MapContainer>
              </div>
            </CardContent>
            {/* Zone + raster legend */}
            <div className="px-4 py-2 space-y-2 border-t bg-muted/20">
              {interpVminmax && (
                <div className="space-y-0.5">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Escala de valores interpolados</p>
                  <div className="flex items-center gap-2">
                    <span className="text-xs tabular-nums text-muted-foreground">{interpVminmax[0].toFixed(2)}</span>
                    <div
                      className="flex-1 h-3 rounded"
                      style={{ background: "linear-gradient(to right, #d73027, #f46d43, #fdae61, #ffffbf, #a6d96a, #1a9850)" }}
                    />
                    <span className="text-xs tabular-nums text-muted-foreground">{interpVminmax[1].toFixed(2)}</span>
                  </div>
                </div>
              )}
              {zones.length > 0 && (
                <div className="flex flex-wrap gap-3">
                  {zones.map((zone: ManagementZone, i: number) => (
                    <div key={zone.id} className="flex items-center gap-1.5 text-xs">
                      <span
                        className="w-4 h-4 rounded-sm inline-block border border-black/10"
                        style={{ background: zone.colorHex ?? ZONE_COLORS[i] ?? "#888" }}
                      />
                      {zone.zoneLabel ?? ZONE_LABELS[zone.zoneIndex] ?? `Z${i + 1}`}
                      {lowVigorZoneIds.has(zone.id) && (
                        <Badge variant="destructive" className="text-[9px] py-0 px-1 h-4 gap-0.5" data-testid={`badge-low-vigor-legend-${i}`}>
                          <AlertTriangle className="w-2.5 h-2.5" /> Menor vigor
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        )}

        {/* Zone stats + AI interpretation */}
        {zones.length > 0 && (
          <div className="space-y-2" data-testid="list-zones">
            {zones.map((zone: ManagementZone, i: number) => {
              const isExpanded = expandedZone === zone.id;
              const color = zone.colorHex ?? ZONE_COLORS[i] ?? "#888";
              const label = zone.zoneLabel ?? ZONE_LABELS[zone.zoneIndex] ?? `Zona ${i + 1}`;
              return (
                <Card key={zone.id} data-testid={`card-zone-${i}`} className="overflow-hidden">
                  <CardContent className="p-0">
                    {/* Zone header */}
                    <button
                      className="w-full flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors text-left"
                      onClick={() => setExpandedZone(isExpanded ? null : zone.id)}
                      data-testid={`btn-expand-zone-${i}`}
                    >
                      <span className="w-4 h-4 rounded-sm shrink-0" style={{ background: color }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{label}</span>
                          {zone.category && (
                            <Badge variant="outline" className="text-xs py-0 px-1.5">{zone.category}</Badge>
                          )}
                          {lowVigorZoneIds.has(zone.id) && (
                            <Badge variant="destructive" className="text-[10px] py-0 px-1.5 gap-1" data-testid={`badge-low-vigor-${i}`}>
                              <AlertTriangle className="w-3 h-3" /> Menor vigor
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                          {zone.areaHa != null && (
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3 h-3" /> {Number(zone.areaHa).toFixed(2)} ha
                            </span>
                          )}
                          {zone.valueMean != null && <span>Media: {Number(zone.valueMean).toFixed(3)}</span>}
                          {zone.valueStd != null && <span>σ: {Number(zone.valueStd).toFixed(3)}</span>}
                        </div>
                      </div>
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
                    </button>

                    {/* Expanded stats + AI */}
                    {isExpanded && (
                      <div className="border-t p-3 space-y-3 bg-muted/20">
                        {/* Stats grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                          {[
                            { label: "Mín", val: zone.valueMin },
                            { label: "Media", val: zone.valueMean },
                            { label: "Máx", val: zone.valueMax },
                            { label: "Área (ha)", val: zone.areaHa },
                          ].map(s => (
                            <div key={s.label} className="bg-background rounded p-1.5">
                              <p className="text-xs font-bold font-mono" data-testid={`stat-${s.label}-${i}`}>
                                {s.val != null ? Number(s.val).toFixed(2) : "—"}
                              </p>
                              <p className="text-[10px] text-muted-foreground">{s.label}</p>
                            </div>
                          ))}
                        </div>

                        {/* AI interpretation — kriging mode only; satellite zonification shows raw stats without AI recommendations */}
                        {mode === "kriging" && (
                          zone.aiInterpretation ? (
                            <div className="bg-purple-50 border border-purple-100 rounded p-2.5" data-testid={`ai-interp-${i}`}>
                              <div className="flex items-center gap-1.5 text-xs font-medium text-purple-700 mb-1.5">
                                <Bot className="w-3.5 h-3.5" /> Interpretación IA
                              </div>
                              <p className="text-xs text-purple-800 leading-relaxed whitespace-pre-line">{zone.aiInterpretation}</p>
                            </div>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full gap-2 text-purple-700 border-purple-200 hover:bg-purple-50 text-xs"
                              onClick={() => generateZoneAI(zone.id)}
                              disabled={generatingAI === zone.id}
                              data-testid={`btn-ai-zone-${i}`}
                            >
                              {generatingAI === zone.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bot className="w-3.5 h-3.5" />}
                              {generatingAI === zone.id ? "Generando interpretación…" : "Generar interpretación IA"}
                            </Button>
                          )
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {zones.length === 0 && !interpLoading && !satLoading && (
          <div className="text-center py-12 text-muted-foreground" data-testid="text-no-zones">
            <Layers className="w-12 h-12 mx-auto mb-3 opacity-25" />
            <p className="text-sm font-medium">Sin zonas de manejo</p>
            {mode === "satellite" ? (
              <p className="text-xs mt-1 max-w-xs mx-auto">
                Configura un índice y pulsa <strong>Generar zonas satelitales</strong> arriba.
              </p>
            ) : selectedInterpId ? (
              <>
                <p className="text-xs mt-1 max-w-xs mx-auto">Esta interpolación todavía no tiene zonas generadas.</p>
                <Button
                  size="sm"
                  className="mt-4 gap-2 bg-purple-600 hover:bg-purple-700"
                  onClick={generateZones}
                  disabled={zonifying}
                  data-testid="btn-generate-zones"
                >
                  {zonifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  {zonifying ? "Generando zonas…" : "Generar zonas"}
                </Button>
              </>
            ) : (
              <>
                <p className="text-xs mt-1 max-w-xs mx-auto">Selecciona una campaña e interpolación para ver las zonas.</p>
                <Button variant="outline" size="sm" className="mt-4" onClick={() => setLocation(`/parcel/${id}/sampling/maps`)}>
                  Ir a interpolación
                </Button>
              </>
            )}
          </div>
        )}

        {/* Mapa de Prescripción — kriging usa interpolationId, satélite pasa zoneSetId */}
        {mode === "kriging" && zones.length > 0 && selectedInterpId && (
          <Button
            className="w-full gap-2 bg-purple-600 hover:bg-purple-700"
            onClick={() => setLocation(`/parcel/${id}/prescription?interpolation=${selectedInterpId}`)}
            data-testid="btn-go-prescription"
          >
            Mapa de Prescripción <ChevronRight className="w-4 h-4" />
          </Button>
        )}
        {mode === "satellite" && zones.length > 0 && selectedSatSetId && (
          <Button
            className="w-full gap-2 bg-purple-600 hover:bg-purple-700"
            onClick={() => setLocation(`/parcel/${id}/prescription?zoneSet=${selectedSatSetId}`)}
            data-testid="btn-go-prescription-satellite"
          >
            Mapa de Prescripción (zonas satelitales) <ChevronRight className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, TrendingUp, TrendingDown, Minus, History, Map, FlaskConical } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import { MapContainer, TileLayer, Polygon } from "react-leaflet";
import "leaflet/dist/leaflet.css";

interface HistorialTabProps {
  parcelId: string;
  polygonCoordinates: [number, number][] | null;
}

interface IndexPoint {
  id: string;
  date: string;
  ndvi: number | null;
  evi: number | null;
  soilMoisture: number | null;
  temperature: number | null;
  precipitation: number | null;
}

interface SoilRecord {
  id: string;
  analysisDate: string;
  labName: string | null;
  notes: string | null;
  organicMatter: number | null;
  totalCarbon: number | null;
  nitrogenTotal: number | null;
  phosphorus: number | null;
  potassium: number | null;
  calcium: number | null;
  magnesium: number | null;
  sulfur: number | null;
  ph: number | null;
  electricConductivity: number | null;
  cec: number | null;
  iron: number | null;
  zinc: number | null;
  manganese: number | null;
  copper: number | null;
  boron: number | null;
  sand: number | null;
  silt: number | null;
  clay: number | null;
  delta: Record<string, number | null>;
}

interface TileResponse {
  available: boolean;
  urlFormat?: string;
  hasData?: boolean;
  imageDate?: string;
  message?: string;
}

const SAT_METRICS = [
  { key: "ndvi", label: "NDVI", color: "#16a34a", axis: "left" as const },
  { key: "evi", label: "EVI", color: "#2563eb", axis: "left" as const },
  { key: "soilMoisture", label: "Hum. Suelo (%)", color: "#0891b2", axis: "right" as const },
  { key: "temperature", label: "Temperatura (°C)", color: "#ea580c", axis: "right" as const },
  { key: "precipitation", label: "Precipitación (mm)", color: "#7c3aed", axis: "right" as const },
] as const;

type SatKey = typeof SAT_METRICS[number]["key"];

const SOIL_OVERLAY_METRICS = [
  { key: "organicMatter", label: "M.O. (%)", color: "#854d0e", axis: "right" as const },
  { key: "ph", label: "pH", color: "#9333ea", axis: "right" as const },
  { key: "nitrogenTotal", label: "N (%)", color: "#15803d", axis: "right" as const },
  { key: "phosphorus", label: "P (ppm)", color: "#b45309", axis: "right" as const },
] as const;

type SoilOverlayKey = typeof SOIL_OVERLAY_METRICS[number]["key"];
type AnyMetricKey = SatKey | SoilOverlayKey;

const SOIL_TABLE_FIELDS: { key: keyof Omit<SoilRecord, "id" | "analysisDate" | "labName" | "notes" | "delta">; label: string; unit: string }[] = [
  { key: "organicMatter", label: "Mat. Orgánica", unit: "%" },
  { key: "totalCarbon", label: "Carbono Total", unit: "%" },
  { key: "nitrogenTotal", label: "Nitrógeno", unit: "%" },
  { key: "phosphorus", label: "Fósforo", unit: "ppm" },
  { key: "potassium", label: "Potasio", unit: "ppm" },
  { key: "calcium", label: "Calcio", unit: "ppm" },
  { key: "magnesium", label: "Magnesio", unit: "ppm" },
  { key: "sulfur", label: "Azufre", unit: "ppm" },
  { key: "ph", label: "pH", unit: "" },
  { key: "electricConductivity", label: "C.E.", unit: "dS/m" },
  { key: "cec", label: "CIC", unit: "meq/100g" },
  { key: "iron", label: "Hierro", unit: "ppm" },
  { key: "zinc", label: "Zinc", unit: "ppm" },
  { key: "manganese", label: "Manganeso", unit: "ppm" },
  { key: "copper", label: "Cobre", unit: "ppm" },
  { key: "boron", label: "Boro", unit: "ppm" },
];

function DeltaBadge({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-gray-400 text-xs">—</span>;
  if (Math.abs(value) < 0.1) {
    return (
      <Badge variant="outline" className="text-xs gap-1 py-0">
        <Minus className="w-3 h-3" /> 0%
      </Badge>
    );
  }
  if (value > 0) {
    return (
      <Badge className="text-xs gap-1 py-0 bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">
        <TrendingUp className="w-3 h-3" /> +{value.toFixed(1)}%
      </Badge>
    );
  }
  return (
    <Badge className="text-xs gap-1 py-0 bg-red-100 text-red-700 border-red-200 hover:bg-red-100">
      <TrendingDown className="w-3 h-3" /> {value.toFixed(1)}%
    </Badge>
  );
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtShort(d: string) {
  return new Date(d).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "2-digit" });
}

function IndexMapPanel({
  parcelId,
  polygonCoordinates,
  label,
  date,
  onDateChange,
  indexType,
}: {
  parcelId: string;
  polygonCoordinates: [number, number][] | null;
  label: string;
  date: string;
  onDateChange: (d: string) => void;
  indexType: string;
}) {
  const center = useMemo<[number, number]>(() => {
    if (!polygonCoordinates || polygonCoordinates.length === 0) return [20, -100];
    const lats = polygonCoordinates.map(c => c[0]);
    const lons = polygonCoordinates.map(c => c[1]);
    return [
      (Math.min(...lats) + Math.max(...lats)) / 2,
      (Math.min(...lons) + Math.max(...lons)) / 2,
    ];
  }, [polygonCoordinates]);

  const { data: tileData, isLoading } = useQuery<TileResponse>({
    queryKey: ["index-tiles", parcelId, indexType, date],
    queryFn: async () => {
      const params = new URLSearchParams({ index: indexType });
      if (date) params.set("date", date);
      const r = await fetch(`/api/parcels/${parcelId}/index-tiles?${params}`, { credentials: "include" });
      if (!r.ok) return { available: false };
      return r.json();
    },
    enabled: !!parcelId,
  });

  return (
    <div className="flex-1 min-w-0 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-gray-700 min-w-fit">{label}</span>
        <Label className="text-xs text-gray-500">Fecha:</Label>
        <Input
          type="date"
          value={date}
          onChange={e => onDateChange(e.target.value)}
          className="h-7 text-xs w-36"
          data-testid={`input-map-date-${label}`}
        />
      </div>
      <div className="rounded-lg overflow-hidden border h-56 relative">
        {isLoading && (
          <div className="absolute inset-0 z-[500] flex items-center justify-center bg-white/70">
            <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
          </div>
        )}
        <MapContainer
          center={center}
          zoom={14}
          className="h-full w-full"
          zoomControl={false}
          attributionControl={false}
          key={`${label}-${center[0]}-${center[1]}`}
        >
          <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
          {tileData?.available && tileData.urlFormat && (
            <TileLayer
              url={tileData.urlFormat}
              opacity={0.75}
            />
          )}
          {polygonCoordinates && polygonCoordinates.length > 0 && (
            <Polygon
              positions={polygonCoordinates}
              pathOptions={{ color: "#ffffff", weight: 2, fillOpacity: 0, dashArray: "4" }}
            />
          )}
        </MapContainer>
        {tileData && !tileData.available && !isLoading && (
          <div className="absolute bottom-2 left-2 z-[500] bg-black/60 text-white text-xs px-2 py-1 rounded">
            Sin imagen satelital para esta fecha
          </div>
        )}
        {tileData?.available && tileData.imageDate && (
          <div className="absolute bottom-2 left-2 z-[500] bg-black/60 text-white text-xs px-2 py-1 rounded">
            {indexType.toUpperCase()} · {fmt(tileData.imageDate)}
          </div>
        )}
      </div>
    </div>
  );
}

export function HistorialTab({ parcelId, polygonCoordinates }: HistorialTabProps) {
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [campaignYear, setCampaignYear] = useState("all");
  const [activeMetrics, setActiveMetrics] = useState<Set<AnyMetricKey>>(new Set<AnyMetricKey>(["ndvi", "evi"]));
  const [showComparator, setShowComparator] = useState(false);
  const [mapDateA, setMapDateA] = useState("");
  const [mapDateB, setMapDateB] = useState("");
  const [mapIndex, setMapIndex] = useState("ndvi");

  const qParams = useMemo(() => {
    const p = new URLSearchParams();
    if (desde) p.set("desde", desde);
    if (hasta) p.set("hasta", hasta);
    if (campaignYear && campaignYear !== "all") p.set("campaignYear", campaignYear);
    return p.toString();
  }, [desde, hasta, campaignYear]);

  const dateOnlyParams = useMemo(() => {
    const p = new URLSearchParams();
    if (desde) p.set("desde", desde);
    if (hasta) p.set("hasta", hasta);
    return p.toString();
  }, [desde, hasta]);

  const { data: allYearsData } = useQuery<{ data: IndexPoint[] }>({
    queryKey: ["history-indices-years", parcelId, dateOnlyParams],
    queryFn: async () => {
      const url = `/api/parcels/${parcelId}/history/indices${dateOnlyParams ? `?${dateOnlyParams}` : ""}`;
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) return { data: [] };
      return r.json();
    },
    enabled: !!parcelId,
  });

  const { data: indicesData, isLoading: loadingIndices } = useQuery<{ data: IndexPoint[] }>({
    queryKey: ["history-indices", parcelId, qParams],
    queryFn: async () => {
      const url = `/api/parcels/${parcelId}/history/indices${qParams ? `?${qParams}` : ""}`;
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error("Error al cargar índices");
      return r.json();
    },
    enabled: !!parcelId,
  });

  const { data: soilData, isLoading: loadingSoil } = useQuery<{ analyses: SoilRecord[] }>({
    queryKey: ["history-soil", parcelId, qParams],
    queryFn: async () => {
      const url = `/api/parcels/${parcelId}/history/soil${qParams ? `?${qParams}` : ""}`;
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error("Error al cargar análisis de suelo");
      return r.json();
    },
    enabled: !!parcelId,
  });

  const allSatDates = useMemo(() => (indicesData?.data ?? []).map(d => d.date), [indicesData]);
  const soilAnalyses = soilData?.analyses ?? [];

  const availableYears = useMemo(() => {
    const yearsFromSat = (allYearsData?.data ?? []).map(d => new Date(d.date).getFullYear());
    const yearsFromSoil = (soilData?.analyses ?? []).map(a => new Date(a.analysisDate).getFullYear());
    return Array.from(new Set(yearsFromSat.concat(yearsFromSoil))).sort((a, b) => b - a);
  }, [allYearsData, soilData]);

  const chartData = useMemo(() => {
    const satByDate: Record<string, IndexPoint> = {};
    (indicesData?.data ?? []).forEach(d => {
      const key = new Date(d.date).toISOString().slice(0, 10);
      satByDate[key] = d;
    });

    const soilByDate: Record<string, SoilRecord> = {};
    soilAnalyses.forEach(a => {
      const key = new Date(a.analysisDate).toISOString().slice(0, 10);
      soilByDate[key] = a;
    });

    const allKeys = Array.from(new Set(Object.keys(satByDate).concat(Object.keys(soilByDate)))).sort();

    return allKeys.map(dateKey => {
      const sat = satByDate[dateKey];
      const soil = soilByDate[dateKey];
      return {
        fecha: fmtShort(dateKey),
        fechaCompleta: dateKey,
        ndvi: sat?.ndvi ?? null,
        evi: sat?.evi ?? null,
        soilMoisture: sat?.soilMoisture ?? null,
        temperature: sat?.temperature ?? null,
        precipitation: sat?.precipitation ?? null,
        organicMatter: soil?.organicMatter ?? null,
        ph: soil?.ph ?? null,
        nitrogenTotal: soil?.nitrogenTotal ?? null,
        phosphorus: soil?.phosphorus ?? null,
      };
    });
  }, [indicesData, soilAnalyses]);

  function toggleMetric(key: AnyMetricKey) {
    setActiveMetrics(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  const hasLeftAxis = [...SAT_METRICS].filter(m => m.axis === "left" && activeMetrics.has(m.key)).length > 0;
  const hasRightAxis = (
    [...SAT_METRICS].some(m => m.axis === "right" && activeMetrics.has(m.key)) ||
    [...SOIL_OVERLAY_METRICS].some(m => activeMetrics.has(m.key))
  );

  return (
    <TabsContent value="historial" className="space-y-6 animate-in fade-in slide-in-from-bottom-2" data-testid="content-historial">

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="w-4 h-4 text-emerald-600" />
            Evolución de Índices Satelitales y Suelo
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-xs text-gray-500">Campaña / Año</Label>
              <Select value={campaignYear} onValueChange={setCampaignYear}>
                <SelectTrigger className="h-8 text-sm w-36" data-testid="select-campaign-year">
                  <SelectValue placeholder="Todos los años" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los años</SelectItem>
                  {availableYears.map(yr => (
                    <SelectItem key={yr} value={String(yr)}>{yr}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="hist-desde" className="text-xs text-gray-500">Desde</Label>
              <Input
                id="hist-desde"
                type="date"
                value={desde}
                onChange={e => setDesde(e.target.value)}
                className="h-8 text-sm w-36"
                data-testid="input-hist-desde"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="hist-hasta" className="text-xs text-gray-500">Hasta</Label>
              <Input
                id="hist-hasta"
                type="date"
                value={hasta}
                onChange={e => setHasta(e.target.value)}
                className="h-8 text-sm w-36"
                data-testid="input-hist-hasta"
              />
            </div>
            {(desde || hasta || campaignYear !== "all") && (
              <button
                onClick={() => { setDesde(""); setHasta(""); setCampaignYear("all"); }}
                className="text-xs text-gray-500 underline pb-1"
                data-testid="btn-hist-clear-filters"
              >
                Limpiar filtros
              </button>
            )}
          </div>

          <div className="space-y-1">
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Índices satelitales</p>
            <div className="flex flex-wrap gap-2">
              {SAT_METRICS.map(m => (
                <button
                  key={m.key}
                  onClick={() => toggleMetric(m.key)}
                  data-testid={`toggle-metric-${m.key}`}
                  className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    activeMetrics.has(m.key) ? "border-transparent text-white" : "border-gray-200 text-gray-500 bg-white"
                  }`}
                  style={activeMetrics.has(m.key) ? { backgroundColor: m.color } : {}}
                >
                  <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: m.color }} />
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Métricas de suelo (superposición)</p>
            <div className="flex flex-wrap gap-2">
              {SOIL_OVERLAY_METRICS.map(m => (
                <button
                  key={m.key}
                  onClick={() => toggleMetric(m.key)}
                  data-testid={`toggle-metric-${m.key}`}
                  className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    activeMetrics.has(m.key) ? "border-transparent text-white" : "border-gray-200 text-gray-500 bg-white"
                  }`}
                  style={activeMetrics.has(m.key) ? { backgroundColor: m.color } : {}}
                >
                  <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: m.color }} />
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {loadingIndices || loadingSoil ? (
            <div className="flex items-center justify-center h-56 text-gray-400">
              <Loader2 className="w-6 h-6 animate-spin mr-2" /> Cargando datos...
            </div>
          ) : chartData.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-56 text-gray-400 gap-2">
              <TrendingUp className="w-8 h-8 opacity-30" />
              <p className="text-sm">Sin datos para el período seleccionado</p>
              <p className="text-xs">Los datos satelitales se registran en la pestaña Satélite</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData} margin={{ top: 4, right: 40, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="fecha" tick={{ fontSize: 11 }} tickLine={false} interval="preserveStartEnd" />
                {hasLeftAxis && (
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} domain={[0, 1]} />
                )}
                {hasRightAxis && (
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
                )}
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  formatter={(value: number, name: string) => [value != null ? Number(value).toFixed(3) : "—", name]}
                  labelFormatter={l => `Fecha: ${l}`}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {SAT_METRICS.filter(m => activeMetrics.has(m.key)).map(m => (
                  <Line
                    key={m.key}
                    yAxisId={m.axis}
                    type="monotone"
                    dataKey={m.key}
                    name={m.label}
                    stroke={m.color}
                    strokeWidth={2}
                    dot={{ r: 2, fill: m.color }}
                    activeDot={{ r: 5 }}
                    connectNulls
                  />
                ))}
                {SOIL_OVERLAY_METRICS.filter(m => activeMetrics.has(m.key)).map(m => (
                  <Line
                    key={m.key}
                    yAxisId="right"
                    type="monotone"
                    dataKey={m.key}
                    name={m.label}
                    stroke={m.color}
                    strokeWidth={0}
                    dot={{ r: 5, fill: m.color, strokeWidth: 2, stroke: "#fff" }}
                    activeDot={{ r: 7 }}
                    connectNulls={false}
                    strokeDasharray="4 2"
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}

          {chartData.length > 0 && (
            <p className="text-xs text-gray-400 text-right">
              {chartData.length} registros totales
              {allSatDates.length > 0 && ` · satélite hasta ${fmt(allSatDates[allSatDates.length - 1])}`}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Map className="w-4 h-4 text-blue-600" />
              Comparar Campañas — Índice Satelital
            </CardTitle>
            <button
              onClick={() => setShowComparator(prev => !prev)}
              data-testid="btn-toggle-comparator"
              className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border font-medium transition-colors ${
                showComparator
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-blue-600 border-blue-300 hover:bg-blue-50"
              }`}
            >
              <Map className="w-3.5 h-3.5" />
              {showComparator ? "Cerrar comparación" : "Comparar campañas"}
            </button>
          </div>
        </CardHeader>
        {showComparator && (
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">Índice a comparar</Label>
                <Select value={mapIndex} onValueChange={setMapIndex}>
                  <SelectTrigger className="h-8 text-sm w-28" data-testid="select-map-index">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ndvi">NDVI</SelectItem>
                    <SelectItem value="evi">EVI</SelectItem>
                    <SelectItem value="ndmi">NDMI</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-gray-500 pb-1">
                Selecciona una fecha por panel. Ambos usan el mismo índice y escala de color para comparación directa.
              </p>
            </div>
            <div className="flex gap-4 flex-col sm:flex-row">
              <IndexMapPanel
                parcelId={parcelId}
                polygonCoordinates={polygonCoordinates}
                label="Campaña A"
                date={mapDateA}
                onDateChange={setMapDateA}
                indexType={mapIndex}
              />
              <IndexMapPanel
                parcelId={parcelId}
                polygonCoordinates={polygonCoordinates}
                label="Campaña B"
                date={mapDateB}
                onDateChange={setMapDateB}
                indexType={mapIndex}
              />
            </div>
            <p className="text-xs text-gray-400">
              La capa de índice requiere Google Earth Engine activo. Si no hay imágenes disponibles para la fecha seleccionada, se indica en el mapa.
            </p>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="w-4 h-4 text-amber-600" />
            Cronología de Análisis de Suelo
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingSoil ? (
            <div className="flex items-center justify-center h-32 text-gray-400">
              <Loader2 className="w-6 h-6 animate-spin mr-2" /> Cargando análisis...
            </div>
          ) : soilAnalyses.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-400 gap-2">
              <FlaskConical className="w-8 h-8 opacity-30" />
              <p className="text-sm">Sin análisis de suelo registrados</p>
              <p className="text-xs">Registra tu primer análisis en la pestaña Suelo</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex gap-3 text-xs text-gray-500 pb-1 border-b">
                <span>{soilAnalyses.length} análisis registrados</span>
                <span>·</span>
                <span>Desde {fmt(soilAnalyses[0].analysisDate)}</span>
                {soilAnalyses.length > 1 && (
                  <>
                    <span>·</span>
                    <span>Hasta {fmt(soilAnalyses[soilAnalyses.length - 1].analysisDate)}</span>
                  </>
                )}
              </div>

              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-600 whitespace-nowrap">Parámetro</th>
                      {soilAnalyses.map(a => (
                        <th key={a.id} className="text-center px-3 py-2 text-xs font-medium text-gray-600 whitespace-nowrap" data-testid={`soil-col-${a.id}`}>
                          <div>{fmt(a.analysisDate)}</div>
                          {a.labName && <div className="font-normal text-gray-400">{a.labName}</div>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {SOIL_TABLE_FIELDS.map(field => {
                      const hasAnyValue = soilAnalyses.some(a => a[field.key] != null);
                      if (!hasAnyValue) return null;
                      return (
                        <tr key={field.key} className="border-b last:border-0 hover:bg-gray-50/50">
                          <td className="px-3 py-2 text-xs font-medium text-gray-700 whitespace-nowrap">
                            {field.label}
                            {field.unit && <span className="text-gray-400 font-normal ml-1">({field.unit})</span>}
                          </td>
                          {soilAnalyses.map((a, i) => {
                            const val = a[field.key];
                            const delta = a.delta[field.key];
                            return (
                              <td key={a.id} className="px-3 py-2 text-center" data-testid={`soil-cell-${field.key}-${a.id}`}>
                                <div className="flex flex-col items-center gap-1">
                                  <span className="text-xs font-medium text-gray-800">
                                    {val != null ? Number(val).toFixed(2) : "—"}
                                  </span>
                                  {i > 0 && <DeltaBadge value={delta} />}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-4 text-xs text-gray-400">
                <span className="flex items-center gap-1">
                  <Badge className="text-xs py-0 bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">
                    <TrendingUp className="w-3 h-3 mr-0.5" />+X%
                  </Badge>
                  Mejora vs análisis anterior
                </span>
                <span className="flex items-center gap-1">
                  <Badge className="text-xs py-0 bg-red-100 text-red-700 border-red-200 hover:bg-red-100">
                    <TrendingDown className="w-3 h-3 mr-0.5" />-X%
                  </Badge>
                  Baja vs análisis anterior
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

    </TabsContent>
  );
}

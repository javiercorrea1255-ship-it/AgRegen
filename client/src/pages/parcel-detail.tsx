import { useParams, useLocation } from "wouter";
import { useConnectivity } from "@/lib/connectivity-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Download, Share2, Layers, Droplets, Sprout, ArrowUpRight, Loader2, BarChart3, Thermometer, AlertTriangle, Satellite, Database, FlaskConical, Plus, Calendar, Tractor, RotateCcw, Beef, DollarSign, Check, Bot, Wallet, Maximize2, X, Cloud, ImageIcon, ArrowLeftRight, Info, Plane, Cpu, Upload, Trash2, ScanLine, Calculator, TrendingUp, History, Package, Eye, Leaf, Mountain, Sparkles, BookOpen, Globe2 } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import NutritionCalculatorTab from "@/components/nutrition-calculator-tab";
import ClimateRiskTab from "@/pages/climate-risk-tab";
import SoilBiologyTab from "@/pages/soil-biology-tab";
import SoilHealthAssessment, { SoilHealthSummary } from "@/components/soil-health-assessment";
import { SoilReportRepairs } from "@/components/soil-report-repairs";
import { installHistoryGuard } from "@/lib/guard-history";
import { HistorialTab } from "@/components/historial-tab";
import { RendimientoTab } from "@/components/rendimiento-tab";
import { PhenologyTimeline } from "@/components/phenology-timeline";
import { RotacionTab } from "@/components/rotacion-tab";
import { AIChat } from "@/components/ai-chat";
import { useAuth } from "@/lib/auth-context";
import { getActiveModules } from "@shared/tool-modules";
import { distinctSoilAnalyses, measuredNumber, soilEvidence, soilMeasurementKeys } from "@shared/agronomic-evidence";
import { Link } from "wouter";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, BarChart, Bar } from 'recharts';
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MapContainer, TileLayer, Polygon, useMap, CircleMarker, Popup } from "react-leaflet";
import { useEffect, useState, useMemo, memo, lazy, Suspense, useRef, type CSSProperties } from "react";
import "leaflet/dist/leaflet.css";

const AmendmentsCalculator = lazy(() => import("@/pages/amendments-calculator"));
const ParcelMapEditable = lazy(() => import("@/components/map/parcel-map"));
import soilImage from "@/assets/soil-texture.png";
import { 
  generateIdealCurveForDates, 
  getCropCurve, 
  calculateDeviation,
  getCurrentStage,
  type DeviationResult 
} from "@/lib/ideal-ndvi-curves";
import type { SamplingCampaign } from "@shared/schema";
import { formatMexicoDate, mexicoDateKey } from "@shared/civil-date";
import { getParcelSetupCompletion } from "@shared/parcel-setup-progress";

const SATELLITE_SUPPORTED_CROPS = new Set([
  "Maíz", "Soja", "Trigo", "Girasol",
  "Tomate", "Papa", "Cebolla", "Lechuga", "Ajo",
  "Vid", "Manzano", "Cítricos", "Limón", "Caña de Azúcar",
  "Alfalfa", "Sorgo", "Algodón",
]);

interface Parcel {
  id: string;
  name: string;
  location: string;
  latitude: string;
  longitude: string;
  area: string;
  crop: string;
  status: string;
  isPublic: boolean;
  userId?: string;
  polygonCoordinates?: [number, number][];
  plantingDate?: string;
  phenologicalStage?: string;
  irrigationSystem?: string;
  proactiveAlertFrequencyHours?: number;
}

interface RegenerativeMetrics {
  score: string;
  scoreNumeric: number;
  carbonSequestered: number;
  dataCompleteness?: number;
  ndviSource?: "satellite" | "none";
  satelliteNdvi?: number | null;
  satelliteNdviDate?: string | null;
  breakdown: {
    soil: number;
    practices: number;
    tillage: number;
    rotation: number;
    animals: number;
    livelihood: number;
  };
}

interface ParcelData {
  id: string;
  parcelId: string;
  date: string;
  ndvi: string | null;
  evi: string | null;
  soilMoisture: string | null;
  temperature: string | null;
  precipitation: string | null;
}

interface SoilAnalysis {
  id: string;
  parcelId: string;
  analysisDate: string;
  labName: string | null;
  organicMatter: string | null;
  totalCarbon: string | null;
  nitrogenTotal: string | null;
  nitrogenInorganic: string | null;
  phosphorus: string | null;
  potassium: string | null;
  calcium: string | null;
  magnesium: string | null;
  sulfur: string | null;
  iron: string | null;
  zinc: string | null;
  manganese: string | null;
  copper: string | null;
  boron: string | null;
  ph: string | null;
  electricConductivity: string | null;
  cec: string | null;
  sand: string | null;
  silt: string | null;
  clay: string | null;
  notes: string | null;
  createdAt: string;
}

type SoilEvidenceView = NonNullable<ReturnType<typeof soilEvidence>> & {
  nitrogenTotal: number | null;
  nitrogenInorganic: number | null;
  ph: number | null;
  sand: number | null;
  silt: number | null;
  clay: number | null;
};

interface IndicesData {
  date: string;
  ndvi: number;
  evi: number;
  ndmi: number;
  ndre: number;
  gndvi: number;
  msavi: number;
  savi: number;
  ndwi: number;
}

const defaultSoilMoistureData = [
  { day: '1', value: 30 },
  { day: '5', value: 28 },
  { day: '10', value: 45 },
  { day: '15', value: 40 },
  { day: '20', value: 35 },
  { day: '25', value: 32 },
];

function formatDate(dateStr: string) {
  const date = new Date(dateStr);
  const months = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  return months[date.getMonth()];
}

function formatCachedAt(iso: string | null): string {
  if (!iso) return "caché local";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "hace un momento";
  if (ms < 3_600_000) return `hace ${Math.floor(ms / 60_000)} min`;
  if (ms < 86_400_000) return `hace ${Math.floor(ms / 3_600_000)} h`;
  return new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

function MapController({ center, zoom, bounds }: { center: [number, number]; zoom: number; bounds?: [number, number][] }) {
  const map = useMap();
  
  useEffect(() => {
    if (bounds && bounds.length > 0) {
      const latLngBounds = bounds.map(coord => [coord[0], coord[1]] as [number, number]);
      map.fitBounds(latLngBounds, { padding: [20, 20] });
    } else {
      map.setView(center, zoom);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount — MapContainer only renders after parcel data is loaded
  
  return null;
}

const StablePolygon = memo(function StablePolygon({
  positions,
  hasIndexTiles,
  selectedIndex,
  currentIndexValue,
}: {
  positions: [number, number][];
  hasIndexTiles: boolean;
  selectedIndex: string;
  currentIndexValue: number;
}) {
  const pathOptions = useMemo(() => ({
    color: hasIndexTiles ? "#ffffff" : (selectedIndex === "ndvi" ? getNDVIColor(currentIndexValue) : "#666666"),
    fillColor: hasIndexTiles ? "transparent" : (selectedIndex === "ndvi" ? getNDVIColor(currentIndexValue) : "#888888"),
    fillOpacity: hasIndexTiles ? 0 : (selectedIndex === "ndvi" ? 0.6 : 0.3),
    weight: 2 as number,
  }), [hasIndexTiles, selectedIndex, currentIndexValue]);
  return <Polygon positions={positions} pathOptions={pathOptions} />;
});

interface SoilSampleFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: Record<string, any>;
}

function soilColor(value: number, min: number, max: number): string {
  if (min >= max) return "#888888";
  const t = Math.min(1, Math.max(0, (value - min) / (max - min)));
  const hue = Math.round(t * 120); // 0° red → 120° green
  return `hsl(${hue},80%,42%)`;
}

interface ParcelLeafletMapProps {
  mapCenter: [number, number];
  polygonCoords: [number, number][];
  hasIndexTiles: boolean;
  indexTileUrl: string | null;
  selectedIndex: string;
  currentIndexValue: number;
  tileOpacity?: number;
  scrollWheelZoom?: boolean;
  zoomControl?: boolean;
  mapStyle?: CSSProperties;
  soilSamples?: SoilSampleFeature[];
  soilAttribute?: string;
  soilMin?: number;
  soilMax?: number;
}

function parcelLeafletMapPropsAreEqual(
  prev: ParcelLeafletMapProps,
  next: ParcelLeafletMapProps,
): boolean {
  return (
    prev.hasIndexTiles === next.hasIndexTiles &&
    prev.indexTileUrl === next.indexTileUrl &&
    prev.selectedIndex === next.selectedIndex &&
    Math.abs((prev.currentIndexValue ?? 0) - (next.currentIndexValue ?? 0)) < 0.0001 &&
    Math.abs((prev.tileOpacity ?? 0.75) - (next.tileOpacity ?? 0.75)) < 0.01 &&
    prev.mapCenter[0] === next.mapCenter[0] &&
    prev.mapCenter[1] === next.mapCenter[1] &&
    JSON.stringify(prev.polygonCoords) === JSON.stringify(next.polygonCoords) &&
    prev.scrollWheelZoom === next.scrollWheelZoom &&
    (prev.soilSamples?.length ?? 0) === (next.soilSamples?.length ?? 0) &&
    prev.soilAttribute === next.soilAttribute &&
    prev.soilMin === next.soilMin &&
    prev.soilMax === next.soilMax
  );
}

const ParcelLeafletMap = memo(function ParcelLeafletMap({
  mapCenter,
  polygonCoords,
  hasIndexTiles,
  indexTileUrl,
  selectedIndex,
  currentIndexValue,
  tileOpacity = 0.75,
  scrollWheelZoom = false,
  zoomControl,
  mapStyle = { minHeight: "300px" },
  soilSamples,
  soilAttribute = "pH",
  soilMin = 0,
  soilMax = 1,
}: ParcelLeafletMapProps) {
  const useOSMBase = selectedIndex === "dem" || selectedIndex === "mx-soil";
  return (
    <MapContainer
      center={mapCenter}
      zoom={15}
      className="w-full h-full"
      style={mapStyle}
      scrollWheelZoom={scrollWheelZoom}
      zoomControl={zoomControl}
    >
      {useOSMBase ? (
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
      ) : (
        <TileLayer
          attribution="&copy; Esri"
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        />
      )}
      {hasIndexTiles && indexTileUrl && (
        <TileLayer
          url={indexTileUrl}
          opacity={tileOpacity}
          attribution="Google Earth Engine"
        />
      )}
      {polygonCoords.length > 0 && (
        <StablePolygon
          positions={polygonCoords}
          hasIndexTiles={hasIndexTiles}
          selectedIndex={selectedIndex}
          currentIndexValue={currentIndexValue}
        />
      )}
      {/* Mexico soil sample points */}
      {selectedIndex === "mx-soil" && soilSamples && soilSamples.map((f) => {
        const val = f.properties[soilAttribute];
        const color = (val !== null && val !== undefined)
          ? soilColor(Number(val), soilMin, soilMax)
          : "#888888";
        const [lng, lat] = f.geometry.coordinates;
        const p = f.properties;
        return (
          <CircleMarker
            key={f.properties.id}
            center={[lat, lng]}
            radius={6}
            pathOptions={{ fillColor: color, fillOpacity: 0.85, color: "#fff", weight: 1 }}
          >
            <Popup maxWidth={260} className="soil-sample-popup">
              <div className="text-xs space-y-1">
                <div className="font-semibold text-sm border-b pb-1 mb-1">
                  {p.municipio}, {p.estado}
                </div>
                {p.localidad && <div><span className="font-medium">Localidad:</span> {p.localidad}</div>}
                {p.labNumber && <div><span className="font-medium">No. Lab:</span> {p.labNumber}</div>}
                {p.textura && <div><span className="font-medium">Textura:</span> {p.textura}</div>}
                <table className="w-full border-collapse mt-1">
                  <tbody>
                    {[
                      ["pH", p.pH], ["CE (dS/m)", p.ce], ["M.O. (%)", p.mo],
                      ["N (%)", p.n], ["P (ppm)", p.p], ["K (ppm)", p.k],
                      ["Ca (ppm)", p.ca], ["Mg (ppm)", p.mg], ["Fe (ppm)", p.fe],
                      ["Zn (ppm)", p.zn], ["B (ppm)", p.b], ["Mn (ppm)", p.mn],
                      ["Cu (ppm)", p.cu], ["Na (ppm)", p.na], ["CIC (meq/100g)", p.cic],
                      ["Arcilla (%)", p.arcilla], ["Limo (%)", p.limo], ["Arena (%)", p.arena],
                    ].filter(([, v]) => v !== null && v !== undefined).map(([label, value]) => (
                      <tr key={label as string} className="border-b border-gray-100">
                        <td className="pr-2 text-muted-foreground py-0.5">{label}</td>
                        <td className="font-mono font-medium">{Number(value).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
      <MapController
        center={mapCenter}
        zoom={15}
        bounds={polygonCoords.length > 0 ? polygonCoords : undefined}
      />
    </MapContainer>
  );
}, parcelLeafletMapPropsAreEqual);

function getNDVIColor(ndvi: number): string {
  if (ndvi >= 0.8) return "#1a9850";
  if (ndvi >= 0.6) return "#91cf60";
  if (ndvi >= 0.4) return "#d9ef8b";
  if (ndvi >= 0.2) return "#fee08b";
  if (ndvi >= 0.1) return "#fc8d59";
  return "#d73027";
}

interface DroneFlight {
  id: string;
  parcelId: string;
  flightDate: string;
  indexType: string;
  resolution: number | null;
  notes: string | null;
  createdAt: string;
}

function getDroneRecommendations(crop: string, stage?: string): { title: string; description: string; priority: string }[] {
  const recommendations: { title: string; description: string; priority: string }[] = [];
  const s = stage || "crecimiento";

  if (s === "siembra" || s === "germinacion") {
    recommendations.push({
      title: "Vuelo RGB para verificar emergencia",
      description: `Realiza un vuelo RGB a baja altura (30-50m) para verificar la emergencia uniforme de ${crop}. Resolución recomendada: 1-2 cm/px.`,
      priority: "alta",
    });
  }
  if (s === "crecimiento") {
    recommendations.push({
      title: "Vuelo NDVI para vigor vegetativo",
      description: `Captura un mapa NDVI para evaluar el vigor del ${crop} en etapa de crecimiento. Identifica zonas con estrés temprano.`,
      priority: "alta",
    });
    recommendations.push({
      title: "Vuelo NDMI para estrés hídrico",
      description: "Utiliza el índice NDMI para detectar áreas con déficit de humedad y optimizar el riego.",
      priority: "media",
    });
  }
  if (s === "floracion" || s === "fructificacion") {
    recommendations.push({
      title: "Vuelo térmico para estrés",
      description: `Realiza un vuelo térmico para detectar estrés hídrico y enfermedades durante la ${s} de ${crop}.`,
      priority: "alta",
    });
    recommendations.push({
      title: "Vuelo NDVI de seguimiento",
      description: "Compara con vuelos anteriores para evaluar la evolución del cultivo y detectar anomalías.",
      priority: "media",
    });
  }
  if (s === "cosecha") {
    recommendations.push({
      title: "Vuelo RGB para estimación de rendimiento",
      description: `Captura imágenes RGB de alta resolución para estimar el rendimiento de ${crop} antes de la cosecha.`,
      priority: "media",
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      title: "Vuelo NDVI general",
      description: `Realiza un vuelo NDVI periódico para monitorear el estado general de ${crop}.`,
      priority: "media",
    });
  }

  return recommendations;
}

function DroneTabContent({ parcelId, crop, phenologicalStage }: { parcelId: string; crop: string; phenologicalStage?: string }) {
  const queryClient = useQueryClient();
  const [showFlightDialog, setShowFlightDialog] = useState(false);
  const [flightForm, setFlightForm] = useState({
    flightDate: new Date().toISOString().split("T")[0],
    indexType: "NDVI",
    resolutionCm: "5",
    notes: "",
  });

  const { data: flightsData, isLoading: flightsLoading } = useQuery({
    queryKey: ["drone-flights", parcelId],
    queryFn: async () => {
      const response = await fetch(`/api/parcels/${parcelId}/drone-flights`, { credentials: "include" });
      if (!response.ok) return { flights: [] };
      return response.json();
    },
    enabled: !!parcelId,
  });

  const createFlightMutation = useMutation({
    mutationFn: async (data: typeof flightForm) => {
      const response = await fetch(`/api/parcels/${parcelId}/drone-flights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          flightDate: data.flightDate,
          indexType: data.indexType,
          resolution: data.resolutionCm ? parseInt(data.resolutionCm) : null,
          notes: data.notes || null,
        }),
      });
      if (!response.ok) throw new Error("Error al registrar vuelo");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drone-flights", parcelId] });
      setShowFlightDialog(false);
      setFlightForm({ flightDate: new Date().toISOString().split("T")[0], indexType: "NDVI", resolutionCm: "5", notes: "" });
    },
  });

  const deleteFlightMutation = useMutation({
    mutationFn: async (flightId: string) => {
      const response = await fetch(`/api/drone-flights/${flightId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Error al eliminar vuelo");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drone-flights", parcelId] });
    },
  });

  const flights: DroneFlight[] = flightsData?.flights || [];
  const recommendations = getDroneRecommendations(crop, phenologicalStage);

  const indexTypeLabels: Record<string, string> = {
    NDVI: "NDVI - Vegetación",
    RGB: "RGB - Color real",
    NDMI: "NDMI - Humedad",
    Thermal: "Térmico",
  };

  const indexTypeColors: Record<string, string> = {
    NDVI: "bg-green-100 text-green-800",
    RGB: "bg-blue-100 text-blue-800",
    NDMI: "bg-cyan-100 text-cyan-800",
    Thermal: "bg-red-100 text-red-800",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold" data-testid="text-drone-title">Monitoreo con Drones</h3>
          <p className="text-sm text-muted-foreground">Registra vuelos, sube ortomosaicos y recibe recomendaciones de vuelo.</p>
        </div>
        <Button onClick={() => setShowFlightDialog(true)} data-testid="button-add-flight">
          <Plus className="w-4 h-4 mr-2" /> Registrar Vuelo
        </Button>
      </div>

      <Dialog open={showFlightDialog} onOpenChange={setShowFlightDialog}>
        <DialogContent data-testid="dialog-add-flight">
          <DialogHeader>
            <DialogTitle>Registrar Vuelo de Dron</DialogTitle>
            <DialogDescription>Ingresa los detalles del vuelo realizado sobre la parcela.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="flight-date">Fecha del vuelo</Label>
              <Input
                id="flight-date"
                type="date"
                value={flightForm.flightDate}
                onChange={(e) => setFlightForm({ ...flightForm, flightDate: e.target.value })}
                data-testid="input-flight-date"
              />
            </div>
            <div>
              <Label htmlFor="flight-index">Tipo de índice</Label>
              <Select value={flightForm.indexType} onValueChange={(v) => setFlightForm({ ...flightForm, indexType: v })}>
                <SelectTrigger data-testid="select-flight-index">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NDVI">NDVI - Vegetación</SelectItem>
                  <SelectItem value="RGB">RGB - Color real</SelectItem>
                  <SelectItem value="NDMI">NDMI - Humedad</SelectItem>
                  <SelectItem value="Thermal">Térmico</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="flight-resolution">Resolución (cm/px)</Label>
              <Input
                id="flight-resolution"
                type="number"
                min="1"
                max="100"
                value={flightForm.resolutionCm}
                onChange={(e) => setFlightForm({ ...flightForm, resolutionCm: e.target.value })}
                data-testid="input-flight-resolution"
              />
            </div>
            <div>
              <Label htmlFor="flight-notes">Notas</Label>
              <Input
                id="flight-notes"
                placeholder="Observaciones del vuelo..."
                value={flightForm.notes}
                onChange={(e) => setFlightForm({ ...flightForm, notes: e.target.value })}
                data-testid="input-flight-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFlightDialog(false)} data-testid="button-cancel-flight">Cancelar</Button>
            <Button
              onClick={() => createFlightMutation.mutate(flightForm)}
              disabled={createFlightMutation.isPending || !flightForm.flightDate}
              data-testid="button-save-flight"
            >
              {createFlightMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card data-testid="card-flights-list">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Plane className="w-5 h-5" /> Vuelos Registrados
            </CardTitle>
            <CardDescription>{flights.length} vuelo{flights.length !== 1 ? "s" : ""} registrado{flights.length !== 1 ? "s" : ""}</CardDescription>
          </CardHeader>
          <CardContent>
            {flightsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : flights.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Plane className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No hay vuelos registrados aún.</p>
                <p className="text-xs mt-1">Haz clic en "Registrar Vuelo" para comenzar.</p>
              </div>
            ) : (
              <div className="space-y-3" data-testid="list-flights">
                {flights.map((flight: DroneFlight) => (
                  <div
                    key={flight.id}
                    className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                    data-testid={`flight-item-${flight.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-sm font-medium" data-testid={`text-flight-date-${flight.id}`}>
                            {new Date(flight.flightDate).toLocaleDateString("es-MX")}
                          </span>
                          <Badge variant="secondary" className={`text-xs ${indexTypeColors[flight.indexType] || ""}`} data-testid={`badge-flight-index-${flight.id}`}>
                            {flight.indexType}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          {flight.resolution && (
                            <span className="text-xs text-muted-foreground" data-testid={`text-flight-resolution-${flight.id}`}>
                              {flight.resolution} cm/px
                            </span>
                          )}
                          {flight.notes && (
                            <span className="text-xs text-muted-foreground truncate max-w-[200px]">{flight.notes}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteFlightMutation.mutate(flight.id)}
                      disabled={deleteFlightMutation.isPending}
                      data-testid={`button-delete-flight-${flight.id}`}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-flight-recommendations">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Info className="w-5 h-5" /> Recomendaciones de Vuelo
            </CardTitle>
            <CardDescription>
              Basado en: {crop} — Etapa: {phenologicalStage || "general"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recommendations.map((rec, idx) => (
                <div key={idx} className="p-3 rounded-lg border bg-card" data-testid={`recommendation-${idx}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{rec.title}</p>
                      <p className="text-xs text-muted-foreground mt-1">{rec.description}</p>
                    </div>
                    <Badge variant={rec.priority === "alta" ? "destructive" : "secondary"} className="text-xs shrink-0">
                      {rec.priority}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-upload-orthomosaic">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="w-5 h-5" /> Subir Ortomosaico
          </CardTitle>
          <CardDescription>Arrastra y suelta archivos de ortomosaico (GeoTIFF, JPEG, PNG) para visualizar sobre el mapa.</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center hover:border-primary/50 transition-colors cursor-pointer"
            data-testid="dropzone-orthomosaic"
          >
            <ImageIcon className="w-12 h-12 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">Arrastra archivos aquí o haz clic para seleccionar</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Formatos soportados: GeoTIFF, JPEG, PNG — Máximo 500 MB</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const sensorTypeLabels: Record<string, string> = {
  soil_moisture: "Humedad del Suelo",
  temperature: "Temperatura",
  humidity: "Humedad Aire",
  soil_temperature: "Temp. Suelo",
  ec: "Conductividad",
  ph: "pH",
  light: "Luminosidad",
  wind: "Viento",
  rain: "Precipitación",
};

const sensorTypeUnits: Record<string, string> = {
  soil_moisture: "%",
  temperature: "°C",
  humidity: "%",
  soil_temperature: "°C",
  ec: "dS/m",
  ph: "",
  light: "lux",
  wind: "km/h",
  rain: "mm",
};

const sensorTypeRanges: Record<string, { min: number; max: number }> = {
  soil_moisture: { min: 10, max: 80 },
  temperature: { min: 15, max: 42 },
  humidity: { min: 20, max: 95 },
  soil_temperature: { min: 12, max: 38 },
  ec: { min: 0.1, max: 4.0 },
  ph: { min: 4.5, max: 8.5 },
  light: { min: 100, max: 100000 },
  wind: { min: 0, max: 60 },
  rain: { min: 0, max: 50 },
};

function IoTTabContent({ parcelId }: { parcelId: string }) {
  const queryClient = useQueryClient();
  const [showDeviceDialog, setShowDeviceDialog] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [deviceForm, setDeviceForm] = useState({
    name: "",
    sensorType: "soil_moisture",
    unit: "",
  });

  const { data: devicesData, isLoading: devicesLoading } = useQuery({
    queryKey: ["iot-devices", parcelId],
    queryFn: async () => {
      const response = await fetch(`/api/parcels/${parcelId}/iot-devices`, { credentials: "include" });
      if (!response.ok) return { devices: [] };
      return response.json();
    },
    enabled: !!parcelId,
  });

  const { data: readingsData } = useQuery({
    queryKey: ["iot-readings", selectedDeviceId],
    queryFn: async () => {
      const response = await fetch(`/api/iot-devices/${selectedDeviceId}/readings?limit=50`, { credentials: "include" });
      if (!response.ok) return { readings: [] };
      return response.json();
    },
    enabled: !!selectedDeviceId,
  });

  const createDeviceMutation = useMutation({
    mutationFn: async (data: typeof deviceForm) => {
      const response = await fetch(`/api/parcels/${parcelId}/iot-devices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: data.name,
          sensorType: data.sensorType,
          unit: data.unit || sensorTypeUnits[data.sensorType] || "",
        }),
      });
      if (!response.ok) throw new Error("Error al crear dispositivo");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["iot-devices", parcelId] });
      setShowDeviceDialog(false);
      setDeviceForm({ name: "", sensorType: "soil_moisture", unit: "" });
    },
  });

  const toggleDeviceMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const response = await fetch(`/api/iot-devices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ isActive }),
      });
      if (!response.ok) throw new Error("Error al actualizar dispositivo");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["iot-devices", parcelId] });
    },
  });

  const deleteDeviceMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/iot-devices/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Error al eliminar dispositivo");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["iot-devices", parcelId] });
      if (selectedDeviceId) setSelectedDeviceId(null);
    },
  });

  const simulateReadingMutation = useMutation({
    mutationFn: async ({ deviceId, sensorType }: { deviceId: string; sensorType: string }) => {
      const range = sensorTypeRanges[sensorType] || { min: 0, max: 100 };
      const value = (Math.random() * (range.max - range.min) + range.min).toFixed(2);
      const response = await fetch(`/api/iot-devices/${deviceId}/readings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ value, timestamp: new Date().toISOString() }),
      });
      if (!response.ok) throw new Error("Error al crear lectura");
      return response.json();
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["iot-readings", vars.deviceId] });
    },
  });

  const devices: any[] = devicesData?.devices || [];
  const readings: any[] = readingsData?.readings || [];

  const chartData = useMemo(
    () => [...readings].reverse().map((r: any) => ({
      time: new Date(r.timestamp).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }),
      value: parseFloat(r.value),
    })),
    [readings]
  );

  const selectedDevice = devices.find((d: any) => d.id === selectedDeviceId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold" data-testid="text-iot-title">Sensores IoT</h3>
          <p className="text-sm text-muted-foreground">{devices.length} dispositivo(s) registrado(s)</p>
        </div>
        <Button size="sm" onClick={() => setShowDeviceDialog(true)} data-testid="button-add-device">
          <Plus className="w-4 h-4 mr-1" /> Agregar Sensor
        </Button>
      </div>

      {devicesLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : devices.length === 0 ? (
        <Card>
          <CardContent className="text-center py-8">
            <Cpu className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No hay sensores registrados aún</p>
            <p className="text-xs text-muted-foreground mt-1">Agrega un sensor para comenzar a monitorear tu parcela</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {devices.map((device: any) => (
            <Card
              key={device.id}
              className={`cursor-pointer transition-all ${selectedDeviceId === device.id ? "ring-2 ring-primary" : "hover:shadow-md"}`}
              onClick={() => setSelectedDeviceId(selectedDeviceId === device.id ? null : device.id)}
              data-testid={`card-device-${device.id}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {device.sensorType === "temperature" || device.sensorType === "soil_temperature" ? (
                      <Thermometer className="w-5 h-5 text-orange-500" />
                    ) : device.sensorType === "soil_moisture" || device.sensorType === "humidity" ? (
                      <Droplets className="w-5 h-5 text-blue-500" />
                    ) : (
                      <Database className="w-5 h-5 text-green-500" />
                    )}
                    <div>
                      <p className="font-medium text-sm" data-testid={`text-device-name-${device.id}`}>{device.name}</p>
                      <p className="text-xs text-muted-foreground">{sensorTypeLabels[device.sensorType] || device.sensorType}</p>
                    </div>
                  </div>
                  <Badge variant={device.isActive ? "default" : "secondary"} className="text-[10px]" data-testid={`badge-device-status-${device.id}`}>
                    {device.isActive ? "Activo" : "Inactivo"}
                  </Badge>
                </div>
                <div className="flex gap-1 mt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs flex-1"
                    onClick={(e) => { e.stopPropagation(); simulateReadingMutation.mutate({ deviceId: device.id, sensorType: device.sensorType }); }}
                    data-testid={`button-simulate-${device.id}`}
                  >
                    <BarChart3 className="w-3 h-3 mr-1" /> Simular
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={(e) => { e.stopPropagation(); toggleDeviceMutation.mutate({ id: device.id, isActive: !device.isActive }); }}
                    data-testid={`button-toggle-${device.id}`}
                  >
                    {device.isActive ? "Desactivar" : "Activar"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-destructive"
                    onClick={(e) => { e.stopPropagation(); deleteDeviceMutation.mutate(device.id); }}
                    data-testid={`button-delete-device-${device.id}`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectedDeviceId && selectedDevice && (
        <Card data-testid="card-device-readings">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Lecturas: {selectedDevice.name}
              <span className="text-sm font-normal text-muted-foreground ml-2">
                ({sensorTypeLabels[selectedDevice.sensorType]} — {sensorTypeUnits[selectedDevice.sensorType] || selectedDevice.unit || ""})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {chartData.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-6">Sin lecturas. Usa "Simular" para generar datos de prueba.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="value" stroke="#16a34a" strokeWidth={2} dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={showDeviceDialog} onOpenChange={setShowDeviceDialog}>
        <DialogContent className="max-w-md" data-testid="dialog-add-device">
          <DialogHeader>
            <DialogTitle>Registrar Sensor IoT</DialogTitle>
            <DialogDescription>Agrega un nuevo sensor para monitorear tu parcela</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nombre del sensor</Label>
              <Input
                placeholder="Ej: Sensor Humedad Norte"
                value={deviceForm.name}
                onChange={(e) => setDeviceForm({ ...deviceForm, name: e.target.value })}
                data-testid="input-device-name"
              />
            </div>
            <div>
              <Label>Tipo de sensor</Label>
              <Select value={deviceForm.sensorType} onValueChange={(v) => setDeviceForm({ ...deviceForm, sensorType: v, unit: sensorTypeUnits[v] || "" })}>
                <SelectTrigger data-testid="select-sensor-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(sensorTypeLabels).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Unidad de medida</Label>
              <Input
                placeholder="Ej: %, °C, dS/m"
                value={deviceForm.unit}
                onChange={(e) => setDeviceForm({ ...deviceForm, unit: e.target.value })}
                data-testid="input-device-unit"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeviceDialog(false)}>Cancelar</Button>
            <Button
              onClick={() => createDeviceMutation.mutate(deviceForm)}
              disabled={!deviceForm.name || createDeviceMutation.isPending}
              data-testid="button-save-device"
            >
              {createDeviceMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function IrrigationTabContent({ parcelId, irrigationSystem, crop, area }: { parcelId: string; irrigationSystem?: string; crop?: string; area?: number }) {
  const queryClient = useQueryClient();
  const [showLogDialog, setShowLogDialog] = useState(false);
  const [etc, setEtc] = useState("5.0");
  const [precipitation, setPrecipitation] = useState("0.0");
  const [logForm, setLogForm] = useState({
    date: new Date().toISOString().split("T")[0],
    volumeLiters: "",
    durationMinutes: "",
    method: irrigationSystem || "goteo",
    notes: "",
  });

  const { data: logsData, isLoading: logsLoading } = useQuery({
    queryKey: ["irrigation-logs", parcelId],
    queryFn: async () => {
      const response = await fetch(`/api/parcels/${parcelId}/irrigation-logs`, { credentials: "include" });
      if (!response.ok) return { logs: [] };
      return response.json();
    },
    enabled: !!parcelId,
  });

  const createLogMutation = useMutation({
    mutationFn: async (data: typeof logForm) => {
      const response = await fetch(`/api/parcels/${parcelId}/irrigation-logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          date: data.date,
          volumeLiters: data.volumeLiters ? parseFloat(data.volumeLiters) : null,
          durationMinutes: data.durationMinutes ? parseInt(data.durationMinutes) : null,
          method: data.method,
          notes: data.notes,
        }),
      });
      if (!response.ok) throw new Error("Error al crear registro");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["irrigation-logs", parcelId] });
      setShowLogDialog(false);
      setLogForm({ date: new Date().toISOString().split("T")[0], volumeLiters: "", durationMinutes: "", method: irrigationSystem || "goteo", notes: "" });
    },
  });

  const deleteLogMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/irrigation-logs/${id}`, { method: "DELETE", credentials: "include" });
      if (!response.ok) throw new Error("Error al eliminar registro");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["irrigation-logs", parcelId] });
    },
  });

  const logs: any[] = logsData?.logs || [];

  const now = new Date();
  const thisMonthLogs = logs.filter((l: any) => {
    const d = new Date(l.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  const totalWaterMonth = thisMonthLogs.reduce((sum: number, l: any) => sum + (parseFloat(l.volumeLiters) || 0), 0);
  const avgPerEvent = thisMonthLogs.length > 0 ? totalWaterMonth / thisMonthLogs.length : 0;
  const eventsThisMonth = thisMonthLogs.length;

  const etcValue = parseFloat(etc) || 0;
  const precipValue = parseFloat(precipitation) || 0;
  const irrigApplied = totalWaterMonth > 0 ? totalWaterMonth / ((area || 1) * 10) : 0;
  const deficit = etcValue * 7 - (precipValue * 7 + irrigApplied);

  const weeklyData = useMemo(() => {
    const result = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayStr = d.toLocaleDateString("es", { weekday: "short" });
      const dayLogs = logs.filter((l: any) => {
        const ld = new Date(l.date);
        return ld.toDateString() === d.toDateString();
      });
      const irrigDay = dayLogs.reduce((s: number, l: any) => s + (parseFloat(l.volumeLiters) || 0), 0);
      result.push({
        day: dayStr,
        riego: Math.round(irrigDay),
        etc: Math.round((parseFloat(etc) || 0) * (area || 1) * 10),
      });
    }
    return result;
  }, [logs, etc, area]);

  const methodLabels: Record<string, string> = {
    goteo: "Goteo",
    aspersion: "Aspersión",
    gravedad: "Gravedad",
    pivote: "Pivote",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold" data-testid="text-irrigation-title">Riego Inteligente</h3>
          <p className="text-sm text-muted-foreground">Sistema: {methodLabels[irrigationSystem || ""] || irrigationSystem || "N/A"}</p>
        </div>
        <Button size="sm" onClick={() => setShowLogDialog(true)} data-testid="button-add-irrigation">
          <Plus className="w-4 h-4 mr-1" /> Registrar Riego
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card data-testid="card-water-balance">
          <CardContent className="p-4">
            <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Droplets className="w-4 h-4 text-blue-500" /> Balance Hídrico
            </h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">ETc (mm/día)</Label>
                <Input
                  type="number"
                  value={etc}
                  onChange={(e) => setEtc(e.target.value)}
                  className="w-20 h-7 text-xs text-right"
                  step="0.1"
                  data-testid="input-etc"
                />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Precipitación (mm/día)</Label>
                <Input
                  type="number"
                  value={precipitation}
                  onChange={(e) => setPrecipitation(e.target.value)}
                  className="w-20 h-7 text-xs text-right"
                  step="0.1"
                  data-testid="input-precipitation"
                />
              </div>
              <div className="flex items-center justify-between pt-1 border-t">
                <span className="text-xs font-medium">Riego aplicado (L/mes)</span>
                <span className="text-xs font-mono" data-testid="text-total-irrigation">{totalWaterMonth.toFixed(0)} L</span>
              </div>
              <div className={`flex items-center justify-between p-2 rounded text-xs font-medium ${deficit > 0 ? "bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400" : "bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400"}`}>
                <span>Déficit semanal</span>
                <span data-testid="text-deficit">{deficit > 0 ? `−${deficit.toFixed(1)} mm` : `+${Math.abs(deficit).toFixed(1)} mm`}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-efficiency">
          <CardContent className="p-4">
            <h4 className="text-sm font-semibold mb-3">Métricas del Mes</h4>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-xs text-muted-foreground">Total agua</span>
                <span className="text-sm font-mono font-medium" data-testid="text-total-water">{totalWaterMonth.toFixed(0)} L</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-muted-foreground">Promedio/evento</span>
                <span className="text-sm font-mono font-medium" data-testid="text-avg-event">{avgPerEvent.toFixed(0)} L</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-muted-foreground">Eventos</span>
                <span className="text-sm font-mono font-medium" data-testid="text-events-count">{eventsThisMonth}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-recommendation">
          <CardContent className="p-4">
            <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <AlertTriangle className={`w-4 h-4 ${deficit > 0 ? "text-orange-500" : "text-green-500"}`} />
              Recomendación
            </h4>
            {deficit > 10 ? (
              <div className="space-y-2">
                <Badge variant="destructive" className="text-xs" data-testid="badge-irrigation-alert">Riego urgente</Badge>
                <p className="text-xs text-muted-foreground">
                  El déficit hídrico es alto ({deficit.toFixed(1)} mm). Se recomienda regar lo antes posible para evitar estrés en el cultivo
                  {crop ? ` de ${crop}` : ""}.
                </p>
              </div>
            ) : deficit > 0 ? (
              <div className="space-y-2">
                <Badge variant="outline" className="text-xs border-orange-300 text-orange-700" data-testid="badge-irrigation-alert">Riego programado</Badge>
                <p className="text-xs text-muted-foreground">
                  Déficit leve ({deficit.toFixed(1)} mm). Programa riego en las próximas 48 horas.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Badge variant="outline" className="text-xs border-green-300 text-green-700" data-testid="badge-irrigation-alert">Sin déficit</Badge>
                <p className="text-xs text-muted-foreground">
                  El balance hídrico es positivo. No se requiere riego inmediato.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-weekly-chart">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Balance Hídrico Semanal</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={weeklyData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="riego" fill="#3b82f6" name="Riego (L)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="etc" fill="#f97316" name="ETc (L)" radius={[4, 4, 0, 0]} opacity={0.4} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {logsLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : logs.length === 0 ? (
        <Card>
          <CardContent className="text-center py-6">
            <Droplets className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">No hay registros de riego aún</p>
          </CardContent>
        </Card>
      ) : (
        <Card data-testid="card-irrigation-logs">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Historial de Riegos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {logs.slice(0, 10).map((log: any) => (
                <div key={log.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/30 text-sm" data-testid={`row-irrigation-${log.id}`}>
                  <div className="flex items-center gap-3">
                    <Calendar className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium">{new Date(log.date).toLocaleDateString("es")}</span>
                    <Badge variant="outline" className="text-[10px]">{methodLabels[log.method] || log.method}</Badge>
                  </div>
                  <div className="flex items-center gap-3">
                    {log.volumeLiters && <span className="text-xs text-muted-foreground">{parseFloat(log.volumeLiters).toFixed(0)} L</span>}
                    {log.durationMinutes && <span className="text-xs text-muted-foreground">{log.durationMinutes} min</span>}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 text-destructive"
                      onClick={() => deleteLogMutation.mutate(log.id)}
                      data-testid={`button-delete-irrigation-${log.id}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={showLogDialog} onOpenChange={setShowLogDialog}>
        <DialogContent className="max-w-md" data-testid="dialog-add-irrigation">
          <DialogHeader>
            <DialogTitle>Registrar Riego</DialogTitle>
            <DialogDescription>Registra el riego aplicado a tu parcela</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Fecha</Label>
              <Input
                type="date"
                value={logForm.date}
                onChange={(e) => setLogForm({ ...logForm, date: e.target.value })}
                data-testid="input-irrigation-date"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Volumen (litros)</Label>
                <Input
                  type="number"
                  placeholder="Ej: 5000"
                  value={logForm.volumeLiters}
                  onChange={(e) => setLogForm({ ...logForm, volumeLiters: e.target.value })}
                  data-testid="input-irrigation-volume"
                />
              </div>
              <div>
                <Label>Duración (min)</Label>
                <Input
                  type="number"
                  placeholder="Ej: 120"
                  value={logForm.durationMinutes}
                  onChange={(e) => setLogForm({ ...logForm, durationMinutes: e.target.value })}
                  data-testid="input-irrigation-duration"
                />
              </div>
            </div>
            <div>
              <Label>Método</Label>
              <Select value={logForm.method} onValueChange={(v) => setLogForm({ ...logForm, method: v })}>
                <SelectTrigger data-testid="select-irrigation-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="goteo">Goteo</SelectItem>
                  <SelectItem value="aspersion">Aspersión</SelectItem>
                  <SelectItem value="gravedad">Gravedad</SelectItem>
                  <SelectItem value="pivote">Pivote</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notas</Label>
              <Input
                placeholder="Observaciones..."
                value={logForm.notes}
                onChange={(e) => setLogForm({ ...logForm, notes: e.target.value })}
                data-testid="input-irrigation-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLogDialog(false)}>Cancelar</Button>
            <Button
              onClick={() => createLogMutation.mutate(logForm)}
              disabled={createLogMutation.isPending}
              data-testid="button-save-irrigation"
            >
              {createLogMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── InsumosDashboard (T155) ──────────────────────────────────────────────────
interface PrescAppRow {
  id: string;
  prescriptionId: string;
  applicationDate: string;
  actualDoseByZone: Record<string, number> | null;
  machineUsed: string | null;
  notes: string | null;
}
interface PrescRaw {
  id: string;
  zoneId: string;
  amendment: string;
  dosePerHa: number | null;
  doseUnit: string | null;
  estimatedCost: number | null;
}
interface ZoneRaw {
  id: string;
  zoneLabel: string | null;
  zoneIndex: number;
  areaHa: string | null;
}
interface InterpPrescResponse {
  prescriptions: PrescRaw[];
  zones: ZoneRaw[];
  applications: PrescAppRow[];
}
interface ProductionCostRaw {
  id: string;
  concept: string;
  totalCost: string;
  category: string;
}

function InsumosDashboard({ parcelId }: { parcelId: string }) {
  const { data: campaigns = [] } = useQuery<{ id: string; name: string; status: string }[]>({
    queryKey: ["sampling-campaigns", parcelId],
    queryFn: async () => {
      const r = await fetch(`/api/parcels/${parcelId}/sampling-campaigns`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const interpolatedCampaignIds = campaigns
    .filter(c => c.status === "interpolated")
    .map(c => c.id);

  const { data: rawData, isLoading } = useQuery<InterpPrescResponse[]>({
    queryKey: ["insumos-dashboard", parcelId, interpolatedCampaignIds.join(",")],
    queryFn: async () => {
      if (interpolatedCampaignIds.length === 0) return [];
      const interpIdArrays = await Promise.all(
        interpolatedCampaignIds.map(async cid => {
          const r = await fetch(`/api/sampling-campaigns/${cid}/interpolations`, { credentials: "include" });
          if (!r.ok) return [];
          const list: { id: string }[] = await r.json();
          return list.map(i => i.id);
        })
      );
      const allInterpIds = interpIdArrays.flat();
      if (allInterpIds.length === 0) return [];
      return Promise.all(
        allInterpIds.map(async iid => {
          const r = await fetch(`/api/interpolations/${iid}/prescriptions`, { credentials: "include" });
          if (!r.ok) return { prescriptions: [], zones: [], applications: [] };
          return r.json() as Promise<InterpPrescResponse>;
        })
      );
    },
    enabled: interpolatedCampaignIds.length > 0,
  });

  const { data: productionCosts = [] } = useQuery<ProductionCostRaw[]>({
    queryKey: ["production-costs", parcelId],
    queryFn: async () => {
      const r = await fetch(`/api/parcels/${parcelId}/costs`, { credentials: "include" });
      if (!r.ok) return [];
      const data = await r.json();
      return Array.isArray(data) ? data : (data.costs ?? []);
    },
  });

  const grouped = (rawData ?? []).reduce<Record<string, {
    prescrito: number; aplicado: number; hasApps: boolean; unit: string;
  }>>((acc, chunk) => {
    const zoneMap = new Map<string, ZoneRaw>(chunk.zones.map(z => [z.id, z]));
    const labelMap = new Map<string, number>();
    chunk.zones.forEach(z => {
      const lbl = z.zoneLabel ?? String(z.zoneIndex);
      labelMap.set(lbl, Number(z.areaHa ?? 0));
    });
    const appsByPresc = new Map<string, PrescAppRow[]>();
    chunk.applications.forEach(a => {
      if (!appsByPresc.has(a.prescriptionId)) appsByPresc.set(a.prescriptionId, []);
      appsByPresc.get(a.prescriptionId)!.push(a);
    });

    chunk.prescriptions.forEach(p => {
      const zone = zoneMap.get(p.zoneId);
      const areaHa = Number(zone?.areaHa ?? 0);
      const prescritedQty = Number(p.dosePerHa ?? 0) * areaHa;
      const apps = appsByPresc.get(p.id) ?? [];
      const appliedQty = apps.reduce((s, a) => {
        const doses = a.actualDoseByZone ?? {};
        return s + Object.entries(doses).reduce((x, [lbl, dose]) => {
          const ha = labelMap.get(lbl) ?? 0;
          return x + dose * ha;
        }, 0);
      }, 0);
      const key = p.amendment ?? "—";
      if (!acc[key]) acc[key] = { prescrito: 0, aplicado: 0, hasApps: false, unit: p.doseUnit ?? "" };
      acc[key].prescrito += prescritedQty;
      acc[key].aplicado += appliedQty;
      if (apps.length > 0) acc[key].hasApps = true;
    });
    return acc;
  }, {});

  const costByConceptMap = productionCosts.reduce<Record<string, number>>((m, c) => {
    const k = c.concept?.toLowerCase() ?? "";
    m[k] = (m[k] ?? 0) + Number(c.totalCost ?? 0);
    return m;
  }, {});

  const rows = Object.entries(grouped).map(([amendment, v]) => {
    const costKey = Object.keys(costByConceptMap).find(k => k.includes(amendment.toLowerCase()) || amendment.toLowerCase().includes(k));
    const costo = costKey ? costByConceptMap[costKey] : 0;
    return {
      amendment,
      prescrito: v.prescrito,
      aplicado: v.aplicado,
      hasApps: v.hasApps,
      diff: v.prescrito > 0 ? Math.abs((v.aplicado - v.prescrito) / v.prescrito) * 100 : null,
      costo,
      unit: v.unit,
    };
  });

  const alerts = rows.filter(r => r.diff !== null && r.hasApps && r.diff > 10);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2">
        <Package className="w-5 h-5 animate-pulse" /> Cargando insumos…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground" data-testid="text-no-insumos">
        <Package className="w-10 h-10 mx-auto mb-2 opacity-25" />
        <p className="text-sm">Sin prescripciones generadas aún. Ve a la pestaña de prescripciones para generarlas.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="insumos-dashboard">
      {alerts.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-xs text-amber-800">
            <p className="font-semibold mb-1">Desviaciones &gt; 10% detectadas:</p>
            {alerts.map(a => (
              <p key={a.amendment}>• {a.amendment}: {a.diff?.toFixed(1)}% de diferencia entre prescrito y aplicado</p>
            ))}
          </div>
        </div>
      )}
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-xs min-w-[560px]">
          <thead>
            <tr className="bg-muted/50 border-b">
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Insumo</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">Prescrito (ha×dosis)</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">Aplicado (ha×dosis)</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">Desv. %</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">Costo (prod.)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.amendment} className="border-b last:border-0 hover:bg-muted/20" data-testid={`row-insumo-${i}`}>
                <td className="px-3 py-2.5 font-medium text-purple-700">{r.amendment}</td>
                <td className="px-3 py-2.5 text-right font-mono">{r.prescrito.toFixed(2)} {r.unit}</td>
                <td className="px-3 py-2.5 text-right font-mono">{r.hasApps ? `${r.aplicado.toFixed(2)} ${r.unit}` : "—"}</td>
                <td className="px-3 py-2.5 text-right">
                  {!r.hasApps || r.diff === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span className={r.diff > 10 ? "text-amber-700 font-semibold" : "text-green-700"}>
                      {r.diff.toFixed(1)}%
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right font-mono">{r.costo > 0 ? `$${r.costo.toFixed(2)}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── AutoguiadoMvzContent ─────────────────────────────────────────────────────

interface ZoneImportRow {
  id: string;
  zoneSetId: string | null;
  originalFileName: string;
  format: string;
  mode: string;
  featureCount: number;
  geometryTypes: string[] | null;
  warnings: unknown;
  createdAt: string;
}

interface ImportPreview {
  format: string;
  featureCount: number;
  geometryTypes: string[];
  warnings: string[];
  featureCollection: Record<string, unknown>;
  originalFileName: string;
  propertyKeys: string[];
}

function AutoguiadoMvzContent({
  parcelId,
  zoneImports,
  onRefresh,
}: {
  parcelId: string;
  zoneImports: ZoneImportRow[];
  onRefresh: () => void;
}) {
  const [, setLocation] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<"idle" | "parsing" | "preview" | "committing">("idle");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [labelColumn, setLabelColumn] = useState<string>("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);

  async function handleFileSelect(f: File) {
    setFile(f);
    setPreview(null);
    setParseError(null);
    setStep("parsing");
    const fd = new FormData();
    fd.append("file", f);
    try {
      const r = await fetch(`/api/parcels/${parcelId}/import-geometry`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      const json = await r.json();
      if (!r.ok) { setParseError(json.message ?? "Error al analizar el archivo"); setStep("idle"); return; }
      // Extract property keys from first feature
      const features = (json.featureCollection?.features ?? []) as Array<{ properties?: Record<string, unknown> | null }>;
      const firstProps = features.find(f => f.properties && Object.keys(f.properties).length > 0)?.properties ?? {};
      const propertyKeys = Object.keys(firstProps);
      setPreview({
        format: json.format,
        featureCount: json.featureCount,
        geometryTypes: json.geometryTypes ?? [],
        warnings: json.warnings ?? [],
        featureCollection: json.featureCollection,
        originalFileName: json.originalFileName,
        propertyKeys,
      });
      if (propertyKeys.length > 0) setLabelColumn(propertyKeys[0]);
      setStep("preview");
    } catch (e) {
      setParseError((e as Error).message);
      setStep("idle");
    }
  }

  async function handleCommit() {
    if (!preview) return;
    setCommitError(null);
    setStep("committing");
    try {
      const body: Record<string, unknown> = {
        featureCollection: preview.featureCollection,
        mode: "polygons",
        originalFileName: preview.originalFileName,
        format: preview.format,
        warnings: preview.warnings,
      };
      if (labelColumn) body.labelColumn = labelColumn;
      const r = await fetch(`/api/parcels/${parcelId}/zones/from-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      const json = await r.json();
      if (!r.ok) { setCommitError(json.message ?? "Error al crear zonas"); setStep("preview"); return; }
      onRefresh();
      setFile(null);
      setPreview(null);
      setStep("idle");
      if (json.zoneSetId) {
        setLocation(`/parcel/${parcelId}/prescription?zoneSet=${json.zoneSetId}&source=imported`);
      }
    } catch (e) {
      setCommitError((e as Error).message);
      setStep("preview");
    }
  }

  function reset() { setFile(null); setPreview(null); setStep("idle"); setParseError(null); setCommitError(null); }

  const formatLabel: Record<string, string> = { kml: "KML", kmz: "KMZ", geojson: "GeoJSON", shapefile: "Shapefile", csv: "CSV" };
  const importedZoneSets = zoneImports.filter(r => r.zoneSetId && r.mode === "polygons");

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <p className="text-sm font-medium">Zonas desde mapa de autoguiado</p>
          <p className="text-xs text-muted-foreground">Importa un KML/KMZ o Shapefile exportado de tu monitor de tractor (John Deere, ISOBUS, CNH, AGCO) y genera zonas de manejo directamente.</p>
        </div>
        {step !== "idle" && (
          <Button size="sm" variant="ghost" onClick={reset} data-testid="btn-autoguid-reset" className="text-muted-foreground">
            <RotateCcw className="w-4 h-4 mr-1" /> Reiniciar
          </Button>
        )}
      </div>

      {/* Upload area */}
      {step === "idle" && (
        <div className="space-y-3">
          {parseError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-700 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{parseError}
            </div>
          )}
          <div
            className="border-2 border-dashed border-amber-200 bg-amber-50/40 rounded-xl p-8 text-center cursor-pointer hover:border-amber-400 hover:bg-amber-50 transition-colors"
            onClick={() => fileInputRef.current?.click()}
            data-testid="drop-autoguid-file"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".kml,.kmz,.geojson,.json,.zip,.shp"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
              data-testid="input-autoguid-file"
            />
            <Tractor className="w-10 h-10 mx-auto text-amber-500 mb-2" />
            <p className="text-sm font-medium text-amber-800">Selecciona el archivo de zonas</p>
            <p className="text-xs text-muted-foreground mt-1">KML · KMZ · GeoJSON · Shapefile (.zip) · máx. 10 MB</p>
          </div>
        </div>
      )}

      {/* Parsing spinner */}
      {step === "parsing" && (
        <div className="flex flex-col items-center gap-3 py-8 text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
          <p className="text-sm">Analizando {file?.name ?? "archivo"}…</p>
        </div>
      )}

      {/* Preview */}
      {step === "preview" && preview && (
        <div className="space-y-4">
          {commitError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-700 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{commitError}
            </div>
          )}

          {/* Summary card */}
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-amber-600" />
              <span className="text-sm font-medium text-amber-800">Archivo válido — {preview.originalFileName}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              <div><span className="text-muted-foreground">Formato:</span> <strong>{formatLabel[preview.format] ?? preview.format}</strong></div>
              <div><span className="text-muted-foreground">Zonas detectadas:</span> <strong>{preview.featureCount}</strong></div>
              <div><span className="text-muted-foreground">Geometrías:</span> <strong>{preview.geometryTypes.join(", ") || "—"}</strong></div>
            </div>
            {preview.warnings.length > 0 && (
              <ul className="text-xs text-amber-700 space-y-0.5">
                {preview.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
              </ul>
            )}
          </div>

          {/* Column picker */}
          {preview.propertyKeys.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Columna de etiqueta de zona (opcional)</label>
              <select
                value={labelColumn}
                onChange={(e) => setLabelColumn(e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                data-testid="select-autoguid-label"
              >
                <option value="">— sin etiqueta —</option>
                {preview.propertyKeys.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">Elige la columna KML que corresponde al nombre / ID de zona o tasa de aplicación.</p>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={reset}
              data-testid="btn-autoguid-cancel"
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              className="bg-amber-600 hover:bg-amber-700 text-white gap-2"
              onClick={handleCommit}
              data-testid="btn-autoguid-commit"
            >
              <Check className="w-4 h-4" /> Crear zonas de manejo ({preview.featureCount})
            </Button>
          </div>
        </div>
      )}

      {/* Committing spinner */}
      {step === "committing" && (
        <div className="flex flex-col items-center gap-3 py-8 text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
          <p className="text-sm">Creando zonas de manejo…</p>
        </div>
      )}

      {/* Existing imports */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Zonas importadas anteriores</p>
        {zoneImports.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3 text-center">Aún no se han importado zonas de autoguiado.</p>
        ) : (
          <div className="space-y-2">
            {zoneImports.map((row) => (
              <div key={row.id} className="border rounded-xl p-3 bg-background flex items-center justify-between gap-2 flex-wrap" data-testid={`card-autoguid-import-${row.id}`}>
                <div className="space-y-0.5 min-w-0">
                  <p className="text-sm font-medium truncate">{row.originalFileName}</p>
                  <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                    <Badge variant="outline" className="text-[10px] h-4">{formatLabel[row.format] ?? row.format}</Badge>
                    <span>{row.featureCount} zona(s)</span>
                    <span>{new Date(row.createdAt).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })}</span>
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {row.zoneSetId && (
                    <>
                      <Link href={`/parcel/${parcelId}/prescription?zoneSet=${row.zoneSetId}&source=imported`}>
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" data-testid={`btn-autoguid-prescribe-${row.id}`}>
                          <Bot className="w-3 h-3" /> Prescripción
                        </Button>
                      </Link>
                      <a href={`/api/zone-sets/${row.zoneSetId}/export-machine?format=kml`} download>
                        <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" data-testid={`btn-autoguid-export-${row.id}`}>
                          <Download className="w-3 h-3" /> KML
                        </Button>
                      </a>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── DroneMvzContent ───────────────────────────────────────────────────────────
interface DroneZoneSet {
  zoneSetId: string;
  indexType: string;
  indexName: string;
  cameraType: string;
  filename: string | null;
  flightDate: string | null;
  method: string;
  createdAt: string;
  zoneCount: number;
  zones: Array<{ areaHa: string | null; colorHex: string | null; zoneLabel: string | null }>;
}

const DRONE_CAMERA_OPTIONS = [
  { value: "dji_p4m",     label: "DJI P4 Multispectral (5 bandas: Blue, Green, Red, RedEdge, NIR)" },
  { value: "dji_mavic3m", label: "DJI Mavic 3 Multispectral (4 bandas: Green, Red, RedEdge, NIR)" },
  { value: "dji_phantom4",label: "DJI Phantom 4 RTK + MicaSense RedEdge-MX (5 bandas)" },
  { value: "generic",     label: "Genérico — especificar bandas manualmente" },
  { value: "precalculated", label: "Índice pre-calculado (1 banda = valor del índice)" },
];

const DRONE_INDEX_OPTIONS = [
  { value: "ndvi",  label: "NDVI — Vigor vegetativo", needs: ["red", "nir"] },
  { value: "ndre",  label: "NDRE — Estado nitrogenado", needs: ["nir", "rededge"] },
  { value: "ndmi",  label: "NDMI — Humedad foliar", needs: ["nir", "rededge"] },
  { value: "evi",   label: "EVI — Vigor mejorado", needs: ["red", "nir", "blue"] },
  { value: "gndvi", label: "GNDVI — Clorofila / verdor", needs: ["green", "nir"] },
  { value: "msavi", label: "MSAVI — Vigor con suelo desnudo", needs: ["red", "nir"] },
];

const DRONE_METHOD_OPTIONS = [
  { value: "spatial_kmeans", label: "K-means espacial (recomendado)" },
  { value: "jenks",          label: "Cortes naturales (Jenks)" },
  { value: "quantiles",      label: "Cuantiles" },
  { value: "fuzzy",          label: "Fuzzy C-means" },
];

const DRONE_ZONE_COLORS = ["#d73027", "#fdae61", "#1a9850", "#2166ac", "#762a83", "#b35806"];

function DroneMvzContent({
  parcelId,
  droneZoneSets,
  onRefresh,
}: {
  parcelId: string;
  droneZoneSets: DroneZoneSet[];
  onRefresh: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [cameraType, setCameraType] = useState("dji_p4m");
  const [indexType, setIndexType] = useState("ndvi");
  const [nZones, setNZones] = useState(3);
  const [method, setMethod] = useState("spatial_kmeans");
  const [redBand, setRedBand] = useState("3");
  const [nirBand, setNirBand] = useState("5");
  const [rededgeBand, setRededgeBand] = useState("4");
  const [greenBand, setGreenBand] = useState("2");
  const [blueBand, setBlueBand] = useState("1");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isGeneric = cameraType === "generic";
  const isPrecalculated = cameraType === "precalculated" || indexType === "precalculated";

  async function handleUpload() {
    if (!file) return;
    setIsUploading(true);
    setUploadError(null);
    setUploadProgress("Subiendo GeoTIFF al servidor…");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("camera_type", cameraType);
      formData.append("index_type", isPrecalculated ? "precalculated" : indexType);
      formData.append("n_zones", String(nZones));
      formData.append("method", method);
      if (isGeneric) {
        formData.append("red_band", redBand);
        formData.append("nir_band", nirBand);
        formData.append("rededge_band", rededgeBand);
        formData.append("green_band", greenBand);
        formData.append("blue_band", blueBand);
      }

      setUploadProgress("Calculando índice y generando zonas… (puede tardar 1-2 min según tamaño del archivo)");
      const resp = await fetch(`/api/parcels/${parcelId}/zones/from-drone`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data.message ?? "Error desconocido");

      setUploadProgress(null);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      onRefresh();
    } catch (err: any) {
      setUploadError(err.message ?? "Error al procesar el archivo");
      setUploadProgress(null);
    } finally {
      setIsUploading(false);
    }
  }

  async function handleDelete(zoneSetId: string) {
    setDeletingId(zoneSetId);
    try {
      await fetch(`/api/parcels/${parcelId}/drone-zone-sets/${zoneSetId}`, {
        method: "DELETE",
        credentials: "include",
      });
      onRefresh();
    } finally {
      setDeletingId(null);
    }
  }

  const methodLabel: Record<string, string> = {
    spatial_kmeans: "K-means",
    jenks: "Jenks",
    quantiles: "Cuantiles",
    fuzzy: "Fuzzy C-means",
  };

  const cameraLabel: Record<string, string> = {
    dji_p4m: "DJI P4M",
    dji_mavic3m: "Mavic 3M",
    dji_phantom4: "P4 RTK + MicaSense",
    generic: "Genérico",
    precalculated: "Pre-calculado",
  };

  return (
    <div className="space-y-5">
      {/* ── Info callout ── */}
      <div className="rounded-lg border border-sky-200 bg-sky-50/60 px-4 py-3 text-xs text-sky-800 flex items-start gap-2" data-testid="callout-drone-mvz">
        <Plane className="w-4 h-4 shrink-0 mt-0.5 text-sky-600" />
        <div>
          <span className="font-semibold">¿Cómo funciona?</span> Sube el ortomosaico GeoTIFF multispectral exportado desde <strong>DJI Terra</strong>, Pix4D o Agisoft Metashape. La plataforma extrae el índice seleccionado de las bandas espectrales y genera zonas de manejo usando el mismo algoritmo que el módulo satelital. Compatible con DJI P4 Multispectral, DJI Mavic 3 Multispectral y cámaras genéricas.
        </div>
      </div>

      {/* ── Upload form ── */}
      <Card data-testid="card-drone-mvz-upload">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Upload className="w-4 h-4 text-sky-600" /> Nueva zonificación desde imagen de dron
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* File selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Archivo GeoTIFF (.tif)</label>
            <div
              className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                file ? "border-sky-400 bg-sky-50" : "border-border hover:border-sky-300 hover:bg-sky-50/40"
              }`}
              onClick={() => fileInputRef.current?.click()}
              data-testid="drop-zone-drone-geotiff"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".tif,.tiff"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f);
                  setUploadError(null);
                }}
                data-testid="input-drone-geotiff"
              />
              {file ? (
                <div className="space-y-1">
                  <Plane className="w-6 h-6 mx-auto text-sky-500" />
                  <p className="text-sm font-medium text-sky-700">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB — haz clic para cambiar</p>
                </div>
              ) : (
                <div className="space-y-1">
                  <Upload className="w-8 h-8 mx-auto text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">Haz clic para seleccionar el ortomosaico GeoTIFF</p>
                  <p className="text-xs text-muted-foreground/60">Máx. 500 MB · Exportar georreferenciado desde DJI Terra</p>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Camera type */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Tipo de cámara / drone</label>
              <select
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                value={cameraType}
                onChange={(e) => setCameraType(e.target.value)}
                data-testid="select-drone-camera"
              >
                {DRONE_CAMERA_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            {/* Index type */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Índice a calcular</label>
              <select
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                value={isPrecalculated ? "precalculated" : indexType}
                onChange={(e) => setIndexType(e.target.value)}
                disabled={isPrecalculated && cameraType === "precalculated"}
                data-testid="select-drone-index"
              >
                {!isPrecalculated && DRONE_INDEX_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
                {isPrecalculated && <option value="precalculated">Índice pre-calculado (1 banda)</option>}
              </select>
            </div>
          </div>

          {/* Generic band mapping */}
          {isGeneric && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3 space-y-3" data-testid="section-generic-bands">
              <p className="text-xs font-semibold text-amber-800">Mapeo de bandas (número de banda en el GeoTIFF)</p>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {[
                  { label: "Red", value: redBand, setter: setRedBand, testId: "input-band-red" },
                  { label: "NIR", value: nirBand, setter: setNirBand, testId: "input-band-nir" },
                  { label: "RedEdge", value: rededgeBand, setter: setRededgeBand, testId: "input-band-rededge" },
                  { label: "Green", value: greenBand, setter: setGreenBand, testId: "input-band-green" },
                  { label: "Blue", value: blueBand, setter: setBlueBand, testId: "input-band-blue" },
                ].map(({ label, value, setter, testId }) => (
                  <div key={label} className="space-y-0.5">
                    <label className="text-[10px] font-medium text-amber-700">{label}</label>
                    <input
                      type="number"
                      min="1"
                      max="20"
                      className="w-full border rounded px-2 py-1 text-sm bg-background"
                      value={value}
                      onChange={(e) => setter(e.target.value)}
                      data-testid={testId}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* N zones */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Número de zonas ({nZones})</label>
              <input
                type="range"
                min={2}
                max={6}
                value={nZones}
                onChange={(e) => setNZones(Number(e.target.value))}
                className="w-full accent-sky-600"
                data-testid="range-drone-nzones"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>2</span><span>3</span><span>4</span><span>5</span><span>6</span>
              </div>
            </div>

            {/* Method */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Método de clasificación</label>
              <select
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                data-testid="select-drone-method"
              >
                {DRONE_METHOD_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          {uploadError && (
            <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700" data-testid="alert-drone-upload-error">
              {uploadError}
            </div>
          )}

          {uploadProgress && (
            <div className="rounded-md bg-sky-50 border border-sky-200 px-3 py-2 text-xs text-sky-700 flex items-center gap-2" data-testid="status-drone-upload">
              <Loader2 className="w-3 h-3 animate-spin" />
              {uploadProgress}
            </div>
          )}

          <Button
            className="w-full bg-sky-600 hover:bg-sky-700"
            disabled={!file || isUploading}
            onClick={handleUpload}
            data-testid="btn-drone-generate-zones"
          >
            {isUploading ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Procesando…</>
            ) : (
              <><Plane className="w-4 h-4 mr-2" /> Generar zonas desde imagen de dron</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* ── Existing drone zone sets ── */}
      {droneZoneSets.length === 0 ? (
        <Card className="border-dashed border-sky-200" data-testid="card-drone-zones-empty">
          <CardContent className="py-10 text-center">
            <Plane className="w-10 h-10 mx-auto mb-3 text-muted-foreground/25" />
            <h3 className="text-sm font-medium mb-1">Sin zonificaciones de dron</h3>
            <p className="text-xs text-muted-foreground max-w-xs mx-auto">
              Sube un ortomosaico GeoTIFF multispectral de tu vuelo para generar zonas de manejo diferenciado.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3" data-testid="list-drone-zone-sets">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Zonificaciones generadas</p>
          {droneZoneSets.map((s) => {
            const totalHa = s.zones.reduce((acc, z) => acc + parseFloat(z.areaHa ?? "0"), 0);
            return (
              <Card key={s.zoneSetId} className="hover:shadow-md transition-shadow" data-testid={`card-drone-set-${s.zoneSetId}`}>
                <CardContent className="py-4 px-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className="bg-sky-100 text-sky-800 border-sky-300 text-xs" data-testid={`badge-drone-index-${s.zoneSetId}`}>
                          {(s.indexType ?? "ndvi").toUpperCase()}
                        </Badge>
                        <Badge variant="outline" className="text-xs">{cameraLabel[s.cameraType] ?? s.cameraType}</Badge>
                        <Badge variant="outline" className="text-xs">{methodLabel[s.method] ?? s.method}</Badge>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span data-testid={`text-drone-zones-${s.zoneSetId}`}>{s.zoneCount} zona{s.zoneCount !== 1 ? "s" : ""}</span>
                        {totalHa > 0 && <span>{totalHa.toFixed(1)} ha</span>}
                        {s.filename && <span className="truncate max-w-[120px]" title={s.filename}>{s.filename}</span>}
                      </div>
                      {/* Zone swatches */}
                      <div className="flex items-center gap-1 flex-wrap">
                        {s.zones.map((z, zi) => (
                          <div key={zi} className="flex items-center gap-1">
                            <span className="w-3 h-3 rounded-sm inline-block border border-white shadow-sm" style={{ background: z.colorHex ?? DRONE_ZONE_COLORS[zi % DRONE_ZONE_COLORS.length] }} />
                            <span className="text-[10px] text-muted-foreground">{z.zoneLabel ?? `Z${zi + 1}`}</span>
                          </div>
                        ))}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Generado {new Date(s.createdAt).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <Link href={`/parcel/${parcelId}/drone-zones/${s.zoneSetId}`}>
                        <Button variant="outline" size="sm" className="w-full border-sky-200 text-sky-700 hover:bg-sky-50" data-testid={`btn-drone-set-view-${s.zoneSetId}`}>
                          Ver zonas
                        </Button>
                      </Link>
                      <Link href={`/parcel/${parcelId}/prescription?zoneSet=${s.zoneSetId}&source=drone`}>
                        <Button variant="outline" size="sm" className="w-full border-purple-200 text-purple-700 hover:bg-purple-50" data-testid={`btn-drone-set-prescribe-${s.zoneSetId}`}>
                          Prescripción
                        </Button>
                      </Link>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full text-red-500 hover:text-red-600 hover:bg-red-50"
                        disabled={deletingId === s.zoneSetId}
                        onClick={() => handleDelete(s.zoneSetId)}
                        data-testid={`btn-drone-set-delete-${s.zoneSetId}`}
                      >
                        {deletingId === s.zoneSetId ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Market Price Widget (SNIIM + Banxico) ────────────────────────────────────
function MarketPriceWidget({ parcelId, crop, estimatedMarginPerHa }: { parcelId: string; crop?: string; estimatedMarginPerHa?: number | null }) {
  const { data, isLoading } = useQuery({
    queryKey: ["market-prices", parcelId],
    queryFn: async () => {
      const res = await fetch(`/api/parcels/${parcelId}/market-prices`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json() as Promise<{
        sniim: { crop: string; price: number; unit: string; plaza: string; state: string; date: string } | null;
        exchange: { usdMxn: number; date: string } | null;
        parcelCrop: string;
        parcelState: string;
        supportedCrops: string[];
        cachedAt: string;
      }>;
    },
    staleTime: 1000 * 60 * 30, // 30 min client-side stale
    retry: 1,
  });

  if (isLoading) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Consultando precio de mercado...
        </CardContent>
      </Card>
    );
  }

  const sniim = data?.sniim;
  const exchange = data?.exchange;
  const supported = data?.supportedCrops ?? [];
  const cropLower = (crop || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const isCropSupported = supported.some(c => c.includes(cropLower) || cropLower.includes(c));

  if (!sniim && !exchange) {
    if (!isCropSupported && crop) {
      return null; // Silently hide for unsupported crops
    }
    return (
      <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
        <CardContent className="py-3 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
          <TrendingUp className="w-4 h-4 flex-shrink-0" />
          <span>Precio de mercado no disponible en este momento. Los datos se actualizan cada 6 h.</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/20">
      <CardContent className="py-3 px-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
            <span className="text-sm font-medium text-emerald-800 dark:text-emerald-300">Precio de mercado hoy</span>
            <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-700 dark:text-emerald-400">SNIIM</Badge>
          </div>
          {exchange && (
            <span className="text-xs text-muted-foreground">
              USD/MXN: <span className="font-mono font-medium">${exchange.usdMxn.toFixed(2)}</span>
              <span className="ml-1 opacity-70">· {exchange.date}</span>
            </span>
          )}
        </div>
        {sniim ? (
          <div className="mt-2 flex flex-wrap items-baseline gap-3">
            <span className="text-2xl font-mono font-bold text-emerald-700 dark:text-emerald-300" data-testid="market-price-sniim">
              ${sniim.price.toLocaleString("es-MX")}
            </span>
            <span className="text-sm text-muted-foreground">{sniim.unit}</span>
            {exchange && (
              <span className="text-sm text-muted-foreground">
                ≈ <span className="font-mono">${(sniim.price / exchange.usdMxn).toFixed(0)} USD/ton</span>
              </span>
            )}
            <div className="w-full flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
              <span className="font-medium">{sniim.crop}</span>
              <span>·</span>
              <span>Plaza: {sniim.plaza}</span>
              <span>·</span>
              <span>{sniim.date}</span>
            </div>
            {estimatedMarginPerHa != null && (
              <div className="w-full flex items-center gap-2 text-xs mt-2 pt-2 border-t border-emerald-200/60 dark:border-emerald-800/60">
                <DollarSign className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                <span className="text-muted-foreground">Margen bruto estimado con tus costos:</span>
                <span className={`font-mono font-semibold ${estimatedMarginPerHa >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600"}`}>
                  {estimatedMarginPerHa >= 0 ? "+" : ""}${Math.abs(estimatedMarginPerHa).toLocaleString("es-AR", { maximumFractionDigits: 0 })} MXN/ha
                </span>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-1.5 text-sm text-muted-foreground">
            {isCropSupported ? "Sin datos SNIIM disponibles para este cultivo hoy." : `Cultivo "${crop}" no está en el catálogo SNIIM (granos básicos).`}
            {exchange && <span> Tipo de cambio disponible.</span>}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── International commodity benchmarks panel ────────────────────────────────

type RefSource = "worldbank" | "imf" | null;
type FuturesSource = "nasdaq" | "stooq" | "yahoo" | null;

interface CommodityBenchmark {
  crop: string;
  worldBankPrice: number | null;
  worldBankDate: string | null;
  worldBankSource: RefSource;
  cmeFuturePrice: number | null;
  cmeFutureDate: string | null;
  cmeFutureSource: FuturesSource;
  unit: "USD/ton";
}

function InternationalBenchmarkPanel({
  crop,
  targetPriceUsd,
}: {
  crop?: string;
  targetPriceUsd?: number | null;
}) {
  const [open, setOpen] = useState(true);
  const { data, isLoading } = useQuery({
    queryKey: ["international-prices", crop ?? "all"],
    queryFn: async () => {
      const params = crop ? `?crop=${encodeURIComponent(crop)}` : "";
      const res = await fetch(`/api/market/international${params}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json() as Promise<{
        benchmarks: CommodityBenchmark[];
        supportedCrops: string[];
        fetchedAt: string;
      }>;
    },
    staleTime: 1000 * 60 * 60 * 4, // 4 h client-side stale
    retry: 1,
  });

  if (isLoading) {
    return (
      <Card className="border-blue-200 dark:border-blue-800">
        <CardContent className="py-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Consultando precios internacionales…
        </CardContent>
      </Card>
    );
  }

  if (!data || !data.benchmarks || data.benchmarks.every(b => b.worldBankPrice == null && b.cmeFuturePrice == null)) {
    return null;
  }

  const benchmarks = data.benchmarks;

  // Canonical alias map: resolves crop names (including "Soja") to benchmark labels
  const PANEL_CROP_ALIASES: Record<string, string> = {
    maiz: "Maíz", maize: "Maíz", corn: "Maíz",
    soja: "Soya", soya: "Soya", soybean: "Soya", soybeans: "Soya",
    trigo: "Trigo", wheat: "Trigo",
  };
  function canonicalizeCrop(s: string): string {
    const a: Record<string,string> = {á:"a",é:"e",í:"i",ó:"o",ú:"u"};
    const key = s.toLowerCase().replace(/[áéíóú]/g, (c) => a[c] ?? c);
    for (const [alias, label] of Object.entries(PANEL_CROP_ALIASES)) {
      if (key.includes(alias)) return label;
    }
    return s;
  }
  const matchedBenchmark = crop
    ? benchmarks.find(b => b.crop === canonicalizeCrop(crop))
    : null;

  function PriceRelativeIndicator({ userPrice, refPrice, label }: { userPrice: number; refPrice: number; label: string }) {
    const pct = ((userPrice - refPrice) / refPrice) * 100;
    const isAbove = pct >= 0;
    return (
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">{label}:</span>
        <span className={`font-semibold font-mono ${isAbove ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
          {isAbove ? "+" : ""}{pct.toFixed(1)}%
        </span>
        <span className="text-muted-foreground">{isAbove ? "sobre" : "bajo"} referencia</span>
      </div>
    );
  }

  return (
    <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-950/20" data-testid="card-international-benchmark">
      <CardHeader className="pb-2 cursor-pointer" onClick={() => setOpen(o => !o)}>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-blue-800 dark:text-blue-300">
            <ArrowUpRight className="w-4 h-4" />
            Contexto Internacional
            <Badge variant="outline" className="text-[10px] border-blue-300 text-blue-700 dark:text-blue-400">
              {(() => {
                const refLabel = benchmarks.some(b => b.worldBankSource === "worldbank") ? "Banco Mundial" : benchmarks.some(b => b.worldBankSource === "imf") ? "FMI" : null;
                const cmeLabel = benchmarks.some(b => b.cmeFutureSource === "nasdaq") ? "CME CBOT" : benchmarks.some(b => b.cmeFutureSource) ? "CBOT" : null;
                return [refLabel, cmeLabel].filter(Boolean).join(" · ") || "Precios internacionales";
              })()}
            </Badge>
          </CardTitle>
          <span className="text-xs text-muted-foreground select-none">{open ? "▲" : "▼"}</span>
        </div>
        {!open && (
          <p className="text-xs text-muted-foreground mt-0.5">Precios de referencia mundiales para granos básicos</p>
        )}
      </CardHeader>

      {open && (
        <CardContent className="space-y-4">
          {matchedBenchmark && targetPriceUsd != null && (
            <div className="rounded-lg border border-blue-200 dark:border-blue-700 p-3 bg-white/60 dark:bg-blue-950/30 space-y-1.5" data-testid="section-price-comparison">
              <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-1">
                Tu precio objetivo vs. referencia internacional ({matchedBenchmark.crop})
              </p>
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-xl font-mono font-bold text-blue-700 dark:text-blue-300">
                  ${targetPriceUsd.toLocaleString("es-MX", { maximumFractionDigits: 0 })} USD/ton
                </span>
                <span className="text-xs text-muted-foreground">precio objetivo</span>
              </div>
              {matchedBenchmark.worldBankPrice != null && (
                <PriceRelativeIndicator
                  userPrice={targetPriceUsd}
                  refPrice={matchedBenchmark.worldBankPrice}
                  label={`vs ${matchedBenchmark.worldBankSource === "worldbank" ? "Banco Mundial" : matchedBenchmark.worldBankSource === "imf" ? "FMI" : "Referencia"}`}
                />
              )}
              {matchedBenchmark.cmeFuturePrice != null && (
                <PriceRelativeIndicator
                  userPrice={targetPriceUsd}
                  refPrice={matchedBenchmark.cmeFuturePrice}
                  label={`vs ${matchedBenchmark.cmeFutureSource === "nasdaq" ? "CME CBOT" : "Futuro CBOT"}`}
                />
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid="grid-benchmarks">
            {benchmarks.map(b => {
              const isMatch = matchedBenchmark?.crop === b.crop;
              return (
                <div
                  key={b.crop}
                  className={`rounded-lg border p-3 text-center space-y-1 ${isMatch ? "border-blue-400 bg-blue-50 dark:bg-blue-900/30 dark:border-blue-600" : "border-muted bg-background"}`}
                  data-testid={`benchmark-${b.crop.toLowerCase()}`}
                >
                  <p className="text-xs font-semibold text-muted-foreground">{b.crop}</p>
                  {b.worldBankPrice != null ? (
                    <div>
                      <p className="text-lg font-mono font-bold text-blue-700 dark:text-blue-300" data-testid={`wb-price-${b.crop.toLowerCase().replace(/[áéíóúü]/g, c => ({á:"a",é:"e",í:"i",ó:"o",ú:"u"})[c]??c)}`}>
                        ${b.worldBankPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {b.worldBankSource === "worldbank" ? "Banco Mundial" : b.worldBankSource === "imf" ? "FMI" : "Referencia"} · {b.worldBankDate ?? ""}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Ref: —</p>
                  )}
                  {b.cmeFuturePrice != null ? (
                    <div>
                      <p className="text-sm font-mono font-semibold text-indigo-600 dark:text-indigo-400" data-testid={`cme-price-${b.crop.toLowerCase().replace(/[áéíóúü]/g, c => ({á:"a",é:"e",í:"i",ó:"o",ú:"u"})[c]??c)}`}>
                        ${b.cmeFuturePrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {b.cmeFutureSource === "nasdaq" ? "CME CBOT" : "CBOT"} · {b.cmeFutureDate ?? ""}
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Futuro: —</p>
                  )}
                  <p className="text-[10px] text-muted-foreground">{b.unit}</p>
                </div>
              );
            })}
          </div>

          <p className="text-[10px] text-muted-foreground">
            {(() => {
              const refSrc = benchmarks.find(b => b.worldBankSource)?.worldBankSource;
              const cSrc = benchmarks.find(b => b.cmeFutureSource)?.cmeFutureSource;
              const parts: string[] = [];
              if (refSrc === "worldbank") parts.push("Banco Mundial (GEM Commodities)");
              else if (refSrc === "imf") parts.push("FMI (Primary Commodity Prices)");
              if (cSrc === "nasdaq") parts.push("Nasdaq Data Link / CME CBOT");
              else if (cSrc === "stooq") parts.push("Stooq / CBOT");
              else if (cSrc === "yahoo") parts.push("Yahoo Finance / CBOT");
              return `Precios actualizados una vez por día. ${parts.length > 0 ? "Fuentes: " + parts.join(" y ") + "." : ""} No constituyen asesoramiento de inversión.`;
            })()}
          </p>
        </CardContent>
      )}
    </Card>
  );
}

// ─── Historial de Ciclos ─────────────────────────────────────────────────────
function CycleHistorialSection({ parcelId }: { parcelId: string }) {
  const [, navigate] = useLocation();

  const { data: cycleData, isLoading } = useQuery({
    queryKey: ["cycle-detail", parcelId],
    queryFn: async () => {
      const res = await fetch(`/api/parcels/${parcelId}/cycle-detail`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 60_000,
  });

  const cycles: any[] = cycleData?.details ?? [];

  const seasonLabel = (s: string) =>
    s === "primavera-verano" ? "P-V" : s === "otono-invierno" ? "O-I" : s;

  const chartData = cycles
    .slice()
    .reverse()
    .map((c) => ({
      name: `${c.cycleYear} ${seasonLabel(c.cycleSeason)}`,
      esperado: c.expectedYieldTon != null ? Number(c.expectedYieldTon) : null,
      real: c.actualYieldTon != null ? Number(c.actualYieldTon) : null,
    }))
    .filter((d) => d.esperado != null || d.real != null);

  return (
    <Card data-testid="card-cycle-historial">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <History className="w-5 h-5 text-green-700" />
              Historial de Ciclos
            </CardTitle>
            <CardDescription>
              Registro de todos los ciclos de cultivo registrados para esta parcela.
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-green-700 border-green-300 hover:bg-green-50"
            onClick={() => navigate(`/parcel/${parcelId}/setup`)}
            data-testid="btn-nuevo-ciclo"
          >
            <Plus className="w-4 h-4" /> Nuevo Ciclo
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : cycles.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
            <Sprout className="w-10 h-10 mx-auto mb-2 opacity-25" />
            <p className="text-sm">Sin ciclos registrados todavía.</p>
            <Button
              variant="link"
              size="sm"
              className="mt-1 text-green-700"
              onClick={() => navigate(`/parcel/${parcelId}/setup`)}
            >
              Configurar primer ciclo →
            </Button>
          </div>
        ) : (
          <>
            {/* Compact cycle cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {cycles.map((c, idx) => {
                const isLatest = idx === 0;
                return (
                <div
                  key={c.id}
                  className="rounded-lg border p-3 space-y-1.5 hover:shadow-sm transition-shadow"
                  data-testid={`card-cycle-${c.id}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 font-mono bg-green-50 border-green-300 text-green-800"
                        data-testid={`badge-cycle-season-${c.id}`}
                      >
                        {c.cycleYear} · {seasonLabel(c.cycleSeason)}
                      </Badge>
                      {isLatest && (
                        <Badge
                          className="text-[10px] px-1.5 py-0 bg-green-600 text-white border-0"
                          data-testid={`badge-cycle-actual-${c.id}`}
                        >
                          Actual
                        </Badge>
                      )}
                      {c.variety && (
                        <span className="text-xs text-muted-foreground truncate max-w-[80px]" title={c.variety}>
                          {c.variety}
                        </span>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs text-muted-foreground hover:text-primary"
                      onClick={() => navigate(`/parcel/${parcelId}/setup?cycleId=${c.id}&step=0`)}
                      data-testid={`btn-edit-cycle-${c.id}`}
                    >
                      Editar
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-xs">
                    {c.expectedYieldTon != null && (
                      <span className="text-muted-foreground">
                        Esperado: <strong>{Number(c.expectedYieldTon).toFixed(1)} t/ha</strong>
                      </span>
                    )}
                    {c.actualYieldTon != null ? (
                      <span className="text-green-700">
                        Real: <strong>{Number(c.actualYieldTon).toFixed(1)} t/ha</strong>
                      </span>
                    ) : (
                      <span className="text-muted-foreground italic text-[10px]">Cierre pendiente</span>
                    )}
                    {c.targetPricePerTon != null && (
                      <span className="text-muted-foreground">
                        P. objetivo: <strong>${Number(c.targetPricePerTon).toLocaleString("es-MX")}/tn</strong>
                      </span>
                    )}
                    {c.actualPricePerTon != null && (
                      <span className="text-green-700">
                        P. real: <strong>${Number(c.actualPricePerTon).toLocaleString("es-MX")}/tn</strong>
                      </span>
                    )}
                    {c.totalPlannedCost != null && (
                      <span className="text-muted-foreground">
                        Costo: <strong>${Number(c.totalPlannedCost).toLocaleString("es-MX")}</strong>
                      </span>
                    )}
                    {c.saleChannel && (
                      <span className="text-muted-foreground truncate" title={c.saleChannel}>
                        Canal: <strong>{c.saleChannel}</strong>
                      </span>
                    )}
                  </div>
                </div>
              );
              })}
            </div>

            {/* Bar chart: Expected vs Real yield — only when >=2 cycles have real data */}
            {chartData.filter(d => d.real != null).length >= 2 && (
              <div className="pt-2">
                <p className="text-xs font-medium text-muted-foreground mb-2">Rendimiento por ciclo (t/ha)</p>
                <div className="h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: -16 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" fontSize={10} tickLine={false} axisLine={false} />
                      <YAxis fontSize={10} tickLine={false} axisLine={false} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "8px", fontSize: 12 }}
                        formatter={(v: number, name: string) => [`${v.toFixed(2)} t/ha`, name === "esperado" ? "Esperado" : "Real"]}
                      />
                      <Bar dataKey="esperado" name="esperado" fill="#86efac" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="real" name="real" fill="#16a34a" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
                  <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm inline-block bg-[#86efac]" /> Esperado</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm inline-block bg-[#16a34a]" /> Real</span>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function ParcelDetail() {
  const params = useParams();
  const [, navigate] = useLocation();
  const id = params?.id;
  const { user } = useAuth();
  const { isOnline: _isOnline } = useConnectivity();
  const [parcelCacheStatus, setParcelCacheStatus] = useState<{ isHit: boolean; cachedAt: string | null } | null>(null);
  const [selectedIndex, setSelectedIndex] = useState("ndvi");
  const [chartTimeRange, setChartTimeRange] = useState("6m");
  const [activeIndices, setActiveIndices] = useState<Set<string>>(
    new Set(["ndvi", "evi", "ndmi", "ndre", "gndvi", "msavi", "savi", "ndwi"])
  );
  const toggleIndex = (key: string) =>
    setActiveIndices(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size === 1) return prev; // keep at least 1 active
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  const [selectedSentinelDate, setSelectedSentinelDate] = useState<string>("latest");
  const [selectedDemType, setSelectedDemType] = useState<string>("elevation");
  const [selectedSoilAttribute, setSelectedSoilAttribute] = useState<string>("pH");

  const chartDateBounds = useMemo(() => {
    const end = new Date();
    let start: Date;
    switch (chartTimeRange) {
      case "3m":        { const d = new Date(); d.setMonth(d.getMonth() - 3); start = d; break; }
      case "1y":        { const d = new Date(); d.setFullYear(d.getFullYear() - 1); start = d; break; }
      case "2y":        { const d = new Date(); d.setFullYear(d.getFullYear() - 2); start = d; break; }
      case "5y":        { const d = new Date(); d.setFullYear(d.getFullYear() - 5); start = d; break; }
      case "10y":       { const d = new Date(); d.setFullYear(d.getFullYear() - 10); start = d; break; }
      case "since2015": start = new Date("2015-06-23"); break;
      default:          { const d = new Date(); d.setMonth(d.getMonth() - 6); start = d; }
    }
    return {
      startDate: start!.toISOString().split("T")[0],
      endDate:   end.toISOString().split("T")[0],
    };
  }, [chartTimeRange]);
  const [showFullscreenMap, setShowFullscreenMap] = useState(false);
  const [tileOpacity, setTileOpacity] = useState(0.75);
  const [activeTab, setActiveTabState] = useState(() => new URLSearchParams(window.location.search).get("tab") || "crop");
  const soilAssessmentDirty = useRef(false);
  const soilAssessmentBusy = useRef(false);
  const setActiveTab = (nextTab: string) => {
    if (nextTab === activeTab) return;
    if (soilAssessmentBusy.current) {
      window.alert("Espera a que termine la operación antes de cambiar de pestaña.");
      return;
    }
    if (soilAssessmentDirty.current && !window.confirm("Hay cambios sin guardar en la evaluación de campo. ¿Descartarlos y cambiar de pestaña?")) return;
    soilAssessmentDirty.current = false;
    setActiveTabState(nextTab);
  };
  const [editPolygonMode, setEditPolygonMode] = useState(false);
  const [pendingPolygonCoords, setPendingPolygonCoords] = useState<[number, number][] | null>(null);
  const [showDeletePolygonDialog, setShowDeletePolygonDialog] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get("tab");
    if (requestedTab) setActiveTab(requestedTab);
    if (params.get("editPolygon") === "true") {
      setEditPolygonMode(true);
      params.delete("editPolygon");
      window.history.replaceState({}, "", `${window.location.pathname}${params.size ? `?${params}` : ""}`);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (activeTab === "crop") params.delete("tab");
    else params.set("tab", activeTab);
    window.history.replaceState({}, "", `${window.location.pathname}${params.size ? `?${params}` : ""}`);
  }, [activeTab]);

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  useEffect(() => installHistoryGuard(() => {
    if (soilAssessmentBusy.current) {
      window.alert("Espera a que termine la operación antes de salir de la parcela.");
      return false;
    }
    if (soilAssessmentDirty.current && !window.confirm("Hay cambios sin guardar en la evaluación de campo. ¿Descartarlos y salir?")) return false;
    soilAssessmentDirty.current = false;
    return true;
  }), []);
  useEffect(() => {
    const interceptParcelNavigation = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin || destination.href === window.location.href) return;
      if (!soilAssessmentBusy.current && !soilAssessmentDirty.current) return;
      event.preventDefault();
      event.stopPropagation();
      if (soilAssessmentBusy.current) {
        window.alert("Espera a que termine la operación antes de salir de la parcela.");
        return;
      }
      if (!window.confirm("Hay cambios sin guardar en la evaluación de campo. ¿Descartarlos y salir?")) return;
      soilAssessmentDirty.current = false;
      navigateRef.current(`${destination.pathname}${destination.search}${destination.hash}`);
    };
    document.addEventListener("click", interceptParcelNavigation, true);
    return () => document.removeEventListener("click", interceptParcelNavigation, true);
  }, []);

  const TAB_CATEGORY_MAP: Record<string, string> = {
    crop: "campo", soil: "campo", biology: "campo", tillage: "campo", rotation: "campo", animals: "campo",
    fertilization: "nutricion", amendments: "nutricion", insumos: "nutricion",
    water: "agua", "smart-irrigation": "agua", "climate-risk": "agua",
    costs: "economia", livelihood: "economia",
    mvz: "precision", drones: "precision", iot: "precision",
    historial: "seguimiento", rendimiento: "seguimiento", fenologia: "seguimiento",
    assistant: "agente",
  };
  const activeCategory = TAB_CATEGORY_MAP[activeTab] ?? "campo";

  const { data: parcelData, isLoading: parcelLoading, error: parcelError } = useQuery({
    queryKey: ["parcel", id],
    queryFn: async () => {
      const response = await fetch(`/api/parcels/${id}`, {
        credentials: "include",
      });
      if (!response.ok) {
        if (response.status === 404) throw new Error("Lote no encontrado");
        throw new Error("Error al cargar lote");
      }
      const cacheHit = response.headers.get("X-Offline-Cache") === "hit";
      const cachedAt = response.headers.get("X-Offline-Cached-At");
      setParcelCacheStatus({ isHit: cacheHit, cachedAt });
      return response.json();
    },
    enabled: !!id,
  });

  const { data: timeSeriesData } = useQuery({
    queryKey: ["parcel-data", id],
    queryFn: async () => {
      const response = await fetch(`/api/parcels/${id}/data`, {
        credentials: "include",
      });
      if (!response.ok) return { data: [] };
      return response.json();
    },
    enabled: !!id,
  });

  const { data: setupProgress, isLoading: setupProgressLoading } = useQuery({
    queryKey: ["setup-progress", id],
    queryFn: async () => {
      const res = await fetch(`/api/parcels/${id}/setup-progress`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });

  const { data: alertsData } = useQuery({
    queryKey: ["parcel-alerts", id],
    queryFn: async () => {
      const response = await fetch(`/api/parcels/${id}/alerts`, {
        credentials: "include",
      });
      if (!response.ok) return { alerts: [] };
      return response.json();
    },
    enabled: !!id,
  });

  const { data: indicesData } = useQuery({
    queryKey: ["parcel-gee-indices", id],
    queryFn: async () => {
      const response = await fetch(`/api/parcels/${id}/indices?period=quarter`, {
        credentials: "include",
      });
      if (!response.ok) return { indices: [], source: "simulated" };
      return response.json();
    },
    enabled: !!id,
  });

  // Separate chart query driven by the user-selected time range.
  const { data: chartIndicesData, isLoading: chartIndicesLoading } = useQuery({
    queryKey: ["parcel-chart-indices", id, chartDateBounds.startDate, chartDateBounds.endDate],
    queryFn: async () => {
      const response = await fetch(
        `/api/parcels/${id}/indices?startDate=${chartDateBounds.startDate}&endDate=${chartDateBounds.endDate}`,
        { credentials: "include" },
      );
      if (!response.ok) return { indices: [], source: "simulated" };
      return response.json();
    },
    enabled: !!id,
  });

  const { data: geeStatus } = useQuery({
    queryKey: ["gee-status"],
    queryFn: async () => {
      const response = await fetch("/api/gee/status", { credentials: "include" });
      if (!response.ok) return { available: false, error: null };
      return response.json();
    },
  });

  const { data: indexTilesData } = useQuery({
    queryKey: ["parcel-index-tiles", id, selectedIndex, selectedSentinelDate],
    queryFn: async () => {
      const dateParam = selectedSentinelDate && selectedSentinelDate !== "latest" ? `&date=${selectedSentinelDate}` : "";
      const response = await fetch(`/api/parcels/${id}/index-tiles?index=${selectedIndex}${dateParam}`, {
        credentials: "include",
      });
      if (!response.ok) return { available: false };
      return response.json();
    },
    enabled: !!id && geeStatus?.available === true && selectedIndex !== "dem",
  });

  const { data: demTilesData, isFetching: demFetching } = useQuery({
    queryKey: ["parcel-dem-tiles", id, selectedDemType],
    queryFn: async () => {
      const response = await fetch(`/api/parcels/${id}/dem-tiles?type=${selectedDemType}`, {
        credentials: "include",
      });
      if (!response.ok) return { available: false };
      return response.json();
    },
    enabled: !!id && geeStatus?.available === true && selectedIndex === "dem",
    staleTime: 1000 * 60 * 60,
  });

  const { data: mexSoilData, isFetching: mexSoilFetching } = useQuery({
    queryKey: ["mexico-soil-samples", id, selectedSoilAttribute],
    queryFn: async () => {
      const parcel = parcelData?.parcel;
      if (!parcel) return { type: "FeatureCollection", features: [] };
      const lat = parseFloat(parcel.latitude);
      const lng = parseFloat(parcel.longitude);
      const response = await fetch(
        `/api/mexico-soil-samples?lat=${lat}&lng=${lng}&radiusKm=120`,
        { credentials: "include" },
      );
      if (!response.ok) return { type: "FeatureCollection", features: [] };
      return response.json();
    },
    enabled: !!id && selectedIndex === "mx-soil" && !!parcelData?.parcel,
    staleTime: 1000 * 60 * 60 * 24,
  });

  const { data: sentinelImagesData } = useQuery({
    queryKey: ["sentinel-images", id],
    queryFn: async () => {
      const response = await fetch(`/api/parcels/${id}/sentinel-images?months=3`, {
        credentials: "include",
      });
      if (!response.ok) return { images: [], source: "simulated" };
      return response.json();
    },
    enabled: !!id,
  });

  const { data: soilAnalysisData, isLoading: soilLoading } = useQuery({
    queryKey: ["soil-analysis", id],
    queryFn: async () => {
      const response = await fetch(`/api/parcels/${id}/soil-analysis`, {
        credentials: "include",
      });
      if (!response.ok) return { analyses: [] };
      return response.json();
    },
    enabled: !!id,
  });

  const queryClient = useQueryClient();

  const updatePolygonMutation = useMutation({
    mutationFn: async (coordinates: [number, number][]) => {
      const res = await fetch(`/api/parcels/${id}/polygon`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ coordinates }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Error al guardar el polígono");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["parcel", id] });
      setEditPolygonMode(false);
      setPendingPolygonCoords(null);
    },
  });

  const deletePolygonMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/parcels/${id}/polygon`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Error al eliminar el polígono");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["parcel", id] });
      setShowDeletePolygonDialog(false);
    },
  });

  const [showSoilModal, setShowSoilModal] = useState(false);
  const initialSoilForm = {
    analysisDate: mexicoDateKey(new Date()),
    labName: "",
    // Organic matter & carbon
    organicMatter: "",
    totalCarbon: "",
    // Macronutrients
    nitrogenTotal: "",
    nitrogenInorganic: "",
    phosphorus: "",
    potassium: "",
    calcium: "",
    magnesium: "",
    sulfur: "",
    // Micronutrients
    iron: "",
    zinc: "",
    manganese: "",
    copper: "",
    boron: "",
    // Physico-chemical
    ph: "",
    electricConductivity: "",
    cec: "",
    // Texture
    sand: "",
    silt: "",
    clay: "",
    notes: "",
  };
  const [soilFormData, setSoilFormData] = useState(initialSoilForm);

  const soilMutation = useMutation({
    mutationFn: async (data: typeof soilFormData) => {
      const response = await fetch(`/api/parcels/${id}/soil-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...data,
          nitrogenTotal: data.nitrogenTotal.trim() === "" ? null : data.nitrogenTotal,
        }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || error.error || "Error al guardar análisis");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["soil-analysis", id] });
      queryClient.invalidateQueries({ queryKey: ["parcel-alerts", id] });
      setShowSoilModal(false);
      setSoilFormData({ ...initialSoilForm, analysisDate: mexicoDateKey(new Date()) });
    },
  });

  const soilMergeMutation = useMutation({
    mutationFn: async ({ keepId, duplicateId }: { keepId: string; duplicateId: string }) => {
      const response = await fetch(`/api/parcels/${id}/soil-analysis/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ keepId, duplicateId }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || error.error || "No se pudieron fusionar los análisis");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["soil-analysis", id] });
      queryClient.invalidateQueries({ queryKey: ["parcel-alerts", id] });
    },
  });

  const clearUnreportedSoilN = useMutation({
    mutationFn: async (analysis: SoilAnalysis) => {
      const response = await fetch(`/api/parcels/${id}/soil-analysis/report-repairs`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysisId: analysis.id, clearUnreportedTotalN: true,
          before: { nitrogenTotal: analysis.nitrogenTotal, nitrogenInorganic: analysis.nitrogenInorganic } }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "No se pudo dejar N total vacío");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["soil-analysis", id] });
      queryClient.invalidateQueries({ queryKey: ["parcel-alerts", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/parcels", id, "soil-analysis", "report-repairs"] });
    },
  });

  const deleteSoilAnalysisMutation = useMutation({
    mutationFn: async (analysisId: string) => {
      const response = await fetch(`/api/soil-analysis/${analysisId}`, { method: "DELETE", credentials: "include" });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || error.error || "No se pudo eliminar el análisis");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["soil-analysis", id] });
      queryClient.invalidateQueries({ queryKey: ["parcel-alerts", id] });
    },
  });

  // Water Analysis state
  const { data: waterAnalysisData, refetch: refetchWater } = useQuery({
    queryKey: ["water-analysis", id],
    queryFn: async () => {
      const response = await fetch(`/api/parcels/${id}/water-analysis`, { credentials: "include" });
      if (!response.ok) return { analyses: [] };
      return response.json();
    },
    enabled: !!id,
  });

  const [showWaterModal, setShowWaterModal] = useState(false);
  const initialWaterForm = {
    analysisDate: mexicoDateKey(new Date()),
    source: "",
    labName: "",
    ph: "",
    electricConductivity: "",
    tds: "",
    hardness: "",
    sar: "",
    rsc: "",
    sodium: "",
    calcium: "",
    magnesium: "",
    bicarbonates: "",
    carbonates: "",
    chlorides: "",
    sulfates: "",
    boron: "",
    nitrates: "",
    notes: "",
  };
  const [waterFormData, setWaterFormData] = useState(initialWaterForm);

  const waterMutation = useMutation({
    mutationFn: async (data: typeof waterFormData) => {
      const response = await fetch(`/api/parcels/${id}/water-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Error al guardar análisis de agua");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["water-analysis", id] });
      queryClient.invalidateQueries({ queryKey: ["parcel-alerts", id] });
      setShowWaterModal(false);
      setWaterFormData({ ...initialWaterForm, analysisDate: mexicoDateKey(new Date()) });
    },
  });

  const deleteWaterMutation = useMutation({
    mutationFn: async (analysisId: string) => {
      const response = await fetch(`/api/parcels/${id}/water-analysis/${analysisId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Error al eliminar análisis");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["water-analysis", id] });
    },
  });

  // Water quality classification (FAO 29)
  const getWaterQuality = (analysis: any): { label: string; color: string; bg: string } => {
    const ec = analysis.electricConductivity ? parseFloat(analysis.electricConductivity) : null;
    const sar = analysis.sar ? parseFloat(analysis.sar) : null;
    const ph = analysis.ph ? parseFloat(analysis.ph) : null;
    const cl = analysis.chlorides ? parseFloat(analysis.chlorides) : null;
    if (
      (ec !== null && ec > 3) || (sar !== null && sar > 10) ||
      (ph !== null && (ph < 5.5 || ph > 9)) || (cl !== null && cl > 700)
    ) return { label: "No Apta", color: "text-red-700", bg: "bg-red-100 border-red-200" };
    if (
      (ec !== null && ec > 2) || (sar !== null && sar > 7) ||
      (ph !== null && (ph < 6.0 || ph > 8.5)) || (cl !== null && cl > 350)
    ) return { label: "Deficiente", color: "text-orange-700", bg: "bg-orange-100 border-orange-200" };
    if (
      (ec !== null && ec > 1) || (sar !== null && sar > 4) ||
      (ph !== null && (ph < 6.5 || ph > 8.0))
    ) return { label: "Marginal", color: "text-yellow-700", bg: "bg-yellow-100 border-yellow-200" };
    if (ec !== null || sar !== null || ph !== null) {
      if ((ec === null || ec <= 0.7) && (sar === null || sar <= 3) && (ph === null || (ph >= 6.5 && ph <= 8.0))) {
        return { label: "Excelente", color: "text-green-700", bg: "bg-green-100 border-green-200" };
      }
      return { label: "Buena", color: "text-teal-700", bg: "bg-teal-100 border-teal-200" };
    }
    return { label: "Sin clasificar", color: "text-muted-foreground", bg: "bg-secondary/30" };
  };

  // Tillage data
  const { data: tillageData, isLoading: tillageLoading } = useQuery({
    queryKey: ["tillage", id],
    queryFn: async () => {
      const response = await fetch(`/api/parcels/${id}/tillage`, { credentials: "include" });
      if (!response.ok) return { tillage: [] };
      return response.json();
    },
    enabled: !!id,
  });

  const [showTillageModal, setShowTillageModal] = useState(false);
  const [tillageFormData, setTillageFormData] = useState({
    cycleYear: new Date().getFullYear(),
    cycleSeason: "primavera-verano",
    desvaradora: 0, barbecho: 0, rastra: 0, siembra: 0, cosechadora: 0,
    yearsReducingTillage: 0,
    burnsResidues: false,
    residuePercentLeft: 50,
  });

  const tillageMutation = useMutation({
    mutationFn: async (data: typeof tillageFormData) => {
      const response = await fetch(`/api/parcels/${id}/tillage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Error al guardar labranza");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tillage", id] });
      queryClient.invalidateQueries({ queryKey: ["regenerative-metrics", id] });
      setShowTillageModal(false);
    },
  });

  // Crop rotation data
  const { data: rotationData, isLoading: rotationLoading } = useQuery({
    queryKey: ["rotation", id],
    queryFn: async () => {
      const response = await fetch(`/api/parcels/${id}/rotation`, { credentials: "include" });
      if (!response.ok) return { rotation: [] };
      return response.json();
    },
    enabled: !!id,
  });

  const [showRotationModal, setShowRotationModal] = useState(false);
  const [rotationFormData, setRotationFormData] = useState({
    year: new Date().getFullYear(),
    springCrops: "",
    fallCrops: "",
    rotationSystem: "",
  });

  const rotationMutation = useMutation({
    mutationFn: async (data: typeof rotationFormData) => {
      const response = await fetch(`/api/parcels/${id}/rotation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Error al guardar rotación");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rotation", id] });
      queryClient.invalidateQueries({ queryKey: ["regenerative-metrics", id] });
      setShowRotationModal(false);
    },
  });

  // Animal integration data
  const { data: animalsData, isLoading: animalsLoading } = useQuery({
    queryKey: ["animals", id],
    queryFn: async () => {
      const response = await fetch(`/api/parcels/${id}/animals`, { credentials: "include" });
      if (!response.ok) return { animals: null };
      return response.json();
    },
    enabled: !!id,
  });

  const [showAnimalsModal, setShowAnimalsModal] = useState(false);
  const [animalsFormData, setAnimalsFormData] = useState({
    hasBovinos: false, bovinosCount: 0,
    hasOvinos: false, ovinosCount: 0,
    hasAves: false, avesCount: 0,
    hasCaprinos: false, caprinosCount: 0,
    hasPorcinos: false, porcinosCount: 0,
    hasEquinos: false, equinosCount: 0,
    otherAnimals: "", otherAnimalsCount: 0,
    grazingSystem: "",
    grazingSystemDetails: "",
    numberOfLots: 0,
    restDays: 0,
    animalLoadPerHa: "",
    manureUse: [] as string[],
    compostType: [] as string[],
    compostMaterials: [] as string[],
  });

  const animalsMutation = useMutation({
    mutationFn: async (data: typeof animalsFormData) => {
      const response = await fetch(`/api/parcels/${id}/animals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Error al guardar animales");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["animals", id] });
      queryClient.invalidateQueries({ queryKey: ["regenerative-metrics", id] });
      setShowAnimalsModal(false);
    },
  });

  // Livelihood data
  const { data: livelihoodData, isLoading: livelihoodLoading } = useQuery({
    queryKey: ["livelihood", id],
    queryFn: async () => {
      const response = await fetch(`/api/parcels/${id}/livelihood`, { credentials: "include" });
      if (!response.ok) return { livelihood: null };
      return response.json();
    },
    enabled: !!id,
  });

  const [showLivelihoodModal, setShowLivelihoodModal] = useState(false);
  const [livelihoodFormData, setLivelihoodFormData] = useState({
    incomeAgricultural: 0,
    incomeAnimal: 0,
    incomeNonAgricultural: 0,
    incomeRemittances: 0,
    sellsToConsumers: false,
    sellsToIntermediaries: false,
    sellsToCooperatives: false,
  });

  const livelihoodMutation = useMutation({
    mutationFn: async (data: typeof livelihoodFormData) => {
      const response = await fetch(`/api/parcels/${id}/livelihood`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Error al guardar comercialización");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["livelihood", id] });
      queryClient.invalidateQueries({ queryKey: ["regenerative-metrics", id] });
      setShowLivelihoodModal(false);
    },
  });

  const [showCostsModal, setShowCostsModal] = useState(false);
  const [faoOpen, setFaoOpen] = useState(false);
  const [costsFormData, setCostsFormData] = useState({
    cycleYear: new Date().getFullYear(),
    cycleSeason: "primavera-verano",
    category: "semillas",
    concept: "",
    unit: "",
    quantity: "",
    unitCost: "",
    totalCost: "",
    notes: "",
  });

  const costsMutation = useMutation({
    mutationFn: async (data: typeof costsFormData) => {
      const payload: any = {
        ...data,
        quantity: data.quantity ? parseFloat(data.quantity) : null,
        unitCost: data.unitCost ? parseFloat(data.unitCost) : null,
        totalCost: parseFloat(data.totalCost),
      };
      const response = await fetch(`/api/parcels/${id}/costs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error("Error al guardar costo");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["costs", id] });
      setShowCostsModal(false);
      setCostsFormData({
        cycleYear: new Date().getFullYear(),
        cycleSeason: "primavera-verano",
        category: "semillas",
        concept: "",
        unit: "",
        quantity: "",
        unitCost: "",
        totalCost: "",
        notes: "",
      });
    },
  });

  const deleteCostMutation = useMutation({
    mutationFn: async (costId: string) => {
      const response = await fetch(`/api/parcels/${id}/costs/${costId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Error al eliminar");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["costs", id] });
    },
  });

  const { data: costsData } = useQuery({
    queryKey: ["costs", id],
    queryFn: async () => {
      const res = await fetch(`/api/parcels/${id}/costs`, { credentials: "include" });
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
    enabled: !!id,
  });

  interface ProfitabilityResponse {
    totalCostPerHa: number;
    totalCost: number;
    projectedRevenue: number | null;
    grossMargin: number | null;
    costPerTon: number | null;
    roi: number | null;
    breakEvenTon: number | null;
    parcelArea: number;
    cycleDetail: Record<string, unknown> | null;
    costBreakdown: { category: string; totalCost: number }[];
    autoEstimate: boolean;
    sniimPrice: number | null;
    sniimDate: string | null;
    siapBenchmarkTonHa: number | null;
    siapCycle: string | null;
    siapSource: string;
    estimatedGrossMarginPerHa: number | null;
    estimatedRoiPct: number | null;
    estimatedBreakEvenTonHa: number | null;
  }

  const { data: profitabilityData } = useQuery<ProfitabilityResponse | null>({
    queryKey: ["profitability", id],
    queryFn: async () => {
      const res = await fetch(`/api/parcels/${id}/profitability`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json() as Promise<ProfitabilityResponse>;
    },
    enabled: !!id,
    staleTime: 120_000,
  });

  const { data: parcelMarketData } = useQuery({
    queryKey: ["market-prices", id],
    queryFn: async () => {
      const res = await fetch(`/api/parcels/${id}/market-prices`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json() as Promise<{
        exchange: { usdMxn: number; date: string } | null;
      }>;
    },
    enabled: !!id && activeTab === "costs",
    staleTime: 1000 * 60 * 30,
  });

  interface FAOFertilizerPrice {
    name: string;
    code: string;
    price: number;
    unit: string;
    date: string;
    source: string;
    aliases: string[];
  }

  const { data: faoFertilizerPrices = [] } = useQuery<FAOFertilizerPrice[]>({
    queryKey: ["fao-fertilizer-prices"],
    queryFn: async () => {
      const res = await fetch("/api/market/fertilizers", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!id && activeTab === "costs",
    staleTime: 7 * 24 * 60 * 60 * 1000,
  });

  function matchFaoFertilizer(concept: string): FAOFertilizerPrice | null {
    if (!faoFertilizerPrices.length) return null;
    const accentMap: Record<string, string> = { á: "a", é: "e", í: "i", ó: "o", ú: "u" };
    const c = concept.toLowerCase().replace(/[áéíóú]/g, (ch) => accentMap[ch] ?? ch);
    for (const price of faoFertilizerPrices) {
      if (price.aliases.some((alias) => c.includes(alias))) return price;
      if (c.includes(price.name.toLowerCase())) return price;
    }
    return null;
  }

  function getFaoAlertInfo(cost: any, fao: FAOFertilizerPrice, usdMxn: number | null): { alert: boolean; costPerTonMxn: number | null } {
    const unitCost = parseFloat(cost.unitCost ?? "0");
    const unit = (cost.unit ?? "").toLowerCase();
    if (!unitCost || !unit) return { alert: false, costPerTonMxn: null };
    let perTon = unitCost;
    if (unit.includes("kg")) perTon = unitCost * 1000;
    else if (!unit.includes("ton") && !unit.includes("tn") && !unit.includes("t")) return { alert: false, costPerTonMxn: null };
    const effectiveUsdMxn = usdMxn ?? 17.5;
    const faoMxn = fao.price * effectiveUsdMxn;
    return { alert: perTon > 1.2 * faoMxn, costPerTonMxn: perTon };
  }

  const { data: metricsData, isLoading: metricsLoading } = useQuery<RegenerativeMetrics>({
    queryKey: ["regenerative-metrics", id],
    queryFn: async () => {
      const response = await fetch(`/api/parcels/${id}/regenerative-metrics`, { credentials: "include" });
      if (!response.ok) return { score: "C", scoreNumeric: 50, carbonSequestered: 0, dataCompleteness: 0, ndviSource: "none" as const, satelliteNdvi: null, satelliteNdviDate: null, breakdown: { soil: 50, practices: 40, tillage: 50, rotation: 50, animals: 50, livelihood: 0 } };
      return response.json();
    },
    enabled: !!id,
  });

  interface CarbonValue {
    tons: number;
    pricePerTon: number | null;
    totalUsd: number;
    totalMxn: number | null;
    usdMxn: number | null;
    source: string | null;
    date: string | null;
    available: boolean;
  }
  const { data: carbonValueData } = useQuery<CarbonValue | null>({
    queryKey: ["carbon-value", id],
    queryFn: async () => {
      const res = await fetch(`/api/parcels/${id}/carbon-value`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!id,
    staleTime: 24 * 60 * 60 * 1000,
  });

  const { data: mvzCampaigns = [] } = useQuery<SamplingCampaign[]>({
    queryKey: ["sampling-campaigns", id],
    queryFn: async () => {
      const r = await fetch(`/api/parcels/${id}/sampling-campaigns`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!id,
  });

  interface SatelliteZoneSetMeta {
    indexType?: string; imageDate?: string; method?: string;
    nZonesActual?: number; vmin?: number; vmax?: number;
    scaleM?: number; cloudyPixelPercentage?: number | null;
  }
  interface SatelliteZoneSetBrief {
    zoneSetId: string; createdAt: string;
    metadata: SatelliteZoneSetMeta | null;
    zones: Array<{ areaHa: string | null; colorHex: string | null; zoneLabel: string | null }>;
  }
  const { data: satZoneSetsData } = useQuery<{ zoneSets: SatelliteZoneSetBrief[] }>({
    queryKey: ["satellite-zone-sets", id],
    queryFn: async () => {
      const r = await fetch(`/api/parcels/${id}/zones/from-satellite`, { credentials: "include" });
      if (!r.ok) return { zoneSets: [] };
      return r.json();
    },
    enabled: !!id,
  });
  const satZoneSets = satZoneSetsData?.zoneSets ?? [];

  interface DroneZoneSetBrief {
    zoneSetId: string;
    indexType: string;
    indexName: string;
    cameraType: string;
    filename: string | null;
    flightDate: string | null;
    method: string;
    createdAt: string;
    zoneCount: number;
    zones: Array<{ areaHa: string | null; colorHex: string | null; zoneLabel: string | null }>;
  }
  const { data: droneZoneSetsData, refetch: refetchDroneZoneSets } = useQuery<{ zoneSets: DroneZoneSetBrief[] }>({
    queryKey: ["drone-zone-sets", id],
    queryFn: async () => {
      const r = await fetch(`/api/parcels/${id}/zones/from-drone`, { credentials: "include" });
      if (!r.ok) return { zoneSets: [] };
      return r.json();
    },
    enabled: !!id,
  });
  const droneZoneSets = droneZoneSetsData?.zoneSets ?? [];

  const { data: zoneImportsData, refetch: refetchZoneImports } = useQuery<{ imports: ZoneImportRow[] }>({
    queryKey: ["zone-imports", id],
    queryFn: async () => {
      const r = await fetch(`/api/parcels/${id}/zone-imports`, { credentials: "include" });
      if (!r.ok) return { imports: [] };
      return r.json();
    },
    enabled: !!id,
  });
  const zoneImportRows = zoneImportsData?.imports ?? [];

  const categoryLabels: Record<string, string> = {
    semillas: "Semillas",
    fertilizantes: "Fertilizantes",
    herbicidas: "Herbicidas",
    insecticidas: "Insecticidas",
    fungicidas: "Fungicidas",
    otros_insumos: "Otros Insumos",
    mano_obra_siembra: "Mano de Obra - Siembra",
    mano_obra_cosecha: "Mano de Obra - Cosecha",
    mano_obra_riego: "Mano de Obra - Riego",
    mano_obra_fumigacion: "Mano de Obra - Fumigación",
    mano_obra_otros: "Mano de Obra - Otros",
    maquinaria_renta: "Maquinaria - Renta",
    maquinaria_combustible: "Maquinaria - Combustible",
    maquinaria_mantenimiento: "Maquinaria - Mantenimiento",
    riego_agua: "Riego - Agua",
    riego_energia: "Riego - Energía",
    riego_mantenimiento: "Riego - Mantenimiento",
    transporte: "Transporte",
    almacenamiento: "Almacenamiento",
    empaque: "Empaque",
    renta_tierra: "Renta de Tierra",
    seguro_agricola: "Seguro Agrícola",
    asistencia_tecnica: "Asistencia Técnica",
    credito_intereses: "Crédito/Intereses",
    otros_gastos: "Otros Gastos",
  };

  const categoryGroups: Record<string, string[]> = {
    "Insumos": ["semillas", "fertilizantes", "herbicidas", "insecticidas", "fungicidas", "otros_insumos"],
    "Mano de Obra": ["mano_obra_siembra", "mano_obra_cosecha", "mano_obra_riego", "mano_obra_fumigacion", "mano_obra_otros"],
    "Maquinaria": ["maquinaria_renta", "maquinaria_combustible", "maquinaria_mantenimiento"],
    "Riego": ["riego_agua", "riego_energia", "riego_mantenimiento"],
    "Cosecha y Post-cosecha": ["transporte", "almacenamiento", "empaque"],
    "Otros": ["renta_tierra", "seguro_agricola", "asistencia_tecnica", "credito_intereses", "otros_gastos"],
  };

  const polygonCoords = useMemo(
    () => (parcelData?.parcel?.polygonCoordinates as [number, number][] | undefined) || [],
    [parcelData?.parcel?.polygonCoordinates]
  );
  const mapCenter = useMemo((): [number, number] => {
    if (polygonCoords.length > 0) {
      return [
        polygonCoords.reduce((sum: number, c: [number, number]) => sum + c[0], 0) / polygonCoords.length,
        polygonCoords.reduce((sum: number, c: [number, number]) => sum + c[1], 0) / polygonCoords.length,
      ];
    }
    return [
      parseFloat(parcelData?.parcel?.latitude || "19.4326"),
      parseFloat(parcelData?.parcel?.longitude || "-99.1332"),
    ];
  }, [polygonCoords, parcelData?.parcel?.latitude, parcelData?.parcel?.longitude]);

  // ── All useMemo hooks must be declared before any conditional early return ──
  const monitoringData: ParcelData[] = useMemo(
    () => (timeSeriesData?.data as ParcelData[] | undefined) || [],
    [timeSeriesData?.data]
  );
  const geeIndices: IndicesData[] = useMemo(
    () => (indicesData?.indices as IndicesData[] | undefined) || [],
    [indicesData?.indices]
  );
  const chartGeeIndices: IndicesData[] = useMemo(
    () => (chartIndicesData?.indices as IndicesData[] | undefined) || [],
    [chartIndicesData?.indices]
  );
  // Chart prefers the time-range query; sidebar stats use the quick 3-month query.
  const hasGEEData = geeIndices.length > 0 || chartGeeIndices.length > 0;
  const chartHasData = chartGeeIndices.length > 0;

  const plantingDate = useMemo(
    () => parcelData?.parcel?.plantingDate ? new Date(parcelData.parcel.plantingDate) : null,
    [parcelData?.parcel?.plantingDate]
  );
  const cropCurve = useMemo(
    () => getCropCurve(parcelData?.parcel?.crop || "Genérico"),
    [parcelData?.parcel?.crop]
  );

  const chartDates = useMemo(
    () => chartHasData
      ? chartGeeIndices.map(d => d.date)
      : hasGEEData
        ? geeIndices.map(d => d.date)
        : monitoringData.length > 0
          ? monitoringData.map(d => d.date).reverse()
          : null,
    [chartHasData, chartGeeIndices, hasGEEData, geeIndices, monitoringData]
  );

  const idealCurveData = useMemo(
    () => plantingDate && chartDates
      ? generateIdealCurveForDates(plantingDate, chartDates, parcelData?.parcel?.crop || "Genérico")
      : [],
    [plantingDate, chartDates, parcelData?.parcel?.crop]
  );

  const idealByDate = useMemo(
    () => new Map(idealCurveData.map(d => [d.date, d])),
    [idealCurveData]
  );

  const indexChartData = useMemo(() => {
    // Use the time-range query for the chart; fall back to 3-month sidebar query.
    const source = chartHasData ? chartGeeIndices : hasGEEData ? geeIndices : null;
    if (source) {
      return source.map((d) => {
        const ideal = idealByDate.get(d.date);
        return {
          month: formatDate(d.date),
          date:  d.date,
          ndvi:  d.ndvi,
          evi:   d.evi,
          ndmi:  d.ndmi,
          ndre:  d.ndre  ?? 0,
          gndvi: d.gndvi ?? 0,
          msavi: d.msavi ?? 0,
          savi:  d.savi  ?? 0,
          ndwi:  d.ndwi  ?? 0,
          ideal: ideal?.idealNdvi ?? null,
          stage: ideal?.stage ?? null,
        };
      });
    }
    if (monitoringData.length > 0) {
      return monitoringData.map((d) => {
        const ideal = idealByDate.get(d.date);
        const v = parseFloat(d.ndvi || "0");
        return {
          month: new Date(d.date).toLocaleDateString('es-AR', { month: 'short' }),
          date:  d.date,
          ndvi:  v,
          evi:   v * 0.85,
          ndmi:  v * 0.7 - 0.3,
          ndre:  v * 0.6,
          gndvi: v * 0.75,
          msavi: v * 0.8,
          savi:  v * 0.78,
          ndwi:  v * 0.4 - 0.1,
          ideal: ideal?.idealNdvi ?? null,
          stage: ideal?.stage ?? null,
        };
      }).reverse();
    }
    return [] as {
      month: string; date: string;
      ndvi: number; evi: number; ndmi: number; ndre: number;
      gndvi: number; msavi: number; savi: number; ndwi: number;
      ideal: number | null; stage: string | null;
    }[];
  }, [chartHasData, chartGeeIndices, hasGEEData, geeIndices, monitoringData, idealByDate]);

  const moistureChartData = useMemo(
    () => monitoringData.length > 0
      ? monitoringData.map((d, i) => ({
          day: (i + 1).toString(),
          value: parseFloat(d.soilMoisture || "0"),
        })).reverse()
      : defaultSoilMoistureData,
    [monitoringData]
  );
  // Compute min/max of selected soil attribute for color scale (must be before early returns)
  const mexSoilFeatures: SoilSampleFeature[] = (mexSoilData as any)?.features ?? [];
  const { soilAttrMin, soilAttrMax } = useMemo(() => {
    if (!mexSoilFeatures.length) return { soilAttrMin: 0, soilAttrMax: 1 };
    const vals = mexSoilFeatures
      .map((f) => f.properties[selectedSoilAttribute])
      .filter((v) => v !== null && v !== undefined && !isNaN(Number(v)))
      .map(Number);
    if (!vals.length) return { soilAttrMin: 0, soilAttrMax: 1 };
    return { soilAttrMin: Math.min(...vals), soilAttrMax: Math.max(...vals) };
  }, [mexSoilFeatures.length, selectedSoilAttribute]);
  // ─────────────────────────────────────────────────────────────────────────

  if (parcelLoading) {
    return (
      <div className="container mx-auto px-4 py-12 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (parcelError || !parcelData?.parcel) {
    return (
      <div className="container mx-auto px-4 py-12 text-center">
        <h2 className="text-2xl font-bold mb-4">Lote no encontrado</h2>
        <p className="text-muted-foreground mb-6">El lote que buscas no existe o no tienes permiso para verlo.</p>
        <Link href="/dashboard">
          <Button>Volver al Tablero</Button>
        </Link>
      </div>
    );
  }

  const parcel: Parcel = parcelData.parcel;
  const activeModules = getActiveModules(
    { hasDrones: (user as any)?.hasDrones, hasIoT: (user as any)?.hasIoT, producerType: (user as any)?.producerType, techLevel: (user as any)?.techLevel },
    parcel.irrigationSystem
  );
  const alerts = alertsData?.alerts || [];
  const dataSource = indicesData?.source || "simulated";
  const isDEMMode = selectedIndex === "dem";
  const isMexSoilMode = selectedIndex === "mx-soil";
  const hasIndexTiles = isDEMMode
    ? (demTilesData?.available && demTilesData?.urlFormat)
    : (indexTilesData?.available && indexTilesData?.urlFormat);
  const indexTileUrl = isDEMMode
    ? (demTilesData?.urlFormat || null)
    : (indexTilesData?.urlFormat || null);
  const sentinelImages = sentinelImagesData?.images || [];
  const tileImageDate = (!isDEMMode && !isMexSoilMode && indexTilesData?.imageDate) ? indexTilesData.imageDate : null;

  const lastChartPoint = indexChartData.length > 0 ? indexChartData[indexChartData.length - 1] : null;
  const currentIndexValue = lastChartPoint ? ((lastChartPoint as unknown as Record<string, number>)[selectedIndex] ?? 0.65) : 0.65;

  const latestDataDate = lastChartPoint?.date
    ? new Date(lastChartPoint.date)
    : new Date();

  const daysSincePlanting = plantingDate
    ? Math.floor((latestDataDate.getTime() - plantingDate.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const isPrePlanting = daysSincePlanting !== null && daysSincePlanting < 0;

  const latestIdealNdvi = !isPrePlanting && lastChartPoint && lastChartPoint.ideal !== null
    ? lastChartPoint.ideal
    : null;

  const deviation: DeviationResult | null = latestIdealNdvi !== null && !isPrePlanting && selectedIndex === "ndvi"
    ? calculateDeviation(currentIndexValue, latestIdealNdvi)
    : null;

  const currentExpectedStage = plantingDate && daysSincePlanting !== null
    ? getCurrentStage(daysSincePlanting, cropCurve)
    : null;
  
  const latestIndexDate = hasGEEData && geeIndices.length > 0
    ? new Date(geeIndices[geeIndices.length - 1].date).toLocaleDateString('es-AR')
    : new Date().toLocaleDateString('es-AR');

  const statusLabel = parcel.status === "active" ? "Ciclo Activo" : parcel.status === "warning" ? "Alerta" : "Inactivo";

  const setupCompletion = getParcelSetupCompletion(setupProgress);
  const sp = setupCompletion.flags;
  const statusStyle = parcel.status === "active" 
    ? "bg-green-100 text-green-800 hover:bg-green-200 border-green-200"
    : parcel.status === "warning"
    ? "bg-yellow-100 text-yellow-800 hover:bg-yellow-200 border-yellow-200"
    : "bg-gray-100 text-gray-800 hover:bg-gray-200 border-gray-200";

  return (
    <div className="container mx-auto px-4 py-4 md:py-6 space-y-4 md:space-y-6">
      <div className="flex items-center gap-2 text-xs md:text-sm text-muted-foreground mb-2 md:mb-4">
        <Link href="/dashboard" className="hover:text-primary flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> <span className="hidden sm:inline">Volver al </span>Tablero
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium truncate max-w-[150px] md:max-w-none" data-testid="text-parcel-name">{parcel.name}</span>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 md:gap-6 items-start">
        <div className="flex-1 w-full">
          <div className="flex flex-wrap items-center gap-2 md:gap-3 mb-2">
            <h1 className="text-xl md:text-3xl font-heading font-bold text-foreground">{parcel.name}</h1>
            <Badge className={`${statusStyle} text-xs`} data-testid="badge-parcel-status">{statusLabel}</Badge>
            {parcel.isPublic && (
              <Badge variant="secondary" className="text-xs">Público</Badge>
            )}
            {parcelCacheStatus?.isHit && (
              <Badge variant="outline" className="text-xs border-amber-300 bg-amber-50 text-amber-700" data-testid="badge-offline-parcel">
                Sin conexión — {parcelCacheStatus.cachedAt ? `datos de ${formatCachedAt(parcelCacheStatus.cachedAt)}` : "datos guardados"}
              </Badge>
            )}
          </div>
          <p className="text-xs md:text-sm text-muted-foreground mb-3 md:mb-4 flex items-center gap-2 md:gap-4 flex-wrap">
            <span className="hidden md:inline">Lat: {parseFloat(parcel.latitude).toFixed(2)}, Lon: {parseFloat(parcel.longitude).toFixed(2)}</span>
            <span className="hidden md:inline">•</span>
            <span>{parcel.area} ha</span>
            <span>•</span>
            <span className="inline-flex items-center gap-1">
              {parcel.crop}
              {parcel.crop && SATELLITE_SUPPORTED_CROPS.has(parcel.crop) && (
                <span title="Interpretación satelital disponible" className="inline-flex items-center gap-0.5 text-[10px] text-sky-600 font-medium bg-sky-50 border border-sky-200 rounded px-1 py-0.5 leading-none">
                  <Satellite className="w-2.5 h-2.5" /> SAT
                </span>
              )}
            </span>
          </p>

          {/* Setup progress banner — shown only when wizard is incomplete */}
          {!setupProgressLoading && setupProgress && !setupCompletion.isComplete && (
            <div className="mb-3 p-3 rounded-lg border border-amber-200 bg-amber-50 flex flex-col sm:flex-row items-start sm:items-center gap-3" data-testid="banner-setup-progress">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-amber-800 mb-1">Completa el perfil de tu parcela — {setupCompletion.completedCount}/{setupCompletion.totalCount} pasos listos</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-amber-200 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${setupCompletion.percentage}%` }} />
                  </div>
                  <span className="text-[10px] text-amber-700 font-mono shrink-0">{setupCompletion.percentage}%</span>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {setupCompletion.steps.map(s => (
                    <span key={s.key} className={`text-[10px] px-1.5 py-0.5 rounded ${sp[s.key] ? "bg-green-100 text-green-700" : s.required ? "bg-amber-100 text-amber-600" : "bg-gray-100 text-gray-500"}`}>
                      {sp[s.key] ? "✓" : "·"} {s.label}
                    </span>
                  ))}
                </div>
              </div>
              <Link href={`/parcel/${parcel.id}/setup`}>
                <Button size="sm" variant="outline" className="shrink-0 text-xs border-amber-400 text-amber-800 hover:bg-amber-100 h-8" data-testid="btn-open-setup-wizard">
                  Completar
                </Button>
              </Link>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Link href={`/parcel/${parcel.id}/indices`}>
              <Button variant="default" size="sm" className="gap-1 md:gap-2 text-xs md:text-sm h-8 md:h-9" data-testid="btn-view-indices">
                <BarChart3 className="w-3 h-3 md:w-4 md:h-4" /> Índices
              </Button>
            </Link>
            <Link href={`/parcel/${parcel.id}/climate`}>
              <Button variant="outline" size="sm" className="gap-1 md:gap-2 text-xs md:text-sm h-8 md:h-9" data-testid="btn-view-climate">
                <Thermometer className="w-3 h-3 md:w-4 md:h-4" /> Clima
              </Button>
            </Link>
            <Link href={`/parcel/${parcel.id}/alerts`}>
              <Button variant="outline" size="sm" className="gap-1 md:gap-2 text-xs md:text-sm h-8 md:h-9" data-testid="btn-view-alerts">
                <AlertTriangle className="w-3 h-3 md:w-4 md:h-4" /> Alertas
              </Button>
            </Link>
            {parcel?.id && (
              <Link href={`/parcel/${parcel.id}/sampling/design`}>
                <Button variant="outline" size="sm" className="gap-1 md:gap-2 text-xs md:text-sm h-8 md:h-9 border-purple-300 text-purple-700 hover:bg-purple-50" data-testid="btn-variable-management">
                  <ScanLine className="w-3 h-3 md:w-4 md:h-4" /> MVZ
                </Button>
              </Link>
            )}
            {parcel?.id && (
              <Link href={`/parcel/${parcel.id}/import`}>
                <Button variant="outline" size="sm" className="gap-1 md:gap-2 text-xs md:text-sm h-8 md:h-9 border-blue-300 text-blue-700 hover:bg-blue-50" data-testid="btn-import-zones">
                  <Upload className="w-3 h-3 md:w-4 md:h-4" /> Importar
                </Button>
              </Link>
            )}
            <Button variant="ghost" size="sm" className="gap-1 text-xs md:text-sm h-8 md:h-9">
              <Share2 className="w-3 h-3 md:w-4 md:h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-xs md:text-sm h-8 md:h-9"
              title="Descargar informe de parcela (JSON)"
              data-testid="btn-download-parcel-report"
              onClick={() => parcel?.id && window.open(`/api/parcels/${parcel.id}/report`, "_blank")}
            >
              <Download className="w-3 h-3 md:w-4 md:h-4" />
            </Button>
          </div>
        </div>
        
        <div className="w-full lg:w-1/3">
           <Card className="bg-secondary/10 border-none shadow-inner">
             <CardContent className="p-4 space-y-3">
               <div className="flex justify-between items-center">
                 <div>
                   <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Puntaje Regenerativo</p>
                   {metricsLoading ? (
                     <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                   ) : (
                     <p className={`text-3xl font-mono font-bold ${
                       metricsData?.score?.startsWith('A') ? 'text-primary' :
                       metricsData?.score?.startsWith('B') ? 'text-green-600' :
                       metricsData?.score?.startsWith('C') ? 'text-yellow-600' :
                       'text-red-600'
                     }`} data-testid="regenerative-score">{metricsData?.score || 'C'}</p>
                   )}
                 </div>
                 <div className="text-right">
                   <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Carbono Secuestrado</p>
                   {metricsLoading ? (
                     <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                   ) : (
                     <>
                       <p className="text-xl font-mono font-medium" data-testid="carbon-sequestered">{metricsData?.carbonSequestered || 0} tons</p>
                       {carbonValueData && carbonValueData.totalUsd > 0 && (
                         <p
                           className="text-[11px] mt-0.5 text-emerald-700 dark:text-emerald-400 font-medium cursor-help"
                           title={`Basado en precio de crédito de carbono voluntario (${carbonValueData.source}) del ${carbonValueData.date}. Estimación no certificada. Precio: $${carbonValueData.pricePerTon} USD/tCO₂.`}
                           data-testid="carbon-economic-value"
                         >
                           ≈ ${carbonValueData.totalUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })} USD
                           {carbonValueData.totalMxn !== null && (
                             <> · ${carbonValueData.totalMxn.toLocaleString("es-MX", { maximumFractionDigits: 0 })} MXN</>
                           )}
                           <span className="ml-1 text-[9px] text-muted-foreground font-normal">(VCM ⓘ)</span>
                         </p>
                       )}
                       <p className={`text-[10px] mt-0.5 ${metricsData?.ndviSource === "satellite" ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                         {metricsData?.ndviSource === "satellite"
                           ? `📡 Sentinel-2 · NDVI ${metricsData.satelliteNdvi?.toFixed(3)}`
                           : "Sin NDVI satelital aún"}
                       </p>
                     </>
                   )}
                 </div>
               </div>
               {!metricsLoading && metricsData?.breakdown && (
                 <div className="border-t border-border/40 pt-3 space-y-2">
                   <div className="flex items-center justify-between mb-1">
                     <div className="flex items-center gap-1.5">
                       <Info className="w-3 h-3 text-muted-foreground" />
                       <p className="text-[10px] text-muted-foreground">5 pilares — actualiza al reportar datos</p>
                     </div>
                     {metricsData.dataCompleteness !== undefined && (
                       <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                         metricsData.dataCompleteness >= 80 ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" :
                         metricsData.dataCompleteness >= 40 ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300" :
                         "bg-muted text-muted-foreground"
                       }`}>
                         {metricsData.dataCompleteness}% datos
                       </span>
                     )}
                   </div>
                   <div className="space-y-1.5">
                     {[
                       { label: "Suelo",      icon: FlaskConical, key: "soil",      weight: "25%" },
                       { label: "Prácticas",  icon: Sprout,       key: "practices", weight: "25%" },
                       { label: "Labranza",   icon: Tractor,      key: "tillage",   weight: "20%" },
                       { label: "Rotación",   icon: RotateCcw,    key: "rotation",  weight: "20%" },
                       { label: "Animales",   icon: Beef,         key: "animals",   weight: "10%" },
                     ].map(({ label, icon: Icon, key, weight }) => {
                       const val = (metricsData.breakdown as Record<string, number>)[key] ?? 50;
                       const color = val >= 75 ? "bg-green-500" : val >= 50 ? "bg-yellow-500" : "bg-red-400";
                       return (
                         <div key={key} className="flex items-center gap-2">
                           <span className="text-[11px] text-muted-foreground flex items-center gap-1 w-20 flex-shrink-0">
                             <Icon className="w-3 h-3" /> {label}
                           </span>
                           <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                             <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${val}%` }} />
                           </div>
                           <span className="text-[10px] font-mono w-14 text-right flex-shrink-0">
                             {val}% <span className="text-muted-foreground">({weight})</span>
                           </span>
                         </div>
                       );
                     })}
                   </div>
                 </div>
               )}
             </CardContent>
           </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        <div className="lg:col-span-1 space-y-6">
          {/* ── Satellite map card ────────────────────────────────────────── */}
          <Card className="overflow-hidden border-border/60">
            {/* Map viewport */}
            <div className="relative bg-black/5" style={{ minHeight: 300 }}>
              {editPolygonMode ? (
                <Suspense fallback={<div className="flex items-center justify-center h-[350px]"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}>
                  <div style={{ height: 350 }}>
                    <ParcelMapEditable
                      initialCoordinates={polygonCoords.length > 0 ? polygonCoords : undefined}
                      center={mapCenter}
                      fitBoundsTo={polygonCoords.length > 0 ? polygonCoords : null}
                      onPolygonCreated={(coords) => setPendingPolygonCoords(coords)}
                      onPolygonDeleted={() => setPendingPolygonCoords(null)}
                      readOnly={false}
                    />
                  </div>
                </Suspense>
              ) : (
                <>
                  <ParcelLeafletMap
                    mapCenter={mapCenter}
                    polygonCoords={polygonCoords}
                    hasIndexTiles={!!hasIndexTiles}
                    indexTileUrl={indexTileUrl}
                    selectedIndex={selectedIndex}
                    currentIndexValue={currentIndexValue}
                    tileOpacity={tileOpacity}
                    mapStyle={{ minHeight: "300px", height: "300px" }}
                    soilSamples={isMexSoilMode ? mexSoilFeatures : undefined}
                    soilAttribute={selectedSoilAttribute}
                    soilMin={soilAttrMin}
                    soilMax={soilAttrMax}
                  />

                  {/* Fullscreen button */}
                  <button
                    onClick={() => setShowFullscreenMap(true)}
                    className="absolute top-3 right-3 bg-background/90 backdrop-blur p-1.5 rounded-md shadow border border-border cursor-pointer hover:bg-background transition-colors z-[400]"
                    data-testid="button-fullscreen-map"
                    title="Pantalla completa"
                  >
                    <Maximize2 className="w-4 h-4 text-foreground" />
                  </button>
                </>
              )}

              {/* Image-date badge (top-left) — hidden in DEM mode or edit mode */}
              {!editPolygonMode && tileImageDate && !isDEMMode && (
                <div className="absolute top-3 left-3 z-[400] flex items-center gap-1.5 bg-background/90 backdrop-blur px-2 py-1 rounded-md shadow border border-border text-[11px] font-medium">
                  <ImageIcon className="w-3 h-3 text-muted-foreground" />
                  {new Date(tileImageDate + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })}
                  {/* Cloud % for selected date */}
                  {(() => {
                    const match = sentinelImages.find((img: any) => img.date === tileImageDate);
                    return match ? (
                      <span className={`flex items-center gap-0.5 ml-1 ${match.cloudPercentage > 20 ? "text-amber-600" : "text-green-600"}`}>
                        <Cloud className="w-3 h-3" />{match.cloudPercentage.toFixed(0)}%
                      </span>
                    ) : null;
                  })()}
                </div>
              )}

              {/* Mexico soil — loading / no-data overlay */}
              {!editPolygonMode && isMexSoilMode && (() => {
                if (mexSoilFetching) {
                  return (
                    <div className="absolute inset-0 z-[400] flex items-center justify-center bg-background/60 backdrop-blur-sm">
                      <div className="flex items-center gap-2 bg-background border border-border rounded-lg px-4 py-3 shadow-lg">
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                        <span className="text-sm">Cargando muestras de suelo…</span>
                      </div>
                    </div>
                  );
                }
                if (!mexSoilFetching && mexSoilFeatures.length === 0) {
                  return (
                    <div className="absolute inset-0 z-[400] flex items-center justify-center bg-background/70 backdrop-blur-sm">
                      <div className="bg-background border border-amber-300 rounded-lg px-4 py-3 shadow-lg max-w-[240px] text-center space-y-1">
                        <FlaskConical className="w-6 h-6 mx-auto text-amber-500" />
                        <p className="text-sm font-semibold">Sin muestras cercanas</p>
                        <p className="text-xs text-muted-foreground">No hay puntos de análisis de suelo INIFAP en un radio de 120 km de esta parcela.</p>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}

              {/* DEM status overlay — shown when GEE unavailable or DEM has no data */}
              {!editPolygonMode && isDEMMode && !demFetching && (() => {
                if (geeStatus?.available === false) {
                  return (
                    <div className="absolute inset-0 z-[400] flex items-center justify-center bg-background/70 backdrop-blur-sm">
                      <div className="bg-background border border-border rounded-lg px-4 py-3 shadow-lg max-w-[220px] text-center space-y-1">
                        <Mountain className="w-6 h-6 mx-auto text-muted-foreground" />
                        <p className="text-sm font-semibold">DEM no disponible</p>
                        <p className="text-xs text-muted-foreground">Google Earth Engine no está configurado para esta cuenta.</p>
                      </div>
                    </div>
                  );
                }
                if (demTilesData && !demTilesData.available) {
                  return (
                    <div className="absolute inset-0 z-[400] flex items-center justify-center bg-background/70 backdrop-blur-sm">
                      <div className="bg-background border border-amber-300 rounded-lg px-4 py-3 shadow-lg max-w-[220px] text-center space-y-1">
                        <AlertTriangle className="w-6 h-6 mx-auto text-amber-500" />
                        <p className="text-sm font-semibold">Sin datos de elevación</p>
                        <p className="text-xs text-muted-foreground">No hay datos DEM Copernicus disponibles para esta parcela.</p>
                      </div>
                    </div>
                  );
                }
                if (demTilesData?.available && demTilesData.hasData === false) {
                  return (
                    <div className="absolute inset-0 z-[400] flex items-center justify-center bg-background/70 backdrop-blur-sm">
                      <div className="bg-background border border-amber-300 rounded-lg px-4 py-3 shadow-lg max-w-[220px] text-center space-y-1">
                        <AlertTriangle className="w-6 h-6 mx-auto text-amber-500" />
                        <p className="text-sm font-semibold">Sin píxeles DEM</p>
                        <p className="text-xs text-muted-foreground">El DEM no tiene cobertura para las coordenadas de esta parcela.</p>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}

            </div>

            {/* ── Controls ──────────────────────────────────────────────── */}
            <CardContent className="p-4 space-y-3">

              {/* ── Index / DEM / Soil legend ──────────────────────────── */}
              {isMexSoilMode ? (
                /* Mexico Soil Analysis legend */
                <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">
                      Análisis de Suelo <span className="font-normal text-muted-foreground">— INIFAP · {mexSoilFeatures.length} muestras</span>
                    </span>
                    {mexSoilFetching && <span className="text-[10px] text-muted-foreground animate-pulse">Cargando…</span>}
                  </div>
                  <div className="h-2.5 w-full rounded-full" style={{ background: "linear-gradient(to right,#d73027,#fc8d59,#fee08b,#d9ef8b,#66bd63,#1a9850)" }} />
                  <div className="flex justify-between text-[9px] text-muted-foreground">
                    <span>{soilAttrMin.toFixed(2)} <span className="text-red-500">▼ bajo</span></span>
                    <span>{((soilAttrMin + soilAttrMax) / 2).toFixed(2)}</span>
                    <span><span className="text-green-600">▲ alto</span> {soilAttrMax.toFixed(2)}</span>
                  </div>
                  <div className="text-[9px] text-muted-foreground text-center">
                    Haz clic en un punto para ver todos los parámetros
                  </div>
                </div>
              ) : isDEMMode ? (
                /* DEM legend — palette + terrain stats */
                (() => {
                  const demMeta: Record<string, { label: string; gradient: string; minLabel: string; midLabel: string; maxLabel: string }> = {
                    elevation: { label: "Elevación (m)",  gradient: "linear-gradient(to right,#313695,#4575b4,#74add1,#abd9e9,#e0f3f8,#ffffbf,#fee090,#fdae61,#f46d43,#d73027,#a50026)", minLabel: "0 m",      midLabel: "250 m",    maxLabel: "≥500 m"   },
                    hillshade: { label: "Relieve Sombreado", gradient: "linear-gradient(to right,#000000,#404040,#808080,#bfbfbf,#ffffff)",                                                 minLabel: "Sombra",   midLabel: "—",        maxLabel: "Luz"      },
                    slope:     { label: "Pendiente (°)",   gradient: "linear-gradient(to right,#1a9850,#91cf60,#d9ef8b,#fee08b,#fc8d59,#d73027)",                                           minLabel: "0° Plano", midLabel: "22°",      maxLabel: "≥45° Escarp." },
                  };
                  const m = demMeta[selectedDemType] ?? demMeta.elevation;
                  const ds = demTilesData?.stats;
                  return (
                    <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold">{m.label} <span className="font-normal text-muted-foreground">— DEM Copernicus GLO-30</span></span>
                        {demFetching && <span className="text-[10px] text-muted-foreground animate-pulse">Cargando…</span>}
                      </div>
                      <div className="h-2.5 w-full rounded-full" style={{ background: m.gradient }} />
                      <div className="flex justify-between text-[9px] text-muted-foreground">
                        <span>{m.minLabel}</span><span>{m.midLabel}</span><span>{m.maxLabel}</span>
                      </div>
                      {/* Terrain stats */}
                      {ds && (
                        <div className="grid grid-cols-2 gap-1 pt-0.5">
                          {ds.elevMean != null && (
                            <div className="rounded bg-background/70 px-2 py-1 text-center">
                              <div className="text-[9px] text-muted-foreground">Elev. media</div>
                              <div className="text-xs font-semibold tabular-nums">{ds.elevMean} m</div>
                            </div>
                          )}
                          {ds.elevMin != null && ds.elevMax != null && (
                            <div className="rounded bg-background/70 px-2 py-1 text-center">
                              <div className="text-[9px] text-muted-foreground">Rango</div>
                              <div className="text-xs font-semibold tabular-nums">{ds.elevMin}–{ds.elevMax} m</div>
                            </div>
                          )}
                          {ds.slopeMean != null && (
                            <div className="rounded bg-background/70 px-2 py-1 text-center col-span-2">
                              <div className="text-[9px] text-muted-foreground">Pendiente media</div>
                              <div className="text-xs font-semibold tabular-nums">{ds.slopeMean}°</div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()
              ) : (
                /* Vegetation index legend */
                (() => {
                  const indexMeta: Record<string, { label: string; desc: string; gradient: string; min: number; max: number; minLabel: string; midLabel: string; maxLabel: string }> = {
                    ndvi:  { label: "NDVI",  desc: "Salud Vegetal",          gradient: "linear-gradient(to right,#a50026,#d73027,#f46d43,#fdae61,#fee08b,#d9ef8b,#a6d96a,#66bd63,#1a9850,#006837)", min: 0,    max: 1,   minLabel: "0.0 Suelo",   midLabel: "0.5",  maxLabel: "1.0 Densa"    },
                    evi:   { label: "EVI",   desc: "Índice Veg. Mejorado",   gradient: "linear-gradient(to right,#543005,#8c510a,#bf812d,#dfc27d,#f6e8c3,#c7eae5,#80cdc1,#35978f,#01665e,#003c30)", min: 0,    max: 2,   minLabel: "0.0 Sin veg.", midLabel: "1.0",  maxLabel: "2.0 Alta"     },
                    ndmi:  { label: "NDMI",  desc: "Contenido Hídrico",      gradient: "linear-gradient(to right,#8b0000,#d7191c,#fdae61,#ffffbf,#abd9e9,#2c7bb6,#023858)",                         min: -0.5, max: 0.5, minLabel: "-0.5 Seco",   midLabel: "0.0",  maxLabel: "0.5 Húmedo"  },
                    ndre:  { label: "NDRE",  desc: "Red Edge / Nitrógeno",   gradient: "linear-gradient(to right,#7f2704,#d94801,#f16913,#fd8d3c,#fdbe85,#c7e9c0,#74c476,#31a354,#006d2c)",         min: -0.1, max: 0.5, minLabel: "-0.1 Bajo",   midLabel: "0.2",  maxLabel: "0.5 Alto"    },
                    gndvi: { label: "GNDVI", desc: "Veg. Banda Verde",       gradient: "linear-gradient(to right,#a50026,#d73027,#f46d43,#fdae61,#fee090,#e0f3f8,#74add1,#313695,#08306b)",         min: 0,    max: 0.8, minLabel: "0.0 Suelo",   midLabel: "0.4",  maxLabel: "0.8 Densa"   },
                    msavi: { label: "MSAVI", desc: "Ajustado al Suelo",      gradient: "linear-gradient(to right,#543005,#bf812d,#f6e8c3,#d9ef8b,#a6d96a,#66bd63,#1a9850,#006837)",                 min: -0.1, max: 0.8, minLabel: "-0.1 Suelo",  midLabel: "0.35", maxLabel: "0.8 Densa"   },
                    savi:  { label: "SAVI",  desc: "Aj. Suelo Simple",        gradient: "linear-gradient(to right,#a50026,#d73027,#f46d43,#fdae61,#fee08b,#d9ef8b,#a6d96a,#66bd63,#1a9850,#006837)",  min: -0.1, max: 0.8, minLabel: "-0.1 Suelo",  midLabel: "0.35", maxLabel: "0.8 Densa"   },
                    ndwi:  { label: "NDWI",  desc: "Índice de Agua",          gradient: "linear-gradient(to right,#d7191c,#fdae61,#ffffbf,#abd9e9,#2c7bb6,#023858)",                                   min: -0.8, max: 0.8, minLabel: "-0.8 Tierra",  midLabel: "0.0",  maxLabel: "0.8 Agua"    },
                  };
                  const meta = indexMeta[selectedIndex] ?? indexMeta.ndvi;
                  const pct = Math.min(100, Math.max(0, ((currentIndexValue - meta.min) / (meta.max - meta.min)) * 100));
                  return (
                    <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold">{meta.label} <span className="font-normal text-muted-foreground">— {meta.desc}</span></span>
                        <span className="text-xs font-mono font-bold tabular-nums">{currentIndexValue.toFixed(3)}</span>
                      </div>
                      <div className="relative h-2.5 w-full rounded-full overflow-visible" style={{ background: meta.gradient }}>
                        <div
                          className="absolute top-1/2 -translate-y-1/2 w-1.5 h-4 rounded-sm border border-white shadow"
                          style={{ left: `calc(${pct}% - 3px)`, background: "rgba(0,0,0,0.85)" }}
                        />
                      </div>
                      <div className="flex justify-between text-[9px] text-muted-foreground">
                        <span>{meta.minLabel}</span><span>{meta.midLabel}</span><span>{meta.maxLabel}</span>
                      </div>
                    </div>
                  );
                })()
              )}

              {/* Data source badge — hidden in DEM / mx-soil mode */}
              {!isDEMMode && !isMexSoilMode && (
                <Badge
                  variant="outline"
                  className={dataSource === "satellite" ? "border-green-500 text-green-700 w-full justify-center" : "border-amber-500 text-amber-700 w-full justify-center"}
                  data-testid="badge-data-source"
                >
                  {dataSource === "satellite" ? (
                    <><Satellite className="w-3 h-3 mr-1" /> Datos Satelitales (Sentinel-2)</>
                  ) : (
                    <><Database className="w-3 h-3 mr-1" /> Datos Simulados</>
                  )}
                </Badge>
              )}
              {isDEMMode && (
                <Badge variant="outline" className="border-stone-500 text-stone-700 w-full justify-center">
                  <Mountain className="w-3 h-3 mr-1" /> Copernicus DEM GLO-30 (~30 m) — Estático
                </Badge>
              )}
              {isMexSoilMode && (
                <Badge variant="outline" className="border-amber-700 text-amber-800 w-full justify-center">
                  <FlaskConical className="w-3 h-3 mr-1" /> Dataset INIFAP/SADER — {mexSoilFeatures.length} puntos · Radio 120 km
                </Badge>
              )}

              {/* Layer selector — indices + DEM + soil */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Capa del mapa</label>
                <Select value={selectedIndex} onValueChange={setSelectedIndex}>
                  <SelectTrigger data-testid="select-index-type">
                    <SelectValue placeholder="Seleccionar capa" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ndvi">NDVI — Salud Vegetal</SelectItem>
                    <SelectItem value="evi">EVI — Índice Veg. Mejorado</SelectItem>
                    <SelectItem value="ndmi">NDMI — Contenido Hídrico</SelectItem>
                    <SelectItem value="ndre">NDRE — Red Edge / Nitrógeno</SelectItem>
                    <SelectItem value="gndvi">GNDVI — Veg. Banda Verde</SelectItem>
                    <SelectItem value="msavi">MSAVI — Ajustado al Suelo</SelectItem>
                    <SelectItem value="savi">SAVI — Aj. Suelo Simple</SelectItem>
                    <SelectItem value="ndwi">NDWI — Índice de Agua</SelectItem>
                    <SelectItem value="dem">DEM — Modelo de Elevación Digital</SelectItem>
                    <SelectItem value="mx-soil">Análisis de Suelo (MX)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* DEM type sub-selector — shown only in DEM mode */}
              {isDEMMode && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium flex items-center gap-1.5">
                    <Mountain className="w-3.5 h-3.5" /> Visualización del terreno
                  </label>
                  <Select value={selectedDemType} onValueChange={setSelectedDemType} data-testid="select-dem-type">
                    <SelectTrigger data-testid="select-dem-type-trigger">
                      <SelectValue placeholder="Tipo de visualización" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="elevation">Elevación (hipsométrico)</SelectItem>
                      <SelectItem value="hillshade">Relieve sombreado</SelectItem>
                      <SelectItem value="slope">Pendiente</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Soil attribute sub-selector — shown only in mx-soil mode */}
              {isMexSoilMode && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium flex items-center gap-1.5">
                    <FlaskConical className="w-3.5 h-3.5" /> Parámetro a colorear
                  </label>
                  <Select value={selectedSoilAttribute} onValueChange={setSelectedSoilAttribute} data-testid="select-soil-attribute">
                    <SelectTrigger data-testid="select-soil-attribute-trigger">
                      <SelectValue placeholder="Seleccionar parámetro" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pH">pH</SelectItem>
                      <SelectItem value="mo">Materia Orgánica (%)</SelectItem>
                      <SelectItem value="p">Fósforo P (ppm)</SelectItem>
                      <SelectItem value="k">Potasio K (ppm)</SelectItem>
                      <SelectItem value="ca">Calcio Ca (ppm)</SelectItem>
                      <SelectItem value="mg">Magnesio Mg (ppm)</SelectItem>
                      <SelectItem value="fe">Hierro Fe (ppm)</SelectItem>
                      <SelectItem value="zn">Zinc Zn (ppm)</SelectItem>
                      <SelectItem value="b">Boro B (ppm)</SelectItem>
                      <SelectItem value="mn">Manganeso Mn (ppm)</SelectItem>
                      <SelectItem value="cu">Cobre Cu (ppm)</SelectItem>
                      <SelectItem value="cic">CIC (meq/100g)</SelectItem>
                      <SelectItem value="ce">CE (dS/m)</SelectItem>
                      <SelectItem value="arcilla">Arcilla (%)</SelectItem>
                      <SelectItem value="limo">Limo (%)</SelectItem>
                      <SelectItem value="arena">Arena (%)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Date selector — hidden in DEM / soil mode */}
              {!isDEMMode && !isMexSoilMode && sentinelImages.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5" /> Imagen Sentinel-2
                  </label>
                  <Select value={selectedSentinelDate} onValueChange={setSelectedSentinelDate}>
                    <SelectTrigger data-testid="select-sentinel-date" className="text-xs">
                      <SelectValue placeholder="Más reciente" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="latest">Más reciente</SelectItem>
                      {sentinelImages.map((img: any) => (
                        <SelectItem key={img.id || img.date} value={img.date} className="text-xs">
                          <span className="flex items-center gap-2">
                            <span>{img.date}</span>
                            <span className={`flex items-center gap-0.5 ${img.cloudPercentage > 30 ? "text-amber-600" : "text-green-600"}`}>
                              <Cloud className="w-3 h-3" /> {img.cloudPercentage.toFixed(0)}%
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Opacity slider */}
              {hasIndexTiles && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium flex items-center justify-between">
                    <span className="flex items-center gap-1.5"><Eye className="w-3.5 h-3.5" /> Opacidad capa</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{Math.round(tileOpacity * 100)}%</span>
                  </label>
                  <Slider
                    value={[tileOpacity]}
                    onValueChange={([v]) => setTileOpacity(v)}
                    min={0.1}
                    max={1}
                    step={0.05}
                    data-testid="slider-tile-opacity"
                  />
                </div>
              )}

              {/* Action buttons */}
              <div className="grid grid-cols-2 gap-2">
                <Link href={`/parcel/${parcel.id}/indices`}>
                  <Button className="w-full" data-testid="btn-full-analysis">Ver Análisis</Button>
                </Link>
                <Link href={`/parcel/${parcel.id}/compare`}>
                  <Button variant="outline" className="w-full" data-testid="btn-compare">
                    <ArrowLeftRight className="w-4 h-4 mr-1" /> Comparar
                  </Button>
                </Link>
              </div>

              {/* ── Polygon edit controls (owner only) ──────────────────── */}
              {!!(user && (parcel.userId === user.id || user.role === "admin")) && (
                <div className="border-t border-border/60 pt-3 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <ScanLine className="w-3.5 h-3.5" /> Límite de la parcela
                  </p>
                  {editPolygonMode ? (
                    <div className="space-y-2">
                      <p className="text-[11px] text-muted-foreground">
                        {polygonCoords.length > 0
                          ? "Arrastra los vértices del polígono para ajustar el límite. Haz clic en un vértice para eliminarlo."
                          : "Usa la herramienta de dibujo en el mapa para trazar el límite de la parcela."}
                      </p>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="flex-1"
                          disabled={updatePolygonMutation.isPending}
                          onClick={() => {
                            const coords = pendingPolygonCoords ?? polygonCoords;
                            if (coords.length >= 3) updatePolygonMutation.mutate(coords);
                          }}
                          data-testid="button-save-polygon"
                        >
                          {updatePolygonMutation.isPending ? (
                            <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Guardando…</>
                          ) : (
                            <><Check className="w-3.5 h-3.5 mr-1" /> Guardar límites</>
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { setEditPolygonMode(false); setPendingPolygonCoords(null); }}
                          disabled={updatePolygonMutation.isPending}
                          data-testid="button-cancel-edit-polygon"
                        >
                          <X className="w-3.5 h-3.5 mr-1" /> Cancelar
                        </Button>
                      </div>
                      {updatePolygonMutation.isError && (
                        <p className="text-xs text-destructive">{(updatePolygonMutation.error as Error).message}</p>
                      )}
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() => { setEditPolygonMode(true); setPendingPolygonCoords(null); }}
                        data-testid="button-edit-polygon"
                      >
                        <ScanLine className="w-3.5 h-3.5 mr-1" />
                        {polygonCoords.length > 0 ? "Editar límites" : "Dibujar límites"}
                      </Button>
                      {polygonCoords.length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive border-destructive/40 hover:bg-destructive/10"
                          onClick={() => setShowDeletePolygonDialog(true)}
                          data-testid="button-delete-polygon"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2 relative z-10">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full">
            {/* ── Nivel 1: Categorías ─────────────────────────────────────────── */}
            <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 mb-1">
              <div className="flex gap-1.5 min-w-max pb-1">
                {/* Campo */}
                <button
                  onClick={() => setActiveTab("crop")}
                  data-testid="cat-campo"
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap border ${activeCategory === "campo" ? "bg-green-600 text-white border-green-600 shadow-sm" : "bg-background text-muted-foreground border-border hover:border-green-400 hover:text-green-700"}`}
                >
                  <Sprout className="w-3.5 h-3.5" /> Campo
                </button>
                {/* Nutrición */}
                <button
                  onClick={() => setActiveTab("fertilization")}
                  data-testid="cat-nutricion"
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap border ${activeCategory === "nutricion" ? "bg-emerald-600 text-white border-emerald-600 shadow-sm" : "bg-background text-muted-foreground border-border hover:border-emerald-400 hover:text-emerald-700"}`}
                >
                  <FlaskConical className="w-3.5 h-3.5" /> Nutrición
                </button>
                {/* Agua */}
                <button
                  onClick={() => setActiveTab("water")}
                  data-testid="cat-agua"
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap border ${activeCategory === "agua" ? "bg-blue-600 text-white border-blue-600 shadow-sm" : "bg-background text-muted-foreground border-border hover:border-blue-400 hover:text-blue-700"}`}
                >
                  <Droplets className="w-3.5 h-3.5" /> Agua
                </button>
                {/* Economía */}
                <button
                  onClick={() => setActiveTab("costs")}
                  data-testid="cat-economia"
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap border ${activeCategory === "economia" ? "bg-amber-600 text-white border-amber-600 shadow-sm" : "bg-background text-muted-foreground border-border hover:border-amber-400 hover:text-amber-700"}`}
                >
                  <DollarSign className="w-3.5 h-3.5" /> Economía
                </button>
                {/* Precisión */}
                <button
                  onClick={() => setActiveTab("mvz")}
                  data-testid="cat-precision"
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap border ${activeCategory === "precision" ? "bg-purple-600 text-white border-purple-600 shadow-sm" : "bg-background text-muted-foreground border-border hover:border-purple-400 hover:text-purple-700"}`}
                >
                  <ScanLine className="w-3.5 h-3.5" /> Precisión
                </button>
                {/* Seguimiento */}
                <button
                  onClick={() => setActiveTab("historial")}
                  data-testid="cat-seguimiento"
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap border ${activeCategory === "seguimiento" ? "bg-teal-600 text-white border-teal-600 shadow-sm" : "bg-background text-muted-foreground border-border hover:border-teal-400 hover:text-teal-700"}`}
                >
                  <TrendingUp className="w-3.5 h-3.5" /> Seguimiento
                </button>
                {/* Agente IA — lugar privilegiado, color primario de la marca */}
                <button
                  onClick={() => setActiveTab("assistant")}
                  data-testid="cat-agente"
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap border ${activeCategory === "agente" ? "bg-primary text-primary-foreground border-primary shadow-sm" : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-primary"}`}
                >
                  <Sparkles className="w-3.5 h-3.5" /> Agente IA
                </button>
                <Link
                  href={`/parcel/${parcel.id}/field-log`}
                  data-testid="link-field-log"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap border bg-background text-muted-foreground border-border hover:border-teal-400 hover:text-teal-700"
                >
                  <BookOpen className="w-3.5 h-3.5" /> Bitácora
                </Link>
              </div>
            </div>

            {/* ── Nivel 2: Sub-tabs de la categoría activa ───────────────────── */}
            <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
              <TabsList className="w-max justify-start border-b rounded-none h-auto p-0 bg-background mb-4 md:mb-6 gap-2 md:gap-4 min-w-max">

                {/* CAMPO */}
                {activeCategory === "campo" && (<>
                  <TabsTrigger value="crop" className="rounded-none border-b-2 border-transparent data-[state=active]:border-green-600 data-[state=active]:bg-transparent px-2 md:px-0 py-2 text-xs md:text-sm whitespace-nowrap">
                    <Sprout className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" /> Cultivo
                  </TabsTrigger>
                  <TabsTrigger value="soil" className="rounded-none border-b-2 border-transparent data-[state=active]:border-green-600 data-[state=active]:bg-transparent px-2 md:px-0 py-2 text-xs md:text-sm whitespace-nowrap">
                    <Layers className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" /> Suelo
                  </TabsTrigger>
                  <TabsTrigger value="biology" data-testid="tab-biology" className="rounded-none border-b-2 border-transparent data-[state=active]:border-green-600 data-[state=active]:bg-transparent px-2 md:px-0 py-2 text-xs md:text-sm whitespace-nowrap">
                    <FlaskConical className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" /> Biología
                  </TabsTrigger>
                  <TabsTrigger value="tillage" className="rounded-none border-b-2 border-transparent data-[state=active]:border-green-600 data-[state=active]:bg-transparent px-2 md:px-0 py-2 text-xs md:text-sm whitespace-nowrap">
                    <Tractor className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" /> Labranza
                  </TabsTrigger>
                  <TabsTrigger value="rotation" className="rounded-none border-b-2 border-transparent data-[state=active]:border-green-600 data-[state=active]:bg-transparent px-2 md:px-0 py-2 text-xs md:text-sm whitespace-nowrap">
                    <RotateCcw className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" /> Rotación
                  </TabsTrigger>
                  <TabsTrigger value="animals" className="rounded-none border-b-2 border-transparent data-[state=active]:border-green-600 data-[state=active]:bg-transparent px-2 md:px-0 py-2 text-xs md:text-sm whitespace-nowrap">
                    <Beef className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" /> Animales
                  </TabsTrigger>
                </>)}

                {/* NUTRICIÓN */}
                {activeCategory === "nutricion" && (<>
                  <TabsTrigger value="fertilization" data-testid="tab-fertilization" className="rounded-none border-b-2 border-transparent data-[state=active]:border-emerald-600 data-[state=active]:bg-transparent px-2 md:px-0 py-2 text-xs md:text-sm whitespace-nowrap">
                    <Calculator className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" /> Fertilización
                  </TabsTrigger>
                  <TabsTrigger value="amendments" data-testid="tab-amendments" className="rounded-none border-b-2 border-transparent data-[state=active]:border-emerald-600 data-[state=active]:bg-transparent px-2 md:px-0 py-2 text-xs md:text-sm whitespace-nowrap">
                    <FlaskConical className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" /> Enmiendas
                  </TabsTrigger>
                  <TabsTrigger value="insumos" data-testid="tab-insumos" className="rounded-none border-b-2 border-transparent data-[state=active]:border-emerald-600 data-[state=active]:bg-transparent px-2 md:px-0 py-2 text-xs md:text-sm whitespace-nowrap">
                    <Package className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" /> Insumos
                  </TabsTrigger>
                </>)}

                {/* AGUA */}
                {activeCategory === "agua" && (<>
                  <TabsTrigger value="water" className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-600 data-[state=active]:bg-transparent px-2 md:px-0 py-2 text-xs md:text-sm whitespace-nowrap">
                    <Droplets className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" /> Agua y Clima
                  </TabsTrigger>
                  {activeModules.includes("riego-inteligente") && (
                    <TabsTrigger value="smart-irrigation" data-testid="tab-smart-irrigation" className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-600 data-[state=active]:bg-transparent px-2 md:px-0 py-2 text-xs md:text-sm whitespace-nowrap">
                      <Droplets className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" /> Riego Inteligente
                    </TabsTrigger>
                  )}
                  <TabsTrigger value="climate-risk" data-testid="tab-climate-risk" className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-600 data-[state=active]:bg-transparent px-2 md:px-0 py-2 text-xs md:text-sm whitespace-nowrap">
                    <Thermometer className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" /> Riesgo Climático
                  </TabsTrigger>
                </>)}

                {/* ECONOMÍA */}
                {activeCategory === "economia" && (<>
                  <TabsTrigger value="costs" className="rounded-none border-b-2 border-transparent data-[state=active]:border-amber-600 data-[state=active]:bg-transparent px-2 md:px-0 py-2 text-xs md:text-sm whitespace-nowrap">
                    <Wallet className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" /> Costos
                  </TabsTrigger>
                  <TabsTrigger value="livelihood" className="rounded-none border-b-2 border-transparent data-[state=active]:border-amber-600 data-[state=active]:bg-transparent px-2 md:px-0 py-2 text-xs md:text-sm whitespace-nowrap">
                    <DollarSign className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" /> Comercialización
                  </TabsTrigger>
                </>)}

                {/* PRECISIÓN */}
                {activeCategory === "precision" && (<>
                  <TabsTrigger value="mvz" data-testid="tab-mvz" className="rounded-none border-b-2 border-transparent data-[state=active]:border-purple-600 data-[state=active]:bg-transparent px-2 md:px-0 py-2 text-xs md:text-sm whitespace-nowrap">
                    <ScanLine className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" /> Muestreo MVZ
                  </TabsTrigger>
                  {activeModules.includes("drones") && (
                    <TabsTrigger value="drones" data-testid="tab-drones" className="rounded-none border-b-2 border-transparent data-[state=active]:border-purple-600 data-[state=active]:bg-transparent px-2 md:px-0 py-2 text-xs md:text-sm whitespace-nowrap">
                      <Plane className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" /> Drones
                    </TabsTrigger>
                  )}
                  {activeModules.includes("iot") && (
                    <TabsTrigger value="iot" data-testid="tab-iot" className="rounded-none border-b-2 border-transparent data-[state=active]:border-purple-600 data-[state=active]:bg-transparent px-2 md:px-0 py-2 text-xs md:text-sm whitespace-nowrap">
                      <Cpu className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" /> Sensores IoT
                    </TabsTrigger>
                  )}
                </>)}

                {/* SEGUIMIENTO */}
                {activeCategory === "seguimiento" && (<>
                  <TabsTrigger value="fenologia" data-testid="tab-fenologia" className="rounded-none border-b-2 border-transparent data-[state=active]:border-teal-600 data-[state=active]:bg-transparent px-2 md:px-0 py-2 text-xs md:text-sm whitespace-nowrap">
                    <Sprout className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" /> Fenología
                  </TabsTrigger>
                  <TabsTrigger value="historial" data-testid="tab-historial" className="rounded-none border-b-2 border-transparent data-[state=active]:border-teal-600 data-[state=active]:bg-transparent px-2 md:px-0 py-2 text-xs md:text-sm whitespace-nowrap">
                    <History className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" /> Historial
                  </TabsTrigger>
                  <TabsTrigger value="rendimiento" data-testid="tab-rendimiento" className="rounded-none border-b-2 border-transparent data-[state=active]:border-teal-600 data-[state=active]:bg-transparent px-2 md:px-0 py-2 text-xs md:text-sm whitespace-nowrap">
                    <TrendingUp className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" /> Rendimiento
                  </TabsTrigger>
                </>)}

                {/* AGENTE IA — tab único, se activa directamente */}
                {activeCategory === "agente" && (
                  <TabsTrigger value="assistant" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-2 md:px-0 py-2 text-xs md:text-sm whitespace-nowrap text-primary font-semibold">
                    <Sparkles className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" /> Agente de Razonamiento
                  </TabsTrigger>
                )}

              </TabsList>
            </div>

            <TabsContent value="crop" className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
              <SoilHealthSummary parcelId={id!} userId={user?.id || ""} onOpen={() => setActiveTab("soil")} />
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>Índices de Vegetación — Comparativa</CardTitle>
                      <CardDescription>
                        8 índices Sentinel-2 simultáneos
                        {plantingDate && !isPrePlanting && " • curva NDVI ideal en gris"}
                        {plantingDate && ` • Siembra: ${formatMexicoDate(plantingDate)}`}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      {chartIndicesLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                      {deviation && (
                        <Badge 
                          variant="outline" 
                          className={
                            deviation.status === "adelantado" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                            deviation.status === "atrasado" ? "bg-amber-50 text-amber-700 border-amber-200" :
                            deviation.status === "normal" ? "bg-primary/10 text-primary border-primary/20" :
                            "bg-gray-50 text-gray-700 border-gray-200"
                          }
                          data-testid="badge-deviation"
                        >
                          {deviation.label}
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4 mb-4 text-xs flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-primary"></div>
                      <span className="text-muted-foreground">{selectedIndex.toUpperCase()} Real (Satelital)</span>
                    </div>
                    {selectedIndex === "ndvi" && plantingDate && !isPrePlanting ? (
                      <div className="flex items-center gap-1.5">
                        <div className="w-6 border-t-2 border-dashed border-gray-400"></div>
                        <span className="text-muted-foreground">Curva Ideal ({parcel.crop})</span>
                      </div>
                    ) : selectedIndex === "ndvi" && plantingDate && isPrePlanting ? (
                      <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                        Pre-siembra - Siembra programada: {formatMexicoDate(plantingDate)}
                      </Badge>
                    ) : selectedIndex === "ndvi" ? (
                      <span className="text-muted-foreground italic">
                        Sin fecha de siembra - curva ideal no disponible
                      </span>
                    ) : null}
                    {currentExpectedStage && !isPrePlanting && selectedIndex === "ndvi" && (
                      <div className="ml-auto">
                        <Badge variant="secondary" className="text-xs">
                          Etapa: {currentExpectedStage}
                        </Badge>
                      </div>
                    )}
                  </div>
                  {/* Time-range selector */}
                  <div className="flex flex-wrap gap-1 mb-3">
                    {([
                      { value: "3m",        label: "3M" },
                      { value: "6m",        label: "6M" },
                      { value: "1y",        label: "1A" },
                      { value: "2y",        label: "2A" },
                      { value: "5y",        label: "5A" },
                      { value: "10y",       label: "10A" },
                      { value: "since2015", label: "Desde 2015" },
                    ] as const).map(({ value, label }) => (
                      <button
                        key={value}
                        onClick={() => setChartTimeRange(value)}
                        data-testid={`btn-range-${value}`}
                        className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors ${
                          chartTimeRange === value
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:bg-muted/80"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={indexChartData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                        <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} domain={[-1, 1.5]} tickFormatter={(v: number) => v.toFixed(1)} />
                        <Tooltip
                          contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px', fontSize: 12 }}
                          formatter={(value: number, name: string) => {
                            if (name === "ideal") return [value?.toFixed(3), "NDVI Ideal"];
                            return [value?.toFixed(3), (name as string).toUpperCase()];
                          }}
                          labelFormatter={(label, payload) => {
                            const stage = payload?.[0]?.payload?.stage;
                            return stage ? `${label} • ${stage}` : label;
                          }}
                        />
                        {/* All 8 indices — render only active ones */}
                        {activeIndices.has("ndvi")  && <Line type="monotone" dataKey="ndvi"  stroke="#16a34a" strokeWidth={2} dot={false} name="ndvi"  />}
                        {activeIndices.has("evi")   && <Line type="monotone" dataKey="evi"   stroke="#065f46" strokeWidth={2} dot={false} name="evi"   />}
                        {activeIndices.has("ndmi")  && <Line type="monotone" dataKey="ndmi"  stroke="#2563eb" strokeWidth={2} dot={false} name="ndmi"  />}
                        {activeIndices.has("ndre")  && <Line type="monotone" dataKey="ndre"  stroke="#ea580c" strokeWidth={2} dot={false} name="ndre"  />}
                        {activeIndices.has("gndvi") && <Line type="monotone" dataKey="gndvi" stroke="#0d9488" strokeWidth={2} dot={false} name="gndvi" />}
                        {activeIndices.has("msavi") && <Line type="monotone" dataKey="msavi" stroke="#84cc16" strokeWidth={2} dot={false} name="msavi" />}
                        {activeIndices.has("savi")  && <Line type="monotone" dataKey="savi"  stroke="#ca8a04" strokeWidth={2} dot={false} name="savi"  />}
                        {activeIndices.has("ndwi")  && <Line type="monotone" dataKey="ndwi"  stroke="#0891b2" strokeWidth={2} dot={false} name="ndwi"  />}
                        {/* NDVI ideal curve when planting date is set */}
                        {plantingDate && !isPrePlanting && (
                          <Line type="monotone" dataKey="ideal" stroke="#9ca3af" strokeWidth={1.5} strokeDasharray="5 5" dot={false} name="ideal" />
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  {/* Clickable colour legend — click to toggle each index */}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {([
                      { key: "ndvi",  label: "NDVI",  color: "#16a34a" },
                      { key: "evi",   label: "EVI",   color: "#065f46" },
                      { key: "ndmi",  label: "NDMI",  color: "#2563eb" },
                      { key: "ndre",  label: "NDRE",  color: "#ea580c" },
                      { key: "gndvi", label: "GNDVI", color: "#0d9488" },
                      { key: "msavi", label: "MSAVI", color: "#84cc16" },
                      { key: "savi",  label: "SAVI",  color: "#ca8a04" },
                      { key: "ndwi",  label: "NDWI",  color: "#0891b2" },
                    ] as const).map(({ key, label, color }) => {
                      const active = activeIndices.has(key);
                      return (
                        <button
                          key={key}
                          onClick={() => toggleIndex(key)}
                          data-testid={`toggle-index-${key}`}
                          title={active ? `Ocultar ${label}` : `Mostrar ${label}`}
                          className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border transition-all ${
                            active
                              ? "border-transparent text-white"
                              : "border-border text-muted-foreground bg-background opacity-40 hover:opacity-60"
                          }`}
                          style={active ? { backgroundColor: color } : {}}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              <div className={`grid gap-4 ${selectedIndex === "ndvi" && plantingDate && !isPrePlanting ? "grid-cols-2 md:grid-cols-4" : "grid-cols-2"}`}>
                <Card data-testid="card-current-index">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      {selectedIndex.toUpperCase()} Actual
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-current-index">{currentIndexValue.toFixed(2)}</div>
                    <p className="text-xs text-muted-foreground mt-1" data-testid="text-index-description">
                      {selectedIndex === "ndvi" ? (
                        currentIndexValue >= 0.7 ? "Vegetación densa y saludable" : 
                        currentIndexValue >= 0.5 ? "Vegetación moderada" :
                        currentIndexValue >= 0.3 ? "Vegetación dispersa" : "Suelo expuesto"
                      ) : selectedIndex === "evi" ? (
                        currentIndexValue >= 0.6 ? "Alta actividad fotosintética" :
                        currentIndexValue >= 0.3 ? "Actividad moderada" : "Baja actividad"
                      ) : (
                        currentIndexValue >= 0.2 ? "Contenido hídrico alto" :
                        currentIndexValue >= 0 ? "Contenido hídrico normal" : "Estrés hídrico"
                      )}
                    </p>
                  </CardContent>
                </Card>
                
                {selectedIndex === "ndvi" && plantingDate && !isPrePlanting && (
                  <Card 
                    data-testid="card-ideal-comparison"
                    className={deviation?.status === "adelantado" ? "border-emerald-200 bg-emerald-50/50" : 
                               deviation?.status === "atrasado" ? "border-amber-200 bg-amber-50/50" : "border-primary/20 bg-primary/5"}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">Comparación Ideal</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-baseline gap-2">
                        <span className="text-lg font-bold" data-testid="text-actual-value">{currentIndexValue.toFixed(2)}</span>
                        <span className="text-muted-foreground text-xs">vs</span>
                        <span className="text-lg font-semibold text-muted-foreground" data-testid="text-ideal-value">{latestIdealNdvi?.toFixed(2) ?? "—"}</span>
                      </div>
                      {deviation && (
                        <p className={`text-xs mt-1 flex items-center gap-1 font-medium ${
                          deviation.status === "adelantado" ? "text-emerald-600" :
                          deviation.status === "atrasado" ? "text-amber-600" : "text-primary"
                        }`} data-testid="text-deviation">
                          {deviation.status === "adelantado" ? "↑" : deviation.status === "atrasado" ? "↓" : "≈"} {deviation.label}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}
                
                {selectedIndex === "ndvi" && plantingDate && !isPrePlanting && currentExpectedStage && (
                  <Card className="border-primary/20 bg-primary/5" data-testid="card-phenological-stage">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">Etapa Fenológica</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-lg font-semibold text-primary" data-testid="phenological-stage">{currentExpectedStage}</div>
                      <p className="text-xs text-muted-foreground mt-1" data-testid="text-cycle-progress">
                        Día {daysSincePlanting} de {cropCurve.cycleDays}
                      </p>
                    </CardContent>
                  </Card>
                )}
                
                <Card data-testid="card-yield-estimate">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      {selectedIndex === "ndmi" ? "Estado Hídrico" : "Rendimiento Estimado"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {selectedIndex === "ndmi" ? (
                      <>
                        <div className="text-2xl font-bold" data-testid="text-yield">
                          {currentIndexValue >= 0.3 ? "Óptimo" :
                           currentIndexValue >= 0.1 ? "Adecuado" :
                           currentIndexValue >= 0.0 ? "Bajo" :
                           currentIndexValue >= -0.2 ? "Deficiente" : "Crítico"}
                        </div>
                        <p className={`text-xs mt-1 flex items-center gap-1 ${
                          currentIndexValue >= 0.1 ? "text-green-600" :
                          currentIndexValue >= 0.0 ? "text-yellow-600" : "text-red-600"
                        }`} data-testid="text-yield-source">
                          {currentIndexValue >= 0.1 ? <Droplets className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                          {currentIndexValue >= 0.1 ? "Humedad foliar suficiente" :
                           currentIndexValue >= 0.0 ? "Monitorear riego" : "Riesgo de estrés hídrico"}
                        </p>
                      </>
                    ) : (() => {
                      const cropYields: Record<string, number> = {
                        "Maíz": 8, "Frijol": 2, "Trigo": 5, "Sorgo": 6, "Soja": 3.5,
                        "Arroz": 7, "Girasol": 2.5, "Cebada": 4, "Avena": 3.5, "Algodón": 3,
                        "Caña de azúcar": 80, "Papa": 25, "Tomate": 40, "Chile": 15,
                        "Aguacate": 10, "Café": 1.5, "Cacao": 1, "Mango": 12, "Naranja": 20,
                      };
                      const cropName = parcel.crop || "Genérico";
                      const maxYield = cropYields[cropName] || 5;
                      const normalizedValue = Math.max(0, selectedIndex === "evi"
                        ? currentIndexValue / 0.8
                        : currentIndexValue);
                      const yieldEstimate = Math.max(0, normalizedValue * maxYield).toFixed(1);
                      return (
                        <>
                          <div className="text-2xl font-bold" data-testid="text-yield">{yieldEstimate} t/ha</div>
                          <p className="text-xs text-green-600 mt-1 flex items-center gap-1" data-testid="text-yield-source">
                            <ArrowUpRight className="w-3 h-3" /> Basado en {selectedIndex.toUpperCase()} de {cropName}
                          </p>
                        </>
                      );
                    })()}
                  </CardContent>
                </Card>
              </div>

              {/* ── Historial de Ciclos ── */}
              <CycleHistorialSection parcelId={parcel.id} />

            </TabsContent>

            <TabsContent value="soil" className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
              <SoilReportRepairs parcelId={id || ""} />
               {(() => {
                  const allSoilAnalyses: SoilAnalysis[] = soilAnalysisData?.analyses || [];
                  const soilAnalyses: SoilAnalysis[] = distinctSoilAnalyses(allSoilAnalyses);
                  const exactDuplicateGroups = new Map<string, SoilAnalysis[]>();
                  allSoilAnalyses.forEach((analysis) => {
                    const values = [
                      mexicoDateKey(analysis.analysisDate),
                      ...soilMeasurementKeys.map(key => {
                        const value = analysis[key];
                        if (value == null || String(value).trim() === "") return null;
                        const number = Number(value);
                        // A legacy zero was not a measured N total in some reports.
                        // Treat it as unreported for duplicate review, never as evidence.
                        if (key === "nitrogenTotal" && number === 0) return null;
                        return Number.isFinite(number) ? number : String(value);
                      }),
                    ];
                    const duplicateKey = JSON.stringify(values);
                    exactDuplicateGroups.set(duplicateKey, [...(exactDuplicateGroups.get(duplicateKey) || []), analysis]);
                  });
                  const exactDuplicates = Array.from(exactDuplicateGroups.values()).filter(group => group.length > 1);
                  const latestAnalysis: SoilAnalysis | undefined = soilAnalyses[0];
                  const latestEvidence = soilEvidence(latestAnalysis) as SoilEvidenceView | null;
                 const hasData = !!latestAnalysis;
                 const currentCrop = parcel?.crop || "Soja";

                 // Crop-specific thresholds matching backend generateSoilAlerts
                 const cropRanges: Record<string, { om: [number, number]; n: [number, number]; p: [number, number]; k: [number, number]; ph: [number, number] }> = {
                   "Soja": { om: [2.5, 5.0], n: [0.15, 0.30], p: [15, 40], k: [120, 200], ph: [5.8, 7.0] },
                   "Maíz": { om: [3.0, 5.0], n: [0.15, 0.35], p: [20, 50], k: [150, 250], ph: [5.8, 7.0] },
                   "Trigo": { om: [2.0, 4.5], n: [0.12, 0.28], p: [15, 35], k: [100, 180], ph: [6.0, 7.5] },
                   "Girasol": { om: [2.0, 4.0], n: [0.10, 0.25], p: [12, 30], k: [100, 160], ph: [6.0, 7.5] },
                 };
                 const ranges = cropRanges[currentCrop] || cropRanges["Soja"];

                 const getNutrientLevel = (value: number, low: number, high: number): { label: string; color: string; width: number } => {
                   if (value < low) return { label: "Bajo", color: "bg-red-500", width: Math.max(20, (value / low) * 40) };
                   if (value > high) return { label: "Alto", color: "bg-blue-500", width: Math.min(100, 60 + ((value - high) / high) * 40) };
                   return { label: "Óptimo", color: "bg-green-500", width: 40 + ((value - low) / (high - low)) * 20 };
                 };

                 const organicMatter = latestAnalysis?.organicMatter ? parseFloat(latestAnalysis.organicMatter) : null;
                  const nitrogen = latestEvidence?.nitrogenTotal ?? null;
                  const inorganicNitrogen = latestEvidence?.nitrogenInorganic ?? null;
                 const phosphorus = latestAnalysis?.phosphorus ? parseFloat(latestAnalysis.phosphorus) : null;
                 const potassium = latestAnalysis?.potassium ? parseFloat(latestAnalysis.potassium) : null;
                 const ph = latestAnalysis?.ph ? parseFloat(latestAnalysis.ph) : null;
                 const ec = latestAnalysis?.electricConductivity ? parseFloat(latestAnalysis.electricConductivity) : null;

                 const omLevel = organicMatter ? getNutrientLevel(organicMatter, ranges.om[0], ranges.om[1]) : null;
                 const nLevel = nitrogen ? getNutrientLevel(nitrogen, ranges.n[0], ranges.n[1]) : null;
                 const pLevel = phosphorus ? getNutrientLevel(phosphorus, ranges.p[0], ranges.p[1]) : null;
                 const kLevel = potassium ? getNutrientLevel(potassium, ranges.k[0], ranges.k[1]) : null;

                  return (
                    <>
                     <div className="flex flex-col gap-6 lg:flex-row">
                      <div className="w-full space-y-4 lg:w-1/3">
                        <img src={soilImage} className="w-full rounded-lg shadow-sm" alt="Textura del suelo" />
                        <Button 
                          variant="outline" 
                          className="w-full"
                          onClick={() => setShowSoilModal(true)}
                          data-testid="btn-upload-soil-analysis"
                        >
                          <Plus className="w-4 h-4 mr-2" />
                          Subir Análisis de Laboratorio
                        </Button>
                        {hasData && latestAnalysis && (
                          <div className="p-3 bg-secondary/20 rounded-lg text-sm">
                            <div className="flex items-center gap-2 text-muted-foreground mb-1">
                              <Calendar className="w-4 h-4" />
                              <span>Último análisis</span>
                            </div>
                            <p className="font-medium">{formatMexicoDate(latestAnalysis.analysisDate)}</p>
                            {latestAnalysis.labName && <p className="text-xs text-muted-foreground">{latestAnalysis.labName}</p>}
                          </div>
                        )}
                     </div>
                      <div className="flex-1 space-y-4">
                        <Card>
                          <CardHeader className="pb-2">
                            <CardTitle className="flex items-center gap-2">
                              <FlaskConical className="w-5 h-5 text-amber-600" />
                              Composición del Suelo
                            </CardTitle>
                            {!hasData && <CardDescription>Sube un análisis de laboratorio para ver datos reales</CardDescription>}
                          </CardHeader>
                          <CardContent>
                            {hasData ? (
                              <div className="space-y-4">
                                {organicMatter !== null && omLevel && (
                                  <div className="space-y-1">
                                    <div className="flex justify-between text-sm">
                                      <span>Materia Orgánica</span>
                                      <span className="font-bold">{organicMatter.toFixed(1)}%</span>
                                    </div>
                                    <div className="h-2 w-full bg-secondary/30 rounded-full overflow-hidden">
                                      <div className={`h-full ${omLevel.color}`} style={{ width: `${omLevel.width}%` }} />
                                    </div>
                                    <p className="text-xs text-muted-foreground">{omLevel.label} (óptimo para {currentCrop}: {ranges.om[0]}-{ranges.om[1]}%)</p>
                                  </div>
                                )}
                                {nitrogen !== null && nLevel && (
                                  <div className="space-y-1">
                                    <div className="flex justify-between text-sm">
                                      <span>Nitrógeno Total (N)</span>
                                      <span className="font-bold">{nitrogen.toFixed(3)}%</span>
                                    </div>
                                    <div className="h-2 w-full bg-secondary/30 rounded-full overflow-hidden">
                                      <div className={`h-full ${nLevel.color}`} style={{ width: `${nLevel.width}%` }} />
                                    </div>
                                    <p className="text-xs text-muted-foreground">{nLevel.label}</p>
                                  </div>
                                )}
                                {latestEvidence?.nitrogenTotalCaveat && (
                                  <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800" data-testid="text-nitrogen-total-unvalidated">{latestEvidence.nitrogenTotalCaveat}</p>
                                )}
                                {inorganicNitrogen !== null && (
                                  <div className="rounded-md bg-secondary/20 p-3 text-sm" data-testid="text-nitrogen-inorganic">
                                    <div className="flex justify-between gap-3">
                                      <span>N inorgánico (mg/kg)</span>
                                      <strong>{inorganicNitrogen.toFixed(2)} mg/kg</strong>
                                    </div>
                                    {latestEvidence?.inorganicSource && <p className="mt-1 text-xs text-muted-foreground">Origen del dato: {latestEvidence.inorganicSource}</p>}
                                  </div>
                                )}
                                {phosphorus !== null && pLevel && (
                                  <div className="space-y-1">
                                    <div className="flex justify-between text-sm">
                                      <span>Fósforo (P)</span>
                                      <span className="font-bold">{phosphorus.toFixed(1)} ppm</span>
                                    </div>
                                    <div className="h-2 w-full bg-secondary/30 rounded-full overflow-hidden">
                                      <div className={`h-full ${pLevel.color}`} style={{ width: `${pLevel.width}%` }} />
                                    </div>
                                    <p className="text-xs text-muted-foreground">{pLevel.label} (óptimo para {currentCrop}: {ranges.p[0]}-{ranges.p[1]} ppm)</p>
                                  </div>
                                )}
                                {potassium !== null && kLevel && (
                                  <div className="space-y-1">
                                    <div className="flex justify-between text-sm">
                                      <span>Potasio (K)</span>
                                      <span className="font-bold">{potassium.toFixed(0)} ppm</span>
                                    </div>
                                    <div className="h-2 w-full bg-secondary/30 rounded-full overflow-hidden">
                                      <div className={`h-full ${kLevel.color}`} style={{ width: `${kLevel.width}%` }} />
                                    </div>
                                    <p className="text-xs text-muted-foreground">{kLevel.label} (óptimo para {currentCrop}: {ranges.k[0]}-{ranges.k[1]} ppm)</p>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="text-center py-8 text-muted-foreground">
                                <FlaskConical className="w-12 h-12 mx-auto mb-3 opacity-30" />
                                <p>No hay análisis de suelo registrados</p>
                                <p className="text-sm">Sube tu primer análisis de laboratorio</p>
                              </div>
                            )}
                          </CardContent>
                        </Card>

                        {hasData && (ph !== null || ec !== null) && (
                          <Card>
                            <CardHeader className="pb-2">
                              <CardTitle>Propiedades Físico-Químicas</CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {ph !== null && (
                                  <div className="p-3 bg-secondary/20 rounded-lg">
                                    <p className="text-sm text-muted-foreground">pH del Suelo</p>
                                    <p className="text-2xl font-bold">{ph.toFixed(2)}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {ph < 5.5 ? "Ácido" : ph > 7.5 ? "Alcalino" : "Neutro"}
                                    </p>
                                  </div>
                                )}
                                {ec !== null && (
                                  <div className="p-3 bg-secondary/20 rounded-lg">
                                    <p className="text-sm text-muted-foreground">Conductividad Eléctrica</p>
                                    <p className="text-2xl font-bold">{ec.toFixed(2)} dS/m</p>
                                    <p className="text-xs text-muted-foreground">
                                      {ec < 2 ? "Normal" : ec < 4 ? "Moderada" : "Alta salinidad"}
                                    </p>
                                  </div>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        )}
                        {latestEvidence && [latestEvidence.sand, latestEvidence.silt, latestEvidence.clay].some(value => value !== null) && (
                          <Card data-testid="card-latest-soil-texture">
                            <CardHeader className="pb-2"><CardTitle className="text-base">Textura reportada</CardTitle></CardHeader>
                            <CardContent className="grid grid-cols-3 gap-3 text-sm">
                              <div>Arena <strong className="block">{latestEvidence.sand === null ? "—" : `${latestEvidence.sand.toFixed(2)}%`}</strong></div>
                              <div>Limo <strong className="block">{latestEvidence.silt === null ? "—" : `${latestEvidence.silt.toFixed(2)}%`}</strong></div>
                              <div>Arcilla <strong className="block">{latestEvidence.clay === null ? "—" : `${latestEvidence.clay.toFixed(2)}%`}</strong></div>
                            </CardContent>
                          </Card>
                        )}
                     </div>
                    </div>
                     {exactDuplicates.length > 0 && <Card className="border-amber-300 bg-amber-50/60" data-testid="soil-exact-duplicates">
                       <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base text-amber-900"><AlertTriangle className="h-4 w-4" />Posibles duplicados</CardTitle><CardDescription>Revisa las mediciones y confirma qué análisis conservar. Un cero heredado en N total no equivale automáticamente a un dato medido.</CardDescription></CardHeader>
                       <CardContent className="space-y-3">
                         {soilMergeMutation.isError && <p role="alert" className="text-sm text-destructive">{(soilMergeMutation.error as Error).message}</p>}
                         {exactDuplicates.map((group, groupIndex) => <div key={groupIndex} className="rounded-lg border border-amber-200 bg-background/70 p-3">
                           <p className="mb-2 text-sm font-medium">{formatMexicoDate(group[0].analysisDate, { year: "numeric", month: "short", day: "numeric" })} · {group.length} registros</p>
                           {group.some(row => measuredNumber(row.nitrogenTotal) !== measuredNumber(group[0].nitrogenTotal)) &&
                             <p className="mb-2 text-xs text-amber-800">N total difiere entre cero y vacío. Revisa primero la corrección del informe mostrada arriba, o edita el análisis: si el laboratorio no reportó N total, déjalo vacío. Solo se permite fusionar cuando las mediciones guardadas sean iguales.</p>}
                           <div className="flex flex-wrap gap-2">{group.flatMap((keep, index) => group.slice(index + 1).map(duplicate => <Button key={`${keep.id}-${duplicate.id}`} size="sm" variant="outline" className="h-8 text-xs" disabled={soilMergeMutation.isPending || measuredNumber(keep.nitrogenTotal) !== measuredNumber(duplicate.nitrogenTotal)} onClick={() => { if (window.confirm("¿Fusionar estos análisis? Se conservarán las mediciones iguales y se combinarán las notas y el laboratorio.")) soilMergeMutation.mutate({ keepId: keep.id, duplicateId: duplicate.id }); }}>FUSIONAR · conservar {keep.labName || `#${keep.id.slice(0, 6)}`}</Button>))}</div>
                         </div>)}
                       </CardContent>
                     </Card>}
                     {soilAnalyses.length > 0 && (
                       <Card data-testid="card-soil-analysis-history">
                         <CardHeader className="pb-2">
                           <CardTitle className="text-base">Historial de análisis de suelo</CardTitle>
                           <CardDescription>{allSoilAnalyses.length} registros guardados, incluidos los posibles duplicados, para revisar o eliminar.</CardDescription>
                         </CardHeader>
                         <CardContent className="space-y-2">
                           {deleteSoilAnalysisMutation.isError && <p role="alert" className="text-sm text-destructive">{(deleteSoilAnalysisMutation.error as Error).message}</p>}
                           {clearUnreportedSoilN.isError && <p role="alert" className="text-sm text-destructive">{(clearUnreportedSoilN.error as Error).message}</p>}
                           {allSoilAnalyses.map((analysis) => {
                             const evidence = soilEvidence(analysis) as SoilEvidenceView | null;
                             if (!evidence) return null;
                             return <div key={analysis.id} className="rounded-lg border p-3" data-testid={`soil-analysis-history-${analysis.id}`}>
                               <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="text-sm font-medium">{formatMexicoDate(analysis.analysisDate, { year: "numeric", month: "short", day: "numeric" })}{analysis.labName ? ` · ${analysis.labName}` : ""}</div>
                                  <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" disabled={deleteSoilAnalysisMutation.isPending} onClick={() => { if (window.confirm("¿Eliminar este análisis de suelo? Esta acción no se puede deshacer.")) deleteSoilAnalysisMutation.mutate(analysis.id); }}><Trash2 className="mr-1 h-3.5 w-3.5" />Eliminar</Button>
                                  {measuredNumber(analysis.nitrogenTotal) === 0 && <Button variant="outline" size="sm" className="h-7 text-xs" disabled={clearUnreportedSoilN.isPending} onClick={() => {
                                    if (window.confirm("¿Confirmas que el laboratorio NO reportó N total y que este cero debe quedar vacío? Se conservará la revisión en auditoría y también se aplicará el N inorgánico explícito en las notas, si está pendiente."))
                                      clearUnreportedSoilN.mutate(analysis);
                                  }}>N total no reportado · dejar vacío</Button>}
                                 <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                   {evidence.nitrogenTotal !== null && <span>N total: {evidence.nitrogenTotal.toFixed(3)}%</span>}
                                   {evidence.nitrogenInorganic !== null && <span>N inorgánico: {evidence.nitrogenInorganic.toFixed(2)} mg/kg</span>}
                                   {evidence.ph !== null && <span>pH: {evidence.ph.toFixed(2)}</span>}
                                   {evidence.sand !== null && <span>Arena: {evidence.sand.toFixed(2)}%</span>}
                                   {evidence.silt !== null && <span>Limo: {evidence.silt.toFixed(2)}%</span>}
                                   {evidence.clay !== null && <span>Arcilla: {evidence.clay.toFixed(2)}%</span>}
                                 </div>
                               </div>
                               {evidence.nitrogenInorganic !== null && evidence.inorganicSource && <p className="mt-1 text-xs text-muted-foreground">Origen N inorgánico: {evidence.inorganicSource}</p>}
                               {evidence.nitrogenTotalCaveat && <p className="mt-1 text-xs text-amber-700">{evidence.nitrogenTotalCaveat}</p>}
                             </div>;
                           })}
                         </CardContent>
                       </Card>
                     )}
                    <SoilHealthAssessment
                      key={`${user?.id}:${id}`}
                      parcelId={id!}
                      userId={user?.id || ""}
                      onDirtyChange={dirty => { soilAssessmentDirty.current = dirty; }}
                      onBusyChange={busy => { soilAssessmentBusy.current = busy; }}
                    />
                    </>
                 );
               })()}
            </TabsContent>
            
            <TabsContent value="water" className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
               <Card>
                <CardHeader>
                  <CardTitle>Humedad del Suelo (%)</CardTitle>
                  <CardDescription>Medición diaria a 20cm de profundidad.</CardDescription>
                </CardHeader>
                <CardContent className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={moistureChartData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))' }} />
                      <Line type="monotone" dataKey="value" stroke="hsl(200 60% 50%)" strokeWidth={3} dot={{r: 4, fill: "hsl(200 60% 50%)"}} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Water Analysis Section */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Droplets className="w-5 h-5 text-blue-600" />
                        Análisis de Agua de Riego
                      </CardTitle>
                      <CardDescription>Calidad del agua según normas FAO 29</CardDescription>
                    </div>
                    <Button size="sm" onClick={() => setShowWaterModal(true)} data-testid="btn-add-water-analysis">
                      <Plus className="w-4 h-4 mr-2" />
                      Agregar Análisis
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {waterAnalysisData?.analyses?.length > 0 ? (
                    <div className="space-y-3">
                      {waterAnalysisData.analyses.map((wa: any) => {
                        const quality = getWaterQuality(wa);
                        return (
                          <div key={wa.id} className={`flex items-start gap-3 p-3 rounded-lg border ${quality.bg}`} data-testid={`water-analysis-card-${wa.id}`}>
                            <div className="flex-1 space-y-1.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-sm">
                                  {formatMexicoDate(wa.analysisDate)}
                                </span>
                                {wa.source && <Badge variant="outline" className="text-xs capitalize">{wa.source}</Badge>}
                                <Badge className={`text-xs ${quality.color} border bg-transparent`}>{quality.label}</Badge>
                              </div>
                              {wa.labName && <p className="text-xs text-muted-foreground">{wa.labName}</p>}
                              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 text-xs">
                                {wa.ph && <span className="text-muted-foreground">pH: <strong>{parseFloat(wa.ph).toFixed(1)}</strong></span>}
                                {wa.electricConductivity && <span className="text-muted-foreground">CE: <strong>{parseFloat(wa.electricConductivity).toFixed(2)} dS/m</strong></span>}
                                {wa.sar && <span className="text-muted-foreground">SAR: <strong>{parseFloat(wa.sar).toFixed(1)}</strong></span>}
                                {wa.tds && <span className="text-muted-foreground">TDS: <strong>{parseFloat(wa.tds).toFixed(0)} mg/L</strong></span>}
                                {wa.sodium && <span className="text-muted-foreground">Na: <strong>{parseFloat(wa.sodium).toFixed(0)} mg/L</strong></span>}
                                {wa.chlorides && <span className="text-muted-foreground">Cl: <strong>{parseFloat(wa.chlorides).toFixed(0)} mg/L</strong></span>}
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                              onClick={() => deleteWaterMutation.mutate(wa.id)}
                              disabled={deleteWaterMutation.isPending}
                              data-testid={`btn-delete-water-${wa.id}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-10 text-muted-foreground">
                      <Droplets className="w-12 h-12 mx-auto mb-3 opacity-25" />
                      <p className="font-medium">Sin análisis de agua registrados</p>
                      <p className="text-sm mt-1">Sube el análisis de tu fuente de riego para obtener alertas de calidad.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Biología del Suelo Tab */}
            <TabsContent value="biology" className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
              <SoilBiologyTab parcelId={id!} crop={parcel?.crop || ""} onOpenFieldAssessment={() => setActiveTab("soil")} />
            </TabsContent>

            {/* Labranza Tab */}
            <TabsContent value="tillage" className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
              {tillageLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
              ) : tillageData?.practices?.length > 0 ? (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="text-lg font-semibold">Prácticas de Labranza por Ciclo</h3>
                    <Button onClick={() => setShowTillageModal(true)} size="sm" data-testid="btn-add-tillage">
                      <Plus className="w-4 h-4 mr-2" /> Agregar Ciclo
                    </Button>
                  </div>
                  {tillageData.practices.map((t: any) => (
                    <Card key={t.id}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                          <Tractor className="w-4 h-4" />
                          Ciclo {t.cycleYear} - {t.cycleSeason === "primavera-verano" ? "Primavera-Verano" : "Otoño-Invierno"}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                          {t.desvaradora > 0 && <div className="text-sm"><span className="text-muted-foreground">Desvaradora:</span> {t.desvaradora} pasos</div>}
                          {t.barbecho > 0 && <div className="text-sm"><span className="text-muted-foreground">Barbecho:</span> {t.barbecho} pasos</div>}
                          {t.rastra > 0 && <div className="text-sm"><span className="text-muted-foreground">Rastra:</span> {t.rastra} pasos</div>}
                          {t.siembra > 0 && <div className="text-sm"><span className="text-muted-foreground">Siembra:</span> {t.siembra} pasos</div>}
                          {t.cosechadora > 0 && <div className="text-sm"><span className="text-muted-foreground">Cosechadora:</span> {t.cosechadora} pasos</div>}
                        </div>
                        <div className="border-t pt-3 flex gap-6 text-sm">
                          <div><span className="text-muted-foreground">Años reduciendo labranza:</span> {t.yearsReducingTillage || 0}</div>
                          <div><span className="text-muted-foreground">Quema rastrojos:</span> {t.burnsResidues ? "Sí" : "No"}</div>
                          <div><span className="text-muted-foreground">Rastrojo en campo:</span> {t.residuePercentLeft || 0}%</div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <Card>
                  <CardContent className="py-12 text-center">
                    <Tractor className="w-12 h-12 mx-auto mb-4 text-muted-foreground/30" />
                    <h3 className="text-lg font-medium mb-2">Sin datos de labranza</h3>
                    <p className="text-muted-foreground mb-4">Registra las prácticas de labranza de tus ciclos agrícolas</p>
                    <Button onClick={() => setShowTillageModal(true)} data-testid="btn-add-tillage-empty">
                      <Plus className="w-4 h-4 mr-2" /> Agregar Datos de Labranza
                    </Button>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Rotación Tab — T154: Visual planner */}
            <RotacionTab parcelId={id!} />

            {/* Animales Tab */}
            <TabsContent value="animals" className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
              {animalsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
              ) : animalsData?.animals ? (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="text-lg font-semibold">Integración Animal</h3>
                    <Button onClick={() => setShowAnimalsModal(true)} size="sm" variant="outline" data-testid="btn-edit-animals">
                      Editar
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                          <Beef className="w-4 h-4" /> Inventario Animal
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          {animalsData.animals.hasBovinos && <div className="flex justify-between"><span>Bovinos</span><span className="font-medium">{animalsData.animals.bovinosCount || 0}</span></div>}
                          {animalsData.animals.hasOvinos && <div className="flex justify-between"><span>Ovinos</span><span className="font-medium">{animalsData.animals.ovinosCount || 0}</span></div>}
                          {animalsData.animals.hasCaprinos && <div className="flex justify-between"><span>Caprinos</span><span className="font-medium">{animalsData.animals.caprinosCount || 0}</span></div>}
                          {animalsData.animals.hasAves && <div className="flex justify-between"><span>Aves</span><span className="font-medium">{animalsData.animals.avesCount || 0}</span></div>}
                          {animalsData.animals.hasPorcinos && <div className="flex justify-between"><span>Porcinos</span><span className="font-medium">{animalsData.animals.porcinosCount || 0}</span></div>}
                          {animalsData.animals.hasEquinos && <div className="flex justify-between"><span>Equinos</span><span className="font-medium">{animalsData.animals.equinosCount || 0}</span></div>}
                          {!animalsData.animals.hasBovinos && !animalsData.animals.hasOvinos && !animalsData.animals.hasAves && (
                            <p className="text-muted-foreground">Sin animales registrados</p>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">Sistema de Pastoreo</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-lg font-medium mb-2">
                          {animalsData.animals.grazingSystem === "corral" ? "Corral" :
                           animalsData.animals.grazingSystem === "pastoreo_continuo" ? "Pastoreo Continuo" :
                           animalsData.animals.grazingSystem === "pastoreo_rotacional" ? "Pastoreo Rotacional" :
                           animalsData.animals.grazingSystem === "combinado" ? "Combinado" : "No especificado"}
                        </p>
                        {animalsData.animals.manureUse?.length > 0 && (
                          <div className="mt-3">
                            <p className="text-sm text-muted-foreground mb-1">Uso de estiércol:</p>
                            <div className="flex flex-wrap gap-1">
                              {animalsData.animals.manureUse.map((use: string) => (
                                <Badge key={use} variant="secondary" className="text-xs">{use}</Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </div>
              ) : (
                <Card>
                  <CardContent className="py-12 text-center">
                    <Beef className="w-12 h-12 mx-auto mb-4 text-muted-foreground/30" />
                    <h3 className="text-lg font-medium mb-2">Sin datos de animales</h3>
                    <p className="text-muted-foreground mb-4">Registra la integración animal en tu parcela</p>
                    <Button onClick={() => setShowAnimalsModal(true)} data-testid="btn-add-animals-empty">
                      <Plus className="w-4 h-4 mr-2" /> Agregar Datos de Animales
                    </Button>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Costos Tab */}
            <TabsContent value="costs" className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
              <Link href={`/parcel/${parcel.id}/field-log?harvest=1`} className="inline-flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100" data-testid="link-record-previous-harvest">
                <Sprout className="h-4 w-4" />Registrar cosecha y venta de un cultivo anterior
              </Link>

              {/* ── T176 + T192: Profitability KPI Panel ──────────────────────── */}
              {profitabilityData ? (() => {
                const isAuto = profitabilityData.autoEstimate;
                const hasKpis = profitabilityData.grossMargin != null;
                const cardClass = !hasKpis
                  ? "border-amber-200 bg-amber-50/50 dark:bg-amber-950/10"
                  : isAuto
                    ? "border-blue-200 bg-blue-50/30 dark:bg-blue-950/10"
                    : profitabilityData.grossMargin! >= 0
                      ? "border-green-200 bg-green-50/50 dark:bg-green-950/10"
                      : "border-red-200 bg-red-50/50 dark:bg-red-950/10";

                const autoTooltip = isAuto
                  ? `Estimación automática. Precio: $${profitabilityData.sniimPrice?.toLocaleString("es-MX")} MXN/tn (SNIIM ${profitabilityData.sniimDate?.slice(0,10) ?? ""}). Rendimiento: ${profitabilityData.siapBenchmarkTonHa} tn/ha (SIAP 2022, ${profitabilityData.siapSource ?? "Nacional"}, ciclo ${profitabilityData.siapCycle ?? "Anual"}). Configure el ciclo para usar sus propios datos.`
                  : undefined;

                return (
                  <Card className={cardClass}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <TrendingUp className="w-4 h-4 text-emerald-600" /> KPIs de Rentabilidad
                          {isAuto && (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded px-1.5 py-0.5 font-medium cursor-help"
                              title={autoTooltip}
                            >
                              Auto · SNIIM + SIAP
                            </span>
                          )}
                        </CardTitle>
                        <Link href={`/parcel/${id}/setup`}>
                          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                            <Calculator className="w-3 h-3" /> {isAuto ? "Configurar valores" : "Configurar ciclo"}
                          </Button>
                        </Link>
                      </div>
                      <CardDescription>
                        {isAuto
                          ? `Estimado con precio SNIIM $${profitabilityData.sniimPrice?.toLocaleString("es-MX")} MXN/tn · benchmark SIAP ${profitabilityData.siapBenchmarkTonHa} tn/ha (${profitabilityData.siapSource ?? "Nacional"})`
                          : "Margen proyectado para el ciclo actual"}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {hasKpis ? (
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div className="text-center p-3 rounded-lg bg-background border">
                              <p className="text-xs text-muted-foreground mb-1">Margen Bruto</p>
                              <p className={`text-lg font-bold font-mono ${isAuto ? "text-slate-700 dark:text-slate-300" : profitabilityData.grossMargin! >= 0 ? "text-green-600" : "text-red-600"}`}
                                 data-testid="kpi-gross-margin">
                                {profitabilityData.grossMargin! >= 0 ? "+" : ""}${Math.abs(profitabilityData.grossMargin!).toLocaleString("es-AR", { maximumFractionDigits: 0 })}
                              </p>
                            </div>
                            <div className="text-center p-3 rounded-lg bg-background border">
                              <p className="text-xs text-muted-foreground mb-1">ROI</p>
                              <p className={`text-lg font-bold font-mono ${isAuto ? "text-slate-700 dark:text-slate-300" : profitabilityData.roi != null && profitabilityData.roi >= 0 ? "text-green-600" : "text-red-600"}`}
                                 data-testid="kpi-roi">
                                {profitabilityData.roi != null ? `${profitabilityData.roi.toFixed(1)}%` : "—"}
                              </p>
                            </div>
                            <div className="text-center p-3 rounded-lg bg-background border">
                              <p className="text-xs text-muted-foreground mb-1">Costo/tn</p>
                              <p className="text-lg font-bold font-mono text-amber-600" data-testid="kpi-cost-per-ton">
                                {profitabilityData.costPerTon != null ? `$${profitabilityData.costPerTon.toLocaleString("es-AR", { maximumFractionDigits: 0 })}` : "—"}
                              </p>
                            </div>
                            <div className="text-center p-3 rounded-lg bg-background border">
                              <p className="text-xs text-muted-foreground mb-1">Pto. Equilibrio</p>
                              <p className="text-lg font-bold font-mono text-blue-600" data-testid="kpi-break-even">
                                {profitabilityData.breakEvenTon != null ? `${profitabilityData.breakEvenTon.toFixed(2)} tn/ha` : "—"}
                              </p>
                            </div>
                          </div>
                          {/* ── T192: Carbon VCM income row ──────────────────────── */}
                          {carbonValueData && carbonValueData.totalUsd > 0 && (
                            <div
                              className="flex items-center justify-between p-3 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800"
                              title={`Estimación no certificada. Precio VCM: $${carbonValueData.pricePerTon} USD/tCO₂ (${carbonValueData.source ?? "Gold Standard"}, ${carbonValueData.date?.slice(0,10) ?? ""}). Basado en ${carbonValueData.tons.toFixed(1)} tCO₂ secuestradas.`}
                            >
                              <div className="flex items-center gap-2">
                                <Leaf className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                                <div>
                                  <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300">Ingreso potencial carbono (VCM)</p>
                                  <p className="text-[10px] text-muted-foreground">Estimación no certificada · {carbonValueData.tons.toFixed(1)} tCO₂</p>
                                </div>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-bold font-mono text-emerald-700 dark:text-emerald-400">
                                  +${carbonValueData.totalUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })} USD
                                </p>
                                {carbonValueData.totalMxn != null && (
                                  <p className="text-[10px] text-muted-foreground font-mono">
                                    ≈ ${carbonValueData.totalMxn.toLocaleString("es-MX", { maximumFractionDigits: 0 })} MXN
                                  </p>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 text-sm">
                          <Calculator className="w-4 h-4 text-amber-600 flex-shrink-0" />
                          <div>
                            <span className="font-medium text-amber-700 dark:text-amber-300">Configura el ciclo económico</span>
                            {" — "}
                            <span className="text-amber-600 dark:text-amber-400">Agrega el rendimiento esperado y precio objetivo para ver el margen bruto.</span>
                          </div>
                          <Link href={`/parcel/${id}/setup`} className="ml-auto flex-shrink-0">
                            <Button size="sm" variant="outline" className="border-amber-400 text-amber-700 hover:bg-amber-100">
                              Configurar
                            </Button>
                          </Link>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })() : null}

              {/* ── T181: International commodity benchmarks ─────────────────── */}
              {(() => {
                const usdMxn = (parcelMarketData as any)?.exchange?.usdMxn ?? null;
                const targetMxn = profitabilityData?.cycleDetail?.targetPricePerTon
                  ? parseFloat(String(profitabilityData.cycleDetail.targetPricePerTon))
                  : null;
                const targetUsd = targetMxn != null && usdMxn != null && usdMxn > 0
                  ? Math.round((targetMxn / usdMxn) * 100) / 100
                  : null;
                return (
                  <InternationalBenchmarkPanel
                    crop={parcel?.crop}
                    targetPriceUsd={targetUsd}
                  />
                );
              })()}

              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Wallet className="w-5 h-5" /> Costos de Producción
                    </CardTitle>
                    <CardDescription>Registra y analiza los costos de producción por ciclo</CardDescription>
                  </div>
                  <Button onClick={() => setShowCostsModal(true)} size="sm" data-testid="btn-add-cost">
                    <Plus className="w-4 h-4 mr-1" /> Agregar
                  </Button>
                </CardHeader>
                <CardContent>
                  {costsData?.costs?.length > 0 ? (
                    <div className="space-y-6">
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        <Card className="bg-primary/5 border-primary/20">
                          <CardContent className="p-4 text-center">
                            <p className="text-xs text-muted-foreground">Costo Total</p>
                            <p className="text-xl font-bold text-primary" data-testid="text-total-cost">
                              ${(costsData.economy?.byCurrency?.MXN?.total ?? 0).toLocaleString("es-MX", { minimumFractionDigits: 2 })} MXN
                            </p>
                          </CardContent>
                        </Card>
                        <Card className="bg-secondary/50 border-secondary">
                          <CardContent className="p-4 text-center">
                            <p className="text-xs text-muted-foreground">Costo por Hectárea</p>
                            <p className="text-xl font-bold" data-testid="text-cost-per-ha">
                              ${parcel ? ((costsData.economy?.byCurrency?.MXN?.total ?? 0) / parseFloat(parcel.area)).toLocaleString("es-MX", { minimumFractionDigits: 2 }) : "—"} MXN
                            </p>
                          </CardContent>
                        </Card>
                        <Card className="bg-accent/30 border-accent">
                          <CardContent className="p-4 text-center">
                            <p className="text-xs text-muted-foreground">Registros</p>
                            <p className="text-xl font-bold">{costsData.costs.length}</p>
                          </CardContent>
                        </Card>
                      </div>

                      <div>
                        <h4 className="text-sm font-medium mb-3">Desglose por Categoría</h4>
                        <div className="space-y-2">
                          {Object.entries(categoryGroups).map(([groupName, cats]) => {
                            const groupTotal = costsData.costs
                              .filter((c: any) => cats.includes(c.category) && (!c.currency || c.currency === "MXN"))
                              .reduce((sum: number, c: any) => sum + parseFloat(c.totalCost || 0), 0);
                            const totalAll = costsData.economy?.byCurrency?.MXN?.total ?? 0;
                            const pct = totalAll > 0 ? (groupTotal / totalAll) * 100 : 0;
                            if (groupTotal === 0) return null;
                            return (
                              <div key={groupName} className="flex items-center gap-3">
                                <span className="text-xs w-32 md:w-40 truncate">{groupName}</span>
                                <div className="flex-1 bg-muted rounded-full h-4 overflow-hidden">
                                  <div className="bg-primary h-full rounded-full transition-all" style={{ width: `${pct}%` }} />
                                </div>
                                <span className="text-xs font-medium w-20 text-right">${groupTotal.toLocaleString("es-MX", { minimumFractionDigits: 0 })}</span>
                                <span className="text-xs text-muted-foreground w-12 text-right">{pct.toFixed(0)}%</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left py-2 px-1 font-medium">Categoría</th>
                              <th className="text-left py-2 px-1 font-medium">Concepto</th>
                              <th className="text-right py-2 px-1 font-medium hidden sm:table-cell">Cant.</th>
                              <th className="text-right py-2 px-1 font-medium hidden sm:table-cell">C. Unit.</th>
                              <th className="text-right py-2 px-1 font-medium">Total</th>
                              <th className="py-2 px-1 w-8"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {costsData.costs.map((cost: any) => {
                              const isFert = cost.category === "fertilizantes";
                              const faoMatch = isFert ? matchFaoFertilizer(cost.concept ?? "") : null;
                              const usdMxn = (parcelMarketData as any)?.exchange?.usdMxn ?? null;
                              const { alert: faoAlert } = faoMatch
                                ? getFaoAlertInfo(cost, faoMatch, usdMxn)
                                : { alert: false };
                              return (
                                <tr key={cost.id} className="border-b hover:bg-muted/30" data-testid={`row-cost-${cost.id}`}>
                                  <td className="py-2 px-1 text-xs">{categoryLabels[cost.category] || cost.category}</td>
                                  <td className="py-2 px-1">
                                    <div className="flex flex-col gap-0.5">
                                      <span>{cost.concept}</span>
                                      {cost.origin === "field_log" && <span className="text-xs text-muted-foreground">Agrobitácora · solo lectura · {cost.currency || "MXN"}</span>}
                                      {isFert && faoMatch && (
                                        <span
                                          className="inline-flex items-center gap-1 text-xs text-blue-700 dark:text-blue-400 font-normal"
                                          data-testid={`badge-fao-${cost.id}`}
                                        >
                                          <span className="text-[10px] bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded px-1 py-0.5 font-medium">FAO</span>
                                          {faoMatch.name}: ${faoMatch.price.toLocaleString("en-US")} USD/ton ({faoMatch.date.slice(0, 7)})
                                        </span>
                                      )}
                                      {isFert && faoAlert && (
                                        <span
                                          className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400"
                                          data-testid={`alert-fao-${cost.id}`}
                                        >
                                          <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                                          Precio inusualmente alto vs. mercado internacional
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-2 px-1 text-right hidden sm:table-cell">{cost.quantity ? `${cost.quantity} ${cost.unit || ""}` : "—"}</td>
                                  <td className="py-2 px-1 text-right hidden sm:table-cell">{cost.unitCost ? `$${parseFloat(cost.unitCost).toLocaleString("es-MX")}` : "—"}</td>
                                  <td className="py-2 px-1 text-right font-medium">${parseFloat(cost.totalCost).toLocaleString("es-MX", { minimumFractionDigits: 2 })} {cost.currency || "MXN"}</td>
                                  <td className="py-2 px-1">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                                      disabled={cost.readOnly}
                                      title={cost.readOnly ? "Gasto de bitácora: corrige o cancela el registro en Agrobitácora" : "Eliminar gasto"}
                                      onClick={() => !cost.readOnly && deleteCostMutation.mutate(cost.id)}
                                      data-testid={`btn-delete-cost-${cost.id}`}
                                    >
                                      ×
                                    </Button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-12 text-muted-foreground">
                      <Wallet className="w-12 h-12 mx-auto mb-4 opacity-30" />
                      <p>No hay costos registrados</p>
                      <p className="text-sm mt-1">Registra los costos de producción para analizar la rentabilidad</p>
                      <Button className="mt-4" onClick={() => setShowCostsModal(true)} data-testid="btn-add-cost-empty">
                        <Plus className="w-4 h-4 mr-2" /> Registrar primer costo
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* ── FAO Fertilizer Reference Panel ───────────────────────── */}
              <Card className="border-blue-200 dark:border-blue-800" data-testid="card-fao-fertilizers">
                <CardHeader
                  className="pb-2 cursor-pointer select-none"
                  onClick={() => setFaoOpen((o) => !o)}
                >
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2 text-blue-700 dark:text-blue-400">
                      <span className="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded px-1.5 py-0.5 font-semibold">FAO</span>
                      Precios internacionales de fertilizantes
                    </CardTitle>
                    <span className="text-xs text-muted-foreground">{faoOpen ? "▲ Ocultar" : "▼ Ver precios"}</span>
                  </div>
                  <CardDescription className="text-xs">
                    Referencia internacional FOB — FAOSTAT / Banco Mundial. Actualización: {faoFertilizerPrices[0]?.date?.slice(0, 7) ?? "2025-01"}.
                  </CardDescription>
                </CardHeader>
                {faoOpen && (
                  <CardContent className="pt-0">
                    {faoFertilizerPrices.length > 0 ? (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
                        {faoFertilizerPrices.map((fao) => (
                          <div
                            key={fao.name}
                            className="rounded-lg border bg-blue-50/50 dark:bg-blue-950/10 p-3 text-center"
                            data-testid={`fao-price-${fao.name.toLowerCase()}`}
                          >
                            <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-1">{fao.name}</p>
                            <p className="text-base font-bold font-mono">
                              ${fao.price.toLocaleString("en-US")}
                            </p>
                            <p className="text-[10px] text-muted-foreground">{fao.unit}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">{fao.date.slice(0, 7)}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground py-3 text-center">Cargando precios FAO...</p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-3">
                      Datos de referencia internacional (FOB). Los precios locales pueden diferir por fletes, impuestos y márgenes comerciales. La alerta de precio alto se activa cuando el costo unitario registrado supera el 120% del precio FAO (conversión a MXN con tipo de cambio vigente).
                    </p>
                  </CardContent>
                )}
              </Card>
            </TabsContent>

            {/* Comercialización Tab */}
            <TabsContent value="livelihood" className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
              {/* Market price widget — always shown, independent of livelihood data */}
              <MarketPriceWidget
                parcelId={parcel.id}
                crop={parcel.crop}
                estimatedMarginPerHa={
                  profitabilityData?.totalCostPerHa != null && profitabilityData.totalCostPerHa > 0
                    ? (profitabilityData.estimatedGrossMarginPerHa ?? null)
                    : null
                }
              />

              {livelihoodLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
              ) : livelihoodData?.livelihood ? (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="text-lg font-semibold">Comercialización e Ingresos</h3>
                    <Button onClick={() => setShowLivelihoodModal(true)} size="sm" variant="outline" data-testid="btn-edit-livelihood">
                      Editar
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                          <DollarSign className="w-4 h-4" /> Distribución de Ingresos
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          {[
                            { label: "Agrícola", value: livelihoodData.livelihood.incomeAgricultural, color: "bg-green-500" },
                            { label: "Pecuario", value: livelihoodData.livelihood.incomeAnimal, color: "bg-amber-500" },
                            { label: "No agrícola", value: livelihoodData.livelihood.incomeNonAgricultural, color: "bg-blue-500" },
                            { label: "Remesas", value: livelihoodData.livelihood.incomeRemittances, color: "bg-purple-500" },
                          ].filter(item => item.value > 0).map(item => (
                            <div key={item.label} className="space-y-1">
                              <div className="flex justify-between text-sm">
                                <span>{item.label}</span>
                                <span className="font-medium">{item.value}%</span>
                              </div>
                              <div className="h-2 w-full bg-secondary/30 rounded-full overflow-hidden">
                                <div className={`h-full ${item.color}`} style={{ width: `${item.value}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">Canales de Venta</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          {livelihoodData.livelihood.sellsToConsumers && (
                            <div className="flex items-center gap-2">
                              <Check className="w-4 h-4 text-green-600" />
                              <span>Venta directa a consumidores</span>
                            </div>
                          )}
                          {livelihoodData.livelihood.sellsToIntermediaries && (
                            <div className="flex items-center gap-2">
                              <Check className="w-4 h-4 text-green-600" />
                              <span>Venta a intermediarios</span>
                            </div>
                          )}
                          {livelihoodData.livelihood.sellsToCompanies && (
                            <div className="flex items-center gap-2">
                              <Check className="w-4 h-4 text-green-600" />
                              <span>Venta a empresas</span>
                            </div>
                          )}
                          {livelihoodData.livelihood.sellsToCooperatives && (
                            <div className="flex items-center gap-2">
                              <Check className="w-4 h-4 text-green-600" />
                              <span>Venta a cooperativas</span>
                            </div>
                          )}
                          {livelihoodData.livelihood.sellsToGovernment && (
                            <div className="flex items-center gap-2">
                              <Check className="w-4 h-4 text-green-600" />
                              <span>Venta a gobierno</span>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              ) : (
                <Card>
                  <CardContent className="py-12 text-center">
                    <DollarSign className="w-12 h-12 mx-auto mb-4 text-muted-foreground/30" />
                    <h3 className="text-lg font-medium mb-2">Sin datos de comercialización</h3>
                    <p className="text-muted-foreground mb-4">Registra información sobre ingresos y canales de venta</p>
                    <Button onClick={() => setShowLivelihoodModal(true)} data-testid="btn-add-livelihood-empty">
                      <Plus className="w-4 h-4 mr-2" /> Agregar Datos de Comercialización
                    </Button>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* AI Agent Tab — Vista espectacular */}
            <TabsContent value="assistant" className="animate-in fade-in slide-in-from-bottom-2">
              {/* ── Hero Banner — paleta earthy del sistema ──────────────── */}
              <div className="relative mb-4 rounded-xl overflow-hidden shadow-md border border-green-900/20">
                {/* Gradient: verde bosque profundo, colores primarios del sistema */}
                <div className="absolute inset-0 bg-gradient-to-br from-green-900 via-green-800 to-emerald-900" />
                {/* Sutiles líneas de textura natural */}
                <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: "repeating-linear-gradient(45deg, white 0px, white 1px, transparent 1px, transparent 8px)" }} />

                <div className="relative z-10 px-5 py-5 md:px-7 md:py-6">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    {/* Left: title + parcel info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="inline-flex items-center gap-1.5 bg-green-300/20 border border-green-300/30 text-green-200 text-[10px] font-bold uppercase tracking-widest rounded-full px-2.5 py-0.5">
                          <Sparkles className="w-3 h-3" /> Análisis profundo · 4 herramientas
                        </span>
                      </div>
                      <h2 className="text-xl md:text-2xl font-bold text-white leading-tight font-heading">
                        Agente Agronómico IA
                      </h2>
                      <p className="text-green-200/70 text-sm mt-0.5 truncate">
                        {parcel.name} · {parcel.crop || "Cultivo"}
                        {parcel.area ? ` · ${typeof (parcel.area as unknown) === "number" ? (parcel.area as unknown as number).toFixed(1) : parcel.area} ha` : ""}
                      </p>
                    </div>

                    {/* Right: capability badges */}
                    <div className="flex flex-wrap gap-2 md:justify-end">
                      {[
                        { icon: <BookOpen className="w-3 h-3" />, label: "Literatura científica" },
                        { icon: <BarChart3 className="w-3 h-3" />, label: "Índices por cultivo" },
                        { icon: <TrendingUp className="w-3 h-3" />, label: "Tendencia 12 meses" },
                        { icon: <Globe2 className="w-3 h-3" />, label: "Comparación regional" },
                      ].map(({ icon, label }) => (
                        <span key={label} className="inline-flex items-center gap-1.5 bg-white/10 border border-white/15 text-white/85 text-xs rounded-lg px-2.5 py-1 font-medium">
                          {icon} {label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Chat component ──────────────────────────────────────────── */}
              <AIChat
                parcelId={parcel.id}
                parcelName={parcel.name}
                crop={parcel.crop || "Cultivo"}
              />
            </TabsContent>

            {/* Fertilization Tab */}
            <TabsContent value="fertilization" className="space-y-6 animate-in fade-in slide-in-from-bottom-2" data-testid="content-fertilization">
              <NutritionCalculatorTab
                parcelId={parcel.id}
                parcelName={parcel.name}
                parcelArea={parcel.area}
                parcelCrop={parcel.crop}
              />
            </TabsContent>

            {/* Amendments Tab */}
            <TabsContent value="amendments" className="animate-in fade-in slide-in-from-bottom-2" data-testid="content-amendments">
              <Suspense fallback={<div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando calculadora…</div>}>
                <AmendmentsCalculator params={{ id: parcel.id }} embedded />
              </Suspense>
            </TabsContent>

            {/* MVZ Tab */}
            <TabsContent value="mvz" className="space-y-4 animate-in fade-in slide-in-from-bottom-2" data-testid="content-mvz">
              <div>
                <h3 className="text-lg font-semibold flex items-center gap-2"><ScanLine className="w-5 h-5 text-purple-600" /> Muestreo por Variables (MVZ)</h3>
                <p className="text-sm text-muted-foreground">Dos metodologías independientes para definir zonas de manejo diferenciado.</p>
              </div>

              <Tabs defaultValue="campo" className="w-full" data-testid="tabs-mvz-methodology">
                <TabsList className="w-full grid grid-cols-4 h-11">
                  <TabsTrigger value="campo" className="gap-1.5 text-xs sm:text-sm" data-testid="tab-mvz-campo">
                    <ScanLine className="w-4 h-4 shrink-0" />
                    <span className="hidden sm:inline">Muestreo en campo</span><span className="sm:hidden">Campo</span>
                  </TabsTrigger>
                  <TabsTrigger value="satelital" className="gap-1.5 text-xs sm:text-sm" data-testid="tab-mvz-satelital">
                    <Satellite className="w-4 h-4 shrink-0" />
                    <span className="hidden sm:inline">Índices satelitales</span><span className="sm:hidden">Satélite</span>
                  </TabsTrigger>
                  <TabsTrigger value="dron" className="gap-1.5 text-xs sm:text-sm" data-testid="tab-mvz-dron">
                    <Plane className="w-4 h-4 shrink-0" />
                    <span className="hidden sm:inline">Imágenes de dron</span><span className="sm:hidden">Dron</span>
                  </TabsTrigger>
                  <TabsTrigger value="autoguiado" className="gap-1.5 text-xs sm:text-sm" data-testid="tab-mvz-autoguiado">
                    <Tractor className="w-4 h-4 shrink-0" />
                    <span className="hidden sm:inline">Mapa de Rendimiento</span><span className="sm:hidden">Rendimiento</span>
                  </TabsTrigger>
                </TabsList>

                {/* ── Campo methodology ── */}
                <TabsContent value="campo" className="mt-4 space-y-4" data-testid="content-mvz-campo">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <p className="text-sm font-medium">Campañas de muestreo en campo</p>
                      <p className="text-xs text-muted-foreground">Diseño de cuadrícula → captura en campo → interpolación → zonas → prescripción</p>
                    </div>
                    <Link href={`/parcel/${parcel.id}/sampling/design`}>
                      <Button size="sm" className="gap-2 bg-purple-600 hover:bg-purple-700" data-testid="btn-new-mvz-campaign">
                        <Plus className="w-4 h-4" /> Nueva Campaña
                      </Button>
                    </Link>
                  </div>

                  {/* Phase tracker */}
                  {(() => {
                    const latestCampaign = mvzCampaigns[0] as SamplingCampaign | undefined;
                    const phase = latestCampaign?.status ?? "none";
                    const steps = [
                      { label: "Diseño", href: `/parcel/${parcel.id}/sampling/design`, done: phase !== "none" },
                      { label: "Captura", href: `/parcel/${parcel.id}/sampling/capture`, done: phase === "completed" || phase === "interpolated" },
                      { label: "Interpolación", href: `/parcel/${parcel.id}/sampling/maps`, done: phase === "interpolated" },
                      { label: "Zonas", href: `/parcel/${parcel.id}/zones`, done: phase === "interpolated" },
                      { label: "Prescripción", href: `/parcel/${parcel.id}/prescription`, done: false },
                    ];
                    const currentIdx = phase === "none" ? -1 : phase === "designing" ? 0 : phase === "active" ? 1 : phase === "completed" ? 2 : 3;
                    return (
                      <div className="flex items-center gap-1 overflow-x-auto pb-1" data-testid="mvz-flow">
                        {steps.map((step, i) => {
                          const isCurrent = i === currentIdx;
                          const isDone = step.done && i < currentIdx;
                          return (
                            <span key={step.label} className="flex items-center gap-1 shrink-0">
                              <Link href={step.href}>
                                <span className={`text-xs px-2 py-0.5 rounded-full border transition-colors cursor-pointer ${
                                  isCurrent
                                    ? "border-purple-500 bg-purple-100 text-purple-800 font-semibold"
                                    : isDone
                                    ? "border-green-300 bg-green-50 text-green-700"
                                    : "border-border text-muted-foreground hover:text-purple-600 hover:border-purple-300"
                                }`} data-testid={`flow-step-${i}`}>{isDone ? "✓ " : ""}{step.label}</span>
                              </Link>
                              {i < steps.length - 1 && <span className="text-muted-foreground/40 text-xs">→</span>}
                            </span>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {mvzCampaigns.length === 0 ? (
                    <Card data-testid="card-mvz-empty">
                      <CardContent className="py-12 text-center">
                        <ScanLine className="w-12 h-12 mx-auto mb-3 text-muted-foreground/25" />
                        <h3 className="text-base font-medium mb-1">Sin campañas de muestreo</h3>
                        <p className="text-muted-foreground text-sm mb-5 max-w-sm mx-auto">Diseña una cuadrícula de muestreo, captura datos en campo e interpola zonas de manejo diferenciado.</p>
                        <Link href={`/parcel/${parcel.id}/sampling/design`}>
                          <Button className="bg-purple-600 hover:bg-purple-700" data-testid="btn-start-sampling">
                            <ScanLine className="w-4 h-4 mr-2" /> Diseñar Muestreo
                          </Button>
                        </Link>
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="space-y-3" data-testid="list-mvz-campaigns">
                      {mvzCampaigns.map((campaign: SamplingCampaign) => {
                        const statusMap: Record<string, { label: string; cls: string }> = {
                          designing: { label: "Diseñando", cls: "bg-blue-100 text-blue-700 border-blue-200" },
                          active: { label: "En campo", cls: "bg-yellow-100 text-yellow-700 border-yellow-200" },
                          completed: { label: "Completada", cls: "bg-green-100 text-green-700 border-green-200" },
                          interpolated: { label: "Interpolada", cls: "bg-purple-100 text-purple-700 border-purple-200" },
                        };
                        const status = statusMap[campaign.status] || { label: campaign.status, cls: "bg-gray-100 text-gray-700" };
                        const nextHref = campaign.status === "designing"
                          ? `/parcel/${parcel.id}/sampling/design`
                          : campaign.status === "active"
                          ? `/parcel/${parcel.id}/sampling/capture`
                          : campaign.status === "completed"
                          ? `/parcel/${parcel.id}/sampling/maps?campaign=${campaign.id}`
                          : `/parcel/${parcel.id}/zones?campaign=${campaign.id}`;
                        return (
                          <Card key={campaign.id} className="hover:shadow-md transition-shadow" data-testid={`card-campaign-${campaign.id}`}>
                            <CardContent className="py-4 px-5">
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    <p className="font-medium text-sm truncate">{campaign.name}</p>
                                    <Badge variant="outline" className={`text-xs shrink-0 ${status.cls}`}>{status.label}</Badge>
                                  </div>
                                  <p className="text-xs text-muted-foreground">
                                    {campaign.nPointsPlanned} puntos · {campaign.gridType} · {campaign.samplingDepth}cm profundidad
                                  </p>
                                </div>
                                <Link href={nextHref}>
                                  <Button variant="outline" size="sm" className="shrink-0 border-purple-200 text-purple-700 hover:bg-purple-50" data-testid={`btn-campaign-continue-${campaign.id}`}>
                                    {campaign.status === "designing" ? "Diseño" :
                                     campaign.status === "active" ? "Captura" :
                                     campaign.status === "completed" ? "Interpolar" :
                                     "Ver Zonas"}
                                  </Button>
                                </Link>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                      <div className="text-center pt-1">
                        <Link href={`/parcel/${parcel.id}/sampling/design`}>
                          <Button variant="ghost" size="sm" className="text-purple-600 hover:text-purple-700 hover:bg-purple-50" data-testid="btn-all-campaigns">
                            Ver gestión completa →
                          </Button>
                        </Link>
                      </div>
                    </div>
                  )}
                </TabsContent>

                {/* ── Satellite methodology ── */}
                <TabsContent value="satelital" className="mt-4 space-y-4" data-testid="content-mvz-satelital">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <p className="text-sm font-medium">Zonificación por índices satelitales</p>
                      <p className="text-xs text-muted-foreground">Genera zonas de manejo automáticamente a partir de imágenes Sentinel-2 (NDVI, EVI, NDRE, NDMI…)</p>
                    </div>
                    <Link href={`/parcel/${parcel.id}/zones?mode=satellite`}>
                      <Button size="sm" className="gap-2 bg-teal-600 hover:bg-teal-700" data-testid="btn-new-sat-zonification">
                        <Satellite className="w-4 h-4" /> Nueva Zonificación
                      </Button>
                    </Link>
                  </div>

                  {/* How it works callout */}
                  <div className="rounded-lg border border-teal-200 bg-teal-50/60 px-4 py-3 text-xs text-teal-800 flex items-start gap-2" data-testid="callout-sat-mvz">
                    <Satellite className="w-4 h-4 shrink-0 mt-0.5 text-teal-600" />
                    <div>
                      <span className="font-semibold">¿Cómo funciona?</span> Se selecciona un índice (NDVI, EVI, NDRE…), la plataforma descarga la imagen Sentinel-2 más reciente sin nubes y aplica un algoritmo de clasificación (K-means, Jenks, cuantiles o fuzzy) para agrupar píxeles en zonas de manejo. Las zonas se exportan como GeoJSON, KML o Shapefile.
                    </div>
                  </div>

                  {satZoneSets.length === 0 ? (
                    <Card data-testid="card-sat-mvz-empty" className="border-dashed border-teal-200">
                      <CardContent className="py-12 text-center">
                        <Satellite className="w-12 h-12 mx-auto mb-3 text-muted-foreground/25" />
                        <h3 className="text-base font-medium mb-1">Sin zonificaciones satelitales</h3>
                        <p className="text-muted-foreground text-sm mb-5 max-w-sm mx-auto">
                          Genera zonas de manejo usando imágenes de satélite sin necesidad de muestreo en campo. Solo necesitas el polígono del predio definido.
                        </p>
                        <Link href={`/parcel/${parcel.id}/zones?mode=satellite`}>
                          <Button className="bg-teal-600 hover:bg-teal-700" data-testid="btn-start-sat-zonification">
                            <Satellite className="w-4 h-4 mr-2" /> Generar Zonas Satelitales
                          </Button>
                        </Link>
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="space-y-3" data-testid="list-sat-zone-sets">
                      {satZoneSets.map((s) => {
                        const meta = s.metadata ?? {};
                        const indexLabel = (meta.indexType ?? "NDVI").toUpperCase();
                        const imageDate = meta.imageDate
                          ? new Date(meta.imageDate).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })
                          : "—";
                        const methodLabel: Record<string, string> = {
                          spatial_kmeans: "K-means",
                          jenks: "Jenks",
                          quantiles: "Cuantiles",
                          fuzzy: "Fuzzy C-means",
                        };
                        const totalHa = s.zones.reduce((acc, z) => acc + parseFloat(z.areaHa ?? "0"), 0);
                        const nZones = s.zones.length;
                        return (
                          <Card key={s.zoneSetId} className="hover:shadow-md transition-shadow" data-testid={`card-sat-set-${s.zoneSetId}`}>
                            <CardContent className="py-4 px-5">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1 space-y-1.5">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <Badge className="bg-teal-100 text-teal-800 border-teal-300 text-xs" data-testid={`badge-sat-index-${s.zoneSetId}`}>{indexLabel}</Badge>
                                    {meta.method && <Badge variant="outline" className="text-xs">{methodLabel[meta.method] ?? meta.method}</Badge>}
                                    <span className="text-xs text-muted-foreground">Imagen: {imageDate}</span>
                                  </div>
                                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                    <span data-testid={`text-sat-zones-${s.zoneSetId}`}>{nZones} zona{nZones !== 1 ? "s" : ""}</span>
                                    <span>{totalHa.toFixed(1)} ha totales</span>
                                    {meta.cloudyPixelPercentage != null && (
                                      <span>☁ {meta.cloudyPixelPercentage.toFixed(0)}% nubes</span>
                                    )}
                                  </div>
                                  {/* Zone color swatches */}
                                  <div className="flex items-center gap-1 flex-wrap">
                                    {s.zones.map((z, zi) => (
                                      <div key={zi} className="flex items-center gap-1">
                                        <span className="w-3 h-3 rounded-sm inline-block border border-white shadow-sm" style={{ background: z.colorHex ?? "#888" }} />
                                        <span className="text-[10px] text-muted-foreground">{z.zoneLabel ?? `Z${zi + 1}`}</span>
                                      </div>
                                    ))}
                                  </div>
                                  <p className="text-[11px] text-muted-foreground">
                                    Generado {new Date(s.createdAt).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}
                                  </p>
                                </div>
                                <div className="flex flex-col gap-1.5 shrink-0">
                                  <Link href={`/parcel/${parcel.id}/zones?mode=satellite`}>
                                    <Button variant="outline" size="sm" className="w-full border-teal-200 text-teal-700 hover:bg-teal-50" data-testid={`btn-sat-set-view-${s.zoneSetId}`}>
                                      Ver zonas
                                    </Button>
                                  </Link>
                                  <Link href={`/parcel/${parcel.id}/prescription?zoneSet=${s.zoneSetId}`}>
                                    <Button variant="outline" size="sm" className="w-full border-purple-200 text-purple-700 hover:bg-purple-50" data-testid={`btn-sat-set-prescribe-${s.zoneSetId}`}>
                                      Prescripción
                                    </Button>
                                  </Link>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                      <div className="text-center pt-1">
                        <Link href={`/parcel/${parcel.id}/zones?mode=satellite`}>
                          <Button variant="ghost" size="sm" className="text-teal-600 hover:text-teal-700 hover:bg-teal-50" data-testid="btn-all-sat-sets">
                            Gestionar todas las zonificaciones →
                          </Button>
                        </Link>
                      </div>
                    </div>
                  )}
                </TabsContent>

                {/* ── Drone imagery methodology ── */}
                <TabsContent value="dron" className="mt-4 space-y-4" data-testid="content-mvz-dron">
                  <DroneMvzContent
                    parcelId={parcel.id}
                    droneZoneSets={droneZoneSets}
                    onRefresh={() => refetchDroneZoneSets()}
                  />
                </TabsContent>

                {/* ── Autoguiado KML methodology ── */}
                <TabsContent value="autoguiado" className="mt-4 space-y-4" data-testid="content-mvz-autoguiado">
                  <AutoguiadoMvzContent
                    parcelId={parcel.id}
                    zoneImports={zoneImportRows}
                    onRefresh={() => refetchZoneImports()}
                  />
                </TabsContent>
              </Tabs>
            </TabsContent>

            {activeModules.includes("drones") && (
              <TabsContent value="drones" className="space-y-6 animate-in fade-in slide-in-from-bottom-2" data-testid="content-drones">
                <DroneTabContent parcelId={parcel.id} crop={parcel.crop} phenologicalStage={parcel.phenologicalStage} />
              </TabsContent>
            )}

            {activeModules.includes("iot") && (
              <TabsContent value="iot" className="space-y-6 animate-in fade-in slide-in-from-bottom-2" data-testid="content-iot">
                <IoTTabContent parcelId={parcel.id} />
              </TabsContent>
            )}

            {activeModules.includes("riego-inteligente") && (
              <TabsContent value="smart-irrigation" className="space-y-6 animate-in fade-in slide-in-from-bottom-2" data-testid="content-smart-irrigation">
                <IrrigationTabContent parcelId={parcel.id} irrigationSystem={parcel.irrigationSystem} crop={parcel.crop} area={parcel.area ? parseFloat(parcel.area) : undefined} />
              </TabsContent>
            )}

            {/* Climate Risk Tab (Task #168) */}
            <TabsContent value="climate-risk" className="space-y-6 animate-in fade-in slide-in-from-bottom-2" data-testid="content-climate-risk-outer">
              <ClimateRiskTab
                parcelId={parcel.id}
                crop={parcel.crop}
                parcelName={parcel.name}
                latitude={parcel.latitude}
                longitude={parcel.longitude}
              />
            </TabsContent>

            {/* T250: Fenología profesional */}
            <TabsContent value="fenologia" className="space-y-6 animate-in fade-in slide-in-from-bottom-2" data-testid="content-fenologia">
              <PhenologyTimeline
                parcelId={parcel.id}
                currentStage={parcel.phenologicalStage}
                calculatedStage={currentExpectedStage ?? undefined}
                plantingDate={parcel.plantingDate}
                crop={parcel.crop}
                canEdit={!!(user && (parcel.userId === user.id || user.role === "admin"))}
                onAdvanceStage={async (nextStage) => {
                  try {
                    const res = await fetch(`/api/parcels/${parcel.id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      credentials: "include",
                      body: JSON.stringify({ phenologicalStage: nextStage }),
                    });
                    if (res.ok) {
                      queryClient.invalidateQueries({ queryKey: ["parcel", parcel.id] });
                    }
                  } catch {}
                }}
              />
            </TabsContent>

            <HistorialTab parcelId={parcel.id} polygonCoordinates={parcel.polygonCoordinates as [number, number][] | null} />

            <RendimientoTab parcelId={parcel.id} />

            {/* Insumos Dashboard Tab (T155) */}
            <TabsContent value="insumos" className="space-y-6 animate-in fade-in slide-in-from-bottom-2" data-testid="content-insumos">
              <InsumosDashboard parcelId={parcel.id} />
            </TabsContent>

          </Tabs>
        </div>
      </div>

      <Dialog open={showSoilModal} onOpenChange={setShowSoilModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FlaskConical className="w-5 h-5 text-amber-600" />
              Subir Análisis de Laboratorio
            </DialogTitle>
            <DialogDescription>
              Ingresa los valores de tu análisis de suelo para obtener indicadores y alertas personalizadas.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={(e) => { e.preventDefault(); soilMutation.mutate(soilFormData); }} className="space-y-4">
            {/* Header */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="analysisDate">Fecha del Análisis *</Label>
                <Input id="analysisDate" type="date" value={soilFormData.analysisDate} onChange={(e) => setSoilFormData(prev => ({ ...prev, analysisDate: e.target.value }))} required data-testid="input-analysis-date" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="labName">Laboratorio</Label>
                <Input id="labName" placeholder="Nombre del laboratorio" value={soilFormData.labName} onChange={(e) => setSoilFormData(prev => ({ ...prev, labName: e.target.value }))} data-testid="input-lab-name" />
              </div>
            </div>

            {/* Organic Matter & Carbon */}
            <div className="border-t pt-4">
              <h4 className="font-medium mb-3 text-amber-700">Materia Orgánica y Carbono</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="organicMatter">Materia Orgánica (%)</Label>
                  <Input id="organicMatter" type="number" step="0.01" placeholder="ej: 3.5" value={soilFormData.organicMatter} onChange={(e) => setSoilFormData(prev => ({ ...prev, organicMatter: e.target.value }))} data-testid="input-organic-matter" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="totalCarbon">Carbono Total (%)</Label>
                  <Input id="totalCarbon" type="number" step="0.01" placeholder="ej: 2.0" value={soilFormData.totalCarbon} onChange={(e) => setSoilFormData(prev => ({ ...prev, totalCarbon: e.target.value }))} data-testid="input-total-carbon" />
                </div>
              </div>
              {soilFormData.totalCarbon && soilFormData.nitrogenTotal && (() => {
                const c = parseFloat(soilFormData.totalCarbon);
                const n = parseFloat(soilFormData.nitrogenTotal);
                if (c > 0 && n > 0) {
                  const ratio = c / n;
                  let hint = "";
                  let hintColor = "text-muted-foreground";
                  if (ratio < 10) { hint = "Relación C/N baja — mineralización rápida, posible pérdida de N."; hintColor = "text-yellow-700"; }
                  else if (ratio <= 15) { hint = "Relación C/N óptima — buena actividad microbiana."; hintColor = "text-green-700"; }
                  else if (ratio <= 25) { hint = "Relación C/N media — mineralización moderada."; hintColor = "text-muted-foreground"; }
                  else { hint = "Relación C/N alta — posible inmovilización de N, incorporar fuentes más lábiles."; hintColor = "text-orange-700"; }
                  return (
                    <p className={`text-xs mt-2 ${hintColor}`} data-testid="text-cn-ratio">
                      Relación C/N: <strong>{ratio.toFixed(1)}:1</strong> — {hint}
                    </p>
                  );
                }
                return null;
              })()}
            </div>

            {/* Macronutrients */}
            <div className="border-t pt-4">
              <h4 className="font-medium mb-3 text-amber-700">Macronutrientes</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="nitrogenTotal">N Total (%)</Label>
                  <Input id="nitrogenTotal" type="number" step="0.001" placeholder="ej: 0.20" value={soilFormData.nitrogenTotal} onChange={(e) => setSoilFormData(prev => ({ ...prev, nitrogenTotal: e.target.value }))} data-testid="input-nitrogen" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nitrogenInorganic">N inorgánico (mg/kg)</Label>
                  <Input id="nitrogenInorganic" type="number" min="0" step="0.01" placeholder="ej: 18.50" value={soilFormData.nitrogenInorganic} onChange={(e) => setSoilFormData(prev => ({ ...prev, nitrogenInorganic: e.target.value }))} data-testid="input-nitrogen-inorganic" />
                  <p className="text-xs text-muted-foreground">Dato independiente de N total (%). En blanco significa sin medición.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phosphorus">P (ppm)</Label>
                  <Input id="phosphorus" type="number" step="0.1" placeholder="ej: 25" value={soilFormData.phosphorus} onChange={(e) => setSoilFormData(prev => ({ ...prev, phosphorus: e.target.value }))} data-testid="input-phosphorus" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="potassium">K (ppm)</Label>
                  <Input id="potassium" type="number" step="0.1" placeholder="ej: 150" value={soilFormData.potassium} onChange={(e) => setSoilFormData(prev => ({ ...prev, potassium: e.target.value }))} data-testid="input-potassium" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="calcium">Ca (ppm)</Label>
                  <Input id="calcium" type="number" step="0.1" placeholder="ej: 1500" value={soilFormData.calcium} onChange={(e) => setSoilFormData(prev => ({ ...prev, calcium: e.target.value }))} data-testid="input-calcium" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="magnesium">Mg (ppm)</Label>
                  <Input id="magnesium" type="number" step="0.1" placeholder="ej: 200" value={soilFormData.magnesium} onChange={(e) => setSoilFormData(prev => ({ ...prev, magnesium: e.target.value }))} data-testid="input-magnesium" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sulfur">S (ppm)</Label>
                  <Input id="sulfur" type="number" step="0.1" placeholder="ej: 10" value={soilFormData.sulfur} onChange={(e) => setSoilFormData(prev => ({ ...prev, sulfur: e.target.value }))} data-testid="input-sulfur" />
                </div>
              </div>
            </div>

            {/* Micronutrients */}
            <div className="border-t pt-4">
              <h4 className="font-medium mb-3 text-amber-700">Micronutrientes (ppm)</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="iron">Fe — Hierro</Label>
                  <Input id="iron" type="number" step="0.01" placeholder="ej: 15" value={soilFormData.iron} onChange={(e) => setSoilFormData(prev => ({ ...prev, iron: e.target.value }))} data-testid="input-iron" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="zinc">Zn — Zinc</Label>
                  <Input id="zinc" type="number" step="0.01" placeholder="ej: 1.5" value={soilFormData.zinc} onChange={(e) => setSoilFormData(prev => ({ ...prev, zinc: e.target.value }))} data-testid="input-zinc" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="manganese">Mn — Manganeso</Label>
                  <Input id="manganese" type="number" step="0.01" placeholder="ej: 5" value={soilFormData.manganese} onChange={(e) => setSoilFormData(prev => ({ ...prev, manganese: e.target.value }))} data-testid="input-manganese" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="copper">Cu — Cobre</Label>
                  <Input id="copper" type="number" step="0.01" placeholder="ej: 0.5" value={soilFormData.copper} onChange={(e) => setSoilFormData(prev => ({ ...prev, copper: e.target.value }))} data-testid="input-copper" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="boron">B — Boro</Label>
                  <Input id="boron" type="number" step="0.01" placeholder="ej: 0.5" value={soilFormData.boron} onChange={(e) => setSoilFormData(prev => ({ ...prev, boron: e.target.value }))} data-testid="input-boron" />
                </div>
              </div>
            </div>

            {/* Physico-Chemical */}
            <div className="border-t pt-4">
              <h4 className="font-medium mb-3 text-amber-700">Propiedades Físico-Químicas</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="ph">pH</Label>
                  <Input id="ph" type="number" step="0.01" min="0" max="14" placeholder="ej: 6.50" value={soilFormData.ph} onChange={(e) => setSoilFormData(prev => ({ ...prev, ph: e.target.value }))} data-testid="input-ph" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="electricConductivity">CE (dS/m)</Label>
                  <Input id="electricConductivity" type="number" step="0.01" placeholder="ej: 1.2" value={soilFormData.electricConductivity} onChange={(e) => setSoilFormData(prev => ({ ...prev, electricConductivity: e.target.value }))} data-testid="input-ec" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cec">CIC (meq/100g)</Label>
                  <Input id="cec" type="number" step="0.1" placeholder="ej: 18" value={soilFormData.cec} onChange={(e) => setSoilFormData(prev => ({ ...prev, cec: e.target.value }))} data-testid="input-cec" />
                </div>
              </div>
            </div>

            {/* Texture */}
            <div className="border-t pt-4">
              <h4 className="font-medium mb-3 text-amber-700">Textura del Suelo (%)</h4>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="sand">Arena</Label>
                  <Input id="sand" type="number" step="0.01" min="0" max="100" placeholder="ej: 45.00" value={soilFormData.sand} onChange={(e) => setSoilFormData(prev => ({ ...prev, sand: e.target.value }))} data-testid="input-sand" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="silt">Limo</Label>
                  <Input id="silt" type="number" step="0.01" min="0" max="100" placeholder="ej: 30.00" value={soilFormData.silt} onChange={(e) => setSoilFormData(prev => ({ ...prev, silt: e.target.value }))} data-testid="input-silt" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="clay">Arcilla</Label>
                  <Input id="clay" type="number" step="0.01" min="0" max="100" placeholder="ej: 25.00" value={soilFormData.clay} onChange={(e) => setSoilFormData(prev => ({ ...prev, clay: e.target.value }))} data-testid="input-clay" />
                </div>
              </div>
              {soilFormData.sand && soilFormData.silt && soilFormData.clay && (() => {
                const sa = parseFloat(soilFormData.sand || "0");
                const si = parseFloat(soilFormData.silt || "0");
                const cl = parseFloat(soilFormData.clay || "0");
                const sum = sa + si + cl;
                const sumOk = Math.abs(sum - 100) <= 2;
                // USDA texture classification
                let textureClass = "";
                if (sumOk) {
                  if (cl >= 40 && si >= 40) textureClass = "Silty Clay";
                  else if (cl >= 40 && sa <= 45) textureClass = "Clay";
                  else if (cl >= 40) textureClass = "Sandy Clay";
                  else if (cl >= 27 && si >= 28 && sa <= 45) textureClass = "Clay Loam";
                  else if (cl >= 27 && si >= 40) textureClass = "Silty Clay Loam";
                  else if (cl >= 20 && sa >= 45) textureClass = "Sandy Clay Loam";
                  else if (si >= 50 && cl >= 12) textureClass = "Silt Loam";
                  else if (si >= 80) textureClass = "Silt";
                  else if (sa >= 85) textureClass = "Sand";
                  else if (sa >= 70 && cl <= 15) textureClass = "Loamy Sand";
                  else if (sa >= 43 && cl <= 18) textureClass = "Sandy Loam";
                  else textureClass = "Loam (Franco)";
                }
                return (
                  <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                    <span>
                      Suma: <strong>{sum.toFixed(2)}%</strong>
                      {!sumOk && <span className="text-orange-600 ml-1">— debe sumar 100%</span>}
                    </span>
                    {textureClass && (
                      <span className="text-amber-700 font-medium" data-testid="text-texture-class">
                        Clase USDA: <strong>{textureClass}</strong>
                      </span>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Notes */}
            <div className="border-t pt-4">
              <div className="space-y-2">
                <Label htmlFor="soilNotes">Observaciones</Label>
                <textarea
                  id="soilNotes"
                  className="w-full min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                  placeholder="Condiciones del muestreo, profundidad, observaciones adicionales..."
                  value={soilFormData.notes}
                  onChange={(e) => setSoilFormData(prev => ({ ...prev, notes: e.target.value }))}
                  data-testid="input-soil-notes"
                />
              </div>
            </div>

            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => setShowSoilModal(false)}>
                Cancelar
              </Button>
            {soilMutation.isError && <p role="alert" className="text-sm text-destructive" data-testid="error-save-soil-analysis">{(soilMutation.error as Error).message}</p>}
            <Button type="submit" disabled={soilMutation.isPending} data-testid="btn-submit-soil">
                {soilMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Guardando...
                  </>
                ) : (
                  "Guardar Análisis"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Water Analysis Modal */}
      <Dialog open={showWaterModal} onOpenChange={setShowWaterModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Droplets className="w-5 h-5 text-blue-600" />
              Análisis de Agua de Riego
            </DialogTitle>
            <DialogDescription>
              Ingresa los parámetros del análisis de tu fuente de riego. Se generarán alertas según las normas FAO 29.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); waterMutation.mutate(waterFormData); }} className="space-y-4">
            {/* Header */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="waterDate">Fecha *</Label>
                <Input id="waterDate" type="date" value={waterFormData.analysisDate} onChange={(e) => setWaterFormData(prev => ({ ...prev, analysisDate: e.target.value }))} required data-testid="input-water-date" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="waterSource">Fuente</Label>
                <select
                  id="waterSource"
                  className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={waterFormData.source}
                  onChange={(e) => setWaterFormData(prev => ({ ...prev, source: e.target.value }))}
                  data-testid="select-water-source"
                >
                  <option value="">Seleccionar…</option>
                  <option value="pozo">Pozo</option>
                  <option value="río">Río</option>
                  <option value="canal">Canal</option>
                  <option value="red">Red pública</option>
                  <option value="represa">Represa / Laguna</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="waterLab">Laboratorio</Label>
                <Input id="waterLab" placeholder="Nombre del lab" value={waterFormData.labName} onChange={(e) => setWaterFormData(prev => ({ ...prev, labName: e.target.value }))} data-testid="input-water-lab" />
              </div>
            </div>

            {/* General parameters */}
            <div className="border-t pt-4">
              <h4 className="font-medium mb-3 text-blue-700">Parámetros Generales</h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="waterPh">pH</Label>
                  <Input id="waterPh" type="number" step="0.1" min="0" max="14" placeholder="ej: 7.2" value={waterFormData.ph} onChange={(e) => setWaterFormData(prev => ({ ...prev, ph: e.target.value }))} data-testid="input-water-ph" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="waterEc">CE (dS/m)</Label>
                  <Input id="waterEc" type="number" step="0.01" placeholder="ej: 0.8" value={waterFormData.electricConductivity} onChange={(e) => setWaterFormData(prev => ({ ...prev, electricConductivity: e.target.value }))} data-testid="input-water-ec" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="waterTds">TDS (mg/L)</Label>
                  <Input id="waterTds" type="number" step="1" placeholder="ej: 500" value={waterFormData.tds} onChange={(e) => setWaterFormData(prev => ({ ...prev, tds: e.target.value }))} data-testid="input-water-tds" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="waterHardness">Dureza (mg/L)</Label>
                  <Input id="waterHardness" type="number" step="1" placeholder="ej: 250" value={waterFormData.hardness} onChange={(e) => setWaterFormData(prev => ({ ...prev, hardness: e.target.value }))} data-testid="input-water-hardness" />
                </div>
              </div>
            </div>

            {/* Sodium hazard */}
            <div className="border-t pt-4">
              <h4 className="font-medium mb-3 text-blue-700">Riesgo de Sodificación</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="waterSar">SAR (adsorción de sodio)</Label>
                  <Input id="waterSar" type="number" step="0.1" placeholder="ej: 3.5" value={waterFormData.sar} onChange={(e) => setWaterFormData(prev => ({ ...prev, sar: e.target.value }))} data-testid="input-water-sar" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="waterRsc">RSC (carbonato sódico residual meq/L)</Label>
                  <Input id="waterRsc" type="number" step="0.01" placeholder="ej: 0.5" value={waterFormData.rsc} onChange={(e) => setWaterFormData(prev => ({ ...prev, rsc: e.target.value }))} data-testid="input-water-rsc" />
                </div>
              </div>
            </div>

            {/* Cations */}
            <div className="border-t pt-4">
              <h4 className="font-medium mb-3 text-blue-700">Cationes (mg/L)</h4>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="waterNa">Sodio (Na)</Label>
                  <Input id="waterNa" type="number" step="0.1" placeholder="ej: 50" value={waterFormData.sodium} onChange={(e) => setWaterFormData(prev => ({ ...prev, sodium: e.target.value }))} data-testid="input-water-sodium" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="waterCa">Calcio (Ca)</Label>
                  <Input id="waterCa" type="number" step="0.1" placeholder="ej: 80" value={waterFormData.calcium} onChange={(e) => setWaterFormData(prev => ({ ...prev, calcium: e.target.value }))} data-testid="input-water-calcium" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="waterMg">Magnesio (Mg)</Label>
                  <Input id="waterMg" type="number" step="0.1" placeholder="ej: 25" value={waterFormData.magnesium} onChange={(e) => setWaterFormData(prev => ({ ...prev, magnesium: e.target.value }))} data-testid="input-water-magnesium" />
                </div>
              </div>
            </div>

            {/* Anions */}
            <div className="border-t pt-4">
              <h4 className="font-medium mb-3 text-blue-700">Aniones (mg/L)</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="waterHco3">Bicarbonatos (HCO₃)</Label>
                  <Input id="waterHco3" type="number" step="0.1" placeholder="ej: 180" value={waterFormData.bicarbonates} onChange={(e) => setWaterFormData(prev => ({ ...prev, bicarbonates: e.target.value }))} data-testid="input-water-bicarbonates" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="waterCo3">Carbonatos (CO₃)</Label>
                  <Input id="waterCo3" type="number" step="0.1" placeholder="ej: 0" value={waterFormData.carbonates} onChange={(e) => setWaterFormData(prev => ({ ...prev, carbonates: e.target.value }))} data-testid="input-water-carbonates" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="waterCl">Cloruros (Cl)</Label>
                  <Input id="waterCl" type="number" step="0.1" placeholder="ej: 80" value={waterFormData.chlorides} onChange={(e) => setWaterFormData(prev => ({ ...prev, chlorides: e.target.value }))} data-testid="input-water-chlorides" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="waterSo4">Sulfatos (SO₄)</Label>
                  <Input id="waterSo4" type="number" step="0.1" placeholder="ej: 100" value={waterFormData.sulfates} onChange={(e) => setWaterFormData(prev => ({ ...prev, sulfates: e.target.value }))} data-testid="input-water-sulfates" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="waterB">Boro (B)</Label>
                  <Input id="waterB" type="number" step="0.01" placeholder="ej: 0.3" value={waterFormData.boron} onChange={(e) => setWaterFormData(prev => ({ ...prev, boron: e.target.value }))} data-testid="input-water-boron" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="waterNo3">Nitratos (NO₃)</Label>
                  <Input id="waterNo3" type="number" step="0.1" placeholder="ej: 10" value={waterFormData.nitrates} onChange={(e) => setWaterFormData(prev => ({ ...prev, nitrates: e.target.value }))} data-testid="input-water-nitrates" />
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className="border-t pt-4">
              <div className="space-y-2">
                <Label htmlFor="waterNotes">Observaciones</Label>
                <textarea
                  id="waterNotes"
                  className="w-full min-h-[50px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                  placeholder="Condiciones del muestreo, época del año, observaciones..."
                  value={waterFormData.notes}
                  onChange={(e) => setWaterFormData(prev => ({ ...prev, notes: e.target.value }))}
                  data-testid="input-water-notes"
                />
              </div>
            </div>

            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => setShowWaterModal(false)}>Cancelar</Button>
              <Button type="submit" disabled={waterMutation.isPending} data-testid="btn-submit-water">
                {waterMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando...</> : "Guardar Análisis"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Tillage Modal */}
      <Dialog open={showTillageModal} onOpenChange={setShowTillageModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tractor className="w-5 h-5" />
              Agregar Datos de Labranza
            </DialogTitle>
            <DialogDescription>
              Registra las prácticas de labranza para un ciclo agrícola.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); tillageMutation.mutate(tillageFormData); }} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Año del Ciclo</Label>
                <Input
                  type="number"
                  value={tillageFormData.cycleYear}
                  onChange={(e) => setTillageFormData(prev => ({ ...prev, cycleYear: parseInt(e.target.value) }))}
                  data-testid="input-tillage-year"
                />
              </div>
              <div className="space-y-2">
                <Label>Temporada</Label>
                <Select value={tillageFormData.cycleSeason} onValueChange={(v) => setTillageFormData(prev => ({ ...prev, cycleSeason: v }))}>
                  <SelectTrigger data-testid="select-tillage-season">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="primavera-verano">Primavera-Verano</SelectItem>
                    <SelectItem value="otono-invierno">Otoño-Invierno</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="border-t pt-4">
              <h4 className="font-medium mb-3">Actividades Mecanizadas (número de pasos)</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Desvaradora</Label>
                  <Input type="number" min="0" value={tillageFormData.desvaradora} onChange={(e) => setTillageFormData(prev => ({ ...prev, desvaradora: parseInt(e.target.value) || 0 }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Barbecho</Label>
                  <Input type="number" min="0" value={tillageFormData.barbecho} onChange={(e) => setTillageFormData(prev => ({ ...prev, barbecho: parseInt(e.target.value) || 0 }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Rastra</Label>
                  <Input type="number" min="0" value={tillageFormData.rastra} onChange={(e) => setTillageFormData(prev => ({ ...prev, rastra: parseInt(e.target.value) || 0 }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Siembra</Label>
                  <Input type="number" min="0" value={tillageFormData.siembra} onChange={(e) => setTillageFormData(prev => ({ ...prev, siembra: parseInt(e.target.value) || 0 }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Cosechadora</Label>
                  <Input type="number" min="0" value={tillageFormData.cosechadora} onChange={(e) => setTillageFormData(prev => ({ ...prev, cosechadora: parseInt(e.target.value) || 0 }))} />
                </div>
              </div>
            </div>
            <div className="border-t pt-4">
              <h4 className="font-medium mb-3">Manejo de Rastrojos</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">Años reduciendo labranza</Label>
                  <Input type="number" min="0" value={tillageFormData.yearsReducingTillage} onChange={(e) => setTillageFormData(prev => ({ ...prev, yearsReducingTillage: parseInt(e.target.value) || 0 }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">% Rastrojo en campo</Label>
                  <Input type="number" min="0" max="100" value={tillageFormData.residuePercentLeft} onChange={(e) => setTillageFormData(prev => ({ ...prev, residuePercentLeft: parseInt(e.target.value) || 0 }))} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowTillageModal(false)}>Cancelar</Button>
              <Button type="submit" disabled={tillageMutation.isPending} data-testid="btn-submit-tillage">
                {tillageMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Guardando...</> : "Guardar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Rotation Modal */}
      <Dialog open={showRotationModal} onOpenChange={setShowRotationModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="w-5 h-5" />
              Agregar Año de Rotación
            </DialogTitle>
            <DialogDescription>
              Registra los cultivos sembrados en un año específico.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); rotationMutation.mutate(rotationFormData); }} className="space-y-4">
            <div className="space-y-2">
              <Label>Año</Label>
              <Input
                type="number"
                value={rotationFormData.year}
                onChange={(e) => setRotationFormData(prev => ({ ...prev, year: parseInt(e.target.value) }))}
                data-testid="input-rotation-year"
              />
            </div>
            <div className="space-y-2">
              <Label>Cultivos Primavera-Verano (P-V)</Label>
              <Input
                placeholder="ej: Maíz, Sorgo"
                value={rotationFormData.springCrops}
                onChange={(e) => setRotationFormData(prev => ({ ...prev, springCrops: e.target.value }))}
                data-testid="input-spring-crops"
              />
            </div>
            <div className="space-y-2">
              <Label>Cultivos Otoño-Invierno (O-I)</Label>
              <Input
                placeholder="ej: Trigo, Avena"
                value={rotationFormData.fallCrops}
                onChange={(e) => setRotationFormData(prev => ({ ...prev, fallCrops: e.target.value }))}
                data-testid="input-fall-crops"
              />
            </div>
            <div className="space-y-2">
              <Label>Sistema de Rotación</Label>
              <Select value={rotationFormData.rotationSystem} onValueChange={(v) => setRotationFormData(prev => ({ ...prev, rotationSystem: v }))}>
                <SelectTrigger data-testid="select-rotation-system">
                  <SelectValue placeholder="Seleccionar..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rotacion_descanso">Rotación con descanso</SelectItem>
                  <SelectItem value="agroforestal">Sistema agroforestal</SelectItem>
                  <SelectItem value="monocultivo">Monocultivo</SelectItem>
                  <SelectItem value="otro">Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowRotationModal(false)}>Cancelar</Button>
              <Button type="submit" disabled={rotationMutation.isPending} data-testid="btn-submit-rotation">
                {rotationMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Guardando...</> : "Guardar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Animals Modal */}
      <Dialog open={showAnimalsModal} onOpenChange={setShowAnimalsModal}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Beef className="w-5 h-5" />
              Datos de Integración Animal
            </DialogTitle>
            <DialogDescription>
              Registra los animales y prácticas de pastoreo en tu parcela.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); animalsMutation.mutate(animalsFormData); }} className="space-y-4">

            {/* Inventario Animal */}
            <div className="border-t pt-4">
              <h4 className="font-medium mb-3">Inventario Animal</h4>
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <input type="checkbox" className="w-4 h-4" checked={animalsFormData.hasBovinos} onChange={(e) => setAnimalsFormData(prev => ({ ...prev, hasBovinos: e.target.checked }))} data-testid="checkbox-hasBovinos" />
                  <Label className="flex-1 cursor-pointer">Bovinos</Label>
                  <Input type="number" min="0" className="w-20" value={animalsFormData.bovinosCount} onChange={(e) => setAnimalsFormData(prev => ({ ...prev, bovinosCount: parseInt(e.target.value) || 0 }))} disabled={!animalsFormData.hasBovinos} data-testid="input-bovinosCount" />
                </div>
                <div className="flex items-center gap-3">
                  <input type="checkbox" className="w-4 h-4" checked={animalsFormData.hasOvinos} onChange={(e) => setAnimalsFormData(prev => ({ ...prev, hasOvinos: e.target.checked }))} data-testid="checkbox-hasOvinos" />
                  <Label className="flex-1 cursor-pointer">Ovinos</Label>
                  <Input type="number" min="0" className="w-20" value={animalsFormData.ovinosCount} onChange={(e) => setAnimalsFormData(prev => ({ ...prev, ovinosCount: parseInt(e.target.value) || 0 }))} disabled={!animalsFormData.hasOvinos} data-testid="input-ovinosCount" />
                </div>
                <div className="flex items-center gap-3">
                  <input type="checkbox" className="w-4 h-4" checked={animalsFormData.hasAves} onChange={(e) => setAnimalsFormData(prev => ({ ...prev, hasAves: e.target.checked }))} data-testid="checkbox-hasAves" />
                  <Label className="flex-1 cursor-pointer">Aves</Label>
                  <Input type="number" min="0" className="w-20" value={animalsFormData.avesCount} onChange={(e) => setAnimalsFormData(prev => ({ ...prev, avesCount: parseInt(e.target.value) || 0 }))} disabled={!animalsFormData.hasAves} data-testid="input-avesCount" />
                </div>
                <div className="flex items-center gap-3">
                  <input type="checkbox" className="w-4 h-4" checked={animalsFormData.hasCaprinos} onChange={(e) => setAnimalsFormData(prev => ({ ...prev, hasCaprinos: e.target.checked }))} data-testid="checkbox-hasCaprinos" />
                  <Label className="flex-1 cursor-pointer">Caprinos</Label>
                  <Input type="number" min="0" className="w-20" value={animalsFormData.caprinosCount} onChange={(e) => setAnimalsFormData(prev => ({ ...prev, caprinosCount: parseInt(e.target.value) || 0 }))} disabled={!animalsFormData.hasCaprinos} data-testid="input-caprinosCount" />
                </div>
                <div className="flex items-center gap-3">
                  <input type="checkbox" className="w-4 h-4" checked={animalsFormData.hasPorcinos} onChange={(e) => setAnimalsFormData(prev => ({ ...prev, hasPorcinos: e.target.checked }))} data-testid="checkbox-hasPorcinos" />
                  <Label className="flex-1 cursor-pointer">Porcinos</Label>
                  <Input type="number" min="0" className="w-20" value={animalsFormData.porcinosCount} onChange={(e) => setAnimalsFormData(prev => ({ ...prev, porcinosCount: parseInt(e.target.value) || 0 }))} disabled={!animalsFormData.hasPorcinos} data-testid="input-porcinosCount" />
                </div>
                <div className="flex items-center gap-3">
                  <input type="checkbox" className="w-4 h-4" checked={animalsFormData.hasEquinos} onChange={(e) => setAnimalsFormData(prev => ({ ...prev, hasEquinos: e.target.checked }))} data-testid="checkbox-hasEquinos" />
                  <Label className="flex-1 cursor-pointer">Equinos</Label>
                  <Input type="number" min="0" className="w-20" value={animalsFormData.equinosCount} onChange={(e) => setAnimalsFormData(prev => ({ ...prev, equinosCount: parseInt(e.target.value) || 0 }))} disabled={!animalsFormData.hasEquinos} data-testid="input-equinosCount" />
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    className="w-4 h-4"
                    checked={!!animalsFormData.otherAnimals}
                    onChange={(e) => {
                      if (!e.target.checked) setAnimalsFormData(prev => ({ ...prev, otherAnimals: "", otherAnimalsCount: 0 }));
                    }}
                    data-testid="checkbox-otherAnimals"
                  />
                  <Input
                    placeholder="Otros (especificar)"
                    className="flex-1"
                    value={animalsFormData.otherAnimals}
                    onChange={(e) => setAnimalsFormData(prev => ({ ...prev, otherAnimals: e.target.value }))}
                    data-testid="input-otherAnimals"
                  />
                  <Input
                    type="number"
                    min="0"
                    className="w-20"
                    value={animalsFormData.otherAnimalsCount}
                    onChange={(e) => setAnimalsFormData(prev => ({ ...prev, otherAnimalsCount: parseInt(e.target.value) || 0 }))}
                    disabled={!animalsFormData.otherAnimals}
                    data-testid="input-otherAnimalsCount"
                  />
                </div>
              </div>
            </div>

            {/* Sistema de Pastoreo */}
            <div className="border-t pt-4 space-y-3">
              <h4 className="font-medium">Sistema de Pastoreo</h4>
              <div className="space-y-2">
                <Label>Sistema</Label>
                <Select value={animalsFormData.grazingSystem} onValueChange={(v) => setAnimalsFormData(prev => ({ ...prev, grazingSystem: v }))}>
                  <SelectTrigger data-testid="select-grazing-system">
                    <SelectValue placeholder="Seleccionar..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="corral">Corral</SelectItem>
                    <SelectItem value="pastoreo_continuo">Pastoreo Continuo</SelectItem>
                    <SelectItem value="pastoreo_rotacional">Pastoreo Rotacional</SelectItem>
                    <SelectItem value="combinado">Combinado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Detalles adicionales del sistema</Label>
                <textarea
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none min-h-[60px]"
                  placeholder="Describe el manejo, rotación, densidad, etc."
                  value={animalsFormData.grazingSystemDetails}
                  onChange={(e) => setAnimalsFormData(prev => ({ ...prev, grazingSystemDetails: e.target.value }))}
                  data-testid="textarea-grazingSystemDetails"
                />
              </div>
              {animalsFormData.grazingSystem === "pastoreo_rotacional" && (
                <div className="bg-muted/40 rounded-lg p-3 space-y-3">
                  <p className="text-sm font-medium text-muted-foreground">Parámetros de Pastoreo Rotacional</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">N° de potreros</Label>
                      <Input
                        type="number"
                        min="0"
                        value={animalsFormData.numberOfLots}
                        onChange={(e) => setAnimalsFormData(prev => ({ ...prev, numberOfLots: parseInt(e.target.value) || 0 }))}
                        data-testid="input-numberOfLots"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Días de descanso</Label>
                      <Input
                        type="number"
                        min="0"
                        value={animalsFormData.restDays}
                        onChange={(e) => setAnimalsFormData(prev => ({ ...prev, restDays: parseInt(e.target.value) || 0 }))}
                        data-testid="input-restDays"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Carga (UA/ha)</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={animalsFormData.animalLoadPerHa}
                        onChange={(e) => setAnimalsFormData(prev => ({ ...prev, animalLoadPerHa: e.target.value }))}
                        data-testid="input-animalLoadPerHa"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Manejo de Estiércol */}
            <div className="border-t pt-4 space-y-3">
              <h4 className="font-medium">Manejo de Estiércol</h4>
              <div className="space-y-2">
                {[
                  { value: "sin_uso", label: "Sin uso" },
                  { value: "crudo", label: "Crudo aplicado directamente" },
                  { value: "composta", label: "Composta" },
                  { value: "venta", label: "Venta" },
                ].map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      className="w-4 h-4"
                      checked={animalsFormData.manureUse.includes(opt.value)}
                      onChange={(e) => {
                        const val = animalsFormData.manureUse;
                        setAnimalsFormData(prev => ({
                          ...prev,
                          manureUse: e.target.checked ? [...val, opt.value] : val.filter(v => v !== opt.value),
                        }));
                      }}
                      data-testid={`checkbox-manure-${opt.value}`}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
              {animalsFormData.manureUse.includes("composta") && (
                <div className="bg-muted/40 rounded-lg p-3 space-y-3">
                  <p className="text-sm font-medium">Detalles de Compostaje</p>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Tipo de composta</Label>
                    <div className="grid grid-cols-2 gap-1">
                      {[
                        { value: "pilas", label: "Pilas" },
                        { value: "fosa", label: "Fosa" },
                        { value: "contenedor", label: "Contenedor" },
                        { value: "lombricomposta", label: "Lombricomposta" },
                        { value: "termico", label: "Térmico" },
                      ].map((opt) => (
                        <label key={opt.value} className="flex items-center gap-2 cursor-pointer text-sm">
                          <input
                            type="checkbox"
                            className="w-4 h-4"
                            checked={animalsFormData.compostType.includes(opt.value)}
                            onChange={(e) => {
                              const val = animalsFormData.compostType;
                              setAnimalsFormData(prev => ({
                                ...prev,
                                compostType: e.target.checked ? [...val, opt.value] : val.filter(v => v !== opt.value),
                              }));
                            }}
                            data-testid={`checkbox-compost-type-${opt.value}`}
                          />
                          {opt.label}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Materiales utilizados</Label>
                    <div className="grid grid-cols-2 gap-1">
                      {[
                        { value: "rastrojos", label: "Rastrojos" },
                        { value: "cocina", label: "Residuos de cocina" },
                        { value: "podas", label: "Podas" },
                        { value: "tierra_cal", label: "Tierra + cal" },
                        { value: "agua", label: "Agua" },
                      ].map((opt) => (
                        <label key={opt.value} className="flex items-center gap-2 cursor-pointer text-sm">
                          <input
                            type="checkbox"
                            className="w-4 h-4"
                            checked={animalsFormData.compostMaterials.includes(opt.value)}
                            onChange={(e) => {
                              const val = animalsFormData.compostMaterials;
                              setAnimalsFormData(prev => ({
                                ...prev,
                                compostMaterials: e.target.checked ? [...val, opt.value] : val.filter(v => v !== opt.value),
                              }));
                            }}
                            data-testid={`checkbox-compost-material-${opt.value}`}
                          />
                          {opt.label}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAnimalsModal(false)}>Cancelar</Button>
              <Button type="submit" disabled={animalsMutation.isPending} data-testid="btn-submit-animals">
                {animalsMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Guardando...</> : "Guardar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Livelihood Modal */}
      <Dialog open={showLivelihoodModal} onOpenChange={setShowLivelihoodModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5" />
              Datos de Comercialización
            </DialogTitle>
            <DialogDescription>
              Registra la distribución de ingresos y canales de venta.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); livelihoodMutation.mutate(livelihoodFormData); }} className="space-y-4">
            <div className="border-t pt-4">
              <h4 className="font-medium mb-3">Distribución de Ingresos (%)</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Agrícola</Label>
                  <Input type="number" min="0" max="100" value={livelihoodFormData.incomeAgricultural} onChange={(e) => setLivelihoodFormData(prev => ({ ...prev, incomeAgricultural: parseInt(e.target.value) || 0 }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Pecuario</Label>
                  <Input type="number" min="0" max="100" value={livelihoodFormData.incomeAnimal} onChange={(e) => setLivelihoodFormData(prev => ({ ...prev, incomeAnimal: parseInt(e.target.value) || 0 }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">No Agrícola</Label>
                  <Input type="number" min="0" max="100" value={livelihoodFormData.incomeNonAgricultural} onChange={(e) => setLivelihoodFormData(prev => ({ ...prev, incomeNonAgricultural: parseInt(e.target.value) || 0 }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Remesas</Label>
                  <Input type="number" min="0" max="100" value={livelihoodFormData.incomeRemittances} onChange={(e) => setLivelihoodFormData(prev => ({ ...prev, incomeRemittances: parseInt(e.target.value) || 0 }))} />
                </div>
              </div>
            </div>
            <div className="border-t pt-4">
              <h4 className="font-medium mb-3">Canales de Venta</h4>
              <div className="space-y-2">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={livelihoodFormData.sellsToConsumers} onChange={(e) => setLivelihoodFormData(prev => ({ ...prev, sellsToConsumers: e.target.checked }))} />
                  Venta directa a consumidores
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={livelihoodFormData.sellsToIntermediaries} onChange={(e) => setLivelihoodFormData(prev => ({ ...prev, sellsToIntermediaries: e.target.checked }))} />
                  Venta a intermediarios
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={livelihoodFormData.sellsToCooperatives} onChange={(e) => setLivelihoodFormData(prev => ({ ...prev, sellsToCooperatives: e.target.checked }))} />
                  Venta a cooperativas
                </label>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowLivelihoodModal(false)}>Cancelar</Button>
              <Button type="submit" disabled={livelihoodMutation.isPending} data-testid="btn-submit-livelihood">
                {livelihoodMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Guardando...</> : "Guardar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={showCostsModal} onOpenChange={setShowCostsModal}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Agregar Costo de Producción</DialogTitle>
            <DialogDescription>Registra un gasto del ciclo agrícola actual</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); costsMutation.mutate(costsFormData); }} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Año *</Label>
                <Input type="number" value={costsFormData.cycleYear} onChange={(e) => setCostsFormData({...costsFormData, cycleYear: parseInt(e.target.value)})} data-testid="input-cost-year" />
              </div>
              <div className="space-y-1">
                <Label>Temporada *</Label>
                <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={costsFormData.cycleSeason} onChange={(e) => setCostsFormData({...costsFormData, cycleSeason: e.target.value})} data-testid="select-cost-season">
                  <option value="primavera-verano">Primavera-Verano</option>
                  <option value="otono-invierno">Otoño-Invierno</option>
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <Label>Categoría *</Label>
              <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={costsFormData.category} onChange={(e) => setCostsFormData({...costsFormData, category: e.target.value})} data-testid="select-cost-category">
                {Object.entries(categoryGroups).map(([groupName, cats]) => (
                  <optgroup key={groupName} label={groupName}>
                    {cats.map(cat => (
                      <option key={cat} value={cat}>{categoryLabels[cat]}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <Label>Concepto / Descripción *</Label>
              <Input placeholder="ej: Urea 46%, Semilla híbrida, Jornales..." value={costsFormData.concept} onChange={(e) => setCostsFormData({...costsFormData, concept: e.target.value})} required data-testid="input-cost-concept" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label>Cantidad</Label>
                <Input type="number" step="0.01" placeholder="ej: 5" value={costsFormData.quantity} onChange={(e) => {
                  const newData = {...costsFormData, quantity: e.target.value};
                  if (e.target.value && newData.unitCost) {
                    newData.totalCost = (parseFloat(e.target.value) * parseFloat(newData.unitCost)).toFixed(2);
                  }
                  setCostsFormData(newData);
                }} data-testid="input-cost-quantity" />
              </div>
              <div className="space-y-1">
                <Label>Unidad</Label>
                <Input placeholder="kg, lt, jornal, ha" value={costsFormData.unit} onChange={(e) => setCostsFormData({...costsFormData, unit: e.target.value})} data-testid="input-cost-unit" />
              </div>
              <div className="space-y-1">
                <Label>Costo Unitario</Label>
                <Input type="number" step="0.01" placeholder="$" value={costsFormData.unitCost} onChange={(e) => {
                  const newData = {...costsFormData, unitCost: e.target.value};
                  if (e.target.value && newData.quantity) {
                    newData.totalCost = (parseFloat(newData.quantity) * parseFloat(e.target.value)).toFixed(2);
                  }
                  setCostsFormData(newData);
                }} data-testid="input-cost-unit-cost" />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Costo Total (MXN) *</Label>
              <Input type="number" step="0.01" placeholder="$0.00" value={costsFormData.totalCost} onChange={(e) => setCostsFormData({...costsFormData, totalCost: e.target.value})} required data-testid="input-cost-total" />
              <p className="text-xs text-muted-foreground">Se calcula automáticamente si ingresas cantidad y costo unitario</p>
            </div>

            <div className="space-y-1">
              <Label>Notas</Label>
              <Input placeholder="Observaciones opcionales" value={costsFormData.notes} onChange={(e) => setCostsFormData({...costsFormData, notes: e.target.value})} data-testid="input-cost-notes" />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCostsModal(false)}>Cancelar</Button>
              <Button type="submit" disabled={costsMutation.isPending} data-testid="btn-save-cost">
                {costsMutation.isPending ? "Guardando..." : "Guardar Costo"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Delete polygon confirmation dialog ─────────────────────── */}
      <Dialog open={showDeletePolygonDialog} onOpenChange={setShowDeletePolygonDialog}>
        <DialogContent data-testid="dialog-delete-polygon">
          <DialogHeader>
            <DialogTitle>¿Eliminar polígono del lote?</DialogTitle>
            <DialogDescription>
              Se eliminará el límite dibujado. El lote seguirá existiendo, pero sin polígono definido. Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeletePolygonDialog(false)}
              disabled={deletePolygonMutation.isPending}
              data-testid="button-cancel-delete-polygon"
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => deletePolygonMutation.mutate()}
              disabled={deletePolygonMutation.isPending}
              data-testid="button-confirm-delete-polygon"
            >
              {deletePolygonMutation.isPending ? (
                <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Eliminando…</>
              ) : (
                <><Trash2 className="w-3.5 h-3.5 mr-1" /> Eliminar polígono</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showFullscreenMap && (
        <div className="fixed inset-0 z-[9999] bg-background flex flex-col" data-testid="fullscreen-map-modal">
          <div className="flex items-center justify-between p-3 border-b bg-background/95 backdrop-blur">
            <div className="flex items-center gap-3">
              <h3 className="font-semibold text-sm md:text-base">{parcel.name} - {selectedIndex.toUpperCase()}</h3>
              <Badge variant="outline" className="text-xs">
                {tileImageDate || latestIndexDate}
              </Badge>
              {parcel.crop && (
                <Badge variant="secondary" className="text-xs">{parcel.crop}</Badge>
              )}
            </div>
            <button
              onClick={() => setShowFullscreenMap(false)}
              className="p-2 rounded-md hover:bg-secondary transition-colors"
              data-testid="button-close-fullscreen"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 flex flex-col lg:flex-row">
            <div className="flex-1 relative">
              <ParcelLeafletMap
                mapCenter={mapCenter}
                polygonCoords={polygonCoords}
                hasIndexTiles={!!hasIndexTiles}
                indexTileUrl={indexTileUrl}
                selectedIndex={selectedIndex}
                currentIndexValue={currentIndexValue}
                scrollWheelZoom={true}
                zoomControl={true}
                mapStyle={{ minHeight: "400px" }}
              />
            </div>

            <div className="lg:w-80 xl:w-96 border-t lg:border-t-0 lg:border-l overflow-y-auto p-4 space-y-4 bg-background">
              <div>
                <h4 className="font-semibold text-sm mb-3">Escala del Índice</h4>
                {selectedIndex === "ndvi" && (
                  <div className="space-y-2">
                    <div className="h-4 w-full bg-gradient-to-r from-red-600 via-yellow-400 to-green-600 rounded" />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>0.0 - Suelo desnudo</span>
                      <span>0.5 - Moderado</span>
                      <span>1.0 - Muy denso</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-[10px] mt-2">
                      <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-red-600" /> 0.0-0.2 Suelo/Agua</div>
                      <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-orange-400" /> 0.2-0.3 Vegetación escasa</div>
                      <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-yellow-400" /> 0.3-0.5 Veg. moderada</div>
                      <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-lime-500" /> 0.5-0.7 Veg. saludable</div>
                      <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-green-600" /> 0.7-0.85 Veg. densa</div>
                      <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-green-800" /> 0.85-1.0 Muy densa</div>
                    </div>
                  </div>
                )}
                {selectedIndex === "evi" && (
                  <div className="space-y-2">
                    <div className="h-4 w-full bg-gradient-to-r from-amber-900 via-amber-300 to-teal-800 rounded" />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>0.0 - Sin vegetación</span>
                      <span>0.5 - Moderado</span>
                      <span>1.0 - Alta biomasa</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-[10px] mt-2">
                      <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-amber-900" /> 0.0-0.2 Suelo desnudo</div>
                      <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-amber-600" /> 0.2-0.4 Baja cobertura</div>
                      <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-amber-300" /> 0.4-0.6 Cobertura moderada</div>
                      <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-teal-500" /> 0.6-0.8 Alta cobertura</div>
                      <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-teal-800" /> 0.8-1.0 Biomasa muy alta</div>
                    </div>
                  </div>
                )}
                {selectedIndex === "ndmi" && (
                  <div className="space-y-2">
                    <div className="h-4 w-full bg-gradient-to-r from-red-700 via-yellow-200 to-blue-800 rounded" />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>-0.5 - Seco</span>
                      <span>0.0</span>
                      <span>0.5 - Húmedo</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-[10px] mt-2">
                      <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-red-700" /> {`<`}-0.2 Estrés hídrico severo</div>
                      <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-orange-400" /> -0.2-0.0 Estrés moderado</div>
                      <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-yellow-200" /> 0.0-0.2 Humedad baja</div>
                      <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-blue-400" /> 0.2-0.4 Humedad adecuada</div>
                      <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-blue-800" /> {`>`}0.4 Alta humedad</div>
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t pt-4">
                <h4 className="font-semibold text-sm mb-2">Valor Actual</h4>
                <div className="text-3xl font-bold mb-1" data-testid="fullscreen-index-value">
                  {currentIndexValue.toFixed(2)}
                </div>
                <Badge className={
                  currentIndexValue >= 0.7 ? "bg-green-500" :
                  currentIndexValue >= 0.5 ? "bg-lime-500" :
                  currentIndexValue >= 0.3 ? "bg-yellow-500" : "bg-red-500"
                }>
                  {selectedIndex === "ndvi" ? (
                    currentIndexValue >= 0.7 ? "Excelente" :
                    currentIndexValue >= 0.5 ? "Bueno" :
                    currentIndexValue >= 0.3 ? "Moderado" : "Bajo"
                  ) : selectedIndex === "evi" ? (
                    currentIndexValue >= 0.6 ? "Alta biomasa" :
                    currentIndexValue >= 0.3 ? "Biomasa moderada" : "Baja biomasa"
                  ) : (
                    currentIndexValue >= 0.3 ? "Hidratado" :
                    currentIndexValue >= 0.0 ? "Humedad baja" : "Estrés hídrico"
                  )}
                </Badge>
              </div>

              <div className="border-t pt-4">
                <h4 className="font-semibold text-sm mb-2">Interpretación</h4>
                <div className="space-y-3 text-sm">
                  {selectedIndex === "ndvi" && (
                    <>
                      <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                        <p className="font-medium text-green-800 mb-1">Estado del {parcel.crop || "Cultivo"}</p>
                        <p className="text-green-700 text-xs">
                          {currentIndexValue >= 0.7
                            ? `Tu ${parcel.crop || "cultivo"} presenta vegetación densa y saludable con alta actividad fotosintética. Esto indica buen vigor y cobertura vegetal adecuada.`
                            : currentIndexValue >= 0.5
                            ? `Tu ${parcel.crop || "cultivo"} muestra desarrollo moderado. La cobertura vegetal es aceptable pero podría mejorar con nutrición adecuada.`
                            : currentIndexValue >= 0.3
                            ? `Tu ${parcel.crop || "cultivo"} presenta vegetación dispersa. Revisa condiciones de suelo, riego y posibles plagas o deficiencias nutricionales.`
                            : `Se detecta poca cobertura vegetal en tu ${parcel.crop || "cultivo"}. Esto puede indicar suelo expuesto, estrés severo o etapa temprana del ciclo.`}
                        </p>
                      </div>
                      {currentExpectedStage && (
                        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                          <p className="font-medium text-blue-800 mb-1">Etapa: {currentExpectedStage}</p>
                          <p className="text-blue-700 text-xs">
                            {currentIndexValue >= 0.6
                              ? `El NDVI es consistente con un buen desarrollo en la etapa de ${currentExpectedStage.toLowerCase()}.`
                              : `El NDVI parece bajo para la etapa de ${currentExpectedStage.toLowerCase()}. Considera revisar las condiciones del cultivo.`}
                          </p>
                        </div>
                      )}
                    </>
                  )}
                  {selectedIndex === "evi" && (
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                      <p className="font-medium text-emerald-800 mb-1">Biomasa del {parcel.crop || "Cultivo"}</p>
                      <p className="text-emerald-700 text-xs">
                        {currentIndexValue >= 0.6
                          ? `El EVI indica alta biomasa y actividad fotosintética en tu ${parcel.crop || "cultivo"}. El índice EVI es más preciso que el NDVI en zonas de vegetación densa ya que corrige distorsiones atmosféricas.`
                          : currentIndexValue >= 0.3
                          ? `Biomasa moderada detectada en tu ${parcel.crop || "cultivo"}. El EVI sugiere desarrollo vegetativo en progreso.`
                          : `Baja biomasa detectada. Tu ${parcel.crop || "cultivo"} podría estar en etapa temprana o experimentando limitaciones de crecimiento.`}
                      </p>
                    </div>
                  )}
                  {selectedIndex === "ndmi" && (
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <p className="font-medium text-blue-800 mb-1">Estado Hídrico del {parcel.crop || "Cultivo"}</p>
                      <p className="text-blue-700 text-xs">
                        {currentIndexValue >= 0.3
                          ? `Tu ${parcel.crop || "cultivo"} tiene niveles adecuados de humedad. No se detecta estrés hídrico.`
                          : currentIndexValue >= 0.0
                          ? `Humedad baja detectada en tu ${parcel.crop || "cultivo"}. Monitorea la disponibilidad de agua y considera ajustar el riego.`
                          : `Se detecta estrés hídrico significativo en tu ${parcel.crop || "cultivo"}. Es importante verificar el sistema de riego y la disponibilidad de agua inmediatamente.`}
                      </p>
                    </div>
                  )}
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="font-medium text-amber-800 mb-1">Recomendación</p>
                    <p className="text-amber-700 text-xs">
                      {selectedIndex === "ndvi" && currentIndexValue < 0.5
                        ? "Realiza una inspección de campo para identificar las causas de baja cobertura. Verifica nutrición, riego, presencia de plagas y condición del suelo."
                        : selectedIndex === "ndmi" && currentIndexValue < 0.2
                        ? "Revisa la frecuencia y eficiencia del riego. Considera implementar técnicas de conservación de humedad como mulching o cobertura orgánica."
                        : "Continúa con el plan de manejo actual. Se recomienda monitoreo periódico cada 5-10 días para detectar cambios tempranos."}
                    </p>
                  </div>
                </div>
              </div>

              <div className="border-t pt-4 text-xs text-muted-foreground">
                <p>Fuente: Sentinel-2 (Copernicus/ESA)</p>
                <p>Resolución: 10m/px</p>
                {tileImageDate && <p>Fecha de imagen: {tileImageDate}</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

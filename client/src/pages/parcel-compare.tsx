import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, CalendarDays, Layers, TrendingUp, TrendingDown, Minus, Cloud, Loader2, ArrowLeftRight, Info } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { MapContainer, TileLayer, Polygon, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

interface SentinelImage {
  date: string;
  cloudPercentage: number;
  id: string;
}

interface IndicesData {
  date: string;
  ndvi: number;
  evi: number;
  ndmi: number;
}

function MapController({ center, zoom, bounds }: { center: [number, number]; zoom: number; bounds?: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (bounds && bounds.length > 0) {
      const L = (window as any).L;
      if (L) {
        const latLngBounds = L.latLngBounds(bounds.map((c: number[]) => [c[0], c[1]]));
        map.fitBounds(latLngBounds, { padding: [20, 20] });
      }
    } else {
      map.setView(center, zoom);
    }
  }, [center, zoom, bounds, map]);
  return null;
}

function getIndexLabel(index: string) {
  switch (index) {
    case "ndvi": return "NDVI (Salud Vegetal)";
    case "evi": return "EVI (Biomasa)";
    case "ndmi": return "NDMI (Contenido Hídrico)";
    default: return index.toUpperCase();
  }
}

function getIndexDescription(index: string) {
  switch (index) {
    case "ndvi": return "Mide la salud y densidad de la vegetación";
    case "evi": return "Índice mejorado de biomasa vegetal";
    case "ndmi": return "Indicador de estrés hídrico y humedad foliar";
    default: return "";
  }
}

function getValueStatus(index: string, value: number) {
  if (index === "ndvi") {
    if (value >= 0.7) return { label: "Excelente", color: "bg-green-500" };
    if (value >= 0.5) return { label: "Bueno", color: "bg-lime-500" };
    if (value >= 0.3) return { label: "Moderado", color: "bg-yellow-500" };
    return { label: "Bajo", color: "bg-red-500" };
  } else if (index === "evi") {
    if (value >= 0.6) return { label: "Alta biomasa", color: "bg-teal-500" };
    if (value >= 0.3) return { label: "Biomasa moderada", color: "bg-amber-500" };
    return { label: "Baja biomasa", color: "bg-red-500" };
  } else {
    if (value >= 0.3) return { label: "Óptimo", color: "bg-blue-500" };
    if (value >= 0.1) return { label: "Adecuado", color: "bg-blue-400" };
    if (value >= 0.0) return { label: "Bajo", color: "bg-yellow-500" };
    if (value >= -0.2) return { label: "Deficiente", color: "bg-orange-500" };
    return { label: "Crítico", color: "bg-red-500" };
  }
}

// Precise multi-stop gradients that match GEE's actual rendering palette
const INDEX_META: Record<string, { gradient: string; min: string; mid: string; max: string }> = {
  ndvi:  { gradient: "linear-gradient(to right,#a50026,#d73027,#f46d43,#fdae61,#fee08b,#d9ef8b,#a6d96a,#66bd63,#1a9850,#006837)", min: "0.0 Suelo", mid: "0.5", max: "1.0 Densa" },
  evi:   { gradient: "linear-gradient(to right,#543005,#8c510a,#bf812d,#dfc27d,#f6e8c3,#c7eae5,#80cdc1,#35978f,#01665e,#003c30)", min: "0.0 Sin veg.", mid: "1.0", max: "2.0 Alta" },
  ndmi:  { gradient: "linear-gradient(to right,#8b0000,#d7191c,#fdae61,#ffffbf,#abd9e9,#2c7bb6,#023858)", min: "-0.5 Seco", mid: "0.0", max: "0.5 Húmedo" },
  ndre:  { gradient: "linear-gradient(to right,#7f2704,#d94801,#f16913,#fd8d3c,#fdbe85,#c7e9c0,#74c476,#31a354,#006d2c)", min: "-0.1 Bajo", mid: "0.2", max: "0.5 Alto" },
  gndvi: { gradient: "linear-gradient(to right,#a50026,#d73027,#f46d43,#fdae61,#fee090,#e0f3f8,#74add1,#313695,#08306b)", min: "0.0 Suelo", mid: "0.4", max: "0.8 Densa" },
  msavi: { gradient: "linear-gradient(to right,#543005,#bf812d,#f6e8c3,#d9ef8b,#a6d96a,#66bd63,#1a9850,#006837)", min: "-0.1 Suelo", mid: "0.35", max: "0.8 Densa" },
};

function getGradientStyle(index: string): string {
  return (INDEX_META[index] ?? INDEX_META.ndvi).gradient;
}

function getGradientLabels(index: string): [string, string, string] {
  const m = INDEX_META[index] ?? INDEX_META.ndvi;
  return [m.min, m.mid, m.max];
}

function getNDVIColor(value: number): string {
  if (value >= 0.7) return "#15803d";
  if (value >= 0.5) return "#65a30d";
  if (value >= 0.3) return "#eab308";
  if (value >= 0.1) return "#f97316";
  return "#dc2626";
}

function interpretChange(index: string, diff: number, pctChange: number): string {
  const absChange = Math.abs(pctChange);
  if (index === "ndvi") {
    if (diff > 0.1) return "Mejora significativa en la salud vegetal. La cobertura y actividad fotosintética aumentaron notablemente.";
    if (diff > 0.03) return "Mejora moderada en la vegetación. El cultivo muestra avance saludable entre las fechas comparadas.";
    if (diff > -0.03) return "La salud vegetal se mantiene estable. No se observan cambios significativos entre las fechas.";
    if (diff > -0.1) return "Ligera disminución en la cobertura vegetal. Podría indicar inicio de senescencia o estrés leve.";
    return "Disminución importante de la vegetación. Revisar posibles causas: plagas, sequía, cosecha o daño mecánico.";
  } else if (index === "evi") {
    if (diff > 0.1) return "Aumento notable de biomasa. El cultivo está acumulando materia vegetal activamente.";
    if (diff > 0.03) return "Incremento moderado en biomasa. El desarrollo vegetal progresa normalmente.";
    if (diff > -0.03) return "La biomasa se mantiene estable entre ambas fechas.";
    if (diff > -0.1) return "Reducción moderada de biomasa. Puede ser normal en etapas finales del ciclo.";
    return "Pérdida importante de biomasa. Investigar causas posibles de deterioro del cultivo.";
  } else {
    if (diff > 0.1) return "Aumento significativo de humedad foliar. Posible efecto de lluvias recientes o riego.";
    if (diff > 0.03) return "Mejora moderada en el contenido hídrico del cultivo.";
    if (diff > -0.03) return "El estado hídrico se mantiene sin cambios relevantes.";
    if (diff > -0.1) return "Disminución de humedad en el follaje. Monitorear disponibilidad de agua.";
    return "Pérdida crítica de humedad. Riesgo de estrés hídrico severo. Acción de riego urgente recomendada.";
  }
}

function MapPanel({ 
  parcelId, index, date, polygonCoords, mapCenter, label 
}: { 
  parcelId: string; index: string; date: string; 
  polygonCoords: [number, number][]; mapCenter: [number, number]; label: string;
}) {
  const { data: tilesData } = useQuery({
    queryKey: ["compare-tiles", parcelId, index, date],
    queryFn: async () => {
      const dateParam = date ? `&date=${date}` : "";
      const response = await fetch(`/api/parcels/${parcelId}/index-tiles?index=${index}${dateParam}`, {
        credentials: "include",
      });
      if (!response.ok) return { available: false };
      return response.json();
    },
    enabled: !!parcelId && !!date,
  });

  const hasIndexTiles = tilesData?.available && tilesData?.urlFormat;
  const indexTileUrl = tilesData?.urlFormat || null;
  const gradientLabels = getGradientLabels(index);

  return (
    <div className="flex-1 min-w-0">
      <div className="text-sm font-semibold mb-2 text-center">{label}</div>
      <div className="relative rounded-lg overflow-hidden border" style={{ height: "350px" }}>
        <MapContainer
          center={mapCenter}
          zoom={14}
          className="w-full h-full"
          scrollWheelZoom={true}
          zoomControl={false}
        >
          <TileLayer
            attribution='&copy; Esri'
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          />
          {hasIndexTiles && indexTileUrl && (
            <TileLayer url={indexTileUrl} opacity={0.7} attribution="Google Earth Engine" />
          )}
          {polygonCoords.length > 0 && (
            <Polygon
              positions={polygonCoords}
              pathOptions={{
                color: hasIndexTiles ? "#ffffff" : "#666666",
                fillColor: hasIndexTiles ? "transparent" : "#888888",
                fillOpacity: hasIndexTiles ? 0 : 0.3,
                weight: 2,
              }}
            />
          )}
          <MapController center={mapCenter} zoom={14} bounds={polygonCoords.length > 0 ? polygonCoords : undefined} />
        </MapContainer>
        <div className="absolute bottom-2 left-2 right-2 bg-background/90 backdrop-blur p-2 rounded-md z-[400]">
          <div className="flex items-center gap-1 mb-0.5">
            <span className="text-[10px] font-bold">{index.toUpperCase()}</span>
          </div>
          <div className="h-2.5 w-full rounded-full" style={{ background: getGradientStyle(index) }} />
          <div className="flex justify-between text-[9px] text-muted-foreground mt-0.5">
            <span>{gradientLabels[0]}</span>
            <span>{gradientLabels[1]}</span>
            <span>{gradientLabels[2]}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ParcelCompare() {
  const params = useParams<{ id: string }>();
  const [mode, setMode] = useState<"dates" | "indices">("dates");
  const [selectedIndex, setSelectedIndex] = useState("ndvi");
  const [dateA, setDateA] = useState("");
  const [dateB, setDateB] = useState("");
  const [indexA, setIndexA] = useState("ndvi");
  const [indexB, setIndexB] = useState("ndmi");
  const [compareDate, setCompareDate] = useState("");

  const { data: parcelData, isLoading: parcelLoading } = useQuery({
    queryKey: ["parcel", params.id],
    queryFn: async () => {
      const response = await fetch(`/api/parcels/${params.id}`, { credentials: "include" });
      if (!response.ok) throw new Error("Error al cargar parcela");
      return response.json();
    },
  });

  const { data: sentinelImagesData, isLoading: imagesLoading } = useQuery({
    queryKey: ["sentinel-images", params.id],
    queryFn: async () => {
      const response = await fetch(`/api/parcels/${params.id}/sentinel-images?months=3`, { credentials: "include" });
      if (!response.ok) return { images: [] };
      return response.json();
    },
    enabled: !!params.id,
  });

  const { data: indicesData } = useQuery({
    queryKey: ["parcel-indices", params.id, "quarter"],
    queryFn: async () => {
      const response = await fetch(`/api/parcels/${params.id}/indices?period=quarter`, { credentials: "include" });
      if (!response.ok) return { indices: [] };
      return response.json();
    },
    enabled: !!params.id,
  });

  const { data: changeMapData, isLoading: changeMapLoading } = useQuery({
    queryKey: ["change-map", params.id, selectedIndex, dateA, dateB],
    queryFn: async () => {
      const response = await fetch(
        `/api/parcels/${params.id}/change-map?index=${selectedIndex}&dateA=${dateA}&dateB=${dateB}`,
        { credentials: "include" }
      );
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!params.id && !!dateA && !!dateB,
  });

  const sentinelImages: SentinelImage[] = sentinelImagesData?.images || [];
  const indices: IndicesData[] = indicesData?.indices || [];

  useEffect(() => {
    if (sentinelImages.length >= 2 && !dateA && !dateB) {
      setDateA(sentinelImages[sentinelImages.length > 5 ? 5 : sentinelImages.length - 1].date);
      setDateB(sentinelImages[0].date);
    }
    if (sentinelImages.length >= 1 && !compareDate) {
      setCompareDate(sentinelImages[0].date);
    }
  }, [sentinelImages]);

  if (parcelLoading || imagesLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const parcel = parcelData?.parcel;
  if (!parcel) return <div className="p-8 text-center">Parcela no encontrada</div>;

  const polygonCoords: [number, number][] = parcel.polygonCoordinates || [];
  const mapCenter: [number, number] = [parseFloat(parcel.latitude), parseFloat(parcel.longitude)];

  const getIndexValueForDate = (date: string, index: string): number | null => {
    const entry = indices.find(i => i.date === date);
    if (!entry) return null;
    return (entry as any)[index] ?? null;
  };

  const valueA_dates = dateA ? getIndexValueForDate(dateA, selectedIndex) : null;
  const valueB_dates = dateB ? getIndexValueForDate(dateB, selectedIndex) : null;
  const diff_dates = valueA_dates !== null && valueB_dates !== null ? valueB_dates - valueA_dates : null;
  const pctChange_dates = valueA_dates !== null && valueA_dates !== 0 && diff_dates !== null
    ? (diff_dates / Math.abs(valueA_dates)) * 100 : null;

  const valueA_indices = compareDate ? getIndexValueForDate(compareDate, indexA) : null;
  const valueB_indices = compareDate ? getIndexValueForDate(compareDate, indexB) : null;

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href={`/parcel/${params.id}`}>
          <Button variant="ghost" size="icon" data-testid="button-back-compare">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold" data-testid="text-compare-title">Comparación de Índices — {parcel.name}</h1>
          <p className="text-sm text-muted-foreground">{parcel.location} · {parcel.crop} · {parcel.area} ha</p>
        </div>
      </div>

      <Tabs value={mode} onValueChange={(v) => setMode(v as "dates" | "indices")} className="space-y-6">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="dates" className="flex items-center gap-2" data-testid="tab-compare-dates">
            <CalendarDays className="w-4 h-4" /> Entre Fechas
          </TabsTrigger>
          <TabsTrigger value="indices" className="flex items-center gap-2" data-testid="tab-compare-indices">
            <Layers className="w-4 h-4" /> Entre Índices
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dates" className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Comparar mismo índice en dos fechas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end relative z-[1000]">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Índice</label>
                  <Select value={selectedIndex} onValueChange={setSelectedIndex}>
                    <SelectTrigger data-testid="select-compare-index">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[1000]">
                      <SelectItem value="ndvi">NDVI — Salud Vegetal</SelectItem>
                      <SelectItem value="evi">EVI — Índice Veg. Mejorado</SelectItem>
                      <SelectItem value="ndmi">NDMI — Contenido Hídrico</SelectItem>
                      <SelectItem value="ndre">NDRE — Red Edge / Nitrógeno</SelectItem>
                      <SelectItem value="gndvi">GNDVI — Veg. Banda Verde</SelectItem>
                      <SelectItem value="msavi">MSAVI — Ajustado al Suelo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Fecha A (anterior)</label>
                  <Select value={dateA} onValueChange={setDateA}>
                    <SelectTrigger data-testid="select-date-a">
                      <SelectValue placeholder="Seleccionar fecha" />
                    </SelectTrigger>
                    <SelectContent className="z-[1000]">
                      {sentinelImages.map((img) => (
                        <SelectItem key={img.id} value={img.date}>
                          <span className="flex items-center gap-2">
                            {img.date} <Cloud className="w-3 h-3 text-muted-foreground" /> {img.cloudPercentage.toFixed(0)}%
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Fecha B (reciente)</label>
                  <Select value={dateB} onValueChange={setDateB}>
                    <SelectTrigger data-testid="select-date-b">
                      <SelectValue placeholder="Seleccionar fecha" />
                    </SelectTrigger>
                    <SelectContent className="z-[1000]">
                      {sentinelImages.map((img) => (
                        <SelectItem key={img.id} value={img.date}>
                          <span className="flex items-center gap-2">
                            {img.date} <Cloud className="w-3 h-3 text-muted-foreground" /> {img.cloudPercentage.toFixed(0)}%
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {dateA && dateB && (
                <>
                  <div className="flex flex-col lg:flex-row gap-4 mt-4">
                    <MapPanel
                      parcelId={params.id!}
                      index={selectedIndex}
                      date={dateA}
                      polygonCoords={polygonCoords}
                      mapCenter={mapCenter}
                      label={`${getIndexLabel(selectedIndex)} — ${dateA}`}
                    />
                    <div className="flex items-center justify-center lg:py-0 py-2">
                      <ArrowLeftRight className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <MapPanel
                      parcelId={params.id!}
                      index={selectedIndex}
                      date={dateB}
                      polygonCoords={polygonCoords}
                      mapCenter={mapCenter}
                      label={`${getIndexLabel(selectedIndex)} — ${dateB}`}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                    <Card className="border-blue-200 bg-blue-50/50">
                      <CardContent className="pt-4 text-center">
                        <p className="text-xs text-muted-foreground mb-1">{dateA}</p>
                        <div className="text-2xl font-bold" data-testid="value-date-a">
                          {valueA_dates !== null ? valueA_dates.toFixed(3) : "—"}
                        </div>
                        {valueA_dates !== null && (
                          <Badge className={`mt-1 ${getValueStatus(selectedIndex, valueA_dates).color}`}>
                            {getValueStatus(selectedIndex, valueA_dates).label}
                          </Badge>
                        )}
                      </CardContent>
                    </Card>

                    <Card className={`border-2 ${diff_dates !== null && diff_dates > 0.03 ? "border-green-300 bg-green-50/50" : diff_dates !== null && diff_dates < -0.03 ? "border-red-300 bg-red-50/50" : "border-gray-200 bg-gray-50/50"}`}>
                      <CardContent className="pt-4 text-center">
                        <p className="text-xs text-muted-foreground mb-1">Cambio</p>
                        <div className="flex items-center justify-center gap-2">
                          {diff_dates !== null ? (
                            diff_dates > 0.03 ? <TrendingUp className="w-5 h-5 text-green-600" /> :
                            diff_dates < -0.03 ? <TrendingDown className="w-5 h-5 text-red-600" /> :
                            <Minus className="w-5 h-5 text-gray-500" />
                          ) : null}
                          <span className="text-2xl font-bold" data-testid="value-diff">
                            {diff_dates !== null ? `${diff_dates > 0 ? "+" : ""}${diff_dates.toFixed(3)}` : "—"}
                          </span>
                        </div>
                        {pctChange_dates !== null && (
                          <p className={`text-sm font-medium mt-1 ${pctChange_dates > 0 ? "text-green-600" : pctChange_dates < 0 ? "text-red-600" : "text-gray-600"}`}>
                            {pctChange_dates > 0 ? "+" : ""}{pctChange_dates.toFixed(1)}%
                          </p>
                        )}
                      </CardContent>
                    </Card>

                    <Card className="border-blue-200 bg-blue-50/50">
                      <CardContent className="pt-4 text-center">
                        <p className="text-xs text-muted-foreground mb-1">{dateB}</p>
                        <div className="text-2xl font-bold" data-testid="value-date-b">
                          {valueB_dates !== null ? valueB_dates.toFixed(3) : "—"}
                        </div>
                        {valueB_dates !== null && (
                          <Badge className={`mt-1 ${getValueStatus(selectedIndex, valueB_dates).color}`}>
                            {getValueStatus(selectedIndex, valueB_dates).label}
                          </Badge>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  {diff_dates !== null && (
                    <Card className="border-amber-200 bg-amber-50/30">
                      <CardContent className="pt-4">
                        <div className="flex items-start gap-3">
                          <Info className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
                          <div>
                            <p className="font-semibold text-sm text-amber-800 mb-1">Interpretación</p>
                            <p className="text-sm text-amber-700" data-testid="text-interpretation-dates">
                              {interpretChange(selectedIndex, diff_dates, pctChange_dates || 0)}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  <Card className="border-border/60">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Layers className="w-4 h-4" />
                        Mapa de Cambios — {getIndexLabel(selectedIndex)}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground">
                        Diferencia pixel a pixel entre {dateA} y {dateB}. Rojo = disminución, Amarillo = sin cambio, Verde = aumento.
                      </p>
                    </CardHeader>
                    <CardContent>
                      {changeMapLoading ? (
                        <div className="flex items-center justify-center h-64">
                          <Loader2 className="w-6 h-6 animate-spin text-primary mr-2" />
                          <span className="text-sm text-muted-foreground">Generando mapa de cambios...</span>
                        </div>
                      ) : changeMapData?.available && changeMapData?.urlFormat ? (
                        <div className="space-y-3">
                          <div className="relative rounded-lg overflow-hidden border" style={{ height: "350px" }}>
                            <MapContainer
                              center={mapCenter}
                              zoom={15}
                              className="w-full h-full"
                              scrollWheelZoom={true}
                              zoomControl={true}
                            >
                              <MapController center={mapCenter} zoom={15} bounds={polygonCoords.length > 0 ? polygonCoords : undefined} />
                              <TileLayer
                                attribution='&copy; Esri'
                                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                              />
                              <TileLayer
                                url={changeMapData.urlFormat}
                                opacity={0.85}
                                attribution="Google Earth Engine"
                              />
                              {polygonCoords.length > 0 && (
                                <Polygon
                                  positions={polygonCoords}
                                  pathOptions={{ color: "white", weight: 2, fillOpacity: 0 }}
                                />
                              )}
                            </MapContainer>
                            <div className="absolute bottom-2 left-2 right-2 bg-background/90 backdrop-blur p-2 rounded-md z-[400]">
                              <div className="flex items-center justify-between text-[10px]">
                                <span className="text-red-600 font-medium">-0.3 (Disminución)</span>
                                <div className="flex-1 mx-2 h-3 rounded-full" style={{
                                  background: "linear-gradient(to right, #d73027, #f46d43, #fdae61, #fee08b, #ffffbf, #d9ef8b, #a6d96a, #66bd63, #1a9850)"
                                }} />
                                <span className="text-green-600 font-medium">+0.3 (Aumento)</span>
                              </div>
                            </div>
                          </div>
                          {changeMapData.meanChange !== undefined && (
                            <div className="flex items-center justify-center gap-3 p-3 bg-secondary/30 rounded-lg">
                              <span className="text-sm text-muted-foreground">Cambio promedio en la parcela:</span>
                              <span className={`text-lg font-bold font-mono ${
                                changeMapData.meanChange > 0.02 ? "text-green-600" :
                                changeMapData.meanChange < -0.02 ? "text-red-600" :
                                "text-gray-600"
                              }`} data-testid="change-map-mean">
                                {changeMapData.meanChange > 0 ? "+" : ""}{changeMapData.meanChange.toFixed(3)}
                              </span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                          No se pudo generar el mapa de cambios para estas fechas
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="indices" className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Comparar dos índices en la misma fecha</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end relative z-[1000]">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Índice A</label>
                  <Select value={indexA} onValueChange={setIndexA}>
                    <SelectTrigger data-testid="select-index-a">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[1000]">
                      <SelectItem value="ndvi">NDVI — Salud Vegetal</SelectItem>
                      <SelectItem value="evi">EVI — Índice Veg. Mejorado</SelectItem>
                      <SelectItem value="ndmi">NDMI — Contenido Hídrico</SelectItem>
                      <SelectItem value="ndre">NDRE — Red Edge / Nitrógeno</SelectItem>
                      <SelectItem value="gndvi">GNDVI — Veg. Banda Verde</SelectItem>
                      <SelectItem value="msavi">MSAVI — Ajustado al Suelo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Índice B</label>
                  <Select value={indexB} onValueChange={setIndexB}>
                    <SelectTrigger data-testid="select-index-b">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[1000]">
                      <SelectItem value="ndvi">NDVI — Salud Vegetal</SelectItem>
                      <SelectItem value="evi">EVI — Índice Veg. Mejorado</SelectItem>
                      <SelectItem value="ndmi">NDMI — Contenido Hídrico</SelectItem>
                      <SelectItem value="ndre">NDRE — Red Edge / Nitrógeno</SelectItem>
                      <SelectItem value="gndvi">GNDVI — Veg. Banda Verde</SelectItem>
                      <SelectItem value="msavi">MSAVI — Ajustado al Suelo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Fecha</label>
                  <Select value={compareDate} onValueChange={setCompareDate}>
                    <SelectTrigger data-testid="select-compare-date">
                      <SelectValue placeholder="Seleccionar fecha" />
                    </SelectTrigger>
                    <SelectContent className="z-[1000]">
                      {sentinelImages.map((img) => (
                        <SelectItem key={img.id} value={img.date}>
                          <span className="flex items-center gap-2">
                            {img.date} <Cloud className="w-3 h-3 text-muted-foreground" /> {img.cloudPercentage.toFixed(0)}%
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {compareDate && (
                <>
                  <div className="flex flex-col lg:flex-row gap-4 mt-4">
                    <MapPanel
                      parcelId={params.id!}
                      index={indexA}
                      date={compareDate}
                      polygonCoords={polygonCoords}
                      mapCenter={mapCenter}
                      label={`${getIndexLabel(indexA)} — ${compareDate}`}
                    />
                    <div className="flex items-center justify-center lg:py-0 py-2">
                      <ArrowLeftRight className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <MapPanel
                      parcelId={params.id!}
                      index={indexB}
                      date={compareDate}
                      polygonCoords={polygonCoords}
                      mapCenter={mapCenter}
                      label={`${getIndexLabel(indexB)} — ${compareDate}`}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                    <Card className="border-blue-200 bg-blue-50/50">
                      <CardContent className="pt-4">
                        <p className="text-xs text-muted-foreground mb-1">{getIndexLabel(indexA)}</p>
                        <div className="text-2xl font-bold" data-testid="value-index-a">
                          {valueA_indices !== null ? valueA_indices.toFixed(3) : "—"}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{getIndexDescription(indexA)}</p>
                        {valueA_indices !== null && (
                          <Badge className={`mt-2 ${getValueStatus(indexA, valueA_indices).color}`}>
                            {getValueStatus(indexA, valueA_indices).label}
                          </Badge>
                        )}
                      </CardContent>
                    </Card>

                    <Card className="border-emerald-200 bg-emerald-50/50">
                      <CardContent className="pt-4">
                        <p className="text-xs text-muted-foreground mb-1">{getIndexLabel(indexB)}</p>
                        <div className="text-2xl font-bold" data-testid="value-index-b">
                          {valueB_indices !== null ? valueB_indices.toFixed(3) : "—"}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{getIndexDescription(indexB)}</p>
                        {valueB_indices !== null && (
                          <Badge className={`mt-2 ${getValueStatus(indexB, valueB_indices).color}`}>
                            {getValueStatus(indexB, valueB_indices).label}
                          </Badge>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  {valueA_indices !== null && valueB_indices !== null && (
                    <Card className="border-amber-200 bg-amber-50/30">
                      <CardContent className="pt-4">
                        <div className="flex items-start gap-3">
                          <Info className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
                          <div>
                            <p className="font-semibold text-sm text-amber-800 mb-1">Análisis Cruzado</p>
                            <p className="text-sm text-amber-700" data-testid="text-interpretation-indices">
                              {(() => {
                                const analyses: string[] = [];
                                const aStatus = getValueStatus(indexA, valueA_indices);
                                const bStatus = getValueStatus(indexB, valueB_indices);
                                analyses.push(`${indexA.toUpperCase()}: ${aStatus.label} (${valueA_indices.toFixed(3)}) · ${indexB.toUpperCase()}: ${bStatus.label} (${valueB_indices.toFixed(3)}).`);

                                if (indexA === "ndvi" && indexB === "ndmi") {
                                  if (valueA_indices >= 0.5 && valueB_indices < 0) {
                                    analyses.push("La vegetación se ve saludable pero con estrés hídrico. El cultivo podría estar usando reservas de agua del suelo. Se recomienda incrementar el riego.");
                                  } else if (valueA_indices < 0.3 && valueB_indices >= 0.2) {
                                    analyses.push("Hay humedad disponible pero baja cobertura vegetal. Posible problema de nutrición, plagas o etapa temprana del cultivo.");
                                  } else if (valueA_indices >= 0.5 && valueB_indices >= 0.1) {
                                    analyses.push("Buena combinación: vegetación saludable con humedad adecuada. El cultivo se desarrolla favorablemente.");
                                  } else {
                                    analyses.push("Tanto la vegetación como la humedad presentan valores bajos. Revisar condiciones de suelo, riego y estado general del cultivo.");
                                  }
                                } else if (indexA === "ndvi" && indexB === "evi") {
                                  if (valueA_indices > valueB_indices + 0.2) {
                                    analyses.push("El NDVI es significativamente mayor que el EVI. Esto puede indicar saturación del NDVI en zonas de vegetación muy densa. El EVI puede ser más preciso en estas condiciones.");
                                  } else if (Math.abs(valueA_indices - valueB_indices) < 0.1) {
                                    analyses.push("Ambos índices muestran valores similares, lo que indica consistencia en la medición de la salud vegetal.");
                                  } else {
                                    analyses.push("La diferencia entre NDVI y EVI puede deberse a condiciones atmosféricas o densidad de vegetación. El EVI es más robusto ante aerosoles.");
                                  }
                                } else if (indexA === "evi" && indexB === "ndmi") {
                                  if (valueA_indices >= 0.4 && valueB_indices < 0) {
                                    analyses.push("Buena biomasa pero estrés hídrico detectado. El cultivo tiene potencial pero necesita más agua.");
                                  } else if (valueA_indices >= 0.4 && valueB_indices >= 0.1) {
                                    analyses.push("Biomasa y humedad en niveles favorables. Condiciones óptimas para el desarrollo del cultivo.");
                                  } else {
                                    analyses.push("Revisar las condiciones generales del cultivo. Los valores sugieren que podría necesitar atención en nutrición y/o riego.");
                                  }
                                } else {
                                  analyses.push(`Comparación de ${indexA.toUpperCase()} vs ${indexB.toUpperCase()} para la fecha ${compareDate}.`);
                                }
                                return analyses.join(" ");
                              })()}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

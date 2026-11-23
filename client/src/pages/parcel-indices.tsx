import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, TrendingUp, TrendingDown, Minus, Leaf, Droplets, Sun, Activity, Loader2, Satellite, Database } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from "recharts";
import { useState } from "react";

function getHealthStatus(ndvi: number) {
  if (ndvi >= 0.7) return { status: "Excelente", color: "bg-green-500", textColor: "text-green-700" };
  if (ndvi >= 0.5) return { status: "Bueno", color: "bg-lime-500", textColor: "text-lime-700" };
  if (ndvi >= 0.3) return { status: "Moderado", color: "bg-yellow-500", textColor: "text-yellow-700" };
  return { status: "Bajo", color: "bg-red-500", textColor: "text-red-700" };
}

function getTrend(current: number, previous: number) {
  const diff = current - previous;
  if (diff > 0.05) return { icon: TrendingUp, color: "text-green-500", text: "Mejorando" };
  if (diff < -0.05) return { icon: TrendingDown, color: "text-red-500", text: "Declinando" };
  return { icon: Minus, color: "text-gray-500", text: "Estable" };
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr);
  const months = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

interface IndicesData {
  date: string;
  ndvi: number;
  evi: number;
  ndmi: number;
}

export default function ParcelIndices() {
  const params = useParams<{ id: string }>();
  const [selectedPeriod, setSelectedPeriod] = useState("month");

  const { data: parcelData, isLoading: parcelLoading } = useQuery({
    queryKey: ["parcel", params.id],
    queryFn: async () => {
      const response = await fetch(`/api/parcels/${params.id}`, { credentials: "include" });
      if (!response.ok) throw new Error("Error al cargar parcela");
      return response.json();
    },
  });

  const { data: indicesData, isLoading: indicesLoading } = useQuery({
    queryKey: ["parcel-indices", params.id, selectedPeriod],
    queryFn: async () => {
      const response = await fetch(`/api/parcels/${params.id}/indices?period=${selectedPeriod}`, { 
        credentials: "include" 
      });
      if (!response.ok) throw new Error("Error al cargar índices");
      return response.json();
    },
    enabled: !!params.id,
  });

  const { data: geeStatus } = useQuery({
    queryKey: ["gee-status"],
    queryFn: async () => {
      const response = await fetch("/api/gee/status", { credentials: "include" });
      if (!response.ok) throw new Error("Error al verificar estado de GEE");
      return response.json();
    },
  });

  const parcel = parcelData?.parcel;
  const indices: IndicesData[] = indicesData?.indices || [];
  const source = indicesData?.source || "simulated";
  const geeError = geeStatus?.error || null;
  const hasData = indices.length > 0;
  
  const chartData = indices.map((item) => ({
    date: formatDate(item.date),
    ndvi: item.ndvi,
    evi: item.evi,
    ndmi: item.ndmi,
  }));

  const currentData = indices[indices.length - 1];
  const previousData = indices[indices.length - 2];
  
  const currentNDVI = currentData?.ndvi || 0;
  const previousNDVI = previousData?.ndvi || currentNDVI;
  const currentEVI = currentData?.evi || 0;
  const currentNDMI = currentData?.ndmi || 0;
  
  const health = getHealthStatus(currentNDVI);
  const trend = getTrend(currentNDVI, previousNDVI);
  const TrendIcon = trend.icon;

  const isLoading = parcelLoading || indicesLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">Cargando datos satelitales...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
          <Link href="/dashboard" className="hover:text-primary flex items-center gap-1" data-testid="link-back-dashboard">
            <ArrowLeft className="w-4 h-4" /> Volver
          </Link>
          <span>/</span>
          <span className="text-foreground font-medium truncate max-w-[120px] sm:max-w-none">{parcel?.name || "Parcela"}</span>
          <span className="hidden sm:inline">/</span>
          <span className="hidden sm:inline text-foreground">Índices Vegetativos</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge 
            variant="outline" 
            className={source === "satellite" ? "border-green-500 text-green-700 text-xs" : "border-amber-500 text-amber-700 text-xs"}
            data-testid="badge-data-source"
          >
            {source === "satellite" ? (
              <><Satellite className="w-3 h-3 mr-1" /> Satelital</>
            ) : (
              <><Database className="w-3 h-3 mr-1" /> Simulado</>
            )}
          </Badge>
          <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
            <SelectTrigger className="w-[150px] text-xs h-8" data-testid="select-period">
              <SelectValue placeholder="Período" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="month">Último mes</SelectItem>
              <SelectItem value="quarter">Último trimestre</SelectItem>
              <SelectItem value="year">Último año</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {source === "simulated" && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          <strong>Nota:</strong> Se muestran datos simulados. Para obtener datos satelitales reales de Sentinel-2, 
          configure las credenciales de Google Earth Engine.
          {geeError && <span className="block mt-1 text-xs text-amber-600">({geeError})</span>}
        </div>
      )}

      {!hasData && !indicesLoading && (
        <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg text-center">
          <p className="text-gray-600">Sin datos disponibles para el período seleccionado.</p>
          <p className="text-sm text-gray-500 mt-1">Intente seleccionar un período diferente.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <Leaf className="w-8 h-8 text-green-600" />
              <Badge className={`${health.color} text-white`}>{health.status}</Badge>
            </div>
            <p className="text-sm text-green-700 font-medium">NDVI Actual</p>
            <p className="text-4xl font-bold text-green-800" data-testid="text-ndvi-value">{currentNDVI.toFixed(2)}</p>
            <div className={`flex items-center gap-1 mt-2 ${trend.color}`}>
              <TrendIcon className="w-4 h-4" />
              <span className="text-sm">{trend.text}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100 border-emerald-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <Activity className="w-8 h-8 text-emerald-600" />
            </div>
            <p className="text-sm text-emerald-700 font-medium">EVI</p>
            <p className="text-4xl font-bold text-emerald-800" data-testid="text-evi-value">{currentEVI.toFixed(2)}</p>
            <p className="text-xs text-emerald-600 mt-2">Índice de Vegetación Mejorado</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <Droplets className="w-8 h-8 text-blue-600" />
            </div>
            <p className="text-sm text-blue-700 font-medium">NDMI</p>
            <p className="text-4xl font-bold text-blue-800" data-testid="text-ndmi-value">{currentNDMI.toFixed(2)}</p>
            <p className="text-xs text-blue-600 mt-2">Humedad de la Vegetación</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-amber-50 to-amber-100 border-amber-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <Sun className="w-8 h-8 text-amber-600" />
            </div>
            <p className="text-sm text-amber-700 font-medium">LAI Estimado</p>
            <p className="text-4xl font-bold text-amber-800" data-testid="text-lai-value">
              {(currentNDVI * 4.5).toFixed(1)}
            </p>
            <p className="text-xs text-amber-600 mt-2">Índice de Área Foliar</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="ndvi" className="space-y-4">
        <TabsList>
          <TabsTrigger value="ndvi" data-testid="tab-ndvi">NDVI</TabsTrigger>
          <TabsTrigger value="evi" data-testid="tab-evi">EVI</TabsTrigger>
          <TabsTrigger value="ndmi" data-testid="tab-ndmi">NDMI</TabsTrigger>
          <TabsTrigger value="comparison" data-testid="tab-comparison">Comparativa</TabsTrigger>
        </TabsList>

        <TabsContent value="ndvi">
          <Card>
            <CardHeader>
              <CardTitle>Evolución del NDVI</CardTitle>
              <CardDescription>
                El Índice de Vegetación de Diferencia Normalizada mide la salud y vigor del cultivo. 
                Valores cercanos a 1 indican vegetación densa y saludable.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="ndviGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22c55e" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#22c55e" stopOpacity={0.1}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="date" stroke="#6b7280" fontSize={12} />
                    <YAxis domain={[0, 1]} stroke="#6b7280" fontSize={12} />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: "white", 
                        border: "1px solid #e5e7eb",
                        borderRadius: "8px"
                      }}
                      formatter={(value: number) => [value.toFixed(3), "NDVI"]}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="ndvi" 
                      stroke="#22c55e" 
                      strokeWidth={2}
                      fill="url(#ndviGradient)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="evi">
          <Card>
            <CardHeader>
              <CardTitle>Evolución del EVI</CardTitle>
              <CardDescription>
                El Índice de Vegetación Mejorado corrige las distorsiones atmosféricas 
                y es más sensible en áreas con vegetación densa.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="eviGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.1}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="date" stroke="#6b7280" fontSize={12} />
                    <YAxis domain={[0, 1]} stroke="#6b7280" fontSize={12} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: "8px" }}
                      formatter={(value: number) => [value.toFixed(3), "EVI"]}
                    />
                    <Area type="monotone" dataKey="evi" stroke="#10b981" strokeWidth={2} fill="url(#eviGradient)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ndmi">
          <Card>
            <CardHeader>
              <CardTitle>Evolución del NDMI</CardTitle>
              <CardDescription>
                El Índice de Humedad de Diferencia Normalizada detecta estrés hídrico en la vegetación.
                Valores bajos pueden indicar necesidad de riego.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="ndmiGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.1}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="date" stroke="#6b7280" fontSize={12} />
                    <YAxis domain={[0, 1]} stroke="#6b7280" fontSize={12} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: "8px" }}
                      formatter={(value: number) => [value.toFixed(3), "NDMI"]}
                    />
                    <Area type="monotone" dataKey="ndmi" stroke="#3b82f6" strokeWidth={2} fill="url(#ndmiGradient)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="comparison">
          <Card>
            <CardHeader>
              <CardTitle>Comparativa de Índices</CardTitle>
              <CardDescription>
                Visualiza la evolución de todos los índices vegetativos para identificar patrones y correlaciones.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="date" stroke="#6b7280" fontSize={12} />
                    <YAxis domain={[0, 1]} stroke="#6b7280" fontSize={12} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: "8px" }}
                    />
                    <Line type="monotone" dataKey="ndvi" stroke="#22c55e" strokeWidth={2} name="NDVI" dot={false} />
                    <Line type="monotone" dataKey="evi" stroke="#10b981" strokeWidth={2} name="EVI" dot={false} />
                    <Line type="monotone" dataKey="ndmi" stroke="#3b82f6" strokeWidth={2} name="NDMI" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center justify-center gap-6 mt-4">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-1 bg-green-500 rounded"></div>
                  <span className="text-sm text-muted-foreground">NDVI</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-1 bg-emerald-500 rounded"></div>
                  <span className="text-sm text-muted-foreground">EVI</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-1 bg-blue-500 rounded"></div>
                  <span className="text-sm text-muted-foreground">NDMI</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle>Interpretación y Recomendaciones</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
            <h4 className="font-semibold text-green-800 mb-2">Estado del Cultivo</h4>
            <p className="text-green-700 text-sm">
              Con un NDVI de {currentNDVI.toFixed(2)}, tu cultivo muestra un vigor {health.status.toLowerCase()}. 
              {currentNDVI >= 0.5 
                ? " La vegetación presenta buena actividad fotosintética y densidad de cobertura."
                : " Se recomienda revisar las condiciones del suelo y nutrientes."}
            </p>
          </div>
          
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h4 className="font-semibold text-blue-800 mb-2">Estrés Hídrico</h4>
            <p className="text-blue-700 text-sm">
              {currentNDMI >= 0.4 
                ? "El índice NDMI indica niveles adecuados de humedad en la vegetación. No se detecta estrés hídrico significativo."
                : currentNDMI >= 0.2
                  ? "El índice NDMI muestra niveles moderados de humedad. Considere monitorear la disponibilidad de agua."
                  : "El índice NDMI indica posible estrés hídrico. Se recomienda verificar el sistema de riego."}
            </p>
          </div>

          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <h4 className="font-semibold text-amber-800 mb-2">Recomendación</h4>
            <p className="text-amber-700 text-sm">
              {trend.text === "Mejorando" 
                ? "La tendencia es positiva. Continúe con el plan de manejo actual."
                : trend.text === "Declinando"
                  ? "Se observa una tendencia descendente. Revise las condiciones del cultivo y considere ajustes en el manejo."
                  : "Los índices se mantienen estables. Se recomienda monitoreo en 7 días para verificar tendencias."}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

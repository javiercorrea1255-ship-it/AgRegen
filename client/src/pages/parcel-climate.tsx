import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Cloud, Droplets, Thermometer, Wind, Sun, Calendar, TrendingUp, Loader2, Zap, AlertCircle, Snowflake } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ResponsiveContainer, AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, LineChart, Line, Legend } from "recharts";

interface ForecastDay {
  date: string;
  dayName: string;
  tempMax: number;
  tempMin: number;
  precipitation: number;
  humidity: number;
  windSpeed: number;
  weatherCode: number;
  icon: "sun" | "cloud" | "rain" | "storm" | "snow";
}

interface CurrentConditions {
  temperature: number;
  humidity: number;
  windSpeed: number;
  precipitation: number;
  weatherCode: number;
  radiation: number;
}

interface GDAResult {
  accumulated: number;
  weeklyData: { week: string; gdd: number; accumulated: number }[];
  currentStage: string;
}

interface ChillingHoursResult {
  simple: number;
  utah: number;
  weeklyData: { week: string; simple: number; utah: number; accSimple: number; accUtah: number }[];
  seasonStart: string;
}

interface WeatherData {
  forecast: ForecastDay[];
  current: CurrentConditions;
  gda: GDAResult | null;
  chilling: ChillingHoursResult | null;
}

const CROP_BASE_TEMPS: Record<string, number> = {
  "Maíz": 10,
  "Soja": 10,
  "Trigo": 0,
  "Girasol": 8,
};

const CROP_KC_VALUES: Record<string, Record<string, number>> = {
  "Maíz": { "Emergencia": 0.3, "V6": 0.7, "V12": 1.0, "Floración": 1.2, "Llenado": 1.1, "Madurez": 0.6, "default": 0.8 },
  "Soja": { "Emergencia": 0.3, "V3": 0.5, "V6": 0.8, "Floración": 1.15, "Llenado": 1.0, "Madurez": 0.5, "default": 0.7 },
  "Trigo": { "Emergencia": 0.4, "Macollaje": 0.7, "Encañado": 1.0, "Espigado": 1.15, "Llenado": 1.0, "Madurez": 0.4, "default": 0.8 },
  "Girasol": { "Emergencia": 0.35, "V6": 0.7, "Floración": 1.1, "Llenado": 0.9, "Madurez": 0.5, "default": 0.7 },
};

function WeatherIcon({ type, className }: { type: string; className?: string }) {
  switch (type) {
    case "sun":
      return <Sun className={className} />;
    case "cloud":
      return <Cloud className={className} />;
    case "rain":
      return <Droplets className={className} />;
    case "storm":
      return <Zap className={className} />;
    case "snow":
      return <Cloud className={className} />;
    default:
      return <Sun className={className} />;
  }
}

function calculateETo(tempMax: number, tempMin: number, radiation: number): number {
  const tempMean = (tempMax + tempMin) / 2;
  const Rs = radiation * 0.0036;
  const eto = 0.0023 * (tempMean + 17.8) * Math.sqrt(tempMax - tempMin) * Rs;
  return Math.max(0, Math.round(eto * 10) / 10);
}

export default function ParcelClimate() {
  const params = useParams<{ id: string }>();

  const { data: parcelData, isLoading: parcelLoading } = useQuery({
    queryKey: ["parcel", params.id],
    queryFn: async () => {
      const response = await fetch(`/api/parcels/${params.id}`, { credentials: "include" });
      if (!response.ok) throw new Error("Error al cargar parcela");
      return response.json();
    },
  });

  const { data: weatherData, isLoading: weatherLoading, error: weatherError } = useQuery<WeatherData>({
    queryKey: ["weather", params.id],
    queryFn: async () => {
      const response = await fetch(`/api/parcels/${params.id}/weather`, { credentials: "include" });
      if (!response.ok) throw new Error("Error al cargar datos climáticos");
      return response.json();
    },
    enabled: !!params.id,
    staleTime: 1000 * 60 * 15,
    refetchInterval: 1000 * 60 * 30,
  });

  const { data: ndviData } = useQuery({
    queryKey: ["parcel-indices", params.id],
    queryFn: async () => {
      const response = await fetch(`/api/parcels/${params.id}/indices`, { credentials: "include" });
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!params.id,
  });

  const parcel = parcelData?.parcel;
  const isLoading = parcelLoading || weatherLoading;

  const crop = parcel?.crop || "Maíz";
  const baseTemp = CROP_BASE_TEMPS[crop] || 10;
  const currentStage = weatherData?.gda?.currentStage || "default";
  const kcValue = CROP_KC_VALUES[crop]?.[currentStage] || CROP_KC_VALUES[crop]?.["default"] || 0.8;

  const currentNdvi = ndviData?.data?.[0]?.ndvi ? parseFloat(ndviData.data[0].ndvi) : 0.65;
  const avgPrecip = weatherData?.forecast?.slice(0, 7).reduce((sum, d) => sum + d.precipitation, 0) || 0;
  const gdaProgress = weatherData?.gda?.accumulated ? Math.min(1, weatherData.gda.accumulated / 1200) : 0;

  const ndviFactor = currentNdvi > 0.7 ? 12 : currentNdvi > 0.5 ? 5 : -8;
  const precipFactor = avgPrecip > 50 ? 8 : avgPrecip > 20 ? 0 : -5;
  const gdaFactor = gdaProgress > 0.5 ? 8 : gdaProgress > 0.3 ? 3 : -2;
  const stressFactor = weatherData?.current?.temperature && weatherData.current.temperature > 35 ? -10 : 
                       weatherData?.current?.humidity && weatherData.current.humidity < 30 ? -5 : -3;

  const baseYield = crop === "Maíz" ? 9.5 : crop === "Soja" ? 3.2 : crop === "Trigo" ? 4.0 : crop === "Girasol" ? 2.5 : 8.0;
  const yieldModifier = (ndviFactor + precipFactor + gdaFactor + stressFactor) / 100;
  const projectedYield = Math.round((baseYield * (1 + yieldModifier)) * 10) / 10;
  const optimalYield = Math.round(baseYield * 1.15 * 10) / 10;
  const lowYield = Math.round(baseYield * 0.75 * 10) / 10;

  const yieldFactors = [
    { name: "NDVI", impact: `${ndviFactor >= 0 ? '+' : ''}${ndviFactor}%`, positive: ndviFactor >= 0 },
    { name: "Precipitación", impact: `${precipFactor >= 0 ? '+' : ''}${precipFactor}%`, positive: precipFactor >= 0 },
    { name: "GDA", impact: `${gdaFactor >= 0 ? '+' : ''}${gdaFactor}%`, positive: gdaFactor >= 0 },
    { name: "Estrés Hídrico", impact: `${stressFactor >= 0 ? '+' : ''}${stressFactor}%`, positive: stressFactor >= 0 },
  ];

  const todayForecast = weatherData?.forecast?.[0];
  const etoDaily = todayForecast 
    ? calculateETo(todayForecast.tempMax, todayForecast.tempMin, weatherData?.current?.radiation || 500)
    : 4.5;
  const etcCrop = Math.round(etoDaily * kcValue * 10) / 10;

  const upcomingRainDays = weatherData?.forecast?.findIndex(d => d.precipitation > 5) ?? -1;
  const nextIrrigation = upcomingRainDays > 0 && upcomingRainDays < 3 
    ? `${upcomingRainDays + 2} días` 
    : avgPrecip > 30 ? "4+ días" : "2 días";
  const suggestedLamina = Math.round(etcCrop * 7);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard" className="hover:text-primary flex items-center gap-1" data-testid="link-back-dashboard">
          <ArrowLeft className="w-4 h-4" /> Volver
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">{parcel?.name || "Parcela"}</span>
        <span>/</span>
        <span className="text-foreground">Clima y Proyecciones</span>
      </div>

      {weatherError && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-amber-500" />
          <p className="text-amber-700">No se pudieron cargar datos climáticos en tiempo real. Mostrando estimaciones.</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cloud className="w-5 h-5 text-blue-500" />
              Pronóstico 7 Días
            </CardTitle>
            <CardDescription>Condiciones climáticas reales para tu zona (Open-Meteo)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto -mx-2 px-2">
              <div className="grid grid-cols-7 gap-2 min-w-[420px]">
                {(weatherData?.forecast || []).map((day, index) => (
                  <div
                    key={day.date}
                    className={`text-center p-3 rounded-lg ${
                      index === 0 ? "bg-primary/10 border-2 border-primary" : "bg-secondary/30"
                    }`}
                    data-testid={`forecast-day-${index}`}
                  >
                    <p className="text-sm font-medium mb-2">{day.dayName}</p>
                    <WeatherIcon
                      type={day.icon}
                      className={`w-8 h-8 mx-auto mb-2 ${
                        day.icon === "sun"
                          ? "text-amber-500"
                          : day.icon === "rain" || day.icon === "storm"
                          ? "text-blue-500"
                          : "text-gray-500"
                      }`}
                    />
                    <p className="text-lg font-bold">{day.tempMax}°</p>
                    <p className="text-xs text-muted-foreground">{day.tempMin}°</p>
                    {day.precipitation > 0 && (
                      <p className="text-xs text-blue-500 mt-1">{day.precipitation}mm</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Thermometer className="w-5 h-5 text-red-500" />
              Condiciones Actuales
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-secondary/30 rounded-lg" data-testid="stat-temperature">
              <div className="flex items-center gap-2">
                <Thermometer className="w-5 h-5 text-red-500" />
                <span className="text-sm">Temperatura</span>
              </div>
              <span className="font-bold">{weatherData?.current?.temperature ?? "--"}°C</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-secondary/30 rounded-lg" data-testid="stat-humidity">
              <div className="flex items-center gap-2">
                <Droplets className="w-5 h-5 text-blue-500" />
                <span className="text-sm">Humedad</span>
              </div>
              <span className="font-bold">{weatherData?.current?.humidity ?? "--"}%</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-secondary/30 rounded-lg" data-testid="stat-wind">
              <div className="flex items-center gap-2">
                <Wind className="w-5 h-5 text-gray-500" />
                <span className="text-sm">Viento</span>
              </div>
              <span className="font-bold">{weatherData?.current?.windSpeed ?? "--"} km/h</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-secondary/30 rounded-lg" data-testid="stat-radiation">
              <div className="flex items-center gap-2">
                <Sun className="w-5 h-5 text-amber-500" />
                <span className="text-sm">Radiación</span>
              </div>
              <span className="font-bold">{weatherData?.current?.radiation ?? "--"} W/m²</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-green-500" />
              Grados Día Acumulados (GDA)
            </CardTitle>
            <CardDescription>
              Seguimiento fenológico basado en la acumulación de calor. 
              Base: {baseTemp}°C para {crop}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-green-700">GDA Acumulados</p>
                  <p className="text-3xl font-bold text-green-800" data-testid="gda-accumulated">
                    {weatherData?.gda?.accumulated ?? "--"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-green-700">Etapa Estimada</p>
                  <Badge className="bg-green-500" data-testid="gda-stage">
                    {weatherData?.gda?.currentStage ?? "Sin datos"}
                  </Badge>
                </div>
              </div>
            </div>
            {weatherData?.gda?.weeklyData && weatherData.gda.weeklyData.length > 0 ? (
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={weatherData.gda.weeklyData}>
                    <defs>
                      <linearGradient id="gddGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22c55e" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="#22c55e" stopOpacity={0.1} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="week" stroke="#6b7280" fontSize={12} />
                    <YAxis stroke="#6b7280" fontSize={12} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: "8px" }}
                      formatter={(value: number) => [`${value} GDA`, "Acumulados"]}
                    />
                    <Area
                      type="monotone"
                      dataKey="accumulated"
                      stroke="#22c55e"
                      strokeWidth={2}
                      fill="url(#gddGradient)"
                      name="GDA Acumulados"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : weatherData?.gda?.currentStage === "Pre-siembra" ? (
              <div className="h-[250px] flex flex-col items-center justify-center text-muted-foreground gap-2">
                <Calendar className="w-8 h-8 text-green-400" />
                <p className="text-center">La siembra aún no ha comenzado.<br />Los GDA se acumularán después de la fecha de siembra.</p>
              </div>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                <p>Se requiere fecha de siembra para calcular GDA</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Snowflake className="w-5 h-5 text-blue-400" />
              Horas Frío Acumuladas
            </CardTitle>
            <CardDescription>
              Temporada desde {weatherData?.chilling?.seasonStart
                ? new Date(weatherData.chilling.seasonStart + 'T00:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })
                : "1 oct"}.
              Calculadas con modelo sinusoidal a partir de temperaturas diarias.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-center" data-testid="chilling-simple">
                <p className="text-xs text-blue-600 font-medium mb-1">Modelo Simple (≤ 7.2 °C)</p>
                <p className="text-3xl font-bold text-blue-800">
                  {weatherData?.chilling?.simple ?? "--"}
                </p>
                <p className="text-xs text-blue-500 mt-1">horas frío</p>
              </div>
              <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-lg text-center" data-testid="chilling-utah">
                <p className="text-xs text-indigo-600 font-medium mb-1">Modelo Utah (UC)</p>
                <p className="text-3xl font-bold text-indigo-800">
                  {weatherData?.chilling?.utah ?? "--"}
                </p>
                <p className="text-xs text-indigo-500 mt-1">unidades de frío</p>
              </div>
            </div>
            {weatherData?.chilling?.weeklyData && weatherData.chilling.weeklyData.length > 0 ? (
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={weatherData.chilling.weeklyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="week" stroke="#6b7280" fontSize={11} />
                    <YAxis stroke="#6b7280" fontSize={11} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: "8px", fontSize: 12 }}
                      formatter={(value: number, name: string) => [
                        name === "accSimple" ? `${value} h` : `${value} UC`,
                        name === "accSimple" ? "Simple acumulado" : "Utah acumulado",
                      ]}
                    />
                    <Legend
                      formatter={(value) => value === "accSimple" ? "Simple acum." : "Utah acum."}
                      wrapperStyle={{ fontSize: 12 }}
                    />
                    <Line type="monotone" dataKey="accSimple" stroke="#3b82f6" strokeWidth={2} dot={false} name="accSimple" />
                    <Line type="monotone" dataKey="accUtah"  stroke="#6366f1" strokeWidth={2} dot={false} name="accUtah"  />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">
                <Snowflake className="w-6 h-6 mr-2 text-blue-300" />
                Sin datos históricos para esta temporada
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-3">
              <span className="font-medium">Referencia:</span> frutales de pepita (manzana, pera) requieren 800–1 500 h frío;
              duraznero 600–900 h; aguacate Hass 200–400 h.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-amber-500" />
              Proyección de Rendimiento
            </CardTitle>
            <CardDescription>
              Estimación basada en índices vegetativos, clima y etapa fenológica
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center mb-6">
              <p className="text-sm text-muted-foreground mb-2">Rendimiento Proyectado</p>
              <p className="text-5xl font-bold text-primary" data-testid="projected-yield">{projectedYield}</p>
              <p className="text-lg text-muted-foreground">ton/ha</p>
              <div className="flex items-center justify-center gap-4 mt-3 text-sm">
                <span className="text-green-600">Óptimo: {optimalYield}</span>
                <span className="text-red-600">Mínimo: {lowYield}</span>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium text-muted-foreground">Factores de Impacto</p>
              {yieldFactors.map((factor) => (
                <div
                  key={factor.name}
                  className={`flex items-center justify-between p-3 rounded-lg ${
                    factor.positive ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"
                  }`}
                  data-testid={`factor-${factor.name.toLowerCase().replace(' ', '-')}`}
                >
                  <span className={factor.positive ? "text-green-700" : "text-red-700"}>
                    {factor.name}
                  </span>
                  <Badge variant={factor.positive ? "default" : "destructive"}>
                    {factor.impact}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recomendaciones de Riego</CardTitle>
          <CardDescription>
            Basado en evapotranspiración, pronóstico y estado del cultivo ({crop} - {currentStage})
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h4 className="font-semibold text-blue-800 mb-2">ETo Diaria</h4>
              <p className="text-3xl font-bold text-blue-700" data-testid="eto-value">{etoDaily} mm</p>
              <p className="text-sm text-blue-600 mt-1">Evapotranspiración de referencia</p>
            </div>
            <div className="p-4 bg-cyan-50 border border-cyan-200 rounded-lg">
              <h4 className="font-semibold text-cyan-800 mb-2">ETc Cultivo</h4>
              <p className="text-3xl font-bold text-cyan-700" data-testid="etc-value">{etcCrop} mm</p>
              <p className="text-sm text-cyan-600 mt-1">Kc = {kcValue} ({currentStage})</p>
            </div>
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <h4 className="font-semibold text-green-800 mb-2">Próximo Riego</h4>
              <p className="text-3xl font-bold text-green-700" data-testid="next-irrigation">{nextIrrigation}</p>
              <p className="text-sm text-green-600 mt-1">Lámina sugerida: {suggestedLamina} mm</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

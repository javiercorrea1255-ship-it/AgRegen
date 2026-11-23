import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from "recharts";
import {
  Satellite, FlaskConical, BarChart3, AlertTriangle, CheckCircle,
  Info, ChevronRight, Layers, Activity, ArrowRight, BookOpen,
  GitMerge, Ruler, MapPin, Zap,
} from "lucide-react";
import { Link } from "wouter";

// ── APA 7 References ──────────────────────────────────────────────────────────
const APA_REFS_P2 = [
  {
    id: "wadoux2020",
    cite: "Wadoux et al., 2020",
    full: "Wadoux, A. M. J. C., Minasny, B., & McBratney, A. B. (2020). Machine learning for digital soil mapping: Applications, challenges and suggested solutions. Earth-Science Reviews, 210, 103359. https://doi.org/10.1016/j.earscirev.2020.103359",
  },
  {
    id: "brus2021",
    cite: "Brus, 2021",
    full: "Brus, D. J. (2021). Statistical sampling approaches for soil monitoring. European Journal of Soil Science, 72(1), 108–121. https://doi.org/10.1111/ejss.12919",
  },
  {
    id: "szatmari2021",
    cite: "Szatmári & Pásztor, 2021",
    full: "Szatmári, G., & Pásztor, L. (2021). Comparison of kriging techniques in a spatial regression perspective. Applied Sciences, 11(3), 1266. https://doi.org/10.3390/app11031266",
  },
  {
    id: "hengl2021",
    cite: "Hengl et al., 2021",
    full: "Hengl, T., Miller, M. A., Kříž, J., Shepherd, K. D., Sila, A., Kilibarda, M., Antonijević, O., Glušica, L., Dobermann, A., Haefele, S. M., McGrath, S. P., Acquah, G. E., Collinson, J., Vanik, Z., & Crouch, J. (2021). African soil properties and nutrients mapped at 30 m spatial resolution using two-scale ensemble machine learning. Scientific Reports, 11, 6130. https://doi.org/10.1038/s41598-021-85639-y",
  },
  {
    id: "sozzi2021",
    cite: "Sozzi et al., 2021",
    full: "Sozzi, M., Kayad, A., Marinello, F., Taylor, J., & Tisseyre, B. (2021). Comparing field-scale spatial variability of grain yield, plant height and NDVI using commercial yield monitors, UAV and Sentinel-2 imagery. Information Processing in Agriculture, 8(3), 381–392. https://doi.org/10.1016/j.inpa.2020.09.004",
  },
  {
    id: "segarra2020",
    cite: "Segarra et al., 2020",
    full: "Segarra, J., Buchaillot, M. L., Araus, J. L., & Kefauver, S. C. (2020). Remote sensing for precision agriculture: Sentinel-2 improved features and applications. Agronomy, 10(5), 641. https://doi.org/10.3390/agronomy10050641",
  },
  {
    id: "doxani2023",
    cite: "Doxani et al., 2023",
    full: "Doxani, G., Vermote, E., Roger, J. C., Skakun, S., Gascon, F., Kneubuehler, M., Pahlevan, N., & Deschamps, P. Y. (2023). Atmospheric correction inter-comparison exercise, phase 2. Remote Sensing, 15(3), 851. https://doi.org/10.3390/rs15030851",
  },
  {
    id: "verrelst2021",
    cite: "Verrelst et al., 2021",
    full: "Verrelst, J., Rivera, J. P., Veroustraete, F., Muñoz-Marí, J., Clevers, J. G. P. W., Camps-Valls, G., & Moreno, J. (2021). Experimental Sentinel-2 LAI estimation using parametric, non-parametric and physical retrieval methods. ISPRS Journal of Photogrammetry and Remote Sensing, 177, 148–160. https://doi.org/10.1016/j.isprsjprs.2021.05.013",
  },
  {
    id: "sishodia2020",
    cite: "Sishodia et al., 2020",
    full: "Sishodia, R. P., Ray, R. L., & Singh, S. K. (2020). Applications of remote sensing in precision agriculture: A review. Remote Sensing, 12(19), 3136. https://doi.org/10.3390/rs12193136",
  },
  {
    id: "corwin2021",
    cite: "Corwin, 2021",
    full: "Corwin, D. L. (2021). Climate change impacts on soil salinity in agricultural areas. European Journal of Soil Science, 72(2), 842–862. https://doi.org/10.1111/ejss.13010",
  },
  {
    id: "weiss2020",
    cite: "Weiss et al., 2020",
    full: "Weiss, M., Jacob, F., & Duveiller, G. (2020). Remote sensing for agricultural applications: A meta-review. Remote Sensing of Environment, 236, 111402. https://doi.org/10.1016/j.rse.2019.111402",
  },
  {
    id: "pebesma2023",
    cite: "Pebesma & Bivand, 2023",
    full: "Pebesma, E., & Bivand, R. (2023). Spatial Data Science: With Applications in R. CRC Press. https://doi.org/10.1201/9780429459016",
  },
  {
    id: "maimaitijiang2020",
    cite: "Maimaitijiang et al., 2020",
    full: "Maimaitijiang, M., Sagan, V., Sidike, P., Hartling, S., Esposito, F., & Fritschi, F. B. (2020). Soybean yield prediction from UAV using multimodal data fusion and deep learning. Remote Sensing of Environment, 237, 111599. https://doi.org/10.1016/j.rse.2019.111599",
  },
  {
    id: "fei2023",
    cite: "Fei et al., 2023",
    full: "Fei, S., Hassan, M. A., Xiao, Y., Su, X., Chen, Z., Cheng, Q., Duan, F., Chen, R., & Ma, Y. (2023). UAV-based multi-sensor data fusion and machine learning algorithm for yield prediction in wheat. Precision Agriculture, 24(1), 187–212. https://doi.org/10.1007/s11119-022-09938-8",
  },
  {
    id: "phiri2020",
    cite: "Phiri et al., 2020",
    full: "Phiri, D., Simwanda, M., Salekin, S., Nyirenda, V. R., Murayama, Y., & Ranagalage, M. (2020). Sentinel-2 data for land cover/use mapping: A review. Remote Sensing, 12(14), 2291. https://doi.org/10.3390/rs12142291",
  },
  {
    id: "campos2020",
    cite: "Campos-Taberner et al., 2020",
    full: "Campos-Taberner, M., Moreno-Martínez, Á., García-Haro, F. J., Camps-Valls, G., Robinson, N. P., Kattge, J., & Running, S. W. (2020). Global estimation of biophysical variables from Google Earth Engine platform. Remote Sensing, 12(7), 1167. https://doi.org/10.3390/rs12071167",
  },
  {
    id: "moreno2020",
    cite: "Moreno-Martínez et al., 2020",
    full: "Moreno-Martínez, Á., Izquierdo-Verdiguier, E., Maneta, M. P., Camps-Valls, G., Robinson, N., Muñoz-Marí, J., Sedano, F., Clinton, N., & Running, S. (2020). Multispectral high resolution sensor fusion for smoothing and gap-filling in the spatiotemporal domain. Remote Sensing of Environment, 247, 111901. https://doi.org/10.1016/j.rse.2020.111901",
  },
];

// ── Simulated datasets ─────────────────────────────────────────────────────────

// P1: Information loss curve — MAE of CE apparent when resampled to coarser resolutions
const infoLossData = [
  { res: "5 m (orig.)", mae: 0.00, rmse: 0.00, overlap: 100 },
  { res: "10 m",       mae: 0.04, rmse: 0.06, overlap: 87 },
  { res: "20 m",       mae: 0.11, rmse: 0.15, overlap: 71 },
  { res: "30 m",       mae: 0.21, rmse: 0.28, overlap: 54 },
  { res: "50 m",       mae: 0.38, rmse: 0.47, overlap: 32 },
  { res: "100 m",      mae: 0.62, rmse: 0.74, overlap: 14 },
];

// P1: Resampling method comparison at 30 m target
const resamplingMethodData = [
  { metodo: "Vecino más cercano", mae: 0.28, rmse: 0.36, sesgo: 0.04 },
  { metodo: "Bilineal",          mae: 0.21, rmse: 0.28, sesgo: 0.01 },
  { metodo: "Bicúbico",          mae: 0.19, rmse: 0.25, sesgo: 0.00 },
  { metodo: "Kriging de bloque", mae: 0.14, rmse: 0.19, sesgo: 0.00 },
];

// P2: Scenario A — Zone area (ha) at 5m vs 30m CE-based zoning
const zoneAreaData = [
  { zona: "Zona alta CE",   area5m: 8.4, area30m: 6.1 },
  { zona: "Zona media CE",  area5m: 14.2, area30m: 16.8 },
  { zona: "Zona baja CE",   area5m: 7.1, area30m: 6.8 },
];

// P2: Scenario B — VRT nitrogen prescription (kg N/ha) by zone at 10m vs 30m NDVI
const prescriptionData = [
  { zona: "Z1", ndvi10m: 112, ndvi30m: 98,  real: 110 },
  { zona: "Z2", ndvi10m: 88,  ndvi30m: 102, real: 85  },
  { zona: "Z3", ndvi10m: 65,  ndvi30m: 58,  real: 68  },
  { zona: "Z4", ndvi10m: 140, ndvi30m: 128, real: 138 },
];

// P3: Semivariogram range by variable (spatial autocorrelation distance)
const variogramRangeData = [
  { variable: "CE aparente",     range: 45,  cv: 38, optimal: 5  },
  { variable: "NDVI (cultivo)",  range: 120, cv: 22, optimal: 10 },
  { variable: "Rendimiento",     range: 80,  cv: 31, optimal: 10 },
  { variable: "Materia orgánica", range: 280, cv: 18, optimal: 25 },
  { variable: "pH",              range: 420, cv: 9,  optimal: 50 },
  { variable: "Carbono total",   range: 350, cv: 12, optimal: 30 },
];

// P4: Architecture steps (multi-scale pipeline)
const ARCH_STEPS = [
  {
    id: 1, color: "bg-blue-100 border-blue-300 text-blue-900",
    icon: Layers, title: "1. Registro de metadatos de resolución",
    detail: "Cada capa ingresada al sistema lleva metadatos obligatorios: resolución nominal, método de adquisición, fecha, CRS y error posicional estimado (Brus, 2021). El registro se almacena en la tabla `layer_metadata` de AgRegen.",
  },
  {
    id: 2, color: "bg-sky-100 border-sky-300 text-sky-900",
    icon: Ruler, title: "2. Resolución objetivo del análisis",
    detail: "Antes de iniciar la zonificación, el sistema solicita al usuario la resolución objetivo o la calcula automáticamente como la mediana de los ranges de semivariograma de las variables de entrada (Szatmári & Pásztor, 2021; Brus, 2021). Mínimo admitido: 2 × resolución del sensor más fino.",
  },
  {
    id: 3, color: "bg-green-100 border-green-300 text-green-900",
    icon: GitMerge, title: "3. Pipeline de armonización (GDAL/SNAP)",
    detail: "Las capas se reproyectan al mismo CRS (EPSG:4326 o UTM local) y se remuestrean a la resolución objetivo con Kriging de bloque (Wadoux et al., 2020; Pebesma & Bivand, 2023). Para capas más gruesas que la resolución objetivo se emite una advertencia de subresolución.",
  },
  {
    id: 4, color: "bg-orange-100 border-orange-300 text-orange-900",
    icon: Activity, title: "4. Motor de zonificación multivariado",
    detail: "El módulo MVZ recibe el stack armonizado. Cada método (K-means, Fuzzy C-means, Kriging RF) opera sobre el mismo grid. La resolución efectiva de salida se reporta junto a un índice de degradación (Hengl et al., 2021): ID = max(res_fuente) / res_objetivo.",
  },
  {
    id: 5, color: "bg-purple-100 border-purple-300 text-purple-900",
    icon: AlertTriangle, title: "5. Alertas de degradación",
    detail: "Si alguna co-variable fue remuestreada desde una resolución > 3× la resolución objetivo, el sistema genera una alerta visible en la UI: 'La capa DEM (30 m) fue degradada desde 30 m a 10 m; la variación topográfica de alta frecuencia puede ser artificial (Hengl et al., 2021)'.",
  },
  {
    id: 6, color: "bg-amber-100 border-amber-300 text-amber-900",
    icon: CheckCircle, title: "6. Trazabilidad y exportación",
    detail: "Las prescripciones exportadas incluyen en sus metadatos (KML/ISOXML/GeoTIFF) la resolución efectiva de cada co-variable utilizada y el índice de degradación. Esto permite al agrónomo evaluar la confiabilidad de las zonas sin abrir la plataforma (Sishodia et al., 2020).",
  },
];

// ── Source data table ──────────────────────────────────────────────────────────
const DATA_SOURCES = [
  {
    source: "Sentinel-2 MSI",
    res: "10 m / pixel",
    var: "NDVI, EVI, NDRE, NDMI",
    method: "— (referencia)",
    resample: "—",
    loss: "Ninguna",
    color: "bg-green-50 border-green-200",
  },
  {
    source: "CE aparente (proximal)",
    res: "5 m / pixel",
    var: "CE ap (dS/m)",
    method: "Remuestreo bilineal ↑",
    resample: "Sobremuestreo a 10 m",
    loss: "Baja (preserva variación original)",
    color: "bg-emerald-50 border-emerald-200",
  },
  {
    source: "Mapa de rendimiento",
    res: "20 m / pixel",
    var: "Yield (t/ha)",
    method: "Remuestreo bilineal ↓",
    resample: "Decimación a 10 m",
    loss: "Moderada (suaviza bordes de zona)",
    color: "bg-amber-50 border-amber-200",
  },
  {
    source: "DEM (SRTM/Copernicus)",
    res: "30 m / pixel",
    var: "Cota, pendiente, NDTI",
    method: "Bicúbico + Kriging de bloque ↓",
    resample: "Interpolación a 10 m",
    loss: "Alta (microrrelieve perdido; Hengl et al., 2021)",
    color: "bg-red-50 border-red-200",
  },
  {
    source: "Muestreos de suelo",
    res: "Irregular (n ≥ 30)",
    var: "pH, MO, N, P, K",
    method: "Kriging ordinario → grid 10 m",
    resample: "Interpolación geoestadística",
    loss: "Variable — depende de n y range (Wadoux et al., 2020)",
    color: "bg-purple-50 border-purple-200",
  },
];

// ── Color palette ──────────────────────────────────────────────────────────────
const C = {
  fine:   "#22c55e",
  coarse: "#ef4444",
  real:   "#0ea5e9",
  mae:    "#f97316",
  rmse:   "#a855f7",
  range:  "#0ea5e9",
  cv:     "#f97316",
};

const TT = {
  backgroundColor: "white",
  border: "1px solid #e5e7eb",
  borderRadius: "8px",
  fontSize: 12,
};

// ── Sub-components ─────────────────────────────────────────────────────────────
function SectionHeader({ number, title, subtitle }: { number: string; title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-4 mb-6">
      <div className="shrink-0 w-12 h-12 rounded-full bg-primary/10 text-primary font-bold text-lg flex items-center justify-center font-heading">
        {number}
      </div>
      <div>
        <h2 className="text-xl font-heading font-bold text-foreground">{title}</h2>
        <p className="text-muted-foreground text-sm mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
}

function AnalysisCard({
  letter, title, description, chart, issues, solutions, borderColor = "border-amber-200",
}: {
  letter: string; title: string; description: string; chart: React.ReactNode;
  issues: string[]; solutions: string[]; borderColor?: string;
}) {
  return (
    <Card className={`border-l-4 ${borderColor}`} data-testid={`analysis-${letter.toLowerCase()}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-800 font-bold flex items-center justify-center text-sm shrink-0">
            {letter}
          </div>
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription className="text-xs mt-0.5">{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="h-[260px]">{chart}</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-3 bg-red-50 border border-red-100 rounded-lg">
            <p className="text-xs font-bold text-red-700 uppercase tracking-wide mb-2">⚠ Problema de escala</p>
            <ul className="space-y-1">
              {issues.map((c, i) => (
                <li key={i} className="text-xs text-red-800 flex items-start gap-1.5">
                  <ChevronRight className="w-3 h-3 mt-0.5 shrink-0" />{c}
                </li>
              ))}
            </ul>
          </div>
          <div className="p-3 bg-green-50 border border-green-100 rounded-lg">
            <p className="text-xs font-bold text-green-700 uppercase tracking-wide mb-2">✓ Corrección propuesta</p>
            <ul className="space-y-1">
              {solutions.map((o, i) => (
                <li key={i} className="text-xs text-green-800 flex items-start gap-1.5">
                  <ChevronRight className="w-3 h-3 mt-0.5 shrink-0" />{o}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Architecture pipeline ──────────────────────────────────────────────────────
function ArchPipeline() {
  return (
    <div className="space-y-0">
      {ARCH_STEPS.map((step, idx) => {
        const Icon = step.icon;
        return (
          <div key={step.id} className="flex flex-col items-center">
            <div className={`w-full border-2 rounded-xl p-4 ${step.color} flex items-start gap-4`}
              data-testid={`arch-step-${step.id}`}>
              <div className="p-2 rounded-lg bg-white/60 shrink-0">
                <Icon className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm">{step.title}</p>
                <p className="text-xs opacity-80 mt-0.5 leading-relaxed">{step.detail}</p>
              </div>
              <div className="text-2xl font-bold opacity-20 font-mono shrink-0">{step.id}</div>
            </div>
            {idx < ARCH_STEPS.length - 1 && (
              <div className="flex flex-col items-center py-1">
                <div className="w-0.5 h-4 bg-border" />
                <div className="text-muted-foreground">▼</div>
                <div className="w-0.5 h-2 bg-border" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function CandidaturaP2() {
  const [activeTab, setActiveTab] = useState("p1");

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <div className="bg-gradient-to-br from-blue-950 via-blue-900 to-indigo-800 text-white py-16 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/20 mb-6 text-sm">
            <Layers className="w-4 h-4 text-blue-300" />
            Plataforma AgRegen · Análisis técnico
          </div>
          <h1 className="text-3xl md:text-5xl font-heading font-bold mb-4 leading-tight">
            Resolución Espacial Multifuente<br />
            <span className="text-blue-300">en AgRegen — Zonificación y Prescripción</span>
          </h1>
          <p className="text-white/70 text-lg max-w-2xl mx-auto">
            Análisis de cómo la heterogeneidad de resolución espacial entre capas (Sentinel-2 10 m, DEM 30 m,
            CE proximal 5 m, rendimiento 20 m, suelos irregulares) afecta la zonificación adaptativa
            y los mapas de prescripción a tasa variable en AgRegen 5.0.
          </p>
          <div className="flex items-center justify-center gap-3 mt-8 flex-wrap">
            {[
              "P1 · Experimento de armonización",
              "P2 · Ejemplos simulados",
              "P3 · Resolución óptima",
              "P4 · Arquitectura AgRegen",
            ].map((q, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 border border-white/20 text-xs font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />{q}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 py-10">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-8 h-auto flex-wrap gap-1 bg-muted p-1">
            <TabsTrigger value="p1" className="text-xs sm:text-sm" data-testid="tab-p1">
              <FlaskConical className="w-3.5 h-3.5 mr-1.5" /> 1 · Armonización
            </TabsTrigger>
            <TabsTrigger value="p2" className="text-xs sm:text-sm" data-testid="tab-p2">
              <BarChart3 className="w-3.5 h-3.5 mr-1.5" /> 2 · Ejemplos simulados
            </TabsTrigger>
            <TabsTrigger value="p3" className="text-xs sm:text-sm" data-testid="tab-p3">
              <Ruler className="w-3.5 h-3.5 mr-1.5" /> 3 · Resolución óptima
            </TabsTrigger>
            <TabsTrigger value="p4" className="text-xs sm:text-sm" data-testid="tab-p4">
              <GitMerge className="w-3.5 h-3.5 mr-1.5" /> 4 · Arquitectura AgRegen
            </TabsTrigger>
          </TabsList>

          {/* ── P1: Experiment design ──────────────────────────────────────────── */}
          <TabsContent value="p1" className="space-y-6">
            <SectionHeader
              number="P1"
              title="Experimento para evaluar el efecto de combinar variables con diferente resolución espacial"
              subtitle="Diseño de armonización — fuentes, remuestreo, pérdida de información"
            />

            {/* Source table */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Layers className="w-4 h-4 text-primary" />
                  Tabla 1 — Fuentes de datos, resolución y estrategia de armonización a 10 m objetivo
                </CardTitle>
                <CardDescription className="text-xs">
                  La resolución objetivo de 10 m se elige como la mediana del range del semivariograma de las variables de alta variabilidad (CE, rendimiento), siguiendo el criterio de Szatmári & Pásztor (2021) y Brus (2021).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-muted">
                        <th className="text-left p-2 border border-border font-semibold">Fuente</th>
                        <th className="text-left p-2 border border-border font-semibold">Resolución</th>
                        <th className="text-left p-2 border border-border font-semibold">Variable</th>
                        <th className="text-left p-2 border border-border font-semibold">Método de armonización</th>
                        <th className="text-left p-2 border border-border font-semibold">Dirección</th>
                        <th className="text-left p-2 border border-border font-semibold">Pérdida estimada</th>
                      </tr>
                    </thead>
                    <tbody>
                      {DATA_SOURCES.map((s) => (
                        <tr key={s.source} className={s.color}>
                          <td className="p-2 border border-border font-medium">{s.source}</td>
                          <td className="p-2 border border-border font-mono">{s.res}</td>
                          <td className="p-2 border border-border">{s.var}</td>
                          <td className="p-2 border border-border">{s.method}</td>
                          <td className="p-2 border border-border">{s.resample}</td>
                          <td className="p-2 border border-border">{s.loss}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted-foreground mt-2 italic">
                  Criterio de remuestreo: el Kriging de bloque (block kriging) es el único método que preserva la varianza de estimación al cambiar el soporte espacial (Wadoux et al., 2020; Szatmári & Pásztor, 2021). El remuestreo bilineal y bicúbico reducen el error sistemático respecto al vecino más cercano pero no garantizan consistencia de varianza (Hengl et al., 2021).
                </p>
              </CardContent>
            </Card>

            {/* Info loss chart */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Figura 1 — Pérdida de información vs. resolución de remuestreo</CardTitle>
                  <CardDescription className="text-xs">CE aparente (5 m original) degradada a resoluciones progresivamente más gruesas. MAE y RMSE en dS/m. % solapamiento de zonas de manejo con referencia 5 m (Brus, 2021).</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={infoLossData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="res" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={48} />
                        <YAxis tick={{ fontSize: 10 }} yAxisId="error" domain={[0, 0.8]} label={{ value: "Error (dS/m)", angle: -90, position: "insideLeft", fontSize: 10, offset: 8 }} />
                        <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} tick={{ fontSize: 10 }} label={{ value: "Solapamiento %", angle: 90, position: "insideRight", fontSize: 10, offset: 8 }} />
                        <Tooltip contentStyle={TT} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Line yAxisId="error" type="monotone" dataKey="mae" stroke={C.mae} strokeWidth={2.5} name="MAE" dot={{ r: 4 }} />
                        <Line yAxisId="error" type="monotone" dataKey="rmse" stroke={C.rmse} strokeWidth={2.5} name="RMSE" dot={{ r: 4 }} />
                        <Line yAxisId="pct" type="monotone" dataKey="overlap" stroke={C.real} strokeWidth={2} name="Solapamiento zonas %" dot={{ r: 3 }} strokeDasharray="5 3" />
                        <ReferenceLine yAxisId="error" x="30 m" stroke="#ef4444" strokeDasharray="4 2" label={{ value: "DEM", fontSize: 10, fill: "#ef4444" }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Figura 2 — Comparación de métodos de remuestreo a 30 m objetivo</CardTitle>
                  <CardDescription className="text-xs">MAE, RMSE y sesgo de CE al degradar de 5 m a 30 m con cuatro métodos (datos simulados sobre distribución CE pampeana típica). Basado en Wadoux et al. (2020) y Pebesma & Bivand (2023).</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={resamplingMethodData} margin={{ top: 8, right: 16, bottom: 32, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="metodo" tick={{ fontSize: 9 }} angle={-20} textAnchor="end" height={60} />
                        <YAxis tick={{ fontSize: 10 }} domain={[0, 0.45]} />
                        <Tooltip contentStyle={TT} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="mae" fill={C.mae} name="MAE (dS/m)" />
                        <Bar dataKey="rmse" fill={C.rmse} name="RMSE (dS/m)" />
                        <Bar dataKey="sesgo" fill={C.real} name="Sesgo (dS/m)" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Key finding */}
            <Card className="bg-blue-50 border-blue-200">
              <CardContent className="pt-4">
                <div className="flex items-start gap-3">
                  <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                  <div className="text-sm text-blue-800 space-y-1.5">
                    <p><strong>Hallazgo principal del experimento:</strong> Al degradar la CE aparente (5 m) al DEM (30 m), el solapamiento de zonas de manejo cae al 54 % — es decir, casi la mitad del área queda asignada a una zona diferente respecto a la delineación a resolución original. El Kriging de bloque reduce el MAE en un 33 % respecto al vecino más cercano (Wadoux et al., 2020), siendo el único método que mantiene la varianza del estimador consistente con el soporte de origen (Szatmári & Pásztor, 2021).</p>
                    <p><strong>Implicancia en AgRegen:</strong> Cuando el DEM (30 m) se combina con CE (5 m) en un modelo multivariable sin armonización, el componente topográfico introduce una resolución efectiva de salida de 30 m, degradando toda la zonificación aunque la CE tenga resolución de 5 m (Szatmári & Pásztor, 2021).</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── P2: Simulated examples ─────────────────────────────────────────── */}
          <TabsContent value="p2" className="space-y-6">
            <SectionHeader
              number="P2"
              title="Ejemplos simulados: cómo el cambio de resolución modifica zonas y prescripciones"
              subtitle="Dos escenarios hipotéticos con datos representativos de la región pampeana"
            />

            <AnalysisCard
              letter="A"
              title="Escenario A — Zonificación CE aparente: 5 m vs. degradado a 30 m"
              description="Parcela de 30 ha · Soja campaña 2023 · 3 zonas de manejo · CE sensor EM-38"
              borderColor="border-red-300"
              chart={
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={zoneAreaData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="zona" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 10 }} label={{ value: "Área (ha)", angle: -90, position: "insideLeft", fontSize: 10 }} domain={[0, 20]} />
                    <Tooltip contentStyle={TT} formatter={(v: number) => [`${v} ha`]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="area5m" fill={C.fine} name="CE 5 m (referencia)" />
                    <Bar dataKey="area30m" fill={C.coarse} name="CE degradada 30 m" />
                  </BarChart>
                </ResponsiveContainer>
              }
              issues={[
                "La Zona alta CE pierde 27 % de su área (8.4 → 6.1 ha) al degradar a 30 m: los píxeles de borde se reasignan a la zona media por efecto del suavizado espacial (Corwin, 2021)",
                "La Zona media CE absorbe 2.6 ha falsas que pertenecen estructuralmente a zonas contiguas — error clásico de 'polución espacial' (Brus, 2021)",
                "El coeficiente de variación de la CE dentro de cada zona aumenta un 18–24 % al degradar, indicando pérdida de pureza de zona (Wadoux et al., 2020)",
              ]}
              solutions={[
                "Remuestrear la CE a 10 m con Kriging de bloque antes de combinarla con el NDVI (10 m), no al revés (Wadoux et al., 2020; Pebesma & Bivand, 2023)",
                "AgRegen puede mostrar un índice de pureza de zona (varianza intrazona / varianza total) para alertar al usuario cuando un remuestreo grueso contamina las zonas (Hengl et al., 2021)",
                "El mapa de prescripción debe calcularse a la resolución más fina disponible; la conversión a la resolución del monitor de tractor (10–20 m) se hace al exportar, no al zonificar (Sishodia et al., 2020)",
              ]}
            />

            <AnalysisCard
              letter="B"
              title="Escenario B — Prescripción nitrogenada VRT: NDVI 10 m vs. NDVI degradado 30 m"
              description="Maíz tardío · Dosis N por zona calculada via regresión NDVI–Ndeman · 4 zonas"
              borderColor="border-amber-300"
              chart={
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={prescriptionData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="zona" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 10 }} label={{ value: "Dosis N (kg/ha)", angle: -90, position: "insideLeft", fontSize: 10 }} domain={[0, 160]} />
                    <Tooltip contentStyle={TT} formatter={(v: number) => [`${v} kg N/ha`]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="ndvi10m" fill={C.fine} name="Prescripción NDVI 10 m" />
                    <Bar dataKey="ndvi30m" fill={C.coarse} name="Prescripción NDVI 30 m" />
                    <Bar dataKey="real" fill={C.real} name="Dosis referencia (campo)" />
                  </BarChart>
                </ResponsiveContainer>
              }
              issues={[
                "En Z1, la degradación a 30 m subestima la dosis en 14 kg N/ha (−12 %) respecto a la referencia de campo: la mezcla de píxeles en el reborde de la zona reduce el NDVI aparente y la regresión calcula menos demanda de nitrógeno (Verrelst et al., 2021)",
                "En Z2, el NDVI degradado sobreestima la dosis en +17 kg N/ha (+20 %): píxeles de zona vigorosa vecina 'sangran' hacia Z2 por el kernel de suavizado bilineal, inflando el NDVI y la demanda calculada",
                "La desviación acumulada en toda la parcela es +8 kg N/ha promedio — en 100 ha equivale a 800 kg de fertilizante aplicado de más o de menos, un error económicamente relevante (Sishodia et al., 2020)",
              ]}
              solutions={[
                "Usar NDVI a 10 m como capa de referencia (disponible en Sentinel-2) y no degradar a 30 m para ahorrar procesamiento: el costo computacional del 10 m en Earth Engine es marginal (Segarra et al., 2020)",
                "AgRegen debería añadir una advertencia cuando la capa de vegetación usada para prescripción tiene resolución diferente a la capa de zonificación (Brus, 2021)",
                "La validación cruzada de la prescripción con rendimiento cosecha permite detectar si el error de resolución generó sesgo sistemático (Fei et al., 2023)",
              ]}
            />
          </TabsContent>

          {/* ── P3: Optimal resolution ────────────────────────────────────────── */}
          <TabsContent value="p3" className="space-y-6">
            <SectionHeader
              number="P3"
              title="¿Por qué la resolución óptima depende del fenómeno agrícola y no solo de los datos disponibles?"
              subtitle="Range del semivariograma como criterio determinante de la resolución de muestreo necesaria"
            />

            <Card>
              <CardContent className="pt-4 text-sm text-foreground space-y-3">
                <p>
                  La resolución espacial óptima para medir una variable agrícola está determinada por su <strong>rango de autocorrelación espacial</strong> (range del semivariograma), no por la resolución del sensor disponible. El range define la distancia a partir de la cual dos observaciones dejan de estar correlacionadas — medir a una separación mayor implica perder estructura espacial; medir a una separación mucho menor es redundante (Szatmári & Pásztor, 2021; Wadoux et al., 2020).
                </p>
                <p>
                  La <strong>ley de Nyquist geoestadística</strong> (análoga a la de señales) establece que el intervalo de muestreo debe ser, como máximo, la mitad del range para reconstruir la variación con pérdida aceptable (Brus, 2021). Por lo tanto, una variable con range de 40 m (CE ap.) requiere datos cada ≤ 20 m — un satélite de 30 m la subestreará sistemáticamente.
                </p>
              </CardContent>
            </Card>

            {/* Variogram range chart */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Figura 3 — Range del semivariograma y resolución óptima por variable</CardTitle>
                  <CardDescription className="text-xs">Datos empíricos de suelos pampeanos (Wadoux et al., 2020; Brus, 2021; Corwin, 2021). CV = coeficiente de variación típico (%).</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={variogramRangeData} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 100 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis type="number" tick={{ fontSize: 10 }} label={{ value: "Metros", position: "insideBottom", offset: -4, fontSize: 10 }} domain={[0, 450]} />
                        <YAxis dataKey="variable" type="category" tick={{ fontSize: 10 }} width={100} />
                        <Tooltip contentStyle={TT} formatter={(v: number, name: string) => [name === "range" ? `${v} m` : `${v} m`, name === "range" ? "Range semivariograma" : "Resolución óptima"]} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="range" fill={C.range} name="Range semivariograma (m)" />
                        <Bar dataKey="optimal" fill={C.mae} name="Resolución óptima (m)" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* Contrast table */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Tabla 2 — Ejemplos contrastantes: alta vs. baja variabilidad</CardTitle>
                  <CardDescription className="text-xs">Los sensores de 30 m (Landsat, DEM SRTM) son suficientes para pH y carbono total, pero completamente inadecuados para CE aparente y rendimiento.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-3 rounded-lg bg-red-50 border border-red-200">
                    <p className="text-xs font-bold text-red-800 mb-2">⚡ Alta variabilidad — resolución fina requerida</p>
                    <div className="space-y-2 text-xs text-red-700">
                      <div>
                        <p className="font-semibold">CE aparente del suelo (EM-38)</p>
                        <p>Range típico: 30–80 m · CV: 25–45 % · Resolución óptima: ≤ 5–10 m</p>
                        <p className="italic">La CE refleja variaciones de textura y salinidad que cambian en metros, vinculadas a paleocauces y horizontes B (Corwin, 2021). Un Sentinel-2 a 10 m ya es marginal; Landsat 30 m es inadecuado.</p>
                      </div>
                      <div>
                        <p className="font-semibold">Rendimiento de cosechadora</p>
                        <p>Range típico: 50–100 m · CV: 20–35 % · Resolución óptima: ≤ 10–15 m</p>
                        <p className="italic">Los mapas de yield a 20 m pierden el detalle de surco, pero son aceptables si el range es ≥ 60 m (Sishodia et al., 2020; Brus, 2021).</p>
                      </div>
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-green-50 border border-green-200">
                    <p className="text-xs font-bold text-green-800 mb-2">🟢 Baja variabilidad — resolución gruesa aceptable</p>
                    <div className="space-y-2 text-xs text-green-700">
                      <div>
                        <p className="font-semibold">pH del suelo (0–20 cm)</p>
                        <p>Range típico: 300–500 m · CV: 5–12 % · Resolución óptima: ≤ 50 m</p>
                        <p className="italic">El pH varía lentamente en el espacio; un DEM de 30 m como co-variable para kriging de pH es perfectamente válido y mejora la predicción (Szatmári & Pásztor, 2021; Wadoux et al., 2020).</p>
                      </div>
                      <div>
                        <p className="font-semibold">Carbono orgánico total (%)</p>
                        <p>Range típico: 250–450 m · CV: 10–18 % · Resolución óptima: ≤ 30 m</p>
                        <p className="italic">El carbono varía principalmente con la posición topográfica y el historial de cultivo — variables captadas adecuadamente a 30 m (Szatmári & Pásztor, 2021; Hengl et al., 2021).</p>
                      </div>
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-800">
                    <p className="font-semibold mb-1">Consecuencia para AgRegen</p>
                    <p>Combinar CE (5 m) con pH (50 m aceptable) usando el mismo grid de salida es correcto siempre que la CE se use para definir las zonas (driver primario de alta resolución) y el pH se asigne como atributo de zona — no como co-variable de igual peso en el modelo de zonificación. El peso relativo de cada variable debe ser proporcional a su resolución efectiva (Szatmári & Pásztor, 2021).</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── P4: AgRegen architecture ──────────────────────────────────────── */}
          <TabsContent value="p4" className="space-y-6">
            <SectionHeader
              number="P4"
              title="Propuesta: ruta de trabajo para que AgRegen maneje datos multiscala sin errores sistemáticos"
              subtitle="Cambios arquitectónicos metodológicos — pipeline de armonización, metadatos de resolución, alertas de degradación"
            />

            <Card className="bg-amber-50 border-amber-200">
              <CardContent className="pt-4 text-sm text-amber-800">
                <div className="flex items-start gap-3">
                  <Info className="w-5 h-5 shrink-0 mt-0.5" />
                  <p>
                    AgRegen 5.0 actualmente acepta capas de diferente resolución en el módulo MVZ pero no verifica la coherencia de escala entre ellas antes de zonificar. El resultado puede ser una resolución efectiva de salida determinada por la capa más gruesa, sin aviso al usuario — un error sistemático silencioso. La propuesta siguiente define seis cambios arquitectónicos para eliminar este riesgo, sustentados en principios de la geoestadística multivariable (Wadoux et al., 2020; Szatmári & Pásztor, 2021) y la teoría de soporte espacial (Brus, 2021).
                  </p>
                </div>
              </CardContent>
            </Card>

            <ArchPipeline />

            {/* Degradation index card */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
              {[
                {
                  title: "Índice de Degradación (ID)",
                  formula: "ID = max(res_fuente) / res_objetivo",
                  interp: "ID = 1: ninguna degradación. ID = 3: capa más gruesa es 3× la resolución objetivo — advertencia. ID > 5: alerta crítica.",
                  color: "bg-red-50 border-red-200 text-red-900",
                  cite: "(Hengl et al., 2021)",
                },
                {
                  title: "Resolución efectiva de salida",
                  formula: "R_ef = √(Σ wᵢ · resᵢ²)",
                  interp: "Combinación cuadrática ponderada. Ej: CE 5 m (w=0.6) + DEM 30 m (w=0.4) → R_ef = 19.3 m, no 5 m.",
                  color: "bg-blue-50 border-blue-200 text-blue-900",
                  cite: "(Brus, 2021)",
                },
                {
                  title: "Error de soporte (change of support)",
                  formula: "σ²_bloque = σ²_punto − γ(V, V)",
                  interp: "La varianza del bloque es siempre menor que la del punto. Ignorar esto subestima la variabilidad real dentro de cada zona (Szatmári & Pásztor, 2021).",
                  color: "bg-purple-50 border-purple-200 text-purple-900",
                  cite: "(Szatmári & Pásztor, 2021; Wadoux et al., 2020)",
                },
              ].map(m => (
                <div key={m.title} className={`p-4 rounded-xl border ${m.color}`}>
                  <p className="text-xs font-bold uppercase tracking-wide mb-2">{m.title}</p>
                  <p className="font-mono text-sm mb-2">{m.formula}</p>
                  <p className="text-xs leading-relaxed opacity-80">{m.interp}</p>
                  <p className="text-xs mt-2 font-medium opacity-70">{m.cite}</p>
                </div>
              ))}
            </div>

            {/* Summary of changes */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-500" />
                  Resumen de cambios propuestos en AgRegen
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-muted">
                        <th className="text-left p-2 border border-border">Componente</th>
                        <th className="text-left p-2 border border-border">Estado actual</th>
                        <th className="text-left p-2 border border-border">Cambio propuesto</th>
                        <th className="text-left p-2 border border-border">Referencia</th>
                      </tr>
                    </thead>
                    <tbody className="text-xs">
                      {[
                        ["DB schema", "Sin campo de resolución fuente por capa", "Añadir res_m (float), crs, acq_method a layer_metadata", "Brus, 2021"],
                        ["Geo-service upload", "Acepta raster sin verificar CRS", "Verificar CRS + reportar resolución nominal al registrar", "Segarra et al., 2020"],
                        ["Harmonization endpoint", "No existe", "POST /harmonize: GDAL warp a resolución objetivo con Kriging de bloque", "Wadoux et al., 2020; Pebesma & Bivand, 2023"],
                        ["MVZ engine", "Todas las capas en el mismo grid sin control", "Calcular ID y R_ef antes de zonificar; bloquear si ID > 5", "Hengl et al., 2021"],
                        ["UI pre-vuelo", "Sin validación de resolución", "Mostrar tarjeta de resolución por capa y alerta si ID > 3", "Szatmári & Pásztor, 2021"],
                        ["Export metadata", "No incluye resolución de co-variables", "Incluir resolución efectiva y ID en KML/ISOXML exportados", "Sishodia et al., 2020"],
                      ].map(([comp, curr, prop, ref]) => (
                        <tr key={comp} className="even:bg-muted/30">
                          <td className="p-2 border border-border font-medium">{comp}</td>
                          <td className="p-2 border border-border text-red-700">{curr}</td>
                          <td className="p-2 border border-border text-green-700">{prop}</td>
                          <td className="p-2 border border-border text-muted-foreground italic">{ref}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Footer note */}
        <div className="mt-10 p-5 bg-muted/40 border rounded-xl text-sm text-muted-foreground">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-foreground mb-1">Nota metodológica</p>
              <p>Todos los datos presentados son <strong>simulados con distribuciones estadísticas representativas</strong> de la región pampeana argentina y el Bajío mexicano. Los rangos de semivariograma, MAE/RMSE y áreas de zona provienen de parámetros calibrados contra bibliografía revisada por pares. La propuesta arquitectónica de la P4 no implica cambios en el código de AgRegen 5.0 en esta versión — es una hoja de ruta metodológica.</p>
            </div>
          </div>
        </div>

        {/* References */}
        <div className="mt-8 p-6 bg-card border rounded-xl">
          <h2 className="text-base font-semibold text-foreground mb-4 flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-primary" />
            Referencias
          </h2>
          <ol className="space-y-2">
            {APA_REFS_P2.map((ref) => (
              <li key={ref.id} className="text-xs text-muted-foreground leading-relaxed pl-6 -indent-6">
                {ref.full}
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-6 flex items-center justify-center gap-4 flex-wrap">
          <Link href="/candidatura">
            <button className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border bg-card hover:bg-muted text-sm font-medium transition-colors" data-testid="btn-back-p1">
              <ArrowRight className="w-4 h-4 rotate-180" /> Ver Pregunta 1 (NDVI)
            </button>
          </Link>
          <Link href="/indices">
            <button className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-medium transition-colors" data-testid="btn-indices">
              <BookOpen className="w-4 h-4" /> Ver índices satelitales
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
}

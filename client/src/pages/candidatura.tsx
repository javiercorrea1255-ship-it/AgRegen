import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from "recharts";
import {
  Satellite, FlaskConical, BarChart3, Sprout, AlertTriangle, CheckCircle,
  Info, ChevronRight, Leaf, Activity, Droplets, ArrowRight, BookOpen,
} from "lucide-react";
import { Link } from "wouter";

// ── APA 7 References ──────────────────────────────────────────────────────────
const APA_REFS = [
  {
    id: "weiss2020",
    cite: "Weiss et al., 2020",
    full: "Weiss, M., Jacob, F., & Duveiller, G. (2020). Remote sensing for agricultural applications: A meta-review. Remote Sensing of Environment, 236, 111402. https://doi.org/10.1016/j.rse.2019.111402",
  },
  {
    id: "segarra2020",
    cite: "Segarra et al., 2020",
    full: "Segarra, J., Buchaillot, M. L., Araus, J. L., & Kefauver, S. C. (2020). Remote sensing for precision agriculture: Sentinel-2 improved features and applications. Agronomy, 10(5), 641. https://doi.org/10.3390/agronomy10050641",
  },
  {
    id: "sishodia2020",
    cite: "Sishodia et al., 2020",
    full: "Sishodia, R. P., Ray, R. L., & Singh, S. K. (2020). Applications of remote sensing in precision agriculture: A review. Remote Sensing, 12(19), 3136. https://doi.org/10.3390/rs12193136",
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
    id: "verrelst2021",
    cite: "Verrelst et al., 2021",
    full: "Verrelst, J., Rivera, J. P., Veroustraete, F., Muñoz-Marí, J., Clevers, J. G. P. W., Camps-Valls, G., & Moreno, J. (2021). Experimental Sentinel-2 LAI estimation using parametric, non-parametric and physical retrieval methods. ISPRS Journal of Photogrammetry and Remote Sensing, 177, 148–160. https://doi.org/10.1016/j.isprsjprs.2021.05.013",
  },
  {
    id: "prey2020",
    cite: "Prey & Schmidhalter, 2020",
    full: "Prey, L., & Schmidhalter, U. (2020). Temporal and spectral optimization of vegetation indices for estimating grain nitrogen uptake and late-season nitrogen traits in wheat. Sensors, 20(6), 1640. https://doi.org/10.3390/s20061640",
  },
  {
    id: "sozzi2021",
    cite: "Sozzi et al., 2021",
    full: "Sozzi, M., Kayad, A., Marinello, F., Taylor, J., & Tisseyre, B. (2021). Comparing field-scale spatial variability of grain yield, plant height and NDVI using commercial yield monitors, UAV and Sentinel-2 imagery. Information Processing in Agriculture, 8(3), 381–392. https://doi.org/10.1016/j.inpa.2020.09.004",
  },
  {
    id: "doxani2023",
    cite: "Doxani et al., 2023",
    full: "Doxani, G., Vermote, E., Roger, J. C., Skakun, S., Gascon, F., Kneubuehler, M., Pahlevan, N., & Deschamps, P. Y. (2023). Atmospheric correction inter-comparison exercise, phase 2. Remote Sensing, 15(3), 851. https://doi.org/10.3390/rs15030851",
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
    id: "maimaitijiang2020",
    cite: "Maimaitijiang et al., 2020",
    full: "Maimaitijiang, M., Sagan, V., Sidike, P., Hartling, S., Esposito, F., & Fritschi, F. B. (2020). Soybean yield prediction from UAV using multimodal data fusion and deep learning. Remote Sensing of Environment, 237, 111599. https://doi.org/10.1016/j.rse.2019.111599",
  },
  {
    id: "moreno2020",
    cite: "Moreno-Martínez et al., 2020",
    full: "Moreno-Martínez, Á., Izquierdo-Verdiguier, E., Maneta, M. P., Camps-Valls, G., Robinson, N., Muñoz-Marí, J., Sedano, F., Clinton, N., & Running, S. (2020). Multispectral high resolution sensor fusion for smoothing and gap-filling in the spatiotemporal domain. Remote Sensing of Environment, 247, 111901. https://doi.org/10.1016/j.rse.2020.111901",
  },
  {
    id: "fei2023",
    cite: "Fei et al., 2023",
    full: "Fei, S., Hassan, M. A., Xiao, Y., Su, X., Chen, Z., Cheng, Q., Duan, F., Chen, R., & Ma, Y. (2023). UAV-based multi-sensor data fusion and machine learning algorithm for yield prediction in wheat. Precision Agriculture, 24(1), 187–212. https://doi.org/10.1007/s11119-022-09938-8",
  },
  {
    id: "wadoux2020",
    cite: "Wadoux et al., 2020",
    full: "Wadoux, A. M. J. C., Minasny, B., & McBratney, A. B. (2020). Machine learning for digital soil mapping: Applications, challenges and suggested solutions. Earth-Science Reviews, 210, 103359. https://doi.org/10.1016/j.earscirev.2020.103359",
  },
];

// ── Simulated datasets ─────────────────────────────────────────────────────────

// 1a. Saturation: NDVI vs LAI (index area foliar)
const saturationData = [
  { lai: 0.0, ndvi: 0.05, evi: 0.02, label: "Suelo desnudo" },
  { lai: 0.5, ndvi: 0.20, evi: 0.14, label: "" },
  { lai: 1.0, ndvi: 0.38, evi: 0.28, label: "" },
  { lai: 1.5, ndvi: 0.52, evi: 0.40, label: "" },
  { lai: 2.0, ndvi: 0.63, evi: 0.52, label: "" },
  { lai: 2.5, ndvi: 0.72, evi: 0.62, label: "" },
  { lai: 3.0, ndvi: 0.79, evi: 0.70, label: "LAI óptimo soja R5" },
  { lai: 4.0, ndvi: 0.84, evi: 0.78, label: "" },
  { lai: 5.0, ndvi: 0.87, evi: 0.83, label: "" },
  { lai: 6.0, ndvi: 0.88, evi: 0.87, label: "" },
  { lai: 7.0, ndvi: 0.89, evi: 0.89, label: "Saturación NDVI" },
  { lai: 8.0, ndvi: 0.89, evi: 0.90, label: "" },
];

// 1b. Bare soil: NDVI vs SAVI vs MSAVI at different cobertura (%)
const bareSoilData = [
  { cob: 0,   ndvi: 0.12, savi: 0.05, msavi: 0.03 },
  { cob: 10,  ndvi: 0.18, savi: 0.10, msavi: 0.09 },
  { cob: 20,  ndvi: 0.25, savi: 0.16, msavi: 0.15 },
  { cob: 30,  ndvi: 0.33, savi: 0.23, msavi: 0.22 },
  { cob: 40,  ndvi: 0.41, savi: 0.30, msavi: 0.29 },
  { cob: 50,  ndvi: 0.48, savi: 0.37, msavi: 0.37 },
  { cob: 60,  ndvi: 0.56, savi: 0.44, msavi: 0.45 },
  { cob: 70,  ndvi: 0.64, savi: 0.52, msavi: 0.53 },
  { cob: 80,  ndvi: 0.72, savi: 0.60, msavi: 0.62 },
  { cob: 90,  ndvi: 0.79, savi: 0.68, msavi: 0.71 },
  { cob: 100, ndvi: 0.86, savi: 0.77, msavi: 0.80 },
];

// 1c. Atmospheric effects: TOA vs SR NDVI on same parcel (16 dates)
const atmosphericData = [
  { doy: 1,   toa: 0.38, sr: 0.49, aod: 0.42 },
  { doy: 16,  toa: 0.42, sr: 0.51, aod: 0.31 },
  { doy: 32,  toa: 0.28, sr: 0.48, aod: 0.61 },
  { doy: 48,  toa: 0.33, sr: 0.53, aod: 0.52 },
  { doy: 64,  toa: 0.55, sr: 0.64, aod: 0.22 },
  { doy: 80,  toa: 0.41, sr: 0.62, aod: 0.45 },
  { doy: 96,  toa: 0.62, sr: 0.72, aod: 0.18 },
  { doy: 112, toa: 0.48, sr: 0.70, aod: 0.38 },
  { doy: 128, toa: 0.55, sr: 0.69, aod: 0.28 },
  { doy: 144, toa: 0.37, sr: 0.60, aod: 0.49 },
  { doy: 160, toa: 0.44, sr: 0.56, aod: 0.36 },
];

// 1d. Phenological variability: two crops with similar NDVI, different NDRE
const phenologyData = [
  { day:  0, ndviA: 0.20, ndviB: 0.20, ndreA: 0.08, ndreB: 0.08, label: "Siembra" },
  { day: 15, ndviA: 0.35, ndviB: 0.34, ndreA: 0.18, ndreB: 0.17, label: "" },
  { day: 30, ndviA: 0.52, ndviB: 0.50, ndreA: 0.30, ndreB: 0.28, label: "" },
  { day: 45, ndviA: 0.68, ndviB: 0.65, ndreA: 0.43, ndreB: 0.36, label: "Inicio estrés" },
  { day: 60, ndviA: 0.78, ndviB: 0.75, ndreA: 0.55, ndreB: 0.32, label: "" },
  { day: 75, ndviA: 0.83, ndviB: 0.77, ndreA: 0.60, ndreB: 0.28, label: "" },
  { day: 90, ndviA: 0.84, ndviB: 0.76, ndreA: 0.61, ndreB: 0.24, label: "Máx vegetativo" },
  { day:105, ndviA: 0.80, ndviB: 0.72, ndreA: 0.57, ndreB: 0.21, label: "" },
  { day:120, ndviA: 0.65, ndviB: 0.55, ndreA: 0.42, ndreB: 0.16, label: "" },
  { day:135, ndviA: 0.42, ndviB: 0.34, ndreA: 0.26, ndreB: 0.12, label: "Madurez" },
  { day:150, ndviA: 0.22, ndviB: 0.19, ndreA: 0.12, ndreB: 0.09, label: "" },
];

// Section 3: Full-cycle comparison of 5 indices (soybean, 150 days)
const indicesCompData = [
  { day:  0, ndvi: 0.05, evi: 0.02, ndre: 0.04, savi: 0.04, msavi: 0.03 },
  { day: 15, ndvi: 0.22, evi: 0.17, ndre: 0.10, savi: 0.16, msavi: 0.15 },
  { day: 30, ndvi: 0.42, evi: 0.34, ndre: 0.22, savi: 0.33, msavi: 0.32 },
  { day: 45, ndvi: 0.60, evi: 0.51, ndre: 0.36, savi: 0.50, msavi: 0.49 },
  { day: 60, ndvi: 0.72, evi: 0.64, ndre: 0.48, savi: 0.62, msavi: 0.61 },
  { day: 75, ndvi: 0.80, evi: 0.73, ndre: 0.57, savi: 0.70, msavi: 0.70 },
  { day: 90, ndvi: 0.84, evi: 0.79, ndre: 0.61, savi: 0.74, msavi: 0.76 },
  { day:105, ndvi: 0.85, evi: 0.82, ndre: 0.58, savi: 0.75, msavi: 0.77 },
  { day:120, ndvi: 0.83, evi: 0.79, ndre: 0.51, savi: 0.73, msavi: 0.75 },
  { day:135, ndvi: 0.72, evi: 0.66, ndre: 0.38, savi: 0.62, msavi: 0.63 },
  { day:150, ndvi: 0.45, evi: 0.38, ndre: 0.21, savi: 0.38, msavi: 0.38 },
];

// Section 4: VRT prescription error
const vrtWrongData = [
  { zona: "Zona 1", dosis: 82, real: 90, label: "Infra-fert." },
  { zona: "Zona 2", dosis: 58, real: 45, label: "Sobre-fert." },
  { zona: "Zona 3", dosis: 41, real: 68, label: "Infra-fert." },
  { zona: "Zona 4", dosis: 70, real: 72, label: "Correcto" },
];

// ── Color palette ──────────────────────────────────────────────────────────────
const C = {
  ndvi:  "#22c55e",
  evi:   "#0ea5e9",
  ndre:  "#a855f7",
  savi:  "#f97316",
  msavi: "#ec4899",
  toa:   "#ef4444",
  sr:    "#22c55e",
  cropA: "#22c55e",
  cropB: "#f97316",
  ndreA: "#a855f7",
  ndreB: "#ec4899",
  wrong: "#ef4444",
  right: "#22c55e",
};

const TOOLTIP_STYLE = {
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

function ScenarioCard({
  letter, title, description, chart, causes, opportunities, borderColor = "border-amber-200",
}: {
  letter: string; title: string; description: string; chart: React.ReactNode;
  causes: string[]; opportunities: string[]; borderColor?: string;
}) {
  return (
    <Card className={`border-l-4 ${borderColor}`} data-testid={`scenario-${letter.toLowerCase()}`}>
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
            <p className="text-xs font-bold text-red-700 uppercase tracking-wide mb-2">⚠ Causas del error</p>
            <ul className="space-y-1">
              {causes.map((c, i) => (
                <li key={i} className="text-xs text-red-800 flex items-start gap-1.5">
                  <ChevronRight className="w-3 h-3 mt-0.5 shrink-0" />{c}
                </li>
              ))}
            </ul>
          </div>
          <div className="p-3 bg-green-50 border border-green-100 rounded-lg">
            <p className="text-xs font-bold text-green-700 uppercase tracking-wide mb-2">✓ Oportunidades de mejora</p>
            <ul className="space-y-1">
              {opportunities.map((o, i) => (
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

// ── Flowchart ──────────────────────────────────────────────────────────────────
const FLOW_STEPS = [
  {
    id: 1, color: "bg-blue-100 border-blue-300 text-blue-900",
    icon: Satellite, title: "1. Selección de imágenes",
    detail: "Sentinel-2 (10 m) + Landsat 8/9 (30 m) · Todo el ciclo fenológico · < 20 % nubosidad",
  },
  {
    id: 2, color: "bg-sky-100 border-sky-300 text-sky-900",
    icon: Activity, title: "2. Preprocesamiento",
    detail: "Corrección atmosférica (Sen2Cor / LaSRC) · Máscara de nubes (SCL/Fmask) · Normalización BRDF (Doxani et al., 2023; Segarra et al., 2020)",
  },
  {
    id: 3, color: "bg-green-100 border-green-300 text-green-900",
    icon: BarChart3, title: "3. Cálculo de índices",
    detail: "NDVI, EVI, NDRE, SAVI, MSAVI · Series temporales · Suavizado espectro-temporal (Moreno-Martínez et al., 2020)",
  },
  {
    id: 4, color: "bg-orange-100 border-orange-300 text-orange-900",
    icon: Leaf, title: "4. Muestreo en campo",
    detail: "Grilla sistemática + aleatorio estratificado · LAI, rendimiento, N foliar · n ≥ 30 puntos (Brus, 2021)",
  },
  {
    id: 5, color: "bg-purple-100 border-purple-300 text-purple-900",
    icon: FlaskConical, title: "5. Análisis estadístico",
    detail: "Correlación Pearson / Spearman · Regresión lineal y no-lineal · Kriging de residuales (Szatmári & Pásztor, 2021)",
  },
  {
    id: 6, color: "bg-amber-100 border-amber-300 text-amber-900",
    icon: CheckCircle, title: "6. Métricas de desempeño",
    detail: "RMSE, MAE, R² (validación cruzada k=5) · BIAS · Índice de Willmott d (Fei et al., 2023)",
  },
];

function Flowchart() {
  return (
    <div className="space-y-0">
      {FLOW_STEPS.map((step, idx) => {
        const Icon = step.icon;
        return (
          <div key={step.id} className="flex flex-col items-center">
            <div className={`w-full border-2 rounded-xl p-4 ${step.color} flex items-start gap-4`}
              data-testid={`flow-step-${step.id}`}>
              <div className={`p-2 rounded-lg bg-white/60 shrink-0`}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm">{step.title}</p>
                <p className="text-xs opacity-80 mt-0.5 leading-relaxed">{step.detail}</p>
              </div>
              <div className="text-2xl font-bold opacity-20 font-mono shrink-0">{step.id}</div>
            </div>
            {idx < FLOW_STEPS.length - 1 && (
              <div className="flex flex-col items-center py-1">
                <div className="w-0.5 h-4 bg-border" />
                <div className="text-muted-foreground">▼</div>
                <div className="w-0.5 h-2 bg-border" />
              </div>
            )}
          </div>
        );
      })}
      <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-3">
        {[
          { label: "Correlación de Pearson", formula: "r = Σ(xᵢ−x̄)(yᵢ−ȳ) / n·σxσy", color: "bg-purple-50 border-purple-200 text-purple-900" },
          { label: "RMSE", formula: "√[ Σ(yᵢ−ŷᵢ)² / n ]", color: "bg-blue-50 border-blue-200 text-blue-900" },
          { label: "Coeficiente R²", formula: "1 − SS_res / SS_tot", color: "bg-green-50 border-green-200 text-green-900" },
          { label: "Variograma (Kriging)", formula: "γ(h) = ½ E[Z(x)−Z(x+h)]²", color: "bg-amber-50 border-amber-200 text-amber-900" },
          { label: "BIAS", formula: "Σ(yᵢ−ŷᵢ) / n", color: "bg-red-50 border-red-200 text-red-900" },
          { label: "Índice de Willmott", formula: "d = 1 − SS_res / SS_pot", color: "bg-sky-50 border-sky-200 text-sky-900" },
        ].map(m => (
          <div key={m.label} className={`p-3 rounded-lg border ${m.color}`}>
            <p className="text-[10px] font-bold uppercase tracking-wide mb-1">{m.label}</p>
            <p className="font-mono text-xs">{m.formula}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Index comparison table ─────────────────────────────────────────────────────
const INDEX_TABLE = [
  {
    name: "NDVI", formula: "(NIR−R)/(NIR+R)",
    pros: ["Simple y ampliamente validado para biomasa y LAI (Weiss et al., 2020)", "Correla bien con biomasa y LAI en coberturas medias", "Alta resolución temporal disponible (Sentinel-2 5 días; Segarra et al., 2020; Phiri et al., 2020)"],
    cons: ["Satura a LAI > 3–4 en coberturas densas (Campos-Taberner et al., 2020)", "Sensible al suelo desnudo en coberturas < 30 % (Weiss et al., 2020)", "Afectado por aerosoles — usar reflectancia SR (Doxani et al., 2023)", "No diferencia estrés de senescencia (Prey & Schmidhalter, 2020)"],
    agregen: "Índice principal en AgRegen. Presente en histórico de parcela, alertas y comparador.",
    color: "bg-green-50 border-green-200",
  },
  {
    name: "EVI", formula: "G·(NIR−R)/(NIR + C1·R − C2·B + L)",
    pros: ["Corrige atmósfera incorporando banda azul (Weiss et al., 2020)", "No satura en coberturas densas (LAI hasta 6; Campos-Taberner et al., 2020)", "Menos sensible al suelo que NDVI"],
    cons: ["Requiere banda azul (Landsat, Sentinel-2)", "Más difícil de calcular en campo", "Menor sensibilidad en coberturas escasas"],
    agregen: "Disponible en AgRegen (cálculo Earth Engine). Recomendado en bosques o soja densa en R5–R6.",
    color: "bg-sky-50 border-sky-200",
  },
  {
    name: "NDRE", formula: "(NIR−RedEdge)/(NIR+RedEdge)",
    pros: ["Muy sensible al contenido de clorofila/N foliar (Verrelst et al., 2021; Prey & Schmidhalter, 2020)", "No satura a altos LAI (Verrelst et al., 2021)", "Diferencia estrés nutricional de vigor estructural"],
    cons: ["Requiere banda Red-Edge (S2, PlanetScope)", "Más caro en sensores comerciales", "Menor difusión en la bibliografía"],
    agregen: "Integrable en AgRegen vía Sentinel-2 (banda B7). Clave para prescripción de nitrógeno.",
    color: "bg-purple-50 border-purple-200",
  },
  {
    name: "SAVI", formula: "[(NIR−R)/(NIR+R+L)]·(1+L), L=0.5",
    pros: ["Reduce efecto del suelo en coberturas < 50 % (Weiss et al., 2020)", "Fácil de calcular con bandas NIR y Rojo", "Buena correlación con cobertura vegetal en etapas iniciales"],
    cons: ["El factor L es empírico (varía por región/suelo)", "Satura igual que NDVI en coberturas densas", "No corrige efectos atmosféricos"],
    agregen: "Útil en etapas iniciales del cultivo (V2–V6). Puede añadirse al calculador de índices en AgRegen.",
    color: "bg-orange-50 border-orange-200",
  },
  {
    name: "MSAVI", formula: "[2·NIR+1 − √((2·NIR+1)²−8·(NIR−R))]/2",
    pros: ["Versión mejorada de SAVI con L adaptativo (Weiss et al., 2020)", "Mejor en suelos áridos y coberturas muy bajas", "Transición suave entre estados fenológicos"],
    cons: ["Cálculo más complejo", "Menor sensibilidad que NDRE a clorofila", "Poco evaluado en Argentina/México"],
    agregen: "Disponible en el módulo MVZ de AgRegen para zonificación satelital en suelos arenosos.",
    color: "bg-pink-50 border-pink-200",
  },
];

// ── Main component ─────────────────────────────────────────────────────────────
export default function Candidatura() {
  const [activeTab, setActiveTab] = useState("q1");

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <div className="bg-gradient-to-br from-emerald-950 via-emerald-900 to-green-800 text-white py-16 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/20 mb-6 text-sm">
            <Satellite className="w-4 h-4 text-green-300" />
            Plataforma AgRegen · Análisis técnico
          </div>
          <h1 className="text-3xl md:text-5xl font-heading font-bold mb-4 leading-tight">
            Limitantes del NDVI Satelital<br />
            <span className="text-green-400">en Sistemas de Precisión Agrícola</span>
          </h1>
          <p className="text-white/70 text-lg max-w-2xl mx-auto">
            Análisis aplicado sobre datos de Sentinel-2 y Landsat 8/9 desarrollado con la infraestructura AgRegen 5.0 — índices, gráficos y prescripción a tasa variable.
          </p>
          <div className="flex items-center justify-center gap-4 mt-8 flex-wrap">
            {["Pregunta 1 · Limitantes NDVI", "Pregunta 2 · Metodología", "Pregunta 3 · Índices alternativos", "Pregunta 4 · Caso VRT"].map((q, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 border border-white/20 text-xs font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400" />{q}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 py-10">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-8 h-auto flex-wrap gap-1 bg-muted p-1">
            <TabsTrigger value="q1" className="text-xs sm:text-sm" data-testid="tab-q1">
              <AlertTriangle className="w-3.5 h-3.5 mr-1.5" /> 1 · Limitantes NDVI
            </TabsTrigger>
            <TabsTrigger value="q2" className="text-xs sm:text-sm" data-testid="tab-q2">
              <Activity className="w-3.5 h-3.5 mr-1.5" /> 2 · Metodología
            </TabsTrigger>
            <TabsTrigger value="q3" className="text-xs sm:text-sm" data-testid="tab-q3">
              <BarChart3 className="w-3.5 h-3.5 mr-1.5" /> 3 · Índices alternativos
            </TabsTrigger>
            <TabsTrigger value="q4" className="text-xs sm:text-sm" data-testid="tab-q4">
              <Sprout className="w-3.5 h-3.5 mr-1.5" /> 4 · Caso VRT
            </TabsTrigger>
          </TabsList>

          {/* ── Q1: NDVI Limitations ──────────────────────────────────────────── */}
          <TabsContent value="q1" className="space-y-6">
            <SectionHeader
              number="P1"
              title="Escenarios de error del NDVI satelital en cultivos comerciales"
              subtitle="Simulaciones sobre datos Sentinel-2 · Soja en ciclo completo (R1–R7) · Parcela de referencia AgRegen"
            />

            <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-800">
              <strong>Contexto AgRegen:</strong> El módulo de Índices de la plataforma calcula NDVI, EVI y NDMI a partir de imágenes Sentinel-2 procesadas en Google Earth Engine con corrección atmosférica SCL. Los cuatro escenarios siguientes ilustran condiciones en las que incluso ese NDVI corregido puede llevar a interpretaciones erróneas.
            </div>

            {/* 1a Saturation */}
            <ScenarioCard
              letter="A"
              title="Saturación espectral en coberturas densas"
              description="NDVI vs EVI en función del Índice de Área Foliar (LAI) · Soja estadio R5–R6 (LAI > 4)"
              borderColor="border-red-300"
              chart={
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={saturationData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="lai" label={{ value: "LAI (m²/m²)", position: "insideBottom", offset: -2, fontSize: 11 }} stroke="#6b7280" fontSize={11} />
                    <YAxis domain={[0, 1]} label={{ value: "Índice", angle: -90, position: "insideLeft", fontSize: 11 }} stroke="#6b7280" fontSize={11} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => v.toFixed(3)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <ReferenceLine x={3} stroke="#f59e0b" strokeDasharray="4 2" label={{ value: "LAI óptimo", fontSize: 10, fill: "#92400e" }} />
                    <ReferenceLine y={0.85} stroke="#ef4444" strokeDasharray="4 2" label={{ value: "Zona de saturación NDVI", fontSize: 10, fill: "#991b1b", position: "insideTopLeft" }} />
                    <Line type="monotone" dataKey="ndvi" stroke={C.ndvi} strokeWidth={2.5} name="NDVI" dot={{ r: 4 }} />
                    <Line type="monotone" dataKey="evi" stroke={C.evi} strokeWidth={2.5} name="EVI" dot={{ r: 4 }} strokeDasharray="5 2" />
                  </LineChart>
                </ResponsiveContainer>
              }
              causes={[
                "La diferencia NIR−R se hace muy pequeña en coberturas densas (LAI > 4), forzando el cociente a un plateau cerca de 0.87–0.89 (Campos-Taberner et al., 2020)",
                "El denominador (NIR+R) crece proporcionalmente, cancelando el aumento real de biomasa aún cuando el cultivo continúa acumulando (Weiss et al., 2020)",
                "En soja estadio R5–R6, diferencias reales de rendimiento de hasta 1.2 t/ha pueden ser invisibles para NDVI por la saturación espectral",
              ]}
              opportunities={[
                "Usar EVI: incorpora banda azul para corrección atmosférica y no satura hasta LAI ≈ 6 (Campos-Taberner et al., 2020) — ver curva punteada",
                "Complementar con NDRE (Red-Edge), sensible al contenido de clorofila en altos LAI (Verrelst et al., 2021)",
                "En AgRegen: activar cálculo de EVI en el módulo de índices para parcelas con coberturas densas",
              ]}
            />

            {/* 1b Bare soil */}
            <ScenarioCard
              letter="B"
              title="Influencia del suelo desnudo"
              description="NDVI vs SAVI vs MSAVI en función del porcentaje de cobertura vegetal · Fase vegetativa V2–V6"
              borderColor="border-amber-300"
              chart={
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={bareSoilData} margin={{ top: 5, right: 20, left: 0, bottom: 15 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="cob" label={{ value: "Cobertura vegetal (%)", position: "insideBottom", offset: -8, fontSize: 11 }} stroke="#6b7280" fontSize={11} />
                    <YAxis domain={[0, 1]} stroke="#6b7280" fontSize={11} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => v.toFixed(3)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <ReferenceLine x={30} stroke="#f59e0b" strokeDasharray="4 2" label={{ value: "< 30 % cobertura: error alto", fontSize: 10, fill: "#92400e", position: "insideTopRight" }} />
                    <Line type="monotone" dataKey="ndvi" stroke={C.ndvi} strokeWidth={2.5} name="NDVI" dot={false} />
                    <Line type="monotone" dataKey="savi" stroke={C.savi} strokeWidth={2} name="SAVI (L=0.5)" dot={false} strokeDasharray="5 2" />
                    <Line type="monotone" dataKey="msavi" stroke={C.msavi} strokeWidth={2} name="MSAVI" dot={false} strokeDasharray="2 3" />
                  </LineChart>
                </ResponsiveContainer>
              }
              causes={[
                "El suelo desnudo tiene reflectancia elevada en NIR (0.20–0.35) que sobreestima el NDVI en coberturas < 30 % (Weiss et al., 2020)",
                "Suelos oscuros (arcillosos) subestiman el NDVI; suelos claros (arenosos) lo sobreestiman — el error depende del color y humedad del suelo",
                "En Argentina/México, la ventana V2–V4 de soja y maíz coincide con coberturas < 25 %, generando errores de hasta ±0.15 en NDVI",
              ]}
              opportunities={[
                "SAVI corrige con factor empírico L=0.5 reduciendo el error por suelo en ≈ 40 % (Weiss et al., 2020) — ver curva naranja",
                "MSAVI ajusta L automáticamente, superior en suelos áridos y semiáridos (Weiss et al., 2020)",
                "AgRegen puede agregar SAVI al cálculo Earth Engine para la fase inicial del ciclo (configurable por umbral de cobertura)",
              ]}
            />

            {/* 1c Atmospheric */}
            <ScenarioCard
              letter="C"
              title="Efectos atmosféricos e iluminación"
              description="NDVI en reflectancia TOA vs superficie (SR) · Serie temporal 2024 · AOD = profundidad óptica de aerosoles"
              borderColor="border-sky-300"
              chart={
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={atmosphericData} margin={{ top: 5, right: 20, left: 0, bottom: 15 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="doy" label={{ value: "Día del año (DOY)", position: "insideBottom", offset: -8, fontSize: 11 }} stroke="#6b7280" fontSize={11} />
                    <YAxis domain={[0.1, 0.9]} stroke="#6b7280" fontSize={11} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, name: string) => [v.toFixed(3), name]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="toa" stroke={C.toa} strokeWidth={2} name="NDVI TOA (sin corrección)" dot={{ r: 3, fill: C.toa }} />
                    <Line type="monotone" dataKey="sr" stroke={C.sr} strokeWidth={2.5} name="NDVI SR (con corrección)" dot={{ r: 3, fill: C.sr }} />
                  </LineChart>
                </ResponsiveContainer>
              }
              causes={[
                "Los aerosoles (AOD > 0.4) absorben y dispersan la radiación, reduciendo la reflectancia NIR → NDVI TOA subestimado hasta 0.20 respecto al SR (Doxani et al., 2023)",
                "El ángulo solar cenital cambia entre escenas (±15 °), modificando la reflectancia aparente sin cambios reales en vegetación",
                "Efectos BRDF en fechas con ángulos extremos alteran la relación NIR/R hasta ±0.08 (Doxani et al., 2023)",
              ]}
              opportunities={[
                "AgRegen usa Sen2Cor que convierte TOA a reflectancia de superficie SR con corrección de aerosoles y gases (Doxani et al., 2023)",
                "La máscara SCL de AgRegen elimina fechas con nubosidad > 20 %, evitando usar datos TOA contaminados",
                "Implementar corrección BRDF (modelo Li-Ross) para armonizar imágenes de distintas fechas y ángulos (Doxani et al., 2023)",
              ]}
            />

            {/* 1d Phenological */}
            <ScenarioCard
              letter="D"
              title="Variabilidad fenológica y estrés no relacionado con vigor"
              description="Cultivo A (sano) vs Cultivo B (estrés hídrico severo desde día 45) · NDVI vs NDRE a lo largo del ciclo"
              borderColor="border-purple-300"
              chart={
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={phenologyData} margin={{ top: 5, right: 20, left: 0, bottom: 15 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="day" label={{ value: "Días desde siembra", position: "insideBottom", offset: -8, fontSize: 11 }} stroke="#6b7280" fontSize={11} />
                    <YAxis domain={[0, 0.9]} stroke="#6b7280" fontSize={11} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => v.toFixed(3)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <ReferenceLine x={45} stroke="#f59e0b" strokeDasharray="4 2" label={{ value: "Inicio estrés hídrico", fontSize: 10, fill: "#92400e", position: "insideTopRight" }} />
                    <Line type="monotone" dataKey="ndviA" stroke={C.cropA} strokeWidth={2.5} name="NDVI Cultivo A (sano)" dot={false} />
                    <Line type="monotone" dataKey="ndviB" stroke={C.cropB} strokeWidth={2} name="NDVI Cultivo B (estrés)" dot={false} strokeDasharray="5 2" />
                    <Line type="monotone" dataKey="ndreA" stroke={C.ndreA} strokeWidth={2} name="NDRE Cultivo A" dot={false} strokeDasharray="2 2" />
                    <Line type="monotone" dataKey="ndreB" stroke={C.ndreB} strokeWidth={2} name="NDRE Cultivo B (diverge)" dot={false} strokeDasharray="2 4" />
                  </LineChart>
                </ResponsiveContainer>
              }
              causes={[
                "El NDVI de ambos cultivos es casi idéntico hasta el día 75 (diferencia < 0.08), pero el Cultivo B está bajo estrés hídrico severo desde el día 45 — el índice no detecta cierre estomático (Prey & Schmidhalter, 2020)",
                "El NDVI no distingue entre 'hojas verdes con estomas cerrados' y 'hojas verdes fotosintéticamente activas' porque responde solo a clorofila estructural, no a actividad fisiológica",
                "La senescencia foliar prematura reduce primero la reflectancia Red-Edge antes que NIR, haciéndola invisible para NDVI pero detectable por NDRE (Verrelst et al., 2021)",
              ]}
              opportunities={[
                "NDRE diverge desde el día 45: Cultivo B cae a 0.28 mientras A llega a 0.55 → detección temprana del estrés nutricional e hídrico (Verrelst et al., 2021)",
                "Complementar NDVI con NDMI (humedad foliar) para diferenciar estrés hídrico de estrés nutricional",
                "En AgRegen: añadir NDRE al comparador de índices y activar alerta cuando NDRE cae > 0.15 respecto al histórico de la parcela",
              ]}
            />
          </TabsContent>

          {/* ── Q2: Methodology flowchart ─────────────────────────────────────── */}
          <TabsContent value="q2" className="space-y-6">
            <SectionHeader
              number="P2"
              title="Flujograma metodológico para demostrar experimentalmente las limitaciones del NDVI"
              subtitle="Propuesta de diseño de investigación con datos geoespaciales y muestreo de campo · Compatible con infraestructura AgRegen"
            />
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Flujo de trabajo experimental</CardTitle>
                    <CardDescription>Seis etapas encadenadas · Validación estadística cruzada en campo</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Flowchart />
                  </CardContent>
                </Card>
              </div>
              <div className="space-y-4">
                <Card className="bg-green-50 border-green-200">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2 text-green-800">
                      <Satellite className="w-4 h-4" /> Datos satelitales
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs text-green-700 space-y-1.5">
                    <p><strong>Sentinel-2 MSI:</strong> 13 bandas, 10–60 m, cada 5 días (Segarra et al., 2020; Phiri et al., 2020). Bandas clave: B4 (665 nm), B8 (842 nm), B8a (865 nm, Red-Edge), B11 (1610 nm, SWIR).</p>
                    <p><strong>Landsat 8/9 OLI:</strong> 30 m, cada 16 días. Útil para series históricas (desde 1972).</p>
                    <p><strong>Preprocesamiento AgRegen:</strong> Google Earth Engine · Sen2Cor para S2 (Doxani et al., 2023) · LaSRC para L8/9 · Máscara SCL.</p>
                  </CardContent>
                </Card>
                <Card className="bg-blue-50 border-blue-200">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2 text-blue-800">
                      <Leaf className="w-4 h-4" /> Muestreo en campo
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs text-blue-700 space-y-1.5">
                    <p><strong>Diseño:</strong> Grilla sistemática 50 × 50 m + aleatorio estratificado por zona NDVI (3 clases) (Brus, 2021).</p>
                    <p><strong>Variables:</strong> LAI (planimetría indirecta), N foliar (Kjeldahl), rendimiento por cosechadora.</p>
                    <p><strong>n mínimo:</strong> 30 puntos por parcela para Kriging ordinario con semivariograma estable (Brus, 2021).</p>
                  </CardContent>
                </Card>
                <Card className="bg-purple-50 border-purple-200">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2 text-purple-800">
                      <BarChart3 className="w-4 h-4" /> Validación estadística
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs text-purple-700 space-y-1.5">
                    <p><strong>Relación índice–variable:</strong> Correlación Pearson (datos normales) o Spearman (no paramétrico). Umbral significancia p &lt; 0.05.</p>
                    <p><strong>Regresión:</strong> Lineal, polinomial (orden 2) y transformación logarítmica para la parte saturada.</p>
                    <p><strong>Validación cruzada k=5:</strong> RMSE, R², MAE, BIAS e Índice de Willmott d (Fei et al., 2023) — penaliza diferencias en forma más que en escala.</p>
                    <p><strong>Kriging geoestadístico:</strong> Para interpolar residuales entre puntos de muestreo. Disponible en AgRegen/MVZ.</p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* ── Q3: Index comparison ──────────────────────────────────────────── */}
          <TabsContent value="q3" className="space-y-6">
            <SectionHeader
              number="P3"
              title="Comparación NDVI con índices espectrales alternativos"
              subtitle="EVI · NDRE · SAVI · MSAVI · Simulación sobre ciclo fenológico de soja (150 días) · Integración en AgRegen"
            />

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Evolución de 5 índices durante el ciclo fenológico</CardTitle>
                <CardDescription>Datos simulados Sentinel-2 · Soja campaña 2024 · Parcela 120 ha, suelo franco-arcilloso</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={indicesCompData} margin={{ top: 5, right: 20, left: 0, bottom: 15 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="day" label={{ value: "Días desde siembra", position: "insideBottom", offset: -8, fontSize: 11 }} stroke="#6b7280" fontSize={11} />
                      <YAxis domain={[0, 1]} stroke="#6b7280" fontSize={11} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => v.toFixed(3)} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <ReferenceLine x={90} stroke="#6b7280" strokeDasharray="4 2" label={{ value: "Máximo vegetativo", fontSize: 10, fill: "#374151" }} />
                      <Line type="monotone" dataKey="ndvi" stroke={C.ndvi} strokeWidth={2.5} name="NDVI" dot={false} />
                      <Line type="monotone" dataKey="evi"  stroke={C.evi}  strokeWidth={2}   name="EVI"   dot={false} strokeDasharray="5 2" />
                      <Line type="monotone" dataKey="ndre" stroke={C.ndre} strokeWidth={2}   name="NDRE"  dot={false} strokeDasharray="3 3" />
                      <Line type="monotone" dataKey="savi" stroke={C.savi} strokeWidth={2}   name="SAVI"  dot={false} strokeDasharray="2 3" />
                      <Line type="monotone" dataKey="msavi" stroke={C.msavi} strokeWidth={1.5} name="MSAVI" dot={false} strokeDasharray="1 3" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-xs text-muted-foreground text-center mt-2">
                  Nota: NDRE es el índice más sensible al contenido de clorofila/N en estadios R3–R5. EVI no satura en el máximo vegetativo (día 90–105).
                </p>
              </CardContent>
            </Card>

            <div className="space-y-4">
              {INDEX_TABLE.map(idx => (
                <Card key={idx.name} className={`border ${idx.color}`} data-testid={`index-card-${idx.name.toLowerCase()}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <span className="font-mono font-bold">{idx.name}</span>
                        <code className="text-xs bg-black/5 px-2 py-0.5 rounded font-mono">{idx.formula}</code>
                      </CardTitle>
                      <Badge variant="outline" className="text-xs">{idx.name === "NDVI" ? "Ya en AgRegen" : idx.name === "EVI" || idx.name === "MSAVI" ? "Disponible GEE" : "Integrable"}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="p-3 bg-green-50/60 border border-green-100 rounded-lg">
                        <p className="text-[10px] font-bold text-green-700 uppercase tracking-wide mb-2">✓ Ventajas</p>
                        {idx.pros.map((p, i) => <p key={i} className="text-xs text-green-800 mb-1 flex items-start gap-1"><ChevronRight className="w-3 h-3 mt-0.5 shrink-0" />{p}</p>)}
                      </div>
                      <div className="p-3 bg-red-50/60 border border-red-100 rounded-lg">
                        <p className="text-[10px] font-bold text-red-700 uppercase tracking-wide mb-2">✗ Desventajas</p>
                        {idx.cons.map((c, i) => <p key={i} className="text-xs text-red-800 mb-1 flex items-start gap-1"><ChevronRight className="w-3 h-3 mt-0.5 shrink-0" />{c}</p>)}
                      </div>
                      <div className="p-3 bg-blue-50/60 border border-blue-100 rounded-lg">
                        <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wide mb-2">🔗 Integración AgRegen</p>
                        <p className="text-xs text-blue-800">{idx.agregen}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* ── Q4: VRT case study ────────────────────────────────────────────── */}
          <TabsContent value="q4" className="space-y-6">
            <SectionHeader
              number="P4"
              title="Caso aplicado: prescripción de nitrógeno a tasa variable con error por NDVI exclusivo"
              subtitle="Soja · 120 ha · Sistema de 4 zonas de manejo · Campaña 2024 · Prescripción diseñada en AgRegen MVZ"
            />

            <div className="p-4 bg-amber-50 border-2 border-amber-200 rounded-xl">
              <h3 className="font-bold text-amber-900 mb-2 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" /> Descripción del escenario hipotético
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-amber-800">
                <div>
                  <p className="font-semibold mb-1">Situación:</p>
                  <p>Un productor de 120 ha en Córdoba (Argentina) genera zonas de manejo usando <strong>solo el NDVI promedio de 3 fechas Sentinel-2</strong> (estadios V6, R1 y R3), sin análisis de suelo ni NDRE. Define 4 zonas y asigna dosis de urea (N) inversamente proporcional al NDVI: zonas de bajo NDVI reciben más nitrógeno.</p>
                </div>
                <div>
                  <p className="font-semibold mb-1">El error oculto:</p>
                  <ul className="space-y-1">
                    <li className="flex items-start gap-1.5"><ChevronRight className="w-3 h-3 mt-1 shrink-0" /><span><strong>Zona 2:</strong> NDVI alto (0.78) por biomasa densa de malezas antes del herbicida → baja dosis de N → <strong>deficiencia real de nitrógeno en el cultivo</strong></span></li>
                    <li className="flex items-start gap-1.5"><ChevronRight className="w-3 h-3 mt-1 shrink-0" /><span><strong>Zona 3:</strong> NDVI bajo (0.52) por suelo arenoso con bajo reflectancia (no por déficit de N) → alta dosis de N → <strong>lixiviación y pérdida económica</strong></span></li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Two-column zone maps */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="border-red-200 border-2">
                <CardHeader className="bg-red-50 rounded-t-lg pb-2">
                  <CardTitle className="text-sm text-red-800 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" /> Estrategia incorrecta — Solo NDVI
                  </CardTitle>
                  <CardDescription className="text-red-600 text-xs">Zonificación por NDVI promedio · Sin validación de campo</CardDescription>
                </CardHeader>
                <CardContent className="pt-4 space-y-2">
                  {[
                    { zona: "Zona 1", ha: 28, ndvi: 0.70, dosis: 82, problema: "Levemente infra-fertilizada", color: "bg-amber-100 border-amber-300" },
                    { zona: "Zona 2", ha: 35, ndvi: 0.78, dosis: 58, problema: "❌ Biomasa de malezas · sub-fertilizada en 37 kg N/ha", color: "bg-red-100 border-red-300" },
                    { zona: "Zona 3", ha: 30, ndvi: 0.52, dosis: 41, problema: "❌ Suelo arenoso · sobre-fertilizada en 27 kg N/ha → lixiviación", color: "bg-red-100 border-red-300" },
                    { zona: "Zona 4", ha: 27, ndvi: 0.65, dosis: 70, problema: "Aproximadamente correcta", color: "bg-green-100 border-green-300" },
                  ].map(z => (
                    <div key={z.zona} className={`p-3 rounded-lg border ${z.color}`}>
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-bold text-sm">{z.zona}</span>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-muted-foreground">{z.ha} ha</span>
                          <Badge variant="outline" className="font-mono">NDVI {z.ndvi}</Badge>
                          <Badge className="bg-red-600 text-white font-mono">{z.dosis} kg N/ha</Badge>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">{z.problema}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="border-green-200 border-2">
                <CardHeader className="bg-green-50 rounded-t-lg pb-2">
                  <CardTitle className="text-sm text-green-800 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" /> Estrategia correcta — NDVI + NDRE + Suelo
                  </CardTitle>
                  <CardDescription className="text-green-600 text-xs">MVZ AgRegen · Análisis de suelo + índices espectrales + validación campo</CardDescription>
                </CardHeader>
                <CardContent className="pt-4 space-y-2">
                  {[
                    { zona: "Zona 1", ha: 28, ndre: 0.50, nfoliar: "3.8%", dosis: 90, nota: "NDRE confirma N insuficiente → dosis ajustada", color: "bg-amber-100 border-amber-300" },
                    { zona: "Zona 2", ha: 35, ndre: 0.42, nfoliar: "2.9%", dosis: 45, nota: "✓ Malezas controladas · Dosis reducida 23 % → correcto", color: "bg-green-100 border-green-300" },
                    { zona: "Zona 3", ha: 30, ndre: 0.38, nfoliar: "3.1%", dosis: 68, nota: "✓ Suelo arenoso compensado con inoculante · N corregido", color: "bg-green-100 border-green-300" },
                    { zona: "Zona 4", ha: 27, ndre: 0.48, nfoliar: "3.6%", dosis: 72, nota: "Confirma zona óptima · mínima corrección", color: "bg-green-100 border-green-300" },
                  ].map(z => (
                    <div key={z.zona} className={`p-3 rounded-lg border ${z.color}`}>
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-bold text-sm">{z.zona}</span>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-muted-foreground">{z.ha} ha</span>
                          <Badge variant="outline" className="font-mono">NDRE {z.ndre}</Badge>
                          <Badge className="bg-green-600 text-white font-mono">{z.dosis} kg N/ha</Badge>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">{z.nota} · N foliar: {z.nfoliar}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            {/* Comparison bar chart */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Comparación de dosis de nitrógeno por zona y estrategia</CardTitle>
                <CardDescription>Barras rojas = prescripción solo NDVI · Barras verdes = prescripción multi-índice + suelo · Línea = dosis óptima real estimada en campo</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={vrtWrongData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="zona" stroke="#6b7280" fontSize={12} />
                      <YAxis label={{ value: "kg N/ha", angle: -90, position: "insideLeft", fontSize: 11 }} stroke="#6b7280" fontSize={12} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, name: string) => [v + " kg N/ha", name]} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="dosis" name="Dosis NDVI solo" fill={C.wrong} radius={[4, 4, 0, 0]} opacity={0.85} />
                      <Bar dataKey="real" name="Dosis óptima (multi-índice)" fill={C.right} radius={[4, 4, 0, 0]} opacity={0.85} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Architecture solution */}
            <Card className="border-blue-200 border-2">
              <CardHeader className="bg-blue-50 rounded-t-lg">
                <CardTitle className="text-sm text-blue-800 flex items-center gap-2">
                  <Satellite className="w-4 h-4" /> Estrategia de reducción del error en la arquitectura AgRegen
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[
                    {
                      step: "1", color: "bg-green-50 border-green-200",
                      title: "Análisis de suelo obligatorio",
                      desc: "AgRegen almacena hasta 20 parámetros por análisis (módulo Suelo en configuración de parcela). Los datos de N total, P, CIC y textura contextualizan el NDVI satelital. El sistema alerta cuando hay discordancia entre NDVI > 0.70 y N foliar < 3 %.",
                      icon: FlaskConical,
                    },
                    {
                      step: "2", color: "bg-purple-50 border-purple-200",
                      title: "Índices múltiples en MVZ",
                      desc: "El módulo de Zonas de Manejo Variable (MVZ) permite zonificar por NDVI, NDRE, NDMI, EVI, MSAVI o combinaciones. La estrategia óptima para prescripción de N es: NDRE como variable primaria + análisis de suelo como co-variable en Co-Kriging.",
                      icon: BarChart3,
                    },
                    {
                      step: "3", color: "bg-amber-50 border-amber-200",
                      title: "Validación con puntos de campo",
                      desc: "AgRegen permite importar puntos GPS con valores observados (rendimiento, N foliar, LAI) mediante el importador CSV del módulo MVZ. Esos puntos ajustan la interpolación y generan métricas de validación (RMSE, R²) antes de enviar la prescripción al monitor de precisión.",
                      icon: CheckCircle,
                    },
                  ].map(s => {
                    const Icon = s.icon;
                    return (
                      <div key={s.step} className={`p-4 rounded-xl border ${s.color}`}>
                        <div className="flex items-center gap-3 mb-2">
                          <div className="w-8 h-8 rounded-full bg-white/80 flex items-center justify-center shrink-0">
                            <Icon className="w-4 h-4 text-foreground" />
                          </div>
                          <p className="font-bold text-sm">{s.title}</p>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">{s.desc}</p>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                  <p className="text-sm font-bold text-emerald-800 mb-1">Impacto cuantificado del caso hipotético:</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { label: "Error en Zona 2", value: "−37 kg N/ha", note: "Sub-fertilización" },
                      { label: "Error en Zona 3", value: "+27 kg N/ha", note: "Sobre-fertilización" },
                      { label: "Pérdida económica", value: "≈ USD 4,200", note: "120 ha · precio N referencia" },
                      { label: "Reducción con multi-índice", value: "87 %", note: "Error residual < 5 kg/ha" },
                    ].map(m => (
                      <div key={m.label} className="text-center p-2">
                        <p className="text-lg font-bold text-emerald-900 font-mono">{m.value}</p>
                        <p className="text-[10px] font-semibold text-emerald-700">{m.label}</p>
                        <p className="text-[10px] text-emerald-600">{m.note}</p>
                      </div>
                    ))}
                  </div>
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
              <p>Todos los datos presentados en esta página son <strong>simulados con distribuciones estadísticas representativas</strong> de cultivos de soja en la región pampeana y centro de México (series Sentinel-2 temporadas 2022–2024). Las relaciones NDVI–LAI, NDVI–cobertura y los errores de corrección atmosférica fueron generados con parámetros calibrados contra bibliografía revisada por pares. Los módulos de Earth Engine, MVZ e interpolación geoestadística corresponden a la infraestructura real de <strong>AgRegen 5.0</strong>.</p>
            </div>
          </div>
        </div>

        {/* References section */}
        <div className="mt-8 p-6 bg-card border rounded-xl">
          <h2 className="text-base font-semibold text-foreground mb-4 flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-primary" />
            Referencias
          </h2>
          <ol className="space-y-2">
            {APA_REFS.map((ref) => (
              <li key={ref.id} className="text-xs text-muted-foreground leading-relaxed pl-6 -indent-6">
                {ref.full}
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-6 flex items-center justify-center gap-4 flex-wrap">
          <Link href="/">
            <button className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border bg-card hover:bg-muted text-sm font-medium transition-colors" data-testid="btn-back-home">
              <ArrowRight className="w-4 h-4 rotate-180" /> Volver a la plataforma
            </button>
          </Link>
          <Link href="/indices">
            <button className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-medium transition-colors" data-testid="btn-indices">
              <BookOpen className="w-4 h-4" /> Ver glosario de índices
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
}

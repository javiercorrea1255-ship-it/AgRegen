/**
 * Cultivos — datos versionados (Fase 3 SEO).
 *
 * Sólo se publican cultivos que tienen una curva NDVI ideal real en el
 * dataset de la app (`client/src/lib/ideal-ndvi-curves.ts`). En este
 * lanzamiento son 4: Soja, Maíz, Trigo, Girasol.
 *
 * Cada cultivo tiene:
 *  - slug estable y nombre por idioma.
 *  - Ficha editorial corta (origen, ciclo, suelo ideal, prácticas
 *    regenerativas asociadas) revisable por humanos — NO autogenerada.
 *  - Curva NDVI importada desde el dataset compartido del cliente. Si la
 *    curva real cambia, esta página refleja el cambio sin tocar dos sitios.
 *  - Etapas con índices satelitales recomendados por etapa y consejos
 *    breves cuando NDVI/NDMI están por debajo o por encima del rango.
 *  - Slug del término del glosario relacionado.
 *
 * Idiomas: este lanzamiento publica `es` y `en`. Para `pt`/`zh` el
 * renderer cae a español y aplica `noindex`.
 */

import { CROP_CURVES, type CropCurve, type PhenologicalStage } from "../../client/src/lib/ideal-ndvi-curves";

export type CropLocale = "es" | "en" | "pt" | "zh";

export interface CropStageEditorial {
  /** Slug normalizado del nombre de la etapa, ej. "germinacion". */
  slug: string;
  /** Nombre tal como aparece en CROP_CURVES (es). */
  sourceName: string;
  /** Nombre por idioma. Falta de traducción → fallback es. */
  name: Partial<Record<CropLocale, string>>;
  /** Índices recomendados (slugs de SATELLITE_INDICES) por orden de utilidad. */
  recommendedIndices: string[];
  /** Qué hacer si el NDVI medido cae por debajo de la curva. */
  ifBelow: Partial<Record<CropLocale, string>>;
  /** Qué hacer si el NDVI medido supera ampliamente la curva. */
  ifAbove: Partial<Record<CropLocale, string>>;
  /** Lo que es esperable agronómicamente en esta etapa. */
  expectation: Partial<Record<CropLocale, string>>;
}

export interface CropEditorial {
  /** Slug url-safe, ej. "soja". */
  slug: string;
  /** Clave en CROP_CURVES, ej. "Soja". */
  curveKey: string;
  /** Nombre del cultivo por idioma. */
  name: Partial<Record<CropLocale, string>>;
  /** Nombre científico (Genus species). */
  scientificName: string;
  /** Origen geográfico/botánico. */
  origin: Partial<Record<CropLocale, string>>;
  /** Tipo de suelo ideal. */
  idealSoil: Partial<Record<CropLocale, string>>;
  /** Resumen agronómico breve (2 párrafos). */
  summary: Partial<Record<CropLocale, string>>;
  /** Prácticas regenerativas que mejoran el desempeño del cultivo. */
  regenerativePractices: Partial<Record<CropLocale, string[]>>;
  /** Slug del término del glosario relacionado. */
  relatedGlossary: string;
  /** Etapas editorializadas (alineadas 1-a-1 con CROP_CURVES.stages). */
  stages: CropStageEditorial[];
  /** Fecha de última edición del contenido editorial. */
  dateUpdated: string;
}

/** Convierte "Crecimiento Vegetativo" → "crecimiento-vegetativo". */
export function slugifyStage(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const SOJA_STAGES: CropStageEditorial[] = [
  {
    slug: "germinacion",
    sourceName: "Germinación",
    name: { es: "Germinación", en: "Germination" },
    recommendedIndices: ["bsi", "ndmi"],
    expectation: {
      es: "NDVI muy bajo (0.10–0.20). El suelo aún domina la señal y el BSI muestra cobertura escasa. Lo importante es la humedad superficial (NDMI) y la temperatura del suelo.",
      en: "Very low NDVI (0.10–0.20). Soil still dominates the signal and BSI shows scant cover. What matters is surface moisture (NDMI) and soil temperature.",
    },
    ifBelow: {
      es: "Verificá emergencia en campo: si la implantación falló por falta de humedad, NDVI no va a subir aunque la curva ideal lo prediga.",
      en: "Field-check emergence: if establishment failed due to low moisture, NDVI will not rise even if the ideal curve predicts it.",
    },
    ifAbove: {
      es: "Probable maleza pre-emergente compitiendo. Inspeccioná visualmente antes de asumir un buen stand.",
      en: "Likely pre-emergent weeds competing. Inspect visually before assuming a good stand.",
    },
  },
  {
    slug: "crecimiento-vegetativo",
    sourceName: "Crecimiento Vegetativo",
    name: { es: "Crecimiento vegetativo", en: "Vegetative growth" },
    recommendedIndices: ["ndvi", "ndre", "ndmi"],
    expectation: {
      es: "NDVI sube de 0.20 a 0.60 a medida que se cierra el surco. NDRE empieza a discriminar bien deficiencias de nitrógeno cuando la canopia se densifica.",
      en: "NDVI climbs from 0.20 to 0.60 as the row closes. NDRE starts to discriminate nitrogen deficiencies well once canopy thickens.",
    },
    ifBelow: {
      es: "Probables zonas con compactación, deficiencias de fósforo o estrés hídrico. Generá un mapa de zonas variables y muestrea las de NDVI bajo.",
      en: "Likely zones with compaction, phosphorus deficiency or water stress. Build a variable-zone map and sample the low-NDVI ones.",
    },
    ifAbove: {
      es: "Cierre de surco más rápido que la curva: usualmente bueno, pero validá con NDMI que no esté ocultando estrés hídrico latente.",
      en: "Row closes faster than curve: usually good, but check NDMI is not masking latent water stress.",
    },
  },
  {
    slug: "floracion",
    sourceName: "Floración",
    name: { es: "Floración", en: "Flowering" },
    recommendedIndices: ["ndvi", "ndmi", "evi"],
    expectation: {
      es: "Pico de NDVI (0.60–0.85). Etapa crítica para rinde: el déficit hídrico aquí cuesta vainas. NDMI debe mantenerse en valores positivos.",
      en: "NDVI peak (0.60–0.85). Critical yield-defining stage: water deficit here costs pods. NDMI should stay positive.",
    },
    ifBelow: {
      es: "Si NDVI no llegó al pico, la planta no llenó canopia: revisar fertilidad y balance hídrico antes de R3.",
      en: "If NDVI did not reach the peak, the plant did not fill canopy: check fertility and water balance before R3.",
    },
    ifAbove: {
      es: "Una canopia muy densa puede esconder enfermedades fúngicas en el bajo dosel; monitoreá vuelco y humedad.",
      en: "A very dense canopy can hide fungal disease in the lower canopy; monitor lodging and humidity.",
    },
  },
  {
    slug: "llenado-de-grano",
    sourceName: "Llenado de Grano",
    name: { es: "Llenado de grano", en: "Grain filling" },
    recommendedIndices: ["ndmi", "ndvi"],
    expectation: {
      es: "NDVI desciende lentamente (0.85 → 0.70). NDMI es el índice clave: si cae bruscamente, hay estrés hídrico que recorta peso de mil granos.",
      en: "NDVI slowly drops (0.85 → 0.70). NDMI is the key index: a sharp drop signals water stress that cuts thousand-grain weight.",
    },
    ifBelow: {
      es: "Caída temprana = senescencia adelantada por estrés. Si hay riego disponible, evaluá una lámina; si no, ajustá expectativas de rinde.",
      en: "Early drop = stress-driven early senescence. If irrigation is available, evaluate a pass; otherwise, adjust yield expectations.",
    },
    ifAbove: {
      es: "Demora en senescencia: chequeá heladas o exceso hídrico. Una soja que no senesce a tiempo dificulta cosecha.",
      en: "Delayed senescence: check for frost or waterlogging. A soybean that does not senesce on time complicates harvest.",
    },
  },
  {
    slug: "madurez",
    sourceName: "Madurez",
    name: { es: "Madurez", en: "Maturity" },
    recommendedIndices: ["ndvi", "bsi"],
    expectation: {
      es: "NDVI cae de 0.70 a 0.30. Es el momento para programar logística de cosecha y ya empezar a planificar cobertura post-cosecha (BSI subirá).",
      en: "NDVI falls from 0.70 to 0.30. Time to schedule harvest logistics and plan post-harvest cover (BSI will rise).",
    },
    ifBelow: {
      es: "Senescencia muy adelantada: probable enfermedad o estrés terminal. Documentá para la rotación siguiente.",
      en: "Very early senescence: likely disease or terminal stress. Document for next rotation.",
    },
    ifAbove: {
      es: "Si no senesce, posiblemente hay rebrote o malezas de fin de ciclo: evaluar antes de cosechar.",
      en: "If it does not senesce, regrowth or late weeds are likely: evaluate before harvest.",
    },
  },
];

const MAIZ_STAGES: CropStageEditorial[] = [
  {
    slug: "germinacion",
    sourceName: "Germinación",
    name: { es: "Germinación", en: "Germination" },
    recommendedIndices: ["bsi", "ndmi"],
    expectation: {
      es: "NDVI bajo (0.10–0.20). Lo crítico es la temperatura y humedad del suelo a 5 cm; un BSI alto y persistente indica suelo desnudo prolongado.",
      en: "Low NDVI (0.10–0.20). Critical: soil temperature and moisture at 5 cm; persistent high BSI indicates prolonged bare soil.",
    },
    ifBelow: {
      es: "Si hubo siembra y NDVI no responde en 10 días, la implantación falló — re-sembrar o ajustar densidad antes de V4.",
      en: "If sowing was done and NDVI does not respond within 10 days, establishment failed — replant or adjust density before V4.",
    },
    ifAbove: {
      es: "Maleza de pre-emergencia compitiendo. Confirmá visualmente antes de asumir buena emergencia.",
      en: "Pre-emergent weeds competing. Confirm visually before assuming good emergence.",
    },
  },
  {
    slug: "crecimiento-vegetativo",
    sourceName: "Crecimiento Vegetativo",
    name: { es: "Crecimiento vegetativo (V4–V12)", en: "Vegetative growth (V4–V12)" },
    recommendedIndices: ["ndvi", "ndre", "ndmi"],
    expectation: {
      es: "NDVI sube fuerte de 0.20 a 0.70. NDRE detecta deficiencias de N temprano; clave para decidir refertilizaciones variables (zonas).",
      en: "NDVI rises strongly from 0.20 to 0.70. NDRE detects N deficiencies early; key for variable-rate refertilization (zones).",
    },
    ifBelow: {
      es: "Posible déficit de nitrógeno o compactación. Generá zonas con MVZ y muestreá las de menor NDVI antes de V8.",
      en: "Possible nitrogen deficit or compaction. Build VRA zones and sample the low-NDVI ones before V8.",
    },
    ifAbove: {
      es: "Cierre de canopia más rápido: usualmente buena performance, pero validá NDMI para descartar estrés hídrico oculto.",
      en: "Faster canopy closure: usually good performance, but check NDMI to rule out hidden water stress.",
    },
  },
  {
    slug: "floracion",
    sourceName: "Floración",
    name: { es: "Floración (VT–R1)", en: "Flowering (VT–R1)" },
    recommendedIndices: ["ndvi", "ndmi", "evi"],
    expectation: {
      es: "Pico de NDVI (0.70–0.90). Etapa más sensible al estrés hídrico — un déficit aquí define rinde irreversiblemente.",
      en: "NDVI peak (0.70–0.90). Most water-stress-sensitive stage — a deficit here defines yield irreversibly.",
    },
    ifBelow: {
      es: "Si NDVI no alcanzó el pico, hubo limitación severa antes. Documentá y considerá baja en proyección de rinde.",
      en: "If NDVI did not reach peak, there was severe earlier limitation. Document and lower yield projection.",
    },
    ifAbove: {
      es: "Canopias muy densas pueden generar microclimas húmedos favorables a hongos: monitoreá foliar.",
      en: "Very dense canopies can generate humid microclimates favoring fungi: monitor foliar disease.",
    },
  },
  {
    slug: "llenado-de-grano",
    sourceName: "Llenado de Grano",
    name: { es: "Llenado de grano (R2–R5)", en: "Grain filling (R2–R5)" },
    recommendedIndices: ["ndmi", "ndvi"],
    expectation: {
      es: "NDVI baja gradual (0.90 → 0.65). NDMI es el termómetro de la disponibilidad hídrica; caídas bruscas anticipan pérdida de PMG.",
      en: "NDVI gradually drops (0.90 → 0.65). NDMI is the water-availability thermometer; sharp drops foreshadow TGW loss.",
    },
    ifBelow: {
      es: "Senescencia adelantada por estrés. En cultivos con riego, programar lámina; en secano, ajustar pronóstico.",
      en: "Stress-driven early senescence. In irrigated crops, schedule a pass; in rainfed, adjust forecast.",
    },
    ifAbove: {
      es: "Demora en madurez fisiológica: revisar excesos hídricos y heladas tardías.",
      en: "Delayed physiological maturity: check waterlogging and late frosts.",
    },
  },
  {
    slug: "madurez",
    sourceName: "Madurez",
    name: { es: "Madurez (R6)", en: "Maturity (R6)" },
    recommendedIndices: ["ndvi", "bsi"],
    expectation: {
      es: "NDVI desciende a 0.25–0.30. Programá cosecha y empezá a pensar la cobertura post-cosecha (BSI marcará suelo desnudo).",
      en: "NDVI descends to 0.25–0.30. Schedule harvest and start planning post-harvest cover (BSI will flag bare soil).",
    },
    ifBelow: {
      es: "Senescencia muy precoz indica problemas terminales — documentar para diagnóstico de la rotación.",
      en: "Very early senescence signals terminal problems — document for rotation diagnosis.",
    },
    ifAbove: {
      es: "Si no madura: humedad excesiva o variedad fuera de zona. Validá fecha de siembra.",
      en: "If it does not ripen: excess moisture or variety out of zone. Validate sowing date.",
    },
  },
];

const TRIGO_STAGES: CropStageEditorial[] = [
  {
    slug: "germinacion",
    sourceName: "Germinación",
    name: { es: "Germinación", en: "Germination" },
    recommendedIndices: ["bsi", "ndmi"],
    expectation: {
      es: "NDVI muy bajo (0.10–0.25). Suelo desnudo dominante; chequeá NDMI para humedad de implantación.",
      en: "Very low NDVI (0.10–0.25). Bare soil dominant; check NDMI for establishment moisture.",
    },
    ifBelow: { es: "Implantación fallida: re-sembrar o ajustar densidad.", en: "Failed establishment: replant or adjust density." },
    ifAbove: { es: "Maleza compitiendo en pre-emergencia.", en: "Pre-emergent weeds competing." },
  },
  {
    slug: "macollaje",
    sourceName: "Macollaje",
    name: { es: "Macollaje", en: "Tillering" },
    recommendedIndices: ["ndvi", "ndre"],
    expectation: {
      es: "NDVI sube de 0.25 a 0.55. La cantidad de macollos define potencial de espigas/m². NDRE empieza a ser útil para nitrógeno.",
      en: "NDVI rises from 0.25 to 0.55. Tiller count defines potential ears/m². NDRE starts to be useful for nitrogen.",
    },
    ifBelow: {
      es: "Bajo macollaje: refertilización con N temprana puede recuperar densidad de espigas.",
      en: "Low tillering: early N refertilization can recover ear density.",
    },
    ifAbove: {
      es: "Macollaje excesivo: controlar exceso de N para evitar vuelco.",
      en: "Excessive tillering: control N excess to avoid lodging.",
    },
  },
  {
    slug: "encanado",
    sourceName: "Encañado",
    name: { es: "Encañado", en: "Stem elongation" },
    recommendedIndices: ["ndvi", "ndre", "ndmi"],
    expectation: {
      es: "NDVI sube de 0.55 a 0.80. Etapa clave para definir número de granos por espiga; déficits aquí son costosos.",
      en: "NDVI rises from 0.55 to 0.80. Key stage to define grains per ear; deficits here are costly.",
    },
    ifBelow: { es: "Estrés hídrico o nutricional: actuar antes de hoja bandera.", en: "Water or nutrient stress: act before flag leaf." },
    ifAbove: { es: "Riesgo de vuelco por exceso de canopia en variedades altas.", en: "Lodging risk from excess canopy in tall varieties." },
  },
  {
    slug: "espigado",
    sourceName: "Espigado",
    name: { es: "Espigado", en: "Heading" },
    recommendedIndices: ["ndvi", "ndmi"],
    expectation: {
      es: "Pico de NDVI (0.80–0.85). Etapa más sensible a estrés hídrico y a fusarium si la humedad es alta.",
      en: "NDVI peak (0.80–0.85). Most sensitive to water stress and to fusarium if humidity is high.",
    },
    ifBelow: { es: "No alcanzó el pico: limitación severa anterior. Ajustar pronóstico.", en: "Did not reach peak: severe earlier limitation. Adjust forecast." },
    ifAbove: { es: "Canopias muy densas + humedad: alto riesgo de fusarium.", en: "Very dense canopies + humidity: high fusarium risk." },
  },
  {
    slug: "llenado-de-grano",
    sourceName: "Llenado de Grano",
    name: { es: "Llenado de grano", en: "Grain filling" },
    recommendedIndices: ["ndmi", "ndvi"],
    expectation: {
      es: "NDVI baja (0.85 → 0.50). NDMI sigue siendo crítico — el peso del grano se define ahora.",
      en: "NDVI drops (0.85 → 0.50). NDMI remains critical — grain weight is defined now.",
    },
    ifBelow: { es: "Senescencia adelantada por estrés terminal.", en: "Stress-driven early senescence." },
    ifAbove: { es: "Demora: revisar heladas tardías o exceso hídrico.", en: "Delay: check late frosts or waterlogging." },
  },
  {
    slug: "madurez",
    sourceName: "Madurez",
    name: { es: "Madurez", en: "Maturity" },
    recommendedIndices: ["ndvi", "bsi"],
    expectation: {
      es: "NDVI cae a 0.20. Programar cosecha; planificar cobertura post-cosecha para no exponer suelo (BSI).",
      en: "NDVI falls to 0.20. Schedule harvest; plan post-harvest cover to avoid exposing soil (BSI).",
    },
    ifBelow: { es: "Madurez muy adelantada: documentar problemas terminales.", en: "Very early maturity: document terminal problems." },
    ifAbove: { es: "Si no madura: rebrote, malezas o exceso hídrico.", en: "If it does not ripen: regrowth, weeds or waterlogging." },
  },
];

const GIRASOL_STAGES: CropStageEditorial[] = [
  {
    slug: "germinacion",
    sourceName: "Germinación",
    name: { es: "Germinación", en: "Germination" },
    recommendedIndices: ["bsi", "ndmi"],
    expectation: {
      es: "NDVI muy bajo (0.10–0.20). Implantación dependiente de humedad; girasol germina mejor con suelo a 8–10 °C.",
      en: "Very low NDVI (0.10–0.20). Establishment depends on moisture; sunflower germinates best with soil at 8–10 °C.",
    },
    ifBelow: { es: "Re-sembrar si no hay emergencia en 10–12 días.", en: "Replant if no emergence within 10–12 days." },
    ifAbove: { es: "Maleza de pre-emergencia compitiendo.", en: "Pre-emergent weeds competing." },
  },
  {
    slug: "crecimiento-vegetativo",
    sourceName: "Crecimiento Vegetativo",
    name: { es: "Crecimiento vegetativo", en: "Vegetative growth" },
    recommendedIndices: ["ndvi", "ndre", "ndmi"],
    expectation: {
      es: "NDVI sube de 0.20 a 0.70. La canopia cubre rápido por hojas grandes; NDRE útil para diagnóstico de N.",
      en: "NDVI rises from 0.20 to 0.70. Canopy covers fast due to large leaves; NDRE useful for N diagnosis.",
    },
    ifBelow: { es: "Posible déficit de N o compactación; muestreo dirigido.", en: "Possible N deficit or compaction; targeted sampling." },
    ifAbove: { es: "Cierre rápido — verificar NDMI para descartar estrés hídrico.", en: "Fast closure — check NDMI to rule out water stress." },
  },
  {
    slug: "floracion",
    sourceName: "Floración",
    name: { es: "Floración (R5)", en: "Flowering (R5)" },
    recommendedIndices: ["ndvi", "ndmi", "evi"],
    expectation: {
      es: "Pico de NDVI (0.70–0.85). Etapa crítica: estrés hídrico o térmico aquí define peso del aquenio.",
      en: "NDVI peak (0.70–0.85). Critical stage: water or thermal stress here defines achene weight.",
    },
    ifBelow: { es: "Si no alcanzó el pico, hubo limitación severa previa.", en: "If peak not reached, severe earlier limitation." },
    ifAbove: { es: "Canopias densas: vigilar enfermedades de capítulo.", en: "Dense canopies: monitor head diseases." },
  },
  {
    slug: "llenado-de-grano",
    sourceName: "Llenado de Grano",
    name: { es: "Llenado de aquenio", en: "Achene filling" },
    recommendedIndices: ["ndmi", "ndvi"],
    expectation: {
      es: "NDVI baja (0.85 → 0.55). NDMI es el indicador clave del estrés hídrico final.",
      en: "NDVI drops (0.85 → 0.55). NDMI is the key indicator of final water stress.",
    },
    ifBelow: { es: "Senescencia adelantada — pérdida de peso de aquenio.", en: "Early senescence — achene weight loss." },
    ifAbove: { es: "Demora — revisar heladas o saturación.", en: "Delay — check frost or saturation." },
  },
  {
    slug: "madurez",
    sourceName: "Madurez (R9)",
    name: { es: "Madurez (R9)", en: "Maturity (R9)" },
    recommendedIndices: ["ndvi", "bsi"],
    expectation: {
      es: "NDVI cae a 0.20. Programar cosecha; planificar cobertura post-cosecha (BSI).",
      en: "NDVI falls to 0.20. Schedule harvest; plan post-harvest cover (BSI).",
    },
    ifBelow: { es: "Senescencia muy precoz: problemas terminales.", en: "Very early senescence: terminal problems." },
    ifAbove: { es: "Si no senesce: humedad excesiva o variedad fuera de zona.", en: "If it does not senesce: excess moisture or out-of-zone variety." },
  },
];

export const CROPS: CropEditorial[] = [
  {
    slug: "soja",
    curveKey: "Soja",
    name: { es: "Soja", en: "Soybean" },
    scientificName: "Glycine max",
    origin: {
      es: "Originaria de Asia oriental (China, Japón). Domesticada hace más de 5.000 años.",
      en: "Native to East Asia (China, Japan). Domesticated more than 5,000 years ago.",
    },
    idealSoil: {
      es: "Suelos francos a franco-arcillosos, pH 6.0–7.0, buen drenaje y nodulación activa de Bradyrhizobium japonicum.",
      en: "Loam to clay-loam soils, pH 6.0–7.0, good drainage and active Bradyrhizobium japonicum nodulation.",
    },
    summary: {
      es: "La soja es una leguminosa C3 de ciclo corto-medio (~120 días) que aporta nitrógeno biológico al sistema. Bien manejada, deja el suelo en mejor estado del que lo encontró: residuos de descomposición rápida y N residual disponible para el cultivo siguiente.\n\nDesde satélite es uno de los cultivos más fáciles de seguir: la curva NDVI tiene un pico claro en floración (R1–R3) y desciende ordenadamente durante el llenado. Los desvíos respecto a esa curva ideal anticipan rinde con bastante precisión.",
      en: "Soybean is a short-to-mid cycle (~120 days) C3 legume that contributes biological nitrogen to the system. Well managed, it leaves the soil better than it found it: fast-decomposing residues and residual N available for the next crop.\n\nFrom satellite it is one of the easiest crops to track: the NDVI curve has a clear peak at flowering (R1–R3) and drops cleanly during grain filling. Deviations from that ideal curve forecast yield fairly precisely.",
    },
    regenerativePractices: {
      es: [
        "Siembra directa sobre cobertura de gramínea (centeno, avena) para no dejar suelo desnudo invernal",
        "Inoculación con cepas frescas de Bradyrhizobium para maximizar nodulación",
        "Rotación obligatoria con maíz o trigo para romper ciclos de patógenos del suelo",
        "Cobertura post-cosecha — aprovechar el N residual con un cultivo de servicio",
      ],
      en: [
        "No-till sowing on grass cover (rye, oats) to avoid bare winter soil",
        "Inoculation with fresh Bradyrhizobium strains to maximize nodulation",
        "Mandatory rotation with maize or wheat to break soil-borne pathogen cycles",
        "Post-harvest cover — capture residual N with a service crop",
      ],
    },
    relatedGlossary: "rotacion-cultivos",
    stages: SOJA_STAGES,
    dateUpdated: "2026-04-18",
  },
  {
    slug: "maiz",
    curveKey: "Maíz",
    name: { es: "Maíz", en: "Maize" },
    scientificName: "Zea mays",
    origin: {
      es: "Domesticado en Mesoamérica (México) hace ~9.000 años a partir del teosinte.",
      en: "Domesticated in Mesoamerica (Mexico) ~9,000 years ago from teosinte.",
    },
    idealSoil: {
      es: "Suelos profundos, francos, pH 5.8–7.0, alta capacidad de retención hídrica y mineralización activa de N.",
      en: "Deep, loamy soils, pH 5.8–7.0, high water-holding capacity and active N mineralization.",
    },
    summary: {
      es: "El maíz es un C4 de alta demanda hídrica y nitrogenada que en condiciones óptimas alcanza los rindes más altos por hectárea de los cultivos extensivos. Su ventana crítica está en floración (VT–R1): un déficit hídrico de 5 días aquí puede costar 30 % del rinde.\n\nLa curva NDVI ideal es muy informativa para este cultivo. NDRE es especialmente valioso entre V6 y V12 para detectar deficiencias de N a tiempo y ajustar refertilización por zonas.",
      en: "Maize is a C4 with high water and nitrogen demand that under optimal conditions achieves the highest per-hectare yields among extensive crops. Its critical window is at flowering (VT–R1): a 5-day water deficit here can cost 30% of yield.\n\nThe ideal NDVI curve is very informative for this crop. NDRE is especially valuable between V6 and V12 to detect N deficiencies in time and adjust zone-based refertilization.",
    },
    regenerativePractices: {
      es: [
        "Cultivos de servicio invernales con vicia + centeno para fijar N y proteger suelo",
        "Refertilización variable usando zonas NDRE en V6–V8",
        "Maíz de baja densidad en zonas de menor productividad para evitar competencia",
        "Rotación con leguminosa (soja, vicia) para reducir dependencia de N sintético",
      ],
      en: [
        "Winter service crops with vetch + rye to fix N and protect soil",
        "Variable refertilization using NDRE zones at V6–V8",
        "Low-density maize in lower-productivity zones to avoid competition",
        "Rotation with legume (soy, vetch) to reduce synthetic N dependency",
      ],
    },
    relatedGlossary: "rotacion-cultivos",
    stages: MAIZ_STAGES,
    dateUpdated: "2026-04-18",
  },
  {
    slug: "trigo",
    curveKey: "Trigo",
    name: { es: "Trigo", en: "Wheat" },
    scientificName: "Triticum aestivum",
    origin: {
      es: "Originario del Creciente Fértil (Medio Oriente). Domesticado hace ~10.000 años.",
      en: "Native to the Fertile Crescent (Middle East). Domesticated ~10,000 years ago.",
    },
    idealSoil: {
      es: "Suelos profundos, francos a franco-arcillosos, pH 6.0–7.5, buena estructura para enraizamiento profundo.",
      en: "Deep, loam to clay-loam soils, pH 6.0–7.5, good structure for deep rooting.",
    },
    summary: {
      es: "El trigo es un cereal C3 de invierno-primavera con un ciclo de ~150 días en regiones templadas. Su rinde se construye en tres etapas clave: macollaje (define espigas/m²), encañado (granos/espiga) y llenado (peso del grano).\n\nDesde satélite, las desviaciones de la curva NDVI en cada una de esas ventanas predicen pérdidas específicas: poco macollaje = poca espiga; bajo NDVI en encañado = pocos granos; caída brusca en llenado = bajo PMG. NDRE en macollaje guía la decisión de N.",
      en: "Wheat is a C3 winter-spring cereal with a ~150-day cycle in temperate regions. Its yield is built in three key stages: tillering (defines ears/m²), stem elongation (grains/ear) and filling (grain weight).\n\nFrom satellite, deviations from the NDVI curve in each of those windows predict specific losses: low tillering = few ears; low NDVI at elongation = few grains; sharp drop at filling = low TGW. NDRE at tillering guides the N decision.",
    },
    regenerativePractices: {
      es: [
        "Siembra directa sobre rastrojo de cultivo de verano para conservar humedad",
        "Refertilización variable de N usando zonas NDRE en macollaje",
        "Rotación con leguminosa de cobertura (vicia) para reducir N sintético",
        "Cosecha con plataforma de stripper para dejar más rastrojo en pie",
      ],
      en: [
        "No-till sowing on summer-crop stubble to conserve moisture",
        "Variable N refertilization using NDRE zones at tillering",
        "Rotation with cover legume (vetch) to reduce synthetic N",
        "Stripper-header harvest to leave more standing stubble",
      ],
    },
    relatedGlossary: "rotacion-cultivos",
    stages: TRIGO_STAGES,
    dateUpdated: "2026-04-18",
  },
  {
    slug: "girasol",
    curveKey: "Girasol",
    name: { es: "Girasol", en: "Sunflower" },
    scientificName: "Helianthus annuus",
    origin: {
      es: "Originario de América del Norte. Domesticado por pueblos originarios hace ~5.000 años.",
      en: "Native to North America. Domesticated by indigenous peoples ~5,000 years ago.",
    },
    idealSoil: {
      es: "Suelos profundos, bien drenados, pH 6.0–7.5. Tolera suelos pobres mejor que maíz, pero no encharcamientos.",
      en: "Deep, well-drained soils, pH 6.0–7.5. Tolerates poor soils better than maize, but not waterlogging.",
    },
    summary: {
      es: "El girasol es un cultivo C3 con sistema radicular profundo capaz de explorar agua y nutrientes que otros cultivos no alcanzan. Su ciclo de ~130 días lo hace versátil para ventanas tardías.\n\nLa curva NDVI tiene un pico ancho en floración (R5) y un descenso rápido durante el llenado del aquenio. NDMI es particularmente útil porque el girasol mantiene un consumo hídrico alto incluso bajo estrés moderado.",
      en: "Sunflower is a C3 crop with a deep root system able to explore water and nutrients other crops cannot reach. Its ~130-day cycle makes it versatile for late windows.\n\nThe NDVI curve has a wide peak at flowering (R5) and a fast descent during achene filling. NDMI is particularly useful because sunflower maintains high water consumption even under moderate stress.",
    },
    regenerativePractices: {
      es: [
        "Aprovechar la raíz profunda para reciclar nutrientes lixiviados",
        "Cultivo de servicio post-girasol para no dejar suelo expuesto en el verano siguiente",
        "Rotación con cereal de invierno para diversificar enfermedades",
        "Densidades más bajas en lotes de menor disponibilidad hídrica",
      ],
      en: [
        "Leverage deep root to recycle leached nutrients",
        "Post-sunflower service crop to avoid exposed soil the following summer",
        "Rotation with winter cereal to diversify diseases",
        "Lower densities in fields with limited water availability",
      ],
    },
    relatedGlossary: "rotacion-cultivos",
    stages: GIRASOL_STAGES,
    dateUpdated: "2026-04-18",
  },
];

export function findCrop(slug: string): CropEditorial | undefined {
  return CROPS.find((c) => c.slug === slug);
}

export function findCropStage(crop: CropEditorial, stageSlug: string):
  | { stage: CropStageEditorial; curveStage: PhenologicalStage }
  | undefined {
  const stage = crop.stages.find((s) => s.slug === stageSlug);
  if (!stage) return undefined;
  const curve: CropCurve = CROP_CURVES[crop.curveKey];
  if (!curve) return undefined;
  const curveStage = curve.stages.find((s) => s.name === stage.sourceName);
  if (!curveStage) return undefined;
  return { stage, curveStage };
}

export function getCropCurveData(crop: CropEditorial): CropCurve {
  return CROP_CURVES[crop.curveKey];
}

/** Devuelve la string en `locale`, o cae a `es` si no existe. */
export function tr<K extends string>(
  field: Partial<Record<CropLocale, string>>,
  locale: CropLocale,
): { value: string; isFallback: boolean } {
  const v = field[locale];
  if (v) return { value: v, isFallback: false };
  return { value: field.es ?? "", isFallback: true };
}

export function trArr(
  field: Partial<Record<CropLocale, string[]>>,
  locale: CropLocale,
): { value: string[]; isFallback: boolean } {
  const v = field[locale];
  if (v) return { value: v, isFallback: false };
  return { value: field.es ?? [], isFallback: true };
}

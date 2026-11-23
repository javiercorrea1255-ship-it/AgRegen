/**
 * Índices satelitales — datos versionados.
 *
 * Cada índice incluye fórmula real, bandas Sentinel-2 que utiliza, rango
 * de valores típico, interpretación por tramo, casos de uso agronómicos
 * y referencia bibliográfica corta. La fórmula se renderiza tanto en
 * texto (`<code>`) como en MathML server-side, sin requerir KaTeX en el
 * cliente para el SEO.
 *
 * Fuente de las fórmulas: definiciones públicas estándar publicadas por
 * la NASA / ESA / index database (https://www.indexdatabase.de/) — se
 * cita la primera publicación en `reference`.
 */

import type { GlossaryLocale } from "./glossary-data";

export type IndexLocale = GlossaryLocale;

export interface IndexBandRamp {
  /** Rango cerrado [min, max). */
  min: number;
  max: number;
  /** Color hex ej. "#fde68a". */
  color: string;
  /** Etiqueta corta por idioma. */
  label: Partial<Record<IndexLocale, string>>;
}

export interface IndexContent {
  fullName: string;
  /** 2 párrafos: qué es + cuándo usarlo. */
  description: string;
  /** Lista de casos de uso (3-5 bullets). */
  useCases: string[];
  /** Etapas fenológicas en que el índice es más informativo. */
  phenology: string;
}

export interface IndexAlternative {
  /** Slug de otro índice de SATELLITE_INDICES. */
  slug: string;
  /** Cuándo conviene preferir esta alternativa, por idioma. */
  reason: Partial<Record<IndexLocale, string>>;
}

export interface SatelliteIndex {
  slug: string;
  /** Sigla en mayúsculas, ej. "NDVI". */
  acronym: string;
  /** Texto plano de la fórmula, ej. "(NIR − Red) / (NIR + Red)". */
  formulaText: string;
  /** MathML server-side. Se inyecta tal cual en el HTML. */
  formulaMathML: string;
  /** Bandas Sentinel-2 usadas, ej. ["B8 (NIR)", "B4 (Red)"]. */
  bands: string[];
  /** Rango típico, ej. [-1, 1]. */
  range: [number, number];
  /** Color ramp para la leyenda del mapa. */
  ramp: IndexBandRamp[];
  /** Referencia corta. */
  reference: string;
  /** Variable agronómica que el índice mide (no la banda; ej. "Biomasa fotosintética"). */
  sensitivity: Partial<Record<IndexLocale, string>>;
  /** Índices alternativos para comparar (slugs de SATELLITE_INDICES). */
  alternatives: IndexAlternative[];
  dateUpdated: string;
  /** Slugs del glosario relacionados. */
  relatedGlossary: string[];
  translations: Partial<Record<IndexLocale, IndexContent>>;
}

const NDVI_RAMP: IndexBandRamp[] = [
  { min: -1.0, max: 0.0, color: "#9ca3af", label: { es: "Agua / no vegetación", en: "Water / non-vegetation", pt: "Água / sem vegetação", zh: "水/无植被" } },
  { min: 0.0, max: 0.2, color: "#fef3c7", label: { es: "Suelo desnudo", en: "Bare soil", pt: "Solo nu", zh: "裸土" } },
  { min: 0.2, max: 0.4, color: "#bef264", label: { es: "Vegetación rala", en: "Sparse vegetation", pt: "Vegetação rala", zh: "稀疏植被" } },
  { min: 0.4, max: 0.6, color: "#65a30d", label: { es: "Vegetación moderada", en: "Moderate vegetation", pt: "Vegetação moderada", zh: "中度植被" } },
  { min: 0.6, max: 1.0, color: "#166534", label: { es: "Vegetación densa y vigorosa", en: "Dense, vigorous vegetation", pt: "Vegetação densa e vigorosa", zh: "茂密植被" } },
];

const NDMI_RAMP: IndexBandRamp[] = [
  { min: -1.0, max: -0.2, color: "#fca5a5", label: { es: "Estrés hídrico severo", en: "Severe water stress", pt: "Estresse hídrico severo", zh: "严重缺水" } },
  { min: -0.2, max: 0.0, color: "#fde68a", label: { es: "Estrés moderado", en: "Moderate stress", pt: "Estresse moderado", zh: "中度缺水" } },
  { min: 0.0, max: 0.2, color: "#bef264", label: { es: "Hidratación normal", en: "Normal hydration", pt: "Hidratação normal", zh: "正常水分" } },
  { min: 0.2, max: 0.4, color: "#22d3ee", label: { es: "Buen contenido de agua", en: "Good water content", pt: "Bom conteúdo de água", zh: "水分充足" } },
  { min: 0.4, max: 1.0, color: "#0891b2", label: { es: "Saturado", en: "Saturated", pt: "Saturado", zh: "饱和" } },
];

const SYM_RAMP: IndexBandRamp[] = [
  { min: -1.0, max: 0.0, color: "#fca5a5", label: { es: "Bajo", en: "Low", pt: "Baixo", zh: "低" } },
  { min: 0.0, max: 0.5, color: "#fde68a", label: { es: "Medio", en: "Medium", pt: "Médio", zh: "中" } },
  { min: 0.5, max: 1.0, color: "#65a30d", label: { es: "Alto", en: "High", pt: "Alto", zh: "高" } },
];

function mfrac(num: string, den: string): string {
  return `<mfrac><mrow>${num}</mrow><mrow>${den}</mrow></mfrac>`;
}

function mathRoot(inner: string): string {
  return `<math xmlns="http://www.w3.org/1998/Math/MathML">${inner}</math>`;
}

function mathFraction(num: string, den: string): string {
  return mathRoot(mfrac(num, den));
}

export const SATELLITE_INDICES: SatelliteIndex[] = [
  {
    slug: "ndvi",
    acronym: "NDVI",
    formulaText: "(NIR − Red) / (NIR + Red)",
    formulaMathML: mathFraction(
      "<mi>NIR</mi><mo>−</mo><mi>Red</mi>",
      "<mi>NIR</mi><mo>+</mo><mi>Red</mi>",
    ),
    bands: ["B8 (NIR, 10 m)", "B4 (Red, 10 m)"],
    range: [-1, 1],
    ramp: NDVI_RAMP,
    reference: "Rouse et al., 1974 — Monitoring vegetation systems in the Great Plains with ERTS.",
    dateUpdated: "2026-04-15",
    relatedGlossary: ["fenologia", "sentinel-2", "estres-hidrico"],
    sensitivity: {es:"Biomasa fotosintéticamente activa",en:"Photosynthetically active biomass",pt:"Biomassa fotossinteticamente ativa",zh:"光合活性生物量"},
    alternatives: [{slug:"evi",reason:{es:"Cuando NDVI satura en cultivos densos (caña, palma).",en:"When NDVI saturates in dense canopies (sugarcane, oil palm).",pt:"Quando NDVI satura em dossel denso.",zh:"茂密冠层下NDVI饱和时"}},{slug:"savi",reason:{es:"Cuando hay mucho suelo desnudo entre plantas (siembras tempranas).",en:"When there is a lot of bare soil between plants (early stages).",pt:"Quando há muito solo nu entre plantas.",zh:"植株间裸土较多时"}}],
    translations: {
      es: {
        fullName: "Índice de Vegetación de Diferencia Normalizada",
        description: "El índice agrícola más usado del mundo. Aprovecha que la clorofila absorbe el rojo y refleja fuertemente el infrarrojo cercano: cuanto mayor el contraste entre ambas bandas, más biomasa fotosintéticamente activa hay.\n\nValores cercanos a 0 indican suelo desnudo o vegetación enferma; valores >0.6 indican un dosel cerrado y sano. Es la base para detectar gradientes de vigor dentro de una misma parcela y para construir series temporales que diagnostican fenología.",
        useCases: [
          "Detectar zonas con bajo vigor dentro de la misma parcela",
          "Construir la curva fenológica del cultivo a lo largo de la temporada",
          "Comparar rendimiento esperado entre parcelas con el mismo cultivo",
          "Ubicar puntos de muestreo de suelo en zonas problemáticas",
        ],
        phenology: "Útil desde emergencia hasta inicio de senescencia. Pico típico cerca de floración.",
      },
      en: {
        fullName: "Normalized Difference Vegetation Index",
        description: "The most widely used agricultural index in the world. It exploits the fact that chlorophyll absorbs red and strongly reflects near-infrared: the higher the contrast between the two bands, the more photosynthetically active biomass is present.\n\nValues near 0 indicate bare soil or unhealthy vegetation; values above 0.6 indicate a closed, healthy canopy. It is the foundation for detecting vigour gradients within a single parcel and for building time series that diagnose phenology.",
        useCases: [
          "Spot low-vigour patches within the same parcel",
          "Build the crop's phenological curve through the season",
          "Compare expected yield between parcels with the same crop",
          "Locate soil sampling points in problem zones",
        ],
        phenology: "Useful from emergence through onset of senescence. Typical peak near flowering.",
      },
      pt: {
        fullName: "Índice de Vegetação por Diferença Normalizada",
        description: "O índice agrícola mais usado do mundo. Aproveita que a clorofila absorve o vermelho e reflete fortemente o infravermelho próximo: quanto maior o contraste entre as duas bandas, mais biomassa fotossintética ativa existe.\n\nValores próximos de 0 indicam solo nu ou vegetação doente; valores acima de 0.6 indicam dossel fechado e saudável.",
        useCases: [
          "Detectar manchas de baixo vigor dentro da mesma parcela",
          "Construir a curva fenológica do cultivo",
          "Comparar produtividade esperada entre parcelas",
          "Localizar pontos de amostragem em zonas problemáticas",
        ],
        phenology: "Útil da emergência ao início da senescência. Pico típico perto da floração.",
      },
      zh: {
        fullName: "归一化差值植被指数",
        description: "全球最常用的农业指数。利用叶绿素吸收红光、强烈反射近红外的特性:两个波段对比越大,光合活性生物量越多。\n\n接近 0 表示裸土或病变;超过 0.6 表示封垄健康冠层。",
        useCases: [
          "识别同一地块内低活力区域",
          "构建作物物候曲线",
          "对比同作物地块预期产量",
          "在问题区域定位土壤采样点",
        ],
        phenology: "从出苗到衰老开始期间有用。开花期附近达到峰值。",
      },
    },
  },
  {
    slug: "evi",
    acronym: "EVI",
    formulaText: "2.5 × (NIR − Red) / (NIR + 6·Red − 7.5·Blue + 1)",
    formulaMathML: mathRoot(
      `<mn>2.5</mn><mo>·</mo>${mfrac(
        "<mi>NIR</mi><mo>−</mo><mi>Red</mi>",
        "<mi>NIR</mi><mo>+</mo><mn>6</mn><mo>·</mo><mi>Red</mi><mo>−</mo><mn>7.5</mn><mo>·</mo><mi>Blue</mi><mo>+</mo><mn>1</mn>",
      )}`,
    ),
    bands: ["B8 (NIR)", "B4 (Red)", "B2 (Blue)"],
    range: [-1, 1],
    ramp: NDVI_RAMP,
    reference: "Huete et al., 2002 — Overview of the radiometric and biophysical performance of the MODIS vegetation indices.",
    dateUpdated: "2026-04-15",
    relatedGlossary: ["fenologia", "sentinel-2"],
    sensitivity: {es:"Biomasa en doseles densos (corrige saturación de NDVI)",en:"Biomass in dense canopies (fixes NDVI saturation)",pt:"Biomassa em dosséis densos",zh:"高密度冠层生物量"},
    alternatives: [{slug:"ndvi",reason:{es:"En cultivos extensivos cuando NDVI todavía no satura.",en:"On row crops where NDVI does not yet saturate.",pt:"Em cultivos onde NDVI não satura ainda.",zh:"未饱和时使用NDVI"}},{slug:"savi",reason:{es:"Cuando el principal problema no es la saturación sino el suelo expuesto.",en:"When the main issue is exposed soil rather than saturation.",pt:"Quando o problema é solo exposto.",zh:"主要受裸土干扰时"}}],
    translations: {
      es: {
        fullName: "Enhanced Vegetation Index",
        description: "Variante mejorada del NDVI que corrige dos limitaciones: la sensibilidad al efecto del suelo en doseles ralos y la saturación en doseles muy densos. Incluye la banda azul para corregir aerosol atmosférico.\n\nEs especialmente útil en cultivos de alta biomasa (caña, palma, maíz adulto) donde el NDVI satura y deja de discriminar entre vigorosos y muy vigorosos.",
        useCases: [
          "Monitorear cultivos densos donde NDVI satura",
          "Análisis fenológico en bosques agroforestales",
          "Detectar diferencias finas en doseles de alto índice de área foliar",
        ],
        phenology: "Mejor que NDVI desde mediados del ciclo en adelante.",
      },
      en: {
        fullName: "Enhanced Vegetation Index",
        description: "Improved variant of NDVI that fixes two limitations: sensitivity to soil background in sparse canopies and saturation in very dense canopies. Includes the blue band to correct for atmospheric aerosols.\n\nIt is especially useful in high-biomass crops (sugarcane, oil palm, mature maize) where NDVI saturates and can no longer discriminate between vigorous and very vigorous patches.",
        useCases: [
          "Monitor dense crops where NDVI saturates",
          "Phenological analysis in agroforestry",
          "Detect fine differences in high-LAI canopies",
        ],
        phenology: "Better than NDVI from mid-cycle onwards.",
      },
    },
  },
  {
    slug: "ndmi",
    acronym: "NDMI",
    formulaText: "(NIR − SWIR1) / (NIR + SWIR1)",
    formulaMathML: mathFraction(
      "<mi>NIR</mi><mo>−</mo><msub><mi>SWIR</mi><mn>1</mn></msub>",
      "<mi>NIR</mi><mo>+</mo><msub><mi>SWIR</mi><mn>1</mn></msub>",
    ),
    bands: ["B8 (NIR, 10 m)", "B11 (SWIR1, 20 m)"],
    range: [-1, 1],
    ramp: NDMI_RAMP,
    reference: "Gao, 1996 — NDWI: A normalized difference water index for remote sensing of vegetation liquid water.",
    dateUpdated: "2026-04-15",
    relatedGlossary: ["estres-hidrico", "sentinel-2"],
    sensitivity: {es:"Contenido de agua en hoja (estrés hídrico temprano)",en:"Leaf water content (early water stress)",pt:"Teor de água na folha",zh:"叶片水分含量"},
    alternatives: [{slug:"msi",reason:{es:"Más sensible aún a estrés hídrico, pero invertido (alto = peor).",en:"Even more sensitive to water stress, but inverted (high = worse).",pt:"Ainda mais sensível, mas invertido.",zh:"对缺水更敏感但方向相反"}},{slug:"ndwi",reason:{es:"Para detectar agua libre en superficie (no estrés del cultivo).",en:"To detect open surface water (not crop stress).",pt:"Para detectar água superficial.",zh:"用于检测地表水"}}],
    translations: {
      es: {
        fullName: "Normalized Difference Moisture Index",
        description: "Mide el contenido de agua en el follaje del cultivo aprovechando que el agua absorbe fuertemente el SWIR1 (~1.6 µm). Es una de las herramientas más sensibles para detectar estrés hídrico antes de que sea visible.\n\nValores positivos altos indican un dosel bien hidratado; valores negativos indican estrés. La diferencia con NDVI es importante: una planta puede tener NDVI alto y NDMI bajo (mucha biomasa pero estresada), señal temprana de problemas.",
        useCases: [
          "Detectar estrés hídrico días antes que el ojo o el NDVI",
          "Programar riego con base en el contenido de agua del follaje",
          "Validar uniformidad de aplicación de un sistema de riego",
        ],
        phenology: "Útil durante todo el ciclo, especialmente desde desarrollo vegetativo a llenado de grano.",
      },
      en: {
        fullName: "Normalized Difference Moisture Index",
        description: "Measures crop canopy water content by exploiting strong water absorption in SWIR1 (~1.6 µm). One of the most sensitive tools to detect water stress before it is visible.\n\nHigh positive values indicate a well-hydrated canopy; negative values indicate stress. The difference with NDVI matters: a plant can have high NDVI and low NDMI (lots of biomass but stressed), an early warning of trouble.",
        useCases: [
          "Detect water stress days before the eye or NDVI does",
          "Schedule irrigation based on canopy water content",
          "Validate application uniformity of an irrigation system",
        ],
        phenology: "Useful throughout the cycle, especially from vegetative growth through grain fill.",
      },
    },
  },
  {
    slug: "ndwi",
    acronym: "NDWI",
    formulaText: "(Green − NIR) / (Green + NIR)",
    formulaMathML: mathFraction(
      "<mi>Green</mi><mo>−</mo><mi>NIR</mi>",
      "<mi>Green</mi><mo>+</mo><mi>NIR</mi>",
    ),
    bands: ["B3 (Green, 10 m)", "B8 (NIR, 10 m)"],
    range: [-1, 1],
    ramp: NDMI_RAMP,
    reference: "McFeeters, 1996 — The use of NDWI in the delineation of open water features.",
    dateUpdated: "2026-04-15",
    relatedGlossary: ["estres-hidrico"],
    sensitivity: {es:"Agua libre en superficie (lagos, anegamientos)",en:"Open surface water (lakes, flooding)",pt:"Água superficial livre",zh:"地表水"},
    alternatives: [{slug:"ndmi",reason:{es:"Para agua dentro de la hoja del cultivo, no en superficie.",en:"For water inside crop leaves, not on the surface.",pt:"Para água dentro da folha.",zh:"用于叶片内水分"}}],
    translations: {
      es: {
        fullName: "Normalized Difference Water Index",
        description: "Diseñado originalmente para detectar superficies de agua abierta. Valores positivos indican presencia de agua (cuerpos, encharcamientos, suelo saturado). Es complementario a NDMI: NDMI mide humedad en el follaje, NDWI agua superficial.\n\nÚtil después de lluvias intensas para mapear zonas con encharcamiento, o para detectar áreas que deberían estar drenadas y no lo están.",
        useCases: [
          "Mapear encharcamientos tras lluvias intensas",
          "Detectar fallos de drenaje",
          "Monitorear cuerpos de agua dentro de la finca",
        ],
        phenology: "Independiente del cultivo; usar cuando se necesita mapear agua superficial.",
      },
      en: {
        fullName: "Normalized Difference Water Index",
        description: "Originally designed to detect open water surfaces. Positive values indicate water (water bodies, ponding, saturated soil). It complements NDMI: NDMI measures canopy moisture, NDWI surface water.\n\nUseful after heavy rains to map flooded patches, or to detect areas that should be draining but are not.",
        useCases: [
          "Map ponding after heavy rains",
          "Detect drainage failures",
          "Monitor water bodies inside the farm",
        ],
        phenology: "Crop-independent; use when you need to map surface water.",
      },
    },
  },
  {
    slug: "savi",
    acronym: "SAVI",
    formulaText: "(1 + L) × (NIR − Red) / (NIR + Red + L), L = 0.5",
    formulaMathML: mathRoot(
      `<mo>(</mo><mn>1</mn><mo>+</mo><mi>L</mi><mo>)</mo><mo>·</mo>${mfrac(
        "<mi>NIR</mi><mo>−</mo><mi>Red</mi>",
        "<mi>NIR</mi><mo>+</mo><mi>Red</mi><mo>+</mo><mi>L</mi>",
      )}<mo>,</mo><mspace width="0.4em"/><mi>L</mi><mo>=</mo><mn>0.5</mn>`,
    ),
    bands: ["B8 (NIR)", "B4 (Red)"],
    range: [-1, 1.5],
    ramp: NDVI_RAMP,
    reference: "Huete, 1988 — A soil-adjusted vegetation index (SAVI).",
    dateUpdated: "2026-04-15",
    relatedGlossary: ["fenologia"],
    sensitivity: {es:"Vigor vegetativo corregido por suelo (factor L)",en:"Vegetation vigour corrected for soil (L factor)",pt:"Vigor vegetativo corrigido por solo",zh:"经土壤校正的植被活力"},
    alternatives: [{slug:"ndvi",reason:{es:"Cuando la cobertura ya cierra el surco y el suelo no influye.",en:"When canopy closes the row and soil no longer interferes.",pt:"Quando o dossel fecha e solo não interfere.",zh:"冠层封闭后"}},{slug:"evi",reason:{es:"Cuando además hay saturación por biomasa muy alta.",en:"When dense biomass also causes saturation.",pt:"Quando há também saturação.",zh:"存在饱和时"}}],
    translations: {
      es: {
        fullName: "Soil-Adjusted Vegetation Index",
        description: "Variante de NDVI que introduce un factor de corrección L (típicamente 0.5) para reducir el efecto del suelo en zonas con cobertura vegetal incompleta. Es la mejor opción cuando se monitorea cultivos en etapas tempranas o cultivos en línea con suelo visible entre surcos.\n\nEn doseles cerrados, SAVI converge a NDVI; el beneficio se concentra en cobertura <50 %.",
        useCases: [
          "Monitorear emergencia y desarrollo temprano",
          "Cultivos en hilera con suelo visible (vid, café, frutales)",
          "Zonas semi-áridas con cobertura rala",
        ],
        phenology: "Especialmente útil de siembra a cierre de dosel.",
      },
      en: {
        fullName: "Soil-Adjusted Vegetation Index",
        description: "NDVI variant that introduces a correction factor L (typically 0.5) to reduce the soil background effect where vegetation cover is incomplete. It is the best choice for monitoring crops in early stages or row crops with visible inter-row soil.\n\nIn closed canopies SAVI converges to NDVI; the benefit is concentrated where cover is <50 %.",
        useCases: [
          "Monitor emergence and early development",
          "Row crops with visible soil (vines, coffee, orchards)",
          "Semi-arid areas with sparse cover",
        ],
        phenology: "Especially useful from sowing to canopy closure.",
      },
    },
  },
  {
    slug: "msi",
    acronym: "MSI",
    formulaText: "SWIR1 / NIR",
    formulaMathML: mathFraction("<msub><mi>SWIR</mi><mn>1</mn></msub>", "<mi>NIR</mi>"),
    bands: ["B11 (SWIR1, 20 m)", "B8 (NIR, 10 m)"],
    range: [0, 3],
    ramp: [
      { min: 0, max: 0.4, color: "#22d3ee", label: { es: "Hidratación alta", en: "High hydration", pt: "Alta hidratação", zh: "水分充足" } },
      { min: 0.4, max: 1.0, color: "#bef264", label: { es: "Hidratación normal", en: "Normal", pt: "Normal", zh: "正常" } },
      { min: 1.0, max: 1.6, color: "#fde68a", label: { es: "Estrés moderado", en: "Moderate stress", pt: "Estresse moderado", zh: "中度缺水" } },
      { min: 1.6, max: 3.0, color: "#fca5a5", label: { es: "Estrés severo", en: "Severe stress", pt: "Estresse severo", zh: "严重缺水" } },
    ],
    reference: "Hunt & Rock, 1989 — Detection of changes in leaf water content using near- and middle-infrared reflectances.",
    dateUpdated: "2026-04-15",
    relatedGlossary: ["estres-hidrico"],
    sensitivity: {es:"Estrés hídrico (escala invertida: alto = más estrés)",en:"Water stress (inverted scale: high = more stress)",pt:"Estresse hídrico (invertido)",zh:"水分胁迫(数值越高越严重)"},
    alternatives: [{slug:"ndmi",reason:{es:"Misma información pero con escala intuitiva (alto = más agua).",en:"Same information but with intuitive scale (high = more water).",pt:"Mesma informação com escala intuitiva.",zh:"相同信息但方向更直观"}}],
    translations: {
      es: {
        fullName: "Moisture Stress Index",
        description: "A diferencia de NDMI, MSI es una razón directa SWIR/NIR sin normalizar. Crece cuando aumenta el estrés hídrico (es \"directo\": más estrés = más alto), lo opuesto al NDMI.\n\nEs preferido por algunos modelos de cultivo porque su respuesta es más lineal frente a la pérdida de agua del follaje.",
        useCases: [
          "Modelos cuantitativos de pérdida de agua foliar",
          "Calibrar umbrales de riego con datos de tensión de agua del suelo",
        ],
        phenology: "Igual que NDMI: durante todo el ciclo activo.",
      },
      en: {
        fullName: "Moisture Stress Index",
        description: "Unlike NDMI, MSI is a direct SWIR/NIR ratio without normalisation. It grows as water stress increases (it is \"direct\": more stress = higher), the opposite of NDMI.\n\nSome crop models prefer it because its response is more linear with respect to canopy water loss.",
        useCases: [
          "Quantitative models of foliar water loss",
          "Calibrate irrigation thresholds against soil water tension data",
        ],
        phenology: "Same as NDMI: throughout the active cycle.",
      },
    },
  },
  {
    slug: "nbr",
    acronym: "NBR",
    formulaText: "(NIR − SWIR2) / (NIR + SWIR2)",
    formulaMathML: mathFraction(
      "<mi>NIR</mi><mo>−</mo><msub><mi>SWIR</mi><mn>2</mn></msub>",
      "<mi>NIR</mi><mo>+</mo><msub><mi>SWIR</mi><mn>2</mn></msub>",
    ),
    bands: ["B8 (NIR)", "B12 (SWIR2, 20 m)"],
    range: [-1, 1],
    ramp: SYM_RAMP,
    reference: "Key & Benson, 2006 — Landscape assessment (LA): sampling and analysis methods.",
    dateUpdated: "2026-04-15",
    relatedGlossary: ["sentinel-2"],
    sensitivity: {es:"Severidad de quema y recuperación post-fuego",en:"Burn severity and post-fire recovery",pt:"Severidade de queimada",zh:"火灾烈度与恢复"},
    alternatives: [{slug:"ndvi",reason:{es:"Para seguir la recuperación de la biomasa una vez pasado el evento.",en:"To track biomass recovery after the event.",pt:"Para acompanhar a recuperação da biomassa.",zh:"事件后跟踪植被恢复"}}],
    translations: {
      es: {
        fullName: "Normalized Burn Ratio",
        description: "Diseñado para detectar áreas quemadas comparando vegetación viva (alta en NIR) con suelo expuesto y carbón (alto en SWIR2). En agricultura se usa para evaluar superficies tras incendio o quema controlada de rastrojo.\n\nLa diferencia entre NBR pre y post evento (dNBR) clasifica la severidad del incendio.",
        useCases: [
          "Mapear superficies tras incendio",
          "Cuantificar la severidad de quemas",
          "Detectar quemas no autorizadas en cuencas",
        ],
        phenology: "Independiente del cultivo. Comparación pre/post evento.",
      },
      en: {
        fullName: "Normalized Burn Ratio",
        description: "Designed to detect burned areas by contrasting live vegetation (high NIR) with exposed soil and char (high SWIR2). In agriculture it is used to assess areas after fire or controlled stubble burns.\n\nThe difference between pre- and post-event NBR (dNBR) classifies fire severity.",
        useCases: [
          "Map post-fire surfaces",
          "Quantify burn severity",
          "Detect unauthorised burns in watersheds",
        ],
        phenology: "Crop-independent. Pre/post-event comparison.",
      },
    },
  },
  {
    slug: "bsi",
    acronym: "BSI",
    formulaText: "((SWIR1 + Red) − (NIR + Blue)) / ((SWIR1 + Red) + (NIR + Blue))",
    formulaMathML: mathFraction(
      "<mo>(</mo><msub><mi>SWIR</mi><mn>1</mn></msub><mo>+</mo><mi>Red</mi><mo>)</mo><mo>−</mo><mo>(</mo><mi>NIR</mi><mo>+</mo><mi>Blue</mi><mo>)</mo>",
      "<mo>(</mo><msub><mi>SWIR</mi><mn>1</mn></msub><mo>+</mo><mi>Red</mi><mo>)</mo><mo>+</mo><mo>(</mo><mi>NIR</mi><mo>+</mo><mi>Blue</mi><mo>)</mo>",
    ),
    bands: ["B11 (SWIR1)", "B4 (Red)", "B8 (NIR)", "B2 (Blue)"],
    range: [-1, 1],
    ramp: SYM_RAMP,
    reference: "Rikimaru et al., 2002 — Tropical forest cover density mapping.",
    dateUpdated: "2026-04-15",
    relatedGlossary: ["cobertura-permanente"],
    sensitivity: {es:"Suelo expuesto (cobertura ausente o baja)",en:"Bare soil (absent or low cover)",pt:"Solo exposto",zh:"裸土"},
    alternatives: [{slug:"ndvi",reason:{es:"Para confirmar el lado opuesto: dónde sí hay vegetación viva.",en:"To confirm the opposite side: where there is live vegetation.",pt:"Para confirmar onde há vegetação viva.",zh:"用于确认有植被的区域"}}],
    translations: {
      es: {
        fullName: "Bare Soil Index",
        description: "Identifica directamente superficies de suelo desnudo combinando bandas que responden al suelo (Red, SWIR1) y a la vegetación (NIR, Blue). Valores positivos indican suelo expuesto; valores negativos, cobertura vegetal.\n\nEs el complemento natural de NDVI para monitorear el principio regenerativo de cobertura permanente.",
        useCases: [
          "Detectar períodos de suelo desnudo en una parcela",
          "Cuantificar superficie sin cobertura vegetal en una finca",
          "Verificar adopción de cultivos de cobertura entre temporadas",
        ],
        phenology: "Especialmente relevante post-cosecha y pre-siembra.",
      },
      en: {
        fullName: "Bare Soil Index",
        description: "Directly identifies bare-soil surfaces by combining bands that respond to soil (Red, SWIR1) and vegetation (NIR, Blue). Positive values indicate exposed soil; negative values, vegetation cover.\n\nIt is the natural complement to NDVI for monitoring the regenerative principle of permanent cover.",
        useCases: [
          "Detect bare-soil windows on a parcel",
          "Quantify uncovered area on a farm",
          "Verify cover-crop adoption between seasons",
        ],
        phenology: "Especially relevant post-harvest and pre-sowing.",
      },
    },
  },
];

export function findIndex(slug: string): SatelliteIndex | undefined {
  return SATELLITE_INDICES.find((i) => i.slug === slug);
}

export function getIndexContent(
  idx: SatelliteIndex,
  locale: IndexLocale,
): { content: IndexContent; isFallback: boolean } {
  const c = idx.translations[locale];
  if (c) return { content: c, isFallback: false };
  return { content: idx.translations.es!, isFallback: true };
}

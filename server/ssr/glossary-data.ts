/**
 * Glosario regenerativo + MVZ — datos versionados.
 *
 * Cada término usa terminología que la plataforma ya emplea en su código
 * y UI. Las definiciones son cortas (2-3 párrafos) y escritas con foco
 * agronómico real, no SEO genérico. `dateUpdated` se usa para
 * `dateModified` del `DefinedTerm` schema y para el `<lastmod>` del
 * sitemap.
 *
 * Reglas:
 * - El campo `es` es obligatorio (idioma fuente). Si una traducción no
 *   está disponible, el renderer sirve el contenido en español con
 *   `<meta name="robots" content="noindex">` (acordado en task #61).
 * - `related` apunta a otros slugs del glosario; `relatedIndices` apunta
 *   a slugs de `indices-data.ts`.
 */

export type GlossaryLocale = "es" | "en" | "pt" | "zh";

export interface GlossaryTermContent {
  title: string;
  /** 2 párrafos. Separados por `\n\n`. */
  definition: string;
  /** Por qué importa para suelo vivo / monitoreo. 1 párrafo. */
  context: string;
}

export interface GlossaryTerm {
  slug: string;
  category: "regenerative" | "monitoring" | "soil" | "method" | "mvz";
  related: string[];
  relatedIndices?: string[];
  dateUpdated: string;
  datePublished?: string;
  translations: Partial<Record<GlossaryLocale, GlossaryTermContent>>;
}

export const GLOSSARY_TERMS: GlossaryTerm[] = [
  {
    slug: "agricultura-regenerativa",
    category: "regenerative",
    related: ["cobertura-permanente", "labranza-cero", "rotacion-cultivos", "integracion-animal"],
    dateUpdated: "2026-04-10",
    translations: {
      es: {
        title: "Agricultura regenerativa",
        definition: "Conjunto de prácticas agrícolas que tienen como objetivo explícito mejorar la salud del suelo, la biodiversidad y el ciclo del agua mientras se produce alimento. Va más allá de \"sostenible\" — busca dejar el ecosistema en mejor estado del que se encontró.\n\nEn la práctica se mide por indicadores: aumento de materia orgánica del suelo, mayor infiltración, menor escorrentía, retorno de fauna polinizadora y cobertura vegetal sin períodos de suelo desnudo. No es una certificación única; es un paquete de prácticas que se ajusta a cada parcela.",
        context: "AgRegen monitorea estos indicadores combinando NDVI/NDMI satelital con análisis de suelo y bitácora de prácticas, para verificar si las decisiones de manejo realmente están regenerando el sistema o sólo manteniéndolo.",
      },
      en: {
        title: "Regenerative agriculture",
        definition: "A set of farming practices whose explicit goal is to improve soil health, biodiversity and the water cycle while producing food. It goes beyond \"sustainable\" — the aim is to leave the ecosystem in better shape than it was found.\n\nIn practice it is measured by indicators: rising soil organic matter, higher infiltration, less runoff, returning pollinators and continuous vegetative cover without bare-soil periods. It is not a single certification; it is a bundle of practices tuned to each parcel.",
        context: "AgRegen tracks these indicators by combining satellite NDVI/NDMI with soil tests and a practices log, so growers can verify that management is really regenerating the system, not just maintaining it.",
      },
      pt: {
        title: "Agricultura regenerativa",
        definition: "Conjunto de práticas agrícolas cujo objetivo explícito é melhorar a saúde do solo, a biodiversidade e o ciclo da água enquanto se produz alimento. Vai além do \"sustentável\" — busca deixar o ecossistema em melhor estado do que foi encontrado.\n\nNa prática mede-se por indicadores: aumento de matéria orgânica do solo, maior infiltração, menor escorrimento, retorno de polinizadores e cobertura vegetal contínua sem períodos de solo nu.",
        context: "A AgRegen monitora esses indicadores combinando NDVI/NDMI por satélite com análises de solo e diário de práticas, para verificar se o manejo realmente está regenerando o sistema.",
      },
      zh: {
        title: "再生农业",
        definition: "一套以改善土壤健康、生物多样性和水循环为明确目标的农业实践,同时生产食物。超越\"可持续\"——目标是让生态系统比发现时更好。\n\n实践中通过指标衡量:土壤有机质增加、入渗增加、地表径流减少、传粉者回归和持续植被覆盖。",
        context: "AgRegen 结合卫星 NDVI/NDMI、土壤分析和实践日志监测这些指标,验证管理是否真正在再生系统。",
      },
    },
  },
  {
    slug: "cobertura-permanente",
    category: "regenerative",
    related: ["labranza-cero", "agricultura-regenerativa", "materia-organica"],
    relatedIndices: ["ndvi", "bsi"],
    dateUpdated: "2026-04-10",
    translations: {
      es: {
        title: "Cobertura permanente del suelo",
        definition: "Mantener el suelo cubierto por vegetación viva o residuos vegetales durante todo el año, evitando los períodos de \"suelo desnudo\" entre cultivos. Se logra con cultivos de cobertura, mulch, rastrojo o asociaciones.\n\nEs uno de los principios centrales de la agricultura regenerativa porque el suelo desnudo pierde humedad por evaporación directa, se compacta con el impacto de la lluvia, y queda expuesto a la erosión hídrica y eólica.",
        context: "En AgRegen, los períodos de suelo desnudo se detectan automáticamente con BSI (Bare Soil Index) y caídas prolongadas de NDVI fuera del ciclo del cultivo, generando alertas para sembrar cobertura.",
      },
      en: {
        title: "Permanent ground cover",
        definition: "Keeping the soil covered by living vegetation or crop residues year-round, avoiding bare-soil periods between cash crops. Achieved with cover crops, mulch, stubble or intercropping.\n\nIt is one of the core principles of regenerative agriculture because bare soil loses moisture through direct evaporation, compacts under raindrop impact, and is exposed to wind and water erosion.",
        context: "AgRegen automatically detects bare-soil windows using BSI (Bare Soil Index) and sustained NDVI drops outside the crop cycle, raising alerts to plant cover.",
      },
      pt: {
        title: "Cobertura permanente do solo",
        definition: "Manter o solo coberto por vegetação viva ou resíduos vegetais o ano todo, evitando períodos de solo nu entre cultivos. Consegue-se com plantas de cobertura, palhada ou consórcios.\n\nÉ um dos princípios centrais da agricultura regenerativa porque o solo nu perde umidade por evaporação, compacta-se com a chuva e fica exposto à erosão.",
        context: "Em AgRegen, períodos de solo nu são detectados automaticamente com BSI e quedas prolongadas de NDVI, gerando alertas para semear cobertura.",
      },
    },
  },
  {
    slug: "labranza-cero",
    category: "regenerative",
    related: ["cobertura-permanente", "materia-organica", "agricultura-regenerativa"],
    dateUpdated: "2026-04-10",
    translations: {
      es: {
        title: "Labranza cero (siembra directa)",
        definition: "Sistema de manejo donde se siembra directamente sobre el rastrojo del cultivo anterior sin remover el suelo con arado, rastra o subsolador. La perturbación se limita a la línea de siembra.\n\nReduce la pérdida de carbono del suelo (la oxidación se acelera al voltear), preserva la estructura de poros formada por raíces y lombrices, y baja el consumo de combustible. Funciona mejor combinada con rotación y cultivos de cobertura.",
        context: "Las parcelas marcadas como labranza cero en AgRegen muestran, en promedio, mayor estabilidad de NDVI durante sequías cortas porque la cobertura vegetal y la mejor estructura del suelo retienen humedad por más tiempo.",
      },
      en: {
        title: "No-till (direct seeding)",
        definition: "Management system in which seed is placed directly into the previous crop's residue without ploughing, harrowing or sub-soiling. Disturbance is limited to the seed row.\n\nIt slows soil carbon loss (oxidation accelerates when soil is turned), preserves the pore structure built by roots and earthworms, and lowers fuel use. Works best combined with rotation and cover crops.",
        context: "Parcels flagged as no-till in AgRegen tend to show steadier NDVI during short droughts because vegetative cover and improved structure retain moisture longer.",
      },
      pt: {
        title: "Plantio direto",
        definition: "Sistema em que se semeia diretamente sobre a palhada do cultivo anterior, sem revolver o solo. A perturbação limita-se à linha de plantio.\n\nReduz a perda de carbono, preserva a estrutura de poros e diminui o consumo de combustível.",
        context: "Parcelas marcadas como plantio direto em AgRegen tendem a mostrar NDVI mais estável durante secas curtas.",
      },
    },
  },
  {
    slug: "rotacion-cultivos",
    category: "regenerative",
    related: ["agricultura-regenerativa", "cobertura-permanente"],
    dateUpdated: "2026-04-10",
    translations: {
      es: {
        title: "Rotación de cultivos",
        definition: "Secuencia planificada de cultivos diferentes en la misma parcela a lo largo de varias temporadas. Se buscan complementariedades: una leguminosa fija nitrógeno para el siguiente cereal, una raíz profunda rompe compactación para uno de raíz superficial, etc.\n\nQuiebra ciclos de plagas y enfermedades específicas de un cultivo, distribuye la demanda de nutrientes y reduce la dependencia de insumos externos.",
        context: "AgRegen guarda el historial de rotación por parcela y permite contrastar rendimientos y NDVI medio entre temporadas con diferentes secuencias para validar qué rotaciones funcionan en cada microclima.",
      },
      en: {
        title: "Crop rotation",
        definition: "A planned sequence of different crops on the same parcel across several seasons. The aim is complementarity: a legume fixes nitrogen for the next cereal, a deep-rooted crop breaks compaction for the next shallow-rooted one, and so on.\n\nIt disrupts pest and disease cycles tied to a single crop, spreads nutrient demand and lowers reliance on external inputs.",
        context: "AgRegen stores per-parcel rotation history and lets users compare yields and mean NDVI between seasons with different sequences to validate which rotations work in each microclimate.",
      },
    },
  },
  {
    slug: "integracion-animal",
    category: "regenerative",
    related: ["agricultura-regenerativa", "cobertura-permanente"],
    dateUpdated: "2026-04-10",
    translations: {
      es: {
        title: "Integración animal",
        definition: "Incorporar pastoreo controlado de animales (vacunos, ovinos, aves) dentro del esquema agrícola, generalmente sobre cultivos de cobertura o rastrojos. El estiércol fertiliza el suelo y el pisoteo aporta materia orgánica triturada.\n\nClave: el manejo es rotacional y con altas densidades por períodos cortos, no pastoreo continuo. La diferencia entre regenerar y degradar está en el tiempo de descanso de cada potrero.",
        context: "AgRegen permite registrar pasos de animales por potrero y cruzarlos con la recuperación de NDVI tras el pastoreo, para detectar sobrepastoreo antes de que el daño sea visible.",
      },
      en: {
        title: "Animal integration",
        definition: "Bringing controlled livestock grazing (cattle, sheep, poultry) into the cropping scheme, usually over cover crops or stubble. Manure fertilises the soil and trampling adds shredded organic matter.\n\nKey: management must be rotational with high stocking densities for short windows, not continuous grazing. The difference between regenerating and degrading lies in each paddock's rest period.",
        context: "AgRegen lets users log animal passes per paddock and cross-reference them with post-grazing NDVI recovery to spot overgrazing before damage is visible on the ground.",
      },
    },
  },
  {
    slug: "materia-organica",
    category: "soil",
    related: ["cobertura-permanente", "labranza-cero", "compost"],
    dateUpdated: "2026-04-10",
    translations: {
      es: {
        title: "Materia orgánica del suelo (MOS)",
        definition: "Fracción del suelo formada por residuos vegetales, animales y microbianos en distintos grados de descomposición, más el humus estable. Se mide en porcentaje del peso seco (típicamente 1-6 % en suelos agrícolas).\n\nGobierna la capacidad de retención de agua, la estructura, la disponibilidad de nutrientes y la resistencia a la erosión. Cada 1 % adicional de MOS puede retener entre 100 000 y 250 000 L de agua por hectárea según la textura.",
        context: "Subir MOS es el indicador más directo de regeneración. AgRegen registra los análisis de laboratorio en el módulo de suelo y los grafica contra el tiempo y las prácticas aplicadas.",
      },
      en: {
        title: "Soil organic matter (SOM)",
        definition: "The soil fraction formed by plant, animal and microbial residues at various decomposition stages, plus stable humus. Measured as a percentage of dry weight (typically 1–6 % in cropland).\n\nIt drives water-holding capacity, structure, nutrient availability and erosion resistance. Each additional 1 % SOM can retain between 100 000 and 250 000 L of water per hectare depending on texture.",
        context: "Raising SOM is the most direct indicator of regeneration. AgRegen logs lab results in the soil module and charts them against time and applied practices.",
      },
    },
  },
  {
    slug: "compost",
    category: "soil",
    related: ["materia-organica", "agricultura-regenerativa"],
    dateUpdated: "2026-04-10",
    translations: {
      es: {
        title: "Composta",
        definition: "Producto estable resultante de la descomposición controlada y aeróbica de residuos orgánicos (estiércol, restos de cultivo, residuos de cocina). El proceso pasa por una fase termófila (>55 °C) que higieniza y degrada lignina.\n\nCuando está madura tiene relación C:N cercana a 12-15, olor a tierra y temperatura ambiente estable. Aplicada al suelo aporta MOS, microbiología y nutrientes liberados de forma lenta.",
        context: "AgRegen permite registrar aplicaciones de composta como intervenciones y verificar el efecto en NDVI/MOS de la siguiente temporada.",
      },
      en: {
        title: "Compost",
        definition: "Stable product of controlled aerobic decomposition of organic residues (manure, crop residues, kitchen waste). The process passes through a thermophilic phase (>55 °C) that sanitises and breaks down lignin.\n\nMature compost has a C:N ratio near 12–15, an earthy smell and stable ambient temperature. Applied to soil it adds SOM, microbiology and slowly-released nutrients.",
        context: "AgRegen lets users log compost applications as interventions and check their effect on next-season NDVI / SOM.",
      },
    },
  },
  {
    slug: "fenologia",
    category: "monitoring",
    related: ["grados-dia"],
    relatedIndices: ["ndvi", "evi"],
    dateUpdated: "2026-04-10",
    translations: {
      es: {
        title: "Fenología del cultivo",
        definition: "Estudio de las etapas del ciclo biológico del cultivo (siembra, emergencia, desarrollo vegetativo, floración, llenado de grano, madurez, cosecha) y de cómo el clima influye en su duración.\n\nCada etapa tiene una firma espectral distinta. NDVI sube durante el desarrollo vegetativo, alcanza su pico cerca de floración, y baja durante senescencia. La forma de esa curva diagnostica si el cultivo está en tiempo o atrasado.",
        context: "AgRegen calcula la etapa fenológica esperada a partir de la fecha de siembra y los grados-día acumulados, y la compara contra la curva real de NDVI para detectar desfases.",
      },
      en: {
        title: "Crop phenology",
        definition: "Study of the crop's biological stages (sowing, emergence, vegetative growth, flowering, grain fill, maturity, harvest) and how climate shapes their length.\n\nEach stage has a distinct spectral signature. NDVI rises during vegetative growth, peaks near flowering and falls during senescence. The shape of that curve diagnoses whether the crop is on schedule.",
        context: "AgRegen estimates expected phenological stage from planting date and accumulated growing-degree days, and compares it against the real NDVI curve to flag delays.",
      },
    },
  },
  {
    slug: "grados-dia",
    category: "monitoring",
    related: ["fenologia"],
    dateUpdated: "2026-04-10",
    translations: {
      es: {
        title: "Grados-día acumulados (GDD)",
        definition: "Suma de la diferencia diaria entre la temperatura media del aire y un umbral mínimo de desarrollo del cultivo (por ejemplo 10 °C para maíz). Se acumula desde la siembra y se mide en °C-día.\n\nCada cultivo necesita una cantidad relativamente fija de GDD para alcanzar cada etapa fenológica, lo que la convierte en un mejor predictor del desarrollo que el calendario.",
        context: "AgRegen calcula GDD diarios usando la API de clima y los compara con los requisitos del cultivo registrado en cada parcela.",
      },
      en: {
        title: "Growing-degree days (GDD)",
        definition: "Daily sum of the difference between mean air temperature and a crop-specific minimum threshold (e.g. 10 °C for maize). Accumulates from sowing and is reported in °C-days.\n\nEach crop needs a fairly fixed amount of GDD to reach each phenological stage, which makes it a better development predictor than the calendar.",
        context: "AgRegen computes daily GDD from weather data and compares it with each parcel's crop GDD requirements.",
      },
    },
  },
  {
    slug: "estres-hidrico",
    category: "monitoring",
    related: ["fenologia"],
    relatedIndices: ["ndmi", "ndwi", "msi"],
    dateUpdated: "2026-04-10",
    translations: {
      es: {
        title: "Estrés hídrico",
        definition: "Condición fisiológica en la que la planta no puede absorber suficiente agua para sostener su transpiración. Se detecta antes que a simple vista por la caída del contenido de agua en la hoja, que cambia su firma en bandas de infrarrojo de onda corta (SWIR).\n\nÍndices como NDMI y MSI usan SWIR para detectar el estrés temprano, días antes de que la hoja se vea marchita o el NDVI caiga.",
        context: "AgRegen genera alertas tempranas cuando NDMI cae por debajo del rango típico para la etapa fenológica del cultivo en esa parcela.",
      },
      en: {
        title: "Water stress",
        definition: "Physiological condition in which the plant cannot absorb enough water to sustain transpiration. Detected before being visible to the eye through a drop in leaf water content, which changes the leaf's signature in short-wave infrared (SWIR) bands.\n\nIndices like NDMI and MSI use SWIR to detect this stress early, days before the leaf wilts or NDVI falls.",
        context: "AgRegen raises early alerts when NDMI drops below the typical range for the crop's phenological stage on that parcel.",
      },
    },
  },
  {
    slug: "sentinel-2",
    category: "monitoring",
    related: ["fenologia"],
    relatedIndices: ["ndvi", "evi", "ndmi"],
    dateUpdated: "2026-04-10",
    translations: {
      es: {
        title: "Sentinel-2",
        definition: "Constelación de dos satélites ópticos (Sentinel-2A y 2B) operada por la Agencia Espacial Europea como parte del programa Copernicus. Captura 13 bandas espectrales con resoluciones de 10, 20 y 60 m, y revisita cada punto del planeta cada ~5 días.\n\nLas bandas en infrarrojo cercano (B8, 10 m) y SWIR (B11, B12, 20 m) son las que permiten calcular NDVI, EVI, NDMI y la mayoría de los índices agrícolas. Los datos son abiertos y gratuitos.",
        context: "AgRegen consume Sentinel-2 a través de Google Earth Engine: el usuario selecciona una imagen disponible y la plataforma calcula y muestra los índices recortados a su parcela.",
      },
      en: {
        title: "Sentinel-2",
        definition: "Constellation of two optical satellites (Sentinel-2A and 2B) operated by the European Space Agency under the Copernicus programme. Captures 13 spectral bands at 10, 20 and 60 m resolution and revisits each point on Earth every ~5 days.\n\nThe near-infrared (B8, 10 m) and SWIR (B11, B12, 20 m) bands are what enable NDVI, EVI, NDMI and most agricultural indices. The data is open and free.",
        context: "AgRegen consumes Sentinel-2 through Google Earth Engine: the user picks an available image and the platform computes and displays the indices clipped to their parcel.",
      },
    },
  },
  {
    slug: "google-earth-engine",
    category: "monitoring",
    related: ["sentinel-2"],
    dateUpdated: "2026-04-10",
    translations: {
      es: {
        title: "Google Earth Engine (GEE)",
        definition: "Plataforma de Google para procesamiento masivo de datos geoespaciales. Da acceso a catálogos públicos (Sentinel, Landsat, MODIS, etc.) y a una infraestructura de cómputo distribuida para correr operaciones a escala planetaria sin descargar las imágenes.\n\nEs gratuita para usos no comerciales y de investigación.",
        context: "AgRegen usa GEE como motor para filtrar imágenes Sentinel-2, calcular índices recortados al polígono de cada parcela y servir los tiles del mapa al navegador.",
      },
      en: {
        title: "Google Earth Engine (GEE)",
        definition: "Google's platform for large-scale geospatial data processing. It provides access to public catalogues (Sentinel, Landsat, MODIS, etc.) and a distributed compute back-end to run planet-scale operations without downloading the imagery.\n\nIt is free for non-commercial and research use.",
        context: "AgRegen uses GEE as its engine to filter Sentinel-2 imagery, compute indices clipped to each parcel's polygon and serve map tiles to the browser.",
      },
    },
  },
  {
    slug: "mvz",
    category: "mvz",
    related: ["kriging", "idw", "zonas-manejo", "interpolacion"],
    dateUpdated: "2026-04-12",
    translations: {
      es: {
        title: "MVZ (Manejo Variable por Zonas)",
        definition: "Estrategia de agricultura de precisión que divide la parcela en zonas internamente homogéneas y aplica insumos (fertilizante, semilla, agua) con dosis distintas por zona, en lugar de una dosis única para todo el lote.\n\nEl flujo típico es: muestreo dirigido → análisis de laboratorio → interpolación espacial → zonificación por k-means → prescripción por zona. AgRegen implementa este flujo completo en un módulo dedicado.",
        context: "El módulo MVZ de AgRegen guía al productor desde el diseño del muestreo hasta el archivo de prescripción listo para subir al equipo de aplicación variable, integrando IA para interpretar zonas.",
      },
      en: {
        title: "VRA (Variable-Rate Application by zones)",
        definition: "Precision-agriculture strategy that splits a parcel into internally-homogeneous zones and applies inputs (fertiliser, seed, water) at different rates per zone instead of a single field-wide rate.\n\nTypical workflow: directed sampling → lab analysis → spatial interpolation → k-means zonification → per-zone prescription. AgRegen implements the full workflow in a dedicated module.",
        context: "AgRegen's MVZ module guides the grower from sampling design through to the prescription file ready to upload to the variable-rate applicator, with AI assistance for zone interpretation.",
      },
    },
  },
  {
    slug: "kriging",
    category: "method",
    related: ["idw", "interpolacion", "mvz"],
    dateUpdated: "2026-04-12",
    translations: {
      es: {
        title: "Kriging (krigeado)",
        definition: "Método geoestadístico de interpolación que estima valores en puntos no muestreados a partir de un modelo de variograma ajustado a los datos observados. A diferencia de IDW, kriging usa la estructura espacial real del fenómeno y produce además una varianza de estimación.\n\nVariantes comunes: ordinario (OK), universal (UK), Co-Kriging (multivariable) y RF-Kriging (combinando random forest y kriging de los residuos).",
        context: "El servicio Python de AgRegen implementa OK, RF-Kriging y Co-Kriging usando los datos del muestreo de la parcela y devuelve el mapa interpolado al navegador.",
      },
      en: {
        title: "Kriging",
        definition: "Geostatistical interpolation method that estimates values at unsampled locations from a variogram model fitted to the observed data. Unlike IDW, kriging uses the phenomenon's real spatial structure and also yields an estimation variance.\n\nCommon variants: ordinary (OK), universal (UK), Co-Kriging (multivariate) and RF-Kriging (combining random forest with kriging of the residuals).",
        context: "AgRegen's Python service implements OK, RF-Kriging and Co-Kriging using the parcel's sampling data and returns the interpolated map to the browser.",
      },
    },
  },
  {
    slug: "idw",
    category: "method",
    related: ["kriging", "interpolacion", "mvz"],
    dateUpdated: "2026-04-12",
    translations: {
      es: {
        title: "IDW (Inverse Distance Weighting)",
        definition: "Método de interpolación que estima un valor en un punto como un promedio ponderado de los valores observados, donde el peso de cada observación es inverso a su distancia (típicamente al cuadrado).\n\nEs simple, rápido y no requiere ajustar modelos. La desventaja es que no reproduce variabilidad espacial real y produce \"ojos de buey\" alrededor de cada punto observado.",
        context: "AgRegen ofrece IDW como opción rápida cuando hay pocos puntos de muestreo o cuando se necesita una primera aproximación antes de pasar a kriging.",
      },
      en: {
        title: "IDW (Inverse Distance Weighting)",
        definition: "Interpolation method that estimates a value at a point as a weighted average of observed values, where each observation's weight is the inverse of its distance (usually squared).\n\nIt is simple, fast and requires no model fitting. The downside is that it does not reproduce real spatial variability and creates \"bull's-eye\" patterns around each observed point.",
        context: "AgRegen offers IDW as a fast option when there are few sampling points or when a first approximation is needed before moving on to kriging.",
      },
    },
  },
  {
    slug: "interpolacion",
    category: "method",
    related: ["kriging", "idw", "mvz"],
    dateUpdated: "2026-04-12",
    translations: {
      es: {
        title: "Interpolación espacial",
        definition: "Proceso por el cual, a partir de un conjunto de mediciones puntuales en distintas ubicaciones, se estima el valor del atributo en toda la superficie de interés. Convierte una nube de puntos en un mapa continuo.\n\nLa elección del método (IDW, splines, kriging, RBF, RF-Kriging) depende del número de puntos, su distribución y la estructura espacial del fenómeno.",
        context: "AgRegen implementa cinco métodos de interpolación en su servicio Python y permite comparar resultados antes de aceptar uno como base para zonificar.",
      },
      en: {
        title: "Spatial interpolation",
        definition: "Process by which, from a set of point measurements at different locations, the value of an attribute is estimated across the whole surface of interest. It turns a point cloud into a continuous map.\n\nMethod choice (IDW, splines, kriging, RBF, RF-Kriging) depends on the number of points, their distribution and the spatial structure of the phenomenon.",
        context: "AgRegen implements five interpolation methods in its Python service and lets users compare results before accepting one as the basis for zonification.",
      },
    },
  },
  {
    slug: "zonas-manejo",
    category: "mvz",
    related: ["mvz", "kriging", "interpolacion"],
    dateUpdated: "2026-04-12",
    translations: {
      es: {
        title: "Zonas de manejo",
        definition: "Subdivisiones de la parcela que agrupan superficies con propiedades similares (ej. fertilidad, contenido de agua, conductividad eléctrica) según el mapa interpolado. Cada zona recibe una prescripción específica.\n\nLa cantidad de zonas se elige por compromiso: pocas zonas son fáciles de operar pero pierden precisión; muchas zonas son precisas pero exigen equipo más complejo.",
        context: "AgRegen genera zonas con k-means sobre el mapa interpolado y permite ajustar manualmente los límites antes de generar la prescripción.",
      },
      en: {
        title: "Management zones",
        definition: "Subdivisions of the parcel that group areas with similar properties (e.g. fertility, water content, electrical conductivity) based on the interpolated map. Each zone gets its own prescription.\n\nThe number of zones is a trade-off: few zones are easier to operate but lose precision; many zones are precise but demand more capable equipment.",
        context: "AgRegen builds zones using k-means on the interpolated map and lets users manually adjust the boundaries before generating the prescription.",
      },
    },
  },
  {
    slug: "muestreo-suelo",
    category: "mvz",
    related: ["mvz", "kriging"],
    dateUpdated: "2026-04-12",
    translations: {
      es: {
        title: "Muestreo de suelo",
        definition: "Procedimiento de campo para extraer submuestras representativas del suelo en ubicaciones planificadas y combinarlas en muestras compuestas que se envían al laboratorio. La calidad de cualquier mapa interpolado depende de cuán bueno fue el muestreo.\n\nReglas básicas: muestreo a profundidad uniforme (típicamente 0-20 cm para fertilidad), evitar bordes y áreas atípicas, y mantener una densidad consistente con el método de interpolación que se usará.",
        context: "AgRegen genera la malla de muestreo automáticamente sobre el polígono de la parcela y guía al productor en campo con coordenadas GPS por cada punto.",
      },
      en: {
        title: "Soil sampling",
        definition: "Field procedure to extract representative sub-samples of soil at planned locations and combine them into composite samples sent to the laboratory. The quality of any interpolated map depends on how good the sampling was.\n\nBasics: sample at uniform depth (typically 0–20 cm for fertility), avoid edges and atypical patches, and keep density consistent with the interpolation method that will be used.",
        context: "AgRegen generates the sampling grid automatically over the parcel's polygon and guides the operator in the field with GPS coordinates per point.",
      },
    },
  },
  {
    slug: "agroforesteria",
    category: "regenerative",
    related: ["integracion-animal", "cobertura-permanente"],
    dateUpdated: "2026-04-15",
    translations: {
      es: {
        title: "Agroforestería",
        definition: "Sistema productivo que combina deliberadamente árboles o arbustos perennes con cultivos anuales, pasturas o ganado en la misma unidad de tierra, organizados en el espacio (callejones, cercos vivos) o en el tiempo (rotación con barbecho arbolado).\n\nLos árboles aportan sombra, fijan carbono profundo, ciclan nutrientes desde capas inaccesibles para el cultivo y crean microclima que reduce evapotranspiración. Bien diseñada, puede aumentar la producción total por hectárea respecto a un monocultivo.",
        context: "AgRegen permite registrar parcelas con uso mixto y comparar la curva de NDVI de zonas con y sin cobertura arbórea.",
      },
      en: {
        title: "Agroforestry",
        definition: "Productive system that deliberately combines trees or perennial shrubs with annual crops, pastures or livestock on the same land unit, arranged in space (alleys, live fences) or in time (rotation with woody fallow).\n\nTrees provide shade, fix deep carbon, cycle nutrients from layers crops cannot reach and create a microclimate that lowers evapotranspiration. Well designed, it can raise total per-hectare production compared with monoculture.",
        context: "AgRegen lets you register parcels with mixed land use and compare the NDVI curve of zones with and without tree cover.",
      },
    },
  },
  {
    slug: "silvopastoreo",
    category: "regenerative",
    related: ["agroforesteria", "integracion-animal"],
    dateUpdated: "2026-04-15",
    translations: {
      es: {
        title: "Silvopastoreo",
        definition: "Forma específica de agroforestería donde árboles, pastura y ganado coexisten en el mismo lote. Los animales aprovechan la sombra y el confort térmico, ramonean rebrotes y ciclan nutrientes con su estiércol; la pastura suele rendir más bajo cobertura arbórea moderada por menor estrés hídrico.\n\nPuntos críticos: elegir especies arbóreas de copa abierta (algarrobo, prosopis, paraíso), manejar la carga animal para evitar compactación cerca del tronco, y dejar barreras de protección en árboles jóvenes.",
        context: "Útil para registrar como práctica regenerativa en parcelas ganaderas y para correlacionarlo con índices NDVI/NDMI estables a lo largo del año.",
      },
      en: {
        title: "Silvopasture",
        definition: "Specific form of agroforestry where trees, pasture and livestock coexist on the same field. Animals use the shade and thermal comfort, browse regrowth and cycle nutrients through manure; pasture often yields more under moderate tree cover thanks to reduced water stress.\n\nKey points: pick open-canopy tree species, manage stocking rate to avoid compaction near trunks, and protect young trees with barriers.",
        context: "Useful to log as a regenerative practice on livestock parcels and to correlate with NDVI/NDMI curves that stay stable through the year.",
      },
    },
  },
  {
    slug: "carbono-suelo",
    category: "soil",
    related: ["materia-organica", "compost", "agricultura-regenerativa"],
    relatedIndices: ["ndvi"],
    dateUpdated: "2026-04-15",
    translations: {
      es: {
        title: "Carbono orgánico del suelo (COS)",
        definition: "Cantidad de carbono almacenada en la materia orgánica del suelo, expresada como porcentaje del peso o como toneladas de carbono por hectárea hasta una profundidad dada (típicamente 0–30 cm).\n\nEl COS es el principal indicador de salud edáfica y la métrica clave para esquemas de carbono regenerativo. Un aumento del 0,1 % anual de COS es ya un cambio agronómicamente significativo y suele requerir varios años de prácticas regenerativas para evidenciarse en laboratorio.",
        context: "AgRegen permite registrar análisis de COS por parcela y proyectar su evolución en función de las prácticas regenerativas adoptadas.",
      },
      en: {
        title: "Soil organic carbon (SOC)",
        definition: "Amount of carbon stored in soil organic matter, expressed as a percentage of weight or as tonnes of carbon per hectare down to a given depth (typically 0–30 cm).\n\nSOC is the headline indicator of soil health and the key metric for regenerative carbon schemes. A 0.1 % annual SOC gain is already an agronomically meaningful change and usually takes several years of regenerative practice to show up in the lab.",
        context: "AgRegen lets you log SOC tests per parcel and project their evolution as a function of the regenerative practices in place.",
      },
    },
  },
  {
    slug: "biologia-suelo",
    category: "soil",
    related: ["materia-organica", "carbono-suelo"],
    dateUpdated: "2026-04-15",
    translations: {
      es: {
        title: "Biología del suelo",
        definition: "Conjunto de organismos vivos del suelo (bacterias, hongos, protozoos, nematodos, micro y mesofauna, lombrices) que descomponen materia orgánica, ciclan nutrientes, construyen agregados y suprimen patógenos.\n\nUn suelo regenerativo se distingue menos por su análisis químico que por la actividad biológica. Indicadores prácticos: presencia de lombrices, respiración del suelo (CO₂ liberado en 24 h), micorrizas asociadas a raíces.",
        context: "AgRegen incorpora campos de evaluación biológica simple en cada análisis de suelo registrado.",
      },
      en: {
        title: "Soil biology",
        definition: "Set of living soil organisms (bacteria, fungi, protozoa, nematodes, micro- and mesofauna, earthworms) that decompose organic matter, cycle nutrients, build aggregates and suppress pathogens.\n\nA regenerative soil is told apart less by its chemistry than by its biological activity. Practical indicators: presence of earthworms, soil respiration (CO₂ released in 24 h), mycorrhizae attached to roots.",
        context: "AgRegen includes simple biological assessment fields in every logged soil test.",
      },
    },
  },
  {
    slug: "biodiversidad-funcional",
    category: "regenerative",
    related: ["agricultura-regenerativa", "rotacion-cultivos", "agroforesteria"],
    dateUpdated: "2026-04-15",
    translations: {
      es: {
        title: "Biodiversidad funcional",
        definition: "Variedad de especies vegetales, animales y microbianas que cumplen funciones agronómicas concretas: fijar nitrógeno, atraer polinizadores, romper ciclos de plagas, descomponer residuos.\n\nMás importante que el número total de especies es la diversidad de funciones cubiertas: leguminosas, gramíneas, crucíferas, plantas con flores, animales descomponedores y polinizadores. La biodiversidad funcional reduce la dependencia de insumos externos.",
        context: "Métrica que se puede registrar en parcelas regenerativas y comunicar al consumidor final.",
      },
      en: {
        title: "Functional biodiversity",
        definition: "Variety of plant, animal and microbial species that fulfil specific agronomic functions: fixing nitrogen, attracting pollinators, breaking pest cycles, breaking down residues.\n\nMore important than the total species count is the diversity of functions covered: legumes, grasses, brassicas, flowering plants, decomposers and pollinators. Functional biodiversity reduces dependence on external inputs.",
        context: "A metric you can log on regenerative parcels and communicate to the end consumer.",
      },
    },
  },
  {
    slug: "compactacion-suelo",
    category: "soil",
    related: ["labranza-cero", "biologia-suelo"],
    dateUpdated: "2026-04-15",
    translations: {
      es: {
        title: "Compactación del suelo",
        definition: "Aumento de la densidad aparente del suelo por presión mecánica (maquinaria pesada, pisoteo del ganado), que reduce porosidad, infiltración de agua y crecimiento radicular.\n\nSe diagnostica con penetrómetro o pala recta: si la raíz no atraviesa los primeros 30 cm, hay capa compactada. Se previene con cobertura permanente, raíces profundas (rabanitos forrajeros, alfalfa) y manejo del tránsito en condiciones de humedad correctas.",
        context: "Indicador agronómico clave que afecta directamente la productividad de la parcela.",
      },
      en: {
        title: "Soil compaction",
        definition: "Increase in soil bulk density caused by mechanical pressure (heavy machinery, livestock trampling) that reduces porosity, water infiltration and root growth.\n\nDiagnosed with a penetrometer or a straight spade: if the root cannot get through the top 30 cm, you have a compacted layer. Prevented through permanent cover, deep roots (forage radish, alfalfa) and traffic management at the right soil moisture.",
        context: "Key agronomic indicator that directly affects parcel productivity.",
      },
    },
  },
  {
    slug: "infiltracion-agua",
    category: "soil",
    related: ["compactacion-suelo", "cobertura-permanente"],
    relatedIndices: ["ndmi", "ndwi"],
    dateUpdated: "2026-04-15",
    translations: {
      es: {
        title: "Infiltración de agua",
        definition: "Velocidad con la que el agua de lluvia o riego entra al suelo y se mueve hacia capas profundas, expresada en mm/hora. Una buena infiltración reduce escurrimiento y erosión, y aumenta el agua disponible para el cultivo.\n\nSuelos regenerativos con alta materia orgánica y agregados estables suelen infiltrar 5–10× más rápido que suelos degradados. Se mide en campo con anillo simple o doble, o se infiere por el comportamiento del suelo después de tormentas intensas.",
        context: "AgRegen permite registrar mediciones de infiltración como parte del seguimiento regenerativo.",
      },
      en: {
        title: "Water infiltration",
        definition: "Rate at which rainfall or irrigation water enters the soil and moves toward deeper layers, expressed in mm/hour. Good infiltration reduces runoff and erosion and raises crop-available water.\n\nRegenerative soils with high organic matter and stable aggregates typically infiltrate 5–10× faster than degraded soils. Measured in the field with a single or double ring, or inferred from how the soil behaves after intense storms.",
        context: "AgRegen lets you log infiltration measurements as part of regenerative tracking.",
      },
    },
  },
  {
    slug: "agricultura-precision",
    category: "method",
    related: ["mvz", "muestreo-suelo", "zonas-manejo"],
    relatedIndices: ["ndvi"],
    dateUpdated: "2026-04-15",
    translations: {
      es: {
        title: "Agricultura de precisión",
        definition: "Conjunto de técnicas que ajustan las decisiones agronómicas (siembra, fertilización, riego, cosecha) a la variabilidad espacial y temporal de la parcela, usando datos georreferenciados (suelo, satélite, rendimiento, clima).\n\nNo se trata sólo de tecnología: requiere capturar información a la escala correcta y traducirla en prácticas accionables. La agricultura regenerativa y la de precisión se complementan: la precisión optimiza insumos, la regeneración mejora el suelo subyacente.",
        context: "AgRegen es una plataforma de precisión orientada explícitamente a un horizonte regenerativo.",
      },
      en: {
        title: "Precision agriculture",
        definition: "Set of techniques that tune agronomic decisions (sowing, fertilising, irrigating, harvesting) to the spatial and temporal variability of the parcel, using geo-referenced data (soil, satellite, yield, climate).\n\nIt is not just technology: it requires capturing information at the right scale and turning it into actionable practices. Regenerative and precision agriculture complement each other: precision optimises inputs, regeneration improves the underlying soil.",
        context: "AgRegen is a precision platform explicitly oriented to a regenerative horizon.",
      },
    },
  },
  {
    slug: "prescripcion-variable",
    category: "mvz",
    related: ["mvz", "zonas-manejo", "agricultura-precision"],
    dateUpdated: "2026-04-15",
    translations: {
      es: {
        title: "Prescripción variable",
        definition: "Mapa georreferenciado que indica al equipo (sembradora, fertilizadora, pulverizador) qué dosis aplicar en cada punto del lote según la zona de manejo. Se entrega típicamente como shapefile o ISO-XML que carga la consola del equipo.\n\nLa prescripción debe definir: variable a aplicar (semilla, urea, fósforo), unidad (kg/ha, semillas/m), dosis por zona, márgenes de transición y, opcionalmente, mínimos y máximos de protección.",
        context: "AgRegen genera prescripciones variables exportables en los formatos más comunes desde el módulo de Manejo Variable por Zonas.",
      },
      en: {
        title: "Variable-rate prescription",
        definition: "Geo-referenced map that tells the equipment (planter, spreader, sprayer) which dose to apply at each point of the field based on its management zone. Delivered typically as a shapefile or ISO-XML that the equipment's console loads.\n\nA prescription must define: variable to apply (seed, urea, phosphorus), unit (kg/ha, seeds/m), dose per zone, transition margins and, optionally, protective min/max thresholds.",
        context: "AgRegen generates exportable variable-rate prescriptions in the most common formats from the VRA module.",
      },
    },
  },
  {
    slug: "ndvi-temporal",
    category: "monitoring",
    related: ["fenologia", "estres-hidrico", "sentinel-2"],
    relatedIndices: ["ndvi", "evi"],
    dateUpdated: "2026-04-15",
    translations: {
      es: {
        title: "Curva temporal de NDVI",
        definition: "Sucesión de valores de NDVI calculados en una misma parcela a lo largo de la campaña, típicamente uno cada 5–10 días. Su forma reproduce la fenología del cultivo: crecimiento, plateau de máximo verdor, senescencia.\n\nDesviaciones de la curva esperada (pico tardío, valle inesperado, asimetría) son indicadores tempranos de estrés hídrico, plagas o problemas de fertilidad. Comparada contra una referencia histórica, permite detectar anomalías sin necesidad de visita a campo.",
        context: "AgRegen genera la curva temporal por parcela y la compara con la fenología esperada y con campañas anteriores.",
      },
      en: {
        title: "NDVI time series",
        definition: "Sequence of NDVI values computed on the same parcel over the season, typically one every 5–10 days. Its shape reproduces the crop's phenology: growth, peak greenness plateau, senescence.\n\nDeviations from the expected curve (late peak, unexpected dip, asymmetry) are early indicators of water stress, pests or fertility issues. Compared against a historical baseline, it lets you detect anomalies without a field visit.",
        context: "AgRegen builds the time series per parcel and compares it against expected phenology and previous seasons.",
      },
    },
  },
  {
    slug: "alerta-temprana",
    category: "monitoring",
    related: ["estres-hidrico", "ndvi-temporal", "fenologia"],
    relatedIndices: ["ndmi", "msi", "ndvi"],
    dateUpdated: "2026-04-15",
    translations: {
      es: {
        title: "Alerta temprana agronómica",
        definition: "Notificación generada automáticamente por el sistema cuando un indicador (NDVI, NDMI, GDD, lluvia acumulada) cae fuera del rango esperado para la etapa fenológica actual del cultivo en esa parcela.\n\nLas alertas son útiles sólo si son específicas, accionables y de baja frecuencia (sin spam). AgRegen calibra el umbral por parcela y por cultivo para minimizar falsos positivos.",
        context: "Centro de alertas de AgRegen, accesible desde el dashboard y vía email opcional.",
      },
      en: {
        title: "Early agronomic alert",
        definition: "Notification raised automatically when an indicator (NDVI, NDMI, GDD, accumulated rain) falls outside the expected range for the crop's current phenological stage on that parcel.\n\nAlerts are only useful when they are specific, actionable and infrequent (no spam). AgRegen calibrates the threshold per parcel and per crop to minimise false positives.",
        context: "AgRegen alert centre, accessible from the dashboard and optionally by email.",
      },
    },
  },
];

export function findGlossaryTerm(slug: string): GlossaryTerm | undefined {
  return GLOSSARY_TERMS.find((t) => t.slug === slug);
}

export function getGlossaryContent(
  term: GlossaryTerm,
  locale: GlossaryLocale,
): { content: GlossaryTermContent; isFallback: boolean } {
  const c = term.translations[locale];
  if (c) return { content: c, isFallback: false };
  // Fallback to Spanish (source). Renderer adds noindex when isFallback === true.
  return { content: term.translations.es!, isFallback: true };
}

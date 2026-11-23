/**
 * SSR para `/casos` y `/casos/:slug` (Fase 3 SEO).
 *
 * Renderiza casos reales sobre parcelas marcadas `isPublic=true` con
 * datos sanitizados. La curva NDVI real se dibuja como SVG inline (sin
 * JS). Los esquemas son ItemList (hub) y Article + Dataset +
 * BreadcrumbList (detalle).
 */

import {
  buildShellHtml,
  getShellChrome,
  SEO_LOCALES,
  type SeoLocale,
} from "./shell";
import {
  getCaseHubItems,
  findCase,
  type CaseRecord,
  type CaseSeries,
  type CaseHubItem,
  PRACTICE_LABELS,
  PRACTICE_KEYS,
  regionToSlug,
} from "./cases-data";
import { CROPS, findCrop, getCropCurveData, tr, type CropLocale } from "./crops-data";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function escapeAttr(s: string): string { return escapeHtml(s); }

interface RenderArgs {
  template: string;
  origin: string;
  pathname: string;
  locale: SeoLocale;
  /** Querystring parameters from the request (sólo se usa en hub para ?cultivo=). */
  query?: Record<string, string | string[] | undefined>;
}
export interface RenderOutput { html: string; status?: number; }

interface CasesStrings {
  hubTitle: string;
  hubDescription: string;
  hubH1: string;
  hubIntro: string;
  hubEmpty: string;
  hubSeeCase: string;
  hubAreaLabel: string;
  hubLastDataLabel: string;
  detailRegion: string;
  detailCrop: string;
  detailArea: string;
  detailPlanted: string;
  detailIrrigation: string;
  detailLastMeasurement: string;
  detailEvolutionTitle: string;
  detailEvolutionCaption: string;
  detailIdealVsActual: string;
  detailNumPoints: (n: number) => string;
  detailDataSource: string;
  detailRelatedCrop: string;
  detailPracticesTitle: string;
  detailPracticesEmpty: string;
  detailOutcomesTitle: string;
  detailOutcomePeak: string;
  detailOutcomeAvg: string;
  detailOutcomeDays: string;
  detailOutcomeMeasurements: string;
  hubFilterAll: string;
  hubFilterCrop: string;
  hubFilterRegion: string;
  hubFilterPractice: string;
  hubFilterEmpty: string;
  ctaCallout: string;
  ctaButton: string;
  back: string;
  notFoundTitle: string;
  notFoundIntro: string;
  contentInSpanishNotice: string;
  curveAxisDate: string;
  curveAxisNdvi: string;
  curveLegendActual: string;
  curveLegendIdeal: string;
}

const CASES_STRINGS: Record<SeoLocale, CasesStrings> = {
  es: {
    hubTitle: "Casos reales de monitoreo satelital regenerativo | AgRegen",
    hubDescription: "Parcelas reales monitoreadas con AgRegen: evolución NDVI medida con Sentinel-2, prácticas declaradas y resultados. Datos compartidos por los productores que decidieron hacerlos públicos.",
    hubH1: "Casos reales monitoreados por satélite",
    hubIntro: "Estas son parcelas reales que sus productores decidieron compartir públicamente. Cada caso muestra la evolución NDVI medida con Sentinel-2 y las prácticas regenerativas declaradas. Sin coordenadas exactas, sin datos personales — sólo lo necesario para aprender de cada experiencia.",
    hubEmpty: "Aún no hay casos públicos. Los primeros aparecerán acá cuando los productores marquen sus parcelas como públicas.",
    hubSeeCase: "Ver caso",
    hubAreaLabel: "ha",
    hubLastDataLabel: "Última medición",
    detailRegion: "Región",
    detailCrop: "Cultivo",
    detailArea: "Superficie",
    detailPlanted: "Fecha de siembra",
    detailIrrigation: "Sistema de riego",
    detailLastMeasurement: "Última medición",
    detailEvolutionTitle: "Evolución del NDVI",
    detailEvolutionCaption: "NDVI medido con Sentinel-2 a lo largo del ciclo del cultivo. Datos suministrados por el productor a través de AgRegen.",
    detailIdealVsActual: "Comparación contra la curva ideal",
    detailNumPoints: (n) => `${n} mediciones disponibles`,
    detailDataSource: "Fuente: Sentinel-2 vía Google Earth Engine, agregado por AgRegen.",
    detailRelatedCrop: "Más sobre este cultivo",
    detailPracticesTitle: "Prácticas regenerativas declaradas",
    detailPracticesEmpty: "El productor todavía no declaró prácticas regenerativas para esta parcela.",
    detailOutcomesTitle: "Resultados observados",
    detailOutcomePeak: "Pico NDVI",
    detailOutcomeAvg: "NDVI promedio",
    detailOutcomeDays: "Cobertura temporal",
    detailOutcomeMeasurements: "Mediciones disponibles",
    hubFilterAll: "Todos los cultivos",
    hubFilterCrop: "Filtrar por cultivo",
    hubFilterRegion: "Filtrar por región",
    hubFilterPractice: "Filtrar por práctica",
    hubFilterEmpty: "No hay casos públicos para este cultivo todavía.",
    ctaCallout: "Si llevás una parcela y querés compartir tus resultados, AgRegen es libre y abierto.",
    ctaButton: "Empezá gratis",
    back: "← Volver a casos",
    notFoundTitle: "Caso no encontrado | AgRegen",
    notFoundIntro: "El caso que buscás ya no está disponible o nunca fue público.",
    contentInSpanishNotice: "Este caso aún no está traducido a tu idioma. Mostramos los textos descriptivos en español.",
    curveAxisDate: "Fecha",
    curveAxisNdvi: "NDVI",
    curveLegendActual: "NDVI medido",
    curveLegendIdeal: "NDVI ideal",
  },
  en: {
    hubTitle: "Real cases of satellite regenerative monitoring | AgRegen",
    hubDescription: "Real parcels monitored with AgRegen: Sentinel-2 NDVI evolution, declared practices and results. Data shared by farmers who chose to make it public.",
    hubH1: "Real satellite-monitored cases",
    hubIntro: "These are real parcels whose farmers chose to share publicly. Each case shows the Sentinel-2 NDVI evolution and the declared regenerative practices. No exact coordinates, no personal data — only what is needed to learn from each experience.",
    hubEmpty: "No public cases yet. The first ones will appear here when farmers mark their parcels as public.",
    hubSeeCase: "View case",
    hubAreaLabel: "ha",
    hubLastDataLabel: "Last measurement",
    detailRegion: "Region",
    detailCrop: "Crop",
    detailArea: "Area",
    detailPlanted: "Planting date",
    detailIrrigation: "Irrigation system",
    detailLastMeasurement: "Last measurement",
    detailEvolutionTitle: "NDVI evolution",
    detailEvolutionCaption: "Sentinel-2 NDVI measured along the crop cycle. Data supplied by the farmer through AgRegen.",
    detailIdealVsActual: "Comparison against the ideal curve",
    detailNumPoints: (n) => `${n} available measurements`,
    detailDataSource: "Source: Sentinel-2 via Google Earth Engine, aggregated by AgRegen.",
    detailRelatedCrop: "More on this crop",
    detailPracticesTitle: "Declared regenerative practices",
    detailPracticesEmpty: "The farmer hasn't declared regenerative practices for this parcel yet.",
    detailOutcomesTitle: "Observed outcomes",
    detailOutcomePeak: "NDVI peak",
    detailOutcomeAvg: "NDVI average",
    detailOutcomeDays: "Time coverage",
    detailOutcomeMeasurements: "Measurements available",
    hubFilterAll: "All crops",
    hubFilterCrop: "Filter by crop",
    hubFilterRegion: "Filter by region",
    hubFilterPractice: "Filter by practice",
    hubFilterEmpty: "No public cases for this crop yet.",
    ctaCallout: "If you manage a parcel and want to share your results, AgRegen is free and open source.",
    ctaButton: "Get started free",
    back: "← Back to cases",
    notFoundTitle: "Case not found | AgRegen",
    notFoundIntro: "The case you are looking for is no longer available or was never public.",
    contentInSpanishNotice: "This case is not translated to your language yet. We show descriptive text in Spanish.",
    curveAxisDate: "Date",
    curveAxisNdvi: "NDVI",
    curveLegendActual: "Measured NDVI",
    curveLegendIdeal: "Ideal NDVI",
  },
  pt: {
    hubTitle: "Casos reais de monitoramento por satélite regenerativo | AgRegen",
    hubDescription: "Parcelas reais monitoradas com AgRegen: evolução NDVI Sentinel-2, práticas declaradas e resultados.",
    hubH1: "Casos reais monitorados por satélite",
    hubIntro: "Parcelas reais cujos produtores decidiram compartilhar publicamente.",
    hubEmpty: "Ainda não há casos públicos.",
    hubSeeCase: "Ver caso",
    hubAreaLabel: "ha",
    hubLastDataLabel: "Última medição",
    detailRegion: "Região",
    detailCrop: "Cultivo",
    detailArea: "Área",
    detailPlanted: "Data de semeadura",
    detailIrrigation: "Sistema de irrigação",
    detailLastMeasurement: "Última medição",
    detailEvolutionTitle: "Evolução do NDVI",
    detailEvolutionCaption: "NDVI Sentinel-2 ao longo do ciclo do cultivo.",
    detailIdealVsActual: "Comparação com a curva ideal",
    detailNumPoints: (n) => `${n} medições disponíveis`,
    detailDataSource: "Fonte: Sentinel-2 via Google Earth Engine.",
    detailRelatedCrop: "Mais sobre este cultivo",
    detailPracticesTitle: "Práticas regenerativas declaradas",
    detailPracticesEmpty: "O produtor ainda não declarou práticas regenerativas para esta parcela.",
    detailOutcomesTitle: "Resultados observados",
    detailOutcomePeak: "Pico NDVI",
    detailOutcomeAvg: "NDVI médio",
    detailOutcomeDays: "Cobertura temporal",
    detailOutcomeMeasurements: "Medições disponíveis",
    hubFilterAll: "Todas as culturas",
    hubFilterCrop: "Filtrar por cultura",
    hubFilterRegion: "Filtrar por região",
    hubFilterPractice: "Filtrar por prática",
    hubFilterEmpty: "Ainda não há casos públicos para esta cultura.",
    ctaCallout: "AgRegen é livre e aberto.",
    ctaButton: "Comece grátis",
    back: "← Voltar a casos",
    notFoundTitle: "Caso não encontrado | AgRegen",
    notFoundIntro: "O caso que procura não está mais disponível.",
    contentInSpanishNotice: "Este caso ainda não foi traduzido ao seu idioma.",
    curveAxisDate: "Data",
    curveAxisNdvi: "NDVI",
    curveLegendActual: "NDVI medido",
    curveLegendIdeal: "NDVI ideal",
  },
  zh: {
    hubTitle: "卫星监测的再生农业真实案例 | AgRegen",
    hubDescription: "使用 AgRegen 监测的真实地块:Sentinel-2 NDVI 演变与已声明的实践。",
    hubH1: "卫星监测的真实案例",
    hubIntro: "由农户自愿公开的真实地块。",
    hubEmpty: "暂无公开案例。",
    hubSeeCase: "查看案例",
    hubAreaLabel: "公顷",
    hubLastDataLabel: "最近测量",
    detailRegion: "区域",
    detailCrop: "作物",
    detailArea: "面积",
    detailPlanted: "播种日期",
    detailIrrigation: "灌溉系统",
    detailLastMeasurement: "最近测量",
    detailEvolutionTitle: "NDVI 演变",
    detailEvolutionCaption: "Sentinel-2 NDVI 在整个生长周期中的演变。",
    detailIdealVsActual: "与理想曲线对比",
    detailNumPoints: (n) => `共 ${n} 次测量`,
    detailDataSource: "来源:Sentinel-2(Google Earth Engine)。",
    detailRelatedCrop: "更多关于该作物",
    detailPracticesTitle: "已声明的再生实践",
    detailPracticesEmpty: "农户尚未为此地块声明再生实践。",
    detailOutcomesTitle: "观察到的结果",
    detailOutcomePeak: "NDVI 峰值",
    detailOutcomeAvg: "NDVI 平均值",
    detailOutcomeDays: "时间覆盖",
    detailOutcomeMeasurements: "可用测量数",
    hubFilterAll: "所有作物",
    hubFilterCrop: "按作物筛选",
    hubFilterRegion: "按地区筛选",
    hubFilterPractice: "按实践筛选",
    hubFilterEmpty: "暂无该作物的公开案例。",
    ctaCallout: "AgRegen 是免费开源的。",
    ctaButton: "免费开始",
    back: "← 返回案例",
    notFoundTitle: "未找到案例 | AgRegen",
    notFoundIntro: "您查找的案例不再可用。",
    contentInSpanishNotice: "该案例尚未翻译为您的语言。",
    curveAxisDate: "日期",
    curveAxisNdvi: "NDVI",
    curveLegendActual: "实测 NDVI",
    curveLegendIdeal: "理想 NDVI",
  },
};

function hreflangsFor(origin: string, pathname: string) {
  return [
    ...SEO_LOCALES.map((l) => ({ locale: l, href: `${origin}${pathname}?lang=${l}` })),
    { locale: "x-default" as const, href: `${origin}${pathname}` },
  ];
}
function noindexMeta(): string { return `<meta name="robots" content="noindex" />`; }
function injectNoindex(html: string): string {
  return html.replace(/<\/head>/i, `${noindexMeta()}\n  </head>`);
}
function ctaButtonHtml(label: string): string {
  return `<p style="margin:2rem 0 0;"><a href="/auth" style="display:inline-block;background:#15803d;color:#fff;padding:0.7rem 1.4rem;border-radius:0.5rem;text-decoration:none;font-weight:600;">${escapeHtml(label)}</a></p>`;
}

/**
 * SVG con curva real (NDVI medido) + curva ideal (si conocemos el cultivo).
 * Eje X: días desde la primera medición disponible.
 */
function renderCaseCurve(c: CaseRecord, strings: CasesStrings, ariaLabel: string): string {
  const W = 640, H = 260;
  const pad = { l: 44, r: 16, t: 16, b: 36 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  const ndviPoints = c.series.filter((s) => s.ndvi !== null) as (CaseSeries & { ndvi: number })[];
  if (ndviPoints.length === 0) return "";

  const t0 = new Date(ndviPoints[0].date).getTime();
  const tEnd = new Date(ndviPoints[ndviPoints.length - 1].date).getTime();
  const totalDays = Math.max(1, (tEnd - t0) / (1000 * 60 * 60 * 24));
  const xs = (d: number) => pad.l + (d / totalDays) * innerW;
  const ys = (n: number) => pad.t + (1 - n) * innerH;

  const measured = ndviPoints
    .map((p) => {
      const d = (new Date(p.date).getTime() - t0) / (1000 * 60 * 60 * 24);
      return `${xs(d).toFixed(1)},${ys(p.ndvi).toFixed(1)}`;
    })
    .join(" ");

  // Curva ideal alineada al mismo dominio si conocemos el cultivo.
  let idealPoly = "";
  if (c.cropSlug) {
    const crop = findCrop(c.cropSlug);
    if (crop) {
      const curve = getCropCurveData(crop);
      const sorted = [...curve.stages].sort((a, b) => a.startDay - b.startDay);
      // Origen de "día 0" del cultivo: si tenemos plantingDate, lo usamos.
      let cropDay0 = t0;
      if (c.plantingDate) {
        const pd = new Date(c.plantingDate).getTime();
        if (!Number.isNaN(pd)) cropDay0 = pd;
      }
      const pts: { d: number; n: number }[] = [];
      for (const s of sorted) {
        pts.push({ d: s.startDay, n: s.ndviStart });
        pts.push({ d: s.endDay, n: s.ndviEnd });
      }
      idealPoly = pts
        .map((p) => {
          const dateMs = cropDay0 + p.d * 24 * 60 * 60 * 1000;
          const dDays = (dateMs - t0) / (1000 * 60 * 60 * 24);
          if (dDays < 0 || dDays > totalDays) return null;
          return `${xs(dDays).toFixed(1)},${ys(p.n).toFixed(1)}`;
        })
        .filter((s): s is string => Boolean(s))
        .join(" ");
    }
  }

  const yTicks = [0, 0.2, 0.4, 0.6, 0.8, 1.0]
    .map((n) => {
      const y = ys(n);
      return `<g><line x1="${pad.l}" y1="${y.toFixed(1)}" x2="${(W - pad.r).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e5e7eb" stroke-dasharray="2,3" /><text x="${(pad.l - 6).toFixed(1)}" y="${(y + 3).toFixed(1)}" font-size="10" text-anchor="end" fill="#64748b">${n.toFixed(1)}</text></g>`;
    })
    .join("");

  // Marcas en eje X: aprox 5 etiquetas equiespaciadas con fechas.
  const tickCount = 5;
  const xTicks: string[] = [];
  for (let i = 0; i <= tickCount; i++) {
    const d = (totalDays / tickCount) * i;
    const x = xs(d);
    const dateMs = t0 + d * 24 * 60 * 60 * 1000;
    const label = new Date(dateMs).toISOString().slice(0, 7); // yyyy-mm
    xTicks.push(`<g><line x1="${x.toFixed(1)}" y1="${(pad.t + innerH).toFixed(1)}" x2="${x.toFixed(1)}" y2="${(pad.t + innerH + 4).toFixed(1)}" stroke="#94a3b8" /><text x="${x.toFixed(1)}" y="${(pad.t + innerH + 16).toFixed(1)}" font-size="10" text-anchor="middle" fill="#64748b">${label}</text></g>`);
  }

  // Puntos de los datos medidos.
  const dots = ndviPoints
    .map((p) => {
      const d = (new Date(p.date).getTime() - t0) / (1000 * 60 * 60 * 24);
      return `<circle cx="${xs(d).toFixed(1)}" cy="${ys(p.ndvi).toFixed(1)}" r="2.5" fill="#15803d" />`;
    })
    .join("");

  return `
    <figure style="margin:1rem 0 1.5rem;">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeAttr(ariaLabel)}" style="width:100%;height:auto;background:#fff;border:1px solid #e5e7eb;border-radius:0.5rem;">
        ${yTicks}
        ${xTicks.join("")}
        ${idealPoly ? `<polyline points="${idealPoly}" fill="none" stroke="#94a3b8" stroke-width="2" stroke-dasharray="6,4" stroke-linejoin="round" />` : ""}
        <polyline points="${measured}" fill="none" stroke="#15803d" stroke-width="2.5" stroke-linejoin="round" />
        ${dots}
        <text x="${pad.l.toFixed(1)}" y="12" font-size="11" fill="#0f172a" font-weight="600">${escapeHtml(strings.curveAxisNdvi)}</text>
        <text x="${(W / 2).toFixed(1)}" y="${(pad.t + innerH + 30).toFixed(1)}" font-size="11" text-anchor="middle" fill="#0f172a" font-weight="600">${escapeHtml(strings.curveAxisDate)}</text>
      </svg>
      <figcaption style="font-size:0.85rem;color:#64748b;margin-top:0.5rem;">
        <span style="color:#15803d;font-weight:600;">━━</span> ${escapeHtml(strings.curveLegendActual)}
        ${idealPoly ? ` · <span style="color:#94a3b8;font-weight:600;">- - -</span> ${escapeHtml(strings.curveLegendIdeal)}` : ""}
      </figcaption>
    </figure>
  `;
}

// ── /casos (hub) ─────────────────────────────────────────────────────────────

export async function renderCasesHub(args: RenderArgs): Promise<RenderOutput> {
  const { template, origin, pathname, locale, query } = args;
  const strings = CASES_STRINGS[locale];
  const isFallbackLocale = locale === "pt" || locale === "zh";

  let allItems: CaseHubItem[];
  try {
    allItems = await getCaseHubItems();
  } catch (err) {
    console.error("[cases] hub load failed:", err);
    allItems = [];
  }

  // ── Filtros server-side (?cultivo / ?region / ?practica) ─────────────
  // El HTML que devolvemos es ya el filtrado. El canonical nunca cambia
  // y los chips llevan rel=nofollow, evitando canibalización en SERPs.
  const pickStr = (v: string | string[] | undefined): string =>
    (Array.isArray(v) ? v[0] : v)?.toLowerCase().trim() ?? "";

  const cropFilter = pickStr(query?.cultivo);
  const validCrop = CROPS.find((c) => c.slug === cropFilter)?.slug ?? "";

  // Conjunto de regiones disponibles (a partir de los datos reales) para
  // validar el ?region= recibido y para construir las chips.
  const regionMap = new Map<string, string>();
  for (const it of allItems) {
    if (it.regionSlug && !regionMap.has(it.regionSlug)) {
      regionMap.set(it.regionSlug, it.region);
    }
  }
  const regionFilter = pickStr(query?.region);
  const validRegion = regionMap.has(regionFilter) ? regionFilter : "";

  // Prácticas presentes en los datos.
  const practicesPresent = new Set<string>();
  for (const it of allItems) for (const p of it.practices) practicesPresent.add(p);
  const practiceFilter = pickStr(query?.practica);
  const validPractice =
    PRACTICE_KEYS.includes(practiceFilter) && practicesPresent.has(practiceFilter)
      ? practiceFilter
      : "";

  const items = allItems.filter((it) => {
    if (validCrop && it.cropSlug !== validCrop) return false;
    if (validRegion && it.regionSlug !== validRegion) return false;
    if (validPractice && !it.practices.includes(validPractice)) return false;
    return true;
  });

  // Canonical siempre apunta al hub raíz (sin querystring) para evitar
  // duplicados en buscadores; los filtros son una conveniencia UX.
  const canonical = `${origin}/casos`;

  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: strings.hubH1,
    numberOfItems: items.length,
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${origin}/casos/${it.slug}`,
      name: `${it.cropLabel} — ${it.region || "—"}`,
    })),
  };

  const cards = items.length === 0
    ? `<p style="padding:1.5rem;background:#fff;border:1px dashed #d1d5db;border-radius:0.5rem;color:#6b7280;text-align:center;">${escapeHtml(validCrop ? strings.hubFilterEmpty : strings.hubEmpty)}</p>`
    : items
        .map((it) => `
          <article style="border:1px solid #e5e7eb;border-radius:0.5rem;background:#fff;padding:1rem 1.25rem;">
            <h2 style="margin:0 0 0.25rem;font-size:1.1rem;color:#0f172a;"><a href="/casos/${escapeAttr(it.slug)}" style="color:#0f172a;text-decoration:none;">${escapeHtml(it.cropLabel)}${it.region ? ` — ${escapeHtml(it.region)}` : ""}</a></h2>
            <p style="margin:0 0 0.4rem;color:#64748b;font-size:0.85rem;">${it.areaHa.toFixed(1)} ${escapeHtml(strings.hubAreaLabel)}${it.lastMeasurementAt ? ` · ${escapeHtml(strings.hubLastDataLabel)}: ${escapeHtml(it.lastMeasurementAt)}` : ""}</p>
            <p style="margin:0;"><a href="/casos/${escapeAttr(it.slug)}" style="color:#15803d;font-weight:600;text-decoration:none;">${escapeHtml(strings.hubSeeCase)} →</a></p>
          </article>
        `)
        .join("");

  // Cultivos disponibles (con al menos 1 caso público).
  const availableCropSlugs = Array.from(
    new Set(
      allItems
        .map((it) => it.cropSlug)
        .filter((s): s is string => !!s && CROPS.some((c) => c.slug === s)),
    ),
  );
  const cropLocale = locale as CropLocale;

  // Construye la URL preservando los otros dos filtros activos. Si la chip
  // representa el valor "todos" (slug vacío) en su dimensión, esa dimensión
  // se omite. El URL final mantiene rel=nofollow porque el canonical
  // siempre apunta a `/casos` y no queremos indexar combinaciones.
  const buildHubUrl = (overrides: { cultivo?: string; region?: string; practica?: string }): string => {
    const params = new URLSearchParams();
    const cultivo = overrides.cultivo !== undefined ? overrides.cultivo : validCrop;
    const region = overrides.region !== undefined ? overrides.region : validRegion;
    const practica = overrides.practica !== undefined ? overrides.practica : validPractice;
    if (cultivo) params.set("cultivo", cultivo);
    if (region) params.set("region", region);
    if (practica) params.set("practica", practica);
    const qs = params.toString();
    return qs ? `/casos?${qs}` : "/casos";
  };

  const chip = (href: string, label: string, active: boolean, isAll: boolean): string =>
    `<a href="${escapeAttr(href)}" ${isAll ? "" : "rel=\"nofollow\""} style="display:inline-block;padding:0.35rem 0.85rem;border-radius:9999px;font-size:0.85rem;text-decoration:none;border:1px solid ${active ? "#15803d" : "#cbd5e1"};background:${active ? "#15803d" : "#fff"};color:${active ? "#fff" : "#0f172a"};font-weight:${active ? 600 : 500};">${escapeHtml(label)}</a>`;

  const renderChipRow = (label: string, chips: string): string => `
      <nav aria-label="${escapeAttr(label)}" style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;margin:0 0 0.75rem;">
        <span style="font-size:0.85rem;color:#64748b;font-weight:600;margin-right:0.25rem;">${escapeHtml(label)}:</span>
        ${chips}
      </nav>`;

  const cropChips = availableCropSlugs.length === 0
    ? ""
    : renderChipRow(
        strings.hubFilterCrop,
        chip(buildHubUrl({ cultivo: "" }), strings.hubFilterAll, !validCrop, true) +
          availableCropSlugs
            .map((s) => {
              const cropDef = CROPS.find((c) => c.slug === s)!;
              return chip(buildHubUrl({ cultivo: s }), tr(cropDef.name, cropLocale).value, validCrop === s, false);
            })
            .join(""),
      );

  const availableRegions = Array.from(regionMap.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  const regionChips = availableRegions.length <= 1
    ? ""
    : renderChipRow(
        strings.hubFilterRegion,
        chip(buildHubUrl({ region: "" }), strings.hubFilterAll, !validRegion, true) +
          availableRegions
            .map(([slug, label]) => chip(buildHubUrl({ region: slug }), label, validRegion === slug, false))
            .join(""),
      );

  const availablePractices = PRACTICE_KEYS.filter((p) => practicesPresent.has(p));
  const practiceChips = availablePractices.length === 0
    ? ""
    : renderChipRow(
        strings.hubFilterPractice,
        chip(buildHubUrl({ practica: "" }), strings.hubFilterAll, !validPractice, true) +
          availablePractices
            .map((p) => {
              const lbl = locale === "en" ? PRACTICE_LABELS[p].en : PRACTICE_LABELS[p].es;
              return chip(buildHubUrl({ practica: p }), lbl, validPractice === p, false);
            })
            .join(""),
      );

  const filterChips = `${cropChips}${regionChips}${practiceChips}` ? `<div style="margin:0 0 1.5rem;">${cropChips}${regionChips}${practiceChips}</div>` : "";

  const hubBody = `
    <section style="max-width:64rem;margin:0 auto;padding:1rem 1.5rem 2rem;">
      ${filterChips}
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(20rem,1fr));gap:1rem;">
        ${cards}
      </div>
    </section>
  `;

  let html = buildShellHtml({
    template,
    locale,
    title: strings.hubTitle,
    description: strings.hubDescription,
    canonical,
    hreflangs: hreflangsFor(origin, pathname),
    schemas: [itemList],
    ogImage: `${origin}/opengraph.jpg`,
    pathname,
    h1: strings.hubH1,
    intro: strings.hubIntro,
    bullets: items.slice(0, 6).map((it) => `${it.cropLabel}${it.region ? ` — ${it.region}` : ""}`),
    ctaText: strings.ctaButton,
    chrome: getShellChrome(locale),
    mode: "pure-ssr",
  });
  html = html.replace(/(<\/main>\s*)(<footer)/i, `</main>${hubBody}$2`);
  if (isFallbackLocale || items.length === 0) html = injectNoindex(html);
  return { html };
}

// ── /casos/:slug ─────────────────────────────────────────────────────────────

function notFoundResponse(template: string, origin: string, pathname: string, locale: SeoLocale): RenderOutput {
  const strings = CASES_STRINGS[locale];
  const html = buildShellHtml({
    template,
    locale,
    title: strings.notFoundTitle,
    description: strings.notFoundIntro,
    canonical: `${origin}${pathname}`,
    hreflangs: hreflangsFor(origin, pathname),
    schemas: [],
    ogImage: `${origin}/opengraph.jpg`,
    pathname,
    h1: strings.notFoundTitle,
    intro: strings.notFoundIntro,
    bullets: [],
    ctaText: strings.ctaButton,
    chrome: getShellChrome(locale),
    mode: "pure-ssr",
  });
  return { html: injectNoindex(html), status: 404 };
}

export async function renderCaseDetail(args: RenderArgs & { slug: string }): Promise<RenderOutput> {
  const { template, origin, pathname, locale, slug } = args;
  const strings = CASES_STRINGS[locale];
  const cropLocale = locale as CropLocale;
  let c: CaseRecord | null;
  try {
    c = await findCase(slug);
  } catch (err) {
    console.error("[cases] case load failed:", err);
    return notFoundResponse(template, origin, pathname, locale);
  }
  if (!c) return notFoundResponse(template, origin, pathname, locale);

  const canonical = `${origin}${pathname}`;
  const isFallbackLocale = locale === "pt" || locale === "zh";

  const ndviCount = c.series.filter((s) => s.ndvi !== null).length;
  const headline = `${c.cropLabel}${c.region ? ` — ${c.region}` : ""}`;
  const intro = `Caso real con ${ndviCount} mediciones NDVI Sentinel-2 sobre ${c.areaHa.toFixed(1)} ha.`;

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${origin}/` },
      { "@type": "ListItem", position: 2, name: strings.hubH1, item: `${origin}/casos` },
      { "@type": "ListItem", position: 3, name: headline, item: canonical },
    ],
  };

  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline,
    description: intro,
    inLanguage: isFallbackLocale ? "es" : locale,
    dateModified: c.lastMeasurementAt ?? undefined,
    author: { "@type": "Organization", name: "AgRegen" },
    publisher: { "@type": "Organization", name: "AgRegen", url: origin },
    mainEntityOfPage: canonical,
  };

  const datasetSchema = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `NDVI Sentinel-2 — ${headline}`,
    description: `Serie temporal de NDVI medido sobre la parcela. ${ndviCount} puntos.`,
    creator: { "@type": "Organization", name: "AgRegen" },
    license: "https://creativecommons.org/licenses/by-sa/4.0/",
    isAccessibleForFree: true,
    variableMeasured: ["NDVI", "EVI", "Soil moisture"],
    distribution: {
      "@type": "DataDownload",
      encodingFormat: "text/html",
      contentUrl: canonical,
    },
    temporalCoverage: c.lastMeasurementAt
      ? `${c.series.filter((s) => s.ndvi !== null)[0]?.date}/${c.lastMeasurementAt}`
      : undefined,
  };

  const cropDef = c.cropSlug ? findCrop(c.cropSlug) : null;
  const cropName = cropDef ? tr(cropDef.name, cropLocale).value : c.cropLabel;
  const relatedCropLink = c.cropSlug
    ? `<p style="margin:1.5rem 0 0;color:#475569;"><a href="/cultivos/${escapeAttr(c.cropSlug)}" style="color:#15803d;font-weight:600;">${escapeHtml(strings.detailRelatedCrop)}: ${escapeHtml(cropName)} →</a></p>`
    : "";

  const meta = [
    c.region ? { k: strings.detailRegion, v: c.region } : null,
    { k: strings.detailCrop, v: cropName },
    { k: strings.detailArea, v: `${c.areaHa.toFixed(1)} ha` },
    c.plantingDate ? { k: strings.detailPlanted, v: c.plantingDate } : null,
    { k: strings.detailIrrigation, v: c.irrigationSystem },
    c.lastMeasurementAt ? { k: strings.detailLastMeasurement, v: c.lastMeasurementAt } : null,
  ].filter((x): x is { k: string; v: string } => Boolean(x));

  const detailBody = `
    <article style="max-width:48rem;margin:0 auto;padding:1rem 1.5rem 3rem;color:#1f2937;line-height:1.7;">
      <p style="margin:0 0 1rem;"><a href="/casos" style="color:#15803d;text-decoration:none;">${escapeHtml(strings.back)}</a></p>
      ${isFallbackLocale ? `<p style="background:#fef9c3;border-left:4px solid #ca8a04;padding:0.6rem 1rem;border-radius:0.25rem;margin:0 0 1.25rem;font-size:0.95rem;">${escapeHtml(strings.contentInSpanishNotice)}</p>` : ""}

      <dl style="display:grid;grid-template-columns:max-content 1fr;gap:0.4rem 1rem;margin:0 0 1.5rem;color:#475569;">
        ${meta.map((m) => `<dt style="font-weight:600;color:#0f172a;">${escapeHtml(m.k)}</dt><dd style="margin:0;">${escapeHtml(m.v)}</dd>`).join("\n        ")}
      </dl>

      <h2 style="font-size:1.25rem;font-weight:700;color:#0f172a;margin:1.75rem 0 0.5rem;">${escapeHtml(strings.detailEvolutionTitle)}</h2>
      <p style="margin:0 0 0.75rem;color:#475569;">${escapeHtml(strings.detailNumPoints(ndviCount))}</p>
      ${renderCaseCurve(c, strings, `${strings.detailEvolutionTitle} — ${headline}`)}
      <p style="font-size:0.85rem;color:#64748b;margin:0;">${escapeHtml(strings.detailEvolutionCaption)}</p>
      <p style="font-size:0.85rem;color:#64748b;margin:0.25rem 0 0;">${escapeHtml(strings.detailDataSource)}</p>

      <h2 style="font-size:1.25rem;font-weight:700;color:#0f172a;margin:1.75rem 0 0.5rem;">${escapeHtml(strings.detailPracticesTitle)}</h2>
      ${
        c.practices.length > 0
          ? `<ul style="margin:0 0 1rem;padding-left:1.25rem;color:#374151;">
              ${c.practices
                .map((p) => {
                  const lbl = PRACTICE_LABELS[p]
                    ? locale === "en" ? PRACTICE_LABELS[p].en : PRACTICE_LABELS[p].es
                    : p;
                  return `<li>${escapeHtml(lbl)}</li>`;
                })
                .join("\n              ")}
            </ul>`
          : `<p style="margin:0 0 1rem;color:#64748b;font-style:italic;">${escapeHtml(strings.detailPracticesEmpty)}</p>`
      }

      <h2 style="font-size:1.25rem;font-weight:700;color:#0f172a;margin:1.75rem 0 0.5rem;">${escapeHtml(strings.detailOutcomesTitle)}</h2>
      <dl style="display:grid;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));gap:0.75rem;margin:0 0 1rem;">
        <div style="background:#f1f5f9;padding:0.75rem 1rem;border-radius:0.5rem;">
          <dt style="font-size:0.8rem;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.03em;">${escapeHtml(strings.detailOutcomePeak)}</dt>
          <dd style="margin:0.2rem 0 0;font-size:1.4rem;font-weight:700;color:#15803d;">${c.outcomes.ndviPeak.toFixed(2)}</dd>
        </div>
        <div style="background:#f1f5f9;padding:0.75rem 1rem;border-radius:0.5rem;">
          <dt style="font-size:0.8rem;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.03em;">${escapeHtml(strings.detailOutcomeAvg)}</dt>
          <dd style="margin:0.2rem 0 0;font-size:1.4rem;font-weight:700;color:#0f172a;">${c.outcomes.ndviAvg.toFixed(2)}</dd>
        </div>
        <div style="background:#f1f5f9;padding:0.75rem 1rem;border-radius:0.5rem;">
          <dt style="font-size:0.8rem;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.03em;">${escapeHtml(strings.detailOutcomeDays)}</dt>
          <dd style="margin:0.2rem 0 0;font-size:1.4rem;font-weight:700;color:#0f172a;">${c.outcomes.daysCovered} d</dd>
        </div>
        <div style="background:#f1f5f9;padding:0.75rem 1rem;border-radius:0.5rem;">
          <dt style="font-size:0.8rem;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.03em;">${escapeHtml(strings.detailOutcomeMeasurements)}</dt>
          <dd style="margin:0.2rem 0 0;font-size:1.4rem;font-weight:700;color:#0f172a;">${c.outcomes.measurements}</dd>
        </div>
      </dl>

      ${relatedCropLink}

      <p style="margin:2rem 0 0;background:#ecfdf5;border-left:4px solid #15803d;padding:0.75rem 1rem;border-radius:0.25rem;">${escapeHtml(strings.ctaCallout)}</p>
      ${ctaButtonHtml(strings.ctaButton)}
    </article>
  `;

  let html = buildShellHtml({
    template,
    locale,
    title: `${headline} — caso real monitoreado por satélite | AgRegen`,
    description: intro.slice(0, 160),
    canonical,
    hreflangs: hreflangsFor(origin, pathname),
    schemas: [articleSchema, datasetSchema, breadcrumbSchema],
    ogImage: `${origin}/opengraph.jpg`,
    pathname,
    h1: headline,
    intro,
    bullets: meta.slice(0, 5).map((m) => `${m.k}: ${m.v}`),
    ctaText: strings.ctaButton,
    chrome: getShellChrome(locale),
    mode: "pure-ssr",
  });
  html = html.replace(/(<\/main>\s*)(<footer)/i, `</main>${detailBody}$2`);
  if (isFallbackLocale) html = injectNoindex(html);
  return { html };
}

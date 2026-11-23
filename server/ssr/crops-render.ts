/**
 * SSR para el cluster "Cultivos" (Fase 3 SEO):
 *   - /cultivos                  hub
 *   - /cultivos/:slug            detalle de cultivo (con curva NDVI ideal)
 *   - /cultivos/:slug/:etapa     detalle por etapa fenológica
 *
 * Patrón: igual a `learn-render.ts` (buildShellHtml + inyectar `</main>`).
 * Las curvas NDVI se renderizan como SVG inline (sin JS) para que sean
 * indexables y accesibles. Los esquemas son Article + BreadcrumbList +
 * ItemList según corresponda. Idiomas no soportados (pt/zh) caen a
 * español con `noindex`.
 */

import {
  buildShellHtml,
  getShellChrome,
  SEO_LOCALES,
  type SeoLocale,
} from "./shell";
import {
  CROPS,
  findCrop,
  findCropStage,
  getCropCurveData,
  slugifyStage,
  tr,
  trArr,
  type CropEditorial,
  type CropLocale,
  type CropStageEditorial,
} from "./crops-data";
import { findGlossaryTerm, getGlossaryContent } from "./glossary-data";
import { findIndex } from "./indices-data";
import type { CropCurve, PhenologicalStage } from "../../client/src/lib/ideal-ndvi-curves";

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
}
export interface RenderOutput { html: string; status?: number; }

interface CropsStrings {
  hubTitle: string;
  hubDescription: string;
  hubH1: string;
  hubIntro: string;
  hubSeeAll: string;
  detailScientific: string;
  detailOrigin: string;
  detailIdealSoil: string;
  detailSummary: string;
  detailCurveTitle: string;
  detailCurveCaption: (crop: string) => string;
  detailStages: string;
  detailStagesIntro: string;
  detailRegen: string;
  detailRelatedGlossary: string;
  detailRelatedCases: string;
  detailRelatedIndices: string;
  stageRecommended: string;
  stageExpectation: string;
  stageIfBelow: string;
  stageIfAbove: string;
  stageBackToCrop: (crop: string) => string;
  stagesNavLabel: string;
  ctaCallout: string;
  ctaButton: string;
  back: string;
  updated: string;
  notFoundTitle: string;
  notFoundIntro: string;
  contentInSpanishNotice: string;
  cropsCardCycle: (days: number) => string;
  curveAxisDays: string;
  curveAxisNdvi: string;
  curveLegendIdeal: string;
}

const CROPS_STRINGS: Record<SeoLocale, CropsStrings> = {
  es: {
    hubTitle: "Cultivos y manejo regenerativo por satélite | AgRegen",
    hubDescription: "Manejo regenerativo por cultivo con monitoreo satelital: soja, maíz, trigo y girasol con curva NDVI ideal, etapas fenológicas e índices recomendados por etapa.",
    hubH1: "Cultivos y manejo regenerativo monitoreado por satélite",
    hubIntro: "Una página por cultivo con curva NDVI ideal real, etapas fenológicas y qué índices satelitales conviene mirar en cada una. Sin generalidades — sólo cultivos para los que tenemos datos verificados.",
    hubSeeAll: "Ver cultivo",
    detailScientific: "Nombre científico",
    detailOrigin: "Origen",
    detailIdealSoil: "Suelo ideal",
    detailSummary: "Resumen agronómico",
    detailCurveTitle: "Curva NDVI ideal",
    detailCurveCaption: (crop) => `Curva NDVI ideal de ${crop} a lo largo del ciclo del cultivo. Esta es la curva con la que AgRegen compara las mediciones satelitales reales para detectar desvíos.`,
    detailStages: "Etapas fenológicas",
    detailStagesIntro: "Cada etapa tiene índices satelitales recomendados y un rango esperado de NDVI. Las desviaciones respecto al rango disparan alertas en AgRegen.",
    detailRegen: "Prácticas regenerativas asociadas",
    detailRelatedGlossary: "Concepto del glosario",
    detailRelatedCases: "Casos reales con este cultivo",
    detailRelatedIndices: "Índices recomendados",
    stageRecommended: "Índices recomendados",
    stageExpectation: "Qué esperar",
    stageIfBelow: "Si NDVI está por debajo",
    stageIfAbove: "Si NDVI está por encima",
    stageBackToCrop: (crop) => `← Volver a ${crop}`,
    stagesNavLabel: "Etapas del cultivo",
    ctaCallout: "Generá la curva NDVI real de tu parcela y compará contra la ideal. AgRegen es libre y abierto.",
    ctaButton: "Empezá gratis",
    back: "← Volver a cultivos",
    updated: "Actualizado",
    notFoundTitle: "Cultivo no encontrado | AgRegen",
    notFoundIntro: "El cultivo o la etapa que buscás no está disponible.",
    contentInSpanishNotice: "Este cultivo todavía no está traducido a tu idioma. Mostramos el contenido en español.",
    cropsCardCycle: (d) => `Ciclo: ~${d} días`,
    curveAxisDays: "Días desde siembra",
    curveAxisNdvi: "NDVI",
    curveLegendIdeal: "NDVI ideal",
  },
  en: {
    hubTitle: "Crops and satellite regenerative management | AgRegen",
    hubDescription: "Per-crop regenerative management with satellite monitoring: soybean, maize, wheat and sunflower with ideal NDVI curve, phenological stages and per-stage recommended indices.",
    hubH1: "Crops and satellite-monitored regenerative management",
    hubIntro: "One page per crop with a real ideal NDVI curve, phenological stages and which satellite indices to check at each one. No generalities — only crops we have verified data for.",
    hubSeeAll: "View crop",
    detailScientific: "Scientific name",
    detailOrigin: "Origin",
    detailIdealSoil: "Ideal soil",
    detailSummary: "Agronomic summary",
    detailCurveTitle: "Ideal NDVI curve",
    detailCurveCaption: (crop) => `Ideal NDVI curve for ${crop} along the crop cycle. AgRegen compares actual satellite measurements against this curve to detect deviations.`,
    detailStages: "Phenological stages",
    detailStagesIntro: "Each stage has recommended satellite indices and an expected NDVI range. Deviations from the range trigger alerts in AgRegen.",
    detailRegen: "Associated regenerative practices",
    detailRelatedGlossary: "Glossary concept",
    detailRelatedCases: "Real-world cases with this crop",
    detailRelatedIndices: "Recommended indices",
    stageRecommended: "Recommended indices",
    stageExpectation: "What to expect",
    stageIfBelow: "If NDVI is below",
    stageIfAbove: "If NDVI is above",
    stageBackToCrop: (crop) => `← Back to ${crop}`,
    stagesNavLabel: "Crop stages",
    ctaCallout: "Generate your parcel's real NDVI curve and compare it against the ideal. AgRegen is free and open source.",
    ctaButton: "Get started free",
    back: "← Back to crops",
    updated: "Updated",
    notFoundTitle: "Crop not found | AgRegen",
    notFoundIntro: "The crop or stage you are looking for is not available.",
    contentInSpanishNotice: "This crop is not translated to your language yet. We are showing the Spanish content.",
    cropsCardCycle: (d) => `Cycle: ~${d} days`,
    curveAxisDays: "Days since sowing",
    curveAxisNdvi: "NDVI",
    curveLegendIdeal: "Ideal NDVI",
  },
  pt: {
    hubTitle: "Cultivos e manejo regenerativo via satélite | AgRegen",
    hubDescription: "Manejo regenerativo por cultivo com monitoramento por satélite: soja, milho, trigo e girassol com curva NDVI ideal e etapas fenológicas.",
    hubH1: "Cultivos e manejo regenerativo monitorado por satélite",
    hubIntro: "Uma página por cultivo com curva NDVI ideal real e etapas fenológicas.",
    hubSeeAll: "Ver cultivo",
    detailScientific: "Nome científico",
    detailOrigin: "Origem",
    detailIdealSoil: "Solo ideal",
    detailSummary: "Resumo agronômico",
    detailCurveTitle: "Curva NDVI ideal",
    detailCurveCaption: (crop) => `Curva NDVI ideal de ${crop} ao longo do ciclo do cultivo.`,
    detailStages: "Etapas fenológicas",
    detailStagesIntro: "Cada etapa tem índices satelitais recomendados e uma faixa esperada de NDVI.",
    detailRegen: "Práticas regenerativas associadas",
    detailRelatedGlossary: "Conceito do glossário",
    detailRelatedCases: "Casos reais com este cultivo",
    detailRelatedIndices: "Índices recomendados",
    stageRecommended: "Índices recomendados",
    stageExpectation: "O que esperar",
    stageIfBelow: "Se NDVI está abaixo",
    stageIfAbove: "Se NDVI está acima",
    stageBackToCrop: (crop) => `← Voltar para ${crop}`,
    stagesNavLabel: "Etapas do cultivo",
    ctaCallout: "Gere a curva NDVI real da sua parcela e compare com a ideal. AgRegen é livre e aberto.",
    ctaButton: "Comece grátis",
    back: "← Voltar para cultivos",
    updated: "Atualizado",
    notFoundTitle: "Cultivo não encontrado | AgRegen",
    notFoundIntro: "O cultivo ou etapa que procura não está disponível.",
    contentInSpanishNotice: "Este cultivo ainda não foi traduzido ao seu idioma. Mostramos o conteúdo em espanhol.",
    cropsCardCycle: (d) => `Ciclo: ~${d} dias`,
    curveAxisDays: "Dias desde a semeadura",
    curveAxisNdvi: "NDVI",
    curveLegendIdeal: "NDVI ideal",
  },
  zh: {
    hubTitle: "卫星监测的作物与再生管理 | AgRegen",
    hubDescription: "结合卫星监测的逐作物再生管理:大豆、玉米、小麦与向日葵,含理想 NDVI 曲线与物候期。",
    hubH1: "结合卫星监测的作物与再生管理",
    hubIntro: "每个作物一页,含真实的理想 NDVI 曲线与物候期。",
    hubSeeAll: "查看作物",
    detailScientific: "学名",
    detailOrigin: "起源",
    detailIdealSoil: "理想土壤",
    detailSummary: "农艺总结",
    detailCurveTitle: "理想 NDVI 曲线",
    detailCurveCaption: (crop) => `${crop} 在整个生长周期中的理想 NDVI 曲线。`,
    detailStages: "物候期",
    detailStagesIntro: "每个阶段都有推荐的卫星指数与预期的 NDVI 区间。",
    detailRegen: "关联的再生农业实践",
    detailRelatedGlossary: "术语表概念",
    detailRelatedCases: "该作物的真实案例",
    detailRelatedIndices: "推荐指数",
    stageRecommended: "推荐指数",
    stageExpectation: "可预期",
    stageIfBelow: "若 NDVI 低于",
    stageIfAbove: "若 NDVI 高于",
    stageBackToCrop: (crop) => `← 返回 ${crop}`,
    stagesNavLabel: "作物阶段",
    ctaCallout: "生成您地块真实的 NDVI 曲线并与理想曲线对比。AgRegen 是免费开源的。",
    ctaButton: "免费开始",
    back: "← 返回作物",
    updated: "更新于",
    notFoundTitle: "未找到作物 | AgRegen",
    notFoundIntro: "您查找的作物或阶段不可用。",
    contentInSpanishNotice: "该作物尚未翻译为您的语言。显示西班牙语内容。",
    cropsCardCycle: (d) => `周期:约 ${d} 天`,
    curveAxisDays: "播种后天数",
    curveAxisNdvi: "NDVI",
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
 * Curva NDVI como SVG inline. 600x260 viewport, ejes simples y polilínea
 * de la curva. Cada punto se construye iterando las etapas con
 * (startDay,ndviStart) y (endDay,ndviEnd) — los mismos datos que la app
 * usa en runtime.
 */
function renderCurveSvg(curve: CropCurve, strings: CropsStrings, ariaLabel: string): string {
  const W = 640, H = 260;
  const pad = { l: 44, r: 16, t: 16, b: 36 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  const points: { day: number; ndvi: number }[] = [];
  const sorted = [...curve.stages].sort((a, b) => a.startDay - b.startDay);
  for (const s of sorted) {
    points.push({ day: s.startDay, ndvi: s.ndviStart });
    points.push({ day: s.endDay, ndvi: s.ndviEnd });
  }
  const maxDay = Math.max(curve.cycleDays, ...points.map((p) => p.day));
  const xs = (d: number) => pad.l + (d / maxDay) * innerW;
  const ys = (n: number) => pad.t + (1 - n) * innerH;

  // Polilínea principal.
  const poly = points.map((p) => `${xs(p.day).toFixed(1)},${ys(p.ndvi).toFixed(1)}`).join(" ");

  // Bandas verticales por etapa con etiqueta corta.
  const bands = sorted.map((s, i) => {
    const x1 = xs(s.startDay), x2 = xs(s.endDay);
    const fill = i % 2 === 0 ? "#f1f5f4" : "#e7efe8";
    return `<rect x="${x1.toFixed(1)}" y="${pad.t}" width="${(x2 - x1).toFixed(1)}" height="${innerH}" fill="${fill}" />`;
  }).join("");

  const stageLabels = sorted.map((s) => {
    const xMid = (xs(s.startDay) + xs(s.endDay)) / 2;
    return `<text x="${xMid.toFixed(1)}" y="${(H - 6).toFixed(1)}" font-size="10" text-anchor="middle" fill="#475569">${escapeHtml(s.name)}</text>`;
  }).join("");

  // Ejes Y (NDVI 0..1 con marcas cada 0.2).
  const yTicks = [0, 0.2, 0.4, 0.6, 0.8, 1.0].map((n) => {
    const y = ys(n);
    return `<g><line x1="${pad.l}" y1="${y.toFixed(1)}" x2="${(W - pad.r).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e5e7eb" stroke-dasharray="2,3" /><text x="${(pad.l - 6).toFixed(1)}" y="${(y + 3).toFixed(1)}" font-size="10" text-anchor="end" fill="#64748b">${n.toFixed(1)}</text></g>`;
  }).join("");

  // Eje X (días, marcas cada ~30 días).
  const xTickStep = maxDay > 200 ? 30 : 20;
  const xTicks: string[] = [];
  for (let d = 0; d <= maxDay; d += xTickStep) {
    const x = xs(d);
    xTicks.push(`<g><line x1="${x.toFixed(1)}" y1="${(pad.t + innerH).toFixed(1)}" x2="${x.toFixed(1)}" y2="${(pad.t + innerH + 4).toFixed(1)}" stroke="#94a3b8" /><text x="${x.toFixed(1)}" y="${(pad.t + innerH + 16).toFixed(1)}" font-size="10" text-anchor="middle" fill="#64748b">${d}</text></g>`);
  }

  return `
    <figure style="margin:1rem 0 1.5rem;">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeAttr(ariaLabel)}" style="width:100%;height:auto;background:#fff;border:1px solid #e5e7eb;border-radius:0.5rem;">
        ${bands}
        ${yTicks}
        ${xTicks.join("")}
        <polyline points="${poly}" fill="none" stroke="#15803d" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
        <text x="${(pad.l).toFixed(1)}" y="12" font-size="11" fill="#0f172a" font-weight="600">${escapeHtml(strings.curveAxisNdvi)}</text>
        <text x="${(W / 2).toFixed(1)}" y="${(pad.t + innerH + 30).toFixed(1)}" font-size="11" text-anchor="middle" fill="#0f172a" font-weight="600">${escapeHtml(strings.curveAxisDays)}</text>
        ${stageLabels}
      </svg>
      <figcaption style="font-size:0.85rem;color:#64748b;margin-top:0.5rem;">${escapeHtml(strings.curveLegendIdeal)} · <span style="color:#15803d;font-weight:600;">━━</span></figcaption>
    </figure>
  `;
}

function findGlossaryLink(slug: string, locale: SeoLocale): { url: string; label: string } | null {
  const t = findGlossaryTerm(slug);
  if (!t) return null;
  const c = getGlossaryContent(t, locale).content;
  return { url: `/glosario/${t.slug}`, label: c.title };
}
function findIndexLink(slug: string, locale: SeoLocale): { url: string; label: string } | null {
  const i = findIndex(slug);
  if (!i) return null;
  return { url: `/indices/${i.slug}`, label: i.acronym };
}

// ── /cultivos (hub) ──────────────────────────────────────────────────────────

export function renderCropsHub(args: RenderArgs): RenderOutput {
  const { template, origin, pathname, locale } = args;
  const strings = CROPS_STRINGS[locale];
  const cropLocale = locale as CropLocale;
  const canonical = `${origin}${pathname}`;
  const isFallbackLocale = locale === "pt" || locale === "zh";

  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: strings.hubH1,
    numberOfItems: CROPS.length,
    itemListElement: CROPS.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${origin}/cultivos/${c.slug}`,
      name: tr(c.name, cropLocale).value,
    })),
  };

  const cards = CROPS.map((c) => {
    const name = tr(c.name, cropLocale).value;
    const summary = tr(c.summary, cropLocale).value.split("\n\n")[0];
    const curve = getCropCurveData(c);
    return `
      <article style="border:1px solid #e5e7eb;border-radius:0.5rem;background:#fff;padding:1.25rem 1.25rem 1rem;">
        <h2 style="margin:0 0 0.25rem;font-size:1.25rem;color:#0f172a;"><a href="/cultivos/${escapeAttr(c.slug)}" style="color:#0f172a;text-decoration:none;">${escapeHtml(name)}</a></h2>
        <p style="margin:0 0 0.5rem;color:#64748b;font-size:0.85rem;"><em>${escapeHtml(c.scientificName)}</em> · ${escapeHtml(strings.cropsCardCycle(curve.cycleDays))}</p>
        <p style="margin:0 0 0.75rem;color:#374151;line-height:1.55;">${escapeHtml(summary.length > 220 ? summary.slice(0, 220) + "…" : summary)}</p>
        <p style="margin:0;"><a href="/cultivos/${escapeAttr(c.slug)}" style="color:#15803d;font-weight:600;text-decoration:none;">${escapeHtml(strings.hubSeeAll)} →</a></p>
      </article>
    `;
  }).join("");

  const hubBody = `
    <section style="max-width:64rem;margin:0 auto;padding:1rem 1.5rem 2rem;">
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
    bullets: CROPS.map((c) => tr(c.name, cropLocale).value),
    ctaText: strings.ctaButton,
    chrome: getShellChrome(locale),
    mode: "pure-ssr",
  });
  html = html.replace(/(<\/main>\s*)(<footer)/i, `</main>${hubBody}$2`);
  if (isFallbackLocale) html = injectNoindex(html);
  return { html };
}

// ── /cultivos/:slug (detalle) ────────────────────────────────────────────────

function notFoundResponse(template: string, origin: string, pathname: string, locale: SeoLocale): RenderOutput {
  const strings = CROPS_STRINGS[locale];
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

export function renderCropDetail(args: RenderArgs & { slug: string }): RenderOutput {
  const { template, origin, pathname, locale, slug } = args;
  const strings = CROPS_STRINGS[locale];
  const cropLocale = locale as CropLocale;
  const crop = findCrop(slug);
  if (!crop) return notFoundResponse(template, origin, pathname, locale);

  const canonical = `${origin}${pathname}`;
  const name = tr(crop.name, cropLocale);
  const origin_ = tr(crop.origin, cropLocale);
  const soil = tr(crop.idealSoil, cropLocale);
  const summary = tr(crop.summary, cropLocale);
  const practices = trArr(crop.regenerativePractices, cropLocale);
  const curve = getCropCurveData(crop);
  const isFallback = name.isFallback || summary.isFallback;

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${origin}/` },
      { "@type": "ListItem", position: 2, name: strings.hubH1, item: `${origin}/cultivos` },
      { "@type": "ListItem", position: 3, name: name.value, item: canonical },
    ],
  };

  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: `${name.value} — manejo regenerativo y monitoreo satelital`,
    description: summary.value.split("\n\n")[0].slice(0, 200),
    inLanguage: isFallback ? "es" : locale,
    datePublished: crop.dateUpdated,
    dateModified: crop.dateUpdated,
    author: { "@type": "Organization", name: "AgRegen" },
    publisher: { "@type": "Organization", name: "AgRegen", url: origin },
    about: { "@type": "Thing", name: name.value, alternateName: crop.scientificName },
    mainEntityOfPage: canonical,
  };

  const itemListStages = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${name.value} — ${strings.detailStages}`,
    numberOfItems: crop.stages.length,
    itemListElement: crop.stages.map((s, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${origin}/cultivos/${crop.slug}/${s.slug}`,
      name: tr(s.name, cropLocale).value,
    })),
  };

  const summaryHtml = summary.value
    .split("\n\n")
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("\n      ");

  const stagesHtml = crop.stages
    .map((s, i) => {
      const stageName = tr(s.name, cropLocale).value;
      const expectation = tr(s.expectation, cropLocale).value;
      const indices = s.recommendedIndices
        .map((sl) => findIndexLink(sl, locale))
        .filter((x): x is { url: string; label: string } => Boolean(x))
        .map((l) => `<a href="${escapeAttr(l.url)}" style="color:#15803d;text-decoration:none;font-weight:600;">${escapeHtml(l.label)}</a>`)
        .join(" · ");
      const curveStage: PhenologicalStage | undefined = curve.stages.find((c) => c.name === s.sourceName);
      const range = curveStage
        ? `<span style="font-family:ui-monospace,monospace;color:#475569;">NDVI ${curveStage.ndviStart.toFixed(2)} → ${curveStage.ndviEnd.toFixed(2)} · día ${curveStage.startDay}–${curveStage.endDay}</span>`
        : "";
      return `
        <article style="border:1px solid #e5e7eb;border-radius:0.5rem;padding:1rem 1.25rem;background:#fff;">
          <h3 style="margin:0 0 0.4rem;font-size:1.05rem;color:#0f172a;"><a href="/cultivos/${escapeAttr(crop.slug)}/${escapeAttr(s.slug)}" style="color:#0f172a;text-decoration:none;">${i + 1}. ${escapeHtml(stageName)}</a></h3>
          <p style="margin:0 0 0.5rem;font-size:0.85rem;color:#64748b;">${range}</p>
          <p style="margin:0 0 0.5rem;color:#374151;line-height:1.55;">${escapeHtml(expectation)}</p>
          <p style="margin:0;font-size:0.9rem;color:#475569;"><strong>${escapeHtml(strings.stageRecommended)}:</strong> ${indices || "—"}</p>
        </article>
      `;
    })
    .join("");

  const glossaryLink = findGlossaryLink(crop.relatedGlossary, locale);

  const detailBody = `
    <article style="max-width:48rem;margin:0 auto;padding:1rem 1.5rem 3rem;color:#1f2937;line-height:1.7;">
      <p style="margin:0 0 1rem;"><a href="/cultivos" style="color:#15803d;text-decoration:none;">${escapeHtml(strings.back)}</a></p>
      ${isFallback ? `<p style="background:#fef9c3;border-left:4px solid #ca8a04;padding:0.6rem 1rem;border-radius:0.25rem;margin:0 0 1.25rem;font-size:0.95rem;">${escapeHtml(strings.contentInSpanishNotice)}</p>` : ""}

      <p style="margin:0 0 0.5rem;color:#475569;"><strong>${escapeHtml(strings.detailScientific)}:</strong> <em>${escapeHtml(crop.scientificName)}</em></p>
      <p style="margin:0 0 0.5rem;color:#475569;"><strong>${escapeHtml(strings.detailOrigin)}:</strong> ${escapeHtml(origin_.value)}</p>
      <p style="margin:0 0 1.25rem;color:#475569;"><strong>${escapeHtml(strings.detailIdealSoil)}:</strong> ${escapeHtml(soil.value)}</p>

      <h2 style="font-size:1.25rem;font-weight:700;color:#0f172a;margin:1.75rem 0 0.5rem;">${escapeHtml(strings.detailSummary)}</h2>
      ${summaryHtml}

      <h2 style="font-size:1.25rem;font-weight:700;color:#0f172a;margin:1.75rem 0 0.5rem;">${escapeHtml(strings.detailCurveTitle)}</h2>
      ${renderCurveSvg(curve, strings, strings.detailCurveCaption(name.value))}
      <p style="font-size:0.9rem;color:#64748b;margin:0;">${escapeHtml(strings.detailCurveCaption(name.value))}</p>

      <h2 style="font-size:1.25rem;font-weight:700;color:#0f172a;margin:1.75rem 0 0.5rem;">${escapeHtml(strings.detailStages)}</h2>
      <p style="margin:0 0 1rem;color:#475569;">${escapeHtml(strings.detailStagesIntro)}</p>
      <div style="display:grid;gap:0.75rem;">${stagesHtml}</div>

      <h2 style="font-size:1.25rem;font-weight:700;color:#0f172a;margin:1.75rem 0 0.5rem;">${escapeHtml(strings.detailRegen)}</h2>
      <ul style="list-style:disc;padding-left:1.25rem;margin:0;">
        ${practices.value.map((p) => `<li>${escapeHtml(p)}</li>`).join("\n        ")}
      </ul>

      ${
        glossaryLink
          ? `<p style="margin:1.5rem 0 0;color:#475569;"><strong>${escapeHtml(strings.detailRelatedGlossary)}:</strong> <a href="${escapeAttr(glossaryLink.url)}" style="color:#15803d;font-weight:600;">${escapeHtml(glossaryLink.label)}</a></p>`
          : ""
      }
      <p style="margin:0.5rem 0 0;color:#475569;"><a href="/casos?cultivo=${escapeAttr(crop.slug)}" rel="nofollow" style="color:#15803d;font-weight:600;">${escapeHtml(strings.detailRelatedCases)} (${escapeHtml(name.value)}) →</a></p>

      <p style="margin:2rem 0 0;background:#ecfdf5;border-left:4px solid #15803d;padding:0.75rem 1rem;border-radius:0.25rem;">${escapeHtml(strings.ctaCallout)}</p>
      ${ctaButtonHtml(strings.ctaButton)}
      <p style="margin:2rem 0 0;font-size:0.85rem;color:#6b7280;">${escapeHtml(strings.updated)}: ${escapeHtml(crop.dateUpdated)}</p>
    </article>
  `;

  let html = buildShellHtml({
    template,
    locale,
    title: `${name.value} — manejo regenerativo monitoreado por satélite | AgRegen`,
    description: summary.value.split("\n\n")[0].slice(0, 160),
    canonical,
    hreflangs: hreflangsFor(origin, pathname),
    schemas: [articleSchema, breadcrumbSchema, itemListStages],
    ogImage: `${origin}/opengraph.jpg`,
    pathname,
    h1: name.value,
    intro: summary.value.split("\n\n")[0],
    bullets: crop.stages.map((s) => tr(s.name, cropLocale).value),
    ctaText: strings.ctaButton,
    chrome: getShellChrome(locale),
    mode: "pure-ssr",
  });
  html = html.replace(/(<\/main>\s*)(<footer)/i, `</main>${detailBody}$2`);
  if (isFallback) html = injectNoindex(html);
  return { html };
}

// ── /cultivos/:slug/:etapa (detalle por etapa) ───────────────────────────────

export function renderCropStage(args: RenderArgs & { slug: string; etapa: string }): RenderOutput {
  const { template, origin, pathname, locale, slug, etapa } = args;
  const strings = CROPS_STRINGS[locale];
  const cropLocale = locale as CropLocale;

  const crop = findCrop(slug);
  if (!crop) return notFoundResponse(template, origin, pathname, locale);
  const found = findCropStage(crop, etapa);
  if (!found) return notFoundResponse(template, origin, pathname, locale);
  const { stage, curveStage } = found;

  const canonical = `${origin}${pathname}`;
  const cropName = tr(crop.name, cropLocale);
  const stageName = tr(stage.name, cropLocale);
  const expectation = tr(stage.expectation, cropLocale);
  const ifBelow = tr(stage.ifBelow, cropLocale);
  const ifAbove = tr(stage.ifAbove, cropLocale);
  const isFallback = cropName.isFallback || stageName.isFallback || expectation.isFallback;

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${origin}/` },
      { "@type": "ListItem", position: 2, name: strings.hubH1, item: `${origin}/cultivos` },
      { "@type": "ListItem", position: 3, name: cropName.value, item: `${origin}/cultivos/${crop.slug}` },
      { "@type": "ListItem", position: 4, name: stageName.value, item: canonical },
    ],
  };

  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: `${cropName.value} — ${stageName.value}: NDVI esperado e índices recomendados`,
    description: expectation.value.slice(0, 200),
    inLanguage: isFallback ? "es" : locale,
    datePublished: crop.dateUpdated,
    dateModified: crop.dateUpdated,
    author: { "@type": "Organization", name: "AgRegen" },
    publisher: { "@type": "Organization", name: "AgRegen", url: origin },
    isPartOf: { "@type": "Article", "@id": `${origin}/cultivos/${crop.slug}` },
    mainEntityOfPage: canonical,
  };

  const indicesLinks = stage.recommendedIndices
    .map((s) => findIndexLink(s, locale))
    .filter((x): x is { url: string; label: string } => Boolean(x));

  // Navegación entre etapas del mismo cultivo.
  const stageNav = crop.stages
    .map((s) => {
      const sn = tr(s.name, cropLocale).value;
      const isCurrent = s.slug === stage.slug;
      const style = isCurrent
        ? "background:#15803d;color:#fff;"
        : "background:#fff;color:#15803d;border:1px solid #15803d;";
      return `<a href="/cultivos/${escapeAttr(crop.slug)}/${escapeAttr(s.slug)}" style="display:inline-block;padding:0.35rem 0.7rem;border-radius:0.375rem;text-decoration:none;font-weight:600;font-size:0.85rem;${style}">${escapeHtml(sn)}</a>`;
    })
    .join(" ");

  const detailBody = `
    <article style="max-width:48rem;margin:0 auto;padding:1rem 1.5rem 3rem;color:#1f2937;line-height:1.7;">
      <p style="margin:0 0 1rem;"><a href="/cultivos/${escapeAttr(crop.slug)}" style="color:#15803d;text-decoration:none;">${escapeHtml(strings.stageBackToCrop(cropName.value))}</a></p>
      ${isFallback ? `<p style="background:#fef9c3;border-left:4px solid #ca8a04;padding:0.6rem 1rem;border-radius:0.25rem;margin:0 0 1.25rem;font-size:0.95rem;">${escapeHtml(strings.contentInSpanishNotice)}</p>` : ""}

      <nav aria-label="${escapeAttr(strings.stagesNavLabel)}" style="display:flex;flex-wrap:wrap;gap:0.4rem;margin:0 0 1.25rem;">${stageNav}</nav>

      <p style="margin:0 0 0.5rem;color:#475569;font-family:ui-monospace,monospace;">NDVI ${curveStage.ndviStart.toFixed(2)} → ${curveStage.ndviEnd.toFixed(2)} · día ${curveStage.startDay}–${curveStage.endDay}</p>

      <h2 style="font-size:1.15rem;font-weight:700;color:#0f172a;margin:1.25rem 0 0.4rem;">${escapeHtml(strings.stageExpectation)}</h2>
      <p>${escapeHtml(expectation.value)}</p>

      <h2 style="font-size:1.15rem;font-weight:700;color:#0f172a;margin:1.25rem 0 0.4rem;">${escapeHtml(strings.stageRecommended)}</h2>
      <ul style="list-style:disc;padding-left:1.25rem;margin:0;">
        ${indicesLinks.map((l) => `<li><a href="${escapeAttr(l.url)}" style="color:#15803d;font-weight:600;">${escapeHtml(l.label)}</a></li>`).join("\n        ") || "<li>—</li>"}
      </ul>

      <h2 style="font-size:1.15rem;font-weight:700;color:#0f172a;margin:1.25rem 0 0.4rem;">${escapeHtml(strings.stageIfBelow)}</h2>
      <p>${escapeHtml(ifBelow.value)}</p>

      <h2 style="font-size:1.15rem;font-weight:700;color:#0f172a;margin:1.25rem 0 0.4rem;">${escapeHtml(strings.stageIfAbove)}</h2>
      <p>${escapeHtml(ifAbove.value)}</p>

      <p style="margin:2rem 0 0;background:#ecfdf5;border-left:4px solid #15803d;padding:0.75rem 1rem;border-radius:0.25rem;">${escapeHtml(strings.ctaCallout)}</p>
      ${ctaButtonHtml(strings.ctaButton)}
      <p style="margin:2rem 0 0;font-size:0.85rem;color:#6b7280;">${escapeHtml(strings.updated)}: ${escapeHtml(crop.dateUpdated)}</p>
    </article>
  `;

  let html = buildShellHtml({
    template,
    locale,
    title: `${cropName.value} — ${stageName.value}: NDVI esperado e índices satelitales | AgRegen`,
    description: expectation.value.slice(0, 160),
    canonical,
    hreflangs: hreflangsFor(origin, pathname),
    schemas: [articleSchema, breadcrumbSchema],
    ogImage: `${origin}/opengraph.jpg`,
    pathname,
    h1: `${cropName.value} — ${stageName.value}`,
    intro: expectation.value,
    bullets: indicesLinks.map((l) => l.label),
    ctaText: strings.ctaButton,
    chrome: getShellChrome(locale),
    mode: "pure-ssr",
  });
  html = html.replace(/(<\/main>\s*)(<footer)/i, `</main>${detailBody}$2`);
  if (isFallback) html = injectNoindex(html);
  return { html };
}

// Reexports útiles para el sitemap.
export { CROPS, slugifyStage };
export type { CropEditorial, CropStageEditorial };

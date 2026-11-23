/**
 * SSR para los hubs y páginas detalle del cluster "Aprendé":
 * /glosario, /glosario/:slug, /indices, /indices/:slug.
 *
 * Cada función devuelve `{ html, status }`. El HTML se construye sobre
 * `buildShellHtml` (shell puro de Fase 1) más bloques específicos del
 * hub/detalle (búsqueda por letra en glosario, tabla comparativa de
 * índices, fórmula MathML, ramp de colores, etc.).
 *
 * Cuando una traducción no está disponible, se sirve el contenido en
 * español y se inyecta `<meta name="robots" content="noindex">` para no
 * poluir los índices de búsqueda con variantes vacías.
 */

import {
  buildShellHtml,
  getShellChrome,
  SEO_LOCALES,
  type SeoLocale,
} from "./shell";
import {
  GLOSSARY_TERMS,
  findGlossaryTerm,
  getGlossaryContent,
  type GlossaryLocale,
  type GlossaryTerm,
} from "./glossary-data";
import {
  SATELLITE_INDICES,
  findIndex,
  getIndexContent,
  type SatelliteIndex,
} from "./indices-data";
import { CROPS as CROPS_FOR_LINKS } from "./crops-data";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

interface RenderArgs {
  template: string;
  origin: string;
  pathname: string;
  locale: SeoLocale;
}

export interface RenderOutput {
  html: string;
  status?: number;
}

// ── Strings localizados de los hubs (no globales del shell, locales aquí) ────

interface LearnStrings {
  glossaryTitle: string;
  glossaryDescription: string;
  glossaryH1: string;
  glossaryIntro: string;
  glossaryFilterByLetter: string;
  glossaryAllTerms: string;
  indicesTitle: string;
  indicesDescription: string;
  indicesH1: string;
  indicesIntro: string;
  indicesTableHeaderName: string;
  indicesTableHeaderFormula: string;
  indicesTableHeaderRange: string;
  indicesTableHeaderSensitiveTo: string;
  indicesTableHeaderUseCase: string;
  detailAlternatives: string;
  detailFormula: string;
  detailBands: string;
  detailRange: string;
  detailColorScale: string;
  detailUseCases: string;
  detailPhenology: string;
  detailRelated: string;
  detailReference: string;
  detailContext: string;
  detailExample: string;
  detailExampleCaption: (date: string) => string;
  detailExampleAlt: (acronym: string) => string;
  ctaCallout: string;
  ctaButton: string;
  back: string;
  updated: string;
  notFoundTitle: string;
  notFoundIntro: string;
  contentInSpanishNotice: string;
}

const LEARN_STRINGS: Record<SeoLocale, LearnStrings> = {
  es: {
    glossaryTitle: "Glosario regenerativo y MVZ | AgRegen",
    glossaryDescription: "Definiciones agronómicas reales de agricultura regenerativa, monitoreo satelital y manejo variable. Escritas por gente que las usa.",
    glossaryH1: "Glosario regenerativo y de monitoreo",
    glossaryIntro: "Términos que usamos todos los días en AgRegen, definidos por agrónomos, no por bloggers genéricos. Cada entrada explica qué es, por qué importa para regenerar el suelo y cómo lo medimos en la plataforma.",
    glossaryFilterByLetter: "Filtrar por letra:",
    glossaryAllTerms: "Todos los términos",
    indicesTitle: "Índices satelitales para agricultura | AgRegen",
    indicesDescription: "NDVI, EVI, NDMI, NDWI, SAVI, MSI, NBR, BSI explicados con fórmula, bandas Sentinel-2 y casos reales. Generá cada índice gratis sobre tu parcela.",
    indicesH1: "Índices satelitales para agricultura",
    indicesIntro: "Una página por índice con la fórmula real, las bandas Sentinel-2 que usa, el rango típico y cuándo conviene cada uno. Si necesitás generar el mapa sobre tu parcela, AgRegen lo hace gratis.",
    indicesTableHeaderName: "Índice",
    indicesTableHeaderFormula: "Fórmula",
    indicesTableHeaderRange: "Rango",
    indicesTableHeaderSensitiveTo: "Sensible a",
    indicesTableHeaderUseCase: "Caso típico",
    detailAlternatives: "Índices alternativos",
    detailFormula: "Fórmula",
    detailBands: "Bandas Sentinel-2",
    detailRange: "Rango típico",
    detailColorScale: "Escala de interpretación",
    detailUseCases: "Casos de uso",
    detailPhenology: "Etapa fenológica",
    detailRelated: "Relacionado",
    detailReference: "Referencia",
    detailContext: "Por qué importa",
    detailExample: "Ejemplo real generado por AgRegen",
    detailExampleCaption: (date) => `Sentinel-2 L2A · parcela de prueba en la Pampa húmeda (Buenos Aires, Argentina) · imagen del ${date} · generado por AgRegen vía Google Earth Engine.`,
    detailExampleAlt: (acronym) => `Mapa ${acronym} sobre parcela de prueba en la Pampa húmeda generado por AgRegen.`,
    ctaCallout: "Generá este índice sobre tu parcela, gratis. AgRegen es libre y abierto.",
    ctaButton: "Empezá gratis",
    back: "← Volver",
    updated: "Actualizado",
    notFoundTitle: "Contenido no encontrado | AgRegen",
    notFoundIntro: "El término o índice que buscás no existe en nuestro glosario.",
    contentInSpanishNotice: "Esta entrada todavía no está traducida a tu idioma. Mostramos el contenido en español.",
  },
  en: {
    glossaryTitle: "Regenerative and VRA glossary | AgRegen",
    glossaryDescription: "Real agronomic definitions for regenerative agriculture, satellite monitoring and variable-rate management. Written by people who actually use them.",
    glossaryH1: "Regenerative and monitoring glossary",
    glossaryIntro: "Terms we use every day at AgRegen, defined by agronomists, not by generic bloggers. Each entry explains what it is, why it matters for regenerating soil and how we measure it on the platform.",
    glossaryFilterByLetter: "Filter by letter:",
    glossaryAllTerms: "All terms",
    indicesTitle: "Satellite indices for agriculture | AgRegen",
    indicesDescription: "NDVI, EVI, NDMI, NDWI, SAVI, MSI, NBR, BSI explained with formula, Sentinel-2 bands and real use cases. Generate each one free on your parcel.",
    indicesH1: "Satellite indices for agriculture",
    indicesIntro: "One page per index with the real formula, the Sentinel-2 bands it uses, the typical range and when each one fits best. If you need to generate the map on your parcel, AgRegen does it for free.",
    indicesTableHeaderName: "Index",
    indicesTableHeaderFormula: "Formula",
    indicesTableHeaderRange: "Range",
    indicesTableHeaderSensitiveTo: "Sensitive to",
    indicesTableHeaderUseCase: "Typical use",
    detailAlternatives: "Alternative indices",
    detailFormula: "Formula",
    detailBands: "Sentinel-2 bands",
    detailRange: "Typical range",
    detailColorScale: "Interpretation scale",
    detailUseCases: "Use cases",
    detailPhenology: "Phenological stage",
    detailRelated: "Related",
    detailReference: "Reference",
    detailContext: "Why it matters",
    detailExample: "Real example generated by AgRegen",
    detailExampleCaption: (date) => `Sentinel-2 L2A · test parcel in the Pampa Húmeda (Buenos Aires, Argentina) · image from ${date} · generated by AgRegen via Google Earth Engine.`,
    detailExampleAlt: (acronym) => `${acronym} map over a test parcel in the Pampa Húmeda generated by AgRegen.`,
    ctaCallout: "Generate this index on your parcel, free. AgRegen is open source.",
    ctaButton: "Get started free",
    back: "← Back",
    updated: "Updated",
    notFoundTitle: "Content not found | AgRegen",
    notFoundIntro: "The term or index you are looking for is not in our glossary.",
    contentInSpanishNotice: "This entry is not translated to your language yet. We are showing the Spanish content.",
  },
  pt: {
    glossaryTitle: "Glossário regenerativo e MVZ | AgRegen",
    glossaryDescription: "Definições agronômicas reais de agricultura regenerativa, monitoramento por satélite e manejo variável.",
    glossaryH1: "Glossário regenerativo e de monitoramento",
    glossaryIntro: "Termos que usamos todos os dias na AgRegen, definidos por agrônomos.",
    glossaryFilterByLetter: "Filtrar por letra:",
    glossaryAllTerms: "Todos os termos",
    indicesTitle: "Índices por satélite para agricultura | AgRegen",
    indicesDescription: "NDVI, EVI, NDMI e mais explicados com fórmula, bandas Sentinel-2 e casos reais.",
    indicesH1: "Índices por satélite para agricultura",
    indicesIntro: "Uma página por índice com fórmula real, bandas Sentinel-2 e quando usar cada um.",
    indicesTableHeaderName: "Índice",
    indicesTableHeaderFormula: "Fórmula",
    indicesTableHeaderRange: "Faixa",
    indicesTableHeaderSensitiveTo: "Sensível a",
    indicesTableHeaderUseCase: "Caso típico",
    detailAlternatives: "Índices alternativos",
    detailFormula: "Fórmula",
    detailBands: "Bandas Sentinel-2",
    detailRange: "Faixa típica",
    detailColorScale: "Escala de interpretação",
    detailUseCases: "Casos de uso",
    detailPhenology: "Etapa fenológica",
    detailRelated: "Relacionado",
    detailReference: "Referência",
    detailContext: "Por que importa",
    detailExample: "Exemplo real gerado pela AgRegen",
    detailExampleCaption: (date) => `Sentinel-2 L2A · parcela de teste no Pampa Húmedo (Buenos Aires, Argentina) · imagem de ${date} · gerada pela AgRegen via Google Earth Engine.`,
    detailExampleAlt: (acronym) => `Mapa ${acronym} sobre parcela de teste no Pampa Húmedo gerado pela AgRegen.`,
    ctaCallout: "Gere esse índice na sua parcela, grátis. AgRegen é código aberto.",
    ctaButton: "Comece grátis",
    back: "← Voltar",
    updated: "Atualizado",
    notFoundTitle: "Conteúdo não encontrado | AgRegen",
    notFoundIntro: "O termo ou índice que procura não está em nosso glossário.",
    contentInSpanishNotice: "Esta entrada ainda não foi traduzida ao seu idioma. Mostramos o conteúdo em espanhol.",
  },
  zh: {
    glossaryTitle: "再生农业与可变量管理术语 | AgRegen",
    glossaryDescription: "再生农业、卫星监测和可变量管理的真实农艺定义。",
    glossaryH1: "再生农业与监测术语",
    glossaryIntro: "AgRegen 日常使用的术语,由农艺师定义。",
    glossaryFilterByLetter: "按字母筛选:",
    glossaryAllTerms: "全部术语",
    indicesTitle: "农业卫星指数 | AgRegen",
    indicesDescription: "NDVI、EVI、NDMI 等卫星指数,含公式、Sentinel-2 波段与真实用例。",
    indicesH1: "农业卫星指数",
    indicesIntro: "每个指数一页,含真实公式、Sentinel-2 波段和使用场景。",
    indicesTableHeaderName: "指数",
    indicesTableHeaderFormula: "公式",
    indicesTableHeaderRange: "范围",
    indicesTableHeaderSensitiveTo: "敏感于",
    indicesTableHeaderUseCase: "典型用途",
    detailAlternatives: "替代指数",
    detailFormula: "公式",
    detailBands: "Sentinel-2 波段",
    detailRange: "典型范围",
    detailColorScale: "解释色阶",
    detailUseCases: "使用场景",
    detailPhenology: "物候期",
    detailRelated: "相关",
    detailReference: "参考",
    detailContext: "重要性",
    detailExample: "AgRegen 生成的真实示例",
    detailExampleCaption: (date) => `Sentinel-2 L2A · 阿根廷布宜诺斯艾利斯潘帕斯湿润区测试地块 · ${date} 影像 · 由 AgRegen 通过 Google Earth Engine 生成。`,
    detailExampleAlt: (acronym) => `AgRegen 在潘帕斯湿润区测试地块上生成的 ${acronym} 地图。`,
    ctaCallout: "在您的地块上免费生成此指数。AgRegen 是开源的。",
    ctaButton: "免费开始",
    back: "← 返回",
    updated: "更新于",
    notFoundTitle: "未找到内容 | AgRegen",
    notFoundIntro: "您查找的术语或指数不在我们的术语表中。",
    contentInSpanishNotice: "此条目尚未翻译为您的语言。显示西班牙语内容。",
  },
};

// ── Utilidades comunes ───────────────────────────────────────────────────────

function hreflangsFor(origin: string, pathname: string) {
  return [
    ...SEO_LOCALES.map((l) => ({
      locale: l,
      href: `${origin}${pathname}?lang=${l}`,
    })),
    { locale: "x-default" as const, href: `${origin}${pathname}` },
  ];
}

function noindexMeta(): string {
  return `<meta name="robots" content="noindex" />`;
}

function injectNoindex(html: string): string {
  return html.replace(/<\/head>/i, `${noindexMeta()}\n  </head>`);
}

function ctaButtonHtml(label: string): string {
  return `<p style="margin:2rem 0 0;"><a href="/auth" style="display:inline-block;background:#15803d;color:#fff;padding:0.7rem 1.4rem;border-radius:0.5rem;text-decoration:none;font-weight:600;">${escapeHtml(label)}</a></p>`;
}

// ── /glosario (hub) ──────────────────────────────────────────────────────────

export function renderGlossaryHub(args: RenderArgs): RenderOutput {
  const { template, origin, pathname, locale } = args;
  const strings = LEARN_STRINGS[locale];
  const canonical = `${origin}${pathname}`;

  // Letras presentes en el glosario.
  const termsByLetter = new Map<string, GlossaryTerm[]>();
  for (const term of GLOSSARY_TERMS) {
    const c = getGlossaryContent(term, locale).content;
    const letter = c.title.charAt(0).toUpperCase();
    const arr = termsByLetter.get(letter) ?? [];
    arr.push(term);
    termsByLetter.set(letter, arr);
  }
  const letters = Array.from(termsByLetter.keys()).sort();

  // ItemList JSON-LD del hub.
  const itemListSchema = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: strings.glossaryH1,
    numberOfItems: GLOSSARY_TERMS.length,
    itemListElement: GLOSSARY_TERMS.map((t, i) => {
      const c = getGlossaryContent(t, locale).content;
      return {
        "@type": "ListItem",
        position: i + 1,
        url: `${origin}/glosario/${t.slug}`,
        name: c.title,
      };
    }),
  };

  // Bloque hub completo (reemplaza el shell genérico para los hubs).
  const hubBody = `
    <section style="max-width:64rem;margin:0 auto;padding:2rem 1.5rem 1rem;">
      <nav aria-label="${escapeAttr(strings.glossaryFilterByLetter)}" style="display:flex;flex-wrap:wrap;gap:0.5rem;margin:1.5rem 0;">
        ${letters
          .map(
            (l) =>
              `<a href="#letter-${escapeAttr(l)}" style="display:inline-block;min-width:2rem;padding:0.35rem 0.6rem;text-align:center;border:1px solid #d1d5db;border-radius:0.375rem;color:#374151;text-decoration:none;font-weight:500;">${escapeHtml(l)}</a>`,
          )
          .join("")}
      </nav>
      ${letters
        .map((letter) => {
          const items = (termsByLetter.get(letter) ?? [])
            .slice()
            .sort((a, b) =>
              getGlossaryContent(a, locale).content.title.localeCompare(
                getGlossaryContent(b, locale).content.title,
              ),
            );
          return `
            <section id="letter-${escapeAttr(letter)}" style="margin:2rem 0;">
              <h2 style="font-size:1.5rem;font-weight:700;color:#15803d;margin:0 0 0.75rem;border-bottom:2px solid #d1d5db;padding-bottom:0.25rem;">${escapeHtml(letter)}</h2>
              <ul style="list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(18rem,1fr));gap:0.75rem;">
                ${items
                  .map((t) => {
                    const c = getGlossaryContent(t, locale).content;
                    return `<li><a href="/glosario/${escapeAttr(t.slug)}" style="display:block;padding:0.75rem 1rem;border:1px solid #e5e7eb;border-radius:0.5rem;color:#0f172a;text-decoration:none;background:#fff;"><strong>${escapeHtml(c.title)}</strong></a></li>`;
                  })
                  .join("")}
              </ul>
            </section>
          `;
        })
        .join("")}
    </section>
  `;

  const html = buildShellHtml({
    template,
    locale,
    title: strings.glossaryTitle,
    description: strings.glossaryDescription,
    canonical,
    hreflangs: hreflangsFor(origin, pathname),
    schemas: [itemListSchema],
    ogImage: `${origin}/opengraph.jpg`,
    pathname,
    h1: strings.glossaryH1,
    intro: strings.glossaryIntro,
    bullets: GLOSSARY_TERMS.slice(0, 6).map(
      (t) => getGlossaryContent(t, locale).content.title,
    ),
    ctaText: strings.ctaButton,
    chrome: getShellChrome(locale),
    mode: "pure-ssr",
  });

  // Insertar el bloque del hub justo después de </main> del shell.
  return {
    html: html.replace(
      /(<\/main>\s*)(<footer)/i,
      `</main>${hubBody}$2`,
    ),
  };
}

// ── /glosario/:slug (detalle) ────────────────────────────────────────────────

export function renderGlossaryDetail(args: RenderArgs & { slug: string }): RenderOutput {
  const { template, origin, pathname, locale, slug } = args;
  const strings = LEARN_STRINGS[locale];
  const term = findGlossaryTerm(slug);

  if (!term) {
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

  const { content, isFallback } = getGlossaryContent(term, locale);
  const canonical = `${origin}${pathname}`;

  const definedTermSchema = {
    "@context": "https://schema.org",
    "@type": "DefinedTerm",
    name: content.title,
    description: content.definition.split("\n\n")[0],
    inLanguage: isFallback ? "es" : locale,
    datePublished: term.datePublished ?? term.dateUpdated,
    dateModified: term.dateUpdated,
    inDefinedTermSet: {
      "@type": "DefinedTermSet",
      name: "AgRegen Glosario",
      url: `${origin}/glosario`,
    },
    url: canonical,
  };

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${origin}/` },
      { "@type": "ListItem", position: 2, name: strings.glossaryH1, item: `${origin}/glosario` },
      { "@type": "ListItem", position: 3, name: content.title, item: canonical },
    ],
  };

  const paragraphs = content.definition.split("\n\n").map((p) => `<p>${escapeHtml(p)}</p>`).join("\n      ");

  const relatedTerms = term.related
    .map((rs) => findGlossaryTerm(rs))
    .filter((t): t is GlossaryTerm => Boolean(t))
    .map((t) => {
      const c = getGlossaryContent(t, locale).content;
      return `<li><a href="/glosario/${escapeAttr(t.slug)}" style="color:#15803d;">${escapeHtml(c.title)}</a></li>`;
    })
    .join("");

  const relatedIndices = (term.relatedIndices ?? [])
    .map((s) => findIndex(s))
    .filter((i): i is SatelliteIndex => Boolean(i))
    .map(
      (i) =>
        `<li><a href="/indices/${escapeAttr(i.slug)}" style="color:#15803d;">${escapeHtml(i.acronym)}</a></li>`,
    )
    .join("");

  // Cross-link reverso: cultivos cuyo `relatedGlossary` apunta a este término.
  const relatedCrops = CROPS_FOR_LINKS
    .filter((c) => c.relatedGlossary === term.slug)
    .map((c) => {
      const cropName = (locale === "en" ? c.name.en : c.name.es) || c.curveKey;
      return `<li><a href="/cultivos/${escapeAttr(c.slug)}" style="color:#15803d;">${escapeHtml(cropName)}</a></li>`;
    })
    .join("");

  const detailBody = `
    <article style="max-width:48rem;margin:0 auto;padding:1rem 1.5rem 3rem;color:#1f2937;line-height:1.7;">
      <p style="margin:0 0 1rem;"><a href="/glosario" style="color:#15803d;text-decoration:none;">${escapeHtml(strings.back)}</a></p>
      ${isFallback ? `<p style="background:#fef9c3;border-left:4px solid #ca8a04;padding:0.6rem 1rem;border-radius:0.25rem;margin:0 0 1.25rem;font-size:0.95rem;">${escapeHtml(strings.contentInSpanishNotice)}</p>` : ""}
      ${paragraphs}
      <h2 style="font-size:1.25rem;font-weight:700;color:#0f172a;margin:1.75rem 0 0.5rem;">${escapeHtml(strings.detailContext)}</h2>
      <p>${escapeHtml(content.context)}</p>
      ${
        relatedTerms || relatedIndices || relatedCrops
          ? `<h2 style="font-size:1.25rem;font-weight:700;color:#0f172a;margin:1.75rem 0 0.5rem;">${escapeHtml(strings.detailRelated)}</h2>
             <ul style="list-style:disc;padding-left:1.25rem;">${relatedTerms}${relatedIndices}${relatedCrops}</ul>`
          : ""
      }
      <p style="margin:2rem 0 0;background:#ecfdf5;border-left:4px solid #15803d;padding:0.75rem 1rem;border-radius:0.25rem;">${escapeHtml(strings.ctaCallout)}</p>
      ${ctaButtonHtml(strings.ctaButton)}
      <p style="margin:2rem 0 0;font-size:0.85rem;color:#6b7280;">${escapeHtml(strings.updated)}: ${escapeHtml(term.dateUpdated)}</p>
    </article>
  `;

  let html = buildShellHtml({
    template,
    locale,
    title: `${content.title} | ${strings.glossaryH1}`,
    description: content.definition.split("\n\n")[0].slice(0, 160),
    canonical,
    hreflangs: hreflangsFor(origin, pathname),
    schemas: [definedTermSchema, breadcrumbSchema],
    ogImage: `${origin}/opengraph.jpg`,
    pathname,
    h1: content.title,
    intro: content.definition.split("\n\n")[0],
    bullets: term.related.slice(0, 5),
    ctaText: strings.ctaButton,
    chrome: getShellChrome(locale),
    mode: "pure-ssr",
  });

  html = html.replace(/(<\/main>\s*)(<footer)/i, `</main>${detailBody}$2`);
  if (isFallback) html = injectNoindex(html);
  return { html };
}

// ── /indices (hub) ───────────────────────────────────────────────────────────

export function renderIndicesHub(args: RenderArgs): RenderOutput {
  const { template, origin, pathname, locale } = args;
  const strings = LEARN_STRINGS[locale];
  const canonical = `${origin}${pathname}`;

  const itemListSchema = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: strings.indicesH1,
    numberOfItems: SATELLITE_INDICES.length,
    itemListElement: SATELLITE_INDICES.map((i, k) => ({
      "@type": "ListItem",
      position: k + 1,
      url: `${origin}/indices/${i.slug}`,
      name: `${i.acronym} — ${getIndexContent(i, locale).content.fullName}`,
    })),
  };

  const tableRows = SATELLITE_INDICES.map((i) => {
    const c = getIndexContent(i, locale).content;
    const sens = i.sensitivity[locale] ?? i.sensitivity.es ?? "";
    return `<tr>
      <td style="padding:0.6rem 0.75rem;border-top:1px solid #e5e7eb;"><a href="/indices/${escapeAttr(i.slug)}" style="color:#15803d;font-weight:600;">${escapeHtml(i.acronym)}</a><div style="font-size:0.85rem;color:#6b7280;">${escapeHtml(c.fullName)}</div></td>
      <td style="padding:0.6rem 0.75rem;border-top:1px solid #e5e7eb;font-family:ui-monospace,monospace;font-size:0.85rem;">${escapeHtml(i.formulaText)}</td>
      <td style="padding:0.6rem 0.75rem;border-top:1px solid #e5e7eb;">[${i.range[0]}, ${i.range[1]}]</td>
      <td style="padding:0.6rem 0.75rem;border-top:1px solid #e5e7eb;">${escapeHtml(sens)}</td>
      <td style="padding:0.6rem 0.75rem;border-top:1px solid #e5e7eb;">${escapeHtml(c.useCases[0] ?? "")}</td>
    </tr>`;
  }).join("");

  const hubBody = `
    <section style="max-width:64rem;margin:0 auto;padding:1rem 1.5rem 2rem;">
      <div style="overflow-x:auto;border:1px solid #e5e7eb;border-radius:0.5rem;background:#fff;">
        <table style="width:100%;border-collapse:collapse;font-size:0.95rem;">
          <thead>
            <tr style="background:#f3f4f6;text-align:left;">
              <th style="padding:0.75rem;">${escapeHtml(strings.indicesTableHeaderName)}</th>
              <th style="padding:0.75rem;">${escapeHtml(strings.indicesTableHeaderFormula)}</th>
              <th style="padding:0.75rem;">${escapeHtml(strings.indicesTableHeaderRange)}</th>
              <th style="padding:0.75rem;">${escapeHtml(strings.indicesTableHeaderSensitiveTo)}</th>
              <th style="padding:0.75rem;">${escapeHtml(strings.indicesTableHeaderUseCase)}</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
      <p style="margin:1.5rem 0 0;background:#ecfdf5;border-left:4px solid #15803d;padding:0.75rem 1rem;border-radius:0.25rem;">${escapeHtml(strings.ctaCallout)}</p>
      ${ctaButtonHtml(strings.ctaButton)}
    </section>
  `;

  const html = buildShellHtml({
    template,
    locale,
    title: strings.indicesTitle,
    description: strings.indicesDescription,
    canonical,
    hreflangs: hreflangsFor(origin, pathname),
    schemas: [itemListSchema],
    ogImage: `${origin}/opengraph.jpg`,
    pathname,
    h1: strings.indicesH1,
    intro: strings.indicesIntro,
    bullets: SATELLITE_INDICES.slice(0, 6).map(
      (i) => `${i.acronym} — ${getIndexContent(i, locale).content.fullName}`,
    ),
    ctaText: strings.ctaButton,
    chrome: getShellChrome(locale),
    mode: "pure-ssr",
  });

  return { html: html.replace(/(<\/main>\s*)(<footer)/i, `</main>${hubBody}$2`) };
}

// ── /indices/:slug (detalle) ─────────────────────────────────────────────────

export function renderIndexDetail(args: RenderArgs & { slug: string }): RenderOutput {
  const { template, origin, pathname, locale, slug } = args;
  const strings = LEARN_STRINGS[locale];
  const idx = findIndex(slug);

  if (!idx) {
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

  const { content, isFallback } = getIndexContent(idx, locale);
  const canonical = `${origin}${pathname}`;
  const fullTitle = `${idx.acronym} — ${content.fullName}`;
  const firstParagraph = content.description.split("\n\n")[0];

  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: fullTitle,
    description: firstParagraph,
    inLanguage: isFallback ? "es" : locale,
    dateModified: idx.dateUpdated,
    datePublished: idx.dateUpdated,
    author: { "@type": "Organization", name: "AgRegen" },
    publisher: { "@type": "Organization", name: "AgRegen", url: origin },
    mainEntityOfPage: canonical,
  };

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${origin}/` },
      { "@type": "ListItem", position: 2, name: strings.indicesH1, item: `${origin}/indices` },
      { "@type": "ListItem", position: 3, name: idx.acronym, item: canonical },
    ],
  };

  const paragraphs = content.description
    .split("\n\n")
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("\n      ");

  const useCasesHtml = content.useCases.map((u) => `<li>${escapeHtml(u)}</li>`).join("");

  const rampHtml = idx.ramp
    .map(
      (r) =>
        `<div style="display:flex;align-items:center;gap:0.6rem;padding:0.35rem 0;"><span style="display:inline-block;width:1.5rem;height:1.5rem;border-radius:0.25rem;background:${r.color};border:1px solid #d1d5db;"></span><strong style="font-family:monospace;font-size:0.85rem;color:#6b7280;min-width:6rem;">[${r.min}, ${r.max})</strong><span>${escapeHtml(r.label[locale] ?? r.label.es ?? "")}</span></div>`,
    )
    .join("");

  const relatedGlossaryHtml = idx.relatedGlossary
    .map((s) => findGlossaryTerm(s))
    .filter((t): t is GlossaryTerm => Boolean(t))
    .map((t) => {
      const c = getGlossaryContent(t, locale).content;
      return `<li><a href="/glosario/${escapeAttr(t.slug)}" style="color:#15803d;">${escapeHtml(c.title)}</a></li>`;
    })
    .join("");

  // Cross-link reverso: cultivos cuya etapa recomienda este índice (ejemplo
  // de uso real). Linkeamos al hub del cultivo, no a una etapa específica,
  // porque varias etapas pueden recomendar el mismo índice.
  const cropsUsingIndex = CROPS_FOR_LINKS.filter((c) =>
    c.stages.some((st) => st.recommendedIndices.includes(idx.slug)),
  );
  const indexCropExamplesHtml = cropsUsingIndex
    .map((c) => {
      const cropName = (locale === "en" ? c.name.en : c.name.es) || c.curveKey;
      return `<li><a href="/cultivos/${escapeAttr(c.slug)}" style="color:#15803d;">${escapeHtml(cropName)}</a></li>`;
    })
    .join("");

  const detailBody = `
    <article style="max-width:48rem;margin:0 auto;padding:1rem 1.5rem 3rem;color:#1f2937;line-height:1.7;">
      <p style="margin:0 0 1rem;"><a href="/indices" style="color:#15803d;text-decoration:none;">${escapeHtml(strings.back)}</a></p>
      ${isFallback ? `<p style="background:#fef9c3;border-left:4px solid #ca8a04;padding:0.6rem 1rem;border-radius:0.25rem;margin:0 0 1.25rem;font-size:0.95rem;">${escapeHtml(strings.contentInSpanishNotice)}</p>` : ""}
      ${paragraphs}

      <h2 style="font-size:1.25rem;font-weight:700;color:#0f172a;margin:1.75rem 0 0.5rem;">${escapeHtml(strings.detailFormula)}</h2>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:0.5rem;padding:1rem;text-align:center;font-size:1.15rem;">
        ${idx.formulaMathML}
        <div style="font-family:monospace;font-size:0.95rem;color:#374151;margin-top:0.5rem;">${escapeHtml(idx.formulaText)}</div>
      </div>

      <h2 style="font-size:1.25rem;font-weight:700;color:#0f172a;margin:1.75rem 0 0.5rem;">${escapeHtml(strings.detailBands)}</h2>
      <ul style="list-style:disc;padding-left:1.25rem;">${idx.bands.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>

      <h2 style="font-size:1.25rem;font-weight:700;color:#0f172a;margin:1.75rem 0 0.5rem;">${escapeHtml(strings.detailRange)}</h2>
      <p>[${idx.range[0]}, ${idx.range[1]}]</p>

      <h2 style="font-size:1.25rem;font-weight:700;color:#0f172a;margin:1.75rem 0 0.5rem;">${escapeHtml(strings.detailColorScale)}</h2>
      <div>${rampHtml}</div>

      <h2 style="font-size:1.25rem;font-weight:700;color:#0f172a;margin:1.75rem 0 0.5rem;">${escapeHtml(strings.detailExample)}</h2>
      <figure style="margin:0;border:1px solid #e5e7eb;border-radius:0.5rem;overflow:hidden;background:#f9fafb;">
        <img src="/indices/${escapeAttr(idx.slug)}.png?v=20260306" alt="${escapeAttr(strings.detailExampleAlt(idx.acronym))}" width="480" height="480" loading="lazy" style="display:block;width:100%;height:auto;" />
        <figcaption style="padding:0.6rem 0.85rem;font-size:0.85rem;color:#6b7280;">${escapeHtml(strings.detailExampleCaption("2024-03-06"))}</figcaption>
      </figure>

      <h2 style="font-size:1.25rem;font-weight:700;color:#0f172a;margin:1.75rem 0 0.5rem;">${escapeHtml(strings.detailUseCases)}</h2>
      <ul style="list-style:disc;padding-left:1.25rem;">${useCasesHtml}</ul>

      <h2 style="font-size:1.25rem;font-weight:700;color:#0f172a;margin:1.75rem 0 0.5rem;">${escapeHtml(strings.detailPhenology)}</h2>
      <p>${escapeHtml(content.phenology)}</p>

      ${
        relatedGlossaryHtml || indexCropExamplesHtml
          ? `<h2 style="font-size:1.25rem;font-weight:700;color:#0f172a;margin:1.75rem 0 0.5rem;">${escapeHtml(strings.detailRelated)}</h2>
             <ul style="list-style:disc;padding-left:1.25rem;">${relatedGlossaryHtml}${indexCropExamplesHtml}</ul>`
          : ""
      }

      ${
        idx.alternatives && idx.alternatives.length > 0
          ? `<h2 style="font-size:1.25rem;font-weight:700;color:#0f172a;margin:1.75rem 0 0.5rem;">${escapeHtml(strings.detailAlternatives)}</h2>
             <ul style="list-style:disc;padding-left:1.25rem;">${idx.alternatives.map((a) => {
               const target = SATELLITE_INDICES.find((x) => x.slug === a.slug);
               if (!target) return "";
               const reason = a.reason[locale] ?? a.reason.es ?? "";
               return `<li style="margin:0.4rem 0;"><a href="/indices/${escapeAttr(target.slug)}" style="color:#15803d;font-weight:600;">${escapeHtml(target.acronym)}</a> — ${escapeHtml(reason)}</li>`;
             }).join("")}</ul>`
          : ""
      }

      <p style="margin:2rem 0 0;background:#ecfdf5;border-left:4px solid #15803d;padding:0.75rem 1rem;border-radius:0.25rem;">${escapeHtml(strings.ctaCallout)}</p>
      ${ctaButtonHtml(strings.ctaButton)}

      <p style="margin:2rem 0 0;font-size:0.85rem;color:#6b7280;">${escapeHtml(strings.detailReference)}: ${escapeHtml(idx.reference)} · ${escapeHtml(strings.updated)}: ${escapeHtml(idx.dateUpdated)}</p>
    </article>
  `;

  let html = buildShellHtml({
    template,
    locale,
    title: `${fullTitle} | AgRegen`,
    description: firstParagraph.slice(0, 160),
    canonical,
    hreflangs: hreflangsFor(origin, pathname),
    schemas: [articleSchema, breadcrumbSchema],
    ogImage: `${origin}/opengraph.jpg`,
    pathname,
    h1: fullTitle,
    intro: firstParagraph,
    bullets: content.useCases,
    ctaText: strings.ctaButton,
    chrome: getShellChrome(locale),
    mode: "pure-ssr",
  });

  html = html.replace(/(<\/main>\s*)(<footer)/i, `</main>${detailBody}$2`);
  if (isFallback) html = injectNoindex(html);
  return { html };
}

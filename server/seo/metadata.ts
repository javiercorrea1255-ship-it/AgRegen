export type SeoLocale = "es" | "en" | "pt" | "zh";

export const SEO_LOCALES: SeoLocale[] = ["es", "en", "pt", "zh"];
export const DEFAULT_LOCALE: SeoLocale = "es";

const OG_LOCALES: Record<SeoLocale, string> = {
  es: "es_ES",
  en: "en_US",
  pt: "pt_BR",
  zh: "zh_CN",
};

export interface SeoContent {
  title: string;
  description: string;
  h1: string;
  intro: string;
  bullets: string[];
  ctaText: string;
}

export type RouteKey =
  | "home"
  | "about"
  | "conferences"
  | "community"
  | "glossary"
  | "indices"
  | "crops";

const ORG_NAME = "AgRegen 5.0";
const ORG_TAGLINE: Record<SeoLocale, string> = {
  es: "Plataforma libre de monitoreo satelital para agricultura regenerativa",
  en: "Open-source satellite monitoring platform for regenerative agriculture",
  pt: "Plataforma livre de monitoramento por satélite para agricultura regenerativa",
  zh: "再生农业的开源卫星监测平台",
};

export function getOrgTagline(locale: SeoLocale): string {
  return ORG_TAGLINE[locale];
}

export interface ShellChrome {
  navHome: string;
  navConferences: string;
  navCommunity: string;
  navAbout: string;
  navSignIn: string;
  footerNote: string;
  learnGlossary: string;
  learnIndices: string;
  learnCrops: string;
  learnCases: string;
}

const SHELL_CHROME: Record<SeoLocale, ShellChrome> = {
  es: {
    navHome: "Inicio",
    navConferences: "Conferencias",
    navCommunity: "Comunidad",
    navAbout: "Quiénes somos",
    navSignIn: "Ingresar",
    footerNote: "Código abierto · Datos del agricultor",
    learnGlossary: "Glosario regenerativo",
    learnIndices: "Índices satelitales",
    learnCrops: "Cultivos y manejo",
    learnCases: "Casos reales",
  },
  en: {
    navHome: "Home",
    navConferences: "Conferences",
    navCommunity: "Community",
    navAbout: "About",
    navSignIn: "Sign in",
    footerNote: "Open source · Farmer-owned data",
    learnGlossary: "Regenerative glossary",
    learnIndices: "Satellite indices",
    learnCrops: "Crops & management",
    learnCases: "Real cases",
  },
  pt: {
    navHome: "Início",
    navConferences: "Conferências",
    navCommunity: "Comunidade",
    navAbout: "Quem somos",
    navSignIn: "Entrar",
    footerNote: "Código aberto · Dados do agricultor",
    learnGlossary: "Glossário regenerativo",
    learnIndices: "Índices satelitais",
    learnCrops: "Culturas e manejo",
    learnCases: "Casos reais",
  },
  zh: {
    navHome: "首页",
    navConferences: "会议",
    navCommunity: "社区",
    navAbout: "关于",
    navSignIn: "登录",
    footerNote: "开源 · 农民拥有数据",
    learnGlossary: "再生农业术语",
    learnIndices: "卫星指数",
    learnCrops: "作物与管理",
    learnCases: "真实案例",
  },
};

export function getShellChrome(locale: SeoLocale): ShellChrome {
  return SHELL_CHROME[locale];
}

export function getOgLocale(locale: SeoLocale): string {
  return OG_LOCALES[locale];
}

/**
 * SEO meta length policy (per Google SERP best practices, 2026):
 * - Latin scripts (es/en/pt): title 50-65 chars, description 150-160 chars.
 * - CJK (zh): tighter due to glyph density — title 22-32 chars,
 *   description 70-110 chars. Going beyond truncates on SERP.
 *
 * Texts in this file are hand-tuned to those ranges. Run
 * `tsx server/seo/__check_lengths.ts` (smoke) to verify.
 */
export const ROUTE_CONTENT: Record<RouteKey, Record<SeoLocale, SeoContent>> = {
  home: {
    es: {
      title: "AgRegen 5.0 — Monitoreo satelital libre y abierto",
      description:
        "Plataforma libre de monitoreo satelital con NDVI, humedad de suelo, clima e IA agronómica. Datos abiertos, sin muros de pago para regenerar tu parcela.",
      h1: "Monitoreo satelital libre para agricultura regenerativa",
      intro:
        "AgRegen 5.0 es la plataforma libre y abierta para productores, técnicos e investigadores que quieren monitorear sus parcelas con imágenes Sentinel-2, índices de vegetación (NDVI, EVI, NDMI), clima en tiempo real y recomendaciones agronómicas con IA. Sin muros de pago, con soberanía total sobre tus datos.",
      bullets: [
        "Imágenes Sentinel-2 actualizadas cada 5 días vía Google Earth Engine",
        "Índices NDVI, EVI y NDMI con interpretación contextual",
        "Manejo variable: muestreo, interpolación (Kriging, IDW, RBF) y prescripciones",
        "Asistente IA con OpenAI GPT-4o y modelo agrícola Sinong",
        "Red comunitaria RegenConnect para compartir experiencias y resultados",
        "Conferencias y foros de discusión sobre agricultura regenerativa",
      ],
      ctaText: "Comenzar gratis ahora",
    },
    en: {
      title: "AgRegen 5.0 — Free open satellite monitoring platform",
      description:
        "Open-source satellite monitoring with NDVI, soil moisture, weather and agronomic AI. Open data, no paywalls — regenerate your fields with full data sovereignty.",
      h1: "Free satellite monitoring for regenerative agriculture",
      intro:
        "AgRegen 5.0 is the open-source platform for farmers, agronomists and researchers who want to monitor their fields with Sentinel-2 imagery, vegetation indices (NDVI, EVI, NDMI), real-time weather and AI agronomic recommendations. No paywalls, full data sovereignty.",
      bullets: [
        "Sentinel-2 imagery refreshed every 5 days via Google Earth Engine",
        "NDVI, EVI and NDMI indices with contextual interpretation",
        "Variable rate management: sampling, interpolation (Kriging, IDW, RBF) and prescriptions",
        "AI assistant powered by OpenAI GPT-4o and Sinong agricultural model",
        "RegenConnect community network to share experiences and results",
        "Conferences and discussion forums on regenerative agriculture",
      ],
      ctaText: "Start free now",
    },
    pt: {
      title: "AgRegen 5.0 — Monitoramento por satélite livre e aberto",
      description:
        "Plataforma livre de monitoramento por satélite com NDVI, umidade do solo, clima e IA agronômica. Dados abertos, sem barreiras, para regenerar sua parcela.",
      h1: "Monitoramento por satélite livre para agricultura regenerativa",
      intro:
        "AgRegen 5.0 é a plataforma livre e aberta para produtores, técnicos e pesquisadores que querem monitorar suas parcelas com imagens Sentinel-2, índices de vegetação (NDVI, EVI, NDMI), clima em tempo real e recomendações agronômicas com IA. Sem barreiras de pagamento, com total soberania sobre seus dados.",
      bullets: [
        "Imagens Sentinel-2 atualizadas a cada 5 dias via Google Earth Engine",
        "Índices NDVI, EVI e NDMI com interpretação contextual",
        "Manejo variável: amostragem, interpolação (Kriging, IDW, RBF) e prescrições",
        "Assistente de IA com OpenAI GPT-4o e modelo agrícola Sinong",
        "Rede comunitária RegenConnect para compartilhar experiências e resultados",
        "Conferências e fóruns de discussão sobre agricultura regenerativa",
      ],
      ctaText: "Começar grátis agora",
    },
    zh: {
      title: "AgRegen 5.0 — 再生农业开源卫星监测平台",
      description:
        "面向再生农业的开源卫星监测平台:NDVI、土壤湿度、实时气象与农艺 AI 助手,数据完全开放,助您高效再生田块,无任何付费墙限制。",
      h1: "面向再生农业的免费卫星监测",
      intro:
        "AgRegen 5.0 是面向农民、技术员和研究人员的开源平台,可使用 Sentinel-2 影像、植被指数 (NDVI、EVI、NDMI)、实时气象和 AI 农艺建议监测您的田块。无任何付费墙,完整的数据主权。",
      bullets: [
        "通过 Google Earth Engine 每 5 天刷新 Sentinel-2 影像",
        "NDVI、EVI 和 NDMI 指数及其情境化解读",
        "变量管理:采样、插值 (Kriging、IDW、RBF) 与处方",
        "由 OpenAI GPT-4o 和司农农业模型驱动的 AI 助手",
        "RegenConnect 社区网络,分享经验与成果",
        "再生农业的会议与讨论论坛",
      ],
      ctaText: "立即免费开始",
    },
  },
  about: {
    es: {
      title: "Quiénes somos | AgRegen — Agricultura abierta",
      description:
        "Conoce la misión de AgRegen 5.0: democratizar el monitoreo satelital con datos abiertos, soberanía de datos y transparencia algorítmica para todos los productores.",
      h1: "Una plataforma libre, abierta y al servicio de quienes regeneran la tierra",
      intro:
        "AgRegen 5.0 nace para acortar la distancia entre la ciencia satelital y el productor. Creemos en el acceso abierto, la soberanía de los datos y la transparencia algorítmica como cimientos de la próxima generación de la agricultura regenerativa.",
      bullets: [
        "Acceso abierto: sin muros de pago en las funciones esenciales",
        "Soberanía de datos: tú decides qué es público, anonimizado o privado",
        "Transparencia algorítmica: modelos de IA auditables y explicables",
        "Tecnologías abiertas: React, Node, PostgreSQL, Google Earth Engine",
        "Multilenguaje: español, inglés, portugués y chino",
      ],
      ctaText: "Únete a la comunidad",
    },
    en: {
      title: "About | AgRegen — Open regenerative agriculture",
      description:
        "Learn AgRegen 5.0's mission: democratize satellite monitoring with open data, data sovereignty and algorithmic transparency for every farmer worldwide.",
      h1: "A free, open platform serving those who regenerate the land",
      intro:
        "AgRegen 5.0 was built to close the gap between satellite science and the farmer. We believe in open access, data sovereignty and algorithmic transparency as the foundations of the next generation of regenerative agriculture.",
      bullets: [
        "Open access: no paywalls for essential features",
        "Data sovereignty: you decide what is public, anonymized or private",
        "Algorithmic transparency: auditable, explainable AI models",
        "Open technologies: React, Node, PostgreSQL, Google Earth Engine",
        "Multilingual: Spanish, English, Portuguese and Chinese",
      ],
      ctaText: "Join the community",
    },
    pt: {
      title: "Sobre | AgRegen — Agricultura regenerativa livre",
      description:
        "Conheça a missão da AgRegen 5.0: democratizar o monitoramento por satélite com dados abertos, soberania de dados e transparência algorítmica para todos os produtores.",
      h1: "Uma plataforma livre e aberta a serviço de quem regenera a terra",
      intro:
        "AgRegen 5.0 nasce para encurtar a distância entre a ciência satelital e o produtor. Acreditamos no acesso aberto, na soberania dos dados e na transparência algorítmica como fundamentos da próxima geração da agricultura regenerativa.",
      bullets: [
        "Acesso aberto: sem barreiras de pagamento nas funções essenciais",
        "Soberania de dados: você decide o que é público, anonimizado ou privado",
        "Transparência algorítmica: modelos de IA auditáveis e explicáveis",
        "Tecnologias abertas: React, Node, PostgreSQL, Google Earth Engine",
        "Multilíngue: espanhol, inglês, português e chinês",
      ],
      ctaText: "Junte-se à comunidade",
    },
    zh: {
      title: "关于我们 | AgRegen 开源再生农业平台",
      description:
        "了解 AgRegen 5.0 的使命:通过开放数据、数据主权与算法透明,让每一位农民都能平等地使用卫星监测与再生农业实践。",
      h1: "为再生大地的人们服务的免费开放平台",
      intro:
        "AgRegen 5.0 旨在缩短卫星科学与农民之间的距离。我们相信开放访问、数据主权和算法透明是下一代再生农业的基石。",
      bullets: [
        "开放访问:核心功能无付费墙",
        "数据主权:由您决定哪些是公开、匿名或私有",
        "算法透明:可审计、可解释的 AI 模型",
        "开放技术栈:React、Node、PostgreSQL、Google Earth Engine",
        "多语言:西班牙语、英语、葡萄牙语和中文",
      ],
      ctaText: "加入社区",
    },
  },
  conferences: {
    es: {
      title: "Conferencias de agricultura regenerativa | AgRegen",
      description:
        "Conferencias en video gratis sobre agricultura regenerativa, suelos, riego, biodiversidad y monitoreo satelital. Cada evento incluye foro abierto a la comunidad.",
      h1: "Conferencias y foros de agricultura regenerativa",
      intro:
        "Accede gratis a conferencias en video con expertos en agricultura regenerativa, suelos, riego y tecnología satelital. Cada conferencia tiene un foro de discusión donde puedes plantear preguntas y compartir tu experiencia.",
      bullets: [
        "Conferencias destacadas con investigadores y productores",
        "Foros de discusión por evento, abiertos a la comunidad",
        "Filtros por tema: suelos, regenerativo, riego, clima, tecnología",
        "Acceso libre, sin registro obligatorio para ver",
      ],
      ctaText: "Ver todas las conferencias",
    },
    en: {
      title: "Regenerative agriculture conferences and forums | AgRegen",
      description:
        "Free video conferences on regenerative agriculture, soils, irrigation, biodiversity and satellite monitoring. Each event includes an open community discussion forum.",
      h1: "Regenerative agriculture conferences and forums",
      intro:
        "Free access to video conferences with experts in regenerative agriculture, soils, irrigation and satellite technology. Each conference has a discussion forum where you can ask questions and share your experience.",
      bullets: [
        "Featured conferences with researchers and farmers",
        "Per-event discussion forums open to the community",
        "Filter by topic: soils, regenerative, irrigation, climate, technology",
        "Free access, no mandatory registration to watch",
      ],
      ctaText: "See all conferences",
    },
    pt: {
      title: "Conferências de agricultura regenerativa | AgRegen",
      description:
        "Conferências em vídeo grátis sobre agricultura regenerativa, solos, irrigação, biodiversidade e monitoramento por satélite. Cada evento traz fórum aberto à comunidade.",
      h1: "Conferências e fóruns de agricultura regenerativa",
      intro:
        "Acesso gratuito a conferências em vídeo com especialistas em agricultura regenerativa, solos, irrigação e tecnologia satelital. Cada conferência possui um fórum de discussão.",
      bullets: [
        "Conferências em destaque com pesquisadores e produtores",
        "Fóruns de discussão por evento, abertos à comunidade",
        "Filtros por tema: solos, regenerativo, irrigação, clima, tecnologia",
        "Acesso livre, sem cadastro obrigatório para assistir",
      ],
      ctaText: "Ver todas as conferências",
    },
    zh: {
      title: "再生农业会议与讨论论坛 | AgRegen",
      description:
        "免费观看再生农业、土壤、灌溉、生物多样性与卫星监测的视频会议;每场活动都设有面向社区的开放讨论论坛。",
      h1: "再生农业会议与论坛",
      intro:
        "免费观看与再生农业、土壤、灌溉和卫星技术专家的视频会议。每场会议都设有讨论论坛。",
      bullets: [
        "由研究人员和农民主讲的精选会议",
        "向社区开放的逐场讨论论坛",
        "按主题筛选:土壤、再生、灌溉、气候、技术",
        "免费访问,无需强制注册即可观看",
      ],
      ctaText: "查看所有会议",
    },
  },
  community: {
    es: {
      title: "RegenConnect — Comunidad regenerativa | AgRegen",
      description:
        "Red social abierta para productores, técnicos e investigadores. Comparte experiencias, resultados de parcelas y consejos de agricultura regenerativa con la red.",
      h1: "RegenConnect: la red de quienes regeneran la tierra",
      intro:
        "RegenConnect es la red social libre de AgRegen donde productores, técnicos e investigadores comparten experiencias de campo, resultados de parcelas, preguntas, consejos y discuten sobre suelos, riego, biodiversidad y tecnología.",
      bullets: [
        "Publica experiencias, resultados, preguntas o consejos",
        "Comparte datos públicos de tus parcelas con la red",
        "Filtra por etiqueta: suelo, cultivos, riego, regenerativo, clima",
        "Comenta, da me gusta y traduce publicaciones automáticamente",
      ],
      ctaText: "Únete a RegenConnect",
    },
    en: {
      title: "RegenConnect — Regenerative agriculture community",
      description:
        "Open social network for farmers, agronomists and researchers. Share field experiences, parcel results and tips on regenerative agriculture with a global community.",
      h1: "RegenConnect: the network of those who regenerate the land",
      intro:
        "RegenConnect is AgRegen's open social network where farmers, agronomists and researchers share field experiences, parcel results, questions and tips, and discuss soils, irrigation, biodiversity and technology.",
      bullets: [
        "Post experiences, results, questions or tips",
        "Share your parcels' public data with the network",
        "Filter by tag: soil, crops, irrigation, regenerative, climate",
        "Comment, like and auto-translate posts",
      ],
      ctaText: "Join RegenConnect",
    },
    pt: {
      title: "RegenConnect — Comunidade regenerativa | AgRegen",
      description:
        "Rede social aberta para produtores, técnicos e pesquisadores. Compartilhe experiências, resultados de parcelas e dicas de agricultura regenerativa com a rede global.",
      h1: "RegenConnect: a rede de quem regenera a terra",
      intro:
        "RegenConnect é a rede social livre da AgRegen onde produtores, técnicos e pesquisadores compartilham experiências de campo, resultados, perguntas e dicas, e discutem solos, irrigação, biodiversidade e tecnologia.",
      bullets: [
        "Publique experiências, resultados, perguntas ou dicas",
        "Compartilhe os dados públicos das suas parcelas",
        "Filtre por etiqueta: solo, cultivos, irrigação, regenerativo, clima",
        "Comente, curta e traduza publicações automaticamente",
      ],
      ctaText: "Junte-se ao RegenConnect",
    },
    zh: {
      title: "RegenConnect 再生农业开放社区 | AgRegen",
      description:
        "面向农民、技术员与研究人员的开放社交网络。分享田间经验、田块结果与再生农业实用技巧,与全球社区共同进步。",
      h1: "RegenConnect:再生大地者的社交网络",
      intro:
        "RegenConnect 是 AgRegen 的开源社交网络,农民、技术员和研究人员在此分享田间经验、田块结果、问题和提示,并讨论土壤、灌溉、生物多样性与技术。",
      bullets: [
        "发布经验、结果、问题或小贴士",
        "与社区分享您田块的公开数据",
        "按标签筛选:土壤、作物、灌溉、再生、气候",
        "评论、点赞并自动翻译帖子",
      ],
      ctaText: "加入 RegenConnect",
    },
  },
  glossary: {
    es: {
      title: "Glosario libre de agricultura regenerativa | AgRegen",
      description:
        "Diccionario abierto de agricultura regenerativa: NDVI, EVI, NDMI, kriging, biodiversidad funcional y manejo holístico con definiciones claras y ejemplos prácticos.",
      h1: "Glosario abierto de agricultura regenerativa",
      intro:
        "Definiciones claras y verificables de los términos clave que se usan en monitoreo satelital, suelos, manejo regenerativo e interpolación espacial. Recurso libre para productores, técnicos y estudiantes.",
      bullets: [
        "Índices satelitales: NDVI, EVI, NDMI, NDRE, SAVI",
        "Suelos: materia orgánica, agregados, infiltración, biología",
        "Geoestadística: kriging, IDW, RBF, semivariograma",
        "Manejo regenerativo: cultivos de cobertura, no labranza, integración animal",
      ],
      ctaText: "Explorar el glosario",
    },
    en: {
      title: "Open regenerative agriculture glossary | AgRegen",
      description:
        "Open dictionary of regenerative agriculture: NDVI, EVI, NDMI, kriging, functional biodiversity and holistic management with clear definitions and practical examples.",
      h1: "Open glossary of regenerative agriculture",
      intro:
        "Clear, verifiable definitions of key terms used in satellite monitoring, soils, regenerative management and spatial interpolation. Free resource for farmers, agronomists and students.",
      bullets: [
        "Satellite indices: NDVI, EVI, NDMI, NDRE, SAVI",
        "Soils: organic matter, aggregates, infiltration, biology",
        "Geostatistics: kriging, IDW, RBF, semivariogram",
        "Regenerative management: cover crops, no-till, animal integration",
      ],
      ctaText: "Explore the glossary",
    },
    pt: {
      title: "Glossário aberto de agricultura regenerativa | AgRegen",
      description:
        "Dicionário aberto de agricultura regenerativa: NDVI, EVI, NDMI, kriging, biodiversidade funcional e manejo holístico com definições claras e exemplos práticos.",
      h1: "Glossário aberto de agricultura regenerativa",
      intro:
        "Definições claras e verificáveis dos termos-chave usados em monitoramento por satélite, solos, manejo regenerativo e interpolação espacial.",
      bullets: [
        "Índices de satélite: NDVI, EVI, NDMI, NDRE, SAVI",
        "Solos: matéria orgânica, agregados, infiltração, biologia",
        "Geoestatística: kriging, IDW, RBF, semivariograma",
        "Manejo regenerativo: plantas de cobertura, plantio direto, integração animal",
      ],
      ctaText: "Explorar o glossário",
    },
    zh: {
      title: "再生农业开放术语表 | AgRegen 平台",
      description:
        "再生农业开放词典:NDVI、EVI、NDMI、克里金法、功能性生物多样性与整体管理,提供清晰定义、实际案例和检索友好的索引结构。",
      h1: "再生农业开放术语表",
      intro: "对卫星监测、土壤、再生管理与空间插值中关键术语的清晰、可验证定义。",
      bullets: [
        "卫星指数:NDVI、EVI、NDMI、NDRE、SAVI",
        "土壤:有机质、团聚体、入渗、生物学",
        "地统计学:克里金、IDW、RBF、半方差函数",
        "再生管理:覆盖作物、免耕、动物整合",
      ],
      ctaText: "浏览术语表",
    },
  },
  indices: {
    es: {
      title: "Índices satelitales NDVI, EVI, NDMI | AgRegen",
      description:
        "Guía libre sobre los índices satelitales más usados en agricultura regenerativa: NDVI, EVI, NDMI, NDRE y SAVI. Cómo se calculan, qué miden y cuándo aplicarlos.",
      h1: "Guía abierta de índices satelitales para agricultura",
      intro:
        "Aprende cómo cada índice satelital responde a la vegetación, el agua del suelo y el estrés hídrico, con casos reales monitoreados desde Sentinel-2 vía Google Earth Engine.",
      bullets: [
        "NDVI: vigor vegetal y biomasa fotosintéticamente activa",
        "EVI: alta sensibilidad en biomasa densa, robusto a la atmósfera",
        "NDMI: contenido de humedad en la canopia y suelo",
        "NDRE: detección temprana de estrés con borde rojo",
      ],
      ctaText: "Ver índices en mi parcela",
    },
    en: {
      title: "Satellite indices NDVI, EVI, NDMI for farms | AgRegen",
      description:
        "Open guide to the satellite indices most used in regenerative agriculture: NDVI, EVI, NDMI, NDRE and SAVI — how they are computed, what they measure and when to use them.",
      h1: "Open guide to satellite indices for agriculture",
      intro:
        "Learn how each satellite index responds to vegetation, soil water and water stress, with real cases monitored from Sentinel-2 via Google Earth Engine.",
      bullets: [
        "NDVI: plant vigor and photosynthetically active biomass",
        "EVI: high sensitivity in dense biomass, atmosphere-robust",
        "NDMI: moisture content in canopy and soil",
        "NDRE: early stress detection using red-edge",
      ],
      ctaText: "View indices on my parcel",
    },
    pt: {
      title: "Índices de satélite NDVI, EVI, NDMI | AgRegen",
      description:
        "Guia aberto dos índices de satélite mais usados em agricultura regenerativa: NDVI, EVI, NDMI, NDRE e SAVI — como são calculados, o que medem e quando aplicar.",
      h1: "Guia aberto de índices de satélite para agricultura",
      intro:
        "Aprenda como cada índice de satélite responde à vegetação, à água do solo e ao estresse hídrico, com casos reais monitorados pelo Sentinel-2 via Google Earth Engine.",
      bullets: [
        "NDVI: vigor vegetal e biomassa fotossinteticamente ativa",
        "EVI: alta sensibilidade em biomassa densa, robusto à atmosfera",
        "NDMI: teor de umidade no dossel e solo",
        "NDRE: detecção precoce de estresse com red-edge",
      ],
      ctaText: "Ver índices na minha parcela",
    },
    zh: {
      title: "农业卫星指数 NDVI、EVI、NDMI | AgRegen",
      description:
        "再生农业最常用卫星指数的开放指南:NDVI、EVI、NDMI、NDRE 与 SAVI 的计算方式、测量内容、使用时机以及配套的实际案例分析。",
      h1: "农业卫星指数开放指南",
      intro:
        "了解每个卫星指数如何响应植被、土壤水分与水分胁迫,提供基于 Google Earth Engine 的 Sentinel-2 真实案例。",
      bullets: [
        "NDVI:植物活力与光合活性生物量",
        "EVI:在高密度生物量下灵敏度高,抗大气干扰",
        "NDMI:冠层与土壤水分含量",
        "NDRE:利用红边的早期胁迫检测",
      ],
      ctaText: "在我的田块查看指数",
    },
  },
  crops: {
    es: {
      title: "Cultivos y manejo regenerativo por satélite | AgRegen",
      description:
        "Manejo regenerativo por cultivo con monitoreo satelital: trigo, maíz, soja, vid, frutales y hortalizas, con cobertura, rotación e integración animal.",
      h1: "Cultivos y manejo regenerativo monitoreado por satélite",
      intro:
        "Aprende cómo aplicar prácticas regenerativas en los principales cultivos extensivos e intensivos, apoyándote en monitoreo satelital, muestreo de suelos y prescripciones variables.",
      bullets: [
        "Trigo y cebada: cobertura entre ciclos y diagnóstico con NDVI",
        "Maíz y soja: rotación, fijación biológica y zonas variables",
        "Vid y frutales: NDMI para riego y manejo de canopia",
        "Hortalizas: rotaciones cortas e integración con animales",
      ],
      ctaText: "Ver mi cultivo",
    },
    en: {
      title: "Crops and satellite regenerative management | AgRegen",
      description:
        "Per-crop regenerative management with satellite monitoring: wheat, maize, soy, vine, fruit trees and vegetables, with cover crops, rotation and animal integration.",
      h1: "Crops and satellite-monitored regenerative management",
      intro:
        "Learn how to apply regenerative practices to the main extensive and intensive crops, using satellite monitoring, soil sampling and variable rate prescriptions.",
      bullets: [
        "Wheat and barley: between-cycle cover and NDVI diagnostics",
        "Maize and soy: rotation, biological fixation and variable zones",
        "Vine and fruit trees: NDMI for irrigation and canopy management",
        "Vegetables: short rotations and animal integration",
      ],
      ctaText: "View my crop",
    },
    pt: {
      title: "Cultivos e manejo regenerativo via satélite | AgRegen",
      description:
        "Manejo regenerativo por cultivo com monitoramento por satélite: trigo, milho, soja, vinha, fruteiras e hortaliças, com cobertura, rotação e integração animal.",
      h1: "Cultivos e manejo regenerativo monitorado por satélite",
      intro:
        "Aprenda como aplicar práticas regenerativas nos principais cultivos, apoiando-se em monitoramento por satélite, amostragem de solos e prescrições variáveis.",
      bullets: [
        "Trigo e cevada: cobertura entre ciclos e diagnóstico com NDVI",
        "Milho e soja: rotação, fixação biológica e zonas variáveis",
        "Vinha e fruteiras: NDMI para irrigação e manejo do dossel",
        "Hortaliças: rotações curtas e integração com animais",
      ],
      ctaText: "Ver meu cultivo",
    },
    zh: {
      title: "卫星监测的作物与再生管理 | AgRegen",
      description:
        "结合卫星监测的逐作物再生管理实践:小麦、玉米、大豆、葡萄、果树与蔬菜,涵盖覆盖作物、轮作、动物整合与变量施用处方。",
      h1: "结合卫星监测的作物与再生管理",
      intro:
        "学习如何在主要大田与园艺作物中应用再生农业实践,结合卫星监测、土壤采样与变量施用处方。",
      bullets: [
        "小麦与大麦:周期间覆盖作物与 NDVI 诊断",
        "玉米与大豆:轮作、生物固氮与变量分区",
        "葡萄与果树:利用 NDMI 进行灌溉与冠层管理",
        "蔬菜:短轮作与动物整合",
      ],
      ctaText: "查看我的作物",
    },
  },
};

export function getRouteContent(route: RouteKey, locale: SeoLocale): SeoContent {
  return ROUTE_CONTENT[route][locale] ?? ROUTE_CONTENT[route][DEFAULT_LOCALE];
}

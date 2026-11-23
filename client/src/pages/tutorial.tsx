import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import {
  BookOpen, MapPin, Satellite, FlaskConical, DollarSign,
  Users, Layers, Plane, Cpu, Video, ChevronRight, ChevronDown,
  CheckCircle, Info, Sprout, ArrowRight, Menu, X,
  BarChart3, CloudSun, Bell, Settings, Upload, Map,
  Leaf, TrendingUp, MessageCircle, Bot, Target, Zap
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────
interface Step {
  text: string;
  note?: string;
}

interface TipItem {
  text: string;
}

interface Section {
  id: string;
  icon: React.ElementType;
  color: string;
  bgColor: string;
  title: string;
  subtitle: string;
  intro: string;
  steps: Step[];
  tips?: TipItem[];
  links?: { label: string; href: string; protected?: boolean }[];
}

// ── Content ────────────────────────────────────────────────────────────────
const SECTIONS: Section[] = [
  {
    id: "primeros-pasos",
    icon: Sprout,
    color: "text-emerald-600",
    bgColor: "bg-emerald-50",
    title: "Primeros pasos",
    subtitle: "Registro y configuración inicial",
    intro:
      "Antes de usar la plataforma necesitas crear una cuenta gratuita y completar tu perfil técnico. Esto permite que el sistema personalice las recomendaciones de cultivo, precios de mercado y benchmarks según tu región.",
    steps: [
      { text: 'Haz clic en "Ingresar" en la esquina superior derecha y luego en "Registrarse".' },
      { text: "Completa el formulario con nombre, correo electrónico, contraseña y tu estado/provincia." },
      { text: "Inicia sesión y dirígete a tu perfil técnico (ícono de usuario → Perfil técnico)." },
      {
        text: "Llena los datos de tu perfil: tipo de productor, hectáreas totales, principales cultivos y prácticas regenerativas actuales.",
        note: "El perfil técnico es opcional pero mejora mucho las recomendaciones del Asistente IA.",
      },
    ],
    links: [
      { label: "Crear cuenta", href: "/auth" },
    ],
  },
  {
    id: "parcelas",
    icon: MapPin,
    color: "text-green-700",
    bgColor: "bg-green-50",
    title: "Parcelas",
    subtitle: "Registrar y administrar tus campos",
    intro:
      "Cada campo agrícola que monitoreas se llama \"parcela\". Puedes registrar tantas parcelas como necesites y cada una tendrá su propio panel con todos los datos agronómicos, satelitales y económicos.",
    steps: [
      { text: 'Desde el Panel principal haz clic en "Nueva parcela".' },
      { text: "Asigna un nombre, selecciona el cultivo actual y el tipo de práctica regenerativa." },
      {
        text: "Define el polígono del campo en el mapa: dibuja los límites haciendo clic o importa un archivo KML/GeoJSON si ya tienes el perímetro digitalizado.",
        note: "También puedes ingresar las coordenadas GPS manualmente si no tienes acceso a internet estable.",
      },
      { text: "Guarda la parcela. Serás redirigido al panel de detalle de la parcela." },
      { text: "Navega entre las pestañas de categorías (Campo, Nutrición, Agua, Economía, Precisión, Seguimiento) para acceder a los diferentes módulos de análisis." },
    ],
    tips: [
      { text: "Las categorías de pestañas agrupan funciones relacionadas para no abrumarte con 18 pestañas a la vez." },
      { text: "Puedes tener parcelas de diferentes cultivos y monitorearlas todas desde el Panel." },
    ],
    links: [
      { label: "Panel principal", href: "/dashboard", protected: true },
    ],
  },
  {
    id: "satelital",
    icon: Satellite,
    color: "text-blue-600",
    bgColor: "bg-blue-50",
    title: "Monitoreo satelital",
    subtitle: "Índices de vegetación con Sentinel-2",
    intro:
      "AgRegen usa imágenes del satélite Sentinel-2 (ESA) para calcular índices de vegetación sobre tus parcelas. Los índices más usados son NDVI (vigor vegetal), EVI (clorofila en zonas densas), y NDMI (humedad de la hoja). Las imágenes se actualizan aproximadamente cada 5 días.",
    steps: [
      { text: "Abre una parcela y dirígete a la categoría Seguimiento → pestaña Historial." },
      {
        text: "El sistema carga automáticamente el historial de índices de los últimos 3 meses vía Google Earth Engine.",
        note: "Solo se muestran imágenes con menos de 30% de nubosidad para garantizar datos confiables.",
      },
      { text: "Usa el gráfico de líneas para ver la evolución del NDVI/EVI/NDMI en el tiempo. Un aumento sostenido indica buena respuesta del cultivo." },
      { text: "En la pestaña \"Mapa satelital\" puedes ver el mapa de calor del índice sobre tu parcela. Cambia entre índices con el selector." },
      { text: "Haz clic en cualquier punto del mapa para ver el valor exacto del índice en esa zona." },
    ],
    tips: [
      { text: "Valores NDVI > 0.6 indican vegetación vigorosa. Valores < 0.3 pueden señalar estrés, suelo desnudo o cosecha reciente." },
      { text: "El comparador de fechas te permite contrastar dos momentos distintos para detectar avance o deterioro." },
    ],
  },
  {
    id: "suelo",
    icon: FlaskConical,
    color: "text-orange-700",
    bgColor: "bg-orange-50",
    title: "Análisis de suelo",
    subtitle: "Laboratorio, enmiendas y salud",
    intro:
      "Puedes cargar los resultados de tus análisis de laboratorio directamente en la plataforma. El sistema interpreta los valores y genera recomendaciones de enmiendas (cal, yeso, compost, etc.) para corregir deficiencias y mejorar la estructura del suelo.",
    steps: [
      { text: "En el panel de la parcela ve a la categoría Campo → pestaña Suelo." },
      { text: 'Haz clic en "Agregar análisis" y completa los datos del laboratorio: pH, MO, N, P, K, Ca, Mg, S, micronutrimentos y textura.' },
      { text: "El sistema muestra inmediatamente un semáforo de indicadores (verde/amarillo/rojo) comparando tus valores con rangos óptimos para el cultivo registrado." },
      {
        text: 'Para calcular enmiendas, ve a la sección "Calculadora de enmiendas" en la misma pestaña o desde el menú de navegación.',
        note: "La calculadora considera el tipo de suelo, CIC, y las metas de pH para sugerir dosis de cal y sulfatos.",
      },
      { text: "Puedes exportar el reporte de análisis y las recomendaciones como PDF/CSV desde el botón de descarga." },
    ],
    tips: [
      { text: "Sube el PDF del laboratorio como adjunto para tener el documento original guardado junto con los datos digitalizados." },
      { text: "El Asistente IA (pestaña Asistente) puede explicar cualquier resultado del análisis en lenguaje sencillo." },
    ],
  },
  {
    id: "economia",
    icon: DollarSign,
    color: "text-amber-600",
    bgColor: "bg-amber-50",
    title: "Economía y costos",
    subtitle: "KPIs de rentabilidad y precios de mercado",
    intro:
      "El módulo económico calcula automáticamente los indicadores clave de rentabilidad de tu ciclo agrícola: margen bruto, ROI, costo por tonelada y punto de equilibrio. Si no tienes un ciclo configurado, el sistema usa el precio actual del mercado (SNIIM) y el rendimiento promedio SIAP de tu estado para estimar los KPIs.",
    steps: [
      { text: "Ve a la categoría Economía → pestaña Costos de tu parcela." },
      { text: 'Agrega tus costos reales por categoría (semilla, fertilizante, mano de obra, maquinaria, etc.) usando el botón "Agregar costo".' },
      {
        text: "El panel de KPIs se actualiza en tiempo real mostrando el margen bruto, ROI, costo/tn y punto de equilibrio.",
        note: 'Si el panel muestra el badge "Auto · SNIIM + SIAP", significa que está usando el precio del mercado y el rendimiento promedio estatal en lugar de tus datos manuales. Esto solo ocurre cuando no has configurado un ciclo.',
      },
      { text: 'Para usar tus datos reales, haz clic en "Configurar ciclo" e ingresa el rendimiento esperado y precio objetivo.' },
      {
        text: "En la pestaña Comercialización verás el precio SNIIM en tiempo real y, si tienes costos registrados, el margen bruto estimado por hectárea directamente en el widget.",
        note: "SNIIM es el sistema nacional de información de mercados agropecuarios. Los precios se actualizan cada 6 horas.",
      },
    ],
    tips: [
      { text: "El ingreso potencial de carbono (VCM) aparece automáticamente en el panel KPIs si tu parcela tiene hectáreas y cultivo registrados. Es una estimación no certificada basada en precios de mercado voluntario." },
      { text: "Puedes registrar múltiples ciclos por año (invierno/verano) y comparar rentabilidades entre ciclos." },
    ],
  },
  {
    id: "comunidad",
    icon: Users,
    color: "text-teal-600",
    bgColor: "bg-teal-50",
    title: "Comunidad y RegenConnect",
    subtitle: "Red social de agricultores regenerativos",
    intro:
      "La comunidad es un foro social donde productores, investigadores y técnicos comparten experiencias, resultados de parcelas y preguntas agronómicas. RegenConnect es el asesor IA que encuentra productores que cultivan lo mismo que tú con buenos resultados documentados.",
    steps: [
      { text: 'Dirígete a "Comunidad" en el menú principal.' },
      { text: "Explora el feed de publicaciones. Puedes filtrar por tipo: Experiencias, Resultados de parcela, Preguntas, Consejos." },
      { text: 'Para publicar, haz clic en "Nueva publicación". Puedes adjuntar fotos y compartir datos de tus parcelas.' },
      { text: 'Usa "Me gusta" y "Comentar" para interactuar con otros miembros.' },
      {
        text: 'Para encontrar asesores entre tus pares, abre el panel "RegenConnect" (botón flotante en móvil o card en la barra lateral). Ingresa tu cultivo y la IA buscará productores con éxito documentado.',
        note: "RegenConnect analiza posts de tipo 'Resultados de parcela' y datos NDVI para identificar historias de éxito relevantes.",
      },
    ],
    tips: [
      { text: "Las publicaciones de tipo 'Resultados de parcela' pueden incluir datos satelitales reales de tu campo, lo que aumenta su credibilidad." },
      { text: "Puedes hacer que tus parcelas sean públicas para que otros usuarios las descubran como referencia." },
    ],
    links: [
      { label: "Ir a Comunidad", href: "/community" },
    ],
  },
  {
    id: "mvz",
    icon: Layers,
    color: "text-purple-600",
    bgColor: "bg-purple-50",
    title: "MVZ — Manejo por Zonas",
    subtitle: "Agricultura de precisión: muestreo, interpolación y prescripciones",
    intro:
      "El Módulo de Manejo por Zonas (MVZ) es la herramienta de agricultura de precisión de AgRegen. Permite diseñar campañas de muestreo de suelo, interpolar los resultados mediante métodos geoestadísticos, generar zonas de manejo diferencial y producir mapas de prescripción para tus equipos.",
    steps: [
      {
        text: "En la categoría Precisión de tu parcela ve a la pestaña MVZ → sub-pestaña Campo.",
        note: "Las 4 sub-pestañas de MVZ son: Campo (kriging/IDW), Satelital (desde índices), Dron (ortomosaico multibanda) y Tractor (importar/exportar para autoguiado).",
      },
      { text: "Crea una Campaña de muestreo y genera el diseño: elige entre grilla regular, cuadrícula, aleatorio estratificado o transecto." },
      { text: "Usa la pestaña Captura de campo para registrar los resultados analíticos en cada punto de muestreo, ya sea en campo (modo offline) o en oficina." },
      { text: "Ve a la pestaña Mapas e Interpolación. Selecciona la variable (pH, MO, P, etc.) y el método (IDW, Kriging ordinario, RBF, RF-Kriging). El geo-servicio Python calculará la superficie interpolada." },
      { text: "En la pestaña Zonas, el sistema agrupa el mapa en zonas de manejo homogéneas. Puedes ajustar el número de zonas y el método de zonificación." },
      { text: 'Desde Zonas haz clic en "Generar prescripción". El Asistente IA propone dosis diferenciadas por zona. Ajusta los valores y exporta en formato KML, KMZ, Shapefile o ISO-XML para cargar en tu equipo de autoguiado.' },
    ],
    tips: [
      { text: 'La sub-pestaña Satelital genera zonas directamente desde el índice NDVI/NDRE sin necesidad de muestreo de suelo. Útil como punto de partida rápido.' },
      { text: "Puedes importar zonas de un archivo externo (KML, GeoJSON, Shapefile) desde la sub-pestaña Tractor si ya tienes un mapa de prescripción de otro sistema." },
    ],
  },
  {
    id: "drones-iot",
    icon: Plane,
    color: "text-sky-600",
    bgColor: "bg-sky-50",
    title: "Drones e IoT",
    subtitle: "Imágenes multiespectrales y sensores en campo",
    intro:
      "Puedes integrar imágenes de drones multiespectrales (DJI Terra, Pix4D, Agisoft) y datos de sensores IoT para complementar el monitoreo satelital con mayor resolución espacial y datos en tiempo real.",
    steps: [
      {
        text: "En la categoría Precisión ve a la pestaña MVZ → sub-pestaña Dron.",
        note: "La pestaña Drones también es accesible desde la categoría Precisión → Drones directamente.",
      },
      { text: "Sube el GeoTIFF del ortomosaico generado por DJI Terra o Pix4D. El sistema detecta automáticamente las bandas (compatible con DJI P4 Multispectral y Mavic 3 Multispectral)." },
      { text: "Selecciona el índice a calcular (NDVI, NDRE, NDMI, EVI, GNDVI, MSAVI) y el número de zonas de manejo." },
      { text: "El sistema genera zonas de manejo directamente desde el ortomosaico del dron con la misma calidad que el flujo de kriging." },
      { text: "Para IoT, ve a la categoría Precisión → pestaña IoT. Registra tus dispositivos (sensores de temperatura, humedad, conductividad eléctrica) y visualiza sus lecturas en tiempo real." },
    ],
    tips: [
      { text: "La resolución del dron (1-10 cm/px) supera ampliamente la del satélite (10 m/px), por lo que las zonas de manejo serán más precisas en campos pequeños." },
      { text: "Los sensores IoT te alertan automáticamente cuando los valores salen del rango configurado." },
    ],
  },
  {
    id: "conferencias",
    icon: Video,
    color: "text-red-500",
    bgColor: "bg-red-50",
    title: "Conferencias",
    subtitle: "Capacitación y conocimiento experto",
    intro:
      "La sección de Conferencias reúne videos educativos sobre agricultura regenerativa, análisis de suelo, manejo hídrico y tecnologías de precisión. Cada conferencia tiene su propio foro de discusión para continuar el aprendizaje colaborativo.",
    steps: [
      { text: 'Dirígete a "Conferencias" en el menú principal.' },
      { text: "Explora el catálogo de videos. Puedes filtrar por etiquetas (suelo, agua, negocio, tecnología, etc.)." },
      { text: "Haz clic en una conferencia para ver el video, la información del expositor y la fecha del evento." },
      { text: "Desplázate hacia abajo para ver el foro de discusión de esa conferencia. Puedes crear hilos de discusión y responder preguntas de otros asistentes." },
    ],
    tips: [
      { text: "Las conferencias quedan grabadas permanentemente, por lo que puedes verlas en cualquier momento a tu propio ritmo." },
    ],
    links: [
      { label: "Ver conferencias", href: "/conferences" },
    ],
  },
];

// ── Sidebar nav item ───────────────────────────────────────────────────────
function SidebarItem({
  section,
  active,
  onClick,
}: {
  section: Section;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = section.icon;
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-left transition-all",
        active
          ? "bg-primary/10 text-primary font-semibold"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
      data-testid={`tutorial-nav-${section.id}`}
    >
      <div className={cn("w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0", section.bgColor)}>
        <Icon className={cn("w-4 h-4", section.color)} />
      </div>
      <span className="truncate">{section.title}</span>
      {active && <ChevronRight className="w-3.5 h-3.5 ml-auto flex-shrink-0 text-primary" />}
    </button>
  );
}

// ── Section content ────────────────────────────────────────────────────────
function SectionContent({ section }: { section: Section }) {
  const Icon = section.icon;
  return (
    <div id={section.id} className="scroll-mt-24 space-y-6" data-testid={`tutorial-section-${section.id}`}>
      {/* Header */}
      <div className={cn("rounded-2xl p-6 border", section.bgColor)}>
        <div className="flex items-start gap-4">
          <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0", section.bgColor, "border border-current/10")}>
            <Icon className={cn("w-6 h-6", section.color)} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-bold text-foreground">{section.title}</h2>
              <Badge variant="outline" className="text-xs">{section.subtitle}</Badge>
            </div>
            <p className="mt-2 text-muted-foreground leading-relaxed">{section.intro}</p>
          </div>
        </div>
      </div>

      {/* Steps */}
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <Target className="w-4 h-4" /> Cómo usarlo paso a paso
        </h3>
        <ol className="space-y-3">
          {section.steps.map((step, i) => (
            <li key={i} className="flex gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center mt-0.5">
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground leading-relaxed">{step.text}</p>
                {step.note && (
                  <div className="mt-1.5 flex items-start gap-1.5 text-xs text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md px-2.5 py-1.5">
                    <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span>{step.note}</span>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* Tips */}
      {section.tips && section.tips.length > 0 && (
        <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4 space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5" /> Consejos
          </h3>
          <ul className="space-y-1.5">
            {section.tips.map((tip, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-emerald-800 dark:text-emerald-300">
                <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-emerald-500" />
                {tip.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Quick links */}
      {section.links && section.links.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {section.links.map((link) => (
            <Button key={link.href} variant="outline" size="sm" asChild className="gap-1.5">
              <Link href={link.href}>
                {link.label}
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </Button>
          ))}
        </div>
      )}

      <hr className="border-border" />
    </div>
  );
}

// ── Mobile accordion item ──────────────────────────────────────────────────
function AccordionItem({ section }: { section: Section }) {
  const [open, setOpen] = useState(false);
  const Icon = section.icon;
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-muted/50 transition-colors"
        data-testid={`tutorial-accordion-${section.id}`}
      >
        <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0", section.bgColor)}>
          <Icon className={cn("w-5 h-5", section.color)} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-foreground">{section.title}</p>
          <p className="text-xs text-muted-foreground truncate">{section.subtitle}</p>
        </div>
        <ChevronDown className={cn("w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-border bg-background">
          <p className="text-sm text-muted-foreground leading-relaxed pt-3">{section.intro}</p>
          <ol className="space-y-2.5">
            {section.steps.map((step, i) => (
              <li key={i} className="flex gap-2.5">
                <div className="flex-shrink-0 w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center mt-0.5">
                  {i + 1}
                </div>
                <div>
                  <p className="text-sm text-foreground">{step.text}</p>
                  {step.note && (
                    <div className="mt-1 flex items-start gap-1 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-1">
                      <Info className="w-3 h-3 flex-shrink-0 mt-0.5" />
                      <span>{step.note}</span>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {section.tips && section.tips.length > 0 && (
            <ul className="space-y-1 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
              {section.tips.map((tip, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-emerald-800">
                  <CheckCircle className="w-3 h-3 flex-shrink-0 mt-0.5 text-emerald-500" />
                  {tip.text}
                </li>
              ))}
            </ul>
          )}
          {section.links && section.links.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {section.links.map((link) => (
                <Button key={link.href} variant="outline" size="sm" asChild>
                  <Link href={link.href}>{link.label} <ArrowRight className="w-3 h-3 ml-1" /></Link>
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function TutorialPage() {
  const [activeSection, setActiveSection] = useState(SECTIONS[0].id);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const scrollToSection = (id: string) => {
    setActiveSection(id);
    setMobileNavOpen(false);
    const el = document.getElementById(id);
    if (el) {
      const offset = 88;
      const top = el.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: "smooth" });
    }
  };

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        }
      },
      { rootMargin: "-30% 0px -60% 0px", threshold: 0 }
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="min-h-screen bg-muted/20" data-testid="tutorial-page">
      {/* ── Hero ── */}
      <div className="bg-gradient-to-br from-emerald-900 via-emerald-800 to-emerald-950 text-white">
        <div className="container mx-auto px-4 py-14 md:py-20">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-10 h-10 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center">
                <BookOpen className="w-5 h-5" />
              </div>
              <Badge className="bg-white/20 text-white border-white/30">Manual de uso</Badge>
            </div>
            <h1 className="text-3xl md:text-5xl font-bold tracking-tight mb-4 leading-tight" data-testid="tutorial-title">
              Tutorial de AgRegen 5.0
            </h1>
            <p className="text-lg md:text-xl text-white/80 leading-relaxed max-w-2xl">
              Guía completa de todas las funciones de la plataforma: desde registrar tu primera parcela hasta generar mapas de prescripción de precisión.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button variant="secondary" size="sm" asChild>
                <Link href="/auth" data-testid="tutorial-cta-register">Crear cuenta gratis <ArrowRight className="w-3.5 h-3.5 ml-1" /></Link>
              </Button>
              <Button variant="outline" size="sm" className="border-white/30 text-white hover:bg-white/10" asChild>
                <Link href="/dashboard" data-testid="tutorial-cta-dashboard">Ir al panel</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Mobile section picker ── */}
      <div className="md:hidden sticky top-[80px] z-30 bg-background border-b px-4 py-2 flex items-center justify-between">
        <span className="text-sm font-medium text-foreground truncate">
          {SECTIONS.find(s => s.id === activeSection)?.title ?? "Secciones"}
        </span>
        <Button variant="ghost" size="sm" className="gap-1.5 flex-shrink-0" onClick={() => setMobileNavOpen(!mobileNavOpen)}>
          {mobileNavOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          Secciones
        </Button>
      </div>
      {mobileNavOpen && (
        <div className="md:hidden fixed inset-0 top-[128px] z-20 bg-background/95 backdrop-blur-sm overflow-y-auto p-4">
          <nav className="space-y-1">
            {SECTIONS.map((s) => (
              <SidebarItem
                key={s.id}
                section={s}
                active={activeSection === s.id}
                onClick={() => scrollToSection(s.id)}
              />
            ))}
          </nav>
        </div>
      )}

      {/* ── Main layout ── */}
      <div className="container mx-auto px-4 py-8 md:py-12">
        <div className="flex gap-8">
          {/* Desktop sidebar */}
          <aside className="hidden md:block w-60 flex-shrink-0">
            <div className="sticky top-24 bg-background border border-border rounded-xl p-3 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-2 mb-2">Módulos</p>
              <nav className="space-y-0.5">
                {SECTIONS.map((s) => (
                  <SidebarItem
                    key={s.id}
                    section={s}
                    active={activeSection === s.id}
                    onClick={() => scrollToSection(s.id)}
                  />
                ))}
              </nav>
            </div>
          </aside>

          {/* Desktop: scrollable sections */}
          <main ref={contentRef} className="hidden md:block flex-1 min-w-0 space-y-10">
            {SECTIONS.map((s) => (
              <SectionContent key={s.id} section={s} />
            ))}

            {/* Bottom CTA */}
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="p-8 text-center space-y-4">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                  <Leaf className="w-7 h-7 text-primary" />
                </div>
                <h3 className="text-xl font-bold">¿Listo para empezar?</h3>
                <p className="text-muted-foreground max-w-md mx-auto text-sm">
                  Crea tu cuenta gratuita y registra tu primera parcela en menos de 5 minutos. No se requiere tarjeta de crédito.
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                  <Button asChild>
                    <Link href="/auth" data-testid="tutorial-bottom-cta">Comenzar ahora <ArrowRight className="w-4 h-4 ml-1.5" /></Link>
                  </Button>
                  <Button variant="outline" asChild>
                    <Link href="/community">Ver la comunidad</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </main>

          {/* Mobile: accordion */}
          <main className="md:hidden flex-1 min-w-0 space-y-3">
            {SECTIONS.map((s) => (
              <AccordionItem key={s.id} section={s} />
            ))}
            <Card className="border-primary/20 bg-primary/5 mt-4">
              <CardContent className="p-6 text-center space-y-3">
                <h3 className="text-lg font-bold">¿Listo para empezar?</h3>
                <p className="text-muted-foreground text-sm">Crea tu cuenta gratuita en menos de 5 minutos.</p>
                <Button asChild className="w-full">
                  <Link href="/auth">Comenzar ahora <ArrowRight className="w-4 h-4 ml-1.5" /></Link>
                </Button>
              </CardContent>
            </Card>
          </main>
        </div>
      </div>
    </div>
  );
}

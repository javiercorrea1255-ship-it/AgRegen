import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldCheck, Database, ArrowRight, Activity, Users, Sprout, Satellite, CloudSun, FlaskConical, Bot, MessageCircle, Video, Play, BookOpen, ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import soilImage from "@/assets/soil-texture.png";
import logoImage from "@/assets/logo-agregen.png";
import heroImage from "@/assets/hero-landing.png";
import stripImage from "@/assets/strip-rotation.png";
import cropsImage from "@/assets/crops-closeup.png";
import communityImage from "@/assets/community-farmers.png";
import { useI18n } from "@/lib/i18n-context";
import { useQuery } from "@tanstack/react-query";

const HERO_SLIDES = [
  { src: heroImage, alt: "Vista aérea de campos de agricultura regenerativa al amanecer", caption: "Monitoreo satelital de precisión para el campo" },
  { src: "https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=1920&q=80", alt: "Campos agrícolas con luz dorada al atardecer", caption: "Suelo vivo, cultivos resilientes y rentables" },
  { src: "https://images.unsplash.com/photo-1464226184884-fa280b87c399?w=1920&q=80", alt: "Cultivos verdes en finca regenerativa", caption: "Biodiversidad que nutre y protege el ecosistema" },
  { src: "https://images.unsplash.com/photo-1574323347407-f5e1ad6d020b?w=1920&q=80", alt: "Hileras de cultivos con cobertura vegetal", caption: "Cobertura permanente del suelo, siempre" },
  { src: "https://images.unsplash.com/photo-1625246333195-78d9c38ad449?w=1920&q=80", alt: "Pastizales regenerativos con ganadería integrada", caption: "Integración animal para regenerar la tierra" },
];

interface Conference {
  id: string; title: string; description: string; speaker: string;
  speakerBio: string | null; thumbnailUrl: string | null; videoUrl: string;
  eventDate: string | null; tags: string[]; viewsCount: number;
}

/* ── Scroll progress bar ────────────────────────────────────────────────── */
function ScrollProgressBar() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
      setProgress(scrollHeight - clientHeight > 0 ? (scrollTop / (scrollHeight - clientHeight)) * 100 : 0);
    };
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] h-[3px] bg-transparent">
      <div
        className="h-full bg-gradient-to-r from-green-400 via-emerald-500 to-green-300 transition-[width] duration-100"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

/* ── FadeIn on scroll ───────────────────────────────────────────────────── */
function FadeInSection({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } }, { threshold: 0.12 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(32px)",
        transition: `opacity 0.7s ease ${delay}ms, transform 0.7s ease ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

/* ── Animated counter ───────────────────────────────────────────────────── */
function AnimatedCounter({ target, suffix = "", prefix = "" }: { target: number; suffix?: string; prefix?: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !started.current) {
        started.current = true;
        const duration = 1800;
        const steps = 60;
        const inc = target / steps;
        let current = 0;
        const timer = setInterval(() => {
          current = Math.min(current + inc, target);
          setCount(Math.floor(current));
          if (current >= target) clearInterval(timer);
        }, duration / steps);
      }
    }, { threshold: 0.5 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [target]);
  return <span ref={ref}>{prefix}{count.toLocaleString("es-MX")}{suffix}</span>;
}

/* ── Floating orb ───────────────────────────────────────────────────────── */
function FloatingOrb({ style }: { style: React.CSSProperties }) {
  return <div className="absolute rounded-full blur-3xl pointer-events-none" style={style} />;
}

export default function Landing() {
  const { t } = useI18n();
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);
  const [stripOffset, setStripOffset] = useState(0);
  const stripRef = useRef<HTMLElement>(null);

  const next = useCallback(() => setSlide(s => (s + 1) % HERO_SLIDES.length), []);
  const prev = useCallback(() => setSlide(s => (s - 1 + HERO_SLIDES.length) % HERO_SLIDES.length), []);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(next, 6000);
    return () => clearInterval(id);
  }, [paused, next]);

  /* Parallax strip */
  useEffect(() => {
    const onScroll = () => {
      if (!stripRef.current) return;
      const rect = stripRef.current.getBoundingClientRect();
      const center = rect.top + rect.height / 2 - window.innerHeight / 2;
      setStripOffset(center * 0.25);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const { data: conferencesData } = useQuery<{ conferences: Conference[] }>({
    queryKey: ["/api/conferences", { status: "published", limit: 3 }],
    queryFn: async () => {
      const res = await fetch("/api/conferences?status=published&limit=3");
      if (!res.ok) throw new Error("Failed to fetch conferences");
      return res.json();
    },
    staleTime: 60000,
  });

  const featuredConferences = conferencesData?.conferences || [];

  return (
    <div className="flex flex-col min-h-screen" data-testid="landing-page">
      <ScrollProgressBar />

      {/* ── Hero Carousel ─────────────────────────────────────────────────── */}
      <section
        className="relative h-[90vh] flex items-center justify-center overflow-hidden pt-14 md:pt-20"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        data-testid="hero-carousel"
      >
        {/* Slides with Ken Burns zoom */}
        <div className="absolute inset-0 z-0">
          {HERO_SLIDES.map((s, i) => (
            <div
              key={i}
              className="absolute inset-0 transition-opacity duration-1000"
              style={{ opacity: i === slide ? 1 : 0 }}
              aria-hidden={i !== slide}
            >
              <img
                src={s.src}
                alt={s.alt}
                className="absolute inset-0 w-full h-full object-cover object-center"
                style={{
                  transform: i === slide ? "scale(1.06)" : "scale(1)",
                  transition: "transform 8s ease-out",
                }}
                loading={i === 0 ? "eager" : "lazy"}
              />
            </div>
          ))}
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-950/70 via-emerald-900/55 to-emerald-950/80" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/10 to-background" />
        </div>

        {/* Floating orbs */}
        <FloatingOrb style={{ width: 480, height: 480, background: "radial-gradient(circle, rgba(74,222,128,0.18) 0%, transparent 70%)", top: "5%", left: "-8%", animation: "floatOrb1 14s ease-in-out infinite" }} />
        <FloatingOrb style={{ width: 360, height: 360, background: "radial-gradient(circle, rgba(96,165,250,0.14) 0%, transparent 70%)", bottom: "10%", right: "-6%", animation: "floatOrb2 18s ease-in-out infinite" }} />
        <FloatingOrb style={{ width: 240, height: 240, background: "radial-gradient(circle, rgba(251,191,36,0.10) 0%, transparent 70%)", top: "40%", right: "20%", animation: "floatOrb3 22s ease-in-out infinite" }} />

        <style>{`
          @keyframes floatOrb1 { 0%,100%{transform:translate(0,0)} 33%{transform:translate(40px,-30px)} 66%{transform:translate(-20px,20px)} }
          @keyframes floatOrb2 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-50px,-40px)} }
          @keyframes floatOrb3 { 0%,100%{transform:translate(0,0)} 25%{transform:translate(30px,20px)} 75%{transform:translate(-30px,-10px)} }
          @keyframes marqueeScroll { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }
          @keyframes pulseGlow { 0%,100%{box-shadow:0 0 0 0 rgba(74,222,128,0.4)} 50%{box-shadow:0 0 0 20px rgba(74,222,128,0)} }
          @keyframes tiltCard { 0%,100%{transform:rotate(1deg)} 50%{transform:rotate(-0.5deg)} }
        `}</style>

        {/* Prev / Next arrows */}
        <button onClick={prev} className="absolute left-4 z-20 p-2 rounded-full bg-black/30 hover:bg-black/50 text-white backdrop-blur-sm transition-all border border-white/10 hover:scale-110" aria-label="Imagen anterior" data-testid="carousel-prev">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <button onClick={next} className="absolute right-4 z-20 p-2 rounded-full bg-black/30 hover:bg-black/50 text-white backdrop-blur-sm transition-all border border-white/10 hover:scale-110" aria-label="Siguiente imagen" data-testid="carousel-next">
          <ChevronRight className="w-6 h-6" />
        </button>

        {/* Main content */}
        <div className="relative z-10 container mx-auto px-4 text-center text-white max-w-4xl pt-16 md:pt-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/20 mb-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-sm font-medium">{t("landing.badge")}</span>
          </div>

          <h1 className="text-4xl md:text-6xl font-heading font-bold mb-6 tracking-tight leading-tight animate-in fade-in slide-in-from-bottom-6 duration-700 delay-100">
            {t("landing.heroTitle1")}<br />
            <span className="text-green-400 drop-shadow-[0_0_20px_rgba(74,222,128,0.5)]">{t("landing.heroHighlight1")}</span><br />
            {t("landing.heroTitle2")} <span className="text-blue-300 drop-shadow-[0_0_20px_rgba(147,197,253,0.5)]">{t("landing.heroHighlight2")}</span>
          </h1>

          <p className="text-xl md:text-2xl text-white/80 mb-10 max-w-2xl mx-auto font-light animate-in fade-in slide-in-from-bottom-8 duration-700 delay-200">
            {t("landing.heroDescription")}
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-in fade-in slide-in-from-bottom-10 duration-700 delay-300">
            <Button size="lg" className="h-14 px-8 text-lg bg-primary hover:bg-primary/90 border-none shadow-xl shadow-green-900/20 hover:shadow-green-500/30 hover:scale-105 transition-all duration-300" asChild>
              <Link href="/auth" data-testid="button-hero-start">{t("landing.startNow")}</Link>
            </Button>
            <Button size="lg" variant="outline" className="h-14 px-8 text-lg bg-white/5 border-white/20 text-white hover:bg-white/10 backdrop-blur-sm hover:scale-105 transition-all duration-300" asChild>
              <Link href="/community" data-testid="button-hero-community">{t("landing.joinCommunity")}</Link>
            </Button>
            <Button size="lg" variant="ghost" className="h-14 px-6 text-base bg-white/5 text-white/80 hover:bg-white/10 hover:text-white backdrop-blur-sm gap-2 hover:scale-105 transition-all duration-300" asChild>
              <Link href="/tutorial" data-testid="button-hero-tutorial">
                <BookOpen className="w-4 h-4" /> Ver manual
              </Link>
            </Button>
          </div>
        </div>

        {/* Bottom: dots + caption */}
        <div className="absolute bottom-8 left-0 right-0 z-20 flex flex-col items-center gap-3">
          <p key={slide} className="text-white/70 text-sm font-medium tracking-wide px-4 text-center animate-in fade-in duration-700">
            {HERO_SLIDES[slide].caption}
          </p>
          <div className="flex items-center gap-2">
            {HERO_SLIDES.map((_, i) => (
              <button
                key={i}
                onClick={() => setSlide(i)}
                aria-label={`Ir a imagen ${i + 1}`}
                data-testid={`carousel-dot-${i}`}
                className={`rounded-full transition-all duration-300 ${i === slide ? "w-6 h-2 bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]" : "w-2 h-2 bg-white/40 hover:bg-white/70"}`}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ── Capabilities strip ────────────────────────────────────────────── */}
      <section className="py-5 bg-primary/5 border-y border-primary/10 overflow-hidden">
        <div className="relative">
          <div className="absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-r from-primary/5 to-transparent z-10 pointer-events-none" />
          <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-primary/5 to-transparent z-10 pointer-events-none" />
          <div className="flex items-center gap-0" style={{ animation: "marqueeScroll 28s linear infinite", width: "max-content" }}>
            {[...Array(2)].map((_, set) => (
              <div key={set} className="flex items-center gap-8 px-8">
                {[
                  { icon: Satellite, label: "Sentinel-2 · NDVI · EVI · NDMI" },
                  { icon: Bot, label: "IA Agronómica multimodelo" },
                  { icon: ShieldCheck, label: "Acceso libre y gratuito" },
                  { icon: FlaskConical, label: "Análisis de suelo integrado" },
                  { icon: CloudSun, label: "Clima en tiempo real" },
                  { icon: MessageCircle, label: "Comunidad de productores" },
                  { icon: Database, label: "Datos soberanos del productor" },
                  { icon: Activity, label: "Transparencia algorítmica" },
                ].map(({ icon: Icon, label }) => (
                  <div key={label} className="flex items-center gap-2 shrink-0 text-muted-foreground hover:text-primary transition-colors duration-300 cursor-default select-none">
                    <Icon className="w-4 h-4 text-primary/70 shrink-0" />
                    <span className="text-sm font-medium whitespace-nowrap">{label}</span>
                    <span className="w-1 h-1 rounded-full bg-primary/30 ml-4" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Principles Section ────────────────────────────────────────────── */}
      <section className="py-24 bg-background">
        <div className="container mx-auto px-4">
          <FadeInSection>
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-heading font-bold text-foreground mb-4">{t("landing.principlesTitle")}</h2>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">{t("landing.principlesSubtitle")}</p>
            </div>
          </FadeInSection>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              { icon: ShieldCheck, title: t("landing.openAccess"), description: t("landing.openAccessDesc") },
              { icon: Database, title: t("landing.dataSovereignty"), description: t("landing.dataSovereigntyDesc") },
              { icon: Activity, title: t("landing.algorithmicTransparency"), description: t("landing.algorithmicTransparencyDesc") },
            ].map((p, i) => (
              <FadeInSection key={p.title} delay={i * 120}>
                <PrincipleCard icon={p.icon} title={p.title} description={p.description} />
              </FadeInSection>
            ))}
          </div>
        </div>
      </section>

      {/* ── Visual divider with parallax ──────────────────────────────────── */}
      <section ref={stripRef} className="relative h-48 md:h-64 lg:h-72 overflow-hidden" aria-hidden="true">
        <img
          src={stripImage}
          alt=""
          className="absolute inset-0 w-full h-full object-cover object-center"
          style={{ transform: `translateY(${stripOffset}px)`, transition: "transform 0.05s linear" }}
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background via-transparent to-secondary/20" />
        {/* Overlay text */}
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-white/80 text-xl md:text-2xl font-heading font-semibold tracking-wider text-center px-4 drop-shadow-lg backdrop-blur-[1px]">
            "La tierra no es una herencia de nuestros padres,<br className="hidden sm:block" /> sino un préstamo de nuestros hijos."
          </p>
        </div>
      </section>

      {/* ── Features Section ──────────────────────────────────────────────── */}
      <section className="py-24 bg-secondary/20 border-y border-border">
        <div className="container mx-auto px-4">
          <FadeInSection>
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-heading font-bold text-foreground mb-4">{t("landing.featuresTitle")}</h2>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">{t("landing.featuresSubtitle")}</p>
            </div>
          </FadeInSection>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: Satellite, title: t("landing.featureSatellite"), description: t("landing.featureSatelliteDesc"), color: "text-blue-500", bgColor: "bg-blue-500/10" },
              { icon: CloudSun, title: t("landing.featureClimate"), description: t("landing.featureClimateDesc"), color: "text-amber-500", bgColor: "bg-amber-500/10" },
              { icon: FlaskConical, title: t("landing.featureSoilAnalysis"), description: t("landing.featureSoilAnalysisDesc"), color: "text-orange-700", bgColor: "bg-orange-700/10" },
              { icon: Bot, title: t("landing.featureAI"), description: t("landing.featureAIDesc"), color: "text-purple-500", bgColor: "bg-purple-500/10" },
              { icon: MessageCircle, title: t("landing.featureCommunity"), description: t("landing.featureCommunityDesc"), color: "text-green-600", bgColor: "bg-green-600/10" },
              { icon: Video, title: t("landing.featureConferences"), description: t("landing.featureConferencesDesc"), color: "text-red-500", bgColor: "bg-red-500/10" },
            ].map((f, i) => (
              <FadeInSection key={f.title} delay={i * 80}>
                <FeatureCard icon={f.icon} title={f.title} description={f.description} color={f.color} bgColor={f.bgColor} />
              </FadeInSection>
            ))}
          </div>
        </div>
      </section>

      {/* ── Feature Highlight: Soil & Satellite ───────────────────────────── */}
      <section className="py-24 bg-background overflow-hidden">
        <div className="container mx-auto px-4">
          <div className="flex flex-col lg:flex-row items-center gap-16">
            <FadeInSection className="lg:w-1/2 space-y-8">
              <div className="space-y-8">
                <h2 className="text-4xl font-heading font-bold text-foreground">
                  {t("landing.monitoringTitle1")} <span className="text-primary">{t("landing.monitoringOrbit")}</span> {t("landing.monitoringTitle2")} <span className="text-[#8B5A2B]">{t("landing.monitoringSoil")}</span>.
                </h2>
                <p className="text-lg text-muted-foreground leading-relaxed">{t("landing.monitoringDesc")}</p>

                <ul className="space-y-4">
                  {[t("landing.feature1"), t("landing.feature2"), t("landing.feature3"), t("landing.feature4")].map((item, i) => (
                    <FadeInSection key={i} delay={i * 100}>
                      <li className="flex items-center gap-3 text-foreground font-medium">
                        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                          <Sprout className="w-4 h-4" />
                        </div>
                        {item}
                      </li>
                    </FadeInSection>
                  ))}
                </ul>

                <Button variant="outline" className="mt-4 hover:scale-105 transition-transform duration-300" asChild>
                  <Link href="/auth" data-testid="button-view-demo">{t("landing.viewDemo")} <ArrowRight className="ml-2 w-4 h-4" /></Link>
                </Button>
              </div>
            </FadeInSection>

            <FadeInSection delay={200} className="lg:w-1/2 relative">
              <div className="relative">
                <div className="relative z-10 rounded-2xl overflow-hidden shadow-2xl border border-white/20 rotate-1 hover:rotate-0 transition-transform duration-500">
                  <img src={soilImage} alt="Salud del Suelo" className="w-full h-auto object-cover" />
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 backdrop-blur-md p-4 text-white">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-xs text-white/60 uppercase tracking-wider">{t("landing.analysis")}</p>
                        <p className="font-mono text-lg">{t("landing.organicMatter")}</p>
                      </div>
                      <div className="h-2 w-24 bg-white/20 rounded-full overflow-hidden">
                        <div className="h-full bg-green-400 w-[70%] animate-pulse" />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="hidden md:block absolute -top-8 -right-6 w-56 lg:w-64 rounded-2xl overflow-hidden shadow-2xl border border-white/30 -rotate-3 hover:rotate-0 transition-transform duration-500 z-20">
                  <img src={cropsImage} alt="Vista cercana de un cultivo regenerativo sano" className="w-full h-32 lg:h-36 object-cover" loading="lazy" />
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 backdrop-blur-md p-2 text-white">
                    <div className="flex items-center gap-2">
                      <Satellite className="w-3.5 h-3.5 text-blue-300" />
                      <p className="font-mono text-xs">NDVI · 0.78</p>
                    </div>
                  </div>
                </div>

                <div className="absolute -top-10 -right-10 w-64 h-64 bg-primary/10 rounded-full blur-3xl -z-10" />
                <div className="absolute -bottom-10 -left-10 w-64 h-64 bg-orange-500/10 rounded-full blur-3xl -z-10" />
              </div>
            </FadeInSection>
          </div>
        </div>
      </section>

      {/* ── Featured Conferences Section ──────────────────────────────────── */}
      <section className="py-24 bg-secondary/20 border-y border-border">
        <div className="container mx-auto px-4">
          <FadeInSection>
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-heading font-bold text-foreground mb-4">{t("landing.featuredConferencesTitle")}</h2>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">{t("landing.featuredConferencesSubtitle")}</p>
            </div>
          </FadeInSection>

          {featuredConferences.length > 0 ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8 mb-10">
              {featuredConferences.map((conf, i) => (
                <FadeInSection key={conf.id} delay={i * 120}>
                  <ConferenceCard conference={conf} watchLabel={t("landing.watchConference")} />
                </FadeInSection>
              ))}
            </div>
          ) : (
            <FadeInSection>
              <div className="text-center py-12 text-muted-foreground mb-10">
                <Video className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>{t("landing.noFeaturedConferences")}</p>
              </div>
            </FadeInSection>
          )}

          <FadeInSection delay={300}>
            <div className="text-center">
              <Button variant="outline" size="lg" className="hover:scale-105 transition-transform duration-300" asChild>
                <Link href="/conferences" data-testid="button-view-all-conferences">{t("landing.viewAllConferences")} <ArrowRight className="ml-2 w-4 h-4" /></Link>
              </Button>
            </div>
          </FadeInSection>
        </div>
      </section>

      {/* ── Community CTA ─────────────────────────────────────────────────── */}
      <section className="relative py-24 text-primary-foreground text-center overflow-hidden">
        <img src={communityImage} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover object-center scale-105" loading="lazy" />
        <div className="absolute inset-0 bg-primary/85" />
        <div className="absolute inset-0 bg-gradient-to-b from-primary/40 via-primary/70 to-primary/90" />

        {/* Animated rings */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-64 h-64 rounded-full border border-white/10 animate-ping" style={{ animationDuration: "3s" }} />
          <div className="absolute w-96 h-96 rounded-full border border-white/5 animate-ping" style={{ animationDuration: "4s", animationDelay: "1s" }} />
        </div>

        <div className="container mx-auto px-4 max-w-3xl relative z-10">
          <FadeInSection>
            <div
              className="w-20 h-20 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-6 border border-white/20"
              style={{ animation: "pulseGlow 2.5s ease-in-out infinite" }}
            >
              <Users className="w-10 h-10" />
            </div>
            <h2 className="text-4xl font-heading font-bold mb-6">{t("landing.communityTitle")}</h2>
            <p className="text-xl opacity-90 mb-10 font-light">{t("landing.communityDesc")}</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button size="lg" variant="secondary" className="font-semibold hover:scale-105 transition-transform duration-300" asChild>
                <Link href="/community" data-testid="button-cta-community">{t("landing.accessForums")}</Link>
              </Button>
              <Button size="lg" variant="outline" className="font-semibold border-white/30 text-white hover:bg-white/10 hover:scale-105 transition-all duration-300" asChild>
                <Link href="/auth" data-testid="button-cta-register">{t("landing.startNow")}</Link>
              </Button>
            </div>
          </FadeInSection>
        </div>
      </section>

      {/* ── Partners marquee ──────────────────────────────────────────────── */}
      <section className="py-20 bg-background">
        <div className="container mx-auto px-4">
          <FadeInSection>
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-heading font-bold text-foreground mb-4">{t("landing.partnersTitle")}</h2>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">{t("landing.partnersSubtitle")}</p>
            </div>
          </FadeInSection>

          {/* Marquee */}
          <div className="relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-20 bg-gradient-to-r from-background to-transparent z-10 pointer-events-none" />
            <div className="absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-background to-transparent z-10 pointer-events-none" />
            <div className="flex" style={{ animation: "marqueeScroll 18s linear infinite", width: "max-content" }}>
              {[...Array(2)].map((_, set) => (
                <div key={set} className="flex items-center gap-16 px-8">
                  <PartnerLogo href="https://www.chapingo.mx" src="/partners/chapingo.png" name="Universidad Autónoma Chapingo" testId={`link-partner-chapingo-${set}`} />
                  <PartnerLogo href="https://www.ciestaam.edu.mx" src="/partners/ciestaam.png" name="CIESTAAM" testId={`link-partner-ciestaam-${set}`} />
                  <PartnerLogo href="#" src="/partners/red-agroinnovacion.png" name="Red Agroinnovación" testId={`link-partner-red-agroinnovacion-${set}`} />
                  <PartnerLogo href="#" src="/partners/directo-al-campo.png" name="Directo al Campo" testId={`link-partner-directo-al-campo-${set}`} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className="py-16 bg-card border-t border-border">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-4 gap-12 mb-12">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <img src={logoImage} alt="AgRegen" className="h-10 w-auto" />
                <span className="text-xl font-heading font-bold text-foreground">AgRegen 5.0</span>
              </div>
              <p className="text-muted-foreground text-sm leading-relaxed">{t("landing.footerAbout")}</p>
            </div>

            <div>
              <h3 className="font-heading font-semibold text-foreground mb-4">{t("landing.footerQuickLinks")}</h3>
              <ul className="space-y-2">
                <li><Link href="/dashboard" className="text-muted-foreground hover:text-primary transition-colors text-sm">{t("landing.footerPlatform")}</Link></li>
                <li><Link href="/conferences" className="text-muted-foreground hover:text-primary transition-colors text-sm">{t("landing.footerConferences")}</Link></li>
                <li><Link href="/community" className="text-muted-foreground hover:text-primary transition-colors text-sm">{t("landing.footerCommunity")}</Link></li>
                <li><Link href="/auth" className="text-muted-foreground hover:text-primary transition-colors text-sm">{t("landing.footerRegister")}</Link></li>
              </ul>
            </div>

            <div>
              <h3 className="font-heading font-semibold text-foreground mb-4">{t("landing.footerLearn")}</h3>
              <ul className="space-y-2">
                <li><a href="/glosario" className="text-muted-foreground hover:text-primary transition-colors text-sm" data-testid="link-footer-glossary">{t("landing.footerGlossary")}</a></li>
                <li><a href="/indices" className="text-muted-foreground hover:text-primary transition-colors text-sm" data-testid="link-footer-indices">{t("landing.footerIndices")}</a></li>
                <li><a href="/cultivos" className="text-muted-foreground hover:text-primary transition-colors text-sm" data-testid="link-footer-crops">{t("landing.footerCrops")}</a></li>
                <li><a href="/casos" className="text-muted-foreground hover:text-primary transition-colors text-sm" data-testid="link-footer-cases">{t("landing.footerCases")}</a></li>
              </ul>
            </div>

            <div>
              <h3 className="font-heading font-semibold text-foreground mb-4">{t("landing.footerContact")}</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>contacto@agregen.org</li>
                <li>Universidad Autónoma Chapingo</li>
                <li>Texcoco, Estado de México</li>
              </ul>
            </div>
          </div>

          <div className="border-t border-border pt-8 text-center text-muted-foreground text-sm">
            <p>{t("landing.footer")}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function PrincipleCard({ icon: Icon, title, description }: { icon: any; title: string; description: string }) {
  return (
    <Card className="border-none shadow-lg hover:shadow-xl transition-all duration-500 group hover:-translate-y-1">
      <CardContent className="pt-8 text-center px-6 pb-8">
        <div className="w-14 h-14 mx-auto bg-secondary/30 text-secondary-foreground rounded-full flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-primary/10 group-hover:text-primary transition-all duration-300">
          <Icon className="w-7 h-7" />
        </div>
        <h3 className="text-xl font-heading font-semibold mb-3">{title}</h3>
        <p className="text-muted-foreground leading-relaxed">{description}</p>
      </CardContent>
    </Card>
  );
}

function FeatureCard({ icon: Icon, title, description, color, bgColor }: { icon: any; title: string; description: string; color: string; bgColor: string }) {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const cardRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((e.clientY - rect.top) / rect.height - 0.5) * 8;
    const y = -((e.clientX - rect.left) / rect.width - 0.5) * 8;
    setTilt({ x, y });
  };

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setTilt({ x: 0, y: 0 })}
      style={{ transform: `perspective(600px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`, transition: "transform 0.15s ease" }}
    >
      <Card className="border border-border hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 group h-full">
        <CardContent className="p-6">
          <div className={`w-12 h-12 rounded-xl ${bgColor} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300`}>
            <Icon className={`w-6 h-6 ${color}`} />
          </div>
          <h3 className="text-lg font-heading font-semibold mb-2 text-foreground">{title}</h3>
          <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>
        </CardContent>
      </Card>
    </div>
  );
}

function ConferenceCard({ conference, watchLabel }: { conference: Conference; watchLabel: string }) {
  const thumbnailUrl = conference.thumbnailUrl || getYouTubeThumbnail(conference.videoUrl);
  return (
    <Card className="overflow-hidden border border-border hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group">
      <div className="relative aspect-video bg-muted overflow-hidden">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt={conference.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-primary/5">
            <Video className="w-12 h-12 text-primary/40" />
          </div>
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors duration-300 flex items-center justify-center">
          <div className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100 transition-all duration-300 shadow-lg">
            <Play className="w-6 h-6 text-primary ml-1" />
          </div>
        </div>
      </div>
      <CardContent className="p-5">
        <h3 className="font-heading font-semibold text-foreground mb-1 line-clamp-2">{conference.title}</h3>
        <p className="text-sm text-muted-foreground mb-3">{conference.speaker}</p>
        {conference.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {conference.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-full">{tag}</span>
            ))}
          </div>
        )}
        <Button variant="ghost" size="sm" className="w-full text-primary hover:text-primary group-hover:bg-primary/5 transition-colors" asChild>
          <Link href={`/conferences/${conference.id}`} data-testid={`button-watch-conference-${conference.id}`}>
            {watchLabel} <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function PartnerLogo({ href, src, name, testId }: { href: string; src: string; name: string; testId: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={testId}
      className="flex items-center justify-center opacity-60 hover:opacity-100 transition-all duration-300 hover:scale-110 shrink-0"
      aria-label={name}
    >
      <img src={src} alt={name} className="h-10 max-w-[140px] object-contain filter grayscale hover:grayscale-0 transition-all duration-300" loading="lazy" />
    </a>
  );
}

function getYouTubeThumbnail(url: string): string | null {
  const match = url.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
  return match ? `https://img.youtube.com/vi/${match[1]}/hqdefault.jpg` : null;
}

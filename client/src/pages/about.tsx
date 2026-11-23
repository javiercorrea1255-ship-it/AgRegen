import { useI18n } from "@/lib/i18n-context";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import heroImage from "@/assets/hero-about.png";
import {
  Leaf, Eye, ShieldCheck, Globe2, Users, Sprout,
  Target, Heart, BookOpen, Satellite, Brain, Database
} from "lucide-react";

const PRINCIPLES = [
  { icon: Eye, color: "text-blue-600 bg-blue-100" },
  { icon: ShieldCheck, color: "text-emerald-600 bg-emerald-100" },
  { icon: Brain, color: "text-purple-600 bg-purple-100" },
];

const FEATURES = [
  { icon: Satellite, color: "text-sky-600 bg-sky-50" },
  { icon: Brain, color: "text-violet-600 bg-violet-50" },
  { icon: Users, color: "text-amber-600 bg-amber-50" },
  { icon: Database, color: "text-emerald-600 bg-emerald-50" },
  { icon: BookOpen, color: "text-rose-600 bg-rose-50" },
  { icon: Globe2, color: "text-blue-600 bg-blue-50" },
];

export default function AboutPage() {
  const { t } = useI18n();

  const principles = [
    { title: t("about.principle1Title"), desc: t("about.principle1Desc") },
    { title: t("about.principle2Title"), desc: t("about.principle2Desc") },
    { title: t("about.principle3Title"), desc: t("about.principle3Desc") },
  ];

  const features = [
    { title: t("about.feature1Title"), desc: t("about.feature1Desc") },
    { title: t("about.feature2Title"), desc: t("about.feature2Desc") },
    { title: t("about.feature3Title"), desc: t("about.feature3Desc") },
    { title: t("about.feature4Title"), desc: t("about.feature4Desc") },
    { title: t("about.feature5Title"), desc: t("about.feature5Desc") },
    { title: t("about.feature6Title"), desc: t("about.feature6Desc") },
  ];

  return (
    <div className="bg-muted/20 min-h-screen" data-testid="about-page">
      <div className="relative overflow-hidden text-white">
        {/* Real photograph of farmer hands cradling soil with a seedling
            (no embedded text) plus emerald gradient overlays so the white
            headline stays readable. Replaces the legacy /regen-hero.png
            which was a screenshot of the site itself in English. */}
        <img
          src={heroImage}
          alt="Manos de un agricultor sosteniendo suelo fértil con una plántula"
          className="absolute inset-0 w-full h-full object-cover object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-950/75 via-emerald-900/55 to-emerald-950/85" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/30" />
        <div className="max-w-5xl mx-auto px-4 py-16 md:py-24 relative z-10">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-3 rounded-2xl bg-white/15 backdrop-blur-sm">
              <Leaf className="h-8 w-8" />
            </div>
            <Badge className="bg-white/20 text-white border-white/30 text-sm px-3 py-1">
              AgRegen 5.0
            </Badge>
          </div>
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight mb-4 leading-tight max-w-3xl" data-testid="about-title">
            {t("about.heroTitle")}
          </h1>
          <p className="text-lg md:text-xl text-white/80 max-w-2xl leading-relaxed">
            {t("about.heroSubtitle")}
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-12 space-y-12">
        <div className="grid md:grid-cols-2 gap-8 items-center">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Target className="h-5 w-5 text-primary" />
              <h2 className="text-sm font-semibold text-primary uppercase tracking-wider">{t("about.missionLabel")}</h2>
            </div>
            <h3 className="text-2xl md:text-3xl font-bold mb-4" data-testid="about-mission-title">{t("about.missionTitle")}</h3>
            <p className="text-muted-foreground leading-relaxed">{t("about.missionDesc")}</p>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Sprout className="h-5 w-5 text-primary" />
              <h2 className="text-sm font-semibold text-primary uppercase tracking-wider">{t("about.visionLabel")}</h2>
            </div>
            <h3 className="text-2xl md:text-3xl font-bold mb-4" data-testid="about-vision-title">{t("about.visionTitle")}</h3>
            <p className="text-muted-foreground leading-relaxed">{t("about.visionDesc")}</p>
          </div>
        </div>

        <div>
          <div className="text-center mb-8">
            <h2 className="text-2xl md:text-3xl font-bold mb-2">{t("about.principlesTitle")}</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">{t("about.principlesSubtitle")}</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {principles.map((p, i) => {
              const Icon = PRINCIPLES[i].icon;
              return (
                <Card key={i} className="border-0 shadow-sm bg-white hover:shadow-md transition-shadow" data-testid={`about-principle-${i}`}>
                  <CardContent className="p-6">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${PRINCIPLES[i].color}`}>
                      <Icon className="h-6 w-6" />
                    </div>
                    <h3 className="font-bold text-lg mb-2">{p.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{p.desc}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        <div>
          <div className="text-center mb-8">
            <h2 className="text-2xl md:text-3xl font-bold mb-2">{t("about.featuresTitle")}</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">{t("about.featuresSubtitle")}</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {features.map((f, i) => {
              const Icon = FEATURES[i].icon;
              return (
                <Card key={i} className="border-0 shadow-sm bg-white hover:shadow-md transition-shadow" data-testid={`about-feature-${i}`}>
                  <CardContent className="p-5">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${FEATURES[i].color}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="font-semibold mb-1.5">{f.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        <Card className="border-0 shadow-sm bg-white overflow-hidden">
          <CardContent className="p-0">
            <div className="bg-gradient-to-r from-primary/5 to-emerald-50 p-8 md:p-10">
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-xl bg-primary/10 shrink-0">
                  <Heart className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-xl md:text-2xl font-bold mb-3">{t("about.openSourceTitle")}</h2>
                  <p className="text-muted-foreground leading-relaxed mb-4">{t("about.openSourceDesc")}</p>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="bg-white/80">React + TypeScript</Badge>
                    <Badge variant="outline" className="bg-white/80">Node.js + Express</Badge>
                    <Badge variant="outline" className="bg-white/80">PostgreSQL + Drizzle</Badge>
                    <Badge variant="outline" className="bg-white/80">Google Earth Engine</Badge>
                    <Badge variant="outline" className="bg-white/80">Open-Meteo API</Badge>
                    <Badge variant="outline" className="bg-white/80">OpenAI / Sinong AI</Badge>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

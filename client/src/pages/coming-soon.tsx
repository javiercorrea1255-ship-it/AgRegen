import { Link } from "wouter";
import { useI18n } from "@/lib/i18n-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Sparkles } from "lucide-react";

interface ComingSoonProps {
  titleKey: string;
  descriptionKey: string;
  fallbackTitle: string;
  fallbackDescription: string;
  testId: string;
}

export function ComingSoon({
  titleKey,
  descriptionKey,
  fallbackTitle,
  fallbackDescription,
  testId,
}: ComingSoonProps) {
  const { t } = useI18n();
  const title = (t(titleKey) as string) || fallbackTitle;
  const description = (t(descriptionKey) as string) || fallbackDescription;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6" data-testid={`page-${testId}`}>
      <Card className="max-w-xl w-full">
        <CardContent className="p-8 text-center space-y-4">
          <div className="flex justify-center">
            <Sparkles className="h-10 w-10 text-primary" />
          </div>
          <h1 className="text-2xl font-bold" data-testid={`text-title-${testId}`}>{title}</h1>
          <p className="text-muted-foreground" data-testid={`text-desc-${testId}`}>{description}</p>
          <Link href="/">
            <Button variant="outline" data-testid={`button-home-${testId}`}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {(t("common.backHome") as string) || "Volver al inicio"}
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

export function GlosarioPage() {
  return (
    <ComingSoon
      titleKey="seo.glossary.title"
      descriptionKey="seo.glossary.description"
      fallbackTitle="Glosario de agricultura regenerativa"
      fallbackDescription="Definiciones claras de términos clave: NDVI, EVI, NDMI, kriging, manejo holístico, biodiversidad funcional. Próximamente disponible."
      testId="glosario"
    />
  );
}

export function IndicesPage() {
  return (
    <ComingSoon
      titleKey="seo.indices.title"
      descriptionKey="seo.indices.description"
      fallbackTitle="Índices satelitales para agricultura"
      fallbackDescription="Guía abierta sobre NDVI, EVI, NDMI, NDRE y SAVI con casos prácticos en parcelas reales. Próximamente disponible."
      testId="indices"
    />
  );
}

export function CultivosPage() {
  return (
    <ComingSoon
      titleKey="seo.crops.title"
      descriptionKey="seo.crops.description"
      fallbackTitle="Cultivos y manejo regenerativo"
      fallbackDescription="Manejo regenerativo por cultivo: trigo, maíz, soja, vid, frutales y hortalizas. Próximamente disponible."
      testId="cultivos"
    />
  );
}

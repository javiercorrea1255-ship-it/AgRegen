import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Satellite, Plane, Cpu, Droplets, Target, Loader2, Check, Sprout } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n-context";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getActiveModules, HIDE_DRONES, HIDE_IOT, type ToolModule } from "@shared/tool-modules";

export default function TechProfile() {
  const { user, refreshUser, needsTechProfile } = useAuth();
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const isOnboarding = needsTechProfile;

  const [producerType, setProducerType] = useState(user?.producerType || "pequeno");
  const [hasDrones, setHasDrones] = useState(user?.hasDrones || false);
  const [hasIoT, setHasIoT] = useState(user?.hasIoT || false);
  const [techLevel, setTechLevel] = useState(user?.techLevel || "basico");

  const activeModules = getActiveModules({ producerType, hasDrones, hasIoT, techLevel });

  const saveMutation = useMutation({
    mutationFn: async (data: { producerType: string; hasDrones: boolean; hasIoT: boolean; techLevel: string }) => {
      const res = await fetch("/api/auth/tech-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Error al guardar");
      return res.json();
    },
    onSuccess: async () => {
      await refreshUser();
      queryClient.invalidateQueries({ queryKey: ["auth-user"] });
      if (isOnboarding) {
        setLocation("/dashboard");
      } else {
        toast({ title: t("techProfile.saved"), description: t("techProfile.savedDesc") });
      }
    },
    onError: () => {
      toast({ title: t("techProfile.saveError"), description: t("techProfile.saveError"), variant: "destructive" });
    },
  });

  const handleSave = () => {
    saveMutation.mutate({ producerType, hasDrones, hasIoT, techLevel });
  };

  const moduleInfo: Record<ToolModule, { icon: React.ReactNode; label: string; desc: string }> = {
    "base": { icon: <Satellite className="w-5 h-5" />, label: t("techProfile.moduleSatellite"), desc: t("techProfile.moduleSatelliteDesc") },
    "drones": { icon: <Plane className="w-5 h-5" />, label: t("techProfile.moduleDrones"), desc: t("techProfile.moduleDronesDesc") },
    "iot": { icon: <Cpu className="w-5 h-5" />, label: t("techProfile.moduleIoT"), desc: t("techProfile.moduleIoTDesc") },
    "riego-inteligente": { icon: <Droplets className="w-5 h-5" />, label: t("techProfile.moduleIrrigation"), desc: t("techProfile.moduleIrrigationDesc") },
    "precision": { icon: <Target className="w-5 h-5" />, label: t("techProfile.modulePrecision"), desc: t("techProfile.modulePrecisionDesc") },
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-3xl">
      {isOnboarding ? (
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
            <Sprout className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold" data-testid="text-tech-profile-title">{t("techProfile.welcomeTitle")}</h1>
          <p className="text-muted-foreground mt-2 max-w-md mx-auto">{t("techProfile.welcomeSubtitle")}</p>
        </div>
      ) : (
        <>
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="mb-4" data-testid="btn-back-dashboard">
              <ArrowLeft className="w-4 h-4 mr-2" /> {t("techProfile.backToDashboard")}
            </Button>
          </Link>
          <div className="mb-6">
            <h1 className="text-2xl font-bold" data-testid="text-tech-profile-title">{t("techProfile.title")}</h1>
            <p className="text-muted-foreground mt-1">{t("techProfile.subtitle")}</p>
          </div>
        </>
      )}

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("techProfile.producerTypeTitle")}</CardTitle>
            <CardDescription>{t("techProfile.producerTypeDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(["pequeno", "mediano", "grande"] as const).map((type) => (
                <Button
                  key={type}
                  type="button"
                  variant={producerType === type ? "default" : "outline"}
                  className="flex flex-col h-auto py-3 gap-1"
                  onClick={() => setProducerType(type)}
                  data-testid={`btn-producer-${type}`}
                >
                  <span className="font-medium">{t(`techProfile.producer_${type}` as any)}</span>
                  <span className="text-xs opacity-70">{t(`techProfile.producer_${type}_desc` as any)}</span>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("techProfile.techLevelTitle")}</CardTitle>
            <CardDescription>{t("techProfile.techLevelDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(["basico", "intermedio", "avanzado"] as const).map((level) => (
                <Button
                  key={level}
                  type="button"
                  variant={techLevel === level ? "default" : "outline"}
                  className="flex flex-col h-auto py-3 gap-1"
                  onClick={() => setTechLevel(level)}
                  data-testid={`btn-tech-${level}`}
                >
                  <span className="font-medium">{t(`techProfile.tech_${level}` as any)}</span>
                  <span className="text-xs opacity-70">{t(`techProfile.tech_${level}_desc` as any)}</span>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("techProfile.techTitle")}</CardTitle>
            <CardDescription>{t("techProfile.techDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!HIDE_DRONES && (
              <div
                className={`flex items-center justify-between p-4 rounded-lg border-2 cursor-pointer transition-colors ${hasDrones ? "border-primary bg-primary/5" : "border-muted hover:border-muted-foreground/30"}`}
                onClick={() => setHasDrones(!hasDrones)}
                data-testid="toggle-drones"
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${hasDrones ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                    <Plane className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-medium">{t("techProfile.dronesLabel")}</p>
                    <p className="text-sm text-muted-foreground">{t("techProfile.dronesDesc")}</p>
                  </div>
                </div>
                {hasDrones && <Check className="w-5 h-5 text-primary" />}
              </div>
            )}

            {!HIDE_IOT && (
              <div
                className={`flex items-center justify-between p-4 rounded-lg border-2 cursor-pointer transition-colors ${hasIoT ? "border-primary bg-primary/5" : "border-muted hover:border-muted-foreground/30"}`}
                onClick={() => setHasIoT(!hasIoT)}
                data-testid="toggle-iot"
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${hasIoT ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                    <Cpu className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-medium">{t("techProfile.iotLabel")}</p>
                    <p className="text-sm text-muted-foreground">{t("techProfile.iotDesc")}</p>
                  </div>
                </div>
                {hasIoT && <Check className="w-5 h-5 text-primary" />}
              </div>
            )}

            {HIDE_DRONES && HIDE_IOT && (
              <p className="text-sm text-muted-foreground text-center py-2">
                {t("techProfile.dronesIotComingSoon")}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("techProfile.activeModulesTitle")}</CardTitle>
            <CardDescription>{t("techProfile.activeModulesDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              {(Object.keys(moduleInfo) as ToolModule[]).filter(modId =>
                !(HIDE_DRONES && modId === "drones") && !(HIDE_IOT && modId === "iot")
              ).map((modId) => {
                const isActive = activeModules.includes(modId);
                const info = moduleInfo[modId];
                return (
                  <div
                    key={modId}
                    className={`flex items-center gap-3 p-3 rounded-lg border ${isActive ? "border-primary/30 bg-primary/5" : "border-muted bg-muted/30 opacity-50"}`}
                    data-testid={`module-${modId}`}
                  >
                    <div className={`p-2 rounded-lg ${isActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                      {info.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{info.label}</span>
                        {isActive ? (
                          <Badge variant="default" className="text-[10px] px-1.5 py-0">{t("techProfile.active")}</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{t("techProfile.available")}</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{info.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Button onClick={handleSave} className="w-full" disabled={saveMutation.isPending} data-testid="btn-save-profile">
          {saveMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          {saveMutation.isPending
            ? t("techProfile.saving")
            : isOnboarding
              ? t("techProfile.continue")
              : t("techProfile.save")
          }
        </Button>
      </div>
    </div>
  );
}

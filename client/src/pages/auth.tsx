import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { useRecaptcha } from "@/lib/recaptcha-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ChevronLeft, ChevronRight, Check, Camera, Upload } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import logoImage from "@/assets/logo-agregen.png";
import heroImage from "@/assets/hero-about.png";
import { useI18n } from "@/lib/i18n-context";

const FARMING_TYPES = [
  { value: "granos", label: "Granos" },
  { value: "hortalizas", label: "Hortalizas" },
  { value: "frutales", label: "Frutales" },
  { value: "ganaderia", label: "Ganadería" },
  { value: "silvopastoril", label: "Silvopastoril" },
  { value: "mixto", label: "Mixto" },
  { value: "otro", label: "Otro" },
];

const ANIMAL_SPECIES = [
  { value: "bovinos", label: "Bovinos" },
  { value: "ovinos", label: "Ovinos" },
  { value: "caprinos", label: "Caprinos" },
  { value: "porcinos", label: "Porcinos" },
  { value: "aves", label: "Aves" },
  { value: "equinos", label: "Equinos" },
  { value: "otros", label: "Otros" },
];

const CURRENT_PRACTICES = [
  { value: "cobertura_vegetal", label: "Cobertura vegetal permanente" },
  { value: "rotacion_cultivos", label: "Rotación de cultivos" },
  { value: "labranza_minima", label: "Labranza mínima o cero" },
  { value: "compostaje", label: "Compostaje" },
  { value: "bioinsumos", label: "Bioinsumos" },
  { value: "integracion_animal", label: "Integración animal" },
  { value: "agroforesteria", label: "Agroforestería" },
  { value: "ninguna", label: "Ninguna aún" },
];

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className="flex items-center gap-2">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
              i + 1 < current
                ? "bg-primary text-white"
                : i + 1 === current
                ? "bg-primary text-white ring-4 ring-primary/20"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {i + 1 < current ? <Check className="w-4 h-4" /> : i + 1}
          </div>
          {i < total - 1 && (
            <div className={`h-0.5 w-8 ${i + 1 < current ? "bg-primary" : "bg-muted"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

function CheckboxGroup({
  options,
  selected,
  onChange,
}: {
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (val: string[]) => void;
}) {
  const toggle = (value: string) => {
    onChange(
      selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]
    );
  };
  return (
    <div className="grid grid-cols-2 gap-2">
      {options.map((opt) => (
        <label
          key={opt.value}
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer text-sm transition-colors ${
            selected.includes(opt.value)
              ? "border-primary bg-primary/5 text-primary font-medium"
              : "border-border hover:border-primary/40"
          }`}
        >
          <input
            type="checkbox"
            className="sr-only"
            checked={selected.includes(opt.value)}
            onChange={() => toggle(opt.value)}
          />
          <span
            className={`w-4 h-4 rounded flex-shrink-0 border flex items-center justify-center ${
              selected.includes(opt.value) ? "bg-primary border-primary" : "border-muted-foreground"
            }`}
          >
            {selected.includes(opt.value) && <Check className="w-3 h-3 text-white" />}
          </span>
          {opt.label}
        </label>
      ))}
    </div>
  );
}

export default function AuthPage() {
  const { login, isLoading, refreshUser } = useAuth();
  const { toast } = useToast();
  const { t } = useI18n();
  const [, setLocation] = useLocation();
  const getRecaptchaToken = useRecaptcha();

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [step, setStep] = useState(1);
  const [registering, setRegistering] = useState(false);

  const [registerName, setRegisterName] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerPhone, setRegisterPhone] = useState("");
  const [registerRole, setRegisterRole] = useState<"farmer" | "researcher">("farmer");

  type GenderValue = "masculino" | "femenino" | "otro" | "prefiero_no_decir";
  type ProducerTypeValue = "pequeno" | "mediano" | "grande";
  type TechLevelValue = "basico" | "intermedio" | "avanzado";

  const [gender, setGender] = useState<GenderValue | undefined>(undefined);
  const [age, setAge] = useState("");
  const [schoolingYears, setSchoolingYears] = useState("");
  const [farmingExperienceYears, setFarmingExperienceYears] = useState("");
  const [state, setState] = useState("");
  const [municipality, setMunicipality] = useState("");
  const [locality, setLocality] = useState("");

  const [producerType, setProducerType] = useState<ProducerTypeValue | undefined>(undefined);
  const [techLevel, setTechLevel] = useState<TechLevelValue | undefined>(undefined);
  const [farmingTypes, setFarmingTypes] = useState<string[]>([]);
  const [hasAnimals, setHasAnimals] = useState(false);
  const [animalSpecies, setAnimalSpecies] = useState<string[]>([]);
  const [currentPractices, setCurrentPractices] = useState<string[]>([]);

  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarUploaded, setAvatarUploaded] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(loginEmail, loginPassword);
    } catch (error: any) {
      toast({
        title: t("auth.loginError"),
        description: error.message || t("auth.loginErrorDesc"),
        variant: "destructive",
      });
    }
  };

  const validateStep1 = () => {
    if (!registerName.trim()) {
      toast({ title: "Nombre requerido", description: "Por favor ingresa tu nombre completo.", variant: "destructive" });
      return false;
    }
    if (!registerEmail.trim() || !registerEmail.includes("@")) {
      toast({ title: "Email inválido", description: "Por favor ingresa un email válido.", variant: "destructive" });
      return false;
    }
    if (!registerPassword || registerPassword.length < 6) {
      toast({ title: "Contraseña muy corta", description: "La contraseña debe tener al menos 6 caracteres.", variant: "destructive" });
      return false;
    }
    return true;
  };

  const submitRegistration = async (skipOptional = false) => {
    setRegistering(true);
    try {
      const recaptchaToken = await getRecaptchaToken("register");
      const payload = skipOptional
        ? { name: registerName, email: registerEmail, passwordHash: registerPassword, role: registerRole, phone: registerPhone || undefined, recaptchaToken }
        : {
            name: registerName,
            email: registerEmail,
            passwordHash: registerPassword,
            role: registerRole,
            phone: registerPhone || undefined,
            gender: gender,
            age: age ? parseInt(age) : undefined,
            schoolingYears: schoolingYears ? parseInt(schoolingYears) : undefined,
            farmingExperienceYears: farmingExperienceYears ? parseInt(farmingExperienceYears) : undefined,
            state: state || undefined,
            municipality: municipality || undefined,
            locality: locality || undefined,
            producerType: producerType,
            techLevel: techLevel,
            farmingTypes: farmingTypes.length ? farmingTypes : undefined,
            currentPractices: currentPractices.length ? currentPractices : undefined,
            recaptchaToken,
          };

      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Error al registrarse");
      }

      setStep(4);
    } catch (error: any) {
      toast({
        title: t("auth.registerError"),
        description: error.message || t("auth.registerErrorDesc"),
        variant: "destructive",
      });
    } finally {
      setRegistering(false);
    }
  };

  const handleAvatarFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => setAvatarPreview(reader.result as string);
    reader.readAsDataURL(file);

    setAvatarUploading(true);
    try {
      const formData = new FormData();
      formData.append("avatar", file);
      const res = await fetch("/api/auth/avatar", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) throw new Error("No se pudo subir la foto");
      setAvatarUploaded(true);
    } catch (error: any) {
      toast({ title: "Error al subir foto", description: error.message, variant: "destructive" });
      setAvatarPreview(null);
    } finally {
      setAvatarUploading(false);
    }
  };

  const finalizeRegistration = async () => {
    await refreshUser();
    setLocation("/community?welcome=1");
  };

  const stepTitles = ["Cuenta", "Perfil personal", "Perfil productivo", "Foto de perfil"];

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="flex items-center justify-center p-8 bg-background">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center lg:text-left mb-8">
            <Link href="/">
              <div className="flex items-center gap-2 cursor-pointer justify-center lg:justify-start mb-6">
                <img src={logoImage} alt="AgRegen 5.0" className="h-28 w-auto drop-shadow-xl" />
              </div>
            </Link>
            <h1 className="text-3xl font-heading font-bold">{t("auth.welcome")}</h1>
            <p className="text-muted-foreground mt-2">{t("auth.subtitle")}</p>
          </div>

          <Tabs defaultValue="login" className="w-full" onValueChange={() => setStep(1)}>
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="login">{t("auth.loginTab")}</TabsTrigger>
              <TabsTrigger value="register">{t("auth.registerTab")}</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={handleLogin}>
                <Card className="border-none shadow-none">
                  <CardContent className="space-y-4 px-0">
                    <div className="space-y-2">
                      <Label htmlFor="email">{t("auth.email")}</Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder={t("auth.emailPlaceholder")}
                        required
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="password">{t("auth.password")}</Label>
                      <Input
                        id="password"
                        type="password"
                        required
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                      />
                    </div>
                  </CardContent>
                  <CardFooter className="px-0 flex flex-col gap-4">
                    <Button type="submit" className="w-full" disabled={isLoading}>
                      {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      {isLoading ? t("auth.entering") : t("auth.enter")}
                    </Button>
                    <p className="text-sm text-center text-muted-foreground">
                      {t("auth.forgotPassword")}{" "}
                      <a href="#" className="underline hover:text-primary">
                        {t("auth.recover")}
                      </a>
                    </p>
                  </CardFooter>
                </Card>
              </form>
            </TabsContent>

            <TabsContent value="register">
              <Card className="border-none shadow-none">
                <CardHeader className="px-0 pb-2">
                  <StepIndicator current={step} total={4} />
                  <p className="text-center text-sm text-muted-foreground font-medium">
                    Paso {step} de 4 — {stepTitles[step - 1]}
                  </p>
                </CardHeader>
                <CardContent className="px-0 space-y-4">

                  {step === 1 && (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="reg-name">{t("auth.fullName")}</Label>
                        <Input
                          id="reg-name"
                          placeholder={t("auth.namePlaceholder")}
                          required
                          data-testid="input-name"
                          value={registerName}
                          onChange={(e) => setRegisterName(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="reg-email">{t("auth.email")}</Label>
                        <Input
                          id="reg-email"
                          type="email"
                          placeholder={t("auth.emailPlaceholder")}
                          required
                          data-testid="input-email"
                          value={registerEmail}
                          onChange={(e) => setRegisterEmail(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="reg-password">{t("auth.password")}</Label>
                        <Input
                          id="reg-password"
                          type="password"
                          required
                          data-testid="input-password"
                          value={registerPassword}
                          onChange={(e) => setRegisterPassword(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="reg-phone">Celular <span className="text-muted-foreground font-normal text-xs">(opcional)</span></Label>
                        <Input
                          id="reg-phone"
                          type="tel"
                          placeholder="Ej. 5512345678"
                          data-testid="input-phone"
                          value={registerPhone}
                          onChange={(e) => setRegisterPhone(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Rol principal</Label>
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            type="button"
                            variant={registerRole === "farmer" ? "default" : "outline"}
                            onClick={() => setRegisterRole("farmer")}
                            data-testid="button-role-farmer"
                          >
                            {t("auth.technician")}
                          </Button>
                          <Button
                            type="button"
                            variant={registerRole === "researcher" ? "default" : "outline"}
                            onClick={() => setRegisterRole("researcher")}
                            data-testid="button-role-researcher"
                          >
                            {t("auth.researcher")}
                          </Button>
                        </div>
                      </div>
                    </>
                  )}

                  {step === 2 && (
                    <>
                      <div className="space-y-2">
                        <Label>Género</Label>
                        <Select value={gender ?? ""} onValueChange={(v) => setGender(v as GenderValue)}>
                          <SelectTrigger data-testid="select-gender">
                            <SelectValue placeholder="Seleccionar..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="masculino">Masculino</SelectItem>
                            <SelectItem value="femenino">Femenino</SelectItem>
                            <SelectItem value="otro">Otro</SelectItem>
                            <SelectItem value="prefiero_no_decir">Prefiero no decir</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label htmlFor="age">Edad (años)</Label>
                          <Input
                            id="age"
                            type="number"
                            min="15"
                            max="100"
                            placeholder="Ej. 35"
                            data-testid="input-age"
                            value={age}
                            onChange={(e) => setAge(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="schoolingYears">Años de escolaridad</Label>
                          <Input
                            id="schoolingYears"
                            type="number"
                            min="0"
                            max="30"
                            placeholder="0–30"
                            data-testid="input-schoolingYears"
                            value={schoolingYears}
                            onChange={(e) => setSchoolingYears(e.target.value)}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="farmingExp">Años de experiencia agrícola</Label>
                        <Input
                          id="farmingExp"
                          type="number"
                          min="0"
                          max="80"
                          placeholder="0–80"
                          data-testid="input-farmingExperienceYears"
                          value={farmingExperienceYears}
                          onChange={(e) => setFarmingExperienceYears(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="state">Estado</Label>
                        <Input
                          id="state"
                          placeholder="Ej. Jalisco"
                          data-testid="input-state"
                          value={state}
                          onChange={(e) => setState(e.target.value)}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label htmlFor="municipality">Municipio</Label>
                          <Input
                            id="municipality"
                            placeholder="Ej. Guadalajara"
                            data-testid="input-municipality"
                            value={municipality}
                            onChange={(e) => setMunicipality(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="locality">Localidad</Label>
                          <Input
                            id="locality"
                            placeholder="Ej. La Estancia"
                            data-testid="input-locality"
                            value={locality}
                            onChange={(e) => setLocality(e.target.value)}
                          />
                        </div>
                      </div>
                    </>
                  )}

                  {step === 3 && (
                    <>
                      <div className="space-y-2">
                        <Label>Tamaño de operación</Label>
                        <div className="grid grid-cols-3 gap-2">
                          {(
                            [
                              { value: "pequeno" as ProducerTypeValue, label: "Pequeño", sub: "<20 ha" },
                              { value: "mediano" as ProducerTypeValue, label: "Mediano", sub: "20–200 ha" },
                              { value: "grande" as ProducerTypeValue, label: "Grande", sub: ">200 ha" },
                            ] as const
                          ).map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              data-testid={`button-producer-${opt.value}`}
                              onClick={() => setProducerType(opt.value)}
                              className={`rounded-lg border p-3 text-center text-sm transition-colors ${
                                producerType === opt.value
                                  ? "border-primary bg-primary/5 text-primary font-medium"
                                  : "border-border hover:border-primary/40"
                              }`}
                            >
                              <div className="font-medium">{opt.label}</div>
                              <div className="text-xs text-muted-foreground">{opt.sub}</div>
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Nivel tecnológico</Label>
                        <div className="grid grid-cols-3 gap-2">
                          {(
                            [
                              { value: "basico" as TechLevelValue, label: "Básico" },
                              { value: "intermedio" as TechLevelValue, label: "Intermedio" },
                              { value: "avanzado" as TechLevelValue, label: "Avanzado" },
                            ] as const
                          ).map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              data-testid={`button-tech-${opt.value}`}
                              onClick={() => setTechLevel(opt.value)}
                              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                                techLevel === opt.value
                                  ? "border-primary bg-primary/5 text-primary font-medium"
                                  : "border-border hover:border-primary/40"
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Tipo de sistema productivo</Label>
                        <CheckboxGroup
                          options={FARMING_TYPES}
                          selected={farmingTypes}
                          onChange={setFarmingTypes}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={hasAnimals}
                            data-testid="checkbox-has-animals"
                            onChange={(e) => setHasAnimals(e.target.checked)}
                            className="w-4 h-4"
                          />
                          <span className="text-sm font-medium">¿Integra animales en su operación?</span>
                        </label>
                        {hasAnimals && (
                          <div className="mt-2 pl-6">
                            <p className="text-xs text-muted-foreground mb-2">Especies presentes:</p>
                            <CheckboxGroup
                              options={ANIMAL_SPECIES}
                              selected={animalSpecies}
                              onChange={setAnimalSpecies}
                            />
                          </div>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label>Prácticas regenerativas actuales</Label>
                        <CheckboxGroup
                          options={CURRENT_PRACTICES}
                          selected={currentPractices}
                          onChange={setCurrentPractices}
                        />
                      </div>
                    </>
                  )}

                  {step === 4 && (
                    <div className="flex flex-col items-center gap-5 py-2">
                      <div className="text-center space-y-1">
                        <p className="text-sm text-muted-foreground">
                          Agrega una foto para que la comunidad te reconozca fácilmente.
                        </p>
                      </div>

                      <div
                        className="relative cursor-pointer group"
                        onClick={() => !avatarUploading && fileInputRef.current?.click()}
                        data-testid="avatar-dropzone"
                      >
                        <div className={`w-36 h-36 rounded-full border-4 flex items-center justify-center overflow-hidden transition-all ${
                          avatarUploaded
                            ? "border-primary"
                            : "border-dashed border-muted-foreground/40 hover:border-primary/60 bg-muted/30"
                        }`}>
                          {avatarPreview ? (
                            <img src={avatarPreview} alt="Vista previa" className="w-full h-full object-cover" />
                          ) : (
                            <div className="flex flex-col items-center gap-2 text-muted-foreground group-hover:text-primary transition-colors">
                              <Camera className="w-10 h-10" />
                              <span className="text-xs font-medium">Subir foto</span>
                            </div>
                          )}
                        </div>
                        {avatarUploading && (
                          <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
                            <Loader2 className="w-8 h-8 animate-spin text-white" />
                          </div>
                        )}
                        {avatarUploaded && !avatarUploading && (
                          <div className="absolute bottom-1 right-1 w-8 h-8 bg-primary rounded-full flex items-center justify-center shadow-md">
                            <Check className="w-4 h-4 text-white" />
                          </div>
                        )}
                      </div>

                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        data-testid="input-avatar-file"
                        onChange={handleAvatarFileChange}
                      />

                      {avatarPreview && !avatarUploaded && !avatarUploading && (
                        <p className="text-xs text-destructive">No se pudo subir. Intenta de nuevo.</p>
                      )}

                      {avatarUploaded && (
                        <p className="text-sm text-primary font-medium flex items-center gap-1.5">
                          <Check className="w-4 h-4" /> Foto subida correctamente
                        </p>
                      )}

                      {!avatarPreview && (
                        <button
                          type="button"
                          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-dashed border-muted-foreground/40 hover:border-primary/60 text-sm text-muted-foreground hover:text-primary transition-colors"
                          onClick={() => fileInputRef.current?.click()}
                          data-testid="btn-select-photo"
                        >
                          <Upload className="w-4 h-4" />
                          Seleccionar imagen
                        </button>
                      )}
                    </div>
                  )}
                </CardContent>

                <CardFooter className="px-0 flex flex-col gap-3">
                  {step < 4 && (
                    <div className="flex gap-3 w-full">
                      {step > 1 && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setStep((s) => s - 1)}
                          data-testid="button-step-back"
                          className="flex-1"
                        >
                          <ChevronLeft className="w-4 h-4 mr-1" />
                          Anterior
                        </Button>
                      )}
                      {step < 3 && (
                        <Button
                          type="button"
                          onClick={() => {
                            if (step === 1 && !validateStep1()) return;
                            setStep((s) => s + 1);
                          }}
                          data-testid="button-step-next"
                          className="flex-1"
                          disabled={isLoading || registering}
                        >
                          Siguiente
                          <ChevronRight className="w-4 h-4 ml-1" />
                        </Button>
                      )}
                      {step === 3 && (
                        <Button
                          type="button"
                          onClick={() => submitRegistration(false)}
                          data-testid="button-register-submit"
                          className="flex-1"
                          disabled={isLoading || registering}
                        >
                          {registering ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          {registering ? t("auth.creatingAccount") : t("auth.createAccount")}
                        </Button>
                      )}
                    </div>
                  )}

                  {step < 4 && step > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      data-testid="button-skip-step"
                      className="w-full text-muted-foreground"
                      disabled={isLoading || registering}
                      onClick={() => submitRegistration(true)}
                    >
                      Completar más tarde
                    </Button>
                  )}

                  {step === 4 && (
                    <div className="flex flex-col gap-3 w-full">
                      <Button
                        type="button"
                        onClick={finalizeRegistration}
                        data-testid="button-finish-registration"
                        className="w-full"
                        disabled={!avatarUploaded || avatarUploading}
                      >
                        <Check className="w-4 h-4 mr-2" />
                        Finalizar y entrar a AgRegen
                      </Button>
                    </div>
                  )}
                </CardFooter>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <div className="hidden lg:block relative bg-primary/10">
        {/* Real photograph of farmer hands cradling soil with a seedling
            (no embedded text). Replaces the legacy /assets/hero-ag.png
            which was a screenshot of the site itself in English. */}
        <img
          src={heroImage}
          alt="Manos de un agricultor sosteniendo suelo fértil con una plántula"
          className="absolute inset-0 w-full h-full object-cover object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-950/55 via-emerald-900/30 to-emerald-950/65" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
        <div className="absolute bottom-12 left-12 right-12 text-white">
          <blockquote className="space-y-4">
            <p className="text-2xl font-serif italic">{t("auth.quote")}</p>
            <footer className="text-sm font-medium opacity-80">{t("auth.quoteAuthor")}</footer>
          </blockquote>
        </div>
      </div>
    </div>
  );
}

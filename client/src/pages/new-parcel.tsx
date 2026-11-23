import { useState, useEffect, lazy, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ArrowLeft, Loader2, MapPin, Sprout, Droplets, Calendar, Navigation, Crosshair, Upload, X, TreePine, Leaf, ChevronDown, ChevronRight, Check, Satellite } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { getCropCurve, getCurrentStage } from "@/lib/ideal-ndvi-curves";
import { useI18n } from "@/lib/i18n-context";
import { parseParcelFile, type ParcelFeature } from "@/lib/parcel-import";
import { parseManualCoordinates } from "@/lib/manual-coordinates";

const ParcelMap = lazy(() => import("@/components/map/parcel-map"));

// ── Crops with full satellite NDVI/EVI interpretation support ─────────────────
const SATELLITE_SUPPORTED_CROPS = new Set([
  "Maíz", "Soja", "Trigo", "Girasol",
  "Tomate", "Papa", "Cebolla", "Lechuga", "Ajo",
  "Vid", "Manzano", "Cítricos", "Limón", "Caña de Azúcar",
  "Alfalfa", "Sorgo", "Algodón",
]);

// ── Crop catalogue grouped by agronomic type ──────────────────────────────────
type CropCategory = "annual" | "perennial" | "vegetable";

const CROP_CATEGORIES: Record<string, CropCategory> = {
  "Maíz": "annual", "Trigo": "annual", "Soja": "annual", "Frijol": "annual",
  "Sorgo": "annual", "Arroz": "annual", "Girasol": "annual", "Cebada": "annual",
  "Avena": "annual", "Algodón": "annual", "Garbanzo": "annual", "Alfalfa": "annual",
  "Café": "perennial", "Aguacate": "perennial", "Cítricos": "perennial",
  "Limón": "perennial", "Caña de Azúcar": "perennial", "Nopal": "perennial",
  "Vid": "perennial", "Manzano": "perennial",
  "Chile": "vegetable", "Tomate": "vegetable", "Cebolla": "vegetable",
  "Hortalizas": "vegetable", "Papa": "vegetable", "Zanahoria": "vegetable",
  "Ajo": "vegetable", "Lechuga": "vegetable",
  "Otro": "annual",
};

const CROPS_BY_CATEGORY: Record<CropCategory, string[]> = {
  annual: ["Maíz", "Trigo", "Soja", "Frijol", "Sorgo", "Arroz", "Girasol", "Cebada", "Avena", "Algodón", "Alfalfa", "Garbanzo", "Otro"],
  perennial: ["Café", "Aguacate", "Cítricos", "Limón", "Caña de Azúcar", "Nopal", "Vid", "Manzano"],
  vegetable: ["Chile", "Tomate", "Cebolla", "Hortalizas", "Papa", "Zanahoria", "Ajo", "Lechuga"],
};

const ALL_CROPS = [
  ...CROPS_BY_CATEGORY.annual,
  ...CROPS_BY_CATEGORY.perennial,
  ...CROPS_BY_CATEGORY.vegetable,
].filter((v, i, a) => a.indexOf(v) === i);

// Phenological stage labels per category
const STAGE_LABELS: Record<CropCategory, Record<string, string>> = {
  annual: {
    siembra: "Siembra", germinacion: "Germinación", crecimiento: "Crecimiento vegetativo",
    floracion: "Floración", fructificacion: "Llenado / Fructificación", cosecha: "Cosecha",
  },
  perennial: {
    siembra: "Establecimiento", germinacion: "Brotación / Rebrote", crecimiento: "Crecimiento vegetativo",
    floracion: "Floración", fructificacion: "Cuajado / Engrosamiento", cosecha: "Cosecha / Madurez",
  },
  vegetable: {
    siembra: "Siembra / Trasplante", germinacion: "Germinación / Prendimiento", crecimiento: "Crecimiento",
    floracion: "Floración", fructificacion: "Cuajado / Engrosamiento", cosecha: "Cosecha",
  },
};

const STAGE_KEYS = ["siembra", "germinacion", "crecimiento", "floracion", "fructificacion", "cosecha"] as const;

const CATEGORY_META: Record<CropCategory, { label: string; color: string; icon: typeof Sprout }> = {
  annual:   { label: "Cultivo anual",   color: "bg-green-100 text-green-800 border-green-300",    icon: Sprout },
  perennial:{ label: "Cultivo perenne", color: "bg-amber-100 text-amber-800 border-amber-300",    icon: TreePine },
  vegetable:{ label: "Hortaliza",       color: "bg-emerald-100 text-emerald-800 border-emerald-300", icon: Leaf },
};

const soilTypes = [
  { value: "arcilloso" }, { value: "arenoso" }, { value: "limoso" },
  { value: "franco" }, { value: "franco-arcilloso" }, { value: "franco-arenoso" },
];

const irrigationSystems = [
  { value: "temporal" }, { value: "goteo" }, { value: "aspersion" },
  { value: "gravedad" }, { value: "pivote" }, { value: "ninguno" },
];

export default function NewParcel() {
  const [, setLocationNav] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useI18n();

  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [crop, setCrop] = useState("");
  const [cropPickerOpen, setCropPickerOpen] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<CropCategory>>(new Set<CropCategory>(["annual", "perennial", "vegetable"]));
  const [phenologicalStage, setPhenologicalStage] = useState("siembra");
  const [soilType, setSoilType] = useState("franco");
  const [irrigationSystem, setIrrigationSystem] = useState("temporal");

  // Annual/vegetable: ISO date string; perennial: 4-digit year as string
  const [plantingDate, setPlantingDate] = useState("");
  const [establishmentYear, setEstablishmentYear] = useState(String(new Date().getFullYear() - 3));

  const [isPublic, setIsPublic] = useState(false);

  const [polygonCoordinates, setPolygonCoordinates] = useState<[number, number][] | null>(null);
  const [calculatedArea, setCalculatedArea] = useState<number>(0);
  const [mapCenter, setMapCenter] = useState<[number, number]>([19.4326, -99.1332]);
  const [coordinateMarker, setCoordinateMarker] = useState<[number, number] | null>(null);
  const [mapZoom, setMapZoom] = useState<number>(15);
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationMode, setLocationMode] = useState<"auto" | "manual" | "import">("auto");
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");
  const [importedFileName, setImportedFileName] = useState<string>("");
  const [importedFeatures, setImportedFeatures] = useState<ParcelFeature[]>([]);
  const [selectedFeatureIdx, setSelectedFeatureIdx] = useState<number>(0);
  const [isParsing, setIsParsing] = useState(false);
  const [fitBoundsTo, setFitBoundsTo] = useState<[number, number][] | null>(null);

  const cropCategory: CropCategory = CROP_CATEGORIES[crop] ?? "annual";
  const isPerennial = cropCategory === "perennial";
  const isVegetable = cropCategory === "vegetable";
  const stageLabels = STAGE_LABELS[cropCategory];
  const catMeta = crop ? CATEGORY_META[cropCategory] : null;
  const CatIcon = catMeta?.icon ?? Sprout;

  // Auto-calculate phenological stage for annual/vegetable crops based on planting date
  useEffect(() => {
    if (!crop || !plantingDate || isPerennial) return;
    const plantDate = new Date(plantingDate);
    const today = new Date();
    const daysSincePlanting = Math.floor((today.getTime() - plantDate.getTime()) / (1000 * 60 * 60 * 24));
    const cropCurve = getCropCurve(crop);
    const stageName = getCurrentStage(daysSincePlanting, cropCurve);
    const stageMapping: Record<string, string> = {
      "Germinación": "germinacion",
      "Crecimiento Vegetativo": "crecimiento",
      "Crecimiento": "crecimiento",
      "Floración": "floracion",
      "Llenado de Grano": "fructificacion",
      "Máximo Desarrollo": "floracion",
      "Madurez": "cosecha",
      "Senescencia": "cosecha",
      "Macollaje": "crecimiento",
      "Encañado": "crecimiento",
      "Espigado": "floracion",
      "Pre-siembra": "siembra",
      "Ciclo completado": "cosecha",
    };
    setPhenologicalStage(stageMapping[stageName] ?? "siembra");
  }, [crop, plantingDate, isPerennial]);

  // For perennials, default stage to "crecimiento" (active growth) when category changes
  useEffect(() => {
    if (isPerennial) setPhenologicalStage("crecimiento");
    else setPhenologicalStage("siembra");
  }, [isPerennial]);

  useEffect(() => {
    let active = true;
    setIsLocating(false);
    setLocationError(null);
    if (locationMode === "auto" && "geolocation" in navigator) {
      setIsLocating(true);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (!active) return;
          setFitBoundsTo(null);
          setMapCenter([position.coords.latitude, position.coords.longitude]);
          setIsLocating(false);
          setLocationError(null);
        },
        (error) => {
          if (!active) return;
          console.log("Geolocation error:", error.message);
          setIsLocating(false);
          setLocationError(t("newParcel.locationError"));
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
      );
    } else if (locationMode === "auto") {
      setLocationError(t("newParcel.locationError"));
    }
    return () => { active = false; };
  }, [locationMode, t]);

  const handleGoToCoords = () => {
    const coordinates = parseManualCoordinates(manualLat, manualLng);
    if (!coordinates) {
      toast({ title: t("newParcel.invalidCoords"), variant: "destructive" });
      return;
    }
    // An imported polygon's bounds otherwise override every new map center.
    // Clear only the viewport instruction, never the polygon or its area.
    setFitBoundsTo(null);
    setMapCenter(coordinates);
    setCoordinateMarker(coordinates);
  };

  const handleCoordinateKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleGoToCoords();
    }
  };

  const createParcelMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch("/api/parcels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || t("newParcel.createError"));
      }
      return response.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["parcels"] });
      const newParcelId = data?.parcel?.id;
      toast({
        title: t("newParcel.parcelCreated"),
        description: t("newParcel.parcelCreatedDesc"),
      });
      // T003: go straight to parcel detail — setup wizard is optional
      setLocationNav(newParcelId ? `/parcel/${newParcelId}` : "/dashboard");
    },
  });

  const handlePolygonCreated = (coordinates: [number, number][], area: number) => {
    setPolygonCoordinates(coordinates);
    setCalculatedArea(area);
  };

  const handlePolygonDeleted = () => {
    setPolygonCoordinates(null);
    setCalculatedArea(0);
    setImportedFileName("");
    setImportedFeatures([]);
  };

  const applyImportedFeature = (feat: ParcelFeature) => {
    setPolygonCoordinates(feat.coordinates);
    setCalculatedArea(feat.areaHa);
    setFitBoundsTo(feat.coordinates);
    if (!name && feat.name) setName(feat.name);
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setIsParsing(true);
    try {
      const { features } = await parseParcelFile(file);
      setImportedFileName(file.name);
      setImportedFeatures(features);
      setSelectedFeatureIdx(0);
      applyImportedFeature(features[0]);
      toast({
        title: t("newParcel.importSuccess"),
        description: features.length > 1
          ? t("newParcel.importMultiple").replace("{n}", String(features.length))
          : t("newParcel.importSingle"),
      });
    } catch (err: any) {
      const code = String(err?.message || "");
      let desc = t("newParcel.importErrorGeneric");
      if (code === "UNSUPPORTED_FORMAT") desc = t("newParcel.importErrorUnsupported");
      else if (code === "NO_POLYGONS") desc = t("newParcel.importErrorNoPolygons");
      else if (code === "KMZ_NO_KML") desc = t("newParcel.importErrorKmz");
      else if (code === "SHP_NOT_WGS84") desc = t("newParcel.importErrorPrj");
      else if (code.startsWith("PARSE_FAILED:")) {
        desc = `${t("newParcel.importErrorParse")}: ${code.slice("PARSE_FAILED:".length)}`;
      }
      toast({ title: t("newParcel.importError"), description: desc, variant: "destructive" });
    } finally {
      setIsParsing(false);
    }
  };

  const handleFeatureChange = (idxStr: string) => {
    const idx = Number(idxStr);
    setSelectedFeatureIdx(idx);
    if (importedFeatures[idx]) applyImportedFeature(importedFeatures[idx]);
  };

  const handleClearImport = () => {
    setImportedFileName("");
    setImportedFeatures([]);
    setPolygonCoordinates(null);
    setCalculatedArea(0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!polygonCoordinates || polygonCoordinates.length < 3) {
      toast({
        title: t("newParcel.drawParcel"),
        description: t("newParcel.drawParcelDesc"),
        variant: "destructive",
      });
      return;
    }

    const centerLat = polygonCoordinates.reduce((sum, c) => sum + c[0], 0) / polygonCoordinates.length;
    const centerLng = polygonCoordinates.reduce((sum, c) => sum + c[1], 0) / polygonCoordinates.length;

    // Build plantingDate: perennials use Jan 1 of establishment year
    let resolvedDate: Date | null = null;
    if (isPerennial) {
      const yr = parseInt(establishmentYear, 10);
      if (!isNaN(yr) && yr >= 1900 && yr <= new Date().getFullYear()) {
        resolvedDate = new Date(`${yr}-01-01`);
      }
    } else if (plantingDate) {
      resolvedDate = new Date(plantingDate);
    }

    try {
      await createParcelMutation.mutateAsync({
        name,
        location,
        latitude: centerLat,
        longitude: centerLng,
        area: calculatedArea,
        crop,
        phenologicalStage,
        soilType,
        irrigationSystem,
        plantingDate: resolvedDate,
        polygonCoordinates,
        isPublic,
        status: "active",
      });
    } catch (error: any) {
      toast({
        title: t("newParcel.createError"),
        description: error.message || t("newParcel.createErrorDesc"),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="container mx-auto px-4 py-4 md:py-8">
      <div className="flex items-center gap-2 text-xs md:text-sm text-muted-foreground mb-4 md:mb-6">
        <Link href="/dashboard" className="hover:text-primary flex items-center gap-1" data-testid="link-back-dashboard">
          <ArrowLeft className="w-4 h-4" /> {t("newParcel.backToDashboard")}
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-8">
        {/* ── Map panel ── */}
        <Card className="lg:order-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-primary" />
              {t("newParcel.drawTitle")}
              {isLocating && (
                <span className="flex items-center gap-1 text-sm font-normal text-muted-foreground">
                  <Navigation className="w-4 h-4 animate-pulse" />
                  {t("newParcel.locating")}
                </span>
              )}
            </CardTitle>
            <CardDescription>
              {locationError ? (
                <span className="text-amber-600">{locationError}</span>
              ) : isLocating ? (
                t("newParcel.gettingLocation")
              ) : (
                t("newParcel.drawDescription")
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-3 md:p-6">
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={locationMode === "auto" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setLocationMode("auto")}
                  data-testid="button-location-auto"
                  className="flex items-center gap-1.5"
                >
                  <Navigation className="w-4 h-4" />
                  {t("newParcel.autoLocation")}
                </Button>
                <Button
                  type="button"
                  variant={locationMode === "manual" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setLocationMode("manual")}
                  data-testid="button-location-manual"
                  className="flex items-center gap-1.5"
                >
                  <Crosshair className="w-4 h-4" />
                  {t("newParcel.manualCoords")}
                </Button>
                <Button
                  type="button"
                  variant={locationMode === "import" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setLocationMode("import")}
                  data-testid="button-location-import"
                  className="flex items-center gap-1.5"
                >
                  <Upload className="w-4 h-4" />
                  {t("newParcel.importFile")}
                </Button>
              </div>
            </div>

            {locationMode === "import" && (
              <div className="flex flex-col gap-3 mb-4 p-3 bg-secondary/30 rounded-lg">
                <div>
                  <Label htmlFor="parcelFile" className="text-xs">
                    {t("newParcel.importFileLabel")}
                  </Label>
                  <Input
                    id="parcelFile"
                    type="file"
                    accept=".kmz,.kml,.zip,.geojson,.json"
                    onChange={handleFileImport}
                    disabled={isParsing}
                    data-testid="input-parcel-file"
                    className="h-9 cursor-pointer"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {t("newParcel.importHint")}
                  </p>
                </div>
                {isParsing && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {t("newParcel.importParsing")}
                  </div>
                )}
                {importedFileName && !isParsing && (
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate" data-testid="text-imported-filename">
                      <strong>{t("newParcel.importedFile")}</strong> {importedFileName}
                    </span>
                    <Button
                      type="button" variant="ghost" size="sm"
                      onClick={handleClearImport}
                      data-testid="button-clear-import"
                      className="h-7 px-2"
                    >
                      <X className="w-3.5 h-3.5 mr-1" />
                      {t("newParcel.importClear")}
                    </Button>
                  </div>
                )}
                {importedFeatures.length > 1 && (
                  <div>
                    <Label htmlFor="featureSelect" className="text-xs">
                      {t("newParcel.importMultipleLabel")}
                    </Label>
                    <Select value={String(selectedFeatureIdx)} onValueChange={handleFeatureChange}>
                      <SelectTrigger id="featureSelect" data-testid="select-imported-feature" className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {importedFeatures.map((f, idx) => (
                          <SelectItem key={idx} value={String(idx)}>
                            {f.name} — {f.areaHa.toFixed(2)} ha
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}

            {locationMode === "manual" && (
              <div className="flex flex-col gap-2 mb-4 p-3 bg-secondary/30 rounded-lg">
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="flex-1 min-w-0">
                    <Label htmlFor="manualLat" className="text-xs">{t("newParcel.latitude")}</Label>
                    <Input
                      id="manualLat" type="text" inputMode="decimal"
                      aria-describedby="manual-coordinates-hint"
                      placeholder={t("newParcel.latPlaceholder")}
                      value={manualLat} onChange={(e) => setManualLat(e.target.value)}
                      onKeyDown={handleCoordinateKeyDown}
                      data-testid="input-manual-lat" className="h-9"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <Label htmlFor="manualLng" className="text-xs">{t("newParcel.longitude")}</Label>
                    <Input
                      id="manualLng" type="text" inputMode="decimal"
                      aria-describedby="manual-coordinates-hint"
                      placeholder={t("newParcel.lngPlaceholder")}
                      value={manualLng} onChange={(e) => setManualLng(e.target.value)}
                      onKeyDown={handleCoordinateKeyDown}
                      data-testid="input-manual-lng" className="h-9"
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button" size="sm"
                      onClick={handleGoToCoords}
                      disabled={!manualLat.trim() || !manualLng.trim()}
                      data-testid="button-go-to-coords"
                      className="h-9 whitespace-nowrap"
                    >
                      <MapPin className="w-4 h-4 mr-1" />
                      {t("newParcel.goToCoords")}
                    </Button>
                  </div>
                </div>
                <p id="manual-coordinates-hint" className="text-xs text-muted-foreground">
                  {t("newParcel.manualCoordsHint")}
                </p>
              </div>
            )}

            <div className="h-[300px] md:h-[500px]">
              <Suspense fallback={
                <div className="w-full h-full flex items-center justify-center bg-muted rounded-lg">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
              }>
                <ParcelMap
                  center={mapCenter}
                  coordinateMarker={coordinateMarker}
                  coordinateMarkerLabel={t("newParcel.manualCoords")}
                  zoom={mapZoom}
                  initialCoordinates={polygonCoordinates ?? undefined}
                  fitBoundsTo={fitBoundsTo}
                  onPolygonCreated={handlePolygonCreated}
                  onPolygonDeleted={handlePolygonDeleted}
                />
              </Suspense>
            </div>

            {calculatedArea > 0 && (
              <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm text-green-800">
                  <strong>{t("newParcel.calculatedArea")}</strong> {calculatedArea.toFixed(2)} {t("newParcel.hectares")}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Form panel ── */}
        <Card className="lg:order-1">
          <CardHeader>
            <CardTitle className="text-2xl font-heading flex items-center gap-2">
              <Sprout className="w-6 h-6 text-primary" />
              {t("newParcel.title")}
            </CardTitle>
            <CardDescription>{t("newParcel.subtitle")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Name */}
              <div className="space-y-2">
                <Label htmlFor="name">{t("newParcel.parcelName")}</Label>
                <Input
                  id="name" placeholder={t("newParcel.parcelNamePlaceholder")}
                  required value={name} onChange={(e) => setName(e.target.value)}
                  data-testid="input-parcel-name"
                />
              </div>

              {/* Location */}
              <div className="space-y-2">
                <Label htmlFor="location">{t("newParcel.locationLabel")}</Label>
                <Input
                  id="location" placeholder={t("newParcel.locationPlaceholder")}
                  required value={location} onChange={(e) => setLocation(e.target.value)}
                  data-testid="input-parcel-location"
                />
              </div>

              {/* Crop + category badge */}
              <div className="space-y-2">
                <Label htmlFor="crop" className="text-sm">{t("newParcel.mainCrop")}</Label>
                <div className="flex items-center gap-2">
                  <Popover open={cropPickerOpen} onOpenChange={setCropPickerOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        data-testid="select-crop"
                        className="h-11 md:h-10 flex-1 flex items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <span className={crop ? "text-foreground" : "text-muted-foreground"}>
                          {crop || t("newParcel.selectPlaceholder")}
                        </span>
                        <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="p-0 w-[var(--radix-popover-trigger-width)]"
                      align="start"
                      sideOffset={4}
                    >
                      <div className="max-h-72 overflow-y-auto">
                        {(
                          [
                            { key: "annual" as CropCategory,   label: "Cereales y granos" },
                            { key: "perennial" as CropCategory, label: "Cultivos perennes" },
                            { key: "vegetable" as CropCategory, label: "Hortalizas" },
                          ]
                        ).map(({ key, label }) => {
                          const isOpen = expandedCategories.has(key);
                          const toggle = () => setExpandedCategories(prev => {
                            const next = new Set(prev);
                            isOpen ? next.delete(key) : next.add(key);
                            return next;
                          });
                          return (
                            <div key={key}>
                              <button
                                type="button"
                                onClick={toggle}
                                className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide bg-muted/50 hover:bg-muted transition-colors border-b border-border"
                              >
                                <span>{label}</span>
                                {isOpen
                                  ? <ChevronDown className="w-3.5 h-3.5" />
                                  : <ChevronRight className="w-3.5 h-3.5" />}
                              </button>
                              {isOpen && CROPS_BY_CATEGORY[key].map((c) => (
                                <button
                                  key={c}
                                  type="button"
                                  onClick={() => { setCrop(c); setCropPickerOpen(false); }}
                                  className={`w-full text-left flex items-center justify-between px-4 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors ${crop === c ? "bg-accent/50 font-medium" : ""}`}
                                >
                                  <span className="flex items-center gap-1.5">
                                    {c}
                                    {SATELLITE_SUPPORTED_CROPS.has(c) && (
                                      <span title="Interpretación satelital disponible">
                                        <Satellite className="w-3 h-3 text-green-600 shrink-0" />
                                      </span>
                                    )}
                                  </span>
                                  {crop === c && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                                </button>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    </PopoverContent>
                  </Popover>
                  {catMeta && (
                    <Badge
                      variant="outline"
                      className={`shrink-0 gap-1 text-xs ${catMeta.color}`}
                      data-testid="badge-crop-category"
                    >
                      <CatIcon className="w-3 h-3" />
                      {catMeta.label}
                    </Badge>
                  )}
                </div>
              </div>

              {/* Phenological stage — labels adapt to crop type */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="stage" className="flex items-center gap-2">
                    {isPerennial ? "Etapa del cultivo" : t("newParcel.phenologicalStage")}
                    {!isPerennial && crop && plantingDate && (
                      <span className="text-xs text-primary font-normal">{t("newParcel.auto")}</span>
                    )}
                  </Label>
                  <Select value={phenologicalStage} onValueChange={setPhenologicalStage}>
                    <SelectTrigger data-testid="select-stage">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STAGE_KEYS.map((key) => (
                        <SelectItem key={key} value={key}>
                          {stageLabels[key]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!isPerennial && crop && plantingDate && (
                    <p className="text-xs text-muted-foreground">{t("newParcel.autoCalcMessage")}</p>
                  )}
                </div>

                {/* Date field: establishment year for perennials, planting/transplant date for others */}
                <div className="space-y-2">
                  {isPerennial ? (
                    <>
                      <Label htmlFor="establishmentYear" className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" /> Año de establecimiento
                      </Label>
                      <Input
                        id="establishmentYear"
                        type="number"
                        min={1900}
                        max={new Date().getFullYear()}
                        value={establishmentYear}
                        onChange={(e) => setEstablishmentYear(e.target.value)}
                        data-testid="input-establishment-year"
                        placeholder="ej. 2018"
                      />
                      <p className="text-xs text-muted-foreground">Año en que se plantó el huerto o cafetal</p>
                    </>
                  ) : (
                    <>
                      <Label htmlFor="plantingDate" className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        {isVegetable ? "Fecha de trasplante" : t("newParcel.plantingDate")}
                      </Label>
                      <Input
                        id="plantingDate"
                        type="date"
                        value={plantingDate}
                        onChange={(e) => setPlantingDate(e.target.value)}
                        data-testid="input-planting-date"
                      />
                    </>
                  )}
                </div>
              </div>

              {/* Soil + Irrigation */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="soil">{t("newParcel.soilType")}</Label>
                  <Select value={soilType} onValueChange={setSoilType}>
                    <SelectTrigger data-testid="select-soil">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {soilTypes.map((s) => (
                        <SelectItem key={s.value} value={s.value}>{t(`soilTypes.${s.value}`)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="irrigation" className="flex items-center gap-1">
                    <Droplets className="w-4 h-4" /> {t("newParcel.irrigationSystem")}
                  </Label>
                  <Select value={irrigationSystem} onValueChange={setIrrigationSystem}>
                    <SelectTrigger data-testid="select-irrigation">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {irrigationSystems.map((s) => (
                        <SelectItem key={s.value} value={s.value}>{t(`irrigation.${s.value}`)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Public toggle */}
              <div className="flex items-center justify-between p-4 bg-secondary/30 rounded-lg">
                <div>
                  <Label htmlFor="public" className="font-medium">{t("newParcel.publicData")}</Label>
                  <p className="text-sm text-muted-foreground">{t("newParcel.publicDataDesc")}</p>
                </div>
                <Switch
                  id="public"
                  checked={isPublic}
                  onCheckedChange={setIsPublic}
                  data-testid="switch-public"
                />
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-4">
                <Button
                  type="submit"
                  className="flex-1"
                  disabled={createParcelMutation.isPending || !polygonCoordinates}
                  data-testid="button-create-parcel"
                >
                  {createParcelMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {t("newParcel.registering")}
                    </>
                  ) : (
                    t("newParcel.registerParcel")
                  )}
                </Button>
                <Link href="/dashboard">
                  <Button type="button" variant="outline" data-testid="button-cancel">{t("common.cancel")}</Button>
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

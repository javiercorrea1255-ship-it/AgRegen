import React, { useState, useMemo, useEffect } from "react";
import { useParams, useLocation, useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  ArrowLeft, Bot, Loader2, Download, Layers, ChevronDown, ChevronUp,
  FileJson, Map, Table2, Sprout, Package, Beaker, FileArchive,
  FlaskConical, BarChart3, Calculator, ClipboardCheck, AlertTriangle, Plus,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { MapContainer, TileLayer, Polygon, Tooltip as LeafletTooltip, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { SamplingCampaign, InterpolationResult, ManagementZone, ZonePrescription, PrescriptionApplication } from "@shared/schema";

const EMPTY_CAMPAIGNS: SamplingCampaign[] = [];
const EMPTY_INTERPOLATIONS: InterpolationResult[] = [];

const ZONE_COLORS = ["#d73027", "#fdae61", "#a6d96a", "#1a9850", "#2166ac"];
const ZONE_LABELS = ["Baja", "Media-Baja", "Media", "Media-Alta", "Alta"];

interface PrescriptionWithZone extends ZonePrescription {
  zone?: ManagementZone;
}

interface PrescriptionsResponse {
  prescriptions: PrescriptionWithZone[];
  zones: ManagementZone[];
  applications?: PrescriptionApplication[];
}

interface InterpolationWithZones {
  interpolation: InterpolationResult;
  zones: ManagementZone[];
}

// ── VRA catalog types ──────────────────────────────────────────────────────────
interface CropEntry {
  code: string;
  label: string;
  nutrients: Record<string, number>;
  source: string;
}
interface ProductEntry {
  code: string;
  label: string;
  N_pct: number;
  P2O5_pct: number;
  K2O_pct: number;
  price_mxn_t: number;
}
interface NutrientEntry {
  code: string;
  label: string;
  default_efficiency: number;
}
interface PrescriptionCatalog {
  crops: CropEntry[];
  products: ProductEntry[];
  nutrients: NutrientEntry[];
}

// ── VRA result types ───────────────────────────────────────────────────────────
interface ZoneDoseResult {
  zone_index: number;
  zone_label: string;
  dose_kg_ha: number;
  area_ha: number;
  total_kg_product: number;
  cost_mxn: number;
  nutrient_demand_kg_ha: number;
  nutrient_available_kg_ha: number;
  nutrient_deficit_kg_ha: number;
  budget_rebalanced?: boolean;
}
interface VRAResult {
  zones_with_doses: ZoneDoseResult[];
  total_kg_product: number;
  total_cost_mxn: number;
  avg_dose_kg_ha: number;
  total_area_ha: number;
  constraints_applied: string[];
  params_used: Record<string, unknown>;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function centroidOf(coords: [number, number][]): [number, number] {
  if (coords.length === 0) return [0, 0];
  const lat = coords.reduce((s, c) => s + c[0], 0) / coords.length;
  const lng = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  return [lat, lng];
}

function makeDoseIcon(text: string, color: string): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="background:rgba(255,255,255,0.9);border:1px solid ${color};border-radius:4px;padding:2px 5px;font-size:10px;font-weight:600;color:${color};white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.2)">${text}</div>`,
    iconAnchor: [0, 0],
  });
}

function coordsFromGeojson(geojson: unknown): [number, number][][] {
  if (!geojson || typeof geojson !== "object") return [];
  const g = geojson as { type?: string; coordinates?: unknown; geometry?: unknown };
  if (g.type === "Polygon" && Array.isArray(g.coordinates)) {
    return (g.coordinates as number[][][]).map(ring => ring.map(c => [c[1], c[0]] as [number, number]));
  }
  if (g.type === "MultiPolygon" && Array.isArray(g.coordinates)) {
    return (g.coordinates as number[][][][]).flatMap(poly => poly.map(ring => ring.map(c => [c[1], c[0]] as [number, number])));
  }
  if (g.type === "Feature") return coordsFromGeojson(g.geometry);
  return [];
}

function FitBounds({ coords }: { coords: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (coords.length > 0) map.fitBounds(coords, { padding: [30, 30] });
  }, [coords, map]);
  return null;
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadBinary(buf: ArrayBuffer, filename: string, mimeType: string) {
  const blob = new Blob([buf], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// VRA dose color scale (kg/ha → green-yellow-red)
function doseColor(dose: number, maxDose: number): string {
  if (maxDose <= 0) return "#a6d96a";
  const t = Math.min(1, dose / maxDose);
  if (t < 0.33) return "#1a9850";
  if (t < 0.66) return "#fdae61";
  return "#d73027";
}

export default function ParcelPrescription() {
  const { id } = useParams<{ id: string }>();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const searchParams = new URLSearchParams(search);
  const interpFromUrl = searchParams.get("interpolation") ?? "";
  const campaignFromUrl = searchParams.get("campaign") ?? "";
  // when present, this page operates on a satellite zone-set instead of
  // an interpolation: it loads zones via /api/zone-sets/:id/prescriptions and
  // generates satellite NDVI prescriptions via /api/zone-sets/:id/prescribe.
  const zoneSetFromUrl = searchParams.get("zoneSet") ?? "";
  const isSatelliteMode = !!zoneSetFromUrl;

  const [selectedCampaignId, setSelectedCampaignId] = useState<string>(campaignFromUrl);
  const [selectedInterpId, setSelectedInterpId] = useState<string>(interpFromUrl);
  const [generating, setGenerating] = useState(false);
  const [expandedZone, setExpandedZone] = useState<string | null>(null);
  const [plannedNitrogenDoses, setPlannedNitrogenDoses] = useState<Record<string, string>>({});

  // ── Application modal state (T155) ─────────────────────────────────────────
  const [appModal, setAppModal] = useState<{ open: boolean; prescription: PrescriptionWithZone | null }>({ open: false, prescription: null });
  const [appDate, setAppDate] = useState(new Date().toISOString().split("T")[0]);
  const [appDoses, setAppDoses] = useState<Record<string, string>>({});
  const [appMachine, setAppMachine] = useState("");
  const [appNotes, setAppNotes] = useState("");

  // ── VRA state ───────────────────────────────────────────────────────────────
  const [vraExpanded, setVraExpanded] = useState(false);
  const [vraCrop, setVraCrop] = useState("");
  const [vraProduct, setVraProduct] = useState("");
  const [vraNutrient, setVraNutrient] = useState("N");
  const [vraYield, setVraYield] = useState("8");
  const [vraBudget, setVraBudget] = useState("");
  const [vraMinDose, setVraMinDose] = useState("0");
  const [vraMaxDose, setVraMaxDose] = useState("500");
  const [vraCalculating, setVraCalculating] = useState(false);
  const [vraExporting, setVraExporting] = useState(false);
  const [vraResult, setVraResult] = useState<VRAResult | null>(null);

  // ── Existing queries ────────────────────────────────────────────────────────
  const { data: campaigns = EMPTY_CAMPAIGNS } = useQuery<SamplingCampaign[]>({
    queryKey: ["sampling-campaigns", id],
    queryFn: async () => {
      const r = await fetch(`/api/parcels/${id}/sampling-campaigns`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!id,
  });

  useEffect(() => {
    if (!selectedCampaignId && campaigns.length > 0) {
      const interpolated = campaigns.find(c => c.status === "interpolated") ?? campaigns[0];
      setSelectedCampaignId(interpolated.id);
    }
  }, [campaigns, selectedCampaignId]);

  const { data: parcel } = useQuery({
    queryKey: ["parcel-mvz", id],
    queryFn: async () => {
      const r = await fetch(`/api/parcels/${id}`, { credentials: "include" });
      if (!r.ok) throw new Error("Error");
      const data = await r.json();
      return data.parcel ?? data;
    },
    enabled: !!id,
  });

  const { data: prevInterpolations = EMPTY_INTERPOLATIONS } = useQuery<InterpolationResult[]>({
    queryKey: ["interpolations", selectedCampaignId],
    queryFn: async () => {
      const r = await fetch(`/api/sampling-campaigns/${selectedCampaignId}/interpolations`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!selectedCampaignId,
  });

  useEffect(() => {
    if (!selectedInterpId && prevInterpolations.length > 0) {
      setSelectedInterpId(prevInterpolations[0].id);
    }
  }, [prevInterpolations, selectedInterpId]);

  const { data: interpData } = useQuery<InterpolationWithZones>({
    queryKey: ["interpolation-zones", selectedInterpId],
    queryFn: async () => {
      const r = await fetch(`/api/interpolations/${selectedInterpId}`, { credentials: "include" });
      if (!r.ok) throw new Error("Error");
      return r.json();
    },
    enabled: !!selectedInterpId,
  });

  const { data: prescData, isLoading: prescLoading, refetch: refetchPresc } = useQuery<PrescriptionsResponse>({
    queryKey: ["prescriptions", selectedInterpId],
    queryFn: async () => {
      const r = await fetch(`/api/interpolations/${selectedInterpId}/prescriptions`, { credentials: "include" });
      if (!r.ok) throw new Error("Error");
      return r.json();
    },
    enabled: !!selectedInterpId && !isSatelliteMode,
  });

  // satellite zone-set mode: fetch zones + prescriptions from the
  // parallel /zone-sets endpoint, with the same response shape so the existing
  // render code below works unchanged.
  const { data: satPrescData, isLoading: satPrescLoading, refetch: refetchSatPresc } = useQuery<PrescriptionsResponse & { zones: ManagementZone[] }>({
    queryKey: ["zone-set-prescriptions", zoneSetFromUrl],
    queryFn: async () => {
      const r = await fetch(`/api/zone-sets/${zoneSetFromUrl}/prescriptions`, { credentials: "include" });
      if (!r.ok) throw new Error("Error");
      return r.json();
    },
    enabled: isSatelliteMode,
  });

  // ── VRA catalog query ───────────────────────────────────────────────────────
  const { data: catalog } = useQuery<PrescriptionCatalog>({
    queryKey: ["prescription-catalog"],
    queryFn: async () => {
      const r = await fetch("/api/geo/prescription/catalog", { credentials: "include" });
      if (!r.ok) throw new Error("Catálogo no disponible");
      return r.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  // Auto-select first crop/product when catalog loads
  useEffect(() => {
    if (catalog && !vraCrop && catalog.crops.length > 0) setVraCrop(catalog.crops[0].code);
    if (catalog && !vraProduct && catalog.products.length > 0) setVraProduct(catalog.products[0].code);
  }, [catalog]);

  // pick the active source: satellite zone-set or kriging interpolation.
  const zones: ManagementZone[] = isSatelliteMode
    ? (satPrescData?.zones ?? [])
    : (interpData?.zones ?? []);
  const prescriptions: PrescriptionWithZone[] = isSatelliteMode
    ? (satPrescData?.prescriptions ?? [])
    : (prescData?.prescriptions ?? []);
  const applications: PrescriptionApplication[] = isSatelliteMode
    ? (satPrescData?.applications ?? [])
    : (prescData?.applications ?? []);
  const hasPrescriptions = prescriptions.length > 0;
  const isNdviSource = zones.length > 0 && zones.every(z => z.source === "satellite_index") &&
    String((zones[0]?.sourceMetadata as { indexType?: string } | null)?.indexType ?? "ndvi").toLowerCase() === "ndvi";
  const hasNutrientRates = prescriptions.some(p => p.doseUnit === "kg N");

  // ── Application mutation (T155) ──────────────────────────────────────────────
  const applyMutation = useMutation({
    mutationFn: async ({ prescriptionId, payload }: { prescriptionId: string; payload: Record<string, unknown> }) => {
      const r = await fetch(`/api/prescriptions/${prescriptionId}/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message ?? "Error al registrar aplicación");
      return data;
    },
    onSuccess: () => {
      if (isSatelliteMode) refetchSatPresc(); else refetchPresc();
      setAppModal({ open: false, prescription: null });
      setAppDoses({});
      setAppMachine("");
      setAppNotes("");
      toast({ title: "Aplicación registrada", description: "Los datos de aplicación se guardaron correctamente." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function openAppModal(p: PrescriptionWithZone) {
    const zone = getZone(p);
    const initialDoses: Record<string, string> = {};
    const zoneLabel = zone?.zoneLabel ?? zone?.zoneIndex?.toString() ?? p.zoneId;
    initialDoses[zoneLabel] = getPlannedDose(p);
    setAppDoses(initialDoses);
    setAppDate(new Date().toISOString().split("T")[0]);
    setAppMachine("");
    setAppNotes("");
    setAppModal({ open: true, prescription: p });
  }

  function getPlannedDose(p: PrescriptionWithZone): string {
    const adjusted = p.doseUnit === "kg N" ? plannedNitrogenDoses[p.id] : undefined;
    return adjusted?.trim() && Number.isFinite(Number(adjusted)) && Number(adjusted) >= 0
      ? adjusted : String(p.dosePerHa ?? "");
  }

  function getPrescriptionStatus(p: PrescriptionWithZone): { status: "pendiente" | "aplicada" | "parcial"; lastDate: string | null } {
    const prescApps = applications.filter(a => a.prescriptionId === p.id);
    if (prescApps.length === 0) return { status: "pendiente", lastDate: null };
    const zone = getZone(p);
    const zoneLabel = zone?.zoneLabel ?? zone?.zoneIndex?.toString() ?? p.zoneId;
    const covered = prescApps.some(a => {
      const doses = a.actualDoseByZone as Record<string, number> | null;
      return doses && Object.keys(doses).includes(zoneLabel);
    });
    const lastDate = prescApps.reduce<string | null>((best, a) => {
      const d = String(a.applicationDate ?? "");
      return !best || d > best ? d : best;
    }, null);
    return { status: covered ? "aplicada" : "parcial", lastDate };
  }
  // Unified gates so the existing render code can branch on either source.
  const hasSource = isSatelliteMode ? !!zoneSetFromUrl : !!selectedInterpId;
  const sourceLoading = isSatelliteMode ? satPrescLoading : prescLoading;

  const polygonCoords = useMemo((): [number, number][] => {
    if (!Array.isArray(parcel?.polygonCoordinates)) return [];
    return parcel.polygonCoordinates as [number, number][];
  }, [parcel]);

  const allPoints = useMemo(() => {
    const zonePoints = zones.flatMap(z => coordsFromGeojson(z.polygonGeojson).flat());
    return [...polygonCoords, ...zonePoints];
  }, [polygonCoords, zones]);

  const generatePrescriptions = async () => {
    // route to the satellite endpoint when the page is in zone-set mode.
    if (!isSatelliteMode && !selectedInterpId) return;
    if (isSatelliteMode && !zoneSetFromUrl) return;
    setGenerating(true);
    try {
      const url = isSatelliteMode
        ? `/api/zone-sets/${zoneSetFromUrl}/prescribe`
        : `/api/interpolations/${selectedInterpId}/prescribe`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message ?? "Error");
      if (isSatelliteMode) {
        refetchSatPresc();
      } else {
        refetchPresc();
      }
      toast({ title: "Prescripciones generadas", description: `${(data.prescriptions as ZonePrescription[]).length} zonas procesadas ${isSatelliteMode ? "con reglas de NDVI" : "con IA"}` });
    } catch (e: unknown) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const getDisplayTotalDose = (p: PrescriptionWithZone): number => {
    const stored = Number(p.totalDose ?? 0);
    if (stored > 0) return stored;
    const zone = zones.find(z => z.id === p.zoneId) ?? (p.zone ?? undefined);
    const areaHa = Number(zone?.areaHa ?? 0);
    const dosePerHa = Number(p.dosePerHa ?? 0);
    return areaHa > 0 && dosePerHa > 0 ? dosePerHa * areaHa : 0;
  };

  const totals = useMemo(() => {
    if (!hasPrescriptions) return null;
    const totalArea = zones.reduce((s, z) => s + Number(z.areaHa ?? 0), 0);
    const totalCost = prescriptions.reduce((s, p) => s + Number(p.estimatedCost ?? 0), 0);
    const totalDose = prescriptions.reduce((s, p) => s + getDisplayTotalDose(p), 0);
    return { totalArea: totalArea.toFixed(2), totalCost: totalCost.toFixed(2), totalDose: totalDose.toFixed(2) };
  }, [prescriptions, zones, hasPrescriptions]);

  const getZone = (p: PrescriptionWithZone): ManagementZone | undefined => {
    if (p.zone) return p.zone;
    return zones.find(z => z.id === p.zoneId);
  };

  const exportCSV = () => {
    const rows = [
      ["Zona", "Insumo", "Dosis/ha", "Unidad", "Dosis total", "Método de aplicación", "Momento", "Costo estimado (USD)", "Justificación"],
      ...prescriptions.map(p => {
        const zone = getZone(p);
        return [
          zone?.zoneLabel ?? ZONE_LABELS[zone?.zoneIndex ?? 0] ?? `Zona`,
          p.amendment,
          p.dosePerHa ?? "",
          p.doseUnit ?? "",
          p.totalDose ?? "",
          p.applicationMethod ?? "",
          p.timing ?? "",
          p.estimatedCost ?? "",
          (p.aiRationale ?? "").replace(/,/g, ";"),
        ];
      }),
    ];
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    downloadFile(csv, `prescripcion_${parcel?.name ?? id}.csv`, "text/csv;charset=utf-8;");
  };

  const exportGeoJSON = async () => {
    if (!selectedCampaignId) return;
    try {
      const r = await fetch(`/api/sampling-campaigns/${selectedCampaignId}/export/geojson`, { credentials: "include" });
      if (!r.ok) throw new Error("Error al exportar");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${parcel?.name ?? id}_MVZ.geojson`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      toast({ title: "Error de exportación", description: (e as Error).message, variant: "destructive" });
    }
  };

  const exportKML = async () => {
    if (!selectedCampaignId) return;
    try {
      const r = await fetch(`/api/sampling-campaigns/${selectedCampaignId}/export/kml`, { credentials: "include" });
      if (!r.ok) throw new Error("Error al exportar");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${parcel?.name ?? id}_MVZ.kml`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      toast({ title: "Error de exportación", description: (e as Error).message, variant: "destructive" });
    }
  };

  // ── VRA: build zone payload from management zones ───────────────────────────
  const buildVraZones = () => {
    return zones.map(z => ({
      zone_index: z.zoneIndex,
      zone_label: z.zoneLabel ?? ZONE_LABELS[z.zoneIndex] ?? `Zona ${z.zoneIndex + 1}`,
      value_mean: Number(z.valueMean ?? 0),
      area_ha: Number(z.areaHa ?? 0),
      polygon_geojson: z.polygonGeojson ?? null,
    }));
  };

  // ── VRA: calculate doses ────────────────────────────────────────────────────
  const vraCalculate = async () => {
    if (!vraCrop || !vraProduct || !vraNutrient) {
      toast({ title: "Parámetros incompletos", description: "Selecciona cultivo, producto y nutriente.", variant: "destructive" });
      return;
    }
    if (zones.length === 0) {
      toast({ title: "Sin zonas", description: "Esta interpolación no tiene zonas de manejo generadas.", variant: "destructive" });
      return;
    }
    setVraCalculating(true);
    setVraResult(null);
    try {
      const payload = {
        zones: buildVraZones(),
        target_nutrient: vraNutrient,
        crop_code: vraCrop,
        yield_target_t_ha: parseFloat(vraYield) || 8,
        product_code: vraProduct,
        min_dose_kg_ha: parseFloat(vraMinDose) || 0,
        max_dose_kg_ha: parseFloat(vraMaxDose) || 500,
        ...(vraBudget ? { budget_limit_mxn: parseFloat(vraBudget) } : {}),
      };
      const r = await fetch("/api/geo/prescription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message ?? "Error calculando prescripción");
      setVraResult(data as VRAResult);
      toast({ title: "Prescripción calculada", description: `${data.zones_with_doses.length} zonas · ${data.total_kg_product} kg totales` });
    } catch (e: unknown) {
      toast({ title: "Error VRA", description: (e as Error).message, variant: "destructive" });
    } finally {
      setVraCalculating(false);
    }
  };

  // ── Export para autoguiado (T147): KML/KMZ/SHP/ISOXML/GeoJSON ─────────────
  const exportMachine = async (format: "kml" | "kmz" | "shapefile" | "isoxml" | "geojson") => {
    if (hasNutrientRates && format !== "geojson") {
      toast({ title: "Dosis en kg de N", description: "Descarga el GeoJSON y convierte la dosis a kg del fertilizante elegido antes de cargarla a maquinaria." });
      return;
    }
    if (!zoneSetFromUrl) {
      toast({ title: "Sin zone-set", description: "Esta exportación requiere un set de zonas (modo satélite o importado).", variant: "destructive" });
      return;
    }
    try {
      const r = await fetch(`/api/zone-sets/${zoneSetFromUrl}/export-machine?format=${format}`, { credentials: "include" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ message: r.statusText }));
        throw new Error(err.message ?? "Error de exportación");
      }
      const blob = await r.blob();
      // Best-effort filename from Content-Disposition
      const cd = r.headers.get("content-disposition") ?? "";
      const m = /filename="?([^";]+)"?/i.exec(cd);
      const filename = m?.[1] ?? `prescripcion_VRA.${format === "shapefile" ? "zip" : format === "isoxml" ? "xml" : format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
      toast({ title: "Descarga iniciada", description: filename });
    } catch (e) {
      toast({ title: "Error de exportación", description: (e as Error).message, variant: "destructive" });
    }
  };

  // ── VRA: export shapefile ───────────────────────────────────────────────────
  const vraExportShp = async (format: "shapefile" | "geojson" = "shapefile") => {
    if (!vraCrop || !vraProduct || !vraNutrient) return;
    if (zones.length === 0) return;
    setVraExporting(true);
    try {
      const payload = {
        zones: buildVraZones(),
        target_nutrient: vraNutrient,
        crop_code: vraCrop,
        yield_target_t_ha: parseFloat(vraYield) || 8,
        product_code: vraProduct,
        min_dose_kg_ha: parseFloat(vraMinDose) || 0,
        max_dose_kg_ha: parseFloat(vraMaxDose) || 500,
        ...(vraBudget ? { budget_limit_mxn: parseFloat(vraBudget) } : {}),
        format,
        projection: "wgs84",
      };
      const r = await fetch("/api/geo/prescription-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as any).message ?? "Error de exportación");
      }
      const warning = r.headers.get("x-export-warning");
      if (warning) toast({ title: "Advertencia de exportación", description: warning });
      const buf = await r.arrayBuffer();
      const isZip = format === "shapefile" && !warning;
      downloadBinary(buf, `prescripcion_vra.${isZip ? "zip" : "geojson"}`, isZip ? "application/zip" : "application/geo+json");
      toast({ title: "Exportación lista", description: isZip ? "Shapefile ZIP descargado (abrir en QGIS/ArcGIS)" : "GeoJSON descargado" });
    } catch (e: unknown) {
      toast({ title: "Error de exportación", description: (e as Error).message, variant: "destructive" });
    } finally {
      setVraExporting(false);
    }
  };

  // VRA result aggregates
  const vraMaxDoseValue = useMemo(() => {
    if (!vraResult) return 0;
    return Math.max(...vraResult.zones_with_doses.map(z => z.dose_kg_ha));
  }, [vraResult]);

  const vraAllPoints = useMemo(() => {
    if (!vraResult) return allPoints;
    return [
      ...allPoints,
      ...vraResult.zones_with_doses.flatMap(z => {
        const zoneObj = zones[z.zone_index];
        return zoneObj ? coordsFromGeojson(zoneObj.polygonGeojson).flat() : [];
      }),
    ];
  }, [vraResult, allPoints, zones]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-white sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setLocation(`/parcel/${id}`)} className="gap-1.5 text-sm">
            <ArrowLeft className="w-4 h-4" /> Parcela
          </Button>
          <div className="h-5 w-px bg-border" />
          <div>
            <h1 className="text-sm font-semibold leading-tight">{parcel?.name ?? "Prescripciones"}</h1>
            <p className="text-xs text-muted-foreground">Prescripción de insumos por zona</p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

        {/* Campaign + Interpolation selectors — hidden in satellite zone-set mode */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Layers className="w-4 h-4 text-purple-600" /> Fuente de datos
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-3">
            {isSatelliteMode ? (
              <div className="space-y-2" data-testid="info-satellite-source">
                <p className="text-sm">
                  Zonas generadas desde índice satelital
                  {(() => {
                    const meta = (zones[0]?.sourceMetadata ?? {}) as { indexType?: string; imageDate?: string };
                    const idx = (meta.indexType ?? "").toUpperCase();
                    const dateStr = meta.imageDate ? ` · imagen ${meta.imageDate}` : "";
                    return idx ? <> (<strong>{idx}</strong>{dateStr})</> : null;
                  })()}
                </p>
                {zones.length > 0 && (isNdviSource ? (
                  <>
                    <p className="text-xs text-muted-foreground">
                      La dosis base se calcula con el NDVI medio por zona. Los kg de N no son kg de fertilizante comercial.
                    </p>
                    {!hasPrescriptions && (
                      <Button onClick={generatePrescriptions} disabled={generating} data-testid="btn-generate-ndvi-prescription">
                        {generating ? "Calculando dosis…" : "Calcular dosis por NDVI"}
                      </Button>
                    )}
                  </>
                ) : <p className="text-xs text-muted-foreground">La dosis de nitrógeno por reglas solo está disponible para zonas satelitales NDVI.</p>)}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Campaña</p>
                  <Select value={selectedCampaignId} onValueChange={v => { setSelectedCampaignId(v); setSelectedInterpId(""); }} data-testid="select-campaign">
                    <SelectTrigger className="text-sm"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                    <SelectContent>
                      {campaigns.map((c: SamplingCampaign) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Interpolación</p>
                  <Select value={selectedInterpId} onValueChange={setSelectedInterpId} disabled={prevInterpolations.length === 0} data-testid="select-interpolation">
                    <SelectTrigger className="text-sm"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                    <SelectContent>
                      {prevInterpolations.map((interp: InterpolationResult) => (
                        <SelectItem key={interp.id} value={interp.id}>
                          {interp.method.toUpperCase()} · {new Date(interp.createdAt).toLocaleDateString("es-MX")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            {zones.length > 0 && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                <Badge variant="outline" className="text-xs">{zones.length} zonas de manejo</Badge>
                <span>·</span>
                <span>{zones.reduce((s, z) => s + Number(z.areaHa ?? 0), 0).toFixed(2)} ha totales</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Section 1: AI Prescriptions (oculta en modo satelital) ─────────── */}
        <div className="space-y-4">
          {!isSatelliteMode && (
            <>
              <div className="flex items-center gap-2">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Bot className="w-3.5 h-3.5 text-purple-500" /> Prescripción con IA
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>

              {/* Generate button (no prescriptions yet) */}
              {hasSource && !sourceLoading && !hasPrescriptions && (
                <Card className="border-purple-100" data-testid="card-generate">
                  <CardContent className="py-10 text-center space-y-3">
                    <Bot className="w-12 h-12 mx-auto text-purple-300" />
                    <div>
                      <p className="font-medium text-sm">Sin prescripciones generadas</p>
                      <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
                        La IA analizará cada zona y generará recomendaciones de insumos, dosis y método de aplicación.
                      </p>
                    </div>
                    <Button
                      className="gap-2 bg-purple-600 hover:bg-purple-700"
                      onClick={generatePrescriptions}
                      disabled={generating || zones.length === 0}
                      data-testid="btn-generate-prescriptions"
                    >
                      {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
                      {generating ? "Generando con IA…" : "Generar Prescripciones con IA"}
                    </Button>
                  </CardContent>
                </Card>
              )}

              {sourceLoading && hasSource && (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              )}
            </>
          )}

          {/* Export para autoguiado de tractor (T147) — visible para zonas importadas
              o satelitales. La prescripción es opcional: si no hay dosis, exportamos
              sólo geometría + parámetros base. */}
          {zoneSetFromUrl && zones.length > 0 && (
            <Card data-testid="card-export-machine" className="border-blue-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Download className="w-4 h-4 text-blue-600" /> Exportar para autoguiado de tractor
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  <Button variant="outline" size="sm" className="gap-1 text-xs border-blue-200 text-blue-700 hover:bg-blue-50" onClick={() => exportMachine("kml")} title="Google Earth, John Deere Operations Center" data-testid="btn-machine-kml">
                    KML
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1 text-xs border-blue-200 text-blue-700 hover:bg-blue-50" onClick={() => exportMachine("kmz")} title="KML comprimido (Google Earth)" data-testid="btn-machine-kmz">
                    KMZ
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1 text-xs border-blue-200 text-blue-700 hover:bg-blue-50" onClick={() => exportMachine("shapefile")} title="Trimble, Ag Leader, QGIS, ArcGIS" data-testid="btn-machine-shp">
                    Shapefile
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1 text-xs border-blue-200 text-blue-700 hover:bg-blue-50" onClick={() => exportMachine("isoxml")} title="ISO 11783-10 — terminales ISOBUS (Müller, CCI, AEF)" data-testid="btn-machine-isoxml">
                    ISO-XML
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1 text-xs border-blue-200 text-blue-700 hover:bg-blue-50" onClick={() => exportMachine("geojson")} title="Formato genérico web/SIG" data-testid="btn-machine-geojson">
                    GeoJSON
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {hasNutrientRates
                    ? "Descarga el GeoJSON para revisar las dosis de N. Convierte a kg del fertilizante elegido antes de cargar dosis a maquinaria."
                    : "Descarga las zonas y dosis (si hay prescripción cargada) en el formato que entiende tu monitor o terminal de pulverizadora/sembradora."}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Prescription map */}
          {!isSatelliteMode && hasPrescriptions && zones.length > 0 && (
            <Card className="overflow-hidden" data-testid="card-prescription-map">
              <CardHeader className="pb-1">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Layers className="w-4 h-4 text-purple-600" /> Mapa de Prescripción
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div style={{ height: 320 }}>
                  <MapContainer
                    center={polygonCoords.length > 0 ? polygonCoords[0] : [20, -99]}
                    zoom={14}
                    style={{ height: "100%", width: "100%" }}
                    data-testid="map-prescription"
                  >
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    {allPoints.length > 0 && <FitBounds coords={allPoints} />}
                    {polygonCoords.length >= 3 && (
                      <Polygon positions={polygonCoords} color="#7c3aed" fillOpacity={0} weight={2} dashArray="6 4" />
                    )}
                    {zones.map((zone: ManagementZone, i: number) => {
                      const rings = coordsFromGeojson(zone.polygonGeojson);
                      const color = zone.colorHex ?? ZONE_COLORS[i] ?? "#888";
                      const label = zone.zoneLabel ?? ZONE_LABELS[zone.zoneIndex] ?? `Zona ${i + 1}`;
                      const presc = prescriptions.find(p => p.zoneId === zone.id);
                      const centroid = rings[0] ? centroidOf(rings[0]) : null;
                      const doseText = presc ? `${presc.dosePerHa} ${presc.doseUnit}/ha` : label;
                      return (
                        <React.Fragment key={zone.id}>
                          {rings.map((ring: [number, number][], ri: number) => (
                            <Polygon
                              key={`${zone.id}-${ri}`}
                              positions={ring}
                              color={color}
                              fillColor={color}
                              fillOpacity={0.5}
                              weight={1.5}
                              data-testid={`polygon-zone-${i}`}
                            >
                              <LeafletTooltip sticky>
                                <div className="text-xs space-y-0.5">
                                  <div className="font-semibold">{label}</div>
                                  {presc && (
                                    <>
                                      <div>Insumo: {presc.amendment}</div>
                                      <div>Dosis: {presc.dosePerHa} {presc.doseUnit}/ha</div>
                                      {zone.areaHa && <div>Área: {Number(zone.areaHa).toFixed(2)} ha</div>}
                                    </>
                                  )}
                                </div>
                              </LeafletTooltip>
                            </Polygon>
                          ))}
                          {centroid && (
                            <Marker
                              key={`label-${zone.id}`}
                              position={centroid}
                              icon={makeDoseIcon(doseText, "#7c3aed")}
                              interactive={false}
                            />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </MapContainer>
                </div>
                <div className="px-4 py-2 flex flex-wrap gap-3">
                  {zones.map((zone: ManagementZone, i: number) => (
                    <div key={zone.id} className="flex items-center gap-1.5 text-xs">
                      <span className="w-3 h-3 rounded-sm inline-block border" style={{ background: zone.colorHex ?? ZONE_COLORS[i] ?? "#888" }} />
                      {zone.zoneLabel ?? ZONE_LABELS[zone.zoneIndex] ?? `Z${i + 1}`}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Summary totals */}
          {!isSatelliteMode && hasPrescriptions && totals && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" data-testid="section-totals">
              {[
                { label: "Área total", value: `${totals.totalArea} ha` },
                { label: "Dosis total", value: totals.totalDose },
                { label: "Costo est. (USD)", value: `$${totals.totalCost}` },
              ].map(t => (
                <Card key={t.label}>
                  <CardContent className="p-3 text-center">
                    <p className="text-base font-bold text-purple-700 font-mono">{t.value}</p>
                    <p className="text-xs text-muted-foreground">{t.label}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Prescription table */}
          {hasPrescriptions && (
            <Card data-testid="card-presc-table">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Table2 className="w-4 h-4 text-purple-600" /> Tabla de Prescripciones
                  </CardTitle>
                  {(!isSatelliteMode || isNdviSource) && <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1 text-xs text-purple-700 hover:bg-purple-50"
                    onClick={generatePrescriptions}
                    disabled={generating || (isSatelliteMode && applications.length > 0)}
                    data-testid="btn-regen-prescriptions"
                  >
                    {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bot className="w-3.5 h-3.5" />}
                    {isSatelliteMode ? "Recalcular dosis NDVI" : "Regenerar"}
                  </Button>}
                </div>
                {hasNutrientRates && (
                  <p className="text-xs text-muted-foreground">
                    Abre una zona para ajustar la dosis prevista antes de aplicar. El ajuste de esta sesión no cambia la dosis base.
                  </p>
                )}
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs min-w-[640px]">
                    <thead>
                      <tr className="bg-muted/50 border-b">
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Zona</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Área (ha)</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Valor medio</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Enmienda / Insumo</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Dosis/ha</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Dosis total</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Costo (USD)</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prescriptions.map((p: PrescriptionWithZone, idx: number) => {
                        const zone = getZone(p);
                        const zoneIdx = zone?.zoneIndex ?? idx;
                        const color = zone?.colorHex ?? ZONE_COLORS[zoneIdx] ?? "#888";
                        const label = zone?.zoneLabel ?? ZONE_LABELS[zoneIdx] ?? `Zona ${idx + 1}`;
                        const isExpanded = expandedZone === p.id;
                        const { status, lastDate } = getPrescriptionStatus(p);
                        const dateLabel = lastDate ? new Date(lastDate).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "2-digit" }) : null;
                        return (
                          <React.Fragment key={p.id}>
                            <tr
                              className="border-b hover:bg-muted/20 cursor-pointer transition-colors"
                              onClick={() => setExpandedZone(isExpanded ? null : p.id)}
                              data-testid={`row-presc-${idx}`}
                            >
                              <td className="px-3 py-2.5">
                                <div className="flex items-center gap-1.5">
                                  <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: color }} />
                                  <span className="font-medium">{label}</span>
                                  {isExpanded ? <ChevronUp className="w-3 h-3 text-muted-foreground ml-1" /> : <ChevronDown className="w-3 h-3 text-muted-foreground ml-1" />}
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono">{zone?.areaHa ? Number(zone.areaHa).toFixed(2) : "—"}</td>
                              <td className="px-3 py-2.5 text-right font-mono">{zone?.valueMean ? Number(zone.valueMean).toFixed(3) : "—"}</td>
                              <td className="px-3 py-2.5 font-medium text-purple-700">{p.amendment}</td>
                              <td className="px-3 py-2.5 text-right font-mono">
                                {p.dosePerHa ? `${p.dosePerHa} ${p.doseUnit ?? ""}` : "—"}
                                {p.doseUnit === "kg N" && getPlannedDose(p) !== String(p.dosePerHa ?? "") &&
                                  <div className="text-muted-foreground">Prevista: {getPlannedDose(p)} kg N/ha</div>}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono">{(() => { const d = getDisplayTotalDose(p); return d > 0 ? `${d.toFixed(4)} ${p.doseUnit ?? ""}` : "—"; })()}</td>
                              <td className="px-3 py-2.5 text-right font-mono">{p.estimatedCost ? `$${p.estimatedCost}` : "—"}</td>
                              <td className="px-3 py-2.5">
                                <div className="flex flex-col gap-1" onClick={e => e.stopPropagation()}>
                                  <div className="flex items-center gap-1.5">
                                    <Badge
                                      variant="outline"
                                      className={
                                        status === "aplicada"
                                          ? "text-xs bg-green-50 text-green-700 border-green-300"
                                          : status === "parcial"
                                            ? "text-xs bg-blue-50 text-blue-700 border-blue-300"
                                            : "text-xs bg-amber-50 text-amber-700 border-amber-300"
                                      }
                                      data-testid={`badge-status-${idx}`}
                                    >
                                      {status === "aplicada" ? <ClipboardCheck className="w-3 h-3 mr-1" /> : null}
                                      {status === "aplicada" ? "Aplicada" : status === "parcial" ? "Aplic. parcial" : "Pendiente"}
                                    </Badge>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-6 text-xs px-2 border-purple-200 text-purple-700 hover:bg-purple-50"
                                      onClick={() => openAppModal(p)}
                                      data-testid={`btn-registrar-aplicacion-${idx}`}
                                    >
                                      <Plus className="w-3 h-3 mr-1" /> Registrar
                                    </Button>
                                  </div>
                                  {dateLabel && (
                                    <span className="text-xs text-muted-foreground" data-testid={`text-applied-date-${idx}`}>
                                      {dateLabel}
                                    </span>
                                  )}
                                </div>
                              </td>
                            </tr>
                            {isExpanded && (p.aiRationale || p.doseUnit === "kg N") && (
                              <tr className="bg-purple-50/70" data-testid={`ai-rationale-${idx}`}>
                                <td colSpan={8} className="px-4 py-2.5">
                                  {p.aiRationale && <div className="flex items-start gap-2">
                                    <Bot className="w-3.5 h-3.5 text-purple-600 mt-0.5 shrink-0" />
                                    <p className="text-xs text-purple-800 leading-relaxed">{p.aiRationale}</p>
                                  </div>}
                                  {p.doseUnit === "kg N" && (
                                    <label className="mt-3 flex flex-wrap items-center gap-2">
                                      Dosis prevista (kg N/ha)
                                      <input type="number" min="0" step="any"
                                        className="w-28 rounded border border-input bg-background px-2 py-1"
                                        value={plannedNitrogenDoses[p.id] ?? String(p.dosePerHa ?? "")}
                                        onChange={e => {
                                          const { value } = e.currentTarget;
                                          setPlannedNitrogenDoses(prev => ({ ...prev, [p.id]: value }));
                                        }}
                                        data-testid={`input-ndvi-planned-dose-${idx}`} />
                                    </label>
                                  )}
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                    <tfoot className="border-t bg-muted/30">
                      <tr>
                        <td className="px-3 py-2 font-semibold text-xs">Totales</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold">{totals?.totalArea ?? "—"}</td>
                        <td className="px-3 py-2" />
                        <td className="px-3 py-2" />
                        <td className="px-3 py-2" />
                        <td className="px-3 py-2 text-right font-mono font-semibold">{totals?.totalDose ?? "—"}</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold">{!hasNutrientRates && totals?.totalCost ? `$${totals.totalCost}` : "—"}</td>
                        <td className="px-3 py-2" />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* AI Export actions */}
          {!isSatelliteMode && hasPrescriptions && (
            <Card data-testid="card-export">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Download className="w-4 h-4 text-purple-600" /> Exportar prescripción IA
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <Button variant="outline" size="sm" className="gap-2 text-xs border-purple-200 text-purple-700 hover:bg-purple-50" onClick={exportCSV} data-testid="btn-export-csv">
                    <Table2 className="w-3.5 h-3.5" /> CSV
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2 text-xs border-purple-200 text-purple-700 hover:bg-purple-50" onClick={exportGeoJSON} data-testid="btn-export-geojson">
                    <FileJson className="w-3.5 h-3.5" /> GeoJSON
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2 text-xs border-purple-200 text-purple-700 hover:bg-purple-50" onClick={exportKML} data-testid="btn-export-kml">
                    <Map className="w-3.5 h-3.5" /> KML
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ── Section 2: VRA Agronómico (sólo modo kriging) ─────────────────── */}
        {selectedInterpId && !isSatelliteMode && (
          <div className="space-y-4">
            <button
              className="w-full flex items-center gap-2 py-1"
              onClick={() => setVraExpanded(v => !v)}
              data-testid="btn-toggle-vra"
            >
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <FlaskConical className="w-3.5 h-3.5 text-green-600" /> Prescripción VRA Agronómica
                {vraExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </span>
              <div className="h-px flex-1 bg-border" />
            </button>

            {vraExpanded && (
              <div className="space-y-4">
                {/* Info banner */}
                <Card className="border-green-100 bg-green-50/40">
                  <CardContent className="py-3 px-4">
                    <p className="text-xs text-green-800 leading-relaxed">
                      <strong>Balance agronómico INIFAP/FAO:</strong> calcula la dosis de fertilizante por zona usando
                      la demanda del cultivo, el contenido de nutriente medido y la eficiencia de uso. Genera un Shapefile
                      listo para cargadores variables (VRA).
                    </p>
                  </CardContent>
                </Card>

                {/* Config panel */}
                <Card data-testid="card-vra-config">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Calculator className="w-4 h-4 text-green-600" /> Parámetros agronómicos
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* Nutriente */}
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                          <Beaker className="w-3 h-3" /> Nutriente
                        </Label>
                        <Select value={vraNutrient} onValueChange={setVraNutrient} data-testid="select-nutrient">
                          <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {catalog?.nutrients.map(n => (
                              <SelectItem key={n.code} value={n.code}>{n.label}</SelectItem>
                            )) ?? (
                              <>
                                <SelectItem value="N">Nitrógeno (N)</SelectItem>
                                <SelectItem value="P2O5">Fósforo (P₂O₅)</SelectItem>
                                <SelectItem value="K2O">Potasio (K₂O)</SelectItem>
                              </>
                            )}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Cultivo */}
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                          <Sprout className="w-3 h-3" /> Cultivo
                        </Label>
                        <Select value={vraCrop} onValueChange={setVraCrop} data-testid="select-crop">
                          <SelectTrigger className="text-sm"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                          <SelectContent>
                            {catalog?.crops.map(c => (
                              <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Producto */}
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                          <Package className="w-3 h-3" /> Fertilizante
                        </Label>
                        <Select value={vraProduct} onValueChange={setVraProduct} data-testid="select-product">
                          <SelectTrigger className="text-sm"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                          <SelectContent>
                            {catalog?.products.map(p => (
                              <SelectItem key={p.code} value={p.code}>{p.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Rendimiento objetivo */}
                      <div className="space-y-1.5">
                        <Label htmlFor="vra-yield" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                          Rendimiento objetivo (t/ha)
                        </Label>
                        <Input
                          id="vra-yield"
                          type="number"
                          min="0.1"
                          max="100"
                          step="0.5"
                          value={vraYield}
                          onChange={e => setVraYield(e.target.value)}
                          className="text-sm"
                          data-testid="input-yield"
                        />
                      </div>
                    </div>

                    {/* Advanced: budget + dose bounds */}
                    <details className="group">
                      <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground select-none flex items-center gap-1">
                        <ChevronDown className="w-3 h-3 group-open:rotate-180 transition-transform" />
                        Parámetros avanzados (presupuesto, dosis mín/máx)
                      </summary>
                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="vra-min-dose" className="text-xs text-muted-foreground">Dosis mín. (kg/ha)</Label>
                          <Input id="vra-min-dose" type="number" min="0" value={vraMinDose} onChange={e => setVraMinDose(e.target.value)} className="text-sm" data-testid="input-min-dose" />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="vra-max-dose" className="text-xs text-muted-foreground">Dosis máx. (kg/ha)</Label>
                          <Input id="vra-max-dose" type="number" min="1" value={vraMaxDose} onChange={e => setVraMaxDose(e.target.value)} className="text-sm" data-testid="input-max-dose" />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="vra-budget" className="text-xs text-muted-foreground">Presupuesto (MXN)</Label>
                          <Input id="vra-budget" type="number" min="0" value={vraBudget} placeholder="Sin límite" onChange={e => setVraBudget(e.target.value)} className="text-sm" data-testid="input-budget" />
                        </div>
                      </div>
                    </details>

                    <Button
                      className="w-full gap-2 bg-green-700 hover:bg-green-800"
                      onClick={vraCalculate}
                      disabled={vraCalculating || zones.length === 0 || !vraCrop || !vraProduct}
                      data-testid="btn-vra-calculate"
                    >
                      {vraCalculating ? <Loader2 className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}
                      {vraCalculating ? "Calculando…" : "Calcular prescripción VRA"}
                    </Button>

                    {zones.length === 0 && selectedInterpId && (
                      <p className="text-xs text-amber-600 text-center">
                        Esta interpolación no tiene zonas de manejo. Ve a la página de zonificación para generarlas.
                      </p>
                    )}
                  </CardContent>
                </Card>

                {/* VRA Results */}
                {vraResult && (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="section-vra-totals">
                      {[
                        { label: "Área", value: `${vraResult.total_area_ha.toFixed(2)} ha` },
                        { label: "Dosis media", value: `${vraResult.avg_dose_kg_ha.toFixed(1)} kg/ha` },
                        { label: "Total producto", value: `${vraResult.total_kg_product.toFixed(0)} kg` },
                        { label: "Costo total", value: `$${(vraResult.total_cost_mxn / 1000).toFixed(1)}k MXN` },
                      ].map(t => (
                        <Card key={t.label}>
                          <CardContent className="p-3 text-center">
                            <p className="text-sm font-bold text-green-700 font-mono">{t.value}</p>
                            <p className="text-xs text-muted-foreground">{t.label}</p>
                          </CardContent>
                        </Card>
                      ))}
                    </div>

                    {vraResult.constraints_applied.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {vraResult.constraints_applied.map(c => (
                          <Badge key={c} variant="outline" className="text-xs text-amber-700 border-amber-300 bg-amber-50">
                            {c === "budget_rebalanced" ? "Presupuesto ajustado" : c === "clamped_to_max" ? "Dosis máxima aplicada" : c === "clamped_to_min" ? "Dosis mínima aplicada" : c}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {/* VRA Map */}
                    {zones.length > 0 && (
                      <Card className="overflow-hidden" data-testid="card-vra-map">
                        <CardHeader className="pb-1">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <Map className="w-4 h-4 text-green-600" /> Mapa de dosis VRA
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                          <div style={{ height: 300 }}>
                            <MapContainer
                              center={polygonCoords.length > 0 ? polygonCoords[0] : [20, -99]}
                              zoom={14}
                              style={{ height: "100%", width: "100%" }}
                              data-testid="map-vra"
                            >
                              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                              {vraAllPoints.length > 0 && <FitBounds coords={vraAllPoints} />}
                              {polygonCoords.length >= 3 && (
                                <Polygon positions={polygonCoords} color="#15803d" fillOpacity={0} weight={2} dashArray="6 4" />
                              )}
                              {vraResult.zones_with_doses.map((zd, i) => {
                                const zone = zones[zd.zone_index] ?? zones[i];
                                if (!zone) return null;
                                const rings = coordsFromGeojson(zone.polygonGeojson);
                                const color = doseColor(zd.dose_kg_ha, vraMaxDoseValue);
                                const centroid = rings[0] ? centroidOf(rings[0]) : null;
                                return (
                                  <React.Fragment key={`vra-${i}`}>
                                    {rings.map((ring, ri) => (
                                      <Polygon
                                        key={`${i}-${ri}`}
                                        positions={ring}
                                        color={color}
                                        fillColor={color}
                                        fillOpacity={0.6}
                                        weight={1.5}
                                        data-testid={`vra-polygon-${i}`}
                                      >
                                        <LeafletTooltip sticky>
                                          <div className="text-xs space-y-0.5">
                                            <div className="font-semibold">{zd.zone_label}</div>
                                            <div>Dosis: {zd.dose_kg_ha.toFixed(1)} kg/ha</div>
                                            <div>Área: {zd.area_ha.toFixed(2)} ha</div>
                                            <div>Total: {zd.total_kg_product.toFixed(0)} kg</div>
                                            <div>Costo: ${zd.cost_mxn.toFixed(0)} MXN</div>
                                          </div>
                                        </LeafletTooltip>
                                      </Polygon>
                                    ))}
                                    {centroid && (
                                      <Marker
                                        position={centroid}
                                        icon={makeDoseIcon(`${zd.dose_kg_ha.toFixed(0)} kg/ha`, "#15803d")}
                                        interactive={false}
                                      />
                                    )}
                                  </React.Fragment>
                                );
                              })}
                            </MapContainer>
                          </div>
                          <div className="px-4 py-2 flex items-center gap-4 text-xs text-muted-foreground">
                            <div className="flex items-center gap-1.5">
                              <span className="w-3 h-3 rounded-sm inline-block" style={{ background: "#1a9850" }} /> Dosis baja
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="w-3 h-3 rounded-sm inline-block" style={{ background: "#fdae61" }} /> Dosis media
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="w-3 h-3 rounded-sm inline-block" style={{ background: "#d73027" }} /> Dosis alta
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {/* VRA zone table */}
                    <Card data-testid="card-vra-table">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Table2 className="w-4 h-4 text-green-600" /> Tabla de dosis por zona
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-0">
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs min-w-[560px]">
                            <thead>
                              <tr className="bg-green-50 border-b">
                                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Zona</th>
                                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Área (ha)</th>
                                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Disponible (ppm→kg/ha)</th>
                                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Déficit (kg/ha)</th>
                                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Dosis producto (kg/ha)</th>
                                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Total (kg)</th>
                                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Costo (MXN)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {vraResult.zones_with_doses.map((zd, idx) => (
                                <tr key={idx} className="border-b hover:bg-muted/20" data-testid={`vra-row-${idx}`}>
                                  <td className="px-3 py-2.5">
                                    <div className="flex items-center gap-1.5">
                                      <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: doseColor(zd.dose_kg_ha, vraMaxDoseValue) }} />
                                      <span className="font-medium">{zd.zone_label}</span>
                                      {zd.budget_rebalanced && <Badge variant="outline" className="text-xs py-0 text-amber-600 border-amber-300">ajustado</Badge>}
                                    </div>
                                  </td>
                                  <td className="px-3 py-2.5 text-right font-mono">{zd.area_ha.toFixed(2)}</td>
                                  <td className="px-3 py-2.5 text-right font-mono">{zd.nutrient_available_kg_ha.toFixed(1)}</td>
                                  <td className="px-3 py-2.5 text-right font-mono text-red-600">{zd.nutrient_deficit_kg_ha.toFixed(1)}</td>
                                  <td className="px-3 py-2.5 text-right font-mono font-semibold text-green-700">{zd.dose_kg_ha.toFixed(1)}</td>
                                  <td className="px-3 py-2.5 text-right font-mono">{zd.total_kg_product.toFixed(0)}</td>
                                  <td className="px-3 py-2.5 text-right font-mono">${zd.cost_mxn.toFixed(0)}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot className="border-t bg-green-50/60">
                              <tr>
                                <td className="px-3 py-2 font-semibold text-xs">Totales</td>
                                <td className="px-3 py-2 text-right font-mono font-semibold">{vraResult.total_area_ha.toFixed(2)}</td>
                                <td className="px-3 py-2" />
                                <td className="px-3 py-2" />
                                <td className="px-3 py-2 text-right font-mono font-semibold">{vraResult.avg_dose_kg_ha.toFixed(1)}</td>
                                <td className="px-3 py-2 text-right font-mono font-semibold">{vraResult.total_kg_product.toFixed(0)}</td>
                                <td className="px-3 py-2 text-right font-mono font-semibold">${vraResult.total_cost_mxn.toFixed(0)}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </CardContent>
                    </Card>

                    {/* VRA Export */}
                    <Card data-testid="card-vra-export">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <FileArchive className="w-4 h-4 text-green-600" /> Exportar prescripción VRA
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-2 text-xs border-green-200 text-green-700 hover:bg-green-50"
                            onClick={() => vraExportShp("shapefile")}
                            disabled={vraExporting}
                            data-testid="btn-export-shp"
                          >
                            {vraExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileArchive className="w-3.5 h-3.5" />}
                            Shapefile ZIP (QGIS/ArcGIS)
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-2 text-xs border-green-200 text-green-700 hover:bg-green-50"
                            onClick={() => vraExportShp("geojson")}
                            disabled={vraExporting}
                            data-testid="btn-export-vra-geojson"
                          >
                            <FileJson className="w-3.5 h-3.5" /> GeoJSON
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                          El Shapefile contiene geometría por zona + dosis, área, costo y parámetros de prescripción.
                          Compatible con terminales de aplicación variable (ISO-XML en próxima versión).
                        </p>
                      </CardContent>
                    </Card>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {!hasSource && !isSatelliteMode && campaigns.length === 0 && (
          <div className="text-center py-12 text-muted-foreground" data-testid="text-no-campaigns">
            <Bot className="w-12 h-12 mx-auto mb-3 opacity-25" />
            <p className="text-sm">Sin campañas de muestreo</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => setLocation(`/parcel/${id}/sampling/design`)}>
              Crear campaña
            </Button>
          </div>
        )}
      </div>

      {/* ── Registrar aplicación modal (T155) ─────────────────────────────── */}
      <Dialog open={appModal.open} onOpenChange={open => setAppModal(prev => ({ ...prev, open }))}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-registrar-aplicacion">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-purple-600" />
              Registrar aplicación
            </DialogTitle>
            <DialogDescription>
              {appModal.prescription
                ? `Insumo: ${appModal.prescription.amendment} — ${appModal.prescription.dosePerHa} ${appModal.prescription.doseUnit ?? ""}/ha prescrita`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs text-muted-foreground">Fecha de aplicación</Label>
              <input
                type="date"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm mt-1"
                value={appDate}
                onChange={e => setAppDate(e.target.value)}
                data-testid="input-app-date"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Dosis real aplicada (por zona, {appModal.prescription?.doseUnit ? `${appModal.prescription.doseUnit}/ha` : "kg/ha"})</Label>
              {Object.entries(appDoses).map(([zoneLabel, dose]) => (
                <div key={zoneLabel} className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-muted-foreground min-w-[60px]">{zoneLabel}</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                    value={dose}
                    onChange={e => setAppDoses(prev => ({ ...prev, [zoneLabel]: e.target.value }))}
                    data-testid={`input-app-dose-${zoneLabel}`}
                  />
                </div>
              ))}
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Maquinaria / equipo</Label>
              <input
                type="text"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm mt-1"
                placeholder="Ej: Fertilizadora Amazone ZA-M"
                value={appMachine}
                onChange={e => setAppMachine(e.target.value)}
                data-testid="input-app-machine"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Notas (opcional)</Label>
              <textarea
                className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1 resize-none"
                placeholder="Condiciones del día, incidencias, etc."
                value={appNotes}
                onChange={e => setAppNotes(e.target.value)}
                data-testid="input-app-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAppModal({ open: false, prescription: null })} data-testid="btn-cancel-app">
              Cancelar
            </Button>
            <Button
              className="bg-purple-600 hover:bg-purple-700 text-white"
              disabled={applyMutation.isPending || !appDate}
              onClick={() => {
                if (!appModal.prescription) return;
                const zoneDosesApplied: Record<string, number> = {};
                Object.entries(appDoses).forEach(([k, v]) => { zoneDosesApplied[k] = parseFloat(v) || 0; });
                applyMutation.mutate({
                  prescriptionId: appModal.prescription.id,
                  payload: {
                    applicationDate: appDate,
                    actualDoseByZone: zoneDosesApplied,
                    machineUsed: appMachine || null,
                    notes: appNotes || null,
                  },
                });
              }}
              data-testid="btn-confirm-app"
            >
              {applyMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ClipboardCheck className="w-4 h-4 mr-2" />}
              Guardar aplicación
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

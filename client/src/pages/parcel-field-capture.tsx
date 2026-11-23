import { useParams, useLocation, useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ArrowLeft, Wifi, WifiOff, MapPin, CheckCircle2, Clock, Loader2, Navigation, Upload, AlertCircle, ChevronDown, ChevronUp, ChevronRight, Camera, Download, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { MapContainer, TileLayer, CircleMarker, Marker, Tooltip as LeafletTooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  savePendingReading, syncPendingReadings, fileToBase64,
  getActivePendingReadings, getDiscardedReadings, dismissDiscardedReading,
  type PendingReading,
} from "@/lib/offline-sync";
import type { SamplingCampaign, SamplingPoint, MasterVariable } from "@shared/schema";

type CampaignWithVariable = SamplingCampaign & { variable?: Pick<MasterVariable, "minValue" | "maxValue" | "optimalMin" | "optimalMax"> };

const userIcon = L.divIcon({
  html: '<div style="width:14px;height:14px;border-radius:50%;background:#2563eb;border:3px solid white;box-shadow:0 0 0 2px #2563eb;"></div>',
  className: "",
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function MapCenterUser({ position }: { position: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (position) map.setView(position, map.getZoom(), { animate: true });
  }, [position, map]);
  return null;
}

function MapFocusPoint({ position }: { position: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (position) map.setView(position, Math.max(map.getZoom(), 16), { animate: true });
  }, [position, map]);
  return null;
}

const SOIL_CONDITIONS = ["normal", "seco", "húmedo", "saturado", "compactado"];

interface CaptureForm {
  value: string;
  temperatureC: string;
  soilCondition: string;
  notes: string;
  nSubsamples: string;
  photoFile?: File | null;
}

const EMPTY_FORM: CaptureForm = {
  value: "",
  temperatureC: "",
  soilCondition: "normal",
  notes: "",
  nSubsamples: "1",
  photoFile: null,
};

type ValidationStatus = "ok" | "optimal_warn" | "absolute_error" | "empty";

interface PointCapturePayload {
  value: number;
  latActual: number | null;
  lonActual: number | null;
  soilCondition: string | null;
  notes: string | null;
  nSubsamples: number;
  temperatureC: number | null;
  forceInsert?: boolean;
}

function getValueValidation(
  value: string,
  variable: { minValue?: string | number | null; maxValue?: string | number | null; optimalMin?: string | number | null; optimalMax?: string | number | null } | undefined
): { status: ValidationStatus; message: string } {
  if (!value || !variable) return { status: "empty", message: "" };
  const num = parseFloat(value);
  if (isNaN(num)) return { status: "absolute_error", message: "Ingresa un número válido" };
  const min = Number(variable.minValue);
  const max = Number(variable.maxValue);
  const optMin = Number(variable.optimalMin);
  const optMax = Number(variable.optimalMax);
  if (!isNaN(min) && !isNaN(max) && (num < min || num > max)) {
    return { status: "optimal_warn", message: `Fuera del rango de referencia [${min}–${max}]. Puedes guardar igualmente.` };
  }
  if (!isNaN(optMin) && !isNaN(optMax) && (num < optMin || num > optMax)) {
    return { status: "optimal_warn", message: `Fuera del rango óptimo [${optMin}–${optMax}]. Puedes guardar igualmente.` };
  }
  return { status: "ok", message: "" };
}

export default function ParcelFieldCapture() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const qc = useQueryClient();

  const targetPointId = new URLSearchParams(search).get("point") ?? null;
  const campaignIdParam = new URLSearchParams(search).get("campaign") ?? null;

  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [gpsPosition, setGpsPosition] = useState<[number, number] | null>(null);
  const [gpsError, setGpsError] = useState("");
  const [captureForm, setCaptureForm] = useState<CaptureForm>(EMPTY_FORM);
  const [expandedPoint, setExpandedPoint] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [discardedReadings, setDiscardedReadings] = useState<PendingReading[]>([]);
  const [showDiscardedTray, setShowDiscardedTray] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [agronomicWarning, setAgronomicWarning] = useState<{ message: string; value: number; pointId: string } | null>(null);
  const [localCaptured, setLocalCaptured] = useState<Record<string, number>>({});
  const watchRef = useRef<number | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) return;
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setGpsPosition([pos.coords.latitude, pos.coords.longitude]);
        setGpsError("");
      },
      (err) => setGpsError(err.message),
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
    return () => {
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    };
  }, []);

  const { data: parcel } = useQuery({
    queryKey: ["parcel-mvz", id],
    queryFn: async () => {
      const r = await fetch(`/api/parcels/${id}`, { credentials: "include" });
      if (!r.ok) throw new Error("Error");
      const data = await r.json();
      return data.parcel ?? data;
    },
  });

  const { data: campaigns = [] } = useQuery<SamplingCampaign[]>({
    queryKey: ["sampling-campaigns", id],
    queryFn: async () => {
      const r = await fetch(`/api/parcels/${id}/sampling-campaigns`, { credentials: "include" });
      if (!r.ok) throw new Error("Error");
      return r.json();
    },
  });

  // Prefer the campaign ID passed via URL param (set by confirmGrid navigation).
  // When no param is present, prefer the most-recently-started active campaign
  // so multiple simultaneous active campaigns don't cause a silent mismatch.
  const activeCampaign: SamplingCampaign | null = (() => {
    if (campaignIdParam) {
      const byId = campaigns.find((c) => c.id === campaignIdParam);
      if (byId) return byId;
    }
    const activeCampaigns = campaigns.filter((c) => c.status === "active");
    if (activeCampaigns.length > 0) {
      // Sort by startedAt DESC to prefer the most recently confirmed campaign
      return activeCampaigns.sort((a, b) => {
        const ta = a.startedAt ? new Date(a.startedAt).getTime() : 0;
        const tb = b.startedAt ? new Date(b.startedAt).getTime() : 0;
        return tb - ta;
      })[0];
    }
    return campaigns.find((c) => c.status === "designing") ?? campaigns[0] ?? null;
  })();

  // Fetch full campaign detail (includes joined variable with bounds for real-time validation)
  const { data: activeCampaignDetail } = useQuery<CampaignWithVariable>({
    queryKey: ["sampling-campaign-detail", activeCampaign?.id],
    queryFn: async () => {
      const r = await fetch(`/api/sampling-campaigns/${activeCampaign!.id}`, { credentials: "include" });
      if (!r.ok) throw new Error("Error");
      return r.json();
    },
    enabled: !!activeCampaign?.id,
  });

  const { data: points = [], refetch: refetchPoints } = useQuery<SamplingPoint[]>({
    queryKey: ["sampling-points", activeCampaign?.id],
    queryFn: async () => {
      const r = await fetch(`/api/sampling-campaigns/${activeCampaign!.id}/points`, { credentials: "include" });
      if (!r.ok) throw new Error("Error");
      return r.json();
    },
    enabled: !!activeCampaign?.id,
    // Pause polling while the operator is editing a point so their in-progress
    // form data isn't blown away by an incoming refetch.
    refetchInterval: expandedPoint ? false : 30000,
  });

  const refreshLocalQueues = useCallback(async (campaignId: string) => {
    const [active, discarded] = await Promise.all([
      getActivePendingReadings(campaignId),
      getDiscardedReadings(campaignId),
    ]);
    setPendingCount(active.length);
    setDiscardedReadings(discarded);
  }, []);

  useEffect(() => {
    if (activeCampaign?.id) {
      refreshLocalQueues(activeCampaign.id);
    }
  }, [activeCampaign?.id, refreshLocalQueues]);

  // Auto-open point from ?point=ID URL param (deep-link from interpolation diagnosis panel)
  useEffect(() => {
    if (!targetPointId || !points.length) return;
    const found = (points as SamplingPoint[]).find(p => p.id === targetPointId);
    if (found) {
      setExpandedPoint(targetPointId);
      // Pre-fill form if point already has a captured value (editing mode)
      const displayVal = found.value != null ? Number(found.value) : null;
      if (displayVal != null) {
        setCaptureForm({
          ...EMPTY_FORM,
          value: String(displayVal),
          soilCondition: (found as SamplingPoint & { soilCondition?: string }).soilCondition ?? "normal",
          notes: (found as SamplingPoint & { notes?: string }).notes ?? "",
          temperatureC: (found as SamplingPoint & { temperatureC?: number | null }).temperatureC != null
            ? String((found as SamplingPoint & { temperatureC?: number | null }).temperatureC)
            : "",
          nSubsamples: (found as SamplingPoint & { nSubsamples?: number }).nSubsamples != null
            ? String((found as SamplingPoint & { nSubsamples?: number }).nSubsamples)
            : "1",
        });
      }
      setTimeout(() => {
        const el = document.getElementById(`capture-point-${targetPointId}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 300);
    }
  }, [targetPointId, points]);

  // Compute target point map position for deep-link centering
  const targetPointPos = useMemo((): [number, number] | null => {
    if (!targetPointId || !points.length) return null;
    const pt = (points as SamplingPoint[]).find(p => p.id === targetPointId);
    if (!pt) return null;
    const lat = parseFloat(pt.latPlanned);
    const lon = parseFloat(pt.lonPlanned);
    return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
  }, [targetPointId, points]);

  const isPointCompleted = (p: SamplingPoint) => p.value != null || localCaptured[p.id] != null;

  const sortedPoints = [...(points as SamplingPoint[])].sort((a: SamplingPoint, b: SamplingPoint) => {
    const aCompleted = isPointCompleted(a);
    const bCompleted = isPointCompleted(b);
    if (aCompleted && !bCompleted) return 1;
    if (!aCompleted && bCompleted) return -1;
    if (!gpsPosition) return a.pointIndex - b.pointIndex;
    const aLat = parseFloat(a.latPlanned);
    const aLon = parseFloat(a.lonPlanned);
    const bLat = parseFloat(b.latPlanned);
    const bLon = parseFloat(b.lonPlanned);
    return (
      haversineDistance(gpsPosition[0], gpsPosition[1], aLat, aLon) -
      haversineDistance(gpsPosition[0], gpsPosition[1], bLat, bLon)
    );
  });

  const completedCount = points.filter((p) => isPointCompleted(p)).length;
  const progressPct = points.length > 0 ? Math.round((completedCount / points.length) * 100) : 0;

  const doCapture = async (pointId: string, forceInsert = false) => {
    const val = parseFloat(captureForm.value);
    if (!captureForm.value || isNaN(val)) {
      toast({ title: "Valor inválido", description: "Ingresa un valor numérico", variant: "destructive" });
      return;
    }

    const payload: PointCapturePayload = {
      value: val,
      latActual: gpsPosition?.[0] ?? null,
      lonActual: gpsPosition?.[1] ?? null,
      soilCondition: captureForm.soilCondition || null,
      notes: captureForm.notes || null,
      nSubsamples: parseInt(captureForm.nSubsamples) || 1,
      temperatureC: captureForm.temperatureC ? parseFloat(captureForm.temperatureC) : null,
      ...(forceInsert ? { forceInsert: true } : {}),
    };

    const r = await fetch(`/api/sampling-points/${pointId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      const err = await r.json();
      if (err.code === "AGRONOMIC_RANGE") {
        setAgronomicWarning({ message: err.message, value: val, pointId });
        return;
      }
      throw new Error(err.message || "Error al guardar");
    }

    const result = await r.json();

    // Upload optional photo (best-effort — reading is already saved)
    if (captureForm.photoFile) {
      try {
        const fd = new FormData();
        fd.append("photo", captureForm.photoFile);
        await fetch(`/api/sampling-points/${pointId}/photo`, {
          method: "POST",
          credentials: "include",
          body: fd,
        });
      } catch {
        // Non-blocking — reading value is persisted regardless
      }
    }

    return result;
  };

  const captureOnline = useMutation({
    mutationFn: async ({ pointId, force }: { pointId: string; force?: boolean }) => {
      return doCapture(pointId, force);
    },
    onSuccess: (result: any) => {
      if (!result) return;
      qc.invalidateQueries({ queryKey: ["sampling-points", activeCampaign?.id] });
      setCaptureForm(EMPTY_FORM);
      setExpandedPoint(null);
      setAgronomicWarning(null);
      // Soft warning path (e.g. GPS outside parcel polygon): the server saved
      // the reading but flagged it. Surface as a non-destructive yellow toast.
      if (result.warning) {
        toast({
          title: "Lectura guardada con aviso",
          description: result.warning,
        });
      } else {
        toast({ title: "Lectura guardada", description: "Sincronizado con el servidor" });
      }
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const captureOffline = async (pointId: string) => {
    const val = parseFloat(captureForm.value);
    if (!captureForm.value || isNaN(val)) {
      toast({ title: "Valor inválido", description: "Ingresa un valor numérico", variant: "destructive" });
      return;
    }
    // Reject obviously bogus GPS readings (e.g. (0, 0) — Null Island).
    if (
      gpsPosition &&
      Math.abs(gpsPosition[0]) < 1e-6 &&
      Math.abs(gpsPosition[1]) < 1e-6
    ) {
      toast({
        title: "GPS no válido",
        description: "Las coordenadas (0, 0) no son válidas. Espera una mejor señal o desactiva el GPS antes de guardar.",
        variant: "destructive",
      });
      return;
    }
    // Convert photo to base64 for offline storage if present
    let photoBase64: string | undefined;
    let photoMime: string | undefined;
    if (captureForm.photoFile) {
      try {
        const encoded = await fileToBase64(captureForm.photoFile);
        photoBase64 = encoded.base64;
        photoMime = encoded.mime;
      } catch {
        // Non-blocking — proceed without photo
      }
    }

    await savePendingReading({
      campaignId: activeCampaign.id,
      pointId,
      value: val,
      latActual: gpsPosition?.[0],
      lonActual: gpsPosition?.[1],
      temperatureC: captureForm.temperatureC ? parseFloat(captureForm.temperatureC) : undefined,
      soilCondition: captureForm.soilCondition || undefined,
      notes: captureForm.notes || undefined,
      nSubsamples: parseInt(captureForm.nSubsamples) || 1,
      photoBase64,
      photoMime,
      capturedAt: new Date().toISOString(),
    });
    await refreshLocalQueues(activeCampaign.id);
    setLocalCaptured(prev => ({ ...prev, [pointId]: val }));
    setCaptureForm(EMPTY_FORM);
    setExpandedPoint(null);
    toast({ title: "Guardado localmente", description: "Se sincronizará cuando haya conexión" });
  };

  const handleCapture = (pointId: string) => {
    if (isOnline) {
      captureOnline.mutate({ pointId });
    } else {
      captureOffline(pointId);
    }
  };

  const handleSync = async () => {
    if (!activeCampaign) return;
    setSyncing(true);
    try {
      const { synced, failed, discarded, syncedPointIds } = await syncPendingReadings(activeCampaign.id);
      await refreshLocalQueues(activeCampaign.id);
      if (syncedPointIds.length > 0) {
        setLocalCaptured(prev => {
          const next = { ...prev };
          syncedPointIds.forEach(pid => delete next[pid]);
          return next;
        });
        refetchPoints();
        qc.invalidateQueries({ queryKey: ["sampling-campaigns", id] });
      }
      if (synced > 0) toast({ title: "Sincronización exitosa", description: `${synced} lectura(s) enviada(s)` });
      if (failed > 0) toast({ title: "Errores", description: `${failed} lectura(s) no sincronizadas`, variant: "destructive" });
      if (discarded > 0) {
        toast({
          title: "Lecturas no sincronizables",
          description: `${discarded} lectura(s) corresponden a puntos que ya no existen. Revísalas en la bandeja.`,
          variant: "destructive",
        });
        setShowDiscardedTray(true);
      }
      if (synced === 0 && failed === 0 && discarded === 0) toast({ title: "Sin pendientes", description: "Todo está sincronizado" });
    } catch {
      toast({ title: "Error de sincronización", variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  const centerLat = parcel ? parseFloat(parcel.latitude) : null;
  const centerLng = parcel ? parseFloat(parcel.longitude) : null;
  const mapCenter: [number, number] = gpsPosition ?? (centerLat && centerLng ? [centerLat, centerLng] : [19.43, -99.13]);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto p-4 space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setLocation(`/parcel/${id}/sampling/design`)} data-testid="btn-back">
            <ArrowLeft className="w-4 h-4 mr-1" /> Diseño
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold truncate">Captura en Campo</h1>
            <p className="text-xs text-muted-foreground truncate">
              {parcel?.name} · {activeCampaign?.name || "Sin campaña activa"}
            </p>
          </div>
          <div className="shrink-0">
            {isOnline ? (
              <Badge variant="outline" className="gap-1 border-green-300 text-green-700 bg-green-50 text-xs" data-testid="badge-online">
                <Wifi className="w-3 h-3" /> En línea
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 border-red-300 text-red-700 bg-red-50 text-xs" data-testid="badge-offline">
                <WifiOff className="w-3 h-3" /> Sin conexión
              </Badge>
            )}
          </div>
        </div>

        {pendingCount > 0 && (
          <div className="flex items-center justify-between p-3 rounded-lg bg-amber-50 border border-amber-200" data-testid="banner-pending-sync">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <p className="text-sm text-amber-700">{pendingCount} lectura(s) pendiente(s)</p>
            </div>
            <Button size="sm" variant="outline" onClick={handleSync} disabled={!isOnline || syncing} data-testid="btn-sync">
              {syncing ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Upload className="w-3 h-3 mr-1" />}
              Sincronizar
            </Button>
          </div>
        )}

        {discardedReadings.length > 0 && (
          <div className="rounded-lg bg-red-50 border border-red-200" data-testid="banner-discarded-sync">
            <button
              type="button"
              className="w-full flex items-center justify-between p-3 text-left"
              onClick={() => setShowDiscardedTray(s => !s)}
              data-testid="btn-toggle-discarded-tray"
            >
              <div className="flex items-center gap-2">
                <XCircle className="w-4 h-4 text-red-600 shrink-0" />
                <p className="text-sm text-red-700">
                  {discardedReadings.length} lectura(s) no sincronizables
                </p>
              </div>
              {showDiscardedTray ? <ChevronUp className="w-4 h-4 text-red-700" /> : <ChevronDown className="w-4 h-4 text-red-700" />}
            </button>
            {showDiscardedTray && (
              <div className="border-t border-red-200 divide-y divide-red-100">
                {discardedReadings.map(r => (
                  <div key={r.id} className="p-3 flex items-start justify-between gap-3" data-testid={`discarded-reading-${r.id}`}>
                    <div className="text-xs text-red-800">
                      <p className="font-medium">Valor: {r.value}</p>
                      <p className="text-red-700/80">Punto: {r.pointId}</p>
                      <p className="text-red-700/80">Capturado: {new Date(r.capturedAt).toLocaleString()}</p>
                      {r.discardReason && <p className="mt-1 italic">{r.discardReason}</p>}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-700 hover:bg-red-100"
                      onClick={async () => {
                        await dismissDiscardedReading(r.id);
                        if (activeCampaign?.id) await refreshLocalQueues(activeCampaign.id);
                      }}
                      data-testid={`btn-dismiss-discarded-${r.id}`}
                    >
                      Descartar
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!activeCampaign ? (
          <Card data-testid="card-no-campaign">
            <CardContent className="py-12 text-center">
              <AlertCircle className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
              <p className="font-medium">No hay campaña activa</p>
              <p className="text-sm text-muted-foreground mb-4">Diseña una cuadrícula primero</p>
              <Button onClick={() => setLocation(`/parcel/${id}/sampling/design`)} data-testid="btn-go-design">
                Ir al Diseñador
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card data-testid="card-progress">
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium">Progreso: {completedCount}/{points.length} puntos</p>
                  <p className="text-sm font-bold text-primary">{progressPct}%</p>
                </div>
                <Progress value={progressPct} className="h-2" data-testid="progress-capture" />
                <p
                  className={`text-xs mt-1.5 font-medium ${completedCount >= 3 ? "text-green-600" : "text-amber-600"}`}
                  data-testid="label-min-points"
                >
                  {completedCount >= 3
                    ? `✓ ${completedCount} puntos medidos · listo para interpolar`
                    : `${completedCount} de ${points.length} medidos · mínimo 3 para interpolar (faltan ${3 - completedCount})`}
                </p>
                <div className="flex items-center gap-3 mt-2 flex-wrap">
                  {gpsPosition ? (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Navigation className="w-3 h-3 text-blue-500" />
                      GPS: {gpsPosition[0].toFixed(5)}, {gpsPosition[1].toFixed(5)}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs text-amber-600">
                      <Navigation className="w-3 h-3" />
                      {gpsError || "Obteniendo GPS..."}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="h-64 rounded-xl overflow-hidden border" data-testid="map-field-capture">
              <MapContainer
                center={mapCenter}
                zoom={16}
                style={{ height: "100%", width: "100%" }}
              >
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />
                {gpsPosition && (
                  <>
                    <MapCenterUser position={gpsPosition} />
                    <Marker position={gpsPosition} icon={userIcon}>
                      <LeafletTooltip permanent>Tú</LeafletTooltip>
                    </Marker>
                  </>
                )}
                {targetPointPos && <MapFocusPoint position={targetPointPos} />}
                {sortedPoints.map((pt: SamplingPoint, idx: number) => {
                  const isCompleted = isPointCompleted(pt);
                  const isOffline = localCaptured[pt.id] != null && pt.value == null;
                  const isAdaptive = (pt as SamplingPoint & { notes?: string }).notes?.includes("[ADAPTATIVO]") ?? false;
                  const lat = parseFloat(pt.latPlanned);
                  const lng = parseFloat(pt.lonPlanned);
                  const dist = gpsPosition
                    ? Math.round(haversineDistance(gpsPosition[0], gpsPosition[1], lat, lng))
                    : null;
                  return (
                    <CircleMarker
                      key={pt.id}
                      center={[lat, lng]}
                      radius={expandedPoint === pt.id ? 9 : 7}
                      pathOptions={
                        isCompleted && !isOffline
                          ? { color: "#16a34a", fillColor: "#86efac", fillOpacity: 0.85, weight: 2 }
                          : isOffline
                          ? { color: "#d97706", fillColor: "#fcd34d", fillOpacity: 0.85, weight: 2 }
                          : isAdaptive
                          ? { color: "#ea580c", fillColor: "#fb923c", fillOpacity: 0.9, weight: 2.5 }
                          : { color: "#7c3aed", fillColor: "#a78bfa", fillOpacity: 0.85, weight: 2 }
                      }
                      eventHandlers={{ click: () => setExpandedPoint(pt.id) }}
                      data-testid={`map-point-${idx}`}
                    >
                      <LeafletTooltip>
                        {isAdaptive ? "+ " : ""}Pto {pt.pointIndex}
                        {dist !== null ? ` · ${dist}m` : ""}
                        {isCompleted && !isOffline ? " ✓" : isOffline ? " ⏳offline" : isAdaptive ? " (adaptativo)" : ""}
                      </LeafletTooltip>
                    </CircleMarker>
                  );
                })}
              </MapContainer>
            </div>

            <div className="space-y-2" data-testid="list-points">
              {sortedPoints.map((pt: SamplingPoint) => {
                const isCompleted = isPointCompleted(pt);
                const isLocalOnly = localCaptured[pt.id] != null && pt.value == null;
                const displayValue = pt.value != null ? Number(pt.value) : localCaptured[pt.id];
                const lat = parseFloat(pt.latPlanned);
                const lng = parseFloat(pt.lonPlanned);
                const dist = gpsPosition
                  ? Math.round(haversineDistance(gpsPosition[0], gpsPosition[1], lat, lng))
                  : null;
                const isExpanded = expandedPoint === pt.id;
                const validation = getValueValidation(captureForm.value, activeCampaignDetail?.variable);
                const isAdaptivePt = (pt as SamplingPoint & { notes?: string }).notes?.includes("[ADAPTATIVO]") ?? false;

                return (
                  <Card
                    key={pt.id}
                    id={`capture-point-${pt.id}`}
                    className={`transition-all ${isExpanded ? (isAdaptivePt ? "border-orange-400 shadow-md" : "border-purple-400 shadow-md") : ""} ${isCompleted ? "opacity-70" : ""} ${pt.id === targetPointId ? (isAdaptivePt ? "ring-2 ring-orange-500" : "ring-2 ring-purple-500") : ""}`}
                    data-testid={`card-point-${pt.pointIndex}`}
                  >
                    <CardHeader
                      className="py-3 px-4 cursor-pointer"
                      onClick={() => {
                        if (isExpanded) {
                          setExpandedPoint(null);
                          setCaptureForm(EMPTY_FORM);
                        } else {
                          setExpandedPoint(pt.id);
                          // Pre-fill form with existing values for completed points so they can be corrected
                          if (isCompleted && displayValue != null) {
                            setCaptureForm({
                              ...EMPTY_FORM,
                              value: String(displayValue),
                              soilCondition: (pt as SamplingPoint & { soilCondition?: string }).soilCondition ?? "normal",
                              notes: (pt as SamplingPoint & { notes?: string }).notes ?? "",
                              temperatureC: (pt as SamplingPoint & { temperatureC?: number | null }).temperatureC != null
                                ? String((pt as SamplingPoint & { temperatureC?: number | null }).temperatureC)
                                : "",
                              nSubsamples: (pt as SamplingPoint & { nSubsamples?: number }).nSubsamples != null
                                ? String((pt as SamplingPoint & { nSubsamples?: number }).nSubsamples)
                                : "1",
                            });
                          } else {
                            setCaptureForm(EMPTY_FORM);
                          }
                        }
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                            isCompleted ? "bg-green-100 text-green-700" : isAdaptivePt ? "bg-orange-100 text-orange-700" : "bg-purple-100 text-purple-700"
                          }`}
                        >
                          {isCompleted ? <CheckCircle2 className="w-4 h-4" /> : isAdaptivePt ? "+" : pt.pointIndex}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">Punto {pt.pointIndex}</p>
                          <p className="text-xs text-muted-foreground">
                            {lat.toFixed(5)}, {lng.toFixed(5)}
                            {dist !== null && (
                              <span className="ml-2 text-blue-600 font-medium">
                                {dist < 1000 ? `${dist}m` : `${(dist / 1000).toFixed(1)}km`}
                              </span>
                            )}
                            {isCompleted && displayValue != null && (
                              <span className="ml-2 text-green-600">
                                = {Number(displayValue).toFixed(2)}
                                {isLocalOnly && <span className="ml-1 text-amber-600">(offline)</span>}
                              </span>
                            )}
                          </p>
                          {isAdaptivePt && !isCompleted && (
                            <p className="text-[10px] text-orange-600 mt-0.5">Alta incertidumbre en esta zona</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {isCompleted ? (
                            <Badge variant="outline" className={`text-xs ${isLocalOnly ? "border-amber-300 text-amber-700 bg-amber-50" : "border-green-300 text-green-700 bg-green-50"}`}>
                              <CheckCircle2 className="w-3 h-3 mr-1" /> {isLocalOnly ? "Offline" : "Listo"}
                            </Badge>
                          ) : isAdaptivePt ? (
                            <Badge variant="outline" className="border-orange-300 text-orange-700 bg-orange-50 text-xs" data-testid={`badge-adaptive-${pt.pointIndex}`}>
                              + Adaptativo
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50 text-xs">
                              <Clock className="w-3 h-3 mr-1" /> Pendiente
                            </Badge>
                          )}
                          {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                        </div>
                      </div>
                    </CardHeader>

                    {isExpanded && (
                      <CardContent className="pt-0 pb-4 px-4 border-t space-y-3 mt-2">
                        {isCompleted && (
                          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 flex items-center gap-1" data-testid={`edit-mode-banner-${pt.pointIndex}`}>
                            <AlertCircle className="w-3 h-3 shrink-0" /> Editando valor ya capturado — el nuevo valor sobreescribirá el anterior.
                          </p>
                        )}
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label htmlFor={`value-${pt.id}`} className="text-xs font-medium">
                              Valor medido *
                            </Label>
                            <Input
                              id={`value-${pt.id}`}
                              type="number"
                              step="0.01"
                              placeholder="Ej: 6.8"
                              value={captureForm.value}
                              onChange={(e) => setCaptureForm({ ...captureForm, value: e.target.value })}
                              className={
                                validation.status === "absolute_error" ? "border-red-400 focus-visible:ring-red-400" :
                                validation.status === "optimal_warn" ? "border-amber-400 focus-visible:ring-amber-400" : ""
                              }
                              data-testid={`input-value-${pt.pointIndex}`}
                            />
                            {validation.status === "absolute_error" && captureForm.value && (
                              <p className="text-xs text-red-600 flex items-center gap-1" data-testid={`validation-error-${pt.pointIndex}`}>
                                <AlertCircle className="w-3 h-3" /> {validation.message}
                              </p>
                            )}
                            {validation.status === "optimal_warn" && captureForm.value && (
                              <p className="text-xs text-amber-600 flex items-center gap-1" data-testid={`validation-warn-${pt.pointIndex}`}>
                                <AlertCircle className="w-3 h-3" /> {validation.message}
                              </p>
                            )}
                            {validation.status === "ok" && captureForm.value && (
                              <p className="text-xs text-green-600 flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" /> Dentro del rango óptimo
                              </p>
                            )}
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor={`temp-${pt.id}`} className="text-xs font-medium">
                              Temp. suelo (°C)
                            </Label>
                            <Input
                              id={`temp-${pt.id}`}
                              type="number"
                              step="0.1"
                              placeholder="Ej: 22.5"
                              value={captureForm.temperatureC}
                              onChange={(e) => setCaptureForm({ ...captureForm, temperatureC: e.target.value })}
                              data-testid={`input-temp-${pt.pointIndex}`}
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs font-medium">Condición del suelo</Label>
                            <Select
                              value={captureForm.soilCondition}
                              onValueChange={(v) => setCaptureForm({ ...captureForm, soilCondition: v })}
                            >
                              <SelectTrigger data-testid={`select-condition-${pt.pointIndex}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {SOIL_CONDITIONS.map((c) => (
                                  <SelectItem key={c} value={c}>
                                    {c.charAt(0).toUpperCase() + c.slice(1)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor={`subs-${pt.id}`} className="text-xs font-medium">
                              Submuestras
                            </Label>
                            <Input
                              id={`subs-${pt.id}`}
                              type="number"
                              min="1"
                              max="20"
                              value={captureForm.nSubsamples}
                              onChange={(e) => setCaptureForm({ ...captureForm, nSubsamples: e.target.value })}
                              data-testid={`input-subsamples-${pt.pointIndex}`}
                            />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`notes-${pt.id}`} className="text-xs font-medium">
                            Observaciones
                          </Label>
                          <Textarea
                            id={`notes-${pt.id}`}
                            placeholder="Observaciones opcionales..."
                            value={captureForm.notes}
                            onChange={(e) => setCaptureForm({ ...captureForm, notes: e.target.value })}
                            rows={2}
                            data-testid={`input-notes-${pt.pointIndex}`}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-medium flex items-center gap-1">
                            <Camera className="w-3 h-3" /> Foto del punto (opcional)
                          </Label>
                          <input
                            ref={photoInputRef}
                            type="file"
                            accept="image/*"
                            capture="environment"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0] ?? null;
                              setCaptureForm({ ...captureForm, photoFile: file });
                            }}
                            data-testid={`input-photo-${pt.pointIndex}`}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="w-full text-xs"
                            onClick={() => photoInputRef.current?.click()}
                            data-testid={`btn-photo-${pt.pointIndex}`}
                          >
                            <Camera className="w-3 h-3 mr-1.5" />
                            {captureForm.photoFile ? captureForm.photoFile.name : "Seleccionar foto"}
                          </Button>
                        </div>
                        <Button
                          className="w-full"
                          onClick={() => handleCapture(pt.id)}
                          disabled={captureOnline.isPending || !captureForm.value}
                          data-testid={`btn-capture-${pt.pointIndex}`}
                        >
                          {captureOnline.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          ) : (
                            <MapPin className="w-4 h-4 mr-2" />
                          )}
                          {isCompleted
                            ? "Actualizar lectura"
                            : isOnline ? "Guardar Lectura" : "Guardar Offline"}
                        </Button>
                      </CardContent>
                    )}
                  </Card>
                );
              })}
            </div>

            {/* Export adaptive pending GPS coords as CSV */}
            {sortedPoints.some(pt => (pt as SamplingPoint & { notes?: string }).notes?.includes("[ADAPTATIVO]") && pt.value == null) && (
              <div className="flex items-center justify-between bg-orange-50 border border-orange-200 rounded-lg px-3 py-2" data-testid="adaptive-export-bar">
                <p className="text-[11px] text-orange-700">
                  {sortedPoints.filter(pt => (pt as SamplingPoint & { notes?: string }).notes?.includes("[ADAPTATIVO]") && pt.value == null).length} puntos adaptativos pendientes
                </p>
                <button
                  className="flex items-center gap-1.5 text-[11px] text-orange-700 font-medium hover:text-orange-900 underline"
                  onClick={() => {
                    const adaptivePending = sortedPoints.filter(pt =>
                      (pt as SamplingPoint & { notes?: string }).notes?.includes("[ADAPTATIVO]") && pt.value == null
                    );
                    const lines = ["No,Latitud,Longitud,Razon"];
                    adaptivePending.forEach((pt, i) => {
                      lines.push(`${i + 1},${parseFloat(pt.latPlanned).toFixed(7)},${parseFloat(pt.lonPlanned).toFixed(7)},Alta incertidumbre LOOCV`);
                    });
                    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url; a.download = "puntos_adaptativos_pendientes.csv"; a.click();
                    URL.revokeObjectURL(url);
                  }}
                  data-testid="btn-export-adaptive-pending-csv"
                >
                  <Download className="w-3.5 h-3.5" /> Exportar GPS
                </button>
              </div>
            )}

            {completedCount === points.length && points.length > 0 && (
              <Card className="border-green-300 bg-green-50" data-testid="card-complete">
                <CardContent className="py-6 text-center">
                  <CheckCircle2 className="w-12 h-12 mx-auto text-green-600 mb-3" />
                  <p className="font-semibold text-green-800 mb-1">¡Captura completada!</p>
                  <p className="text-sm text-green-700 mb-4">
                    Todos los puntos registrados. Ahora puedes interpolar.
                  </p>
                  <Button
                    onClick={() => setLocation(`/parcel/${id}/sampling/maps`)}
                    data-testid="btn-go-interpolation"
                  >
                    Ir a Interpolación
                  </Button>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      {/* Agronomic range warning dialog */}
      <AlertDialog open={!!agronomicWarning} onOpenChange={() => setAgronomicWarning(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-amber-500" /> Valor fuera de rango agronómico
            </AlertDialogTitle>
            <AlertDialogDescription>
              {agronomicWarning?.message}. ¿Deseas guardar el valor de todas formas?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="btn-cancel-force">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (agronomicWarning) {
                  captureOnline.mutate({ pointId: agronomicWarning.pointId, force: true });
                }
              }}
              data-testid="btn-confirm-force"
            >
              Guardar de todas formas
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ArrowLeft, Bot, ChevronDown, ChevronUp, ChevronRight, Grid3X3, Loader2, MapPin, Play,
  CheckCircle2, AlertCircle, FlaskConical, Calculator, Trash2, Upload, Download,
  FileText, XCircle, MousePointerClick, FileSpreadsheet,
} from "lucide-react";
import * as XLSX from "xlsx";
import LabImportPanel from "@/components/lab-import-panel";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n-context";
import {
  MapContainer, TileLayer, Polygon,
  Marker, Popup, useMap, useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { SamplingCampaign, SamplingPoint, MasterVariable } from "@shared/schema";
import { computeSampleSize, fetchSampleSize } from "@shared/sample-size";
import { getVariablePrior } from "@shared/variable-priors";
import { detectInvertedOrientation } from "@shared/polygon-utils";

type CampaignWithVariable = SamplingCampaign & { variable?: MasterVariable };

const EMPTY_CAMPAIGNS: SamplingCampaign[] = [];
const EMPTY_POINTS: SamplingPoint[] = [];

function FitBounds({ coords }: { coords: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (coords && coords.length > 0) {
      map.fitBounds(coords as [[number, number], [number, number]], { padding: [40, 40] });
    }
  }, [map, coords]);
  return null;
}

function calcCochran(area: number): number {
  return computeSampleSize({ areaHa: area }).cochran.n;
}

function calcFAO(area: number): number {
  return computeSampleSize({ areaHa: area }).fao.n;
}

function calcCressieWikle(area: number): number {
  return computeSampleSize({ areaHa: area }).spatial.n;
}

function pipLatLng(lat: number, lng: number, poly: [number, number][]): boolean {
  let inside = false;
  const n = poly.length;
  let j = n - 1;
  for (let i = 0; i < n; i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    j = i;
  }
  return inside;
}

const GRID_TYPES = [
  { value: "regular", label: "Regular (cuadrícula)", description: "Puntos en rejilla uniforme" },
  { value: "hexagonal", label: "Hexagonal", description: "Mayor cobertura con menos puntos" },
  { value: "stratified", label: "Estratificado (LHS)", description: "Distribución aleatoria estratificada" },
  { value: "manual", label: "Manual", description: "Haz clic en el mapa para colocar puntos" },
];

function makePointIcon(index: number, hasValue: boolean, locked = false): L.DivIcon {
  const bg = hasValue ? "#16a34a" : "#7c3aed";
  const cursor = locked ? "not-allowed" : "grab";
  const opacity = locked ? "0.7" : "1";
  return L.divIcon({
    className: "",
    html: `<div style="width:24px;height:24px;border-radius:50%;background:${bg};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:white;cursor:${cursor};opacity:${opacity};">${index}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function MapClickHandler({
  active,
  polygon,
  onMapClick,
}: {
  active: boolean;
  polygon: [number, number][];
  onMapClick: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click: (e) => {
      if (!active) return;
      const { lat, lng } = e.latlng;
      if (polygon.length >= 3 && !pipLatLng(lat, lng, polygon)) return;
      onMapClick(lat, lng);
    },
  });
  return null;
}

interface DraggableMarkerProps {
  point: SamplingPoint;
  onDragEnd: (id: string, lat: number, lng: number) => void;
  onDelete: (id: string) => void;
  isDragging: boolean;
}

function DraggableMarker({ point, onDragEnd, onDelete, isDragging }: DraggableMarkerProps) {
  const markerRef = useRef<L.Marker | null>(null);
  const locked = point.value != null;
  const icon = useMemo(
    () => makePointIcon(point.pointIndex, locked, locked),
    [point.pointIndex, locked],
  );

  return (
    <Marker
      position={[parseFloat(point.latPlanned), parseFloat(point.lonPlanned)]}
      draggable={!locked}
      icon={icon}
      ref={markerRef}
      eventHandlers={{
        dragend: () => {
          if (locked) return;
          const m = markerRef.current;
          if (m) {
            const { lat, lng } = m.getLatLng();
            onDragEnd(point.id, lat, lng);
          }
        },
      }}
    >
      <Popup>
        <div className="text-sm space-y-1.5 min-w-[140px]">
          <p className="font-semibold">Punto {point.pointIndex}</p>
          <p className="text-xs text-gray-500">
            {parseFloat(point.latPlanned).toFixed(5)}, {parseFloat(point.lonPlanned).toFixed(5)}
          </p>
          {locked ? (
            <p className="text-xs text-green-700 font-medium">Valor capturado: {point.value}</p>
          ) : (
            <p className="text-[10px] text-gray-400">Arrastra para mover el punto</p>
          )}
          <button
            onClick={() => onDelete(point.id)}
            disabled={isDragging}
            className="flex items-center gap-1 text-xs text-red-600 hover:text-red-800 mt-1 disabled:opacity-50"
            data-testid={`btn-delete-point-${point.pointIndex}`}
          >
            <Trash2 className="w-3 h-3" /> Eliminar punto
          </button>
        </div>
      </Popup>
    </Marker>
  );
}

interface CsvRow {
  punto: string;
  lat: string;
  lon: string;
  valor: string;
  notas: string;
  status: "ok" | "error" | "no_value" | "out_of_bounds";
  error?: string;
}

function parseCSVText(text: string, polygon: [number, number][] = []): CsvRow[] {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return [];

  const sep = lines[0].includes(";") ? ";" : ",";
  const raw = lines.map(l => l.split(sep).map(c => c.trim().replace(/^["']|["']$/g, "")));

  const header = raw[0].map(h => h.toLowerCase().replace(/\s+/g, "_"));
  const latCol = header.findIndex(h => ["lat", "latitud", "latitude", "lat_planned"].includes(h));
  const lonCol = header.findIndex(h => ["lon", "lng", "longitud", "longitude", "lon_planned"].includes(h));
  const valCol = header.findIndex(h => ["valor", "value", "val", "resultado", "result"].includes(h));
  const ptCol = header.findIndex(h => ["punto", "point", "id", "n", "num", "numero", "number"].includes(h));
  const notesCol = header.findIndex(h => ["notas", "notes", "observaciones", "obs"].includes(h));

  if (latCol < 0 || lonCol < 0) return [];

  return raw.slice(1).map((cols, i) => {
    const lat = cols[latCol] ?? "";
    const lon = cols[lonCol] ?? "";
    const valor = valCol >= 0 ? (cols[valCol] ?? "") : "";
    const notas = notesCol >= 0 ? (cols[notesCol] ?? "") : "";
    const punto = ptCol >= 0 ? (cols[ptCol] ?? String(i + 1)) : String(i + 1);

    const latN = parseFloat(lat);
    const lonN = parseFloat(lon);

    if (isNaN(latN) || isNaN(lonN) || latN < -90 || latN > 90 || lonN < -180 || lonN > 180) {
      return { punto, lat, lon, valor, notas, status: "error", error: "Coordenadas inválidas" };
    }
    if (polygon.length >= 3 && !pipLatLng(latN, lonN, polygon)) {
      return { punto, lat, lon, valor, notas, status: "out_of_bounds", error: "Fuera del polígono" };
    }
    if (valor && isNaN(parseFloat(valor))) {
      return { punto, lat, lon, valor, notas, status: "error", error: "Valor no numérico" };
    }
    return { punto, lat, lon, valor, notas, status: valor ? "ok" : "no_value" };
  });
}

export default function ParcelSamplingDesign() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useI18n();
  const qc = useQueryClient();

  const [variableId, setVariableId] = useState("");
  const [gridType, setGridType] = useState("regular");
  const [nPoints, setNPoints] = useState("25");
  const [samplingDepth, setSamplingDepth] = useState("20");
  const [notes, setNotes] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [generatingGrid, setGeneratingGrid] = useState(false);
  const [activeCampaign, setActiveCampaign] = useState<CampaignWithVariable | null>(null);
  const [localGridType, setLocalGridType] = useState("regular");
  const [localNPoints, setLocalNPoints] = useState("25");

  const [bufferM, setBufferM] = useState(5);

  const [addingPoint, setAddingPoint] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);
  const [gridPaddingNotice, setGridPaddingNotice] = useState<{ paddedCount: number; gridCount: number } | null>(null);
  const [bufferAreaRatio, setBufferAreaRatio] = useState<number | null>(null);
  const [bufferPolygon, setBufferPolygon] = useState<[number, number][] | null>(null);

  const [campaignMode, setCampaignMode] = useState<"field" | "office">("field");
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvPasteText, setCsvPasteText] = useState("");
  const csvFileRef = useRef<HTMLInputElement | null>(null);

  const { data: parcel, isLoading: parcelLoading } = useQuery({
    queryKey: ["parcel-mvz", id],
    queryFn: async () => {
      const r = await fetch(`/api/parcels/${id}`, { credentials: "include" });
      if (!r.ok) throw new Error("Error");
      const data = await r.json();
      return data.parcel ?? data;
    },
  });

  const { data: variables = [] } = useQuery<MasterVariable[]>({
    queryKey: ["master-variables"],
    queryFn: async () => {
      const r = await fetch("/api/master-variables", { credentials: "include" });
      if (!r.ok) throw new Error("Error");
      return r.json();
    },
  });

  const { data: campaigns = EMPTY_CAMPAIGNS } = useQuery<SamplingCampaign[]>({
    queryKey: ["sampling-campaigns", id],
    queryFn: async () => {
      const r = await fetch(`/api/parcels/${id}/sampling-campaigns`, { credentials: "include" });
      if (!r.ok) throw new Error("Error");
      return r.json();
    },
    enabled: !!id,
  });

  const [generatingAI, setGeneratingAI] = useState(false);

  const generateAIInstructions = async () => {
    if (!activeCampaign) return;
    setGeneratingAI(true);
    try {
      const r = await fetch(`/api/sampling-campaigns/${activeCampaign.id}/ai-instructions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || "Error");
      setActiveCampaign(data.campaign);
      qc.invalidateQueries({ queryKey: ["sampling-campaigns", id] });
      toast({ title: "Instrucciones generadas", description: "IA ha preparado el protocolo de campo" });
    } catch (e: unknown) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" });
    } finally {
      setGeneratingAI(false);
    }
  };

  useEffect(() => {
    if (campaigns.length > 0) {
      const designing = campaigns.find((c: SamplingCampaign) => c.status === "designing");
      if (designing) {
        setActiveCampaign(prev => prev?.id === designing.id ? prev : designing);
      }
    }
  }, [campaigns]);

  useEffect(() => {
    if (activeCampaign) {
      setLocalGridType(activeCampaign.gridType ?? "regular");
      setLocalNPoints(String(activeCampaign.nPointsPlanned ?? 25));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCampaign?.id]);

  const area = parcel ? parseFloat(parcel.area || "10") : 10;
  const polygon: [number, number][] = Array.isArray(parcel?.polygonCoordinates) ? parcel.polygonCoordinates : [];

  const selectedVarCode = useMemo(() => {
    const v = variables.find((v: MasterVariable) => v.id === variableId);
    return v?.code ?? undefined;
  }, [variables, variableId]);

  // F1-03/F1-04: Use HTTP adapter to get canonical sample-size from Python geo-service.
  // Polygon coords in parcel.polygonCoordinates are [lat,lon] (Leaflet format);
  // fetchSampleSize expects [[lon, lat]].
  const geoPolygon: number[][] | undefined = polygon.length >= 3
    ? polygon.map(([lat, lon]) => [lon, lat])
    : undefined;

  const { data: backendSampleSize } = useQuery({
    queryKey: ["sample-size-canonical", geoPolygon, selectedVarCode],
    queryFn: () => fetchSampleSize({
      areaHa: area,
      polygon: geoPolygon!,
      variableCode: selectedVarCode,
    }),
    enabled: !!geoPolygon && geoPolygon.length >= 3,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const sampleSizeBreakdown = backendSampleSize ?? computeSampleSize({ areaHa: area, variableCode: selectedVarCode });
  const cochranN = sampleSizeBreakdown.cochran.n;
  const faoN = sampleSizeBreakdown.fao.n;
  const cwN = sampleSizeBreakdown.spatial.n;
  const recommendedN = sampleSizeBreakdown.recommended;
  const samplePrior = sampleSizeBreakdown.priorUsed ?? null;

  const createCampaignMutation = useMutation({
    mutationFn: async () => {
      if (!variableId) throw new Error("Selecciona una variable");
      const selectedVar = variables.find((v: MasterVariable) => v.id === variableId);
      const r = await fetch(`/api/parcels/${id}/sampling-campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          variableId,
          name: `Campaña ${selectedVar?.name || "MVZ"} — ${new Date().toLocaleDateString("es-MX")}`,
          gridType,
          nPointsPlanned: parseInt(nPoints),
          samplingDepth,
          notes,
        }),
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.message || "Error al crear campaña");
      }
      return r.json();
    },
    onSuccess: (campaign) => {
      qc.invalidateQueries({ queryKey: ["sampling-campaigns", id] });
      setActiveCampaign(campaign);
      const isManual = gridType === "manual";
      toast({
        title: "Campaña creada",
        description: isManual
          ? "Haz clic en el mapa para colocar los puntos de muestreo"
          : "Ahora genera la cuadrícula de muestreo",
      });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const generateGrid = async () => {
    if (!activeCampaign || localGridType === "manual") return;
    setGeneratingGrid(true);
    setGridPaddingNotice(null); // clear any previous notice while loading
    try {
      const parsedN = parseInt(localNPoints, 10);
      const safeN = Number.isNaN(parsedN) || parsedN < 1 ? (activeCampaign.nPointsPlanned ?? 25) : parsedN;
      const typeChanged = localGridType !== (activeCampaign.gridType ?? "regular");
      const nChanged = safeN !== (activeCampaign.nPointsPlanned ?? 25);
      if (typeChanged || nChanged) {
        const patchR = await fetch(`/api/sampling-campaigns/${activeCampaign.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ gridType: localGridType, nPointsPlanned: safeN }),
        });
        if (!patchR.ok) throw new Error("Error al actualizar parámetros de la campaña");
        const patchedCampaign = await patchR.json();
        if (patchedCampaign?.id) setActiveCampaign(patchedCampaign);
      }
      const orientationWarning = detectInvertedOrientation(parcel?.polygonCoordinates);
      if (orientationWarning) {
        throw new Error(orientationWarning);
      }
      const callGenerate = async (force: boolean) =>
        fetch(`/api/sampling-campaigns/${activeCampaign.id}/generate-grid`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ force, buffer_m: bufferM }),
        });

      let r = await callGenerate(false);
      let data = await r.json();

      // The server returns 409 when there are already-captured values to protect.
      if (r.status === 409 && data?.code === "HAS_CAPTURED_DATA") {
        const ok = window.confirm(
          `Esta campaña tiene ${data.capturedCount} punto(s) con valores ya capturados. ` +
          `Si regeneras la cuadrícula, esos datos se perderán. ¿Continuar?`,
        );
        if (!ok) {
          toast({ title: "Cancelado", description: "Se conservaron los puntos existentes." });
          return;
        }
        r = await callGenerate(true);
        data = await r.json();
      }

      if (!r.ok) throw new Error(data?.message || "Error al generar cuadrícula");
      await qc.invalidateQueries({ queryKey: ["sampling-campaigns", id] });
      await qc.invalidateQueries({ queryKey: ["sampling-points", activeCampaign.id] });
      if (data.campaign) setActiveCampaign(data.campaign);

      const created: number = data.pointsCreated ?? 0;
      const paddedCount: number = data.paddedCount ?? 0;
      const gridCount: number = data.gridCount ?? created;

      // Clear or set the in-page padding notice so users always see current state.
      if (data.usedPadding && paddedCount > 0) {
        setGridPaddingNotice({ paddedCount, gridCount });
      } else {
        setGridPaddingNotice(null);
      }

      // F1-01: Extract buffer metadata for area-ratio warning and dashed polygon overlay.
      const bm = data.bufferMeta ?? null;
      if (bm && !bm.buffer_skipped && Array.isArray(bm.polygon_buffered) && bm.polygon_buffered.length >= 3) {
        // polygon_buffered is [[lon, lat], ...] — convert to [[lat, lon]] for Leaflet
        setBufferPolygon(bm.polygon_buffered.map(([lon, lat]: number[]) => [lat, lon] as [number, number]));
      } else {
        setBufferPolygon(null);
      }
      setBufferAreaRatio(bm?.area_ratio ?? null);

      // Keep the local N-points field in sync with what was actually generated
      // so the next "Regenerar" doesn't silently use a stale value.
      if (created !== safeN) {
        setLocalNPoints(String(created));
      }

      if (data.fallback) {
        toast({
          title: "Cuadrícula generada (modo fallback)",
          description: `${created} puntos creados con el generador local porque el geo-servicio no estuvo disponible. ${data.fallbackReason ?? ""}`,
        });
      } else {
        toast({ title: "Cuadrícula generada", description: `${created} puntos creados en el mapa` });
      }
    } catch (e: unknown) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" });
    } finally {
      setGeneratingGrid(false);
    }
  };

  const { data: points = EMPTY_POINTS } = useQuery<SamplingPoint[]>({
    queryKey: ["sampling-points", activeCampaign?.id],
    queryFn: async () => {
      const r = await fetch(`/api/sampling-campaigns/${activeCampaign!.id}/points`, { credentials: "include" });
      if (!r.ok) throw new Error("Error");
      return r.json();
    },
    enabled: !!activeCampaign?.id,
  });

  const { data: designData } = useQuery({
    queryKey: ["design-grid", activeCampaign?.id, selectedVarCode],
    queryFn: async () => {
      const r = await fetch(`/api/sampling-campaigns/${activeCampaign!.id}/design-grid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ variabilityPct: 35, allowableError: 15, confidenceLevel: 90, variable_code: selectedVarCode ?? null }),
      });
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!activeCampaign?.id,
  });

  const gridPoints = useMemo(
    () => points.map((p: SamplingPoint) => [parseFloat(p.latPlanned), parseFloat(p.lonPlanned)] as [number, number]),
    [points],
  );

  const isManualMode = localGridType === "manual";

  const addManualPoint = useCallback(async (lat: number, lng: number) => {
    if (!activeCampaign || addingPoint) return;
    const maxIdx = points.reduce((acc, p) => Math.max(acc, p.pointIndex), 0);
    setAddingPoint(true);
    try {
      const r = await fetch(`/api/sampling-campaigns/${activeCampaign.id}/points/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          points: [{ latPlanned: lat, lonPlanned: lng, pointIndex: maxIdx + 1 }],
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message ?? "Error al añadir punto");
      qc.invalidateQueries({ queryKey: ["sampling-points", activeCampaign.id] });
    } catch (e: unknown) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" });
    } finally {
      setAddingPoint(false);
    }
  }, [activeCampaign, addingPoint, points, qc, toast]);

  const updatePointPosition = useCallback(async (pointId: string, lat: number, lng: number) => {
    setDraggingId(pointId);
    try {
      const r = await fetch(`/api/sampling-points/${pointId}/planned-coords`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ latPlanned: lat, lonPlanned: lng }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.message || "Error al mover punto");
      }
      qc.invalidateQueries({ queryKey: ["sampling-points", activeCampaign?.id] });
    } catch (e: unknown) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" });
    } finally {
      setDraggingId(null);
    }
  }, [activeCampaign?.id, qc, toast]);

  const deletePoint = useCallback(async (pointId: string) => {
    try {
      const r = await fetch(`/api/sampling-points/${pointId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) throw new Error("Error al eliminar punto");
      qc.invalidateQueries({ queryKey: ["sampling-points", activeCampaign?.id] });
    } catch (e: unknown) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" });
    }
  }, [activeCampaign?.id, qc, toast]);

  const clearAllPoints = async () => {
    if (!activeCampaign || points.length === 0) return;
    setClearingAll(true);
    try {
      // Single atomic call instead of N parallel DELETEs (which can leave the
      // campaign in a half-deleted state if some fail).
      const callDelete = async (force: boolean) =>
        fetch(`/api/sampling-campaigns/${activeCampaign.id}/points`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ force }),
        });

      let r = await callDelete(false);
      let data = await r.json().catch(() => ({}));
      if (r.status === 409 && data?.code === "HAS_CAPTURED_DATA") {
        const ok = window.confirm(
          `Hay ${data.capturedCount} punto(s) con valores capturados. ¿Eliminarlos de todas formas?`,
        );
        if (!ok) {
          toast({ title: "Cancelado", description: "Se conservaron los puntos." });
          return;
        }
        r = await callDelete(true);
        data = await r.json().catch(() => ({}));
      }
      if (!r.ok) throw new Error(data?.message || "No se pudieron eliminar los puntos");
      qc.invalidateQueries({ queryKey: ["sampling-points", activeCampaign.id] });
      toast({ title: "Puntos eliminados", description: `Se eliminaron ${data.deleted ?? points.length} punto(s).` });
    } catch (e: unknown) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" });
    } finally {
      setClearingAll(false);
    }
  };

  const confirmGrid = async () => {
    if (!activeCampaign) return;
    try {
      const r = await fetch(`/api/sampling-campaigns/${activeCampaign.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: "active", startedAt: new Date() }),
      });
      if (!r.ok) throw new Error("Error al confirmar");
      toast({ title: "Campaña activa", description: "Dirígete a campo para capturar los datos" });
      // Pass the campaign ID so field-capture lands on the correct campaign
      // even when multiple active campaigns exist for the same parcel.
      setLocation(`/parcel/${id}/sampling/capture?campaign=${activeCampaign.id}`);
    } catch (e: unknown) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" });
    }
  };

  const downloadTemplate = () => {
    const header = "punto,lat,lon,valor,notas";
    const rows = points.length > 0
      ? points.map(p => `${p.pointIndex},${parseFloat(p.latPlanned).toFixed(7)},${parseFloat(p.lonPlanned).toFixed(7)},,`)
      : ["1,,,,"]; 
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `plantilla_muestreo_${parcel?.name ?? id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadExcel = () => {
    if (points.length === 0) return;
    const campaignName = activeCampaign?.name ?? "Campaña";
    const varName = variables.find((v: MasterVariable) => v.id === activeCampaign?.variableId)?.name ?? "";
    const varUnit = variables.find((v: MasterVariable) => v.id === activeCampaign?.variableId)?.unit ?? "";

    const wsData = [
      ["Punto", "Latitud", "Longitud", `${varName}${varUnit ? ` (${varUnit})` : ""}`, "Notas", "Estado"],
      ...points.map(p => [
        p.pointIndex,
        parseFloat(p.latPlanned),
        parseFloat(p.lonPlanned),
        p.value ?? "",
        p.notes ?? "",
        p.value != null ? "Capturado" : "Pendiente",
      ]),
    ];

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"] = [
      { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 22 }, { wch: 12 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Puntos");

    const metaData = [
      ["Campaña", campaignName],
      ["Parcela", parcel?.name ?? ""],
      ["Variable", `${varName}${varUnit ? ` (${varUnit})` : ""}`],
      ["Total puntos", points.length],
      ["Capturados", points.filter(p => p.value != null).length],
      ["Pendientes", points.filter(p => p.value == null).length],
      ["Profundidad (cm)", activeCampaign?.samplingDepth ?? ""],
      ["Exportado", new Date().toLocaleDateString("es-MX")],
    ];
    const wsMeta = XLSX.utils.aoa_to_sheet(metaData);
    wsMeta["!cols"] = [{ wch: 18 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, wsMeta, "Info");

    const safeName = (parcel?.name ?? id ?? "muestreo").replace(/[^a-zA-Z0-9_\- ]/g, "_");
    XLSX.writeFile(wb, `puntos_muestreo_${safeName}.xlsx`);
  };

  const handleCSVFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseCSVText(text, polygon);
      setCsvRows(parsed);
      setCsvPasteText("");
    };
    reader.readAsText(file, "utf-8");
  };

  const handleCSVPaste = (text: string) => {
    setCsvPasteText(text);
    if (text.trim()) {
      const parsed = parseCSVText(text, polygon);
      setCsvRows(parsed);
    } else {
      setCsvRows([]);
    }
  };

  const importCSV = async () => {
    if (!activeCampaign || csvRows.length === 0) return;
    const validRows = csvRows.filter(r => r.status !== "error" && r.status !== "out_of_bounds");
    if (validRows.length === 0) {
      toast({ title: "Sin filas válidas", description: "Corrige los errores antes de importar", variant: "destructive" });
      return;
    }
    const orientationWarning = detectInvertedOrientation(parcel?.polygonCoordinates);
    if (orientationWarning) {
      toast({ title: "Polígono sospechoso", description: orientationWarning, variant: "destructive" });
      return;
    }
    setCsvImporting(true);
    try {
      const maxIdx = points.reduce((acc, p) => Math.max(acc, p.pointIndex), 0);
      const payload = validRows.map((row, i) => ({
        pointIndex: maxIdx + 1 + i,
        latPlanned: parseFloat(row.lat),
        lonPlanned: parseFloat(row.lon),
        value: row.valor ? parseFloat(row.valor) : null,
        notes: row.notas || null,
      }));

      const r = await fetch(`/api/sampling-campaigns/${activeCampaign.id}/points/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ points: payload }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message ?? "Error al importar");

      qc.invalidateQueries({ queryKey: ["sampling-points", activeCampaign.id] });

      const allHaveValues = validRows.every(row => !!row.valor && !isNaN(parseFloat(row.valor)));
      if (allHaveValues) {
        const patchR = await fetch(`/api/sampling-campaigns/${activeCampaign.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ status: "completed", completedAt: new Date() }),
        });
        if (!patchR.ok) {
          const patchErr = await patchR.json().catch(() => ({}));
          throw new Error(patchErr.message ?? "Error al completar la campaña");
        }
        qc.invalidateQueries({ queryKey: ["sampling-campaigns", id] });
        toast({
          title: `${data.created} puntos importados con valores`,
          description: "Campaña completada. Puedes pasar directamente a interpolación.",
        });
        setCsvOpen(false);
        setCsvRows([]);
        setCsvPasteText("");
        setLocation(`/parcel/${id}/sampling/maps`);
        return;
      }

      toast({ title: `${data.created} puntos importados`, description: "Completa los valores en la captura de campo." });
      setCsvOpen(false);
      setCsvRows([]);
    } catch (e: unknown) {
      toast({ title: "Error al importar", description: (e as Error).message, variant: "destructive" });
    } finally {
      setCsvImporting(false);
    }
  };

  if (parcelLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!parcel) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">Parcela no encontrada</p>
      </div>
    );
  }

  const hasPolygon = polygon.length >= 3;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setLocation(`/parcel/${id}`)} data-testid="btn-back">
            <ArrowLeft className="w-4 h-4 mr-1" /> Volver
          </Button>
          <div>
            <h1 className="text-xl font-bold">Diseño de Muestreo</h1>
            <p className="text-sm text-muted-foreground">{parcel.name} · {parcel.crop} · {area} ha</p>
          </div>
        </div>

        {/* Mode toggle (only when no campaign in progress) */}
        {!activeCampaign && (
          <Card data-testid="card-campaign-mode">
            <CardContent className="p-3">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("labImport.mode.heading")}
              </Label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                <label
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${campaignMode === "field" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"}`}
                  data-testid="option-mode-field"
                >
                  <input
                    type="radio"
                    name="campaignMode"
                    value="field"
                    checked={campaignMode === "field"}
                    onChange={() => setCampaignMode("field")}
                    className="mt-1"
                  />
                  <div>
                    <p className="text-sm font-medium flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-primary" /> {t("labImport.mode.fieldTitle")}
                    </p>
                    <p className="text-xs text-muted-foreground">{t("labImport.mode.fieldDesc")}</p>
                  </div>
                </label>
                <label
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${campaignMode === "office" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"}`}
                  data-testid="option-mode-office"
                >
                  <input
                    type="radio"
                    name="campaignMode"
                    value="office"
                    checked={campaignMode === "office"}
                    onChange={() => setCampaignMode("office")}
                    className="mt-1"
                  />
                  <div>
                    <p className="text-sm font-medium flex items-center gap-1.5">
                      <FileSpreadsheet className="w-3.5 h-3.5 text-primary" /> {t("labImport.mode.officeTitle")}
                    </p>
                    <p className="text-xs text-muted-foreground">{t("labImport.mode.officeDesc")}</p>
                  </div>
                </label>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Office mode: lab importer */}
        {!activeCampaign && campaignMode === "office" && (
          <LabImportPanel parcel={parcel} />
        )}

        {/* Field mode: original step wizard + grid layout */}
        {(activeCampaign || campaignMode === "field") && (
        <>
        {/* Step wizard */}
        {(() => {
          const currentStep = !activeCampaign ? 1 : gridPoints.length === 0 ? 2 : 3;
          const steps = ["Configurar", "Generar", "Campo"];
          return (
            <div className="flex items-center gap-1 text-sm" data-testid="step-indicator">
              {steps.map((label, i) => {
                const step = i + 1;
                const active = step === currentStep;
                const done = step < currentStep;
                return (
                  <div key={step} className="flex items-center gap-1">
                    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full transition-colors ${active ? "bg-primary/10 text-primary font-semibold" : done ? "text-green-700" : "text-muted-foreground"}`} data-testid={`step-${step}`}>
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${active ? "bg-primary text-white" : done ? "bg-green-600 text-white" : "bg-muted text-muted-foreground"}`}>
                        {done ? "✓" : step}
                      </div>
                      {label}
                    </div>
                    {i < steps.length - 1 && <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />}
                  </div>
                );
              })}
            </div>
          );
        })()}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* LEFT PANEL */}
          <div className="lg:col-span-1 space-y-4">
            <Card data-testid="card-sample-size">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Calculator className="w-4 h-4 text-primary" /> Tamaño de Muestra Recomendado
                </CardTitle>
                <CardDescription>
                  {designData ? "Calculado por el servidor para esta campaña" : `Estimado para ${area.toFixed(1)} ha`}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-2 rounded-lg bg-blue-50 border border-blue-200">
                    <p className="text-xs text-blue-600 font-medium mb-1">Cochran</p>
                    <p className="text-2xl font-bold text-blue-700" data-testid="text-cochran-n">
                      {designData ? designData.cochran.n : cochranN}
                    </p>
                    <p className="text-[10px] text-blue-500">muestras</p>
                  </div>
                  <div className="p-2 rounded-lg bg-green-50 border border-green-200">
                    <p className="text-xs text-green-600 font-medium mb-1">FAO</p>
                    <p className="text-2xl font-bold text-green-700" data-testid="text-fao-n">
                      {designData ? designData.fao.n : faoN}
                    </p>
                    <p className="text-[10px] text-green-500">muestras</p>
                  </div>
                  <div className="p-2 rounded-lg bg-purple-50 border border-purple-200">
                    <p className="text-xs text-purple-600 font-medium mb-1">Espacial</p>
                    <p className="text-2xl font-bold text-purple-700" data-testid="text-cw-n">
                      {designData ? designData.spatial.n : cwN}
                    </p>
                    <p className="text-[10px] text-purple-500">muestras</p>
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-center">
                  <p className="text-xs text-amber-600 mb-1">
                    {designData ? "Recomendado por servidor" : "Promedio estimado"}
                  </p>
                  <p className="text-3xl font-bold text-amber-700" data-testid="text-recommended-n">
                    {designData ? designData.recommended : recommendedN}
                  </p>
                </div>
                {designData ? (
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p><strong>Cochran:</strong> {designData.cochran.formula}</p>
                    <p><strong>FAO:</strong> {designData.fao.formula}</p>
                    <p><strong>Espacial:</strong> {designData.spatial.formula}</p>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p><strong>Cochran:</strong> {sampleSizeBreakdown.cochran.formula}</p>
                    <p><strong>FAO/USDA:</strong> {sampleSizeBreakdown.fao.formula}</p>
                    <p><strong>Cressie-Wikle:</strong> {sampleSizeBreakdown.spatial.formula}</p>
                  </div>
                )}

                {/* Variable-specific justification panel */}
                {samplePrior && (
                  <div className="mt-2 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 space-y-1.5" data-testid="card-variable-prior">
                    <p className="text-xs font-semibold text-emerald-800 flex items-center gap-1.5">
                      <Calculator className="w-3.5 h-3.5" />
                      Justificación agronómica — {samplePrior.label}
                    </p>
                    <p className="text-[11px] text-emerald-700 leading-snug">{samplePrior.agronNote}</p>
                    <div className="flex flex-wrap gap-2 text-[10px]">
                      <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-mono">
                        CV típico: {samplePrior.typicalCvPct}%
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-mono">
                        Error permisible: {samplePrior.allowableErrorPct}%
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-mono">
                        Mín. recomendado: {samplePrior.minRecommendedPoints} pts
                      </span>
                      {samplePrior.transformHint !== "none" && samplePrior.transformHint !== "auto" && (
                        <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 font-mono">
                          Transform: {samplePrior.transformHint}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {!samplePrior && selectedVarCode && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Sin parámetros específicos para "{selectedVarCode}". Usando CV=30%, error=10%.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Campaign creation or management */}
            {!activeCampaign ? (
              <Card data-testid="card-campaign-create">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <FlaskConical className="w-4 h-4" /> Nueva Campaña
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="variable-select">Variable a Medir *</Label>
                    <Select value={variableId} onValueChange={setVariableId}>
                      <SelectTrigger id="variable-select" data-testid="select-variable">
                        <SelectValue placeholder="Seleccionar variable..." />
                      </SelectTrigger>
                      <SelectContent>
                        {variables.map((v: MasterVariable) => (
                          <SelectItem key={v.id} value={v.id} data-testid={`option-variable-${v.id}`}>
                            {v.name} ({v.unit})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Tipo de Cuadrícula</Label>
                    <div className="space-y-2">
                      {GRID_TYPES.map((g) => (
                        <label
                          key={g.value}
                          className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${gridType === g.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"}`}
                          data-testid={`option-grid-${g.value}`}
                        >
                          <input
                            type="radio"
                            name="gridType"
                            value={g.value}
                            checked={gridType === g.value}
                            onChange={() => setGridType(g.value)}
                            className="mt-0.5"
                          />
                          <div>
                            <p className="text-sm font-medium flex items-center gap-1.5">
                              {g.value === "manual" && <MousePointerClick className="w-3.5 h-3.5 text-primary" />}
                              {g.label}
                            </p>
                            <p className="text-xs text-muted-foreground">{g.description}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  {gridType !== "manual" && (
                    <div className="space-y-2">
                      <Label htmlFor="n-points">Número de Puntos</Label>
                      <Input id="n-points" type="number" min="5" max="200" value={nPoints} onChange={(e) => setNPoints(e.target.value)} data-testid="input-n-points" />
                      <p className="text-xs text-muted-foreground">Recomendado: {recommendedN}</p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="sampling-depth">Profundidad de Muestreo (cm)</Label>
                    <Input id="sampling-depth" type="number" min="5" max="100" value={samplingDepth} onChange={(e) => setSamplingDepth(e.target.value)} data-testid="input-sampling-depth" />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="notes">Notas</Label>
                    <Textarea id="notes" placeholder="Observaciones adicionales..." value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} data-testid="input-notes" />
                  </div>

                  {!hasPolygon && (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200">
                      <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                      <p className="text-xs text-amber-700">Esta parcela no tiene polígono. Es necesario para validar las coordenadas de muestreo.</p>
                    </div>
                  )}

                  <Button
                    className="w-full"
                    onClick={() => createCampaignMutation.mutate()}
                    disabled={createCampaignMutation.isPending || !variableId}
                    data-testid="btn-create-campaign"
                  >
                    {createCampaignMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Play className="w-4 h-4 mr-2" />}
                    Crear Campaña
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Card data-testid="card-campaign-actions">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Grid3X3 className="w-4 h-4 text-primary" />
                    {isManualMode
                      ? "Modo manual activo"
                      : points.length > 0 ? "Paso 2: Ajusta y Regenera" : "Paso 2: Genera la Cuadrícula"}
                  </CardTitle>
                  <CardDescription className="text-xs">{activeCampaign.name}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {!hasPolygon && (
                    <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-50 border border-amber-200">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" />
                      <p className="text-xs text-amber-700">Se requiere polígono para validar coordenadas.</p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label className="text-xs font-medium">Tipo de Cuadrícula</Label>
                    <div className="space-y-1.5">
                      {GRID_TYPES.map((g) => (
                        <label
                          key={g.value}
                          className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${localGridType === g.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"}`}
                          data-testid={`option-grid-${g.value}`}
                        >
                          <input
                            type="radio"
                            name="localGridType"
                            value={g.value}
                            checked={localGridType === g.value}
                            onChange={() => setLocalGridType(g.value)}
                            className="mt-0.5"
                          />
                          <div>
                            <p className="text-xs font-medium flex items-center gap-1">
                              {g.value === "manual" && <MousePointerClick className="w-3 h-3 text-primary" />}
                              {g.label}
                            </p>
                            <p className="text-[10px] text-muted-foreground">{g.description}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Auto grid controls (hidden in manual mode) */}
                  {!isManualMode && (
                    <>
                      <div className="space-y-1.5">
                        <Label htmlFor="local-n-points" className="text-xs font-medium">Número de Puntos</Label>
                        <Input id="local-n-points" type="number" min="5" max="200" value={localNPoints} onChange={(e) => setLocalNPoints(e.target.value)} data-testid="input-n-points-regen" />
                        <p className="text-[10px] text-muted-foreground">Recomendado: {recommendedN}</p>
                      </div>

                      {/* F1-01 Buffer interior slider */}
                      <div className="space-y-1.5" data-testid="control-buffer-m">
                        <Label className="text-xs font-medium flex items-center justify-between">
                          <span>Buffer interior</span>
                          <span className="font-mono text-primary">{bufferM} m</span>
                        </Label>
                        <input
                          type="range"
                          min={0}
                          max={20}
                          step={1}
                          value={bufferM}
                          onChange={(e) => setBufferM(Number(e.target.value))}
                          className="w-full accent-primary"
                          data-testid="slider-buffer-m"
                        />
                        <div className="flex justify-between text-[9px] text-muted-foreground font-mono -mt-0.5">
                          <span>0</span><span>3</span><span>5</span><span>8</span><span>10</span><span>20m</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground">Aleja los puntos del borde del lote. 5 m recomendado para evitar el efecto borde.</p>
                        {bufferAreaRatio !== null && bufferAreaRatio < 0.5 && (
                          <div className="flex gap-1.5 p-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800" data-testid="notice-buffer-area-ratio">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600" />
                            <span>El buffer de <strong>{bufferM} m</strong> reduce el área muestreable a <strong>{Math.round((bufferAreaRatio ?? 0) * 100)}%</strong> del lote. Considera reducir el buffer o revisar la forma del polígono.</span>
                          </div>
                        )}
                      </div>

                      <Button
                        variant={points.length > 0 ? "outline" : "default"}
                        className="w-full"
                        onClick={generateGrid}
                        disabled={generatingGrid || !hasPolygon}
                        data-testid="btn-generate-grid"
                      >
                        {generatingGrid ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Grid3X3 className="w-4 h-4 mr-2" />}
                        {points.length > 0 ? "Regenerar Cuadrícula" : "Generar Cuadrícula"}
                      </Button>

                      {/* In-page notice shown when padding was used to reach N */}
                      {gridPaddingNotice && (
                        <div className="flex gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800" data-testid="notice-grid-padding">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600" />
                          <span>
                            La forma del polígono solo admitió <strong>{gridPaddingNotice.gridCount}</strong> puntos en cuadrícula regular.
                            Se añadieron <strong>{gridPaddingNotice.paddedCount}</strong> puntos distribuidos aleatoriamente dentro del lote para completar la cantidad solicitada.
                          </span>
                        </div>
                      )}
                    </>
                  )}

                  {/* Manual mode controls */}
                  {isManualMode && (
                    <div className="space-y-2">
                      <div className="p-2.5 rounded-lg bg-primary/5 border border-primary/20 text-xs text-primary space-y-1">
                        <p className="font-medium flex items-center gap-1.5">
                          <MousePointerClick className="w-3.5 h-3.5" /> Modo edición activo
                        </p>
                        <p className="text-muted-foreground">Haz clic en el mapa para añadir puntos. Arrástralos para reposicionarlos. Haz clic sobre un punto para eliminarlo.</p>
                      </div>
                      {points.length > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full text-xs text-red-600 border-red-200 hover:bg-red-50"
                          onClick={clearAllPoints}
                          disabled={clearingAll}
                          data-testid="btn-clear-all-points"
                        >
                          {clearingAll ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Trash2 className="w-3 h-3 mr-1" />}
                          Limpiar todos los puntos ({points.length})
                        </Button>
                      )}
                    </div>
                  )}

                  {/* CSV Import button */}
                  <Button
                    variant="outline"
                    className="w-full text-xs gap-2"
                    onClick={() => setCsvOpen(true)}
                    data-testid="btn-open-csv-import"
                  >
                    <Upload className="w-3.5 h-3.5" /> Importar CSV con datos
                  </Button>

                  {/* Confirm / go to field */}
                  {points.length > 0 && (
                    <Button
                      className="w-full"
                      onClick={confirmGrid}
                      data-testid="btn-confirm-grid"
                    >
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      {isManualMode ? "Confirmar puntos e ir a Campo" : "Confirmar Malla e Ir a Campo"}
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* RIGHT PANEL */}
          <div className="lg:col-span-2 space-y-4">
            <Card data-testid="card-map">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <MapPin className="w-4 h-4" /> Mapa de Muestreo
                    {isManualMode && activeCampaign && (
                      <Badge variant="outline" className="text-primary border-primary/40 bg-primary/5 text-xs ml-1">
                        <MousePointerClick className="w-3 h-3 mr-1" /> Edición manual
                      </Badge>
                    )}
                    {!isManualMode && points.length > 0 && (
                      <Badge variant="outline" className="text-muted-foreground text-xs ml-1">
                        Arrastra para ajustar
                      </Badge>
                    )}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    {addingPoint && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> Añadiendo…
                      </span>
                    )}
                    {points.length > 0 && !addingPoint && (
                      <>
                        <span className="text-xs text-muted-foreground">{points.length} puntos</span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={downloadExcel}
                          className="h-7 text-xs gap-1.5 text-green-700 border-green-300 hover:bg-green-50"
                          data-testid="btn-download-excel"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="h-[420px] rounded-b-lg overflow-hidden" style={{ cursor: isManualMode && activeCampaign ? "crosshair" : "default" }}>
                  <MapContainer
                    center={[parseFloat(parcel.latitude), parseFloat(parcel.longitude)]}
                    zoom={15}
                    style={{ height: "100%", width: "100%" }}
                    data-testid="map-sampling"
                  >
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />

                    {hasPolygon && (
                      <>
                        <FitBounds coords={polygon} />
                        <Polygon positions={polygon} pathOptions={{ color: "#16a34a", weight: 2, fillOpacity: 0.1 }} />
                        {/* F1-01: Dashed inner polygon showing the effective sampling boundary after buffer */}
                        {bufferPolygon && bufferPolygon.length >= 3 && (
                          <Polygon
                            positions={bufferPolygon}
                            pathOptions={{ color: "#0ea5e9", weight: 1.5, fillOpacity: 0, dashArray: "5 5" }}
                            data-testid="polygon-buffer-inner"
                          />
                        )}
                      </>
                    )}

                    {/* Manual mode: click to add points */}
                    {isManualMode && activeCampaign && (
                      <MapClickHandler
                        active={!addingPoint}
                        polygon={polygon}
                        onMapClick={addManualPoint}
                      />
                    )}

                    {/* All points are draggable regardless of mode */}
                    {points.map((pt: SamplingPoint) => (
                      <DraggableMarker
                        key={pt.id}
                        point={pt}
                        onDragEnd={updatePointPosition}
                        onDelete={deletePoint}
                        isDragging={draggingId === pt.id}
                      />
                    ))}
                  </MapContainer>
                </div>
              </CardContent>
            </Card>

            {/* AI Instructions */}
            <Card data-testid="card-ai-instructions">
              <CardHeader className="pb-2 cursor-pointer" onClick={() => setAiOpen(!aiOpen)}>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Bot className="w-4 h-4 text-purple-600" /> Instrucciones de Campo (IA)
                  </CardTitle>
                  {aiOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </div>
              </CardHeader>
              {aiOpen && (
                <CardContent>
                  {!activeCampaign ? (
                    <p className="text-sm text-muted-foreground">Crea una campaña para generar instrucciones de campo personalizadas.</p>
                  ) : activeCampaign.aiInstructions ? (
                    <div className="space-y-3">
                      <div className="prose prose-sm max-w-none text-sm whitespace-pre-line" data-testid="text-ai-instructions">
                        {activeCampaign.aiInstructions}
                      </div>
                      <Button size="sm" variant="outline" onClick={generateAIInstructions} disabled={generatingAI} data-testid="btn-regenerate-ai" className="text-xs">
                        {generatingAI ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Bot className="w-3 h-3 mr-1" />}
                        Regenerar instrucciones
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="space-y-2 text-sm">
                        <p className="font-medium">Protocolo general de muestreo de suelo:</p>
                        <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
                          <li>Visita cada punto GPS marcado en el mapa con una precisión de ≤5m.</li>
                          <li>Limpia la superficie (elimina residuos y hojarasca del área de muestreo).</li>
                          <li>Extrae una muestra compuesta de la profundidad indicada ({activeCampaign.samplingDepth || 20} cm).</li>
                          <li>Registra el valor medido, temperatura del suelo y condición visual.</li>
                          <li>Etiqueta y guarda la muestra en bolsa con el número de punto.</li>
                          <li>Toma una foto del punto de muestreo antes de colectar.</li>
                        </ol>
                      </div>
                      <Button size="sm" onClick={generateAIInstructions} disabled={generatingAI} data-testid="btn-generate-ai">
                        {generatingAI ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Bot className="w-4 h-4 mr-2" />}
                        Generar instrucciones con IA
                      </Button>
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          </div>
        </div>
        </>
        )}
      </div>

      {/* CSV Import Dialog */}
      <Dialog open={csvOpen} onOpenChange={(open) => { setCsvOpen(open); if (!open) { setCsvRows([]); setCsvPasteText(""); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="w-4 h-4" /> Importar puntos desde CSV
            </DialogTitle>
            <DialogDescription>
              Sube un archivo CSV con coordenadas y, opcionalmente, los valores medidos. Si todos los puntos tienen valor, la campaña se marcará como completada.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Template download */}
            <div className="flex items-center gap-3 p-3 bg-muted/40 rounded-lg border">
              <FileText className="w-8 h-8 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Plantilla CSV</p>
                <p className="text-xs text-muted-foreground">
                  Descarga la plantilla con las columnas correctas.
                  {points.length > 0 && " Incluye los puntos actuales de la campaña."}
                </p>
                <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                  punto, lat, lon, valor, notas
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={downloadTemplate} data-testid="btn-download-template">
                <Download className="w-3.5 h-3.5 mr-1.5" /> Descargar
              </Button>
            </div>

            {/* File upload */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Seleccionar archivo CSV</Label>
              <div className="flex gap-2">
                <input
                  ref={csvFileRef}
                  type="file"
                  accept=".csv,.txt"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleCSVFile(file);
                  }}
                  data-testid="input-csv-file"
                />
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => csvFileRef.current?.click()}
                  data-testid="btn-select-csv"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  {csvRows.length > 0 && !csvPasteText ? `${csvRows.length} filas cargadas` : "Seleccionar archivo…"}
                </Button>
                {csvRows.length > 0 && (
                  <Button variant="ghost" size="icon" onClick={() => { setCsvRows([]); setCsvPasteText(""); if (csvFileRef.current) csvFileRef.current.value = ""; }}>
                    <XCircle className="w-4 h-4 text-muted-foreground" />
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Columnas requeridas: <code className="font-mono">lat</code> y <code className="font-mono">lon</code>. Columnas opcionales: <code className="font-mono">punto</code>, <code className="font-mono">valor</code>, <code className="font-mono">notas</code>. Separador: coma o punto y coma.
              </p>
            </div>

            {/* Paste textarea */}
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">O pega el texto CSV aquí</Label>
              <Textarea
                placeholder={"punto,lat,lon,valor,notas\n1,19.4326,-99.1332,6.8,"}
                value={csvPasteText}
                onChange={(e) => handleCSVPaste(e.target.value)}
                rows={4}
                className="font-mono text-xs resize-none"
                data-testid="input-csv-paste"
              />
            </div>

            {/* Preview */}
            {csvRows.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Vista previa</Label>
                  <div className="flex gap-2 text-xs flex-wrap justify-end">
                    <span className="text-green-700">
                      {csvRows.filter(r => r.status === "ok").length} con valor
                    </span>
                    <span className="text-amber-700">
                      {csvRows.filter(r => r.status === "no_value").length} sin valor
                    </span>
                    {csvRows.some(r => r.status === "out_of_bounds") && (
                      <span className="text-orange-600">
                        {csvRows.filter(r => r.status === "out_of_bounds").length} fuera del polígono
                      </span>
                    )}
                    {csvRows.some(r => r.status === "error") && (
                      <span className="text-red-600">
                        {csvRows.filter(r => r.status === "error").length} error(es)
                      </span>
                    )}
                  </div>
                </div>
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="text-xs">
                        <TableHead className="w-8">#</TableHead>
                        <TableHead>Lat</TableHead>
                        <TableHead>Lon</TableHead>
                        <TableHead>Valor</TableHead>
                        <TableHead>Estado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {csvRows.slice(0, 50).map((row, i) => (
                        <TableRow
                          key={i}
                          className={`text-xs ${row.status === "error" ? "bg-red-50" : row.status === "out_of_bounds" ? "bg-orange-50" : ""}`}
                          data-testid={`csv-row-${i}`}
                        >
                          <TableCell className="font-mono">{row.punto}</TableCell>
                          <TableCell className="font-mono">{row.lat}</TableCell>
                          <TableCell className="font-mono">{row.lon}</TableCell>
                          <TableCell className="font-mono">{row.valor || <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell>
                            {row.status === "ok" && <span className="text-green-700 flex items-center gap-0.5"><CheckCircle2 className="w-3 h-3" /> OK</span>}
                            {row.status === "no_value" && <span className="text-amber-600 flex items-center gap-0.5"><AlertCircle className="w-3 h-3" /> Sin valor</span>}
                            {row.status === "out_of_bounds" && <span className="text-orange-600 flex items-center gap-0.5"><XCircle className="w-3 h-3" /> Fuera del polígono</span>}
                            {row.status === "error" && <span className="text-red-600 flex items-center gap-0.5"><XCircle className="w-3 h-3" /> {row.error}</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {csvRows.length > 50 && (
                    <p className="text-xs text-muted-foreground px-3 py-2 border-t">
                      Mostrando 50 de {csvRows.length} filas. Todas se importarán.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setCsvOpen(false); setCsvRows([]); setCsvPasteText(""); }}>
              Cancelar
            </Button>
            <Button
              onClick={importCSV}
              disabled={csvImporting || csvRows.filter(r => r.status !== "error" && r.status !== "out_of_bounds").length === 0}
              data-testid="btn-confirm-csv-import"
            >
              {csvImporting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
              Importar {csvRows.filter(r => r.status !== "error" && r.status !== "out_of_bounds").length} puntos
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

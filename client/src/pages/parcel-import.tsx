import { useParams, useLocation, Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { ArrowLeft, Upload, Loader2, FileUp, MapPin, AlertTriangle, CheckCircle2, Layers, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";

import L from "leaflet";
import { MapContainer, TileLayer, Polygon as LPolygon, GeoJSON as LGeoJSON, CircleMarker, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { FeatureCollection, Feature, Geometry } from "geojson";
import type { ZoneImport } from "@shared/schema";
import type { ImportErrorBody } from "@/lib/import-zone-errors";
import { translateImportError } from "@/lib/import-zone-errors";

type ImportFormat = "kml" | "kmz" | "geojson" | "shapefile" | "csv";
type ImportMode = "polygons" | "voronoi" | "idw" | "samples" | "reference";

interface PreviewResp {
  format: ImportFormat;
  featureCount: number;
  geometryTypes: string[];
  warnings: string[];
  csvDetection?: { delimiter?: string; decimal?: string; columns?: string[] };
  featureCollection: FeatureCollection;
  originalFileName: string;
  parcelOutsideCount: number;
}

const MODE_DESCRIPTIONS: Record<ImportMode, string> = {
  polygons: "Cada polígono del archivo se convierte en una zona de manejo.",
  voronoi: "Construye polígonos de Voronoi a partir de los puntos, recortados al límite de la parcela.",
  idw: "Interpolación IDW espacial: el geo-service genera un raster y clasifica por cuantiles en zonas de manejo.",
  samples: "Registra los puntos como ubicaciones de muestreo (no genera zonas).",
  reference: "Solo guarda el archivo como capa de referencia (no genera zonas).",
};

function FitBounds({ fc, parcelCoords }: { fc?: FeatureCollection | null; parcelCoords?: [number, number][] | null }) {
  const map = useMap();
  useMemo(() => {
    if (!map) return;
    const bounds = L.latLngBounds([]);
    if (parcelCoords && parcelCoords.length > 0) {
      parcelCoords.forEach(([lat, lon]) => bounds.extend([lat, lon]));
    }
    if (fc) {
      const collect = (g: Geometry) => {
        if (!g) return;
        if (g.type === "Point") bounds.extend([g.coordinates[1], g.coordinates[0]]);
        else if (g.type === "MultiPoint") g.coordinates.forEach(c => bounds.extend([c[1], c[0]]));
        else if (g.type === "LineString") g.coordinates.forEach(c => bounds.extend([c[1], c[0]]));
        else if (g.type === "Polygon") g.coordinates.forEach(r => r.forEach(c => bounds.extend([c[1], c[0]])));
        else if (g.type === "MultiPolygon") g.coordinates.forEach(p => p.forEach(r => r.forEach(c => bounds.extend([c[1], c[0]]))));
      };
      fc.features.forEach(f => f.geometry && collect(f.geometry));
    }
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24] });
  }, [map, fc, parcelCoords]);
  return null;
}

export default function ParcelImport() {
  const params = useParams<{ id: string }>();
  const parcelId = params.id;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<ImportMode>("polygons");
  const [csvLat, setCsvLat] = useState<string>("");
  const [csvLon, setCsvLon] = useState<string>("");
  const [csvValue, setCsvValue] = useState<string>("");
  const [csvLabel, setCsvLabel] = useState<string>("");
  // Modo "samples": elegir una campaña existente o crear una nueva con variable.
  const [samplesCampaignId, setSamplesCampaignId] = useState<string>("");
  const [samplesVariableId, setSamplesVariableId] = useState<string>("");
  const [samplesCampaignName, setSamplesCampaignName] = useState<string>("");
  // Modo "reference": opcional buffer en metros para convertir líneas a polígonos.
  const [referenceBufferM, setReferenceBufferM] = useState<string>("");
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: parcelData } = useQuery<{ parcel: { id: string; name: string; polygonCoordinates?: [number, number][] | null } }>({
    queryKey: [`/api/parcels/${parcelId}`],
    enabled: !!parcelId,
  });
  const parcel = parcelData?.parcel;

  const { data: importsData, refetch: refetchImports } = useQuery<{ imports: ZoneImport[] }>({
    queryKey: [`/api/parcels/${parcelId}/zone-imports`],
    enabled: !!parcelId,
  });

  // Catálogo de campañas existentes y variables maestras para el modo "samples".
  // Ambos endpoints responden con arrays directamente.
  const { data: campaignsData } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: [`/api/parcels/${parcelId}/sampling-campaigns`],
    enabled: !!parcelId && mode === "samples",
  });
  const { data: variablesData } = useQuery<Array<{ id: string; name: string; code?: string }>>({
    queryKey: [`/api/master-variables`],
    enabled: mode === "samples",
  });

  const isPointMode = useMemo(() => {
    if (!preview) return false;
    return preview.geometryTypes.includes("Point") && !preview.geometryTypes.some(t => t.includes("Polygon"));
  }, [preview]);

  const validateAndSetFile = useCallback((f: File) => {
    if (f.size > 10 * 1024 * 1024) {
      toast({ title: "Archivo demasiado grande", description: "Tamaño máximo: 10 MB.", variant: "destructive" });
      return;
    }
    setFile(f);
    setPreview(null);
  }, [toast]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    validateAndSetFile(f);
  }, [validateAndSetFile]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    validateAndSetFile(f);
  }, [validateAndSetFile]);

  const upload = useCallback(async () => {
    if (!file || !parcelId) return;
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const csvMapping: Record<string, string> = {};
      if (csvLat) csvMapping.latColumn = csvLat;
      if (csvLon) csvMapping.lonColumn = csvLon;
      if (csvValue) csvMapping.valueColumn = csvValue;
      if (csvLabel) csvMapping.labelColumn = csvLabel;
      if (Object.keys(csvMapping).length > 0) fd.append("csvMapping", JSON.stringify(csvMapping));
      const res = await fetch(`/api/parcels/${parcelId}/import-geometry`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.message || "Error al subir");
      }
      const json = (await res.json()) as PreviewResp;
      setPreview(json);
      // Sugerir el modo correcto según las geometrías recibidas.
      if (json.geometryTypes.includes("Point") && !json.geometryTypes.some(t => t.includes("Polygon"))) {
        setMode("voronoi");
      } else {
        setMode("polygons");
      }
      toast({
        title: "Vista previa generada",
        description: `${json.featureCount} feature(s) detectada(s) — formato ${json.format.toUpperCase()}.`,
      });
    } catch (e) {
      toast({ title: "Error al importar", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [file, parcelId, csvLat, csvLon, csvValue, csvLabel, toast]);

  const commit = useCallback(async () => {
    if (!preview || !parcelId) return;
    setSaving(true);
    try {
      const samplesTarget = mode === "samples" ? {
        ...(samplesCampaignId ? { campaignId: samplesCampaignId } : {}),
        ...(samplesVariableId ? { variableId: samplesVariableId } : {}),
        ...(samplesCampaignName ? { campaignName: samplesCampaignName } : {}),
      } : undefined;
      const referenceOptions = mode === "reference" && referenceBufferM
        ? { bufferMeters: Number(referenceBufferM) }
        : undefined;

      const res = await fetch(`/api/parcels/${parcelId}/zones/from-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          featureCollection: preview.featureCollection,
          mode,
          originalFileName: preview.originalFileName,
          format: preview.format,
          csvMapping: preview.format === "csv" ? { latColumn: csvLat, lonColumn: csvLon, valueColumn: csvValue, labelColumn: csvLabel } : undefined,
          warnings: preview.warnings,
          ...(samplesTarget && Object.keys(samplesTarget).length > 0 ? { samplesTarget } : {}),
          ...(referenceOptions ? { referenceOptions } : {}),
        }),
      });

      if (!res.ok) {
        let errBody: ImportErrorBody = {};
        try { errBody = await res.json(); } catch { /* ignore parse error */ }
        const description = translateImportError(errBody, preview.originalFileName);
        toast({ title: "Error al guardar", description, variant: "destructive" });
        return;
      }

      const json = await res.json();
      qc.invalidateQueries({ queryKey: [`/api/parcels/${parcelId}/zone-imports`] });
      qc.invalidateQueries({ queryKey: [`/api/parcels/${parcelId}/zones`] });
      refetchImports();
      toast({
        title: "Importación guardada",
        description: `${json.zonesCreated ?? 0} zona(s) creada(s).`,
      });
      if (json.zoneSetId) {
        // Llevamos al usuario directo a la página de prescripción con el zoneSet
        // cargado, donde aparecen los botones de exportar para autoguiado.
        setLocation(`/parcel/${parcelId}/prescription?zoneSet=${json.zoneSetId}`);
      } else {
        setPreview(null);
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    } catch (e) {
      toast({ title: "Error al guardar", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [preview, parcelId, mode, csvLat, csvLon, csvValue, csvLabel, samplesCampaignId, samplesVariableId, samplesCampaignName, referenceBufferM, qc, refetchImports, toast, setLocation]);

  const center: [number, number] = useMemo(() => {
    if (parcel?.polygonCoordinates && parcel.polygonCoordinates.length > 0) {
      const lats = parcel.polygonCoordinates.map(c => c[0]);
      const lons = parcel.polygonCoordinates.map(c => c[1]);
      return [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lons) + Math.max(...lons)) / 2];
    }
    return [-34.6, -58.4];
  }, [parcel?.polygonCoordinates]);

  return (
    <div className="container mx-auto p-4 space-y-6 max-w-7xl">
      <div className="flex items-center gap-3">
        <Link href={`/parcel/${parcelId}`}>
          <Button variant="ghost" size="sm" data-testid="link-back-parcel">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Volver a la parcela
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Importar zonas / puntos</h1>
          <p className="text-sm text-muted-foreground">
            {parcel?.name ?? "…"} · KML, KMZ, GeoJSON, Shapefile (.zip) o CSV (máx. 10 MB)
          </p>
        </div>
      </div>

      <Tabs defaultValue="upload" className="space-y-4">
        <TabsList>
          <TabsTrigger value="upload" data-testid="tab-upload">Subir archivo</TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">Historial ({importsData?.imports?.length ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><FileUp className="h-5 w-5" /> Archivo</CardTitle>
                <CardDescription>Selecciona el archivo a importar.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Zona de arrastre (drag-and-drop) + click para seleccionar */}
                <div
                  role="button"
                  aria-label="Zona de arrastre de archivos"
                  data-testid="drop-zone"
                  className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg p-6 cursor-pointer transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary/50"}`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                >
                  <FileUp className={`h-8 w-8 ${dragOver ? "text-primary" : "text-muted-foreground"}`} />
                  {file ? (
                    <span className="text-sm font-medium" data-testid="text-filename">
                      {file.name} — {(file.size / 1024).toFixed(1)} KB
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground text-center">
                      Arrastra un archivo aquí o <span className="underline text-primary">haz clic para seleccionar</span>
                    </span>
                  )}
                  <span className="text-[11px] text-muted-foreground">KML · KMZ · GeoJSON · Shapefile (.zip) · CSV</span>
                </div>
                {/* Input oculto que activa el selector nativo */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".kml,.kmz,.geojson,.json,.zip,.csv,.txt"
                  onChange={handleFileChange}
                  data-testid="input-file"
                  className="hidden"
                />

                {file && file.name.toLowerCase().endsWith(".csv") && (
                  <div className="space-y-2 border rounded-md p-3 bg-muted/30">
                    <Label className="text-xs font-semibold">Mapeo de columnas CSV (opcional)</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <Input placeholder="lat" value={csvLat} onChange={e => setCsvLat(e.target.value)} data-testid="input-csv-lat" />
                      <Input placeholder="lon" value={csvLon} onChange={e => setCsvLon(e.target.value)} data-testid="input-csv-lon" />
                      <Input placeholder="value" value={csvValue} onChange={e => setCsvValue(e.target.value)} data-testid="input-csv-value" />
                      <Input placeholder="label" value={csvLabel} onChange={e => setCsvLabel(e.target.value)} data-testid="input-csv-label" />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Si está vacío, se autodetectan: lat/latitud/y, lon/longitud/x, value/valor/z.
                    </p>
                  </div>
                )}

                <Button onClick={upload} disabled={!file || loading} className="w-full" data-testid="button-upload">
                  {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                  {loading ? "Procesando…" : "Generar vista previa"}
                </Button>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><MapPin className="h-5 w-5" /> Vista previa</CardTitle>
                <CardDescription>Las geometrías se muestran en EPSG:4326.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[420px] rounded-md overflow-hidden border" data-testid="map-preview">
                  <MapContainer center={center} zoom={13} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OSM" />
                    {parcel?.polygonCoordinates && (
                      <LPolygon positions={parcel.polygonCoordinates as [number, number][]} pathOptions={{ color: "#1f6feb", fillOpacity: 0.05 }} />
                    )}
                    {preview && (
                      <>
                        {preview.featureCollection.features.map((f, i) => {
                          if (!f.geometry) return null;
                          if (f.geometry.type === "Point") {
                            const [lon, lat] = f.geometry.coordinates;
                            return <CircleMarker key={i} center={[lat, lon]} radius={5} pathOptions={{ color: "#d97706", fillOpacity: 0.7 }} />;
                          }
                          return <LGeoJSON key={i} data={f as Feature} style={{ color: "#16a34a", weight: 2, fillOpacity: 0.2 }} />;
                        })}
                        <FitBounds fc={preview.featureCollection} parcelCoords={parcel?.polygonCoordinates} />
                      </>
                    )}
                  </MapContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {preview && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Layers className="h-5 w-5" /> Resumen y modo</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary" data-testid="badge-format">{preview.format.toUpperCase()}</Badge>
                  <Badge variant="secondary" data-testid="badge-feature-count">{preview.featureCount} feature(s)</Badge>
                  {preview.geometryTypes.map(t => (
                    <Badge key={t} variant="outline">{t}</Badge>
                  ))}
                  {preview.parcelOutsideCount > 0 && (
                    <Badge variant="destructive" data-testid="badge-outside-count">
                      {preview.parcelOutsideCount} fuera de la parcela
                    </Badge>
                  )}
                </div>

                {preview.warnings.length > 0 && (
                  <Alert variant="default" className="border-amber-500/40 bg-amber-50 dark:bg-amber-950/20">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <AlertTitle>Advertencias</AlertTitle>
                    <AlertDescription>
                      <ul className="list-disc pl-5 text-xs space-y-1">
                        {preview.warnings.map((w, i) => <li key={i} data-testid={`text-warning-${i}`}>{w}</li>)}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}

                <div className="space-y-2">
                  <Label htmlFor="mode-select">Modo de importación</Label>
                  <Select value={mode} onValueChange={v => setMode(v as ImportMode)}>
                    <SelectTrigger id="mode-select" data-testid="select-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="polygons" disabled={isPointMode}>Polígonos → zonas</SelectItem>
                      <SelectItem value="voronoi" disabled={!isPointMode}>Voronoi (puntos → zonas)</SelectItem>
                      <SelectItem value="idw" disabled={!isPointMode}>IDW (puntos interpolados)</SelectItem>
                      <SelectItem value="samples" disabled={!isPointMode}>Puntos de muestreo</SelectItem>
                      <SelectItem value="reference">Capa de referencia</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{MODE_DESCRIPTIONS[mode]}</p>
                </div>

                {/* Modo "samples": destino de campaña */}
                {mode === "samples" && (
                  <div className="space-y-2 border rounded-md p-3 bg-muted/30" data-testid="section-samples-target">
                    <Label className="text-xs font-semibold">Destino de los puntos</Label>
                    <Select value={samplesCampaignId} onValueChange={setSamplesCampaignId}>
                      <SelectTrigger data-testid="select-samples-campaign">
                        <SelectValue placeholder="Anexar a campaña existente…" />
                      </SelectTrigger>
                      <SelectContent>
                        {(campaignsData ?? []).map(c => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">— o crear una nueva con —</p>
                    <Select value={samplesVariableId} onValueChange={setSamplesVariableId} disabled={!!samplesCampaignId}>
                      <SelectTrigger data-testid="select-samples-variable">
                        <SelectValue placeholder="Variable de muestreo" />
                      </SelectTrigger>
                      <SelectContent>
                        {(variablesData ?? []).map(v => (
                          <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder="Nombre de la nueva campaña (opcional)"
                      value={samplesCampaignName}
                      onChange={e => setSamplesCampaignName(e.target.value)}
                      disabled={!!samplesCampaignId}
                      data-testid="input-samples-campaign-name"
                    />
                  </div>
                )}

                {/* Modo "reference": opcional buffer en metros para convertir líneas a polígonos */}
                {mode === "reference" && (
                  <div className="space-y-2 border rounded-md p-3 bg-muted/30" data-testid="section-reference-options">
                    <Label htmlFor="ref-buffer" className="text-xs font-semibold">
                      Buffer en metros (opcional, convierte líneas/puntos a polígonos)
                    </Label>
                    <Input
                      id="ref-buffer"
                      type="number"
                      min={0}
                      max={500}
                      placeholder="Ej. 5"
                      value={referenceBufferM}
                      onChange={e => setReferenceBufferM(e.target.value)}
                      data-testid="input-reference-buffer"
                    />
                    <p className="text-xs text-muted-foreground">
                      Si no especificas un buffer, el archivo solo se guarda como capa visual.
                    </p>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button onClick={commit} disabled={saving} data-testid="button-commit">
                    {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                    {saving ? "Guardando…" : "Crear zonas"}
                  </Button>
                  <Button variant="outline" onClick={() => { setPreview(null); setFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} data-testid="button-cancel">
                    <Trash2 className="h-4 w-4 mr-2" /> Descartar
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>Historial de importaciones</CardTitle>
              <CardDescription>Trazabilidad de archivos importados a esta parcela.</CardDescription>
            </CardHeader>
            <CardContent>
              {(importsData?.imports?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">No hay importaciones aún.</p>
              ) : (
                <ul className="space-y-2">
                  {importsData!.imports.map(imp => (
                    <li key={imp.id} className="border rounded-md p-3 flex items-start justify-between gap-3" data-testid={`row-import-${imp.id}`}>
                      <div className="space-y-1">
                        <div className="font-medium text-sm">{imp.originalFileName}</div>
                        <div className="text-xs text-muted-foreground flex flex-wrap gap-2">
                          <Badge variant="outline">{imp.format}</Badge>
                          <Badge variant="outline">{imp.mode}</Badge>
                          <span>{imp.featureCount} feature(s)</span>
                          <span>{new Date(imp.createdAt).toLocaleString("es-AR")}</span>
                        </div>
                        {Array.isArray(imp.warnings) && imp.warnings.length > 0 && (
                          <div className="text-xs text-amber-700 dark:text-amber-400">{imp.warnings.length} advertencia(s)</div>
                        )}
                      </div>
                      {imp.zoneSetId && (
                        <div className="flex flex-col gap-1">
                          <Link href={`/parcel/${parcelId}/zones?zoneSet=${imp.zoneSetId}`}>
                            <Button size="sm" variant="outline" data-testid={`button-view-zones-${imp.id}`}>Ver zonas</Button>
                          </Link>
                          <Link href={`/parcel/${parcelId}/prescription?zoneSet=${imp.zoneSetId}`}>
                            <Button size="sm" variant="outline" data-testid={`button-export-zones-${imp.id}`}>Exportar</Button>
                          </Link>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

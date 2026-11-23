import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Upload, Plus, CheckCircle2, AlertCircle, XCircle, Loader2, ArrowRight, Download, X, AlertTriangle, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n-context";
import { isValidPolygon, pointInPolygon, detectInvertedOrientation } from "@shared/polygon-utils";

type ParcelLite = {
  id: string;
  name: string;
  crop?: string;
  area?: string | number;
  polygonCoordinates?: [number, number][] | null;
};

type MasterVariable = {
  id: string;
  code: string;
  name: string;
  unit: string;
  minValue: string;
  maxValue: string;
};

type RowStatus = "ok" | "no_value" | "out_of_bounds" | "out_of_range" | "duplicate" | "invalid_coord" | "invalid_value";

type ImportErrorItem = {
  variableIndex?: number;
  row?: number;
  message?: string;
};

interface ParsedRow {
  rowIndex: number;
  lat: number | null;
  lon: number | null;
  notes: string | null;
  rawValues: Record<string, string>;
}

interface VariableMapping {
  columnKey: string;
  columnHeader: string;
  variableId: string | "__skip__" | "__create__";
}

interface VariableImportPreview {
  columnKey: string;
  columnHeader: string;
  variable: MasterVariable;
  rows: { rowIndex: number; lat: number; lon: number; value: number | null; notes: string | null; status: RowStatus; error?: string }[];
  counts: { ok: number; no_value: number; out_of_bounds: number; out_of_range: number; duplicate: number; invalid: number };
}

const LAT_HEADERS = new Set(["lat", "latitud", "latitude", "y"]);
const LON_HEADERS = new Set(["lon", "lng", "long", "longitud", "longitude", "x"]);
const NOTES_HEADERS = new Set(["notas", "notes", "observaciones", "obs", "method", "metodo", "método", "comments", "comentarios"]);
const ID_HEADERS = new Set(["punto", "point", "id", "n", "num", "numero", "number", "fid"]);

function normalizeHeader(h: string): string {
  return String(h ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

async function parseFile(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", codepage: 65001 });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [] };
  const sheet = wb.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "", raw: false });
  if (data.length === 0) return { headers: [], rows: [] };
  const originalKeys = Object.keys(data[0]);
  const headers = originalKeys.map(h => String(h).trim()).filter(h => h.length > 0);
  // Map trimmed header → original key so rows with "pH " headers still resolve correctly
  const keyMap: Record<string, string> = {};
  for (const orig of originalKeys) {
    const t = String(orig).trim();
    if (t && !keyMap[t]) keyMap[t] = orig;
  }
  const rows = data.map(r => {
    const out: Record<string, string> = {};
    for (const h of headers) {
      out[h] = String(r[keyMap[h] ?? h] ?? "").trim();
    }
    return out;
  });
  return { headers, rows };
}

interface LabImportPanelProps {
  parcel: ParcelLite;
}

export default function LabImportPanel({ parcel }: LabImportPanelProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();

  const parcelId = parcel.id;
  const polygon: [number, number][] = useMemo(
    () => (parcel.polygonCoordinates ?? []) as [number, number][],
    [parcel.polygonCoordinates],
  );

  const [fileName, setFileName] = useState<string>("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [latCol, setLatCol] = useState<string>("");
  const [lonCol, setLonCol] = useState<string>("");
  const [notesCol, setNotesCol] = useState<string>("__none__");
  const [mappings, setMappings] = useState<VariableMapping[]>([]);
  const [campaignNamePrefix, setCampaignNamePrefix] = useState<string>("");
  const [samplingDepth, setSamplingDepth] = useState<string>("20");
  const [createVarOpen, setCreateVarOpen] = useState<{ columnKey: string } | null>(null);
  const [newVarForm, setNewVarForm] = useState({ code: "", name: "", unit: "", minValue: "", maxValue: "" });
  const [resultSummary, setResultSummary] = useState<null | { created: { campaignId: string; variableName: string; campaignName: string; nPoints: number; allHaveValues: boolean }[]; parcelId: string }>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: variables = [], refetch: refetchVars } = useQuery<MasterVariable[]>({
    queryKey: ["/api/master-variables"],
    queryFn: async () => {
      const r = await fetch("/api/master-variables", { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const autoDetect = useCallback((hdrs: string[], sampleRows: ParsedRow[]) => {
    const norm = hdrs.map(h => ({ raw: h, n: normalizeHeader(h) }));
    const lat = norm.find(h => LAT_HEADERS.has(h.n))?.raw ?? "";
    const lon = norm.find(h => LON_HEADERS.has(h.n))?.raw ?? "";
    const notes = norm.find(h => NOTES_HEADERS.has(h.n))?.raw ?? "__none__";
    setLatCol(lat);
    setLonCol(lon);
    setNotesCol(notes);

    const reserved = new Set([lat, lon, notes !== "__none__" ? notes : ""]);
    const sample = sampleRows.slice(0, 30);
    const isNumericColumn = (raw: string) => {
      let total = 0;
      let numeric = 0;
      for (const r of sample) {
        const cell = (r.rawValues[raw] ?? "").toString().trim();
        if (cell === "") continue;
        total++;
        const n = parseFloat(cell.replace(",", "."));
        if (Number.isFinite(n)) numeric++;
      }
      return total > 0 && numeric / total >= 0.6;
    };

    const candidateVarCols = norm.filter(
      h => !reserved.has(h.raw) && !ID_HEADERS.has(h.n) && isNumericColumn(h.raw),
    );

    setMappings(candidateVarCols.map(h => {
      const m = variables.find(v => {
        const code = v.code.toLowerCase();
        const name = v.name.toLowerCase().replace(/\s+/g, "_");
        return (
          code === h.n ||
          name === h.n ||
          // Substring match only for codes ≥ 3 chars to avoid false positives
          // (e.g. code "E" matching column "ce", code "P" matching column "ph")
          (code.length >= 3 && h.n.includes(code))
        );
      });
      return {
        columnKey: h.raw,
        columnHeader: h.raw,
        variableId: m?.id ?? "__skip__",
      };
    }));
  }, [variables]);

  // When lat/lon/notes column changes, remove any variable mapping that uses the same column
  useEffect(() => {
    const reserved = new Set([latCol, lonCol, notesCol !== "__none__" ? notesCol : ""].filter(Boolean));
    if (reserved.size === 0) return;
    setMappings(ms => ms.filter(m => !reserved.has(m.columnKey)));
  }, [latCol, lonCol, notesCol]);

  // Helper: try to auto-detect a variable for a newly selected column header
  const autoDetectVarForColumn = useCallback((raw: string): string => {
    const n = normalizeHeader(raw);
    const m = variables.find(v => {
      const code = v.code.toLowerCase();
      return (
        code === n ||
        v.name.toLowerCase().replace(/\s+/g, "_") === n ||
        (code.length >= 3 && n.includes(code))
      );
    });
    return m?.id ?? "__skip__";
  }, [variables]);

  const handleFile = async (file: File) => {
    try {
      const { headers: hdrs, rows: parsedRows } = await parseFile(file);
      if (hdrs.length === 0 || parsedRows.length === 0) {
        toast({ title: t("labImport.errFileEmpty"), variant: "destructive" });
        return;
      }
      setFileName(file.name);
      setHeaders(hdrs);
      const parsed: ParsedRow[] = parsedRows.map((r, i) => ({
        rowIndex: i + 2,
        lat: null,
        lon: null,
        notes: null,
        rawValues: r,
      }));
      setRows(parsed);
      autoDetect(hdrs, parsed);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: t("labImport.errFileParse"), description: msg, variant: "destructive" });
    }
  };

  const polygonValid = useMemo(() => isValidPolygon(polygon), [polygon]);
  const polygonOrientationWarning = useMemo(
    () => (polygonValid ? detectInvertedOrientation(polygon) : null),
    [polygon, polygonValid],
  );

  const previews: VariableImportPreview[] = useMemo(() => {
    if (!latCol || !lonCol || rows.length === 0 || !polygonValid || polygonOrientationWarning) return [];
    const result: VariableImportPreview[] = [];
    for (const m of mappings) {
      if (m.variableId === "__skip__" || m.variableId === "__create__") continue;
      const variable = variables.find(v => v.id === m.variableId);
      if (!variable) continue;
      const minV = Number(variable.minValue);
      const maxV = Number(variable.maxValue);
      const seenCoord = new Set<string>();
      const out: VariableImportPreview["rows"] = [];
      const counts = { ok: 0, no_value: 0, out_of_bounds: 0, out_of_range: 0, duplicate: 0, invalid: 0 };
      for (const row of rows) {
        const latStr = row.rawValues[latCol] ?? "";
        const lonStr = row.rawValues[lonCol] ?? "";
        const valStr = row.rawValues[m.columnKey] ?? "";
        const notesStr = notesCol !== "__none__" ? (row.rawValues[notesCol] ?? "") : "";
        const lat = parseFloat(latStr.replace(",", "."));
        const lon = parseFloat(lonStr.replace(",", "."));
        if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
          out.push({ rowIndex: row.rowIndex, lat: NaN, lon: NaN, value: null, notes: null, status: "invalid_coord", error: t("labImport.errInvalidCoord") });
          counts.invalid++;
          continue;
        }
        if (Math.abs(lat) < 1e-6 && Math.abs(lon) < 1e-6) {
          out.push({ rowIndex: row.rowIndex, lat, lon, value: null, notes: null, status: "invalid_coord", error: t("labImport.errZeroCoord") });
          counts.invalid++;
          continue;
        }
        if (!pointInPolygon(lat, lon, polygon)) {
          out.push({ rowIndex: row.rowIndex, lat, lon, value: null, notes: notesStr || null, status: "out_of_bounds", error: t("labImport.errOutOfBounds") });
          counts.out_of_bounds++;
          continue;
        }
        const coordKey = `${lat.toFixed(6)},${lon.toFixed(6)}`;
        if (seenCoord.has(coordKey)) {
          out.push({ rowIndex: row.rowIndex, lat, lon, value: null, notes: notesStr || null, status: "duplicate", error: t("labImport.errDuplicate") });
          counts.duplicate++;
          continue;
        }
        seenCoord.add(coordKey);
        const valTrimmed = valStr.trim();
        if (!valTrimmed) {
          out.push({ rowIndex: row.rowIndex, lat, lon, value: null, notes: notesStr || null, status: "no_value" });
          counts.no_value++;
          continue;
        }
        const val = parseFloat(valTrimmed.replace(",", "."));
        if (isNaN(val)) {
          out.push({ rowIndex: row.rowIndex, lat, lon, value: null, notes: notesStr || null, status: "invalid_value", error: t("labImport.errInvalidValue") });
          counts.invalid++;
          continue;
        }
        if (val < minV || val > maxV) {
          out.push({ rowIndex: row.rowIndex, lat, lon, value: val, notes: notesStr || null, status: "out_of_range", error: `${val} ∉ [${minV}, ${maxV}] ${variable.unit}` });
          counts.out_of_range++;
          continue;
        }
        out.push({ rowIndex: row.rowIndex, lat, lon, value: val, notes: notesStr || null, status: "ok" });
        counts.ok++;
      }
      result.push({ columnKey: m.columnKey, columnHeader: m.columnHeader, variable, rows: out, counts });
    }
    return result;
  }, [latCol, lonCol, notesCol, rows, mappings, variables, polygon, polygonValid, polygonOrientationWarning, t]);

  const totalErrors = useMemo(
    () => previews.reduce(
      (acc, p) => acc + p.counts.out_of_bounds + p.counts.out_of_range + p.counts.duplicate + p.counts.invalid,
      0,
    ),
    [previews],
  );
  const totalSkipped = useMemo(
    () => previews.reduce((acc, p) => acc + p.counts.no_value, 0),
    [previews],
  );
  const totalOk = useMemo(
    () => previews.reduce((acc, p) => acc + p.counts.ok, 0),
    [previews],
  );
  const canImport = previews.length > 0 && totalErrors === 0 && totalOk > 0 && polygonValid && !polygonOrientationWarning;

  const previewByKey = useMemo(
    () => Object.fromEntries(previews.map(p => [p.columnKey, p])),
    [previews],
  );

  const importMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        campaignNamePrefix: campaignNamePrefix.trim() || undefined,
        samplingDepth: parseFloat(samplingDepth) || 20,
        variables: previews.map(p => ({
          variableId: p.variable.id,
          campaignName: campaignNamePrefix.trim()
            ? `${campaignNamePrefix.trim()} — ${p.variable.name}`
            : `${p.variable.name} — ${new Date().toISOString().slice(0, 10)}`,
          points: p.rows
            .filter(r => r.status === "ok")
            .map(r => ({
              latPlanned: r.lat,
              lonPlanned: r.lon,
              value: r.value,
              notes: r.notes,
            })),
        })).filter(v => v.points.length > 0),
      };
      const r = await fetch(`/api/parcels/${parcelId}/lab-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) {
        const detail = Array.isArray(data.errors) && data.errors.length > 0
          ? `${data.message}: ${data.errors.slice(0, 3).map((e: ImportErrorItem) => `var#${e.variableIndex ?? "?"} fila ${e.row ?? "?"}: ${e.message ?? ""}`).join("; ")}`
          : (data.message ?? t("labImport.errImport"));
        throw new Error(detail);
      }
      return data;
    },
    onSuccess: (data) => {
      setResultSummary(data);
      qc.invalidateQueries({ queryKey: ["sampling-campaigns", parcelId] });
      toast({
        title: t("labImport.toastSuccess"),
        description: t("labImport.toastSuccessDesc", { n: String(data.created.length) }),
      });
    },
    onError: (e: Error) => {
      toast({ title: t("labImport.errImport"), description: e.message, variant: "destructive" });
    },
  });

  const createVarMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/master-variables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          code: newVarForm.code.toUpperCase(),
          name: newVarForm.name,
          unit: newVarForm.unit,
          minValue: parseFloat(newVarForm.minValue),
          maxValue: parseFloat(newVarForm.maxValue),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? "Error");
      return d as MasterVariable;
    },
    onSuccess: async (v) => {
      await refetchVars();
      if (createVarOpen) {
        setMappings(ms => ms.map(m => m.columnKey === createVarOpen.columnKey ? { ...m, variableId: v.id } : m));
      }
      setCreateVarOpen(null);
      setNewVarForm({ code: "", name: "", unit: "", minValue: "", maxValue: "" });
      toast({ title: t("labImport.varCreated", { name: v.name }) });
    },
    onError: (e: Error) => {
      toast({ title: t("common.error"), description: e.message, variant: "destructive" });
    },
  });

  const reset = () => {
    setFileName(""); setHeaders([]); setRows([]); setLatCol(""); setLonCol("");
    setNotesCol("__none__"); setMappings([]); setResultSummary(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const downloadTemplate = () => {
    const csv = [
      "Longitud,Latitud,pH,Method,CE",
      "-102.979851,20.380928,4.42,1 a 2 agua,0.16",
      "-102.979638,20.380772,4.40,1 a 2 agua,0.16",
      "-102.979358,20.380867,4.38,1 a 2 agua,0.15",
      "-102.979873,20.380606,4.28,1 a 2 agua,0.13",
      "-102.980067,20.380289,4.27,1 a 2 agua,0.16",
    ].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "plantilla_laboratorio.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!polygonValid) {
    return (
      <Card data-testid="card-lab-import-no-polygon">
        <CardContent className="p-6 text-sm text-muted-foreground flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <span>{t("labImport.noEligibleParcels")}</span>
        </CardContent>
      </Card>
    );
  }

  if (polygonOrientationWarning) {
    return (
      <Card data-testid="card-lab-import-orientation-warning">
        <CardContent className="p-6 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{polygonOrientationWarning}</span>
        </CardContent>
      </Card>
    );
  }

  if (resultSummary) {
    return (
      <Card className="border-green-200 bg-green-50/30" data-testid="card-import-success">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-green-800">
            <CheckCircle2 className="w-6 h-6" /> {t("labImport.successTitle")}
          </CardTitle>
          <CardDescription>
            {t("labImport.successDesc", { n: String(resultSummary.created.length) })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {resultSummary.created.map(c => (
            <div key={c.campaignId} className="flex items-center justify-between p-3 bg-white rounded-lg border" data-testid={`row-result-${c.campaignId}`}>
              <div>
                <p className="font-medium">{c.variableName}</p>
                <p className="text-xs text-muted-foreground">{c.campaignName} · {c.nPoints} {t("labImport.points")}</p>
                {c.allHaveValues && (
                  <Badge variant="secondary" className="mt-1 bg-green-100 text-green-800 text-[10px]">
                    {t("labImport.readyToInterpolate")}
                  </Badge>
                )}
              </div>
              <div className="flex gap-2">
                {c.allHaveValues && (
                  <Button asChild size="sm" data-testid={`btn-interpolate-${c.campaignId}`}>
                    <Link href={`/parcel/${resultSummary.parcelId}/sampling/maps?campaign=${c.campaignId}`}>
                      {t("labImport.interpolate")} <ArrowRight className="w-3 h-3 ml-1" />
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          ))}
          <div className="flex gap-2 pt-3">
            <Button variant="outline" onClick={reset} data-testid="btn-import-another">
              <Upload className="w-4 h-4 mr-2" /> {t("labImport.importAnother")}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      {/* 1. File upload */}
      <Card data-testid="card-file-upload">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <span className="bg-primary text-primary-foreground rounded-full w-6 h-6 inline-flex items-center justify-center text-xs">1</span>
            {t("labImport.step2Title")}
          </CardTitle>
          <CardDescription>{t("labImport.step2Desc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls,.txt"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            data-testid="input-lab-file"
          />
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => fileInputRef.current?.click()}
              data-testid="btn-select-file"
            >
              <Upload className="w-4 h-4 mr-2" />
              {fileName ? fileName : t("labImport.chooseFile")}
            </Button>
            {fileName && (
              <Button variant="ghost" size="icon" onClick={reset} data-testid="btn-clear-file">
                <X className="w-4 h-4" />
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={downloadTemplate} data-testid="btn-download-template-lab">
              <Download className="w-3.5 h-3.5 mr-1.5" /> {t("labImport.template")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("labImport.fileHint")}</p>
        </CardContent>
      </Card>

      {/* 2. Column mapping */}
      {headers.length > 0 && (
        <Card data-testid="card-mapping">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <span className="bg-primary text-primary-foreground rounded-full w-6 h-6 inline-flex items-center justify-center text-xs">2</span>
              {t("labImport.step3Title")}
            </CardTitle>
            <CardDescription>{t("labImport.step3Desc", { n: String(rows.length) })}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">{t("labImport.colLat")} *</Label>
                <Select value={latCol} onValueChange={setLatCol}>
                  <SelectTrigger data-testid="select-lat-col"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t("labImport.colLon")} *</Label>
                <Select value={lonCol} onValueChange={setLonCol}>
                  <SelectTrigger data-testid="select-lon-col"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t("labImport.colNotes")}</Label>
                <Select value={notesCol} onValueChange={setNotesCol}>
                  <SelectTrigger data-testid="select-notes-col"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t("labImport.none")}</SelectItem>
                    {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide">{t("labImport.varMappings")}</Label>
              {mappings.length === 0 && (
                <p className="text-sm text-muted-foreground">{t("labImport.noVarColumns")}</p>
              )}
              {mappings.length > 0 && (() => {
                const reserved = new Set([latCol, lonCol, notesCol !== "__none__" ? notesCol : ""].filter(Boolean));
                return (
                  <div className="space-y-2">
                    {mappings.map(m => {
                      const usedByOthers = new Set(mappings.filter(x => x.columnKey !== m.columnKey).map(x => x.columnKey));
                      const availableCols = headers.filter(h => !reserved.has(h) && !usedByOthers.has(h));
                      if (!availableCols.includes(m.columnKey)) availableCols.unshift(m.columnKey);
                      return (
                        <div key={m.columnKey} className="flex flex-col md:flex-row md:items-start gap-2 p-2 border rounded-lg" data-testid={`mapping-${m.columnKey}`}>
                          {/* Source column selector */}
                          <div className="flex-1 min-w-0 space-y-1">
                            <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">{t("labImport.column")}</Label>
                            <Select value={m.columnKey} onValueChange={(newKey) => {
                              setMappings(ms => ms.map(x => x.columnKey === m.columnKey
                                ? { ...x, columnKey: newKey, columnHeader: newKey, variableId: autoDetectVarForColumn(newKey) }
                                : x));
                            }}>
                              <SelectTrigger className="h-8 text-sm" data-testid={`select-col-${m.columnKey}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {availableCols.map(h => (
                                  <SelectItem key={h} value={h}>{h}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          {/* Variable selector */}
                          <div className="flex-1 space-y-1">
                            <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">{t("labImport.variable")}</Label>
                            <Select value={m.variableId} onValueChange={(v) => {
                              if (v === "__create__") {
                                setCreateVarOpen({ columnKey: m.columnKey });
                                setNewVarForm({ code: m.columnHeader.toUpperCase().slice(0, 20), name: m.columnHeader, unit: "", minValue: "", maxValue: "" });
                              } else {
                                setMappings(ms => ms.map(x => x.columnKey === m.columnKey ? { ...x, variableId: v } : x));
                              }
                            }}>
                              <SelectTrigger className="h-8 text-sm" data-testid={`select-var-${m.columnKey}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__skip__">— {t("labImport.skipColumn")} —</SelectItem>
                                <SelectItem value="__create__">+ {t("labImport.createNewVar")}</SelectItem>
                                {variables.map(v => (
                                  <SelectItem key={v.id} value={v.id}>{v.name} ({v.unit})</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {(() => {
                              const p = previewByKey[m.columnKey];
                              if (!p || p.counts.ok > 0) return null;
                              const totalRows = p.counts.ok + p.counts.out_of_range + p.counts.out_of_bounds + p.counts.no_value + p.counts.duplicate + p.counts.invalid;
                              if (totalRows === 0) return null;
                              return (
                                <p className="text-[10px] text-amber-600 flex items-center gap-1" data-testid={`warn-mismatch-${m.columnKey}`}>
                                  <AlertTriangle className="w-3 h-3 shrink-0" />
                                  {t("labImport.mismatchWarn")}
                                </p>
                              );
                            })()}
                          </div>
                          {/* Remove row */}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0 mt-5"
                            onClick={() => setMappings(ms => ms.filter(x => x.columnKey !== m.columnKey))}
                            data-testid={`btn-remove-mapping-${m.columnKey}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
              {/* Add column row button */}
              {headers.length > 0 && (() => {
                const reserved = new Set([latCol, lonCol, notesCol !== "__none__" ? notesCol : ""].filter(Boolean));
                const usedCols = new Set(mappings.map(m => m.columnKey));
                const unusedCols = headers.filter(h => !reserved.has(h) && !usedCols.has(h));
                if (unusedCols.length === 0) return null;
                return (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full text-xs h-8 border-dashed"
                    onClick={() => {
                      const nextCol = unusedCols[0];
                      setMappings(ms => [...ms, { columnKey: nextCol, columnHeader: nextCol, variableId: autoDetectVarForColumn(nextCol) }]);
                    }}
                    data-testid="btn-add-mapping"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    {t("labImport.addColumn")}
                  </Button>
                );
              })()}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t">
              <div>
                <Label htmlFor="prefix" className="text-xs">{t("labImport.namePrefix")}</Label>
                <Input id="prefix" value={campaignNamePrefix} onChange={e => setCampaignNamePrefix(e.target.value)} placeholder={t("labImport.namePrefixPlaceholder")} data-testid="input-name-prefix" />
              </div>
              <div>
                <Label htmlFor="depth" className="text-xs">{t("labImport.samplingDepth")}</Label>
                <Input id="depth" type="number" min={1} max={200} value={samplingDepth} onChange={e => setSamplingDepth(e.target.value)} data-testid="input-depth" />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 3. Preview per variable */}
      {previews.length > 0 && (
        <Card data-testid="card-preview">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <span className="bg-primary text-primary-foreground rounded-full w-6 h-6 inline-flex items-center justify-center text-xs">3</span>
              {t("labImport.step4Title")}
            </CardTitle>
            <CardDescription>{t("labImport.step4Desc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {previews.map(p => (
              <div key={p.columnKey} className="border rounded-lg overflow-hidden" data-testid={`preview-${p.columnKey}`}>
                <div className="bg-muted/40 p-3 flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="font-medium text-sm">{p.variable.name} <span className="text-muted-foreground font-normal">({p.variable.unit})</span></p>
                    <p className="text-[10px] text-muted-foreground">{t("labImport.fromColumn")}: <code>{p.columnHeader}</code></p>
                  </div>
                  <div className="flex gap-2 text-xs flex-wrap">
                    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">{p.counts.ok} {t("labImport.ok")}</Badge>
                    {p.counts.no_value > 0 && <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">{p.counts.no_value} {t("labImport.noValue")}</Badge>}
                    {p.counts.out_of_bounds > 0 && <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">{p.counts.out_of_bounds} {t("labImport.outBounds")}</Badge>}
                    {p.counts.out_of_range > 0 && <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">{p.counts.out_of_range} {t("labImport.outRange")}</Badge>}
                    {p.counts.duplicate > 0 && <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">{p.counts.duplicate} {t("labImport.duplicate")}</Badge>}
                    {p.counts.invalid > 0 && <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">{p.counts.invalid} {t("labImport.invalid")}</Badge>}
                  </div>
                </div>
                {p.counts.no_value > 0 && (
                  <p className="text-[10px] text-amber-600 px-3 py-1.5 bg-amber-50/60 border-b border-amber-100" data-testid={`note-skipped-${p.columnKey}`}>
                    {t("labImport.skippedRows", { n: String(p.counts.no_value) })}
                  </p>
                )}
                <div className="max-h-64 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="text-xs">
                        <TableHead className="w-12">{t("labImport.row")}</TableHead>
                        <TableHead>Lat</TableHead>
                        <TableHead>Lon</TableHead>
                        <TableHead>{t("labImport.value")}</TableHead>
                        <TableHead>{t("labImport.status")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {p.rows.slice(0, 100).map(r => (
                        <TableRow
                          key={`${p.columnKey}-${r.rowIndex}`}
                          className={`text-xs ${r.status === "ok" ? "" : r.status === "no_value" ? "bg-amber-50/50" : "bg-red-50/50"}`}
                        >
                          <TableCell className="font-mono">{r.rowIndex}</TableCell>
                          <TableCell className="font-mono">{isNaN(r.lat) ? "—" : r.lat.toFixed(6)}</TableCell>
                          <TableCell className="font-mono">{isNaN(r.lon) ? "—" : r.lon.toFixed(6)}</TableCell>
                          <TableCell className="font-mono">{r.value ?? "—"}</TableCell>
                          <TableCell>
                            {r.status === "ok" && <span className="text-green-700 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />OK</span>}
                            {r.status === "no_value" && <span className="text-amber-600 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{t("labImport.noValue")}</span>}
                            {(r.status === "out_of_bounds" || r.status === "out_of_range" || r.status === "duplicate" || r.status === "invalid_coord" || r.status === "invalid_value") && (
                              <span className="text-red-600 flex items-center gap-1"><XCircle className="w-3 h-3" />{r.error}</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {p.rows.length > 100 && (
                    <p className="text-xs text-muted-foreground px-3 py-2 border-t">{t("labImport.showingFirst", { shown: "100", total: String(p.rows.length) })}</p>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 4. Import action */}
      {previews.length > 0 && (
        <Card
          className={
            canImport
              ? "border-green-200 bg-green-50/30"
              : totalErrors > 0
                ? "border-red-200 bg-red-50/30"
                : "border-amber-200 bg-amber-50/30"
          }
          data-testid="card-import-action"
        >
          <CardContent className="p-4 flex items-center justify-between flex-wrap gap-3">
            <div className="space-y-0.5">
              <p className="font-medium">
                {totalErrors > 0
                  ? t("labImport.fixErrorsFirst", { n: String(totalErrors) })
                  : totalOk === 0
                    ? t("labImport.noOkRows")
                    : t("labImport.readyToImport", { vars: String(previews.filter(p => p.counts.ok > 0).length) })}
              </p>
              <p className="text-xs text-muted-foreground">
                {totalOk} {t("labImport.totalPoints")}
              </p>
              {totalSkipped > 0 && (
                <p className="text-xs text-amber-600 font-medium" data-testid="text-skipped-rows">
                  {t("labImport.skippedRows", { n: String(totalSkipped) })}
                </p>
              )}
            </div>
            <Button
              size="lg"
              disabled={!canImport || importMutation.isPending}
              onClick={() => importMutation.mutate()}
              data-testid="btn-import-all"
            >
              {importMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              {t("labImport.importAll")}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Inline new-variable dialog */}
      <Dialog open={!!createVarOpen} onOpenChange={(o) => { if (!o) setCreateVarOpen(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("labImport.newVarTitle")}</DialogTitle>
            <DialogDescription>{t("labImport.newVarDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t("labImport.varCode")} *</Label>
                <Input value={newVarForm.code} onChange={e => setNewVarForm(f => ({ ...f, code: e.target.value.toUpperCase().slice(0, 20) }))} data-testid="input-newvar-code" />
              </div>
              <div>
                <Label className="text-xs">{t("labImport.varUnit")} *</Label>
                <Input value={newVarForm.unit} onChange={e => setNewVarForm(f => ({ ...f, unit: e.target.value }))} placeholder="ej. dS/m" data-testid="input-newvar-unit" />
              </div>
            </div>
            <div>
              <Label className="text-xs">{t("labImport.varName")} *</Label>
              <Input value={newVarForm.name} onChange={e => setNewVarForm(f => ({ ...f, name: e.target.value }))} data-testid="input-newvar-name" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t("labImport.varMin")} *</Label>
                <Input type="number" value={newVarForm.minValue} onChange={e => setNewVarForm(f => ({ ...f, minValue: e.target.value }))} data-testid="input-newvar-min" />
              </div>
              <div>
                <Label className="text-xs">{t("labImport.varMax")} *</Label>
                <Input type="number" value={newVarForm.maxValue} onChange={e => setNewVarForm(f => ({ ...f, maxValue: e.target.value }))} data-testid="input-newvar-max" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateVarOpen(null)}>{t("common.cancel")}</Button>
            <Button
              disabled={!newVarForm.code || !newVarForm.name || !newVarForm.unit || !newVarForm.minValue || !newVarForm.maxValue || createVarMutation.isPending}
              onClick={() => createVarMutation.mutate()}
              data-testid="btn-create-var"
            >
              {createVarMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
              {t("labImport.createVar")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

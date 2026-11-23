import { randomUUID } from "node:crypto";
import { fieldLogOrigin, fieldLogOriginLabels, fieldLogOccurredOn } from "@shared/field-log-policy";
import type { Express, RequestHandler } from "express";
import type { IStorage, FieldLogFilters } from "../storage";
import { ObjectStorageService } from "../replit_integrations/object_storage/objectStorage";
import { ObjectPermission } from "../replit_integrations/object_storage/objectAcl";
import { importReviewedNotebook, previewNotebook } from "../services/field-notebook";
import { z } from "zod";
import { civilDateInstant, mexicoDateKey } from "@shared/civil-date";
import { measuredNumber, soilMeasurementKeys } from "@shared/agronomic-evidence";
import { exactSoilDuplicates, soilReportRepair } from "../services/soil-quality";

type AuthMiddleware = RequestHandler;

function dateParam(value: unknown, endOfDay = false): Date | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}-06:00`
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value) ? `${value}-06:00` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function filtersFromQuery(query: Record<string, unknown>): FieldLogFilters {
  return {
    search: typeof query.search === "string" ? query.search.slice(0, 120) : undefined,
    status: typeof query.status === "string" && query.status !== "all" ? query.status : undefined,
    activity: typeof query.activity === "string" && query.activity !== "all" ? query.activity.slice(0, 100) : undefined,
    category: typeof query.category === "string" && query.category !== "all" ? query.category.slice(0, 40) : undefined,
    cycleDetailId: typeof query.cycleDetailId === "string" && query.cycleDetailId !== "all" ? query.cycleDetailId : undefined,
    from: dateParam(query.from),
    to: dateParam(query.to, true),
    page: Number(query.page) || 1,
    limit: Number(query.limit) || 25,
  };
}

function normalizeCorrection(raw: any, current: any) {
  const prior = current?.structuredData || {};
  const structured = raw?.structuredData && typeof raw.structuredData === "object"
    ? raw.structuredData : prior;
  const items = (Array.isArray(structured?.items) ? structured.items : []).slice(0, 50).map((item: any) => ({
    category: ["labor", "input", "machinery", "harvest", "sale", "observation"].includes(item?.category)
      ? item.category : "observation",
    name: String(item?.name || "").trim().slice(0, 160),
    quantity: item?.quantity === "" || item?.quantity == null ? null : Number(item.quantity),
    unit: item?.unit ? String(item.unit).trim().slice(0, 40) : null,
    personnel: item?.personnel ? String(item.personnel).trim().slice(0, 160) : null,
    machinery: item?.machinery ? String(item.machinery).trim().slice(0, 160) : null,
    cost: item?.cost === "" || item?.cost == null ? null : Number(item.cost),
    currency: item?.currency ? String(item.currency).trim().toUpperCase().slice(0, 8) : null,
  })).filter((item: any) => item.name);
  const activityType = raw?.activityType == null ? current.activityType : String(raw.activityType).trim().slice(0, 100);
  const occurredAt = raw?.occurredAt == null ? current.occurredAt : dateParam(raw.occurredAt);
  const missing = new Set<string>();
  if (!activityType) missing.add("tipo de labor");
  if (!occurredAt) missing.add("fecha");
  const totalsByCurrency: Record<string, number> = {};
  for (const item of items) {
    if (Number.isFinite(item.quantity) && !item.unit) missing.add(`unidad de ${item.name}`);
    if (Number.isFinite(item.cost) && !item.currency) missing.add(`moneda de ${item.name}`);
    if (Number.isFinite(item.cost) && item.currency) {
      totalsByCurrency[item.currency] = Number(((totalsByCurrency[item.currency] || 0) + item.cost).toFixed(2));
    }
  }
  return {
    activityType,
    occurredAt: occurredAt || null,
    missingFields: Array.from(missing),
    structuredData: {
      ...structured,
      activityType,
      occurredAt: occurredAt?.toISOString() || null,
      occurredOn: mexicoDateKey(occurredAt ?? null),
      datePrecision: occurredAt ? "exact" : "unknown",
      items,
      observations: structured?.observations ? String(structured.observations).slice(0, 2000) : null,
      totalsByCurrency,
      missingFields: Array.from(missing),
    },
  };
}

function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function registerFieldLogRoutes(
  app: Express,
  storage: IStorage,
  isAuthenticated: AuthMiddleware,
  isActiveUser: AuthMiddleware,
) {
  async function parcelOwner(req: any, res: any): Promise<string | null> {
    const parcel = await storage.getParcel(req.params.id);
    if (!parcel) {
      res.status(404).json({ message: "Parcela no encontrada" });
      return null;
    }
    if (parcel.userId !== req.user.id && req.user.role !== "admin") {
      res.status(403).json({ message: "No tienes acceso a esta parcela" });
      return null;
    }
    return parcel.userId;
  }

  app.get("/api/parcels/:id/field-logs/import-sources", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const owner = await parcelOwner(req, res); if (!owner) return;
      const rows = await storage.getConversationsByParcel(req.params.id);
      res.json({ conversations: rows.filter(c => c.userId === owner && c.channel === "web")
        .map(c => ({ id: c.id, title: c.title, createdAt: c.createdAt })) });
    } catch { res.status(500).json({ message: "No se pudieron consultar los cuadernos" }); }
  });
  app.post("/api/parcels/:id/field-logs/import-preview", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const owner = await parcelOwner(req, res); if (!owner) return;
      const input = z.object({ text: z.string().max(60000).optional(), conversationId: z.string().optional() }).parse(req.body);
      let text = input.text || "", source = "texto pegado";
      if (input.conversationId) {
        const conversations = await storage.getConversationsByParcel(req.params.id);
        const conversation = conversations.find(c => c.id === input.conversationId && c.userId === owner && c.channel === "web");
        if (!conversation) return res.status(403).json({ message: "Conversación no autorizada" });
        const messages = await storage.getMessagesByConversation(conversation.id);
        text = messages.filter(m => m.role === "user").map(m => m.content).join("\n\n");
        source = `chat web ${conversation.id}`;
      }
      if (!text.trim() || text.length > 60000) return res.status(400).json({ message: "Pega un cuaderno de hasta 60,000 caracteres" });
      res.json({ text, source, records: await previewNotebook(text) });
    } catch (e) { res.status(e instanceof z.ZodError ? 400 : 502).json({ message: "No se pudo preparar la revisión del cuaderno" }); }
  });
  app.post("/api/parcels/:id/field-logs/import", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const owner = await parcelOwner(req, res); if (!owner) return;
      res.json({ entries: await importReviewedNotebook(storage, owner, req.params.id, req.body) });
    } catch (e) { res.status(400).json({ message: e instanceof Error ? e.message : "Importación inválida" }); }
  });
  app.post("/api/parcels/:id/soil-analysis/merge", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const owner = await parcelOwner(req, res); if (!owner) return;
      const { keepId, duplicateId } = z.object({ keepId: z.string().min(1), duplicateId: z.string().min(1) }).parse(req.body);
      if (keepId === duplicateId) return res.status(400).json({ message: "Selecciona dos análisis distintos" });
      const { db } = await import("../storage");
      const { soilAnalysis } = await import("@shared/schema");
      const { eq, and, inArray, sql } = await import("drizzle-orm");
      const analysis = await db.transaction(async tx => {
        await tx.execute(sql`SELECT id FROM soil_analysis WHERE parcel_id=${req.params.id} AND id IN (${keepId},${duplicateId}) FOR UPDATE`);
        const rows = await tx.select().from(soilAnalysis).where(and(eq(soilAnalysis.parcelId, req.params.id), inArray(soilAnalysis.id, [keepId, duplicateId])));
        const keep = rows.find(r => r.id === keepId), duplicate = rows.find(r => r.id === duplicateId);
        if (!keep || !duplicate) throw new Error("Análisis no encontrados en esta parcela");
        if (!exactSoilDuplicates(keep, duplicate))
          throw new Error("Solo se pueden fusionar análisis con la misma fecha y mediciones idénticas");
        const notes = [keep.notes, duplicate.notes,
          `Fusión revisada ${new Date().toISOString()}; copia auditable del duplicado: ${JSON.stringify(duplicate)}`].filter(Boolean).join("\n");
        const [saved] = await tx.update(soilAnalysis).set({ notes, labName: keep.labName || duplicate.labName }).where(eq(soilAnalysis.id, keep.id)).returning();
        await tx.delete(soilAnalysis).where(eq(soilAnalysis.id, duplicate.id));
        return saved;
      });
      res.json({ analysis });
    } catch (e) { res.status(400).json({ message: e instanceof Error ? e.message : "No se pudo fusionar" }); }
  });
  app.get("/api/parcels/:id/soil-analysis/report-repairs", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const owner = await parcelOwner(req, res); if (!owner) return;
      const rows = await storage.getSoilAnalysisByParcel(req.params.id);
      res.json({ proposals: rows.map(row => ({ id: row.id, date: row.analysisDate,
        before: { nitrogenTotal: row.nitrogenTotal, nitrogenInorganic: row.nitrogenInorganic },
        changes: soilReportRepair(row), notes: row.notes })).filter(row => Object.keys(row.changes).length) });
    } catch { res.status(500).json({ message: "No se pudo revisar el informe" }); }
  });
  app.post("/api/parcels/:id/soil-analysis/report-repairs", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const owner = await parcelOwner(req, res); if (!owner) return;
      const input = z.object({ analysisId: z.string(), before: z.object({
        nitrogenTotal: z.string().nullable(), nitrogenInorganic: z.string().nullable(),
       }), clearUnreportedTotalN: z.boolean().default(false) }).parse(req.body);
      const { db } = await import("../storage");
      const { soilAnalysis } = await import("@shared/schema");
      const { eq, and, sql } = await import("drizzle-orm");
      const analysis = await db.transaction(async tx => {
        await tx.execute(sql`SELECT id FROM soil_analysis WHERE id=${input.analysisId} AND parcel_id=${req.params.id} FOR UPDATE`);
        const [row] = await tx.select().from(soilAnalysis).where(and(eq(soilAnalysis.id, input.analysisId), eq(soilAnalysis.parcelId, req.params.id)));
        if (!row) throw new Error("Análisis no encontrado");
        if (row.nitrogenTotal !== input.before.nitrogenTotal || row.nitrogenInorganic !== input.before.nitrogenInorganic)
          throw new Error("El análisis cambió; vuelve a revisar la propuesta");
        const changes = soilReportRepair(row);
        if (input.clearUnreportedTotalN) {
          if (row.nitrogenTotal == null || Number(row.nitrogenTotal) !== 0)
            throw new Error("Esta corrección solo deja vacío un cero que confirmes como no reportado; no borra valores medidos distintos de cero");
          changes.nitrogenTotal = null;
        }
        if (!Object.keys(changes).length) return row;
        const [saved] = await tx.update(soilAnalysis).set({ ...changes,
          notes: `${row.notes || ""}\nRevisión explícita de N ${new Date().toISOString()}: ${JSON.stringify(input.before)} → ${JSON.stringify(changes)}; fuente: ${input.clearUnreportedTotalN ? "confirmación explícita del usuario: el laboratorio no reportó N total; datos de N inorgánico del texto del informe" : "texto del informe"}.` })
          .where(eq(soilAnalysis.id, row.id)).returning();
        return saved;
      });
      res.json({ analysis });
    } catch (e) { res.status(400).json({ message: e instanceof Error ? e.message : "No se pudo corregir" }); }
  });

  app.get("/api/parcels/:id/field-logs", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const ownerId = await parcelOwner(req, res);
      if (!ownerId) return;
      await storage.promoteLegacyFieldLogs(ownerId, req.params.id);
      const [result, cycles] = await Promise.all([
        storage.listFieldLogs(ownerId, req.params.id, filtersFromQuery(req.query)),
        storage.getCropCycleDetails(req.params.id),
      ]);
      res.json({ ...result, cycles });
    } catch (error: any) {
      console.error("[Field log] list failed:", error);
      res.status(500).json({ message: "No se pudo cargar la bitácora" });
    }
  });

  app.get("/api/parcels/:id/field-logs/export.csv", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const ownerId = await parcelOwner(req, res);
      if (!ownerId) return;
      const filters = filtersFromQuery(req.query);
      const exported = await storage.exportFieldLogs(ownerId, req.params.id, filters, 5_000);
      if (exported.truncated) {
        return res.status(413).json({
          message: `La exportación contiene ${exported.total} registros. Acota el periodo o aplica filtros para descargar un máximo de 5,000.`,
          total: exported.total,
          limit: 5_000,
        });
      }
      const entries = exported.entries;
      const rows = [["ID", "Estado", "Fecha", "Actividad", "Categoría", "Partida", "Cantidad", "Unidad", "Personal", "Maquinaria", "Costo", "Moneda", "Observaciones", "Canal", "Revisión", "Origen"]];
      for (const entry of entries) {
        const data = entry.structuredData as any;
        const items = Array.isArray(data?.items) && data.items.length ? data.items : [{}];
        for (const item of items) rows.push([
          entry.id, entry.status, fieldLogOccurredOn(entry), entry.activityType || "",
          item.category || "", item.name || "", item.quantity ?? "", item.unit || "", item.personnel || "",
          item.machinery || "", item.cost ?? "", item.currency || "", data?.observations || "",
          data?.channel === "web" ? "Web" : "WhatsApp", String(entry.currentRevision), fieldLogOriginLabels[fieldLogOrigin(entry)],
        ]);
      }
      const csv = "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
      res.set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="bitacora-${req.params.id}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Export-Total": String(exported.total),
        "X-Export-Truncated": String(exported.truncated),
      }).send(csv);
    } catch (error: any) {
      console.error("[Field log] CSV export failed:", error);
      res.status(500).json({ message: "No se pudo exportar la bitácora" });
    }
  });

  app.get("/api/parcels/:id/field-logs/export.json", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const ownerId = await parcelOwner(req, res);
      if (!ownerId) return;
      const exported = await storage.exportFieldLogs(ownerId, req.params.id, filtersFromQuery(req.query), 5_000);
      res.set("Cache-Control", "private, no-store").json(exported);
    } catch (error: any) {
      console.error("[Field log] JSON export failed:", error);
      res.status(500).json({ message: "No se pudo preparar la exportación" });
    }
  });

  app.get("/api/field-logs/:entryId", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const detail = await storage.getFieldLogDetail(req.params.entryId, userId);
      if (!detail) return res.status(404).json({ message: "Registro no encontrado" });
      res.json(detail);
    } catch (error: any) {
      res.status(500).json({ message: "No se pudo cargar el registro" });
    }
  });

  app.patch("/api/field-logs/:entryId", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const detail = await storage.getFieldLogDetail(req.params.entryId, req.user.id);
      if (!detail) return res.status(404).json({ message: "Registro no encontrado" });
      const sourceId = `web:${randomUUID()}`;
      let entry;
      if (req.body?.action === "confirm") {
        if (!["pending", "corrected"].includes(detail.entry.status)) {
          return res.status(409).json({ message: `El registro ya está ${detail.entry.status}` });
        }
        if (detail.entry.missingFields.length) return res.status(409).json({ message: "Completa los datos faltantes antes de confirmar" });
        entry = await storage.confirmFieldLog(detail.entry.id, req.user.id, sourceId, detail.entry.currentRevision);
      } else if (req.body?.action === "reject") {
        if (!["draft", "pending", "corrected", "confirmed"].includes(detail.entry.status)) {
          return res.status(409).json({ message: `El registro ya está ${detail.entry.status}` });
        }
        entry = await storage.rejectFieldLog(detail.entry.id, req.user.id, sourceId, detail.entry.currentRevision);
      } else if (req.body?.action === "correct") {
        if (!["draft", "pending", "corrected", "confirmed"].includes(detail.entry.status)) {
          return res.status(409).json({ message: `El registro ya está ${detail.entry.status}` });
        }
        const correction = normalizeCorrection(req.body?.correction, detail.entry);
        entry = await storage.reviseFieldLog(detail.entry.id, req.user.id, sourceId, detail.entry.currentRevision, {
          ...correction,
          confidence: detail.entry.confidence == null ? null : Number(detail.entry.confidence),
          correctionText: String(req.body?.correctionText || "Corrección desde AgRegen").slice(0, 500),
        });
      } else {
        return res.status(400).json({ message: "Acción no válida" });
      }
      res.json({ entry });
    } catch (error: any) {
      const conflict = /cambió|cerrada/.test(error.message);
      res.status(conflict ? 409 : 500).json({ message: error.message || "No se pudo actualizar el registro" });
    }
  });

  app.get("/api/field-logs/:entryId/evidence/:index", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const detail = await storage.getFieldLogDetail(req.params.entryId, req.user.id);
      if (!detail) return res.status(404).json({ message: "Registro no encontrado" });
      const index = Number(req.params.index);
      const evidence = Array.isArray(detail.entry.evidence) ? detail.entry.evidence as any[] : [];
      const item = Number.isInteger(index) ? evidence[index] : undefined;
      if (!item?.path) return res.status(404).json({ message: "Evidencia no encontrada" });
      const service = new ObjectStorageService();
      const file = await service.getObjectEntityFile(item.path);
      const allowed = await service.canAccessObjectEntity({
        userId: req.user.id,
        objectFile: file,
        requestedPermission: ObjectPermission.READ,
      });
      if (!allowed) return res.status(403).json({ message: "No tienes acceso a esta evidencia" });
      res.set("Content-Disposition", `inline; filename="evidencia-${detail.entry.id.slice(0, 8)}-${index}"`);
      await service.downloadObject(file, res, 0);
    } catch (error: any) {
      console.error("[Field log] evidence failed:", error);
      if (!res.headersSent) res.status(404).json({ message: "Evidencia no encontrada" });
    }
  });
}
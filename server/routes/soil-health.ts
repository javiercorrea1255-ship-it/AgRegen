import type { Express, RequestHandler } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import type { IStorage } from "../storage";
import type { SoilHealthRepository } from "../services/soil-health-repository";
import { chronologicalSoilHealth, indicatorIdSchema, soilHealthInputSchema } from "@shared/soil-health";
import { ObjectStorageService } from "../replit_integrations/object_storage/objectStorage";
import { cleanupSoilHealthObject } from "../services/soil-health-cleanup";

const base = "/api/parcels/:id/soil-health";
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

// Do not trust a user-supplied MIME type, and never serve SVG/HTML as evidence.
export function soilHealthPhotoType(buffer: Buffer): { contentType: string; extension: string } | null {
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { contentType: "image/jpeg", extension: "jpg" };
  if (buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { contentType: "image/png", extension: "png" };
  if (buffer.length > 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return { contentType: "image/webp", extension: "webp" };
  return null;
}

export function registerSoilHealthRoutes(app: Express, storage: Pick<IStorage, "getParcel">, repository: SoilHealthRepository, authenticated: RequestHandler, active: RequestHandler) {
  const objects = new ObjectStorageService();
  async function access(req: any, res: any, write: boolean) {
    const parcel = await storage.getParcel(req.params.id);
    if (!parcel) { res.status(404).json({ message: "Predio no encontrado" }); return null; }
    const canEdit = parcel.userId === req.user.id || req.user.role === "admin";
    if (!canEdit && (write || !parcel.isPublic)) { res.status(403).json({ message: "No tienes permiso para acceder a esta evaluación" }); return null; }
    return { parcel, canEdit };
  }
  function route(write: boolean, handler: (req: any, res: any, permission: NonNullable<Awaited<ReturnType<typeof access>>>) => Promise<unknown>): RequestHandler {
    return async (req, res) => {
      try {
        res.set({ "Cache-Control": "private, no-store", "Vary": "Cookie" });
        const permission = await access(req, res, write);
        if (permission) await handler(req, res, permission);
      } catch (error) {
        console.error("[soil-health]", error);
        if (!res.headersSent) res.status(500).json({ message: "No se pudo completar la operación de evaluación de campo" });
      }
    };
  }
  async function cleanup(objectPath: string) {
    try {
      await cleanupSoilHealthObject(repository, objectPath, objects);
    } catch (error) {
      // Metadata deletion and queue insertion are atomic. Access is revoked
      // immediately; the worker retries physical deletion after storage outages.
      console.error("[soil-health] private evidence cleanup deferred", error);
    }
  }
  app.get(base, authenticated, active, route(false, async (req, res, { canEdit }) => {
    res.json({ assessments: chronologicalSoilHealth(await repository.list(req.params.id)), canEdit });
  }));
  app.post(base, authenticated, active, route(true, async (req, res) => {
    const result = soilHealthInputSchema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ message: "Datos de evaluación inválidos", errors: result.error.flatten() });
    res.status(201).json(await repository.create(req.params.id, req.user.id, result.data));
  }));
  app.put(`${base}/:assessmentId`, authenticated, active, route(true, async (req, res) => {
    const result = soilHealthInputSchema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ message: "Datos de evaluación inválidos", errors: result.error.flatten() });
    const row = await repository.update(req.params.id, req.params.assessmentId, result.data);
    if (!row) return res.status(404).json({ message: "Evaluación no encontrada" });
    res.json(row);
  }));
  app.delete(`${base}/:assessmentId`, authenticated, active, route(true, async (req, res) => {
    const photos = await repository.remove(req.params.id, req.params.assessmentId);
    if (!photos) return res.status(404).json({ message: "Evaluación no encontrada" });
    await Promise.all(photos.map(p => cleanup(p.objectPath)));
    res.json({ success: true });
  }));
  const evidenceBase = `${base}/:assessmentId/evidence`;
  const parsePhoto: RequestHandler = (req, res, next) => {
    upload.single("photo")(req, res, error => {
      if (error) return res.status(400).json({ message: "Carga inválida. Envía una foto JPEG, PNG o WEBP de hasta 8 MB." });
      next();
    });
  };
  // Authorize before accepting/allocating the multipart body.
  const authorizeUpload = route(true, async (req, res) => {
    if (!await repository.get(req.params.id, req.params.assessmentId)) return res.status(404).json({ message: "Evaluación no encontrada" });
    if (!indicatorIdSchema.safeParse(req.params.indicatorId).success) return res.status(400).json({ message: "Indicador inválido" });
    res.locals.soilHealthUploadAllowed = true;
  });
  app.post(`${evidenceBase}/:indicatorId`, authenticated, active, (req, res, next) => {
    Promise.resolve(authorizeUpload(req, res, next)).then(() => { if (res.locals.soilHealthUploadAllowed) next(); }).catch(next);
  }, parsePhoto, route(true, async (req, res, { parcel }) => {
    const indicator = indicatorIdSchema.parse(req.params.indicatorId);
    const photo = req.file;
    const format = photo && soilHealthPhotoType(photo.buffer);
    if (!photo || !format) return res.status(400).json({ message: "Solo se permiten fotos JPEG, PNG o WEBP" });
    const objectId = randomUUID();
    const objectPath = `/objects/soil-health/${objectId}.${format.extension}`;
    // Record intent BEFORE storage I/O. If DB and storage fail together or the
    // process stops, reconciliation still knows which private object to remove.
    await repository.enqueueCleanup(objectPath, new Date(Date.now() + 60 * 60_000));
    try {
      await objects.savePrivateBuffer({ ownerId: parcel.userId, buffer: photo.buffer, namespace: "soil-health", objectId, ...format });
    } catch (error) {
      // Includes a successful file write followed by ACL metadata failure.
      await cleanup(objectPath);
      throw error;
    }
    try {
      const row = await repository.addEvidence(req.params.assessmentId, indicator, objectPath, photo.originalname.replace(/[\x00-\x1f\x7f/\\]/g, "").slice(0, 200) || `foto.${format.extension}`);
      const { objectPath: hidden, createdAt, ...publicRow } = row;
      res.status(201).json(publicRow);
    } catch (error) {
      // Do not blindly compensate an uncertain DB commit: the transaction
      // removes the intent if evidence was committed, otherwise the worker
      // will delete the orphan once storage/database connectivity recovers.
      throw error;
    }
  }));
  app.get(`${evidenceBase}/:evidenceId`, authenticated, active, route(false, async (req, res) => {
    if (!await repository.get(req.params.id, req.params.assessmentId)) return res.status(404).json({ message: "Evaluación no encontrada" });
    const photo = await repository.getEvidence(req.params.assessmentId, req.params.evidenceId);
    if (!photo) return res.status(404).json({ message: "Foto no encontrada" });
    res.set({ "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Vary": "Cookie" });
    const file = await objects.getObjectEntityFile(photo.objectPath);
    // Zero TTL means authorization is checked on every view after deletion.
    await objects.downloadObject(file, res, 0);
  }));
  app.delete(`${evidenceBase}/:evidenceId`, authenticated, active, route(true, async (req, res) => {
    if (!await repository.get(req.params.id, req.params.assessmentId)) return res.status(404).json({ message: "Evaluación no encontrada" });
    const row = await repository.removeEvidence(req.params.assessmentId, req.params.evidenceId);
    if (!row) return res.status(404).json({ message: "Foto no encontrada" });
    await cleanup(row.objectPath);
    res.json({ success: true });
  }));
}
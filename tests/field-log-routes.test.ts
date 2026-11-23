import express from "express";
import { Readable } from "node:stream";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerFieldLogRoutes } from "../server/routes/field-logs";
import {
  ObjectStorageService,
  objectStorageClient,
} from "../server/replit_integrations/object_storage/objectStorage";

function buildApp(storage: any, user: { id: string; role: string } | null = { id: "owner-1", role: "producer" }) {
  const app = express();
  app.use(express.json());
  const auth = ((req: any, res: any, next: any) => {
    if (!user) return res.status(401).json({ message: "No autenticado" });
    req.user = user;
    next();
  }) as any;
  registerFieldLogRoutes(app, storage, auth, auth);
  return app;
}

function fakeStorage(parcelOwner = "owner-1") {
  return {
    getParcel: vi.fn().mockResolvedValue({ id: "parcel-1", userId: parcelOwner }),
    getCropCycleDetails: vi.fn().mockResolvedValue([]),
    promoteLegacyFieldLogs: vi.fn().mockResolvedValue(undefined),
    listFieldLogs: vi.fn().mockResolvedValue({
      entries: [], total: 0, page: 1, limit: 25,
      summary: {
        totalEntries: 0, statusCounts: {}, activityCounts: {}, categoryCounts: {},
        totalsByCurrency: {}, quantitiesByUnit: {},
      },
    }),
    exportFieldLogs: vi.fn(),
    getFieldLogDetail: vi.fn(),
    getFieldLogBySourceMessage: vi.fn(),
    confirmFieldLog: vi.fn(),
    rejectFieldLog: vi.fn(),
    reviseFieldLog: vi.fn(),
  };
}

describe("Field log routes", () => {
  it.each(["import", "import-preview", "soil-analysis/merge", "soil-analysis/report-repairs"])("denies cross-owner notebook and soil mutation: %s", async action => {
    const storage = fakeStorage("another-owner");
    const path = action.startsWith("soil-analysis/") ? `/api/parcels/parcel-1/${action}`
      : `/api/parcels/parcel-1/field-logs/${action}`;
    expect((await request(buildApp(storage)).post(path).send({})).status).toBe(403);
  });
  it("never imports another parcel's web conversation", async () => {
    const storage = { ...fakeStorage(), getConversationsByParcel: vi.fn().mockResolvedValue([]),
      getMessagesByConversation: vi.fn() };
    const response = await request(buildApp(storage)).post("/api/parcels/parcel-1/field-logs/import-preview")
      .send({ conversationId: "other-parcel-conversation" });
    expect(response.status).toBe(403);
    expect(storage.getMessagesByConversation).not.toHaveBeenCalled();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("isolates parcel owners before listing operational data", async () => {
    const storage = fakeStorage("another-owner");
    const response = await request(buildApp(storage)).get("/api/parcels/parcel-1/field-logs");
    expect(response.status).toBe(403);
    expect(storage.listFieldLogs).not.toHaveBeenCalled();
  });

  it("forwards bounded filters and pagination to the read model", async () => {
    const storage = fakeStorage();
    const response = await request(buildApp(storage)).get(
      "/api/parcels/parcel-1/field-logs?status=confirmed&category=input&from=2026-08-01&to=2026-09-06&page=2&limit=30&search=composta",
    );
    expect(response.status).toBe(200);
    expect(storage.listFieldLogs).toHaveBeenCalledWith("owner-1", "parcel-1", expect.objectContaining({
      status: "confirmed", category: "input", page: 2, limit: 30, search: "composta",
      from: expect.any(Date), to: expect.any(Date),
    }));
  });

  it("exports separate currencies and neutralizes spreadsheet formulas", async () => {
    const storage = fakeStorage();
    storage.exportFieldLogs.mockResolvedValue({
      total: 1, page: 1, limit: 100,
      truncated: false,
      summary: { totalEntries: 1 },
      entries: [{
        id: "log-1", status: "confirmed", occurredAt: new Date("2026-09-06T12:00:00Z"),
        activityType: "aplicación", currentRevision: 2,
        structuredData: {
          observations: "=HYPERLINK(\"bad\")",
          items: [
            { category: "input", name: "=2+2", cost: 200, currency: "MXN" },
            { category: "labor", name: "jornal", cost: 15, currency: "USD" },
          ],
        },
      }],
    });
    const response = await request(buildApp(storage)).get("/api/parcels/parcel-1/field-logs/export.csv");
    expect(response.status).toBe(200);
    expect(response.text).toContain("MXN");
    expect(response.text).toContain("USD");
    expect(response.text).toContain("'=2+2");
    expect(response.text).toContain("'=HYPERLINK");
  });

  it("uses the authenticated owner for detail and terminal actions", async () => {
    const storage = fakeStorage();
    const entry = {
      id: "log-1", userId: "owner-1", status: "pending", missingFields: [],
      currentRevision: 1, structuredData: {}, evidence: [],
    };
    storage.getFieldLogDetail.mockResolvedValue({ entry, revisions: [] });
    storage.confirmFieldLog.mockResolvedValue({ ...entry, status: "confirmed" });
    const response = await request(buildApp(storage))
      .patch("/api/field-logs/log-1")
      .send({ action: "confirm" });
    expect(response.status).toBe(200);
    expect(storage.getFieldLogDetail).toHaveBeenCalledWith("log-1", "owner-1");
    expect(storage.confirmFieldLog).toHaveBeenCalledWith("log-1", "owner-1", expect.stringMatching(/^web:/), 1);
  });

  it("returns a conflict instead of claiming a repeated terminal action succeeded", async () => {
    const storage = fakeStorage();
    storage.getFieldLogDetail.mockResolvedValue({
      entry: {
        id: "log-1", userId: "owner-1", status: "rejected", missingFields: [],
        currentRevision: 2, structuredData: {}, evidence: [],
      },
      revisions: [],
    });
    const response = await request(buildApp(storage))
      .patch("/api/field-logs/log-1")
      .send({ action: "reject" });
    expect(response.status).toBe(409);
    expect(storage.rejectFieldLog).not.toHaveBeenCalled();
  });

  it("reports when a bounded JSON export would be partial", async () => {
    const storage = fakeStorage();
    storage.exportFieldLogs.mockResolvedValue({ entries: [], total: 5_001, truncated: true });
    const response = await request(buildApp(storage)).get("/api/parcels/parcel-1/field-logs/export.json");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ entries: [], total: 5_001, truncated: true });
  });

  it("refuses to download a silently truncated CSV", async () => {
    const storage = fakeStorage();
    storage.exportFieldLogs.mockResolvedValue({ entries: [], total: 5_001, truncated: true });
    const response = await request(buildApp(storage)).get("/api/parcels/parcel-1/field-logs/export.csv");
    expect(response.status).toBe(413);
    expect(response.body.message).toContain("5,000");
  });

  it("keeps private image and audio evidence isolated end to end", async () => {
    const previousPrivateDir = process.env.PRIVATE_OBJECT_DIR;
    process.env.PRIVATE_OBJECT_DIR = "/private-test-bucket/private";
    const objects = new Map<string, {
      body: Buffer;
      metadata: Record<string, any>;
    }>();
    const fileFor = (name: string) => ({
      name,
      exists: vi.fn(async () => [objects.has(name)]),
      save: vi.fn(async (body: Buffer, options: any) => {
        objects.set(name, {
          body: Buffer.from(body),
          metadata: { ...options.metadata, size: String(body.length), metadata: {} },
        });
      }),
      setMetadata: vi.fn(async (update: any) => {
        const current = objects.get(name);
        if (!current) throw new Error("Object not found");
        current.metadata = {
          ...current.metadata,
          ...update,
          metadata: { ...current.metadata.metadata, ...update.metadata },
        };
        return [current.metadata];
      }),
      getMetadata: vi.fn(async () => {
        const current = objects.get(name);
        if (!current) throw new Error("Object not found");
        return [current.metadata];
      }),
      createReadStream: vi.fn(() => {
        const current = objects.get(name);
        if (!current) throw new Error("Object not found");
        return Readable.from(current.body);
      }),
    });
    const files = new Map<string, ReturnType<typeof fileFor>>();
    vi.spyOn(objectStorageClient, "bucket").mockImplementation(((bucketName: string) => ({
      file(objectName: string) {
        const key = `${bucketName}/${objectName}`;
        if (!files.has(key)) files.set(key, fileFor(objectName));
        return files.get(key)!;
      },
    })) as any);

    try {
      const service = new ObjectStorageService();
      const imagePath = await service.savePrivateBuffer({
        ownerId: "owner-1",
        buffer: Buffer.from("private-image"),
        contentType: "image/jpeg",
        namespace: "field-log-evidence",
        extension: "jpg",
        objectId: "image-proof",
      });
      const audioPath = await service.savePrivateBuffer({
        ownerId: "owner-1",
        buffer: Buffer.from("private-audio"),
        contentType: "audio/ogg",
        namespace: "field-log-evidence",
        extension: "ogg",
        objectId: "audio-proof",
      });
      const entry = {
        id: "log-private-1",
        userId: "owner-1",
        status: "confirmed",
        evidence: [
          { path: imagePath, contentType: "image/jpeg", originalName: "sensitive-photo.jpg" },
          { path: audioPath, contentType: "audio/ogg", originalName: "sensitive-audio.ogg" },
        ],
      };
      const storage = fakeStorage();
      storage.getFieldLogDetail.mockImplementation(async (_entryId: string, userId: string) =>
        userId === "owner-1" ? { entry, revisions: [] } : null,
      );

      const ownerApp = buildApp(storage);
      const image = await request(ownerApp).get("/api/field-logs/log-private-1/evidence/0");
      expect(image.status).toBe(200);
      expect(image.headers["content-type"]).toMatch(/^image\/jpeg/);
      expect(image.body).toEqual(Buffer.from("private-image"));
      expect(image.headers["cache-control"]).toBe("private, max-age=0");

      const audio = await request(ownerApp)
        .get("/api/field-logs/log-private-1/evidence/1")
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          res.on("end", () => callback(null, Buffer.concat(chunks)));
        });
      expect(audio.status).toBe(200);
      expect(audio.headers["content-type"]).toMatch(/^audio\/ogg/);
      expect(audio.body).toEqual(Buffer.from("private-audio"));

      const stranger = await request(buildApp(storage, { id: "other-user", role: "producer" }))
        .get("/api/field-logs/log-private-1/evidence/0");
      expect([403, 404]).toContain(stranger.status);
      expect(JSON.stringify(stranger.body)).not.toContain("sensitive-photo.jpg");
      expect(JSON.stringify(stranger.body)).not.toContain(imagePath);

      const anonymous = await request(buildApp(storage, null))
        .get("/api/field-logs/log-private-1/evidence/0");
      expect(anonymous.status).toBe(401);

      expect(imagePath).toBe("/objects/field-log-evidence/image-proof.jpg");
      expect(audioPath).toBe("/objects/field-log-evidence/audio-proof.ogg");
      expect(JSON.stringify(entry)).not.toMatch(/https?:\/\/|signed/i);
      expect(JSON.stringify(Array.from(objects.values()))).not.toMatch(/https?:\/\/|signed_url/i);
    } finally {
      if (previousPrivateDir === undefined) delete process.env.PRIVATE_OBJECT_DIR;
      else process.env.PRIVATE_OBJECT_DIR = previousPrivateDir;
    }
  });
});

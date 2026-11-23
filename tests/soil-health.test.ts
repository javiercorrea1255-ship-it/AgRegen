import express from "express";
import request from "supertest";
import { Readable } from "node:stream";
import { existsSync, readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chronologicalSoilHealth, compareSoilHealth, soilHealthIndicators, soilHealthInputSchema, soilHealthSummary } from "../shared/soil-health";
import { registerSoilHealthRoutes, soilHealthPhotoType } from "../server/routes/soil-health";
import { ObjectStorageService } from "../server/replit_integrations/object_storage/objectStorage";
import { ObjectNotFoundError } from "../server/replit_integrations/object_storage/objectStorage";
import { cleanupSoilHealthObject } from "../server/services/soil-health-cleanup";

const input = { assessmentDate: "2026-10-01", responsible: "Observador", answers: {} };
function fixture(user: any = { id: "owner", role: "farmer" }, isPublic = false) {
  const parcel = { id: "parcel", userId: "owner", isPublic };
  const rows: any[] = [];
  const photos: any[] = [];
  const storage = { getParcel: vi.fn(async (id: string) => id === "parcel" ? parcel : undefined) };
  const repo = {
    list: vi.fn(async (parcelId: string) => rows.filter(r => r.parcelId === parcelId).map(r => ({ ...r, evidence: photos.filter(p => p.assessmentId === r.id).map(({ objectPath, ...p }) => p) }))),
    get: vi.fn(async (parcelId: string, id: string) => rows.find(r => r.parcelId === parcelId && r.id === id)),
    create: vi.fn(async (parcelId: string, authorId: string, data: any) => {
      const row = { ...data, id: `visit-${rows.length + 1}`, parcelId, authorId, catalogueVersion: "1", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), evidence: [] };
      rows.push(row); return row;
    }),
    update: vi.fn(async (parcelId: string, id: string, data: any) => {
      const row = rows.find(r => r.parcelId === parcelId && r.id === id);
      if (row) Object.assign(row, data); return row;
    }),
    remove: vi.fn(async (parcelId: string, id: string) => {
      const idx = rows.findIndex(r => r.parcelId === parcelId && r.id === id);
      if (idx === -1) return undefined;
      rows.splice(idx, 1);
      return photos.filter(p => p.assessmentId === id);
    }),
    addEvidence: vi.fn(async (assessmentId: string, indicatorId: string, objectPath: string, filename: string) => {
      const row = { id: "photo-1", assessmentId, indicatorId, objectPath, filename };
      photos.push(row); return row;
    }),
    getEvidence: vi.fn(async (assessmentId: string, id: string) => photos.find(p => p.assessmentId === assessmentId && p.id === id)),
    removeEvidence: vi.fn(async (assessmentId: string, id: string) => {
      const index = photos.findIndex(p => p.assessmentId === assessmentId && p.id === id);
      if (index === -1) return undefined;
      return photos.splice(index, 1)[0];
    }),
    enqueueCleanup: vi.fn().mockResolvedValue(undefined),
    finishCleanup: vi.fn().mockResolvedValue(undefined),
  };
  const app = express(); app.use(express.json());
  const auth = ((req: any, res: any, next: any) => { if (!user) return res.sendStatus(401); req.user = user; next(); }) as any;
  registerSoilHealthRoutes(app, storage, repo as any, auth, auth);
  return { app, repo, rows, photos, parcel };
}
const url = "/api/parcels/parcel/soil-health";
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
afterEach(() => vi.restoreAllMocks());

describe("Original soil health catalogue and interpretation", () => {
  const privateWorkbook = "attached_assets/Linea_base_de_la_AgRegen5.0_Salud_del_suelo_2_1790887718946.xlsx";
  it.skipIf(process.env.SOIL_HEALTH_PRIVATE_FIXTURE === "0" || !existsSync(privateWorkbook))("preserves all 19 original Excel criteria, names, problems and observation moments verbatim", () => {
    const workbook = XLSX.read(readFileSync(privateWorkbook), { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<any[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
    expect(soilHealthIndicators).toHaveLength(19);
    soilHealthIndicators.forEach((indicator, i) => {
      expect(indicator.name).toBe(rows[i + 2][1]);
      expect(indicator.problem).toBe(rows[i + 2][2] ?? null);
      expect(indicator.timing).toBe(rows[i + 2][3] ?? null);
      expect(indicator.criterion).toBe(rows[i + 2][4]);
    });
  });
  it("does not label an empty assessment 0% health", () => {
    expect(soilHealthSummary({})).toEqual({ fulfilled: 0, evaluated: 0, unevaluated: 19, coverage: 0, percentage: null });
  });
  it("counts only evaluated answers; notes do not imply evaluation", () => {
    expect(soilHealthSummary({ cover: { answer: "yes", notes: "" }, crusts: { answer: "no", notes: "" }, ph: { answer: "unevaluated", notes: "Pending lab" } })).toMatchObject({ fulfilled: 1, evaluated: 2, unevaluated: 17, percentage: 50 });
  });
  it("compares only pairs of answered criteria", () => {
    const comparison = compareSoilHealth({ cover: { answer: "no", notes: "" }, ph: { answer: "yes", notes: "" }, salts: { answer: "yes", notes: "" } }, { cover: { answer: "yes", notes: "" }, ph: { answer: "no", notes: "" }, salts: { answer: "yes", notes: "" } });
    expect(comparison.find(c => c.indicatorId === "cover")?.change).toBe("improved");
    expect(comparison.find(c => c.indicatorId === "ph")?.change).toBe("worsened");
    expect(comparison.find(c => c.indicatorId === "salts")?.change).toBe("unchanged");
    expect(comparison.find(c => c.indicatorId === "roots")?.change).toBe("not-comparable");
  });
  it.each(["2026-02-30", "2026-13-01", "abc", "2026-2-01"])("rejects invalid date %s", assessmentDate => {
    expect(soilHealthInputSchema.safeParse({ ...input, assessmentDate }).success).toBe(false);
  });
  it("defaults missing answers to unevaluated, rejects unknown identifiers and protected fields", () => {
    expect(soilHealthInputSchema.parse({ ...input, answers: { cover: {} } }).answers.cover?.answer).toBe("unevaluated");
    expect(soilHealthInputSchema.safeParse({ ...input, answers: { invented: { answer: "yes" } } }).success).toBe(false);
    expect(soilHealthInputSchema.safeParse({ ...input, parcelId: "other" }).success).toBe(false);
  });
});

describe("Soil-health CRUD and isolation", () => {
  it("requires authentication", async () => {
    expect((await request(fixture(null).app).get(url)).status).toBe(401);
  });
  it.each(["get", "post", "put", "delete"])("blocks another owner on %s", async method => {
    const { app, repo } = fixture({ id: "intruder", role: "farmer" });
    const r = method === "get" ? await request(app).get(url) : method === "post" ? await request(app).post(url).send(input) : method === "put" ? await request(app).put(`${url}/visit-1`).send(input) : await request(app).delete(`${url}/visit-1`);
    expect(r.status).toBe(403); expect(repo.list).not.toHaveBeenCalled(); expect(repo.create).not.toHaveBeenCalled();
  });
  it("permits public parcel reading but never editing", async () => {
    const { app } = fixture({ id: "reader", role: "farmer" }, true);
    expect((await request(app).get(url)).body.canEdit).toBe(false);
    expect((await request(app).post(url).send(input)).status).toBe(403);
  });
  it("allows administration to write", async () => {
    expect((await request(fixture({ id: "admin", role: "admin" }).app).post(url).send(input)).status).toBe(201);
  });
  it("creates empty/partial visits, updates/deletes and dynamically recalculates baseline", async () => {
    const { app } = fixture();
    const later = await request(app).post(url).send(input);
    const earlier = await request(app).post(url).send({ ...input, assessmentDate: "2026-09-01", answers: { cover: { answer: "no" } } });
    expect(later.status).toBe(201); expect(earlier.status).toBe(201);
    let history = (await request(app).get(url)).body.assessments;
    expect(history[0].id).toBe(earlier.body.id);
    expect(soilHealthSummary(history[1].answers).percentage).toBeNull();
    await request(app).put(`${url}/${later.body.id}`).send({ ...input, assessmentDate: "2026-08-01", answers: { cover: { answer: "yes" } } }).expect(200);
    history = (await request(app).get(url)).body.assessments;
    expect(history[0].id).toBe(later.body.id);
    expect(compareSoilHealth(history[0].answers, history[1].answers)[0].change).toBe("worsened");
    await request(app).delete(`${url}/${later.body.id}`).expect(200);
    history = (await request(app).get(url)).body.assessments;
    expect(history[0].id).toBe(earlier.body.id);
    expect(history).toHaveLength(1);
  });
  it("rejects malformed inputs and cross-parcel assessment IDs", async () => {
    const { app, rows } = fixture();
    await request(app).post(url).send({ ...input, responsible: "" }).expect(400);
    rows.push({ id: "foreign", parcelId: "other" });
    await request(app).put(`${url}/foreign`).send(input).expect(404);
    await request(app).delete(`${url}/foreign`).expect(404);
    await request(app).get("/api/parcels/missing/soil-health").expect(404);
  });
  it("uses deterministic same-date ordering without mutating input", () => {
    const records = [{ id: "b", assessmentDate: "2026-01-01", createdAt: "2026-01-01T12:00:00Z" }, { id: "a", assessmentDate: "2026-01-01", createdAt: "2026-01-01T10:00:00Z" }];
    expect(chronologicalSoilHealth(records)[0].id).toBe("a"); expect(records[0].id).toBe("b");
  });
});

describe("Private indicator evidence", () => {
  it("retains a durable deletion job on storage failures, completes it after a retry", async () => {
    const repository = { finishCleanup: vi.fn().mockResolvedValue(undefined) };
    const deleteFile = vi.fn().mockRejectedValueOnce(new Error("storage unavailable")).mockResolvedValueOnce(undefined);
    const objects = { getObjectEntityFile: vi.fn().mockResolvedValue({ delete: deleteFile }) } as any;
    await expect(cleanupSoilHealthObject(repository, "/objects/soil-health/photo.jpg", objects)).rejects.toThrow("storage unavailable");
    expect(repository.finishCleanup).not.toHaveBeenCalled();
    await cleanupSoilHealthObject(repository, "/objects/soil-health/photo.jpg", objects);
    expect(repository.finishCleanup).toHaveBeenCalledOnce();
  });
  it("completes an already-deleted object job and refuses non-soil-health paths", async () => {
    const repository = { finishCleanup: vi.fn().mockResolvedValue(undefined) };
    const objects = { getObjectEntityFile: vi.fn().mockRejectedValue(new ObjectNotFoundError()) } as any;
    await cleanupSoilHealthObject(repository, "/objects/soil-health/photo.jpg", objects);
    expect(repository.finishCleanup).toHaveBeenCalledOnce();
    await expect(cleanupSoilHealthObject(repository, "/objects/uploads/another-feature.jpg", objects)).rejects.toThrow("Invalid");
  });
  it("excludes evaluations and evidence from offline browser caching", () => {
    const sw = readFileSync("client/public/sw.js", "utf8");
    const denied = runInNewContext(`${sw.match(/const API_NEVER_CACHE = \[[\s\S]*?\];/)?.[0]}\nAPI_NEVER_CACHE`);
    for (const path of [url, `${url}/visit-1/evidence/photo-1`]) {
      expect(denied.some((pattern: RegExp) => pattern.test(path))).toBe(true);
    }
  });
  it("rejects HTML/SVG disguised as photos", () => {
    expect(soilHealthPhotoType(Buffer.from("<svg/>"))).toBeNull();
    expect(soilHealthPhotoType(jpeg)?.contentType).toBe("image/jpeg");
  });
  it("denies upload/view/removal before touching object storage on another parcel", async () => {
    const { app, repo } = fixture({ id: "intruder", role: "farmer" });
    await request(app).post(`${url}/visit-1/evidence/cover`).attach("photo", jpeg, "photo.jpg").expect(403);
    await request(app).get(`${url}/visit-1/evidence/photo-1`).expect(403);
    await request(app).delete(`${url}/visit-1/evidence/photo-1`).expect(403);
    expect(repo.getEvidence).not.toHaveBeenCalled(); expect(repo.addEvidence).not.toHaveBeenCalled();
  });
  it("uploads privately, hides object paths, serves after parcel permission check, removes blob", async () => {
    const save = vi.spyOn(ObjectStorageService.prototype, "savePrivateBuffer").mockResolvedValue("/objects/soil-health/private.jpg");
    const remove = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(ObjectStorageService.prototype, "getObjectEntityFile").mockResolvedValue({ delete: remove } as any);
    vi.spyOn(ObjectStorageService.prototype, "downloadObject").mockImplementation(async (_file, res) => { res.type("image/jpeg"); Readable.from(jpeg).pipe(res); });
    const { app } = fixture();
    await request(app).post(url).send(input);
    const photo = await request(app).post(`${url}/visit-1/evidence/cover`).attach("photo", jpeg, "photo.jpg");
    expect(photo.status).toBe(201);
    expect(photo.body.objectPath).toBeUndefined();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ ownerId: "owner", namespace: "soil-health", contentType: "image/jpeg" }));
    const history = (await request(app).get(url)).body;
    expect(history.assessments[0].evidence[0].objectPath).toBeUndefined();
    const view = await request(app).get(`${url}/visit-1/evidence/photo-1`);
    expect(view.status).toBe(200); expect(view.headers["x-content-type-options"]).toBe("nosniff");
    await request(app).delete(`${url}/visit-1/evidence/photo-1`).expect(200);
    expect(remove).toHaveBeenCalledOnce();
    await request(app).get(`${url}/visit-1/evidence/photo-1`).expect(404);
  });
  it("rejects nonexistent assessments, unknown indicators, oversized or fake photos", async () => {
    const { app, repo } = fixture();
    await request(app).post(`${url}/missing/evidence/cover`).attach("photo", jpeg, "photo.jpg").expect(404);
    await request(app).post(url).send(input);
    await request(app).post(`${url}/visit-1/evidence/fake`).attach("photo", jpeg, "photo.jpg").expect(400);
    await request(app).post(`${url}/visit-1/evidence/cover`).attach("photo", Buffer.from("<svg/>"), { filename: "fake.jpg", contentType: "image/jpeg" }).expect(400);
    await request(app).post(`${url}/visit-1/evidence/cover`).attach("photo", Buffer.alloc(8 * 1024 * 1024 + 1), "large.jpg").expect(400);
    expect(repo.addEvidence).not.toHaveBeenCalled();
  });
  it("does not let a photo from a different assessment be viewed or removed", async () => {
    const { app, photos } = fixture();
    await request(app).post(url).send(input);
    photos.push({ id: "foreign", assessmentId: "other-visit", objectPath: "/objects/soil-health/foreign.jpg" });
    await request(app).get(`${url}/visit-1/evidence/foreign`).expect(404);
    await request(app).delete(`${url}/visit-1/evidence/foreign`).expect(404);
  });
  it("records durable intent before upload when persistence fails", async () => {
    vi.spyOn(ObjectStorageService.prototype, "savePrivateBuffer").mockResolvedValue("/objects/soil-health/private.jpg");
    const remove = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(ObjectStorageService.prototype, "getObjectEntityFile").mockResolvedValue({ delete: remove } as any);
    const { app, repo } = fixture(); await request(app).post(url).send(input);
    repo.addEvidence.mockRejectedValueOnce(new Error("persistence failed"));
    await request(app).post(`${url}/visit-1/evidence/cover`).attach("photo", jpeg, "photo.jpg").expect(500);
    expect(remove).not.toHaveBeenCalled();
    expect(repo.enqueueCleanup).toHaveBeenCalledWith(expect.stringMatching(/^\/objects\/soil-health\/.*\.jpg$/), expect.any(Date));
  });
  it("does not upload at all if durable intent cannot be recorded", async () => {
    const save = vi.spyOn(ObjectStorageService.prototype, "savePrivateBuffer").mockResolvedValue("/objects/soil-health/private.jpg");
    const { app, repo } = fixture(); await request(app).post(url).send(input);
    repo.enqueueCleanup.mockRejectedValueOnce(new Error("database unavailable"));
    await request(app).post(`${url}/visit-1/evidence/cover`).attach("photo", jpeg, "photo.jpg").expect(500);
    expect(save).not.toHaveBeenCalled();
  });
  it("compensates storage partial-write/ACL failures using the already recorded path", async () => {
    vi.spyOn(ObjectStorageService.prototype, "savePrivateBuffer").mockRejectedValue(new Error("ACL write failed after upload"));
    const remove = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(ObjectStorageService.prototype, "getObjectEntityFile").mockResolvedValue({ delete: remove } as any);
    const { app, repo } = fixture(); await request(app).post(url).send(input);
    await request(app).post(`${url}/visit-1/evidence/cover`).attach("photo", jpeg, "photo.jpg").expect(500);
    expect(remove).toHaveBeenCalledOnce();
    expect(repo.enqueueCleanup).toHaveBeenCalledOnce();
    expect(repo.addEvidence).not.toHaveBeenCalled();
  });
});
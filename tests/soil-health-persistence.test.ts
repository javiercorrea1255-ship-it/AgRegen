import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, storage } from "../server/storage";
import { parcels, users, soilHealthObjectCleanup, soilHealthEvidence } from "../shared/schema";
import { soilHealthInputSchema, chronologicalSoilHealth } from "../shared/soil-health";
import { soilHealthRepository as repository } from "../server/services/soil-health-repository";

// Explicit opt-in: never mutate a database as part of the generic unit suite.
const enabled = process.env.SOIL_HEALTH_DB_TESTS === "1";
describe.skipIf(!enabled)("Soil-health development persistence", () => {
  let userId: string;
  const parcelIds: string[] = [];
  const objectPaths: string[] = [];
  afterAll(async () => {
    try {
      for (const id of parcelIds) await storage.deleteParcel(id);
      if (userId) await db.delete(users).where(eq(users.id, userId));
      if (objectPaths.length) await db.delete(soilHealthObjectCleanup).where(inArray(soilHealthObjectCleanup.objectPath, objectPaths));
    } finally { await db.$client.end(); }
  });
  it("persists CRUD and atomically queues photo cleanup for evidence, assessment and parcel deletion", async () => {
    const [user] = await db.insert(users).values({ name: "Verification fixture", email: `soil-verification-${randomUUID()}@example.invalid`, passwordHash: "not-a-login" }).returning();
    userId = user.id;
    const [parcel] = await db.insert(parcels).values({ userId, name: "Verification fixture", location: "Verification", latitude: "0", longitude: "0", area: "1", crop: "Maíz" }).returning();
    parcelIds.push(parcel.id);
    const a = await repository.create(parcel.id, userId, soilHealthInputSchema.parse({ assessmentDate: "2026-10-01", responsible: "Verification" }));
    const b = await repository.create(parcel.id, userId, soilHealthInputSchema.parse({ assessmentDate: "2026-09-01", responsible: "Verification", answers: { cover: { answer: "no" } } }));
    expect(chronologicalSoilHealth(await repository.list(parcel.id))[0].id).toBe(b.id);
    await repository.update(parcel.id, a.id, soilHealthInputSchema.parse({ assessmentDate: "2026-08-01", responsible: "Verification", answers: { cover: { answer: "yes" } } }));
    expect(chronologicalSoilHealth(await repository.list(parcel.id))[0].id).toBe(a.id);
    const path = () => { const p = `/objects/soil-health/verification-${randomUUID()}.jpg`; objectPaths.push(p); return p; };
    const evidencePath = path();
    const photo = await repository.addEvidence(a.id, "cover", evidencePath, "verification.jpg");
    const assessmentWithPhoto = (await repository.list(parcel.id)).find(row => row.id === a.id);
    expect(assessmentWithPhoto).toBeDefined();
    expect(assessmentWithPhoto!.evidence.some(e => e.id === photo.id)).toBe(true);
    await repository.removeEvidence(a.id, photo.id);
    expect(await repository.getEvidence(a.id, photo.id)).toBeUndefined();
    expect(await db.select().from(soilHealthObjectCleanup).where(eq(soilHealthObjectCleanup.objectPath, evidencePath))).toHaveLength(1);
    const assessmentPath = path();
    await repository.addEvidence(a.id, "ph", assessmentPath, "verification.jpg");
    await repository.remove(parcel.id, a.id);
    expect(chronologicalSoilHealth(await repository.list(parcel.id))[0].id).toBe(b.id);
    expect(await db.select().from(soilHealthObjectCleanup).where(eq(soilHealthObjectCleanup.objectPath, assessmentPath))).toHaveLength(1);
    expect(await db.select().from(soilHealthEvidence).where(eq(soilHealthEvidence.assessmentId, a.id))).toHaveLength(0);
    const parcelPath = path();
    await repository.addEvidence(b.id, "cover", parcelPath, "verification.jpg");
    expect(await storage.deleteParcel(parcel.id)).toBe(true);
    expect(await repository.list(parcel.id)).toHaveLength(0);
    expect(await db.select().from(soilHealthObjectCleanup).where(eq(soilHealthObjectCleanup.objectPath, parcelPath))).toHaveLength(1);
  });
});
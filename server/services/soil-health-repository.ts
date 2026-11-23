import { and, eq, inArray, lte } from "drizzle-orm";
import { db } from "../storage";
import { soilHealthAssessments as assessments, soilHealthEvidence as evidence, soilHealthObjectCleanup as cleanup } from "@shared/schema";
import type { SoilHealthInput, SoilHealthIndicatorId } from "@shared/soil-health";

export const soilHealthRepository = {
  async list(parcelId: string) {
    const rows = await db.select().from(assessments).where(eq(assessments.parcelId, parcelId));
    const photos = rows.length ? await db.select().from(evidence).where(inArray(evidence.assessmentId, rows.map(r => r.id))) : [];
    return rows.map(row => ({
      ...row,
      evidence: photos.filter(p => p.assessmentId === row.id).map(({ objectPath, createdAt, ...photo }) => photo),
    }));
  },
  async get(parcelId: string, id: string) {
    const [row] = await db.select().from(assessments).where(and(eq(assessments.parcelId, parcelId), eq(assessments.id, id)));
    return row;
  },
  async create(parcelId: string, authorId: string, input: SoilHealthInput) {
    const [row] = await db.insert(assessments).values({ ...input, parcelId, authorId }).returning();
    return { ...row, evidence: [] };
  },
  async update(parcelId: string, id: string, input: SoilHealthInput) {
    const [row] = await db.update(assessments).set({ ...input, updatedAt: new Date() }).where(and(eq(assessments.parcelId, parcelId), eq(assessments.id, id))).returning();
    return row;
  },
  async remove(parcelId: string, id: string) {
    return db.transaction(async tx => {
      // Serialize deletion against evidence uploads using the parent row lock.
      const [row] = await tx.select().from(assessments).where(and(eq(assessments.parcelId, parcelId), eq(assessments.id, id))).for("update");
      if (!row) return undefined;
      const photos = await tx.select().from(evidence).where(eq(evidence.assessmentId, id));
      if (photos.length) await tx.insert(cleanup).values(photos.map(p => ({ objectPath: p.objectPath }))).onConflictDoNothing();
      await tx.delete(assessments).where(eq(assessments.id, id));
      return photos;
    });
  },
  async addEvidence(assessmentId: string, indicatorId: SoilHealthIndicatorId, objectPath: string, filename: string) {
    return db.transaction(async tx => {
      const [row] = await tx.insert(evidence).values({ assessmentId, indicatorId, objectPath, filename }).returning();
      await tx.delete(cleanup).where(eq(cleanup.objectPath, objectPath));
      return row;
    });
  },
  async getEvidence(assessmentId: string, id: string) {
    const [row] = await db.select().from(evidence).where(and(eq(evidence.assessmentId, assessmentId), eq(evidence.id, id)));
    return row;
  },
  async removeEvidence(assessmentId: string, id: string) {
    return db.transaction(async tx => {
      const [row] = await tx.delete(evidence).where(and(eq(evidence.assessmentId, assessmentId), eq(evidence.id, id))).returning();
      if (row) await tx.insert(cleanup).values({ objectPath: row.objectPath }).onConflictDoNothing();
      return row;
    });
  },
  async enqueueCleanup(objectPath: string, notBefore = new Date()) {
    await db.insert(cleanup).values({ objectPath, notBefore }).onConflictDoNothing();
  },
  async pendingCleanup() {
    return db.select().from(cleanup).where(lte(cleanup.notBefore, new Date())).orderBy(cleanup.createdAt).limit(50);
  },
  async finishCleanup(objectPath: string) {
    await db.delete(cleanup).where(eq(cleanup.objectPath, objectPath));
  },
};
export type SoilHealthRepository = typeof soilHealthRepository;
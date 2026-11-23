import { and, eq, sql } from "drizzle-orm";
import { db } from "../storage";
import { soilBiology, type InsertSoilBiology } from "@shared/schema";
import { hasSoilBiologyIndicator, sameSoilBiologyInput } from "@shared/soil-biology-input";

export async function saveSoilBiologyRecord(input: InsertSoilBiology, recordId?: string) {
  if (!hasSoilBiologyIndicator(input)) throw new Error("Captura al menos un indicador o un resultado detectado/no detectado.");
  return db.transaction(async tx => {
    // Serialize repeated Save/New submissions for this parcel, not just this process.
    await tx.execute(sql`SELECT id FROM parcels WHERE id=${input.parcelId} FOR UPDATE`);
    const records = await tx.select().from(soilBiology).where(eq(soilBiology.parcelId, input.parcelId));
    const current = recordId ? records.find(row => row.id === recordId) : undefined;
    if (recordId && !current) throw new Error("Análisis no encontrado en esta parcela.");
    const numeric = ["mbc", "mr", "bg", "nag", "dnaYield", "trichodermaCfu", "fusariumCfu",
      "bacillusCfu", "metarhiziumCfu", "beauveriaCfu"] as const;
    const values = { ...input, ...Object.fromEntries(numeric.map(key =>
      [key, input[key] == null ? null : String(input[key])])) } as typeof soilBiology.$inferInsert;
    const duplicate = records.find(row => row.id !== recordId && sameSoilBiologyInput(row, values));
    if (duplicate) {
      if (recordId) throw new Error("Ya existe un análisis idéntico; conserva el registro existente.");
      return { record: duplicate, created: false };
    }
    if (current) {
      const [record] = await tx.update(soilBiology).set({ ...values, userId: current.userId,
        aiInterpretation: null }).where(and(eq(soilBiology.id, recordId!), eq(soilBiology.parcelId, input.parcelId))).returning();
      return { record, created: false };
    }
    const [record] = await tx.insert(soilBiology).values(values).returning();
    return { record, created: true };
  });
}

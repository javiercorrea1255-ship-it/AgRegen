import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, storage } from "../server/storage";
import { users, parcels, insertSoilAnalysisSchema, insertSoilBiologySchema } from "../shared/schema";
import { microbiologyEvidence } from "../shared/agronomic-evidence";
import { normalizeFieldLogTurn } from "../server/services/field-log-turn";
import { persistWebFieldLog } from "../server/services/web-field-log";
import { projectParcelCosts, summarizeParcelEconomy } from "../server/services/parcel-economy";
import { producerPriceHistory, previousHarvests } from "../server/services/parcel-economy";
import express from "express";
import request from "supertest";
import { registerFieldLogRoutes } from "../server/routes/field-logs";
import { saveSoilBiologyRecord } from "../server/services/soil-biology-records";

// Explicit development-only opt-in, like the existing soil-health persistence suite.
describe.skipIf(process.env.AGRONOMIC_DB_TESTS !== "1")("Agronomic development persistence", () => {
  let userId: string | undefined, parcelId: string | undefined;
  afterAll(async () => {
    try {
      if (parcelId) await storage.deleteParcel(parcelId);
      if (userId) await db.delete(users).where(eq(users.id, userId));
    } finally { await db.$client.end(); }
  });
  it("round-trips precise soil and plate results and creates exactly one auditable web expense", async () => {
    if (process.env.NODE_ENV === "production") throw new Error("Development tests only");
    const [user] = await db.insert(users).values({ name: "Agronomic verification",
      email: `agronomic-verification-${randomUUID()}@example.invalid`, passwordHash: "not-a-login" }).returning();
    userId = user.id;
    const [parcel] = await db.insert(parcels).values({ userId, name: "Agronomic verification",
      location: "Verification", latitude: "0", longitude: "0", area: "1", crop: "Maíz" }).returning();
    parcelId = parcel.id;
    await storage.createSoilAnalysis(insertSoilAnalysisSchema.parse({ parcelId, analysisDate: "2026-02-13",
      ph: "7.18", nitrogenInorganic: "20.08", nitrogenTotal: null, sand: "78.36", silt: "9.28", clay: "12.36" }));
    expect(await storage.getLatestSoilAnalysis(parcelId)).toMatchObject({ ph: "7.18", nitrogenInorganic: "20.08",
      nitrogenTotal: null, sand: "78.36", silt: "9.28", clay: "12.36" });
    await storage.createSoilBiology(insertSoilBiologySchema.parse({ parcelId, userId, sampleDate: "2026-02-13",
      labFolio: "LAB-TEST", labName: "Verification laboratory", microbiologyMethod: "Conteo en placa",
      trichodermaCfu: "2000", fusariumCfu: "100", bacillusCfu: "50000",
      metarhiziumStatus: "not_detected", beauveriaStatus: "counted", beauveriaCfu: "25",
      nitrogenFixersStatus: "not_analyzed" }));
    const biology = (await storage.getSoilBiologyByParcel(parcelId))[0];
    expect(biology).toMatchObject({ labFolio: "LAB-TEST", trichodermaCfu: "2000.00", bacillusCfu: "50000.00",
      metarhiziumStatus: "not_detected", metarhiziumCfu: null, beauveriaCfu: "25.00" });
    expect(microbiologyEvidence(biology)?.trichodermaFusariumRatio).toBe(20);
    const now = new Date();
    const turn = normalizeFieldLogTurn({ kind: "report", response: "", recommendedFieldAction: false,
      record: { activityType: "fertilization", items: [{ category: "input", name: "urea", quantity: 50,
        unit: "kg", cost: 900 }], confidence: .95 } }, now);
    const options = { storage, userId, parcelId, now, sourceId: `web:verification:${randomUUID()}`,
      originalText: "Registra: apliqué 50 kg de urea; costó 900 pesos", response: "", record: turn.record };
    const first = await persistWebFieldLog(options), retry = await persistWebFieldLog(options);
    expect(retry.entry?.id).toBe(first.entry?.id); expect(retry.response).toContain("$900");
    const detail = await storage.getFieldLogDetail(first.entry!.id, userId);
    expect(detail?.revisions).toHaveLength(1); expect(detail?.entry.confirmedAt).toBeNull();
    const logs = await storage.getActiveFieldLogs(userId, parcelId);
    expect(logs).toHaveLength(1);
    expect(summarizeParcelEconomy(projectParcelCosts([], logs, undefined), undefined).byCurrency.MXN.total).toBe(900);
    expect(await storage.getProductionCostsByParcel(parcelId)).toHaveLength(0);
    const context = await storage.getConfirmedFieldLogContext(userId, parcelId, { query: "urea" });
    expect(context.events[0]).toMatchObject({ channel: "Web", activityType: "fertilización" });
  }, 30000);
  it("reviews and repairs report-backed nitrogen then merges exact duplicates through authorized routes", async () => {
    const app = express(); app.use(express.json());
    const auth = ((req: any, _res: any, next: any) => { req.user = { id: userId, role: "producer" }; next(); }) as any;
    registerFieldLogRoutes(app, storage, auth, auth);
    const base = { parcelId, analysisDate: "2026-02-13", ph: "7.15", nitrogenTotal: "0",
      notes: "N total no analizado. N inorgánico (KCl 2N) 20.08 mg/kg." };
    const a = await storage.createSoilAnalysis(insertSoilAnalysisSchema.parse(base));
    const b = await storage.createSoilAnalysis(insertSoilAnalysisSchema.parse({ ...base, nitrogenTotal: "" }));
    expect(b.nitrogenTotal).toBeNull();
    const preview = await request(app).get(`/api/parcels/${parcelId}/soil-analysis/report-repairs`);
    expect(preview.status).toBe(200);
    for (const row of [a, b]) {
      const proposal = preview.body.proposals.find((p: any) => p.id === row.id);
      expect(proposal.changes.nitrogenInorganic).toBe("20.08");
      const repaired = await request(app).post(`/api/parcels/${parcelId}/soil-analysis/report-repairs`)
        .send({ analysisId: row.id, before: proposal.before });
      expect(repaired.status).toBe(200);
      expect(repaired.body.analysis).toMatchObject({ nitrogenTotal: null, nitrogenInorganic: "20.08" });
    }
    const merged = await request(app).post(`/api/parcels/${parcelId}/soil-analysis/merge`).send({ keepId: a.id, duplicateId: b.id });
    expect(merged.status).toBe(200);
    expect(merged.body.analysis.notes).toContain(b.id);
    expect(merged.body.analysis.notes).toContain("copia auditable");
    expect((await storage.getSoilAnalysisByParcel(parcelId!)).some(s => s.id === b.id)).toBe(false);
  });
  it("edits a plate-analysis fixture without adding an empty or duplicate record", async () => {
    const [copy] = await db.insert(parcels).values({ userId: userId!, name: "Pilot test fixture",
      location: "Verification", latitude: "0", longitude: "0", area: ".93", crop: "Maíz" }).returning();
    try {
      const input = insertSoilBiologySchema.parse({ parcelId: copy.id, userId,
        sampleDate: "2025-01-15", depthCm: 20, labFolio: "146", labName: "Laboratorio de verificación",
        microbiologyMethod: "Conteo en placa", trichodermaCfu: 6600, fusariumCfu: 4650, bacillusCfu: 30000,
        metarhiziumStatus: "not_detected", beauveriaStatus: "not_detected", nitrogenFixersStatus: "detected",
        notes: "Organismos cultivables; no diagnóstico." });
      const first = await saveSoilBiologyRecord(input);
      const retries = await Promise.all([saveSoilBiologyRecord(input), saveSoilBiologyRecord(input)]);
      expect(retries.every(saved => saved.record.id === first.record.id && !saved.created)).toBe(true);
      const updated = await saveSoilBiologyRecord({ ...input, notes: "Observaciones revisadas" }, first.record.id);
      expect(updated.record.id).toBe(first.record.id);
      expect(updated.record.sampleDate.toISOString().slice(0, 10)).toBe("2025-01-15");
      expect(microbiologyEvidence(updated.record)?.trichodermaFusariumRatio).toBeCloseTo(1.42, 2);
      expect(await storage.getSoilBiologyByParcel(copy.id)).toHaveLength(1);
      await expect(saveSoilBiologyRecord(insertSoilBiologySchema.parse({
        parcelId: copy.id, userId, sampleDate: "2026-11-18", labName: "Solo metadatos" }))).rejects.toThrow("indicador");
      expect(await storage.getSoilBiologyByParcel(copy.id)).toHaveLength(1);
      await expect(saveSoilBiologyRecord({ ...input, parcelId: parcelId! }, first.record.id)).rejects.toThrow("no encontrado");
    } finally { await storage.deleteParcel(copy.id); }
  });
  it("preserves structured base plans when the text memory summary is refreshed", async () => {
    await storage.saveParcelFertilizationPlan(parcelId!, userId!, "frijol", { fingerprint: "soil-1",
      plan: { crop: "frijol", nutrientsKgHa: { p2o5: [50, 60] } } });
    await storage.upsertParcelMemory(parcelId!, userId!, "Nuevo resumen, sin copiar gastos.");
    await storage.saveParcelFertilizationPlan(parcelId!, userId!, "maiz", { fingerprint: "soil-1", plan: { crop: "maíz" } });
    expect((await storage.getParcelMemory(parcelId!, userId!))?.fertilizationPlans).toMatchObject({
      frijol: { plan: { nutrientsKgHa: { p2o5: [50, 60] } } }, maiz: { plan: { crop: "maíz" } },
    });
  });
  it("requires explicit owner confirmation to clear a legacy zero without report wording, and never clears a nonzero measurement", async () => {
    const record = await storage.createSoilAnalysis(insertSoilAnalysisSchema.parse({
      parcelId, analysisDate: "2026-02-13", nitrogenTotal: 0, notes: "N inorgánico 20.08 mg/kg (KCl 2N)" }));
    const app = express(); app.use(express.json());
    registerFieldLogRoutes(app, storage, (req: any, _res, next) => { req.user = { id: userId }; next(); },
      (_req, _res, next) => next());
    const path = `/api/parcels/${parcelId}/soil-analysis/report-repairs`;
    const before = { nitrogenTotal: record.nitrogenTotal, nitrogenInorganic: record.nitrogenInorganic };
    const unchanged = await request(app).post(path).send({ analysisId: record.id, before });
    expect(unchanged.body.analysis.nitrogenTotal).toBe("0.000");
    const cleared = await request(app).post(path).send({ analysisId: record.id, clearUnreportedTotalN: true,
      before: { nitrogenTotal: unchanged.body.analysis.nitrogenTotal, nitrogenInorganic: unchanged.body.analysis.nitrogenInorganic } });
    expect(cleared.status).toBe(200);
    expect(cleared.body.analysis.nitrogenTotal).toBeNull();
    expect(cleared.body.analysis.nitrogenInorganic).toBe("20.08");
    expect(cleared.body.analysis.notes).toContain("confirmación explícita del usuario");
    const measured = await storage.createSoilAnalysis(insertSoilAnalysisSchema.parse({
      parcelId, analysisDate: "2025-01-17", nitrogenTotal: .15 }));
    const rejected = await request(app).post(path).send({ analysisId: measured.id, clearUnreportedTotalN: true,
      before: { nitrogenTotal: measured.nitrogenTotal, nitrogenInorganic: measured.nitrogenInorganic } });
    expect(rejected.status).toBe(400);
    expect((await storage.getSoilAnalysisByParcel(parcelId!)).find(row => row.id === measured.id)?.nitrogenTotal).toBe("0.150");
  });
  it("corrects civil dates on current entries, reloads and exports them, and leaves undated corrections pending", async () => {
    const app = express(); app.use(express.json());
    const auth = ((req: any, _res: any, next: any) => { req.user = { id: userId, role: "producer" }; next(); }) as any;
    registerFieldLogRoutes(app, storage, auth, auth);
    const imported = await request(app).post(`/api/parcels/${parcelId}/field-logs/import`).send({
      requestId: randomUUID(), source: "texto revisado", text: "urea del 17",
      records: [{ activityType: "fertilización", occurredAt: "2026-11-17", datePrecision: "exact",
        items: [{ category: "input", name: "urea", quantity: 50, unit: "kg", cost: 900 }] }],
    });
    expect(imported.status).toBe(200);
    const entryId = imported.body.entries[0].id;
    const corrected = await request(app).patch(`/api/field-logs/${entryId}`).send({
      action: "correct", correction: { occurredAt: "2026-11-16", structuredData: imported.body.entries[0].structuredData },
    });
    expect(corrected.status).toBe(200);
    expect(corrected.body.entry).toMatchObject({ status: "confirmed", structuredData: { occurredOn: "2026-11-16" } });
    const reloaded = await request(app).get(`/api/field-logs/${entryId}`);
    expect(reloaded.body.entry.structuredData.occurredOn).toBe("2026-11-16");
    expect(reloaded.body.revisions).toHaveLength(2);
    const csv = await request(app).get(`/api/parcels/${parcelId}/field-logs/export.csv`);
    expect(csv.status).toBe(200); expect(csv.text).toContain('"2026-11-16"');
    const undated = await request(app).patch(`/api/field-logs/${entryId}`).send({
      action: "correct", correction: { occurredAt: "", structuredData: reloaded.body.entry.structuredData },
    });
    expect(undated.body.entry).toMatchObject({ status: "pending", occurredAt: null,
      structuredData: { occurredOn: "", datePrecision: "unknown" } });
    expect((await storage.getActiveFieldLogs(userId!, parcelId!)).some(e => e.id === entryId)).toBe(false);
  }, 30000);
  it("also removes an explicitly confirmed expense from active costs when its date is cleared", async () => {
    const app = express(); app.use(express.json());
    const auth = ((req: any, _res: any, next: any) => { req.user = { id: userId, role: "producer" }; next(); }) as any;
    registerFieldLogRoutes(app, storage, auth, auth);
    const draft = await storage.createFieldLogDraft({
      userId: userId!, parcelId: parcelId!, sourceProviderMessageId: `explicit-test:${randomUUID()}`,
      originalText: "Gasto confirmado expresamente", activityType: "fertilización",
      occurredAt: new Date("2026-11-17T18:00:00Z"),
      structuredData: { registration: "explicit", occurredOn: "2026-11-17",
        items: [{ category: "input", name: "Urea explícita", cost: 900, currency: "MXN" }] },
      confidence: 1, missingFields: [], evidence: [],
    });
    const confirmed = await storage.confirmFieldLog(draft.id, userId!, `explicit-confirm:${randomUUID()}`, draft.currentRevision);
    expect(confirmed?.status).toBe("confirmed");
    expect((await storage.getActiveFieldLogs(userId!, parcelId!)).some(e => e.id === draft.id)).toBe(true);
    const corrected = await request(app).patch(`/api/field-logs/${draft.id}`).send({
      action: "correct", correction: { occurredAt: "", structuredData: confirmed!.structuredData },
    });
    expect(corrected.status).toBe(200);
    expect(corrected.body.entry).toMatchObject({ status: "pending", occurredAt: null,
      structuredData: { registration: "explicit", occurredOn: "", datePrecision: "unknown" } });
    for (let reload = 0; reload < 2; reload++) {
      const listed = await request(app).get(`/api/parcels/${parcelId}/field-logs`);
      expect(listed.status).toBe(200);
      expect(listed.body.entries.find((e: any) => e.id === draft.id)).toMatchObject({ status: "pending", occurredAt: null });
    }
    const detail = await storage.getFieldLogDetail(draft.id, userId!);
    expect(detail?.revisions).toHaveLength(3);
    const logs = await storage.getActiveFieldLogs(userId!, parcelId!);
    expect(logs.some(e => e.id === draft.id)).toBe(false);
    expect(projectParcelCosts([], logs).some(row => row.fieldLogEntryId === draft.id)).toBe(false);
    expect(projectParcelCosts([], [corrected.body.entry])).toEqual([]);
  }, 30000);
  it("promotes only dated genuine legacy drafts, never modern explicit or uncertain-date records", async () => {
    const make = (extra: Record<string, unknown>, occurredAt: Date | null) => storage.createFieldLogDraft({
      userId: userId!, parcelId: parcelId!, sourceProviderMessageId: `legacy-test:${randomUUID()}`,
      originalText: "Prueba de migración de bitácora", activityType: "fertilización", occurredAt,
      structuredData: { items: [{ category: "input", name: "Urea", cost: 100, currency: "MXN" }], ...extra },
      confidence: 1, missingFields: occurredAt ? [] : ["fecha"], evidence: [],
    });
    const date = new Date("2026-05-26T18:00:00Z");
    const eligible = await make({}, date);
    const undated = await make({}, null);
    const uncertain = await make({ datePrecision: "unknown" }, date);
    const explicit = await make({ registration: "explicit" }, date);
    await storage.promoteLegacyFieldLogs(userId!, parcelId!);
    expect((await storage.getFieldLogDetail(eligible.id, userId!))?.entry).toMatchObject({ status: "confirmed",
      occurredAt: date, structuredData: { migratedFromLegacy: true } });
    for (const record of [undated, uncertain, explicit]) {
      const after = await storage.getFieldLogDetail(record.id, userId!);
      expect(after?.entry.status).toBe(record.status);
      expect(after?.entry.occurredAt).toEqual(record.occurredAt);
      expect(after?.revisions).toHaveLength(1);
    }
  }, 30000);
  it("imports a reviewed notebook once, excludes undated expenses and preserves harvest profitability", async () => {
    const app = express(); app.use(express.json());
    const auth = ((req: any, _res: any, next: any) => { req.user = { id: userId, role: "producer" }; next(); }) as any;
    registerFieldLogRoutes(app, storage, auth, auth);
    const body = { requestId: randomUUID(), text: "Cuaderno revisado de prueba", source: "revisión de campo",
      records: [
        { activityType: "fertilización", occurredAt: "2026-05-26", datePrecision: "exact",
          items: [{ category: "input", name: "urea", quantity: 75, unit: "kg", cost: 1230 }] },
        { activityType: "gasto", occurredAt: null, datePrecision: "unknown",
          items: [{ category: "input", name: "urea", quantity: 1, unit: "kg", cost: 9999 }] },
        { activityType: "cosecha y venta", occurredAt: "2026-10-01", datePrecision: "exact",
          items: [{ category: "sale", name: "frijol 2026", quantity: 400, unit: "kg", cost: 10400 },
            { category: "labor", name: "Costo del cultivo anterior", cost: 6830 }] },
      ] };
    const first = await request(app).post(`/api/parcels/${parcelId}/field-logs/import`).send(body);
    expect(first.status).toBe(200);
    expect(first.body.entries[1]).toMatchObject({ status: "pending", occurredAt: null });
    const retry = await request(app).post(`/api/parcels/${parcelId}/field-logs/import`).send(body);
    expect(retry.body.entries.map((e: any) => e.id)).toEqual(first.body.entries.map((e: any) => e.id));
    await storage.promoteLegacyFieldLogs(userId!, parcelId!);
    const logs = await storage.getActiveFieldLogs(userId!, parcelId!);
    expect(logs.some(e => e.id === first.body.entries[1].id)).toBe(false);
    expect(producerPriceHistory([], logs).some(p => p.unitPrice === 16.4)).toBe(true);
    expect(previousHarvests(logs)[0]).toMatchObject({ revenue: 10400, cost: 6830, margin: 3570 });
    expect(await storage.getProductionCostsByParcel(parcelId!)).toHaveLength(0);
  });
});

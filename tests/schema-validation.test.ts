import { describe, it, expect } from "vitest";
import {
  insertParcelSchema,
  insertSamplingPointSchema,
  insertCommunityPostSchema,
  insertUserSchema,
} from "../shared/schema";

// ─── insertParcelSchema ───────────────────────────────────────────────────────

describe("insertParcelSchema", () => {
  const validParcel = {
    userId: "user-1",
    name: "Parcela Norte",
    location: "Sonora, México",
    latitude: 28.5,
    longitude: -110.3,
    area: 10.5,
    crop: "maiz",
  };

  it("accepts valid parcel data", () => {
    const result = insertParcelSchema.safeParse(validParcel);
    expect(result.success).toBe(true);
  });

  it("rejects missing name", () => {
    const { name: _, ...rest } = validParcel;
    const result = insertParcelSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing userId", () => {
    const { userId: _, ...rest } = validParcel;
    const result = insertParcelSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects latitude out of range", () => {
    const result = insertParcelSchema.safeParse({ ...validParcel, latitude: 95 });
    expect(result.success).toBe(false);
  });

  it("rejects longitude out of range", () => {
    const result = insertParcelSchema.safeParse({ ...validParcel, longitude: -200 });
    expect(result.success).toBe(false);
  });

  it("rejects non-positive area", () => {
    const result = insertParcelSchema.safeParse({ ...validParcel, area: -5 });
    expect(result.success).toBe(false);
  });

  it("rejects invalid phenological stage", () => {
    const result = insertParcelSchema.safeParse({ ...validParcel, phenologicalStage: "invalid_stage" });
    expect(result.success).toBe(false);
  });

  it("accepts valid phenological stage", () => {
    const result = insertParcelSchema.safeParse({ ...validParcel, phenologicalStage: "floracion" });
    expect(result.success).toBe(true);
  });

  it("accepts valid irrigation system", () => {
    const result = insertParcelSchema.safeParse({ ...validParcel, irrigationSystem: "goteo" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid irrigation system", () => {
    const result = insertParcelSchema.safeParse({ ...validParcel, irrigationSystem: "underground" });
    expect(result.success).toBe(false);
  });
});

// ─── insertSamplingPointSchema ────────────────────────────────────────────────

describe("insertSamplingPointSchema", () => {
  const validPoint = {
    campaignId: "camp-1",
    pointIndex: 0,
    latPlanned: -34.2,
    lonPlanned: -63.5,
  };

  it("accepts valid sampling point", () => {
    const result = insertSamplingPointSchema.safeParse(validPoint);
    expect(result.success).toBe(true);
  });

  it("rejects missing campaignId", () => {
    const { campaignId: _, ...rest } = validPoint;
    const result = insertSamplingPointSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing pointIndex", () => {
    const { pointIndex: _, ...rest } = validPoint;
    const result = insertSamplingPointSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("accepts optional value field", () => {
    const result = insertSamplingPointSchema.safeParse({ ...validPoint, value: 6.8 });
    expect(result.success).toBe(true);
  });

  it("rejects nSubsamples < 1", () => {
    const result = insertSamplingPointSchema.safeParse({ ...validPoint, nSubsamples: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects nSubsamples > 20", () => {
    const result = insertSamplingPointSchema.safeParse({ ...validPoint, nSubsamples: 25 });
    expect(result.success).toBe(false);
  });

  it("accepts nSubsamples within range", () => {
    const result = insertSamplingPointSchema.safeParse({ ...validPoint, nSubsamples: 5 });
    expect(result.success).toBe(true);
  });
});

// ─── insertCommunityPostSchema ────────────────────────────────────────────────

describe("insertCommunityPostSchema", () => {
  const validPost = {
    userId: "user-1",
    title: "Mi experiencia con labranza mínima",
    content: "Después de tres años de reducir labranza los resultados son notables.",
  };

  it("accepts valid community post", () => {
    const result = insertCommunityPostSchema.safeParse(validPost);
    expect(result.success).toBe(true);
  });

  it("rejects invalid post type", () => {
    const result = insertCommunityPostSchema.safeParse({ ...validPost, type: "invalid_type" });
    expect(result.success).toBe(false);
  });

  it("accepts valid post type experience", () => {
    const result = insertCommunityPostSchema.safeParse({ ...validPost, type: "experience" });
    expect(result.success).toBe(true);
  });

  it("accepts valid post type question", () => {
    const result = insertCommunityPostSchema.safeParse({ ...validPost, type: "question" });
    expect(result.success).toBe(true);
  });

  it("rejects title too short (< 3 chars)", () => {
    const result = insertCommunityPostSchema.safeParse({ ...validPost, title: "ab" });
    expect(result.success).toBe(false);
  });

  it("rejects empty content", () => {
    const result = insertCommunityPostSchema.safeParse({ ...validPost, content: "" });
    expect(result.success).toBe(false);
  });

  it("accepts tags array", () => {
    const result = insertCommunityPostSchema.safeParse({ ...validPost, tags: ["ndvi", "suelo"] });
    expect(result.success).toBe(true);
  });

  it("accepts missing optional fields", () => {
    const result = insertCommunityPostSchema.safeParse({ userId: "u1", title: "Titulo valido", content: "Contenido" });
    expect(result.success).toBe(true);
  });
});

// ─── insertUserSchema ─────────────────────────────────────────────────────────

describe("insertUserSchema", () => {
  const validUser = {
    name: "Juan Pérez",
    email: "juan@campo.mx",
    passwordHash: "hashed_password",
    role: "farmer" as const,
  };

  it("accepts valid user", () => {
    const result = insertUserSchema.safeParse(validUser);
    expect(result.success).toBe(true);
  });

  it("rejects invalid email format", () => {
    const result = insertUserSchema.safeParse({ ...validUser, email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid role", () => {
    const result = insertUserSchema.safeParse({ ...validUser, role: "superuser" });
    expect(result.success).toBe(false);
  });

  it("accepts researcher role", () => {
    const result = insertUserSchema.safeParse({ ...validUser, role: "researcher" });
    expect(result.success).toBe(true);
  });

  it("accepts admin role", () => {
    const result = insertUserSchema.safeParse({ ...validUser, role: "admin" });
    expect(result.success).toBe(true);
  });

  it("accepts valid age range", () => {
    const result = insertUserSchema.safeParse({ ...validUser, age: 35 });
    expect(result.success).toBe(true);
  });

  it("rejects age below 15", () => {
    const result = insertUserSchema.safeParse({ ...validUser, age: 10 });
    expect(result.success).toBe(false);
  });

  it("rejects age above 120", () => {
    const result = insertUserSchema.safeParse({ ...validUser, age: 130 });
    expect(result.success).toBe(false);
  });
});

/**
 * Tests for the UI-side import error translation function (T149).
 *
 * `translateImportError` converts structured backend error bodies into
 * actionable Spanish messages shown in the toast inside parcel-import.tsx.
 */
import { describe, it, expect } from "vitest";
import { translateImportError } from "@/lib/import-zone-errors";

describe("translateImportError — ring_not_closed", () => {
  it("mentions the file name in the message", () => {
    const msg = translateImportError(
      { errorCode: "ring_not_closed", zoneIndex: 0 },
      "campo_norte.geojson",
    );
    expect(msg).toContain('"campo_norte.geojson"');
  });

  it("includes the 1-based zone number when zoneIndex is provided", () => {
    const msg = translateImportError(
      { errorCode: "ring_not_closed", zoneIndex: 2 },
      "lote.geojson",
    );
    // zoneIndex 2 → zona 3
    expect(msg).toContain("zona 3");
  });

  it("does not include a zone reference when zoneIndex is null", () => {
    const msg = translateImportError(
      { errorCode: "ring_not_closed", zoneIndex: null },
      "lote.geojson",
    );
    expect(msg).not.toMatch(/zona \d/);
  });

  it("instructs the user to re-export from their GIS", () => {
    const msg = translateImportError(
      { errorCode: "ring_not_closed", zoneIndex: 0 },
      "any.geojson",
    );
    expect(msg.toLowerCase()).toContain("sig");
  });

  it("uses a generic file reference when fileName is null", () => {
    const msg = translateImportError(
      { errorCode: "ring_not_closed", zoneIndex: 0 },
      null,
    );
    expect(msg).toContain("el archivo");
    expect(msg).not.toContain('"null"');
  });
});

describe("translateImportError — non_finite_coord", () => {
  it("mentions the file name in the message", () => {
    const msg = translateImportError(
      { errorCode: "non_finite_coord", zoneIndex: 0 },
      "datos.geojson",
    );
    expect(msg).toContain('"datos.geojson"');
  });

  it("includes the 1-based zone number when zoneIndex is provided", () => {
    const msg = translateImportError(
      { errorCode: "non_finite_coord", zoneIndex: 4 },
      "datos.geojson",
    );
    expect(msg).toContain("zona 5");
  });

  it("mentions Infinity or NaN to help the user understand the problem", () => {
    const msg = translateImportError(
      { errorCode: "non_finite_coord", zoneIndex: 0 },
      "any.geojson",
    );
    expect(msg).toMatch(/infinity|nan/i);
  });
});

describe("translateImportError — validation_error (fallback)", () => {
  it("returns the server message when errorCode is validation_error", () => {
    const serverMessage = "Validation error: missing required field at [0]";
    const msg = translateImportError(
      { errorCode: "validation_error", zoneIndex: null, message: serverMessage },
      "test.geojson",
    );
    expect(msg).toBe(serverMessage);
  });

  it("returns the server message when errorCode is missing (unknown backend version)", () => {
    const serverMessage = "Something went wrong on the server";
    const msg = translateImportError(
      { message: serverMessage },
      "test.geojson",
    );
    expect(msg).toBe(serverMessage);
  });

  it("returns a default message when both errorCode and message are absent", () => {
    const msg = translateImportError({}, "test.geojson");
    expect(typeof msg).toBe("string");
    expect(msg.length).toBeGreaterThan(0);
  });
});

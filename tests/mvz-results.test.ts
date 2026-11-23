import { describe, expect, it, vi, afterEach } from "vitest";
import { associateResiduals, linearQuantile, normalizeMvzZones, sampleCoordinates, variogramCurve } from "../client/src/lib/mvz-results";
import { computeSampleSize, fetchSampleSize } from "../shared/sample-size";

afterEach(() => vi.unstubAllGlobals());

describe("MVZ result lineage and scales", () => {
  it("preserves re-run zone geometries and statistics in the map's client format", () => {
    const geometry = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
    const [zone] = normalizeMvzZones([{ zone_index: 1, zone_label: "Alta", geojson: geometry,
      area_ha: 2.5, value_mean: 2.7, color: "#44986D" }]);
    expect(zone.polygonGeojson).toEqual(geometry);
    expect(zone).toMatchObject({ zoneIndex: 1, zoneLabel: "Alta", areaHa: "2.5", valueMean: "2.7", colorHex: "#44986D" });
    expect(normalizeMvzZones([zone])[0]).toBe(zone);
  });
  it("prefers real GPS, including zero, and uses planned only as fallback", () => {
    expect(sampleCoordinates({ latActual: 0, lonActual: -100, latPlanned: 20, lonPlanned: -101 }))
      .toEqual({ lat: 0, lon: -100 });
    expect(sampleCoordinates({ latActual: null, lonActual: "", latPlanned: "20", lonPlanned: "-101" }))
      .toEqual({ lat: 20, lon: -101 });
  });
  it("interpolates quartiles linearly, including four samples", () => {
    expect(linearQuantile([0, 10, 20, 30], .25)).toBe(7.5);
    expect(linearQuantile([0, 10, 20, 30], .75)).toBe(22.5);
  });
  it("binds residuals by original index, not filtered position", () => {
    const points = ["a", "b", "c"].map((id, i) => ({ id, latActual: i, lonActual: i }));
    const result = associateResiduals([
      { original_index: 2, lat: 2, lon: 2 },
      { original_index: 1, excluded: true, lat: 1, lon: 1 },
      { original_index: 0, lat: 0, lon: 0 },
    ], points);
    expect(result.map(r => r.pointId)).toEqual(["c", "a"]);
  });
  it("uses coordinate identity for legacy residuals instead of positional guesses", () => {
    const result = associateResiduals([{ lat: 2, lon: 3 }], [
      { id: "wrong", latActual: 1, lonActual: 1 },
      { id: "right", latActual: 2, lonActual: 3 },
    ]);
    expect(result[0].pointId).toBe("right");
  });
  it("matches the PyKrige spherical, exponential and Gaussian range conventions", () => {
    for (const model of ["spherical", "exponential", "gaussian"]) {
      const curve = variogramCurve({ model, psill: .25, nugget: .02, sill: .27, range: 120 });
      expect(curve[0].gamma).toBe(.02);
      const p = curve.find(p => p.h >= 120)!;
      expect(p.gamma).toBeGreaterThan(model === "spherical" ? .269 : .256);
      expect(p.gamma).toBeLessThanOrEqual(.27);
    }
  });
});

describe("mapping sample size", () => {
  it("sends the catalog spatial range and session credentials", async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        n_recommended: 30, n_cochran: 10, n_fao: 10, n_cressie_wikle: 4,
        params: {}, params_used: { cv_pct: 30, precision_pct: 20, range_m: 150, z_score: 1.645, confidence_level: 90, prior_source: "agronomic_prior" },
      }),
    });
    vi.stubGlobal("fetch", mock);
    await fetchSampleSize({ areaHa: 9, polygon: [[0, 0], [1, 0], [1, 1]], variableCode: "P" });
    const init = mock.mock.calls[0][1];
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body)).toMatchObject({ range_m: 150, purpose: "mapping" });
  });
  it("does not fall back to ten mapping samples or cap dense grids at eighty", () => {
    expect(computeSampleSize({ areaHa: 9, allowableError: 20 }).recommended).toBeGreaterThanOrEqual(30);
    expect(computeSampleSize({ areaHa: 9, spatialRangeM: 30 }).recommended).toBeGreaterThanOrEqual(400);
    expect(computeSampleSize({ areaHa: 9, allowableError: 20, purpose: "mean" }).recommended).toBeLessThan(30);
  });
});

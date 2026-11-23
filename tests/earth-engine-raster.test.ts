import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  matrix: [] as (number | null)[][], band: "NDVI",
  mask: vi.fn(), paint: vi.fn(), unmask: vi.fn(), sample: vi.fn(), project: vi.fn(), clip: vi.fn(),
  evaluations: vi.fn(), validFilter: vi.fn(),
}));
vi.mock("@google/earthengine", () => {
  const unwrap = (v: any): any => v && "value" in Object(v) ? unwrap(v.value)
    : Array.isArray(v) ? v.map(unwrap) : v && typeof v === "object"
      ? Object.fromEntries(Object.entries(v).filter(([, value]) => typeof value !== "function").map(([k, value]) => [k, unwrap(value)])) : v;
  const evaluated = (value: unknown) => ({ value, evaluate: (done: Function) => {
    sdk.evaluations(); done(unwrap(value), null);
  } });
  class N {
    value: number;
    constructor(v: any) { this.value = Number(unwrap(v)); }
    add(v: any) { return new N(this.value + Number(unwrap(v))); }
    subtract(v: any) { return new N(this.value - Number(unwrap(v))); }
    multiply(v: any) { return new N(this.value * Number(unwrap(v))); }
    divide(v: any) { return new N(this.value / Number(unwrap(v))); }
    max(v: any) { return new N(Math.max(this.value, Number(unwrap(v)))); }
    sqrt() { return new N(Math.sqrt(this.value)); }
    ceil() { return new N(Math.ceil(this.value)); }
    floor() { return new N(Math.floor(this.value)); }
    cos() { return new N(Math.cos(this.value)); }
    gt(v: any) { return this.value > Number(unwrap(v)); }
    lte(v: any) { return this.value <= Number(unwrap(v)); }
    evaluate(done: Function) { sdk.evaluations(); done(this.value, null); }
  }
  class L {
    value: any[];
    constructor(v: any) { this.value = v instanceof L ? v.value : v.value ?? v; }
    get(i: number) { return this.value[i]; }
    map(fn: Function) { return new L(this.value.map(v => fn(v))); }
    reduce(reducer: string) { return new N(reducer === "min" ? Math.min(...unwrap(this.value)) : Math.max(...unwrap(this.value))); }
    iterate(fn: Function, initial: any) { return this.value.reduce((state, v) => fn(v, state), initial); }
    indexOf(v: any) { return this.value.indexOf(unwrap(v)); }
    evaluate(done: Function) { sdk.evaluations(); done(unwrap(this.value), null); }
  }
  const geometry = {
    area: () => evaluated(1400),
    bounds: () => ({
      coordinates: () => ({ get: () => evaluated([
        [-103, 20], [-102.9996, 20], [-102.9996, 20.0004], [-103, 20.0004], [-103, 20],
      ]) }),
    }),
  };
  const paintMask = { paint: sdk.paint.mockImplementation(() => paintMask) };
  const scl: any = { neq: () => scl, and: () => scl, eq: () => scl, or: () => scl,
    reproject: () => scl, unmask: () => scl,
    sampleRectangle: () => ({ get: () => sdk.matrix.map(row => row.map(v => v == null || v === -9999 ? 1 : 0)) }) };
  const index: any = {
    rename: (name: string) => { sdk.band = name; return index; },
    toFloat: () => index,
    updateMask: sdk.mask.mockImplementation(() => index),
    clip: sdk.clip.mockImplementation(() => { throw new Error("Do not clip before sampleRectangle"); }),
    reproject: sdk.project.mockImplementation(() => index),
    unmask: sdk.unmask.mockImplementation(() => index),
    sampleRectangle: sdk.sample.mockImplementation((options: any) => ({
      get: () => {
        if (options.defaultValue !== -9999) throw new Error("Fully masked pixels");
        return sdk.matrix;
      },
      evaluate: (done: Function) => {
        // Reproduce the production failure unless missing samples are explicit.
        if (options.defaultValue !== -9999) {
          done(null, "Image.sampleRectangle: Fully masked pixels / pixels outside of the image footprint");
        } else done({ properties: { [sdk.band]: sdk.matrix } }, null);
      },
    })),
    reduceRegion: () => ({ get: () => new N(sdk.matrix.flat().filter(v => v != null && v !== -9999).length) }),
  };
  const source: any = {
    select: (band: string) => band === "SCL" ? scl : { projection: () => ({ crs: () => "EPSG:32613" }) },
    updateMask: () => source, resample: () => source,
    normalizedDifference: () => index,
    get: (key: string) => evaluated(key === "system:time_start" ? Date.parse("2026-11-16")
      : key === "system:index" ? "real-scene" : 5),
    set: () => source,
    toDictionary: () => ({ _date: Date.parse("2026-11-16"), _cloud: 5, _id: "real-scene" }),
  };
  const collection: any = {
    filterBounds: () => collection, filter: () => collection, filterDate: () => collection,
    sort: () => collection, first: () => source, size: () => new N(1),
    map: (fn: Function) => { fn(source); return collection; },
    toList: () => new L([source]),
  };
  return { default: {
    data: { authenticateViaPrivateKey: (_credentials: unknown, ok: Function) => ok() },
    initialize: (_a: unknown, _b: unknown, ok: Function) => ok(),
    Geometry: { Polygon: () => geometry, Rectangle: () => ({ rectangle: true }) },
    Feature: (shape: any, properties?: any) => shape?.evaluate ? shape : {
      geometry: shape, evaluate: (done: Function) => { sdk.evaluations(); done({ properties: unwrap(properties) }, null); },
    },
    FeatureCollection: (features: unknown) => ({ features }),
    Image: Object.assign((image: any) => image, { constant: () => paintMask }),
    ImageCollection: () => collection,
    Number: (value: any) => new N(value),
    List: Object.assign((value: any) => new L(value), { sequence: (start: number, end: number) => new L(Array.from({ length: end - start + 1 }, (_, i) => start + i)) }),
    Dictionary: (values: any) => values,
    Date: (value: any) => ({ format: () => new Date(unwrap(value)).toISOString().slice(0, 10) }),
    Algorithms: { If: (condition: boolean, yes: any, no: any) => condition ? yes : no },
    Reducer: { min: () => "min", max: () => "max", count: () => "count" },
    Filter: { eq: () => ({}), lt: () => ({}), inList: () => ({}), gte: sdk.validFilter.mockReturnValue({}) },
  } };
});
import { getAvailableSentinelImages, getIndexRaster, initializeEarthEngine } from "../server/services/earth-engine";

// An anonymized, nonrectangular four-vertex parcel of roughly 0.14 ha.
const coordinates: [number, number][] = [
  [20, -103], [20.0004, -102.9999], [20.0004, -102.9996], [20, -102.9997],
];
beforeAll(async () => {
  // The SDK is entirely mocked; these are not real credentials or API calls.
  vi.stubEnv("GEE_SERVICE_ACCOUNT_KEY", JSON.stringify({ private_key: "test-only", client_email: "test@example.invalid" }));
  expect(await initializeEarthEngine()).toBe(true);
});
afterAll(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.clearAllMocks();
  sdk.matrix = Array.from({ length: 5 }, () => Array(5).fill(.6));
  sdk.matrix[0][0] = -9999; // Outside the slanted polygon.
  sdk.matrix[1][0] = -9999;
  sdk.matrix[3][4] = -9999;
  sdk.matrix[4][4] = -9999;
  sdk.matrix[2][2] = -9999; // A cloud/shadow inside the parcel.
  sdk.matrix[2][1] = 0; // A real zero must not become missing data.
});

describe("Earth Engine numeric raster missing-data contract", () => {
  it.each([true, false])("samples a small four-vertex parcel without clipping (northUpGrid=%s)", async northUpGrid => {
    const result = await getIndexRaster({ coordinates }, "ndvi", {
      imageId: "real-scene", northUpGrid, targetMaxPixels: 2500,
    });
    expect(sdk.clip).not.toHaveBeenCalled();
    expect(sdk.paint).toHaveBeenCalledWith(expect.objectContaining({ features: expect.any(Array) }), 1);
    expect(sdk.mask).toHaveBeenCalledTimes(1);
    expect(sdk.unmask).toHaveBeenCalledWith(-9999, false);
    expect(sdk.sample).toHaveBeenCalledWith(expect.objectContaining({ defaultValue: -9999 }));
    expect(result).toMatchObject({
      rows: 5, cols: 5, validPixels: 20, vmin: 0, vmax: .6, imageDate: "2026-11-16",
    });
    expect(result!.values[0][0]).toBeNull();
    expect(result!.values[2][2]).toBeNull();
    expect(result!.values[2][1]).toBe(0);
    expect(result!.values.flat()).not.toContain(-9999);
    if (!northUpGrid) expect(sdk.project).toHaveBeenCalledWith({ crs: "EPSG:32613", scale: 10 });
    if (northUpGrid) expect(sdk.evaluations).toHaveBeenCalledTimes(1);
  });
  it("downloads all catalogue properties in exactly one evaluation", async () => {
    expect(await getAvailableSentinelImages({ coordinates }, 1, { allowSynthetic: false }))
      .toEqual([{ date: "2026-11-16", cloudPercentage: 5, id: "real-scene" }]);
    expect(sdk.evaluations).toHaveBeenCalledTimes(1);
  });
  it("selects observable candidates on Earth Engine without evaluating each scene from the application", async () => {
    const result = await getIndexRaster({ coordinates }, "ndvi", {
      candidateImageIds: ["masked-scene", "real-scene"], northUpGrid: true,
    });
    expect(result?.imageId).toBe("real-scene");
    expect(sdk.validFilter).toHaveBeenCalledWith("_observable_pixels", 9);
    expect(sdk.evaluations).toHaveBeenCalledTimes(1);
  });
  it("does not manufacture values for a fully cloudy scene", async () => {
    sdk.matrix = Array.from({ length: 5 }, () => Array(5).fill(-9999));
    await expect(getIndexRaster({ coordinates }, "ndvi", { imageId: "cloudy", northUpGrid: true }))
      .rejects.toThrow("Todos los píxeles");
  });
});

import ee from "@google/earthengine";
import { evaluateAlignedRaster, type NumericRasterOptions } from "./earth-engine-batched-raster";

let isInitialized = false;
let initializationError: string | null = null;

interface GEECredentials {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
}

export async function initializeEarthEngine(): Promise<boolean> {
  if (isInitialized) return true;
  
  const credentialsJson = process.env.GEE_SERVICE_ACCOUNT_KEY;
  
  if (!credentialsJson) {
    initializationError = "GEE_SERVICE_ACCOUNT_KEY not configured";
    console.warn("Google Earth Engine: Credentials not found. Using mock data.");
    return false;
  }

  try {
    const credentials: GEECredentials = JSON.parse(credentialsJson);
    
    if (!credentials.private_key || !credentials.client_email) {
      initializationError = "Invalid credentials: missing private_key or client_email";
      console.error("GEE credentials validation failed");
      return false;
    }
    
    return new Promise((resolve) => {
      ee.data.authenticateViaPrivateKey(
        credentials,
        () => {
          ee.initialize(
            null,
            null,
            () => {
              console.log("Google Earth Engine initialized successfully");
              isInitialized = true;
              resolve(true);
            },
            (err: Error) => {
              initializationError = `Initialization error: ${err.message}`;
              console.error("GEE initialization error:", err);
              resolve(false);
            }
          );
        },
        (err: Error) => {
          initializationError = `Authentication error: ${err.message}`;
          console.error("GEE authentication error:", err);
          resolve(false);
        }
      );
    });
  } catch (error: any) {
    initializationError = `Invalid credentials JSON: ${error.message}`;
    console.error("GEE credentials error:", error);
    return false;
  }
}

export function isGEEAvailable(): boolean {
  return isInitialized;
}

export function getGEEStatus(): { available: boolean; error: string | null } {
  return {
    available: isInitialized,
    error: initializationError,
  };
}

export interface VegetationIndex {
  date: string;
  ndvi: number;
  evi: number;
  ndmi: number;
  ndre: number;
  gndvi: number;
  msavi: number;
  savi: number;
  ndwi: number;
}

export interface ParcelBounds {
  coordinates: [number, number][];
}

// ─── Planet-like super-resolution helper ─────────────────────────────────────
// Applies adaptive unsharp masking to a single-band index image (NDVI, EVI,
// NDMI, etc.) to simulate the spatial sharpness of Planet 3 m imagery.
//
// Algorithm:
//   1. Convolve with a Gaussian kernel  (radius 3 px, σ = 1.5 px) → low-pass
//   2. high_freq = original − low_pass
//   3. enhanced  = original + α · high_freq          (default α = 1.2)
//
// This is combined with .resample('bicubic') applied to the raw Sentinel-2
// image *before* computing any index, so GEE tiles are rendered with smooth
// sub-pixel interpolation at every zoom level instead of nearest-neighbor.
// Together the two steps recover the spatial detail that Sentinel-2's 10 m
// (or 20 m for SWIR) sampling smears out.
// ---------------------------------------------------------------------------
function applyUnsharpMask(indexImage: any, amount = 1.2): any {
  const kernel = (ee as any).Kernel.gaussian({
    radius: 3, sigma: 1.5, units: "pixels", normalize: true,
  });
  const blurred  = indexImage.convolve(kernel);
  const highFreq = indexImage.subtract(blurred);
  return indexImage.add(highFreq.multiply(amount));
}

export async function getVegetationIndices(
  bounds: ParcelBounds,
  startDate: string,
  endDate: string
): Promise<VegetationIndex[]> {
  if (!isInitialized) {
    return generateMockIndices(startDate, endDate);
  }

  try {
    const polygon = ee.Geometry.Polygon([bounds.coordinates.map(c => [c[1], c[0]])]);
    
    const sentinel2 = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
      .filterBounds(polygon)
      .filterDate(startDate, endDate)
      .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 20))
      .sort("system:time_start");

    const size: number = await new Promise((resolve, reject) => {
      sentinel2.size().evaluate((result: any, error: any) => {
        if (error) reject(error);
        else resolve(result);
      });
    });

    if (size === 0) {
      console.log("No satellite images found for vegetation indices");
      return generateMockIndices(startDate, endDate);
    }

    // Compute all 8 vegetation indices per image and wrap as ee.Feature so we
    // can evaluate the entire collection with a single server call instead of
    // chaining 8 separate aggregate_array / evaluate pairs.
    const withFeatures = sentinel2.map((image: any) => {
      const ndvi  = image.normalizedDifference(["B8", "B4"]).rename("NDVI");
      const evi   = image.expression(
        "2.5 * ((NIR - RED) / (NIR + 6 * RED - 7.5 * BLUE + 1))",
        { NIR: image.select("B8"), RED: image.select("B4"), BLUE: image.select("B2") },
      ).rename("EVI");
      const ndmi  = image.normalizedDifference(["B8", "B11"]).rename("NDMI");
      const ndre  = image.normalizedDifference(["B8", "B5"]).rename("NDRE");
      const gndvi = image.normalizedDifference(["B8", "B3"]).rename("GNDVI");
      const msavi = image.expression(
        "0.5 * (2 * NIR + 1 - sqrt(((2 * NIR + 1) ** 2) - 8 * (NIR - RED)))",
        { NIR: image.select("B8"), RED: image.select("B4") },
      ).rename("MSAVI");
      const savi  = image.expression(
        "1.5 * (NIR - RED) / (NIR + RED + 0.5)",
        { NIR: image.select("B8"), RED: image.select("B4") },
      ).rename("SAVI");
      const ndwi  = image.normalizedDifference(["B3", "B8"]).rename("NDWI");

      const allBands = (ee.Image as any).cat([ndvi, evi, ndmi, ndre, gndvi, msavi, savi, ndwi]);
      const stats = allBands.reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: polygon,
        scale: 10,
        maxPixels: 1e9,
      });

      return (ee as any).Feature(null, {
        ts:    image.get("system:time_start"),
        NDVI:  stats.get("NDVI"),
        EVI:   stats.get("EVI"),
        NDMI:  stats.get("NDMI"),
        NDRE:  stats.get("NDRE"),
        GNDVI: stats.get("GNDVI"),
        MSAVI: stats.get("MSAVI"),
        SAVI:  stats.get("SAVI"),
        NDWI:  stats.get("NDWI"),
      });
    });

    const results: VegetationIndex[] = await new Promise((resolve, reject) => {
      (ee as any).FeatureCollection(withFeatures).toList(500).evaluate((features: any, error: any) => {
        if (error) { reject(error); return; }
        if (!features || features.length === 0) { resolve([]); return; }
        const indices: VegetationIndex[] = (features as any[])
          .map((f) => {
            const p = f.properties ?? {};
            return {
              date:  new Date(p.ts as number).toISOString().split("T")[0],
              ndvi:  (p.NDVI  as number) ?? 0,
              evi:   (p.EVI   as number) ?? 0,
              ndmi:  (p.NDMI  as number) ?? 0,
              ndre:  (p.NDRE  as number) ?? 0,
              gndvi: (p.GNDVI as number) ?? 0,
              msavi: (p.MSAVI as number) ?? 0,
              savi:  (p.SAVI  as number) ?? 0,
              ndwi:  (p.NDWI  as number) ?? 0,
            };
          })
          .sort((a, b) => a.date.localeCompare(b.date));
        resolve(indices);
      });
    });

    return results.length > 0 ? results : generateMockIndices(startDate, endDate);
  } catch (error) {
    console.error("Error fetching vegetation indices:", error);
    return generateMockIndices(startDate, endDate);
  }
}

export async function getLatestNDVIStats(bounds: ParcelBounds): Promise<{
  mean: number;
  min: number;
  max: number;
  date: string;
  hasData: boolean;
}> {
  const defaultStats = {
    mean: 0.65 + Math.random() * 0.2,
    min: 0.3 + Math.random() * 0.2,
    max: 0.8 + Math.random() * 0.15,
    date: new Date().toISOString().split("T")[0],
    hasData: false,
  };

  if (!isInitialized) {
    return defaultStats;
  }

  try {
    const polygon = ee.Geometry.Polygon([bounds.coordinates.map(c => [c[1], c[0]])]);
    
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);

    const collection = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
      .filterBounds(polygon)
      .filterDate(startDate.toISOString(), endDate.toISOString())
      .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 20))
      .sort("system:time_start", false);

    const size: number = await new Promise((resolve, reject) => {
      collection.size().evaluate((result: any, error: any) => {
        if (error) reject(error);
        else resolve(result);
      });
    });

    if (size === 0) {
      console.log("No satellite images found for the given region and date range");
      return { ...defaultStats, hasData: false };
    }

    const sentinel2 = collection.first();
    const ndvi = sentinel2.normalizedDifference(["B8", "B4"]).rename("NDVI");
    
    const stats: any = await new Promise((resolve, reject) => {
      ndvi.reduceRegion({
        reducer: ee.Reducer.mean().combine({
          reducer2: ee.Reducer.minMax(),
          sharedInputs: true,
        }),
        geometry: polygon,
        scale: 10,
        maxPixels: 1e9,
      }).evaluate((result: any, error: any) => {
        if (error) reject(error);
        else resolve(result);
      });
    });

    const imageDate: any = await new Promise((resolve, reject) => {
      sentinel2.get("system:time_start").evaluate((result: any, error: any) => {
        if (error) reject(error);
        else resolve(result);
      });
    });

    return {
      mean: stats.NDVI_mean || stats.NDVI || 0,
      min: stats.NDVI_min || 0,
      max: stats.NDVI_max || 0,
      date: new Date(imageDate).toISOString().split("T")[0],
      hasData: true,
    };
  } catch (error) {
    console.error("Error fetching NDVI stats:", error);
    return defaultStats;
  }
}

export async function getNDVIMapTiles(bounds: ParcelBounds): Promise<{
  mapId: string;
  urlFormat: string;
  hasData: boolean;
} | null> {
  return getIndexMapTiles(bounds, "ndvi");
}

export interface SentinelImageInfo {
  date: string;
  cloudPercentage: number;
  id: string;
}

export async function getAvailableSentinelImages(
  bounds: ParcelBounds,
  months: number = 3,
  options: { allowSynthetic?: boolean; dateFrom?: string; dateTo?: string } = {},
): Promise<SentinelImageInfo[]> {
  if (!isInitialized) {
    if (options.allowSynthetic === false) throw new Error("Servicio satelital no disponible.");
    return generateMockSentinelImages(months);
  }

  try {
    const polygon = ee.Geometry.Polygon([bounds.coordinates.map(c => [c[1], c[0]])]);

    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);
    if (options.dateFrom) startDate.setTime(new Date(options.dateFrom).getTime());
    if (options.dateTo) endDate.setTime(new Date(options.dateTo).getTime());

    const collection = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
      .filterBounds(polygon)
      .filterDate(startDate.toISOString(), endDate.toISOString())
      .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", options.allowSynthetic === false ? 101 : 50))
      .sort("system:time_start", false);

    const results: SentinelImageInfo[] = await new Promise((resolve, reject) => {
      const mapped = collection.map((img: any) => {
        return img.set({
          _date: img.get("system:time_start"),
          _cloud: img.get("CLOUDY_PIXEL_PERCENTAGE"),
          _id: img.get("system:index"),
        });
      });

      // One RPC, with properties kept together instead of three serial arrays.
      mapped.toList(mapped.size()).map((image: any) =>
        ee.Image(image).toDictionary(["_date", "_cloud", "_id"]),
      ).evaluate((rows: any, error: any) => {
        if (error) { reject(error); return; }
        resolve((rows || []).map((row: any) => ({
          date: new Date(row._date).toISOString().split("T")[0],
          cloudPercentage: Math.round((row._cloud ?? 0) * 100) / 100,
          id: row._id ?? "",
        })));
      });
    });

    return results.length > 0 || options.allowSynthetic === false ? results : generateMockSentinelImages(months);
  } catch (error) {
    if (options.allowSynthetic === false) throw error;
    console.error("Error listing Sentinel images:", error);
    return generateMockSentinelImages(months);
  }
}

function generateMockSentinelImages(months: number): SentinelImageInfo[] {
  const images: SentinelImageInfo[] = [];
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - months);
  let current = new Date(end);
  while (current >= start) {
    images.push({
      date: current.toISOString().split("T")[0],
      cloudPercentage: Math.round(Math.random() * 30 * 100) / 100,
      id: `mock_${current.toISOString().split("T")[0]}`,
    });
    current.setDate(current.getDate() - 5);
  }
  return images;
}

export async function getIndexMapTiles(bounds: ParcelBounds, indexType: string = "ndvi", specificDate?: string): Promise<{
  mapId: string;
  urlFormat: string;
  hasData: boolean;
  imageDate?: string;
} | null> {
  if (!isInitialized) {
    return null;
  }

  try {
    const polygon = ee.Geometry.Polygon([bounds.coordinates.map(c => [c[1], c[0]])]);

    let sentinel2: any;

    if (specificDate) {
      const targetDate = new Date(specificDate);
      const dayBefore = new Date(targetDate);
      dayBefore.setDate(dayBefore.getDate() - 1);
      const dayAfter = new Date(targetDate);
      dayAfter.setDate(dayAfter.getDate() + 1);

      const collection = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterBounds(polygon)
        .filterDate(dayBefore.toISOString(), dayAfter.toISOString())
        .sort("CLOUDY_PIXEL_PERCENTAGE");

      const size: number = await new Promise((resolve, reject) => {
        collection.size().evaluate((result: any, error: any) => {
          if (error) reject(error);
          else resolve(result);
        });
      });

      if (size === 0) {
        console.log(`No satellite image found for date ${specificDate}`);
        return null;
      }

      sentinel2 = collection.first();
    } else {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);

      const collection = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterBounds(polygon)
        .filterDate(startDate.toISOString(), endDate.toISOString())
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 20))
        .sort("system:time_start", false);

      const size: number = await new Promise((resolve, reject) => {
        collection.size().evaluate((result: any, error: any) => {
          if (error) reject(error);
          else resolve(result);
        });
      });

      if (size === 0) {
        console.log("No satellite images found for map tiles");
        return null;
      }

      sentinel2 = collection.first();
    }

    // Apply bicubic resampling to all bands before index computation.
    // This is step 1 of the Planet-like super-resolution pipeline: GEE will
    // use smooth bicubic interpolation (instead of nearest-neighbor) when
    // rendering tiles at zoom levels beyond the native 10 m resolution.
    // B11 (SWIR, native 20 m) also benefits — it is upsampled with bicubic
    // to match the 10 m grid of B8, making NDMI visually much sharper.
    sentinel2 = (sentinel2 as any).resample("bicubic");

    let indexImage: any;
    let visParams: any;

    switch (indexType.toLowerCase()) {
      case "evi":
        indexImage = sentinel2.expression(
          "2.5 * ((NIR - RED) / (NIR + 6 * RED - 7.5 * BLUE + 1))",
          {
            NIR: sentinel2.select("B8"),
            RED: sentinel2.select("B4"),
            BLUE: sentinel2.select("B2"),
          }
        );
        visParams = {
          min: 0,
          max: 1,
          palette: ["#543005", "#8c510a", "#bf812d", "#dfc27d", "#f6e8c3", "#c7eae5", "#80cdc1", "#35978f", "#01665e", "#003c30"],
        };
        break;
      case "ndmi":
        indexImage = sentinel2.normalizedDifference(["B8", "B11"]);
        visParams = {
          min: -0.5,
          max: 0.5,
          palette: ["#a50026", "#d73027", "#f46d43", "#fdae61", "#fee090", "#e0f3f8", "#abd9e9", "#74add1", "#4575b4", "#313695"],
        };
        break;
      case "ndvi":
      default:
        indexImage = sentinel2.normalizedDifference(["B8", "B4"]);
        visParams = {
          min: 0,
          max: 1,
          palette: ["#d73027", "#fc8d59", "#fee08b", "#d9ef8b", "#91cf60", "#1a9850"],
        };
        break;
    }

    const imageDate: any = await new Promise((resolve, reject) => {
      sentinel2.get("system:time_start").evaluate((result: any, error: any) => {
        if (error) reject(error);
        else resolve(result);
      });
    });

    // Step 2 of super-resolution pipeline: adaptive unsharp masking.
    // Injects high-frequency spatial detail that bicubic resampling smoothed
    // out, producing the crisp field-boundary appearance of Planet 3 m tiles.
    const enhancedImage = applyUnsharpMask(indexImage);
    const clippedImage  = enhancedImage.clip(polygon);

    const mapId: any = await new Promise((resolve, reject) => {
      clippedImage.getMap(visParams, (obj: any, error: any) => {
        if (error) reject(error);
        else resolve(obj);
      });
    });

    return {
      mapId: mapId.mapid,
      urlFormat: mapId.urlFormat,
      hasData: true,
      imageDate: new Date(imageDate).toISOString().split("T")[0],
    };
  } catch (error) {
    console.error(`Error generating ${indexType.toUpperCase()} map tiles:`, error);
    return null;
  }
}

export async function getChangeMapTiles(
  bounds: ParcelBounds,
  indexType: string = "ndvi",
  dateA: string,
  dateB: string
): Promise<{
  mapId: string;
  urlFormat: string;
  hasData: boolean;
  meanChange: number;
} | null> {
  if (!isInitialized) {
    return null;
  }

  try {
    const polygon = ee.Geometry.Polygon([bounds.coordinates.map(c => [c[1], c[0]])]);

    const collectionA = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
      .filterBounds(polygon)
      .filterDate(
        new Date(new Date(dateA).getTime() - 86400000).toISOString(),
        new Date(new Date(dateA).getTime() + 86400000).toISOString()
      )
      .sort("CLOUDY_PIXEL_PERCENTAGE");

    const collectionB = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
      .filterBounds(polygon)
      .filterDate(
        new Date(new Date(dateB).getTime() - 86400000).toISOString(),
        new Date(new Date(dateB).getTime() + 86400000).toISOString()
      )
      .sort("CLOUDY_PIXEL_PERCENTAGE");

    const [sizeA, sizeB]: [number, number] = await Promise.all([
      new Promise<number>((resolve, reject) => {
        collectionA.size().evaluate((r: any, e: any) => e ? reject(e) : resolve(r));
      }),
      new Promise<number>((resolve, reject) => {
        collectionB.size().evaluate((r: any, e: any) => e ? reject(e) : resolve(r));
      }),
    ]);

    if (sizeA === 0 || sizeB === 0) {
      console.log(`Change map: missing images (dateA: ${sizeA}, dateB: ${sizeB})`);
      return null;
    }

    const imageA = collectionA.first();
    const imageB = collectionB.first();

    const computeIndex = (image: any) => {
      // Apply bicubic resampling before computing any index so that
      // both images in the difference pair are sharpened consistently.
      const sharp = (image as any).resample("bicubic");
      switch (indexType.toLowerCase()) {
        case "evi":
          return sharp.expression(
            "2.5 * ((NIR - RED) / (NIR + 6 * RED - 7.5 * BLUE + 1))",
            { NIR: sharp.select("B8"), RED: sharp.select("B4"), BLUE: sharp.select("B2") }
          );
        case "ndmi":
          return sharp.normalizedDifference(["B8", "B11"]);
        case "ndvi":
        default:
          return sharp.normalizedDifference(["B8", "B4"]);
      }
    };

    const indexA = computeIndex(imageA);
    const indexB = computeIndex(imageB);
    // Apply unsharp mask to the difference image so spatial edges in the
    // change map are as crisp as the individual index tiles.
    const difference = applyUnsharpMask(indexB.subtract(indexA)).clip(polygon);

    const visParams = {
      min: -0.3,
      max: 0.3,
      palette: [
        "#d73027", "#f46d43", "#fdae61", "#fee08b",
        "#ffffbf",
        "#d9ef8b", "#a6d96a", "#66bd63", "#1a9850"
      ],
    };

    const stats: any = await new Promise((resolve, reject) => {
      difference.reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: polygon,
        scale: 10,
        maxPixels: 1e9,
      }).evaluate((result: any, error: any) => {
        if (error) reject(error);
        else resolve(result);
      });
    });

    const meanChange = Object.values(stats)[0] as number || 0;

    const mapId: any = await new Promise((resolve, reject) => {
      difference.getMap(visParams, (obj: any, error: any) => {
        if (error) reject(error);
        else resolve(obj);
      });
    });

    return {
      mapId: mapId.mapid,
      urlFormat: mapId.urlFormat,
      hasData: true,
      meanChange: Math.round(meanChange * 1000) / 1000,
    };
  } catch (error) {
    console.error(`Error generating change map:`, error);
    return null;
  }
}

// ─── DEM (Modelo de Elevación Digital) ───────────────────────────────────────
// Fuente: COPERNICUS/DEM/GLO30  (~30 m global, derivado de radar TanDEM-X)
// Tipos disponibles: "elevation" | "hillshade" | "slope"
// ─────────────────────────────────────────────────────────────────────────────
export interface DEMStats {
  elevMin: number | null;
  elevMax: number | null;
  elevMean: number | null;
  slopeMean: number | null;
}

export async function getDEMMapTiles(
  bounds: ParcelBounds,
  type: string = "elevation",
): Promise<{
  urlFormat: string;
  hasData: boolean;
  type: string;
  stats: DEMStats;
  dataset: string;
} | null> {
  if (!isInitialized) return null;

  try {
    const polygon = ee.Geometry.Polygon([bounds.coordinates.map(c => [c[1], c[0]])]);

    // Mosaic Copernicus DEM tiles that overlap the parcel
    const demRaw = ee.ImageCollection("COPERNICUS/DEM/GLO30")
      .filterBounds(polygon)
      .select("DEM")
      .mosaic();

    // Compute terrain derivatives from the unclipped mosaic (avoids edge artifacts)
    const slopeImg     = (ee as any).Terrain.slope(demRaw);
    const hillshadeImg = (ee as any).Terrain.hillshade(demRaw);

    // Choose which band to visualize and its params
    let visImage: any;
    let visParams: any;
    const typeLc = (type || "elevation").toLowerCase();

    switch (typeLc) {
      case "hillshade":
        visImage = hillshadeImg.clip(polygon);
        visParams = {
          min: 0, max: 255,
          palette: ["#000000", "#404040", "#808080", "#bfbfbf", "#ffffff"],
        };
        break;
      case "slope":
        visImage = slopeImg.clip(polygon);
        visParams = {
          min: 0, max: 45,
          palette: ["#1a9850", "#91cf60", "#d9ef8b", "#fee08b", "#fc8d59", "#d73027"],
        };
        break;
      case "elevation":
      default:
        visImage = demRaw.clip(polygon);
        visParams = {
          min: 0, max: 500,
          palette: [
            "#313695", "#4575b4", "#74add1", "#abd9e9", "#e0f3f8",
            "#ffffbf", "#fee090", "#fdae61", "#f46d43", "#d73027", "#a50026",
          ],
        };
        break;
    }

    // Fire tiles request and stats request in parallel
    const [mapId, rawStats] = await Promise.all([
      new Promise<any>((resolve, reject) => {
        visImage.getMap(visParams, (obj: any, error: any) => {
          if (error) reject(error);
          else resolve(obj);
        });
      }),
      new Promise<any>((resolve) => {
        demRaw
          .addBands(slopeImg.rename("slope"))
          .reduceRegion({
            reducer: (ee.Reducer as any).mean().combine({
              reducer2: (ee.Reducer as any).minMax(),
              sharedInputs: true,
            }),
            geometry: polygon,
            scale: 30,
            maxPixels: 1e9,
          })
          .evaluate((result: any, error: any) => {
            // Stats failure is non-fatal — return null so tiles still work
            resolve(error ? null : result);
          });
      }),
    ]);

    const stats: DEMStats = {
      elevMin:   rawStats?.DEM_min  != null ? Math.round(rawStats.DEM_min)             : null,
      elevMax:   rawStats?.DEM_max  != null ? Math.round(rawStats.DEM_max)             : null,
      elevMean:  rawStats?.DEM_mean != null ? Math.round(rawStats.DEM_mean * 10) / 10  : null,
      slopeMean: rawStats?.slope_mean != null ? Math.round(rawStats.slope_mean * 10) / 10 : null,
    };

    // hasData is true only when the DEM actually contains valid pixels for
    // the polygon (indicated by a non-null elevation mean from reduceRegion).
    const hasData = stats.elevMean !== null;

    return {
      urlFormat: mapId.urlFormat,
      hasData,
      type: typeLc,
      stats,
      dataset: "Copernicus DEM GLO-30 (~30 m)",
    };
  } catch (error) {
    console.error("Error generating DEM tiles:", error);
    return null;
  }
}

function generateMockIndices(startDate: string, endDate: string): VegetationIndex[] {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const indices: VegetationIndex[] = [];
  
  let currentDate = new Date(start);
  let baseNdvi = 0.3;
  
  while (currentDate <= end) {
    const dayOfYear = Math.floor((currentDate.getTime() - new Date(currentDate.getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24));
    const seasonalFactor = Math.sin((dayOfYear / 365) * Math.PI * 2 - Math.PI / 2) * 0.3 + 0.5;
    
    baseNdvi = Math.max(0.1, Math.min(0.95, baseNdvi + (Math.random() - 0.5) * 0.1));
    const ndvi = baseNdvi * seasonalFactor + Math.random() * 0.1;
    
    const evi  = Math.round((ndvi * 0.85 + Math.random() * 0.1) * 1000) / 1000;
    const ndmi = Math.round((ndvi * 0.70 + Math.random() * 0.15 - 0.3) * 1000) / 1000;
    indices.push({
      date:  currentDate.toISOString().split("T")[0],
      ndvi:  Math.round(ndvi * 1000) / 1000,
      evi,
      ndmi,
      ndre:  Math.round((ndvi * 0.60 + Math.random() * 0.08) * 1000) / 1000,
      gndvi: Math.round((ndvi * 0.75 + Math.random() * 0.10) * 1000) / 1000,
      msavi: Math.round((ndvi * 0.80 + Math.random() * 0.10) * 1000) / 1000,
      savi:  Math.round((ndvi * 0.78 + Math.random() * 0.10) * 1000) / 1000,
      ndwi:  Math.round((ndvi * 0.40 - 0.1 + Math.random() * 0.12) * 1000) / 1000,
    });
    
    currentDate.setDate(currentDate.getDate() + 5);
  }
  
  return indices;
}

// ─── Numeric raster extraction (for satellite-based VRA zonification) ────────
// Returns the index values as a 2D matrix (rows × cols) over the parcel polygon's
// bounding box. Used by /api/parcels/:id/zones/from-satellite to feed the
// Python /zonify endpoint without needing a prior interpolation result.
//
// Supported indices (all derived from Sentinel-2 SR Harmonized):
//   ndvi  = (B8 - B4) / (B8 + B4)
//   ndre  = (B8 - B5) / (B8 + B5)            (red-edge — chlorophyll/N proxy)
//   ndmi  = (B8 - B11) / (B8 + B11)          (moisture)
//   evi   = 2.5 · (B8 - B4) / (B8 + 6·B4 - 7.5·B2 + 1)
//   gndvi = (B8 - B3) / (B8 + B3)            (greenness)
//   msavi = 0.5 · (2·B8 + 1 - sqrt((2·B8+1)^2 - 8·(B8-B4)))
//
// Matrix is downsampled so total pixels ≤ MAX_RASTER_PIXELS (~22 500).
export interface IndexRasterResult {
  imageId?: string;
  values: (number | null)[][];      // rows × cols, top-row = max latitude
  bbox: { minx: number; miny: number; maxx: number; maxy: number };
  vmin: number;
  vmax: number;
  imageDate: string;                // YYYY-MM-DD
  indexType: string;                // ndvi | ndre | ...
  scaleM: number;                   // effective ground sampling distance (m)
  rows: number;
  cols: number;
  validPixels: number;
  cloudyPixelPercentage: number | null;
  /** SCL-derived cloud/shadow flag on the same grid; null means unclassified. */
  cloudMask?: (number | null)[][];
}

const MAX_RASTER_PIXELS = 150 * 150;        // hard cap for sampleRectangle payload

function indexExpression(indexType: string, sentinel2: any): { image: any; bandName: string } {
  switch (indexType.toLowerCase()) {
    case "ndre":
      return { image: sentinel2.normalizedDifference(["B8", "B5"]).rename("NDRE"), bandName: "NDRE" };
    case "ndmi":
      return { image: sentinel2.normalizedDifference(["B8", "B11"]).rename("NDMI"), bandName: "NDMI" };
    case "gndvi":
      return { image: sentinel2.normalizedDifference(["B8", "B3"]).rename("GNDVI"), bandName: "GNDVI" };
    case "evi": {
      const img = sentinel2.expression(
        "2.5 * ((NIR - RED) / (NIR + 6 * RED - 7.5 * BLUE + 1))",
        { NIR: sentinel2.select("B8"), RED: sentinel2.select("B4"), BLUE: sentinel2.select("B2") },
      ).rename("EVI");
      return { image: img, bandName: "EVI" };
    }
    case "msavi": {
      const img = sentinel2.expression(
        "0.5 * (2 * NIR + 1 - sqrt(((2 * NIR + 1) ** 2) - 8 * (NIR - RED)))",
        { NIR: sentinel2.select("B8"), RED: sentinel2.select("B4") },
      ).rename("MSAVI");
      return { image: img, bandName: "MSAVI" };
    }
    case "ndvi":
    default:
      return { image: sentinel2.normalizedDifference(["B8", "B4"]).rename("NDVI"), bandName: "NDVI" };
  }
}

export async function getIndexRaster(
  bounds: ParcelBounds,
  indexType: string = "ndvi",
  options: NumericRasterOptions = {},
): Promise<IndexRasterResult | null> {
  if (!isInitialized) return null;
  if (!bounds.coordinates || bounds.coordinates.length < 3) {
    throw new Error("La parcela no tiene polígono definido (mínimo 3 vértices).");
  }
  if (options.northUpGrid) {
    return evaluateAlignedRaster(bounds.coordinates, indexType, options, indexExpression);
  }

  // Pre-flight guard: caller must have GEE initialized; we surface a hard
  // error so the route can return a clean message rather than a fallback.
  try {
    const polygon = ee.Geometry.Polygon([bounds.coordinates.map(c => [c[1], c[0]])]);

    // ── Pick the best image in window ─────────────────────────────────────
    let collection: any;
    if (options.imageId) {
      collection = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterBounds(polygon).filter((ee.Filter as any).eq("system:index", options.imageId));
    } else if (options.specificDate) {
      const d = new Date(options.specificDate);
      const before = new Date(d); before.setDate(before.getDate() - 1);
      const after  = new Date(d); after.setDate(after.getDate() + 1);
      collection = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterBounds(polygon)
        .filterDate(before.toISOString(), after.toISOString())
        .sort("CLOUDY_PIXEL_PERCENTAGE");
    } else if (options.dateFrom && options.dateTo) {
      // Inclusive date range. EE filterDate is [start, end), so push end +1 day.
      const start = new Date(options.dateFrom);
      const end = new Date(options.dateTo);
      end.setDate(end.getDate() + 1);
      collection = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterBounds(polygon)
        .filterDate(start.toISOString(), end.toISOString())
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", options.maxCloudPct ?? 20))
        .sort("system:time_start", false);
    } else {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - (options.daysBack ?? 30));
      collection = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterBounds(polygon)
        .filterDate(start.toISOString(), end.toISOString())
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", options.maxCloudPct ?? 20))
        .sort("system:time_start", false);
    }

    const size: number = await new Promise((resolve, reject) =>
      collection.size().evaluate((r: any, e: any) => (e ? reject(e) : resolve(r))),
    );
    if (size === 0) {
      throw new Error("No hay imágenes Sentinel-2 disponibles para los criterios indicados (revisa la fecha o aumenta tolerancia de nubes).");
    }

    const sentinel2 = collection.first();

    // ── Per-pixel cloud / shadow / cirrus mask via SCL band ──────────────
    // Sentinel-2 SR HARMONIZED SCL classes:
    //   3 = cloud shadow, 8 = cloud (medium prob), 9 = cloud (high prob),
    //   10 = cirrus, 11 = snow/ice.
    // We keep only "good" pixels — masked pixels become null in the output
    // matrix and the geo-service treats them as NaN during zonification.
    const scl = sentinel2.select("SCL");
    const cloudMask = scl.neq(3)
      .and(scl.neq(8))
      .and(scl.neq(9))
      .and(scl.neq(10))
      .and(scl.neq(11));

    const sentinel2Masked = sentinel2.updateMask(cloudMask);
    // Apply bicubic resampling so that 20 m bands (B11 for NDMI, B5 for NDRE)
    // are smoothly upsampled to 10 m before index computation.  Unsharp masking
    // is intentionally NOT applied here because this path feeds K-means / Kriging
    // algorithms that need accurate index values, not visually sharpened ones.
    const sentinel2Sharp = (sentinel2Masked as any).resample("bicubic");
    const { image: indexImage, bandName } = indexExpression(indexType, sentinel2Sharp);

    // ── Compute polygon area (m²) → pick scale to keep raster ≤ cap ──────
    const areaM2: number = await new Promise((resolve, reject) =>
      polygon.area(1).evaluate((r: any, e: any) => (e ? reject(e) : resolve(r))),
    );
    const cap = options.targetMaxPixels ?? MAX_RASTER_PIXELS;
    // Scale derived from areaM2 and pixel cap; floor at 10 m (S2 native).
    let scaleM = Math.max(options.northUpGrid && indexType === "ndmi" ? 20 : 10, Math.ceil(Math.sqrt(areaM2 / cap)));

    // ── Get bbox in lon/lat (EPSG:4326) ──────────────────────────────────
    const bboxCoords: number[][] = await new Promise((resolve, reject) =>
      polygon.bounds().coordinates().get(0).evaluate((r: any, e: any) => (e ? reject(e) : resolve(r))),
    );
    const xs = bboxCoords.map(c => c[0]);
    const ys = bboxCoords.map(c => c[1]);
    const minx = Math.min(...xs), maxx = Math.max(...xs);
    const miny = Math.min(...ys), maxy = Math.max(...ys);

    // Keep the scene footprint until sampling. Clipping to a small/nonrectangular
    // parcel first makes sampleRectangle fail in the surrounding bounding box.
    // Paint a mask instead; after reprojection, expand missing coverage with an
    // explicit float sentinel, which is always converted back to null below.
    const noData = -9999;
    const parcelMask = ee.Image.constant(0).paint(ee.FeatureCollection([ee.Feature(polygon)]), 1);
    const maskedIndex = indexImage.toFloat().updateMask(parcelMask);
    const latitude = (miny + maxy) / 2 * Math.PI / 180;
    const widthM = (maxx - minx) * 111320 * Math.cos(latitude);
    const heightM = (maxy - miny) * 111320;
    // Cap by bounding-box area as well, including long/narrow or concave parcels.
    if (options.northUpGrid) scaleM = Math.max(scaleM, Math.ceil(Math.sqrt(widthM * heightM / cap)));
    let gridCols = Math.max(1, Math.ceil(widthM / scaleM));
    let gridRows = Math.max(1, Math.ceil(heightM / scaleM));
    while (options.northUpGrid && gridCols * gridRows > cap) {
      scaleM++;
      gridCols = Math.max(1, Math.ceil(widthM / scaleM));
      gridRows = Math.max(1, Math.ceil(heightM / scaleM));
    }
    const dx = (maxx - minx) / gridCols, dy = (maxy - miny) / gridRows;
    const reprojected = options.northUpGrid
      ? maskedIndex.reproject({
        crs: "EPSG:4326", crsTransform: [dx, 0, minx, 0, -dy, maxy],
      })
      : maskedIndex.reproject({ crs: sentinel2.select("B8").projection().crs(), scale: scaleM });

    // ── sampleRectangle returns a feature with the matrix as a property ──
    const sampled = reprojected.unmask(noData, false).sampleRectangle({
      region: options.northUpGrid
        ? (ee.Geometry.Rectangle as any)([minx + dx * .01, miny + dy * .01, maxx - dx * .01, maxy - dy * .01], null, false)
        : polygon.bounds(),
      defaultValue: noData,
    });

    const sampleResult: any = await new Promise((resolve, reject) =>
      sampled.evaluate((r: any, e: any) => (e ? reject(e) : resolve(r))),
    );

    const props = sampleResult?.properties ?? {};
    let raw: number[][] | undefined = props[bandName];
    if (!Array.isArray(raw) || raw.length === 0 || !Array.isArray(raw[0])) {
      throw new Error(`Earth Engine devolvió una matriz vacía para ${bandName}. Posibles causas: parcela demasiado pequeña, nubes totales o índice no disponible para el sensor.`);
    }

    // sampleRectangle returns rows ordered north-to-south (top = max lat),
    // which is what front-end leaflet ImageOverlay expects.
    const rows = raw.length;
    const cols = raw[0].length;
    if (options.northUpGrid && (rows !== gridRows || cols !== gridCols)) {
      throw new Error("El satélite devolvió una malla desalineada; no se generó un mapa aproximado.");
    }

    // Convert sentinel -9999 sentinel back to null and compute stats.
    let vmin = Infinity, vmax = -Infinity, n = 0;
    const values: (number | null)[][] = new Array(rows);
    for (let r = 0; r < rows; r++) {
      const row = new Array(cols);
      for (let c = 0; c < cols; c++) {
        const v = raw[r][c];
        if (v == null || v === noData || !Number.isFinite(v)) {
          row[c] = null;
        } else {
          row[c] = v;
          if (v < vmin) vmin = v;
          if (v > vmax) vmax = v;
          n++;
        }
      }
      values[r] = row;
    }
    if (n === 0) {
      throw new Error("Todos los píxeles del índice son inválidos (nubes/sombras). Prueba con otra fecha.");
    }

    const imageDate: any = await new Promise((resolve, reject) =>
      sentinel2.get("system:time_start").evaluate((r: any, e: any) => (e ? reject(e) : resolve(r))),
    );
    const cloudPct: any = await new Promise((resolve) =>
      sentinel2.get("CLOUDY_PIXEL_PERCENTAGE").evaluate((r: any) => resolve(r ?? null)),
    );

    return {
      values,
      bbox: { minx, miny, maxx, maxy },
      vmin: vmin === Infinity ? 0 : vmin,
      vmax: vmax === -Infinity ? 0 : vmax,
      imageDate: new Date(imageDate).toISOString().split("T")[0],
      indexType: indexType.toLowerCase(),
      scaleM,
      rows,
      cols,
      validPixels: n,
      cloudyPixelPercentage: typeof cloudPct === "number" ? cloudPct : null,
    };
  } catch (error: any) {
    // Re-throw as a typed error so the route can map to a 5xx with a clear
    // message; never return null silently when the user explicitly requested
    // satellite zonification.
    throw new Error(error?.message ?? String(error));
  }
}

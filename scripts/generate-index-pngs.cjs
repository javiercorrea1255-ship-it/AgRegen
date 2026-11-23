/**
 * Generates one real PNG per satellite index in client/public/indices/<slug>.png
 * using Google Earth Engine over a fixed public agronomic test parcel.
 *
 * Parcel: ~5 km x 5 km area in the Argentine Pampas (a publicly visible
 *   agricultural region) centered around -33.50, -60.50. This is documented
 *   demo geometry — no private user data is used.
 *
 * Run: node scripts/generate-index-pngs.cjs
 *
 * Requires GEE_SERVICE_ACCOUNT_KEY in the env.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const ee = require("@google/earthengine");

const PARCEL_BOUNDS = [
  [-60.55, -33.55],
  [-60.45, -33.55],
  [-60.45, -33.45],
  [-60.55, -33.45],
  [-60.55, -33.55],
];
const DATE_START = "2024-01-15";
const DATE_END = "2024-04-15";
const OUT_DIR = path.join(__dirname, "..", "client", "public", "indices");
const PROVENANCE_FILE = path.join(OUT_DIR, "provenance.json");

const INDICES = [
  {
    slug: "ndvi",
    expr: (img) => img.normalizedDifference(["B8", "B4"]),
    vis: { min: 0, max: 1, palette: ["#9ca3af", "#fef3c7", "#bef264", "#65a30d", "#166534"] },
  },
  {
    slug: "evi",
    expr: (img) =>
      img.expression("2.5 * ((NIR - RED) / (NIR + 6 * RED - 7.5 * BLUE + 1))", {
        NIR: img.select("B8"),
        RED: img.select("B4"),
        BLUE: img.select("B2"),
      }),
    vis: { min: 0, max: 1, palette: ["#9ca3af", "#fef3c7", "#bef264", "#65a30d", "#166534"] },
  },
  {
    slug: "ndmi",
    expr: (img) => img.normalizedDifference(["B8", "B11"]),
    vis: { min: -0.4, max: 0.4, palette: ["#fca5a5", "#fde68a", "#bef264", "#22d3ee", "#0891b2"] },
  },
  {
    slug: "ndwi",
    expr: (img) => img.normalizedDifference(["B3", "B8"]),
    vis: { min: -0.5, max: 0.5, palette: ["#fef3c7", "#bef264", "#22d3ee", "#0891b2", "#1e3a8a"] },
  },
  {
    slug: "savi",
    expr: (img) =>
      img.expression("(1 + 0.5) * (NIR - RED) / (NIR + RED + 0.5)", {
        NIR: img.select("B8"),
        RED: img.select("B4"),
      }),
    vis: { min: 0, max: 1, palette: ["#9ca3af", "#fef3c7", "#bef264", "#65a30d", "#166534"] },
  },
  {
    slug: "msi",
    expr: (img) => img.select("B11").divide(img.select("B8")),
    vis: { min: 0.4, max: 1.6, palette: ["#22d3ee", "#bef264", "#fde68a", "#fca5a5"] },
  },
  {
    slug: "nbr",
    expr: (img) => img.normalizedDifference(["B8", "B12"]),
    vis: { min: -0.5, max: 0.8, palette: ["#7f1d1d", "#fca5a5", "#fde68a", "#bef264", "#166534"] },
  },
  {
    slug: "bsi",
    expr: (img) =>
      img.expression(
        "((SWIR + RED) - (NIR + BLUE)) / ((SWIR + RED) + (NIR + BLUE))",
        {
          SWIR: img.select("B11"),
          RED: img.select("B4"),
          NIR: img.select("B8"),
          BLUE: img.select("B2"),
        }
      ),
    vis: { min: -0.5, max: 0.5, palette: ["#166534", "#bef264", "#fde68a", "#fca5a5", "#78350f"] },
  },
];

function authenticate() {
  return new Promise((resolve, reject) => {
    const credentialsJson = process.env.GEE_SERVICE_ACCOUNT_KEY;
    if (!credentialsJson) {
      reject(new Error("GEE_SERVICE_ACCOUNT_KEY missing"));
      return;
    }
    const credentials = JSON.parse(credentialsJson);
    ee.data.authenticateViaPrivateKey(
      credentials,
      () => {
        ee.initialize(
          null,
          null,
          () => resolve(),
          (err) => reject(err)
        );
      },
      (err) => reject(err)
    );
  });
}

function getThumbURL(image, region) {
  return new Promise((resolve, reject) => {
    image.getThumbURL(
      { dimensions: 480, region, format: "png" },
      (url, error) => (error ? reject(error) : resolve(url))
    );
  });
}

function evaluateImageDate(img) {
  return new Promise((resolve, reject) => {
    img.get("system:time_start").evaluate((v, err) => (err ? reject(err) : resolve(v)));
  });
}

function download(url, outPath) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          fs.writeFileSync(outPath, Buffer.concat(chunks));
          resolve();
        });
      })
      .on("error", reject);
  });
}

async function run() {
  console.log("Initializing GEE…");
  await authenticate();

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const polygon = ee.Geometry.Polygon([PARCEL_BOUNDS]);
  console.log("Fetching cleanest Sentinel-2 image…");
  const collection = ee
    .ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
    .filterBounds(polygon)
    .filterDate(DATE_START, DATE_END)
    .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 10))
    .sort("CLOUDY_PIXEL_PERCENTAGE");

  const sentinel2 = collection.first();
  const imageDateMs = await evaluateImageDate(sentinel2);
  const imageDate = new Date(imageDateMs).toISOString().slice(0, 10);
  console.log("Image date:", imageDate);

  const provenance = {
    source: "Sentinel-2 L2A (COPERNICUS/S2_SR_HARMONIZED via Google Earth Engine)",
    parcelBounds: PARCEL_BOUNDS,
    region: "Pampa húmeda — Buenos Aires, Argentina (test parcel)",
    imageDate,
    generatedAt: new Date().toISOString(),
    indices: {},
  };

  for (const idx of INDICES) {
    process.stdout.write(`  ${idx.slug}… `);
    const indexImage = idx.expr(sentinel2).clip(polygon).visualize(idx.vis);
    const url = await getThumbURL(indexImage, polygon);
    const out = path.join(OUT_DIR, `${idx.slug}.png`);
    await download(url, out);
    const size = fs.statSync(out).size;
    console.log(`OK (${size} bytes)`);
    provenance.indices[idx.slug] = { bytes: size, vis: idx.vis };
  }

  fs.writeFileSync(PROVENANCE_FILE, JSON.stringify(provenance, null, 2));
  console.log("Wrote", PROVENANCE_FILE);
}

run().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});

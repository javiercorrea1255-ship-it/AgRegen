/**
 * One-time import script: parses ESTADOS_ANALISIS_DE_SUELO shapefile ZIP,
 * reprojects from UTM Zone 14N (EPSG:32614) to WGS-84 (EPSG:4326),
 * and inserts 14,943 soil analysis records into mexico_soil_samples table.
 *
 * Run once with:
 *   npx tsx scripts/import-mexico-soil.ts
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { drizzle } from "drizzle-orm/node-postgres";
import pkg from "pg";
const { Pool } = pkg;
import * as schema from "../shared/schema.js";
import proj4 from "proj4";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UTM14N = "+proj=utm +zone=14 +datum=WGS84 +units=m +no_defs";
const WGS84  = "+proj=longlat +datum=WGS84 +no_defs";

const ZIP_PATH = path.join(__dirname, "../attached_assets/ESTADOS_ANALISIS_DE_SUELO_1782092998815.zip");
const BATCH_SIZE = 500;

function safeNum(v: unknown): string | null {
  if (v === null || v === undefined || v === "" || v === "NULL") return null;
  const n = Number(v);
  return isNaN(n) ? null : String(n);
}

function safeText(v: unknown): string | null {
  if (v === null || v === undefined || v === "" || v === "NULL") return null;
  return String(v).trim();
}

async function main() {
  if (!fs.existsSync(ZIP_PATH)) {
    console.error(`❌ Shapefile ZIP not found at: ${ZIP_PATH}`);
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const db = drizzle(pool, { schema });

  // Check if already imported
  const [countRow] = await db.select({ count: schema.mexicoSoilSamples.id })
    .from(schema.mexicoSoilSamples)
    .limit(1);
  if (countRow) {
    console.log("✅ Mexico soil samples already imported. Run with --force to re-import.");
    if (!process.argv.includes("--force")) {
      await pool.end();
      return;
    }
    // Truncate and re-import
    await pool.query("TRUNCATE TABLE mexico_soil_samples RESTART IDENTITY");
    console.log("🗑  Truncated existing records. Re-importing...");
  }

  console.log(`📂 Reading ZIP: ${ZIP_PATH}`);
  const buf = fs.readFileSync(ZIP_PATH);
  const arr = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

  console.log("🔍 Parsing shapefile…");
  const shp = await import("shpjs");
  let result: any;
  try {
    result = await shp.default(arr);
  } catch (e) {
    console.error("❌ Failed to parse shapefile:", e);
    process.exit(1);
  }

  const collections = Array.isArray(result) ? result : [result];
  const features: any[] = [];
  for (const c of collections) features.push(...(c.features ?? []));
  console.log(`✅ Parsed ${features.length} features`);

  // Detect if reprojection is needed (UTM coords are >> 360 for easting)
  const firstCoords = features[0]?.geometry?.coordinates;
  const needsReproject =
    firstCoords &&
    (Math.abs(firstCoords[0]) > 360 || Math.abs(firstCoords[1]) > 90);

  if (needsReproject) {
    console.log("🔄 Reprojecting from UTM Zone 14N → WGS-84…");
  } else {
    console.log("✅ Coordinates already in WGS-84 (shpjs auto-reprojected)");
  }

  const records: (typeof schema.mexicoSoilSamples.$inferInsert)[] = [];
  let skipped = 0;

  for (const f of features) {
    if (!f.geometry || f.geometry.type !== "Point") { skipped++; continue; }
    let [x, y] = f.geometry.coordinates as [number, number];
    if (needsReproject) {
      const reproj = proj4(UTM14N, WGS84, [x, y]);
      x = reproj[0];
      y = reproj[1];
    }
    // WGS-84 sanity check: Mexico lon ~-118 to -86, lat ~14 to 33
    if (x < -125 || x > -80 || y < 10 || y > 38) { skipped++; continue; }

    const p = f.properties ?? {};
    records.push({
      labNumber: safeText(p.NUMERO_LAB ?? p.NumeroLab ?? p.NUMEROLAB),
      estado:    safeText(p.ESTADO),
      municipio: safeText(p.MUNICIPIO),
      localidad: safeText(p.LOCALIDAD),
      loteu:     safeText(p.LOTEU),
      lat:       String(y),
      lng:       String(x),
      ph:        safeNum(p.pH ?? p.ph ?? p.PH),
      ce:        safeNum(p.CE ?? p.ce),
      dap:       safeNum(p.Dap ?? p.DAP ?? p.dap),
      mo:        safeNum(p.M_O ?? p.MO ?? p.mo),
      n:         safeNum(p.N ?? p.n),
      metP:      safeText(p.MET_P ?? p.METP),
      p:         safeNum(p.P ?? p.p),
      k:         safeNum(p.K ?? p.k),
      ca:        safeNum(p.Ca ?? p.CA ?? p.ca),
      mg:        safeNum(p.Mg ?? p.MG ?? p.mg),
      fe:        safeNum(p.Fe ?? p.FE ?? p.fe),
      zn:        safeNum(p.Zn ?? p.ZN ?? p.zn),
      b:         safeNum(p.B ?? p.b),
      mn:        safeNum(p.Mn ?? p.MN ?? p.mn),
      cu:        safeNum(p.Cu ?? p.CU ?? p.cu),
      arcilla:   safeNum(p.Arcilla ?? p.ARCILLA),
      limo:      safeNum(p.Limo ?? p.LIMO),
      arena:     safeNum(p.Arena ?? p.ARENA),
      na:        safeNum(p.Na ?? p.NA ?? p.na),
      cic:       safeNum(p.CIC ?? p.cic),
      textura:   safeText(p.TEXTURA),
    });
  }

  console.log(`📊 Prepared ${records.length} records (skipped ${skipped})`);

  let inserted = 0;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    await db.insert(schema.mexicoSoilSamples).values(batch);
    inserted += batch.length;
    process.stdout.write(`\r⬆  Inserted ${inserted}/${records.length}…`);
  }
  console.log(`\n✅ Done! ${inserted} soil analysis points imported.`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });

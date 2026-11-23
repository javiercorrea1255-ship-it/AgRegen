#!/usr/bin/env npx tsx
/**
 * Seeds mexico_soil_samples from the bundled CSV file.
 * Safe to run multiple times — skips if table already has rows.
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { Pool } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("DATABASE_URL not set — skipping Mexico soil seed");
  process.exit(0);
}

const pool = new Pool({ connectionString: DB_URL });

async function main() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      "SELECT COUNT(*) AS n FROM mexico_soil_samples"
    );
    const count = parseInt(rows[0].n, 10);
    if (count > 0) {
      console.log(
        `mexico_soil_samples already has ${count} rows — skipping seed.`
      );
      return;
    }

    console.log("mexico_soil_samples is empty — seeding from CSV...");

    const csvPath = join(__dirname, "mexico-soil-data.csv");
    const raw = readFileSync(csvPath, "utf-8");
    const lines = raw.trim().split("\n");
    const headers = lines[0].split(",");

    // Parse CSV rows into objects, handling quoted fields
    function parseCSVLine(line: string): string[] {
      const result: string[] = [];
      let cur = "";
      let inQuote = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          inQuote = !inQuote;
        } else if (ch === "," && !inQuote) {
          result.push(cur);
          cur = "";
        } else {
          cur += ch;
        }
      }
      result.push(cur);
      return result;
    }

    function toNum(v: string): number | null {
      if (v === "" || v === "\\N") return null;
      const n = parseFloat(v);
      return isNaN(n) ? null : n;
    }

    function toStr(v: string): string | null {
      if (v === "" || v === "\\N") return null;
      return v;
    }

    const BATCH = 500;
    let inserted = 0;

    for (let i = 1; i < lines.length; i += BATCH) {
      const batch = lines.slice(i, i + BATCH);
      if (batch.length === 0) break;

      const values: unknown[][] = batch.map((line) => {
        const cols = parseCSVLine(line);
        const get = (h: string) => cols[headers.indexOf(h)] ?? "";
        return [
          toStr(get("lab_number")),
          toStr(get("estado")),
          toStr(get("municipio")),
          toStr(get("localidad")),
          toStr(get("loteu")),
          toNum(get("lat")),
          toNum(get("lng")),
          toNum(get("ph")),
          toNum(get("ce")),
          toNum(get("dap")),
          toNum(get("mo")),
          toNum(get("n")),
          toStr(get("met_p")),
          toNum(get("p")),
          toNum(get("k")),
          toNum(get("ca")),
          toNum(get("mg")),
          toNum(get("fe")),
          toNum(get("zn")),
          toNum(get("b")),
          toNum(get("mn")),
          toNum(get("cu")),
          toNum(get("arcilla")),
          toNum(get("limo")),
          toNum(get("arena")),
          toNum(get("na")),
          toNum(get("cic")),
          toStr(get("textura")),
        ];
      });

      // Build multi-row INSERT
      const placeholders = values
        .map(
          (_, ri) =>
            `(${Array.from({ length: 28 }, (_, ci) => `$${ri * 28 + ci + 1}`).join(",")})`
        )
        .join(",");

      const flat = values.flat();
      await client.query(
        `INSERT INTO mexico_soil_samples
          (lab_number,estado,municipio,localidad,loteu,lat,lng,
           ph,ce,dap,mo,n,met_p,p,k,ca,mg,fe,zn,b,mn,cu,
           arcilla,limo,arena,na,cic,textura)
         VALUES ${placeholders}
         ON CONFLICT DO NOTHING`,
        flat
      );
      inserted += batch.length;
      console.log(`  Inserted ${inserted}/${lines.length - 1} rows...`);
    }

    console.log(`✓ Mexico soil seed complete — ${inserted} rows inserted.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Seed error:", err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * One-time migration: back-transform zone statistics for historical interpolations.
 *
 * When interpolations used a non-identity transform (log1p, sqrt, boxcox), zone
 * statistics (value_mean, value_min, value_max) were stored in transformed space
 * instead of original agronomic units. This script corrects those stored values.
 *
 * Idempotency: a boolean column `stats_back_transformed` is added directly to the
 * management_zones table in the database (via ALTER TABLE IF NOT EXISTS). This column
 * is NOT declared in shared/schema.ts — it is exclusively managed by this script so
 * that the app server does not depend on the script having been run first. Rows
 * already processed are skipped on re-runs.
 *
 * Transform metadata lookup supports both formats:
 *   - Current format: top-level keys transform_type, transform_shift, transform_lambda
 *   - Legacy format: nested under params_json.params (transform, shift, lambda)
 *
 * Rows are only marked stats_back_transformed=true when transform metadata is
 * confidently resolved. Rows with no params_json are deferred (left for a future run).
 *
 * Usage:
 *   node scripts/fix-zone-stats-back-transform.cjs
 *   DATABASE_URL=... node scripts/fix-zone-stats-back-transform.cjs
 */

"use strict";

const { Pool } = require("pg");

// ─── Back-transform helpers (mirrors geo-service/services/interpolation.py) ────

/**
 * Inverse Box-Cox transform.
 *   lam = 0  →  exp(z)
 *   lam ≠ 0  →  (lam * z + 1) ^ (1 / lam)
 */
function invBoxcox(z, lam) {
  if (Math.abs(lam) < 1e-10) {
    return Math.exp(z);
  }
  const inner = lam * z + 1;
  if (inner <= 0) {
    // Domain invalid — match Python's expm1 fallback
    return Math.exp(z);
  }
  return Math.pow(inner, 1.0 / lam);
}

/**
 * Invert the transform applied by _preprocess_values in interpolation.py.
 *
 * @param {number} z             Value in transformed space
 * @param {string} transformType "log1p", "sqrt", "boxcox", or identity variant
 * @param {number} shift         Additive shift applied before the forward transform
 * @param {number} lam           Box-Cox lambda (only used for transformType === "boxcox")
 * @returns {number}             Value in original agronomic units
 */
function backTransform(z, transformType, shift, lam) {
  const s = (typeof shift === "number" && isFinite(shift)) ? shift : 0.0;
  const l = (typeof lam   === "number" && isFinite(lam))   ? lam   : 0.0;

  if (transformType === "log1p") {
    return Math.expm1(z) - s;
  } else if (transformType === "sqrt") {
    return Math.pow(Math.max(z, 0.0), 2) - s;
  } else if (transformType === "boxcox") {
    try {
      return invBoxcox(z, l) - s;
    } catch (_) {
      // Match Python's expm1 fallback for boxcox edge cases
      return Math.expm1(z) - s;
    }
  }
  // "none", "", "identity", or any unrecognised value → no-op
  return z;
}

/** Returns true when the transform type string represents an identity (no-op) transform. */
function isIdentityTransform(tt) {
  return (
    tt === "none" ||
    tt === "" ||
    tt === "identity" ||
    tt === "no_transform"
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("ERROR: DATABASE_URL environment variable is not set.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    console.log("=== Zone statistics back-transform migration ===\n");

    // ── Step 1: Add idempotency column ───────────────────────────────────────
    // The column lives only in the database; it is intentionally absent from
    // shared/schema.ts so the app server can start independently of this script.
    await client.query(`
      ALTER TABLE management_zones
        ADD COLUMN IF NOT EXISTS stats_back_transformed boolean NOT NULL DEFAULT false
    `);
    console.log("Ensured column management_zones.stats_back_transformed exists.\n");

    // ── Step 2: Fetch unprocessed zones ──────────────────────────────────────
    // COALESCE reads transform metadata from both the current top-level format
    // and the legacy nested format (params_json → 'params' → key) to handle
    // interpolations stored before the current schema was introduced.
    const { rows: pending } = await client.query(`
      SELECT
        mz.id                                                              AS zone_id,
        mz.value_mean,
        mz.value_min,
        mz.value_max,
        COALESCE(
          ir.params_json->>'transform_type',
          ir.params_json->'params'->>'transform',
          ir.params_json->'params'->>'transform_type'
        )                                                                  AS transform_type,
        COALESCE(
          (ir.params_json->>'transform_shift')::float8,
          (ir.params_json->'params'->>'transform_shift')::float8,
          (ir.params_json->'params'->>'shift')::float8
        )                                                                  AS transform_shift,
        COALESCE(
          (ir.params_json->>'transform_lambda')::float8,
          (ir.params_json->'params'->>'transform_lambda')::float8,
          (ir.params_json->'params'->>'lambda')::float8
        )                                                                  AS transform_lambda,
        ir.params_json IS NOT NULL                                         AS has_params
      FROM management_zones mz
      JOIN interpolation_results ir ON ir.id = mz.interpolation_id
      WHERE mz.stats_back_transformed = false
    `);

    console.log(`Found ${pending.length} zone row(s) not yet processed.`);

    let updated  = 0;
    let skipped  = 0;
    let deferred = 0;

    for (const row of pending) {
      // Cannot determine transform without params_json → defer to a future run.
      if (!row.has_params) {
        deferred++;
        continue;
      }

      // transform_type is NULL only for records created before the transform
      // feature was introduced — those rows were always stored in original units.
      // Mark them done without modifying the statistics.
      if (row.transform_type === null) {
        await client.query(
          `UPDATE management_zones SET stats_back_transformed = true WHERE id = $1`,
          [row.zone_id]
        );
        skipped++;
        continue;
      }

      const tt = row.transform_type.trim().toLowerCase();

      // Explicit identity transform — stats are already in original units.
      if (isIdentityTransform(tt)) {
        await client.query(
          `UPDATE management_zones SET stats_back_transformed = true WHERE id = $1`,
          [row.zone_id]
        );
        skipped++;
        continue;
      }

      // Non-identity transform — invert and update statistics.
      const shift = row.transform_shift ?? 0.0;
      const lam   = row.transform_lambda ?? 0.0;

      const rawMean = row.value_mean !== null ? parseFloat(row.value_mean) : null;
      const rawMin  = row.value_min  !== null ? parseFloat(row.value_min)  : null;
      const rawMax  = row.value_max  !== null ? parseFloat(row.value_max)  : null;

      const newMean = rawMean !== null ? backTransform(rawMean, tt, shift, lam) : null;
      const newMin  = rawMin  !== null ? backTransform(rawMin,  tt, shift, lam) : null;
      const newMax  = rawMax  !== null ? backTransform(rawMax,  tt, shift, lam) : null;

      await client.query(
        `UPDATE management_zones
            SET value_mean             = $1,
                value_min              = $2,
                value_max              = $3,
                stats_back_transformed = true
          WHERE id = $4`,
        [newMean, newMin, newMax, row.zone_id]
      );

      updated++;
    }

    console.log(`\nResults:`);
    console.log(`  Back-transformed (updated):      ${updated}`);
    console.log(`  Skipped (no/identity transform): ${skipped}`);
    console.log(`  Deferred (missing params_json):  ${deferred}`);
    console.log(`  Total processed this run:        ${updated + skipped}`);
    if (deferred > 0) {
      console.log(`\n  Note: ${deferred} row(s) were deferred because their parent`);
      console.log(`  interpolation had no params_json. Re-run this script after`);
      console.log(`  those records are repaired.`);
    }
    console.log(`\nMigration complete.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

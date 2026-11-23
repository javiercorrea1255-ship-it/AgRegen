import { drizzle } from "drizzle-orm/node-postgres";
import pkg from "pg";
import { users } from "@shared/schema";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

export async function ensureAdminUser() {
  const email = process.env.AG_REGEN_ADMIN_EMAIL?.trim();
  const password = process.env.AG_REGEN_ADMIN_PASSWORD;
  if (!email || !password) return;
  if (password.length < 16 || Buffer.byteLength(password, "utf8") > 72) {
    console.warn("Administrator bootstrap skipped: use a password of at least 16 characters and at most 72 UTF-8 bytes.");
    return;
  }

  const pool = new pkg.Pool({ connectionString: process.env.DATABASE_URL });
  pool.on("error", () => console.error("Administrator bootstrap database pool error."));
  const db = drizzle(pool);
  try {
    const [existing] = await db.select({ id: users.id })
      .from(users).where(eq(users.email, email)).limit(1);
    if (existing) return; // Never elevate an existing account or reset its password at boot.
    const passwordHash = await bcrypt.hash(password, 12);
    await db.insert(users).values({
      name: "Admin Principal",
      email,
      passwordHash,
      role: "admin",
      isActive: true,
    }).onConflictDoNothing({ target: users.email });
  } catch {
    // Connection and uniqueness errors can include credentials or the account email.
    console.error("Administrator bootstrap failed. Check development database and bootstrap configuration.");
  } finally {
    await pool.end();
  }
}

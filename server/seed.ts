import { ensureAdminUser } from "./ensure-admin";

if (!process.env.AG_REGEN_ADMIN_EMAIL || !process.env.AG_REGEN_ADMIN_PASSWORD) {
  console.error("Set AG_REGEN_ADMIN_EMAIL and AG_REGEN_ADMIN_PASSWORD to bootstrap a development administrator.");
  process.exitCode = 1;
} else {
  ensureAdminUser().catch(() => {
    console.error("Administrator bootstrap did not complete.");
    process.exitCode = 1;
  });
}

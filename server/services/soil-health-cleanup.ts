import { ObjectNotFoundError, ObjectStorageService } from "../replit_integrations/object_storage/objectStorage";
import type { SoilHealthRepository } from "./soil-health-repository";

export async function cleanupSoilHealthObject(repository: Pick<SoilHealthRepository, "finishCleanup">, objectPath: string, objects = new ObjectStorageService()) {
  // This queue must never become a general-purpose arbitrary-object deletion endpoint.
  if (!/^\/objects\/soil-health\/[a-zA-Z0-9_.-]+$/.test(objectPath)) throw new Error("Invalid soil-health cleanup namespace");
  try {
    const file = await objects.getObjectEntityFile(objectPath);
    await file.delete({ ignoreNotFound: true });
  } catch (error) {
    if (!(error instanceof ObjectNotFoundError)) throw error;
  }
  await repository.finishCleanup(objectPath);
}

export function startSoilHealthCleanup(repository: SoilHealthRepository) {
  let running = false;
  async function run() {
    if (running) return;
    running = true;
    try {
      for (const job of await repository.pendingCleanup()) {
        try { await cleanupSoilHealthObject(repository, job.objectPath); }
        catch (error) { console.error("[soil-health] evidence cleanup deferred", error); }
      }
    } catch (error) {
      console.error("[soil-health] cleanup queue unavailable", error);
    } finally { running = false; }
  }
  void run();
  const timer = setInterval(() => { void run(); }, 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
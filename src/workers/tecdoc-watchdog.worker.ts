import type { Job } from "bullmq";
import { logger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import { getAdapterOrLoad } from "../adapters/registry.js";
import { syncQueue, matchQueue } from "./queues.js";

/**
 * TecDoc watchdog.
 *
 * Runs every 5 minutes. Does a minimal TecDoc probe (1 API call). When the
 * probe succeeds AND the sync-tecdoc repeatable is absent (i.e. an operator
 * paused it during an outage), automatically:
 *   1. Re-arm sync-tecdoc (every 4h) and match-tecdoc (every 1h) repeatables.
 *   2. Enqueue a targeted oil-category sync so the 10k olie-producten get
 *      articleCriteria back-filled straight away.
 *
 * On a failed probe: do nothing, log at debug level, wait for the next tick.
 * Probe cost: 1 getArticles(perPage=1) call per tick = ~288 calls/day.
 */

// Oil-related TecDoc assemblyGroupNodeIds — same list as
// /jobs/sync-tecdoc-categories default. Back-fills articleCriteria on
// the ~10,693 oil-category products first when TecDoc recovers.
const OIL_GROUP_IDS = [
  706233, 101994, 101996, 102201, 102203, 103352, // Olie
  100259, 103543, 706587, 706726, 100470,          // Oliefilter
  100108, 100483, 706083,                          // Oliekoeler
];

async function probeTecDoc(): Promise<{ ok: boolean; error?: string }> {
  try {
    const adapter = await getAdapterOrLoad("tecdoc");
    if (!adapter) return { ok: false, error: "adapter not loaded" };
    // Use the adapter's public syncCatalog generator with a single-page cursor
    // and break immediately — this costs exactly one getArticles call.
    const iter: AsyncGenerator<unknown[]> = (adapter as { syncCatalog: (c?: string) => AsyncGenerator<unknown[]> })
      .syncCatalog("0:1"); // groupIdx=0, page=1 — minimal request
    // Only pull the first batch then abort
    const firstBatchPromise = iter.next();
    const timeoutPromise = new Promise<{ done: true; value: undefined }>((resolve) =>
      setTimeout(() => resolve({ done: true, value: undefined }), 30_000),
    );
    await Promise.race([firstBatchPromise, timeoutPromise]);
    try { await iter.return?.(undefined); } catch { /* ignore */ }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function isTecDocSyncPaused(): Promise<boolean> {
  // Canonical source: tecdoc_sync_paused setting (survives restarts).
  // Fallback: check if sync-tecdoc repeatable is absent (covers manual Redis pokes).
  const flag = await prisma.setting.findUnique({ where: { key: "tecdoc_sync_paused" } });
  if (flag?.value === "true") return true;
  const repeat = await syncQueue.getRepeatableJobs();
  return !repeat.some((r) => r.name === "sync-tecdoc");
}

async function rearmAndBackfill(): Promise<void> {
  // Clear the pause flag first so a future restart re-arms correctly.
  await prisma.setting.upsert({
    where: { key: "tecdoc_sync_paused" },
    create: { key: "tecdoc_sync_paused", value: "false" },
    update: { value: "false" },
  });
  // Re-add the 4h sync + 1h match repeatables with the same jobIds as scheduler.ts.
  await syncQueue.add(
    "sync-tecdoc",
    { supplierCode: "tecdoc" },
    { repeat: { every: 4 * 60 * 60 * 1000 }, jobId: "sync-repeat-tecdoc" },
  );
  await matchQueue.add(
    "match-tecdoc",
    { supplierCode: "tecdoc" },
    { repeat: { every: 60 * 60 * 1000 }, jobId: "match-repeat-tecdoc" },
  );
  // Fire the oil-category back-fill once.
  await syncQueue.add(
    "sync-tecdoc-categories",
    { supplierCode: "tecdoc", assemblyGroupNodeIds: OIL_GROUP_IDS },
    { priority: 2, jobId: `sync-tecdoc-categories-auto-${Date.now()}` },
  );
  logger.info(
    { reArmed: ["sync-tecdoc", "match-tecdoc"], backfillQueued: OIL_GROUP_IDS.length },
    "TecDoc watchdog: API healthy again — schedulers re-armed and oil back-fill queued",
  );
}

export async function processTecdocWatchdogJob(job: Job): Promise<void> {
  const probe = await probeTecDoc();
  if (!probe.ok) {
    logger.debug({ err: probe.error }, "TecDoc watchdog: probe failed, staying paused");
    return;
  }

  const paused = await isTecDocSyncPaused();
  if (!paused) {
    // Nothing to do — sync is already running.
    return;
  }

  logger.info("TecDoc watchdog: API recovered while scheduler was paused, re-arming");
  await rearmAndBackfill();
}

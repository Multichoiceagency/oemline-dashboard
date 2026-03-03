import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { syncQueue, matchQueue, indexQueue } from "./queues.js";

/**
 * Sets up repeatable jobs for continuous sync, match, and index operations.
 *
 * Schedule (aggressive for initial ~2M product sync):
 * - Sync:  Every 5 minutes for each active supplier (quick recovery on failure)
 * - Match: Every 10 minutes for each active supplier
 * - Index: Every 15 minutes (search index rebuild)
 *
 * Also runs an initial sync/match/index on startup.
 */
export async function startScheduler(): Promise<void> {
  logger.info("Starting job scheduler...");

  // Clean up old repeatable jobs to avoid duplicates
  const existingSyncJobs = await syncQueue.getRepeatableJobs();
  for (const job of existingSyncJobs) {
    await syncQueue.removeRepeatableByKey(job.key);
  }

  const existingMatchJobs = await matchQueue.getRepeatableJobs();
  for (const job of existingMatchJobs) {
    await matchQueue.removeRepeatableByKey(job.key);
  }

  const existingIndexJobs = await indexQueue.getRepeatableJobs();
  for (const job of existingIndexJobs) {
    await indexQueue.removeRepeatableByKey(job.key);
  }

  // Get all active suppliers
  const suppliers = await prisma.supplier.findMany({
    where: { active: true },
    select: { code: true, name: true },
  });

  logger.info({ supplierCount: suppliers.length }, "Scheduling jobs for active suppliers");

  for (const supplier of suppliers) {
    // Schedule repeating sync: every 5 minutes (aggressive for 2M product catalog)
    await syncQueue.add(
      `sync-${supplier.code}`,
      { supplierCode: supplier.code },
      {
        repeat: { every: 5 * 60 * 1000 }, // 5 minutes
        jobId: `sync-repeat-${supplier.code}`,
      }
    );

    // Schedule repeating match: every 10 minutes
    await matchQueue.add(
      `match-${supplier.code}`,
      { supplierCode: supplier.code },
      {
        repeat: { every: 10 * 60 * 1000 }, // 10 minutes
        jobId: `match-repeat-${supplier.code}`,
      }
    );

    logger.info({ supplier: supplier.code }, "Scheduled sync (5m) and match (10m)");
  }

  // Schedule repeating index rebuild: every 2 hours
  await indexQueue.add(
    "reindex-all",
    {},
    {
      repeat: { every: 2 * 60 * 60 * 1000 }, // 2 hours
      jobId: "index-repeat-all",
    }
  );

  logger.info("Scheduled index rebuild (2h)");

  // Fire initial jobs immediately for all suppliers
  for (const supplier of suppliers) {
    await syncQueue.add(
      `sync-initial-${supplier.code}`,
      { supplierCode: supplier.code },
      { priority: 1 }
    );

    await matchQueue.add(
      `match-initial-${supplier.code}`,
      { supplierCode: supplier.code },
      { priority: 1 }
    );
  }

  // Initial index
  await indexQueue.add("reindex-initial", {}, { priority: 1 });

  logger.info("Initial sync/match/index jobs enqueued for all suppliers");
}

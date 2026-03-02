import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { syncQueue, matchQueue, indexQueue } from "./queues.js";

/**
 * Sets up repeatable jobs for continuous sync, match, and index operations.
 *
 * Schedule:
 * - Sync:  Every 30 minutes for each active supplier (continuous catalog sync)
 * - Match: Every 30 minutes for each active supplier (match new products)
 * - Index: Every 1 hour (search index rebuild)
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
    // Schedule repeating sync: every 30 minutes (continuous)
    await syncQueue.add(
      `sync-${supplier.code}`,
      { supplierCode: supplier.code },
      {
        repeat: { every: 30 * 60 * 1000 }, // 30 minutes
        jobId: `sync-repeat-${supplier.code}`,
      }
    );

    // Schedule repeating match: every 30 minutes
    await matchQueue.add(
      `match-${supplier.code}`,
      { supplierCode: supplier.code },
      {
        repeat: { every: 30 * 60 * 1000 }, // 30 minutes
        jobId: `match-repeat-${supplier.code}`,
      }
    );

    logger.info({ supplier: supplier.code }, "Scheduled sync (30m) and match (30m)");
  }

  // Schedule repeating index rebuild: every 1 hour
  await indexQueue.add(
    "reindex-all",
    {},
    {
      repeat: { every: 60 * 60 * 1000 }, // 1 hour
      jobId: "index-repeat-all",
    }
  );

  logger.info("Scheduled index rebuild (1h)");

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

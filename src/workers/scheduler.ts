import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { syncQueue, matchQueue, indexQueue } from "./queues.js";

/**
 * Sets up repeatable jobs for continuous sync, match, and index operations.
 *
 * Schedule:
 * - Sync:  Every 4 hours for each active supplier
 * - Match: Every 2 hours for each active supplier (rematch unresolved)
 * - Index: Every 6 hours (full search index rebuild)
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
    // Schedule repeating sync: every 4 hours
    await syncQueue.add(
      `sync-${supplier.code}`,
      { supplierCode: supplier.code },
      {
        repeat: { every: 4 * 60 * 60 * 1000 }, // 4 hours
        jobId: `sync-repeat-${supplier.code}`,
      }
    );

    // Schedule repeating match: every 2 hours
    await matchQueue.add(
      `match-${supplier.code}`,
      { supplierCode: supplier.code },
      {
        repeat: { every: 2 * 60 * 60 * 1000 }, // 2 hours
        jobId: `match-repeat-${supplier.code}`,
      }
    );

    logger.info({ supplier: supplier.code }, "Scheduled sync (4h) and match (2h)");
  }

  // Schedule repeating index rebuild: every 6 hours
  await indexQueue.add(
    "reindex-all",
    {},
    {
      repeat: { every: 6 * 60 * 60 * 1000 }, // 6 hours
      jobId: "index-repeat-all",
    }
  );

  logger.info("Scheduled index rebuild (6h)");

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

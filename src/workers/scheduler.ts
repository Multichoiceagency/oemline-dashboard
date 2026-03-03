import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { syncQueue, matchQueue, indexQueue, pricingQueue, stockQueue, icMatchQueue } from "./queues.js";

/**
 * Sets up repeatable jobs for continuous sync, match, pricing, stock, and index.
 *
 * Schedule:
 * - Sync:     Every 4 hours per supplier (TecDoc catalog sync)
 * - IC Match: Every 2 hours per supplier (IC product matching, fast ~2-5 min)
 * - Match:    Every 2 hours per supplier (rematch unmatched products)
 * - Pricing:  Every 1 hour (refresh prices for IC-linked products)
 * - Stock:    Every 30 minutes (refresh stock for IC-linked products)
 * - Index:    Every 2 hours (Meilisearch rebuild)
 */
export async function startScheduler(): Promise<void> {
  logger.info("Starting job scheduler...");

  // Clean up old repeatable jobs to avoid duplicates
  for (const queue of [syncQueue, matchQueue, indexQueue, pricingQueue, stockQueue, icMatchQueue]) {
    const existing = await queue.getRepeatableJobs();
    for (const job of existing) {
      await queue.removeRepeatableByKey(job.key);
    }
  }

  // Get all active suppliers
  const suppliers = await prisma.supplier.findMany({
    where: { active: true },
    select: { code: true, name: true },
  });

  logger.info({ supplierCount: suppliers.length }, "Scheduling jobs for active suppliers");

  for (const supplier of suppliers) {
    // Sync: every 4 hours (matching + price fetch combined)
    await syncQueue.add(
      `sync-${supplier.code}`,
      { supplierCode: supplier.code },
      {
        repeat: { every: 4 * 60 * 60 * 1000 },
        jobId: `sync-repeat-${supplier.code}`,
      }
    );

    // IC Match: every 2 hours (fast IC product matching, ~2-5 min per run)
    await icMatchQueue.add(
      `ic-match-${supplier.code}`,
      { supplierCode: supplier.code },
      {
        repeat: { every: 2 * 60 * 60 * 1000 },
        jobId: `ic-match-repeat-${supplier.code}`,
      }
    );

    // Match: every 2 hours (rematch unmatched products)
    await matchQueue.add(
      `match-${supplier.code}`,
      { supplierCode: supplier.code },
      {
        repeat: { every: 2 * 60 * 60 * 1000 },
        jobId: `match-repeat-${supplier.code}`,
      }
    );

    // Pricing: every 1 hour (refresh prices for linked products)
    await pricingQueue.add(
      `pricing-${supplier.code}`,
      { supplierCode: supplier.code },
      {
        repeat: { every: 60 * 60 * 1000 },
        jobId: `pricing-repeat-${supplier.code}`,
      }
    );

    // Stock: every 30 minutes (refresh stock for linked products)
    await stockQueue.add(
      `stock-${supplier.code}`,
      { supplierCode: supplier.code },
      {
        repeat: { every: 30 * 60 * 1000 },
        jobId: `stock-repeat-${supplier.code}`,
      }
    );

    logger.info({ supplier: supplier.code }, "Scheduled sync(4h), ic-match(2h), match(2h), pricing(1h), stock(30m)");
  }

  // Index: every 2 hours
  await indexQueue.add(
    "reindex-all",
    {},
    {
      repeat: { every: 2 * 60 * 60 * 1000 },
      jobId: "index-repeat-all",
    }
  );

  logger.info("Scheduled index rebuild (2h)");

  // Fire initial jobs immediately for all suppliers
  // Use jobId for deduplication — prevents duplicate jobs accumulating across restarts
  for (const supplier of suppliers) {
    await syncQueue.add(
      `sync-initial-${supplier.code}`,
      { supplierCode: supplier.code },
      { priority: 1, jobId: `sync-initial-dedup-${supplier.code}` }
    );

    await icMatchQueue.add(
      `ic-match-initial-${supplier.code}`,
      { supplierCode: supplier.code },
      { priority: 1, jobId: `ic-match-initial-dedup-${supplier.code}` }
    );

    await matchQueue.add(
      `match-initial-${supplier.code}`,
      { supplierCode: supplier.code },
      { priority: 1, jobId: `match-initial-dedup-${supplier.code}` }
    );
  }

  // Initial index
  await indexQueue.add("reindex-initial", {}, { priority: 1, jobId: "index-initial-dedup" });

  logger.info("Initial sync/ic-match/match/index jobs enqueued for all suppliers");
}

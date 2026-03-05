import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { syncQueue, matchQueue, indexQueue, pricingQueue, stockQueue, icMatchQueue, aiMatchQueue } from "./queues.js";

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
 *
 * Direct suppliers (e.g. diederichs) only get stock jobs — no TecDoc sync,
 * no IC matching, no pricing (prices come from FTP manual import).
 */
export async function startScheduler(): Promise<void> {
  logger.info("Starting job scheduler...");

  // Clean up old repeatable jobs to avoid duplicates
  for (const queue of [syncQueue, matchQueue, indexQueue, pricingQueue, stockQueue, icMatchQueue, aiMatchQueue]) {
    const existing = await queue.getRepeatableJobs();
    for (const job of existing) {
      await queue.removeRepeatableByKey(job.key);
    }
  }

  // Get all active suppliers with their adapter type
  const suppliers = await prisma.supplier.findMany({
    where: { active: true },
    select: { code: true, name: true, adapterType: true },
  });

  logger.info({ supplierCount: suppliers.length }, "Scheduling jobs for active suppliers");

  // Catalog suppliers need full TecDoc sync + IC matching.
  // Direct suppliers (diederichs, vanwezel, etc.) only need stock refresh.
  const CATALOG_TYPES = new Set(["tecdoc", "intercars", "partspoint"]);

  for (const supplier of suppliers) {
    const isDirect = !CATALOG_TYPES.has(supplier.adapterType);

    if (!isDirect) {
      // Sync: every 4 hours (TecDoc catalog + IC phase matching)
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

      // Pricing: every 1 hour (refresh prices for IC-linked products)
      await pricingQueue.add(
        `pricing-${supplier.code}`,
        { supplierCode: supplier.code },
        {
          repeat: { every: 60 * 60 * 1000 },
          jobId: `pricing-repeat-${supplier.code}`,
        }
      );
    }

    // Stock: every 30 minutes (all suppliers with fetchQuoteBatch support)
    await stockQueue.add(
      `stock-${supplier.code}`,
      { supplierCode: supplier.code },
      {
        repeat: { every: 30 * 60 * 1000 },
        jobId: `stock-repeat-${supplier.code}`,
      }
    );

    logger.info(
      { supplier: supplier.code, isDirect },
      isDirect ? "Scheduled stock(30m) [direct supplier]" : "Scheduled sync(4h), ic-match(2h), match(2h), pricing(1h), stock(30m)"
    );
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

  // AI match: every 6 hours — brand alias discovery via article overlap + Ollama LLM
  await aiMatchQueue.add(
    "ai-match-scheduled",
    {},
    {
      repeat: { every: 6 * 60 * 60 * 1000 },
      jobId: "ai-match-repeat",
    }
  );

  logger.info("Scheduled AI match (6h)");

  // Fire initial jobs immediately for all suppliers
  // Use jobId for deduplication — prevents duplicate jobs accumulating across restarts
  for (const supplier of suppliers) {
    const isDirectSupplier = !CATALOG_TYPES.has(supplier.adapterType);

    if (!isDirectSupplier) {
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

      await pricingQueue.add(
        `pricing-initial-${supplier.code}`,
        { supplierCode: supplier.code },
        { priority: 2, jobId: `pricing-initial-dedup-${supplier.code}` }
      );
    }

    await stockQueue.add(
      `stock-initial-${supplier.code}`,
      { supplierCode: supplier.code },
      { priority: 2, jobId: `stock-initial-dedup-${supplier.code}` }
    );
  }

  // Initial index
  await indexQueue.add("reindex-initial", {}, { priority: 1, jobId: "index-initial-dedup" });

  // Initial AI match (low priority — let sync/ic-match run first)
  await aiMatchQueue.add("ai-match-initial", {}, { priority: 5, jobId: "ai-match-initial-dedup" });

  logger.info("Initial jobs enqueued for all suppliers");
}

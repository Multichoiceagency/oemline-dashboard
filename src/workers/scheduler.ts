import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { syncQueue, matchQueue, indexQueue, pricingQueue, stockQueue, icMatchQueue, aiMatchQueue, brandQueue, swarmQueue, oemEnrichQueue } from "./queues.js";

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
  for (const queue of [syncQueue, matchQueue, indexQueue, pricingQueue, stockQueue, icMatchQueue, aiMatchQueue, brandQueue, swarmQueue, oemEnrichQueue]) {
    const existing = await queue.getRepeatableJobs();
    for (const job of existing) {
      await queue.removeRepeatableByKey(job.key);
    }
  }

  // Check if swarm mode is enabled (faster parallel processing)
  const useSwarmMode = process.env.USE_SWARM_MODE === "true";

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
      if (useSwarmMode) {
        // SWARM MODE: Use parallel swarm orchestration (4-5x faster)
        // Full swarm: parallel matching + parallel pricing in one job
        await swarmQueue.add(
          `swarm-full-${supplier.code}`,
          { type: "full-sync", supplierCode: supplier.code },
          {
            repeat: { every: 2 * 60 * 60 * 1000 }, // Every 2 hours (faster refresh)
            jobId: `swarm-full-repeat-${supplier.code}`,
          }
        );
        logger.info(
          { supplier: supplier.code, mode: "swarm" },
          "Scheduled swarm full-sync (2h) - 4-5x faster than sequential"
        );
      } else {
        // LEGACY MODE: Sequential processing
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

        logger.info(
          { supplier: supplier.code, mode: "legacy" },
          "Scheduled sync(4h), ic-match(2h), match(2h), pricing(1h)"
        );
      }
    }

    // Stock: every 30 minutes (all suppliers with fetchQuoteBatch support)
    // In swarm mode, this is handled by the swarm job, but we keep a fallback
    if (!useSwarmMode || isDirect) {
      await stockQueue.add(
        `stock-${supplier.code}`,
        { supplierCode: supplier.code },
        {
          repeat: { every: 30 * 60 * 1000 },
          jobId: `stock-repeat-${supplier.code}`,
        }
      );
    }

    if (isDirect) {
      logger.info({ supplier: supplier.code }, "Scheduled stock(30m) [direct supplier]");
    }
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

  // Brand sync: every 24 hours — sync brands from TecDoc + fetch logos + cleanup empty
  await brandQueue.add(
    "brand-sync-scheduled",
    {},
    {
      repeat: { every: 24 * 60 * 60 * 1000 },
      jobId: "brand-sync-repeat",
    }
  );
  logger.info("Scheduled brand sync (24h)");

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

  // OEM enrichment: every 6 hours — fetch OEM cross-references from TecDoc API
  // Populates product_maps.oem_numbers for IC matching Phase 2B
  await oemEnrichQueue.add(
    "oem-enrich-scheduled",
    { batchSize: 100, maxProducts: 50_000 },
    {
      repeat: { every: 6 * 60 * 60 * 1000 },
      jobId: "oem-enrich-repeat",
    }
  );
  logger.info("Scheduled OEM enrichment (6h)");

  // Fire initial jobs immediately for all suppliers
  // Use jobId for deduplication — prevents duplicate jobs accumulating across restarts
  for (const supplier of suppliers) {
    const isDirectSupplier = !CATALOG_TYPES.has(supplier.adapterType);

    if (!isDirectSupplier) {
      if (useSwarmMode) {
        // SWARM MODE: Fire single optimized swarm job
        await swarmQueue.add(
          `swarm-initial-${supplier.code}`,
          { type: "full-sync", supplierCode: supplier.code, triggerReindex: true },
          { priority: 1, jobId: `swarm-initial-dedup-${supplier.code}` }
        );
        logger.info({ supplier: supplier.code }, "Fired initial swarm job (parallel mode)");
      } else {
        // LEGACY MODE: Fire individual jobs
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
    }

    if (!useSwarmMode || isDirectSupplier) {
      await stockQueue.add(
        `stock-initial-${supplier.code}`,
        { supplierCode: supplier.code },
        { priority: 2, jobId: `stock-initial-dedup-${supplier.code}` }
      );
    }
  }

  // Initial brand sync (low priority — let product sync run first)
  await brandQueue.add("brand-sync-initial", {}, { priority: 3, jobId: "brand-sync-initial-dedup" });

  // Initial index
  await indexQueue.add("reindex-initial", {}, { priority: 1, jobId: "index-initial-dedup" });

  // Initial AI match (low priority — let sync/ic-match run first)
  await aiMatchQueue.add("ai-match-initial", {}, { priority: 5, jobId: "ai-match-initial-dedup" });

  logger.info("Initial jobs enqueued for all suppliers");
}

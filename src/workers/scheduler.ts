import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { syncQueue, matchQueue, indexQueue, pricingQueue, stockQueue, icMatchQueue, aiMatchQueue, brandQueue, swarmQueue, oemEnrichQueue, icCatalogQueue, icEnrichQueue, icCsvSyncQueue, aiCoordinatorQueue, tecdocWatchdogQueue } from "./queues.js";

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
  for (const queue of [syncQueue, matchQueue, indexQueue, pricingQueue, stockQueue, icMatchQueue, aiMatchQueue, brandQueue, swarmQueue, oemEnrichQueue, icCatalogQueue, icEnrichQueue, icCsvSyncQueue, aiCoordinatorQueue, tecdocWatchdogQueue]) {
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
        // For tecdoc we honour an operator-set "paused" flag so restarts don't
        // undo a deliberate pause during a TecDoc outage. The watchdog will
        // flip the flag off and add the repeatables back once the API recovers.
        const paused = supplier.code === "tecdoc"
          ? (await prisma.setting.findUnique({ where: { key: "tecdoc_sync_paused" } }))?.value === "true"
          : false;

        if (!paused) {
          // Sync: every 4 hours (TecDoc catalog + IC phase matching)
          await syncQueue.add(
            `sync-${supplier.code}`,
            { supplierCode: supplier.code },
            {
              repeat: { every: 4 * 60 * 60 * 1000 },
              jobId: `sync-repeat-${supplier.code}`,
            }
          );

          // Match: every 1 hour (rematch unmatched products)
          await matchQueue.add(
            `match-${supplier.code}`,
            { supplierCode: supplier.code },
            {
              repeat: { every: 60 * 60 * 1000 },
              jobId: `match-repeat-${supplier.code}`,
            }
          );
        } else {
          logger.warn(
            { supplier: supplier.code },
            "Sync + match schedulers skipped (tecdoc_sync_paused=true) — watchdog will rearm on recovery",
          );
        }

        // IC Match: every 1 hour (fast IC product matching, ~2-5 min per run)
        // Doesn't hit TecDoc API — always armed regardless of tecdoc pause flag.
        await icMatchQueue.add(
          `ic-match-${supplier.code}`,
          { supplierCode: supplier.code },
          {
            repeat: { every: 60 * 60 * 1000 },
            jobId: `ic-match-repeat-${supplier.code}`,
          }
        );

        // Pricing: every 1 hour (API refresh for real-time price updates)
        await pricingQueue.add(
          `pricing-${supplier.code}`,
          { supplierCode: supplier.code },
          {
            repeat: { every: 60 * 60 * 1000 },
            jobId: `pricing-repeat-${supplier.code}`,
          }
        );

        logger.info(
          { supplier: supplier.code, mode: "legacy", paused },
          `Scheduled ${paused ? "ic-match(1h), pricing(1h) only — sync/match paused" : "sync(4h), ic-match(1h), match(1h), pricing(1h)"}`,
        );
      }
    }

    // Stock: only for direct suppliers (DIEDERICHS, VAN WEZEL, etc.)
    // For IC-linked suppliers, the pricing worker already updates stock via /inventory/quote
    // Running a separate stock worker wastes IC API quota (same endpoint, same data)
    if (isDirect) {
      await stockQueue.add(
        `stock-${supplier.code}`,
        { supplierCode: supplier.code },
        {
          repeat: { every: 30 * 60 * 1000 },
          jobId: `stock-repeat-${supplier.code}`,
        }
      );
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

  // IC catalog sync via API: DISABLED — gets stuck on rate limiting (30 req/min × 3M+ products).
  // The ic-csv-sync worker fills intercars_mappings from the daily ProductInformation CSV
  // (same data, zero API calls, completes in ~2 min). ic-catalog API crawl is redundant.
  logger.info("IC catalog API sync DISABLED — CSV worker handles intercars_mappings");

  // IC enrichment: DISABLED while catalog crawl is in progress.
  // IC enrich makes parallel API calls that flood the IC rate limit (60 req/min)
  // and block the catalog crawler. Re-enable after full 3M catalog is crawled.
  // await icEnrichQueue.add(
  //   "ic-enrich-scheduled",
  //   { mode: "full", maxEnrich: 50_000, parallelism: 20 },
  //   {
  //     repeat: { every: 6 * 60 * 60 * 1000 },
  //     jobId: "ic-enrich-repeat",
  //   }
  // );
  logger.info("IC enrichment DISABLED (catalog crawl in progress)");

  // IC CSV sync: every 6h — download fresh prices/stock from IC HTTPS CSVs
  // IC regenerates CSVs daily at 3-5:30 AM Polish time, but we run every 6h to
  // catch the new file as soon as it's available. Falls back to yesterday's file.
  // Zero API calls, zero rate limiting, complete data in ~2 minutes.
  await icCsvSyncQueue.add(
    "ic-csv-sync-scheduled",
    { priceStockOnly: false },
    {
      repeat: { every: 6 * 60 * 60 * 1000 }, // Every 6 hours
      jobId: "ic-csv-sync-repeat",
    }
  );
  logger.info("Scheduled IC CSV sync (6h — prices/stock from CSV)");

  // AI Coordinator: Ollama-powered orchestrator — analyzes platform state every 30 min
  // Uses Ollama (llama3.2:3b) to decide which workers to trigger next for optimal throughput
  await aiCoordinatorQueue.add(
    "ai-coordinator-scheduled",
    {},
    {
      repeat: { every: 30 * 60 * 1000 }, // Every 30 minutes
      jobId: "ai-coordinator-repeat",
    }
  );
  logger.info("Scheduled AI Coordinator (30m — Ollama-powered worker orchestration)");

  // TecDoc watchdog: probes TecDoc every 5 min; auto-rearms sync+match when
  // the API recovers from an outage/quota-exceeded state.
  await tecdocWatchdogQueue.add(
    "tecdoc-watchdog-scheduled",
    {},
    {
      repeat: { every: 5 * 60 * 1000 },
      jobId: "tecdoc-watchdog-repeat",
    }
  );
  logger.info("Scheduled TecDoc watchdog (5m — auto-rearm on recovery)");

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

    // Stock initial only for direct suppliers (IC stock comes via pricing worker)
    if (isDirectSupplier) {
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

  // Initial IC CSV sync (high priority — gets all IC prices immediately on startup)
  await icCsvSyncQueue.add(
    "ic-csv-sync-initial",
    { priceStockOnly: false },
    { priority: 1, jobId: "ic-csv-sync-initial-dedup" }
  );

  // Initial IC catalog crawl (low priority — long-running, runs after sync/match)
  await icCatalogQueue.add(
    "ic-catalog-initial",
    { skipDetails: true },
    { priority: 5, jobId: "ic-catalog-initial-dedup" }
  );

  // Initial AI coordinator run (runs immediately to assess state and trigger needed workers)
  await aiCoordinatorQueue.add(
    "ai-coordinator-initial",
    {},
    { priority: 1, jobId: "ai-coordinator-initial-dedup" }
  );

  logger.info("Initial jobs enqueued for all suppliers");
}

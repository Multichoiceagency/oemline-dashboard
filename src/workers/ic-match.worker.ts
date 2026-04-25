import { Job } from "bullmq";
import { logger } from "../lib/logger.js";
import { getAdapterOrLoad } from "../adapters/registry.js";

interface IcMatchJobData {
  supplierCode?: string;
}

/**
 * IC Match worker: runs InterCars product matching (Phase 0-1D) only.
 * Fast: completes in ~2-5 minutes.
 * Pricing/stock fetching is handled separately by the pricing/stock workers.
 *
 * Runs on the dedicated "ic-match" queue, completely isolated from TecDoc sync.
 */
export async function processIcMatchJob(job: Job<IcMatchJobData>): Promise<void> {
  const { supplierCode = "intercars" } = job.data;

  const adapter = await getAdapterOrLoad(supplierCode);
  if (!adapter) {
    logger.warn({ supplierCode }, "No adapter for ic-match job");
    return;
  }

  // IC phase matching only makes sense for the intercars adapter — running it
  // against e.g. tecdoc would invoke TecDocAdapter.syncCatalog (full TecDoc
  // API crawl), which is exactly what this worker is meant to stay isolated from.
  if (adapter.code !== "intercars") {
    logger.warn(
      { supplierCode, adapterCode: adapter.code },
      "Skipping ic-match: only the intercars adapter supports IC phase matching",
    );
    return;
  }

  const { prisma } = await import("../lib/prisma.js");

  logger.info({ supplierCode }, "IC match job starting");

  let batchCount = 0;
  let matchedCount = 0;

  try {
    // syncCatalog now only runs Phase 0-1D (fast matching, no pricing API calls)
    for await (const products of adapter.syncCatalog("")) {
      batchCount++;
      matchedCount += products.length;
      // Extend lock — phases can take >10 min on 1M+ datasets
      try { await job.extendLock(job.token!, 1_200_000); } catch { /* ok */ }
      await job.updateProgress(batchCount);
    }
  } catch (err) {
    // Re-throw so BullMQ marks the job as failed with proper reason and can retry
    logger.error({ err, supplierCode, batchCount, matchedCount }, "IC match job failed");
    throw err;
  }

  logger.info({ supplierCode, batchCount, matchedCount }, "IC match job completed");
}

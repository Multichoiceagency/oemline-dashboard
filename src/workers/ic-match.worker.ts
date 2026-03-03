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

  const { prisma } = await import("../lib/prisma.js");

  logger.info({ supplierCode }, "IC match job starting");

  let batchCount = 0;
  let matchedCount = 0;

  // syncCatalog now only runs Phase 0-1D (fast matching, no pricing API calls)
  for await (const products of adapter.syncCatalog("")) {
    batchCount++;
    matchedCount += products.length;
    await job.updateProgress(batchCount);
  }

  logger.info({ supplierCode, batchCount, matchedCount }, "IC match job completed");
}

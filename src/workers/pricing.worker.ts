import { Job } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { getAdapterOrLoad } from "../adapters/registry.js";
import { sendWorkerNotification } from "../lib/notify.js";
import { pricingQueue } from "./queues.js";

interface PricingJobData {
  supplierCode?: string;
  minId?: number;
  maxId?: number;
  isSubJob?: boolean;
  staleMinutes?: number;
}

// ── Tuning knobs (aggressive for 1M+ products) ─────────────────────────────
const API_BATCH_SIZE = 30;         // IC API max per call
const PARALLEL_API_CALLS = 5;      // Concurrent API requests (was 25 — caused 429 floods)
const DB_PAGE_SIZE = 5000;         // Products per cursor page
const RATE_LIMIT_PAUSE = 150;      // ms between parallel groups (was 20ms — too aggressive)
const SUB_JOB_SIZE = 50_000;       // ID range per sub-job (sparse IDs, actual products << this)
const DEFAULT_STALE_MINUTES = 45;  // Only re-price products older than this

interface ProductRow { id: number; ic_sku: string }

/**
 * Pricing worker for 1M+ products.
 *
 * Architecture:
 * 1. Parent job queries ID range → fans out ~100 sub-jobs
 * 2. BullMQ distributes sub-jobs across all worker pods
 * 3. Each sub-job: 25 parallel API calls, double-buffer pipelining, bulk DB
 * 4. Skips recently updated products (staleMinutes)
 * 5. Sends email notification on parent job completion
 */
export async function processPricingJob(job: Job<PricingJobData>): Promise<void> {
  const {
    supplierCode = "intercars",
    isSubJob = false,
    minId,
    maxId,
    staleMinutes = DEFAULT_STALE_MINUTES,
  } = job.data;

  // ── Sub-job: process a specific ID range ──────────────────────────────────
  if (isSubJob && minId != null && maxId != null) {
    await processRange(supplierCode, minId, maxId, staleMinutes, job);
    return;
  }

  // ── Parent job: fan out into sub-jobs ─────────────────────────────────────
  const adapter = await getAdapterOrLoad(supplierCode);
  if (!adapter || typeof (adapter as any).fetchQuoteBatch !== "function") {
    logger.info({ supplierCode }, "Adapter does not support fetchQuoteBatch, skipping");
    return;
  }

  const startTime = Date.now();

  // Skip fan-out if sub-jobs are already pending (prevents accumulation)
  const pending = await pricingQueue.getJobCounts("active", "waiting", "prioritized");
  const pendingTotal = pending.active + pending.waiting + pending.prioritized;
  if (pendingTotal > 5) {
    logger.info({ supplierCode, pendingTotal }, "Pricing: skipping fan-out, sub-jobs still pending");
    return;
  }

  const range = await prisma.$queryRawUnsafe<[{ min_id: number; max_id: number; cnt: bigint }]>(
    `SELECT MIN(id) AS min_id, MAX(id) AS max_id, COUNT(*) AS cnt
     FROM product_maps
     WHERE ic_sku IS NOT NULL AND status = 'active'`
  );

  const { min_id, max_id, cnt } = range[0];
  const total = Number(cnt);

  if (total === 0) {
    logger.info({ supplierCode }, "No products with IC SKU to price");
    return;
  }

  // Small catalogs: process directly + send notification
  if (total <= SUB_JOB_SIZE) {
    const result = await processRange(supplierCode, min_id, max_id, staleMinutes, job);
    await sendWorkerNotification({
      worker: "Pricing",
      status: "completed",
      supplierCode,
      totalProducts: total,
      totalUpdated: result.updated,
      totalErrors: result.errors,
      durationMs: Date.now() - startTime,
      throughput: result.throughputStr,
    });
    return;
  }

  // Fan out: create sub-jobs by ID range
  const subJobs: Array<{ name: string; data: PricingJobData; opts: Record<string, unknown> }> = [];
  for (let start = min_id; start <= max_id; start += SUB_JOB_SIZE) {
    const end = Math.min(start + SUB_JOB_SIZE - 1, max_id);
    subJobs.push({
      name: `pricing-${supplierCode}-${start}-${end}`,
      data: { supplierCode, minId: start, maxId: end, isSubJob: true, staleMinutes },
      opts: {
        priority: 2,
        jobId: `pricing-sub-${supplierCode}-${start}`,
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 100 },
      },
    });
  }

  await pricingQueue.addBulk(subJobs);

  const durationMs = Date.now() - startTime;

  logger.info({
    supplierCode, totalProducts: total, subJobs: subJobs.length, durationMs,
  }, `Pricing fan-out: ${subJobs.length} sub-jobs created for ${total} products`);

  await sendWorkerNotification({
    worker: "Pricing",
    status: "completed",
    supplierCode,
    totalProducts: total,
    subJobs: subJobs.length,
    durationMs,
    throughput: `${subJobs.length} sub-jobs distributed across workers`,
  });
}

interface RangeResult { updated: number; errors: number; throughputStr: string }

async function processRange(
  supplierCode: string,
  minId: number,
  maxId: number,
  staleMinutes: number,
  job: Job
): Promise<RangeResult> {
  const adapter = await getAdapterOrLoad(supplierCode);
  if (!adapter) return { updated: 0, errors: 0, throughputStr: "0" };
  const icAdapter = adapter as any;

  const startTime = Date.now();
  let lastId = minId - 1;
  let totalUpdated = 0;
  let totalErrors = 0;
  let pendingDbWrite: Promise<void> | null = null;

  while (lastId < maxId) {
    const products = await prisma.$queryRawUnsafe<ProductRow[]>(
      `SELECT id, ic_sku FROM product_maps
       WHERE ic_sku IS NOT NULL
         AND status = 'active'
         AND id > $1 AND id <= $2
         AND updated_at < NOW() - INTERVAL '${staleMinutes} minutes'
       ORDER BY id ASC
       LIMIT $3`,
      lastId, maxId, DB_PAGE_SIZE
    );

    if (products.length === 0) {
      const remaining = await prisma.$queryRawUnsafe<[{ next_id: number | null }]>(
        `SELECT MIN(id) AS next_id FROM product_maps
         WHERE id > $1 AND id <= $2 AND ic_sku IS NOT NULL AND status = 'active'`,
        lastId, maxId
      );
      if (!remaining[0].next_id) break;
      lastId = remaining[0].next_id - 1;
      continue;
    }

    lastId = products[products.length - 1].id;

    const apiBatches: ProductRow[][] = [];
    for (let i = 0; i < products.length; i += API_BATCH_SIZE) {
      apiBatches.push(products.slice(i, i + API_BATCH_SIZE));
    }

    for (let i = 0; i < apiBatches.length; i += PARALLEL_API_CALLS) {
      const group = apiBatches.slice(i, i + PARALLEL_API_CALLS);

      if (pendingDbWrite) {
        await pendingDbWrite;
        pendingDbWrite = null;
      }

      const results = await Promise.allSettled(
        group.map((batch) => fetchQuotes(icAdapter, batch))
      );

      const allUpdates: Array<{ id: number; price: number | null; stock: number; currency: string }> = [];
      for (const r of results) {
        if (r.status === "fulfilled") allUpdates.push(...r.value);
        else totalErrors++;
      }

      if (allUpdates.length > 0) {
        const updates = allUpdates;
        pendingDbWrite = bulkUpdatePrices(updates)
          .then(() => { totalUpdated += updates.length; })
          .catch((err) => {
            totalErrors += updates.length;
            if (totalErrors <= 10) logger.warn({ err }, "Bulk pricing update failed");
          });
      }

      if (i + PARALLEL_API_CALLS < apiBatches.length) {
        await new Promise((r) => setTimeout(r, RATE_LIMIT_PAUSE));
      }
    }

    await job.updateProgress(totalUpdated);
  }

  if (pendingDbWrite) await pendingDbWrite;

  const durationMs = Date.now() - startTime;
  const throughput = durationMs > 0 ? Math.round((totalUpdated / (durationMs / 1000)) * 60) : 0;
  return { updated: totalUpdated, errors: totalErrors, throughputStr: `${throughput.toLocaleString()}/min` };
}

async function fetchQuotes(
  adapter: any,
  products: ProductRow[]
): Promise<Array<{ id: number; price: number | null; stock: number; currency: string }>> {
  const skus = products.map((p) => p.ic_sku);
  const quoteMap = await adapter.fetchQuoteBatch(skus);
  const updates: Array<{ id: number; price: number | null; stock: number; currency: string }> = [];
  for (const product of products) {
    const quote = quoteMap.get(product.ic_sku);
    if (quote) updates.push({ id: product.id, price: quote.price, stock: quote.stock, currency: quote.currency });
  }
  return updates;
}

async function bulkUpdatePrices(
  updates: Array<{ id: number; price: number | null; stock: number; currency: string }>
): Promise<void> {
  if (updates.length === 0) return;
  const valuesList = updates
    .map((u) => `(${u.id}, ${u.price ?? "NULL"}, ${u.stock}, '${u.currency.replace(/'/g, "''")}')`)
    .join(",\n");
  await prisma.$executeRawUnsafe(
    `UPDATE product_maps AS pm SET
      price = COALESCE(v.price, pm.price),
      stock = v.stock,
      currency = COALESCE(v.currency, pm.currency),
      updated_at = NOW()
    FROM (VALUES ${valuesList}) AS v(id, price, stock, currency)
    WHERE pm.id = v.id`
  );
}

import { prisma } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";
import { getAdapterOrLoad } from "../../adapters/registry.js";

interface PricingResult {
  totalUpdated: number;
  totalErrors: number;
  durationMs: number;
  parallelWorkers: number;
}

const PARALLEL_API_BATCHES = 5; // Number of concurrent API calls
const API_BATCH_SIZE = 20; // SKUs per API call
const DB_BATCH_SIZE = 500; // Products fetched per DB query
const RATE_LIMIT_DELAY = 100; // ms between batch groups

interface ProductRecord {
  id: number;
  ic_sku: string;
}

/**
 * Process a single batch of products - fetch quotes and update DB
 */
async function processBatch(
  adapter: any,
  products: ProductRecord[]
): Promise<{ updated: number; errors: number }> {
  let updated = 0;
  let errors = 0;

  const skus = products.map((p) => p.ic_sku);
  
  try {
    const quoteMap = await adapter.fetchQuoteBatch(skus);

    // Batch DB updates for efficiency
    const updates: Array<{ id: number; price: number | null; stock: number; currency: string }> = [];
    
    for (const product of products) {
      const quote = quoteMap.get(product.ic_sku);
      if (quote) {
        updates.push({
          id: product.id,
          price: quote.price,
          stock: quote.stock,
          currency: quote.currency,
        });
      }
    }

    if (updates.length > 0) {
      // Use single UPDATE with CASE statements for efficiency
      const priceCases = updates.map((u) => `WHEN ${u.id} THEN ${u.price ?? "NULL"}`).join(" ");
      const stockCases = updates.map((u) => `WHEN ${u.id} THEN ${u.stock}`).join(" ");
      const currencyCases = updates.map((u) => `WHEN ${u.id} THEN '${u.currency}'`).join(" ");
      const ids = updates.map((u) => u.id).join(",");

      await prisma.$executeRawUnsafe(
        `UPDATE product_maps SET
          price = COALESCE(CASE id ${priceCases} END, price),
          stock = CASE id ${stockCases} END,
          currency = COALESCE(CASE id ${currencyCases} END, currency),
          updated_at = NOW()
        WHERE id IN (${ids})`
      );
      updated = updates.length;
    }
  } catch (err) {
    errors = products.length;
  }

  return { updated, errors };
}

/**
 * Run parallel pricing refresh using swarm pattern.
 * Fetches products in chunks and processes API calls concurrently.
 */
export async function runParallelPricing(
  supplierCode = "intercars"
): Promise<PricingResult> {
  const startTime = Date.now();
  
  const adapter = await getAdapterOrLoad(supplierCode);
  if (!adapter) {
    logger.warn({ supplierCode }, "No adapter found for pricing");
    return { totalUpdated: 0, totalErrors: 0, durationMs: 0, parallelWorkers: 0 };
  }

  const icAdapter = adapter as any;
  if (typeof icAdapter.fetchQuoteBatch !== "function") {
    logger.info({ supplierCode }, "Adapter does not support fetchQuoteBatch");
    return { totalUpdated: 0, totalErrors: 0, durationMs: 0, parallelWorkers: 0 };
  }

  logger.info({ supplierCode, parallelWorkers: PARALLEL_API_BATCHES }, "Starting parallel pricing swarm");

  let offset = 0;
  let totalUpdated = 0;
  let totalErrors = 0;

  while (true) {
    // Fetch larger batch to keep parallel workers busy
    const products = await prisma.$queryRawUnsafe<ProductRecord[]>(
      `SELECT id, ic_sku FROM product_maps
       WHERE ic_sku IS NOT NULL AND status = 'active'
       ORDER BY id ASC
       LIMIT ${DB_BATCH_SIZE} OFFSET ${offset}`
    );

    if (products.length === 0) break;
    offset += DB_BATCH_SIZE;

    // Split into API-sized batches
    const apiBatches: ProductRecord[][] = [];
    for (let i = 0; i < products.length; i += API_BATCH_SIZE) {
      apiBatches.push(products.slice(i, i + API_BATCH_SIZE));
    }

    // Process PARALLEL_API_BATCHES concurrently
    for (let i = 0; i < apiBatches.length; i += PARALLEL_API_BATCHES) {
      const parallelBatches = apiBatches.slice(i, i + PARALLEL_API_BATCHES);
      
      const results = await Promise.allSettled(
        parallelBatches.map((batch) => processBatch(icAdapter, batch))
      );

      for (const result of results) {
        if (result.status === "fulfilled") {
          totalUpdated += result.value.updated;
          totalErrors += result.value.errors;
        } else {
          totalErrors += API_BATCH_SIZE;
        }
      }

      // Brief rate limit pause between parallel batch groups
      await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY));
    }
  }

  const durationMs = Date.now() - startTime;

  logger.info({
    supplierCode,
    totalUpdated,
    totalErrors,
    durationMs,
    throughput: Math.round((totalUpdated / (durationMs / 1000)) * 60) + " products/min",
  }, "Parallel pricing completed");

  return { totalUpdated, totalErrors, durationMs, parallelWorkers: PARALLEL_API_BATCHES };
}

/**
 * Run parallel stock refresh - same pattern as pricing.
 */
export async function runParallelStock(
  supplierCode = "intercars"
): Promise<PricingResult> {
  // Stock uses the same API (fetchQuoteBatch returns price+stock)
  // so we reuse the parallel pricing logic
  return runParallelPricing(supplierCode);
}

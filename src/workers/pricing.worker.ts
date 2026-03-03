import { Job } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { getAdapterOrLoad } from "../adapters/registry.js";

interface PricingJobData {
  supplierCode?: string;
  batchSize?: number;
}

/**
 * Pricing worker: refreshes prices for products with stored icSku.
 * Runs independently from sync — uses the stored IC SKU to directly
 * call the pricing API without re-matching.
 */
export async function processPricingJob(job: Job<PricingJobData>): Promise<void> {
  const { supplierCode = "intercars", batchSize = 500 } = job.data;

  const adapter = await getAdapterOrLoad(supplierCode);
  if (!adapter) {
    logger.warn({ supplierCode }, "No adapter found for pricing job");
    return;
  }

  // Only IC-type adapters support batch quotes — exit early for others
  const icAdapter = adapter as any;
  if (typeof icAdapter.fetchQuoteBatch !== "function") {
    logger.info({ supplierCode }, "Adapter does not support fetchQuoteBatch, skipping pricing job");
    return;
  }

  logger.info({ supplierCode }, "Starting pricing refresh for IC-linked products");

  let offset = 0;
  let totalUpdated = 0;
  let totalErrors = 0;
  const BATCH_SIZE = 20;

  while (true) {
    // Get products that have IC SKU but haven't been price-updated recently
    const products = await prisma.$queryRawUnsafe<Array<{
      id: number;
      ic_sku: string;
    }>>(
      `SELECT id, ic_sku FROM product_maps
       WHERE ic_sku IS NOT NULL AND status = 'active'
       ORDER BY updated_at ASC
       LIMIT ${batchSize} OFFSET ${offset}`
    );

    if (products.length === 0) break;
    offset += batchSize;

    // Process in API batch sizes
    for (let i = 0; i < products.length; i += BATCH_SIZE) {
      const batch = products.slice(i, i + BATCH_SIZE);
      const skus = batch.map((p) => p.ic_sku);

      try {
        const quoteMap = await icAdapter.fetchQuoteBatch(skus);

        for (const product of batch) {
          const quote = quoteMap.get(product.ic_sku);
          if (!quote) continue;

          try {
            await prisma.$executeRawUnsafe(
              `UPDATE product_maps SET
                price = COALESCE($1, price),
                stock = $2,
                currency = COALESCE($3, currency),
                updated_at = NOW()
              WHERE id = $4`,
              quote.price,
              quote.stock,
              quote.currency,
              product.id
            );
            totalUpdated++;
          } catch {
            // Skip
          }
        }
      } catch (err) {
        totalErrors++;
        if (totalErrors <= 5) {
          logger.warn({ err, supplierCode }, "Pricing batch failed");
        }
        // Brief pause on error
        await new Promise((r) => setTimeout(r, 5000));
      }

      // Rate limit
      await new Promise((r) => setTimeout(r, 300));
    }

    await job.updateProgress(offset);
  }

  logger.info(
    { supplierCode, totalUpdated, totalErrors, offset },
    "Pricing refresh completed"
  );
}

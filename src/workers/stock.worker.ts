import { Job } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { getAdapterOrLoad } from "../adapters/registry.js";

interface StockJobData {
  supplierCode?: string;
  batchSize?: number;
}

/**
 * Stock worker: refreshes stock levels for products with stored icSku.
 * Uses stored IC SKU to directly call the IC stock API.
 */
export async function processStockJob(job: Job<StockJobData>): Promise<void> {
  const { supplierCode = "intercars", batchSize = 500 } = job.data;

  const adapter = await getAdapterOrLoad(supplierCode);
  if (!adapter) {
    logger.warn({ supplierCode }, "No adapter found for stock job");
    return;
  }

  logger.info({ supplierCode }, "Starting stock refresh for IC-linked products");

  let offset = 0;
  let totalUpdated = 0;
  let totalErrors = 0;
  const BATCH_SIZE = 20;

  while (true) {
    // Get IC-linked products, oldest-updated first
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

    for (let i = 0; i < products.length; i += BATCH_SIZE) {
      const batch = products.slice(i, i + BATCH_SIZE);
      const skus = batch.map((p) => p.ic_sku);

      try {
        const icAdapter = adapter as any;
        if (typeof icAdapter.fetchQuoteBatch === "function") {
          const quoteMap = await icAdapter.fetchQuoteBatch(skus);

          for (const product of batch) {
            const quote = quoteMap.get(product.ic_sku);
            if (!quote) continue;

            try {
              await prisma.$executeRawUnsafe(
                `UPDATE product_maps SET
                  stock = $1,
                  updated_at = NOW()
                WHERE id = $2`,
                quote.stock,
                product.id
              );
              totalUpdated++;
            } catch {
              // Skip
            }
          }
        }
      } catch (err) {
        totalErrors++;
        if (totalErrors <= 5) {
          logger.warn({ err, supplierCode }, "Stock batch failed");
        }
        await new Promise((r) => setTimeout(r, 5000));
      }

      await new Promise((r) => setTimeout(r, 300));
    }

    await job.updateProgress(offset);
  }

  logger.info(
    { supplierCode, totalUpdated, totalErrors, offset },
    "Stock refresh completed"
  );
}

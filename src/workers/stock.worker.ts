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

  // Only IC-type adapters support batch quotes — exit early for others
  const icAdapter = adapter as any;
  if (typeof icAdapter.fetchQuoteBatch !== "function") {
    logger.info({ supplierCode }, "Adapter does not support fetchQuoteBatch, skipping stock job");
    return;
  }

  // IC-based suppliers (intercars) use the ic_sku cross-reference field.
  // Direct suppliers (diederichs, etc.) use their own sku field.
  const isIcLinked = supplierCode === "intercars";

  logger.info({ supplierCode, isIcLinked }, "Starting stock refresh");

  let offset = 0;
  let totalUpdated = 0;
  let totalErrors = 0;
  const BATCH_SIZE = 20;

  while (true) {
    const products = await (isIcLinked
      ? prisma.$queryRawUnsafe<Array<{ id: number; ic_sku: string }>>(
          `SELECT id, ic_sku FROM product_maps
           WHERE ic_sku IS NOT NULL AND status = 'active'
           ORDER BY id ASC
           LIMIT ${batchSize} OFFSET ${offset}`
        )
      : prisma.$queryRawUnsafe<Array<{ id: number; ic_sku: string }>>(
          `SELECT pm.id, pm.sku AS ic_sku
           FROM product_maps pm
           JOIN suppliers s ON s.id = pm.supplier_id
           WHERE s.code = $1 AND pm.status = 'active'
           ORDER BY pm.id ASC
           LIMIT ${batchSize} OFFSET ${offset}`,
          supplierCode
        ));

    if (products.length === 0) break;
    offset += batchSize;

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
                stock = $1,
                price = COALESCE($2, price),
                currency = COALESCE($3, currency),
                updated_at = NOW()
              WHERE id = $4`,
              quote.stock,
              quote.price,
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

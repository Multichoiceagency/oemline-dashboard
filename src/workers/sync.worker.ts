import { Job } from "bullmq";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { getAdapter } from "../adapters/registry.js";
import { indexQueue } from "./queues.js";
import type { SupplierCatalogItem } from "../types/index.js";

interface SyncJobData {
  supplierCode: string;
  cursor?: string;
}

const UPSERT_BATCH_SIZE = 200;

export async function processSyncJob(job: Job<SyncJobData>): Promise<void> {
  const { supplierCode, cursor } = job.data;
  const adapter = getAdapter(supplierCode);

  if (!adapter) {
    throw new Error(`Unknown supplier: ${supplierCode}`);
  }

  const supplier = await prisma.supplier.findUnique({
    where: { code: supplierCode },
  });

  if (!supplier) {
    throw new Error(`Supplier not in database: ${supplierCode}`);
  }

  logger.info({ supplier: supplierCode, cursor }, "Starting catalog sync");

  let totalProcessed = 0;
  let batchCount = 0;

  const catalogIterator = adapter.syncCatalog(cursor);

  for await (const batch of catalogIterator) {
    batchCount++;

    // Process in chunks using batch upsert via raw SQL
    for (let i = 0; i < batch.length; i += UPSERT_BATCH_SIZE) {
      const chunk = batch.slice(i, i + UPSERT_BATCH_SIZE);
      await batchUpsertProducts(supplier.id, chunk);
    }

    totalProcessed += batch.length;
    await job.updateProgress(totalProcessed);

    logger.info(
      { supplier: supplierCode, batch: batchCount, processed: totalProcessed },
      "Sync batch processed"
    );
  }

  // Trigger reindex after sync
  await indexQueue.add("reindex", { supplierCode }, { priority: 5 });

  logger.info(
    { supplier: supplierCode, total: totalProcessed, batches: batchCount },
    "Catalog sync completed"
  );
}

async function batchUpsertProducts(supplierId: number, items: SupplierCatalogItem[]): Promise<void> {
  if (items.length === 0) return;

  const values = items.map(
    (item) =>
      Prisma.sql`(${supplierId}, 1, ${item.sku}, ${item.articleNo}, ${item.ean}, ${item.tecdocId}, ${item.oem}, ${item.description}, NOW(), NOW())`
  );

  await prisma.$executeRaw`
    INSERT INTO product_maps (supplier_id, brand_id, sku, article_no, ean, tecdoc_id, oem, description, created_at, updated_at)
    VALUES ${Prisma.join(values)}
    ON CONFLICT (supplier_id, sku)
    DO UPDATE SET
      article_no = EXCLUDED.article_no,
      ean = EXCLUDED.ean,
      tecdoc_id = EXCLUDED.tecdoc_id,
      oem = EXCLUDED.oem,
      description = EXCLUDED.description,
      updated_at = NOW()
  `;
}

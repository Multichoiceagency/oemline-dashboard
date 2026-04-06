import { Job } from "bullmq";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";
import { getAdapterOrLoad } from "../../adapters/registry.js";
import type { SupplierCatalogItem } from "../../types/index.js";

interface SyncJobData {
  supplierCode: string;
  cursor?: string;
}

interface PipelineSyncResult {
  totalProcessed: number;
  batchCount: number;
  durationMs: number;
  avgBatchMs: number;
}

const UPSERT_BATCH_SIZE = 2000;
const MAX_PARALLEL_CHUNKS = 6; // Increased from 4
const PREFETCH_BUFFER = 2; // Number of batches to prefetch

const brandCache = new Map<string, number>();
const categoryCache = new Map<number, number>();

async function ensureBrandsBatch(items: SupplierCatalogItem[]): Promise<void> {
  const uniqueNames = [
    ...new Set(items.map((i) => i.brand).filter(Boolean) as string[]),
  ].filter((name) => !brandCache.has(name));

  if (uniqueNames.length === 0) return;

  const brandData = uniqueNames.map((name) => ({
    name,
    code: name.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_"),
  }));

  await prisma.brand.createMany({ data: brandData, skipDuplicates: true });

  const codes = brandData.map((b) => b.code);
  const brands = await prisma.brand.findMany({ where: { code: { in: codes } } });

  for (const brand of brands) {
    const original = uniqueNames.find(
      (n) => n.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_") === brand.code
    );
    if (original) brandCache.set(original, brand.id);
  }
}

async function prefetchCategories(items: SupplierCatalogItem[]): Promise<void> {
  const uncachedIds = [
    ...new Set(
      items
        .map((i) => i.tecdocGroupId)
        .filter((id): id is number => id != null && !categoryCache.has(id))
    ),
  ];

  if (uncachedIds.length === 0) return;

  const codes = uncachedIds.map((id) => `tecdoc-${id}`);
  const cats = await prisma.category.findMany({ where: { code: { in: codes } } });

  for (const cat of cats) {
    const tecdocGroupId = parseInt(cat.code.replace("tecdoc-", ""), 10);
    if (!isNaN(tecdocGroupId)) categoryCache.set(tecdocGroupId, cat.id);
  }
}

function getBrandId(brandName: string): number {
  return brandCache.get(brandName) ?? 1;
}

function getCategoryId(tecdocGroupId: number | undefined | null): number | null {
  if (!tecdocGroupId) return null;
  return categoryCache.get(tecdocGroupId) ?? null;
}

async function batchUpsertProducts(supplierId: number, items: SupplierCatalogItem[]): Promise<void> {
  if (items.length === 0) return;

  const values = items.map((item) =>
    Prisma.sql`(
      ${supplierId}, ${getBrandId(item.brand)}, ${getCategoryId(item.tecdocGroupId)},
      ${item.sku}, ${item.articleNo},
      ${item.ean ?? null}, ${item.tecdocId ?? null}, ${item.oem ?? null}, ${item.description ?? null},
      ${item.imageUrl ?? null}, ${JSON.stringify(item.images ?? [])}::jsonb, ${item.genericArticle ?? null},
      ${JSON.stringify(item.oemNumbers ?? [])}::jsonb,
      ${item.price ?? null}, ${item.currency ?? "EUR"}, ${item.stock ?? null},
      'active', NOW(), NOW()
    )`
  );

  await prisma.$executeRaw`
    INSERT INTO product_maps (
      supplier_id, brand_id, category_id, sku, article_no,
      ean, tecdoc_id, oem, description,
      image_url, images, generic_article, oem_numbers,
      price, currency, stock,
      status, created_at, updated_at
    )
    VALUES ${Prisma.join(values)}
    ON CONFLICT (supplier_id, sku)
    DO UPDATE SET
      brand_id    = EXCLUDED.brand_id,
      category_id = COALESCE(product_maps.category_id, EXCLUDED.category_id),
      article_no  = EXCLUDED.article_no,
      ean         = COALESCE(EXCLUDED.ean,         product_maps.ean),
      tecdoc_id   = COALESCE(EXCLUDED.tecdoc_id,   product_maps.tecdoc_id),
      oem         = COALESCE(EXCLUDED.oem,         product_maps.oem),
      description = CASE WHEN EXCLUDED.description != '' THEN EXCLUDED.description ELSE product_maps.description END,
      image_url   = COALESCE(EXCLUDED.image_url,   product_maps.image_url),
      images      = CASE WHEN EXCLUDED.images != '[]'::jsonb THEN EXCLUDED.images ELSE product_maps.images END,
      generic_article = COALESCE(EXCLUDED.generic_article, product_maps.generic_article),
      oem_numbers = CASE WHEN EXCLUDED.oem_numbers != '[]'::jsonb THEN EXCLUDED.oem_numbers ELSE product_maps.oem_numbers END,
      price       = COALESCE(EXCLUDED.price,    product_maps.price),
      currency    = COALESCE(EXCLUDED.currency, product_maps.currency),
      stock       = COALESCE(EXCLUDED.stock,    product_maps.stock),
      updated_at  = NOW()
  `;
}

/**
 * Pipeline-based sync using producer/consumer pattern.
 * Prefetches the next batch while processing the current one.
 */
export async function runPipelineSync(
  supplierCode: string,
  cursor?: string,
  onProgress?: (processed: number) => void
): Promise<PipelineSyncResult> {
  const startTime = Date.now();
  const adapter = await getAdapterOrLoad(supplierCode);

  if (!adapter) {
    throw new Error(`Unknown supplier: ${supplierCode}`);
  }

  const supplier = await prisma.supplier.findUnique({
    where: { code: supplierCode },
  });

  if (!supplier) {
    throw new Error(`Supplier not in database: ${supplierCode}`);
  }

  logger.info({ supplier: supplierCode, cursor }, "Starting pipeline sync");

  let totalProcessed = 0;
  let batchCount = 0;
  const batchTimes: number[] = [];

  const catalogIterator = adapter.syncCatalog(cursor);

  // Prefetch buffer for producer/consumer pattern
  const prefetchQueue: Promise<SupplierCatalogItem[]>[] = [];

  // Helper to prefetch next batch
  const fetchNext = async (): Promise<SupplierCatalogItem[]> => {
    const result = await catalogIterator.next();
    if (result.done) return [];
    return result.value;
  };

  // Initialize prefetch buffer
  for (let i = 0; i < PREFETCH_BUFFER; i++) {
    prefetchQueue.push(fetchNext());
  }

  while (prefetchQueue.length > 0) {
    const batchStart = Date.now();
    
    // Get current batch
    const batch = await prefetchQueue.shift()!;
    
    // Immediately queue next prefetch
    prefetchQueue.push(fetchNext());

    if (batch.length === 0) continue;

    batchCount++;

    // Process brands and categories in parallel
    await Promise.all([
      ensureBrandsBatch(batch).catch((err) => {
        logger.warn({ supplier: supplierCode, batch: batchCount, err }, "ensureBrands failed");
      }),
      prefetchCategories(batch),
    ]);

    // Split into chunks
    const chunks: SupplierCatalogItem[][] = [];
    for (let i = 0; i < batch.length; i += UPSERT_BATCH_SIZE) {
      chunks.push(batch.slice(i, i + UPSERT_BATCH_SIZE));
    }

    let batchProcessed = 0;

    // Process up to MAX_PARALLEL_CHUNKS at a time
    for (let i = 0; i < chunks.length; i += MAX_PARALLEL_CHUNKS) {
      const window = chunks.slice(i, i + MAX_PARALLEL_CHUNKS);
      const results = await Promise.allSettled(
        window.map((chunk) => batchUpsertProducts(supplier.id, chunk))
      );

      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        if (r.status === "fulfilled") {
          batchProcessed += window[j].length;
        } else {
          logger.warn(
            { supplier: supplierCode, batch: batchCount, chunkIndex: i + j, err: r.reason },
            "Batch upsert failed"
          );
        }
      }
    }

    totalProcessed += batchProcessed;
    batchTimes.push(Date.now() - batchStart);

    if (onProgress) {
      onProgress(totalProcessed);
    }

    logger.info(
      { supplier: supplierCode, batch: batchCount, processed: totalProcessed, batchMs: Date.now() - batchStart },
      "Pipeline batch processed"
    );
  }

  const durationMs = Date.now() - startTime;
  const avgBatchMs = batchTimes.length > 0 
    ? Math.round(batchTimes.reduce((a, b) => a + b, 0) / batchTimes.length)
    : 0;

  logger.info(
    { supplier: supplierCode, totalProcessed, batchCount, durationMs, avgBatchMs },
    "Pipeline sync completed"
  );

  return { totalProcessed, batchCount, durationMs, avgBatchMs };
}

/**
 * Job processor for BullMQ that uses pipeline sync.
 */
export async function processPipelineSyncJob(job: Job<SyncJobData>): Promise<void> {
  const { supplierCode, cursor } = job.data;

  await runPipelineSync(
    supplierCode,
    cursor,
    async (processed) => {
      await job.updateProgress(processed);
      // Extend lock every 50k products
      if (processed % 50000 === 0) {
        try { await job.extendLock(job.token!, 600_000); } catch { /* ok */ }
      }
    }
  );

  // Import indexQueue dynamically to avoid circular dependency
  const { indexQueue } = await import("../queues.js");
  await indexQueue.add("reindex", { supplierCode }, { priority: 5 });
}

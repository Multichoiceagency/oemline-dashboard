import { Job } from "bullmq";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { getAdapterOrLoad } from "../adapters/registry.js";
import { indexQueue } from "./queues.js";
import type { SupplierCatalogItem } from "../types/index.js";

interface SyncJobData {
  supplierCode: string;
  cursor?: string;
  /** Optional TecDoc brand IDs to sync. When set, only these brands are fetched
   *  (overrides tecdoc_brand_filter_ids setting for this specific job). */
  brandIds?: number[];
}

// Larger batch = fewer DB round-trips. PostgreSQL handles 2000-row INSERT fine.
const UPSERT_BATCH_SIZE = 2000;

// Max parallel DB write chunks per batch (avoids overwhelming Postgres connection pool)
const MAX_PARALLEL_CHUNKS = 4;

// Extend lock every N batches only — skip the Redis call overhead on every batch
const LOCK_EXTEND_EVERY = 5;

export async function processSyncJob(job: Job<SyncJobData>): Promise<void> {
  const { supplierCode, cursor, brandIds } = job.data;
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

  logger.info({ supplier: supplierCode, cursor, brandIds }, "Starting catalog sync");

  let totalProcessed = 0;
  let batchCount = 0;

  // Pass brandIds to the adapter if provided (TecDoc adapter will use it to override the brand filter)
  const catalogIterator = (adapter as any).syncCatalogWithOptions
    ? (adapter as any).syncCatalogWithOptions(cursor, { brandIds })
    : adapter.syncCatalog(cursor);

  for await (const batch of catalogIterator) {
    batchCount++;

    // Extend lock only every N batches to cut Redis overhead
    if (batchCount % LOCK_EXTEND_EVERY === 0) {
      try { await job.extendLock(job.token!, 600_000); } catch { /* ok */ }
    }

    // ── 1. Resolve all brands for this batch in 2 DB queries (not N) ──
    try {
      await ensureBrandsBatch(batch);
    } catch (err) {
      logger.warn({ supplier: supplierCode, batch: batchCount, err }, "ensureBrands failed, continuing with partial brand cache");
    }

    // ── 2. Resolve all unique category IDs for this batch in 1 DB query ──
    await prefetchCategories(batch);

    // ── 3. Split into chunks and write them in parallel ──
    const chunks: SupplierCatalogItem[][] = [];
    for (let i = 0; i < batch.length; i += UPSERT_BATCH_SIZE) {
      chunks.push(batch.slice(i, i + UPSERT_BATCH_SIZE));
    }

    let batchProcessed = 0;

    // Process up to MAX_PARALLEL_CHUNKS chunks at a time
    for (let i = 0; i < chunks.length; i += MAX_PARALLEL_CHUNKS) {
      const window = chunks.slice(i, i + MAX_PARALLEL_CHUNKS);
      const results = await Promise.allSettled(
        window.map(chunk => batchUpsertProducts(supplier.id, chunk))
      );
      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        if (r.status === "fulfilled") {
          batchProcessed += window[j].length;
        } else {
          logger.warn(
            { supplier: supplierCode, batch: batchCount, chunkIndex: i + j, err: r.reason },
            "Batch upsert failed, skipping chunk"
          );
        }
      }
    }

    totalProcessed += batchProcessed;
    await job.updateProgress(totalProcessed);

    logger.info(
      { supplier: supplierCode, batch: batchCount, processed: totalProcessed, batchSize: batch.length },
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

// ─── In-process caches ──────────────────────────────────────────────────────

const brandCache = new Map<string, number>();
const categoryCache = new Map<number, number>();

// ─── Batch brand resolution: 2 queries for any number of new brands ─────────

async function ensureBrandsBatch(items: SupplierCatalogItem[]): Promise<void> {
  const uniqueNames = [
    ...new Set(items.map((i) => i.brand).filter(Boolean) as string[]),
  ].filter((name) => !brandCache.has(name));

  if (uniqueNames.length === 0) return;

  const brandData = uniqueNames.map((name) => ({
    name,
    code: name.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_"),
  }));

  // Upsert all missing brands in a single query (skipDuplicates = ON CONFLICT DO NOTHING)
  await prisma.brand.createMany({ data: brandData, skipDuplicates: true });

  // Fetch all by code in one query and populate cache
  const codes = brandData.map((b) => b.code);
  const brands = await prisma.brand.findMany({ where: { code: { in: codes } } });

  for (const brand of brands) {
    const original = uniqueNames.find(
      (n) => n.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_") === brand.code
    );
    if (original) brandCache.set(original, brand.id);
  }
}

// ─── Batch category prefetch: 1 query per batch instead of 1 per item ───────

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

// ─── Single bulk upsert ──────────────────────────────────────────────────────

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

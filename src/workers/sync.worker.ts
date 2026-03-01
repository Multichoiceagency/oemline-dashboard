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

    // Resolve brands first
    await ensureBrands(batch);

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

// Brand cache to avoid repeated DB lookups
const brandCache = new Map<string, number>();
// Category cache: tecdocGroupId -> categoryId
const categoryCache = new Map<number, number>();

async function ensureCategory(tecdocGroupId: number): Promise<number | null> {
  if (categoryCache.has(tecdocGroupId)) return categoryCache.get(tecdocGroupId)!;

  const code = `tecdoc-${tecdocGroupId}`;
  const cat = await prisma.category.findUnique({ where: { code } });
  if (cat) {
    categoryCache.set(tecdocGroupId, cat.id);
    return cat.id;
  }
  return null;
}

async function ensureBrands(items: SupplierCatalogItem[]): Promise<void> {
  const uniqueBrands = new Set(items.map((i) => i.brand).filter(Boolean));

  for (const brandName of uniqueBrands) {
    if (brandCache.has(brandName)) continue;

    const code = brandName.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_");
    try {
      const existing = await prisma.brand.findUnique({ where: { code } });
      if (existing) {
        brandCache.set(brandName, existing.id);
      } else {
        const created = await prisma.brand.create({
          data: { name: brandName, code },
        });
        brandCache.set(brandName, created.id);
      }
    } catch {
      // Concurrent creation — try to find it
      const found = await prisma.brand.findUnique({ where: { code } });
      if (found) brandCache.set(brandName, found.id);
    }
  }
}

function getBrandId(brandName: string): number {
  return brandCache.get(brandName) ?? 1;
}

async function batchUpsertProducts(supplierId: number, items: SupplierCatalogItem[]): Promise<void> {
  if (items.length === 0) return;

  // Resolve category IDs for items with tecdocGroupId
  const categoryIds = new Map<number, number | null>();
  for (const item of items) {
    if (item.tecdocGroupId && !categoryIds.has(item.tecdocGroupId)) {
      categoryIds.set(item.tecdocGroupId, await ensureCategory(item.tecdocGroupId));
    }
  }

  const values = items.map((item) => {
    const brandId = getBrandId(item.brand);
    const imageUrl = item.imageUrl ?? null;
    const images = JSON.stringify(item.images ?? []);
    const genericArticle = item.genericArticle ?? null;
    const oemNumbers = JSON.stringify(item.oemNumbers ?? []);
    const price = item.price ?? null;
    const currency = item.currency ?? "EUR";
    const stock = item.stock ?? null;
    const categoryId = item.tecdocGroupId ? (categoryIds.get(item.tecdocGroupId) ?? null) : null;

    return Prisma.sql`(
      ${supplierId}, ${brandId}, ${categoryId}, ${item.sku}, ${item.articleNo},
      ${item.ean}, ${item.tecdocId}, ${item.oem}, ${item.description},
      ${imageUrl}, ${images}::jsonb, ${genericArticle}, ${oemNumbers}::jsonb,
      ${price}, ${currency}, ${stock},
      'active', NOW(), NOW()
    )`;
  });

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
      brand_id = EXCLUDED.brand_id,
      category_id = COALESCE(EXCLUDED.category_id, product_maps.category_id),
      article_no = EXCLUDED.article_no,
      ean = COALESCE(EXCLUDED.ean, product_maps.ean),
      tecdoc_id = COALESCE(EXCLUDED.tecdoc_id, product_maps.tecdoc_id),
      oem = COALESCE(EXCLUDED.oem, product_maps.oem),
      description = CASE WHEN EXCLUDED.description != '' THEN EXCLUDED.description ELSE product_maps.description END,
      image_url = COALESCE(EXCLUDED.image_url, product_maps.image_url),
      images = CASE WHEN EXCLUDED.images != '[]'::jsonb THEN EXCLUDED.images ELSE product_maps.images END,
      generic_article = COALESCE(EXCLUDED.generic_article, product_maps.generic_article),
      oem_numbers = CASE WHEN EXCLUDED.oem_numbers != '[]'::jsonb THEN EXCLUDED.oem_numbers ELSE product_maps.oem_numbers END,
      price = COALESCE(EXCLUDED.price, product_maps.price),
      currency = COALESCE(EXCLUDED.currency, product_maps.currency),
      stock = COALESCE(EXCLUDED.stock, product_maps.stock),
      updated_at = NOW()
  `;
}

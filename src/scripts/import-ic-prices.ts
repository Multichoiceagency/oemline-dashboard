/**
 * Standalone IC pricing import script.
 * Runs directly on the server (not via API endpoint).
 *
 * Usage: node dist/scripts/import-ic-prices.js
 *
 * Reads IC CSV data from MinIO, matches against product_maps using
 * prefix brand matching, and bulk-updates prices.
 * Streams in batches — no memory issues with 1.6M products.
 */
import "dotenv/config";
import { prisma } from "../lib/prisma.js";
import { minioClient } from "../lib/minio.js";
import { logger } from "../lib/logger.js";

const BUCKET = process.env.MINIO_BUCKET || "oemline";
const PAGE_SIZE = 10_000;

interface ArticleEntry { b: string; p: number }

async function loadArticleIndex(): Promise<Record<string, ArticleEntry[]>> {
  logger.info("Loading article-index.json from MinIO...");
  const stream = await minioClient.getObject(BUCKET, "intercars/article-index.json");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const data = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, ArticleEntry[]>;
  logger.info({ articles: Object.keys(data).length }, "Article index loaded");
  return data;
}

function findPrice(articleIndex: Record<string, ArticleEntry[]>, articleNo: string, brandName: string): number | null {
  const normArticle = articleNo.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const entries = articleIndex[normArticle];
  if (!entries) return null;

  const normBrand = brandName.toUpperCase().replace(/[^A-Z0-9]/g, "");

  // Priority: exact match → prefix match
  for (const entry of entries) {
    if (entry.b === normBrand) return entry.p;
  }
  for (const entry of entries) {
    if (normBrand.startsWith(entry.b) || entry.b.startsWith(normBrand)) return entry.p;
  }
  return null;
}

async function main() {
  const startTime = Date.now();
  const articleIndex = await loadArticleIndex();

  let lastId = 0;
  let scanned = 0;
  let updated = 0;
  let matched = 0;

  logger.info("Starting product scan...");

  while (true) {
    const products = await prisma.$queryRawUnsafe<Array<{
      id: number; article_no: string; brand_name: string;
    }>>(
      `SELECT pm.id, pm.article_no, b.name AS brand_name
       FROM product_maps pm
       JOIN brands b ON b.id = pm.brand_id
       WHERE pm.id > $1 AND pm.status = 'active'
       ORDER BY pm.id ASC LIMIT $2`,
      lastId, PAGE_SIZE
    );

    if (products.length === 0) break;
    lastId = products[products.length - 1].id;
    scanned += products.length;

    // Match products against the article index
    const updates: Array<{ id: number; price: number }> = [];
    for (const p of products) {
      const price = findPrice(articleIndex, p.article_no, p.brand_name);
      if (price != null && price > 0) {
        updates.push({ id: p.id, price });
        matched++;
      }
    }

    // Batch update
    if (updates.length > 0) {
      const values = updates.map((u) => `(${u.id}, ${u.price}::double precision)`).join(",");
      try {
        const res = await prisma.$executeRawUnsafe(`
          UPDATE product_maps pm SET price = v.price, currency = 'EUR', updated_at = NOW()
          FROM (VALUES ${values}) AS v(id, price)
          WHERE pm.id = v.id
        `);
        updated += Number(res);
      } catch (err) {
        logger.warn({ err, lastId }, "Batch update failed");
      }
    }

    if (scanned % 100_000 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = Math.round(scanned / (Number(elapsed) || 1) * 60);
      logger.info({ scanned, matched, updated, lastId, elapsed: `${elapsed}s`, rate: `${rate}/min` }, "Progress");
    }
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  logger.info({ scanned, matched, updated, durationSec }, "IC pricing import completed");

  await prisma.$disconnect();
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "IC pricing import failed");
  process.exit(1);
});

import { Job } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

/**
 * IC Catalog Sync Worker
 *
 * Crawls all InterCars catalog categories via the API and upserts products
 * into intercars_mappings. The CSV import only has 565K products; the API
 * has 3M+. This worker fills the gap so IC matching covers the full catalog.
 *
 * Strategy:
 * 1. Authenticate via OAuth2 client_credentials
 * 2. Fetch all 45 categories from /catalog/category
 * 3. For each category, paginate /catalog/products (100/page)
 * 4. Upsert into intercars_mappings (tow_kod as unique key)
 * 5. Batch detail lookups (by sku) to get tecDoc + tecDocProd fields
 *
 * Rate limiting: 50ms pause between pages, 100ms between detail batches.
 * Full crawl takes ~2-4 hours for 3M+ products.
 */

interface IcCatalogJobData {
  /** Limit categories to crawl (null = all) */
  maxCategories?: number;
  /** Limit total products (null = unlimited) */
  maxProducts?: number;
  /** Skip detail lookup for tecDoc/tecDocProd (faster but less data) */
  skipDetails?: boolean;
  /** Only process specific categories by ID */
  categoryIds?: string[];
}

interface IcCategory {
  categoryId: string;
  label: string;
}

interface IcCatalogProduct {
  sku: string;
  index: string;
  brand: string;
  shortDescription?: string;
  description?: string;
  blockedReturn?: boolean;
}

interface IcDetailProduct {
  sku: string;
  index: string;
  tecDoc?: string;
  tecDocProd?: string | number;
  articleNumber?: string;
  brand: string;
  eans?: string[];
  packageWeight?: string;
  shortDescription?: string;
  description?: string;
  blockedReturn?: boolean;
}

interface IcCatalogResponse {
  totalResults: number;
  hasNextPage: boolean;
  products: IcCatalogProduct[];
}

interface IcDetailResponse {
  totalResults: number;
  products: IcDetailProduct[];
}

// ── OAuth2 token management ──────────────────────────────────────────────

let accessToken: string | null = null;
let tokenExpiresAt = 0;

const IC_TOKEN_URL = process.env.INTERCARS_TOKEN_URL || "https://is.webapi.intercars.eu/oauth2/token";
const IC_API_URL = process.env.INTERCARS_API_URL || "https://api.webapi.intercars.eu/ic";
const IC_CLIENT_ID = process.env.INTERCARS_CLIENT_ID || "";
const IC_CLIENT_SECRET = process.env.INTERCARS_CLIENT_SECRET || "";
const IC_CUSTOMER_ID = process.env.INTERCARS_CUSTOMER_ID || "";
const IC_PAYER_ID = process.env.INTERCARS_PAYER_ID || "";
const IC_BRANCH = process.env.INTERCARS_BRANCH || "";

async function getIcToken(): Promise<string> {
  if (accessToken && Date.now() < tokenExpiresAt - 30_000) {
    return accessToken;
  }

  const basicAuth = Buffer.from(`${IC_CLIENT_ID}:${IC_CLIENT_SECRET}`).toString("base64");

  const response = await fetch(IC_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body: "grant_type=client_credentials&scope=allinone",
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`IC OAuth2 failed: ${response.status}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  accessToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;
  return accessToken;
}

function icHeaders(token: string): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Accept-Language": "en",
  };
  if (IC_CUSTOMER_ID) h["X-Customer-Id"] = IC_CUSTOMER_ID;
  if (IC_PAYER_ID) h["X-Payer-Id"] = IC_PAYER_ID;
  if (IC_BRANCH) h["X-Branch"] = IC_BRANCH;
  return h;
}

// ── Main worker ──────────────────────────────────────────────────────────

export async function processIcCatalogJob(job: Job<IcCatalogJobData>): Promise<void> {
  const { maxCategories, maxProducts, skipDetails = false, categoryIds } = job.data;

  if (!IC_CLIENT_ID || !IC_CLIENT_SECRET) {
    logger.warn("IC catalog sync: no INTERCARS_CLIENT_ID/SECRET configured");
    return;
  }

  logger.info({ maxCategories, maxProducts, skipDetails }, "IC catalog sync starting");

  const token = await getIcToken();
  const headers = icHeaders(token);

  // ── Step 1: Fetch categories ────────────────────────────────────────────
  const catResponse = await fetch(`${IC_API_URL}/catalog/category`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });

  if (!catResponse.ok) {
    throw new Error(`IC catalog/category failed: ${catResponse.status}`);
  }

  let categories = (await catResponse.json()) as IcCategory[];

  if (categoryIds?.length) {
    const allowed = new Set(categoryIds);
    categories = categories.filter(c => allowed.has(c.categoryId));
  }

  if (maxCategories) {
    categories = categories.slice(0, maxCategories);
  }

  logger.info({ categoryCount: categories.length }, "IC categories fetched");

  let totalInserted = 0;
  let totalUpdated = 0;
  let totalProcessed = 0;
  let totalSkipped = 0;

  // ── Step 2: Crawl each category ─────────────────────────────────────────
  for (const cat of categories) {
    let page = 0;
    let categoryProducts = 0;
    let categoryTotal = 0;

    let retries429 = 0;
    const MAX_429_RETRIES = 5;

    while (true) {
      if (maxProducts && totalProcessed >= maxProducts) break;

      try {
        // Refresh token if needed
        const tok = await getIcToken();
        const hdrs = icHeaders(tok);

        const url = `${IC_API_URL}/catalog/products?categoryId=${encodeURIComponent(cat.categoryId)}&pageNumber=${page}&pageSize=100`;
        const resp = await fetch(url, { headers: hdrs, signal: AbortSignal.timeout(30_000) });

        if (resp.status === 429) {
          retries429++;
          if (retries429 > MAX_429_RETRIES) {
            logger.warn({ category: cat.label, page, retries429 }, "IC catalog: too many 429s, skipping category");
            break;
          }
          const backoffMs = Math.min(retries429 * 30_000, 120_000); // 30s, 60s, 90s, 120s
          logger.info({ category: cat.label, page, retries429, backoffMs }, "IC catalog: 429 rate-limited, backing off");
          await new Promise(r => setTimeout(r, backoffMs));
          continue; // retry same page
        }

        if (!resp.ok) {
          logger.warn({ status: resp.status, category: cat.label, page }, "IC catalog page failed");
          break;
        }

        retries429 = 0; // reset on success

        const data = (await resp.json()) as IcCatalogResponse;
        if (page === 0) categoryTotal = data.totalResults;

        const products = data.products;
        if (!products || products.length === 0) break;

        // ── Batch upsert into intercars_mappings ────────────────────────
        const { inserted, updated, skipped } = await batchUpsertMappings(products);
        totalInserted += inserted;
        totalUpdated += updated;
        totalSkipped += skipped;
        totalProcessed += products.length;
        categoryProducts += products.length;

        if (!data.hasNextPage) break;
        page++;

        // Rate limit: 200ms between pages (was 50ms — too aggressive)
        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        logger.warn({ err, category: cat.label, page }, "IC catalog page error");
        break;
      }
    }

    // ── Optional: batch detail lookups for tecdoc_prod ──────────────────
    if (!skipDetails && categoryProducts > 0) {
      try {
        const enriched = await enrichDetailsForCategory(cat.categoryId, categoryProducts);
        if (enriched > 0) {
          logger.info({ category: cat.label, enriched }, "IC detail enrichment done");
        }
      } catch (err) {
        logger.warn({ err, category: cat.label }, "IC detail enrichment failed (non-critical)");
      }
    }

    logger.info({
      category: cat.label,
      categoryProducts,
      categoryTotal,
      totalProcessed,
      totalInserted,
      totalUpdated,
    }, "IC category sync done");

    // Extend job lock
    try { await job.extendLock(job.token!, 600_000); } catch { /* ok */ }
    await job.updateProgress(totalProcessed);

    // Pause between categories to avoid rate-limiting
    await new Promise(r => setTimeout(r, 2_000));
  }

  logger.info({
    totalProcessed,
    totalInserted,
    totalUpdated,
    totalSkipped,
    categories: categories.length,
  }, "IC catalog sync completed");
}

// ── Batch upsert ─────────────────────────────────────────────────────────

async function batchUpsertMappings(
  products: IcCatalogProduct[]
): Promise<{ inserted: number; updated: number; skipped: number }> {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  // Build VALUES for upsert (batch of up to 100)
  const values: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  for (const p of products) {
    if (!p.sku || !p.index || !p.brand) {
      skipped++;
      continue;
    }

    // Extract article_number from index:
    // IC index format varies: "EL242608" (brand prefix + number), "1 987 473 597" (spaced)
    // article_number is the full index as-is (matching uses normalized comparison)
    const articleNumber = p.index;

    values.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5})`);
    params.push(
      p.sku,                          // tow_kod
      p.index,                        // ic_index
      articleNumber,                   // article_number
      p.brand,                        // manufacturer
      p.shortDescription || p.description || "",  // description
      p.blockedReturn ?? false,       // blocked_return
    );
    idx += 6;
  }

  if (values.length === 0) return { inserted, updated, skipped };

  try {
    // IMPORTANT: On conflict, do NOT overwrite article_number if it already has a
    // value from CSV import (which has the correct clean article number).
    // Only update ic_index, manufacturer, description (metadata refresh).
    const result = await prisma.$executeRawUnsafe(
      `INSERT INTO intercars_mappings (tow_kod, ic_index, article_number, manufacturer, description, blocked_return, created_at)
       VALUES ${values.join(", ")}
       ON CONFLICT (tow_kod) DO UPDATE SET
         ic_index = EXCLUDED.ic_index,
         manufacturer = COALESCE(NULLIF(EXCLUDED.manufacturer, ''), intercars_mappings.manufacturer),
         description = COALESCE(NULLIF(EXCLUDED.description, ''), intercars_mappings.description),
         blocked_return = EXCLUDED.blocked_return`,
      ...params
    );
    inserted = result;
  } catch (err) {
    logger.warn({ err, count: values.length }, "IC batch upsert error — falling back to individual");
    for (const p of products) {
      if (!p.sku || !p.index || !p.brand) continue;
      try {
        const r = await prisma.$executeRawUnsafe(
          `INSERT INTO intercars_mappings (tow_kod, ic_index, article_number, manufacturer, description, blocked_return, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT (tow_kod) DO UPDATE SET
             ic_index = EXCLUDED.ic_index,
             manufacturer = COALESCE(NULLIF(EXCLUDED.manufacturer, ''), intercars_mappings.manufacturer)`,
          p.sku, p.index, p.index, p.brand,
          p.shortDescription || "", p.blockedReturn ?? false
        );
        if (r > 0) inserted++;
      } catch {
        skipped++;
      }
    }
  }

  return { inserted, updated, skipped };
}

// ── Detail enrichment ────────────────────────────────────────────────────

/**
 * For products that were just upserted from a category listing (which lacks
 * tecDoc/tecDocProd), do batch SKU lookups to fill tecdoc_prod and ean.
 * We query intercars_mappings for rows missing tecdoc_prod in the batch.
 */
async function enrichDetailsForCategory(categoryId: string, productCount: number): Promise<number> {
  // Find recently inserted rows without tecdoc_prod
  const missing = await prisma.$queryRawUnsafe<Array<{ tow_kod: string }>>(
    `SELECT tow_kod FROM intercars_mappings
     WHERE tecdoc_prod IS NULL
     ORDER BY id DESC
     LIMIT $1`,
    Math.min(productCount, 500)  // Limit detail lookups to 500 per category
  );

  if (missing.length === 0) return 0;

  let enriched = 0;
  const BATCH = 10; // 10 SKU lookups at a time

  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);

    // Parallel SKU lookups
    const results = await Promise.allSettled(
      batch.map(m => fetchProductDetail(m.tow_kod))
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        const p = result.value;
        const tecdocProd = p.tecDocProd ? Number(p.tecDocProd) : null;
        const ean = p.eans?.[0] ?? null;
        const weight = p.packageWeight ? parseFloat(p.packageWeight.replace(",", ".")) : null;

        if (tecdocProd || ean) {
          try {
            await prisma.$executeRawUnsafe(
              `UPDATE intercars_mappings SET
                tecdoc_prod = COALESCE($1, tecdoc_prod),
                ean = COALESCE($2, ean),
                weight = COALESCE($3, weight)
              WHERE tow_kod = $4`,
              tecdocProd, ean, weight, p.sku
            );
            enriched++;
          } catch { /* skip */ }
        }
      }
    }

    // Rate limit: 100ms between detail batches
    await new Promise(r => setTimeout(r, 100));
  }

  return enriched;
}

async function fetchProductDetail(sku: string): Promise<IcDetailProduct | null> {
  const tok = await getIcToken();
  const hdrs = icHeaders(tok);

  const url = `${IC_API_URL}/catalog/products?sku=${encodeURIComponent(sku)}&pageNumber=0&pageSize=1`;
  const resp = await fetch(url, { headers: hdrs, signal: AbortSignal.timeout(15_000) });

  if (!resp.ok) return null;

  const data = (await resp.json()) as IcDetailResponse;
  return data.products?.[0] ?? null;
}

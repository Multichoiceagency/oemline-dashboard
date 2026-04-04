import { Job } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { waitForIcRateLimit } from "../lib/ic-rate-limiter.js";
import { sendProgressNotification } from "../lib/notify.js";

/**
 * IC Catalog Sync Worker
 *
 * Crawls all InterCars catalog categories via the API and upserts products
 * into intercars_mappings. The IC API has 3M+ products across 45 categories.
 *
 * Strategy:
 * 1. Authenticate via OAuth2 client_credentials
 * 2. Fetch top-level categories, then recursively drill into subcategories
 *    (IC API caps pagination at 10K products per category query)
 * 3. For each leaf category, paginate /catalog/products (100/page)
 * 4. Upsert into intercars_mappings (tow_kod as unique key)
 *
 * Rate limiting: IC API allows 600 req/min. We use 8 req/sec max with
 * exponential backoff on 429 responses.
 */

interface IcCatalogJobData {
  maxCategories?: number;
  maxProducts?: number;
  skipDetails?: boolean;
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

interface IcCatalogResponse {
  totalResults: number;
  hasNextPage: boolean;
  products: IcCatalogProduct[];
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

// ── Rate-limited fetch with 429 retry ───────────────────────────────────

async function icFetch(url: string, maxRetries = 5): Promise<Response | null> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    await waitForIcRateLimit();
    const tok = await getIcToken();
    const resp = await fetch(url, {
      headers: icHeaders(tok),
      signal: AbortSignal.timeout(30_000),
    });

    if (resp.status === 429) {
      const backoffMs = Math.min((attempt + 1) * 30_000, 120_000);
      logger.info({ url: url.substring(0, 80), attempt: attempt + 1, backoffMs }, "IC 429 — backing off");
      await new Promise(r => setTimeout(r, backoffMs));
      continue;
    }

    return resp;
  }
  return null; // all retries exhausted
}

// ── Subcategory tree resolver ───────────────────────────────────────────
// IC API caps pagination at 10K products per category.
// For categories >10K, we drill into subcategories recursively.

const MAX_PRODUCTS_PER_CATEGORY = 9_900; // stay under 10K pagination cap

async function getLeafCategories(categoryId: string, label: string, depth = 0): Promise<IcCategory[]> {
  if (depth > 6) return [{ categoryId, label }]; // safety: max depth

  // First check how many products this category has
  const countResp = await icFetch(
    `${IC_API_URL}/catalog/products?categoryId=${encodeURIComponent(categoryId)}&pageNumber=0&pageSize=1`
  );

  if (!countResp || !countResp.ok) return [{ categoryId, label }];

  const countData = (await countResp.json()) as IcCatalogResponse;

  if (countData.totalResults <= MAX_PRODUCTS_PER_CATEGORY) {
    // This category fits within the pagination limit — use it directly
    return [{ categoryId, label }];
  }

  // Too many products — try to get subcategories
  const subResp = await icFetch(
    `${IC_API_URL}/catalog/category?categoryId=${encodeURIComponent(categoryId)}`
  );

  if (!subResp || !subResp.ok) return [{ categoryId, label }];

  const subcats = (await subResp.json()) as IcCategory[];

  if (!subcats || subcats.length === 0) {
    // No subcategories available — just crawl up to 10K from this category
    return [{ categoryId, label }];
  }

  // Recursively resolve subcategories
  const leaves: IcCategory[] = [];
  for (const sub of subcats) {
    const subLeaves = await getLeafCategories(sub.categoryId, `${label} > ${sub.label}`, depth + 1);
    leaves.push(...subLeaves);
  }

  return leaves;
}

// ── Main worker ──────────────────────────────────────────────────────────

export async function processIcCatalogJob(job: Job<IcCatalogJobData>): Promise<void> {
  const { maxCategories, maxProducts, skipDetails = false, categoryIds } = job.data;

  if (!IC_CLIENT_ID || !IC_CLIENT_SECRET) {
    logger.warn("IC catalog sync: no INTERCARS_CLIENT_ID/SECRET configured");
    return;
  }

  logger.info({ maxCategories, maxProducts, skipDetails }, "IC catalog sync starting");
  await sendProgressNotification({ worker: "IC Catalog Sync", progress: 5, detail: "Start: ophalen IC categorie-overzicht" });

  // ── Step 1: Fetch top-level categories ────────────────────────────────
  const catResp = await icFetch(`${IC_API_URL}/catalog/category`);
  if (!catResp || !catResp.ok) {
    throw new Error(`IC catalog/category failed: ${catResp?.status ?? "no response"}`);
  }

  let topCategories = (await catResp.json()) as IcCategory[];

  if (categoryIds?.length) {
    const allowed = new Set(categoryIds);
    topCategories = topCategories.filter(c => allowed.has(c.categoryId));
  }

  if (maxCategories) {
    topCategories = topCategories.slice(0, maxCategories);
  }

  logger.info({ topCategories: topCategories.length }, "IC top-level categories fetched");

  // ── Step 2: Build category list ───────────────────────────────────────
  // Strategy: First crawl top-level categories (10K each, fast).
  // Then resolve subcategories only for categories that have >10K products
  // to get the remaining products in a second pass.
  const allLeafCategories: IcCategory[] = [];

  // Pass 1: Add all top-level categories directly (each gets up to 10K products)
  for (const cat of topCategories) {
    allLeafCategories.push(cat);
  }

  logger.info({ totalCategories: allLeafCategories.length, mode: "top-level-first" }, "Starting fast crawl (10K per category)");

  let totalInserted = 0;
  let totalUpdated = 0;
  let totalProcessed = 0;
  let totalSkipped = 0;

  // ── Step 3: Crawl each leaf category ──────────────────────────────────
  for (const cat of allLeafCategories) {
    let page = 0;
    let categoryProducts = 0;
    let categoryTotal = 0;

    while (true) {
      if (maxProducts && totalProcessed >= maxProducts) break;

      try {
        const resp = await icFetch(
          `${IC_API_URL}/catalog/products?categoryId=${encodeURIComponent(cat.categoryId)}&pageNumber=${page}&pageSize=100`
        );

        if (!resp) {
          logger.warn({ category: cat.label, page }, "IC catalog: all retries exhausted, skipping");
          break;
        }

        if (!resp.ok) {
          logger.warn({ status: resp.status, category: cat.label, page }, "IC catalog page failed");
          break;
        }

        const data = (await resp.json()) as IcCatalogResponse;
        if (page === 0) categoryTotal = data.totalResults;

        const products = data.products;
        if (!products || products.length === 0) break;

        const { inserted, updated, skipped } = await batchUpsertMappings(products);
        totalInserted += inserted;
        totalUpdated += updated;
        totalSkipped += skipped;
        totalProcessed += products.length;
        categoryProducts += products.length;

        if (!data.hasNextPage) break;
        page++;
      } catch (err) {
        logger.warn({ err, category: cat.label, page }, "IC catalog page error");
        break;
      }
    }

    if (categoryProducts > 0) {
      logger.info({
        category: cat.label,
        categoryProducts,
        categoryTotal,
        totalProcessed,
      }, "IC leaf category done");
    }

    // Extend job lock (long-running job)
    try { await job.extendLock(job.token!, 600_000); } catch { /* ok */ }
    await job.updateProgress(totalProcessed);

    // Send progress email at every 5% of estimated 3M products
    const estimatedTotal = maxProducts || 3_000_000;
    const pct = Math.min(95, Math.round(totalProcessed / estimatedTotal * 90)); // 90% = pass 1
    await sendProgressNotification({
      worker: "IC Catalog Sync",
      progress: pct,
      processed: totalProcessed,
      total: estimatedTotal,
      detail: `Categorie: ${cat.label}`,
    });
  }

  logger.info({ totalProcessed, totalInserted }, "Pass 1 done (top-level 10K each)");

  // ── Pass 2: Resolve subcategories for large categories (>10K products) ─
  // Only runs after pass 1 is complete to maximize early data
  const largeCats = topCategories.filter(c => {
    // Check if this category had more products than we could crawl (hit page 99)
    return true; // resolve all to catch remaining products
  });

  for (const cat of largeCats) {
    if (maxProducts && totalProcessed >= maxProducts) break;

    try {
      const leaves = await getLeafCategories(cat.categoryId, cat.label);
      if (leaves.length <= 1) continue; // no subcategories or small enough

      logger.info({ category: cat.label, leaves: leaves.length }, "Pass 2: resolved subcategories");

      for (const leaf of leaves) {
        let page = 0;
        let leafProducts = 0;

        while (true) {
          if (maxProducts && totalProcessed >= maxProducts) break;
          try {
            const resp = await icFetch(
              `${IC_API_URL}/catalog/products?categoryId=${encodeURIComponent(leaf.categoryId)}&pageNumber=${page}&pageSize=100`
            );
            if (!resp || !resp.ok) break;
            const data = (await resp.json()) as IcCatalogResponse;
            const products = data.products;
            if (!products || products.length === 0) break;

            const { inserted } = await batchUpsertMappings(products);
            totalInserted += inserted;
            totalProcessed += products.length;
            leafProducts += products.length;

            if (!data.hasNextPage) break;
            page++;
          } catch { break; }
        }

        if (leafProducts > 0) {
          logger.info({ category: leaf.label, leafProducts, totalProcessed }, "Pass 2: leaf done");
        }
      }

      try { await job.extendLock(job.token!, 600_000); } catch { /* ok */ }
      await job.updateProgress(totalProcessed);
    } catch (err) {
      logger.warn({ err, category: cat.label }, "Pass 2: subcategory resolution failed");
    }
  }

  // ── Optional: detail enrichment ───────────────────────────────────────
  if (!skipDetails) {
    try {
      const enriched = await enrichMissingDetails();
      if (enriched > 0) {
        logger.info({ enriched }, "IC detail enrichment done");
      }
    } catch (err) {
      logger.warn({ err }, "IC detail enrichment failed (non-critical)");
    }
  }

  logger.info({
    totalProcessed,
    totalInserted,
    totalUpdated,
    totalSkipped,
    leafCategories: allLeafCategories.length,
  }, "IC catalog sync completed");

  await sendProgressNotification({
    worker: "IC Catalog Sync",
    progress: 100,
    processed: totalProcessed,
    detail: `Klaar! ${totalInserted.toLocaleString("nl-NL")} nieuwe mappings toegevoegd, ${totalProcessed.toLocaleString("nl-NL")} producten verwerkt`,
  });
}

// ── Batch upsert ─────────────────────────────────────────────────────────

async function batchUpsertMappings(
  products: IcCatalogProduct[]
): Promise<{ inserted: number; updated: number; skipped: number }> {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  const values: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  for (const p of products) {
    if (!p.sku || !p.index || !p.brand) {
      skipped++;
      continue;
    }

    values.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, NOW())`);
    params.push(
      p.sku,
      p.index,
      p.index, // article_number = index
      p.brand,
      p.shortDescription || p.description || "",
      p.blockedReturn ?? false,
    );
    idx += 6;
  }

  if (values.length === 0) return { inserted, updated, skipped };

  try {
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

// ── Detail enrichment (batch, post-crawl) ────────────────────────────────

async function enrichMissingDetails(): Promise<number> {
  const missing = await prisma.$queryRawUnsafe<Array<{ tow_kod: string }>>(
    `SELECT tow_kod FROM intercars_mappings
     WHERE tecdoc_prod IS NULL
     ORDER BY id DESC
     LIMIT 2000`
  );

  if (missing.length === 0) return 0;

  let enriched = 0;

  for (let i = 0; i < missing.length; i++) {
    const sku = missing[i].tow_kod;

    try {
      const resp = await icFetch(
        `${IC_API_URL}/catalog/products?sku=${encodeURIComponent(sku)}&pageNumber=0&pageSize=1`
      );

      if (!resp || !resp.ok) continue;

      const data = (await resp.json()) as IcDetailResponse;
      const p = data.products?.[0];
      if (!p) continue;

      const tecdocProd = p.tecDocProd ? Number(p.tecDocProd) : null;
      const ean = p.eans?.[0] ?? null;
      const weight = p.packageWeight ? parseFloat(p.packageWeight.replace(",", ".")) : null;

      if (tecdocProd || ean) {
        await prisma.$executeRawUnsafe(
          `UPDATE intercars_mappings SET
            tecdoc_prod = COALESCE($1, tecdoc_prod),
            ean = COALESCE($2, ean),
            weight = COALESCE($3, weight)
          WHERE tow_kod = $4`,
          tecdocProd, ean, weight, sku
        );
        enriched++;
      }
    } catch { /* skip */ }
  }

  return enriched;
}

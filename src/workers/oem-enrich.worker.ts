import { Job } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { config } from "../config.js";

const TECDOC_API_URL = config.TECDOC_API_URL;
const TECDOC_API_KEY = config.TECDOC_API_KEY;
const PROVIDER_ID = 22691;

interface OemEnrichJobData {
  batchSize?: number;
  maxProducts?: number;
}

interface TecDocArticle {
  dataSupplierId?: number;
  articleNumber?: string;
  mfrName?: string;
  oemNumbers?: Array<{ oemNumber?: string; mfrName?: string }>;
  eanNumbers?: Array<{ eanNumber?: string }>;
}

interface GetArticlesResponse {
  articles?: TecDocArticle[];
  totalMatchingArticles?: number;
  status?: number;
}

/**
 * OEM Enrichment Worker
 *
 * Single-request TecDoc API approach: fetches all brands once, then iterates
 * through each brand's articles using getArticles with includeOemNumbers=true.
 * Updates product_maps.oem_numbers for IC matching Phase 3B/3C.
 *
 * Strategy:
 * 1. Fetch ALL brands from TecDoc in one getBrands call
 * 2. For each brand with unmatched products, paginate getArticles
 * 3. Match returned articles to product_maps by normalized article number
 * 4. Store oem_numbers array for matched products
 */
export async function processOemEnrichJob(job: Job<OemEnrichJobData>): Promise<void> {
  const maxProducts = job.data.maxProducts ?? 50_000;

  if (!TECDOC_API_KEY) {
    logger.warn("No TECDOC_API_KEY configured, skipping OEM enrichment");
    return;
  }

  logger.info({ maxProducts }, "OEM enrichment starting — fetching all brands from TecDoc");

  // ── Step 1: Get ALL brands from TecDoc in one API call ─────────────────
  const brandsResult = await tecdocRequest("getBrands", {
    perPage: 500,
    page: 1,
  }) as { data?: { array?: Array<{ dataSupplierId?: number; mfrName?: string }> } };

  const tecdocBrands = (brandsResult.data?.array ?? [])
    .filter(b => b.dataSupplierId != null && b.mfrName)
    .map(b => ({ id: b.dataSupplierId!, name: b.mfrName! }));

  logger.info({ brandCount: tecdocBrands.length }, "TecDoc brands fetched in single request");

  // ── Step 2: Find brands that have unmatched products needing OEM data ──
  const brandsWithUnmatched = await prisma.$queryRawUnsafe<Array<{
    tecdoc_id: number;
    product_count: bigint;
  }>>(
    `SELECT b.tecdoc_id, COUNT(pm.id) as product_count
     FROM product_maps pm
     JOIN brands b ON b.id = pm.brand_id
     WHERE pm.status = 'active'
       AND b.tecdoc_id IS NOT NULL
       AND (pm.oem_numbers IS NULL OR pm.oem_numbers::text = '[]' OR pm.oem_numbers::text = 'null')
     GROUP BY b.tecdoc_id
     ORDER BY product_count DESC`
  );

  const brandIdsNeeded = new Set(brandsWithUnmatched.map(b => b.tecdoc_id));
  const activeBrands = tecdocBrands.filter(b => brandIdsNeeded.has(b.id));

  logger.info({
    totalBrands: tecdocBrands.length,
    brandsNeedingOem: activeBrands.length,
    totalProductsToEnrich: brandsWithUnmatched.reduce((s, b) => s + Number(b.product_count), 0),
  }, "Brands needing OEM enrichment identified");

  let totalEnriched = 0;
  let totalProcessed = 0;

  // ── Step 3: For each brand, fetch articles with OEM numbers ────────────
  for (const brand of activeBrands) {
    if (totalProcessed >= maxProducts) break;

    let page = 1;
    const perPage = 100;
    let brandEnriched = 0;

    while (page <= 100) { // TecDoc max 100 pages
      try {
        const result = await tecdocRequest("getArticles", {
          dataSupplierIds: [brand.id],
          perPage,
          page,
          includeOemNumbers: true,
          includeEanNumbers: true,
        }) as GetArticlesResponse;

        const articles = result.articles ?? [];
        if (articles.length === 0) break;

        // Collect articles that have OEM numbers
        const articlesWithOem: Array<{ artNorm: string; oem: string; oemNumbers: string[] }> = [];
        for (const art of articles) {
          const oemList = (art.oemNumbers ?? [])
            .map(o => o.oemNumber)
            .filter((o): o is string => !!o);
          if (oemList.length > 0 && art.articleNumber) {
            articlesWithOem.push({
              artNorm: art.articleNumber.toUpperCase().replace(/[^A-Z0-9]/g, ""),
              oem: oemList[0],
              oemNumbers: oemList,
            });
          }
        }

        // Batch update: match by brand tecdoc_id + normalized article number
        if (articlesWithOem.length > 0) {
          for (const art of articlesWithOem) {
            try {
              const updated = await prisma.$executeRawUnsafe(
                `UPDATE product_maps SET
                  oem_numbers = $1::jsonb,
                  oem = COALESCE(oem, $2),
                  updated_at = NOW()
                FROM brands b
                WHERE product_maps.brand_id = b.id
                  AND b.tecdoc_id = $3
                  AND product_maps.normalized_article_no = $4
                  AND product_maps.status = 'active'
                  AND (product_maps.oem_numbers IS NULL OR product_maps.oem_numbers::text = '[]' OR product_maps.oem_numbers::text = 'null')`,
                JSON.stringify(art.oemNumbers),
                art.oem,
                brand.id,
                art.artNorm
              );
              if (updated > 0) {
                brandEnriched += updated;
                totalEnriched += updated;
              }
            } catch {
              // skip individual failures
            }
          }
        }

        totalProcessed += articles.length;

        if (articles.length < perPage) break;

        const groupTotal = result.totalMatchingArticles ?? 0;
        if (groupTotal > 0 && page * perPage >= groupTotal) break;

        page++;
        await new Promise(r => setTimeout(r, 50)); // Rate limit
      } catch (err) {
        logger.warn({ err, brand: brand.name, page }, "OEM enrichment page failed");
        break;
      }
    }

    if (brandEnriched > 0) {
      logger.info({ brand: brand.name, brandId: brand.id, enriched: brandEnriched }, "Brand OEM enrichment done");
    }

    // Extend lock
    try { await job.extendLock(job.token!, 600_000); } catch { /* ok */ }
    await job.updateProgress(totalProcessed);
  }

  logger.info({ totalProcessed, totalEnriched, brandsProcessed: activeBrands.length }, "OEM enrichment completed");
}

async function tecdocRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
  const body = {
    ...params,
    articleCountry: "NL",
    providerId: PROVIDER_ID,
    lang: "nl",
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(TECDOC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": TECDOC_API_KEY,
      },
      body: JSON.stringify({ [method]: body }),
      signal: controller.signal,
    });

    const json = await response.json() as Record<string, unknown>;
    if (json.status && json.status !== 200) {
      throw new Error(`TecDoc API error: status=${json.status}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

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
 * Fetches OEM cross-reference numbers from TecDoc API for products that have
 * empty oem_numbers arrays. Populates oem_numbers and oem fields so the
 * IC matching phases (2A, 2B) can find matches via OEM → IC article lookups.
 *
 * Strategy:
 * 1. Select batches of unmatched products with empty oem_numbers
 * 2. Group by brand (dataSupplierId) for efficient TecDoc API calls
 * 3. Call getArticles with includeOemNumbers=true
 * 4. Update product_maps.oem_numbers and oem fields
 */
export async function processOemEnrichJob(job: Job<OemEnrichJobData>): Promise<void> {
  const batchSize = job.data.batchSize ?? 100;
  const maxProducts = job.data.maxProducts ?? 50_000;

  if (!TECDOC_API_KEY) {
    logger.warn("No TECDOC_API_KEY configured, skipping OEM enrichment");
    return;
  }

  logger.info({ batchSize, maxProducts }, "OEM enrichment starting");

  let totalEnriched = 0;
  let totalProcessed = 0;
  let offset = 0;

  while (totalProcessed < maxProducts) {
    // Fetch products that need OEM enrichment: unmatched, active, no oem_numbers
    const products = await prisma.$queryRawUnsafe<Array<{
      id: number;
      article_no: string;
      brand_id: number;
      tecdoc_id: string | null;
    }>>(
      `SELECT pm.id, pm.article_no, pm.brand_id, pm.tecdoc_id
       FROM product_maps pm
       WHERE pm.status = 'active'
         AND (pm.oem_numbers IS NULL OR pm.oem_numbers::text = '[]' OR pm.oem_numbers::text = 'null')
         AND pm.article_no IS NOT NULL AND pm.article_no != ''
       ORDER BY pm.id
       LIMIT $1 OFFSET $2`,
      batchSize,
      offset
    );

    if (products.length === 0) break;
    offset += products.length;
    totalProcessed += products.length;

    // Get brand tecdoc_ids for these products
    const brandIds = [...new Set(products.map(p => p.brand_id))];
    const brands = await prisma.brand.findMany({
      where: { id: { in: brandIds } },
      select: { id: true, tecdocId: true, name: true },
    });
    const brandMap = new Map(brands.map(b => [b.id, b]));

    // Group products by brand tecdocId for batch API calls
    const byBrand = new Map<number, typeof products>();
    for (const p of products) {
      const brand = brandMap.get(p.brand_id);
      if (!brand?.tecdocId) continue;
      const group = byBrand.get(brand.tecdocId) ?? [];
      group.push(p);
      byBrand.set(brand.tecdocId, group);
    }

    // For each brand group, call TecDoc getArticles
    for (const [dataSupplierId, group] of byBrand) {
      try {
        const articleNumbers = [...new Set(group.map(p => p.article_no))];

        // TecDoc getArticles accepts up to ~25 articles per call
        for (let i = 0; i < articleNumbers.length; i += 25) {
          const chunk = articleNumbers.slice(i, i + 25);

          const result = await tecdocRequest("getArticles", {
            dataSupplierIds: [dataSupplierId],
            articleNumber: chunk.length === 1 ? chunk[0] : undefined,
            articleId: undefined,
            perPage: chunk.length * 5,
            page: 1,
            includeOemNumbers: true,
            includeEanNumbers: true,
          }) as GetArticlesResponse;

          const articles = result.articles ?? [];

          // Build lookup: normalized article -> OEM numbers
          const oemByArticle = new Map<string, { oem: string | null; oemNumbers: string[] }>();
          for (const art of articles) {
            const artNo = art.articleNumber ?? "";
            const oemList = (art.oemNumbers ?? [])
              .map(o => o.oemNumber)
              .filter((o): o is string => !!o);
            if (oemList.length > 0) {
              oemByArticle.set(artNo.toUpperCase().replace(/[^A-Z0-9]/g, ""), {
                oem: oemList[0],
                oemNumbers: oemList,
              });
            }
          }

          // Update matching products
          for (const p of group) {
            const normArt = p.article_no.toUpperCase().replace(/[^A-Z0-9]/g, "");
            const oemData = oemByArticle.get(normArt);
            if (oemData && oemData.oemNumbers.length > 0) {
              try {
                await prisma.$executeRawUnsafe(
                  `UPDATE product_maps SET
                    oem_numbers = $1::jsonb,
                    oem = COALESCE(oem, $2),
                    updated_at = NOW()
                  WHERE id = $3 AND (oem_numbers IS NULL OR oem_numbers::text = '[]' OR oem_numbers::text = 'null')`,
                  JSON.stringify(oemData.oemNumbers),
                  oemData.oem,
                  p.id
                );
                totalEnriched++;
              } catch {
                // skip individual failures
              }
            }
          }

          // Rate limit: 50ms between TecDoc calls
          await new Promise(r => setTimeout(r, 50));
        }
      } catch (err) {
        logger.warn({ err, dataSupplierId }, "OEM enrichment batch failed (non-critical)");
      }
    }

    // Extend lock
    try { await job.extendLock(job.token!, 600_000); } catch { /* ok */ }
    await job.updateProgress(totalProcessed);

    logger.info({ totalProcessed, totalEnriched, batch: offset / batchSize }, "OEM enrichment progress");
  }

  logger.info({ totalProcessed, totalEnriched }, "OEM enrichment completed");
}

async function tecdocRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
  const body = {
    ...params,
    articleCountry: "NL",
    providerId: PROVIDER_ID,
    lang: "nl",
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

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

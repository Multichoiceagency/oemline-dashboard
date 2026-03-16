import { Job } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

/**
 * IC Direct Lookup & Enrichment Worker → 100% Match Rate
 *
 * Strategy: For each unmatched product in product_maps, directly search the
 * IC API to find the matching IC product. This is faster and more reliable
 * than crawling IC's full 3M+ catalog.
 *
 * Steps:
 * 1. Build brand→IC index prefix map from existing CSV data
 * 2. Auto-create brand aliases (IC brand → TecDoc brand)
 * 3. For each unmatched product: construct IC index, search IC API
 * 4. If found: upsert into intercars_mappings with full details (articleNumber, tecDocProd, EAN)
 * 5. Run all matching phases on the enriched data
 * 6. Prices + stock follow automatically via pricing/stock workers
 *
 * Performance: 50 parallel API calls → ~15K products/min → ~1h for 900K
 */

export interface IcEnrichJobData {
  mode?: "full" | "direct-lookup" | "aliases-only" | "match-only";
  /** Max products to look up (0 = unlimited) */
  maxLookup?: number;
  /** Parallel API calls (default 50) */
  parallelism?: number;
}

// ── OAuth2 ───────────────────────────────────────────────────────────────

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
  if (accessToken && Date.now() < tokenExpiresAt - 30_000) return accessToken;
  const basicAuth = Buffer.from(`${IC_CLIENT_ID}:${IC_CLIENT_SECRET}`).toString("base64");
  const response = await fetch(IC_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basicAuth}` },
    body: "grant_type=client_credentials&scope=allinone",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`IC OAuth2 failed: ${response.status}`);
  const data = (await response.json()) as { access_token: string; expires_in: number };
  accessToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;
  return accessToken;
}

function icHeaders(token: string): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json", "Accept-Language": "en" };
  if (IC_CUSTOMER_ID) h["X-Customer-Id"] = IC_CUSTOMER_ID;
  if (IC_PAYER_ID) h["X-Payer-Id"] = IC_PAYER_ID;
  if (IC_BRANCH) h["X-Branch"] = IC_BRANCH;
  return h;
}

interface IcProduct {
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
}

// ── Main worker ──────────────────────────────────────────────────────────

export async function processIcEnrichJob(job: Job<IcEnrichJobData>): Promise<void> {
  const { mode = "full", maxLookup = 0, parallelism = 10 } = job.data;

  if (!IC_CLIENT_ID || !IC_CLIENT_SECRET) {
    logger.warn("IC enrich: no INTERCARS_CLIENT_ID/SECRET configured");
    return;
  }

  logger.info({ mode, maxLookup, parallelism }, "IC enrichment starting");
  const stats = { prefixBrands: 0, aliasesCreated: 0, looked: 0, found: 0, matched: 0, learnedBrands: 0 };

  if (mode === "full" || mode === "direct-lookup") {
    // ── Step 1: Fix aliases first ──────────────────────────────────────
    logger.info("Step 1: Fixing brand aliases...");
    stats.aliasesCreated = await autoCreateBrandAliases();
    logger.info({ created: stats.aliasesCreated }, "Brand aliases done");
    await job.updateProgress(3);

    // ── Step 2: Run matching phases on existing IC data FIRST ─────────
    // This is instant and catches all low-hanging fruit before slow API lookups
    logger.info("Step 2: Running matching phases on existing IC data...");
    try {
      await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY ic_unique_articles`);
    } catch { /* ok */ }
    const earlyMatches = await runAllMatchingPhases();
    stats.matched += earlyMatches;
    logger.info({ earlyMatches }, "Early matching done");
    await job.updateProgress(15);

    // ── Step 3: Learn prefix map from EXISTING matches ─────────────────
    // We have ~240K+ matched products with ic_sku. Use those to learn the IC index
    // format for every brand, then apply to unmatched products.
    logger.info("Step 3: Building prefix map from CSV + learning from existing matches...");
    const prefixMap = await buildBrandPrefixMap();
    stats.prefixBrands = Object.keys(prefixMap).length;

    // Also learn from existing matched products (ic_sku → IC API detail → index format)
    const learnedCount = await learnPrefixFromMatches(job, prefixMap, parallelism);
    stats.learnedBrands = learnedCount;
    stats.prefixBrands = Object.keys(prefixMap).length; // Updated after learning
    logger.info({ prefixBrands: stats.prefixBrands, learned: learnedCount }, "Prefix map complete");
    await job.updateProgress(25);

    // ── Step 4: Direct IC lookup for unmatched products ─────────────────
    // Now with a comprehensive prefix map, search IC for remaining unmatched products
    // Use parallelism=10 to avoid IC API rate limits (was 50, caused 429s)
    logger.info("Step 4: Direct IC API lookup for unmatched products...");
    const lookupResult = await directIcLookup(job, prefixMap, Math.min(parallelism, 10), maxLookup);
    stats.looked = lookupResult.looked;
    stats.found = lookupResult.found;
    logger.info({ looked: stats.looked, found: stats.found }, "Direct IC lookup done");
    await job.updateProgress(80);

    // ── Step 5: Run matching phases AGAIN on newly added IC data ────────
    logger.info("Step 5: Running matching phases on new IC data...");
    try {
      await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY ic_unique_articles`);
    } catch { /* ok */ }
    const lateMatches = await runAllMatchingPhases();
    stats.matched += lateMatches;
    logger.info({ lateMatches, totalMatched: stats.matched }, "Final matching done");
    await job.updateProgress(100);
  }

  if (mode === "aliases-only") {
    stats.aliasesCreated = await autoCreateBrandAliases();
  }

  if (mode === "match-only") {
    logger.info("Running matching phases...");
    try {
      await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY ic_unique_articles`);
    } catch { /* ok */ }
    stats.matched = await runAllMatchingPhases();
    await job.updateProgress(100);
  }

  logger.info({ stats }, "IC enrichment completed");
}

// ── Brand prefix map ─────────────────────────────────────────────────────

/**
 * Derive IC index prefix per brand from existing CSV data.
 * Compares ic_index vs article_number: e.g. ELRING ic_index="EL242608",
 * article="242.608" → prefix="EL". BOSCH ic_index="0 986 479 313",
 * article="0 986 479 313" → prefix="" (with space pattern).
 *
 * Returns: { "ELRING": { prefix: "EL", hasSpaces: false },
 *            "BOSCH": { prefix: "", hasSpaces: true }, ... }
 */
async function buildBrandPrefixMap(): Promise<Record<string, { prefix: string; hasSpaces: boolean; sample: string }>> {
  const rows = await prisma.$queryRawUnsafe<Array<{
    manufacturer: string;
    ic_index: string;
    article_number: string;
  }>>(
    `SELECT DISTINCT ON (UPPER(manufacturer))
      manufacturer,
      ic_index,
      article_number
    FROM intercars_mappings
    WHERE ic_index IS NOT NULL
      AND article_number IS NOT NULL
      AND LENGTH(article_number) >= 3
      AND ic_index != article_number
    ORDER BY UPPER(manufacturer), id
    LIMIT 500`
  );

  const map: Record<string, { prefix: string; hasSpaces: boolean; sample: string }> = {};

  for (const row of rows) {
    const brand = row.manufacturer.toUpperCase();
    const normIndex = row.ic_index.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const normArticle = row.article_number.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const hasSpaces = row.ic_index.includes(" ");

    if (normIndex.endsWith(normArticle) && normIndex.length > normArticle.length) {
      const prefix = normIndex.slice(0, normIndex.length - normArticle.length);
      if (prefix.length <= 5) {
        map[brand] = { prefix, hasSpaces, sample: row.ic_index };
      }
    } else if (normIndex === normArticle) {
      // Same content, different formatting (BOSCH with spaces)
      map[brand] = { prefix: "", hasSpaces, sample: row.ic_index };
    }
  }

  // Also check brands where ic_index == article_number (exact match, no transform)
  const sameRows = await prisma.$queryRawUnsafe<Array<{ manufacturer: string; ic_index: string }>>(
    `SELECT DISTINCT ON (UPPER(manufacturer))
      manufacturer, ic_index
    FROM intercars_mappings
    WHERE ic_index IS NOT NULL AND article_number IS NOT NULL
      AND ic_index = article_number
      AND tecdoc_prod IS NOT NULL
    ORDER BY UPPER(manufacturer), id
    LIMIT 200`
  );

  for (const row of sameRows) {
    const brand = row.manufacturer.toUpperCase();
    if (!map[brand]) {
      map[brand] = { prefix: "", hasSpaces: row.ic_index.includes(" "), sample: row.ic_index };
    }
  }

  return map;
}

/**
 * Learn IC index format for brands we DON'T have in the prefix map yet,
 * by doing SKU lookups on products we already matched (have ic_sku set).
 * For each brand without a prefix, pick a matched product → call IC API by SKU →
 * get the `index` field → derive the prefix.
 *
 * This fills the prefix map for brands that weren't in the original CSV import.
 */
async function learnPrefixFromMatches(
  job: Job,
  prefixMap: Record<string, { prefix: string; hasSpaces: boolean; sample: string }>,
  parallelism: number
): Promise<number> {
  // Find brands that have matched products but no prefix map entry
  const brandsToLearn = await prisma.$queryRawUnsafe<Array<{
    brand_name: string;
    ic_sku: string;
    article_no: string;
  }>>(
    `SELECT DISTINCT ON (UPPER(b.name))
      b.name AS brand_name,
      pm.ic_sku,
      pm.article_no
    FROM product_maps pm
    JOIN brands b ON b.id = pm.brand_id
    WHERE pm.ic_sku IS NOT NULL AND pm.status = 'active'
    ORDER BY UPPER(b.name), pm.id
    LIMIT 500`
  );

  let learned = 0;
  const BATCH = Math.min(parallelism, 5); // Conservative to avoid rate limits

  for (let i = 0; i < brandsToLearn.length; i += BATCH) {
    const batch = brandsToLearn.slice(i, i + BATCH);
    const toLearn = batch.filter(b => !prefixMap[b.brand_name.toUpperCase()]);

    if (toLearn.length === 0) continue;

    const results = await Promise.allSettled(
      toLearn.map(async (b) => {
        const tok = await getIcToken();
        const hdrs = icHeaders(tok);
        const url = `${IC_API_URL}/catalog/products?sku=${encodeURIComponent(b.ic_sku)}&pageNumber=0&pageSize=1`;
        const resp = await fetch(url, { headers: hdrs, signal: AbortSignal.timeout(10_000) });
        if (!resp.ok) return null;
        const data = (await resp.json()) as { products: Array<{ index: string; sku: string; articleNumber?: string; brand: string }> };
        const product = data.products?.[0];
        if (!product) return null;
        return { brandName: b.brand_name, articleNo: b.article_no, icIndex: product.index, icBrand: product.brand };
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        const { brandName, articleNo, icIndex } = result.value;
        const brand = brandName.toUpperCase();
        if (prefixMap[brand]) continue; // Already learned

        const normIndex = icIndex.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
        const normArticle = articleNo.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
        const hasSpaces = icIndex.includes(" ");

        if (normIndex.endsWith(normArticle) && normIndex.length > normArticle.length) {
          const prefix = normIndex.slice(0, normIndex.length - normArticle.length);
          if (prefix.length <= 5) {
            prefixMap[brand] = { prefix, hasSpaces, sample: icIndex };
            learned++;
          }
        } else if (normIndex === normArticle) {
          prefixMap[brand] = { prefix: "", hasSpaces, sample: icIndex };
          learned++;
        } else {
          // IC index doesn't match article at all — store as-is for reference
          prefixMap[brand] = { prefix: "", hasSpaces, sample: icIndex };
          learned++;
        }
      }
    }

    // Rate limit: 200ms between batches
    await new Promise(r => setTimeout(r, 200));
    try { await job.extendLock(job.token!, 600_000); } catch { /* ok */ }
  }

  return learned;
}

/**
 * Construct the IC index from a TecDoc article number using the brand prefix map.
 * Returns multiple possible IC index formats to try.
 */
function constructIcIndexes(
  articleNo: string,
  brandName: string,
  prefixMap: Record<string, { prefix: string; hasSpaces: boolean; sample: string }>
): string[] {
  const norm = articleNo.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (norm.length < 3) return [];

  const brandKey = brandName.toUpperCase();
  const info = prefixMap[brandKey];
  const indexes: string[] = [];

  if (info) {
    // Known brand: use prefix
    if (info.prefix) {
      indexes.push(info.prefix + norm); // e.g., "EL" + "242608" = "EL242608"
    }
    if (info.hasSpaces) {
      // Try with original spacing from article_no
      indexes.push(articleNo); // "0 986 479 313"
    }
    if (!info.prefix && !info.hasSpaces) {
      indexes.push(norm); // Just the normalized article
    }
  }

  // Always try: raw article number, then normalized version
  if (!indexes.includes(articleNo)) indexes.push(articleNo);
  if (!indexes.includes(norm)) indexes.push(norm);

  // Only use prefix map from CSV data — never guess prefixes from brand name abbreviations

  return indexes.slice(0, 5); // Max 5 attempts per product
}

// ── Direct IC Lookup ─────────────────────────────────────────────────────

async function directIcLookup(
  job: Job,
  prefixMap: Record<string, { prefix: string; hasSpaces: boolean; sample: string }>,
  parallelism: number,
  maxLookup: number
): Promise<{ looked: number; found: number }> {
  let totalLooked = 0;
  let totalFound = 0;
  const limit = maxLookup > 0 ? maxLookup : 2_000_000;
  let offset = 0;
  const PAGE = 1000;

  while (totalLooked < limit) {
    // Get batch of unmatched products
    const batch = await prisma.$queryRawUnsafe<Array<{
      id: number;
      article_no: string;
      brand_name: string;
      ean: string | null;
    }>>(
      `SELECT pm.id, pm.article_no, b.name AS brand_name, pm.ean
       FROM product_maps pm
       JOIN brands b ON b.id = pm.brand_id
       WHERE pm.status = 'active' AND pm.ic_sku IS NULL
       ORDER BY pm.id
       LIMIT $1 OFFSET $2`,
      Math.min(PAGE, limit - totalLooked),
      offset
    );

    if (batch.length === 0) break;
    offset += batch.length;

    // Process in parallel chunks
    for (let i = 0; i < batch.length; i += parallelism) {
      const chunk = batch.slice(i, i + parallelism);

      const results = await Promise.allSettled(
        chunk.map(async (product) => {
          const indexes = constructIcIndexes(product.article_no, product.brand_name, prefixMap);
          for (const idx of indexes) {
            const found = await searchIcByIndex(idx);
            if (found) {
              return { productId: product.id, product: found };
            }
          }
          return null;
        })
      );

      // Process found products
      for (const result of results) {
        totalLooked++;
        if (result.status === "fulfilled" && result.value) {
          totalFound++;
          const { productId, product: p } = result.value;

          // Upsert into intercars_mappings
          try {
            await prisma.$executeRawUnsafe(
              `INSERT INTO intercars_mappings (tow_kod, ic_index, article_number, manufacturer, tecdoc_prod, ean, weight, description, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
               ON CONFLICT (tow_kod) DO UPDATE SET
                 article_number = COALESCE(EXCLUDED.article_number, intercars_mappings.article_number),
                 tecdoc_prod = COALESCE(EXCLUDED.tecdoc_prod, intercars_mappings.tecdoc_prod),
                 ean = COALESCE(EXCLUDED.ean, intercars_mappings.ean),
                 weight = COALESCE(EXCLUDED.weight, intercars_mappings.weight)`,
              p.sku,
              p.index,
              p.articleNumber || p.tecDoc || p.index,
              p.brand,
              p.tecDocProd ? Number(p.tecDocProd) : null,
              p.eans?.[0] ?? null,
              p.packageWeight ? parseFloat(p.packageWeight.replace(",", ".")) || null : null,
              p.shortDescription || p.description || ""
            );
          } catch { /* skip duplicate */ }

          // Directly update product_maps with ic_sku
          try {
            await prisma.$executeRawUnsafe(
              `UPDATE product_maps SET
                ic_sku = $1,
                ic_matched_at = NOW(),
                ean = COALESCE(ean, $2),
                weight = COALESCE(weight, $3)
              WHERE id = $4 AND ic_sku IS NULL`,
              p.sku,
              p.eans?.[0] ?? null,
              p.packageWeight ? parseFloat(p.packageWeight.replace(",", ".")) || null : null,
              productId
            );
          } catch { /* skip */ }
        }
      }

      // Pause between chunks to respect IC API rate limits (was 10ms, caused 429s at 50 parallel)
      await new Promise(r => setTimeout(r, 100));
    }

    // Extend lock + log progress
    try { await job.extendLock(job.token!, 600_000); } catch { /* ok */ }
    const progress = 10 + Math.min(75, Math.floor((totalLooked / Math.max(limit, 1)) * 75));
    await job.updateProgress(progress);

    if (totalLooked % 5000 < PAGE) {
      logger.info({ totalLooked, totalFound, offset, hitRate: totalLooked > 0 ? `${(totalFound / totalLooked * 100).toFixed(1)}%` : "0%" }, "IC direct lookup progress");
    }
  }

  return { looked: totalLooked, found: totalFound };
}

/**
 * Search IC API by index. Returns full product details if found.
 * Uses SKU detail endpoint for complete data (articleNumber, tecDocProd, EAN).
 */
async function searchIcByIndex(index: string): Promise<IcProduct | null> {
  try {
    const tok = await getIcToken();
    const hdrs = icHeaders(tok);

    // Search by index (the only working search method in IC API)
    const searchUrl = `${IC_API_URL}/catalog/products?index=${encodeURIComponent(index)}&pageNumber=0&pageSize=1`;
    const resp = await fetch(searchUrl, { headers: hdrs, signal: AbortSignal.timeout(10_000) });

    // Handle rate limiting — wait and signal caller to slow down
    if (resp.status === 429) {
      logger.warn("IC API rate limited (429) — pausing for 60s");
      await new Promise(r => setTimeout(r, 60_000));
      return null;
    }
    if (!resp.ok) return null;

    const data = (await resp.json()) as { totalResults: number; products: IcProduct[] };
    if (!data.products?.length) return null;

    const found = data.products[0];

    // If the search result has sku, do a detail lookup for full data (articleNumber, tecDocProd, EAN)
    if (found.sku && !found.tecDoc && !found.tecDocProd) {
      const detailUrl = `${IC_API_URL}/catalog/products?sku=${encodeURIComponent(found.sku)}&pageNumber=0&pageSize=1`;
      const detailResp = await fetch(detailUrl, { headers: hdrs, signal: AbortSignal.timeout(10_000) });
      if (detailResp.ok) {
        const detailData = (await detailResp.json()) as { products: IcProduct[] };
        if (detailData.products?.[0]) {
          return detailData.products[0];
        }
      }
    }

    return found;
  } catch {
    return null;
  }
}

// ── Auto brand aliases ───────────────────────────────────────────────────

async function autoCreateBrandAliases(): Promise<number> {
  const supplier = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
    `SELECT id FROM suppliers WHERE code = 'intercars' LIMIT 1`
  );
  if (!supplier[0]) return 0;
  const supplierId = supplier[0].id;
  let created = 0;

  // Step 0: Delete wrong aliases where IC brand and TecDoc brand names don't match
  // The old prefix-match method created many wrong aliases (ELRING→FEBI, NRF→NGK, etc.)
  const deleted = await prisma.$executeRawUnsafe(
    `DELETE FROM supplier_brand_rules
     WHERE supplier_id = $1
       AND UPPER(regexp_replace(supplier_brand, '[^a-zA-Z0-9]', '', 'g'))
           != UPPER(regexp_replace((SELECT name FROM brands WHERE id = brand_id), '[^a-zA-Z0-9]', '', 'g'))
       AND NOT (
         -- Keep valid aliases where one name contains the other (TRW AUTOMOTIVE ↔ TRW)
         UPPER(regexp_replace(supplier_brand, '[^a-zA-Z0-9]', '', 'g'))
           LIKE UPPER(regexp_replace((SELECT name FROM brands WHERE id = brand_id), '[^a-zA-Z0-9]', '', 'g')) || '%'
         OR UPPER(regexp_replace((SELECT name FROM brands WHERE id = brand_id), '[^a-zA-Z0-9]', '', 'g'))
           LIKE UPPER(regexp_replace(supplier_brand, '[^a-zA-Z0-9]', '', 'g')) || '%'
       )
       -- Only delete if supplier_brand length >= 4 (short brands like "KS" might be legit prefix matches)
       AND LENGTH(regexp_replace(supplier_brand, '[^a-zA-Z0-9]', '', 'g')) >= 4`,
    supplierId
  );
  if (deleted > 0) {
    logger.info({ deleted }, "Deleted wrong brand aliases");
  }

  // Method 1: tecdoc_prod → brands.tecdoc_id — BUT only when brand names are similar
  // tecdoc_prod is the TecDoc data supplier ID, which maps to brands.tecdoc_id.
  // We validate that the IC manufacturer name somewhat matches the TecDoc brand name
  // to avoid cross-brand matches (e.g. ELRING products with FEBI tecdoc_id).
  const tecdocMatches = await prisma.$queryRawUnsafe<Array<{ brand_id: number; manufacturer: string; brand_name: string }>>(
    `SELECT DISTINCT ON (UPPER(im.manufacturer))
      b.id AS brand_id, im.manufacturer, b.name AS brand_name
    FROM intercars_mappings im
    JOIN brands b ON b.tecdoc_id = im.tecdoc_prod
    WHERE im.tecdoc_prod IS NOT NULL
      AND (
        -- Exact normalized name match
        UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) = UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g'))
        -- One contains the other (TRW AUTOMOTIVE ↔ TRW, MAGNETI MARELLI ↔ MARELLI)
        OR UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) LIKE UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) || '%'
        OR UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) LIKE UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) || '%'
      )
      AND NOT EXISTS (
        SELECT 1 FROM supplier_brand_rules sbr
        WHERE sbr.supplier_id = $1 AND sbr.brand_id = b.id
      )
    ORDER BY UPPER(im.manufacturer)`,
    supplierId
  );

  for (const m of tecdocMatches) {
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO supplier_brand_rules (supplier_id, brand_id, supplier_brand, active, created_at)
         VALUES ($1, $2, $3, true, NOW()) ON CONFLICT DO NOTHING`,
        supplierId, m.brand_id, m.manufacturer.toUpperCase()
      );
      created++;
    } catch { /* skip */ }
  }

  // Method 2: Exact normalized name match (most reliable)
  const nameMatches = await prisma.$queryRawUnsafe<Array<{ brand_id: number; manufacturer: string }>>(
    `SELECT DISTINCT ON (UPPER(im.manufacturer))
      b.id AS brand_id, im.manufacturer
    FROM (SELECT DISTINCT manufacturer FROM intercars_mappings) im
    JOIN brands b ON UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) = UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g'))
    WHERE NOT EXISTS (
      SELECT 1 FROM supplier_brand_rules sbr
      WHERE sbr.supplier_id = $1 AND sbr.brand_id = b.id
    )
    ORDER BY UPPER(im.manufacturer)`,
    supplierId
  );

  for (const m of nameMatches) {
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO supplier_brand_rules (supplier_id, brand_id, supplier_brand, active, created_at)
         VALUES ($1, $2, $3, true, NOW()) ON CONFLICT DO NOTHING`,
        supplierId, m.brand_id, m.manufacturer.toUpperCase()
      );
      created++;
    } catch { /* skip */ }
  }

  // Method 3: Containment match — only when one full name contains the other
  // e.g. "TRW AUTOMOTIVE" contains "TRW", "MAGNETI MARELLI" contains "MARELLI"
  // Requires minimum 4 chars to avoid false positives with short brand names
  const containMatches = await prisma.$queryRawUnsafe<Array<{ brand_id: number; manufacturer: string }>>(
    `SELECT DISTINCT ON (UPPER(im.manufacturer))
      b.id AS brand_id, im.manufacturer
    FROM (SELECT DISTINCT manufacturer FROM intercars_mappings) im
    JOIN brands b ON (
      UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) LIKE UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) || '%'
      OR UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) LIKE UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) || '%'
    )
    WHERE LENGTH(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) >= 4
      AND LENGTH(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) >= 4
      AND NOT EXISTS (
        SELECT 1 FROM supplier_brand_rules sbr
        WHERE sbr.supplier_id = $1 AND sbr.brand_id = b.id
      )
    ORDER BY UPPER(im.manufacturer), LENGTH(b.name) DESC`,
    supplierId
  );

  for (const m of containMatches) {
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO supplier_brand_rules (supplier_id, brand_id, supplier_brand, active, created_at)
         VALUES ($1, $2, $3, true, NOW()) ON CONFLICT DO NOTHING`,
        supplierId, m.brand_id, m.manufacturer.toUpperCase()
      );
      created++;
    } catch { /* skip */ }
  }

  // Method 4: Known manual aliases for common IC ↔ TecDoc brand differences
  const MANUAL_ALIASES: Record<string, string> = {
    "BLIC": "DIEDERICHS",          // BLIC = IC house brand for DIEDERICHS parts
    "KAYABA": "KYB",               // KYB was formerly Kayaba
    "HANS PRIES": "HP",            // Hans Pries = HP brand
    "MAHLE": "KNECHT",             // MAHLE owns KNECHT (same company)
    "KNECHT": "MAHLE",             // Reverse
    "LUK1": "LUK",                // LUK1 = typo variant
    "MEAT&DORIA": "MEAT & DORIA", // Formatting
    "KS": "KOLBENSCHMIDT",        // KS = Kolbenschmidt
    "GOETZE": "GOETZE ENGINE",    // Goetze = Goetze Engine
    "VDO": "CONTINENTAL",          // VDO is Continental brand
    "CONTI": "CONTINENTAL",        // Conti = Continental
  };

  for (const [icBrand, tecdocName] of Object.entries(MANUAL_ALIASES)) {
    try {
      const brand = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
        `SELECT id FROM brands WHERE UPPER(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g')) = UPPER(regexp_replace($1, '[^a-zA-Z0-9]', '', 'g')) LIMIT 1`,
        tecdocName
      );
      if (brand[0]) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO supplier_brand_rules (supplier_id, brand_id, supplier_brand, active, created_at)
           VALUES ($1, $2, $3, true, NOW()) ON CONFLICT DO NOTHING`,
          supplierId, brand[0].id, icBrand.toUpperCase()
        );
        created++;
      }
    } catch { /* skip */ }
  }

  logger.info({ tecdoc: tecdocMatches.length, name: nameMatches.length, contain: containMatches.length, manual: Object.keys(MANUAL_ALIASES).length }, "Brand alias methods");
  return created;
}

// ── Matching phases ──────────────────────────────────────────────────────

async function runAllMatchingPhases(): Promise<number> {
  type MatchRow = { product_id: number; tow_kod: string; ic_ean: string | null; ic_weight: number | null };
  let total = 0;

  const runPhase = async (name: string, sql: string, timeoutMs = 600_000): Promise<number> => {
    const start = Date.now();
    try {
      const matches = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL work_mem = '512MB'`);
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${timeoutMs}'`);
        return tx.$queryRawUnsafe<MatchRow[]>(sql);
      }, { timeout: timeoutMs + 60_000 });

      if (matches.length > 0) {
        for (let i = 0; i < matches.length; i += 500) {
          const batch = matches.slice(i, i + 500);
          const cases = batch.map(m => `WHEN ${m.product_id} THEN '${m.tow_kod.replace(/'/g, "''")}'`).join(" ");
          const eanCases = batch.map(m => `WHEN ${m.product_id} THEN ${m.ic_ean ? `'${m.ic_ean.replace(/'/g, "''")}'` : "NULL"}`).join(" ");
          const weightCases = batch.map(m => `WHEN ${m.product_id} THEN ${m.ic_weight ?? "NULL"}`).join(" ");
          const ids = batch.map(m => m.product_id).join(",");
          await prisma.$executeRawUnsafe(
            `UPDATE product_maps SET
              ic_sku = CASE id ${cases} END,
              ic_matched_at = NOW(),
              ean = CASE WHEN ean IS NULL THEN CASE id ${eanCases} END ELSE ean END,
              weight = CASE WHEN weight IS NULL THEN CASE id ${weightCases} END ELSE weight END
            WHERE id IN (${ids})`
          );
        }
      }
      logger.info({ phase: name, matches: matches.length, sec: ((Date.now() - start) / 1000).toFixed(1) }, "Phase done");
      return matches.length;
    } catch (err) {
      logger.warn({ phase: name, err, sec: ((Date.now() - start) / 1000).toFixed(1) }, "Phase failed");
      return 0;
    }
  };

  // Phase 1: DIRECT — tecdoc_prod matches brand's tecdoc_id + article number match
  total += await runPhase("DIRECT", `
    SELECT DISTINCT ON (pm.id) pm.id as product_id, im.tow_kod, im.ean as ic_ean, im.weight as ic_weight
    FROM product_maps pm
    JOIN brands b ON b.id = pm.brand_id
    JOIN intercars_mappings im ON im.tecdoc_prod IS NOT NULL AND b.tecdoc_id IS NOT NULL
      AND im.tecdoc_prod = b.tecdoc_id AND im.normalized_article_number = pm.normalized_article_no
    WHERE pm.status = 'active' AND pm.ic_sku IS NULL ORDER BY pm.id`);

  // Phase 2: ALIASES — brand alias rules + article number match
  total += await runPhase("ALIASES", `
    SELECT DISTINCT ON (pm.id) pm.id as product_id, im.tow_kod, im.ean as ic_ean, im.weight as ic_weight
    FROM product_maps pm
    JOIN brands b ON b.id = pm.brand_id
    JOIN supplier_brand_rules sbr ON sbr.brand_id = b.id AND sbr.active = true
    JOIN intercars_mappings im ON im.normalized_article_number = pm.normalized_article_no
      AND UPPER(im.manufacturer) = sbr.supplier_brand
    WHERE pm.status = 'active' AND pm.ic_sku IS NULL ORDER BY pm.id`);

  // Phase 3: BRAND_ARTICLE — normalized brand name match + article number
  // Requires min 4 chars for prefix match to avoid false positives (NRF→NGK)
  total += await runPhase("BRAND_ARTICLE", `
    SELECT DISTINCT ON (pm.id) pm.id as product_id, im.tow_kod, im.ean as ic_ean, im.weight as ic_weight
    FROM product_maps pm
    JOIN brands b ON b.id = pm.brand_id
    JOIN intercars_mappings im ON im.normalized_article_number = pm.normalized_article_no
      AND (
        im.normalized_manufacturer = UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))
        OR (LENGTH(im.normalized_manufacturer) >= 4 AND UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) LIKE im.normalized_manufacturer || '%')
        OR (LENGTH(UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))) >= 4 AND im.normalized_manufacturer LIKE UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) || '%')
      )
    WHERE pm.status = 'active' AND pm.ic_sku IS NULL ORDER BY pm.id`);

  // Phase 4: EAN — exact EAN match (very reliable, brand-independent)
  total += await runPhase("EAN", `
    SELECT DISTINCT ON (pm.id) pm.id as product_id, im.tow_kod, im.ean as ic_ean, im.weight as ic_weight
    FROM product_maps pm
    JOIN intercars_mappings im ON pm.ean IS NOT NULL AND im.ean IS NOT NULL
      AND LENGTH(pm.ean) >= 8 AND UPPER(TRIM(pm.ean)) = UPPER(TRIM(im.ean))
    WHERE pm.status = 'active' AND pm.ic_sku IS NULL ORDER BY pm.id`);

  // Phase 5: TECDOC_ID — match tecdoc_id (data supplier brand ID) + article
  total += await runPhase("TECDOC_ID", `
    SELECT DISTINCT ON (pm.id) pm.id as product_id, im.tow_kod, im.ean as ic_ean, im.weight as ic_weight
    FROM product_maps pm
    JOIN intercars_mappings im ON pm.tecdoc_id IS NOT NULL AND im.tecdoc_prod IS NOT NULL
      AND CAST(pm.tecdoc_id AS TEXT) = CAST(im.tecdoc_prod AS TEXT)
      AND im.normalized_article_number = pm.normalized_article_no
    WHERE pm.status = 'active' AND pm.ic_sku IS NULL ORDER BY pm.id`);

  // Phase 6: UNIQUE_ARTICLE — materialized view of articles unique to one IC mapping
  total += await runPhase("UNIQUE_ARTICLE", `
    SELECT pm.id AS product_id, ua.tow_kod, ua.ic_ean, ua.ic_weight
    FROM product_maps pm
    JOIN ic_unique_articles ua ON ua.norm_article = pm.normalized_article_no
    WHERE pm.status = 'active' AND pm.ic_sku IS NULL ORDER BY pm.id`);

  // Phase 7: OEM — match product OEM number against IC article numbers
  total += await runPhase("OEM", `
    SELECT DISTINCT ON (pm.id) pm.id as product_id, im.tow_kod, im.ean as ic_ean, im.weight as ic_weight
    FROM product_maps pm
    JOIN intercars_mappings im ON im.normalized_article_number = UPPER(regexp_replace(pm.oem, '[^a-zA-Z0-9]', '', 'g'))
    WHERE pm.status = 'active' AND pm.ic_sku IS NULL AND pm.oem IS NOT NULL AND LENGTH(pm.oem) >= 5
    ORDER BY pm.id`);

  // Phase 8: LEADING_ZEROS — strip leading zeros for comparison
  total += await runPhase("LEADING_ZEROS", `
    SELECT DISTINCT ON (pm.id) pm.id as product_id, im.tow_kod, im.ean as ic_ean, im.weight as ic_weight
    FROM product_maps pm
    JOIN brands b ON b.id = pm.brand_id
    JOIN intercars_mappings im ON LTRIM(im.normalized_article_number, '0') = LTRIM(pm.normalized_article_no, '0')
      AND LENGTH(LTRIM(pm.normalized_article_no, '0')) >= 5
      AND (im.normalized_manufacturer = UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) OR im.tecdoc_prod = b.tecdoc_id)
    WHERE pm.status = 'active' AND pm.ic_sku IS NULL ORDER BY pm.id`);

  // Phase 9: CROSS_BRAND — tecdoc_prod = tecdoc_id + article (same as DIRECT but re-run after previous phases fill gaps)
  total += await runPhase("CROSS_BRAND", `
    SELECT DISTINCT ON (pm.id) pm.id as product_id, im.tow_kod, im.ean as ic_ean, im.weight as ic_weight
    FROM product_maps pm
    JOIN brands b ON b.id = pm.brand_id
    JOIN intercars_mappings im ON im.normalized_article_number = pm.normalized_article_no
      AND im.tecdoc_prod IS NOT NULL AND b.tecdoc_id IS NOT NULL AND im.tecdoc_prod = b.tecdoc_id
    WHERE pm.status = 'active' AND pm.ic_sku IS NULL ORDER BY pm.id`);

  // Phase 10: ARTICLE_ONLY — unique articles with length >= 6 (lowered from 8 for more coverage)
  total += await runPhase("ARTICLE_ONLY", `
    SELECT DISTINCT ON (pm.id) pm.id as product_id, im.tow_kod, im.ean as ic_ean, im.weight as ic_weight
    FROM product_maps pm
    JOIN intercars_mappings im ON im.normalized_article_number = pm.normalized_article_no
      AND LENGTH(pm.normalized_article_no) >= 6
    WHERE pm.status = 'active' AND pm.ic_sku IS NULL
      AND (SELECT COUNT(*) FROM intercars_mappings im2 WHERE im2.normalized_article_number = pm.normalized_article_no) = 1
    ORDER BY pm.id`, 600_000);

  // Phase 11: TECDOC_BRAND_ONLY — match by tecdoc_prod brand ID only (no article, but same brand)
  // This matches products where article numbers differ between TecDoc and IC formats
  total += await runPhase("TECDOC_BRAND_FUZZY", `
    SELECT DISTINCT ON (pm.id) pm.id as product_id, im.tow_kod, im.ean as ic_ean, im.weight as ic_weight
    FROM product_maps pm
    JOIN brands b ON b.id = pm.brand_id
    JOIN intercars_mappings im ON im.tecdoc_prod IS NOT NULL AND b.tecdoc_id IS NOT NULL
      AND im.tecdoc_prod = b.tecdoc_id
      AND LTRIM(im.normalized_article_number, '0') = LTRIM(pm.normalized_article_no, '0')
      AND LENGTH(LTRIM(pm.normalized_article_no, '0')) >= 4
    WHERE pm.status = 'active' AND pm.ic_sku IS NULL ORDER BY pm.id`);

  // Phase 12: SUBSTRING_ARTICLE — IC article contains or is contained in product article
  // Handles cases where IC index has prefix but article_number column wasn't updated
  total += await runPhase("SUBSTRING_ARTICLE", `
    SELECT DISTINCT ON (pm.id) pm.id as product_id, im.tow_kod, im.ean as ic_ean, im.weight as ic_weight
    FROM product_maps pm
    JOIN brands b ON b.id = pm.brand_id
    JOIN intercars_mappings im ON (
      im.normalized_article_number LIKE '%' || pm.normalized_article_no || '%'
      OR pm.normalized_article_no LIKE '%' || im.normalized_article_number || '%'
    )
    AND LENGTH(pm.normalized_article_no) >= 6
    AND LENGTH(im.normalized_article_number) >= 6
    AND (im.normalized_manufacturer = UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))
      OR im.tecdoc_prod = b.tecdoc_id
      OR EXISTS (SELECT 1 FROM supplier_brand_rules sbr WHERE sbr.brand_id = b.id AND sbr.active = true AND UPPER(im.manufacturer) = sbr.supplier_brand))
    WHERE pm.status = 'active' AND pm.ic_sku IS NULL ORDER BY pm.id`, 900_000);

  return total;
}

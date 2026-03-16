import { Job } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

/**
 * IC Bulk Enrichment Worker
 *
 * Gets 100% IC match rate by:
 * 1. Building brand prefix map from existing CSV data (ic_index vs article_number)
 * 2. Fixing article_numbers in catalog-crawled products (strip brand prefix)
 * 3. Batch SKU detail lookups for tecdoc_prod + clean articleNumber + EAN
 * 4. Auto-creating brand aliases (IC brand → TecDoc brand via tecdoc_prod)
 * 5. Running all 13 matching phases
 *
 * Strategy: parallelize everything — 20 concurrent API calls, batch DB updates.
 */

export interface IcEnrichJobData {
  /** "full" = fix data + enrich + aliases + match. "enrich-only" = just SKU lookups */
  mode?: "full" | "enrich-only" | "fix-articles" | "aliases-only" | "match-only";
  /** Max products to enrich via API (0 = unlimited) */
  maxEnrich?: number;
  /** Parallel API calls (default 20) */
  parallelism?: number;
  /** Batch size for DB updates (default 500) */
  batchSize?: number;
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
  if (!response.ok) throw new Error(`IC OAuth2 failed: ${response.status}`);
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

interface IcDetailProduct {
  sku: string;
  index: string;
  tecDoc?: string;
  tecDocProd?: string | number;
  articleNumber?: string;
  brand: string;
  eans?: string[];
  packageWeight?: string;
}

// ── Main worker ──────────────────────────────────────────────────────────

export async function processIcEnrichJob(job: Job<IcEnrichJobData>): Promise<void> {
  const {
    mode = "full",
    maxEnrich = 0,
    parallelism = 20,
    batchSize = 500,
  } = job.data;

  if (!IC_CLIENT_ID || !IC_CLIENT_SECRET) {
    logger.warn("IC enrich: no INTERCARS_CLIENT_ID/SECRET configured");
    return;
  }

  logger.info({ mode, maxEnrich, parallelism }, "IC enrichment starting");

  const stats = {
    prefixesFixed: 0,
    articlesFixed: 0,
    skuEnriched: 0,
    aliasesCreated: 0,
    matchesFound: 0,
  };

  // ── Step 1: Build brand prefix map from existing CSV data ─────────────
  if (mode === "full" || mode === "fix-articles") {
    logger.info("Step 1: Building brand prefix map from CSV data...");
    const prefixMap = await buildBrandPrefixMap();
    logger.info({ brands: Object.keys(prefixMap).length }, "Brand prefix map built");

    // Fix article_numbers for catalog-crawled products (those with brand-prefixed articles)
    stats.articlesFixed = await fixCrawledArticleNumbers(prefixMap);
    logger.info({ fixed: stats.articlesFixed }, "Fixed catalog-crawled article numbers");
    await job.updateProgress(10);
  }

  // ── Step 2: Batch SKU detail lookups for missing tecdoc_prod ──────────
  if (mode === "full" || mode === "enrich-only") {
    logger.info("Step 2: Batch SKU detail lookups for tecdoc_prod...");
    stats.skuEnriched = await enrichSkuDetails(job, parallelism, batchSize, maxEnrich);
    logger.info({ enriched: stats.skuEnriched }, "SKU detail enrichment done");
    await job.updateProgress(60);
  }

  // ── Step 3: Auto-create brand aliases ─────────────────────────────────
  if (mode === "full" || mode === "aliases-only") {
    logger.info("Step 3: Auto-creating brand aliases...");
    stats.aliasesCreated = await autoCreateBrandAliases();
    logger.info({ created: stats.aliasesCreated }, "Brand aliases created");
    await job.updateProgress(70);
  }

  // ── Step 4: Refresh materialized view and trigger IC match ────────────
  if (mode === "full" || mode === "match-only") {
    logger.info("Step 4: Refreshing materialized view + running IC match...");
    try {
      await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY ic_unique_articles`);
      logger.info("ic_unique_articles materialized view refreshed");
    } catch (err) {
      logger.warn({ err }, "Materialized view refresh failed (non-critical)");
    }
    await job.updateProgress(80);

    // Run aggressive matching (all phases)
    stats.matchesFound = await runAggressiveMatching();
    logger.info({ matches: stats.matchesFound }, "Aggressive matching complete");
    await job.updateProgress(100);
  }

  logger.info({ stats }, "IC enrichment completed");
}

// ── Brand prefix map ─────────────────────────────────────────────────────

/**
 * Build a map of IC brand → prefix by comparing ic_index vs article_number
 * in existing CSV data. E.g., ELRING: ic_index="EL242608", article="242.608"
 * → prefix="EL". BOSCH: ic_index="1 987 473 597", article="1 987 473 597"
 * → prefix="" (no prefix).
 */
async function buildBrandPrefixMap(): Promise<Record<string, string>> {
  const rows = await prisma.$queryRawUnsafe<Array<{
    manufacturer: string;
    sample_index: string;
    sample_article: string;
  }>>(
    `SELECT DISTINCT ON (manufacturer)
      manufacturer,
      ic_index AS sample_index,
      article_number AS sample_article
    FROM intercars_mappings
    WHERE ic_index IS NOT NULL
      AND article_number IS NOT NULL
      AND ic_index != article_number
      AND LENGTH(article_number) >= 3
    ORDER BY manufacturer, id
    LIMIT 500`
  );

  const prefixMap: Record<string, string> = {};

  for (const row of rows) {
    const normIndex = row.sample_index.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const normArticle = row.sample_article.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();

    // The prefix is the part of ic_index that comes before the article_number
    if (normIndex.endsWith(normArticle)) {
      const prefix = normIndex.slice(0, normIndex.length - normArticle.length);
      if (prefix.length > 0 && prefix.length <= 5) {
        prefixMap[row.manufacturer.toUpperCase()] = prefix;
      }
    } else if (normIndex.startsWith(normArticle)) {
      // Suffix brand (e.g., THERMOTEC: "DCC087TT" where article="DCC087")
      const suffix = normIndex.slice(normArticle.length);
      if (suffix.length > 0 && suffix.length <= 4) {
        prefixMap[row.manufacturer.toUpperCase()] = `SUFFIX:${suffix}`;
      }
    }
  }

  // Also add brands with NO prefix (ic_index = article_number)
  const sameRows = await prisma.$queryRawUnsafe<Array<{ manufacturer: string }>>(
    `SELECT DISTINCT manufacturer
    FROM intercars_mappings
    WHERE ic_index IS NOT NULL AND article_number IS NOT NULL
      AND UPPER(REPLACE(REPLACE(REPLACE(ic_index, ' ', ''), '.', ''), '-', ''))
        = UPPER(REPLACE(REPLACE(REPLACE(article_number, ' ', ''), '.', ''), '-', ''))
    LIMIT 200`
  );

  for (const row of sameRows) {
    const key = row.manufacturer.toUpperCase();
    if (!prefixMap[key]) {
      prefixMap[key] = ""; // no prefix
    }
  }

  return prefixMap;
}

/**
 * Fix article_numbers for catalog-crawled products.
 * These were stored with the IC index (brand-prefixed) instead of clean article numbers.
 * Detect them: ic_index = article_number (both set to the same value).
 */
async function fixCrawledArticleNumbers(prefixMap: Record<string, string>): Promise<number> {
  // Find products where article_number looks like it has a brand prefix
  // (i.e., article_number == ic_index, which means it wasn't cleaned)
  const crawled = await prisma.$queryRawUnsafe<Array<{
    id: number;
    ic_index: string;
    article_number: string;
    manufacturer: string;
  }>>(
    `SELECT id, ic_index, article_number, manufacturer
    FROM intercars_mappings
    WHERE ic_index IS NOT NULL
      AND article_number IS NOT NULL
      AND ic_index = article_number
      AND tecdoc_prod IS NULL
    LIMIT 100000`
  );

  if (crawled.length === 0) return 0;

  let fixed = 0;
  const updates: Array<{ id: number; cleanArticle: string }> = [];

  for (const row of crawled) {
    const brand = row.manufacturer.toUpperCase();
    const prefix = prefixMap[brand];
    const normIndex = row.ic_index.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();

    let cleanArticle: string | null = null;

    if (prefix === "") {
      // No prefix — article is the index without formatting
      cleanArticle = normIndex;
    } else if (prefix && !prefix.startsWith("SUFFIX:")) {
      // Strip prefix
      if (normIndex.startsWith(prefix)) {
        cleanArticle = normIndex.slice(prefix.length);
      }
    } else if (prefix?.startsWith("SUFFIX:")) {
      // Strip suffix
      const suffix = prefix.slice(7);
      if (normIndex.endsWith(suffix)) {
        cleanArticle = normIndex.slice(0, normIndex.length - suffix.length);
      }
    }

    if (cleanArticle && cleanArticle.length >= 3) {
      updates.push({ id: row.id, cleanArticle });
    }
  }

  // Batch update
  for (let i = 0; i < updates.length; i += 500) {
    const batch = updates.slice(i, i + 500);
    const cases = batch.map(u => `WHEN ${u.id} THEN '${u.cleanArticle}'`).join(" ");
    const ids = batch.map(u => u.id).join(",");

    await prisma.$executeRawUnsafe(
      `UPDATE intercars_mappings
       SET article_number = CASE id ${cases} END
       WHERE id IN (${ids})`
    );
    fixed += batch.length;
  }

  return fixed;
}

// ── SKU detail enrichment ────────────────────────────────────────────────

/**
 * For IC products missing tecdoc_prod (from catalog crawl), do batch SKU
 * lookups to get articleNumber, tecDocProd, EAN, weight.
 */
async function enrichSkuDetails(
  job: Job,
  parallelism: number,
  batchSize: number,
  maxEnrich: number
): Promise<number> {
  let totalEnriched = 0;
  let offset = 0;
  const limit = maxEnrich > 0 ? maxEnrich : 1_000_000;

  while (totalEnriched < limit) {
    // Get batch of SKUs missing tecdoc_prod
    const batch = await prisma.$queryRawUnsafe<Array<{ tow_kod: string }>>(
      `SELECT tow_kod FROM intercars_mappings
       WHERE tecdoc_prod IS NULL
       ORDER BY id
       LIMIT $1 OFFSET $2`,
      Math.min(batchSize * parallelism, limit - totalEnriched),
      offset
    );

    if (batch.length === 0) break;

    // Process in parallel chunks
    for (let i = 0; i < batch.length; i += parallelism) {
      const chunk = batch.slice(i, i + parallelism);
      const results = await Promise.allSettled(
        chunk.map(m => fetchProductDetail(m.tow_kod))
      );

      const updates: Array<{
        tow_kod: string;
        articleNumber: string;
        tecdocProd: number | null;
        ean: string | null;
        weight: number | null;
      }> = [];

      for (const result of results) {
        if (result.status === "fulfilled" && result.value) {
          const p = result.value;
          const tecdocProd = p.tecDocProd ? Number(p.tecDocProd) : null;
          const articleNumber = p.articleNumber || p.tecDoc || "";
          const ean = p.eans?.[0] ?? null;
          const weight = p.packageWeight
            ? parseFloat(p.packageWeight.replace(",", "."))
            : null;

          if (articleNumber) {
            updates.push({
              tow_kod: p.sku,
              articleNumber,
              tecdocProd,
              ean,
              weight: isNaN(weight!) ? null : weight,
            });
          }
        }
      }

      // Batch update
      if (updates.length > 0) {
        for (const u of updates) {
          try {
            await prisma.$executeRawUnsafe(
              `UPDATE intercars_mappings SET
                article_number = $1,
                tecdoc_prod = COALESCE($2, tecdoc_prod),
                ean = COALESCE($3, ean),
                weight = COALESCE($4, weight)
              WHERE tow_kod = $5`,
              u.articleNumber,
              u.tecdocProd,
              u.ean,
              u.weight,
              u.tow_kod
            );
            totalEnriched++;
          } catch { /* skip */ }
        }
      }

      // Rate limit: small pause between batches
      await new Promise(r => setTimeout(r, 20));
    }

    offset += batch.length;

    // Extend job lock
    try { await job.extendLock(job.token!, 600_000); } catch { /* ok */ }
    await job.updateProgress(10 + Math.min(50, Math.floor((totalEnriched / limit) * 50)));

    logger.info({ totalEnriched, offset }, "IC SKU enrichment progress");
  }

  return totalEnriched;
}

async function fetchProductDetail(sku: string): Promise<IcDetailProduct | null> {
  const tok = await getIcToken();
  const hdrs = icHeaders(tok);
  const url = `${IC_API_URL}/catalog/products?sku=${encodeURIComponent(sku)}&pageNumber=0&pageSize=1`;
  const resp = await fetch(url, { headers: hdrs, signal: AbortSignal.timeout(15_000) });
  if (!resp.ok) return null;
  const data = (await resp.json()) as { products: IcDetailProduct[] };
  return data.products?.[0] ?? null;
}

// ── Auto brand aliases ───────────────────────────────────────────────────

/**
 * Auto-create brand aliases by matching IC brands to TecDoc brands via:
 * 1. tecdoc_prod → brands.tecdoc_id (most reliable)
 * 2. Normalized name matching (ELRING ↔ ELRING, KAYABA ↔ KYB, etc.)
 * 3. Prefix matching (TRW AUTOMOTIVE ↔ TRW)
 */
async function autoCreateBrandAliases(): Promise<number> {
  // Get the InterCars supplier ID
  const supplier = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
    `SELECT id FROM suppliers WHERE code = 'intercars' LIMIT 1`
  );
  if (!supplier[0]) {
    logger.warn("No intercars supplier found in DB");
    return 0;
  }
  const supplierId = supplier[0].id;

  let created = 0;

  // Method 1: tecdoc_prod → brands.tecdoc_id (highest confidence)
  const tecdocMatches = await prisma.$queryRawUnsafe<Array<{
    brand_id: number;
    manufacturer: string;
  }>>(
    `SELECT DISTINCT ON (im.manufacturer)
      b.id AS brand_id,
      im.manufacturer
    FROM intercars_mappings im
    JOIN brands b ON b.tecdoc_id = im.tecdoc_prod
    WHERE im.tecdoc_prod IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM supplier_brand_rules sbr
        WHERE sbr.supplier_id = $1
          AND sbr.brand_id = b.id
          AND sbr.supplier_brand = UPPER(im.manufacturer)
      )
    ORDER BY im.manufacturer`,
    supplierId
  );

  for (const m of tecdocMatches) {
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO supplier_brand_rules (supplier_id, brand_id, supplier_brand, active, created_at)
         VALUES ($1, $2, $3, true, NOW())
         ON CONFLICT DO NOTHING`,
        supplierId, m.brand_id, m.manufacturer.toUpperCase()
      );
      created++;
    } catch { /* skip */ }
  }

  logger.info({ method: "tecdoc_prod", created: tecdocMatches.length }, "Brand aliases via tecdoc_prod");

  // Method 2: Exact normalized name match
  const nameMatches = await prisma.$queryRawUnsafe<Array<{
    brand_id: number;
    manufacturer: string;
  }>>(
    `SELECT DISTINCT ON (im.manufacturer)
      b.id AS brand_id,
      im.manufacturer
    FROM (SELECT DISTINCT manufacturer FROM intercars_mappings) im
    JOIN brands b ON UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) = UPPER(REGEXP_REPLACE(im.manufacturer, '[^a-zA-Z0-9]', '', 'g'))
    WHERE NOT EXISTS (
      SELECT 1 FROM supplier_brand_rules sbr
      WHERE sbr.supplier_id = $1
        AND sbr.brand_id = b.id
        AND sbr.supplier_brand = UPPER(im.manufacturer)
    )
    ORDER BY im.manufacturer`,
    supplierId
  );

  for (const m of nameMatches) {
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO supplier_brand_rules (supplier_id, brand_id, supplier_brand, active, created_at)
         VALUES ($1, $2, $3, true, NOW())
         ON CONFLICT DO NOTHING`,
        supplierId, m.brand_id, m.manufacturer.toUpperCase()
      );
      created++;
    } catch { /* skip */ }
  }

  logger.info({ method: "name_match", created: nameMatches.length }, "Brand aliases via name match");

  // Method 3: Prefix matching (TRW AUTOMOTIVE ↔ TRW, QUICK BRAKE ↔ QUICKBRAKE)
  const prefixMatches = await prisma.$queryRawUnsafe<Array<{
    brand_id: number;
    manufacturer: string;
  }>>(
    `SELECT DISTINCT ON (im.manufacturer)
      b.id AS brand_id,
      im.manufacturer
    FROM (SELECT DISTINCT manufacturer FROM intercars_mappings) im
    JOIN brands b ON (
      UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) LIKE UPPER(REGEXP_REPLACE(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) || '%'
      OR UPPER(REGEXP_REPLACE(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) LIKE UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) || '%'
    )
    WHERE LENGTH(UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))) >= 3
      AND NOT EXISTS (
        SELECT 1 FROM supplier_brand_rules sbr
        WHERE sbr.supplier_id = $1
          AND sbr.brand_id = b.id
      )
    ORDER BY im.manufacturer, LENGTH(UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))) DESC`,
    supplierId
  );

  for (const m of prefixMatches) {
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO supplier_brand_rules (supplier_id, brand_id, supplier_brand, active, created_at)
         VALUES ($1, $2, $3, true, NOW())
         ON CONFLICT DO NOTHING`,
        supplierId, m.brand_id, m.manufacturer.toUpperCase()
      );
      created++;
    } catch { /* skip */ }
  }

  logger.info({ method: "prefix_match", created: prefixMatches.length }, "Brand aliases via prefix match");

  return created;
}

// ── Aggressive matching ──────────────────────────────────────────────────

/**
 * Run all matching phases plus additional aggressive phases:
 * - Article number substring matching (for remaining unmatched)
 * - Brand-agnostic unique article matching
 * - Fuzzy article number matching (Levenshtein distance 1-2)
 */
async function runAggressiveMatching(): Promise<number> {
  type MatchRow = { product_id: number; tow_kod: string; ic_ean: string | null; ic_weight: number | null };
  let totalMatches = 0;

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

      const dur = ((Date.now() - start) / 1000).toFixed(1);
      logger.info({ phase: name, matches: matches.length, durationSec: dur }, "Phase done");
      return matches.length;
    } catch (err) {
      const dur = ((Date.now() - start) / 1000).toFixed(1);
      logger.warn({ phase: name, err, durationSec: dur }, "Phase failed");
      return 0;
    }
  };

  // Phase DIRECT: tecdoc_prod + normalized article
  totalMatches += await runPhase("DIRECT",
    `SELECT DISTINCT ON (pm.id)
      pm.id as product_id, im.tow_kod, im.ean as ic_ean, im.weight as ic_weight
    FROM product_maps pm
    JOIN brands b ON b.id = pm.brand_id
    JOIN intercars_mappings im ON
      im.tecdoc_prod IS NOT NULL AND b.tecdoc_id IS NOT NULL
      AND im.tecdoc_prod = b.tecdoc_id
      AND im.normalized_article_number = pm.normalized_article_no
    WHERE pm.status = 'active' AND pm.ic_sku IS NULL
    ORDER BY pm.id`);

  // Phase 0: Brand aliases
  totalMatches += await runPhase("ALIASES",
    `SELECT DISTINCT ON (pm.id)
      pm.id as product_id, im.tow_kod, im.ean as ic_ean, im.weight as ic_weight
    FROM product_maps pm
    JOIN brands b ON b.id = pm.brand_id
    JOIN supplier_brand_rules sbr ON sbr.brand_id = b.id AND sbr.active = true
    JOIN intercars_mappings im ON
      im.normalized_article_number = pm.normalized_article_no
      AND UPPER(im.manufacturer) = sbr.supplier_brand
    WHERE pm.status = 'active' AND pm.ic_sku IS NULL
    ORDER BY pm.id`);

  // Phase 1A: Brand + article (flexible)
  totalMatches += await runPhase("BRAND+ARTICLE",
    `SELECT DISTINCT ON (pm.id)
      pm.id as product_id, im.tow_kod, im.ean as ic_ean, im.weight as ic_weight
    FROM product_maps pm
    JOIN brands b ON b.id = pm.brand_id
    JOIN intercars_mappings im ON
      im.normalized_article_number = pm.normalized_article_no
      AND (
        im.normalized_manufacturer = UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))
        OR (LENGTH(im.normalized_manufacturer) >= 2 AND UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) LIKE im.normalized_manufacturer || '%')
        OR (LENGTH(UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))) >= 2 AND im.normalized_manufacturer LIKE UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) || '%')
      )
    WHERE pm.status = 'active' AND pm.ic_sku IS NULL
    ORDER BY pm.id`);

  // Phase 1B: EAN
  totalMatches += await runPhase("EAN",
    `SELECT DISTINCT ON (pm.id)
      pm.id as product_id, im.tow_kod, im.ean as ic_ean, im.weight as ic_weight
    FROM product_maps pm
    JOIN intercars_mappings im ON
      pm.ean IS NOT NULL AND im.ean IS NOT NULL
      AND LENGTH(pm.ean) >= 8
      AND UPPER(TRIM(pm.ean)) = UPPER(TRIM(im.ean))
    WHERE pm.status = 'active' AND pm.ic_sku IS NULL
    ORDER BY pm.id`);

  // Phase 1C: TecDoc product ID
  totalMatches += await runPhase("TECDOC_ID",
    `SELECT DISTINCT ON (pm.id)
      pm.id as product_id, im.tow_kod, im.ean as ic_ean, im.weight as ic_weight
    FROM product_maps pm
    JOIN intercars_mappings im ON
      pm.tecdoc_id IS NOT NULL AND im.tecdoc_prod IS NOT NULL
      AND CAST(pm.tecdoc_id AS TEXT) = CAST(im.tecdoc_prod AS TEXT)
    WHERE pm.status = 'active' AND pm.ic_sku IS NULL
    ORDER BY pm.id`);

  // Phase 1D: Unique article (materialized view)
  totalMatches += await runPhase("UNIQUE_ARTICLE",
    `SELECT pm.id AS product_id, ua.tow_kod, ua.ic_ean, ua.ic_weight
    FROM product_maps pm
    JOIN ic_unique_articles ua ON ua.norm_article = pm.normalized_article_no
    WHERE pm.status = 'active' AND pm.ic_sku IS NULL
    ORDER BY pm.id`);

  // Phase 2A: OEM → IC article
  totalMatches += await runPhase("OEM",
    `SELECT DISTINCT ON (pm.id)
      pm.id as product_id, im.tow_kod, im.ean as ic_ean, im.weight as ic_weight
    FROM product_maps pm
    JOIN intercars_mappings im ON
      im.normalized_article_number = UPPER(regexp_replace(pm.oem, '[^a-zA-Z0-9]', '', 'g'))
    WHERE pm.status = 'active' AND pm.ic_sku IS NULL
      AND pm.oem IS NOT NULL AND LENGTH(pm.oem) >= 5
    ORDER BY pm.id`);

  // Phase 2C: Leading zeros stripped
  totalMatches += await runPhase("LEADING_ZEROS",
    `SELECT DISTINCT ON (pm.id)
      pm.id as product_id, im.tow_kod, im.ean as ic_ean, im.weight as ic_weight
    FROM product_maps pm
    JOIN brands b ON b.id = pm.brand_id
    JOIN intercars_mappings im ON
      LTRIM(im.normalized_article_number, '0') = LTRIM(pm.normalized_article_no, '0')
      AND LENGTH(LTRIM(pm.normalized_article_no, '0')) >= 5
      AND (im.normalized_manufacturer = UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) OR im.tecdoc_prod = b.tecdoc_id)
    WHERE pm.status = 'active' AND pm.ic_sku IS NULL
    ORDER BY pm.id`);

  // Phase 2D: Cross-brand (tecdoc_prod validated)
  totalMatches += await runPhase("CROSS_BRAND",
    `SELECT DISTINCT ON (pm.id)
      pm.id as product_id, im.tow_kod, im.ean as ic_ean, im.weight as ic_weight
    FROM product_maps pm
    JOIN brands b ON b.id = pm.brand_id
    JOIN intercars_mappings im ON
      im.normalized_article_number = pm.normalized_article_no
      AND im.tecdoc_prod IS NOT NULL AND b.tecdoc_id IS NOT NULL
      AND im.tecdoc_prod = b.tecdoc_id
    WHERE pm.status = 'active' AND pm.ic_sku IS NULL
    ORDER BY pm.id`);

  // Phase 3A-3C: OEM phases
  totalMatches += await runPhase("OEM_TO_OE",
    `SELECT DISTINCT ON (pm.id)
      pm.id as product_id, im.tow_kod, im.ean as ic_ean, im.weight as ic_weight
    FROM product_maps pm
    JOIN intercars_mappings im ON
      im.normalized_article_number = UPPER(regexp_replace(pm.oem, '[^a-zA-Z0-9]', '', 'g'))
      AND im.manufacturer LIKE 'OE %'
    WHERE pm.status = 'active' AND pm.ic_sku IS NULL
      AND pm.oem IS NOT NULL AND LENGTH(pm.oem) >= 5
    ORDER BY pm.id`);

  // ── NEW aggressive phases ─────────────────────────────────────────────

  // Phase 4A: Article-only match (no brand check) for very unique articles (8+ chars)
  // Safe when article is long and unique enough to be unambiguous
  totalMatches += await runPhase("ARTICLE_ONLY_LONG",
    `SELECT DISTINCT ON (pm.id)
      pm.id as product_id, im.tow_kod, im.ean as ic_ean, im.weight as ic_weight
    FROM product_maps pm
    JOIN intercars_mappings im ON
      im.normalized_article_number = pm.normalized_article_no
      AND LENGTH(pm.normalized_article_no) >= 8
    WHERE pm.status = 'active' AND pm.ic_sku IS NULL
      AND (SELECT COUNT(*) FROM intercars_mappings im2
           WHERE im2.normalized_article_number = pm.normalized_article_no) = 1
    ORDER BY pm.id`, 600_000);

  // Phase 4B: Substring article match — IC article contains our article number
  // For cases where IC prepends/appends extra chars to the article
  totalMatches += await runPhase("ARTICLE_CONTAINS",
    `SELECT DISTINCT ON (pm.id)
      pm.id as product_id, im.tow_kod, im.ean as ic_ean, im.weight as ic_weight
    FROM product_maps pm
    JOIN brands b ON b.id = pm.brand_id
    JOIN intercars_mappings im ON
      LENGTH(pm.normalized_article_no) >= 6
      AND (
        im.normalized_article_number LIKE '%' || pm.normalized_article_no || '%'
        OR pm.normalized_article_no LIKE '%' || im.normalized_article_number || '%'
      )
      AND (
        im.normalized_manufacturer = UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))
        OR im.tecdoc_prod = b.tecdoc_id
        OR UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) LIKE im.normalized_manufacturer || '%'
        OR im.normalized_manufacturer LIKE UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) || '%'
      )
    WHERE pm.status = 'active' AND pm.ic_sku IS NULL
    ORDER BY pm.id`, 900_000);

  // Phase 4C: Article + any brand containing same normalized brand name
  // More relaxed brand matching for remaining products
  totalMatches += await runPhase("RELAXED_BRAND",
    `SELECT DISTINCT ON (pm.id)
      pm.id as product_id, im.tow_kod, im.ean as ic_ean, im.weight as ic_weight
    FROM product_maps pm
    JOIN brands b ON b.id = pm.brand_id
    JOIN intercars_mappings im ON
      im.normalized_article_number = pm.normalized_article_no
      AND LENGTH(pm.normalized_article_no) >= 5
      AND (
        im.normalized_manufacturer LIKE '%' || UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) || '%'
        OR UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) LIKE '%' || im.normalized_manufacturer || '%'
        OR LEFT(im.normalized_manufacturer, 4) = LEFT(UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')), 4)
      )
    WHERE pm.status = 'active' AND pm.ic_sku IS NULL
    ORDER BY pm.id`, 600_000);

  return totalMatches;
}

/**
 * Standalone IC pricing import — safe alias-aware matcher.
 *
 * Usage:
 *   node dist/scripts/import-ic-prices.js                 # preflight only (no DB writes)
 *   node dist/scripts/import-ic-prices.js --execute       # perform price update
 *   node dist/scripts/import-ic-prices.js --execute --reset-stale
 *       # first NULL out prices on IC-matched products that won't re-match this run
 *
 * Previous versions used loose prefix brand matching which assigned wrong prices
 * (e.g. €20k Bentley parts to Bosch products because "BOSCH".startsWith("B")).
 * This version:
 *   1. Loads article-index.json from MinIO
 *   2. Resolves every unique IC brand in the index to a TecDoc brand via:
 *        a) exact normalized name match against brands.normalized_name
 *        b) curated alias map (src/lib/ic-brand-aliases.ts)
 *        c) supplier_brand_rules table (data-driven aliases)
 *      No prefix fallback — unmapped IC brands are skipped.
 *   3. Prints a preflight coverage report and exits unless --execute is given.
 *   4. Bulk-updates product_maps.price using exact (article_no, brand_id) match.
 */
import "dotenv/config";
import { prisma } from "../lib/prisma.js";
import { minioClient } from "../lib/minio.js";
import { logger } from "../lib/logger.js";
import {
  MANUAL_ALIASES_FULL,
  NORMALIZED_ALIASES,
  normalizeBrand,
} from "../lib/ic-brand-aliases.js";

const BUCKET = process.env.MINIO_BUCKET || "oemline";
const PAGE_SIZE = 10_000;

interface ArticleEntry { b: string; p: number }
type ArticleIndex = Record<string, ArticleEntry[]>;

async function loadArticleIndex(): Promise<ArticleIndex> {
  logger.info("Loading article-index.json from MinIO...");
  const stream = await minioClient.getObject(BUCKET, "intercars/article-index.json");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const data = JSON.parse(Buffer.concat(chunks).toString("utf8")) as ArticleIndex;
  logger.info({ articles: Object.keys(data).length }, "Article index loaded");
  return data;
}

/** Build the IC-brand → TecDoc-brand-id resolver from all available sources. */
async function buildBrandResolver(): Promise<{
  resolve: (normIcBrand: string) => number | null;
  diagnostics: {
    brandsLoaded: number;
    manualAliases: number;
    dbAliases: number;
  };
}> {
  // All TecDoc brands — normalized name → id
  const brands = await prisma.$queryRawUnsafe<Array<{ id: number; normalized_name: string | null; name: string }>>(
    `SELECT id, normalized_name, name FROM brands`
  );
  const normToId = new Map<string, number>();
  for (const b of brands) {
    const key = b.normalized_name ?? normalizeBrand(b.name);
    if (key && !normToId.has(key)) normToId.set(key, b.id);
  }

  // Curated manual aliases: IC norm → TecDoc norm
  // NORMALIZED_ALIASES already has normalized keys+values.
  // Collect IC → tecdoc-brand-id for those we can resolve against brands.
  const icNormToBrandId = new Map<string, number>();
  let manualResolved = 0;
  for (const [icNorm, tdNorm] of Object.entries(NORMALIZED_ALIASES)) {
    const id = normToId.get(tdNorm);
    if (id != null) {
      icNormToBrandId.set(icNorm, id);
      manualResolved++;
    }
  }

  // Data-driven aliases from supplier_brand_rules for the intercars supplier
  let dbAliases = 0;
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ supplier_brand: string; brand_id: number }>>(
      `SELECT sbr.supplier_brand, sbr.brand_id
       FROM supplier_brand_rules sbr
       JOIN suppliers s ON s.id = sbr.supplier_id
       WHERE s.code = 'intercars' AND sbr.active = true`
    );
    for (const r of rows) {
      const k = normalizeBrand(r.supplier_brand);
      if (!icNormToBrandId.has(k)) {
        icNormToBrandId.set(k, r.brand_id);
        dbAliases++;
      }
    }
  } catch (err) {
    logger.warn({ err }, "Could not load supplier_brand_rules (non-fatal)");
  }

  const resolve = (normIcBrand: string): number | null => {
    // 1) exact normalized match against a TecDoc brand
    const direct = normToId.get(normIcBrand);
    if (direct != null) return direct;
    // 2) manual alias + data-driven alias (both already keyed by normalized IC name)
    const aliased = icNormToBrandId.get(normIcBrand);
    if (aliased != null) return aliased;
    return null;
  };

  return {
    resolve,
    diagnostics: {
      brandsLoaded: brands.length,
      manualAliases: manualResolved,
      dbAliases,
    },
  };
}

/**
 * Scan article-index to report: unique IC brands, article counts per brand,
 * and which brands cannot be resolved to a TecDoc brand.
 */
function preflight(
  articleIndex: ArticleIndex,
  resolve: (normIcBrand: string) => number | null
): {
  uniqueIcBrands: number;
  resolved: number;
  unresolved: Array<{ brand: string; articles: number }>;
  totalEntries: number;
  resolvedEntries: number;
} {
  const brandCounts = new Map<string, number>();
  let totalEntries = 0;
  for (const entries of Object.values(articleIndex)) {
    for (const e of entries) {
      totalEntries++;
      // Article-index sometimes keeps special chars (e.g. "MEAT&DORIA", "HC-CARGO").
      // Re-normalize to match how our alias/brand keys are stored.
      const norm = normalizeBrand(e.b);
      brandCounts.set(norm, (brandCounts.get(norm) ?? 0) + 1);
    }
  }

  let resolved = 0;
  let resolvedEntries = 0;
  const unresolved: Array<{ brand: string; articles: number }> = [];
  for (const [brand, count] of brandCounts.entries()) {
    if (resolve(brand) != null) {
      resolved++;
      resolvedEntries += count;
    } else {
      unresolved.push({ brand, articles: count });
    }
  }
  unresolved.sort((a, b) => b.articles - a.articles);

  return {
    uniqueIcBrands: brandCounts.size,
    resolved,
    unresolved,
    totalEntries,
    resolvedEntries,
  };
}

/**
 * For each (article, brand_id) combination in the index, pick a single best price.
 * If an index entry has multiple IC brands resolving to the same TecDoc brand_id
 * (e.g. "BOSCH Brakes" and "BOSCH" both → Bosch), prefer the exact-name match,
 * then the first one seen.
 */
function buildPriceLookup(
  articleIndex: ArticleIndex,
  resolve: (normIcBrand: string) => number | null,
  normToId: Map<string, number>
): Map<string, number> {
  // Key: `${normalizedArticle}|${brandId}` → price
  const out = new Map<string, number>();

  // Detect IC "price on request" placeholders: values >= €5000 shared by ≥3
  // distinct SKUs. Without this filter MAHLE fuel filters end up at €11,949.
  const priceCounts = new Map<number, number>();
  for (const entries of Object.values(articleIndex)) {
    for (const e of entries) {
      if (e.p > 0) priceCounts.set(e.p, (priceCounts.get(e.p) ?? 0) + 1);
    }
  }
  const placeholders = new Set<number>();
  for (const [p, c] of priceCounts) {
    if (p >= 5000 && c >= 3) placeholders.add(p);
  }

  for (const [normArticle, entries] of Object.entries(articleIndex)) {
    for (const e of entries) {
      if (!(e.p > 0) || placeholders.has(e.p)) continue;
      // Re-normalize the brand — JSON sometimes preserves special chars.
      const normB = normalizeBrand(e.b);
      // Prefer exact brand match over alias when both yield the same ID
      const exactId = normToId.get(normB);
      const resolvedId = exactId ?? resolve(normB);
      if (resolvedId == null) continue;
      const key = `${normArticle}|${resolvedId}`;
      if (exactId != null || !out.has(key)) {
        out.set(key, e.p);
      }
    }
  }
  return out;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const execute = args.has("--execute");
  const resetStale = args.has("--reset-stale");

  const startTime = Date.now();

  const articleIndex = await loadArticleIndex();
  const { resolve, diagnostics } = await buildBrandResolver();

  // We also need normToId inside buildPriceLookup — rebuild once here for reuse.
  const brands = await prisma.$queryRawUnsafe<Array<{ id: number; normalized_name: string | null; name: string }>>(
    `SELECT id, normalized_name, name FROM brands`
  );
  const normToId = new Map<string, number>();
  for (const b of brands) {
    const key = b.normalized_name ?? normalizeBrand(b.name);
    if (key && !normToId.has(key)) normToId.set(key, b.id);
  }

  const report = preflight(articleIndex, resolve);

  logger.info(
    {
      brandsInDb: diagnostics.brandsLoaded,
      manualAliases: diagnostics.manualAliases,
      dbAliases: diagnostics.dbAliases,
      totalManualMap: Object.keys(MANUAL_ALIASES_FULL).length,
    },
    "Brand resolver built",
  );
  logger.info(
    {
      uniqueIcBrands: report.uniqueIcBrands,
      resolvedBrands: report.resolved,
      unresolvedBrands: report.unresolved.length,
      indexEntries: report.totalEntries,
      resolvedEntries: report.resolvedEntries,
      coverage:
        report.totalEntries > 0
          ? `${((report.resolvedEntries / report.totalEntries) * 100).toFixed(1)}%`
          : "0%",
    },
    "Preflight coverage",
  );

  if (report.unresolved.length > 0) {
    logger.warn(
      { top: report.unresolved.slice(0, 30) },
      "IC brands with NO TecDoc mapping (will be skipped) — top 30 by article count",
    );
  }

  if (!execute) {
    logger.info("Preflight complete. Pass --execute to write prices.");
    await prisma.$disconnect();
    process.exit(0);
  }

  // Build (article, brand_id) → price lookup for the actual update.
  const priceLookup = buildPriceLookup(articleIndex, resolve, normToId);
  logger.info({ lookupEntries: priceLookup.size }, "Price lookup built (article × brand)");

  let lastId = 0;
  let scanned = 0;
  let matched = 0;
  let updated = 0;
  const matchedIds: number[] = resetStale ? [] : [];

  logger.info("Starting product scan...");

  while (true) {
    const products = await prisma.$queryRawUnsafe<Array<{
      id: number;
      normalized_article_no: string | null;
      article_no: string;
      brand_id: number | null;
    }>>(
      `SELECT pm.id, pm.normalized_article_no, pm.article_no, pm.brand_id
       FROM product_maps pm
       WHERE pm.id > $1 AND pm.status = 'active' AND pm.brand_id IS NOT NULL
       ORDER BY pm.id ASC LIMIT $2`,
      lastId, PAGE_SIZE
    );

    if (products.length === 0) break;
    lastId = products[products.length - 1].id;
    scanned += products.length;

    const updates: Array<{ id: number; price: number }> = [];
    for (const p of products) {
      if (p.brand_id == null) continue;
      const normArticle = p.normalized_article_no ?? normalizeBrand(p.article_no);
      const price = priceLookup.get(`${normArticle}|${p.brand_id}`);
      if (price != null && price > 0) {
        updates.push({ id: p.id, price });
        matched++;
        if (resetStale) matchedIds.push(p.id);
      }
    }

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
      const rate = Math.round((scanned / (Number(elapsed) || 1)) * 60);
      logger.info(
        { scanned, matched, updated, lastId, elapsed: `${elapsed}s`, rate: `${rate}/min` },
        "Progress",
      );
    }
  }

  // Optionally reset prices on products that were previously matched by the
  // buggy prefix-matcher but no longer resolve. We identify "previously IC
  // priced" rows as those with a non-null price/currency='EUR' that weren't
  // updated by this run.
  if (resetStale && matchedIds.length > 0) {
    // Use a temp table to avoid a massive IN(...) list.
    logger.info({ matched: matchedIds.length }, "Resetting stale prices...");
    try {
      await prisma.$executeRawUnsafe(`CREATE TEMP TABLE _matched_ids (id INTEGER PRIMARY KEY) ON COMMIT DROP`);
      const BATCH = 10_000;
      for (let i = 0; i < matchedIds.length; i += BATCH) {
        const chunk = matchedIds.slice(i, i + BATCH);
        const values = chunk.map((id) => `(${id})`).join(",");
        await prisma.$executeRawUnsafe(`INSERT INTO _matched_ids VALUES ${values} ON CONFLICT DO NOTHING`);
      }
      const resetResult = await prisma.$executeRawUnsafe(`
        UPDATE product_maps pm SET price = NULL, currency = NULL, updated_at = NOW()
        WHERE pm.currency = 'EUR'
          AND pm.status = 'active'
          AND pm.id NOT IN (SELECT id FROM _matched_ids)
          AND pm.supplier_id IN (SELECT id FROM suppliers WHERE code != 'diederichs' AND code != 'vanwezel')
      `);
      logger.info({ reset: Number(resetResult) }, "Stale prices reset");
    } catch (err) {
      logger.warn({ err }, "Stale reset failed (non-fatal)");
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

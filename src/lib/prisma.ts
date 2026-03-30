import { PrismaClient } from "@prisma/client";
import { config } from "../config.js";
import { logger } from "./logger.js";

const url = new URL(config.DATABASE_URL);
url.searchParams.set("connection_limit", "100");
url.searchParams.set("pool_timeout", "15");

export const prisma = new PrismaClient({
  datasourceUrl: url.toString(),
  log: config.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});

export async function validateConnection(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info("Database connection validated");
  } catch (err) {
    logger.error({ err }, "Database connection failed");
    throw err;
  }
}

/**
 * Ensure stored generated columns, indexes, and materialized views for fast IC matching.
 *
 * Strategy:
 * 1. GENERATED ALWAYS AS STORED columns on both tables — zero runtime regexp cost.
 * 2. Plain B-tree indexes on stored columns — much smaller/faster than functional indexes.
 * 3. Partial index on product_maps (normalized_article_no) WHERE ic_sku IS NULL — skips
 *    already-matched rows entirely during the join.
 * 4. Materialized view ic_unique_articles — pre-aggregates the Phase 1D GROUP BY/HAVING
 *    once; subsequent queries are a pure index lookup instead of a 565K-row hash agg.
 *
 * All operations use IF NOT EXISTS / CONCURRENTLY so they are safe on every startup.
 */
export async function ensureNormalizedIndexes(): Promise<void> {
  // ── Stored generated columns ──────────────────────────────────────────────────
  const generatedColumns: Array<[string, string]> = [
    [
      "intercars_mappings",
      `ALTER TABLE intercars_mappings
         ADD COLUMN IF NOT EXISTS normalized_article_number TEXT
         GENERATED ALWAYS AS (UPPER(regexp_replace(article_number, '[^a-zA-Z0-9]', '', 'g'))) STORED`,
    ],
    [
      "intercars_mappings (normalized_manufacturer)",
      `ALTER TABLE intercars_mappings
         ADD COLUMN IF NOT EXISTS normalized_manufacturer TEXT
         GENERATED ALWAYS AS (UPPER(regexp_replace(manufacturer, '[^a-zA-Z0-9]', '', 'g'))) STORED`,
    ],
    [
      "product_maps",
      `ALTER TABLE product_maps
         ADD COLUMN IF NOT EXISTS normalized_article_no TEXT
         GENERATED ALWAYS AS (UPPER(regexp_replace(article_no, '[^a-zA-Z0-9]', '', 'g'))) STORED`,
    ],
    [
      "brands (normalized_name)",
      `ALTER TABLE brands
         ADD COLUMN IF NOT EXISTS normalized_name TEXT
         GENERATED ALWAYS AS (UPPER(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g'))) STORED`,
    ],
  ];

  for (const [table, sql] of generatedColumns) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (err) {
      logger.warn({ err, table }, "Generated column setup (non-critical — may already exist)");
    }
  }

  // ── Indexes ───────────────────────────────────────────────────────────────────
  const indexes = [
    // IC mappings — stored columns for fast joins
    `CREATE INDEX IF NOT EXISTS idx_im_norm_article_stored ON intercars_mappings (normalized_article_number)`,
    `CREATE INDEX IF NOT EXISTS idx_im_norm_manufacturer_stored ON intercars_mappings (normalized_manufacturer)`,
    `CREATE INDEX IF NOT EXISTS idx_im_norm_article_mfr ON intercars_mappings (normalized_article_number, normalized_manufacturer)`,
    // product_maps — stored article column, full + partial (unmatched only)
    `CREATE INDEX IF NOT EXISTS idx_pm_norm_article_stored ON product_maps (normalized_article_no)`,
    `CREATE INDEX IF NOT EXISTS idx_pm_norm_article_unmatched ON product_maps (normalized_article_no) WHERE ic_sku IS NULL AND status = 'active'`,
    // product_maps — other normalized lookups
    `CREATE INDEX IF NOT EXISTS idx_pm_oem_norm ON product_maps (UPPER(regexp_replace(oem, '[^a-zA-Z0-9]', '', 'g'))) WHERE oem IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_pm_ean_norm ON product_maps (regexp_replace(ean, '[^0-9]', '', 'g')) WHERE ean IS NOT NULL`,
    // brands — stored normalized name for fast IC matching joins
    `CREATE INDEX IF NOT EXISTS idx_brands_norm_name_stored ON brands (normalized_name)`,
    // IC mappings — tecdoc_prod + article for Phase DIRECT (numeric brand ID match)
    `CREATE INDEX IF NOT EXISTS idx_im_tecdoc_prod_article ON intercars_mappings (tecdoc_prod, normalized_article_number) WHERE tecdoc_prod IS NOT NULL`,
    // brands — tecdoc_id for Phase DIRECT join
    `CREATE INDEX IF NOT EXISTS idx_brands_tecdoc_id ON brands (tecdoc_id) WHERE tecdoc_id IS NOT NULL`,
    // Phase 2A: OEM → IC article matching
    `CREATE INDEX IF NOT EXISTS idx_pm_oem_norm_unmatched ON product_maps (UPPER(regexp_replace(oem, '[^a-zA-Z0-9]', '', 'g'))) WHERE oem IS NOT NULL AND ic_sku IS NULL AND status = 'active'`,
    // Phase 2C: leading-zero-stripped article matching
    `CREATE INDEX IF NOT EXISTS idx_im_norm_article_ltrim ON intercars_mappings (LTRIM(normalized_article_number, '0'))`,
    `CREATE INDEX IF NOT EXISTS idx_pm_norm_article_ltrim ON product_maps (LTRIM(normalized_article_no, '0')) WHERE ic_sku IS NULL AND status = 'active'`,
    // Legacy functional indexes kept as fallback while generated columns backfill
    `CREATE INDEX IF NOT EXISTS idx_im_article_norm ON intercars_mappings (UPPER(regexp_replace(article_number, '[^a-zA-Z0-9]', '', 'g')))`,
    `CREATE INDEX IF NOT EXISTS idx_pm_article_no_norm ON product_maps (UPPER(regexp_replace(article_no, '[^a-zA-Z0-9]', '', 'g')))`,
    // Phase 3A/3B: IC OE brand articles — index for manufacturer LIKE 'OE %' + article
    `CREATE INDEX IF NOT EXISTS idx_im_oe_brands ON intercars_mappings (normalized_article_number) WHERE manufacturer LIKE 'OE %'`,
    // Pricing/stock worker: cursor + staleness queries on 1M+ rows
    `CREATE INDEX IF NOT EXISTS idx_pm_active_ic_sku ON product_maps (id) WHERE ic_sku IS NOT NULL AND status = 'active'`,
    `CREATE INDEX IF NOT EXISTS idx_pm_stale_pricing ON product_maps (id, updated_at) WHERE ic_sku IS NOT NULL AND status = 'active'`,
  ];

  for (const sql of indexes) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (err) {
      logger.warn({ err, sql: sql.slice(0, 80) }, "Failed to create index (non-critical)");
    }
  }

  // ── Materialized view: ic_unique_articles ─────────────────────────────────────
  // Pre-aggregates the Phase 1D GROUP BY/HAVING COUNT(*) = 1 query so it runs
  // once at refresh time instead of scanning 565K rows on every ic-match job.
  // REFRESH MATERIALIZED VIEW CONCURRENTLY keeps it readable during refresh.
  try {
    await prisma.$executeRawUnsafe(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS ic_unique_articles AS
      SELECT
        normalized_article_number AS norm_article,
        MIN(tow_kod)  AS tow_kod,
        MIN(ean)      AS ic_ean,
        MIN(weight)   AS ic_weight
      FROM intercars_mappings
      GROUP BY normalized_article_number
      HAVING COUNT(*) = 1
    `);
    // Unique index required for CONCURRENTLY refresh
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_ic_unique_articles_norm ON ic_unique_articles (norm_article)`
    );
  } catch (err) {
    logger.warn({ err }, "ic_unique_articles materialized view setup (non-critical)");
  }

  logger.info("Normalized matching indexes and materialized view ensured");
}

/**
 * Refresh the ic_unique_articles materialized view.
 * Call this at the start of every ic-match run so Phase 1D sees current data.
 * CONCURRENTLY means the view stays readable while refreshing.
 */
export async function refreshIcUniqueArticles(): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `REFRESH MATERIALIZED VIEW CONCURRENTLY ic_unique_articles`
    );
    logger.info("ic_unique_articles materialized view refreshed");
  } catch (err) {
    logger.warn({ err }, "Failed to refresh ic_unique_articles (non-critical)");
  }
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}

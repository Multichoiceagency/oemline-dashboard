import { PrismaClient } from "@prisma/client";
import { config } from "../config.js";
import { logger } from "./logger.js";

const url = new URL(config.DATABASE_URL);
// Cumulative cap: API + 3 workers + scheduler share a Postgres default of 100
// max_connections. 100 per process = 500 attempts = "too many clients already"
// storm. Cap each process at 15 so cumulative stays under the server limit.
url.searchParams.set("connection_limit", "15");
url.searchParams.set("pool_timeout", "15");
// Per-session statement timeout: a runaway query (huge groupBy, missing
// index) otherwise holds a connection indefinitely and cascades into "too
// many clients already" for everyone else. 45s cap protects the pool
// without killing legitimate slow admin operations (which set their own
// SET LOCAL statement_timeout when needed).
url.searchParams.set("options", "-c statement_timeout=45000");

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

  // ── Plain additive columns (idempotent) ────────────────────────────────────
  // article_criteria: TecDoc spec sheet ({criteriaId, criteriaDescription, formattedValue, rawValue}[])
  // Stored as JSONB so the storefront can build filter sidebars (e.g. SAE
  // viscositeit voor olie) without a separate TecDoc call per product.
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE product_maps ADD COLUMN IF NOT EXISTS article_criteria JSONB DEFAULT '[]'::jsonb`,
    );
    // GIN index so category pages can filter "article_criteria @> '[{criteriaId: 2950, formattedValue: \"5W-30\"}]'::jsonb" fast.
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS idx_pm_article_criteria_gin ON product_maps USING GIN (article_criteria jsonb_path_ops)`,
    );
  } catch (err) {
    logger.warn({ err }, "article_criteria column/index setup (non-critical — may already exist)");
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
  //
  // v2: includes normalized_manufacturer so Phase 1D can do a strict brand
  // check and stop contaminating rows whose articles collide numerically
  // (MAPCO 29815/5 vs C.E.I. 298.155 both → "298155").
  try {
    // Migration: if the view exists but lacks the norm_manufacturer column,
    // drop + recreate. Otherwise CREATE IF NOT EXISTS is a no-op.
    const hasColumn = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'ic_unique_articles'
           AND column_name = 'norm_manufacturer'
       ) AS exists`
    );
    if (!hasColumn[0]?.exists) {
      logger.info("ic_unique_articles: dropping v1 (no norm_manufacturer) before recreating with brand column");
      await prisma.$executeRawUnsafe(`DROP MATERIALIZED VIEW IF EXISTS ic_unique_articles CASCADE`);
    }

    await prisma.$executeRawUnsafe(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS ic_unique_articles AS
      SELECT
        normalized_article_number AS norm_article,
        MIN(tow_kod)                  AS tow_kod,
        MIN(ean)                      AS ic_ean,
        MIN(weight)                   AS ic_weight,
        MIN(manufacturer)             AS manufacturer,
        MIN(normalized_manufacturer)  AS norm_manufacturer
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

/**
 * Ensure the `tasks` table exists. Fallback for when `prisma db push` in the
 * Docker entrypoint times out before the schema is synced — the sidebar polls
 * /api/tasks/stats every 15s and a missing table creates a 500-storm.
 *
 * Safe to run on every startup (IF NOT EXISTS + idempotent indexes).
 */
export async function ensureTasksTable(): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        type TEXT NOT NULL DEFAULT 'TASK',
        status TEXT NOT NULL DEFAULT 'OPEN',
        priority TEXT NOT NULL DEFAULT 'MEDIUM',
        assignee TEXT,
        reporter TEXT,
        labels TEXT[] DEFAULT ARRAY[]::TEXT[],
        related_url TEXT,
        created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(status)`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS tasks_type_idx ON tasks(type)`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON tasks(assignee)`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS tasks_created_at_idx ON tasks(created_at)`);
    logger.info("tasks table ensured");
  } catch (err) {
    logger.warn({ err }, "ensureTasksTable failed (non-critical — prisma db push may have handled it)");
  }
}

/**
 * Ensure the `orders` table exists. Same fallback pattern as ensureTasksTable:
 * the Docker entrypoint's 30s prisma db push can time out before schema
 * sync completes, leaving new tables missing on every fresh container.
 */
export async function ensureOrdersTable(): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        cart_key TEXT,
        wc_order_id INTEGER,
        wc_order_url TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        total DOUBLE PRECISION NOT NULL,
        currency TEXT NOT NULL DEFAULT 'EUR',
        customer_email TEXT NOT NULL,
        customer_name TEXT NOT NULL,
        customer_phone TEXT,
        shipping JSONB NOT NULL,
        items JSONB NOT NULL,
        note TEXT,
        error_message TEXT,
        created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status)`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS orders_customer_email_idx ON orders(customer_email)`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS orders_wc_order_id_idx ON orders(wc_order_id)`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders(created_at)`);
    logger.info("orders table ensured");
  } catch (err) {
    logger.warn({ err }, "ensureOrdersTable failed (non-critical)");
  }
}

/**
 * Ensure the additive `categories.position` and `categories.description`
 * columns exist. Same fallback as ensureTasksTable / ensureOrdersTable for
 * when the boot-time `prisma db push` is throttled by an unrelated
 * materialized-view dependency error and skips the additive changes.
 */
export async function ensureCategoryExtraColumns(): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE categories ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0`,
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE categories ADD COLUMN IF NOT EXISTS description TEXT`,
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE categories ADD COLUMN IF NOT EXISTS seo_description TEXT`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS categories_parent_position_idx ON categories(parent_id, position)`,
    );
    logger.info("categories.position + .description + .seo_description ensured");
  } catch (err) {
    logger.warn({ err }, "ensureCategoryExtraColumns failed (non-critical)");
  }
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}

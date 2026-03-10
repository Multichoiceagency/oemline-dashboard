import { PrismaClient } from "@prisma/client";
import { config } from "../config.js";
import { logger } from "./logger.js";

const url = new URL(config.DATABASE_URL);
url.searchParams.set("connection_limit", "20");
url.searchParams.set("pool_timeout", "10");

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
 * Create functional indexes for normalized matching queries.
 * Uses CREATE INDEX IF NOT EXISTS so safe to run on every startup.
 *
 * Also ensures the intercars_mappings.normalized_article_number stored generated
 * column exists (PostgreSQL 12+ GENERATED ALWAYS AS STORED). This eliminates
 * UPPER(regexp_replace(...)) computation at query time across all IC match phases.
 */
export async function ensureNormalizedIndexes(): Promise<void> {
  // Step 1: Add the stored generated column for IC article normalization.
  // GENERATED ALWAYS AS STORED: Postgres computes + persists value on write.
  // ADD COLUMN IF NOT EXISTS: no-op if already present.
  // Initial creation backfills all existing rows automatically.
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE intercars_mappings
         ADD COLUMN IF NOT EXISTS normalized_article_number TEXT
         GENERATED ALWAYS AS (UPPER(regexp_replace(article_number, '[^a-zA-Z0-9]', '', 'g'))) STORED`
    );
  } catch (err) {
    // Column may already exist with a different definition — log and continue
    logger.warn({ err }, "intercars_mappings normalized_article_number column setup (non-critical)");
  }

  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_pm_article_no_norm ON product_maps (UPPER(regexp_replace(article_no, '[^a-zA-Z0-9]', '', 'g')))`,
    `CREATE INDEX IF NOT EXISTS idx_pm_oem_norm ON product_maps (UPPER(regexp_replace(oem, '[^a-zA-Z0-9]', '', 'g'))) WHERE oem IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_pm_ean_norm ON product_maps (regexp_replace(ean, '[^0-9]', '', 'g')) WHERE ean IS NOT NULL`,
    // Plain B-tree index on the stored generated column — much cheaper than functional index
    `CREATE INDEX IF NOT EXISTS idx_im_norm_article_stored ON intercars_mappings (normalized_article_number)`,
    // Keep functional indexes as fallback during column creation/backfill
    `CREATE INDEX IF NOT EXISTS idx_im_article_norm ON intercars_mappings (UPPER(regexp_replace(article_number, '[^a-zA-Z0-9]', '', 'g')))`,
    `CREATE INDEX IF NOT EXISTS idx_im_manufacturer_norm ON intercars_mappings (UPPER(regexp_replace(manufacturer, '[^a-zA-Z0-9]', '', 'g')))`,
    `CREATE INDEX IF NOT EXISTS idx_brands_name_norm ON brands (UPPER(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g')))`,
  ];

  for (const sql of indexes) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (err) {
      logger.warn({ err, sql: sql.slice(0, 80) }, "Failed to create normalized index (non-critical)");
    }
  }
  logger.info("Normalized matching indexes ensured");
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}

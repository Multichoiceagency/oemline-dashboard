import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { NORMALIZED_ALIASES, normalizeBrand } from "../lib/ic-brand-aliases.js";

const setPriceSchema = z.object({
  price: z.number().min(0).max(1_000_000).nullable(),
});

const stripSentinelsSchema = z.object({
  confirm: z.literal("YES_STRIP_SENTINELS"),
});

const cleanFieldsSchema = z.object({
  price: z.number().min(0).max(1_000_000).nullable().optional(),
  ean: z.string().max(50).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  icSku: z.string().max(100).nullable().optional(),
});

const auditContaminationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

const dedupeSchema = z.object({
  confirm: z.literal("YES_DEDUPE_INTERCARS"),
});

const cleanupContaminationSchema = z.object({
  confirm: z.literal("YES_CLEAN_CONTAMINATION"),
  dryRun: z.boolean().default(true),
});

/**
 * Targeted price admin endpoints.
 *
 * Background: an earlier fix assumed all high prices were cents-mistakes and
 * divided everything ≥ €1000 by 100. That broke legitimately expensive items
 * (ZF automatic gearboxes, Bosch injection pumps etc.). Those real prices
 * match what InterCars lists on pl.e-cat.intercars.eu. We back out the blanket
 * normalization and expose two surgical tools:
 *
 *   POST /admin/pricing/set-price/:productId { price: number|null }
 *     — Directly set / clear a single product's wholesale price. Used to
 *       restore values broken by the earlier /100 experiment.
 *
 *   POST /admin/pricing/strip-sentinels { confirm: "YES_STRIP_SENTINELS" }
 *     — NULL out prices that match IC "Prijs op aanvraag" sentinels
 *       (>= €5000 and ending in .99) across the whole table. This is the
 *       only bulk cleanup still needed — real high-priced items stay.
 */
export async function pricingAdminRoutes(app: FastifyInstance) {
  /**
   * Alias-aware cleanup of IC cross-contamination.
   *
   * Background: 124K rows have ic_sku pointing to an IC row whose manufacturer
   * doesn't match the product's brand. Most of those are legitimate aliases
   * (MAHLE↔KNECHT, Schaeffler-LuK↔LUK, LEMFÖRDER↔LEMFOERDER) routed via
   * supplier_brand_rules + NORMALIZED_ALIASES. Only ~25K are real
   * contamination from the old Phase 1D (MAPCO↔FEBI etc).
   *
   * Strategy:
   * 1. Pre-compute legit alias set: NORMALIZED_ALIASES + supplier_brand_rules
   *    rows for the InterCars supplier. Key: `${normTecDocName}|${normIcManu}`.
   * 2. Scan contaminated rows, bucket by brand-pair.
   * 3. If pair is in legit set → skip (keep ic_sku + price).
   * 4. If pair is not in legit set → NULL out ic_sku, price, ean.
   *    Description left as-is; TecDoc description will repopulate on next
   *    sync for that brand if missing.
   * 5. Idempotent: running twice is safe because contamination only touches
   *    rows we've flagged.
   *
   * Supports dryRun (default) so callers see the scale before writing.
   */
  app.post("/admin/products/cleanup-contamination", async (request) => {
    const { dryRun } = cleanupContaminationSchema.parse(request.body ?? {});
    const start = Date.now();

    // 1. Build legit-alias set
    const legitPairs = new Set<string>();

    // 1a. NORMALIZED_ALIASES is { normIc: normTecDoc }.
    for (const [icNorm, tdNorm] of Object.entries(NORMALIZED_ALIASES)) {
      legitPairs.add(`${tdNorm}|${icNorm}`);
    }

    // 1b. supplier_brand_rules for InterCars supplier
    try {
      const rules = await prisma.$queryRawUnsafe<Array<{
        brand_name: string; supplier_brand: string;
      }>>(
        `SELECT b.name AS brand_name, sbr.supplier_brand
           FROM supplier_brand_rules sbr
           JOIN suppliers s ON s.id = sbr.supplier_id
           JOIN brands b ON b.id = sbr.brand_id
          WHERE s.code = 'intercars' AND sbr.active = true`
      );
      for (const r of rules) {
        legitPairs.add(`${normalizeBrand(r.brand_name)}|${normalizeBrand(r.supplier_brand)}`);
      }
    } catch (err) {
      logger.warn({ err }, "Could not read supplier_brand_rules — alias resolution is NORMALIZED_ALIASES-only");
    }

    // 2. Count contaminated rows grouped by brand-pair so we can bucket alias/dirty.
    // Disable parallel workers for this groupBy — parallel hash aggregation
    // allocates shared memory segments that fill /tmp under concurrent load.
    // Serial execution is slower but doesn't hit the shm bottleneck.
    await prisma.$executeRawUnsafe(`SET LOCAL max_parallel_workers_per_gather = 0`);
    await prisma.$executeRawUnsafe(`SET LOCAL work_mem = '256MB'`);

    const pairs = await prisma.$queryRawUnsafe<Array<{
      our_brand: string; ic_brand: string; row_count: bigint;
    }>>(
      `SELECT b.name AS our_brand,
              im.manufacturer AS ic_brand,
              COUNT(*)::bigint AS row_count
         FROM product_maps pm
         JOIN brands b ON b.id = pm.brand_id
         JOIN intercars_mappings im ON im.tow_kod = pm.ic_sku
        WHERE pm.ic_sku IS NOT NULL
          AND pm.status = 'active'
          AND UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))
                <> UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g'))
          AND UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))
                NOT LIKE UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) || '%'
          AND UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g'))
                NOT LIKE UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) || '%'
        GROUP BY b.name, im.manufacturer`
    );

    const dirtyPairs: Array<{ ourBrand: string; icBrand: string; rowCount: number }> = [];
    const legitKept: Array<{ ourBrand: string; icBrand: string; rowCount: number }> = [];
    let dirtyTotal = 0;
    let legitTotal = 0;

    for (const p of pairs) {
      const key = `${normalizeBrand(p.our_brand)}|${normalizeBrand(p.ic_brand)}`;
      const count = Number(p.row_count);
      if (legitPairs.has(key)) {
        legitKept.push({ ourBrand: p.our_brand, icBrand: p.ic_brand, rowCount: count });
        legitTotal += count;
      } else {
        dirtyPairs.push({ ourBrand: p.our_brand, icBrand: p.ic_brand, rowCount: count });
        dirtyTotal += count;
      }
    }

    dirtyPairs.sort((a, b) => b.rowCount - a.rowCount);
    legitKept.sort((a, b) => b.rowCount - a.rowCount);

    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        durationMs: Date.now() - start,
        summary: {
          dirtyRowsToClean: dirtyTotal,
          legitRowsKept: legitTotal,
          dirtyPairs: dirtyPairs.length,
          legitPairs: legitKept.length,
        },
        topDirtyPairs: dirtyPairs.slice(0, 15),
        topLegitKept: legitKept.slice(0, 10),
        note: "Re-run with dryRun=false to actually clean.",
      };
    }

    // 3. Real cleanup — NULL out ic_sku/price/ean for each dirty pair
    await prisma.$executeRawUnsafe(`SET LOCAL statement_timeout = '600s'`);
    let affected = 0;
    for (const p of dirtyPairs) {
      const res = await prisma.$executeRawUnsafe(
        `UPDATE product_maps pm
            SET ic_sku = NULL, price = NULL, ean = NULL, updated_at = NOW()
           FROM brands b, intercars_mappings im
          WHERE pm.brand_id = b.id
            AND im.tow_kod = pm.ic_sku
            AND pm.status = 'active'
            AND UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) = UPPER(regexp_replace($1, '[^a-zA-Z0-9]', '', 'g'))
            AND UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) = UPPER(regexp_replace($2, '[^a-zA-Z0-9]', '', 'g'))`,
        p.ourBrand,
        p.icBrand
      );
      affected += Number(res);
    }

    logger.warn(
      { affected, durationMs: Date.now() - start, dirtyPairCount: dirtyPairs.length },
      "IC cross-contamination cleanup applied"
    );

    return {
      ok: true,
      dryRun: false,
      durationMs: Date.now() - start,
      affected,
      dirtyPairCount: dirtyPairs.length,
      legitRowsKept: legitTotal,
      note: "ic_sku, price, ean reset on dirty rows. Next ic-match run (with brand-guarded Phase 1D) will re-match correctly.",
    };
  });

  /**
   * One-off dedupe of intercars_mappings.
   *
   * The mat-view has 2.5M rows while the CSV source is ~565K — ~4× duplicates
   * from repeated imports. Deduping halves every Phase 1D query, every
   * /finalized/stats groupBy, every audit.
   *
   * Strategy: keep the earliest id per (tow_kod, article_number, manufacturer)
   * triple; delete the rest. Safe because tow_kod uniquely identifies an IC
   * article and we preserve the representative row.
   */
  app.post("/admin/migrations/dedupe-intercars-mappings", async (request) => {
    dedupeSchema.parse(request.body ?? {});
    const start = Date.now();

    await prisma.$executeRawUnsafe(`SET LOCAL statement_timeout = '600s'`);

    const before = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
      `SELECT COUNT(*)::bigint AS c FROM intercars_mappings`
    );

    const deleted = await prisma.$executeRawUnsafe(`
      DELETE FROM intercars_mappings im
      USING (
        SELECT ctid
          FROM (
            SELECT ctid,
                   ROW_NUMBER() OVER (
                     PARTITION BY tow_kod, article_number, manufacturer
                     ORDER BY ctid
                   ) AS rn
              FROM intercars_mappings
          ) t
          WHERE t.rn > 1
      ) dup
      WHERE im.ctid = dup.ctid
    `);

    const after = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
      `SELECT COUNT(*)::bigint AS c FROM intercars_mappings`
    );

    logger.warn(
      { before: Number(before[0]?.c), after: Number(after[0]?.c), deleted, durationMs: Date.now() - start },
      "intercars_mappings deduped"
    );

    return {
      ok: true,
      durationMs: Date.now() - start,
      before: Number(before[0]?.c ?? 0),
      after: Number(after[0]?.c ?? 0),
      deleted: Number(deleted),
      note: "Run POST /admin/migrations/rebuild-ic-unique-articles next to refresh the Phase 1D mat-view with the clean data.",
    };
  });

  /**
   * On-demand rebuild of ic_unique_articles (Phase 1D source of truth).
   *
   * Targeted: only CREATE MATERIALIZED VIEW + index, no ensureNormalizedIndexes.
   * Calling the full bootstrap was the cause of earlier CREATE failures — too
   * many parallel DDLs on a busy Postgres. Also extends the session timeout
   * because the GROUP BY over 565K IC rows runs 30-60s under load.
   */
  app.post("/admin/migrations/rebuild-ic-unique-articles", async () => {
    const start = Date.now();

    // Per-session timeout: default 30s isn't enough for the CREATE's GROUP BY
    // on 565K intercars_mappings rows. Bump to 5 min for this one request.
    await prisma.$executeRawUnsafe(`SET LOCAL statement_timeout = '300s'`);

    await prisma.$executeRawUnsafe(`DROP MATERIALIZED VIEW IF EXISTS ic_unique_articles CASCADE`);

    await prisma.$executeRawUnsafe(`
      CREATE MATERIALIZED VIEW ic_unique_articles AS
      SELECT
        normalized_article_number     AS norm_article,
        MIN(tow_kod)                  AS tow_kod,
        MIN(ean)                      AS ic_ean,
        MIN(weight)                   AS ic_weight,
        MIN(manufacturer)             AS manufacturer,
        MIN(normalized_manufacturer)  AS norm_manufacturer
      FROM intercars_mappings
      GROUP BY normalized_article_number
      HAVING COUNT(*) = 1
    `);

    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX idx_ic_unique_articles_norm ON ic_unique_articles (norm_article)`
    );

    const cols = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'ic_unique_articles'
        ORDER BY ordinal_position`
    );
    const count = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
      `SELECT COUNT(*)::bigint AS c FROM ic_unique_articles`
    );

    logger.info(
      { durationMs: Date.now() - start, rowCount: Number(count[0]?.c ?? 0) },
      "ic_unique_articles rebuilt with manufacturer column"
    );

    return {
      ok: true,
      durationMs: Date.now() - start,
      columns: cols.map((c) => c.column_name),
      rowCount: Number(count[0]?.c ?? 0),
    };
  });

  app.post("/admin/pricing/set-price/:productId", async (request, reply) => {
    const { productId } = z.object({ productId: z.coerce.number().int().positive() }).parse(request.params);
    const { price } = setPriceSchema.parse(request.body ?? {});

    const before = await prisma.productMap.findUnique({
      where: { id: productId },
      select: { id: true, sku: true, articleNo: true, price: true, currency: true },
    });
    if (!before) return reply.code(404).send({ error: "Product not found" });

    const after = await prisma.productMap.update({
      where: { id: productId },
      data: { price },
      select: { id: true, sku: true, articleNo: true, price: true, currency: true },
    });

    logger.info({ productId, before: before.price, after: price }, "Set wholesale price directly");
    return { productId, before, after, changed: before.price !== after.price };
  });

  app.post("/admin/pricing/strip-sentinels", async (request) => {
    stripSentinelsSchema.parse(request.body);

    // Count first so the response tells the caller what was touched.
    const precheck = await prisma.productMap.count({
      where: {
        price: { gte: 5000 },
      },
    });

    // Strip .99-ending sentinels at high values. Uses modulo to identify
    // exactly-.99 tails (floats are messy, so subtract floor and compare).
    const affected = await prisma.$executeRawUnsafe(
      `UPDATE product_maps
         SET price = NULL, updated_at = NOW()
       WHERE price IS NOT NULL
         AND price >= 5000
         AND ROUND((price - FLOOR(price))::numeric, 2) = 0.99`
    );

    logger.warn({ precheckHighPrice: precheck, affected }, "Stripped price-on-request sentinels");
    return {
      ok: true,
      affected,
      precheckHighPriceRows: precheck,
      note: "Only .99-ending sentinels at ≥ €5000 were cleared; real high-priced items untouched.",
    };
  });

  // Clean IC-contamination from a single product row.
  // Accepts any subset of { price, ean, description, icSku } to overwrite.
  // Pass `null` for a field to NULL it; omit to leave as-is.
  app.patch("/admin/products/:productId/fields", async (request, reply) => {
    const { productId } = z.object({ productId: z.coerce.number().int().positive() }).parse(request.params);
    const data = cleanFieldsSchema.parse(request.body ?? {});

    const before = await prisma.productMap.findUnique({
      where: { id: productId },
      select: { id: true, sku: true, articleNo: true, price: true, ean: true, description: true, icSku: true },
    });
    if (!before) return reply.code(404).send({ error: "Product not found" });

    const updateData: Record<string, unknown> = {};
    if (data.price !== undefined) updateData.price = data.price;
    if (data.ean !== undefined) updateData.ean = data.ean;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.icSku !== undefined) updateData.icSku = data.icSku;
    if (Object.keys(updateData).length === 0) {
      return { productId, before, after: before, changed: false, note: "no fields to update" };
    }

    const after = await prisma.productMap.update({
      where: { id: productId },
      data: updateData,
      select: { id: true, sku: true, articleNo: true, price: true, ean: true, description: true, icSku: true },
    });

    logger.info({ productId, fields: Object.keys(updateData) }, "Admin field update on product");
    return { productId, before, after, changed: true };
  });

  /**
   * Audit endpoint — find IC-contamination candidates without TecDoc round-trips.
   *
   * Strategy: if two or more product_maps rows share the same EAN but have
   * different brand_ids, at most one is correct. The "real" owner is the brand
   * whose name matches (prefix-normalized) the `intercars_mappings.manufacturer`
   * for that EAN. Any other row with that EAN is cross-contaminated by the
   * ic-match worker and should be scrubbed.
   *
   * Returns a ranked list of contaminated rows so we can size the cleanup
   * before running any mass UPDATE.
   */
  /**
   * Summary audit — one row per (our_brand → ic_brand) pair with count.
   * Surfaces whether the mismatch is a systemic alias (MAHLE↔KNECHT with
   * thousands of rows) or one-off contamination (MAPCO↔SONIC with a few).
   * No row-level payload — just aggregation so the caller can prioritise.
   */
  app.get("/admin/products/audit-contamination/summary", async () => {
    const pairs = await prisma.$queryRawUnsafe<Array<{
      our_brand: string;
      ic_brand: string;
      row_count: bigint;
      sample_articles: string[];
    }>>(
      `SELECT b.name AS our_brand,
              im.manufacturer AS ic_brand,
              COUNT(*)::bigint AS row_count,
              (ARRAY_AGG(pm.article_no ORDER BY pm.id))[1:3] AS sample_articles
         FROM product_maps pm
         JOIN brands b ON b.id = pm.brand_id
         JOIN intercars_mappings im ON im.tow_kod = pm.ic_sku
        WHERE pm.ic_sku IS NOT NULL
          AND pm.status = 'active'
          AND UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))
                <> UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g'))
          AND UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))
                NOT LIKE UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) || '%'
          AND UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g'))
                NOT LIKE UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) || '%'
        GROUP BY b.name, im.manufacturer
        ORDER BY COUNT(*) DESC
        LIMIT 200`
    );

    return {
      uniquePairs: pairs.length,
      pairs: pairs.map((p) => ({
        ourBrand: p.our_brand,
        icBrand: p.ic_brand,
        rowCount: Number(p.row_count),
        sampleArticles: p.sample_articles,
      })),
      note: "Legitimate group brands (MAHLE/KNECHT, CONTINENTAL/VDO, SACHS/ZF) surface as large clusters; pure contamination is the long tail of tiny counts.",
    };
  });

  app.get("/admin/products/audit-contamination", async (request) => {
    const { limit } = auditContaminationSchema.parse(request.query);

    // Direct detection: a product_maps row whose assigned ic_sku points to an
    // intercars_mappings entry whose manufacturer doesn't match the product's
    // own brand. This is the smoking gun for cross-contamination — the
    // ic-match worker assigned a TOW_KOD from brand X to a product of brand Y.
    //
    // Uses the existing index on product_maps(ic_sku) via the JOIN, so it
    // touches only the subset of rows IC has matched (typically <1M) instead
    // of GROUP BY on all 1.6M rows.
    const results = await prisma.$queryRawUnsafe<Array<{
      id: number;
      sku: string;
      article_no: string;
      brand_id: number;
      our_brand: string;
      ic_brand: string;
      ic_article: string;
      ic_sku: string;
      price: number | null;
      ean: string | null;
      description: string;
    }>>(
      `SELECT pm.id, pm.sku, pm.article_no, pm.brand_id,
              b.name AS our_brand,
              im.manufacturer AS ic_brand,
              im.article_number AS ic_article,
              pm.ic_sku, pm.price, pm.ean, pm.description
         FROM product_maps pm
         JOIN brands b ON b.id = pm.brand_id
         JOIN intercars_mappings im ON im.tow_kod = pm.ic_sku
        WHERE pm.ic_sku IS NOT NULL
          AND pm.status = 'active'
          -- Strict: normalized names must differ AND neither must be a prefix
          -- of the other (so "FEBI" + "FEBI BILSTEIN" is fine).
          AND UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))
                <> UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g'))
          AND UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))
                NOT LIKE UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) || '%'
          AND UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g'))
                NOT LIKE UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) || '%'
        ORDER BY pm.id
        LIMIT $1`,
      limit
    );

    // Also return the total count so we know the scale before running cleanup.
    const totalRow = await prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
      `SELECT COUNT(*)::bigint AS total
         FROM product_maps pm
         JOIN brands b ON b.id = pm.brand_id
         JOIN intercars_mappings im ON im.tow_kod = pm.ic_sku
        WHERE pm.ic_sku IS NOT NULL
          AND pm.status = 'active'
          AND UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))
                <> UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g'))
          AND UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))
                NOT LIKE UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) || '%'
          AND UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g'))
                NOT LIKE UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) || '%'`
    );

    return {
      totalContaminated: Number(totalRow[0]?.total ?? 0),
      shown: results.length,
      limit,
      note: "Rows where product's own brand doesn't match the IC TOW_KOD's manufacturer (even via prefix). These are ic-match mis-assignments.",
      rows: results.map((r) => ({
        ...r,
        price: r.price ? Number(r.price) : null,
      })),
    };
  });
}

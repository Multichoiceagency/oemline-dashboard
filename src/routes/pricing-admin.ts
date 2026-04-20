import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

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

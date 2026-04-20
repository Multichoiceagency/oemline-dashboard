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

    // Step 1: find EANs shared across multiple brands in product_maps.
    const conflicts = await prisma.$queryRawUnsafe<Array<{ ean: string; brand_count: bigint; ids: number[] }>>(
      `SELECT ean,
              COUNT(DISTINCT brand_id) AS brand_count,
              ARRAY_AGG(id ORDER BY id) AS ids
         FROM product_maps
        WHERE ean IS NOT NULL AND ean <> '' AND brand_id IS NOT NULL
        GROUP BY ean
       HAVING COUNT(DISTINCT brand_id) > 1
        ORDER BY COUNT(DISTINCT brand_id) DESC
        LIMIT $1`,
      limit
    );

    // Step 2: for each conflict, look up IC's manufacturer to identify the real owner.
    const results = [];
    for (const c of conflicts) {
      const icOwner = await prisma.$queryRawUnsafe<Array<{ manufacturer: string; article_number: string }>>(
        `SELECT manufacturer, article_number
           FROM intercars_mappings
          WHERE ean = $1
          LIMIT 1`,
        c.ean
      );
      const rows = await prisma.productMap.findMany({
        where: { id: { in: c.ids as unknown as number[] } },
        select: {
          id: true, sku: true, articleNo: true, price: true, description: true,
          brand: { select: { id: true, name: true, code: true } },
        },
      });
      results.push({
        ean: c.ean,
        brandCount: Number(c.brand_count),
        icOwner: icOwner[0] ?? null,
        rows,
      });
    }

    return {
      conflictsReturned: results.length,
      limit,
      note: "Conflicts ordered by brand_count DESC. icOwner.manufacturer is the IC-CSV brand; rows whose brand.name doesn't match (prefix-normalized) are contamination.",
      results,
    };
  });
}

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
}

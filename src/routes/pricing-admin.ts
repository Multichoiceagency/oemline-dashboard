import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

const normalizeSingleSchema = z.object({
  productId: z.coerce.number().int().positive(),
});

const normalizeBulkSchema = z.object({
  confirm: z.literal("YES_NORMALIZE_ALL_PRICES"),
  threshold: z.coerce.number().min(0).default(100),
});

/**
 * One-off price normalization endpoints.
 *
 * Context: supplier adapters historically stored wholesale prices in minor
 * units (cents) while the rest of the system treats them as euros, producing
 * values 100x too high across the catalogue. This route exposes two tools:
 *
 *   POST /admin/pricing/normalize-cents/:productId
 *     — Dry-fix one row. Use this to verify the approach on a single product
 *       (e.g. /finalized/8164484) before touching the whole table.
 *
 *   POST /admin/pricing/normalize-cents-bulk
 *     — Mass update. Divides `price` by 100 for every row where price is
 *       above `threshold` (default 100, catches anything likely-inflated
 *       while leaving already-sane prices alone). Requires an explicit
 *       confirm string so it can't fire by accident.
 *
 * Both operations also bust the `finalized-products` Redis cache via the
 * pricing settings touch (updates updated_at on product_maps).
 */
export async function pricingAdminRoutes(app: FastifyInstance) {
  app.post("/admin/pricing/normalize-cents/:productId", async (request, reply) => {
    const { productId } = normalizeSingleSchema.parse(request.params);

    const before = await prisma.productMap.findUnique({
      where: { id: productId },
      select: { id: true, sku: true, articleNo: true, price: true, currency: true },
    });
    if (!before) return reply.code(404).send({ error: "Product not found" });

    if (before.price == null) {
      return { productId, before, after: before, changed: false, note: "price was null, nothing to do" };
    }

    const newPrice = Math.round((before.price / 100) * 100) / 100;
    const after = await prisma.productMap.update({
      where: { id: productId },
      data: { price: newPrice },
      select: { id: true, sku: true, articleNo: true, price: true, currency: true },
    });

    logger.info({ productId, oldPrice: before.price, newPrice }, "Normalized single product price (/100)");
    return { productId, before, after, changed: before.price !== after.price };
  });

  app.post("/admin/pricing/normalize-cents-bulk", async (request) => {
    const { threshold } = normalizeBulkSchema.parse(request.body);

    const toUpdate = await prisma.productMap.count({ where: { price: { gt: threshold } } });

    const result = await prisma.$executeRawUnsafe(
      `UPDATE product_maps SET price = ROUND((price / 100.0)::numeric, 2)::double precision, updated_at = NOW() WHERE price IS NOT NULL AND price > $1`,
      threshold
    );

    logger.warn(
      { threshold, affectedCount: result, precheckCount: toUpdate },
      "Bulk normalization of wholesale prices applied (/100)"
    );

    return {
      ok: true,
      threshold,
      affected: result,
      precheckCount: toUpdate,
      note: "Run this only once. Redeploy the workers to prevent re-inflation via future syncs.",
    };
  });
}

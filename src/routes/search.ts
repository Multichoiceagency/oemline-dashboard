import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { config } from "../config.js";
import { searchProducts } from "../services/search.js";

function revalidateStorefront(productId: number | string): void {
  const url = config.STOREFRONT_URL;
  const secret = config.STOREFRONT_REVALIDATE_SECRET;
  if (!url || !secret) return;
  fetch(`${url}/api/revalidate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-webhook-secret": secret },
    body: JSON.stringify({ contentType: "dashboard_product", contentId: String(productId) }),
    signal: AbortSignal.timeout(5_000),
  }).catch((err) => {
    logger.debug({ err: err?.message, productId }, "Storefront revalidation failed (non-critical)");
  });
}

const searchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  brand: z.string().max(100).optional(),
  articleNo: z.string().max(100).optional(),
  ean: z.string().max(50).optional(),
  tecdocId: z.string().max(50).optional(),
  oem: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get("/search", async (request, reply) => {
    const parsed = searchQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "Bad Request",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { q, brand, articleNo, ean, tecdocId, oem, limit } = parsed.data;

    try {
      const result = await searchProducts({
        query: q,
        brand,
        articleNo,
        ean,
        tecdocId,
        oem,
        limit,
      });

      return reply.send(result);
    } catch (err) {
      request.log.error({ err, reqId: request.id }, "Search failed");
      return reply.code(500).send({
        error: "Search temporarily unavailable",
        query: q,
        results: [],
        matches: [],
        errors: [{ supplier: "system", message: "Internal error", code: "INTERNAL" }],
        totalResults: 0,
        cachedAt: null,
      });
    }
  });

  app.get("/unmatched", async (request, reply) => {
    const querySchema = z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      resolved: z.enum(["true", "false", "all"]).default("false"),
    });

    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Bad Request",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { page, limit, resolved } = parsed.data;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (resolved === "false") where.resolvedAt = null;
    else if (resolved === "true") where.resolvedAt = { not: null };

    const [items, total] = await Promise.all([
      prisma.unmatched.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          supplier: { select: { name: true, code: true } },
          brand: { select: { name: true, code: true } },
        },
      }),
      prisma.unmatched.count({ where }),
    ]);

    return reply.send({
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  });

  // Products without IC coupling — direct product_maps WHERE ic_sku IS NULL
  // These never appear in the unmatched table (they were never attempted).
  // Supports manual price/stock/description editing.
  app.get("/unmatched-products", async (request, reply) => {
    const querySchema = z.object({
      page:     z.coerce.number().int().min(1).default(1),
      limit:    z.coerce.number().int().min(1).max(100).default(50),
      q:        z.string().optional(),
      brandId:  z.coerce.number().int().optional(),
      withPrice: z.enum(["true", "false"]).optional(),
    });

    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Bad Request" });
    const { page, limit, q, brandId, withPrice } = parsed.data;
    const skip = (page - 1) * limit;

    let whereClause = `pm.ic_sku IS NULL AND pm.status = 'active'`;
    const params: unknown[] = [];
    let idx = 1;

    if (brandId) {
      whereClause += ` AND pm.brand_id = $${idx++}`;
      params.push(brandId);
    }
    if (withPrice === "true") {
      whereClause += ` AND pm.price IS NOT NULL`;
    } else if (withPrice === "false") {
      whereClause += ` AND pm.price IS NULL`;
    }
    if (q) {
      whereClause += ` AND (pm.article_no ILIKE $${idx} OR pm.description ILIKE $${idx} OR pm.ean ILIKE $${idx})`;
      params.push(`%${q}%`);
      idx++;
    }

    const countParams = [...params];
    const itemParams = [...params];
    itemParams.push(limit, skip);

    const [rows, countRows] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{
        id: number; sku: string; article_no: string; description: string;
        price: number | null; stock: number | null; currency: string | null;
        image_url: string | null; ean: string | null; tecdoc_id: string | null;
        brand_id: number; brand_name: string; brand_code: string;
        supplier_id: number; supplier_name: string; supplier_code: string;
        updated_at: string;
      }>>(
        `SELECT pm.id, pm.sku, pm.article_no, pm.description,
                pm.price, pm.stock, pm.currency, pm.image_url, pm.ean, pm.tecdoc_id,
                b.id AS brand_id, b.name AS brand_name, b.code AS brand_code,
                s.id AS supplier_id, s.name AS supplier_name, s.code AS supplier_code,
                pm.updated_at
         FROM product_maps pm
         JOIN brands b ON b.id = pm.brand_id
         JOIN suppliers s ON s.id = pm.supplier_id
         WHERE ${whereClause}
         ORDER BY pm.id DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        ...itemParams
      ),
      prisma.$queryRawUnsafe<[{ cnt: bigint }]>(
        `SELECT COUNT(*) AS cnt FROM product_maps pm WHERE ${whereClause}`,
        ...countParams
      ),
    ]);

    const total = Number(countRows[0]?.cnt ?? 0);

    return reply.send({
      items: rows.map(r => ({
        id: r.id,
        sku: r.sku,
        articleNo: r.article_no,
        description: r.description,
        price: r.price,
        stock: r.stock,
        currency: r.currency ?? "EUR",
        imageUrl: r.image_url,
        ean: r.ean,
        tecdocId: r.tecdoc_id,
        brand: { id: r.brand_id, name: r.brand_name, code: r.brand_code },
        supplier: { id: r.supplier_id, name: r.supplier_name, code: r.supplier_code },
        updatedAt: r.updated_at,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  });

  // Update price/stock/description manually for a non-IC-linked product
  app.patch("/unmatched-products/:id", async (request, reply) => {
    const productId = parseInt((request.params as { id: string }).id, 10);
    if (isNaN(productId)) return reply.code(400).send({ error: "Invalid id" });

    const schema = z.object({
      price:       z.number().positive().nullable().optional(),
      stock:       z.number().int().min(0).nullable().optional(),
      currency:    z.string().max(3).optional(),
      description: z.string().max(2000).optional(),
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });

    const { price, stock, currency, description } = parsed.data;

    const product = await prisma.productMap.findUnique({ where: { id: productId } });
    if (!product) return reply.code(404).send({ error: "Product niet gevonden" });
    if (product.icSku) return reply.code(409).send({ error: "Product heeft al een IC koppeling" });

    const updated = await prisma.productMap.update({
      where: { id: productId },
      data: {
        ...(price !== undefined ? { price } : {}),
        ...(stock !== undefined ? { stock } : {}),
        ...(currency !== undefined ? { currency } : {}),
        ...(description !== undefined ? { description } : {}),
        updatedAt: new Date(),
      },
    });

    logger.info({ productId, price, stock }, "Manual price/stock set on non-IC product");
    revalidateStorefront(updated.id);
    return reply.send({ id: updated.id, price: updated.price, stock: updated.stock, currency: updated.currency, description: updated.description });
  });

  app.get("/unmatched/:id", async (request, reply) => {
    const rawId = (request.params as { id: string }).id;
    const id = parseInt(rawId, 10);

    if (isNaN(id)) {
      return reply.code(400).send({ error: "Invalid id" });
    }

    const item = await prisma.unmatched.findUnique({
      where: { id },
      include: {
        supplier: { select: { name: true, code: true } },
        brand: { select: { name: true, code: true } },
      },
    });

    if (!item) {
      return reply.code(404).send({ error: "Not found" });
    }

    return reply.send(item);
  });
}

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { searchProducts } from "../services/search.js";

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
}

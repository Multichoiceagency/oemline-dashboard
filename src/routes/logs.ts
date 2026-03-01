import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

export async function logsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/trace/logs", async (request, reply) => {
    const querySchema = z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      matched: z.enum(["true", "false", "all"]).default("all"),
      method: z.string().optional(),
      supplierId: z.coerce.number().int().optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
    });

    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Bad Request",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { page, limit, matched, method, supplierId, from, to } = parsed.data;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (matched === "true") where.matched = true;
    else if (matched === "false") where.matched = false;

    if (method) where.method = method;
    if (supplierId) where.supplierId = supplierId;

    if (from || to) {
      const createdAt: Record<string, Date> = {};
      if (from) createdAt.gte = new Date(from);
      if (to) createdAt.lte = new Date(to);
      where.createdAt = createdAt;
    }

    const [items, total, stats] = await Promise.all([
      prisma.matchLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          supplier: { select: { name: true, code: true } },
          brand: { select: { name: true, code: true } },
        },
      }),
      prisma.matchLog.count({ where }),
      prisma.matchLog.groupBy({
        by: ["method"],
        where,
        _count: { id: true },
        _avg: { durationMs: true, confidence: true },
      }),
    ]);

    return reply.send({
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      stats: stats.map((s) => ({
        method: s.method ?? "unmatched",
        count: s._count.id,
        avgDurationMs: Math.round(s._avg.durationMs ?? 0),
        avgConfidence: s._avg.confidence ? Number(s._avg.confidence.toFixed(2)) : null,
      })),
    });
  });
}

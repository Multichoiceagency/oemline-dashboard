import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(250).default(50),
  q: z.string().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  logoUrl: z.string().nullable().optional(),
  tecdocId: z.number().int().nullable().optional(),
});

export async function brandRoutes(app: FastifyInstance) {
  // List brands with product counts
  app.get("/brands", async (request) => {
    const query = listQuerySchema.parse(request.query);
    const { page, limit, q } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { code: { contains: q, mode: "insensitive" } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.brand.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: "asc" },
        include: {
          _count: {
            select: { productMaps: true },
          },
        },
      }),
      prisma.brand.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  });

  // Get single brand with top products
  app.get("/brands/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const brand = await prisma.brand.findUnique({
      where: { id: parseInt(id, 10) },
      include: {
        _count: { select: { productMaps: true } },
        productMaps: {
          take: 20,
          orderBy: { updatedAt: "desc" },
          include: {
            supplier: { select: { name: true, code: true } },
          },
        },
      },
    });

    if (!brand) {
      return reply.code(404).send({ error: "Brand not found" });
    }

    return brand;
  });

  // Update brand
  app.patch("/brands/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = updateSchema.parse(request.body);

    const existing = await prisma.brand.findUnique({
      where: { id: parseInt(id, 10) },
    });

    if (!existing) {
      return reply.code(404).send({ error: "Brand not found" });
    }

    const brand = await prisma.brand.update({
      where: { id: parseInt(id, 10) },
      data,
    });

    return brand;
  });
}

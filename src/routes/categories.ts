import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(250).default(100),
  parentId: z.coerce.number().int().optional(),
  q: z.string().optional(),
});

const updateCategorySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  code: z.string().min(1).max(100).optional(),
  parentId: z.number().int().nullable().optional(),
});

export async function categoryRoutes(app: FastifyInstance) {
  // List categories (tree or flat)
  app.get("/categories", async (request) => {
    const query = listQuerySchema.parse(request.query);
    const { page, limit, parentId, q } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (parentId !== undefined) {
      where.parentId = parentId;
    } else if (!q) {
      // Top-level categories by default
      where.parentId = null;
    }

    if (q) {
      where.name = { contains: q, mode: "insensitive" };
    }

    const [items, total] = await Promise.all([
      prisma.category.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: "asc" },
        include: {
          _count: { select: { products: true, children: true } },
          children: {
            take: 10,
            orderBy: { name: "asc" },
            include: {
              _count: { select: { products: true, children: true } },
            },
          },
        },
      }),
      prisma.category.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  });

  // Get single category with children and products
  app.get("/categories/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const category = await prisma.category.findUnique({
      where: { id: parseInt(id, 10) },
      include: {
        parent: { select: { id: true, name: true, code: true } },
        children: {
          orderBy: { name: "asc" },
          include: {
            _count: { select: { products: true, children: true } },
          },
        },
        _count: { select: { products: true } },
        products: {
          take: 20,
          orderBy: { updatedAt: "desc" },
          include: {
            supplier: { select: { name: true, code: true } },
            brand: { select: { name: true, code: true } },
          },
        },
      },
    });

    if (!category) {
      return reply.code(404).send({ error: "Category not found" });
    }

    return category;
  });

  // Update category
  app.patch("/categories/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = updateCategorySchema.parse(request.body);

    const existing = await prisma.category.findUnique({
      where: { id: parseInt(id, 10) },
    });

    if (!existing) {
      return reply.code(404).send({ error: "Category not found" });
    }

    const updated = await prisma.category.update({
      where: { id: parseInt(id, 10) },
      data: body,
    });

    return updated;
  });
}

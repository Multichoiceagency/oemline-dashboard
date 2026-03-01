import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(250).default(50),
  q: z.string().optional(),
  supplierId: z.coerce.number().int().optional(),
  brandId: z.coerce.number().int().optional(),
  supplier: z.string().optional(),
  brand: z.string().optional(),
});

const createSchema = z.object({
  supplierId: z.number().int(),
  brandId: z.number().int().default(1),
  sku: z.string().min(1),
  articleNo: z.string().min(1),
  ean: z.string().nullable().optional(),
  tecdocId: z.string().nullable().optional(),
  oem: z.string().nullable().optional(),
  description: z.string().default(""),
});

const updateSchema = z.object({
  sku: z.string().min(1).optional(),
  articleNo: z.string().min(1).optional(),
  ean: z.string().nullable().optional(),
  tecdocId: z.string().nullable().optional(),
  oem: z.string().nullable().optional(),
  description: z.string().optional(),
  brandId: z.number().int().optional(),
  imageUrl: z.string().nullable().optional(),
  price: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  stock: z.number().int().nullable().optional(),
  genericArticle: z.string().nullable().optional(),
  status: z.string().optional(),
});

const batchImportSchema = z.object({
  supplierId: z.number().int(),
  brandId: z.number().int().default(1),
  items: z.array(
    z.object({
      sku: z.string().min(1),
      articleNo: z.string().min(1),
      ean: z.string().nullable().optional(),
      tecdocId: z.string().nullable().optional(),
      oem: z.string().nullable().optional(),
      description: z.string().default(""),
    })
  ).min(1).max(500),
});

export async function productRoutes(app: FastifyInstance) {
  // ─── Static routes first (before :id param routes) ───

  // Get product stats
  app.get("/products/stats", async () => {
    const [total, bySupplier, recentlyUpdated] = await Promise.all([
      prisma.productMap.count(),
      prisma.productMap.groupBy({
        by: ["supplierId"],
        _count: { id: true },
      }),
      prisma.productMap.count({
        where: {
          updatedAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
        },
      }),
    ]);

    const supplierIds = bySupplier.map((s) => s.supplierId);
    const suppliers = await prisma.supplier.findMany({
      where: { id: { in: supplierIds } },
      select: { id: true, name: true, code: true },
    });

    const supplierMap = new Map(suppliers.map((s) => [s.id, s]));

    return {
      total,
      recentlyUpdated,
      bySupplier: bySupplier.map((s) => ({
        supplier: supplierMap.get(s.supplierId) ?? { id: s.supplierId, name: "Unknown", code: "unknown" },
        count: s._count.id,
      })),
    };
  });

  // Batch import products from search results
  app.post("/products/import", async (request) => {
    const data = batchImportSchema.parse(request.body);

    let imported = 0;
    let updated = 0;

    for (const item of data.items) {
      const result = await prisma.productMap.upsert({
        where: {
          supplierId_sku: {
            supplierId: data.supplierId,
            sku: item.sku,
          },
        },
        update: {
          articleNo: item.articleNo,
          ean: item.ean ?? null,
          tecdocId: item.tecdocId ?? null,
          oem: item.oem ?? null,
          description: item.description,
          brandId: data.brandId,
        },
        create: {
          supplierId: data.supplierId,
          brandId: data.brandId,
          sku: item.sku,
          articleNo: item.articleNo,
          ean: item.ean ?? null,
          tecdocId: item.tecdocId ?? null,
          oem: item.oem ?? null,
          description: item.description,
        },
      });

      if (result.createdAt.getTime() === result.updatedAt.getTime()) {
        imported++;
      } else {
        updated++;
      }
    }

    logger.info({ imported, updated, supplierId: data.supplierId }, "Batch import completed");

    return { imported, updated, total: data.items.length };
  });

  // ─── List and CRUD routes ───

  // List products with search & filters
  app.get("/products", async (request) => {
    const query = listQuerySchema.parse(request.query);
    const { page, limit, q, supplierId, brandId, supplier, brand } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (supplierId) where.supplierId = supplierId;
    if (brandId) where.brandId = brandId;

    if (supplier) {
      where.supplier = { code: supplier };
    }

    if (brand) {
      where.brand = { code: brand };
    }

    if (q) {
      where.OR = [
        { sku: { contains: q, mode: "insensitive" } },
        { articleNo: { contains: q, mode: "insensitive" } },
        { ean: { contains: q, mode: "insensitive" } },
        { tecdocId: { contains: q, mode: "insensitive" } },
        { oem: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.productMap.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: "desc" },
        include: {
          supplier: { select: { id: true, name: true, code: true } },
          brand: { select: { id: true, name: true, code: true } },
        },
      }),
      prisma.productMap.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  });

  // Create product
  app.post("/products", async (request) => {
    const data = createSchema.parse(request.body);

    const product = await prisma.productMap.upsert({
      where: {
        supplierId_sku: {
          supplierId: data.supplierId,
          sku: data.sku,
        },
      },
      update: {
        articleNo: data.articleNo,
        ean: data.ean ?? null,
        tecdocId: data.tecdocId ?? null,
        oem: data.oem ?? null,
        description: data.description,
        brandId: data.brandId,
      },
      create: {
        supplierId: data.supplierId,
        brandId: data.brandId,
        sku: data.sku,
        articleNo: data.articleNo,
        ean: data.ean ?? null,
        tecdocId: data.tecdocId ?? null,
        oem: data.oem ?? null,
        description: data.description,
      },
      include: {
        supplier: { select: { id: true, name: true, code: true } },
        brand: { select: { id: true, name: true, code: true } },
      },
    });

    return product;
  });

  // Get single product
  app.get("/products/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const product = await prisma.productMap.findUnique({
      where: { id: parseInt(id, 10) },
      include: {
        supplier: { select: { id: true, name: true, code: true } },
        brand: { select: { id: true, name: true, code: true } },
      },
    });

    if (!product) {
      return reply.code(404).send({ error: "Product not found" });
    }

    return product;
  });

  // Update product
  app.patch("/products/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = updateSchema.parse(request.body);

    const existing = await prisma.productMap.findUnique({
      where: { id: parseInt(id, 10) },
    });

    if (!existing) {
      return reply.code(404).send({ error: "Product not found" });
    }

    const product = await prisma.productMap.update({
      where: { id: parseInt(id, 10) },
      data,
      include: {
        supplier: { select: { id: true, name: true, code: true } },
        brand: { select: { id: true, name: true, code: true } },
      },
    });

    return product;
  });

  // Delete product
  app.delete("/products/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const existing = await prisma.productMap.findUnique({
      where: { id: parseInt(id, 10) },
    });

    if (!existing) {
      return reply.code(404).send({ error: "Product not found" });
    }

    await prisma.productMap.delete({ where: { id: parseInt(id, 10) } });

    return { success: true, id: parseInt(id, 10) };
  });
}

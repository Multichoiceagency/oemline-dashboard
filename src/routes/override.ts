import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { cacheInvalidatePattern } from "../services/cache.js";

const createOverrideSchema = z.object({
  supplierCode: z.string().min(1),
  brandCode: z.string().min(1),
  articleNo: z.string().min(1),
  sku: z.string().min(1),
  ean: z.string().optional(),
  tecdocId: z.string().optional(),
  oem: z.string().optional(),
  reason: z.string().default(""),
  createdBy: z.string().min(1),
});

export async function overrideRoutes(app: FastifyInstance): Promise<void> {
  app.post("/override", async (request, reply) => {
    const parsed = createOverrideSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "Bad Request",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const data = parsed.data;

    const supplier = await prisma.supplier.findUnique({
      where: { code: data.supplierCode },
    });

    if (!supplier) {
      return reply.code(404).send({ error: "Supplier not found" });
    }

    let brand = await prisma.brand.findUnique({
      where: { code: data.brandCode },
    });

    if (!brand) {
      brand = await prisma.brand.create({
        data: { name: data.brandCode, code: data.brandCode },
      });
    }

    const override = await prisma.override.upsert({
      where: {
        supplierId_brandId_articleNo: {
          supplierId: supplier.id,
          brandId: brand.id,
          articleNo: data.articleNo,
        },
      },
      update: {
        sku: data.sku,
        ean: data.ean ?? null,
        tecdocId: data.tecdocId ?? null,
        oem: data.oem ?? null,
        reason: data.reason,
        createdBy: data.createdBy,
        active: true,
      },
      create: {
        supplierId: supplier.id,
        brandId: brand.id,
        articleNo: data.articleNo,
        sku: data.sku,
        ean: data.ean ?? null,
        tecdocId: data.tecdocId ?? null,
        oem: data.oem ?? null,
        reason: data.reason,
        createdBy: data.createdBy,
      },
    });

    // Resolve unmatched first, then invalidate cache (atomic ordering)
    await prisma.unmatched.updateMany({
      where: {
        supplierId: supplier.id,
        articleNo: data.articleNo,
        resolvedAt: null,
      },
      data: {
        resolvedAt: new Date(),
        resolvedBy: `override:${override.id}`,
      },
    });

    // Invalidate search cache after data is consistent
    await cacheInvalidatePattern("search", "*").catch((err) => {
      request.log.warn({ err }, "Cache invalidation failed — stale results may persist");
    });

    return reply.code(201).send({
      id: override.id,
      supplier: supplier.code,
      brand: brand.code,
      articleNo: override.articleNo,
      sku: override.sku,
      message: "Override created successfully",
    });
  });

  app.get("/overrides", async (request, reply) => {
    const querySchema = z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      supplierCode: z.string().optional(),
    });

    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Bad Request",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { page, limit, supplierCode } = parsed.data;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { active: true };

    if (supplierCode) {
      const supplier = await prisma.supplier.findUnique({ where: { code: supplierCode } });
      if (supplier) where.supplierId = supplier.id;
    }

    const [items, total] = await Promise.all([
      prisma.override.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          supplier: { select: { name: true, code: true } },
          brand: { select: { name: true, code: true } },
        },
      }),
      prisma.override.count({ where }),
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

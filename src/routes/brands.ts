import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { decryptCredentials } from "../lib/crypto.js";

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

  // Sync brands: set tecdocId from product data (uses distinct tecdoc_id from product_maps)
  app.post("/brands/sync-tecdoc", async () => {
    // Get distinct tecdocId -> brand mappings from product_maps
    const mappings = await prisma.$queryRaw<Array<{ brand_id: number; tecdoc_id: string; brand_name: string }>>`
      SELECT DISTINCT ON (b.id) pm.brand_id, pm.tecdoc_id, b.name as brand_name
      FROM product_maps pm
      JOIN brands b ON b.id = pm.brand_id
      WHERE pm.tecdoc_id IS NOT NULL
        AND pm.tecdoc_id != ''
        AND b.tecdoc_id IS NULL
      ORDER BY b.id, pm.created_at DESC
    `;

    let updated = 0;
    for (const m of mappings) {
      const tecdocId = parseInt(m.tecdoc_id, 10);
      if (isNaN(tecdocId)) continue;
      try {
        await prisma.brand.update({
          where: { id: m.brand_id },
          data: { tecdocId },
        });
        updated++;
      } catch {
        // skip conflict
      }
    }

    // Count total brands
    const total = await prisma.brand.count();
    const withTecdocId = await prisma.brand.count({ where: { tecdocId: { not: null } } });

    return { updated, total, withTecdocId };
  });

  // Set brand logos from existing product images (uses first product with image per brand)
  app.post("/brands/fetch-logos", async () => {
    // Find brands without logos that have products with images
    const results = await prisma.$queryRaw<Array<{ brand_id: number; image_url: string }>>`
      SELECT DISTINCT ON (pm.brand_id) pm.brand_id, pm.image_url
      FROM product_maps pm
      JOIN brands b ON b.id = pm.brand_id
      WHERE pm.image_url IS NOT NULL
        AND pm.image_url != ''
        AND b.logo_url IS NULL
      ORDER BY pm.brand_id, pm.updated_at DESC
    `;

    let logosSet = 0;
    for (const r of results) {
      try {
        await prisma.brand.update({
          where: { id: r.brand_id },
          data: { logoUrl: r.image_url },
        });
        logosSet++;
      } catch {
        // skip
      }
    }

    const total = await prisma.brand.count();
    const withLogo = await prisma.brand.count({ where: { logoUrl: { not: null } } });

    return { logosSet, total, withLogo };
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

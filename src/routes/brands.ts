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

const createSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1).optional(),
  tecdocId: z.number().int().nullable().optional(),
  logoUrl: z.string().nullable().optional(),
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

    const where: Record<string, unknown> = {
      productMaps: { some: {} }, // hide brands with 0 products
    };
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

  // Create a new brand
  app.post("/brands", async (request, reply) => {
    const data = createSchema.parse(request.body);
    const code = data.code ?? data.name.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");

    try {
      const brand = await prisma.brand.create({
        data: { name: data.name, code, tecdocId: data.tecdocId ?? null, logoUrl: data.logoUrl ?? null },
      });
      logger.info({ brandId: brand.id, brandName: brand.name }, "Created brand");
      return reply.code(201).send(brand);
    } catch (err: any) {
      if (err?.code === "P2002") {
        return reply.code(409).send({ error: `Brand with name "${data.name}" or code "${code}" already exists` });
      }
      throw err;
    }
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

  // Fetch real brand logos from TecDoc API (getBrands with includeDataSupplierLogo)
  app.post("/brands/fetch-logos", async () => {
    const { config } = await import("../config.js");

    // Step 1: Fetch brand logos from TecDoc getBrands API
    const tecdocUrl = "https://webservice.tecalliance.services/pegasus-3-0/services/TecdocToCatDLB.jsonEndpoint";
    const tecdocKey = config.TECDOC_API_KEY;
    if (!tecdocKey) {
      return { error: "TECDOC_API_KEY not configured" };
    }

    const response = await fetch(tecdocUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": tecdocKey },
      body: JSON.stringify({
        getBrands: {
          providerId: 22691,
          articleCountry: "NL",
          lang: "nl",
          includeAll: true,
          includeDataSupplierLogo: true,
        },
      }),
    });

    if (!response.ok) {
      return { error: `TecDoc API error: ${response.status}` };
    }

    const data = (await response.json()) as {
      data?: { array?: Array<{
        dataSupplierId: number;
        mfrName: string;
        dataSupplierLogo?: {
          imageURL100?: string;
          imageURL200?: string;
          imageURL400?: string;
          imageURL800?: string;
        };
      }> };
    };

    const tecdocBrands = data.data?.array ?? [];
    logger.info({ count: tecdocBrands.length }, "Fetched TecDoc brands with logos");

    // Step 2: Build tecdocId → brand info map
    const tecdocBrandMap = new Map<number, { name: string; logoUrl: string | null }>();
    const nameLogoMap = new Map<string, { dataSupplierId: number; logoUrl: string | null }>();
    for (const tb of tecdocBrands) {
      const logo = tb.dataSupplierLogo;
      const logoUrl = logo?.imageURL400 ?? logo?.imageURL200 ?? logo?.imageURL100 ?? null;
      tecdocBrandMap.set(tb.dataSupplierId, { name: tb.mfrName, logoUrl });
      nameLogoMap.set(tb.mfrName.toUpperCase(), { dataSupplierId: tb.dataSupplierId, logoUrl });
    }

    // Step 3: Load existing brands and build lookup maps
    const existingBrands = await prisma.brand.findMany({
      select: { id: true, name: true, code: true, tecdocId: true },
    });

    const existingByTecdocId = new Map<number, (typeof existingBrands)[0]>();
    const existingByName = new Map<string, (typeof existingBrands)[0]>();
    for (const b of existingBrands) {
      if (b.tecdocId) existingByTecdocId.set(b.tecdocId, b);
      existingByName.set(b.name.toUpperCase(), b);
    }

    let updated = 0;
    let created = 0;
    let notFound = 0;

    // Step 4: Create missing brands from TecDoc and update logos for all
    for (const [dataSupplierId, info] of tecdocBrandMap) {
      const { name, logoUrl } = info;
      const code = name.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");

      // Check if brand already exists (by tecdocId or name)
      let existing = existingByTecdocId.get(dataSupplierId) ?? existingByName.get(name.toUpperCase());

      if (existing) {
        // Update logo and tecdocId if needed
        const updates: Record<string, unknown> = {};
        if (logoUrl) updates.logoUrl = logoUrl;
        if (!existing.tecdocId) updates.tecdocId = dataSupplierId;

        if (Object.keys(updates).length > 0) {
          try {
            await prisma.brand.update({ where: { id: existing.id }, data: updates });
            updated++;
          } catch {
            // skip conflict
          }
        }
      } else {
        // Create new brand from TecDoc
        try {
          await prisma.brand.create({
            data: { name, code, tecdocId: dataSupplierId, logoUrl },
          });
          created++;
        } catch {
          // Might conflict on code — try with suffix
          try {
            await prisma.brand.create({
              data: { name, code: `${code}_${dataSupplierId}`, tecdocId: dataSupplierId, logoUrl },
            });
            created++;
          } catch {
            notFound++;
          }
        }
      }
    }

    // Also update logos for brands not in TecDoc's brand list (match by name)
    for (const brand of existingBrands) {
      if (brand.name === "Unknown") continue;
      const match = nameLogoMap.get(brand.name.toUpperCase());
      if (match?.logoUrl && !existingByTecdocId.has(brand.tecdocId ?? -1)) {
        try {
          const updates: Record<string, unknown> = { logoUrl: match.logoUrl };
          if (!brand.tecdocId) updates.tecdocId = match.dataSupplierId;
          await prisma.brand.update({ where: { id: brand.id }, data: updates });
          updated++;
        } catch {
          // skip
        }
      }
    }

    const total = await prisma.brand.count();
    const withLogo = await prisma.brand.count({ where: { logoUrl: { not: null } } });

    return { updated, created, notFound, tecdocBrands: tecdocBrands.length, total, withLogo };
  });

  // Delete empty brands (brands with 0 products)
  app.delete("/brands/cleanup-empty", async () => {
    // Find brands with no products
    const emptyBrands = await prisma.brand.findMany({
      where: {
        productMaps: { none: {} },
      },
      select: { id: true, name: true, code: true },
    });

    if (emptyBrands.length === 0) {
      return { deleted: 0, message: "No empty brands found" };
    }

    const ids = emptyBrands.map((b) => b.id);
    const { count } = await prisma.brand.deleteMany({
      where: { id: { in: ids } },
    });

    logger.info({ count, brands: emptyBrands.map((b) => b.name) }, "Deleted empty brands");

    return {
      deleted: count,
      brands: emptyBrands.map((b) => ({ id: b.id, name: b.name, code: b.code })),
    };
  });

  // Delete a single brand (only if it has no products)
  app.delete("/brands/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { force } = (request.query ?? {}) as { force?: string };
    const brandId = parseInt(id, 10);

    const brand = await prisma.brand.findUnique({
      where: { id: brandId },
      include: { _count: { select: { productMaps: true } } },
    });

    if (!brand) {
      return reply.code(404).send({ error: "Brand not found" });
    }

    if (brand._count.productMaps > 0 && force !== "true") {
      return reply.code(400).send({
        error: `Cannot delete brand "${brand.name}" — it has ${brand._count.productMaps} products. Use ?force=true to delete with products.`,
      });
    }

    if (brand._count.productMaps > 0) {
      await prisma.productMap.deleteMany({ where: { brandId } });
    }

    await prisma.brand.delete({ where: { id: brandId } });
    logger.info({ brandId, brandName: brand.name, force: force === "true" }, "Deleted brand");

    return { success: true, deleted: { id: brand.id, name: brand.name, productsRemoved: brand._count.productMaps } };
  });

  // Bulk delete brands not in the provided tecdocId list (with their products)
  app.post("/brands/cleanup-unselected", async (request, reply) => {
    const { keepTecdocIds } = request.body as { keepTecdocIds: number[] };
    if (!Array.isArray(keepTecdocIds) || keepTecdocIds.length === 0) {
      return reply.code(400).send({ error: "keepTecdocIds array required" });
    }
    const toDelete = await prisma.brand.findMany({
      where: { tecdocId: { notIn: keepTecdocIds } },
      include: { _count: { select: { productMaps: true } } },
    });
    let deletedProducts = 0;
    for (const b of toDelete) {
      if (b._count.productMaps > 0) {
        await prisma.productMap.deleteMany({ where: { brandId: b.id } });
        deletedProducts += b._count.productMaps;
      }
      await prisma.brand.delete({ where: { id: b.id } });
    }
    logger.info({ deletedBrands: toDelete.length, deletedProducts }, "cleanup-unselected completed");
    return {
      deletedBrands: toDelete.length,
      deletedProducts,
      brands: toDelete.map((b) => ({ id: b.id, name: b.name, tecdocId: b.tecdocId, products: b._count.productMaps })),
    };
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

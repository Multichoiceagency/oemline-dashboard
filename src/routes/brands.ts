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

    // Step 2: Build tecdocId → logo URL map
    const logoMap = new Map<number, string>();
    const nameLogoMap = new Map<string, string>();
    for (const tb of tecdocBrands) {
      const logo = tb.dataSupplierLogo;
      const url = logo?.imageURL400 ?? logo?.imageURL200 ?? logo?.imageURL100;
      if (url) {
        logoMap.set(tb.dataSupplierId, url);
        nameLogoMap.set(tb.mfrName.toUpperCase(), url);
      }
    }

    // Step 3: Update brands in our DB
    const brands = await prisma.brand.findMany({
      where: { name: { not: "Unknown" } },
      select: { id: true, name: true, tecdocId: true },
    });

    let updated = 0;
    let notFound = 0;

    for (const brand of brands) {
      // Try matching by tecdocId first, then by name
      let logoUrl = brand.tecdocId ? logoMap.get(brand.tecdocId) : undefined;
      if (!logoUrl) {
        logoUrl = nameLogoMap.get(brand.name.toUpperCase());
      }

      if (!logoUrl) {
        notFound++;
        continue;
      }

      try {
        await prisma.brand.update({
          where: { id: brand.id },
          data: { logoUrl },
        });
        updated++;
      } catch {
        // skip
      }
    }

    const total = await prisma.brand.count();
    const withLogo = await prisma.brand.count({ where: { logoUrl: { not: null } } });

    return { updated, notFound, tecdocBrands: tecdocBrands.length, total, withLogo };
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

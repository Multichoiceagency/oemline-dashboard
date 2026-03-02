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

  // Sync brands from TecDoc (fetches tecdocId and logos where available)
  app.post("/brands/sync-tecdoc", async (request, reply) => {
    const supplier = await prisma.supplier.findUnique({ where: { code: "tecdoc" } });
    if (!supplier) {
      return reply.code(404).send({ error: "TecDoc supplier not found" });
    }

    let creds: { apiKey: string; providerId?: number; articleCountry?: string } = { apiKey: "" };
    try {
      let raw = supplier.credentials as string;
      try { raw = decryptCredentials(raw); } catch { /* plaintext fallback */ }
      creds = JSON.parse(raw);
    } catch {
      return reply.code(500).send({ error: "Invalid TecDoc credentials" });
    }

    const tecdocUrl = supplier.baseUrl || "https://webservice.tecalliance.services/pegasus-3-0/services/TecdocToCatDLB.jsonEndpoint";

    // Use dataSupplierFacetOptions to discover all brands/manufacturers
    const response = await fetch(tecdocUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": creds.apiKey,
      },
      body: JSON.stringify({
        getArticles: {
          articleCountry: creds.articleCountry ?? "NL",
          providerId: creds.providerId ?? 22691,
          lang: "nl",
          perPage: 0,
          page: 1,
          dataSupplierFacetOptions: {
            enabled: true,
          },
        },
      }),
    });

    if (!response.ok) {
      return reply.code(502).send({ error: `TecDoc API error: ${response.status}` });
    }

    const data = (await response.json()) as Record<string, unknown>;
    const dsf = data.dataSupplierFacets;

    let suppliers: Array<Record<string, unknown>> = [];
    if (Array.isArray(dsf)) {
      suppliers = dsf;
    } else if (dsf && typeof dsf === "object") {
      const obj = dsf as Record<string, unknown>;
      for (const val of Object.values(obj)) {
        if (Array.isArray(val)) { suppliers = val; break; }
      }
    }

    logger.info({ supplierCount: suppliers.length }, "TecDoc data suppliers fetched");

    let updated = 0;
    let created = 0;
    let logosDownloaded = 0;

    for (const ds of suppliers) {
      const dataSupplierId = ds.dataSupplierId as number | undefined;
      const dataSupplierName = (ds.mfrName ?? ds.dataSupplierName ?? ds.name ?? "") as string;
      const matchCount = (ds.matchCount ?? ds.count ?? 0) as number;

      if (!dataSupplierId || !dataSupplierName) continue;

      // Try to find existing brand by name (normalized)
      const code = dataSupplierName.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_");
      try {
        const existing = await prisma.brand.findUnique({ where: { code } });
        if (existing) {
          await prisma.brand.update({
            where: { code },
            data: { tecdocId: dataSupplierId },
          });
          updated++;
        } else {
          await prisma.brand.create({
            data: { name: dataSupplierName, code, tecdocId: dataSupplierId },
          });
          created++;
        }
      } catch (err) {
        logger.warn({ err, code, name: dataSupplierName }, "Brand sync failed");
      }
    }

    logger.info({ updated, created, logosDownloaded, total: suppliers.length }, "Brand sync completed");
    return { updated, created, logosDownloaded, total: suppliers.length };
  });

  // Fetch brand logos from TecDoc for all brands with tecdocId
  app.post("/brands/fetch-logos", async (request, reply) => {
    const supplier = await prisma.supplier.findUnique({ where: { code: "tecdoc" } });
    if (!supplier) {
      return reply.code(404).send({ error: "TecDoc supplier not found" });
    }

    let creds: { apiKey: string; providerId?: number; articleCountry?: string } = { apiKey: "" };
    try {
      let raw = supplier.credentials as string;
      try { raw = decryptCredentials(raw); } catch { /* plaintext fallback */ }
      creds = JSON.parse(raw);
    } catch {
      return reply.code(500).send({ error: "Invalid TecDoc credentials" });
    }

    const tecdocUrl = supplier.baseUrl || "https://webservice.tecalliance.services/pegasus-3-0/services/TecdocToCatDLB.jsonEndpoint";

    // Get brands without logos that have tecdocId
    const brands = await prisma.brand.findMany({
      where: { tecdocId: { not: null }, logoUrl: null },
      select: { id: true, name: true, code: true, tecdocId: true },
    });

    logger.info({ brands: brands.length }, "Fetching logos for brands");

    let logosFound = 0;

    // Fetch article images for each brand to discover manufacturer logos
    for (const brand of brands) {
      try {
        // Get one article to check for brand logo
        const response = await fetch(tecdocUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Api-Key": creds.apiKey,
          },
          body: JSON.stringify({
            getArticles: {
              articleCountry: creds.articleCountry ?? "NL",
              providerId: creds.providerId ?? 22691,
              lang: "nl",
              perPage: 1,
              page: 1,
              dataSupplierId: brand.tecdocId,
              includeImages: true,
            },
          }),
        });

        if (!response.ok) continue;

        const data = (await response.json()) as Record<string, unknown>;
        const articles = (data.articles ?? []) as Array<Record<string, unknown>>;

        if (articles.length === 0) continue;

        // Check if article has images - use the first image as a proxy for the brand
        const art = articles[0];
        const images = art.images as Array<Record<string, unknown>> | undefined;
        if (images && images.length > 0) {
          const img = images[0];
          const logoUrl = (img.imageURL200 ?? img.imageURL400 ?? img.imageURL100 ?? "") as string;
          if (logoUrl) {
            await prisma.brand.update({
              where: { id: brand.id },
              data: { logoUrl },
            });
            logosFound++;
          }
        }

        // Rate limit
        await new Promise((r) => setTimeout(r, 200));
      } catch (err) {
        logger.warn({ err, brandId: brand.id }, "Failed to fetch brand logo");
      }
    }

    return { brandsChecked: brands.length, logosFound };
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

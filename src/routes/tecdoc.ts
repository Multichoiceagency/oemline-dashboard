import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getTecDocService } from "../services/tecdoc.js";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

export async function tecdocRoutes(app: FastifyInstance): Promise<void> {
  app.get("/tecdoc/search", async (request, reply) => {
    const schema = z.object({
      q: z.string().min(1).max(200),
      type: z.enum(["article", "oem", "ean", "text"]).default("text"),
      brandId: z.coerce.number().int().optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25),
    });

    const parsed = schema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Bad Request",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { q, type, brandId, page, limit } = parsed.data;
    const tecdoc = getTecDocService();

    try {
      switch (type) {
        case "article": {
          const articles = await tecdoc.searchByArticleNumber(q, brandId);
          return reply.send({ articles, total: articles.length });
        }
        case "oem": {
          const articles = await tecdoc.searchByOemNumber(q);
          return reply.send({ articles, total: articles.length });
        }
        case "ean": {
          const articles = await tecdoc.searchByEan(q);
          return reply.send({ articles, total: articles.length });
        }
        case "text":
        default: {
          const result = await tecdoc.searchFreeText(q, page, limit);
          return reply.send(result);
        }
      }
    } catch (err) {
      request.log.error({ err }, "TecDoc search error");
      return reply.code(502).send({
        error: "TecDoc API error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  });

  // Get vehicle linkages for an article (by articleNumber or articleId)
  app.get("/tecdoc/linkages", async (request, reply) => {
    const schema = z.object({
      articleId: z.coerce.number().int().min(1).optional(),
      articleNumber: z.string().min(1).optional(),
    }).refine((d) => d.articleId || d.articleNumber, {
      message: "Either articleId or articleNumber is required",
    });

    const parsed = schema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Bad Request",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { articleId, articleNumber } = parsed.data;
    const tecdoc = getTecDocService();

    try {
      const linkages = articleNumber
        ? await tecdoc.getArticleLinkagesByNumber(articleNumber)
        : await tecdoc.getArticleLinkages(articleId!);
      return reply.send({ linkages, total: linkages.length });
    } catch (err) {
      request.log.error({ err }, "TecDoc linkages error");
      return reply.code(502).send({
        error: "TecDoc API error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  });

  // Get full article details (description, text, OEM numbers)
  app.get("/tecdoc/details", async (request, reply) => {
    const schema = z.object({
      articleNumber: z.string().min(1),
    });

    const parsed = schema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Bad Request",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const tecdoc = getTecDocService();

    try {
      const details = await tecdoc.getArticleDetails(parsed.data.articleNumber);
      if (!details) {
        return reply.code(404).send({ error: "Article not found in TecDoc" });
      }
      return reply.send(details);
    } catch (err) {
      request.log.error({ err }, "TecDoc details error");
      return reply.code(502).send({
        error: "TecDoc API error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  });

  // Populate DB with TecDoc search results
  app.post("/tecdoc/populate", async (request, reply) => {
    const schema = z.object({
      queries: z.array(z.string().min(1)).min(1).max(100),
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Bad Request",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { queries } = parsed.data;
    const tecdoc = getTecDocService();

    // Find or create the TecDoc supplier
    let supplier = await prisma.supplier.findUnique({ where: { code: "tecdoc" } });
    if (!supplier) {
      return reply.code(400).send({ error: "TecDoc supplier not found in database" });
    }

    // Ensure default brand exists
    let brand = await prisma.brand.findFirst({ where: { id: 1 } });
    if (!brand) {
      brand = await prisma.brand.create({
        data: { name: "Unknown", code: "unknown" },
      });
    }

    let totalImported = 0;
    let totalUpdated = 0;

    for (const query of queries) {
      try {
        // Search by article number
        const articleResults = await tecdoc.searchByArticleNumber(query);
        // Search by OEM
        const oemResults = await tecdoc.searchByOemNumber(query);

        const allResults = [...articleResults, ...oemResults];
        const seen = new Set<string>();

        for (const article of allResults) {
          const key = `${article.tecdocId}`;
          if (seen.has(key) || !article.tecdocId || article.tecdocId === "0") continue;
          seen.add(key);

          // Find or create brand
          let articleBrandId = brand.id;
          if (article.brand) {
            const brandCode = article.brand.toLowerCase().replace(/[^a-z0-9]/g, "_");
            const existingBrand = await prisma.brand.findUnique({ where: { code: brandCode } });
            if (existingBrand) {
              articleBrandId = existingBrand.id;
            } else {
              try {
                const newBrand = await prisma.brand.create({
                  data: { name: article.brand, code: brandCode },
                });
                articleBrandId = newBrand.id;
              } catch {
                // Brand may have been created concurrently
                const existing = await prisma.brand.findUnique({ where: { code: brandCode } });
                if (existing) articleBrandId = existing.id;
              }
            }
          }

          const result = await prisma.productMap.upsert({
            where: {
              supplierId_sku: {
                supplierId: supplier.id,
                sku: article.tecdocId,
              },
            },
            update: {
              articleNo: article.articleNumber,
              ean: article.ean,
              tecdocId: article.tecdocId,
              oem: article.oemNumbers?.[0] ?? null,
              description: article.description,
              brandId: articleBrandId,
            },
            create: {
              supplierId: supplier.id,
              brandId: articleBrandId,
              sku: article.tecdocId,
              articleNo: article.articleNumber,
              ean: article.ean,
              tecdocId: article.tecdocId,
              oem: article.oemNumbers?.[0] ?? null,
              description: article.description,
            },
          });

          if (result.createdAt.getTime() === result.updatedAt.getTime()) {
            totalImported++;
          } else {
            totalUpdated++;
          }
        }
      } catch (err) {
        logger.warn({ err, query }, "TecDoc populate query failed");
      }
    }

    logger.info({ imported: totalImported, updated: totalUpdated }, "TecDoc populate completed");

    return {
      imported: totalImported,
      updated: totalUpdated,
      total: totalImported + totalUpdated,
    };
  });

  /**
   * POST /tecdoc/sync-brands
   *
   * Fetches all data suppliers (brands) directly from TecDoc via
   * `dataSupplierFacetOptions` and upserts them into the `brands` table.
   *
   * TecDoc Pegasus 3.0 does not have a getBrands endpoint — brands come
   * from dataSupplierFacetOptions filtered by your catalog scope.
   */
  app.post("/tecdoc/sync-brands", async (request, reply) => {
    const { config } = await import("../config.js");

    const apiUrl = config.TECDOC_API_URL;
    const apiKey = config.TECDOC_API_KEY;

    if (!apiKey) {
      return reply.code(400).send({ error: "TECDOC_API_KEY not configured" });
    }

    // Call getBrands — returns all data suppliers (brands) for the provider's catalog.
    // Response: { data: { array: [{ dataSupplierId, mfrName }] } }
    // Note: perPage cap is 100 and the API returns the same set regardless of page,
    // so a single page-1 fetch is sufficient.
    let rawBrands: Array<{ dataSupplierId: number; dataSupplierName: string }> = [];

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
        body: JSON.stringify({
          getBrands: {
            articleCountry: "NL",
            providerId: 22691,
            lang: "nl",
            perPage: 100,
            page: 1,
          },
        }),
        signal: AbortSignal.timeout(30_000),
      });

      const json = (await response.json()) as Record<string, unknown>;

      type BrandItem = { dataSupplierId?: number; mfrName?: string };
      const items: BrandItem[] =
        (json as { data?: { array?: BrandItem[] } })?.data?.array ?? [];

      rawBrands = items
        .filter((f) => f.dataSupplierId != null && f.mfrName)
        .map((f) => ({
          dataSupplierId: f.dataSupplierId!,
          dataSupplierName: f.mfrName!,
        }));
    } catch (err) {
      logger.error({ err }, "TecDoc dataSupplierFacetOptions request failed");
      return reply.code(502).send({
        error: "TecDoc API request failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }

    if (rawBrands.length === 0) {
      logger.warn("TecDoc sync-brands: no brands returned from dataSupplierFacetOptions");
      return { upserted: 0, total: 0, message: "No brands returned from TecDoc API" };
    }

    // Upsert every brand from TecDoc.
    // createMany(skipDuplicates) silently drops rows when code OR name already
    // exists — causing brands to be missed. Instead we use raw SQL with two
    // conflict targets so every TecDoc brand lands in the DB regardless.
    let upserted = 0;

    for (const b of rawBrands) {
      const name = b.dataSupplierName;
      const code = name.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
      const tecdocId = b.dataSupplierId;

      try {
        // Primary: upsert on code (most common conflict). Sets tecdocId so
        // future syncs can match by tecdocId directly.
        await prisma.$executeRawUnsafe(
          `INSERT INTO brands (name, code, tecdoc_id, created_at, updated_at)
           VALUES ($1, $2, $3, NOW(), NOW())
           ON CONFLICT (code) DO UPDATE SET
             tecdoc_id = EXCLUDED.tecdoc_id,
             updated_at = NOW()`,
          name, code, tecdocId
        );
        upserted++;
      } catch {
        // Secondary: name conflict with a different code — append tecdocId to
        // make the code unique while still inserting the brand.
        try {
          await prisma.$executeRawUnsafe(
            `INSERT INTO brands (name, code, tecdoc_id, created_at, updated_at)
             VALUES ($1, $2, $3, NOW(), NOW())
             ON CONFLICT (name) DO UPDATE SET
               tecdoc_id = EXCLUDED.tecdoc_id,
               updated_at = NOW()`,
            name, `${code}_${tecdocId}`, tecdocId
          );
          upserted++;
        } catch (err2) {
          logger.warn({ err: err2, name, code }, "Brand upsert failed (skipping)");
        }
      }
    }

    // Delete brands not in TecDoc (including null tecdocId) with no products
    const tecdocIds = rawBrands.map((b) => b.dataSupplierId);
    const deleted = await prisma.brand.deleteMany({
      where: {
        OR: [
          { tecdocId: { notIn: tecdocIds } },
          { tecdocId: null },
        ],
        productMaps: { none: {} },
      },
    });

    const totalInDb = await prisma.brand.count();

    logger.info({ fetched: rawBrands.length, upserted, deleted: deleted.count, totalInDb }, "TecDoc sync-brands completed");

    return {
      fetched: rawBrands.length,
      upserted,
      deleted: deleted.count,
      totalInDb,
      brands: rawBrands.slice(0, 20).map((b) => ({
        id: b.dataSupplierId,
        name: b.dataSupplierName,
      })),
    };
  });
}

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

  // Get vehicle linkages for an article
  app.get("/tecdoc/linkages", async (request, reply) => {
    const schema = z.object({
      articleId: z.coerce.number().int().min(1),
    });

    const parsed = schema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Bad Request",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { articleId } = parsed.data;
    const tecdoc = getTecDocService();

    try {
      const linkages = await tecdoc.getArticleLinkages(articleId);
      return reply.send({ linkages, total: linkages.length });
    } catch (err) {
      request.log.error({ err }, "TecDoc linkages error");
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
}

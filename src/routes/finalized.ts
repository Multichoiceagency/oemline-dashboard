import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { getAllSettings } from "./settings.js";
import { meili, PRODUCTS_INDEX } from "../lib/meilisearch.js";

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(250).default(50),
  q: z.string().optional(),
  brand: z.string().optional(),
  category: z.string().optional(),
  supplier: z.string().optional(),
  hasStock: z.enum(["true", "false"]).optional(),
  hasPrice: z.enum(["true", "false"]).optional(),
  hasImage: z.enum(["true", "false"]).optional(),
});

interface IcMappingRow {
  product_id: number;
  tow_kod: string;
  ic_description: string;
  ic_manufacturer: string;
  ic_article_number: string;
  ic_ean: string | null;
  ic_weight: number | null;
}

export async function finalizedRoutes(app: FastifyInstance) {
  // ─── GET /finalized ─── Paginated finalized products with all combined data
  app.get("/finalized", async (request) => {
    const query = listQuerySchema.parse(request.query);
    const { page, limit, q, brand, category, supplier, hasStock, hasPrice, hasImage } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      status: "active",
    };

    if (brand) {
      where.brand = { code: brand };
    }

    if (category) {
      where.category = { code: category };
    }

    if (supplier) {
      where.supplier = { code: supplier };
    }

    if (hasStock === "true") {
      where.stock = { not: null, gt: 0 };
    } else if (hasStock === "false") {
      where.OR = [{ stock: null }, { stock: 0 }];
    }

    if (hasPrice === "true") {
      where.price = { not: null };
    } else if (hasPrice === "false") {
      where.price = null;
    }

    if (hasImage === "true") {
      where.imageUrl = { not: null };
    } else if (hasImage === "false") {
      where.imageUrl = null;
    }

    if (q) {
      // If other OR conditions exist (from hasStock=false), we need to wrap with AND
      const searchOr = [
        { sku: { contains: q, mode: "insensitive" } },
        { articleNo: { contains: q, mode: "insensitive" } },
        { ean: { contains: q, mode: "insensitive" } },
        { tecdocId: { contains: q, mode: "insensitive" } },
        { oem: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
      ];

      if (where.OR) {
        // Combine existing OR (hasStock=false) with search OR using AND
        const existingOr = where.OR;
        delete where.OR;
        where.AND = [
          { OR: existingOr as Record<string, unknown>[] },
          { OR: searchOr },
        ];
      } else {
        where.OR = searchOr;
      }
    }

    const [items, total] = await Promise.all([
      prisma.productMap.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: "desc" },
        include: {
          brand: { select: { id: true, name: true, code: true, logoUrl: true } },
          category: { select: { id: true, name: true, code: true } },
          supplier: { select: { id: true, name: true, code: true } },
        },
      }),
      prisma.productMap.count({ where }),
    ]);

    // Fetch IC mappings for returned products via LATERAL join (one mapping per product)
    let icMappings = new Map<number, IcMappingRow>();
    if (items.length > 0) {
      try {
        const productIds = items.map((p) => p.id);
        const icRows = await prisma.$queryRawUnsafe<IcMappingRow[]>(
          `SELECT pm.id AS product_id,
                  ic.tow_kod,
                  ic.description AS ic_description,
                  ic.manufacturer AS ic_manufacturer,
                  ic.article_number AS ic_article_number,
                  ic.ean AS ic_ean,
                  ic.weight AS ic_weight
           FROM product_maps pm
           JOIN brands b ON b.id = pm.brand_id
           LEFT JOIN LATERAL (
             SELECT im.tow_kod, im.description, im.manufacturer, im.article_number, im.ean, im.weight
             FROM intercars_mappings im
             WHERE UPPER(regexp_replace(im.article_number, '[^a-zA-Z0-9]', '', 'g'))
                     = UPPER(regexp_replace(pm.article_no, '[^a-zA-Z0-9]', '', 'g'))
               AND (
                 UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g'))
                   = UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))
                 OR (
                   LENGTH(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) >= 3
                   AND UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))
                     LIKE UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) || '%'
                 )
                 OR (
                   LENGTH(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) >= 3
                   AND UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g'))
                     LIKE UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) || '%'
                 )
               )
             LIMIT 1
           ) ic ON true
           WHERE pm.id = ANY($1::int[]) AND ic.tow_kod IS NOT NULL`,
          productIds
        );
        for (const row of icRows) {
          icMappings.set(row.product_id, row);
        }
      } catch (err) {
        logger.warn({ err }, "Failed to fetch IC mappings for finalized products");
      }
    }

    // Fetch pricing settings for calculated prices
    const settings = await getAllSettings();
    const taxRate = parseFloat(settings.tax_rate ?? "21") / 100;
    const marginPct = parseFloat(settings.margin_percentage ?? "0") / 100;

    const finalizedItems = items.map((p) => {
      const ic = icMappings.get(p.id);
      const basePrice = p.price;
      let priceWithMargin: number | null = null;
      let priceWithTax: number | null = null;
      if (basePrice != null) {
        priceWithMargin = Math.round(basePrice * (1 + marginPct) * 100) / 100;
        priceWithTax = Math.round(priceWithMargin * (1 + taxRate) * 100) / 100;
      }

      return {
        id: p.id,
        articleNo: p.articleNo,
        sku: p.sku,
        description: p.description,
        imageUrl: p.imageUrl,
        images: p.images,
        ean: p.ean,
        tecdocId: p.tecdocId,
        oem: p.oem,
        genericArticle: p.genericArticle,
        oemNumbers: p.oemNumbers,
        price: basePrice,
        priceWithMargin,
        priceWithTax,
        currency: p.currency,
        stock: p.stock,
        weight: p.weight,
        status: p.status,
        brand: p.brand,
        category: p.category,
        supplier: p.supplier,
        icMapping: ic
          ? {
              towKod: ic.tow_kod,
              icDescription: ic.ic_description,
              icManufacturer: ic.ic_manufacturer,
              icArticleNumber: ic.ic_article_number,
              icEan: ic.ic_ean,
              icWeight: ic.ic_weight,
            }
          : null,
        updatedAt: p.updatedAt,
        createdAt: p.createdAt,
      };
    });

    return {
      items: finalizedItems,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      pricing: {
        taxRate: taxRate * 100,
        marginPercentage: marginPct * 100,
      },
    };
  });

  // ─── GET /finalized/stats ─── Summary statistics
  app.get("/finalized/stats", async () => {
    const activeWhere = { status: "active" as const };

    const [
      totalProducts,
      withPrice,
      withStock,
      withImage,
      topBrandsRaw,
      topCategoriesRaw,
    ] = await Promise.all([
      prisma.productMap.count({ where: activeWhere }),
      prisma.productMap.count({ where: { ...activeWhere, price: { not: null } } }),
      prisma.productMap.count({ where: { ...activeWhere, stock: { not: null, gt: 0 } } }),
      prisma.productMap.count({ where: { ...activeWhere, imageUrl: { not: null } } }),
      prisma.productMap.groupBy({
        by: ["brandId"],
        where: activeWhere,
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 20,
      }),
      prisma.productMap.groupBy({
        by: ["categoryId"],
        where: { ...activeWhere, categoryId: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 20,
      }),
    ]);

    // IC mapping count — count products with stored icSku (direct IC link)
    let withIcMapping = 0;
    try {
      withIcMapping = await prisma.productMap.count({
        where: {
          status: "active",
          icSku: { not: null },
        },
      });
    } catch (err) {
      logger.warn({ err }, "Failed to count IC mappings for finalized stats");
    }

    // Resolve brand names
    const brandIds = topBrandsRaw.map((b) => b.brandId);
    const brands = await prisma.brand.findMany({
      where: { id: { in: brandIds } },
      select: { id: true, name: true, code: true, logoUrl: true },
    });
    const brandMap = new Map(brands.map((b) => [b.id, b]));

    const topBrands = topBrandsRaw.map((b) => ({
      brand: brandMap.get(b.brandId) ?? { id: b.brandId, name: "Unknown", code: "unknown", logoUrl: null },
      count: b._count.id,
    }));

    // Resolve category names
    const categoryIds = topCategoriesRaw
      .map((c) => c.categoryId)
      .filter((id): id is number => id !== null);
    const categories = await prisma.category.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, name: true, code: true },
    });
    const categoryMap = new Map(categories.map((c) => [c.id, c]));

    const topCategories = topCategoriesRaw.map((c) => ({
      category: c.categoryId
        ? categoryMap.get(c.categoryId) ?? { id: c.categoryId, name: "Unknown", code: "unknown" }
        : null,
      count: c._count.id,
    }));

    // Meilisearch index stats
    let indexStats = { numberOfDocuments: 0, isIndexing: false, fieldDistribution: {} as Record<string, number> };
    try {
      const meiliStats = await meili.index(PRODUCTS_INDEX).getStats();
      indexStats = {
        numberOfDocuments: meiliStats.numberOfDocuments,
        isIndexing: meiliStats.isIndexing,
        fieldDistribution: meiliStats.fieldDistribution as Record<string, number>,
      };
    } catch (err) {
      logger.warn({ err }, "Failed to fetch Meilisearch index stats");
    }

    return {
      totalProducts,
      withPrice,
      withStock,
      withImage,
      withIcMapping,
      topBrands,
      topCategories,
      indexStats,
    };
  });

  // ─── GET /finalized/:id ─── Single product with full details including IC mapping
  app.get("/finalized/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const productId = parseInt(id, 10);

    if (isNaN(productId)) {
      return reply.code(400).send({ error: "Invalid product ID" });
    }

    const product = await prisma.productMap.findUnique({
      where: { id: productId },
      include: {
        brand: { select: { id: true, name: true, code: true, logoUrl: true } },
        category: { select: { id: true, name: true, code: true } },
        supplier: { select: { id: true, name: true, code: true } },
      },
    });

    if (!product) {
      return reply.code(404).send({ error: "Product not found" });
    }

    // Fetch IC mapping via raw SQL
    let icMapping = null;
    try {
      const icRows = await prisma.$queryRawUnsafe<Array<{
        tow_kod: string;
        ic_index: string;
        article_number: string;
        manufacturer: string;
        description: string;
        ean: string | null;
        weight: number | null;
        tecdoc_prod: number | null;
        blocked_return: boolean;
      }>>(
        `SELECT im.tow_kod, im.ic_index, im.article_number, im.manufacturer,
                im.description, im.ean, im.weight, im.tecdoc_prod, im.blocked_return
         FROM intercars_mappings im
         JOIN brands b ON b.id = $2
         WHERE UPPER(regexp_replace(im.article_number, '[^a-zA-Z0-9]', '', 'g'))
                 = UPPER(regexp_replace($1, '[^a-zA-Z0-9]', '', 'g'))
           AND (
             UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g'))
               = UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))
             OR (
               LENGTH(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) >= 3
               AND UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))
                 LIKE UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) || '%'
             )
             OR (
               LENGTH(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) >= 3
               AND UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g'))
                 LIKE UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) || '%'
             )
           )
         LIMIT 5`,
        product.articleNo,
        product.brandId
      );

      if (icRows.length > 0) {
        icMapping = icRows.map((row) => ({
          towKod: row.tow_kod,
          icIndex: row.ic_index,
          articleNumber: row.article_number,
          manufacturer: row.manufacturer,
          description: row.description,
          ean: row.ean,
          weight: row.weight,
          tecdocProd: row.tecdoc_prod,
          blockedReturn: row.blocked_return,
        }));
      }
    } catch (err) {
      logger.warn({ err, productId }, "Failed to fetch IC mapping for finalized product");
    }

    // Calculate prices with margin and tax
    const settings = await getAllSettings();
    const taxRate = parseFloat(settings.tax_rate ?? "21") / 100;
    const marginPct = parseFloat(settings.margin_percentage ?? "0") / 100;

    const basePrice = product.price;
    let priceWithMargin: number | null = null;
    let priceWithTax: number | null = null;
    if (basePrice != null) {
      priceWithMargin = Math.round(basePrice * (1 + marginPct) * 100) / 100;
      priceWithTax = Math.round(priceWithMargin * (1 + taxRate) * 100) / 100;
    }

    return {
      id: product.id,
      articleNo: product.articleNo,
      sku: product.sku,
      description: product.description,
      imageUrl: product.imageUrl,
      images: product.images,
      ean: product.ean,
      tecdocId: product.tecdocId,
      oem: product.oem,
      genericArticle: product.genericArticle,
      oemNumbers: product.oemNumbers,
      price: basePrice,
      priceWithMargin,
      priceWithTax,
      currency: product.currency,
      stock: product.stock,
      weight: product.weight,
      status: product.status,
      brand: product.brand,
      category: product.category,
      supplier: product.supplier,
      icMapping,
      updatedAt: product.updatedAt,
      createdAt: product.createdAt,
    };
  });

  // ─── POST /finalized/:id/push ─── Push product to configured output API
  app.post("/finalized/:id/push", async (request, reply) => {
    const { id } = request.params as { id: string };
    const productId = parseInt(id, 10);

    if (isNaN(productId)) {
      return reply.code(400).send({ error: "Invalid product ID" });
    }

    const settings = await getAllSettings();
    const outputApiUrl = settings.output_api_url ?? "";
    const outputApiKey = settings.output_api_key ?? "";

    if (!outputApiUrl) {
      return reply.code(400).send({ error: "Output API URL not configured. Set it in Settings." });
    }

    const product = await prisma.productMap.findUnique({
      where: { id: productId },
      include: {
        brand: { select: { id: true, name: true, code: true, logoUrl: true } },
        category: { select: { id: true, name: true, code: true } },
        supplier: { select: { id: true, name: true, code: true } },
      },
    });

    if (!product) {
      return reply.code(404).send({ error: "Product not found" });
    }

    const taxRate = parseFloat(settings.tax_rate ?? "21") / 100;
    const marginPct = parseFloat(settings.margin_percentage ?? "0") / 100;

    const basePrice = product.price;
    let priceWithMargin: number | null = null;
    let priceWithTax: number | null = null;
    if (basePrice != null) {
      priceWithMargin = Math.round(basePrice * (1 + marginPct) * 100) / 100;
      priceWithTax = Math.round(priceWithMargin * (1 + taxRate) * 100) / 100;
    }

    const payload = {
      id: product.id,
      articleNo: product.articleNo,
      sku: product.sku,
      description: product.description,
      imageUrl: product.imageUrl,
      images: product.images,
      ean: product.ean,
      tecdocId: product.tecdocId,
      oem: product.oem,
      genericArticle: product.genericArticle,
      oemNumbers: product.oemNumbers,
      price: basePrice,
      priceWithMargin,
      priceWithTax,
      currency: product.currency ?? settings.currency,
      stock: product.stock,
      weight: product.weight,
      status: product.status,
      brand: product.brand,
      category: product.category,
      supplier: product.supplier,
      updatedAt: product.updatedAt,
    };

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (outputApiKey) headers["X-API-Key"] = outputApiKey;

      const response = await fetch(outputApiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        logger.warn({ productId, status: response.status, url: outputApiUrl }, "Output API push failed");
        return reply.code(502).send({ error: `Output API returned ${response.status}: ${text.slice(0, 200)}` });
      }

      logger.info({ productId, url: outputApiUrl }, "Product pushed to output API");
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ productId, err: message }, "Output API push error");
      return reply.code(502).send({ error: `Failed to reach output API: ${message}` });
    }
  });
}

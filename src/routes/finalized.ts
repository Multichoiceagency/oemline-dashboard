import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { getAllSettings } from "./settings.js";
import { meili, PRODUCTS_INDEX } from "../lib/meilisearch.js";
import { pushQueue } from "../workers/queues.js";
import { cacheGet, cacheSet, cacheWrap, hashQuery } from "../services/cache.js";

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(250).default(50),
  q: z.string().optional(),
  brand: z.string().optional(),
  category: z.string().optional(),
  categoryId: z.coerce.number().int().optional(),
  supplier: z.string().optional(),
  /** Comma-separated supplier codes — e.g. "intercars,vanwezel,diederichs". */
  suppliers: z.string().optional(),
  /** Cap maximum price to avoid showing industrial/wholesale-only products. */
  maxPrice: z.coerce.number().positive().optional(),
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
    const { page, limit, q, brand, category, categoryId, supplier, suppliers, maxPrice, hasStock, hasPrice, hasImage } = query;

    // Blanket catalog cache (60s). Keyed by a hash of every query parameter so
    // repeated storefront requests with the same filters skip the DB entirely.
    // This is the single biggest Postgres-load reduction for the storefront:
    // under 10K concurrent users reading the same catalogue page, only ~1 DB
    // hit per minute per unique filter combination.
    const catalogCacheKey = hashQuery(query as unknown as Record<string, unknown>);
    const cachedCatalog = await cacheGet<unknown>("catalog", [catalogCacheKey]);
    if (cachedCatalog) return cachedCatalog;

    // Legacy small-query cache kept as fallback; cache writes now both keys.
    if (q && !brand && !category && !categoryId && !supplier && !suppliers && !maxPrice && !hasStock && !hasPrice && !hasImage && limit <= 10) {
      const cacheKeyParts = ["finalized", q, String(page), String(limit)];
      const cached = await cacheGet<unknown>("pricing", cacheKeyParts);
      if (cached) return cached;
    }

    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      status: "active",
    };

    if (brand) {
      where.brand = { code: brand };
    }

    if (categoryId) {
      where.categoryId = categoryId;
    } else if (category) {
      where.category = { code: category };
    }

    if (supplier) {
      where.supplier = { code: supplier };
    } else if (suppliers) {
      const codes = suppliers.split(",").map((s) => s.trim()).filter(Boolean);
      if (codes.length > 0) where.supplier = { code: { in: codes } };
    }

    if (hasStock === "true") {
      where.stock = { not: null, gt: 0 };
    } else if (hasStock === "false") {
      where.OR = [{ stock: null }, { stock: 0 }];
    }

    // maxPrice is the RETAIL cap the customer sees (incl. margin + VAT).
    // Convert to a wholesale-base cap using current pricing settings so the
    // SQL filter on product_maps.price (which is the raw base) is correct.
    let baseCap: number | null = null;
    if (maxPrice != null) {
      const s = await getAllSettings();
      const marginPct = parseFloat(s.margin_percentage ?? "0") / 100;
      const taxRate = parseFloat(s.tax_rate ?? "21") / 100;
      const multiplier = (1 + marginPct) * (1 + taxRate);
      baseCap = multiplier > 0 ? maxPrice / multiplier : maxPrice;
    }

    // Compose price filter from hasPrice + maxPrice. Both can be combined.
    if (hasPrice === "true" && baseCap != null) {
      where.price = { not: null, lte: baseCap };
    } else if (hasPrice === "true") {
      where.price = { not: null };
    } else if (hasPrice === "false") {
      where.price = null;
    } else if (baseCap != null) {
      where.price = { lte: baseCap };
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

    // When searching (q is set): fetch extra rows and deduplicate in memory.
    // Same brand+articleNo can exist from multiple suppliers (TecDoc, IC, VanWezel, etc.)
    // Keep the "best" version: has price > has image > most recently updated.
    const isSearchQuery = !!q;
    const fetchLimit = isSearchQuery ? Math.min(limit * 4, 500) : limit;
    const fetchSkip = isSearchQuery ? 0 : skip; // dedup pagination is approximated for q-searches

    const [rawItems, total] = await Promise.all([
      prisma.productMap.findMany({
        where,
        skip: fetchSkip,
        take: fetchLimit,
        orderBy: [
          { price: { sort: "desc", nulls: "last" } }, // prefer products with price
          { imageUrl: { sort: "desc", nulls: "last" } }, // then with image
          { updatedAt: "desc" },
        ],
        include: {
          brand: { select: { id: true, name: true, code: true, logoUrl: true } },
          category: { select: { id: true, name: true, code: true } },
          supplier: { select: { id: true, name: true, code: true } },
        },
      }),
      prisma.productMap.count({ where }),
    ]);

    // Deduplicate: keep 1 product per brand + normalized articleNo
    let items: typeof rawItems;
    let deduplicatedTotal = total;
    if (isSearchQuery) {
      const seen = new Map<string, typeof rawItems[0]>();
      for (const item of rawItems) {
        const key = `${item.brandId}_${(item.articleNo ?? item.sku).toUpperCase().replace(/[^A-Z0-9]/g, "")}`;
        if (!seen.has(key)) seen.set(key, item);
      }
      const allDeduped = Array.from(seen.values());
      const pageStart = skip; // use original skip for the deduped array
      items = allDeduped.slice(pageStart, pageStart + limit);
      deduplicatedTotal = allDeduped.length;
    } else {
      items = rawItems;
    }

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
        articleCriteria: p.articleCriteria ?? [],
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

    const result = {
      items: finalizedItems,
      total: deduplicatedTotal,
      page,
      limit,
      totalPages: Math.ceil(deduplicatedTotal / limit),
      pricing: {
        taxRate: taxRate * 100,
        marginPercentage: marginPct * 100,
      },
    };

    // Catalog cache (60s TTL) for any parameter combination
    await cacheSet("catalog", [catalogCacheKey], result);

    // Legacy storefront article lookup cache
    if (q && !brand && !category && !categoryId && !supplier && !hasStock && !hasPrice && !hasImage && limit <= 10) {
      await cacheSet("pricing", ["finalized", q, String(page), String(limit)], result);
    }

    return result;
  });

  // ─── GET /finalized/stats ─── Summary statistics
  app.get("/finalized/stats", async () => {
    // Heavy groupBy on 1.6M rows — cache aggressively (5 min). Stats rarely
    // move meaningfully between refreshes, and the query can trigger shm
    // shortages under load; serving from Redis avoids that entirely.
    const statsCached = await cacheGet<unknown>("catalog", ["stats-v2"]);
    if (statsCached) return statsCached;

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

    const statsResult = {
      totalProducts,
      withPrice,
      withStock,
      withImage,
      withIcMapping,
      topBrands,
      topCategories,
      indexStats,
    };
    await cacheSet("catalog", ["stats-v2"], statsResult);
    return statsResult;
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
        stockByLoc: {
          include: {
            location: {
              select: { id: true, code: true, name: true, country: true, sortOrder: true, active: true },
            },
          },
        },
      },
    });

    if (!product) {
      return reply.code(404).send({ error: "Product not found" });
    }

    // Reshape per-location stock for the storefront — only active locations,
    // sorted, missing combinations omitted (storefront treats absence as 0).
    const stockByLocation = product.stockByLoc
      .filter((s) => s.location.active)
      .sort((a, b) => a.location.sortOrder - b.location.sortOrder || a.location.name.localeCompare(b.location.name))
      .map((s) => ({
        locationId: s.location.id,
        code: s.location.code,
        name: s.location.name,
        country: s.location.country,
        quantity: s.quantity,
      }));

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
      stockByLocation,
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

  // ─── POST /batch/articles ─── Fast batch lookup by article numbers (single query)
  app.post("/batch/articles", async (request, reply) => {
    const body = request.body as { articleNumbers?: string[]; suppliers?: string[]; maxPrice?: number };
    if (!Array.isArray(body?.articleNumbers) || body.articleNumbers.length === 0) {
      return reply.code(400).send({ error: "articleNumbers array required (1-100)" });
    }

    const articleNumbers = body.articleNumbers.slice(0, 100).map((a) => String(a).trim()).filter(Boolean);
    if (articleNumbers.length === 0) {
      return { items: {}, found: 0, requested: 0 };
    }

    const supplierCodes = Array.isArray(body.suppliers)
      ? body.suppliers.map((s) => String(s).trim()).filter(Boolean)
      : [];
    const maxRetailPrice = typeof body.maxPrice === "number" && body.maxPrice > 0 ? body.maxPrice : null;
    // Translate the retail cap to a wholesale-base cap (same multiplier as /finalized).
    let maxPrice: number | null = null;
    if (maxRetailPrice != null) {
      const s = await getAllSettings();
      const marginPct = parseFloat(s.margin_percentage ?? "0") / 100;
      const taxRate = parseFloat(s.tax_rate ?? "21") / 100;
      const multiplier = (1 + marginPct) * (1 + taxRate);
      maxPrice = multiplier > 0 ? maxRetailPrice / multiplier : maxRetailPrice;
    }

    // Normalize for matching: uppercase, alphanumeric only
    const normalized = articleNumbers.map((a) => a.replace(/[^a-zA-Z0-9]/g, "").toUpperCase());

    // Check Redis cache first — key must include filter scope so different callers don't collide
    const cacheKey = [normalized.slice().sort().join(","), supplierCodes.sort().join(","), maxPrice ?? ""].join("|");
    const cached = await cacheGet<Record<string, unknown>>("pricing", ["batch", cacheKey]);
    if (cached) {
      return cached;
    }

    // Single DB query — find all matching products
    const products = await prisma.$queryRawUnsafe<Array<{
      id: number;
      article_no: string;
      sku: string | null;
      description: string | null;
      image_url: string | null;
      images: unknown;
      ean: string | null;
      tecdoc_id: string | null;
      oem: string | null;
      generic_article: string | null;
      oem_numbers: unknown;
      article_criteria: unknown;
      price: number | null;
      currency: string;
      stock: number | null;
      weight: number | null;
      status: string;
      ic_sku: string | null;
      brand_id: number | null;
      brand_name: string | null;
      brand_code: string | null;
      brand_logo_url: string | null;
      category_id: number | null;
      category_name: string | null;
      category_code: string | null;
      supplier_id: number | null;
      supplier_name: string | null;
      supplier_code: string | null;
      updated_at: Date;
      created_at: Date;
    }>>(
      `SELECT
        p.id, p.article_no, p.sku, p.description, p.image_url, p.images,
        p.ean, p.tecdoc_id, p.oem, p.generic_article, p.oem_numbers,
        p.article_criteria,
        p.price, p.currency, p.stock, p.weight, p.status, p.ic_sku,
        p.updated_at, p.created_at,
        b.id AS brand_id, b.name AS brand_name, b.code AS brand_code, b.logo_url AS brand_logo_url,
        c.id AS category_id, c.name AS category_name, c.code AS category_code,
        s.id AS supplier_id, s.name AS supplier_name, s.code AS supplier_code
      FROM product_maps p
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.status = 'active'
        AND UPPER(REGEXP_REPLACE(p.article_no, '[^a-zA-Z0-9]', '', 'g')) = ANY($1::text[])
        ${supplierCodes.length > 0 ? `AND s.code = ANY($2::text[])` : ``}
        ${maxPrice != null ? `AND (p.price IS NULL OR p.price <= ${maxPrice})` : ``}`,
      normalized,
      ...(supplierCodes.length > 0 ? [supplierCodes] : [])
    );

    // Apply pricing
    const settings = await getAllSettings();
    const taxRate = parseFloat(settings.tax_rate ?? "21") / 100;
    const marginPct = parseFloat(settings.margin_percentage ?? "0") / 100;

    const items: Record<string, unknown> = {};
    for (const row of products) {
      const key = row.article_no.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
      const basePrice = row.price;
      let priceWithMargin: number | null = null;
      let priceWithTax: number | null = null;
      if (basePrice != null) {
        priceWithMargin = Math.round(basePrice * (1 + marginPct) * 100) / 100;
        priceWithTax = Math.round(priceWithMargin * (1 + taxRate) * 100) / 100;
      }

      items[key] = {
        id: row.id,
        articleNo: row.article_no,
        sku: row.sku,
        description: row.description,
        imageUrl: row.image_url,
        images: row.images ?? [],
        ean: row.ean,
        tecdocId: row.tecdoc_id,
        oem: row.oem,
        genericArticle: row.generic_article,
        oemNumbers: row.oem_numbers ?? [],
        articleCriteria: row.article_criteria ?? [],
        price: basePrice,
        priceWithMargin,
        priceWithTax,
        currency: row.currency,
        stock: row.stock,
        weight: row.weight,
        status: row.status,
        icSku: row.ic_sku,
        brand: row.brand_id ? { id: row.brand_id, name: row.brand_name, code: row.brand_code, logoUrl: row.brand_logo_url } : null,
        category: row.category_id ? { id: row.category_id, name: row.category_name, code: row.category_code } : null,
        supplier: row.supplier_id ? { id: row.supplier_id, name: row.supplier_name, code: row.supplier_code } : null,
        updatedAt: row.updated_at,
        createdAt: row.created_at,
      };
    }

    // Override-lookup for articles we didn't find directly. When an admin has
    // manually mapped (supplier, brand, articleNo) → sku in the overrides
    // table, use that sku to fetch the linked product_map row. This matters
    // for the kenteken flow: a customer sees TecDoc articles that may not
    // have been synced to product_maps yet, but a manual override can still
    // pin them to the correct inventory SKU.
    const missingNormalized = normalized.filter((n) => !items[n]);
    if (missingNormalized.length > 0) {
      try {
        const overrideRows = await prisma.$queryRawUnsafe<Array<{
          norm_key: string;
          sku: string;
        }>>(
          `SELECT DISTINCT
             UPPER(REGEXP_REPLACE(o.article_no, '[^a-zA-Z0-9]', '', 'g')) AS norm_key,
             o.sku
           FROM overrides o
           JOIN suppliers s ON s.id = o.supplier_id
           WHERE o.active = true
             AND UPPER(REGEXP_REPLACE(o.article_no, '[^a-zA-Z0-9]', '', 'g')) = ANY($1::text[])
             ${supplierCodes.length > 0 ? `AND s.code = ANY($2::text[])` : ``}`,
          missingNormalized,
          ...(supplierCodes.length > 0 ? [supplierCodes] : [])
        );

        if (overrideRows.length > 0) {
          const skuToNorm = new Map<string, string>();
          for (const r of overrideRows) skuToNorm.set(r.sku, r.norm_key);

          const overrideProducts = await prisma.$queryRawUnsafe<typeof products>(
            `SELECT
              p.id, p.article_no, p.sku, p.description, p.image_url, p.images,
              p.ean, p.tecdoc_id, p.oem, p.generic_article, p.oem_numbers,
              p.price, p.currency, p.stock, p.weight, p.status, p.ic_sku,
              p.updated_at, p.created_at,
              b.id AS brand_id, b.name AS brand_name, b.code AS brand_code, b.logo_url AS brand_logo_url,
              c.id AS category_id, c.name AS category_name, c.code AS category_code,
              s.id AS supplier_id, s.name AS supplier_name, s.code AS supplier_code
            FROM product_maps p
            LEFT JOIN brands b ON b.id = p.brand_id
            LEFT JOIN categories c ON c.id = p.category_id
            LEFT JOIN suppliers s ON s.id = p.supplier_id
            WHERE p.status = 'active' AND p.sku = ANY($1::text[])
              ${maxPrice != null ? `AND (p.price IS NULL OR p.price <= ${maxPrice})` : ``}`,
            [...skuToNorm.keys()]
          );

          for (const row of overrideProducts) {
            if (!row.sku) continue;
            const normKey = skuToNorm.get(row.sku);
            if (!normKey || items[normKey]) continue;
            const basePrice = row.price;
            let priceWithMargin: number | null = null;
            let priceWithTax: number | null = null;
            if (basePrice != null) {
              priceWithMargin = Math.round(basePrice * (1 + marginPct) * 100) / 100;
              priceWithTax = Math.round(priceWithMargin * (1 + taxRate) * 100) / 100;
            }
            items[normKey] = {
              id: row.id,
              articleNo: row.article_no,
              sku: row.sku,
              description: row.description,
              imageUrl: row.image_url,
              images: row.images ?? [],
              ean: row.ean,
              tecdocId: row.tecdoc_id,
              oem: row.oem,
              genericArticle: row.generic_article,
              oemNumbers: row.oem_numbers ?? [],
        articleCriteria: row.article_criteria ?? [],
              price: basePrice,
              priceWithMargin,
              priceWithTax,
              currency: row.currency,
              stock: row.stock,
              weight: row.weight,
              status: row.status,
              icSku: row.ic_sku,
              brand: row.brand_id ? { id: row.brand_id, name: row.brand_name, code: row.brand_code, logoUrl: row.brand_logo_url } : null,
              category: row.category_id ? { id: row.category_id, name: row.category_name, code: row.category_code } : null,
              supplier: row.supplier_id ? { id: row.supplier_id, name: row.supplier_name, code: row.supplier_code } : null,
              matchedVia: "override",
              updatedAt: row.updated_at,
              createdAt: row.created_at,
            };
          }
        }
      } catch (err) {
        // Override lookup failure is non-fatal — the direct match still works.
        // Falls through to the existing response.
      }
    }

    const result = { items, found: Object.keys(items).length, requested: articleNumbers.length };

    // Cache for 60 seconds
    await cacheSet("pricing", ["batch", cacheKey], result);

    return result;
  });

  // ─── POST /finalized/push-all ─── Enqueue bulk push of all active products to output API
  app.post("/finalized/push-all", async (request, reply) => {
    const settings = await getAllSettings();
    const outputApiUrl = settings.output_api_url ?? "";

    if (!outputApiUrl) {
      return reply.code(400).send({ error: "Output API URL not configured. Set it in Settings." });
    }

    const body = (request.body ?? {}) as { supplierCode?: string };
    const jobName = `push-all-manual${body.supplierCode ? `-${body.supplierCode}` : ""}`;

    const job = await pushQueue.add(jobName, { supplierCode: body.supplierCode }, { priority: 1 });

    return { jobId: job.id, queue: "push", status: "queued", outputApiUrl };
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

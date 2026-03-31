import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { getAllSettings } from "./settings.js";

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(250).default(50),
  q: z.string().optional(),
  brand: z.string().optional(),
  category: z.string().optional(),
  categoryId: z.coerce.number().int().optional(),
  categoryIds: z.string().optional(), // comma-separated category IDs
  minPrice: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional(),
  inStock: z.enum(["true", "false"]).optional(),
  hasPrice: z.enum(["true", "false"]).optional(),
  sort: z.enum(["price_asc", "price_desc", "name_asc", "name_desc", "newest", "updated"]).optional(),
});

const detailQuerySchema = z.object({
  articleNo: z.string().optional(),
  ean: z.string().optional(),
  oem: z.string().optional(),
});

/**
 * OEMline Storefront API — official public-facing product API.
 *
 * All prices include margin + tax from settings.
 * No internal supplier details (InterCars, TecDoc IDs, IC SKUs) are exposed.
 * This is the API the storefront and external integrations consume.
 */
export async function storefrontRoutes(app: FastifyInstance) {

  // ─── GET /storefront/products ─── Paginated product listing with calculated prices
  app.get("/storefront/products", async (request) => {
    const query = listQuerySchema.parse(request.query);
    const { page, limit, q, brand, category, categoryId, categoryIds, minPrice, maxPrice, inStock, hasPrice, sort } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { status: "active" };

    if (q) {
      where.OR = [
        { articleNo: { contains: q, mode: "insensitive" } },
        { sku: { contains: q, mode: "insensitive" } },
        { ean: { contains: q, mode: "insensitive" } },
        { oem: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { brand: { name: { contains: q, mode: "insensitive" } } },
      ];
    }

    if (brand) where.brand = { code: brand };

    if (categoryIds) {
      const ids = categoryIds.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
      if (ids.length > 0) where.categoryId = { in: ids };
    } else if (categoryId) {
      where.categoryId = categoryId;
    } else if (category) {
      where.category = { code: category };
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      const priceFilter: Record<string, number> = {};
      if (minPrice !== undefined) priceFilter.gte = minPrice;
      if (maxPrice !== undefined) priceFilter.lte = maxPrice;
      where.price = priceFilter;
    }

    if (inStock === "true") where.stock = { gt: 0 };

    if (hasPrice === "true") {
      where.price = { ...(where.price as Record<string, number> || {}), not: null, gt: 0 };
    } else if (hasPrice === "false") {
      where.price = null;
    }

    let orderBy: any = [{ price: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }];
    switch (sort) {
      case "price_asc": orderBy = [{ price: { sort: "asc", nulls: "last" } }]; break;
      case "price_desc": orderBy = [{ price: { sort: "desc", nulls: "last" } }]; break;
      case "name_asc": orderBy = { description: "asc" }; break;
      case "name_desc": orderBy = { description: "desc" }; break;
      case "newest": orderBy = { createdAt: "desc" }; break;
      case "updated": orderBy = { updatedAt: "desc" }; break;
    }

    const settings = await getAllSettings();
    const taxRate = parseFloat(settings.tax_rate ?? "21") / 100;
    const marginPct = parseFloat(settings.margin_percentage ?? "0") / 100;

    const [items, total] = await Promise.all([
      prisma.productMap.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          brand: { select: { id: true, name: true, code: true, logoUrl: true } },
          category: { select: { id: true, name: true, code: true, parentId: true } },
        },
      }),
      prisma.productMap.count({ where }),
    ]);

    // Enrich with IC descriptions (richer, Dutch, includes vehicle fitment)
    const icDescriptions = await fetchIcDescriptions(items.map((p) => p.id));

    return {
      items: items.map((p) => formatPublicProduct(p, marginPct, taxRate, icDescriptions.get(p.id))),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  });

  // ─── GET /storefront/products/:id ─── Single product detail
  app.get("/storefront/products/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const product = await prisma.productMap.findUnique({
      where: { id: parseInt(id, 10) },
      include: {
        brand: { select: { id: true, name: true, code: true, logoUrl: true } },
        category: { select: { id: true, name: true, code: true, parentId: true } },
      },
    });

    if (!product) return reply.code(404).send({ error: "Product not found" });

    const settings = await getAllSettings();
    const taxRate = parseFloat(settings.tax_rate ?? "21") / 100;
    const marginPct = parseFloat(settings.margin_percentage ?? "0") / 100;

    const icDescriptions = await fetchIcDescriptions([product.id]);
    return formatPublicProduct(product, marginPct, taxRate, icDescriptions.get(product.id));
  });

  // ─── GET /storefront/lookup ─── Lookup by articleNo, EAN, or OEM
  app.get("/storefront/lookup", async (request, reply) => {
    const query = detailQuerySchema.parse(request.query);

    if (!query.articleNo && !query.ean && !query.oem) {
      return reply.code(400).send({ error: "Provide at least one of: articleNo, ean, oem" });
    }

    const where: Record<string, unknown> = { status: "active" };
    if (query.articleNo) where.articleNo = query.articleNo;
    if (query.ean) where.ean = query.ean;
    if (query.oem) where.oem = query.oem;

    const settings = await getAllSettings();
    const taxRate = parseFloat(settings.tax_rate ?? "21") / 100;
    const marginPct = parseFloat(settings.margin_percentage ?? "0") / 100;

    const products = await prisma.productMap.findMany({
      where,
      take: 50,
      include: {
        brand: { select: { id: true, name: true, code: true, logoUrl: true } },
        category: { select: { id: true, name: true, code: true, parentId: true } },
      },
    });

    const icDescriptions = await fetchIcDescriptions(products.map((p) => p.id));

    return {
      items: products.map((p) => formatPublicProduct(p, marginPct, taxRate, icDescriptions.get(p.id))),
      total: products.length,
    };
  });

  // ─── GET /storefront/brands ─── Public brands list
  app.get("/storefront/brands", async () => {
    const brands = await prisma.brand.findMany({
      where: { showOnStorefront: true },
      orderBy: { name: "asc" },
      include: {
        _count: { select: { productMaps: true } },
      },
    });

    return {
      items: brands.map((b) => ({
        id: b.id,
        name: b.name,
        code: b.code,
        logoUrl: b.logoUrl,
        productCount: b._count.productMaps,
      })),
      total: brands.length,
    };
  });

  // ─── GET /storefront/categories ─── Category tree
  app.get("/storefront/categories", async (request) => {
    const { parentId } = z.object({ parentId: z.coerce.number().int().optional() }).parse(request.query);

    const where: Record<string, unknown> = {};
    if (parentId !== undefined) {
      where.parentId = parentId;
    } else {
      where.parentId = null;
    }
    where.OR = [
      { products: { some: {} } },
      { children: { some: { products: { some: {} } } } },
    ];

    const categories = await prisma.category.findMany({
      where,
      orderBy: { name: "asc" },
      include: {
        _count: { select: { products: true, children: true } },
        children: {
          take: 500,
          orderBy: { name: "asc" },
          where: { products: { some: {} } },
          include: {
            _count: { select: { products: true, children: true } },
          },
        },
      },
    });

    return {
      items: categories.map((c) => ({
        id: c.id,
        name: c.name,
        code: c.code,
        parentId: c.parentId,
        productCount: c._count.products,
        childCount: c.children.length,
        children: c.children.map((ch) => ({
          id: ch.id,
          name: ch.name,
          code: ch.code,
          productCount: ch._count.products,
          childCount: ch._count.children,
        })),
      })),
      total: categories.length,
    };
  });
}

/**
 * Fetch IC CSV descriptions for a set of product IDs.
 * Uses the same LATERAL join as the finalized route.
 * Returns a Map<productId, { description, shortDescription }>.
 */
async function fetchIcDescriptions(productIds: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (productIds.length === 0) return map;

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{
      product_id: number;
      ic_description: string;
    }>>(
      `SELECT pm.id AS product_id,
              ic.description AS ic_description
       FROM product_maps pm
       JOIN brands b ON b.id = pm.brand_id
       LEFT JOIN LATERAL (
         SELECT im.description
         FROM intercars_mappings im
         WHERE im.normalized_article_number = pm.normalized_article_no
           AND (
             im.normalized_manufacturer = b.normalized_name
             OR (LENGTH(b.normalized_name) >= 3 AND im.normalized_manufacturer LIKE b.normalized_name || '%')
             OR (LENGTH(im.normalized_manufacturer) >= 3 AND b.normalized_name LIKE im.normalized_manufacturer || '%')
           )
         LIMIT 1
       ) ic ON true
       WHERE pm.id = ANY($1::int[]) AND ic.description IS NOT NULL AND ic.description != ''`,
      productIds
    );

    for (const row of rows) {
      map.set(row.product_id, row.ic_description);
    }
  } catch (err) {
    logger.warn({ err }, "Failed to fetch IC descriptions for storefront products");
  }

  return map;
}

/**
 * Format a product for public consumption.
 * - Applies margin + tax to base price
 * - Uses IC description when available (richer, Dutch, includes vehicle fitment)
 * - Strips all internal fields (icSku, tecdocId, supplierId, supplier name)
 */
function formatPublicProduct(
  p: Record<string, unknown>,
  marginPct: number,
  taxRate: number,
  icDescription?: string,
) {
  const images = p.images as string[] | null;
  const basePrice = p.price as number | null;

  let price: number | null = null;
  let priceExclTax: number | null = null;
  if (basePrice != null && basePrice > 0) {
    priceExclTax = Math.round(basePrice * (1 + marginPct) * 100) / 100;
    price = Math.round(priceExclTax * (1 + taxRate) * 100) / 100;
  }

  // Use IC description (richer, Dutch, with vehicle fitment) when available
  const productDesc = p.description as string | null;
  const description = icDescription || productDesc || null;

  return {
    id: p.id,
    articleNo: p.articleNo,
    ean: p.ean,
    oem: p.oem,
    description,
    genericArticle: p.genericArticle,
    imageUrl: p.imageUrl,
    images: Array.isArray(images) ? images : [],
    oemNumbers: Array.isArray(p.oemNumbers) ? p.oemNumbers : [],
    price,            // incl. BTW (margin + tax applied)
    priceExclTax,     // excl. BTW (margin applied)
    currency: "EUR",
    stock: p.stock,
    weight: p.weight,
    brand: p.brand,
    category: p.category,
    updatedAt: p.updatedAt,
  };
}

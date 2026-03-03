import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(250).default(50),
  q: z.string().optional(),
  brand: z.string().optional(),
  category: z.string().optional(),
  categoryId: z.coerce.number().int().optional(),
  supplier: z.string().optional(),
  minPrice: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional(),
  inStock: z.enum(["true", "false"]).optional(),
  sort: z.enum(["price_asc", "price_desc", "name_asc", "name_desc", "newest", "updated"]).optional(),
});

const detailQuerySchema = z.object({
  articleNo: z.string().optional(),
  ean: z.string().optional(),
  oem: z.string().optional(),
  tecdocId: z.string().optional(),
});

/**
 * Storefront API — unified endpoint for frontend consumption.
 * All data (product, brand, category, supplier, price, stock, images)
 * is returned in a single response. Queries run in parallel.
 */
export async function storefrontRoutes(app: FastifyInstance) {
  // List products with all related data — optimized for frontend
  app.get("/storefront/products", async (request) => {
    const query = listQuerySchema.parse(request.query);
    const { page, limit, q, brand, category, categoryId, supplier, minPrice, maxPrice, inStock, sort } = query;
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

    if (brand) {
      where.brand = { code: brand };
    }

    if (supplier) {
      where.supplier = { code: supplier };
    }

    if (categoryId) {
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

    if (inStock === "true") {
      where.stock = { gt: 0 };
    }

    let orderBy: Record<string, string> = { updatedAt: "desc" };
    switch (sort) {
      case "price_asc": orderBy = { price: "asc" }; break;
      case "price_desc": orderBy = { price: "desc" }; break;
      case "name_asc": orderBy = { description: "asc" }; break;
      case "name_desc": orderBy = { description: "desc" }; break;
      case "newest": orderBy = { createdAt: "desc" }; break;
      case "updated": orderBy = { updatedAt: "desc" }; break;
    }

    // Run count and data queries in parallel
    const [items, total] = await Promise.all([
      prisma.productMap.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          supplier: { select: { id: true, name: true, code: true } },
          brand: { select: { id: true, name: true, code: true, logoUrl: true } },
          category: { select: { id: true, name: true, code: true, parentId: true } },
        },
      }),
      prisma.productMap.count({ where }),
    ]);

    return {
      items: items.map(formatProduct),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  });

  // Get single product by ID with full details
  app.get("/storefront/products/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const product = await prisma.productMap.findUnique({
      where: { id: parseInt(id, 10) },
      include: {
        supplier: { select: { id: true, name: true, code: true } },
        brand: { select: { id: true, name: true, code: true, logoUrl: true } },
        category: { select: { id: true, name: true, code: true, parentId: true } },
      },
    });

    if (!product) {
      return reply.code(404).send({ error: "Product not found" });
    }

    return formatProduct(product);
  });

  // Lookup product by article number, EAN, OEM, or TecDoc ID
  app.get("/storefront/lookup", async (request, reply) => {
    const query = detailQuerySchema.parse(request.query);

    if (!query.articleNo && !query.ean && !query.oem && !query.tecdocId) {
      return reply.code(400).send({ error: "Provide at least one of: articleNo, ean, oem, tecdocId" });
    }

    const where: Record<string, unknown> = { status: "active" };
    if (query.articleNo) where.articleNo = query.articleNo;
    if (query.ean) where.ean = query.ean;
    if (query.oem) where.oem = query.oem;
    if (query.tecdocId) where.tecdocId = query.tecdocId;

    const products = await prisma.productMap.findMany({
      where,
      take: 50,
      include: {
        supplier: { select: { id: true, name: true, code: true } },
        brand: { select: { id: true, name: true, code: true, logoUrl: true } },
        category: { select: { id: true, name: true, code: true, parentId: true } },
      },
    });

    return {
      items: products.map(formatProduct),
      total: products.length,
    };
  });

  // Get all brands with product counts
  app.get("/storefront/brands", async () => {
    const brands = await prisma.brand.findMany({
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

  // Get category tree
  app.get("/storefront/categories", async (request) => {
    const { parentId } = z.object({ parentId: z.coerce.number().int().optional() }).parse(request.query);

    const where: Record<string, unknown> = {};
    if (parentId !== undefined) {
      where.parentId = parentId;
    } else {
      where.parentId = null;
    }

    const categories = await prisma.category.findMany({
      where,
      orderBy: { name: "asc" },
      include: {
        _count: { select: { products: true, children: true } },
        children: {
          take: 500,
          orderBy: { name: "asc" },
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
        childCount: c._count.children,
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

function formatProduct(p: Record<string, unknown>) {
  const images = p.images as string[] | null;
  return {
    id: p.id,
    sku: p.sku,
    articleNo: p.articleNo,
    ean: p.ean,
    tecdocId: p.tecdocId,
    oem: p.oem,
    description: p.description,
    genericArticle: p.genericArticle,
    imageUrl: p.imageUrl,
    images: Array.isArray(images) ? images : [],
    oemNumbers: Array.isArray(p.oemNumbers) ? p.oemNumbers : [],
    price: p.price,
    currency: p.currency ?? "EUR",
    stock: p.stock,
    weight: p.weight,
    status: p.status,
    supplier: p.supplier,
    brand: p.brand,
    category: p.category,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

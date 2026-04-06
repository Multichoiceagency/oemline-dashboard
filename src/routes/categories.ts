import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { decryptCredentials } from "../lib/crypto.js";

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(250).default(100),
  parentId: z.coerce.number().int().optional(),
  q: z.string().optional(),
  hideEmpty: z.enum(["true", "false"]).default("true"),
});

const updateCategorySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  code: z.string().min(1).max(100).optional(),
  parentId: z.number().int().nullable().optional(),
});

export async function categoryRoutes(app: FastifyInstance) {
  // List categories (tree or flat)
  app.get("/categories", async (request) => {
    const query = listQuerySchema.parse(request.query);
    const { page, limit, parentId, q, hideEmpty } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (parentId !== undefined) {
      where.parentId = parentId;
    } else if (!q) {
      // Top-level categories by default
      where.parentId = null;
    }

    if (q) {
      where.name = { contains: q, mode: "insensitive" };
    }

    if (hideEmpty === "true") {
      // Only show categories that have direct products or at least one child category
      where.OR = [{ products: { some: {} } }, { children: { some: {} } }];
    }

    const [items, total] = await Promise.all([
      prisma.category.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: "asc" },
        include: {
          _count: { select: { products: true, children: true } },
          children: {
            take: 10,
            orderBy: { name: "asc" },
            include: {
              _count: { select: { products: true, children: true } },
            },
          },
        },
      }),
      prisma.category.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  });

  // Get single category with children and products
  app.get("/categories/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const category = await prisma.category.findUnique({
      where: { id: parseInt(id, 10) },
      include: {
        parent: { select: { id: true, name: true, code: true } },
        children: {
          orderBy: { name: "asc" },
          include: {
            _count: { select: { products: true, children: true } },
          },
        },
        _count: { select: { products: true } },
        products: {
          take: 20,
          orderBy: { updatedAt: "desc" },
          include: {
            supplier: { select: { name: true, code: true } },
            brand: { select: { name: true, code: true } },
          },
        },
      },
    });

    if (!category) {
      return reply.code(404).send({ error: "Category not found" });
    }

    return category;
  });

  // Sync categories from TecDoc assembly groups
  app.post("/categories/sync-tecdoc", async (request, reply) => {
    const { config } = await import("../config.js");

    const apiKey = config.TECDOC_API_KEY;
    if (!apiKey) {
      return reply.code(400).send({ error: "TECDOC_API_KEY not configured" });
    }

    const tecdocUrl = config.TECDOC_API_URL || "https://webservice.tecalliance.services/pegasus-3-0/services/TecdocToCatDLB.jsonEndpoint";

    logger.info("Starting TecDoc category sync");

    // Fetch assembly groups via getArticles with assemblyGroupFacetOptions.
    // Response: { assemblyGroupFacets: { total: N, counts: [...flat array...] } }
    // Each item: { assemblyGroupNodeId, assemblyGroupName, parentNodeId, count, sortNo }
    const response = await fetch(tecdocUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
      body: JSON.stringify({
        getArticles: {
          articleCountry: "NL",
          providerId: 22691,
          lang: "nl",
          perPage: 0,
          page: 1,
          assemblyGroupFacetOptions: {
            enabled: true,
            assemblyGroupType: "P",
          },
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      return reply.code(502).send({ error: `TecDoc API error: ${response.status}` });
    }

    const data = (await response.json()) as {
      assemblyGroupFacets?: {
        total?: number;
        counts?: Array<{
          assemblyGroupNodeId: number;
          assemblyGroupName: string;
          parentNodeId?: number;
          count?: number;
          sortNo?: number;
        }>;
      };
    };

    const rawFacets = data.assemblyGroupFacets?.counts ?? [];
    logger.info({ total: data.assemblyGroupFacets?.total, fetched: rawFacets.length }, "TecDoc assembly group facets");

    if (rawFacets.length === 0) {
      return { created: 0, updated: 0, linked: 0, total: 0, message: "No assembly groups returned from TecDoc" };
    }

    // TecDoc returns a flat list — each item carries its own parentNodeId
    interface FlatCategory {
      nodeId: number;
      name: string;
      count: number;
      parentNodeId: number | null;
    }

    const categories: FlatCategory[] = rawFacets
      .filter((f) => f.assemblyGroupNodeId && f.assemblyGroupName)
      .map((f) => ({
        nodeId: f.assemblyGroupNodeId,
        name: f.assemblyGroupName,
        count: f.count ?? 0,
        parentNodeId: f.parentNodeId ?? null,
      }));
    logger.info({ count: categories.length }, "Flattened TecDoc assembly groups");

    // Upsert categories - first pass: create all without parents
    let created = 0;
    let updated = 0;

    for (const cat of categories) {
      const code = `tecdoc-${cat.nodeId}`;
      try {
        const existing = await prisma.category.findUnique({ where: { code } });
        if (existing) {
          await prisma.category.update({
            where: { code },
            data: { name: cat.name, tecdocId: cat.nodeId },
          });
          updated++;
        } else {
          await prisma.category.create({
            data: { name: cat.name, code, tecdocId: cat.nodeId },
          });
          created++;
        }
      } catch (err) {
        logger.warn({ err, code, name: cat.name }, "Category upsert failed");
      }
    }

    // Second pass: set parent relationships
    let linked = 0;
    for (const cat of categories) {
      if (!cat.parentNodeId) continue;
      const code = `tecdoc-${cat.nodeId}`;
      const parentCode = `tecdoc-${cat.parentNodeId}`;
      try {
        const parent = await prisma.category.findUnique({ where: { code: parentCode } });
        if (parent) {
          await prisma.category.update({
            where: { code },
            data: { parentId: parent.id },
          });
          linked++;
        }
      } catch {
        // Skip link errors
      }
    }

    logger.info({ created, updated, linked, total: categories.length }, "TecDoc category sync completed");

    return { created, updated, linked, total: categories.length };
  });

  // Batch-link existing products to categories via TecDoc API
  app.post("/categories/link-products", async (request, reply) => {
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

    // Get all categories with tecdocId
    const categories = await prisma.category.findMany({
      where: { tecdocId: { not: null } },
      select: { id: true, tecdocId: true, name: true },
    });

    logger.info({ categories: categories.length }, "Starting product-category linking");

    let totalLinked = 0;
    let groupsProcessed = 0;

    for (const cat of categories) {
      if (!cat.tecdocId) continue;
      groupsProcessed++;

      try {
        // Fetch first page of articles for this assembly group
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
              perPage: 100,
              page: 1,
              assemblyGroupNodeIds: [cat.tecdocId],
            },
          }),
        });

        if (!response.ok) continue;

        const data = (await response.json()) as Record<string, unknown>;
        const articles = (data.articles ?? []) as Array<Record<string, unknown>>;

        if (articles.length === 0) continue;

        // Extract article numbers from this group
        const articleNos = articles
          .map((a) => a.articleNumber as string)
          .filter(Boolean);

        if (articleNos.length === 0) continue;

        // Update products that match these article numbers
        const result = await prisma.$executeRawUnsafe(
          `UPDATE product_maps SET category_id = $1
           WHERE supplier_id = $2 AND category_id IS NULL
           AND article_no = ANY($3::text[])`,
          cat.id,
          supplier.id,
          articleNos
        );

        totalLinked += Number(result);

        if (groupsProcessed % 50 === 0) {
          logger.info({ groupsProcessed, totalLinked, total: categories.length }, "Link progress");
        }

        // Rate limit: 200ms between API calls
        await new Promise((r) => setTimeout(r, 200));
      } catch (err) {
        logger.warn({ err, categoryId: cat.id, tecdocId: cat.tecdocId }, "Failed to link category");
      }
    }

    logger.info({ totalLinked, groupsProcessed }, "Product-category linking completed");
    return { totalLinked, groupsProcessed, totalCategories: categories.length };
  });

  // Deduplicate categories with same name - merge into the one with most products
  app.post("/categories/deduplicate", async () => {
    // Find duplicate category names
    const dupes = await prisma.$queryRaw<Array<{ name: string; cnt: bigint }>>`
      SELECT name, COUNT(*) as cnt FROM categories
      GROUP BY name HAVING COUNT(*) > 1
      ORDER BY cnt DESC
    `;

    let merged = 0;
    let deleted = 0;

    for (const dupe of dupes) {
      // Get all categories with this name, ordered by product count desc
      const cats = await prisma.$queryRaw<Array<{ id: number; code: string; product_count: bigint }>>`
        SELECT c.id, c.code, COUNT(pm.id) as product_count
        FROM categories c
        LEFT JOIN product_maps pm ON pm.category_id = c.id
        WHERE c.name = ${dupe.name}
        GROUP BY c.id, c.code
        ORDER BY COUNT(pm.id) DESC, c.id ASC
      `;

      if (cats.length <= 1) continue;

      const keeper = cats[0]; // Keep the one with most products
      const toMerge = cats.slice(1);

      for (const cat of toMerge) {
        // Move products from duplicate to keeper
        const moved = await prisma.$executeRawUnsafe(
          `UPDATE product_maps SET category_id = $1 WHERE category_id = $2`,
          keeper.id, cat.id
        );
        merged += Number(moved);

        // Move children from duplicate to keeper
        await prisma.$executeRawUnsafe(
          `UPDATE categories SET parent_id = $1 WHERE parent_id = $2`,
          keeper.id, cat.id
        );

        // Delete the duplicate
        await prisma.category.delete({ where: { id: cat.id } });
        deleted++;
      }
    }

    return {
      duplicateNames: dupes.length,
      categoriesDeleted: deleted,
      productsMerged: merged,
    };
  });

  // Reset product categories: set category_id = NULL for products in the given categories.
  // Use this to fix wrong TecDoc cross-categorization (e.g. AUGER products in "Spiegels").
  // After reset, re-run /categories/link-products so products get reassigned from scratch.
  app.post("/categories/reset-products", async (request, reply) => {
    const schema = z.object({
      // Either provide category IDs directly, or search by name fragment (case-insensitive)
      categoryIds: z.array(z.number().int()).optional(),
      nameContains: z.string().optional(),
    }).refine(d => d.categoryIds?.length || d.nameContains, {
      message: "Geef categoryIds of nameContains op",
    });

    const body = schema.parse(request.body);

    let targetIds: number[] = body.categoryIds ?? [];

    if (body.nameContains) {
      const found = await prisma.$queryRaw<Array<{ id: number; name: string }>>`
        SELECT id, name FROM categories
        WHERE LOWER(name) LIKE ${'%' + body.nameContains.toLowerCase() + '%'}
      `;
      targetIds = [...new Set([...targetIds, ...found.map(c => c.id)])];
    }

    if (targetIds.length === 0) {
      return reply.code(404).send({ error: "Geen categorieën gevonden" });
    }

    // Get category names for the response
    const categories = await prisma.category.findMany({
      where: { id: { in: targetIds } },
      select: { id: true, name: true },
    });

    const reset = await prisma.$executeRawUnsafe(
      `UPDATE product_maps SET category_id = NULL WHERE category_id = ANY($1::int[])`,
      targetIds
    );

    logger.info({ targetIds, reset }, "Category reset: product category_id cleared");

    return {
      categoriesReset: categories,
      productsReset: Number(reset),
      message: "Voer nu /categories/link-products uit om categorieën opnieuw toe te wijzen",
    };
  });

  // Update category
  // Create manual category
  app.post("/categories", async (request, reply) => {
    const schema = z.object({
      name: z.string().min(1).max(200),
      code: z.string().min(1).max(100).optional(),
      parentId: z.number().int().nullable().optional(),
    });

    const body = schema.parse(request.body);

    // Auto-generate code from name if not provided
    const baseCode = body.code?.trim() ||
      body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    // If user explicitly provided a code and it conflicts → error
    if (body.code?.trim()) {
      const existing = await prisma.category.findUnique({ where: { code: baseCode } });
      if (existing) {
        return reply.code(409).send({ error: `Categorie code '${baseCode}' bestaat al` });
      }
    }

    // Auto-generated code: add suffix -2, -3, … until unique
    let code = baseCode;
    let suffix = 2;
    while (await prisma.category.findUnique({ where: { code } })) {
      code = `${baseCode}-${suffix++}`;
    }

    // Determine level from parent
    let level = 0;
    if (body.parentId) {
      const parent = await prisma.category.findUnique({ where: { id: body.parentId } });
      if (!parent) return reply.code(404).send({ error: "Bovenliggende categorie niet gevonden" });
      level = (parent.level ?? 0) + 1;
    }

    const category = await prisma.category.create({
      data: { name: body.name, code, parentId: body.parentId ?? null, level },
    });

    return reply.code(201).send(category);
  });

  // Delete manual category (only if no products linked)
  app.delete("/categories/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const catId = parseInt(id, 10);

    const cat = await prisma.category.findUnique({
      where: { id: catId },
      include: { _count: { select: { products: true, children: true } } },
    });

    if (!cat) return reply.code(404).send({ error: "Categorie niet gevonden" });
    if (cat.tecdocId) return reply.code(409).send({ error: "Kan TecDoc-categorieën niet verwijderen" });
    if (cat._count.products > 0) return reply.code(409).send({ error: `Categorie heeft nog ${cat._count.products} gekoppelde producten` });
    if (cat._count.children > 0) return reply.code(409).send({ error: `Categorie heeft nog ${cat._count.children} subcategorieën` });

    await prisma.category.delete({ where: { id: catId } });
    return { success: true };
  });

  // Merge categories: verplaats alle producten van bronnen naar doelcategorie
  app.post("/categories/merge", async (request, reply) => {
    const schema = z.object({
      targetCategoryId: z.number().int().optional(),
      newCategory: z.object({
        name: z.string().min(1).max(200),
        code: z.string().min(1).max(100).optional(),
        parentId: z.number().int().nullable().optional(),
      }).optional(),
      sourceCategoryIds: z.array(z.number().int()).min(1).max(100),
      deleteSource: z.boolean().default(false),
    }).refine((d) => d.targetCategoryId != null || d.newCategory != null, {
      message: "Geef targetCategoryId of newCategory op",
    });

    const body = schema.parse(request.body);

    // Bepaal / maak doelcategorie aan
    let targetId: number;

    if (body.targetCategoryId != null) {
      const target = await prisma.category.findUnique({ where: { id: body.targetCategoryId } });
      if (!target) return reply.code(404).send({ error: "Doelcategorie niet gevonden" });
      targetId = target.id;
    } else {
      const nc = body.newCategory!;
      const code = nc.code?.trim() ||
        nc.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const existing = await prisma.category.findUnique({ where: { code } });
      if (existing) return reply.code(409).send({ error: `Categorie code '${code}' bestaat al` });
      let level = 0;
      if (nc.parentId) {
        const parent = await prisma.category.findUnique({ where: { id: nc.parentId } });
        level = (parent?.level ?? 0) + 1;
      }
      const created = await prisma.category.create({
        data: { name: nc.name, code, parentId: nc.parentId ?? null, level },
      });
      targetId = created.id;
    }

    // Verwijder de doelcategorie zelf uit de bronnenlijst (voorkomt zelf-merge)
    const sourceIds = body.sourceCategoryIds.filter((id) => id !== targetId);
    if (sourceIds.length === 0) {
      return reply.code(400).send({ error: "Geen bronnen om samen te voegen" });
    }

    // Verplaats alle producten van bronnen naar doel
    const productsMoved = await prisma.$executeRawUnsafe(
      `UPDATE product_maps SET category_id = $1 WHERE category_id = ANY($2::int[])`,
      targetId,
      sourceIds
    );

    // Verplaats subcategorieën van bronnen naar doel
    await prisma.$executeRawUnsafe(
      `UPDATE categories SET parent_id = $1 WHERE parent_id = ANY($2::int[]) AND id != $1`,
      targetId,
      sourceIds
    );

    // Verwijder lege broncategorieën indien gewenst
    let deleted = 0;
    if (body.deleteSource) {
      for (const srcId of sourceIds) {
        const src = await prisma.category.findUnique({
          where: { id: srcId },
          include: { _count: { select: { products: true, children: true } } },
        });
        if (src && src._count.products === 0 && src._count.children === 0) {
          await prisma.category.delete({ where: { id: srcId } }).catch(() => {});
          deleted++;
        }
      }
    }

    const target = await prisma.category.findUnique({ where: { id: targetId } });

    logger.info({ targetId, sourceIds, productsMoved: Number(productsMoved), deleted }, "Categories merged");

    return {
      targetCategory: target,
      productsMoved: Number(productsMoved),
      sourceCategories: sourceIds.length,
      deleted,
    };
  });

  app.patch("/categories/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = updateCategorySchema.parse(request.body);

    const existing = await prisma.category.findUnique({
      where: { id: parseInt(id, 10) },
    });

    if (!existing) {
      return reply.code(404).send({ error: "Category not found" });
    }

    const updated = await prisma.category.update({
      where: { id: parseInt(id, 10) },
      data: body,
    });

    return updated;
  });
}

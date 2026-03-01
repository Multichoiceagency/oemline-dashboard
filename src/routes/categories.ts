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
    const { page, limit, parentId, q } = query;
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
    const supplier = await prisma.supplier.findUnique({ where: { code: "tecdoc" } });
    if (!supplier) {
      return reply.code(404).send({ error: "TecDoc supplier not found" });
    }

    let creds: { apiKey: string; providerId?: number; articleCountry?: string } = { apiKey: "" };
    try {
      let raw = supplier.credentials as string;
      try {
        raw = decryptCredentials(raw);
      } catch {
        // Fallback: credentials stored as plaintext
      }
      creds = JSON.parse(raw);
    } catch {
      return reply.code(500).send({ error: "Invalid TecDoc credentials" });
    }

    const tecdocUrl = supplier.baseUrl || "https://webservice.tecalliance.services/pegasus-3-0/services/TecdocToCatDLB.jsonEndpoint";

    logger.info("Starting TecDoc category sync");

    // Fetch assembly groups via facets
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
          lang: "en",
          perPage: 0,
          page: 1,
          assemblyGroupFacetOptions: {
            enabled: true,
            assemblyGroupType: "P",
          },
        },
      }),
    });

    if (!response.ok) {
      return reply.code(502).send({ error: `TecDoc API error: ${response.status}` });
    }

    const data = (await response.json()) as Record<string, unknown>;
    const agf = data.assemblyGroupFacets;

    let rawFacets: Array<Record<string, unknown>> = [];
    if (Array.isArray(agf)) {
      rawFacets = agf;
    } else if (agf && typeof agf === "object") {
      const obj = agf as Record<string, unknown>;
      rawFacets = (obj.counts ?? obj.array ?? obj.data ?? []) as Array<Record<string, unknown>>;
      if (!Array.isArray(rawFacets)) rawFacets = [];
    }

    // Recursive flatten with parent tracking
    interface FlatCategory {
      nodeId: number;
      name: string;
      count: number;
      parentNodeId: number | null;
    }

    function flattenWithParent(
      facets: Array<Record<string, unknown>>,
      parentId: number | null = null
    ): FlatCategory[] {
      const result: FlatCategory[] = [];
      for (const f of facets) {
        const nodeId = f.assemblyGroupNodeId as number | undefined;
        const name = (f.assemblyGroupName ?? f.name ?? "") as string;
        const count = (f.matchCount ?? f.count ?? 0) as number;
        if (nodeId && name) {
          result.push({ nodeId, name, count, parentNodeId: parentId });
          const children = f.children as Array<Record<string, unknown>> | undefined;
          if (Array.isArray(children) && children.length > 0) {
            result.push(...flattenWithParent(children, nodeId));
          }
        }
      }
      return result;
    }

    const categories = flattenWithParent(rawFacets);
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

  // Update category
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

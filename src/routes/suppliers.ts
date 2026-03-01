import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { encryptCredentials } from "../lib/crypto.js";
import { loadAdaptersFromDb } from "../adapters/registry.js";
import { syncQueue } from "../workers/queues.js";

const createSupplierSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/),
  adapterType: z.string().min(1).max(50),
  baseUrl: z.string().url(),
  credentials: z.record(z.string()).default({}),
  priority: z.number().int().min(1).max(1000).default(100),
  active: z.boolean().default(true),
});

const updateSupplierSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  adapterType: z.string().min(1).max(50).optional(),
  baseUrl: z.string().url().optional(),
  credentials: z.record(z.string()).optional(),
  priority: z.number().int().min(1).max(1000).optional(),
  active: z.boolean().optional(),
});

export async function supplierRoutes(app: FastifyInstance): Promise<void> {
  app.get("/suppliers", async (request, reply) => {
    const querySchema = z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      active: z.enum(["true", "false", "all"]).default("all"),
    });

    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Bad Request",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { page, limit, active } = parsed.data;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (active === "true") where.active = true;
    else if (active === "false") where.active = false;

    const [items, total] = await Promise.all([
      prisma.supplier.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ priority: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          code: true,
          adapterType: true,
          baseUrl: true,
          priority: true,
          active: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              productMaps: true,
              unmatched: true,
              overrides: true,
            },
          },
        },
      }),
      prisma.supplier.count({ where }),
    ]);

    return reply.send({
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  });

  app.post("/suppliers", async (request, reply) => {
    const parsed = createSupplierSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "Bad Request",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const data = parsed.data;

    const existing = await prisma.supplier.findUnique({
      where: { code: data.code },
    });

    if (existing) {
      return reply.code(409).send({ error: "Supplier with this code already exists" });
    }

    const encryptedCreds = encryptCredentials(JSON.stringify(data.credentials));

    const supplier = await prisma.supplier.create({
      data: {
        name: data.name,
        code: data.code,
        adapterType: data.adapterType,
        baseUrl: data.baseUrl,
        credentials: encryptedCreds,
        priority: data.priority,
        active: data.active,
      },
    });

    // Reload adapters to pick up the new supplier
    await loadAdaptersFromDb();

    return reply.code(201).send({
      id: supplier.id,
      name: supplier.name,
      code: supplier.code,
      adapterType: supplier.adapterType,
      baseUrl: supplier.baseUrl,
      priority: supplier.priority,
      active: supplier.active,
      message: "Supplier created successfully",
    });
  });

  app.patch("/suppliers/:id", async (request, reply) => {
    const idSchema = z.object({
      id: z.coerce.number().int().positive(),
    });

    const idParsed = idSchema.safeParse(request.params);
    if (!idParsed.success) {
      return reply.code(400).send({ error: "Invalid supplier ID" });
    }

    const parsed = updateSupplierSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Bad Request",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const existing = await prisma.supplier.findUnique({
      where: { id: idParsed.data.id },
    });

    if (!existing) {
      return reply.code(404).send({ error: "Supplier not found" });
    }

    const updateData: Record<string, unknown> = {};
    const data = parsed.data;

    if (data.name !== undefined) updateData.name = data.name;
    if (data.adapterType !== undefined) updateData.adapterType = data.adapterType;
    if (data.baseUrl !== undefined) updateData.baseUrl = data.baseUrl;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.active !== undefined) updateData.active = data.active;

    if (data.credentials !== undefined) {
      updateData.credentials = encryptCredentials(JSON.stringify(data.credentials));
    }

    const supplier = await prisma.supplier.update({
      where: { id: idParsed.data.id },
      data: updateData,
    });

    // Reload adapters to pick up changes
    await loadAdaptersFromDb();

    return reply.send({
      id: supplier.id,
      name: supplier.name,
      code: supplier.code,
      adapterType: supplier.adapterType,
      baseUrl: supplier.baseUrl,
      priority: supplier.priority,
      active: supplier.active,
      message: "Supplier updated successfully",
    });
  });

  app.post("/suppliers/:id/sync", async (request, reply) => {
    const idSchema = z.object({
      id: z.coerce.number().int().positive(),
    });

    const idParsed = idSchema.safeParse(request.params);
    if (!idParsed.success) {
      return reply.code(400).send({ error: "Invalid supplier ID" });
    }

    const supplier = await prisma.supplier.findUnique({
      where: { id: idParsed.data.id },
    });

    if (!supplier) {
      return reply.code(404).send({ error: "Supplier not found" });
    }

    if (!supplier.active) {
      return reply.code(400).send({ error: "Cannot sync inactive supplier" });
    }

    const job = await syncQueue.add(
      `sync-${supplier.code}`,
      { supplierCode: supplier.code },
      {
        jobId: `sync-${supplier.code}-${Date.now()}`,
        priority: 1,
      }
    );

    return reply.code(202).send({
      message: "Sync job queued",
      jobId: job.id,
      supplier: supplier.code,
    });
  });
}

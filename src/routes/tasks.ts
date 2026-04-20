import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

// Prisma error code when the target table is missing (schema out of sync with DB).
// We degrade gracefully on read endpoints so the sidebar badge can't cause a
// 500-storm before the migration has been applied.
const MISSING_TABLE = "P2021";
function isMissingTable(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === MISSING_TABLE;
}

const TASK_TYPES = ["BUG", "FEATURE", "TASK"] as const;
const TASK_STATUSES = ["OPEN", "IN_PROGRESS", "BLOCKED", "DONE"] as const;
const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

const listQuerySchema = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  type: z.enum(TASK_TYPES).optional(),
  assignee: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

const createSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(10_000).optional(),
  type: z.enum(TASK_TYPES).default("TASK"),
  status: z.enum(TASK_STATUSES).default("OPEN"),
  priority: z.enum(TASK_PRIORITIES).default("MEDIUM"),
  assignee: z.string().email().max(200).optional().or(z.literal("")),
  reporter: z.string().max(200).optional(),
  labels: z.array(z.string().max(50)).max(20).default([]),
  relatedUrl: z.string().max(500).optional(),
});

const updateSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(10_000).nullable().optional(),
  type: z.enum(TASK_TYPES).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  assignee: z.string().max(200).nullable().optional(),
  labels: z.array(z.string().max(50)).max(20).optional(),
  relatedUrl: z.string().max(500).nullable().optional(),
});

export async function taskRoutes(app: FastifyInstance) {
  // List tasks with filters — used for kanban board
  app.get("/tasks", async (request) => {
    const { status, type, assignee, q, limit } = listQuerySchema.parse(request.query);

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (type) where.type = type;
    if (assignee) where.assignee = assignee;
    if (q) {
      where.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
      ];
    }

    try {
      const items = await prisma.task.findMany({
        where,
        orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
        take: limit,
      });
      return { items, total: items.length };
    } catch (err) {
      if (isMissingTable(err)) return { items: [], total: 0 };
      throw err;
    }
  });

  // Counts per status + open-bug count for sidebar badge
  app.get("/tasks/stats", async () => {
    try {
      const [byStatus, byType, openBugs] = await Promise.all([
        prisma.task.groupBy({ by: ["status"], _count: { _all: true } }),
        prisma.task.groupBy({ by: ["type"], _count: { _all: true } }),
        prisma.task.count({
          where: {
            type: "BUG",
            status: { in: ["OPEN", "IN_PROGRESS", "BLOCKED"] },
          },
        }),
      ]);

      const status: Record<string, number> = { OPEN: 0, IN_PROGRESS: 0, BLOCKED: 0, DONE: 0 };
      for (const row of byStatus) status[row.status] = row._count._all;

      const type: Record<string, number> = { BUG: 0, FEATURE: 0, TASK: 0 };
      for (const row of byType) type[row.type] = row._count._all;

      return { status, type, openBugs };
    } catch (err) {
      if (isMissingTable(err)) {
        return {
          status: { OPEN: 0, IN_PROGRESS: 0, BLOCKED: 0, DONE: 0 },
          type: { BUG: 0, FEATURE: 0, TASK: 0 },
          openBugs: 0,
        };
      }
      throw err;
    }
  });

  app.get("/tasks/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = await prisma.task.findUnique({ where: { id: parseInt(id, 10) } });
    if (!task) return reply.code(404).send({ error: "Not found" });
    return task;
  });

  app.post("/tasks", async (request, reply) => {
    const data = createSchema.parse(request.body);
    // Normalize empty-string assignee to null (form-friendly)
    const assignee = data.assignee && data.assignee.length > 0 ? data.assignee : null;
    const task = await prisma.task.create({
      data: {
        title: data.title,
        description: data.description ?? null,
        type: data.type,
        status: data.status,
        priority: data.priority,
        assignee,
        reporter: data.reporter ?? null,
        labels: data.labels,
        relatedUrl: data.relatedUrl ?? null,
      },
    });
    return reply.code(201).send(task);
  });

  app.patch("/tasks/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = updateSchema.parse(request.body);
    try {
      const task = await prisma.task.update({
        where: { id: parseInt(id, 10) },
        data,
      });
      return task;
    } catch {
      return reply.code(404).send({ error: "Not found" });
    }
  });

  app.delete("/tasks/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await prisma.task.delete({ where: { id: parseInt(id, 10) } });
      return { success: true };
    } catch {
      return reply.code(404).send({ error: "Not found" });
    }
  });
}

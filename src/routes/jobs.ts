import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { syncQueue, matchQueue, indexQueue } from "../workers/queues.js";

export async function jobRoutes(app: FastifyInstance) {
  // Get all job queue status
  app.get("/jobs/status", async () => {
    const [syncCounts, matchCounts, indexCounts] = await Promise.all([
      getQueueCounts(syncQueue),
      getQueueCounts(matchQueue),
      getQueueCounts(indexQueue),
    ]);

    return {
      sync: syncCounts,
      match: matchCounts,
      index: indexCounts,
    };
  });

  // Get recent completed/failed jobs for a queue
  app.get("/jobs/:queue/history", async (request) => {
    const { queue } = request.params as { queue: string };
    const q = getQueue(queue);
    if (!q) return { error: "Unknown queue" };

    const [completed, failed] = await Promise.all([
      q.getCompleted(0, 20),
      q.getFailed(0, 20),
    ]);

    return {
      completed: completed.map(formatJob),
      failed: failed.map(formatJob),
    };
  });

  // Manually trigger a sync job for a supplier
  app.post("/jobs/sync", async (request) => {
    const schema = z.object({ supplierCode: z.string().min(1) });
    const { supplierCode } = schema.parse(request.body);

    const job = await syncQueue.add(
      `sync-manual-${supplierCode}`,
      { supplierCode },
      { priority: 1 }
    );

    return { jobId: job.id, queue: "sync", supplierCode, status: "queued" };
  });

  // Manually trigger a match job for a supplier
  app.post("/jobs/match", async (request) => {
    const schema = z.object({ supplierCode: z.string().min(1) });
    const { supplierCode } = schema.parse(request.body);

    const job = await matchQueue.add(
      `match-manual-${supplierCode}`,
      { supplierCode },
      { priority: 1 }
    );

    return { jobId: job.id, queue: "match", supplierCode, status: "queued" };
  });

  // Manually trigger an index rebuild
  app.post("/jobs/index", async (request) => {
    const body = (request.body ?? {}) as { supplierCode?: string };

    const job = await indexQueue.add(
      "reindex-manual",
      { supplierCode: body.supplierCode },
      { priority: 1 }
    );

    return { jobId: job.id, queue: "index", status: "queued" };
  });

  // Trigger sync for ALL active suppliers
  app.post("/jobs/sync-all", async () => {
    const { prisma } = await import("../lib/prisma.js");
    const suppliers = await prisma.supplier.findMany({
      where: { active: true },
      select: { code: true, name: true },
    });

    const jobs = [];
    for (const supplier of suppliers) {
      const job = await syncQueue.add(
        `sync-manual-${supplier.code}`,
        { supplierCode: supplier.code },
        { priority: 1 }
      );
      jobs.push({ jobId: job.id, supplierCode: supplier.code });
    }

    return { queued: jobs.length, jobs };
  });
}

function getQueue(name: string) {
  switch (name) {
    case "sync": return syncQueue;
    case "match": return matchQueue;
    case "index": return indexQueue;
    default: return null;
  }
}

async function getQueueCounts(queue: typeof syncQueue) {
  const counts = await queue.getJobCounts(
    "active", "completed", "delayed", "failed", "paused", "waiting"
  );

  const repeatable = await queue.getRepeatableJobs();

  return {
    name: queue.name,
    ...counts,
    repeatableJobs: repeatable.length,
  };
}

function formatJob(job: { id?: string; name: string; data: unknown; progress: unknown; finishedOn?: number; failedReason?: string; processedOn?: number; timestamp: number }) {
  return {
    id: job.id,
    name: job.name,
    data: job.data,
    progress: job.progress,
    finishedOn: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : null,
    createdAt: new Date(job.timestamp).toISOString(),
    failedReason: job.failedReason ?? null,
  };
}

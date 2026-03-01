import { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { meili } from "../lib/meilisearch.js";
import { getAllAdapters } from "../adapters/registry.js";
import { syncQueue, matchQueue, indexQueue } from "../workers/queues.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async (_request, reply) => {
    const checks: Record<string, string> = {};

    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.postgres = "ok";
    } catch {
      checks.postgres = "error";
    }

    try {
      await redis.ping();
      checks.redis = "ok";
    } catch {
      checks.redis = "error";
    }

    try {
      await meili.health();
      checks.meilisearch = "ok";
    } catch {
      checks.meilisearch = "error";
    }

    // Circuit breaker states
    const circuits: Record<string, { state: string; failures: number }> = {};
    for (const adapter of getAllAdapters()) {
      circuits[adapter.code] = {
        state: adapter.circuitBreaker.getState(),
        failures: adapter.circuitBreaker.getFailures(),
      };
    }

    // Queue depths (waiting + active + prioritized)
    const queues: Record<string, { waiting: number; active: number; completed: number; failed: number }> = {};
    try {
      const [syncCounts, matchCounts, indexCounts] = await Promise.all([
        syncQueue.getJobCounts("waiting", "active", "prioritized", "completed", "failed"),
        matchQueue.getJobCounts("waiting", "active", "prioritized", "completed", "failed"),
        indexQueue.getJobCounts("waiting", "active", "prioritized", "completed", "failed"),
      ]);
      queues.sync = {
        waiting: (syncCounts.waiting ?? 0) + (syncCounts.prioritized ?? 0),
        active: syncCounts.active ?? 0,
        completed: syncCounts.completed ?? 0,
        failed: syncCounts.failed ?? 0,
      };
      queues.match = {
        waiting: (matchCounts.waiting ?? 0) + (matchCounts.prioritized ?? 0),
        active: matchCounts.active ?? 0,
        completed: matchCounts.completed ?? 0,
        failed: matchCounts.failed ?? 0,
      };
      queues.index = {
        waiting: (indexCounts.waiting ?? 0) + (indexCounts.prioritized ?? 0),
        active: indexCounts.active ?? 0,
        completed: indexCounts.completed ?? 0,
        failed: indexCounts.failed ?? 0,
      };
    } catch {
      // Queue stats are non-critical
    }

    const healthy = Object.values(checks).every((v) => v === "ok");

    reply.code(healthy ? 200 : 503).send({
      status: healthy ? "healthy" : "degraded",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks,
      circuits,
      queues,
    });
  });
}

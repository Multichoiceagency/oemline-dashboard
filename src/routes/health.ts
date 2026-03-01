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
    const circuits: Record<string, string> = {};
    for (const adapter of getAllAdapters()) {
      circuits[adapter.code] = adapter.circuitBreaker.getState();
    }

    // Queue depths
    const queues: Record<string, number> = {};
    try {
      const [syncWaiting, matchWaiting, indexWaiting] = await Promise.all([
        syncQueue.getWaitingCount(),
        matchQueue.getWaitingCount(),
        indexQueue.getWaitingCount(),
      ]);
      queues.sync = syncWaiting;
      queues.match = matchWaiting;
      queues.index = indexWaiting;
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

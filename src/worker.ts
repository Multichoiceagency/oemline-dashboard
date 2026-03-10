import "dotenv/config";
import { Worker } from "bullmq";
import { redisConfig } from "./lib/redis.js";
import { disconnectPrisma, validateConnection } from "./lib/prisma.js";
import { disconnectRedis } from "./lib/redis.js";
import { ensureProductsIndex } from "./lib/meilisearch.js";
import { logger } from "./lib/logger.js";
import { processSyncJob } from "./workers/sync.worker.js";
import { processRematchJob } from "./workers/match.worker.js";
import { processIndexJob } from "./workers/index.worker.js";
import { processPricingJob } from "./workers/pricing.worker.js";
import { processStockJob } from "./workers/stock.worker.js";
import { processIcMatchJob } from "./workers/ic-match.worker.js";
import { processAiMatchJob } from "./workers/ai-match.worker.js";
import { processPushJob } from "./workers/push.worker.js";
import { loadAdaptersFromDb } from "./adapters/registry.js";
import { startScheduler } from "./workers/scheduler.js";

/**
 * WORKER_QUEUES env var controls which queues this worker instance handles.
 * Comma-separated list: "sync,match,index,pricing,stock,ic-match,ai-match"
 *
 * Examples:
 *   WORKER_QUEUES=pricing,stock       → dedicated pricing+stock worker (no scheduler)
 *   WORKER_QUEUES=sync,match,index    → sync/match/index worker (runs scheduler)
 *   WORKER_QUEUES=ic-match            → dedicated IC matching worker
 *   WORKER_QUEUES=ai-match            → dedicated AI match worker
 *   (not set)                         → all queues + scheduler (default)
 *
 * Concurrency tuning (all queues run in parallel within one process):
 *   WORKER_CONCURRENCY=N              → apply N to all queues
 *   WORKER_CONCURRENCY_STOCK=N        → stock queue specifically
 *   WORKER_CONCURRENCY_PRICING=N      → pricing queue specifically
 *   WORKER_CONCURRENCY_MATCH=N        → match queue specifically
 *   WORKER_CONCURRENCY_SYNC=N         → sync queue specifically
 *   WORKER_CONCURRENCY_IC_MATCH=N     → ic-match queue specifically
 *
 * Scaling: run multiple worker pods with the same WORKER_QUEUES — BullMQ
 * distributes jobs across all instances automatically (ultra-fast scaling).
 */
const WORKER_QUEUES = process.env.WORKER_QUEUES
  ? new Set(process.env.WORKER_QUEUES.split(",").map((q) => q.trim().toLowerCase()))
  : null; // null = all queues

const isAllQueues = WORKER_QUEUES === null;
const handles = (q: string) => isAllQueues || WORKER_QUEUES!.has(q);

// Detect dedicated modes
const isDedicatedPricing = WORKER_QUEUES?.has("pricing") && !WORKER_QUEUES?.has("sync");
const isDedicatedMatch   = WORKER_QUEUES?.has("match")   && !WORKER_QUEUES?.has("sync");

/**
 * Resolve concurrency for a queue.
 * Priority: per-queue env → global WORKER_CONCURRENCY → mode-based default.
 *
 * @param envKey     e.g. "STOCK"
 * @param base       default when running all queues together
 * @param dedicated  default when this is a dedicated worker for this queue
 */
function concurrency(envKey: string, base: number, dedicated: number): number {
  const perQueue = process.env[`WORKER_CONCURRENCY_${envKey}`];
  if (perQueue) return Math.max(1, parseInt(perQueue, 10) || base);
  const global = process.env.WORKER_CONCURRENCY;
  if (global) return Math.max(1, parseInt(global, 10) || base);
  return isDedicatedPricing || isDedicatedMatch ? dedicated : base;
}

const connection = {
  host: redisConfig.host,
  port: redisConfig.port,
  password: redisConfig.password,
  db: redisConfig.db,
  maxRetriesPerRequest: null,
};

const GRACEFUL_SHUTDOWN_MS = 30_000;

// Build worker list based on WORKER_QUEUES
const workers: Worker[] = [];

if (handles("sync")) {
  workers.push(new Worker("sync", processSyncJob, {
    connection,
    // base 6 (was 3), dedicated 12 (was 6) — batches are now parallel so more concurrency helps
    concurrency: concurrency("SYNC", 6, 12),
    stalledInterval: 600_000, // 10 min (was 5 min) — large batches take longer
    lockDuration:    900_000, // 15 min lock
  }));
}

if (handles("match")) {
  workers.push(new Worker("match", processRematchJob, {
    connection,
    // base 10 (was 5), dedicated 20 (was 10)
    concurrency: concurrency("MATCH", 10, 20),
    stalledInterval: 60_000,
  }));
}

if (handles("index")) {
  workers.push(new Worker("index", processIndexJob, {
    connection,
    // base 4 (was 2), dedicated 8 (was 4)
    concurrency: concurrency("INDEX", 4, 8),
    stalledInterval: 60_000,
  }));
}

if (handles("pricing")) {
  workers.push(new Worker("pricing", processPricingJob, {
    connection,
    // base 10 (was 6), dedicated 20 (was 12)
    concurrency: concurrency("PRICING", 10, 20),
    stalledInterval: 300_000,
    lockDuration: 600_000,
  }));
}

if (handles("stock")) {
  workers.push(new Worker("stock", processStockJob, {
    connection,
    // base 10 (was 6), dedicated 20 (was 12)
    concurrency: concurrency("STOCK", 10, 20),
    stalledInterval: 300_000,
    lockDuration: 600_000,
  }));
}

if (handles("ic-match")) {
  workers.push(new Worker("ic-match", processIcMatchJob, {
    connection,
    // base 3 (was 2), dedicated 6 (was 4)
    concurrency: concurrency("IC_MATCH", 3, 6),
    stalledInterval: 600_000,
    lockDuration:   1_200_000,
  }));
}

if (handles("ai-match")) {
  workers.push(new Worker("ai-match", processAiMatchJob, {
    connection,
    concurrency: concurrency("AI_MATCH", 1, 2),
    stalledInterval: 300_000,
    lockDuration: 1_800_000,
  }));
}

if (handles("push")) {
  workers.push(new Worker("push", processPushJob, {
    connection,
    concurrency: 1, // One push job at a time — sequential batches to avoid hammering output API
    stalledInterval: 300_000,
    lockDuration: 1_800_000, // 30 min — large catalogs can take a while
  }));
}

for (const worker of workers) {
  worker.on("completed", (job) => {
    logger.info({ queue: worker.name, jobId: job.id }, "Job completed");
  });

  worker.on("failed", (job, err) => {
    logger.error(
      { queue: worker.name, jobId: job?.id, err: err.message },
      "Job failed"
    );
  });

  worker.on("error", (err) => {
    logger.error({ queue: worker.name, err: err.message }, "Worker error");
  });

  worker.on("stalled", (jobId) => {
    logger.warn({ queue: worker.name, jobId }, "Job stalled — will be retried");
  });
}

let shuttingDown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info("Worker shutting down gracefully...");

  const forceExit = setTimeout(() => {
    logger.warn("Graceful shutdown timed out, forcing exit");
    process.exit(1);
  }, GRACEFUL_SHUTDOWN_MS);

  try {
    await Promise.all(workers.map((w) => w.close()));
    await disconnectRedis();
    await disconnectPrisma();
  } catch (err) {
    logger.error({ err }, "Error during shutdown");
  } finally {
    clearTimeout(forceExit);
    process.exit(0);
  }
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

try {
  await validateConnection();

  await loadAdaptersFromDb().catch((err) => {
    logger.warn({ err }, "Failed to load adapters from DB");
  });

  await Promise.race([
    ensureProductsIndex(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Meilisearch init timeout")), 10_000)
    ),
  ]).catch((err) => {
    logger.warn({ err }, "Meilisearch init failed — workers will retry indexing later");
  });

  logger.info(
    { queues: workers.map((w) => w.name), dedicated: WORKER_QUEUES ? [...WORKER_QUEUES] : "all" },
    "Workers started"
  );

  // Only the primary worker (handles sync) runs the scheduler to avoid duplicate jobs
  if (handles("sync")) {
    await startScheduler();
  } else {
    logger.info({ queues: workers.map((w) => w.name) }, "Dedicated worker — scheduler skipped");
  }
} catch (err) {
  logger.error(err, "Failed to start workers");
  process.exit(1);
}

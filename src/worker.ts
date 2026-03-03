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
import { loadAdaptersFromDb } from "./adapters/registry.js";
import { startScheduler } from "./workers/scheduler.js";

/**
 * WORKER_QUEUES env var controls which queues this worker instance handles.
 * Comma-separated list: "sync,match,index,pricing,stock"
 *
 * Examples:
 *   WORKER_QUEUES=pricing,stock     → dedicated pricing+stock worker (no scheduler)
 *   WORKER_QUEUES=sync,match,index  → dedicated sync/match/index worker (runs scheduler)
 *   (not set)                       → all queues + scheduler (default)
 *
 * WORKER_CONCURRENCY overrides concurrency per queue (default varies by queue type).
 */
const WORKER_QUEUES = process.env.WORKER_QUEUES
  ? new Set(process.env.WORKER_QUEUES.split(",").map((q) => q.trim().toLowerCase()))
  : null; // null = all queues

const isAllQueues = WORKER_QUEUES === null;
const handles = (q: string) => isAllQueues || WORKER_QUEUES!.has(q);

// In dedicated pricing/stock mode, run more concurrent API calls
const isDedicatedPricing = WORKER_QUEUES?.has("pricing") && !WORKER_QUEUES?.has("sync");
const pricingConcurrency = isDedicatedPricing ? 6 : 2;
const stockConcurrency = isDedicatedPricing ? 6 : 2;

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
    concurrency: 1,
    stalledInterval: 300_000,
    lockDuration: 600_000,
  }));
}

if (handles("match")) {
  workers.push(new Worker("match", processRematchJob, {
    connection,
    concurrency: 3,
    stalledInterval: 30_000,
  }));
}

if (handles("index")) {
  workers.push(new Worker("index", processIndexJob, {
    connection,
    concurrency: 1,
    stalledInterval: 60_000,
  }));
}

if (handles("pricing")) {
  workers.push(new Worker("pricing", processPricingJob, {
    connection,
    concurrency: pricingConcurrency,
    stalledInterval: 300_000,
    lockDuration: 600_000,
  }));
}

if (handles("stock")) {
  workers.push(new Worker("stock", processStockJob, {
    connection,
    concurrency: stockConcurrency,
    stalledInterval: 300_000,
    lockDuration: 600_000,
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

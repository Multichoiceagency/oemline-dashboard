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
import { loadAdaptersFromDb } from "./adapters/registry.js";
import { startScheduler } from "./workers/scheduler.js";

const connection = {
  host: redisConfig.host,
  port: redisConfig.port,
  password: redisConfig.password,
  db: redisConfig.db,
  maxRetriesPerRequest: null,
};

const GRACEFUL_SHUTDOWN_MS = 15_000;

const syncWorker = new Worker("sync", processSyncJob, {
  connection,
  concurrency: 2,
  limiter: { max: 5, duration: 60_000 },
  stalledInterval: 30_000,
});

const matchWorker = new Worker("match", processRematchJob, {
  connection,
  concurrency: 3,
  stalledInterval: 30_000,
});

const indexWorker = new Worker("index", processIndexJob, {
  connection,
  concurrency: 1,
  stalledInterval: 60_000,
});

const pricingWorker = new Worker(
  "pricing",
  async (job) => {
    logger.info({ jobId: job.id, data: job.data }, "Processing pricing job");
  },
  { connection, concurrency: 5 }
);

const stockWorker = new Worker(
  "stock",
  async (job) => {
    logger.info({ jobId: job.id, data: job.data }, "Processing stock job");
  },
  { connection, concurrency: 5 }
);

const workers = [syncWorker, matchWorker, indexWorker, pricingWorker, stockWorker];

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
    // Close workers — waits for active jobs to finish
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
    { queues: workers.map((w) => w.name) },
    "Workers started"
  );

  // Start the scheduler to enqueue repeating sync/match/index jobs
  await startScheduler();
} catch (err) {
  logger.error(err, "Failed to start workers");
  process.exit(1);
}

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

  // Debug: check Redis connection and raw job data
  app.get("/jobs/debug", async () => {
    const { redis } = await import("../lib/redis.js");

    // Check raw Redis keys for BullMQ
    const syncKeys = await redis.keys("bull:sync:*");
    const matchKeys = await redis.keys("bull:match:*");
    const indexKeys = await redis.keys("bull:index:*");

    // Try to get a specific job
    const job = await syncQueue.add("debug-test", { test: true });
    const jobId = job.id;

    // Wait 1 second and check
    await new Promise((r) => setTimeout(r, 1000));

    const retrieved = await syncQueue.getJob(jobId!);
    const state = retrieved ? await retrieved.getState() : "not-found";

    // Cleanup test job
    if (retrieved) await retrieved.remove();

    return {
      redisConnected: true,
      syncKeys: syncKeys.length,
      matchKeys: matchKeys.length,
      indexKeys: indexKeys.length,
      testJob: { id: jobId, state, exists: !!retrieved },
      sampleKeys: syncKeys.slice(0, 10),
    };
  });

  // Import InterCars CSV mapping (from local file or MinIO)
  app.post("/jobs/import-intercars-csv", async (request) => {
    const { prisma } = await import("../lib/prisma.js");
    const { logger } = await import("../lib/logger.js");
    const { createReadStream, existsSync } = await import("node:fs");
    const { createInterface } = await import("node:readline");
    const { Prisma } = await import("@prisma/client");
    const { resolve } = await import("node:path");
    const { getObjectStream } = await import("../lib/minio.js");

    const body = (request.body ?? {}) as { csvPath?: string; minioKey?: string };
    const csvPath = body.csvPath || resolve(process.cwd(), "ProductInformation_2026-02-26.csv");

    // Create table if not exists
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS intercars_mappings (
        id SERIAL PRIMARY KEY,
        tow_kod TEXT NOT NULL UNIQUE,
        ic_index TEXT NOT NULL DEFAULT '',
        article_number TEXT NOT NULL DEFAULT '',
        manufacturer TEXT NOT NULL DEFAULT '',
        tecdoc_prod INTEGER,
        description TEXT NOT NULL DEFAULT '',
        ean TEXT,
        weight DOUBLE PRECISION,
        blocked_return BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_ic_map_mfr_art ON intercars_mappings (manufacturer, article_number)`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_ic_map_art ON intercars_mappings (article_number)`);

    // Stream the CSV - from MinIO if minioKey provided, otherwise local file
    const BATCH_SIZE = 5000;
    let batch: Array<{ towKod: string; icIndex: string; articleNumber: string; manufacturer: string; tecdocProd: number | null; description: string; ean: string | null; weight: number | null; blockedReturn: boolean }> = [];
    let totalImported = 0;

    let stream: NodeJS.ReadableStream;
    if (body.minioKey) {
      logger.info({ minioKey: body.minioKey }, "Reading CSV from MinIO");
      stream = await getObjectStream(body.minioKey);
    } else if (existsSync(csvPath)) {
      stream = createReadStream(csvPath, { encoding: "utf-8" });
    } else {
      // Try default MinIO path
      logger.info("No local CSV found, trying MinIO files/ProductInformation.csv");
      try {
        stream = await getObjectStream("files/ProductInformation_2026-02-26.csv");
      } catch {
        return { error: "CSV file not found locally or in MinIO. Provide csvPath or minioKey parameter." };
      }
    }
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    let lineNum = 0;

    for await (const line of rl) {
      lineNum++;
      if (lineNum === 1) continue;

      const parts = line.split(";");
      if (parts.length < 15) continue;

      const towKod = parts[0]?.trim();
      if (!towKod) continue;

      const articleNumber = parts[4]?.trim() ?? "";
      const manufacturer = parts[5]?.trim() ?? "";
      if (!articleNumber || !manufacturer) continue;

      const tecdocProdRaw = parseInt(parts[3]?.trim() ?? "", 10);
      const weightStr = parts[9]?.trim().replace(",", ".") ?? "";
      const weightVal = parseFloat(weightStr);

      batch.push({
        towKod,
        icIndex: parts[1]?.trim() ?? "",
        articleNumber,
        manufacturer,
        tecdocProd: isNaN(tecdocProdRaw) ? null : tecdocProdRaw,
        description: parts[7]?.trim() || parts[6]?.trim() || "",
        ean: parts[8]?.trim().split(",")[0] || null,
        weight: isNaN(weightVal) ? null : weightVal,
        blockedReturn: parts[14]?.trim().toLowerCase() === "true",
      });

      if (batch.length >= BATCH_SIZE) {
        const values = batch.map((r) =>
          Prisma.sql`(${r.towKod}, ${r.icIndex}, ${r.articleNumber}, ${r.manufacturer}, ${r.tecdocProd}, ${r.description}, ${r.ean}, ${r.weight}, ${r.blockedReturn}, NOW())`
        );
        await prisma.$executeRaw`
          INSERT INTO intercars_mappings (tow_kod, ic_index, article_number, manufacturer, tecdoc_prod, description, ean, weight, blocked_return, created_at)
          VALUES ${Prisma.join(values)}
          ON CONFLICT (tow_kod) DO UPDATE SET
            ic_index = EXCLUDED.ic_index, article_number = EXCLUDED.article_number,
            manufacturer = EXCLUDED.manufacturer, tecdoc_prod = EXCLUDED.tecdoc_prod,
            description = CASE WHEN EXCLUDED.description != '' THEN EXCLUDED.description ELSE intercars_mappings.description END,
            ean = COALESCE(EXCLUDED.ean, intercars_mappings.ean),
            weight = COALESCE(EXCLUDED.weight, intercars_mappings.weight),
            blocked_return = EXCLUDED.blocked_return
        `;
        totalImported += batch.length;
        batch = [];

        if (totalImported % 50000 === 0) {
          logger.info({ totalImported }, "InterCars CSV import progress");
        }
      }
    }

    if (batch.length > 0) {
      const values = batch.map((r) =>
        Prisma.sql`(${r.towKod}, ${r.icIndex}, ${r.articleNumber}, ${r.manufacturer}, ${r.tecdocProd}, ${r.description}, ${r.ean}, ${r.weight}, ${r.blockedReturn}, NOW())`
      );
      await prisma.$executeRaw`
        INSERT INTO intercars_mappings (tow_kod, ic_index, article_number, manufacturer, tecdoc_prod, description, ean, weight, blocked_return, created_at)
        VALUES ${Prisma.join(values)}
        ON CONFLICT (tow_kod) DO UPDATE SET
          ic_index = EXCLUDED.ic_index, article_number = EXCLUDED.article_number,
          manufacturer = EXCLUDED.manufacturer, tecdoc_prod = EXCLUDED.tecdoc_prod,
          description = CASE WHEN EXCLUDED.description != '' THEN EXCLUDED.description ELSE intercars_mappings.description END,
          ean = COALESCE(EXCLUDED.ean, intercars_mappings.ean),
          weight = COALESCE(EXCLUDED.weight, intercars_mappings.weight),
          blocked_return = EXCLUDED.blocked_return
      `;
      totalImported += batch.length;
    }

    logger.info({ totalImported, totalLines: lineNum }, "InterCars CSV import completed");

    return { imported: totalImported, totalLines: lineNum };
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
    "active", "completed", "delayed", "failed", "paused", "waiting", "prioritized", "wait"
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

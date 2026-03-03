import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { syncQueue, matchQueue, indexQueue, pricingQueue, stockQueue, icMatchQueue } from "../workers/queues.js";

export async function jobRoutes(app: FastifyInstance) {
  // Get all job queue status
  app.get("/jobs/status", async () => {
    const [syncCounts, matchCounts, indexCounts, pricingCounts, stockCounts, icMatchCounts] = await Promise.all([
      getQueueCounts(syncQueue),
      getQueueCounts(matchQueue),
      getQueueCounts(indexQueue),
      getQueueCounts(pricingQueue),
      getQueueCounts(stockQueue),
      getQueueCounts(icMatchQueue),
    ]);

    return {
      sync: syncCounts,
      match: matchCounts,
      index: indexCounts,
      pricing: pricingCounts,
      stock: stockCounts,
      icMatch: icMatchCounts,
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

  // Manually trigger a pricing refresh job for a supplier
  app.post("/jobs/pricing", async (request) => {
    const schema = z.object({ supplierCode: z.string().min(1).default("intercars") });
    const { supplierCode } = schema.parse(request.body ?? {});

    const job = await pricingQueue.add(
      `pricing-manual-${supplierCode}`,
      { supplierCode },
      { priority: 1 }
    );

    return { jobId: job.id, queue: "pricing", supplierCode, status: "queued" };
  });

  // Manually trigger a stock refresh job for a supplier
  app.post("/jobs/stock", async (request) => {
    const schema = z.object({ supplierCode: z.string().min(1).default("intercars") });
    const { supplierCode } = schema.parse(request.body ?? {});

    const job = await stockQueue.add(
      `stock-manual-${supplierCode}`,
      { supplierCode },
      { priority: 1 }
    );

    return { jobId: job.id, queue: "stock", supplierCode, status: "queued" };
  });

  // Manually trigger IC match job for a supplier
  app.post("/jobs/ic-match", async (request) => {
    const schema = z.object({ supplierCode: z.string().min(1).default("intercars") });
    const { supplierCode } = schema.parse(request.body ?? {});

    const job = await icMatchQueue.add(
      `ic-match-manual-${supplierCode}`,
      { supplierCode },
      { priority: 1 }
    );

    return { jobId: job.id, queue: "ic-match", supplierCode, status: "queued" };
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

  // Debug: check Redis connection and queue state (non-destructive)
  app.get("/jobs/debug", async () => {
    const { redis } = await import("../lib/redis.js");

    const pingResult = await redis.ping();

    // Use BullMQ's built-in methods instead of redis.keys()
    const [syncCounts, matchCounts, indexCounts, pricingCounts, stockCounts, icMatchCounts] = await Promise.all([
      syncQueue.getJobCounts("active", "completed", "delayed", "failed", "waiting", "prioritized"),
      matchQueue.getJobCounts("active", "completed", "delayed", "failed", "waiting", "prioritized"),
      indexQueue.getJobCounts("active", "completed", "delayed", "failed", "waiting", "prioritized"),
      pricingQueue.getJobCounts("active", "completed", "delayed", "failed", "waiting", "prioritized"),
      stockQueue.getJobCounts("active", "completed", "delayed", "failed", "waiting", "prioritized"),
      icMatchQueue.getJobCounts("active", "completed", "delayed", "failed", "waiting", "prioritized"),
    ]);

    return {
      redisConnected: pingResult === "PONG",
      sync: syncCounts,
      match: matchCounts,
      index: indexCounts,
      pricing: pricingCounts,
      stock: stockCounts,
      icMatch: icMatchCounts,
    };
  });

  // Import InterCars CSV mapping (from local file or MinIO)
  // Extend timeout: CSV import processes ~565K rows and can take minutes
  app.post("/jobs/import-intercars-csv", {
    onRequest: async (request) => { request.raw.socket.setTimeout(300_000); },
  }, async (request) => {
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
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_im_article_norm ON intercars_mappings (UPPER(regexp_replace(article_number, '[^a-zA-Z0-9]', '', 'g')))`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_im_ean_norm ON intercars_mappings (UPPER(TRIM(ean))) WHERE ean IS NOT NULL`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_im_tecdoc_prod ON intercars_mappings (tecdoc_prod) WHERE tecdoc_prod IS NOT NULL`);

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

  // Create expression indexes to speed up IC matching queries
  // Run this once after initial data load — creates indexes on normalized article numbers
  app.post("/jobs/optimize-db", async () => {
    const { prisma } = await import("../lib/prisma.js");
    const { logger } = await import("../lib/logger.js");

    logger.info("Creating expression indexes for IC matching optimization...");

    const indexes = [
      // Normalized article number on intercars_mappings — used by all 4 matching strategies
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_im_article_norm
        ON intercars_mappings (UPPER(regexp_replace(article_number, '[^a-zA-Z0-9]', '', 'g')))`,
      // Normalized article number on product_maps (unmatched only)
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pm_article_norm_unmatched
        ON product_maps (UPPER(regexp_replace(article_no, '[^a-zA-Z0-9]', '', 'g')))
        WHERE status = 'active' AND ic_sku IS NULL`,
      // Normalized EAN on intercars_mappings
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_im_ean_norm
        ON intercars_mappings (UPPER(TRIM(ean)))
        WHERE ean IS NOT NULL`,
      // tecdoc_prod on intercars_mappings for Strategy C
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_im_tecdoc_prod
        ON intercars_mappings (tecdoc_prod)
        WHERE tecdoc_prod IS NOT NULL`,
    ];

    const results: Array<{ index: string; status: string }> = [];
    for (const sql of indexes) {
      const indexName = sql.match(/idx_\w+/)?.[0] ?? "unknown";
      try {
        await prisma.$executeRawUnsafe(sql);
        results.push({ index: indexName, status: "created" });
        logger.info({ index: indexName }, "Expression index created");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ index: indexName, status: `error: ${msg}` });
        logger.warn({ index: indexName, err }, "Index creation failed (may already exist)");
      }
    }

    return { indexes: results };
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

  // Clean a queue: remove completed/failed/waiting jobs
  app.delete("/jobs/:queue/clean", async (request) => {
    const { queue } = request.params as { queue: string };
    const q = getQueue(queue);
    if (!q) return { error: "Unknown queue" };

    const { type } = (request.query ?? {}) as { type?: string };

    const results: Record<string, number> = {};
    if (!type || type === "failed") {
      const removed = await q.clean(0, 1000, "failed");
      results.failed = removed.length;
    }
    if (!type || type === "waiting") {
      const removed = await q.clean(0, 1000, "wait");
      results.waiting = removed.length;
    }
    if (type === "completed") {
      const removed = await q.clean(0, 1000, "completed");
      results.completed = removed.length;
    }

    return { cleaned: results };
  });

  // Force-drain a queue: removes all non-active jobs (waiting, delayed, prioritized)
  // Active jobs are left to complete naturally or expire via stall checker
  app.post("/jobs/:queue/drain", async (request) => {
    const { queue } = request.params as { queue: string };
    const q = getQueue(queue);
    if (!q) return { error: "Unknown queue" };

    await q.drain(true); // true = also drain delayed jobs
    const counts = await q.getJobCounts("active", "waiting", "prioritized", "delayed", "failed");
    return { drained: true, remaining: counts };
  });

  // Obliterate a queue: removes ALL jobs including active (use carefully)
  app.post("/jobs/:queue/obliterate", async (request) => {
    const { queue } = request.params as { queue: string };
    const q = getQueue(queue);
    if (!q) return { error: "Unknown queue" };

    await q.obliterate({ force: true });
    return { obliterated: true, queue };
  });

  // Database maintenance: check sizes, clean old data, vacuum
  app.post("/jobs/db-maintenance", async () => {
    const { prisma } = await import("../lib/prisma.js");
    const { logger } = await import("../lib/logger.js");

    const results: Record<string, unknown> = {};

    // 1. Check table sizes
    const sizes = await prisma.$queryRawUnsafe<Array<{ table_name: string; total_size: string; row_estimate: string }>>(`
      SELECT
        relname AS table_name,
        pg_size_pretty(pg_total_relation_size(oid)) AS total_size,
        reltuples::text AS row_estimate
      FROM pg_class
      WHERE relnamespace = 'public'::regnamespace
        AND relkind = 'r'
      ORDER BY pg_total_relation_size(oid) DESC
      LIMIT 10
    `);
    results.tableSizes = sizes;

    // 2. Check DB size
    const diskInfo = await prisma.$queryRawUnsafe<Array<{ db_size_mb: number }>>(`
      SELECT (pg_database_size(current_database()) / 1024 / 1024)::int AS db_size_mb
    `);
    results.dbSizeMb = (diskInfo[0] as any)?.db_size_mb;

    // 3. Delete match_logs older than 3 days (these accumulate rapidly)
    const matchLogsDeleted = await prisma.$executeRawUnsafe(`
      DELETE FROM match_logs WHERE created_at < NOW() - INTERVAL '3 days'
    `);
    results.matchLogsDeleted = matchLogsDeleted;
    logger.info({ deleted: matchLogsDeleted }, "Deleted old match_logs");

    // 4. Delete unmatched records resolved > 7 days ago
    const unmatchedDeleted = await prisma.$executeRawUnsafe(`
      DELETE FROM unmatched WHERE created_at < NOW() - INTERVAL '7 days' AND attempts < 3
    `);
    results.unmatchedDeleted = unmatchedDeleted;
    logger.info({ deleted: unmatchedDeleted }, "Deleted old unmatched records");

    // 5. VACUUM ANALYZE the largest tables to reclaim dead tuple space
    // Note: VACUUM cannot run in a transaction, use $executeRawUnsafe
    const tablesToVacuum = ["match_logs", "product_maps", "intercars_mappings", "unmatched"];
    const vacuumResults: string[] = [];
    for (const table of tablesToVacuum) {
      try {
        await prisma.$executeRawUnsafe(`VACUUM ANALYZE ${table}`);
        vacuumResults.push(`${table}: ok`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vacuumResults.push(`${table}: ${msg}`);
      }
    }
    results.vacuum = vacuumResults;

    return results;
  });
}

function getQueue(name: string) {
  switch (name) {
    case "sync": return syncQueue;
    case "match": return matchQueue;
    case "index": return indexQueue;
    case "pricing": return pricingQueue;
    case "stock": return stockQueue;
    case "ic-match": return icMatchQueue;
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

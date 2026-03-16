import { Job } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { matchProduct } from "../services/matching.js";
import { matchQueue } from "./queues.js";

interface RematchJobData {
  supplierCode: string;
  batchSize?: number;
  minId?: number;
  maxId?: number;
  isSubJob?: boolean;
}

const PARALLEL_MATCHES = 30;  // Concurrent matchProduct calls per chunk
const DB_PAGE_SIZE = 500;     // Unmatched items per cursor page
const SUB_JOB_SIZE = 5_000;   // Items per sub-job for fan-out

export async function processRematchJob(job: Job<RematchJobData>): Promise<void> {
  const { supplierCode, isSubJob = false, minId, maxId } = job.data;

  const supplier = await prisma.supplier.findUnique({
    where: { code: supplierCode },
  });
  if (!supplier) throw new Error(`Supplier not in database: ${supplierCode}`);

  // Sub-job: process specific ID range
  if (isSubJob && minId != null && maxId != null) {
    await processRange(supplier.id, supplierCode, minId, maxId, job);
    return;
  }

  // Parent: check total and fan out if large
  const countResult = await prisma.unmatched.aggregate({
    where: { supplierId: supplier.id, resolvedAt: null },
    _count: true,
    _min: { id: true },
    _max: { id: true },
  });

  const total = countResult._count;
  if (total === 0) {
    logger.info({ supplier: supplierCode }, "No unmatched items to process");
    return;
  }

  // Small set: process directly
  if (total <= SUB_JOB_SIZE) {
    await processRange(supplier.id, supplierCode, countResult._min.id!, countResult._max.id!, job);
    return;
  }

  // Fan out
  const subJobs: Array<{ name: string; data: RematchJobData; opts: Record<string, unknown> }> = [];
  const minIdVal = countResult._min.id!;
  const maxIdVal = countResult._max.id!;

  for (let start = minIdVal; start <= maxIdVal; start += SUB_JOB_SIZE) {
    const end = Math.min(start + SUB_JOB_SIZE - 1, maxIdVal);
    subJobs.push({
      name: `match-${supplierCode}-${start}-${end}`,
      data: { supplierCode, minId: start, maxId: end, isSubJob: true },
      opts: {
        priority: 2,
        jobId: `match-sub-${supplierCode}-${start}`,
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 100 },
      },
    });
  }

  await matchQueue.addBulk(subJobs);
  logger.info({ supplier: supplierCode, total, subJobs: subJobs.length }, "Match fan-out created");
}

async function processRange(
  supplierId: number,
  supplierCode: string,
  minId: number,
  maxId: number,
  job: Job
): Promise<void> {
  const startTime = Date.now();
  let processed = 0;
  let resolved = 0;
  let lastId = minId - 1;

  while (lastId < maxId) {
    const unmatched = await prisma.unmatched.findMany({
      where: {
        supplierId,
        resolvedAt: null,
        id: { gt: lastId, lte: maxId },
      },
      take: DB_PAGE_SIZE,
      orderBy: { id: "asc" },
    });

    if (unmatched.length === 0) break;
    lastId = unmatched[unmatched.length - 1].id;

    // Process in parallel chunks
    for (let i = 0; i < unmatched.length; i += PARALLEL_MATCHES) {
      const chunk = unmatched.slice(i, i + PARALLEL_MATCHES);

      const results = await Promise.allSettled(
        chunk.map(async (item) => {
          const result = await matchProduct({
            supplierId,
            brandId: item.brandId ?? undefined,
            query: item.query,
            ean: item.ean ?? undefined,
            tecdocId: item.tecdocId ?? undefined,
            articleNo: item.articleNo ?? undefined,
            oem: item.oem ?? undefined,
          });
          return { item, result };
        })
      );

      const toResolve: Array<{ id: number; method: string }> = [];
      for (const r of results) {
        if (r.status === "fulfilled" && r.value.result) {
          toResolve.push({ id: r.value.item.id, method: r.value.result.method });
        }
      }

      if (toResolve.length > 0) {
        const ids = toResolve.map((r) => r.id);
        await prisma.unmatched.updateMany({
          where: { id: { in: ids } },
          data: { resolvedAt: new Date() },
        });
        const cases = toResolve
          .map((r) => `WHEN ${r.id} THEN 'rematch:${r.method.replace(/'/g, "''")}'`)
          .join(" ");
        await prisma.$executeRawUnsafe(
          `UPDATE unmatched SET resolved_by = CASE id ${cases} END WHERE id IN (${ids.join(",")})`
        );
        resolved += toResolve.length;
      }

      processed += chunk.length;
    }

    await job.updateProgress(processed);
  }

  const durationMs = Date.now() - startTime;
  logger.info(
    { supplier: supplierCode, range: `${minId}-${maxId}`, processed, resolved, durationMs },
    "Rematch range completed"
  );
}

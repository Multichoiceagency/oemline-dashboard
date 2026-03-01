import { Job } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { matchProduct } from "../services/matching.js";

interface RematchJobData {
  supplierCode: string;
  batchSize?: number;
}

export async function processRematchJob(job: Job<RematchJobData>): Promise<void> {
  const { supplierCode, batchSize = 100 } = job.data;

  const supplier = await prisma.supplier.findUnique({
    where: { code: supplierCode },
  });

  if (!supplier) {
    throw new Error(`Supplier not in database: ${supplierCode}`);
  }

  logger.info({ supplier: supplierCode }, "Starting unmatched rematch");

  let processed = 0;
  let resolved = 0;
  let offset = 0;

  while (true) {
    const unmatched = await prisma.unmatched.findMany({
      where: {
        supplierId: supplier.id,
        resolvedAt: null,
      },
      take: batchSize,
      skip: offset,
      orderBy: { attempts: "asc" },
    });

    if (unmatched.length === 0) break;

    for (const item of unmatched) {
      const result = await matchProduct({
        supplierId: supplier.id,
        brandId: item.brandId ?? undefined,
        query: item.query,
        ean: item.ean ?? undefined,
        tecdocId: item.tecdocId ?? undefined,
        articleNo: item.articleNo ?? undefined,
        oem: item.oem ?? undefined,
      });

      if (result) {
        await prisma.unmatched.update({
          where: { id: item.id },
          data: {
            resolvedAt: new Date(),
            resolvedBy: `rematch:${result.method}`,
          },
        });
        resolved++;
      }

      processed++;
    }

    offset += batchSize;
    await job.updateProgress(processed);
  }

  logger.info(
    { supplier: supplierCode, processed, resolved },
    "Rematch completed"
  );
}

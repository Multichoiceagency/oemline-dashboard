import { Job } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { meili, PRODUCTS_INDEX } from "../lib/meilisearch.js";
import { logger } from "../lib/logger.js";

interface IndexJobData {
  supplierCode?: string;
}

export async function processIndexJob(job: Job<IndexJobData>): Promise<void> {
  const { supplierCode } = job.data;

  logger.info({ supplier: supplierCode ?? "all" }, "Starting search index rebuild");

  const where: Record<string, unknown> = {};

  if (supplierCode) {
    const supplier = await prisma.supplier.findUnique({
      where: { code: supplierCode },
    });
    if (supplier) where.supplierId = supplier.id;
  }

  const batchSize = 1000;
  let skip = 0;
  let totalIndexed = 0;

  while (true) {
    const products = await prisma.productMap.findMany({
      where,
      skip,
      take: batchSize,
      include: {
        supplier: { select: { code: true, name: true } },
        brand: { select: { code: true, name: true } },
      },
    });

    if (products.length === 0) break;

    const documents = products.map((p) => ({
      id: `${p.supplier.code}_${p.sku}`,
      supplier: p.supplier.code,
      supplierName: p.supplier.name,
      sku: p.sku,
      brand: p.brand.name,
      brandCode: p.brand.code,
      articleNo: p.articleNo,
      ean: p.ean ?? "",
      tecdocId: p.tecdocId ?? "",
      oem: p.oem ?? "",
      description: p.description,
      createdAt: p.createdAt.toISOString(),
    }));

    await meili.index(PRODUCTS_INDEX).addDocuments(documents);

    totalIndexed += documents.length;
    skip += batchSize;

    await job.updateProgress(totalIndexed);

    logger.info(
      { indexed: totalIndexed, supplier: supplierCode ?? "all" },
      "Index batch processed"
    );
  }

  logger.info(
    { total: totalIndexed, supplier: supplierCode ?? "all" },
    "Search index rebuild completed"
  );
}

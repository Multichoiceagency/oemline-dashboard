import { Job } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { meili, PRODUCTS_INDEX } from "../lib/meilisearch.js";
import { logger } from "../lib/logger.js";
import { pushQueue } from "./queues.js";
import { getAllSettings } from "../routes/settings.js";

interface IndexJobData {
  supplierCode?: string;
}

/**
 * Sanitize a string for use as a Meilisearch document ID.
 * Meilisearch only allows alphanumeric chars (a-z A-Z 0-9), hyphens (-), and underscores (_).
 * Replace all disallowed characters with hyphens.
 */
function sanitizeDocId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, "-");
}

/**
 * Wait for a Meilisearch task to complete and check for errors.
 * Returns true if succeeded, false if failed.
 */
async function waitForMeiliTask(taskUid: number, timeoutMs = 120_000): Promise<{ succeeded: boolean; error?: string }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const task = await meili.getTask(taskUid);
    if (task.status === "succeeded") return { succeeded: true };
    if (task.status === "failed") {
      return { succeeded: false, error: task.error?.message ?? "Unknown Meilisearch error" };
    }
    // Still processing or enqueued -- wait briefly before polling again
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { succeeded: false, error: `Task ${taskUid} timed out after ${timeoutMs}ms` };
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

  // Delete stale docs before rebuilding.
  // Full reindex → wipe entire index. Partial → wipe only this supplier's docs.
  // Without this, orphans (deleted/merged products, SKU-renames) accumulate and
  // Meilisearch doc count drifts above the DB row count (e.g. 143% of totaal).
  try {
    const index = meili.index(PRODUCTS_INDEX);
    const deleteTask = supplierCode
      ? await index.deleteDocuments({ filter: `supplier = "${supplierCode}"` })
      : await index.deleteAllDocuments();
    const deleteResult = await waitForMeiliTask(deleteTask.taskUid);
    if (!deleteResult.succeeded) {
      logger.error(
        { taskUid: deleteTask.taskUid, error: deleteResult.error, supplier: supplierCode ?? "all" },
        "Failed to purge stale docs before reindex — continuing anyway (orphans may persist)"
      );
    } else {
      logger.info({ supplier: supplierCode ?? "all" }, "Purged stale docs before reindex");
    }
  } catch (err) {
    logger.error({ err, supplier: supplierCode ?? "all" }, "Delete-before-reindex threw — continuing");
  }

  const batchSize = 10_000;
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
        category: { select: { code: true, name: true } },
      },
    });

    if (products.length === 0) break;

    const documents = products.map((p) => {
      const oemNumbers = Array.isArray(p.oemNumbers) ? (p.oemNumbers as string[]) : [];
      const images = Array.isArray(p.images) ? (p.images as string[]) : [];

      // Normalized article key for deduplication (brand + articleNo, lowercase, no special chars).
      // Meilisearch distinctAttribute returns only 1 result per articleKey.
      // Products prefer: has price > has image > has description (via ranking rules).
      const normalizedArticle = (p.articleNo ?? p.sku).toLowerCase().replace(/[^a-z0-9]/g, "");
      const articleKey = `${p.brand.code}_${normalizedArticle}`;

      return {
        id: sanitizeDocId(`${p.supplier.code}_${p.sku}`),
        articleKey,  // used for deduplication (distinctAttribute)
        supplier: p.supplier.code,
        supplierName: p.supplier.name,
        sku: p.sku,
        brand: p.brand.name,
        brandCode: p.brand.code,
        articleNo: p.articleNo,
        ean: p.ean ?? "",
        tecdocId: p.tecdocId ?? "",
        oem: p.oem ?? "",
        oemNumbers,
        description: p.description,
        imageUrl: p.imageUrl ?? "",
        images,
        genericArticle: p.genericArticle ?? "",
        category: p.category?.name ?? "",
        categoryCode: p.category?.code ?? "",
        price: p.price ?? 0,
        currency: p.currency ?? "EUR",
        stock: p.stock ?? 0,
        weight: p.weight ?? 0,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      };
    });

    try {
      const enqueueResult = await meili.index(PRODUCTS_INDEX).addDocuments(documents);

      // Wait for Meilisearch to actually process the batch and check for errors
      const taskResult = await waitForMeiliTask(enqueueResult.taskUid);
      if (!taskResult.succeeded) {
        logger.error(
          { taskUid: enqueueResult.taskUid, error: taskResult.error, batchSize: documents.length, skip, supplier: supplierCode ?? "all" },
          "Meilisearch task failed for batch — skipping"
        );
      }
    } catch (err) {
      logger.error(
        { err, batchSize: documents.length, skip, supplier: supplierCode ?? "all" },
        "Failed to index batch — skipping"
      );
    }

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

  // Auto-push to output API if configured
  try {
    const settings = await getAllSettings();
    if (settings.output_api_url && settings.auto_push_enabled === "true") {
      await pushQueue.add(
        `push-auto-post-index${supplierCode ? `-${supplierCode}` : ""}`,
        { supplierCode },
        {
          priority: 10, // low priority — runs after urgent jobs
          jobId: `push-auto-${supplierCode ?? "all"}`, // deduplicates: only 1 auto-push queued at a time
        }
      );
      logger.info({ supplierCode: supplierCode ?? "all" }, "Auto-push job enqueued after index");
    }
  } catch (err) {
    logger.warn({ err }, "Failed to enqueue auto-push after index");
  }
}

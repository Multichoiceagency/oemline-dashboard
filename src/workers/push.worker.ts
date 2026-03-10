import { Job } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { getAllSettings } from "../routes/settings.js";

interface PushJobData {
  /** Push only a specific supplier's products (optional) */
  supplierCode?: string;
  /** Maximum number of products to push in this run (optional, default = all) */
  limit?: number;
}

const PUSH_BATCH_SIZE = 100;

export async function processPushJob(job: Job<PushJobData>): Promise<void> {
  const { supplierCode, limit } = job.data;

  const settings = await getAllSettings();
  const outputApiUrl = settings.output_api_url ?? "";
  const outputApiKey = settings.output_api_key ?? "";

  if (!outputApiUrl) {
    logger.warn("Push job skipped — output_api_url not configured");
    return;
  }

  const taxRate = parseFloat(settings.tax_rate ?? "21") / 100;
  const marginPct = parseFloat(settings.margin_percentage ?? "0") / 100;

  const baseWhere: Record<string, unknown> = { status: "active" };
  if (supplierCode) {
    const supplier = await prisma.supplier.findUnique({ where: { code: supplierCode } });
    if (!supplier) throw new Error(`Push job aborted: supplier "${supplierCode}" not found`);
    baseWhere.supplierId = supplier.id;
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (outputApiKey) headers["X-API-Key"] = outputApiKey;

  let skip = 0;
  let totalPushed = 0;
  let errors = 0;

  logger.info({ outputApiUrl, supplierCode: supplierCode ?? "all", limit }, "Starting push to output API");

  while (true) {
    const products = await prisma.productMap.findMany({
      where: baseWhere,
      skip,
      take: PUSH_BATCH_SIZE,
      orderBy: { updatedAt: "desc" },
      include: {
        brand: { select: { id: true, name: true, code: true, logoUrl: true } },
        category: { select: { id: true, name: true, code: true } },
        supplier: { select: { id: true, name: true, code: true } },
      },
    });

    if (products.length === 0) break;

    const payload = products.map((p) => {
      const basePrice = p.price;
      const priceWithMargin = basePrice != null
        ? Math.round(basePrice * (1 + marginPct) * 100) / 100
        : null;
      const priceWithTax = priceWithMargin != null
        ? Math.round(priceWithMargin * (1 + taxRate) * 100) / 100
        : null;

      return {
        id: p.id,
        articleNo: p.articleNo,
        sku: p.sku,
        description: p.description,
        imageUrl: p.imageUrl,
        images: p.images,
        ean: p.ean,
        tecdocId: p.tecdocId,
        oem: p.oem,
        genericArticle: p.genericArticle,
        oemNumbers: p.oemNumbers,
        price: basePrice,
        priceWithMargin,
        priceWithTax,
        currency: p.currency ?? settings.currency,
        stock: p.stock,
        weight: p.weight,
        status: p.status,
        brand: p.brand,
        category: p.category,
        supplier: p.supplier,
        updatedAt: p.updatedAt,
      };
    });

    try {
      const response = await fetch(outputApiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60_000),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        logger.warn(
          { status: response.status, batch: skip / PUSH_BATCH_SIZE, count: payload.length },
          `Output API returned ${response.status}: ${text.slice(0, 200)}`
        );
        errors++;
      } else {
        totalPushed += payload.length;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err: message, batch: skip / PUSH_BATCH_SIZE }, "Push batch failed");
      errors++;
    }

    skip += PUSH_BATCH_SIZE;
    await job.updateProgress(totalPushed);

    // Respect optional limit
    if (limit && totalPushed >= limit) break;
  }

  logger.info(
    { totalPushed, errors, supplierCode: supplierCode ?? "all", outputApiUrl },
    "Push to output API completed"
  );

  if (errors > 0) {
    throw new Error(`Push completed with errors: ${errors} batch(es) failed, ${totalPushed} products pushed`);
  }
}

import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import type { MatchMethod, MatchResult } from "../types/index.js";

/** Strip all non-alphanumeric chars and uppercase for robust comparison */
function normalize(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

interface MatchQuery {
  supplierId: number;
  brandId?: number;
  query: string;
  ean?: string;
  tecdocId?: string;
  articleNo?: string;
  oem?: string;
}

export async function matchProduct(params: MatchQuery): Promise<MatchResult | null> {
  const start = performance.now();
  let result: MatchResult | null = null;

  try {
    // Priority 1: Manual override
    result = await matchByOverride(params);
    if (result) return result;

    // Priority 2: TecDoc ID
    if (params.tecdocId) {
      result = await matchByTecdocId(params);
      if (result) return result;
    }

    // Priority 3: EAN
    if (params.ean) {
      result = await matchByEan(params);
      if (result) return result;
    }

    // Priority 4: Brand + Article Number
    if (params.brandId && params.articleNo) {
      result = await matchByBrandArticle(params);
      if (result) return result;
    }

    // Priority 5: OEM number
    if (params.oem) {
      result = await matchByOem(params);
      if (result) return result;
    }

    // No match — log as unmatched
    await insertUnmatched(params);
    return null;
  } finally {
    const durationMs = Math.round(performance.now() - start);
    await logMatch(params, result, durationMs);
  }
}

async function matchByOverride(params: MatchQuery): Promise<MatchResult | null> {
  const where: Record<string, unknown> = {
    supplierId: params.supplierId,
    active: true,
  };

  if (params.brandId && params.articleNo) {
    where.brandId = params.brandId;
    where.articleNo = params.articleNo;
  } else if (params.ean) {
    where.ean = params.ean;
  } else if (params.tecdocId) {
    where.tecdocId = params.tecdocId;
  } else {
    return null;
  }

  const override = await prisma.override.findFirst({ where });

  if (!override) return null;

  return {
    supplier: params.supplierId.toString(),
    sku: override.sku,
    method: "override",
    confidence: 1.0,
    timestamp: new Date(),
  };
}

async function matchByTecdocId(params: MatchQuery): Promise<MatchResult | null> {
  if (!params.tecdocId) return null;

  const product = await prisma.productMap.findFirst({
    where: {
      supplierId: params.supplierId,
      tecdocId: params.tecdocId,
    },
  });

  if (!product) return null;

  return {
    supplier: params.supplierId.toString(),
    sku: product.sku,
    method: "tecdocId",
    confidence: 0.95,
    timestamp: new Date(),
  };
}

async function matchByEan(params: MatchQuery): Promise<MatchResult | null> {
  if (!params.ean) return null;

  // Try exact match first (uses index)
  let product = await prisma.productMap.findFirst({
    where: {
      supplierId: params.supplierId,
      ean: params.ean,
    },
  });

  if (product) {
    return {
      supplier: params.supplierId.toString(),
      sku: product.sku,
      method: "ean",
      confidence: 0.95,
      timestamp: new Date(),
    };
  }

  // Fallback: normalized EAN (strip non-digits, right-pad to compare)
  const normalizedEan = params.ean.replace(/[^0-9]/g, "");
  if (!normalizedEan || normalizedEan.length < 8) return null;

  const rows = await prisma.$queryRawUnsafe<Array<{ sku: string }>>(
    `SELECT sku FROM product_maps
     WHERE supplier_id = $1
       AND regexp_replace(ean, '[^0-9]', '', 'g') = $2
     LIMIT 1`,
    params.supplierId,
    normalizedEan
  );

  if (rows.length === 0) return null;

  return {
    supplier: params.supplierId.toString(),
    sku: rows[0].sku,
    method: "ean",
    confidence: 0.9,
    timestamp: new Date(),
  };
}

async function matchByBrandArticle(params: MatchQuery): Promise<MatchResult | null> {
  if (!params.brandId || !params.articleNo) return null;

  // Try exact match first (uses index)
  let product = await prisma.productMap.findFirst({
    where: {
      supplierId: params.supplierId,
      brandId: params.brandId,
      articleNo: params.articleNo,
    },
  });

  if (product) {
    return {
      supplier: params.supplierId.toString(),
      sku: product.sku,
      method: "brand_article",
      confidence: 0.90,
      timestamp: new Date(),
    };
  }

  // Fallback: normalized match (strips all non-alphanumeric chars)
  const normalizedArticle = normalize(params.articleNo);
  if (!normalizedArticle) return null;

  const rows = await prisma.$queryRawUnsafe<Array<{ sku: string }>>(
    `SELECT sku FROM product_maps
     WHERE supplier_id = $1 AND brand_id = $2
       AND UPPER(regexp_replace(article_no, '[^a-zA-Z0-9]', '', 'g')) = $3
     LIMIT 1`,
    params.supplierId,
    params.brandId,
    normalizedArticle
  );

  if (rows.length === 0) return null;

  return {
    supplier: params.supplierId.toString(),
    sku: rows[0].sku,
    method: "brand_article",
    confidence: 0.85,
    timestamp: new Date(),
  };
}

async function matchByOem(params: MatchQuery): Promise<MatchResult | null> {
  if (!params.oem) return null;

  // Try exact match first (uses index)
  let product = await prisma.productMap.findFirst({
    where: {
      supplierId: params.supplierId,
      oem: params.oem,
    },
  });

  if (product) {
    return {
      supplier: params.supplierId.toString(),
      sku: product.sku,
      method: "oem",
      confidence: 0.80,
      timestamp: new Date(),
    };
  }

  // Fallback: normalized OEM (strip non-alphanumeric)
  const normalizedOem = normalize(params.oem);
  if (!normalizedOem) return null;

  const rows = await prisma.$queryRawUnsafe<Array<{ sku: string }>>(
    `SELECT sku FROM product_maps
     WHERE supplier_id = $1
       AND UPPER(regexp_replace(oem, '[^a-zA-Z0-9]', '', 'g')) = $2
     LIMIT 1`,
    params.supplierId,
    normalizedOem
  );

  if (rows.length === 0) return null;

  return {
    supplier: params.supplierId.toString(),
    sku: rows[0].sku,
    method: "oem",
    confidence: 0.75,
    timestamp: new Date(),
  };
}

async function insertUnmatched(params: MatchQuery): Promise<void> {
  try {
    await prisma.unmatched.upsert({
      where: {
        supplierId_query: {
          supplierId: params.supplierId,
          query: params.query,
        },
      },
      update: {
        attempts: { increment: 1 },
        ean: params.ean ?? undefined,
        tecdocId: params.tecdocId ?? undefined,
        articleNo: params.articleNo ?? undefined,
        oem: params.oem ?? undefined,
      },
      create: {
        supplierId: params.supplierId,
        brandId: params.brandId ?? null,
        query: params.query,
        articleNo: params.articleNo ?? null,
        ean: params.ean ?? null,
        tecdocId: params.tecdocId ?? null,
        oem: params.oem ?? null,
      },
    });
  } catch (err) {
    logger.error({ err, params }, "Failed to insert unmatched record");
  }
}

async function logMatch(
  params: MatchQuery,
  result: MatchResult | null,
  durationMs: number
): Promise<void> {
  try {
    await prisma.matchLog.create({
      data: {
        supplierId: params.supplierId,
        brandId: params.brandId ?? null,
        query: params.query,
        sku: result?.sku ?? null,
        method: result?.method ?? null,
        confidence: result?.confidence ?? null,
        matched: result !== null,
        durationMs,
        metadata: {
          ean: params.ean ?? null,
          tecdocId: params.tecdocId ?? null,
          articleNo: params.articleNo ?? null,
          oem: params.oem ?? null,
        },
      },
    });
  } catch (err) {
    logger.error({ err }, "Failed to write match log");
  }
}

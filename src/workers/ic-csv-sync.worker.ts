import { Job } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

/**
 * IC CSV Sync Worker
 *
 * Downloads fresh CSV files from IC's HTTPS endpoint daily at ~4:30 AM CET
 * (IC generates them between 3:00-5:30 AM Polish time).
 *
 * Strategy:
 * 1. Download ProductInformation, WholesalePricing, Stock CSVs
 * 2. Upsert intercars_mappings from ProductInformation (ic_index, tecdoc, brand)
 * 3. Bulk update product_maps prices from WholesalePricing
 * 4. Bulk update product_maps stock from Stock (aggregated across warehouses)
 *
 * This replaces the API-based pricing/stock workers for IC products.
 * Zero API calls, zero rate limiting, complete data in ~2 minutes.
 */

const CSV_BASE_URL = "https://data.webapi.intercars.eu/customer";
const CSV_USER = process.env.IC_CSV_USER || "9AI9KF";
const CSV_PASS = process.env.IC_CSV_PASS || "NbcA84FwaQuYkoWy";
const CUSTOMER_ID = process.env.INTERCARS_CUSTOMER_ID || "9AI9KF";

interface IcCsvSyncJobData {
  /** Override date (YYYY-MM-DD), defaults to today */
  date?: string;
  /** Skip product info import (only update prices/stock) */
  priceStockOnly?: boolean;
}

export async function processIcCsvSyncJob(job: Job<IcCsvSyncJobData>): Promise<void> {
  const startTime = Date.now();
  const today = job.data.date || new Date().toISOString().split("T")[0];
  const priceStockOnly = job.data.priceStockOnly ?? false;

  logger.info({ date: today, priceStockOnly }, "IC CSV sync starting");

  const basicAuth = Buffer.from(`${CSV_USER}:${CSV_PASS}`).toString("base64");
  const headers = { Authorization: `Basic ${basicAuth}` };

  // ── Step 1: Download CSVs ─────────────────────────────────────────────
  const productInfoUrl = `${CSV_BASE_URL}/${CUSTOMER_ID}/ProductInformation/ProductInformation_${today}.csv.zip`;
  const pricingUrl = `${CSV_BASE_URL}/${CUSTOMER_ID}/WholesalePricing/Wholesale_Pricing_${today}.csv.zip`;
  const stockUrl = `${CSV_BASE_URL}/${CUSTOMER_ID}/Stock/Stock_${today}.csv.zip`;

  let productRows: ProductInfoRow[] = [];
  let pricingRows: PricingRow[] = [];
  let stockRows: StockRow[] = [];

  try {
    if (!priceStockOnly) {
      logger.info("Downloading ProductInformation CSV...");
      productRows = await downloadAndParseCsv<ProductInfoRow>(productInfoUrl, headers, parseProductInfoRow);
      logger.info({ count: productRows.length }, "ProductInformation loaded");
    }

    logger.info("Downloading WholesalePricing CSV...");
    pricingRows = await downloadAndParseCsv<PricingRow>(pricingUrl, headers, parsePricingRow);
    logger.info({ count: pricingRows.length }, "WholesalePricing loaded");

    logger.info("Downloading Stock CSV...");
    stockRows = await downloadAndParseCsv<StockRow>(stockUrl, headers, parseStockRow);
    logger.info({ count: stockRows.length }, "Stock loaded");
  } catch (err) {
    // If today's file isn't ready yet, try yesterday
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    logger.warn({ err, today, yesterday }, "Today's CSV not available, trying yesterday");

    const yPricingUrl = `${CSV_BASE_URL}/${CUSTOMER_ID}/WholesalePricing/Wholesale_Pricing_${yesterday}.csv.zip`;
    const yStockUrl = `${CSV_BASE_URL}/${CUSTOMER_ID}/Stock/Stock_${yesterday}.csv.zip`;

    pricingRows = await downloadAndParseCsv<PricingRow>(yPricingUrl, headers, parsePricingRow);
    stockRows = await downloadAndParseCsv<StockRow>(yStockUrl, headers, parseStockRow);

    if (!priceStockOnly) {
      const yProductUrl = `${CSV_BASE_URL}/${CUSTOMER_ID}/ProductInformation/ProductInformation_${yesterday}.csv.zip`;
      productRows = await downloadAndParseCsv<ProductInfoRow>(yProductUrl, headers, parseProductInfoRow);
    }
  }

  // ── Step 2: Upsert intercars_mappings from ProductInformation ─────────
  if (productRows.length > 0) {
    const upserted = await upsertMappings(productRows);
    logger.info({ upserted, total: productRows.length }, "intercars_mappings upserted");
    await job.updateProgress(30);
  }

  // ── Step 3: Build price + stock maps ──────────────────────────────────
  const priceMap = new Map<string, number>();
  for (const r of pricingRows) {
    if (r.price > 0) priceMap.set(r.towKod, r.price);
  }

  // Aggregate stock across warehouses
  const stockMap = new Map<string, number>();
  for (const r of stockRows) {
    stockMap.set(r.towKod, (stockMap.get(r.towKod) || 0) + r.availability);
  }

  logger.info({ prices: priceMap.size, stockProducts: stockMap.size }, "Price/stock maps built");

  // ── Step 4: Bulk update product_maps ──────────────────────────────────
  const allToks = new Set([...priceMap.keys(), ...stockMap.keys()]);
  const tokArray = Array.from(allToks);
  let totalUpdated = 0;

  const BATCH = 500;
  for (let i = 0; i < tokArray.length; i += BATCH) {
    const batch = tokArray.slice(i, i + BATCH);
    const values = batch.map(tok => {
      const safeTok = tok.replace(/'/g, "''");
      const price = priceMap.get(tok);
      const stock = stockMap.get(tok) ?? 0;
      const priceVal = price != null ? `${price}::double precision` : "NULL";
      return `('${safeTok}', ${priceVal}, ${stock}::int)`;
    }).join(",");

    try {
      const result = await prisma.$executeRawUnsafe(
        `UPDATE product_maps AS pm SET
          price = COALESCE(v.price, pm.price),
          stock = v.stock,
          updated_at = NOW()
        FROM (VALUES ${values}) AS v(sku, price, stock)
        WHERE pm.ic_sku = v.sku AND pm.status = 'active'`
      );
      totalUpdated += result;
    } catch (err) {
      logger.warn({ err, batch: i / BATCH }, "Bulk price/stock update batch failed");
    }

    if (i % 5000 === 0) {
      const pct = 50 + Math.round(45 * i / tokArray.length);
      await job.updateProgress(pct);
    }
  }

  logger.info({
    totalUpdated,
    prices: priceMap.size,
    stockProducts: stockMap.size,
    productRows: productRows.length,
  }, "IC CSV sync completed");

}

// ── CSV types ───────────────────────────────────────────────────────────

interface ProductInfoRow {
  towKod: string;
  icIndex: string;
  tecdoc: string;
  tecdocProd: number | null;
  articleNumber: string;
  manufacturer: string;
  description: string;
  ean: string | null;
  weight: number | null;
  blockedReturn: boolean;
}

interface PricingRow {
  towKod: string;
  price: number;
}

interface StockRow {
  towKod: string;
  warehouse: string;
  availability: number;
}

// ── CSV parsers ─────────────────────────────────────────────────────────

function parseProductInfoRow(fields: string[]): ProductInfoRow | null {
  if (fields.length < 10 || !fields[0]) return null;
  const tecdocProd = fields[3] ? parseInt(fields[3], 10) : null;
  const weight = fields[9] ? parseFloat(fields[9].replace(",", ".")) : null;
  return {
    towKod: fields[0],
    icIndex: fields[1],
    tecdoc: fields[2],
    tecdocProd: isNaN(tecdocProd as number) ? null : tecdocProd,
    articleNumber: fields[4] || fields[2],
    manufacturer: fields[5],
    description: fields[7] || fields[6] || "",
    ean: fields[8] || null,
    weight: isNaN(weight as number) ? null : weight,
    blockedReturn: fields[14] === "true",
  };
}

function parsePricingRow(fields: string[]): PricingRow | null {
  if (fields.length < 5 || !fields[0]) return null;
  const price = parseFloat((fields[4] || "0").replace(",", "."));
  if (isNaN(price) || price <= 0) return null;
  return { towKod: fields[0], price };
}

function parseStockRow(fields: string[]): StockRow | null {
  if (fields.length < 6 || !fields[0]) return null;
  const availability = parseInt(fields[5] || "0", 10);
  return {
    towKod: fields[0],
    warehouse: fields[4],
    availability: isNaN(availability) ? 0 : availability,
  };
}

// ── CSV download + parse ────────────────────────────────────────────────

async function downloadAndParseCsv<T>(
  url: string,
  headers: Record<string, string>,
  parser: (fields: string[]) => T | null
): Promise<T[]> {
  const resp = await fetch(url, { headers, signal: AbortSignal.timeout(120_000) });
  if (!resp.ok) throw new Error(`CSV download failed: ${resp.status} ${url}`);

  const buffer = Buffer.from(await resp.arrayBuffer());

  // Decompress zip
  const { Readable } = await import("stream");
  const { createUnzip } = await import("zlib");
  const unzipped = await unzipBuffer(buffer);

  // Parse CSV (semicolon-delimited, skip header)
  const text = unzipped.toString("utf-8");
  const lines = text.split("\n");
  const rows: T[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const fields = line.split(";");
    const parsed = parser(fields);
    if (parsed) rows.push(parsed);
  }

  return rows;
}

async function unzipBuffer(buffer: Buffer): Promise<Buffer> {
  // Use AdmZip-style extraction (zip, not gzip)
  // Simple approach: find the file data after the local file header
  const { Readable } = await import("stream");

  // ZIP local file header magic: PK\x03\x04
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new Error("Not a ZIP file");
  }

  // Parse ZIP: find compressed data
  const compressedSize = buffer.readUInt32LE(18);
  const fileNameLen = buffer.readUInt16LE(26);
  const extraLen = buffer.readUInt16LE(28);
  const dataOffset = 30 + fileNameLen + extraLen;
  const compressionMethod = buffer.readUInt16LE(8);

  if (compressionMethod === 0) {
    // Stored (no compression)
    return buffer.subarray(dataOffset, dataOffset + compressedSize);
  }

  // Deflate
  const { inflateRawSync } = await import("zlib");
  const uncompressedSize = buffer.readUInt32LE(22);
  return Buffer.from(inflateRawSync(buffer.subarray(dataOffset, dataOffset + compressedSize)));
}

// ── Upsert intercars_mappings ───────────────────────────────────────────

async function upsertMappings(rows: ProductInfoRow[]): Promise<number> {
  let total = 0;
  const BATCH = 500;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const values: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    for (const r of batch) {
      values.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7}, $${idx + 8}, NOW())`);
      params.push(
        r.towKod, r.icIndex, r.articleNumber, r.manufacturer,
        r.tecdocProd, r.description, r.ean, r.weight, r.blockedReturn
      );
      idx += 9;
    }

    try {
      const result = await prisma.$executeRawUnsafe(
        `INSERT INTO intercars_mappings (tow_kod, ic_index, article_number, manufacturer, tecdoc_prod, description, ean, weight, blocked_return, created_at)
         VALUES ${values.join(",")}
         ON CONFLICT (tow_kod) DO UPDATE SET
           ic_index = EXCLUDED.ic_index,
           article_number = EXCLUDED.article_number,
           manufacturer = EXCLUDED.manufacturer,
           tecdoc_prod = COALESCE(EXCLUDED.tecdoc_prod, intercars_mappings.tecdoc_prod),
           description = COALESCE(NULLIF(EXCLUDED.description, ''), intercars_mappings.description),
           ean = COALESCE(EXCLUDED.ean, intercars_mappings.ean),
           weight = COALESCE(EXCLUDED.weight, intercars_mappings.weight)`,
        ...params
      );
      total += result;
    } catch (err) {
      logger.warn({ err, batch: i / BATCH }, "Mapping upsert batch failed");
    }
  }

  return total;
}

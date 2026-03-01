/**
 * Import InterCars product CSV into the intercars_mappings table.
 *
 * CSV columns (semicolon-separated):
 *   TOW_KOD;IC_INDEX;TEC_DOC;TEC_DOC_PROD;ARTICLE_NUMBER;MANUFACTURER;
 *   SHORT_DESCRIPTION;DESCRIPTION;BARCODES;PACKAGE_WEIGHT;PACKAGE_LENGTH;
 *   PACKAGE_WIDTH;PACKAGE_HEIGHT;CUSTOM_CODE;BLOCKED_RETURN;GTU
 *
 * Usage:
 *   npx tsx src/scripts/import-intercars-csv.ts [path-to-csv]
 *   node dist/scripts/import-intercars-csv.js [path-to-csv]
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { Prisma } from "@prisma/client";

const DEFAULT_CSV = "ProductInformation_2026-02-26.csv";
const BATCH_SIZE = 5000;

interface CsvRow {
  towKod: string;
  icIndex: string;
  articleNumber: string;
  manufacturer: string;
  tecdocProd: number | null;
  description: string;
  ean: string | null;
  weight: number | null;
  blockedReturn: boolean;
}

function parseCsvLine(line: string): CsvRow | null {
  const parts = line.split(";");
  if (parts.length < 15) return null;

  const towKod = parts[0]?.trim();
  if (!towKod || towKod === "TOW_KOD") return null; // skip header

  const icIndex = parts[1]?.trim() ?? "";
  const articleNumber = parts[4]?.trim() ?? parts[2]?.trim() ?? "";
  const manufacturer = parts[5]?.trim() ?? "";
  const tecdocProdRaw = parseInt(parts[3]?.trim() ?? "", 10);
  const tecdocProd = isNaN(tecdocProdRaw) ? null : tecdocProdRaw;
  const shortDesc = parts[6]?.trim() ?? "";
  const longDesc = parts[7]?.trim() ?? "";
  const description = longDesc || shortDesc;

  // BARCODES can have multiple comma-separated values, take first
  const barcodes = parts[8]?.trim() ?? "";
  const ean = barcodes.split(",")[0]?.trim() || null;

  // Weight: European decimal format (comma as separator)
  const weightStr = parts[9]?.trim().replace(",", ".") ?? "";
  const weight = parseFloat(weightStr);
  const weightVal = isNaN(weight) ? null : weight;

  const blockedReturn = parts[14]?.trim().toLowerCase() === "true";

  if (!articleNumber || !manufacturer) return null;

  return {
    towKod,
    icIndex,
    articleNumber,
    manufacturer,
    tecdocProd,
    description,
    ean,
    weight: weightVal,
    blockedReturn,
  };
}

async function bulkInsert(rows: CsvRow[]): Promise<void> {
  if (rows.length === 0) return;

  const values = rows.map((r) =>
    Prisma.sql`(
      ${r.towKod}, ${r.icIndex}, ${r.articleNumber}, ${r.manufacturer},
      ${r.tecdocProd}, ${r.description}, ${r.ean}, ${r.weight},
      ${r.blockedReturn}, NOW()
    )`
  );

  await prisma.$executeRaw`
    INSERT INTO intercars_mappings (
      tow_kod, ic_index, article_number, manufacturer,
      tecdoc_prod, description, ean, weight,
      blocked_return, created_at
    )
    VALUES ${Prisma.join(values)}
    ON CONFLICT (tow_kod) DO UPDATE SET
      ic_index = EXCLUDED.ic_index,
      article_number = EXCLUDED.article_number,
      manufacturer = EXCLUDED.manufacturer,
      tecdoc_prod = EXCLUDED.tecdoc_prod,
      description = CASE WHEN EXCLUDED.description != '' THEN EXCLUDED.description ELSE intercars_mappings.description END,
      ean = COALESCE(EXCLUDED.ean, intercars_mappings.ean),
      weight = COALESCE(EXCLUDED.weight, intercars_mappings.weight),
      blocked_return = EXCLUDED.blocked_return
  `;
}

async function main() {
  const csvPath = process.argv[2] || DEFAULT_CSV;
  logger.info({ csvPath }, "Starting InterCars CSV import");

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

  // Create indexes
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_ic_map_mfr_art ON intercars_mappings (manufacturer, article_number)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_ic_map_art ON intercars_mappings (article_number)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_ic_map_ean ON intercars_mappings (ean)
  `);

  const stream = createReadStream(csvPath, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let batch: CsvRow[] = [];
  let totalImported = 0;
  let totalSkipped = 0;
  let lineNum = 0;

  for await (const line of rl) {
    lineNum++;
    if (lineNum === 1) continue; // skip header

    const row = parseCsvLine(line);
    if (!row) {
      totalSkipped++;
      continue;
    }

    batch.push(row);

    if (batch.length >= BATCH_SIZE) {
      await bulkInsert(batch);
      totalImported += batch.length;
      batch = [];

      if (totalImported % 50000 === 0) {
        logger.info(
          { totalImported, totalSkipped, lineNum },
          "InterCars CSV import progress"
        );
      }
    }
  }

  // Final batch
  if (batch.length > 0) {
    await bulkInsert(batch);
    totalImported += batch.length;
  }

  logger.info(
    { totalImported, totalSkipped, totalLines: lineNum },
    "InterCars CSV import completed"
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  logger.error({ err }, "InterCars CSV import failed");
  process.exit(1);
});

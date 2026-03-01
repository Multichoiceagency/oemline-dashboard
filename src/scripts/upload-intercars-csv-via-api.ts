/**
 * Upload InterCars CSV data to the remote API in batches.
 * This avoids needing to copy the large CSV file to the server.
 *
 * Usage: npx tsx src/scripts/upload-intercars-csv-via-api.ts
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const API_URL = process.env.API_URL || "https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu";
const API_KEY = process.env.API_KEY || "oemline_api_key_change_me";
const CSV_PATH = process.argv[2] || "ProductInformation_2026-02-26.csv";
const BATCH_SIZE = 2000;

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

function parseLine(line: string): CsvRow | null {
  const parts = line.split(";");
  if (parts.length < 15) return null;

  const towKod = parts[0]?.trim();
  if (!towKod || towKod === "TOW_KOD") return null;

  const articleNumber = parts[4]?.trim() ?? "";
  const manufacturer = parts[5]?.trim() ?? "";
  if (!articleNumber || !manufacturer) return null;

  const tecdocProdRaw = parseInt(parts[3]?.trim() ?? "", 10);
  const weightStr = parts[9]?.trim().replace(",", ".") ?? "";
  const weightVal = parseFloat(weightStr);

  return {
    towKod,
    icIndex: parts[1]?.trim() ?? "",
    articleNumber,
    manufacturer,
    tecdocProd: isNaN(tecdocProdRaw) ? null : tecdocProdRaw,
    description: parts[7]?.trim() || parts[6]?.trim() || "",
    ean: parts[8]?.trim().split(",")[0] || null,
    weight: isNaN(weightVal) ? null : weightVal,
    blockedReturn: parts[14]?.trim().toLowerCase() === "true",
  };
}

async function sendBatch(rows: CsvRow[]): Promise<void> {
  const response = await fetch(`${API_URL}/api/intercars/import-batch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": API_KEY,
    },
    body: JSON.stringify({ rows }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API error ${response.status}: ${text}`);
  }
}

async function main() {
  console.log(`Uploading InterCars CSV from ${CSV_PATH} to ${API_URL}`);

  const stream = createReadStream(CSV_PATH, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let batch: CsvRow[] = [];
  let totalSent = 0;
  let lineNum = 0;

  for await (const line of rl) {
    lineNum++;
    if (lineNum === 1) continue;

    const row = parseLine(line);
    if (!row) continue;

    batch.push(row);

    if (batch.length >= BATCH_SIZE) {
      await sendBatch(batch);
      totalSent += batch.length;
      batch = [];

      if (totalSent % 10000 === 0) {
        console.log(`Sent ${totalSent} rows...`);
      }
    }
  }

  if (batch.length > 0) {
    await sendBatch(batch);
    totalSent += batch.length;
  }

  console.log(`Done! Total sent: ${totalSent} rows from ${lineNum} lines`);
}

main().catch((err) => {
  console.error("Upload failed:", err);
  process.exit(1);
});

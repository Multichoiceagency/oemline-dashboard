/**
 * Upload InterCars CSV data to the remote API in batches.
 * This avoids needing to copy the large CSV file to the server.
 *
 * Usage: npx tsx src/scripts/upload-intercars-csv-via-api.ts [path-to-csv]
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const API_URL = process.env.API_URL || "https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu";
const API_KEY = process.env.API_KEY || "oemline_api_key_change_me";
const CSV_PATH = process.argv[2] || "ProductInformation_2026-02-26.csv";
const BATCH_SIZE = 2000;
const DELAY_MS = 800; // delay between batches to avoid rate limiting

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

function deduplicateBatch(rows: CsvRow[]): CsvRow[] {
  const map = new Map<string, CsvRow>();
  for (const r of rows) {
    map.set(r.towKod, r);
  }
  return Array.from(map.values());
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sendBatch(rows: CsvRow[], retries = 5): Promise<number> {
  const unique = deduplicateBatch(rows);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${API_URL}/api/intercars/import-batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": API_KEY,
        },
        body: JSON.stringify({ rows: unique }),
      });

      if (response.status === 429) {
        // Rate limited - extract retry-after or use exponential backoff
        const retryAfter = parseInt(response.headers.get("retry-after") || "30", 10);
        const waitMs = Math.max(retryAfter * 1000, 5000 * attempt);
        console.warn(`Rate limited, waiting ${Math.round(waitMs / 1000)}s (attempt ${attempt}/${retries})...`);
        await sleep(waitMs);
        continue;
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`API error ${response.status}: ${text}`);
      }
      return unique.length;
    } catch (err) {
      if (attempt === retries) throw err;
      const isRateLimit = err instanceof Error && err.message.includes("429");
      const waitMs = isRateLimit ? 30000 : 2000 * attempt;
      console.warn(`Batch failed (attempt ${attempt}/${retries}), retrying in ${Math.round(waitMs / 1000)}s...`);
      await sleep(waitMs);
    }
  }
  return 0;
}

async function main() {
  console.log(`Uploading InterCars CSV from ${CSV_PATH} to ${API_URL}`);
  console.log(`Batch size: ${BATCH_SIZE}, delay: ${DELAY_MS}ms`);

  const stream = createReadStream(CSV_PATH, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let batch: CsvRow[] = [];
  let totalSent = 0;
  let lineNum = 0;
  let batchNum = 0;

  for await (const line of rl) {
    lineNum++;
    if (lineNum === 1) continue;

    const row = parseLine(line);
    if (!row) continue;

    batch.push(row);

    if (batch.length >= BATCH_SIZE) {
      const sent = await sendBatch(batch);
      totalSent += sent;
      batchNum++;
      batch = [];

      if (totalSent % 10000 === 0) {
        console.log(`Sent ${totalSent} rows (line ${lineNum}, batch #${batchNum})...`);
      }

      // Throttle to avoid rate limiting
      await sleep(DELAY_MS);
    }
  }

  if (batch.length > 0) {
    const sent = await sendBatch(batch);
    totalSent += sent;
  }

  console.log(`Done! Total sent: ${totalSent} rows from ${lineNum} lines in ${batchNum + 1} batches`);
}

main().catch((err) => {
  console.error("Upload failed:", err);
  process.exit(1);
});

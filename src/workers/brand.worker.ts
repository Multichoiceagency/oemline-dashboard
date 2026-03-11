import { Job } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { config } from "../config.js";

/**
 * processBrandSyncJob
 *
 * Runs every 24 hours:
 * 1. Sync brands from TecDoc getBrands (upsert all 100)
 * 2. Fetch brand logos via getBrands includeDataSupplierLogo
 * 3. Delete brands not in TecDoc with no products (cleanup)
 */
export async function processBrandSyncJob(_job: Job): Promise<void> {
  const apiUrl = config.TECDOC_API_URL;
  const apiKey = config.TECDOC_API_KEY;

  if (!apiKey) {
    throw new Error("TECDOC_API_KEY not configured");
  }

  // ── Step 1: getBrands with logos ─────────────────────────────────────────
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
    body: JSON.stringify({
      getBrands: {
        articleCountry: "NL",
        providerId: 22691,
        lang: "nl",
        perPage: 100,
        page: 1,
        includeDataSupplierLogo: true,
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`TecDoc getBrands failed: ${response.status}`);
  }

  type BrandItem = {
    dataSupplierId?: number;
    mfrName?: string;
    dataSupplierLogo?: {
      imageURL100?: string;
      imageURL200?: string;
      imageURL400?: string;
    };
  };

  const json = (await response.json()) as { data?: { array?: BrandItem[] } };
  const items: BrandItem[] = json?.data?.array ?? [];

  const rawBrands = items.filter((f) => f.dataSupplierId != null && f.mfrName);
  logger.info({ count: rawBrands.length }, "Brand sync: fetched from TecDoc");

  // ── Step 2: Upsert all brands + logos ─────────────────────────────────────
  let upserted = 0;
  for (const b of rawBrands) {
    const name = b.mfrName!;
    const tecdocId = b.dataSupplierId!;
    const code = name.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
    const logo = b.dataSupplierLogo;
    const logoUrl = logo?.imageURL400 ?? logo?.imageURL200 ?? logo?.imageURL100 ?? null;

    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO brands (name, code, tecdoc_id, logo_url, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         ON CONFLICT (code) DO UPDATE SET
           tecdoc_id = EXCLUDED.tecdoc_id,
           logo_url  = COALESCE(EXCLUDED.logo_url, brands.logo_url),
           updated_at = NOW()`,
        name, code, tecdocId, logoUrl
      );
      upserted++;
    } catch {
      try {
        await prisma.$executeRawUnsafe(
          `INSERT INTO brands (name, code, tecdoc_id, logo_url, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW())
           ON CONFLICT (name) DO UPDATE SET
             tecdoc_id = EXCLUDED.tecdoc_id,
             logo_url  = COALESCE(EXCLUDED.logo_url, brands.logo_url),
             updated_at = NOW()`,
          name, `${code}_${tecdocId}`, tecdocId, logoUrl
        );
        upserted++;
      } catch (err2) {
        logger.warn({ err: err2, name }, "Brand upsert failed (skipping)");
      }
    }
  }

  // ── Step 3: Delete brands not in TecDoc with no products ──────────────────
  const tecdocIds = rawBrands.map((b) => b.dataSupplierId!);
  const deleted = await prisma.brand.deleteMany({
    where: {
      OR: [
        { tecdocId: { notIn: tecdocIds } },
        { tecdocId: null },
      ],
      productMaps: { none: {} },
    },
  });

  const total = await prisma.brand.count();
  const withLogo = await prisma.brand.count({ where: { logoUrl: { not: null } } });

  logger.info(
    { fetched: rawBrands.length, upserted, deletedEmpty: deleted.count, total, withLogo },
    "Brand sync completed"
  );
}

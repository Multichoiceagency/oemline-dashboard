import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

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

export async function intercarsRoutes(app: FastifyInstance) {
  // Ensure table exists
  app.addHook("onReady", async () => {
    try {
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
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_ic_map_mfr_art ON intercars_mappings (manufacturer, article_number)`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_ic_map_art ON intercars_mappings (article_number)`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_ic_map_ean ON intercars_mappings (ean)`);
    } catch (err) {
      logger.warn({ err }, "Could not ensure intercars_mappings table");
    }
  });

  // Get mapping stats
  app.get("/intercars/mapping-stats", async () => {
    try {
      const result = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM intercars_mappings`
      );
      const total = Number(result[0]?.count ?? 0);

      const topBrands = await prisma.$queryRawUnsafe<Array<{ manufacturer: string; count: bigint }>>(
        `SELECT manufacturer, COUNT(*) as count FROM intercars_mappings GROUP BY manufacturer ORDER BY count DESC LIMIT 20`
      );

      return {
        totalMappings: total,
        topBrands: topBrands.map((b) => ({ brand: b.manufacturer, count: Number(b.count) })),
      };
    } catch {
      return { totalMappings: 0, topBrands: [] };
    }
  });

  // Batch import endpoint - accepts JSON array of rows
  app.post("/intercars/import-batch", async (request) => {
    const body = request.body as { rows: CsvRow[] };
    const rows = body?.rows;

    if (!Array.isArray(rows) || rows.length === 0) {
      return { imported: 0 };
    }

    const validRows = rows.filter((r) => r.towKod && r.articleNumber && r.manufacturer);

    if (validRows.length === 0) {
      return { imported: 0 };
    }

    // Deduplicate by towKod within the batch (keep last occurrence)
    const deduped = new Map<string, CsvRow>();
    for (const r of validRows) {
      deduped.set(r.towKod, r);
    }
    const uniqueRows = Array.from(deduped.values());

    const values = uniqueRows.map((r) =>
      Prisma.sql`(
        ${r.towKod}, ${r.icIndex ?? ""}, ${r.articleNumber}, ${r.manufacturer},
        ${r.tecdocProd}, ${r.description ?? ""}, ${r.ean}, ${r.weight},
        ${r.blockedReturn ?? false}, NOW()
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

    return { imported: uniqueRows.length };
  });

  // Lookup: find IC mapping for a brand + article number (flexible brand match)
  app.get("/intercars/lookup", async (request) => {
    const { brand, articleNo } = request.query as { brand?: string; articleNo?: string };

    if (!brand || !articleNo) {
      return { items: [] };
    }

    const results = await prisma.$queryRawUnsafe<Array<{
      tow_kod: string;
      ic_index: string;
      article_number: string;
      manufacturer: string;
      description: string;
      ean: string | null;
    }>>(
      `SELECT tow_kod, ic_index, article_number, manufacturer, description, ean
       FROM intercars_mappings
       WHERE UPPER(regexp_replace(article_number, '[^a-zA-Z0-9]', '', 'g')) = UPPER(regexp_replace($2, '[^a-zA-Z0-9]', '', 'g'))
         AND (
           UPPER(regexp_replace(manufacturer, '[^a-zA-Z0-9]', '', 'g')) = UPPER(regexp_replace($1, '[^a-zA-Z0-9]', '', 'g'))
           OR (
             LENGTH(regexp_replace(manufacturer, '[^a-zA-Z0-9]', '', 'g')) >= 3
             AND UPPER(regexp_replace($1, '[^a-zA-Z0-9]', '', 'g'))
               LIKE UPPER(regexp_replace(manufacturer, '[^a-zA-Z0-9]', '', 'g')) || '%'
           )
           OR (
             LENGTH(regexp_replace($1, '[^a-zA-Z0-9]', '', 'g')) >= 3
             AND UPPER(regexp_replace(manufacturer, '[^a-zA-Z0-9]', '', 'g'))
               LIKE UPPER(regexp_replace($1, '[^a-zA-Z0-9]', '', 'g')) || '%'
           )
         )
       LIMIT 10`,
      brand,
      articleNo
    );

    return {
      items: results.map((r) => ({
        towKod: r.tow_kod,
        icIndex: r.ic_index,
        articleNumber: r.article_number,
        manufacturer: r.manufacturer,
        description: r.description,
        ean: r.ean,
      })),
    };
  });

  // Test one product: find IC mapping, fetch price/stock, update TecDoc product
  app.get("/intercars/test-match", async (request) => {
    const { productId } = request.query as { productId?: string };

    // Find a TecDoc product that matches IC CSV
    let matchQuery: string;
    let matchParams: unknown[];

    if (productId) {
      matchQuery = `
        SELECT pm.id as product_id, pm.sku, pm.article_no, b.name as brand_name,
               im.tow_kod, im.manufacturer as ic_brand, im.article_number as ic_article,
               im.description as ic_description, im.ean as ic_ean
        FROM product_maps pm
        JOIN brands b ON b.id = pm.brand_id
        JOIN intercars_mappings im ON
          UPPER(regexp_replace(im.article_number, '[^a-zA-Z0-9]', '', 'g')) = UPPER(regexp_replace(pm.article_no, '[^a-zA-Z0-9]', '', 'g'))
          AND (
            UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) = UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))
            OR (LENGTH(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) >= 3
                AND UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))
                  LIKE UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) || '%')
            OR (LENGTH(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) >= 3
                AND UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g'))
                  LIKE UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) || '%')
          )
        WHERE pm.id = $1
        LIMIT 1`;
      matchParams = [Number(productId)];
    } else {
      matchQuery = `
        SELECT pm.id as product_id, pm.sku, pm.article_no, b.name as brand_name,
               im.tow_kod, im.manufacturer as ic_brand, im.article_number as ic_article,
               im.description as ic_description, im.ean as ic_ean
        FROM product_maps pm
        JOIN brands b ON b.id = pm.brand_id
        JOIN intercars_mappings im ON
          UPPER(regexp_replace(im.article_number, '[^a-zA-Z0-9]', '', 'g')) = UPPER(regexp_replace(pm.article_no, '[^a-zA-Z0-9]', '', 'g'))
          AND (
            UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) = UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))
            OR (LENGTH(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) >= 3
                AND UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))
                  LIKE UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) || '%')
            OR (LENGTH(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) >= 3
                AND UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g'))
                  LIKE UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) || '%')
          )
        WHERE pm.status = 'active'
        ORDER BY RANDOM()
        LIMIT 1`;
      matchParams = [];
    }

    const matched = await prisma.$queryRawUnsafe<Array<{
      product_id: number;
      sku: string;
      article_no: string;
      brand_name: string;
      tow_kod: string;
      ic_brand: string;
      ic_article: string;
      ic_description: string;
      ic_ean: string | null;
    }>>(matchQuery, ...matchParams);

    if (matched.length === 0) {
      return { error: "No matching product found in IC CSV mapping" };
    }

    const product = matched[0];

    return {
      step1_tecdoc_product: {
        id: product.product_id,
        sku: product.sku,
        brand: product.brand_name,
        articleNo: product.article_no,
      },
      step2_ic_csv_match: {
        towKod: product.tow_kod,
        icBrand: product.ic_brand,
        icArticle: product.ic_article,
        icDescription: product.ic_description,
        icEan: product.ic_ean,
        brandMatchMethod:
          product.brand_name.replace(/[^a-zA-Z0-9]/g, "").toUpperCase() ===
          product.ic_brand.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()
            ? "exact"
            : "prefix",
      },
      step3_note: `Call IC API: stock → /inventory/stock?sku=${product.tow_kod}, pricing → /dropshipping/pricing/quote?sku=${product.tow_kod}&quantity=1`,
    };
  });

  // Count how many TecDoc products match IC CSV (with flexible brand matching)
  app.get("/intercars/match-count", async () => {
    const result = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(DISTINCT pm.id) as count
       FROM product_maps pm
       JOIN brands b ON b.id = pm.brand_id
       JOIN intercars_mappings im ON
         UPPER(regexp_replace(im.article_number, '[^a-zA-Z0-9]', '', 'g')) = UPPER(regexp_replace(pm.article_no, '[^a-zA-Z0-9]', '', 'g'))
         AND (
           UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) = UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))
           OR (LENGTH(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) >= 3
               AND UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))
                 LIKE UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) || '%')
           OR (LENGTH(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) >= 3
               AND UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g'))
                 LIKE UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) || '%')
         )
       WHERE pm.status = 'active'`
    );

    return {
      matchedProducts: Number(result[0]?.count ?? 0),
      note: "TecDoc products that have a matching IC CSV entry (flexible brand matching)",
    };
  });
}

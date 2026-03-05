import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { syncQueue, matchQueue, indexQueue, pricingQueue, stockQueue, icMatchQueue, aiMatchQueue } from "../workers/queues.js";

export async function jobRoutes(app: FastifyInstance) {
  // Get all job queue status
  app.get("/jobs/status", async () => {
    const [syncCounts, matchCounts, indexCounts, pricingCounts, stockCounts, icMatchCounts] = await Promise.all([
      getQueueCounts(syncQueue),
      getQueueCounts(matchQueue),
      getQueueCounts(indexQueue),
      getQueueCounts(pricingQueue),
      getQueueCounts(stockQueue),
      getQueueCounts(icMatchQueue),
    ]);

    const aiMatchCounts = await getQueueCounts(aiMatchQueue);
    return {
      sync: syncCounts,
      match: matchCounts,
      index: indexCounts,
      pricing: pricingCounts,
      stock: stockCounts,
      icMatch: icMatchCounts,
      aiMatch: aiMatchCounts,
    };
  });

  // Get recent completed/failed jobs for a queue
  app.get("/jobs/:queue/history", async (request) => {
    const { queue } = request.params as { queue: string };
    const q = getQueue(queue);
    if (!q) return { error: "Unknown queue" };

    const [completed, failed] = await Promise.all([
      q.getCompleted(0, 20),
      q.getFailed(0, 20),
    ]);

    return {
      completed: completed.map(formatJob),
      failed: failed.map(formatJob),
    };
  });

  // Manually trigger a sync job for a supplier
  app.post("/jobs/sync", async (request) => {
    const schema = z.object({ supplierCode: z.string().min(1) });
    const { supplierCode } = schema.parse(request.body);

    const job = await syncQueue.add(
      `sync-manual-${supplierCode}`,
      { supplierCode },
      { priority: 1 }
    );

    return { jobId: job.id, queue: "sync", supplierCode, status: "queued" };
  });

  // Manually trigger a match job for a supplier
  app.post("/jobs/match", async (request) => {
    const schema = z.object({ supplierCode: z.string().min(1) });
    const { supplierCode } = schema.parse(request.body);

    const job = await matchQueue.add(
      `match-manual-${supplierCode}`,
      { supplierCode },
      { priority: 1 }
    );

    return { jobId: job.id, queue: "match", supplierCode, status: "queued" };
  });

  // Manually trigger a pricing refresh job for a supplier
  app.post("/jobs/pricing", async (request) => {
    const schema = z.object({ supplierCode: z.string().min(1).default("intercars") });
    const { supplierCode } = schema.parse(request.body ?? {});

    const job = await pricingQueue.add(
      `pricing-manual-${supplierCode}`,
      { supplierCode },
      { priority: 1 }
    );

    return { jobId: job.id, queue: "pricing", supplierCode, status: "queued" };
  });

  // Manually trigger a stock refresh job for a supplier
  app.post("/jobs/stock", async (request) => {
    const schema = z.object({ supplierCode: z.string().min(1).default("intercars") });
    const { supplierCode } = schema.parse(request.body ?? {});

    const job = await stockQueue.add(
      `stock-manual-${supplierCode}`,
      { supplierCode },
      { priority: 1 }
    );

    return { jobId: job.id, queue: "stock", supplierCode, status: "queued" };
  });

  // Manually trigger IC match job for a supplier
  app.post("/jobs/ic-match", async (request) => {
    const schema = z.object({ supplierCode: z.string().min(1).default("intercars") });
    const { supplierCode } = schema.parse(request.body ?? {});

    const job = await icMatchQueue.add(
      `ic-match-manual-${supplierCode}`,
      { supplierCode },
      { priority: 1 }
    );

    return { jobId: job.id, queue: "ic-match", supplierCode, status: "queued" };
  });

  // Manually trigger an index rebuild
  app.post("/jobs/index", async (request) => {
    const body = (request.body ?? {}) as { supplierCode?: string };

    const job = await indexQueue.add(
      "reindex-manual",
      { supplierCode: body.supplierCode },
      { priority: 1 }
    );

    return { jobId: job.id, queue: "index", status: "queued" };
  });

  // Debug: check Redis connection and queue state (non-destructive)
  app.get("/jobs/debug", async () => {
    const { redis } = await import("../lib/redis.js");

    const pingResult = await redis.ping();

    // Use BullMQ's built-in methods instead of redis.keys()
    const [syncCounts, matchCounts, indexCounts, pricingCounts, stockCounts, icMatchCounts] = await Promise.all([
      syncQueue.getJobCounts("active", "completed", "delayed", "failed", "waiting", "prioritized"),
      matchQueue.getJobCounts("active", "completed", "delayed", "failed", "waiting", "prioritized"),
      indexQueue.getJobCounts("active", "completed", "delayed", "failed", "waiting", "prioritized"),
      pricingQueue.getJobCounts("active", "completed", "delayed", "failed", "waiting", "prioritized"),
      stockQueue.getJobCounts("active", "completed", "delayed", "failed", "waiting", "prioritized"),
      icMatchQueue.getJobCounts("active", "completed", "delayed", "failed", "waiting", "prioritized"),
    ]);

    return {
      redisConnected: pingResult === "PONG",
      sync: syncCounts,
      match: matchCounts,
      index: indexCounts,
      pricing: pricingCounts,
      stock: stockCounts,
      icMatch: icMatchCounts,
    };
  });

  // Import InterCars CSV mapping (from local file or MinIO)
  // Extend timeout: CSV import processes ~565K rows and can take minutes
  app.post("/jobs/import-intercars-csv", {
    onRequest: async (request) => { request.raw.socket.setTimeout(300_000); },
  }, async (request) => {
    const { prisma } = await import("../lib/prisma.js");
    const { logger } = await import("../lib/logger.js");
    const { createReadStream, existsSync } = await import("node:fs");
    const { createInterface } = await import("node:readline");
    const { Prisma } = await import("@prisma/client");
    const { resolve } = await import("node:path");
    const { getObjectStream } = await import("../lib/minio.js");

    const body = (request.body ?? {}) as { csvPath?: string; minioKey?: string };
    const csvPath = body.csvPath || resolve(process.cwd(), "ProductInformation_2026-02-26.csv");

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
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_ic_map_mfr_art ON intercars_mappings (manufacturer, article_number)`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_ic_map_art ON intercars_mappings (article_number)`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_im_article_norm ON intercars_mappings (UPPER(regexp_replace(article_number, '[^a-zA-Z0-9]', '', 'g')))`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_im_ean_norm ON intercars_mappings (UPPER(TRIM(ean))) WHERE ean IS NOT NULL`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_im_tecdoc_prod ON intercars_mappings (tecdoc_prod) WHERE tecdoc_prod IS NOT NULL`);

    // Stream the CSV - from MinIO if minioKey provided, otherwise local file
    const BATCH_SIZE = 5000;
    let batch: Array<{ towKod: string; icIndex: string; articleNumber: string; manufacturer: string; tecdocProd: number | null; description: string; ean: string | null; weight: number | null; blockedReturn: boolean }> = [];
    let totalImported = 0;

    let stream: NodeJS.ReadableStream;
    if (body.minioKey) {
      logger.info({ minioKey: body.minioKey }, "Reading CSV from MinIO");
      stream = await getObjectStream(body.minioKey);
    } else if (existsSync(csvPath)) {
      stream = createReadStream(csvPath, { encoding: "utf-8" });
    } else {
      // Try default MinIO path
      logger.info("No local CSV found, trying MinIO files/ProductInformation.csv");
      try {
        stream = await getObjectStream("files/ProductInformation_2026-02-26.csv");
      } catch {
        return { error: "CSV file not found locally or in MinIO. Provide csvPath or minioKey parameter." };
      }
    }
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    let lineNum = 0;

    for await (const line of rl) {
      lineNum++;
      if (lineNum === 1) continue;

      const parts = line.split(";");
      if (parts.length < 15) continue;

      const towKod = parts[0]?.trim();
      if (!towKod) continue;

      const articleNumber = parts[4]?.trim() ?? "";
      const manufacturer = parts[5]?.trim() ?? "";
      if (!articleNumber || !manufacturer) continue;

      const tecdocProdRaw = parseInt(parts[3]?.trim() ?? "", 10);
      const weightStr = parts[9]?.trim().replace(",", ".") ?? "";
      const weightVal = parseFloat(weightStr);

      batch.push({
        towKod,
        icIndex: parts[1]?.trim() ?? "",
        articleNumber,
        manufacturer,
        tecdocProd: isNaN(tecdocProdRaw) ? null : tecdocProdRaw,
        description: parts[7]?.trim() || parts[6]?.trim() || "",
        ean: parts[8]?.trim().split(",")[0] || null,
        weight: isNaN(weightVal) ? null : weightVal,
        blockedReturn: parts[14]?.trim().toLowerCase() === "true",
      });

      if (batch.length >= BATCH_SIZE) {
        const values = batch.map((r) =>
          Prisma.sql`(${r.towKod}, ${r.icIndex}, ${r.articleNumber}, ${r.manufacturer}, ${r.tecdocProd}, ${r.description}, ${r.ean}, ${r.weight}, ${r.blockedReturn}, NOW())`
        );
        await prisma.$executeRaw`
          INSERT INTO intercars_mappings (tow_kod, ic_index, article_number, manufacturer, tecdoc_prod, description, ean, weight, blocked_return, created_at)
          VALUES ${Prisma.join(values)}
          ON CONFLICT (tow_kod) DO UPDATE SET
            ic_index = EXCLUDED.ic_index, article_number = EXCLUDED.article_number,
            manufacturer = EXCLUDED.manufacturer, tecdoc_prod = EXCLUDED.tecdoc_prod,
            description = CASE WHEN EXCLUDED.description != '' THEN EXCLUDED.description ELSE intercars_mappings.description END,
            ean = COALESCE(EXCLUDED.ean, intercars_mappings.ean),
            weight = COALESCE(EXCLUDED.weight, intercars_mappings.weight),
            blocked_return = EXCLUDED.blocked_return
        `;
        totalImported += batch.length;
        batch = [];

        if (totalImported % 50000 === 0) {
          logger.info({ totalImported }, "InterCars CSV import progress");
        }
      }
    }

    if (batch.length > 0) {
      const values = batch.map((r) =>
        Prisma.sql`(${r.towKod}, ${r.icIndex}, ${r.articleNumber}, ${r.manufacturer}, ${r.tecdocProd}, ${r.description}, ${r.ean}, ${r.weight}, ${r.blockedReturn}, NOW())`
      );
      await prisma.$executeRaw`
        INSERT INTO intercars_mappings (tow_kod, ic_index, article_number, manufacturer, tecdoc_prod, description, ean, weight, blocked_return, created_at)
        VALUES ${Prisma.join(values)}
        ON CONFLICT (tow_kod) DO UPDATE SET
          ic_index = EXCLUDED.ic_index, article_number = EXCLUDED.article_number,
          manufacturer = EXCLUDED.manufacturer, tecdoc_prod = EXCLUDED.tecdoc_prod,
          description = CASE WHEN EXCLUDED.description != '' THEN EXCLUDED.description ELSE intercars_mappings.description END,
          ean = COALESCE(EXCLUDED.ean, intercars_mappings.ean),
          weight = COALESCE(EXCLUDED.weight, intercars_mappings.weight),
          blocked_return = EXCLUDED.blocked_return
      `;
      totalImported += batch.length;
    }

    logger.info({ totalImported, totalLines: lineNum }, "InterCars CSV import completed");

    return { imported: totalImported, totalLines: lineNum };
  });

  /**
   * Import Diederichs Stock.csv from FTP.
   * CSV format (semicolon-separated): "ARTICLE_NO   ";STOCK   ;"EAN"
   *
   * For each row: matches by EAN against existing TecDoc products and creates/updates
   * a product_map entry under the Diederichs supplier with current stock.
   * Also activates the Diederichs supplier and updates adapterType to "diederichs".
   */
  app.post("/jobs/import-diederichs-ftp", {
    onRequest: async (request) => { request.raw.socket.setTimeout(120_000); },
  }, async () => {
    const { prisma } = await import("../lib/prisma.js");
    const { logger } = await import("../lib/logger.js");
    const { Prisma } = await import("@prisma/client");
    const ftp = await import("basic-ftp");
    const os = await import("node:os");
    const path = await import("node:path");
    const fs = await import("node:fs/promises");

    logger.info("Downloading Diederichs Stock.csv from FTP...");

    let csvData: string;
    const tmpFile = path.join(os.tmpdir(), `diederichs-stock-${Date.now()}.csv`);
    const client = new ftp.Client(30_000);
    try {
      await client.access({
        host: "km1106.promserver.de",
        user: "died_stock",
        password: "Qa1w8&9a",
        secure: false,
      });
      await client.downloadTo(tmpFile, "/Stock.csv");
      csvData = await fs.readFile(tmpFile, "utf8");
    } catch (err) {
      logger.error({ err }, "Diederichs FTP download failed");
      return { error: "FTP download failed", details: String(err) };
    } finally {
      client.close();
      await fs.unlink(tmpFile).catch(() => { /* ignore */ });
    }

    // Ensure Diederichs supplier exists and is configured
    let supplier = await prisma.supplier.findUnique({ where: { code: "diederichs" } });
    if (!supplier) {
      return { error: "Diederichs supplier not found. Create it in the suppliers page first." };
    }

    // Update adapterType to diederichs and activate if needed
    if (supplier.adapterType !== "diederichs" || !supplier.active) {
      supplier = await prisma.supplier.update({
        where: { id: supplier.id },
        data: {
          adapterType: "diederichs",
          baseUrl: "http://diederichs.spdns.eu/dvse/v1.2",
          active: true,
        },
      });
      logger.info({ supplierId: supplier.id }, "Diederichs supplier activated");
    }

    // Parse CSV: "ARTICLE_NO   ";STOCK   ;"EAN"
    // Skip header line (contains non-numeric SKU like "ARTICLE_NO")
    const rows: Array<{ sku: string; stock: number; ean: string }> = [];
    for (const line of csvData.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(";");
      if (parts.length < 3) continue;
      const sku = parts[0].replace(/"/g, "").trim();
      const stock = Math.max(0, parseInt(parts[1].trim(), 10) || 0);
      const ean = parts[2].replace(/"/g, "").trim();
      // Skip header row and rows without valid EAN (min 8 digits)
      if (!sku || !ean || !/^\d{8,14}$/.test(ean)) continue;
      rows.push({ sku, stock, ean });
    }

    logger.info({ total: rows.length }, "Diederichs CSV parsed");

    // Ensure a Diederichs brand exists for standalone (unlinked) products
    let diedBrand = await prisma.brand.findFirst({ where: { name: { equals: "Diederichs", mode: "insensitive" } } });
    if (!diedBrand) {
      diedBrand = await prisma.brand.create({ data: { name: "Diederichs", code: "DIEDERICHS" } });
      logger.info({ brandId: diedBrand.id }, "Created Diederichs brand");
    }

    const BATCH_SIZE = 500;
    let matched = 0;
    let icMatched = 0;
    let upserted = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const eans = batch.map((r) => r.ean);

      // Strategy 1: EAN match against TecDoc products in product_maps
      const tecdocProducts = await prisma.productMap.findMany({
        where: { supplier: { code: "tecdoc" }, ean: { in: eans }, status: "active" },
        select: {
          ean: true, brandId: true, categoryId: true,
          articleNo: true, tecdocId: true, oem: true,
          description: true, imageUrl: true,
        },
        distinct: ["ean"],
      });
      const eanMap = new Map(tecdocProducts.map((p) => [p.ean!, p]));

      // Strategy 2: EAN match against intercars_mappings (565K rows with EAN index)
      // For EANs not found in product_maps, look up via IC mapping then find TecDoc product
      const unmatched = eans.filter((e) => !eanMap.has(e));
      if (unmatched.length > 0) {
        // Single SQL join: intercars_mappings.ean → product_maps via article_no + brand name
        type IcEanRow = { ean: string; brand_id: number | null; category_id: number | null; article_no: string | null; tecdoc_id: number | null; oem: string | null; description: string | null; image_url: string | null };
        const icRows = await prisma.$queryRawUnsafe<IcEanRow[]>(`
          SELECT DISTINCT ON (im.ean)
            im.ean,
            pm.brand_id, pm.category_id, pm.article_no,
            pm.tecdoc_id, pm.oem, pm.description, pm.image_url
          FROM intercars_mappings im
          JOIN brands b ON LOWER(b.name) = LOWER(im.manufacturer)
          JOIN product_maps pm
            ON pm.article_no = im.article_number
            AND pm.brand_id = b.id
            AND pm.status = 'active'
          JOIN suppliers s ON s.id = pm.supplier_id AND s.code = 'tecdoc'
          WHERE im.ean = ANY($1::text[])
          LIMIT 2000
        `, unmatched);
        for (const row of icRows) {
          if (row.ean) {
            // Normalize snake_case columns from raw query to camelCase for eanMap
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            eanMap.set(row.ean, {
              ean: row.ean,
              brandId: row.brand_id ?? null,
              categoryId: row.category_id ?? null,
              articleNo: row.article_no ?? null,
              tecdocId: row.tecdoc_id ?? null,
              oem: row.oem ?? null,
              description: row.description ?? null,
              imageUrl: row.image_url ?? null,
            } as any);
            icMatched++;
          }
        }
      }

      const values: ReturnType<typeof Prisma.sql>[] = [];
      for (const row of batch) {
        const tecdoc = eanMap.get(row.ean);
        if (tecdoc) {
          // Linked: use TecDoc brand/category/description
          matched++;
          values.push(Prisma.sql`(
            ${supplier.id}, ${tecdoc.brandId}, ${tecdoc.categoryId},
            ${row.sku}, ${tecdoc.articleNo ?? row.sku}, ${row.ean},
            ${tecdoc.tecdocId}, ${tecdoc.oem}, ${tecdoc.description},
            ${tecdoc.imageUrl}, 'EUR',
            ${row.stock}, 'active', NOW(), NOW()
          )`);
        } else {
          // Unlinked: create standalone Diederichs product with Diederichs brand
          values.push(Prisma.sql`(
            ${supplier.id}, ${diedBrand!.id}, NULL,
            ${row.sku}, ${row.sku}, ${row.ean},
            NULL, NULL, '',
            NULL, 'EUR',
            ${row.stock}, 'active', NOW(), NOW()
          )`);
        }
      }

      if (values.length === 0) continue;

      await prisma.$executeRaw`
        INSERT INTO product_maps (
          supplier_id, brand_id, category_id, sku, article_no, ean,
          tecdoc_id, oem, description, image_url, currency,
          stock, status, created_at, updated_at
        )
        VALUES ${Prisma.join(values)}
        ON CONFLICT (supplier_id, sku)
        DO UPDATE SET
          stock = EXCLUDED.stock,
          ean = COALESCE(EXCLUDED.ean, product_maps.ean),
          updated_at = NOW()
      `;

      upserted += values.length;
      logger.info({ processed: i + batch.length, upserted, matched, icMatched }, "Diederichs import progress");
    }

    logger.info({ total: rows.length, matched, icMatched, upserted }, "Diederichs FTP import completed");
    return { total: rows.length, matched, icMatched, upserted };
  });

  /**
   * Import Diederichs price list CSV.
   *
   * CSV format (semicolon-separated, latin-1, German decimal comma):
   *   "Artikel Nr HOD";"Hersteller";"Typ";"Art.Gruppe Txt";"Bezeichnung";"Tuning";"Status";
   *   "Nettopreis Handel";"Empf.Werkstattpreis";"Empf.Endverbr.Preis";"VPE";"OE-Nummer";"EAN";...
   *
   * Matches by EAN against Diederichs product_maps and updates price + description + oem.
   *
   * Body (optional):
   *   { "minioKey": "diederichs/pricelist.csv" }  — read from MinIO (default)
   *   { "csvPath": "/tmp/pricelist.csv" }          — read from local path
   */
  app.post("/jobs/import-diederichs-prices", {
    onRequest: async (request) => { request.raw.socket.setTimeout(120_000); },
  }, async (request) => {
    const { prisma } = await import("../lib/prisma.js");
    const { logger } = await import("../lib/logger.js");
    const { createInterface } = await import("node:readline");
    const { createReadStream, existsSync } = await import("node:fs");
    const { getObjectStream } = await import("../lib/minio.js");

    const body = (request.body ?? {}) as { csvPath?: string; minioKey?: string };
    const DEFAULT_MINIO_KEY = "diederichs/pricelist.csv";

    // Resolve stream source: MinIO > local file > default MinIO key
    let stream: NodeJS.ReadableStream;
    if (body.minioKey) {
      stream = await getObjectStream(body.minioKey);
    } else if (body.csvPath && existsSync(body.csvPath)) {
      stream = createReadStream(body.csvPath, { encoding: "latin1" });
    } else {
      try {
        stream = await getObjectStream(DEFAULT_MINIO_KEY);
      } catch {
        return { error: `Price CSV not found in MinIO at '${DEFAULT_MINIO_KEY}'. Upload it to MinIO or provide minioKey/csvPath.` };
      }
    }

    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    // Parse CSV: EAN → { price, sku, description, oeNumber }
    const priceMap = new Map<string, { sku: string; price: number; description: string; oeNumber: string }>();
    let lineNum = 0;

    for await (const line of rl) {
      lineNum++;
      if (lineNum === 1) continue; // skip header

      // Semicolon-separated, fields may be quoted
      const parts = line.split(";").map((p) => p.replace(/^"|"$/g, "").trim());
      const sku         = parts[0] ?? "";
      const description = parts[4] ?? ""; // Bezeichnung
      const status      = parts[6] ?? ""; // Status: "01" = active
      const priceRaw    = parts[7] ?? ""; // Nettopreis Handel (German comma decimal)
      const oeNumber    = parts[11] ?? ""; // OE-Nummer
      const ean         = parts[12] ?? "";

      if (!sku || !ean || !/^\d{8,14}$/.test(ean)) continue;
      if (status && status !== "01") continue; // skip inactive

      const price = parseFloat(priceRaw.replace(",", "."));
      if (!price || price <= 0) continue;

      priceMap.set(ean, { sku, price, description, oeNumber });
    }

    logger.info({ parsed: priceMap.size }, "Diederichs pricelist parsed");

    if (priceMap.size === 0) {
      return { error: "No valid price rows parsed from CSV (check format or encoding)" };
    }

    // Get Diederichs supplier
    const supplier = await prisma.supplier.findUnique({ where: { code: "diederichs" } });
    if (!supplier) return { error: "Diederichs supplier not found" };

    // Batch update by EAN
    const eans = Array.from(priceMap.keys());
    const BATCH_SIZE = 500;
    let updated = 0;

    for (let i = 0; i < eans.length; i += BATCH_SIZE) {
      const batch = eans.slice(i, i + BATCH_SIZE);

      // Fetch matching Diederichs product_map IDs for this EAN batch
      const products = await prisma.$queryRawUnsafe<Array<{ id: number; ean: string }>>(
        `SELECT id, ean FROM product_maps WHERE supplier_id = $1 AND ean = ANY($2::text[])`,
        supplier.id,
        batch
      );

      for (const product of products) {
        const entry = priceMap.get(product.ean);
        if (!entry) continue;

        await prisma.$executeRawUnsafe(
          `UPDATE product_maps SET
            price = $1,
            currency = 'EUR',
            description = CASE WHEN $2 != '' THEN $2 ELSE description END,
            oem = CASE WHEN $3 != '' AND oem IS NULL THEN $3 ELSE oem END,
            updated_at = NOW()
           WHERE id = $4`,
          entry.price,
          entry.description,
          entry.oeNumber,
          product.id
        );
        updated++;
      }

      logger.info({ processed: i + batch.length, updated }, "Diederichs price import progress");
    }

    logger.info({ total: priceMap.size, updated }, "Diederichs price import completed");
    return { total: priceMap.size, updated };
  });

  /**
   * Import Van Wezel product catalog from a CSV file stored in MinIO.
   *
   * Upload the catalog file to MinIO at vanwezel/catalog.csv first,
   * then POST to this endpoint.
   *
   * CSV columns (auto-detected by header name, semicolon or comma separated):
   *   - Article number: "ArticleID", "Article", "Artikel", "Artikelnummer", "Part Number", col 0
   *   - EAN:            "EAN", "GTIN", "Barcode"
   *   - Description:    "Description", "Omschrijving", "Bezeichnung", "Name"
   *   - OE Number:      "OE", "OE Number", "OE Nummer", "OENummer"
   *
   * Products are EAN-matched against TecDoc/IC for brand, category, image.
   * Stock + price are set to 0/null — the stock worker refreshes them every 30 min
   * via the VWA getstock API.
   *
   * Body (optional):
   *   { "minioKey": "vanwezel/catalog.csv" }
   *   { "csvPath": "/tmp/vanwezel.csv" }
   */
  app.post("/jobs/import-vanwezel-catalog", {
    onRequest: async (request) => { request.raw.socket.setTimeout(300_000); },
  }, async (request) => {
    const { prisma } = await import("../lib/prisma.js");
    const { logger } = await import("../lib/logger.js");
    const { Prisma } = await import("@prisma/client");
    const { createInterface } = await import("node:readline");
    const { createReadStream, existsSync } = await import("node:fs");
    const { getObjectStream } = await import("../lib/minio.js");

    const body = (request.body ?? {}) as { csvPath?: string; minioKey?: string };
    const DEFAULT_MINIO_KEY = "vanwezel/catalog.csv";

    let stream: NodeJS.ReadableStream;
    if (body.minioKey) {
      stream = await getObjectStream(body.minioKey);
    } else if (body.csvPath && existsSync(body.csvPath)) {
      stream = createReadStream(body.csvPath, { encoding: "latin1" });
    } else {
      try {
        stream = await getObjectStream(DEFAULT_MINIO_KEY);
      } catch {
        return { error: `Catalog not found in MinIO at '${DEFAULT_MINIO_KEY}'. Upload it first or provide minioKey/csvPath.` };
      }
    }

    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    interface VwRow { sku: string; ean: string; description: string; oem: string }
    const rows: VwRow[] = [];
    let lineNum = 0;
    let delimiter = ";";
    let skuCol = 0, eanCol = -1, descCol = -1, oemCol = -1;

    for await (const raw of rl) {
      lineNum++;

      if (lineNum === 1) {
        // Detect delimiter
        delimiter = (raw.match(/;/g) ?? []).length >= (raw.match(/,/g) ?? []).length ? ";" : ",";

        // Detect columns by header
        const headers = raw.split(delimiter).map((h) => h.replace(/^"|"$/g, "").trim().toLowerCase().replace(/[\s\-_]/g, ""));
        const articlePatterns = ["articleid", "articlenr", "articleno", "article", "partnumber", "partno", "artnr", "artikelnummer", "artikel"];
        const eanPatterns     = ["ean", "gtin", "barcode", "ean13"];
        const descPatterns    = ["description", "omschrijving", "bezeichnung", "articlename", "name"];
        const oemPatterns     = ["oenumber", "oenummer", "oe", "oemnumber"];

        for (let i = 0; i < headers.length; i++) {
          const h = headers[i];
          if (skuCol === 0 && i > 0 && articlePatterns.some((p) => h.includes(p))) skuCol = i;
          if (eanCol  === -1 && eanPatterns.some((p) => h.includes(p)))  eanCol  = i;
          if (descCol === -1 && descPatterns.some((p) => h.includes(p))) descCol = i;
          if (oemCol  === -1 && oemPatterns.some((p) => h.includes(p)))  oemCol  = i;
        }
        continue;
      }

      const parts = raw.split(delimiter).map((p) => p.replace(/^"|"$/g, "").trim());
      if (parts.length < 1) continue;

      const sku  = parts[skuCol] ?? "";
      const rawEan = eanCol  >= 0 ? (parts[eanCol]  ?? "") : "";
      const desc = descCol >= 0 ? (parts[descCol] ?? "") : "";
      const oem  = oemCol  >= 0 ? (parts[oemCol]  ?? "") : "";

      if (!sku) continue;
      const ean = /^\d{8,14}$/.test(rawEan.replace(/\s/g, "")) ? rawEan.replace(/\s/g, "") : "";
      rows.push({ sku, ean, description: desc, oem });
    }

    logger.info({ parsed: rows.length, skuCol, eanCol, descCol, delimiter }, "Van Wezel catalog parsed");

    if (rows.length === 0) {
      return { error: "No valid rows parsed. Check the file format, delimiter, and encoding." };
    }

    // Ensure supplier exists and is activated
    let supplier = await prisma.supplier.findUnique({ where: { code: "vanwezel" } });
    if (!supplier) return { error: "Van Wezel supplier not found. Create it in the suppliers page first." };

    if (supplier.adapterType !== "vanwezel" || !supplier.active) {
      supplier = await prisma.supplier.update({
        where: { id: supplier.id },
        data: {
          adapterType: "vanwezel",
          baseUrl: "https://vwa.autopartscat.com/WcfVWAService/WcfVWAService/VWAService.svc",
          active: true,
        },
      });
    }

    // Ensure Van Wezel brand exists for unlinked fallback products
    let vwBrand = await prisma.brand.findFirst({ where: { name: { equals: "Van Wezel", mode: "insensitive" } } });
    if (!vwBrand) {
      vwBrand = await prisma.brand.create({ data: { name: "Van Wezel", code: "VANWEZEL" } });
      logger.info({ brandId: vwBrand.id }, "Created Van Wezel brand");
    }

    const BATCH_SIZE = 500;
    let upserted = 0, matched = 0, icMatched = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const eans  = batch.map((r) => r.ean).filter(Boolean);

      // Strategy 1: EAN match against TecDoc products
      const eanMap = new Map<string, {
        ean: string; brandId: number | null; categoryId: number | null;
        articleNo: string | null; tecdocId: number | null;
        oem: string | null; description: string | null; imageUrl: string | null;
      }>();

      if (eans.length > 0) {
        const tecdocProducts = await prisma.productMap.findMany({
          where: { supplier: { code: "tecdoc" }, ean: { in: eans }, status: "active" },
          select: { ean: true, brandId: true, categoryId: true, articleNo: true, tecdocId: true, oem: true, description: true, imageUrl: true },
          distinct: ["ean"],
        });
        for (const p of tecdocProducts) {
          if (p.ean) eanMap.set(p.ean, {
            ean: p.ean,
            brandId: p.brandId,
            categoryId: p.categoryId,
            articleNo: p.articleNo,
            tecdocId: p.tecdocId != null ? Number(p.tecdocId) : null,
            oem: p.oem,
            description: p.description,
            imageUrl: p.imageUrl,
          });
        }

        // Strategy 2: IC mapping fallback
        const unmatched = eans.filter((e) => !eanMap.has(e));
        if (unmatched.length > 0) {
          type IcRow = { ean: string; brand_id: number | null; category_id: number | null; article_no: string | null; tecdoc_id: number | null; oem: string | null; description: string | null; image_url: string | null };
          const icRows = await prisma.$queryRawUnsafe<IcRow[]>(`
            SELECT DISTINCT ON (im.ean)
              im.ean,
              pm.brand_id, pm.category_id, pm.article_no,
              pm.tecdoc_id, pm.oem, pm.description, pm.image_url
            FROM intercars_mappings im
            JOIN brands b ON LOWER(b.name) = LOWER(im.manufacturer)
            JOIN product_maps pm
              ON pm.article_no = im.article_number
              AND pm.brand_id = b.id
              AND pm.status = 'active'
            JOIN suppliers s ON s.id = pm.supplier_id AND s.code = 'tecdoc'
            WHERE im.ean = ANY($1::text[])
            LIMIT 2000
          `, unmatched);
          for (const r of icRows) {
            if (r.ean) {
              eanMap.set(r.ean, { ean: r.ean, brandId: r.brand_id ?? null, categoryId: r.category_id ?? null, articleNo: r.article_no ?? null, tecdocId: r.tecdoc_id ?? null, oem: r.oem ?? null, description: r.description ?? null, imageUrl: r.image_url ?? null });
              icMatched++;
            }
          }
        }
      }

      const values: ReturnType<typeof Prisma.sql>[] = [];
      for (const row of batch) {
        const td = row.ean ? eanMap.get(row.ean) : null;
        const ean = row.ean || null;
        const oem = row.oem || null;
        const desc = row.description || "";

        if (td) {
          matched++;
          values.push(Prisma.sql`(
            ${supplier.id}, ${td.brandId}, ${td.categoryId},
            ${row.sku}, ${td.articleNo ?? row.sku}, ${ean},
            ${td.tecdocId}, ${td.oem ?? oem}, ${desc || td.description || ""},
            ${td.imageUrl}, 'EUR',
            0, 'active', NOW(), NOW()
          )`);
        } else {
          values.push(Prisma.sql`(
            ${supplier.id}, ${vwBrand!.id}, NULL,
            ${row.sku}, ${row.sku}, ${ean},
            NULL, ${oem}, ${desc},
            NULL, 'EUR',
            0, 'active', NOW(), NOW()
          )`);
        }
      }

      if (values.length === 0) continue;

      await prisma.$executeRaw`
        INSERT INTO product_maps (
          supplier_id, brand_id, category_id, sku, article_no, ean,
          tecdoc_id, oem, description, image_url, currency,
          stock, status, created_at, updated_at
        )
        VALUES ${Prisma.join(values)}
        ON CONFLICT (supplier_id, sku)
        DO UPDATE SET
          ean         = COALESCE(EXCLUDED.ean, product_maps.ean),
          description = CASE WHEN EXCLUDED.description != '' THEN EXCLUDED.description ELSE product_maps.description END,
          oem         = COALESCE(product_maps.oem, EXCLUDED.oem),
          image_url   = COALESCE(product_maps.image_url, EXCLUDED.image_url),
          brand_id    = COALESCE(product_maps.brand_id, EXCLUDED.brand_id),
          category_id = COALESCE(product_maps.category_id, EXCLUDED.category_id),
          updated_at  = NOW()
      `;

      upserted += values.length;
      logger.info({ processed: i + batch.length, upserted, matched, icMatched }, "Van Wezel catalog import progress");
    }

    logger.info({ total: rows.length, matched, icMatched, upserted }, "Van Wezel catalog import completed");
    return {
      total: rows.length,
      matched,
      icMatched,
      upserted,
      message: "Stock and pricing will be refreshed automatically every 30 min via VWA getstock API",
    };
  });

  /**
   * Bootstrap Van Wezel VWA supplier from existing TecDoc Van Wezel products.
   *
   * Van Wezel (TecDoc brand ID 36) products are already synced in TecDoc product_maps
   * with article numbers, EANs, descriptions, and images.
   * Van Wezel uses the same article numbers as TecDoc for the getstock API.
   *
   * This copies those TecDoc products into the VWA supplier product_maps so the
   * stock worker can call getstock for each one every 30 min.
   */
  app.post("/jobs/bootstrap-vanwezel-from-tecdoc", {
    onRequest: async (request) => { request.raw.socket.setTimeout(120_000); },
  }, async () => {
    const { prisma } = await import("../lib/prisma.js");
    const { logger } = await import("../lib/logger.js");
    const { Prisma } = await import("@prisma/client");

    let vwSupplier = await prisma.supplier.findUnique({ where: { code: "vanwezel" } });
    if (!vwSupplier) return { error: "Van Wezel supplier not found." };

    if (vwSupplier.adapterType !== "vanwezel" || !vwSupplier.active) {
      vwSupplier = await prisma.supplier.update({
        where: { id: vwSupplier.id },
        data: {
          adapterType: "vanwezel",
          baseUrl: "https://vwa.autopartscat.com/WcfVWAService/WcfVWAService/VWAService.svc",
          active: true,
        },
      });
    }

    const vwBrand = await prisma.brand.findFirst({
      where: { OR: [{ name: { equals: "VAN WEZEL", mode: "insensitive" } }, { tecdocId: 36 }] },
    });
    if (!vwBrand) return { error: "VAN WEZEL brand not found. Run TecDoc sync with brand filter (brand ID 36) first." };

    const tecdocSupplier = await prisma.supplier.findUnique({ where: { code: "tecdoc" }, select: { id: true } });
    if (!tecdocSupplier) return { error: "TecDoc supplier not found." };

    const totalTecdoc = await prisma.productMap.count({
      where: { supplierId: tecdocSupplier.id, brandId: vwBrand.id, status: "active" },
    });

    if (totalTecdoc === 0) {
      return { error: "No TecDoc VAN WEZEL products found. Run TecDoc sync with brand filter first." };
    }

    logger.info({ totalTecdoc, brand: vwBrand.name }, "Bootstrapping Van Wezel from TecDoc");

    const BATCH_SIZE = 500;
    let upserted = 0;
    let offset = 0;

    while (offset < totalTecdoc) {
      const products = await prisma.productMap.findMany({
        where: { supplierId: tecdocSupplier.id, brandId: vwBrand.id, status: "active" },
        select: { articleNo: true, ean: true, tecdocId: true, oem: true, description: true, imageUrl: true, categoryId: true },
        skip: offset,
        take: BATCH_SIZE,
      });

      const values: ReturnType<typeof Prisma.sql>[] = [];
      for (const p of products) {
        if (!p.articleNo) continue;
        const tecdocId = p.tecdocId != null ? Number(p.tecdocId) : null;
        values.push(Prisma.sql`(
          ${vwSupplier.id}, ${vwBrand.id}, ${p.categoryId},
          ${p.articleNo}, ${p.articleNo}, ${p.ean},
          ${tecdocId}, ${p.oem}, ${p.description ?? ""},
          ${p.imageUrl}, 'EUR',
          0, 'active', NOW(), NOW()
        )`);
      }

      if (values.length > 0) {
        await prisma.$executeRaw`
          INSERT INTO product_maps (
            supplier_id, brand_id, category_id, sku, article_no, ean,
            tecdoc_id, oem, description, image_url, currency,
            stock, status, created_at, updated_at
          )
          VALUES ${Prisma.join(values)}
          ON CONFLICT (supplier_id, sku)
          DO UPDATE SET
            ean         = COALESCE(EXCLUDED.ean, product_maps.ean),
            image_url   = COALESCE(product_maps.image_url, EXCLUDED.image_url),
            description = CASE WHEN EXCLUDED.description != '' THEN EXCLUDED.description ELSE product_maps.description END,
            category_id = COALESCE(product_maps.category_id, EXCLUDED.category_id),
            tecdoc_id   = COALESCE(product_maps.tecdoc_id, EXCLUDED.tecdoc_id),
            updated_at  = NOW()
        `;
        upserted += values.length;
      }

      offset += BATCH_SIZE;
      logger.info({ offset, upserted, total: totalTecdoc }, "Van Wezel bootstrap progress");
    }

    logger.info({ totalTecdoc, upserted }, "Van Wezel bootstrap from TecDoc completed");
    return {
      totalTecdoc,
      upserted,
      brand: vwBrand.name,
      message: "Van Wezel products copied from TecDoc. Stock worker will refresh prices every 30 min via VWA getstock API.",
    };
  });

  /**
   * Import Van Wezel catalog/price data.
   * Activates Van Wezel supplier with REST API credentials.
   * Van Wezel stock is refreshed real-time via the VWA getstock API (every 30 min).
   */
  app.post("/jobs/activate-vanwezel", async (request) => {
    const { prisma } = await import("../lib/prisma.js");
    const { encryptCredentials } = await import("../lib/crypto.js");
    const { loadAdaptersFromDb } = await import("../adapters/registry.js");

    // Optional: override credentials from request body
    const body = (request.body ?? {}) as { username?: string; password?: string };
    const username = body.username ?? "57206";
    const password = body.password ?? "2514";

    let supplier = await prisma.supplier.findUnique({ where: { code: "vanwezel" } });
    if (!supplier) {
      return { error: "Van Wezel supplier not found. Create it in the suppliers page first." };
    }

    const credentials = encryptCredentials(`${username}:${password}`);
    supplier = await prisma.supplier.update({
      where: { id: supplier.id },
      data: {
        adapterType: "vanwezel",
        baseUrl: "https://vwa.autopartscat.com/WcfVWAService/WcfVWAService/VWAService.svc",
        credentials,
        active: true,
      },
    });

    await loadAdaptersFromDb();

    return {
      id: supplier.id,
      code: supplier.code,
      adapterType: supplier.adapterType,
      active: supplier.active,
      message: "Van Wezel activated. Stock will refresh every 30 minutes via VWA API.",
    };
  });

  // Create expression indexes to speed up IC matching queries
  // Run this once after initial data load — creates indexes on normalized article numbers
  app.post("/jobs/optimize-db", async () => {
    const { prisma } = await import("../lib/prisma.js");
    const { logger } = await import("../lib/logger.js");

    logger.info("Creating expression indexes for IC matching optimization...");

    const indexes = [
      // Normalized article number on intercars_mappings — used by all 4 matching strategies
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_im_article_norm
        ON intercars_mappings (UPPER(regexp_replace(article_number, '[^a-zA-Z0-9]', '', 'g')))`,
      // Normalized article number on product_maps (unmatched only)
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pm_article_norm_unmatched
        ON product_maps (UPPER(regexp_replace(article_no, '[^a-zA-Z0-9]', '', 'g')))
        WHERE status = 'active' AND ic_sku IS NULL`,
      // Normalized EAN on intercars_mappings
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_im_ean_norm
        ON intercars_mappings (UPPER(TRIM(ean)))
        WHERE ean IS NOT NULL`,
      // tecdoc_prod on intercars_mappings for Strategy C
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_im_tecdoc_prod
        ON intercars_mappings (tecdoc_prod)
        WHERE tecdoc_prod IS NOT NULL`,
    ];

    const results: Array<{ index: string; status: string }> = [];
    for (const sql of indexes) {
      const indexName = sql.match(/idx_\w+/)?.[0] ?? "unknown";
      try {
        await prisma.$executeRawUnsafe(sql);
        results.push({ index: indexName, status: "created" });
        logger.info({ index: indexName }, "Expression index created");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ index: indexName, status: `error: ${msg}` });
        logger.warn({ index: indexName, err }, "Index creation failed (may already exist)");
      }
    }

    return { indexes: results };
  });

  // Trigger sync for ALL active suppliers
  app.post("/jobs/sync-all", async () => {
    const { prisma } = await import("../lib/prisma.js");
    const suppliers = await prisma.supplier.findMany({
      where: { active: true },
      select: { code: true, name: true },
    });

    const jobs = [];
    for (const supplier of suppliers) {
      const job = await syncQueue.add(
        `sync-manual-${supplier.code}`,
        { supplierCode: supplier.code },
        { priority: 1 }
      );
      jobs.push({ jobId: job.id, supplierCode: supplier.code });
    }

    return { queued: jobs.length, jobs };
  });

  // Clean a queue: remove completed/failed/waiting jobs
  app.delete("/jobs/:queue/clean", async (request) => {
    const { queue } = request.params as { queue: string };
    const q = getQueue(queue);
    if (!q) return { error: "Unknown queue" };

    const { type } = (request.query ?? {}) as { type?: string };

    const results: Record<string, number> = {};
    if (!type || type === "failed") {
      const removed = await q.clean(0, 1000, "failed");
      results.failed = removed.length;
    }
    if (!type || type === "waiting") {
      const removed = await q.clean(0, 1000, "wait");
      results.waiting = removed.length;
    }
    if (type === "completed") {
      const removed = await q.clean(0, 1000, "completed");
      results.completed = removed.length;
    }

    return { cleaned: results };
  });

  // Force-drain a queue: removes all non-active jobs (waiting, delayed, prioritized)
  // Active jobs are left to complete naturally or expire via stall checker
  app.post("/jobs/:queue/drain", async (request) => {
    const { queue } = request.params as { queue: string };
    const q = getQueue(queue);
    if (!q) return { error: "Unknown queue" };

    await q.drain(true); // true = also drain delayed jobs
    const counts = await q.getJobCounts("active", "waiting", "prioritized", "delayed", "failed");
    return { drained: true, remaining: counts };
  });

  // Obliterate a queue: removes ALL jobs including active (use carefully)
  app.post("/jobs/:queue/obliterate", async (request) => {
    const { queue } = request.params as { queue: string };
    const q = getQueue(queue);
    if (!q) return { error: "Unknown queue" };

    await q.obliterate({ force: true });
    return { obliterated: true, queue };
  });

  // Database maintenance: check sizes, clean old data, vacuum
  app.post("/jobs/db-maintenance", async () => {
    const { prisma } = await import("../lib/prisma.js");
    const { logger } = await import("../lib/logger.js");

    const results: Record<string, unknown> = {};

    // 1. Check table sizes
    const sizes = await prisma.$queryRawUnsafe<Array<{ table_name: string; total_size: string; row_estimate: string }>>(`
      SELECT
        relname AS table_name,
        pg_size_pretty(pg_total_relation_size(oid)) AS total_size,
        reltuples::text AS row_estimate
      FROM pg_class
      WHERE relnamespace = 'public'::regnamespace
        AND relkind = 'r'
      ORDER BY pg_total_relation_size(oid) DESC
      LIMIT 10
    `);
    results.tableSizes = sizes;

    // 2. Check DB size
    const diskInfo = await prisma.$queryRawUnsafe<Array<{ db_size_mb: number }>>(`
      SELECT (pg_database_size(current_database()) / 1024 / 1024)::int AS db_size_mb
    `);
    results.dbSizeMb = (diskInfo[0] as any)?.db_size_mb;

    // 3. Delete match_logs older than 3 days (these accumulate rapidly)
    const matchLogsDeleted = await prisma.$executeRawUnsafe(`
      DELETE FROM match_logs WHERE created_at < NOW() - INTERVAL '3 days'
    `);
    results.matchLogsDeleted = matchLogsDeleted;
    logger.info({ deleted: matchLogsDeleted }, "Deleted old match_logs");

    // 4. Delete unmatched records resolved > 7 days ago
    const unmatchedDeleted = await prisma.$executeRawUnsafe(`
      DELETE FROM unmatched WHERE created_at < NOW() - INTERVAL '7 days' AND attempts < 3
    `);
    results.unmatchedDeleted = unmatchedDeleted;
    logger.info({ deleted: unmatchedDeleted }, "Deleted old unmatched records");

    // 5. VACUUM ANALYZE the largest tables to reclaim dead tuple space
    // Note: VACUUM cannot run in a transaction, use $executeRawUnsafe
    const tablesToVacuum = ["match_logs", "product_maps", "intercars_mappings", "unmatched"];
    const vacuumResults: string[] = [];
    for (const table of tablesToVacuum) {
      try {
        await prisma.$executeRawUnsafe(`VACUUM ANALYZE ${table}`);
        vacuumResults.push(`${table}: ok`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vacuumResults.push(`${table}: ${msg}`);
      }
    }
    results.vacuum = vacuumResults;

    return results;
  });

  /**
   * Trigger an AI match run immediately (brand alias discovery + optional Ollama LLM).
   * Body: { autoApplyThreshold?: number, llmMinThreshold?: number, llmConfidenceThreshold?: number }
   */
  app.post("/jobs/ai-match", async (request) => {
    const body = (request.body ?? {}) as {
      autoApplyThreshold?: number;
      llmMinThreshold?: number;
      llmConfidenceThreshold?: number;
    };
    const job = await aiMatchQueue.add("ai-match-manual", body, {
      priority: 1,
      jobId: "ai-match-manual-dedup",
    });
    return { queued: true, jobId: job.id, message: "AI match started — brand alias discovery + optional Ollama confirmation" };
  });

  /**
   * LLM provider status — shows active provider (Kimi or Ollama), model, and availability.
   * Replaces the old ollama-status endpoint (kept as alias below).
   */
  app.get("/jobs/ai-match/llm-status", async () => {
    const { llmStatus, ollamaListModels } = await import("../lib/llm.js");
    const [status, ollamaModels] = await Promise.all([llmStatus(), ollamaListModels()]);
    return { ...status, ollamaModels };
  });

  // Backward-compat alias
  app.get("/jobs/ai-match/ollama-status", async () => {
    const { llmStatus, ollamaListModels, OLLAMA_MODEL } = await import("../lib/llm.js");
    const [status, models] = await Promise.all([llmStatus(), ollamaListModels()]);
    return {
      available: status.available,
      ollamaUrl: process.env.OLLAMA_URL ?? "http://ollama:11434",
      configuredModel: OLLAMA_MODEL,
      loadedModels: models,
      llmProvider: status.provider,
    };
  });

  /**
   * Pull a model into Ollama (only relevant when using Ollama provider).
   */
  app.post("/jobs/ai-match/pull-model", async (request) => {
    const body = (request.body ?? {}) as { model?: string };
    const { ollamaPullModel, OLLAMA_MODEL } = await import("../lib/llm.js");
    const model = body.model ?? OLLAMA_MODEL;
    try {
      await ollamaPullModel(model);
      return { ok: true, model, message: `Model ${model} is ready` };
    } catch (err) {
      return { ok: false, model, error: String(err) };
    }
  });

  /**
   * Preview brand alias candidates without applying them.
   * Returns the top candidates ranked by overlapping article count.
   */
  app.get("/jobs/ai-match/candidates", async (request) => {
    const { prisma } = await import("../lib/prisma.js");
    const { limit = "50", minArticles = "3" } = (request.query ?? {}) as { limit?: string; minArticles?: string };

    const intercarsSupplier = await prisma.supplier.findUnique({
      where: { code: "intercars" },
      select: { id: true },
    });
    if (!intercarsSupplier) return { error: "InterCars supplier not found" };

    type Row = { tecdoc_brand: string; ic_manufacturer: string; matching_articles: bigint | number };
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT
         b.name          AS tecdoc_brand,
         im.manufacturer AS ic_manufacturer,
         COUNT(*)        AS matching_articles
       FROM product_maps pm
       JOIN brands b ON b.id = pm.brand_id
       JOIN intercars_mappings im
         ON UPPER(regexp_replace(im.article_number, '[^a-zA-Z0-9]', '', 'g'))
          = UPPER(regexp_replace(pm.article_no,     '[^a-zA-Z0-9]', '', 'g'))
       WHERE pm.ic_sku IS NULL AND pm.status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM supplier_brand_rules sbr
           WHERE sbr.supplier_id = $1
             AND UPPER(sbr.supplier_brand) = UPPER(im.manufacturer)
         )
         AND UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))
           != UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g'))
       GROUP BY b.name, im.manufacturer
       HAVING COUNT(*) >= $2
       ORDER BY matching_articles DESC
       LIMIT $3`,
      intercarsSupplier.id,
      parseInt(minArticles, 10),
      parseInt(limit, 10)
    );

    return rows.map((r) => ({
      tecdocBrand: r.tecdoc_brand,
      icManufacturer: r.ic_manufacturer,
      matchingArticles: Number(r.matching_articles),
    }));
  });

  /**
   * Aggregated system status — health + all queues + LLM in one request.
   * Replaces 3 separate API calls from the dashboard/health/workflow pages.
   */
  app.get("/jobs/system-status", async () => {
    const start = Date.now();
    const { prisma: db } = await import("../lib/prisma.js");
    const { redis: redisClient } = await import("../lib/redis.js");
    const { meili: meiliClient } = await import("../lib/meilisearch.js");
    const { getAllAdapters } = await import("../adapters/registry.js");
    const { llmStatus, ollamaListModels } = await import("../lib/llm.js");

    // All fetches in parallel — fast even if one service is slow
    const [
      syncR, matchR, indexR, pricingR, stockR, icMatchR, aiMatchR,
      pgR, redisR, meiliR, llmR, modelsR,
    ] = await Promise.allSettled([
      getQueueCounts(syncQueue),
      getQueueCounts(matchQueue),
      getQueueCounts(indexQueue),
      getQueueCounts(pricingQueue),
      getQueueCounts(stockQueue),
      getQueueCounts(icMatchQueue),
      getQueueCounts(aiMatchQueue),
      db.$queryRaw`SELECT 1`.then(() => true),
      redisClient.ping().then(() => true),
      meiliClient.health().then(() => true),
      llmStatus(),
      ollamaListModels(),
    ]);

    const jobs = {
      sync:    syncR.status    === "fulfilled" ? syncR.value    : null,
      match:   matchR.status   === "fulfilled" ? matchR.value   : null,
      index:   indexR.status   === "fulfilled" ? indexR.value   : null,
      pricing: pricingR.status === "fulfilled" ? pricingR.value : null,
      stock:   stockR.status   === "fulfilled" ? stockR.value   : null,
      icMatch: icMatchR.status === "fulfilled" ? icMatchR.value : null,
      aiMatch: aiMatchR.status === "fulfilled" ? aiMatchR.value : null,
    };

    const checks: Record<string, string> = {
      postgres:    pgR.status    === "fulfilled" && pgR.value    ? "ok" : "error",
      redis:       redisR.status === "fulfilled" && redisR.value ? "ok" : "error",
      meilisearch: meiliR.status === "fulfilled" && meiliR.value ? "ok" : "error",
    };

    const llm         = llmR.status    === "fulfilled" ? llmR.value    : { provider: "none", model: "", available: false, kimiConfigured: false, ollamaUrl: "" };
    const ollamaModels = modelsR.status === "fulfilled" ? modelsR.value : [];

    const circuits: Record<string, { state: string; failures: number }> = {};
    for (const adapter of getAllAdapters()) {
      circuits[adapter.code] = {
        state:    adapter.circuitBreaker.getState(),
        failures: adapter.circuitBreaker.getFailures(),
      };
    }

    type Alert = {
      type: "failed" | "service_error" | "circuit_open";
      queue?: string; service?: string; count?: number; message: string;
    };
    const alerts: Alert[] = [];

    for (const [key, q] of Object.entries(jobs) as [string, { failed: number } | null][]) {
      if (q && q.failed > 0) {
        alerts.push({ type: "failed", queue: key, count: q.failed,
          message: `${q.failed} failed job${q.failed > 1 ? "s" : ""} in ${key} queue` });
      }
    }
    for (const [svc, st] of Object.entries(checks)) {
      if (st !== "ok") alerts.push({ type: "service_error", service: svc, message: `${svc} is unreachable` });
    }
    for (const [code, cb] of Object.entries(circuits)) {
      if (cb.state === "open") {
        alerts.push({ type: "circuit_open", service: code,
          message: `Circuit breaker OPEN for ${code} (${cb.failures} failures)` });
      }
    }

    return {
      health: {
        status:  Object.values(checks).every((s) => s === "ok") ? "healthy" : "degraded",
        uptime:  Math.floor(process.uptime()),
        checks,
        circuits,
      },
      jobs,
      llm,
      // backward-compat: dashboard reads ollama.loadedModels / configuredModel
      ollama: {
        available:       llm.available,
        ollamaUrl:       llm.ollamaUrl || (process.env.OLLAMA_URL ?? "http://ollama:11434"),
        configuredModel: llm.model,
        loadedModels:    ollamaModels,
        provider:        llm.provider,
      },
      alerts,
      timestamp:      new Date().toISOString(),
      responseTimeMs: Date.now() - start,
    };
  });

  /** Retry all failed jobs in a queue (up to 100). */
  app.post("/jobs/:queue/retry-failed", async (request) => {
    const { queue } = request.params as { queue: string };
    const q = getQueue(queue);
    if (!q) return { error: "Unknown queue" };

    const failed = await q.getFailed(0, 100);
    let retried = 0;
    for (const job of failed) {
      try { await job.retry(); retried++; } catch { /* skip */ }
    }
    return { retried, total: failed.length, queue };
  });

  /**
   * Run all workers immediately — triggers sync, match, ic-match, stock for every
   * active supplier, plus index and ai-match. Uses jobId deduplication so it's
   * safe to call multiple times.
   */
  app.post("/jobs/run-all", async () => {
    const { prisma: db } = await import("../lib/prisma.js");
    const suppliers = await db.supplier.findMany({
      where: { active: true },
      select: { code: true, adapterType: true },
    });

    const CATALOG_TYPES = new Set(["tecdoc", "intercars", "partspoint"]);
    const queued: Array<{ queue: string; supplierCode?: string; jobId?: string }> = [];

    for (const supplier of suppliers) {
      const isDirect = !CATALOG_TYPES.has(supplier.adapterType);
      if (!isDirect) {
        const [sJob, mJob, icJob] = await Promise.all([
          syncQueue.add(`sync-runall-${supplier.code}`,     { supplierCode: supplier.code }, { priority: 2, jobId: `sync-runall-${supplier.code}` }),
          matchQueue.add(`match-runall-${supplier.code}`,   { supplierCode: supplier.code }, { priority: 2, jobId: `match-runall-${supplier.code}` }),
          icMatchQueue.add(`ic-match-runall-${supplier.code}`, { supplierCode: supplier.code }, { priority: 2, jobId: `ic-match-runall-${supplier.code}` }),
        ]);
        queued.push({ queue: "sync",     supplierCode: supplier.code, jobId: sJob.id });
        queued.push({ queue: "match",    supplierCode: supplier.code, jobId: mJob.id });
        queued.push({ queue: "ic-match", supplierCode: supplier.code, jobId: icJob.id });
      }
      const stJob = await stockQueue.add(`stock-runall-${supplier.code}`, { supplierCode: supplier.code }, { priority: 3, jobId: `stock-runall-${supplier.code}` });
      queued.push({ queue: "stock", supplierCode: supplier.code, jobId: stJob.id });
    }

    const [idxJob, aiJob] = await Promise.all([
      indexQueue.add("index-runall",    {}, { priority: 3, jobId: "index-runall-dedup" }),
      aiMatchQueue.add("ai-match-runall", {}, { priority: 3, jobId: "ai-match-runall-dedup" }),
    ]);
    queued.push({ queue: "index",    jobId: idxJob.id });
    queued.push({ queue: "ai-match", jobId: aiJob.id });

    return { queued: queued.length, jobs: queued };
  });

  /**
   * Import TecDoc brand filter — stores selected brand IDs in settings.
   * Body: { brandIds: number[] }
   * These IDs are used as dataSupplierIds in TecDoc sync to restrict to selected brands.
   */
  app.post("/jobs/import-brand-filter", async (request) => {
    const { prisma: db } = await import("../lib/prisma.js");
    const body = (request.body ?? {}) as { brandIds?: unknown };
    const brandIds = Array.isArray(body.brandIds)
      ? (body.brandIds as unknown[]).filter((v) => typeof v === "number" && Number.isInteger(v))
      : [];

    if (brandIds.length === 0) {
      return { error: "brandIds array is required and must contain integers" };
    }

    const value = JSON.stringify(brandIds);
    await db.$executeRawUnsafe(
      `INSERT INTO settings (key, value, updated_at) VALUES ('tecdoc_brand_filter_ids', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      value
    );

    return { stored: brandIds.length, brandIds };
  });

  /**
   * Get current TecDoc brand filter.
   */
  app.get("/jobs/brand-filter", async () => {
    const { prisma: db } = await import("../lib/prisma.js");
    const row = await db.setting.findUnique({ where: { key: "tecdoc_brand_filter_ids" } });
    const brandIds: number[] = row ? JSON.parse(row.value) : [];
    return { count: brandIds.length, brandIds };
  });
}

function getQueue(name: string) {
  switch (name) {
    case "sync": return syncQueue;
    case "match": return matchQueue;
    case "index": return indexQueue;
    case "pricing": return pricingQueue;
    case "stock": return stockQueue;
    case "ic-match": return icMatchQueue;
    case "ai-match": return aiMatchQueue;
    default: return null;
  }
}

async function getQueueCounts(queue: typeof syncQueue) {
  const counts = await queue.getJobCounts(
    "active", "completed", "delayed", "failed", "paused", "waiting", "prioritized", "wait"
  );

  const repeatable = await queue.getRepeatableJobs();

  return {
    name: queue.name,
    ...counts,
    repeatableJobs: repeatable.length,
  };
}

function formatJob(job: { id?: string; name: string; data: unknown; progress: unknown; finishedOn?: number; failedReason?: string; processedOn?: number; timestamp: number }) {
  return {
    id: job.id,
    name: job.name,
    data: job.data,
    progress: job.progress,
    finishedOn: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : null,
    createdAt: new Date(job.timestamp).toISOString(),
    failedReason: job.failedReason ?? null,
  };
}

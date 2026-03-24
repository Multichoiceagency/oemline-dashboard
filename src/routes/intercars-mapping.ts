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

  // Quick IC SKU assignment stats (lightweight)
  app.get("/intercars/ic-sku-stats", async () => {
    const [matched, unmatched, totalMappings] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM product_maps WHERE ic_sku IS NOT NULL AND status = 'active'`
      ),
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM product_maps WHERE ic_sku IS NULL AND status = 'active'`
      ),
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM intercars_mappings`
      ),
    ]);
    const m = Number(matched[0]?.count ?? 0);
    const u = Number(unmatched[0]?.count ?? 0);
    const total = m + u;
    return {
      icMappings: Number(totalMappings[0]?.count ?? 0),
      matched: m,
      unmatched: u,
      total,
      matchRate: total > 0 ? `${((m / total) * 100).toFixed(1)}%` : "0%",
    };
  });

  // Get mapping stats
  app.get("/intercars/mapping-stats", async () => {
    try {
      const result = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM intercars_mappings`
      );
      const total = Number(result[0]?.count ?? 0);

      const withTecdocProd = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM intercars_mappings WHERE tecdoc_prod IS NOT NULL`
      );

      const topBrands = await prisma.$queryRawUnsafe<Array<{ manufacturer: string; count: bigint }>>(
        `SELECT manufacturer, COUNT(*) as count FROM intercars_mappings GROUP BY manufacturer ORDER BY count DESC LIMIT 20`
      );

      // Phase DIRECT diagnostic: how many UNMATCHED products could be matched?
      const directMatchPotential = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(DISTINCT pm.id) as count
         FROM product_maps pm
         JOIN brands b ON b.id = pm.brand_id
         JOIN intercars_mappings im ON
           im.tecdoc_prod IS NOT NULL
           AND b.tecdoc_id IS NOT NULL
           AND im.tecdoc_prod = b.tecdoc_id
           AND im.normalized_article_number = pm.normalized_article_no
         WHERE pm.status = 'active' AND pm.ic_sku IS NULL`
      );

      // Total matched (for comparison)
      const alreadyMatched = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM product_maps WHERE ic_sku IS NOT NULL AND status = 'active'`
      );

      // How many active unmatched products total?
      const totalUnmatched = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM product_maps WHERE ic_sku IS NULL AND status = 'active'`
      );

      const brandsWithTecdocId = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM brands WHERE tecdoc_id IS NOT NULL`
      );

      return {
        totalMappings: total,
        withTecdocProd: Number(withTecdocProd[0]?.count ?? 0),
        brandsWithTecdocId: Number(brandsWithTecdocId[0]?.count ?? 0),
        directMatchNewPotential: Number(directMatchPotential[0]?.count ?? 0),
        alreadyMatched: Number(alreadyMatched[0]?.count ?? 0),
        totalUnmatched: Number(totalUnmatched[0]?.count ?? 0),
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

  // Test IC API call: authenticate + fetch stock + pricing for a single TOW_KOD
  app.get("/intercars/test-api", async (request) => {
    const { sku } = request.query as { sku?: string };

    // Get IC supplier credentials
    const supplier = await prisma.supplier.findUnique({ where: { code: "intercars" } });
    if (!supplier) return { error: "InterCars supplier not found" };

    let creds: Record<string, string> = {};
    try {
      const { decryptCredentials } = await import("../lib/crypto.js");
      let raw = supplier.credentials as string;
      try { raw = decryptCredentials(raw); } catch { /* plaintext */ }
      creds = JSON.parse(raw);
    } catch (err) {
      return { error: "Failed to parse IC credentials", detail: String(err) };
    }

    const clientId = creds.clientId || process.env.INTERCARS_CLIENT_ID || "";
    const clientSecret = creds.clientSecret || process.env.INTERCARS_CLIENT_SECRET || "";
    const tokenUrl = creds.tokenUrl || "https://is.webapi.intercars.eu/oauth2/token";
    const apiUrl = supplier.baseUrl || "https://api.webapi.intercars.eu/ic";
    const customerId = creds.customerId || process.env.INTERCARS_CUSTOMER_ID || "";
    const payerId = creds.payerId || process.env.INTERCARS_PAYER_ID || "";
    const branch = creds.branch || process.env.INTERCARS_BRANCH || "";

    // Step 1: Get OAuth2 token
    let accessToken = "";
    let tokenError = "";
    try {
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      const tokenResp = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${basicAuth}`,
        },
        body: "grant_type=client_credentials&scope=allinone",
      });

      const tokenBody = await tokenResp.text();
      if (!tokenResp.ok) {
        tokenError = `${tokenResp.status}: ${tokenBody}`;
      } else {
        const tokenData = JSON.parse(tokenBody);
        accessToken = tokenData.access_token;
      }
    } catch (err) {
      tokenError = String(err);
    }

    if (!accessToken) {
      return {
        step1_token: { success: false, error: tokenError },
        config: { tokenUrl, apiUrl, clientId: clientId ? `${clientId.slice(0, 4)}...` : "(empty)", hasSecret: !!clientSecret, customerId, payerId, branch },
      };
    }

    // Step 2: Find a test SKU if none provided
    let testSku = sku;
    if (!testSku) {
      const sample = await prisma.$queryRawUnsafe<Array<{ tow_kod: string }>>(
        `SELECT tow_kod FROM intercars_mappings ORDER BY RANDOM() LIMIT 1`
      );
      testSku = sample[0]?.tow_kod;
    }

    if (!testSku) {
      return {
        step1_token: { success: true, tokenLength: accessToken.length },
        error: "No SKU to test. Provide ?sku=XXX or import IC CSV first",
      };
    }

    // Build auth headers
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Accept-Language": "en",
    };
    if (customerId) headers["X-Customer-Id"] = customerId;
    if (payerId) headers["X-Payer-Id"] = payerId;
    if (branch) headers["X-Branch"] = branch;

    // Step 3: Call stock API
    let stockResult: Record<string, unknown> = {};
    try {
      const stockUrl = `${apiUrl}/inventory/stock?sku=${encodeURIComponent(testSku)}`;
      const stockResp = await fetch(stockUrl, { headers });
      const stockBody = await stockResp.text();
      stockResult = {
        url: stockUrl,
        status: stockResp.status,
        statusText: stockResp.statusText,
        headers: Object.fromEntries(stockResp.headers.entries()),
        body: stockBody.slice(0, 2000),
        ok: stockResp.ok,
      };
    } catch (err) {
      stockResult = { error: String(err) };
    }

    // Step 4: Test /inventory/quote (combined stock + pricing, from Postman docs)
    let inventoryQuoteResult: Record<string, unknown> = {};
    try {
      const quoteUrl = `${apiUrl}/inventory/quote`;
      const quoteBody = JSON.stringify({ lines: [{ sku: testSku, quantity: 1 }] });
      const quoteResp = await fetch(quoteUrl, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: quoteBody,
      });
      const quoteRespBody = await quoteResp.text();
      inventoryQuoteResult = {
        url: quoteUrl,
        requestBody: quoteBody,
        status: quoteResp.status,
        body: quoteRespBody.slice(0, 2000),
        ok: quoteResp.ok,
      };
    } catch (err) {
      inventoryQuoteResult = { error: String(err) };
    }

    // Step 5: Test /pricing/quote with correct body format from Postman
    let pricingQuoteResult: Record<string, unknown> = {};
    try {
      const priceUrl = `${apiUrl}/pricing/quote`;
      const priceBody = JSON.stringify({ lines: [{ sku: testSku, quantity: 1 }] });
      const priceResp = await fetch(priceUrl, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: priceBody,
      });
      const priceRespBody = await priceResp.text();
      pricingQuoteResult = {
        url: priceUrl,
        requestBody: priceBody,
        status: priceResp.status,
        body: priceRespBody.slice(0, 2000),
        ok: priceResp.ok,
      };
    } catch (err) {
      pricingQuoteResult = { error: String(err) };
    }

    return {
      step1_token: { success: true, tokenLength: accessToken.length },
      testSku,
      step2_stock: stockResult,
      step3_inventory_quote: inventoryQuoteResult,
      step4_pricing_quote: pricingQuoteResult,
      config: {
        apiUrl,
        customerId: customerId || "(empty)",
        payerId: payerId || "(empty)",
        branch: branch || "(empty)",
        headersUsed: Object.keys(headers),
      },
    };
  });

  // ============ IC API Search Probe ============
  // Test different IC API search parameters to discover what works
  app.get("/intercars/probe-api", async (request) => {
    const { article, brand } = request.query as { article?: string; brand?: string };
    if (!article) return { error: "Provide ?article=XXX (TecDoc article number)" };

    const IC_TOKEN_URL = process.env.INTERCARS_TOKEN_URL || "https://is.webapi.intercars.eu/oauth2/token";
    const IC_API_URL = process.env.INTERCARS_API_URL || "https://api.webapi.intercars.eu/ic";
    const IC_CLIENT_ID = process.env.INTERCARS_CLIENT_ID || "";
    const IC_CLIENT_SECRET = process.env.INTERCARS_CLIENT_SECRET || "";
    const IC_CUSTOMER_ID = process.env.INTERCARS_CUSTOMER_ID || "";
    const IC_PAYER_ID = process.env.INTERCARS_PAYER_ID || "";
    const IC_BRANCH = process.env.INTERCARS_BRANCH || "";

    if (!IC_CLIENT_ID) return { error: "No INTERCARS_CLIENT_ID configured" };

    // Get token
    const basicAuth = Buffer.from(`${IC_CLIENT_ID}:${IC_CLIENT_SECRET}`).toString("base64");
    const tokenResp = await fetch(IC_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basicAuth}` },
      body: "grant_type=client_credentials&scope=allinone",
    });
    if (!tokenResp.ok) return { error: `Token failed: ${tokenResp.status}` };
    const tokenData = (await tokenResp.json()) as { access_token: string };
    const token = tokenData.access_token;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Accept-Language": "en",
    };
    if (IC_CUSTOMER_ID) headers["X-Customer-Id"] = IC_CUSTOMER_ID;
    if (IC_PAYER_ID) headers["X-Payer-Id"] = IC_PAYER_ID;
    if (IC_BRANCH) headers["X-Branch"] = IC_BRANCH;

    const norm = article.replace(/[^a-zA-Z0-9]/g, "");
    const results: Record<string, unknown> = {};

    // Try many different search approaches
    const searches = [
      { name: "by_index_raw", url: `${IC_API_URL}/catalog/products?index=${encodeURIComponent(article)}&pageSize=3` },
      { name: "by_index_norm", url: `${IC_API_URL}/catalog/products?index=${encodeURIComponent(norm)}&pageSize=3` },
      { name: "by_query", url: `${IC_API_URL}/catalog/products?query=${encodeURIComponent(article)}&pageSize=3` },
      { name: "by_search", url: `${IC_API_URL}/catalog/products?search=${encodeURIComponent(article)}&pageSize=3` },
      { name: "by_articleNumber", url: `${IC_API_URL}/catalog/products?articleNumber=${encodeURIComponent(article)}&pageSize=3` },
      { name: "by_tecDoc", url: `${IC_API_URL}/catalog/products?tecDoc=${encodeURIComponent(article)}&pageSize=3` },
      { name: "by_ean", url: `${IC_API_URL}/catalog/products?ean=${encodeURIComponent(article)}&pageSize=3` },
      { name: "search_endpoint", url: `${IC_API_URL}/catalog/search?query=${encodeURIComponent(article)}&pageSize=3` },
      { name: "search_v2", url: `${IC_API_URL}/search/products?query=${encodeURIComponent(article)}&pageSize=3` },
      { name: "cross_ref", url: `${IC_API_URL}/catalog/crossreference?articleNumber=${encodeURIComponent(article)}&pageSize=3` },
      { name: "cross_ref2", url: `${IC_API_URL}/crossreference?articleNumber=${encodeURIComponent(article)}` },
    ];

    if (brand) {
      searches.push(
        { name: "by_index_brand", url: `${IC_API_URL}/catalog/products?index=${encodeURIComponent(article)}&brand=${encodeURIComponent(brand)}&pageSize=3` },
        { name: "by_query_brand", url: `${IC_API_URL}/catalog/products?query=${encodeURIComponent(brand + " " + article)}&pageSize=3` },
      );
    }

    // Run all searches in parallel
    const settled = await Promise.allSettled(
      searches.map(async (s) => {
        const resp = await fetch(s.url, { headers, signal: AbortSignal.timeout(10_000) });
        const body = await resp.text();
        return {
          name: s.name,
          url: s.url,
          status: resp.status,
          body: body.slice(0, 500),
          hasProducts: body.includes('"products"') && !body.includes('"products":[]'),
        };
      })
    );

    for (const r of settled) {
      if (r.status === "fulfilled") {
        const v = r.value;
        results[v.name] = {
          status: v.status,
          hasProducts: v.hasProducts,
          body: v.body,
        };
      }
    }

    return { article, norm, brand, results };
  });

  // ============ Brand Alias Management ============

  // List all brand aliases for InterCars
  app.get("/intercars/brand-aliases", async () => {
    const icSupplier = await prisma.supplier.findUnique({ where: { code: "intercars" } });
    if (!icSupplier) return { error: "InterCars supplier not found" };

    const aliases = await prisma.supplierBrandRule.findMany({
      where: { supplierId: icSupplier.id, active: true },
      include: { brand: { select: { id: true, name: true, code: true } } },
      orderBy: { supplierBrand: "asc" },
    });

    return {
      total: aliases.length,
      aliases: aliases.map((a) => ({
        id: a.id,
        supplierBrand: a.supplierBrand,
        tecdocBrand: a.brand.name,
        tecdocBrandId: a.brand.id,
        active: a.active,
      })),
    };
  });

  // Add a brand alias (IC brand name → TecDoc brand)
  app.post("/intercars/brand-aliases", async (request, reply) => {
    const { supplierBrand, tecdocBrandId, tecdocBrandName } = request.body as {
      supplierBrand?: string;
      tecdocBrandId?: number;
      tecdocBrandName?: string;
    };

    if (!supplierBrand) {
      return reply.code(400).send({ error: "supplierBrand is required" });
    }

    const icSupplier = await prisma.supplier.findUnique({ where: { code: "intercars" } });
    if (!icSupplier) return reply.code(404).send({ error: "InterCars supplier not found" });

    // Find the TecDoc brand by ID or name
    let brand;
    if (tecdocBrandId) {
      brand = await prisma.brand.findUnique({ where: { id: tecdocBrandId } });
    } else if (tecdocBrandName) {
      brand = await prisma.brand.findFirst({
        where: { name: { equals: tecdocBrandName, mode: "insensitive" } },
      });
    }
    if (!brand) {
      return reply.code(404).send({ error: "TecDoc brand not found" });
    }

    const alias = await prisma.supplierBrandRule.upsert({
      where: {
        supplierId_supplierBrand: {
          supplierId: icSupplier.id,
          supplierBrand: supplierBrand.toUpperCase(),
        },
      },
      update: { brandId: brand.id, active: true },
      create: {
        supplierId: icSupplier.id,
        brandId: brand.id,
        supplierBrand: supplierBrand.toUpperCase(),
        active: true,
      },
    });

    logger.info({ alias: supplierBrand, tecdocBrand: brand.name }, "Brand alias created/updated");
    return { id: alias.id, supplierBrand: alias.supplierBrand, tecdocBrand: brand.name };
  });

  // Delete a brand alias
  app.delete("/intercars/brand-aliases/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await prisma.supplierBrandRule.delete({ where: { id: parseInt(id, 10) } });
      return { success: true };
    } catch {
      return reply.code(404).send({ error: "Alias not found" });
    }
  });

  // Seed known brand aliases (IC → TecDoc mappings)
  app.post("/intercars/brand-aliases/seed", async () => {
    const icSupplier = await prisma.supplier.findUnique({ where: { code: "intercars" } });
    if (!icSupplier) return { error: "InterCars supplier not found" };

    // Known IC → TecDoc brand name mappings
    const knownAliases: Array<{ icBrand: string; tecdocName: string }> = [
      // Exact renames / historical name changes
      { icBrand: "KAYABA", tecdocName: "KYB" },
      { icBrand: "DT", tecdocName: "DT Spare Parts" },
      { icBrand: "LUK", tecdocName: "Schaeffler LuK" },
      { icBrand: "INA", tecdocName: "Schaeffler INA" },
      { icBrand: "FAG", tecdocName: "Schaeffler FAG" },
      { icBrand: "VITESCO", tecdocName: "Schaeffler Vitesco" },
      // Prefix mismatches the regex can't catch
      { icBrand: "TRW AUTOMOTIVE", tecdocName: "TRW" },
      { icBrand: "MANN FILTER", tecdocName: "MANN-FILTER" },
      { icBrand: "MANN+HUMMEL", tecdocName: "MANN-FILTER" },
      { icBrand: "MANN-HUMMEL", tecdocName: "MANN-FILTER" },
      { icBrand: "K&N", tecdocName: "K&N FILTERS" },
      { icBrand: "KN", tecdocName: "K&N FILTERS" },
      { icBrand: "LEMFORDER", tecdocName: "LEMFÖRDER" },
      { icBrand: "LEMFOERDER", tecdocName: "LEMFÖRDER" },
      // Common abbreviations / alternate names
      { icBrand: "ZF FRIEDRICHSHAFEN", tecdocName: "ZF" },
      { icBrand: "ZF PARTS", tecdocName: "ZF" },
      { icBrand: "NGK SPARK PLUG", tecdocName: "NGK" },
      { icBrand: "SKF VKBA", tecdocName: "SKF" },
      { icBrand: "OLSA", tecdocName: "OLSA Aftermarket" },
      { icBrand: "MAGNUM", tecdocName: "Magnum Technology" },
      { icBrand: "FILTRON MANN", tecdocName: "FILTRON" },
      { icBrand: "FEBI", tecdocName: "FEBI BILSTEIN" },
      { icBrand: "BILSTEIN FEBI", tecdocName: "FEBI BILSTEIN" },
      { icBrand: "BOSAL NOWOTWOR", tecdocName: "BOSAL" },
      { icBrand: "METZGER", tecdocName: "METZGER AUTOTEILE" },
      { icBrand: "BLUE PRINT ADL", tecdocName: "BLUE PRINT" },
      { icBrand: "CHAMPION LABS", tecdocName: "CHAMPION" },
      // Body parts / lighting brands (map to closest TecDoc brand if same products)
      { icBrand: "BLIC", tecdocName: "DIEDERICHS" },
      { icBrand: "DEPO", tecdocName: "TYC" },
      // FAG variants → Schaeffler FAG
      { icBrand: "FAG ZAWIESZENIE", tecdocName: "Schaeffler FAG" },
      { icBrand: "FAG Bearings", tecdocName: "Schaeffler FAG" },
      { icBrand: "FAG BEARINGS", tecdocName: "Schaeffler FAG" },
      // LuK variants → Schaeffler LuK
      { icBrand: "LUK1", tecdocName: "Schaeffler LuK" },
      { icBrand: "LUK 1", tecdocName: "Schaeffler LuK" },
      // KS pistons/rings → Kolbenschmidt
      { icBrand: "KS", tecdocName: "KOLBENSCHMIDT" },
      { icBrand: "KS KOLBENSCHMIDT", tecdocName: "KOLBENSCHMIDT" },
      // Goetze → MAHLE (acquired, same TecDoc articles)
      { icBrand: "GOETZE", tecdocName: "MAHLE" },
      // VDO (Continental brand), HC-Cargo electrical
      { icBrand: "VDO", tecdocName: "CONTINENTAL" },
      { icBrand: "HC-CARGO", tecdocName: "CARGOPARTS" },
      { icBrand: "HC CARGO", tecdocName: "CARGOPARTS" },
      // SACHS variants
      { icBrand: "SACHS BOGE", tecdocName: "SACHS" },
      { icBrand: "ZF SACHS", tecdocName: "SACHS" },
      // SNR bearings
      { icBrand: "SNR BEARINGS", tecdocName: "SNR" },
      { icBrand: "NTN-SNR", tecdocName: "SNR" },
      // Continental/ContiTech variants
      { icBrand: "CONTITECH", tecdocName: "CONTINENTAL" },
      { icBrand: "CONTINENTAL CONTITECH", tecdocName: "CONTINENTAL" },
      // Other brand variants
      { icBrand: "HELLA PAGID", tecdocName: "HELLA" },
      { icBrand: "ELRING KLINGER", tecdocName: "ELRING" },
      { icBrand: "SWF VALEO", tecdocName: "SWF" },
      { icBrand: "MARELLI", tecdocName: "MAGNETI MARELLI" },
      { icBrand: "PASCAL (CIT)", tecdocName: "PASCAL" },
      // BOSCH sub-brands in InterCars
      { icBrand: "BOSCH Brakes", tecdocName: "BOSCH" },
      { icBrand: "BOSCH Filers", tecdocName: "BOSCH" },
      { icBrand: "BOSCH DIESEL", tecdocName: "BOSCH" },
      { icBrand: "BOSCH Belts", tecdocName: "BOSCH" },
      { icBrand: "BOSCH Wipers", tecdocName: "BOSCH" },
      { icBrand: "BOSCH Injection", tecdocName: "BOSCH" },
      { icBrand: "BOSCH Electrics", tecdocName: "BOSCH" },
      { icBrand: "BOSCH Bateries", tecdocName: "BOSCH" },
      { icBrand: "BOSCH-ELEKTRONARZĘDZ", tecdocName: "BOSCH" },
      { icBrand: "KIOSK SBC", tecdocName: "BOSCH" },
      // VALEO sub-brands
      { icBrand: "VALEO1", tecdocName: "VALEO" },
      { icBrand: "VALEO WYCIERACZKI", tecdocName: "VALEO" },
      // DELPHI sub-brands
      { icBrand: "DELPHI DIESEL", tecdocName: "DELPHI" },
      { icBrand: "DELPHI WTRYSK", tecdocName: "DELPHI" },
      // DENSO sub-brands
      { icBrand: "DENSO WTRYSK", tecdocName: "DENSO" },
      { icBrand: "DENSO DIESEL", tecdocName: "DENSO" },
      // Other sub-brands
      { icBrand: "GATES OFF HIGHWAY", tecdocName: "GATES" },
      { icBrand: "DONALDSON OFF", tecdocName: "DONALDSON" },
      { icBrand: "TRW ENGINE COMPONENT", tecdocName: "TRW" },
      { icBrand: "ABE PERFORMANCE", tecdocName: "ABE" },
      { icBrand: "CONTI Industry", tecdocName: "CONTINENTAL CTAM" },
      // Numbered IC variants
      { icBrand: "MAGNUM TECHNOLOGY1", tecdocName: "Magnum Technology" },
      { icBrand: "TYC1", tecdocName: "TYC" },
      { icBrand: "BILSTEIN1", tecdocName: "BILSTEIN" },
      { icBrand: "BREMBO-TU", tecdocName: "BREMBO" },
      // XXL / bulk pack variants
      { icBrand: "CASTROL XXL", tecdocName: "CASTROL" },
      { icBrand: "CASTROL MOTO", tecdocName: "CASTROL" },
      { icBrand: "CASTROL MOTO XXL", tecdocName: "CASTROL" },
      { icBrand: "SHELL XXL", tecdocName: "SHELL" },
      { icBrand: "MOBIL XXL", tecdocName: "MOBIL" },
      { icBrand: "LIQUI MOLY XXL", tecdocName: "LIQUI MOLY" },
      { icBrand: "LIQUI MOLY MOTO", tecdocName: "LIQUI MOLY" },
      { icBrand: "FEBI BILSTEIN XXL", tecdocName: "FEBI BILSTEIN" },
      // Other aliases
      { icBrand: "HANKOOK AKUMULATORY", tecdocName: "Hankook" },
      { icBrand: "BMTS", tecdocName: "MAHLE" },
      { icBrand: "FAG Industry", tecdocName: "Schaeffler FAG" },
      { icBrand: "TARNÓW", tecdocName: "ZF" },
      { icBrand: "4MAX BLACHY", tecdocName: "BLIC" },
      // Missing from worker: ensure parity
      { icBrand: "HANS PRIES", tecdocName: "TOPRAN" },
      { icBrand: "HENGST", tecdocName: "HENGST FILTER" },
      { icBrand: "SACHS1", tecdocName: "SACHS" },
    ];

    let created = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const alias of knownAliases) {
      const brand = await prisma.brand.findFirst({
        where: { name: { equals: alias.tecdocName, mode: "insensitive" } },
      });

      if (!brand) {
        errors.push(`TecDoc brand "${alias.tecdocName}" not found for IC brand "${alias.icBrand}"`);
        skipped++;
        continue;
      }

      try {
        await prisma.supplierBrandRule.upsert({
          where: {
            supplierId_supplierBrand: {
              supplierId: icSupplier.id,
              supplierBrand: alias.icBrand.toUpperCase(),
            },
          },
          update: { brandId: brand.id, active: true },
          create: {
            supplierId: icSupplier.id,
            brandId: brand.id,
            supplierBrand: alias.icBrand.toUpperCase(),
            active: true,
          },
        });
        created++;
      } catch (err) {
        errors.push(`Failed to create alias "${alias.icBrand}" → "${alias.tecdocName}": ${err}`);
        skipped++;
      }
    }

    return { created, skipped, errors: errors.length > 0 ? errors : undefined };
  });

  // Auto-discover: find IC CSV brands with no TecDoc brand match
  app.get("/intercars/unmatched-brands", async () => {
    const icSupplier = await prisma.supplier.findUnique({ where: { code: "intercars" } });

    // Get all IC CSV distinct manufacturers with counts
    const icBrands = await prisma.$queryRawUnsafe<Array<{ manufacturer: string; count: bigint }>>(
      `SELECT manufacturer, COUNT(*) as count FROM intercars_mappings GROUP BY manufacturer ORDER BY count DESC`
    );

    // Get all TecDoc brands
    const tecdocBrands = await prisma.brand.findMany({ select: { id: true, name: true } });

    // Get existing aliases
    const aliases = icSupplier
      ? await prisma.supplierBrandRule.findMany({
          where: { supplierId: icSupplier.id, active: true },
          select: { supplierBrand: true, brand: { select: { name: true } } },
        })
      : [];
    const aliasMap = new Map(aliases.map((a) => [a.supplierBrand.toUpperCase(), a.brand.name]));

    // Build normalized TecDoc brand lookup
    const normalize = (s: string) => s.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const tecdocNormalized = new Map<string, string>();
    for (const b of tecdocBrands) {
      tecdocNormalized.set(normalize(b.name), b.name);
    }

    const matched: Array<{ icBrand: string; count: number; tecdocBrand: string; method: string }> = [];
    const unmatched: Array<{ icBrand: string; count: number }> = [];
    const aliased: Array<{ icBrand: string; count: number; tecdocBrand: string }> = [];

    for (const ic of icBrands) {
      const icNorm = normalize(ic.manufacturer);
      const count = Number(ic.count);

      // Check alias first
      if (aliasMap.has(ic.manufacturer.toUpperCase())) {
        aliased.push({ icBrand: ic.manufacturer, count, tecdocBrand: aliasMap.get(ic.manufacturer.toUpperCase())! });
        continue;
      }

      // Check exact normalized match
      if (tecdocNormalized.has(icNorm)) {
        matched.push({ icBrand: ic.manufacturer, count, tecdocBrand: tecdocNormalized.get(icNorm)!, method: "exact" });
        continue;
      }

      // Check prefix match (both directions)
      let found = false;
      for (const [tn, tb] of tecdocNormalized) {
        if (icNorm.length >= 2 && tn.startsWith(icNorm)) {
          matched.push({ icBrand: ic.manufacturer, count, tecdocBrand: tb, method: "prefix" });
          found = true;
          break;
        }
        if (tn.length >= 2 && icNorm.startsWith(tn)) {
          matched.push({ icBrand: ic.manufacturer, count, tecdocBrand: tb, method: "prefix" });
          found = true;
          break;
        }
      }
      if (!found) {
        unmatched.push({ icBrand: ic.manufacturer, count });
      }
    }

    const unmatchedTotal = unmatched.reduce((s, u) => s + u.count, 0);
    const matchedTotal = matched.reduce((s, m) => s + m.count, 0);
    const aliasedTotal = aliased.reduce((s, a) => s + a.count, 0);

    return {
      summary: {
        totalIcBrands: icBrands.length,
        matched: matched.length,
        matchedProducts: matchedTotal,
        aliased: aliased.length,
        aliasedProducts: aliasedTotal,
        unmatched: unmatched.length,
        unmatchedProducts: unmatchedTotal,
      },
      aliased,
      unmatched,
      matched,
    };
  });

  // Auto-create brand aliases for IC brands that match TecDoc brands by normalized name
  app.post("/intercars/brand-aliases/auto", async () => {
    const icSupplier = await prisma.supplier.findUnique({ where: { code: "intercars" } });
    if (!icSupplier) return { error: "InterCars supplier not found" };

    const icBrands = await prisma.$queryRawUnsafe<Array<{ manufacturer: string; count: bigint }>>(
      `SELECT manufacturer, COUNT(*) as count FROM intercars_mappings GROUP BY manufacturer ORDER BY count DESC`
    );
    const tecdocBrands = await prisma.brand.findMany({ select: { id: true, name: true } });
    const existingAliases = await prisma.supplierBrandRule.findMany({
      where: { supplierId: icSupplier.id },
      select: { supplierBrand: true },
    });
    const existingSet = new Set(existingAliases.map((a) => a.supplierBrand.toUpperCase()));

    const normalize = (s: string) => s.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const tecdocByNorm = new Map<string, { id: number; name: string }>();
    for (const b of tecdocBrands) {
      tecdocByNorm.set(normalize(b.name), b);
    }

    let created = 0;
    let skipped = 0;
    const newAliases: Array<{ icBrand: string; tecdocBrand: string; count: number }> = [];

    for (const ic of icBrands) {
      const icUpper = ic.manufacturer.toUpperCase();
      if (existingSet.has(icUpper)) { skipped++; continue; }

      // Skip OE brands — they use OEM part numbers, not aftermarket article numbers
      // Matching them to aftermarket brands creates false product links
      if (icUpper.startsWith("OE ")) { skipped++; continue; }

      const icNorm = normalize(ic.manufacturer);
      let match: { id: number; name: string } | undefined;

      // Exact normalized match
      if (tecdocByNorm.has(icNorm)) {
        match = tecdocByNorm.get(icNorm);
      } else {
        // Prefix match (IC starts with TecDoc or vice versa, min 3 chars)
        for (const [tn, tb] of tecdocByNorm) {
          if (icNorm.length >= 3 && tn.length >= 3) {
            if (tn.startsWith(icNorm) || icNorm.startsWith(tn)) {
              match = tb;
              break;
            }
          }
        }
      }

      if (!match) { skipped++; continue; }

      try {
        await prisma.supplierBrandRule.create({
          data: {
            supplierId: icSupplier.id,
            brandId: match.id,
            supplierBrand: icUpper,
            active: true,
          },
        });
        created++;
        newAliases.push({ icBrand: ic.manufacturer, tecdocBrand: match.name, count: Number(ic.count) });
        existingSet.add(icUpper);
      } catch {
        skipped++;
      }
    }

    return {
      created,
      skipped,
      totalIcMappingsCovered: newAliases.reduce((s, a) => s + a.count, 0),
      newAliases,
    };
  });

  // Import Stock CSV: upsert TOW_KOD + TEC_DOC + TEC_DOC_PROD into intercars_mappings
  // This adds tecdoc_prod for direct brand-ID matching (bypasses fuzzy brand name matching)
  app.post("/intercars/import-stock-csv", async (request) => {
    const body = request.body as { rows: Array<{ towKod: string; icIndex: string; tecdoc: string; tecdocProd: number | null; warehouse?: string; availability?: number }> };
    const rows = body?.rows;

    if (!Array.isArray(rows) || rows.length === 0) {
      return { imported: 0 };
    }

    // Deduplicate by towKod within the batch (keep last occurrence)
    const deduped = new Map<string, typeof rows[0]>();
    for (const r of rows) {
      if (r.towKod) deduped.set(r.towKod, r);
    }
    const uniqueRows = Array.from(deduped.values());

    // Batch upsert in chunks of 500
    let imported = 0;
    for (let i = 0; i < uniqueRows.length; i += 500) {
      const batch = uniqueRows.slice(i, i + 500);
      const values = batch.map((r) =>
        Prisma.sql`(
          ${r.towKod}, ${r.icIndex ?? ""}, ${r.tecdoc ?? ""}, '',
          ${r.tecdocProd}, '', NULL, NULL,
          false, NOW()
        )`
      );

      try {
        await prisma.$executeRaw`
          INSERT INTO intercars_mappings (
            tow_kod, ic_index, article_number, manufacturer,
            tecdoc_prod, description, ean, weight,
            blocked_return, created_at
          )
          VALUES ${Prisma.join(values)}
          ON CONFLICT (tow_kod) DO UPDATE SET
            ic_index = CASE WHEN EXCLUDED.ic_index != '' THEN EXCLUDED.ic_index ELSE intercars_mappings.ic_index END,
            article_number = CASE WHEN EXCLUDED.article_number != '' AND intercars_mappings.article_number = '' THEN EXCLUDED.article_number ELSE intercars_mappings.article_number END,
            tecdoc_prod = COALESCE(EXCLUDED.tecdoc_prod, intercars_mappings.tecdoc_prod)
        `;
        imported += batch.length;
      } catch (err) {
        logger.warn({ err, chunk: i }, "Stock CSV import chunk failed");
      }
    }

    return { imported, uniqueRows: uniqueRows.length };
  });

  // Bulk import Stock CSV server-side from file path
  app.post("/intercars/import-stock-file", async (request) => {
    const { filePath } = request.body as { filePath?: string };
    const csvPath = filePath || "/app/data/Stock_2026-02-26.csv";

    const fs = await import("fs");
    const readline = await import("readline");

    if (!fs.existsSync(csvPath)) {
      return { error: `File not found: ${csvPath}` };
    }

    const fileStream = fs.createReadStream(csvPath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    const esc = (s: string) => s.replace(/'/g, "''");

    let header: string[] = [];
    let lineNum = 0;
    let imported = 0;
    let errors = 0;
    let batch: Array<{ towKod: string; icIndex: string; articleNumber: string; tecdocProd: number | null }> = [];

    const flushBatch = async () => {
      if (batch.length === 0) return;
      // Deduplicate by towKod within the batch (keep last occurrence)
      const deduped = new Map<string, typeof batch[0]>();
      for (const r of batch) deduped.set(r.towKod, r);
      const unique = Array.from(deduped.values());
      const valuesStr = unique.map((r) =>
        `('${esc(r.towKod)}', '${esc(r.icIndex)}', '${esc(r.articleNumber)}', '', ${r.tecdocProd ?? "NULL"}, '', NULL, NULL, false, NOW())`
      ).join(",\n");

      try {
        await prisma.$executeRawUnsafe(`
          INSERT INTO intercars_mappings (
            tow_kod, ic_index, article_number, manufacturer,
            tecdoc_prod, description, ean, weight,
            blocked_return, created_at
          )
          VALUES ${valuesStr}
          ON CONFLICT (tow_kod) DO UPDATE SET
            ic_index = CASE WHEN EXCLUDED.ic_index != '' THEN EXCLUDED.ic_index ELSE intercars_mappings.ic_index END,
            article_number = CASE WHEN EXCLUDED.article_number != '' AND intercars_mappings.article_number = '' THEN EXCLUDED.article_number ELSE intercars_mappings.article_number END,
            tecdoc_prod = COALESCE(EXCLUDED.tecdoc_prod, intercars_mappings.tecdoc_prod)
        `);
        imported += unique.length;
      } catch (err) {
        errors++;
        logger.warn({ err, lineNum, batchSize: unique.length }, "Stock CSV file import batch failed");
      }
      batch = [];
    };

    for await (const line of rl) {
      lineNum++;
      if (lineNum === 1) {
        header = line.split(";").map((h: string) => h.trim());
        continue;
      }

      const cols = line.split(";");
      const towKod = cols[header.indexOf("TOW_KOD")]?.trim();
      const icIndex = cols[header.indexOf("IC_INDEX")]?.trim() || "";
      const tecdoc = cols[header.indexOf("TEC_DOC")]?.trim() || "";
      const tecdocProd = cols[header.indexOf("TEC_DOC_PROD")]?.trim();

      if (!towKod) continue;

      batch.push({
        towKod,
        icIndex,
        articleNumber: tecdoc,
        tecdocProd: tecdocProd ? parseInt(tecdocProd, 10) : null,
      });

      if (batch.length >= 1000) {
        await flushBatch();
      }
    }

    await flushBatch();

    logger.info({ imported, errors, totalLines: lineNum - 1 }, "Stock CSV file import complete");
    return { imported, errors, totalLines: lineNum - 1 };
  });

  // Fix wrong OE brand aliases — remove any alias where IC brand starts with "OE "
  app.post("/intercars/brand-aliases/fix-oe", async () => {
    const icSupplier = await prisma.supplier.findUnique({ where: { code: "intercars" } });
    if (!icSupplier) return { error: "InterCars supplier not found" };

    const wrongAliases = await prisma.supplierBrandRule.findMany({
      where: { supplierId: icSupplier.id, supplierBrand: { startsWith: "OE " } },
      include: { brand: { select: { name: true } } },
    });

    let deleted = 0;
    for (const alias of wrongAliases) {
      await prisma.supplierBrandRule.delete({ where: { id: alias.id } });
      deleted++;
    }

    return {
      deleted,
      removedAliases: wrongAliases.map(a => ({
        icBrand: a.supplierBrand,
        wasMappedTo: a.brand.name,
      })),
    };
  });

  // Diagnostic: understand why fuzzy phases find 0 matches
  app.get("/intercars/fuzzy-diagnostic", async () => {
    const queries: Record<string, string> = {
      // How many unmatched products have OEM data?
      unmatchedWithOem: `SELECT COUNT(*) as count FROM product_maps WHERE ic_sku IS NULL AND status = 'active' AND oem IS NOT NULL AND LENGTH(oem) >= 5`,
      // How many have oem_numbers JSON array?
      unmatchedWithOemNumbers: `SELECT COUNT(*) as count FROM product_maps WHERE ic_sku IS NULL AND status = 'active' AND oem_numbers IS NOT NULL AND oem_numbers::text != '[]' AND oem_numbers::text != 'null'`,
      // Phase 2A potential: OEM → IC article
      phase2aPotential: `SELECT COUNT(DISTINCT pm.id) as count
        FROM product_maps pm
        JOIN intercars_mappings im ON
          im.normalized_article_number = UPPER(regexp_replace(pm.oem, '[^a-zA-Z0-9]', '', 'g'))
        WHERE pm.status = 'active' AND pm.ic_sku IS NULL
          AND pm.oem IS NOT NULL AND LENGTH(pm.oem) >= 5`,
      // Phase 2B potential: oem_numbers array → IC article
      phase2bPotential: `SELECT COUNT(DISTINCT pm.id) as count
        FROM product_maps pm
        CROSS JOIN LATERAL jsonb_array_elements_text(pm.oem_numbers::jsonb) AS oem_val
        JOIN intercars_mappings im ON
          im.normalized_article_number = UPPER(regexp_replace(oem_val, '[^a-zA-Z0-9]', '', 'g'))
        WHERE pm.status = 'active' AND pm.ic_sku IS NULL
          AND pm.oem_numbers IS NOT NULL AND pm.oem_numbers::text != '[]'`,
      // Phase 2C potential: leading-zero strip (use tecdoc_prod only, normalized_name may not exist)
      phase2cPotential: `SELECT COUNT(DISTINCT pm.id) as count
        FROM product_maps pm
        JOIN brands b ON b.id = pm.brand_id
        JOIN intercars_mappings im ON
          LTRIM(im.normalized_article_number, '0') = LTRIM(pm.normalized_article_no, '0')
          AND LENGTH(LTRIM(pm.normalized_article_no, '0')) >= 5
          AND im.tecdoc_prod IS NOT NULL AND b.tecdoc_id IS NOT NULL AND im.tecdoc_prod = b.tecdoc_id
        WHERE pm.status = 'active' AND pm.ic_sku IS NULL`,
      // Phase 2A sample: show actual matches to verify correctness
      phase2aSample: `SELECT pm.id as product_id, pm.article_no, pm.oem, b.name as brand,
          im.tow_kod, im.article_number as ic_article, im.manufacturer as ic_brand
        FROM product_maps pm
        JOIN brands b ON b.id = pm.brand_id
        JOIN intercars_mappings im ON
          im.normalized_article_number = UPPER(regexp_replace(pm.oem, '[^a-zA-Z0-9]', '', 'g'))
        WHERE pm.status = 'active' AND pm.ic_sku IS NULL
          AND pm.oem IS NOT NULL AND LENGTH(pm.oem) >= 5
        LIMIT 15`,
      // Check if brands.normalized_name column exists
      brandsHasNormalizedName: `SELECT column_name FROM information_schema.columns WHERE table_name = 'brands' AND column_name = 'normalized_name'`,
      // Sample unmatched products: what do they look like?
      sampleUnmatched: `SELECT pm.id, pm.article_no, pm.oem, pm.oem_numbers::text as oem_numbers, pm.ean, b.name as brand, b.tecdoc_id
        FROM product_maps pm JOIN brands b ON b.id = pm.brand_id
        WHERE pm.status = 'active' AND pm.ic_sku IS NULL
        ORDER BY RANDOM() LIMIT 10`,
      // How many IC mappings have normalized_article_number populated?
      icWithNormArticle: `SELECT COUNT(*) as count FROM intercars_mappings WHERE normalized_article_number IS NOT NULL AND normalized_article_number != ''`,
      // How many product_maps have normalized_article_no populated?
      pmWithNormArticle: `SELECT COUNT(*) as count FROM product_maps WHERE normalized_article_no IS NOT NULL AND normalized_article_no != '' AND status = 'active'`,
      // Check if normalized columns exist
      icSampleNormalized: `SELECT article_number, normalized_article_number, manufacturer, normalized_manufacturer, tecdoc_prod FROM intercars_mappings LIMIT 5`,
      pmSampleNormalized: `SELECT article_no, normalized_article_no, oem, brand_id FROM product_maps WHERE status = 'active' LIMIT 5`,
    };

    const results: Record<string, unknown> = {};
    for (const [key, sql] of Object.entries(queries)) {
      try {
        const rows = await prisma.$queryRawUnsafe<unknown[]>(sql);
        if (rows.length === 1 && typeof rows[0] === "object" && rows[0] !== null && "count" in rows[0]) {
          results[key] = Number((rows[0] as { count: bigint }).count);
        } else {
          results[key] = rows;
        }
      } catch (err) {
        results[key] = { error: String(err).slice(0, 300) };
      }
    }

    return results;
  });

  /**
   * POST /intercars/create-missing-brands
   *
   * Creates DB brands for ALL IC manufacturers that don't exist yet, then creates
   * brand aliases so the matching phases can find them. This unlocks Phase 0 and
   * Phase 1A matching for the 844+ unmatched IC brands.
   */
  app.post("/intercars/create-missing-brands", async () => {
    const icSupplier = await prisma.supplier.findUnique({ where: { code: "intercars" } });
    if (!icSupplier) return { error: "InterCars supplier not found" };

    // Get all unique IC manufacturers with counts
    const icBrands = await prisma.$queryRawUnsafe<Array<{ manufacturer: string; count: bigint; tecdoc_prod: number | null }>>(
      `SELECT manufacturer, COUNT(*) as count, MAX(tecdoc_prod) as tecdoc_prod
       FROM intercars_mappings
       GROUP BY manufacturer
       ORDER BY count DESC`
    );

    // Get existing brands and aliases
    const existingBrands = await prisma.brand.findMany({ select: { id: true, name: true, code: true } });
    const existingAliases = await prisma.supplierBrandRule.findMany({
      where: { supplierId: icSupplier.id },
      select: { supplierBrand: true, brandId: true },
    });

    const brandByNorm = new Map<string, { id: number; name: string }>();
    for (const b of existingBrands) {
      brandByNorm.set(b.name.replace(/[^a-zA-Z0-9]/g, "").toUpperCase(), b);
      brandByNorm.set(b.code.replace(/[^a-z0-9]/g, "").toUpperCase(), b);
    }
    const aliasSet = new Set(existingAliases.map((a) => a.supplierBrand.toUpperCase()));

    let brandsCreated = 0;
    let aliasesCreated = 0;
    let skipped = 0;
    const created: Array<{ icBrand: string; dbBrand: string; count: number; action: string }> = [];

    for (const ic of icBrands) {
      const icUpper = ic.manufacturer.toUpperCase();
      const icNorm = ic.manufacturer.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();

      // Skip if alias already exists
      if (aliasSet.has(icUpper)) { skipped++; continue; }

      // Try to find existing brand by normalized name
      let matchedBrand = brandByNorm.get(icNorm);

      // Prefix matching: "FEBI" → "FEBI BILSTEIN", "DT SPARE" → "DT SPARE PARTS"
      if (!matchedBrand) {
        for (const [norm, brand] of brandByNorm) {
          if (icNorm.length >= 3 && norm.length >= 3) {
            if (norm.startsWith(icNorm) || icNorm.startsWith(norm)) {
              matchedBrand = brand;
              break;
            }
          }
        }
      }

      if (!matchedBrand) {
        // Create new brand for this IC manufacturer
        const code = ic.manufacturer.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
        try {
          const newBrand = await prisma.brand.create({
            data: {
              name: ic.manufacturer,
              code: code || `ic_${Date.now()}`,
              tecdocId: ic.tecdoc_prod ? Number(ic.tecdoc_prod) : null,
            },
          });
          matchedBrand = { id: newBrand.id, name: newBrand.name };
          brandByNorm.set(icNorm, matchedBrand);
          brandsCreated++;
          created.push({ icBrand: ic.manufacturer, dbBrand: newBrand.name, count: Number(ic.count), action: "brand+alias" });
        } catch {
          // Brand might exist under different code — try finding by name
          const existing = await prisma.brand.findFirst({ where: { name: ic.manufacturer } });
          if (existing) {
            matchedBrand = { id: existing.id, name: existing.name };
          } else {
            skipped++;
            continue;
          }
        }
      } else {
        created.push({ icBrand: ic.manufacturer, dbBrand: matchedBrand.name, count: Number(ic.count), action: "alias-only" });
      }

      // Create alias
      try {
        await prisma.supplierBrandRule.create({
          data: {
            supplierId: icSupplier.id,
            brandId: matchedBrand.id,
            supplierBrand: icUpper,
            active: true,
          },
        });
        aliasesCreated++;
        aliasSet.add(icUpper);
      } catch {
        // Alias might already exist
      }
    }

    // Update normalized_name on all new brands (needed for Phase 1A matching)
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE brands SET normalized_name = UPPER(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g'))
         WHERE normalized_name IS NULL OR normalized_name = ''`
      );
    } catch {
      // Column might not exist, non-fatal
    }

    return {
      totalIcBrands: icBrands.length,
      brandsCreated,
      aliasesCreated,
      skipped,
      totalProducts: created.reduce((s, c) => s + c.count, 0),
      topCreated: created.slice(0, 50),
    };
  });

  /**
   * POST /intercars/import-ic-products
   *
   * Creates product_map entries for IC CSV products that have NO matching
   * TecDoc product. These are products from IC-only brands (ATHENA, CORTECO,
   * VAICO, etc.) that were never synced from TecDoc.
   *
   * The products are created under the TecDoc supplier (so they appear alongside
   * other products) with icSku already set (since they come from IC).
   */
  app.post("/intercars/import-ic-products", {
    onRequest: async (request) => { request.raw.socket.setTimeout(300_000); },
  }, async (request) => {
    const { brandIds, manufacturers } = (request.body ?? {}) as {
      brandIds?: number[];
      manufacturers?: string[];
    };

    const tecdocSupplier = await prisma.supplier.findUnique({ where: { code: "tecdoc" } });
    if (!tecdocSupplier) return { error: "TecDoc supplier not found" };

    // Pre-load brand mapping: IC manufacturer → DB brand ID
    const aliases = await prisma.supplierBrandRule.findMany({
      include: { brand: true },
    });
    const brandMap = new Map<string, number>();
    for (const a of aliases) {
      brandMap.set(a.supplierBrand.toUpperCase(), a.brandId);
    }
    const allBrands = await prisma.brand.findMany({ select: { id: true, name: true } });
    for (const b of allBrands) {
      const upper = b.name.toUpperCase();
      if (!brandMap.has(upper)) brandMap.set(upper, b.id);
    }

    // Build manufacturer filter if brandIds or manufacturers specified
    let mfrFilter = "";
    const targetBrandIds = new Set<number>(brandIds || []);
    if (manufacturers?.length) {
      const escaped = manufacturers.map(m => m.replace(/'/g, "''")).join("','");
      mfrFilter = `AND UPPER(im.manufacturer) IN ('${escaped.toUpperCase()}')`;
    } else if (brandIds?.length) {
      // Find manufacturer names that map to these brand IDs
      const mfrNames: string[] = [];
      for (const [mfr, bid] of brandMap) {
        if (targetBrandIds.has(bid)) mfrNames.push(mfr);
      }
      if (mfrNames.length > 0) {
        const escaped = mfrNames.map(m => m.replace(/'/g, "''")).join("','");
        mfrFilter = `AND UPPER(im.manufacturer) IN ('${escaped}')`;
      }
    }

    // Use efficient bulk INSERT ... SELECT to import all at once
    const result = await prisma.$executeRawUnsafe(`
      INSERT INTO product_maps (supplier_id, brand_id, sku, article_no, normalized_article_no,
        ean, tecdoc_id, description, ic_sku, ic_matched_at, weight, status, created_at, updated_at)
      SELECT
        $1::int,
        sbr.brand_id,
        im.tow_kod,
        im.article_number,
        im.normalized_article_number,
        im.ean,
        CASE WHEN im.tecdoc_prod IS NOT NULL THEN im.tecdoc_prod::text ELSE NULL END,
        COALESCE(im.description, im.article_number),
        im.tow_kod,
        NOW(),
        im.weight,
        'active',
        NOW(),
        NOW()
      FROM intercars_mappings im
      JOIN supplier_brand_rules sbr ON UPPER(sbr.supplier_brand) = UPPER(im.manufacturer)
        AND sbr.active = true
      WHERE NOT EXISTS (
        SELECT 1 FROM product_maps pm
        WHERE pm.supplier_id = $1 AND pm.sku = im.tow_kod
      )
      AND im.normalized_article_number IS NOT NULL
      AND im.normalized_article_number != ''
      ${mfrFilter}
      ON CONFLICT (supplier_id, sku) DO UPDATE SET
        ic_sku = EXCLUDED.ic_sku,
        ic_matched_at = NOW(),
        ean = COALESCE(EXCLUDED.ean, product_maps.ean),
        weight = COALESCE(EXCLUDED.weight, product_maps.weight)
    `, tecdocSupplier.id);

    return {
      imported: result,
      message: `Imported IC-only products as product_maps with icSku pre-set`,
      filter: mfrFilter ? "filtered by brands" : "all IC brands",
    };
  });

  // Clean up old IC duplicate product_maps (products with IC supplier_id that duplicate TecDoc products)
  app.delete("/intercars/cleanup-duplicates", async () => {
    const icSupplier = await prisma.supplier.findUnique({ where: { code: "intercars" } });
    if (!icSupplier) return { error: "InterCars supplier not found" };

    // Count before
    const before = await prisma.productMap.count({ where: { supplierId: icSupplier.id } });

    // Delete all product_maps with IC supplier_id (these are old duplicates)
    const deleted = await prisma.productMap.deleteMany({
      where: { supplierId: icSupplier.id },
    });

    return { deleted: deleted.count, before };
  });
}

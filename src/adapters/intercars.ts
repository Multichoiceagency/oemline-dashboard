import { BaseSupplierAdapter } from "./base.js";
import type {
  SupplierSearchParams,
  SupplierProduct,
  SupplierCatalogItem,
} from "../types/index.js";
import { logger } from "../lib/logger.js";

interface InterCarsCredentials {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  customerId?: string;
  payerId?: string;
  branch?: string;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface StockItem {
  sku?: string;
  index?: string;
  brand?: string;
  articleNumber?: string;
  tecdoc?: string;
  tecdocProd?: number;
  description?: string;
  ean?: string;
  availability?: number;
  warehouse?: string;
}

interface PricingItem {
  sku?: string;
  listPriceNet?: number;
  listPriceGross?: number;
  customerPrice?: number;
  taxRate?: number;
  refundableAmount?: number;
  currency?: string;
}

export class IntercarsAdapter extends BaseSupplierAdapter {
  readonly name = "InterCars";
  readonly code = "intercars";

  private credentials: InterCarsCredentials;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(apiUrl: string, apiKey: string, timeout = 30000) {
    super(apiUrl, apiKey, timeout);

    let creds: Partial<InterCarsCredentials> = {};
    try {
      creds = JSON.parse(apiKey);
    } catch {
      // Fallback: apiKey is the client_secret
    }

    this.credentials = {
      clientId: creds.clientId || process.env.INTERCARS_CLIENT_ID || "",
      clientSecret: creds.clientSecret || process.env.INTERCARS_CLIENT_SECRET || apiKey,
      tokenUrl: creds.tokenUrl || process.env.INTERCARS_TOKEN_URL || "https://is.webapi.intercars.eu/oauth2/token",
      customerId: creds.customerId || process.env.INTERCARS_CUSTOMER_ID || "",
      payerId: creds.payerId || process.env.INTERCARS_PAYER_ID || "",
      branch: creds.branch || process.env.INTERCARS_BRANCH || "",
    };
  }

  /**
   * OAuth2 client_credentials with Basic Auth header.
   */
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 30_000) {
      return this.accessToken;
    }

    const basicAuth = Buffer.from(
      `${this.credentials.clientId}:${this.credentials.clientSecret}`
    ).toString("base64");

    const response = await fetch(this.credentials.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
      },
      body: "grant_type=client_credentials&scope=allinone",
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`InterCars OAuth2 token failed: ${response.status} ${text}`);
    }

    const data = (await response.json()) as TokenResponse;
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;

    logger.info({ supplier: this.code }, "OAuth2 token refreshed");
    return this.accessToken;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.getAccessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Accept-Language": "en",
    };

    if (this.credentials.customerId) {
      headers["X-Customer-Id"] = this.credentials.customerId;
    }
    if (this.credentials.payerId) {
      headers["X-Payer-Id"] = this.credentials.payerId;
    }
    if (this.credentials.branch) {
      headers["X-Branch"] = this.credentials.branch;
    }

    return headers;
  }

  /**
   * Direct fetch with long timeout for sync operations.
   */
  private async syncFetch(url: string, headers: Record<string, string>, opts?: { method?: string; body?: string }): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);

    try {
      return await fetch(url, {
        method: opts?.method ?? "GET",
        headers,
        body: opts?.body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Search: InterCars uses /inventory/stock for SKU-based lookups.
   */
  async search(params: SupplierSearchParams): Promise<SupplierProduct[]> {
    try {
      const sku = params.articleNo ?? params.query;
      if (!sku) return [];

      const headers = await this.authHeaders();

      const stockUrl = `${this.apiUrl}/inventory/stock?sku=${encodeURIComponent(sku)}`;
      const stockResponse = await this.fetchWithTimeout(stockUrl, { headers });

      if (!stockResponse.ok) {
        logger.warn({ status: stockResponse.status, supplier: this.code }, "InterCars stock lookup failed");
        return [];
      }

      const stockData = (await stockResponse.json()) as StockItem[] | { items?: StockItem[] };
      const items = Array.isArray(stockData) ? stockData : (stockData.items ?? []);

      if (items.length === 0) return [];

      // Deduplicate by SKU (stock API returns multiple warehouse entries)
      const skuMap = new Map<string, { item: StockItem; totalStock: number }>();
      for (const item of items) {
        const itemSku = item.sku ?? item.index ?? "";
        if (!itemSku) continue;
        const existing = skuMap.get(itemSku);
        if (existing) {
          existing.totalStock += item.availability ?? 0;
        } else {
          skuMap.set(itemSku, { item, totalStock: item.availability ?? 0 });
        }
      }

      // Fetch pricing via /pricing/quote for found SKUs
      const priceMap = new Map<string, { price: number; currency: string }>();
      const skuList = Array.from(skuMap.keys()).slice(0, 20);
      if (skuList.length > 0) {
        try {
          const priceUrl = `${this.apiUrl}/pricing/quote`;
          const priceResponse = await this.fetchWithTimeout(priceUrl, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ lines: skuList.map((s) => ({ sku: s, quantity: 1 })) }),
          });
          if (priceResponse.ok) {
            const priceData = (await priceResponse.json()) as { lines?: Array<{ sku: string; price?: { customerPriceNet?: number; listPriceNet?: number; currencyCode?: string } }> };
            for (const line of priceData.lines ?? []) {
              const p = line.price?.customerPriceNet ?? line.price?.listPriceNet;
              if (p != null) priceMap.set(line.sku, { price: p, currency: line.price?.currencyCode ?? "EUR" });
            }
          }
        } catch {
          // pricing is best-effort
        }
      }

      return Array.from(skuMap.values()).map(({ item, totalStock }) => {
        const itemSku = item.sku ?? item.index ?? "";
        const pricing = priceMap.get(itemSku);
        return {
          supplier: this.code,
          sku: itemSku,
          brand: item.brand ?? "",
          articleNo: item.articleNumber ?? itemSku,
          ean: item.ean ?? null,
          tecdocId: item.tecdoc ?? null,
          oem: null,
          description: item.description ?? "",
          price: pricing?.price ?? null,
          stock: totalStock,
          currency: pricing?.currency ?? "EUR",
        };
      });
    } catch (err) {
      logger.error({ err, supplier: this.code }, "InterCars search failed");
      return [];
    }
  }

  async getPrice(sku: string): Promise<{ price: number; currency: string } | null> {
    try {
      const headers = await this.authHeaders();
      const url = `${this.apiUrl}/pricing/quote`;
      const response = await this.fetchWithTimeout(url, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ lines: [{ sku, quantity: 1 }] }),
      });

      if (!response.ok) return null;

      const data = (await response.json()) as { lines?: Array<{ price?: { customerPriceNet?: number; listPriceNet?: number; currencyCode?: string } }> };
      const pricing = data.lines?.[0]?.price;
      const price = pricing?.customerPriceNet ?? pricing?.listPriceNet;
      if (price == null) return null;

      return { price, currency: pricing?.currencyCode ?? "EUR" };
    } catch (err) {
      logger.error({ err, supplier: this.code, sku }, "InterCars getPrice failed");
      return null;
    }
  }

  async getStock(sku: string): Promise<{ quantity: number; available: boolean } | null> {
    try {
      const headers = await this.authHeaders();
      const url = `${this.apiUrl}/inventory/stock?sku=${encodeURIComponent(sku)}`;

      const response = await this.fetchWithTimeout(url, { headers });

      if (!response.ok) return null;

      const data = (await response.json()) as StockItem[] | { items?: StockItem[] };
      const items = Array.isArray(data) ? data : (data.items ?? []);

      const item = items.find((i) => i.sku === sku || i.index === sku);
      const qty = item?.availability ?? 0;

      return { quantity: qty, available: qty > 0 };
    } catch (err) {
      logger.error({ err, supplier: this.code, sku }, "InterCars getStock failed");
      return null;
    }
  }

  /**
   * InterCars is a PRICING/STOCK enrichment source, not a product catalog.
   * Products come from TecDoc; IC provides prices and stock via CSV mapping.
   *
   * Flow:
   * 1. Match TecDoc products to IC CSV using 4 strategies:
   *    a. Already linked (icSku stored from previous run)
   *    b. Brand + article_number (flexible brand prefix matching)
   *    c. EAN code (exact match)
   *    d. TecDoc product ID (tecdoc_prod → tecdoc_id)
   * 2. Store matched icSku on product_maps for future fast lookup
   * 3. Fetch stock + pricing from IC API using TOW_KOD
   * 4. Directly UPDATE the TecDoc product_maps with price/stock
   */
  async *syncCatalog(_cursor?: string): AsyncGenerator<SupplierCatalogItem[], void, unknown> {
    try {
      const { prisma } = await import("../lib/prisma.js");

      // Check if mapping table has data
      let totalMappings = 0;
      try {
        const mappingCount = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*) as count FROM intercars_mappings`
        );
        totalMappings = Number(mappingCount[0]?.count ?? 0);
      } catch {
        logger.warn(
          { supplier: this.code },
          "intercars_mappings table not found. Run CSV import first."
        );
        return;
      }

      if (totalMappings === 0) {
        logger.warn(
          { supplier: this.code },
          "No InterCars CSV mappings found. Run: npx tsx src/scripts/import-intercars-csv.ts"
        );
        return;
      }

      logger.info(
        { supplier: this.code, totalMappings },
        "InterCars pricing enrichment starting"
      );

      // Test OAuth2 token first
      try {
        const testHeaders = await this.authHeaders();
        logger.info({ supplier: this.code, hasToken: !!testHeaders.Authorization }, "InterCars OAuth2 token acquired");
      } catch (authErr) {
        logger.error({ err: authErr, supplier: this.code }, "InterCars OAuth2 token FAILED - cannot proceed");
        return;
      }

      let totalUpdated = 0;
      let totalNewMatches = 0;
      let totalApiErrors = 0;

      // =========== PHASE 1: Match unlinked products (no icSku yet) ===========
      // Strategy A: Brand + article_number (existing logic, improved)
      logger.info({ supplier: this.code }, "Phase 1A: Matching by brand + article number...");
      const brandMatches = await prisma.$queryRawUnsafe<Array<{
        product_id: number;
        tow_kod: string;
        ic_ean: string | null;
        ic_weight: number | null;
      }>>(
        `SELECT DISTINCT ON (pm.id)
          pm.id as product_id,
          im.tow_kod,
          im.ean as ic_ean,
          im.weight as ic_weight
        FROM product_maps pm
        JOIN brands b ON b.id = pm.brand_id
        JOIN intercars_mappings im ON
          UPPER(regexp_replace(im.article_number, '[^a-zA-Z0-9]', '', 'g')) = UPPER(regexp_replace(pm.article_no, '[^a-zA-Z0-9]', '', 'g'))
          AND (
            UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) = UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))
            OR (
              LENGTH(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) >= 3
              AND UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))
                LIKE UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) || '%'
            )
            OR (
              LENGTH(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) >= 3
              AND UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g'))
                LIKE UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) || '%'
            )
          )
        WHERE pm.status = 'active' AND pm.ic_sku IS NULL
        ORDER BY pm.id`
      );

      if (brandMatches.length > 0) {
        logger.info({ supplier: this.code, count: brandMatches.length }, "Brand+article matches found, storing icSku");
        for (let i = 0; i < brandMatches.length; i += 500) {
          const batch = brandMatches.slice(i, i + 500);
          const cases = batch.map((m) => `WHEN ${m.product_id} THEN '${m.tow_kod.replace(/'/g, "''")}'`).join(" ");
          const eanCases = batch.map((m) => `WHEN ${m.product_id} THEN ${m.ic_ean ? `'${m.ic_ean.replace(/'/g, "''")}'` : "NULL"}`).join(" ");
          const weightCases = batch.map((m) => `WHEN ${m.product_id} THEN ${m.ic_weight ?? "NULL"}`).join(" ");
          const ids = batch.map((m) => m.product_id).join(",");
          await prisma.$executeRawUnsafe(
            `UPDATE product_maps SET
              ic_sku = CASE id ${cases} END,
              ic_matched_at = NOW(),
              ean = CASE id ${eanCases} ELSE ean END,
              weight = CASE id ${weightCases} ELSE weight END
            WHERE id IN (${ids})`
          );
        }
        totalNewMatches += brandMatches.length;
      }

      // Strategy B: EAN match (products without icSku that have an EAN matching IC CSV)
      logger.info({ supplier: this.code }, "Phase 1B: Matching by EAN...");
      const eanMatches = await prisma.$queryRawUnsafe<Array<{
        product_id: number;
        tow_kod: string;
        ic_ean: string | null;
        ic_weight: number | null;
      }>>(
        `SELECT DISTINCT ON (pm.id)
          pm.id as product_id,
          im.tow_kod,
          im.ean as ic_ean,
          im.weight as ic_weight
        FROM product_maps pm
        JOIN intercars_mappings im ON
          pm.ean IS NOT NULL
          AND im.ean IS NOT NULL
          AND LENGTH(pm.ean) >= 8
          AND UPPER(TRIM(pm.ean)) = UPPER(TRIM(im.ean))
        WHERE pm.status = 'active' AND pm.ic_sku IS NULL
        ORDER BY pm.id`
      );

      if (eanMatches.length > 0) {
        logger.info({ supplier: this.code, count: eanMatches.length }, "EAN matches found, storing icSku");
        for (let i = 0; i < eanMatches.length; i += 500) {
          const batch = eanMatches.slice(i, i + 500);
          const cases = batch.map((m) => `WHEN ${m.product_id} THEN '${m.tow_kod.replace(/'/g, "''")}'`).join(" ");
          const weightCases = batch.map((m) => `WHEN ${m.product_id} THEN ${m.ic_weight ?? "NULL"}`).join(" ");
          const ids = batch.map((m) => m.product_id).join(",");
          await prisma.$executeRawUnsafe(
            `UPDATE product_maps SET
              ic_sku = CASE id ${cases} END,
              ic_matched_at = NOW(),
              weight = CASE id ${weightCases} ELSE weight END
            WHERE id IN (${ids})`
          );
        }
        totalNewMatches += eanMatches.length;
      }

      // Strategy C: TecDoc product ID match
      logger.info({ supplier: this.code }, "Phase 1C: Matching by TecDoc product ID...");
      const tecdocMatches = await prisma.$queryRawUnsafe<Array<{
        product_id: number;
        tow_kod: string;
        ic_ean: string | null;
        ic_weight: number | null;
      }>>(
        `SELECT DISTINCT ON (pm.id)
          pm.id as product_id,
          im.tow_kod,
          im.ean as ic_ean,
          im.weight as ic_weight
        FROM product_maps pm
        JOIN intercars_mappings im ON
          pm.tecdoc_id IS NOT NULL
          AND im.tecdoc_prod IS NOT NULL
          AND CAST(pm.tecdoc_id AS TEXT) = CAST(im.tecdoc_prod AS TEXT)
        WHERE pm.status = 'active' AND pm.ic_sku IS NULL
        ORDER BY pm.id`
      );

      if (tecdocMatches.length > 0) {
        logger.info({ supplier: this.code, count: tecdocMatches.length }, "TecDoc ID matches found, storing icSku");
        for (let i = 0; i < tecdocMatches.length; i += 500) {
          const batch = tecdocMatches.slice(i, i + 500);
          const cases = batch.map((m) => `WHEN ${m.product_id} THEN '${m.tow_kod.replace(/'/g, "''")}'`).join(" ");
          const eanCases = batch.map((m) => `WHEN ${m.product_id} THEN ${m.ic_ean ? `'${m.ic_ean.replace(/'/g, "''")}'` : "NULL"}`).join(" ");
          const weightCases = batch.map((m) => `WHEN ${m.product_id} THEN ${m.ic_weight ?? "NULL"}`).join(" ");
          const ids = batch.map((m) => m.product_id).join(",");
          await prisma.$executeRawUnsafe(
            `UPDATE product_maps SET
              ic_sku = CASE id ${cases} END,
              ic_matched_at = NOW(),
              ean = CASE id ${eanCases} ELSE ean END,
              weight = CASE id ${weightCases} ELSE weight END
            WHERE id IN (${ids})`
          );
        }
        totalNewMatches += tecdocMatches.length;
      }

      // Strategy D: Article number only (no brand check, but only when article is unique in IC)
      logger.info({ supplier: this.code }, "Phase 1D: Matching by unique article number...");
      const articleOnlyMatches = await prisma.$queryRawUnsafe<Array<{
        product_id: number;
        tow_kod: string;
        ic_ean: string | null;
        ic_weight: number | null;
      }>>(
        `SELECT DISTINCT ON (pm.id)
          pm.id as product_id,
          im.tow_kod,
          im.ean as ic_ean,
          im.weight as ic_weight
        FROM product_maps pm
        JOIN intercars_mappings im ON
          UPPER(regexp_replace(im.article_number, '[^a-zA-Z0-9]', '', 'g')) = UPPER(regexp_replace(pm.article_no, '[^a-zA-Z0-9]', '', 'g'))
        WHERE pm.status = 'active' AND pm.ic_sku IS NULL
          AND (SELECT COUNT(*) FROM intercars_mappings im2
               WHERE UPPER(regexp_replace(im2.article_number, '[^a-zA-Z0-9]', '', 'g'))
                   = UPPER(regexp_replace(pm.article_no, '[^a-zA-Z0-9]', '', 'g'))) = 1
        ORDER BY pm.id
        LIMIT 100000`
      );

      if (articleOnlyMatches.length > 0) {
        logger.info({ supplier: this.code, count: articleOnlyMatches.length }, "Unique article matches found, storing icSku");
        for (let i = 0; i < articleOnlyMatches.length; i += 500) {
          const batch = articleOnlyMatches.slice(i, i + 500);
          const cases = batch.map((m) => `WHEN ${m.product_id} THEN '${m.tow_kod.replace(/'/g, "''")}'`).join(" ");
          const eanCases = batch.map((m) => `WHEN ${m.product_id} THEN ${m.ic_ean ? `'${m.ic_ean.replace(/'/g, "''")}'` : "NULL"}`).join(" ");
          const weightCases = batch.map((m) => `WHEN ${m.product_id} THEN ${m.ic_weight ?? "NULL"}`).join(" ");
          const ids = batch.map((m) => m.product_id).join(",");
          await prisma.$executeRawUnsafe(
            `UPDATE product_maps SET
              ic_sku = CASE id ${cases} END,
              ic_matched_at = NOW(),
              ean = CASE id ${eanCases} ELSE ean END,
              weight = CASE id ${weightCases} ELSE weight END
            WHERE id IN (${ids})`
          );
        }
        totalNewMatches += articleOnlyMatches.length;
      }

      logger.info(
        { supplier: this.code, totalNewMatches, brandMatches: brandMatches.length, eanMatches: eanMatches.length, tecdocMatches: tecdocMatches.length, articleOnlyMatches: articleOnlyMatches.length },
        "Phase 1 matching complete"
      );

      // =========== PHASE 2: Fetch prices/stock for ALL linked products ===========
      logger.info({ supplier: this.code }, "Phase 2: Fetching prices and stock for linked products...");

      const PAGE_SIZE = 500;
      let offset = 0;

      while (true) {
        const linkedProducts = await prisma.$queryRawUnsafe<Array<{
          product_id: number;
          ic_sku: string;
        }>>(
          `SELECT id as product_id, ic_sku
          FROM product_maps
          WHERE ic_sku IS NOT NULL AND status = 'active'
          ORDER BY id
          LIMIT ${PAGE_SIZE} OFFSET ${offset}`
        );

        if (linkedProducts.length === 0) break;
        offset += PAGE_SIZE;

        // Fetch prices/stock in batches of 20
        const BATCH_SIZE = 20;
        for (let i = 0; i < linkedProducts.length; i += BATCH_SIZE) {
          const batch = linkedProducts.slice(i, i + BATCH_SIZE);

          try {
            const quoteMap = await this.fetchQuoteBatch(batch.map((p) => p.ic_sku));

            for (const product of batch) {
              const quote = quoteMap.get(product.ic_sku);
              if (!quote) continue;

              try {
                await prisma.$executeRawUnsafe(
                  `UPDATE product_maps SET
                    price = COALESCE($1, price),
                    stock = $2,
                    currency = COALESCE($3, currency),
                    updated_at = NOW()
                  WHERE id = $4`,
                  quote.price,
                  quote.stock,
                  quote.currency,
                  product.product_id
                );
                totalUpdated++;
              } catch {
                // Skip individual update errors
              }
            }
          } catch (err) {
            totalApiErrors++;
            if (totalApiErrors <= 5) {
              logger.warn({ err, supplier: this.code }, "IC batch fetch failed");
            }
          }

          // Rate limit: 300ms between batch calls
          await new Promise((r) => setTimeout(r, 300));
        }

        logger.info(
          { supplier: this.code, updated: totalUpdated, apiErrors: totalApiErrors, offset },
          "Price/stock refresh progress"
        );
      }

      // Yield one empty batch so the sync worker knows we ran
      yield [];

      logger.info(
        { supplier: this.code, totalNewMatches, totalUpdated, totalApiErrors },
        "InterCars pricing enrichment completed"
      );
    } catch (err) {
      logger.error({ err, supplier: this.code }, "InterCars pricing enrichment failed");
    }
  }

  /**
   * Fetch price/stock for a batch of IC SKUs via /inventory/quote.
   */
  async fetchQuoteBatch(skus: string[]): Promise<Map<string, { price: number | null; currency: string; stock: number }>> {
    const quoteMap = new Map<string, { price: number | null; currency: string; stock: number }>();

    const headers = await this.authHeaders();
    const lines = skus.map((sku) => ({ sku, quantity: 1 }));
    const quoteUrl = `${this.apiUrl}/inventory/quote`;

    const quoteResp = await this.syncFetch(quoteUrl, {
      ...headers,
      "Content-Type": "application/json",
    }, {
      method: "POST",
      body: JSON.stringify({ lines }),
    });

    if (!quoteResp.ok) {
      if (quoteResp.status === 429) {
        // Rate limited — wait 30s and throw to retry
        await new Promise((r) => setTimeout(r, 30_000));
      }
      throw new Error(`IC inventory/quote returned ${quoteResp.status}`);
    }

    const quoteData = (await quoteResp.json()) as Array<{
      sku: string;
      quantity: number;
      price?: {
        currencyCode?: string;
        listPriceNet?: number;
        customerPriceNet?: number;
      };
      lines?: Array<{ availability?: number }>;
    }>;

    const quoteItems = Array.isArray(quoteData) ? quoteData : [];

    for (const item of quoteItems) {
      const sku = item.sku;
      const price = item.price?.customerPriceNet ?? item.price?.listPriceNet ?? null;
      const currency = item.price?.currencyCode ?? "EUR";
      const stock = item.lines?.reduce((sum, l) => sum + (l.availability ?? 0), 0) ?? 0;
      const existing = quoteMap.get(sku);
      if (existing) {
        existing.stock += stock;
        if (!existing.price && price) {
          existing.price = price;
          existing.currency = currency;
        }
      } else {
        quoteMap.set(sku, { price, currency, stock });
      }
    }

    return quoteMap;
  }
}

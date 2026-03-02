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
   * 1. Match TecDoc products to IC CSV (brand + article_number → TOW_KOD)
   *    - Brand matching is flexible: exact OR prefix match (handles "FEBI" ↔ "FEBI BILSTEIN")
   * 2. Fetch stock + pricing from IC API using TOW_KOD
   * 3. Directly UPDATE the TecDoc product_maps with price/stock (no duplicate records)
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

      const PAGE_SIZE = 500;
      let offset = 0;
      let totalUpdated = 0;
      let totalMatched = 0;
      let totalApiErrors = 0;

      while (true) {
        // Match TecDoc products → IC CSV mappings via normalized brand + article_number.
        // Brand matching: exact OR prefix (shorter name must be prefix of longer).
        // This handles: "FEBI" ↔ "FEBI BILSTEIN", "DT" ↔ "DT Spare Parts",
        //               "TRW" ↔ "TRW AUTOMOTIVE", "BOSCH" = "BOSCH" (exact)
        const matchedProducts = await prisma.$queryRawUnsafe<Array<{
          product_id: number;
          sku: string;
          article_no: string;
          brand_name: string;
          tow_kod: string;
          ic_description: string;
          ic_ean: string | null;
          ic_weight: number | null;
        }>>(
          `SELECT DISTINCT ON (pm.id)
            pm.id as product_id,
            pm.sku,
            pm.article_no,
            b.name as brand_name,
            im.tow_kod,
            im.description as ic_description,
            im.ean as ic_ean,
            im.weight as ic_weight
          FROM product_maps pm
          JOIN brands b ON b.id = pm.brand_id
          JOIN intercars_mappings im ON
            UPPER(regexp_replace(im.article_number, '[^a-zA-Z0-9]', '', 'g')) = UPPER(regexp_replace(pm.article_no, '[^a-zA-Z0-9]', '', 'g'))
            AND (
              -- Exact brand match
              UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) = UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))
              -- OR prefix match: IC brand is prefix of TecDoc brand (e.g. "FEBI" matches "FEBIBILSTEIN")
              OR (
                LENGTH(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) >= 3
                AND UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))
                  LIKE UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) || '%'
              )
              -- OR reverse prefix: TecDoc brand is prefix of IC brand (e.g. "TRW" matches "TRWAUTOMOTIVE")
              OR (
                LENGTH(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) >= 3
                AND UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g'))
                  LIKE UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) || '%'
              )
            )
          WHERE pm.status = 'active'
          ORDER BY pm.id
          LIMIT ${PAGE_SIZE} OFFSET ${offset}`
        );

        if (matchedProducts.length === 0) break;

        totalMatched += matchedProducts.length;
        offset += PAGE_SIZE;

        // Use /inventory/quote (POST) for combined stock + pricing per batch
        const BATCH_SIZE = 20;
        const retryTracker = new Map<string, number>();
        for (let i = 0; i < matchedProducts.length; i += BATCH_SIZE) {
          const batch = matchedProducts.slice(i, i + BATCH_SIZE);

          try {
            const headers = await this.authHeaders();

            // Build lines array for batch quote request
            const lines = batch.map((p) => ({ sku: p.tow_kod, quantity: 1 }));
            const quoteUrl = `${this.apiUrl}/inventory/quote`;
            const quoteResp = await this.syncFetch(quoteUrl, {
              ...headers,
              "Content-Type": "application/json",
            }, {
              method: "POST",
              body: JSON.stringify({ lines }),
            });

            if (quoteResp.ok) {
              const quoteData = (await quoteResp.json()) as Array<{
                sku: string;
                quantity: number;
                price?: {
                  currencyCode?: string;
                  listPriceNet?: number;
                  customerPriceNet?: number;
                  vatPercentage?: number;
                };
                lines?: Array<{ availability?: number }>;
              }>;

              const quoteItems = Array.isArray(quoteData) ? quoteData : [];

              // Build map of SKU -> price+stock
              const quoteMap = new Map<string, { price: number | null; currency: string; stock: number }>();
              for (const item of quoteItems) {
                const sku = item.sku;
                const price = item.price?.customerPriceNet ?? item.price?.listPriceNet ?? null;
                const currency = item.price?.currencyCode ?? "EUR";
                const stock = item.lines?.reduce((sum, l) => sum + (l.availability ?? 0), 0) ?? 0;
                const existing = quoteMap.get(sku);
                if (existing) {
                  // Aggregate stock from multiple warehouse entries
                  existing.stock += stock;
                  if (!existing.price && price) {
                    existing.price = price;
                    existing.currency = currency;
                  }
                } else {
                  quoteMap.set(sku, { price, currency, stock });
                }
              }

              // Update each matched product
              for (const product of batch) {
                const quote = quoteMap.get(product.tow_kod);
                if (!quote) continue;

                try {
                  await prisma.$executeRawUnsafe(
                    `UPDATE product_maps SET
                      price = COALESCE($1, price),
                      stock = $2,
                      currency = COALESCE($3, currency),
                      ean = COALESCE($4, ean),
                      updated_at = NOW()
                    WHERE id = $5`,
                    quote.price,
                    quote.stock,
                    quote.currency,
                    product.ic_ean,
                    product.product_id
                  );
                  totalUpdated++;
                } catch {
                  // Skip individual update errors
                }
              }
            } else if (quoteResp.status === 429) {
              // Rate limited — wait and retry (max 3 times per batch)
              totalApiErrors++;
              const retryKey = `retry_${i}`;
              const retryCount = (retryTracker.get(retryKey) ?? 0) + 1;
              retryTracker.set(retryKey, retryCount);

              if (retryCount <= 3) {
                const waitSec = retryCount * 30; // 30s, 60s, 90s
                logger.warn({ supplier: this.code, retryCount, waitSec }, "IC rate limited, backing off");
                await new Promise((r) => setTimeout(r, waitSec * 1000));
                i -= BATCH_SIZE; // Retry this batch
                continue;
              }

              logger.error({ supplier: this.code }, "IC rate limit retries exhausted for batch, skipping");
              retryTracker.delete(retryKey);
            } else {
              totalApiErrors++;
              if (totalApiErrors <= 5) {
                const body = await quoteResp.text().catch(() => "");
                logger.warn({ status: quoteResp.status, body: body.slice(0, 200) }, "IC inventory/quote API error");
              }
              // Fallback: try individual stock calls
              for (const product of batch) {
                try {
                  const stockUrl = `${this.apiUrl}/inventory/stock?sku=${encodeURIComponent(product.tow_kod)}`;
                  const stockResp = await this.syncFetch(stockUrl, headers);
                  if (stockResp.ok) {
                    const stockData = (await stockResp.json()) as StockItem[] | { items?: StockItem[] };
                    const stockItems = Array.isArray(stockData) ? stockData : (stockData.items ?? []);
                    const stockQty = stockItems.reduce((sum: number, s: StockItem) => sum + (s.availability ?? 0), 0);
                    await prisma.$executeRawUnsafe(
                      `UPDATE product_maps SET stock = $1, ean = COALESCE($2, ean), updated_at = NOW() WHERE id = $3`,
                      stockQty, product.ic_ean, product.product_id
                    );
                    totalUpdated++;
                  }
                  await new Promise((r) => setTimeout(r, 200));
                } catch {
                  // Skip
                }
              }
            }
          } catch (err) {
            logger.warn({ err, supplier: this.code }, "InterCars batch fetch failed");
          }

          // Rate limit: 300ms between batch calls
          await new Promise((r) => setTimeout(r, 300));
        }

        // Log progress
        logger.info(
          { supplier: this.code, matched: totalMatched, updated: totalUpdated, apiErrors: totalApiErrors, offset },
          "InterCars pricing enrichment progress"
        );
      }

      // Yield one empty batch so the sync worker knows we ran
      yield [];

      logger.info(
        { supplier: this.code, totalMatched, totalUpdated },
        "InterCars pricing enrichment completed"
      );
    } catch (err) {
      logger.error({ err, supplier: this.code }, "InterCars pricing enrichment failed");
    }
  }
}

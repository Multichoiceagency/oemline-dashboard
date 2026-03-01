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

      const priceMap = new Map<string, PricingItem>();
      for (const item of items.slice(0, 20)) {
        const itemSku = item.sku ?? item.index;
        if (!itemSku) continue;

        try {
          const priceUrl = `${this.apiUrl}/dropshipping/pricing/quote?sku=${encodeURIComponent(itemSku)}&quantity=1`;
          const priceResponse = await this.fetchWithTimeout(priceUrl, { headers });

          if (priceResponse.ok) {
            const priceData = (await priceResponse.json()) as PricingItem | PricingItem[];
            const pricing = Array.isArray(priceData) ? priceData[0] : priceData;
            if (pricing) priceMap.set(itemSku, pricing);
          }
        } catch {
          // pricing lookup is best-effort
        }
      }

      return items.map((item) => {
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
          price: pricing?.customerPrice ?? pricing?.listPriceNet ?? null,
          stock: item.availability ?? null,
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
      const url = `${this.apiUrl}/dropshipping/pricing/quote?sku=${encodeURIComponent(sku)}&quantity=1`;

      const response = await this.fetchWithTimeout(url, { headers });

      if (!response.ok) return null;

      const data = (await response.json()) as PricingItem | PricingItem[];
      const pricing = Array.isArray(data) ? data[0] : data;

      const price = pricing?.customerPrice ?? pricing?.listPriceNet;
      if (price == null) return null;

      return { price, currency: pricing?.currency ?? "EUR" };
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
   * InterCars sync: uses CSV mapping table to match products to IC SKUs (TOW_KOD),
   * then fetches pricing and stock for matched products.
   *
   * Mapping: brand + article_number -> TOW_KOD
   * Pricing: GET /dropshipping/pricing/quote?sku=TOW_KOD&quantity=1
   * Stock:   GET /inventory/stock?sku=TOW_KOD
   *
   * Strategy:
   * 1. Load products from DB that need pricing
   * 2. Look up IC TOW_KOD via intercars_mappings table (brand + article_no)
   * 3. Batch fetch stock and pricing using TOW_KOD
   * 4. Yield updated items with price/stock data
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
        "InterCars pricing sync starting with CSV mapping"
      );

      const PAGE_SIZE = 500;
      let offset = 0;
      let totalUpdated = 0;
      let totalMatched = 0;

      while (true) {
        // Find products matched to IC via brand + article_number
        // Normalization: strip ALL non-alphanumeric chars (spaces, dashes, dots, slashes, underscores) + uppercase
        // Handles: "0 986 478 684" = "0986478684", "10.0341-0113" = "10034101134", "ATE/UAT" = "ATEUAT"
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
          `SELECT
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
            UPPER(regexp_replace(im.manufacturer, '[^a-zA-Z0-9]', '', 'g')) = UPPER(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g'))
            AND UPPER(regexp_replace(im.article_number, '[^a-zA-Z0-9]', '', 'g')) = UPPER(regexp_replace(pm.article_no, '[^a-zA-Z0-9]', '', 'g'))
          WHERE pm.status = 'active'
          ORDER BY pm.id
          LIMIT ${PAGE_SIZE} OFFSET ${offset}`
        );

        if (matchedProducts.length === 0) break;

        totalMatched += matchedProducts.length;
        offset += PAGE_SIZE;

        // Batch fetch stock and pricing for matched TOW_KODs
        const BATCH_SIZE = 30;
        for (let i = 0; i < matchedProducts.length; i += BATCH_SIZE) {
          const batch = matchedProducts.slice(i, i + BATCH_SIZE);
          const items: SupplierCatalogItem[] = [];

          try {
            const headers = await this.authHeaders();

            for (const product of batch) {
              try {
                let stockQty: number | null = null;
                let price: number | null = null;
                let currency = "EUR";

                // Fetch stock
                const stockUrl = `${this.apiUrl}/inventory/stock?sku=${encodeURIComponent(product.tow_kod)}`;
                const stockResp = await this.syncFetch(stockUrl, headers);

                if (stockResp.ok) {
                  const stockData = (await stockResp.json()) as StockItem[] | { items?: StockItem[] };
                  const stockItems = Array.isArray(stockData) ? stockData : (stockData.items ?? []);
                  stockQty = stockItems.reduce((sum: number, s: StockItem) => sum + (s.availability ?? 0), 0);
                }

                // Fetch pricing
                try {
                  const priceUrl = `${this.apiUrl}/dropshipping/pricing/quote?sku=${encodeURIComponent(product.tow_kod)}&quantity=1`;
                  const priceResp = await this.syncFetch(priceUrl, headers);

                  if (priceResp.ok) {
                    const priceData = (await priceResp.json()) as PricingItem | PricingItem[];
                    const pricing = Array.isArray(priceData) ? priceData[0] : priceData;
                    price = pricing?.customerPrice ?? pricing?.listPriceNet ?? null;
                    currency = pricing?.currency ?? "EUR";
                  }
                } catch {
                  // pricing is best-effort
                }

                items.push({
                  sku: product.sku,
                  brand: product.brand_name,
                  articleNo: product.article_no,
                  ean: product.ic_ean,
                  tecdocId: null,
                  oem: null,
                  description: product.ic_description || "",
                  weight: product.ic_weight,
                  price,
                  currency,
                  stock: stockQty,
                });
              } catch {
                // Skip individual item errors
              }

              // Rate limit between API calls
              await new Promise((r) => setTimeout(r, 50));
            }

            if (items.length > 0) {
              yield items;
              totalUpdated += items.length;
            }
          } catch (err) {
            logger.warn({ err, supplier: this.code }, "InterCars batch fetch failed");
          }
        }

        // Log progress
        if (totalMatched % 500 === 0 || matchedProducts.length < PAGE_SIZE) {
          logger.info(
            { supplier: this.code, matched: totalMatched, updated: totalUpdated, offset },
            "InterCars pricing sync progress"
          );
        }
      }

      logger.info(
        { supplier: this.code, totalMatched, totalUpdated },
        "InterCars pricing sync completed"
      );
    } catch (err) {
      logger.error({ err, supplier: this.code }, "InterCars pricing sync failed");
    }
  }
}

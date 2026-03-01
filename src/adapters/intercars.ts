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

interface CatalogCategory {
  id?: string;
  name?: string;
  children?: CatalogCategory[];
}

interface CatalogProduct {
  sku?: string;
  index?: string;
  brand?: string;
  articleNumber?: string;
  tecdoc?: string;
  tecdocProd?: number;
  description?: string;
  ean?: string;
  blockedReturn?: boolean;
}

export class IntercarsAdapter extends BaseSupplierAdapter {
  readonly name = "InterCars";
  readonly code = "intercars";

  private credentials: InterCarsCredentials;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(apiUrl: string, apiKey: string, timeout = 30000) {
    super(apiUrl, apiKey, timeout);

    // apiKey is a JSON string of InterCars credentials
    let creds: Partial<InterCarsCredentials> = {};
    try {
      creds = JSON.parse(apiKey);
    } catch {
      // Fallback: apiKey is the client_secret
    }

    // Also check env vars as fallback
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

    // Add InterCars-specific headers
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
   * Direct fetch with long timeout for sync operations (bypasses circuit breaker).
   */
  private async syncFetch(url: string, headers: Record<string, string>, opts?: { method?: string; body?: string }): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000); // 60s for sync ops

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
   * InterCars "sync" fetches pricing and stock for products already in our DB.
   *
   * InterCars is NOT a catalog source — TecDoc provides the catalog.
   * InterCars provides pricing and stock for products we can map to IC SKUs.
   *
   * Strategy:
   * 1. Load products from DB that have article numbers
   * 2. Use inventory/quote to get pricing and stock in batches of 30
   * 3. Yield updated items with price/stock data
   */
  async *syncCatalog(_cursor?: string): AsyncGenerator<SupplierCatalogItem[], void, unknown> {
    try {
      const { prisma } = await import("../lib/prisma.js");

      // Get products from DB that need pricing (all active products)
      const products = await prisma.productMap.findMany({
        where: { status: "active" },
        select: { sku: true, articleNo: true, ean: true, brand: { select: { name: true } } },
        take: 10000,
        orderBy: { updatedAt: "asc" },
      });

      logger.info(
        { supplier: this.code, productCount: products.length },
        "InterCars pricing sync starting"
      );

      if (products.length === 0) return;

      const BATCH_SIZE = 30; // InterCars API limit per request
      let totalUpdated = 0;
      let batchNum = 0;

      for (let i = 0; i < products.length; i += BATCH_SIZE) {
        const batch = products.slice(i, i + BATCH_SIZE);
        batchNum++;

        try {
          const headers = await this.authHeaders();
          headers["Content-Type"] = "application/json";

          // Build quote request using article numbers as SKUs
          const lines = batch
            .filter((p) => p.articleNo)
            .map((p) => ({ sku: p.articleNo, quantity: 1 }));

          if (lines.length === 0) continue;

          const quoteUrl = `${this.apiUrl}/inventory/quote`;
          const response = await this.syncFetch(quoteUrl, headers, {
            method: "POST",
            body: JSON.stringify({ lines }),
          });

          if (!response.ok) {
            if (response.status === 401) {
              this.accessToken = null;
              // Retry once with new token
              const newHeaders = await this.authHeaders();
              newHeaders["Content-Type"] = "application/json";
              const retry = await this.syncFetch(quoteUrl, newHeaders, {
                method: "POST",
                body: JSON.stringify({ lines }),
              });
              if (!retry.ok) continue;
              const retryData = await retry.json();
              const retryItems = this.processQuoteResponse(retryData, batch);
              if (retryItems.length > 0) {
                yield retryItems;
                totalUpdated += retryItems.length;
              }
              continue;
            }
            continue;
          }

          const data = await response.json();
          const items = this.processQuoteResponse(data, batch);

          if (items.length > 0) {
            yield items;
            totalUpdated += items.length;
          }

          // Log progress every 10 batches
          if (batchNum % 10 === 0) {
            logger.info(
              { supplier: this.code, batch: batchNum, totalBatches: Math.ceil(products.length / BATCH_SIZE), totalUpdated },
              "InterCars pricing sync progress"
            );
          }

          await new Promise((r) => setTimeout(r, 100));
        } catch (err) {
          logger.warn({ err, supplier: this.code, batch: batchNum }, "InterCars quote batch failed");
        }
      }

      logger.info({ supplier: this.code, totalUpdated }, "InterCars pricing sync completed");
    } catch (err) {
      logger.error({ err, supplier: this.code }, "InterCars pricing sync failed");
    }
  }

  private processQuoteResponse(
    data: unknown,
    batch: Array<{ sku: string; articleNo: string; ean: string | null; brand: { name: string } | null }>
  ): SupplierCatalogItem[] {
    const items: SupplierCatalogItem[] = [];
    const responseItems = Array.isArray(data) ? data : ((data as Record<string, unknown>)?.lines ?? (data as Record<string, unknown>)?.items ?? []) as Array<{
      sku?: string;
      price?: { listPriceNet?: number; customerPriceNet?: number; currencyCode?: string };
      lines?: Array<{ availability?: number }>;
      name?: string;
      description?: string;
      eans?: string[];
    }>;

    for (const item of responseItems) {
      if (!item.sku) continue;
      const original = batch.find((b) => b.articleNo === item.sku);
      if (!original) continue;

      const price = item.price?.customerPriceNet ?? item.price?.listPriceNet ?? null;
      const _stock = item.lines?.reduce((sum: number, l: { availability?: number }) => sum + (l.availability ?? 0), 0) ?? null;

      items.push({
        sku: original.sku,
        brand: original.brand?.name ?? "",
        articleNo: original.articleNo,
        ean: original.ean ?? (item.eans?.[0] ?? null),
        tecdocId: null,
        oem: null,
        description: item.name ?? item.description ?? "",
      });
    }

    return items;
  }

}

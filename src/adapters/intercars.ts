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
  private async syncFetch(url: string, headers: Record<string, string>): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000); // 60s for sync ops

    try {
      return await fetch(url, { headers, signal: controller.signal });
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
   * Catalog sync: browse category tree, then fetch products per category.
   * Uses long timeout and direct fetch (bypasses circuit breaker).
   */
  async *syncCatalog(cursor?: string): AsyncGenerator<SupplierCatalogItem[], void, unknown> {
    try {
      const headers = await this.authHeaders();

      // Get all top-level categories
      const catUrl = `${this.apiUrl}/catalog/category`;
      logger.info({ supplier: this.code, url: catUrl }, "Fetching InterCars catalog categories");

      const catResponse = await this.syncFetch(catUrl, headers);

      if (!catResponse.ok) {
        const text = await catResponse.text().catch(() => "");
        logger.error(
          { status: catResponse.status, supplier: this.code, body: text.slice(0, 500) },
          "InterCars catalog/category failed"
        );
        return;
      }

      const categoriesRaw = await catResponse.json();
      const categories = (Array.isArray(categoriesRaw) ? categoriesRaw : (categoriesRaw as { categories?: CatalogCategory[] }).categories ?? []) as CatalogCategory[];

      // Flatten category tree to get all category IDs (both parents and leaves)
      const categoryIds = this.flattenCategories(categories);

      logger.info(
        { supplier: this.code, categoryCount: categoryIds.length },
        "InterCars catalog categories loaded"
      );

      if (categoryIds.length === 0) {
        logger.warn({ supplier: this.code }, "InterCars returned 0 categories");
        return;
      }

      let startIdx = cursor ? parseInt(cursor, 10) : 0;
      if (isNaN(startIdx)) startIdx = 0;

      let totalProducts = 0;

      for (let i = startIdx; i < categoryIds.length; i++) {
        const categoryId = categoryIds[i];
        let pageNumber = 0;
        const pageSize = 50;

        while (true) {
          try {
            const prodUrl = `${this.apiUrl}/catalog/products?categoryId=${encodeURIComponent(categoryId)}&pageNumber=${pageNumber}&pageSize=${pageSize}`;
            const prodResponse = await this.syncFetch(prodUrl, headers);

            if (!prodResponse.ok) {
              if (prodResponse.status === 401) {
                // Token expired, refresh
                this.accessToken = null;
                const newHeaders = await this.authHeaders();
                Object.assign(headers, newHeaders);
                continue; // retry with new token
              }
              break;
            }

            const prodData = (await prodResponse.json()) as {
              products?: CatalogProduct[];
              items?: CatalogProduct[];
              totalPages?: number;
            };

            const products = prodData.products ?? prodData.items ?? [];
            if (products.length === 0) break;

            const items: SupplierCatalogItem[] = products.map((p) => ({
              sku: p.sku ?? p.index ?? p.articleNumber ?? "",
              brand: p.brand ?? "",
              articleNo: p.articleNumber ?? "",
              ean: p.ean ?? null,
              tecdocId: p.tecdoc ?? null,
              oem: null,
              description: p.description ?? "",
            }));

            yield items;
            totalProducts += items.length;

            if (products.length < pageSize) break;
            if (prodData.totalPages != null && pageNumber >= prodData.totalPages - 1) break;

            pageNumber++;

            // Small delay to avoid rate limiting
            await new Promise((r) => setTimeout(r, 100));
          } catch (err) {
            logger.error({ err, supplier: this.code, categoryId, pageNumber }, "InterCars catalog page failed");
            break;
          }
        }

        // Log progress every 20 categories
        if (i % 20 === 0 || i === categoryIds.length - 1) {
          logger.info(
            { supplier: this.code, categoryIndex: i, totalCategories: categoryIds.length, totalProducts },
            "InterCars sync progress"
          );
        }
      }

      logger.info({ supplier: this.code, totalProducts }, "InterCars catalog sync completed");
    } catch (err) {
      logger.error({ err, supplier: this.code }, "InterCars catalog sync failed");
    }
  }

  private flattenCategories(categories: CatalogCategory[]): string[] {
    const ids: string[] = [];

    for (const cat of categories) {
      if (cat.id) {
        // Add all categories, not just leaves
        ids.push(cat.id);
        if (cat.children && cat.children.length > 0) {
          ids.push(...this.flattenCategories(cat.children));
        }
      }
    }

    return ids;
  }
}

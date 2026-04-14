import { BaseSupplierAdapter } from "./base.js";
import type {
  SupplierSearchParams,
  SupplierProduct,
  SupplierCatalogItem,
} from "../types/index.js";
import { logger } from "../lib/logger.js";

/**
 * Van Wezel Autoparts REST adapter.
 *
 * Credentials (stored in supplier.credentials): "username:password"
 *   Example: "57206:2514"
 *
 * API endpoint: https://vwa.autopartscat.com/WcfVWAService/WcfVWAService/VWAService.svc
 *
 * Auth flow:
 *   1. POST /Login with service Basic auth + customer credentials in body → JWT token
 *   2. Token is valid 1 day; cached for 20 hours
 *   3. All subsequent calls use JWT in Authorization header
 *
 * Supported operations:
 *   - getstock?productid=xxx → returns ArticleId, Qty, Price, Success
 *   - fetchQuoteBatch: parallel getstock calls (10 concurrent)
 */
export class VanWezelAdapter extends BaseSupplierAdapter {
  readonly name = "Van Wezel";
  readonly code = "vanwezel";

  private readonly customerUsername: string;
  private readonly customerPassword: string;

  private cachedToken: string | null = null;
  private tokenExpiry = 0;

  // Service-level Basic auth — fixed per VWA docs
  private static readonly SERVICE_AUTH =
    "Basic " + Buffer.from("WebSVWA:VanWezelAutoparts2024WS").toString("base64");

  private static readonly CONCURRENCY = 10;

  constructor(apiUrl: string, credentials: string, timeout = 15_000) {
    super(apiUrl, credentials, timeout);
    const colonIdx = credentials.indexOf(":");
    if (colonIdx > 0) {
      this.customerUsername = credentials.slice(0, colonIdx);
      this.customerPassword = credentials.slice(colonIdx + 1);
    } else {
      this.customerUsername = credentials;
      this.customerPassword = "";
    }
  }

  private async getToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiry) {
      return this.cachedToken;
    }

    const url = `${this.apiUrl}/Login`;
    const response = await this.fetchWithTimeout(url, {
      method: "POST",
      headers: {
        Authorization: VanWezelAdapter.SERVICE_AUTH,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ usname: this.customerUsername, pwd: this.customerPassword }),
    });

    if (!response.ok) {
      throw new Error(`Van Wezel login failed: ${response.status}`);
    }

    const text = await response.text();
    let token: string;
    try {
      const json = JSON.parse(text);
      token = typeof json === "string" ? json : (json.token ?? json.Token ?? text);
    } catch {
      // Raw string response — strip wrapping quotes if present
      token = text.trim().replace(/^"|"$/g, "");
    }

    if (!token) throw new Error("Van Wezel login returned empty token");

    this.cachedToken = token;
    this.tokenExpiry = Date.now() + 20 * 60 * 60 * 1000; // 20h (token valid 24h)

    logger.info({ supplier: this.code }, "Van Wezel token refreshed");
    return token;
  }

  private async fetchSingleStock(
    sku: string,
    token: string
  ): Promise<{ price: number | null; stock: number } | null> {
    const url = `${this.apiUrl}/getstock?productid=${encodeURIComponent(sku)}`;
    let response: Response;
    try {
      response = await this.fetchWithTimeout(url, {
        headers: {
          Authorization: token,
          Accept: "application/json",
        },
      });
    } catch {
      return null;
    }

    if (!response.ok) return null;

    // VWA API returns flat JSON (no wrapper): {"product-id":"...","amount":"0","price":"73,95","success":1}
    // Price uses European comma format (e.g. "73,95" not "73.95")
    const data = (await response.json()) as Record<string, unknown>;

    // Handle both wrapped (legacy {Stock:{...}}) and flat response formats
    const s = (data?.Stock ?? data) as Record<string, unknown>;
    if (!s) return null;

    const success = String(s.Success ?? s.success ?? s["success"] ?? "0");
    const rawQty = s.Qty ?? s.amount ?? s["amount"] ?? 0;
    const qty = typeof rawQty === "string" ? parseInt(rawQty, 10) : (Number(rawQty) || 0);

    const rawPrice = s.Price ?? s.price ?? s["price"] ?? null;
    let priceNum: number | null = null;
    if (rawPrice != null) {
      // European comma format: "73,95" → 73.95
      const priceStr = String(rawPrice).replace(",", ".");
      priceNum = parseFloat(priceStr);
      if (!Number.isFinite(priceNum) || priceNum <= 0) priceNum = null;
    }
    const price = priceNum != null ? Math.round(priceNum * 100) / 100 : null;

    // Return price+stock even when out of stock — VWA always returns price for valid articles.
    // Only return null for truly unknown articles (success=0 AND no price).
    if (success === "0" && !price) return null;
    return { price, stock: Math.max(0, qty) };
  }

  /**
   * Fetch stock + price for a batch of VWA article numbers.
   * Calls getstock per SKU in parallel (max 10 concurrent).
   */
  async fetchQuoteBatch(
    skus: string[]
  ): Promise<Map<string, { price: number | null; currency: string; stock: number }>> {
    const result = new Map<string, { price: number | null; currency: string; stock: number }>();
    if (skus.length === 0) return result;

    const token = await this.getToken();

    for (let i = 0; i < skus.length; i += VanWezelAdapter.CONCURRENCY) {
      const chunk = skus.slice(i, i + VanWezelAdapter.CONCURRENCY);
      const responses = await Promise.allSettled(
        chunk.map((sku) => this.fetchSingleStock(sku, token))
      );

      for (let j = 0; j < chunk.length; j++) {
        const r = responses[j];
        if (r.status === "fulfilled" && r.value !== null) {
          result.set(chunk[j], { ...r.value, currency: "EUR" });
        }
      }

      if (i + VanWezelAdapter.CONCURRENCY < skus.length) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    return result;
  }

  async getStock(sku: string): Promise<{ quantity: number; available: boolean } | null> {
    try {
      const token = await this.getToken();
      const data = await this.fetchSingleStock(sku, token);
      if (!data) return null;
      return { quantity: data.stock, available: data.stock > 0 };
    } catch (err) {
      logger.error({ err, supplier: this.code, sku }, "Van Wezel getStock failed");
      return null;
    }
  }

  async getPrice(sku: string): Promise<{ price: number; currency: string } | null> {
    try {
      const token = await this.getToken();
      const data = await this.fetchSingleStock(sku, token);
      if (!data?.price) return null;
      return { price: data.price, currency: "EUR" };
    } catch (err) {
      logger.error({ err, supplier: this.code, sku }, "Van Wezel getPrice failed");
      return null;
    }
  }

  async search(_params: SupplierSearchParams): Promise<SupplierProduct[]> {
    return [];
  }

  // eslint-disable-next-line require-yield
  async *syncCatalog(
    _cursor?: string
  ): AsyncGenerator<SupplierCatalogItem[], void, unknown> {
    // VWA catalog imported from separate FTP/catalog file
  }
}

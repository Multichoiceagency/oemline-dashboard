import { BaseSupplierAdapter } from "./base.js";
import type {
  SupplierSearchParams,
  SupplierProduct,
  SupplierCatalogItem,
} from "../types/index.js";
import { logger } from "../lib/logger.js";

export class PartsPointAdapter extends BaseSupplierAdapter {
  readonly name = "PartsPoint";
  readonly code = "partspoint";

  async search(params: SupplierSearchParams): Promise<SupplierProduct[]> {
    try {
      const body: Record<string, unknown> = {};
      if (params.query) body.search = params.query;
      if (params.brand) body.brand = params.brand;
      if (params.articleNo) body.partNumber = params.articleNo;
      if (params.ean) body.ean = params.ean;
      if (params.limit) body.maxResults = params.limit;

      const url = `${this.apiUrl}/api/v2/parts/search`;
      const response = await this.fetchWithTimeout(url, {
        method: "POST",
        headers: {
          "X-Api-Key": this.apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        logger.warn({ status: response.status, supplier: this.code }, "PartsPoint API error");
        return [];
      }

      const data = (await response.json()) as {
        results?: Array<{
          partNumber?: string;
          brandName?: string;
          articleRef?: string;
          eanCode?: string;
          tecdocRef?: string;
          oemRef?: string;
          title?: string;
          netPrice?: number;
          stockQty?: number;
          currency?: string;
        }>;
      };

      return (data.results ?? []).map((item) => ({
        supplier: this.code,
        sku: item.partNumber ?? "",
        brand: item.brandName ?? "",
        articleNo: item.articleRef ?? "",
        ean: item.eanCode ?? null,
        tecdocId: item.tecdocRef ?? null,
        oem: item.oemRef ?? null,
        description: item.title ?? "",
        price: item.netPrice ?? null,
        stock: item.stockQty ?? null,
        currency: item.currency ?? "EUR",
      }));
    } catch (err) {
      logger.error({ err, supplier: this.code }, "PartsPoint search failed");
      return [];
    }
  }

  async getPrice(sku: string): Promise<{ price: number; currency: string } | null> {
    try {
      const url = `${this.apiUrl}/api/v2/parts/${encodeURIComponent(sku)}/price`;
      const response = await this.fetchWithTimeout(url, {
        headers: {
          "X-Api-Key": this.apiKey,
          Accept: "application/json",
        },
      });

      if (!response.ok) return null;

      const data = (await response.json()) as { netPrice?: number; currency?: string };
      if (data.netPrice == null) return null;

      return { price: data.netPrice, currency: data.currency ?? "EUR" };
    } catch (err) {
      logger.error({ err, supplier: this.code, sku }, "PartsPoint getPrice failed");
      return null;
    }
  }

  async getStock(sku: string): Promise<{ quantity: number; available: boolean } | null> {
    try {
      const url = `${this.apiUrl}/api/v2/parts/${encodeURIComponent(sku)}/availability`;
      const response = await this.fetchWithTimeout(url, {
        headers: {
          "X-Api-Key": this.apiKey,
          Accept: "application/json",
        },
      });

      if (!response.ok) return null;

      const data = (await response.json()) as { stockQty?: number; inStock?: boolean };
      if (data.stockQty == null) return null;

      return { quantity: data.stockQty, available: data.inStock ?? data.stockQty > 0 };
    } catch (err) {
      logger.error({ err, supplier: this.code, sku }, "PartsPoint getStock failed");
      return null;
    }
  }

  async *syncCatalog(cursor?: string): AsyncGenerator<SupplierCatalogItem[], void, unknown> {
    let offset = cursor ? parseInt(cursor, 10) : 0;
    const limit = 500;

    while (true) {
      try {
        const url = `${this.apiUrl}/api/v2/catalog/export?offset=${offset}&limit=${limit}`;
        const response = await this.fetchWithTimeout(url, {
          headers: {
            "X-Api-Key": this.apiKey,
            Accept: "application/json",
          },
        });

        if (!response.ok) break;

        const data = (await response.json()) as {
          parts?: Array<{
            partNumber?: string;
            brandName?: string;
            articleRef?: string;
            eanCode?: string;
            tecdocRef?: string;
            oemRef?: string;
            title?: string;
          }>;
          total?: number;
        };

        const items = (data.parts ?? []).map((item) => ({
          sku: item.partNumber ?? "",
          brand: item.brandName ?? "",
          articleNo: item.articleRef ?? "",
          ean: item.eanCode ?? null,
          tecdocId: item.tecdocRef ?? null,
          oem: item.oemRef ?? null,
          description: item.title ?? "",
        }));

        if (items.length === 0) break;

        yield items;

        offset += limit;
        if (data.total != null && offset >= data.total) break;
      } catch (err) {
        logger.error({ err, supplier: this.code, offset }, "PartsPoint catalog sync failed");
        break;
      }
    }
  }
}

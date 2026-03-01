import { BaseSupplierAdapter } from "./base.js";
import type {
  SupplierSearchParams,
  SupplierProduct,
  SupplierCatalogItem,
} from "../types/index.js";
import { logger } from "../lib/logger.js";

export class IntercarsAdapter extends BaseSupplierAdapter {
  readonly name = "InterCars";
  readonly code = "intercars";

  async search(params: SupplierSearchParams): Promise<SupplierProduct[]> {
    try {
      const queryParts: string[] = [];
      if (params.query) queryParts.push(`q=${encodeURIComponent(params.query)}`);
      if (params.brand) queryParts.push(`brand=${encodeURIComponent(params.brand)}`);
      if (params.articleNo) queryParts.push(`articleNo=${encodeURIComponent(params.articleNo)}`);
      if (params.ean) queryParts.push(`ean=${encodeURIComponent(params.ean)}`);
      if (params.limit) queryParts.push(`limit=${params.limit}`);

      const url = `${this.apiUrl}/v1/products/search?${queryParts.join("&")}`;

      const response = await this.fetchWithTimeout(url, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        logger.warn({ status: response.status, supplier: this.code }, "InterCars API error");
        return [];
      }

      const data = (await response.json()) as {
        items?: Array<{
          sku?: string;
          brand?: string;
          articleNumber?: string;
          ean?: string;
          tecdocId?: string;
          oemNumber?: string;
          description?: string;
          price?: number;
          stock?: number;
          currency?: string;
        }>;
      };

      return (data.items ?? []).map((item) => ({
        supplier: this.code,
        sku: item.sku ?? "",
        brand: item.brand ?? "",
        articleNo: item.articleNumber ?? "",
        ean: item.ean ?? null,
        tecdocId: item.tecdocId ?? null,
        oem: item.oemNumber ?? null,
        description: item.description ?? "",
        price: item.price ?? null,
        stock: item.stock ?? null,
        currency: item.currency ?? "EUR",
      }));
    } catch (err) {
      logger.error({ err, supplier: this.code }, "InterCars search failed");
      return [];
    }
  }

  async getPrice(sku: string): Promise<{ price: number; currency: string } | null> {
    try {
      const url = `${this.apiUrl}/v1/products/${encodeURIComponent(sku)}/price`;
      const response = await this.fetchWithTimeout(url, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
        },
      });

      if (!response.ok) return null;

      const data = (await response.json()) as { price?: number; currency?: string };
      if (data.price == null) return null;

      return { price: data.price, currency: data.currency ?? "EUR" };
    } catch (err) {
      logger.error({ err, supplier: this.code, sku }, "InterCars getPrice failed");
      return null;
    }
  }

  async getStock(sku: string): Promise<{ quantity: number; available: boolean } | null> {
    try {
      const url = `${this.apiUrl}/v1/products/${encodeURIComponent(sku)}/stock`;
      const response = await this.fetchWithTimeout(url, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
        },
      });

      if (!response.ok) return null;

      const data = (await response.json()) as { quantity?: number; available?: boolean };
      if (data.quantity == null) return null;

      return { quantity: data.quantity, available: data.available ?? data.quantity > 0 };
    } catch (err) {
      logger.error({ err, supplier: this.code, sku }, "InterCars getStock failed");
      return null;
    }
  }

  async *syncCatalog(cursor?: string): AsyncGenerator<SupplierCatalogItem[], void, unknown> {
    let page = cursor ? parseInt(cursor, 10) : 1;
    const pageSize = 500;

    while (true) {
      try {
        const url = `${this.apiUrl}/v1/catalog?page=${page}&size=${pageSize}`;
        const response = await this.fetchWithTimeout(url, {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: "application/json",
          },
        });

        if (!response.ok) break;

        const data = (await response.json()) as {
          items?: Array<{
            sku?: string;
            brand?: string;
            articleNumber?: string;
            ean?: string;
            tecdocId?: string;
            oemNumber?: string;
            description?: string;
          }>;
          hasMore?: boolean;
        };

        const items = (data.items ?? []).map((item) => ({
          sku: item.sku ?? "",
          brand: item.brand ?? "",
          articleNo: item.articleNumber ?? "",
          ean: item.ean ?? null,
          tecdocId: item.tecdocId ?? null,
          oem: item.oemNumber ?? null,
          description: item.description ?? "",
        }));

        if (items.length === 0) break;

        yield items;

        if (!data.hasMore) break;
        page++;
      } catch (err) {
        logger.error({ err, supplier: this.code, page }, "InterCars catalog sync failed");
        break;
      }
    }
  }
}

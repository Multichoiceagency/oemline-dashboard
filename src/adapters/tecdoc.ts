import { BaseSupplierAdapter } from "./base.js";
import type {
  SupplierSearchParams,
  SupplierProduct,
  SupplierCatalogItem,
} from "../types/index.js";
import { logger } from "../lib/logger.js";

interface TecDocCredentials {
  apiKey: string;
  providerId?: number;
  articleCountry?: string;
}

const DEFAULT_PROVIDER_ID = 22691;
const DEFAULT_ARTICLE_COUNTRY = "NL";

interface DirectSearchItem {
  articleId?: number;
  articleName?: string;
  articleNo?: string;
  articleSearchNo?: string;
  brandName?: string;
  brandNo?: number;
  numberType?: number;
}

interface DirectSearchResponse {
  data?: { array?: DirectSearchItem[] };
  totalMatchingArticles?: number;
  status?: number;
}

interface GetArticlesResponse {
  articles?: Array<{
    dataSupplierId?: number;
    articleNumber?: string;
    mfrName?: string;
    mfrId?: number;
    genericArticleDescription?: string;
    eanNumbers?: Array<{ eanNumber?: string }>;
    oemNumbers?: Array<{ oemNumber?: string; mfrName?: string }>;
  }>;
  totalMatchingArticles?: number;
  status?: number;
}

export class TecDocAdapter extends BaseSupplierAdapter {
  readonly name = "TecDoc";
  readonly code = "tecdoc";

  private credentials: TecDocCredentials;
  private tecdocUrl: string;

  constructor(apiUrl: string, apiKey: string, timeout = 15000) {
    super(apiUrl, apiKey, timeout);

    let creds: Partial<TecDocCredentials> = {};
    try {
      creds = JSON.parse(apiKey);
    } catch {
      creds = { apiKey };
    }

    this.credentials = {
      apiKey: creds.apiKey ?? apiKey,
      providerId: creds.providerId ?? DEFAULT_PROVIDER_ID,
      articleCountry: creds.articleCountry ?? DEFAULT_ARTICLE_COUNTRY,
    };

    this.tecdocUrl = apiUrl || "https://webservice.tecalliance.services/pegasus-3-0/services/TecdocToCatDLB.jsonEndpoint";
  }

  private async tecdocRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    const body = {
      ...params,
      articleCountry: this.credentials.articleCountry,
      providerId: this.credentials.providerId,
      lang: "nl",
    };

    const response = await this.fetchWithTimeout(this.tecdocUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": this.credentials.apiKey,
      },
      body: JSON.stringify({ [method]: body }),
    });

    const json = (await response.json()) as Record<string, unknown>;
    if (json.status && json.status !== 200) {
      throw new Error(`TecDoc API error: status=${json.status}`);
    }

    return json;
  }

  /**
   * Search TecDoc catalog. Tries multiple search strategies:
   * 1. Article number search (numberType=0)
   * 2. OEM cross-reference search (numberType=10)
   * 3. EAN search (numberType=4)
   */
  async search(params: SupplierSearchParams): Promise<SupplierProduct[]> {
    try {
      const query = params.query.trim();
      if (!query) return [];

      const promises: Promise<SupplierProduct[]>[] = [];

      // Search by article number
      promises.push(this.searchByNumberType(query, 0));

      // Search by OEM number (cross-reference)
      if (params.oem) {
        promises.push(this.searchByNumberType(params.oem, 10));
      } else {
        promises.push(this.searchByNumberType(query, 10));
      }

      // Search by EAN
      if (params.ean) {
        promises.push(this.searchByNumberType(params.ean, 4));
      }

      const settled = await Promise.allSettled(promises);
      const results: SupplierProduct[] = [];
      const seen = new Set<string>();

      for (const outcome of settled) {
        if (outcome.status === "fulfilled") {
          for (const product of outcome.value) {
            const key = `${product.brand}:${product.articleNo}`;
            if (!seen.has(key)) {
              seen.add(key);
              results.push(product);
            }
          }
        }
      }

      // Enrich with EAN and OEM numbers for top results
      if (results.length > 0) {
        await this.enrichWithDetails(results.slice(0, 25));
      }

      return results;
    } catch (err) {
      logger.error({ err, supplier: this.code }, "TecDoc search failed");
      return [];
    }
  }

  private async searchByNumberType(query: string, numberType: number): Promise<SupplierProduct[]> {
    const result = (await this.tecdocRequest(
      "getArticleDirectSearchAllNumbersWithState",
      {
        articleNumber: query,
        numberType,
        searchExact: numberType === 4, // exact for EAN
        perPage: 25,
        page: 1,
      }
    )) as DirectSearchResponse;

    const items = result.data?.array ?? [];

    return items.map((a) => ({
      supplier: this.code,
      sku: String(a.articleId ?? 0),
      brand: a.brandName ?? "",
      articleNo: a.articleNo ?? a.articleSearchNo ?? "",
      ean: null,
      tecdocId: String(a.articleId ?? 0),
      oem: null,
      description: a.articleName ?? "",
      price: null,
      stock: null,
      currency: "EUR",
    }));
  }

  /**
   * Enrich products with EAN and OEM numbers from getArticles endpoint
   */
  private async enrichWithDetails(products: SupplierProduct[]): Promise<void> {
    const articleIds = products
      .map((p) => parseInt(p.sku, 10))
      .filter((id) => !isNaN(id) && id > 0);

    if (articleIds.length === 0) return;

    try {
      const result = (await this.tecdocRequest("getArticles", {
        articleId: articleIds,
        includeOemNumbers: true,
        includeEanNumbers: true,
      })) as GetArticlesResponse;

      const articleMap = new Map<string, { ean: string | null; oem: string | null }>();
      for (const art of result.articles ?? []) {
        const id = String(art.dataSupplierId ?? 0);
        const ean = art.eanNumbers?.[0]?.eanNumber ?? null;
        const oemList = art.oemNumbers?.map((o) => o.oemNumber).filter(Boolean) ?? [];
        articleMap.set(art.articleNumber ?? "", { ean, oem: oemList[0] ?? null });
      }

      for (const product of products) {
        const details = articleMap.get(product.articleNo);
        if (details) {
          product.ean = details.ean;
          product.oem = details.oem;
        }
      }
    } catch (err) {
      logger.warn({ err }, "TecDoc enrichment failed (non-critical)");
    }
  }

  async getPrice(_sku: string): Promise<{ price: number; currency: string } | null> {
    // TecDoc doesn't provide pricing
    return null;
  }

  async getStock(_sku: string): Promise<{ quantity: number; available: boolean } | null> {
    // TecDoc doesn't provide stock info
    return null;
  }

  /**
   * TecDoc catalog sync not applicable — TecDoc is used as a reference catalog.
   */
  async *syncCatalog(_cursor?: string): AsyncGenerator<SupplierCatalogItem[], void, unknown> {
    // TecDoc serves as a reference catalog, not synced locally
    return;
  }
}

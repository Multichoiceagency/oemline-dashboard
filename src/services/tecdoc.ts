import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { cacheGet, cacheSet } from "./cache.js";

const TECDOC_PROVIDER_ID = 22691; // Standard TecDoc provider ID

interface TecDocArticle {
  dataSupplierId?: number;
  articleNumber?: string;
  mfrName?: string;
  mfrId?: number;
  genericArticleDescription?: string;
  eanNumbers?: Array<{ eanNumber?: string }>;
  oemNumbers?: Array<{ oemNumber?: string; mfrName?: string }>;
  articleStatusDescription?: string;
  packingUnit?: number;
}

interface TecDocSearchResponse {
  data?: {
    articles?: TecDocArticle[];
    totalMatchingArticles?: number;
  };
  status?: number;
}

export interface TecDocProduct {
  articleNumber: string;
  brand: string;
  brandId: number;
  description: string;
  ean: string | null;
  oemNumbers: string[];
  tecdocId: string;
}

/**
 * TecDoc Pegasus 3.0 JSON API service.
 * Reference data source for article lookups, OEM cross-references, and EAN matching.
 */
export class TecDocService {
  private apiUrl: string;
  private apiKey: string;

  constructor() {
    this.apiUrl = config.TECDOC_API_URL;
    this.apiKey = config.TECDOC_API_KEY;
  }

  private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const body = {
      ...params,
      providerId: TECDOC_PROVIDER_ID,
      lang: "nl",
    };

    const response = await fetch(this.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": this.apiKey,
      },
      body: JSON.stringify({
        [method]: body,
      }),
    });

    if (!response.ok) {
      throw new Error(`TecDoc API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async searchByArticleNumber(articleNumber: string, brandId?: number): Promise<TecDocProduct[]> {
    const cached = await cacheGet<TecDocProduct[]>("tecdoc", ["article", articleNumber, String(brandId ?? "")]);
    if (cached) return cached;

    try {
      const params: Record<string, unknown> = {
        articleNumber,
        numberType: 0,
        searchExact: true,
        perPage: 25,
        page: 1,
      };

      if (brandId) params.dataSupplierId = brandId;

      const result = (await this.request("getArticles", params)) as TecDocSearchResponse;
      const articles = this.mapArticles(result);

      await cacheSet("tecdoc", ["article", articleNumber, String(brandId ?? "")], articles);
      return articles;
    } catch (err) {
      logger.error({ err, articleNumber }, "TecDoc searchByArticleNumber failed");
      return [];
    }
  }

  async searchByOemNumber(oemNumber: string): Promise<TecDocProduct[]> {
    const cached = await cacheGet<TecDocProduct[]>("tecdoc", ["oem", oemNumber]);
    if (cached) return cached;

    try {
      const result = (await this.request("getArticles", {
        articleNumber: oemNumber,
        numberType: 2,
        searchExact: false,
        perPage: 25,
        page: 1,
      })) as TecDocSearchResponse;

      const articles = this.mapArticles(result);
      await cacheSet("tecdoc", ["oem", oemNumber], articles);
      return articles;
    } catch (err) {
      logger.error({ err, oemNumber }, "TecDoc searchByOemNumber failed");
      return [];
    }
  }

  async searchByEan(ean: string): Promise<TecDocProduct[]> {
    const cached = await cacheGet<TecDocProduct[]>("tecdoc", ["ean", ean]);
    if (cached) return cached;

    try {
      const result = (await this.request("getArticles", {
        articleNumber: ean,
        numberType: 4,
        searchExact: true,
        perPage: 25,
        page: 1,
      })) as TecDocSearchResponse;

      const articles = this.mapArticles(result);
      await cacheSet("tecdoc", ["ean", ean], articles);
      return articles;
    } catch (err) {
      logger.error({ err, ean }, "TecDoc searchByEan failed");
      return [];
    }
  }

  async searchFreeText(query: string, page = 1, perPage = 25): Promise<{
    articles: TecDocProduct[];
    total: number;
  }> {
    const cached = await cacheGet<{ articles: TecDocProduct[]; total: number }>(
      "search",
      ["tecdoc", query, String(page), String(perPage)]
    );
    if (cached) return cached;

    try {
      const result = (await this.request("getArticles", {
        articleNumber: query,
        numberType: 0,
        searchExact: false,
        perPage,
        page,
      })) as TecDocSearchResponse;

      const articles = this.mapArticles(result);
      const total = result.data?.totalMatchingArticles ?? articles.length;
      const response = { articles, total };

      await cacheSet("search", ["tecdoc", query, String(page), String(perPage)], response);
      return response;
    } catch (err) {
      logger.error({ err, query }, "TecDoc searchFreeText failed");
      return { articles: [], total: 0 };
    }
  }

  private mapArticles(result: TecDocSearchResponse): TecDocProduct[] {
    const articles = result.data?.articles ?? [];

    return articles.map((a) => ({
      articleNumber: a.articleNumber ?? "",
      brand: a.mfrName ?? "",
      brandId: a.mfrId ?? 0,
      description: a.genericArticleDescription ?? a.articleStatusDescription ?? "",
      ean: a.eanNumbers?.[0]?.eanNumber ?? null,
      oemNumbers: (a.oemNumbers ?? []).map((o) => o.oemNumber ?? "").filter(Boolean),
      tecdocId: `${a.dataSupplierId ?? 0}_${a.articleNumber ?? ""}`,
    }));
  }
}

let tecdocService: TecDocService | null = null;

export function getTecDocService(): TecDocService {
  if (!tecdocService) {
    tecdocService = new TecDocService();
  }
  return tecdocService;
}

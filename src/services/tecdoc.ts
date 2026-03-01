import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { cacheGet, cacheSet } from "./cache.js";

const TECDOC_PROVIDER_ID = 22691;
const ARTICLE_COUNTRY = "NL";

/**
 * Response from getArticleDirectSearchAllNumbersWithState
 */
interface DirectSearchResponse {
  data?: {
    array?: Array<{
      articleId?: number;
      articleName?: string;
      articleNo?: string;
      articleSearchNo?: string;
      articleStateId?: number;
      brandName?: string;
      brandNo?: number;
      genericArticleId?: number;
      numberType?: number;
    }>;
  };
  status?: number;
}

/**
 * Response from getArticles (full article details)
 */
interface GetArticlesResponse {
  totalMatchingArticles?: number;
  articles?: Array<{
    dataSupplierId?: number;
    articleNumber?: string;
    mfrName?: string;
    mfrId?: number;
    genericArticleDescription?: string;
    eanNumbers?: Array<{ eanNumber?: string }>;
    oemNumbers?: Array<{ oemNumber?: string; mfrName?: string }>;
    articleStatusDescription?: string;
  }>;
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
      articleCountry: ARTICLE_COUNTRY,
      providerId: TECDOC_PROVIDER_ID,
      lang: "nl",
    };

    const payload = JSON.stringify({ [method]: body });

    const response = await fetch(this.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": this.apiKey,
      },
      body: payload,
    });

    const json = (await response.json()) as Record<string, unknown>;

    // TecDoc returns HTTP 200 even for errors; check JSON status
    if (json.status && json.status !== 200) {
      throw new Error(`TecDoc API error: status=${json.status} ${json.statusText ?? ""}`);
    }

    return json;
  }

  /**
   * Search by article number using getArticleDirectSearchAllNumbersWithState.
   * numberType: 0 = article number, 2 = OEM number, 3 = trade number, 4 = EAN
   */
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

      if (brandId) params.brandNo = brandId;

      const result = (await this.request(
        "getArticleDirectSearchAllNumbersWithState",
        params
      )) as DirectSearchResponse;

      const articles = this.mapDirectSearch(result);
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
      const result = (await this.request(
        "getArticleDirectSearchAllNumbersWithState",
        {
          articleNumber: oemNumber,
          numberType: 2,
          searchExact: true,
          perPage: 25,
          page: 1,
        }
      )) as DirectSearchResponse;

      const articles = this.mapDirectSearch(result);
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
      const result = (await this.request(
        "getArticleDirectSearchAllNumbersWithState",
        {
          articleNumber: ean,
          numberType: 4,
          searchExact: true,
          perPage: 25,
          page: 1,
        }
      )) as DirectSearchResponse;

      const articles = this.mapDirectSearch(result);
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
      const result = (await this.request(
        "getArticleDirectSearchAllNumbersWithState",
        {
          articleNumber: query,
          numberType: 0,
          searchExact: false,
          perPage,
          page,
        }
      )) as DirectSearchResponse;

      const articles = this.mapDirectSearch(result);
      const total = articles.length;
      const response = { articles, total };

      await cacheSet("search", ["tecdoc", query, String(page), String(perPage)], response);
      return response;
    } catch (err) {
      logger.error({ err, query }, "TecDoc searchFreeText failed");
      return { articles: [], total: 0 };
    }
  }

  private mapDirectSearch(result: DirectSearchResponse): TecDocProduct[] {
    const items = result.data?.array ?? [];

    return items.map((a) => ({
      articleNumber: a.articleNo ?? a.articleSearchNo ?? "",
      brand: a.brandName ?? "",
      brandId: a.brandNo ?? 0,
      description: a.articleName ?? "",
      ean: null,
      oemNumbers: [],
      tecdocId: String(a.articleId ?? 0),
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

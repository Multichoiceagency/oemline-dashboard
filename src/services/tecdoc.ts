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

/**
 * Response from getArticles with includeAll (full details)
 */
interface FullArticleResponse {
  articles?: Array<{
    dataSupplierId?: number;
    articleNumber?: string;
    mfrName?: string;
    mfrId?: number;
    totalLinkages?: number;
    genericArticles?: Array<{
      genericArticleId?: number;
      genericArticleDescription?: string;
      assemblyGroupName?: string;
      legacyArticleId?: number;
    }>;
    articleText?: Array<{ text?: string; textType?: string }>;
    eanNumbers?: Array<{ eanNumber?: string }>;
    oemNumbers?: Array<{ oemNumber?: string; mfrName?: string }>;
    linkages?: Array<Record<string, unknown>>;
  }>;
  status?: number;
}

/**
 * Response from getArticleLinkedAllLinkingTarget4
 */
interface LinkagesResponse {
  data?: {
    array?: Array<{
      linkingTargetId?: number;
      linkingTargetDescription?: string;
      mfrName?: string;
      vehicleModelSeriesName?: string;
      beginYearMonth?: string;
      endYearMonth?: string;
      typeName?: string;
      subTypeName?: string;
      capacity?: string;
      power?: string;
      fuelType?: string;
    }>;
  };
  status?: number;
}

export interface VehicleLinkage {
  linkingTargetId: number;
  description: string;
  mfrName: string;
  vehicleModelSeriesName: string;
  beginYearMonth: string | null;
  endYearMonth: string | null;
  typeName: string;
  subTypeName: string;
  capacity: string | null;
  power: string | null;
  fuelType: string | null;
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
          numberType: 10, // OEM cross-reference
          searchExact: false,
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

  /**
   * Get vehicle linkages for an article (which vehicles is this part for).
   * Accepts either a TecDoc articleId directly, or articleNumber to look up first.
   */
  async getArticleLinkages(articleId: number): Promise<VehicleLinkage[]> {
    const cached = await cacheGet<VehicleLinkage[]>("tecdoc", ["linkages", String(articleId)]);
    if (cached) return cached;

    try {
      const result = (await this.request(
        "getArticleLinkedAllLinkingTarget4",
        {
          articleId,
          linkingTargetType: "V",
          country: ARTICLE_COUNTRY,
          perPage: 100,
          page: 1,
        }
      )) as LinkagesResponse;

      const linkages = this.mapLinkages(result);
      await cacheSet("tecdoc", ["linkages", String(articleId)], linkages);
      return linkages;
    } catch (err) {
      logger.error({ err, articleId }, "TecDoc getArticleLinkages failed");
      return [];
    }
  }

  /**
   * Get vehicle linkages by article number (looks up the real TecDoc articleId first).
   */
  async getArticleLinkagesByNumber(articleNumber: string): Promise<VehicleLinkage[]> {
    const cacheKey = `linkages-by-number-${articleNumber}`;
    const cached = await cacheGet<VehicleLinkage[]>("tecdoc", [cacheKey]);
    if (cached) return cached;

    try {
      // Step 1: Look up the real TecDoc articleId via direct search
      const searchResult = (await this.request(
        "getArticleDirectSearchAllNumbersWithState",
        {
          articleNumber: articleNumber.replace(/\s+/g, ""),
          numberType: 0,
          searchExact: true,
          perPage: 5,
          page: 1,
        }
      )) as DirectSearchResponse;

      const articles = searchResult.data?.array ?? [];
      if (articles.length === 0) {
        logger.debug({ articleNumber }, "No TecDoc article found for linkage lookup");
        return [];
      }

      const realArticleId = articles[0].articleId;
      if (!realArticleId) return [];

      // Step 2: Get linkages with the real articleId
      const linkages = await this.getArticleLinkages(realArticleId);
      await cacheSet("tecdoc", [cacheKey], linkages);
      return linkages;
    } catch (err) {
      logger.error({ err, articleNumber }, "TecDoc getArticleLinkagesByNumber failed");
      return [];
    }
  }

  /**
   * Get full article details including description and generic article info.
   */
  async getArticleDetails(articleNumber: string): Promise<{
    description: string;
    genericArticle: string;
    articleText: string[];
    oemNumbers: string[];
    totalLinkages: number;
  } | null> {
    const cached = await cacheGet<ReturnType<typeof this.getArticleDetails>>("tecdoc", ["details", articleNumber]);
    if (cached) return cached;

    try {
      // First get the real article via direct search
      const searchResult = (await this.request(
        "getArticleDirectSearchAllNumbersWithState",
        {
          articleNumber: articleNumber.replace(/\s+/g, ""),
          numberType: 0,
          searchExact: true,
          perPage: 1,
          page: 1,
        }
      )) as DirectSearchResponse;

      const found = searchResult.data?.array?.[0];
      if (!found?.articleId) return null;

      // Then get full details using getArticles with the articleId
      const result = (await this.request("getArticles", {
        articleId: found.articleId,
        includeAll: true,
        includeArticleText: true,
        perPage: 1,
        page: 1,
      })) as FullArticleResponse;

      const art = result.articles?.[0];
      if (!art) return null;

      const ga = art.genericArticles?.[0];
      const texts = (art.articleText ?? []).map((t) => t.text).filter(Boolean) as string[];
      const oems = (art.oemNumbers ?? []).map((o) => o.oemNumber).filter(Boolean) as string[];

      const details = {
        description: found.articleName ?? ga?.genericArticleDescription ?? "",
        genericArticle: ga?.genericArticleDescription ?? "",
        articleText: texts,
        oemNumbers: oems,
        totalLinkages: art.totalLinkages ?? 0,
      };

      await cacheSet("tecdoc", ["details", articleNumber], details);
      return details;
    } catch (err) {
      logger.error({ err, articleNumber }, "TecDoc getArticleDetails failed");
      return null;
    }
  }

  private mapLinkages(result: LinkagesResponse): VehicleLinkage[] {
    const items = result.data?.array ?? [];

    return items.map((a) => ({
      linkingTargetId: a.linkingTargetId ?? 0,
      description: a.linkingTargetDescription ?? "",
      mfrName: a.mfrName ?? "",
      vehicleModelSeriesName: a.vehicleModelSeriesName ?? "",
      beginYearMonth: a.beginYearMonth ?? null,
      endYearMonth: a.endYearMonth ?? null,
      typeName: a.typeName ?? "",
      subTypeName: a.subTypeName ?? "",
      capacity: a.capacity ?? null,
      power: a.power ?? null,
      fuelType: a.fuelType ?? null,
    }));
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

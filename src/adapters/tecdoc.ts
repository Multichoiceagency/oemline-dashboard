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

interface TecDocArticle {
  dataSupplierId?: number;
  articleNumber?: string;
  mfrName?: string;
  mfrId?: number;
  genericArticleDescription?: string;
  eanNumbers?: Array<{ eanNumber?: string }>;
  oemNumbers?: Array<{ oemNumber?: string; mfrName?: string }>;
  articleStatusDescription?: string;
  images?: Array<{
    imageURL50?: string;
    imageURL100?: string;
    imageURL200?: string;
    imageURL400?: string;
    imageURL800?: string;
  }>;
  articleAttributes?: Array<{
    attrName?: string;
    attrValue?: string;
    attrUnit?: string;
  }>;
  linkages?: Array<{
    linkageTargetType?: string;
  }>;
}

interface GetArticlesResponse {
  articles?: TecDocArticle[];
  totalMatchingArticles?: number;
  status?: number;
}

interface TecDocBrand {
  brandId?: number;
  brandName?: string;
  brandLogoUrl?: string;
}

export class TecDocAdapter extends BaseSupplierAdapter {
  readonly name = "TecDoc";
  readonly code = "tecdoc";

  private credentials: TecDocCredentials;
  private tecdocUrl: string;

  constructor(apiUrl: string, apiKey: string, timeout = 30000) {
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

  /**
   * Direct fetch for TecDoc API with long timeout (bypasses circuit breaker for sync).
   */
  private async tecdocFetch(body: Record<string, unknown>): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000); // 60s timeout for bulk ops

    try {
      const response = await fetch(this.tecdocUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": this.credentials.apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const json = (await response.json()) as Record<string, unknown>;
      if (json.status && json.status !== 200) {
        throw new Error(`TecDoc API error: status=${json.status}`);
      }

      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  private async tecdocRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    const body = {
      ...params,
      articleCountry: this.credentials.articleCountry,
      providerId: this.credentials.providerId,
      lang: "nl",
    };

    return this.tecdocFetch({ [method]: body });
  }

  /**
   * Search TecDoc catalog. Tries multiple search strategies.
   */
  async search(params: SupplierSearchParams): Promise<SupplierProduct[]> {
    try {
      const query = params.query.trim();
      if (!query) return [];

      const promises: Promise<SupplierProduct[]>[] = [];
      promises.push(this.searchByNumberType(query, 0));

      if (params.oem) {
        promises.push(this.searchByNumberType(params.oem, 10));
      } else {
        promises.push(this.searchByNumberType(query, 10));
      }

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
        searchExact: numberType === 4,
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
        includeImages: true,
      })) as GetArticlesResponse;

      const articleMap = new Map<string, { ean: string | null; oem: string | null }>();
      for (const art of result.articles ?? []) {
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
    return null;
  }

  async getStock(_sku: string): Promise<{ quantity: number; available: boolean } | null> {
    return null;
  }

  /**
   * Full TecDoc catalog sync by paginating through all articles.
   *
   * Strategy: Use getArticles with pagination to fetch all articles.
   * TecDoc enforces max 100 per page. We paginate through all available articles.
   *
   * Cursor format: page number string for resume capability
   */
  async *syncCatalog(cursor?: string): AsyncGenerator<SupplierCatalogItem[], void, unknown> {
    try {
      // First check total article count with perPage=0
      const countResult = (await this.tecdocRequest("getArticles", {
        perPage: 0,
        page: 1,
      })) as GetArticlesResponse;

      const totalArticles = countResult.totalMatchingArticles ?? 0;
      logger.info(
        { supplier: this.code, totalArticles },
        "TecDoc catalog sync starting"
      );

      if (totalArticles === 0) {
        logger.warn({ supplier: this.code }, "TecDoc returned 0 articles");
        return;
      }

      const perPage = 100;
      let page = cursor ? parseInt(cursor, 10) : 1;
      if (isNaN(page) || page < 1) page = 1;
      let totalYielded = 0;
      let consecutiveEmpty = 0;

      while (true) {
        try {
          const result = (await this.tecdocRequest("getArticles", {
            perPage,
            page,
            includeOemNumbers: true,
            includeEanNumbers: true,
            includeImages: true,
          })) as GetArticlesResponse;

          const articles = result.articles ?? [];

          if (articles.length === 0) {
            consecutiveEmpty++;
            if (consecutiveEmpty >= 3) break;
            page++;
            continue;
          }

          consecutiveEmpty = 0;

          // Map TecDoc articles to our catalog item format
          const items: SupplierCatalogItem[] = articles.map((art) => {
            const ean = art.eanNumbers?.[0]?.eanNumber ?? null;
            const oemList = (art.oemNumbers ?? [])
              .map((o) => o.oemNumber)
              .filter((o): o is string => !!o);
            const images = (art.images ?? [])
              .map((img) => img.imageURL800 ?? img.imageURL400 ?? img.imageURL200 ?? "")
              .filter(Boolean);
            const imageUrl = images[0] ?? null;

            return {
              sku: String(art.dataSupplierId ?? 0) + "_" + (art.articleNumber ?? ""),
              brand: art.mfrName ?? "",
              articleNo: art.articleNumber ?? "",
              ean,
              tecdocId: String(art.dataSupplierId ?? 0),
              oem: oemList[0] ?? null,
              description: art.genericArticleDescription ?? "",
              imageUrl,
              images,
              genericArticle: art.genericArticleDescription ?? null,
              oemNumbers: oemList,
            };
          });

          yield items;
          totalYielded += items.length;

          // Log progress every 50 pages
          if (page % 50 === 0 || page === 1) {
            logger.info(
              {
                supplier: this.code,
                page,
                totalPages: Math.ceil(totalArticles / perPage),
                totalYielded,
              },
              "TecDoc sync progress"
            );
          }

          // Check if we've reached the end
          if (articles.length < perPage) break;
          if (totalArticles > 0 && page * perPage >= totalArticles) break;

          page++;

          // Small delay to avoid rate limiting
          await new Promise((r) => setTimeout(r, 200));
        } catch (err) {
          logger.warn(
            { err, supplier: this.code, page },
            "TecDoc getArticles failed for page, retrying next page"
          );
          page++;
          consecutiveEmpty++;
          if (consecutiveEmpty >= 5) break;
        }
      }

      logger.info({ supplier: this.code, totalYielded, pages: page }, "TecDoc catalog sync completed");
    } catch (err) {
      logger.error({ err, supplier: this.code }, "TecDoc catalog sync failed");
    }
  }
}

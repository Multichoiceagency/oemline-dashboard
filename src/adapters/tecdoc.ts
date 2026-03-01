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
   * Full TecDoc catalog sync using getArticles with dataSupplierId (brand filter).
   *
   * Strategy:
   * 1. Fetch all brands via getBrands
   * 2. For each brand, use getArticles with dataSupplierId to get all articles
   * 3. Paginate through each brand's articles
   * 4. Yield batches for DB upsert
   *
   * Cursor format: "brandIndex:page" for resume capability
   */
  async *syncCatalog(cursor?: string): AsyncGenerator<SupplierCatalogItem[], void, unknown> {
    try {
      // Step 1: Get ALL brands
      const brandsResult = (await this.tecdocRequest("getBrands", {})) as {
        brands?: TecDocBrand[];
      };

      const brands = brandsResult.brands ?? [];
      if (brands.length === 0) {
        logger.warn({ supplier: this.code }, "TecDoc getBrands returned no brands");
        return;
      }

      logger.info(
        { supplier: this.code, brandCount: brands.length },
        "TecDoc catalog sync starting"
      );

      let startBrandIdx = 0;
      let startPage = 1;
      if (cursor) {
        const parts = cursor.split(":");
        startBrandIdx = parseInt(parts[0] ?? "0", 10) || 0;
        startPage = parseInt(parts[1] ?? "1", 10) || 1;
      }

      let totalYielded = 0;

      for (let bi = startBrandIdx; bi < brands.length; bi++) {
        const brand = brands[bi];
        if (!brand.brandId) continue;

        let page = bi === startBrandIdx ? startPage : 1;
        const perPage = 100;
        let hasMore = true;
        let brandArticleCount = 0;

        while (hasMore) {
          try {
            // Use getArticles with dataSupplierId for bulk fetch
            const result = (await this.tecdocRequest("getArticles", {
              dataSupplierId: brand.brandId,
              perPage,
              page,
              includeOemNumbers: true,
              includeEanNumbers: true,
              includeImages: true,
            })) as GetArticlesResponse;

            const articles = result.articles ?? [];

            if (articles.length === 0) {
              hasMore = false;
              break;
            }

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
                sku: String(art.dataSupplierId ?? brand.brandId ?? 0) + "_" + (art.articleNumber ?? ""),
                brand: art.mfrName ?? brand.brandName ?? "",
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
            brandArticleCount += items.length;
            totalYielded += items.length;

            // Check if more pages
            const totalForBrand = result.totalMatchingArticles ?? 0;
            if (articles.length < perPage || (totalForBrand > 0 && page * perPage >= totalForBrand)) {
              hasMore = false;
            } else {
              page++;
            }

            // Small delay to avoid rate limiting
            await new Promise((r) => setTimeout(r, 200));
          } catch (err) {
            logger.warn(
              { err, supplier: this.code, brandId: brand.brandId, brandName: brand.brandName, page },
              "TecDoc getArticles failed for brand, skipping"
            );
            hasMore = false;
          }
        }

        // Log progress every 10 brands or when a brand has articles
        if (bi % 10 === 0 || brandArticleCount > 0) {
          logger.info(
            {
              supplier: this.code,
              brandIndex: bi,
              totalBrands: brands.length,
              brand: brand.brandName,
              brandArticles: brandArticleCount,
              totalYielded,
            },
            "TecDoc sync progress"
          );
        }
      }

      logger.info({ supplier: this.code, totalYielded }, "TecDoc catalog sync completed");
    } catch (err) {
      logger.error({ err, supplier: this.code }, "TecDoc catalog sync failed");
    }
  }
}

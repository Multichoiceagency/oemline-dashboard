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
   * Direct fetch for TecDoc API with long timeout and retry (bypasses circuit breaker for sync).
   * Retries up to 3 times with exponential backoff (2s, 4s) on any transient failure.
   */
  private async tecdocFetch(body: Record<string, unknown>): Promise<unknown> {
    const MAX_RETRIES = 3;
    let lastErr: Error | undefined;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120_000); // 120s timeout per attempt

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
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_RETRIES) {
          const delay = 2000 * (2 ** (attempt - 1)); // 2s, 4s
          logger.warn(
            { supplier: this.code, attempt, maxRetries: MAX_RETRIES, delayMs: delay, err: lastErr.message },
            "TecDoc fetch failed, retrying with backoff"
          );
          await new Promise((r) => setTimeout(r, delay));
        }
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastErr!;
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
   * Full TecDoc catalog sync using assembly groups to partition the catalog.
   *
   * TecDoc limits unfiltered queries to 100 pages (10,000 articles).
   * By filtering per assembly group (category), each subset stays under the limit.
   *
   * Strategy:
   * 1. Get all assembly groups via facets (perPage=0)
   * 2. For each assembly group, paginate through its articles (max 100 pages each)
   * 3. Yield batches for DB upsert
   *
   * Cursor format: "groupIndex:page" for resume capability
   */
  /**
   * syncCatalogWithOptions allows passing brandIds directly (overrides the DB setting).
   * Used by the sync worker when a targeted per-brand sync is requested.
   */
  async *syncCatalogWithOptions(
    cursor?: string,
    opts?: { brandIds?: number[] }
  ): AsyncGenerator<SupplierCatalogItem[], void, unknown> {
    yield* this.syncCatalogInternal(cursor, opts?.brandIds);
  }

  async *syncCatalog(cursor?: string): AsyncGenerator<SupplierCatalogItem[], void, unknown> {
    yield* this.syncCatalogInternal(cursor);
  }

  private async *syncCatalogInternal(
    cursor?: string,
    overrideBrandIds?: number[]
  ): AsyncGenerator<SupplierCatalogItem[], void, unknown> {
    try {
      // Load brand filter: job-level override takes priority, then DB setting
      let dataSupplierIds: number[] | undefined = overrideBrandIds;

      if (!dataSupplierIds) {
        try {
          const { prisma } = await import("../lib/prisma.js");
          const row = await prisma.setting.findUnique({ where: { key: "tecdoc_brand_filter_ids" } });
          if (row?.value) {
            const ids = JSON.parse(row.value) as number[];
            if (Array.isArray(ids) && ids.length > 0) dataSupplierIds = ids;
          }
        } catch { /* ignore — proceed without filter */ }
      }

      if (dataSupplierIds) {
        logger.info({ supplier: this.code, brandCount: dataSupplierIds.length, fromOverride: !!overrideBrandIds }, "TecDoc sync: brand filter active");
      }

      // Step 1: Discover assembly groups using facets
      const facetResult = (await this.tecdocFetch({
        getArticles: {
          articleCountry: this.credentials.articleCountry,
          providerId: this.credentials.providerId,
          lang: "nl",
          perPage: 0,
          page: 1,
          ...(dataSupplierIds ? { dataSupplierIds } : {}),
          assemblyGroupFacetOptions: {
            enabled: true,
            assemblyGroupType: "P",
          },
        },
      })) as Record<string, unknown>;

      const totalArticles = (facetResult.totalMatchingArticles as number) ?? 0;

      // assemblyGroupFacets can be an object with counts/array, or directly an array
      let rawFacets: Array<Record<string, unknown>> = [];
      const agf = facetResult.assemblyGroupFacets;
      if (Array.isArray(agf)) {
        rawFacets = agf;
      } else if (agf && typeof agf === "object") {
        const obj = agf as Record<string, unknown>;
        rawFacets = (obj.counts ?? obj.array ?? obj.data ?? []) as Array<Record<string, unknown>>;
        if (!Array.isArray(rawFacets)) rawFacets = [];
      }

      // Flatten nested tree structure if needed
      const allFacets = this.flattenFacets(rawFacets);

      const groups = allFacets
        .filter((g) => g.assemblyGroupNodeId && (g.matchCount ?? 0) > 0)
        .sort((a, b) => (b.matchCount ?? 0) - (a.matchCount ?? 0));

      logger.info(
        {
          supplier: this.code,
          totalArticles,
          assemblyGroups: groups.length,
          facetType: typeof agf,
          isArray: Array.isArray(agf),
          rawFacetKeys: agf && typeof agf === "object" && !Array.isArray(agf) ? Object.keys(agf as Record<string, unknown>).slice(0, 5) : [],
        },
        "TecDoc catalog sync starting with assembly group partitioning"
      );

      if (groups.length === 0) {
        // Fallback: direct pagination (gets up to 10,000)
        logger.warn({ supplier: this.code }, "No assembly groups found, using direct pagination");
        yield* this.syncDirectPagination();
        return;
      }

      // Parse cursor
      let startGroupIdx = 0;
      let startPage = 1;
      if (cursor) {
        const parts = cursor.split(":");
        startGroupIdx = parseInt(parts[0] ?? "0", 10) || 0;
        startPage = parseInt(parts[1] ?? "1", 10) || 1;
      }

      let totalYielded = 0;
      const perPage = 100;
      const MAX_PAGES_PER_GROUP = 100; // TecDoc's hard limit
      const PAGE_LIMIT_THRESHOLD = perPage * MAX_PAGES_PER_GROUP; // 10,000
      let fetchDelay = 50; // Adaptive delay — starts low, increases on errors

      for (let gi = startGroupIdx; gi < groups.length; gi++) {
        const group = groups[gi];
        if (!group.assemblyGroupNodeId) continue;

        let page = gi === startGroupIdx ? startPage : 1;
        let groupYielded = 0;
        let consecutiveErrors = 0;
        let groupHitPageLimit = false;

        while (page <= MAX_PAGES_PER_GROUP) {
          try {
            const result = (await this.tecdocRequest("getArticles", {
              assemblyGroupNodeIds: [group.assemblyGroupNodeId],
              perPage,
              page,
              includeOemNumbers: true,
              includeEanNumbers: true,
              includeImages: true,
              ...(dataSupplierIds ? { dataSupplierIds } : {}),
            })) as GetArticlesResponse;

            const articles = result.articles ?? [];
            if (articles.length === 0) break;

            const items = this.mapArticlesToCatalogItems(articles, group.assemblyGroupNodeId);
            yield items;
            groupYielded += items.length;
            totalYielded += items.length;

            // Success — gradually reduce delay back toward minimum
            consecutiveErrors = 0;
            if (fetchDelay > 50) {
              fetchDelay = Math.max(50, Math.floor(fetchDelay * 0.8));
            }

            if (articles.length < perPage) break;

            const groupTotal = result.totalMatchingArticles ?? 0;
            if (groupTotal > 0 && page * perPage >= groupTotal) break;

            // Detect if this group exceeds the page limit (has more articles than 10K)
            if (page === MAX_PAGES_PER_GROUP && groupTotal > PAGE_LIMIT_THRESHOLD) {
              groupHitPageLimit = true;
            }

            page++;
            await new Promise((r) => setTimeout(r, fetchDelay));
          } catch (err) {
            consecutiveErrors++;
            const isTimeout = err instanceof Error && (err.name === "AbortError" || err.message.includes("timeout") || err.message.includes("abort"));

            if (isTimeout || consecutiveErrors <= 3) {
              // Increase delay and retry the same page
              fetchDelay = Math.min(5000, fetchDelay * 2);
              const waitMs = fetchDelay * consecutiveErrors;
              logger.warn(
                { supplier: this.code, group: group.assemblyGroupName, page, attempt: consecutiveErrors, waitMs, isTimeout },
                "TecDoc request failed, retrying with backoff"
              );
              await new Promise((r) => setTimeout(r, waitMs));
              // Don't increment page — retry same page
              continue;
            }

            // Too many consecutive errors — skip to next group
            logger.error(
              { supplier: this.code, group: group.assemblyGroupName, page, errors: consecutiveErrors },
              "TecDoc group skipped after repeated failures"
            );
            break;
          }
        }

        // If this group hit the 10K page limit and we have brand IDs,
        // re-fetch per brand to get the remaining articles beyond 10K.
        if (groupHitPageLimit && dataSupplierIds && dataSupplierIds.length > 1) {
          logger.info(
            { supplier: this.code, group: group.assemblyGroupName, groupYielded },
            "Group hit 10K page limit — sub-partitioning by brand to fetch remaining articles"
          );

          for (const brandId of dataSupplierIds) {
            let brandPage = 1;
            let brandYielded = 0;

            while (brandPage <= MAX_PAGES_PER_GROUP) {
              try {
                const result = (await this.tecdocRequest("getArticles", {
                  assemblyGroupNodeIds: [group.assemblyGroupNodeId],
                  dataSupplierIds: [brandId],
                  perPage,
                  page: brandPage,
                  includeOemNumbers: true,
                  includeEanNumbers: true,
                  includeImages: true,
                })) as GetArticlesResponse;

                const articles = result.articles ?? [];
                if (articles.length === 0) break;

                const items = this.mapArticlesToCatalogItems(articles, group.assemblyGroupNodeId);
                yield items;
                brandYielded += items.length;
                totalYielded += items.length;

                if (articles.length < perPage) break;

                const brandTotal = result.totalMatchingArticles ?? 0;
                if (brandTotal > 0 && brandPage * perPage >= brandTotal) break;

                brandPage++;
                await new Promise((r) => setTimeout(r, fetchDelay));
              } catch {
                break;
              }
            }

            if (brandYielded > 0) {
              groupYielded += brandYielded;
            }
          }
        }

        // Log progress every 10 groups
        if (gi % 10 === 0 || groupYielded > 0) {
          logger.info(
            {
              supplier: this.code,
              groupIndex: gi,
              totalGroups: groups.length,
              groupName: group.assemblyGroupName,
              groupArticles: groupYielded,
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

  private flattenFacets(facets: Array<Record<string, unknown>>): Array<{ assemblyGroupNodeId: number; assemblyGroupName: string; matchCount: number }> {
    const result: Array<{ assemblyGroupNodeId: number; assemblyGroupName: string; matchCount: number }> = [];

    for (const facet of facets) {
      const nodeId = facet.assemblyGroupNodeId as number | undefined;
      const name = (facet.assemblyGroupName ?? facet.name ?? "") as string;
      const count = (facet.matchCount ?? facet.count ?? 0) as number;

      if (nodeId) {
        result.push({ assemblyGroupNodeId: nodeId, assemblyGroupName: name, matchCount: count });
      }

      // Recursively flatten children
      const children = facet.children as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(children) && children.length > 0) {
        result.push(...this.flattenFacets(children));
      }
    }

    return result;
  }

  /**
   * Fallback: direct pagination sync (max 10,000 articles due to TecDoc API limit).
   */
  private async *syncDirectPagination(): AsyncGenerator<SupplierCatalogItem[], void, unknown> {
    const perPage = 100;
    let page = 1;
    let totalYielded = 0;

    while (page <= 100) {
      try {
        const result = (await this.tecdocRequest("getArticles", {
          perPage,
          page,
          includeOemNumbers: true,
          includeEanNumbers: true,
          includeImages: true,
        })) as GetArticlesResponse;

        const articles = result.articles ?? [];
        if (articles.length === 0) break;

        yield this.mapArticlesToCatalogItems(articles);
        totalYielded += articles.length;

        if (articles.length < perPage) break;
        page++;
        await new Promise((r) => setTimeout(r, 50));
      } catch {
        break;
      }
    }

    logger.info({ supplier: this.code, totalYielded }, "TecDoc direct pagination sync completed");
  }

  private mapArticlesToCatalogItems(articles: TecDocArticle[], groupNodeId?: number): SupplierCatalogItem[] {
    return articles.map((art) => {
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
        tecdocGroupId: groupNodeId ?? null,
      };
    });
  }
}

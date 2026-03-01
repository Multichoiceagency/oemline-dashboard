import { getAllAdapters } from "../adapters/registry.js";
import { CircuitOpenError } from "../lib/circuit-breaker.js";
import { cacheGet, cacheSet } from "./cache.js";
import { meili, PRODUCTS_INDEX } from "../lib/meilisearch.js";
import { logger } from "../lib/logger.js";
import { getTecDocService } from "./tecdoc.js";
import type {
  SupplierSearchParams,
  SupplierProduct,
  SupplierError,
  SearchResult,
} from "../types/index.js";

const MAX_MERGED_RESULTS = 200;

function sanitizeFilterValue(value: string): string {
  return value.replace(/[\\"]/g, "");
}

export async function searchProducts(params: SupplierSearchParams): Promise<SearchResult> {
  const cacheKey = [params.query, params.brand ?? "", params.ean ?? "", params.tecdocId ?? "", params.oem ?? ""];
  const cached = await cacheGet<SearchResult>("search", cacheKey);
  if (cached) {
    return { ...cached, cachedAt: new Date().toISOString() };
  }

  const adapters = getAllAdapters();
  const errors: SupplierError[] = [];
  const allResults: SupplierProduct[] = [];

  // Step 1: Cross-reference with TecDoc to find aftermarket articles
  const tecdocResults: SupplierProduct[] = [];
  try {
    const tecdoc = getTecDocService();
    const query = params.query.trim();

    // Try multiple TecDoc search strategies in parallel
    const tecdocPromises: Promise<SupplierProduct[]>[] = [];

    // If OEM param is set, search by OEM
    if (params.oem) {
      tecdocPromises.push(
        tecdoc.searchByOemNumber(params.oem).then((articles) =>
          articles.map((a) => ({
            supplier: "tecdoc",
            sku: a.tecdocId,
            brand: a.brand,
            articleNo: a.articleNumber,
            ean: a.ean,
            tecdocId: a.tecdocId,
            oem: params.oem ?? null,
            description: a.description,
            price: null,
            stock: null,
            currency: "EUR",
          }))
        )
      );
    }

    // If EAN param is set, search by EAN
    if (params.ean) {
      tecdocPromises.push(
        tecdoc.searchByEan(params.ean).then((articles) =>
          articles.map((a) => ({
            supplier: "tecdoc",
            sku: a.tecdocId,
            brand: a.brand,
            articleNo: a.articleNumber,
            ean: a.ean ?? params.ean ?? null,
            tecdocId: a.tecdocId,
            oem: null,
            description: a.description,
            price: null,
            stock: null,
            currency: "EUR",
          }))
        )
      );
    }

    // Always try the query as both article number and OEM number
    if (!params.oem && !params.ean) {
      // Try as article number first
      tecdocPromises.push(
        tecdoc.searchByArticleNumber(query).then((articles) =>
          articles.map((a) => ({
            supplier: "tecdoc",
            sku: a.tecdocId,
            brand: a.brand,
            articleNo: a.articleNumber,
            ean: a.ean,
            tecdocId: a.tecdocId,
            oem: null,
            description: a.description,
            price: null,
            stock: null,
            currency: "EUR",
          }))
        )
      );

      // Also try as OEM number (cross-reference)
      tecdocPromises.push(
        tecdoc.searchByOemNumber(query).then((articles) =>
          articles.map((a) => ({
            supplier: "tecdoc",
            sku: a.tecdocId,
            brand: a.brand,
            articleNo: a.articleNumber,
            ean: a.ean,
            tecdocId: a.tecdocId,
            oem: query,
            description: a.description,
            price: null,
            stock: null,
            currency: "EUR",
          }))
        )
      );
    }

    const tecdocSettled = await Promise.allSettled(tecdocPromises);
    for (const outcome of tecdocSettled) {
      if (outcome.status === "fulfilled") {
        tecdocResults.push(...outcome.value);
      }
    }

    logger.info({ query, tecdocHits: tecdocResults.length }, "TecDoc cross-reference complete");
  } catch (err) {
    logger.warn({ err }, "TecDoc cross-reference failed, continuing with supplier search");
  }

  // Step 2: Search Meilisearch index for local matches
  let meiliResults: SupplierProduct[] = [];
  try {
    const limit = Math.min(params.limit ?? 50, MAX_MERGED_RESULTS);
    const searchResponse = await meili.index(PRODUCTS_INDEX).search(params.query, {
      limit,
      filter: buildMeiliFilter(params),
    });

    meiliResults = searchResponse.hits.map((hit) => {
      const h = hit as Record<string, unknown>;
      return {
        supplier: (h.supplier as string) ?? "",
        sku: (h.sku as string) ?? "",
        brand: (h.brand as string) ?? "",
        articleNo: (h.articleNo as string) ?? "",
        ean: (h.ean as string) ?? null,
        tecdocId: (h.tecdocId as string) ?? null,
        oem: (h.oem as string) ?? null,
        description: (h.description as string) ?? "",
        price: null,
        stock: null,
        currency: "EUR",
      };
    });
  } catch (err) {
    logger.warn({ err }, "Meilisearch query failed, falling back to supplier APIs");
  }

  // Step 3: Query supplier APIs — use TecDoc article numbers for better results
  const articleNumbers = tecdocResults
    .map((r) => r.articleNo)
    .filter((a) => a.length > 0)
    .slice(0, 10); // Limit to avoid too many API calls

  const supplierPromises = adapters.map(async (adapter) => {
    if (adapter.circuitBreaker.isOpen()) {
      return {
        supplier: adapter.code,
        results: [] as SupplierProduct[],
        error: {
          supplier: adapter.code,
          message: "Supplier temporarily unavailable",
          code: "CIRCUIT_OPEN",
        },
      };
    }

    try {
      // Search with original query first
      const results = await adapter.search(params);

      // Also search with TecDoc article numbers for better coverage
      if (articleNumbers.length > 0 && results.length === 0) {
        const extraResults: SupplierProduct[] = [];
        for (const artNo of articleNumbers.slice(0, 5)) {
          try {
            const artResults = await adapter.search({ ...params, query: artNo, articleNo: artNo });
            extraResults.push(...artResults);
          } catch {
            // best-effort
          }
        }
        results.push(...extraResults);
      }

      return { supplier: adapter.code, results, error: null };
    } catch (err) {
      const isCircuit = err instanceof CircuitOpenError;
      return {
        supplier: adapter.code,
        results: [] as SupplierProduct[],
        error: {
          supplier: adapter.code,
          message: isCircuit ? "Supplier temporarily unavailable" : "Supplier request failed",
          code: isCircuit ? "CIRCUIT_OPEN" : "SUPPLIER_ERROR",
        },
      };
    }
  });

  const settled = await Promise.allSettled(supplierPromises);

  for (const outcome of settled) {
    if (outcome.status === "fulfilled") {
      allResults.push(...outcome.value.results);
      if (outcome.value.error) {
        errors.push(outcome.value.error);
      }
    } else {
      logger.error({ reason: outcome.reason }, "Supplier search promise rejected");
    }
  }

  // Step 4: Merge results — TecDoc first (reference data), then supplier results, then Meilisearch
  const seen = new Set<string>();
  const merged: SupplierProduct[] = [];

  // Supplier results first (they have price/stock)
  for (const product of allResults) {
    if (merged.length >= MAX_MERGED_RESULTS) break;
    const key = `${product.supplier}:${product.sku}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(product);
    }
  }

  // Then Meilisearch results
  for (const product of meiliResults) {
    if (merged.length >= MAX_MERGED_RESULTS) break;
    const key = `${product.supplier}:${product.sku}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(product);
    }
  }

  // Then TecDoc results (reference catalog — no price/stock but gives cross-ref info)
  for (const product of tecdocResults) {
    if (merged.length >= MAX_MERGED_RESULTS) break;
    const key = `${product.brand}:${product.articleNo}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(product);
    }
  }

  const result: SearchResult = {
    query: params.query,
    results: merged,
    matches: [],
    errors,
    totalResults: merged.length,
    cachedAt: null,
  };

  await cacheSet("search", cacheKey, result).catch((err) => {
    logger.warn({ err }, "Failed to cache search results");
  });

  return result;
}

function buildMeiliFilter(params: SupplierSearchParams): string[] {
  const filters: string[] = [];
  if (params.brand) filters.push(`brand = "${sanitizeFilterValue(params.brand)}"`);
  if (params.ean) filters.push(`ean = "${sanitizeFilterValue(params.ean)}"`);
  if (params.tecdocId) filters.push(`tecdocId = "${sanitizeFilterValue(params.tecdocId)}"`);
  return filters;
}

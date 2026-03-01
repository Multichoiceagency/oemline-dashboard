import { getAllAdapters } from "../adapters/registry.js";
import { CircuitOpenError } from "../lib/circuit-breaker.js";
import { cacheGet, cacheSet } from "./cache.js";
import { meili, PRODUCTS_INDEX } from "../lib/meilisearch.js";
import { logger } from "../lib/logger.js";
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
  const cacheKey = [params.query, params.brand ?? "", params.ean ?? "", params.tecdocId ?? ""];
  const cached = await cacheGet<SearchResult>("search", cacheKey);
  if (cached) {
    return { ...cached, cachedAt: new Date().toISOString() };
  }

  const adapters = getAllAdapters();
  const errors: SupplierError[] = [];
  const allResults: SupplierProduct[] = [];

  // Search Meilisearch index for local matches
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

  // Query all supplier APIs concurrently
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
      const results = await adapter.search(params);
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

  // Merge results, dedup by supplier+sku, enforce size limit
  const seen = new Set<string>();
  const merged: SupplierProduct[] = [];

  for (const product of [...allResults, ...meiliResults]) {
    if (merged.length >= MAX_MERGED_RESULTS) break;
    const key = `${product.supplier}:${product.sku}`;
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

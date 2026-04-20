import crypto from "node:crypto";
import { redis } from "../lib/redis.js";
import { CACHE_TTL } from "../config.js";
import { logger } from "../lib/logger.js";

type CacheNamespace = "tecdoc" | "search" | "pricing" | "stock" | "catalog" | "brands" | "categories";

const TTL_MAP: Record<CacheNamespace, number> = {
  tecdoc: CACHE_TTL.TECDOC,
  search: CACHE_TTL.SEARCH,
  pricing: CACHE_TTL.PRICING,
  stock: CACHE_TTL.STOCK,
  // Catalog listings (finalized, products): short TTL — pricing/stock changes fast
  catalog: 60,
  // Brands: change rarely
  brands: 600,
  // Categories: change rarely
  categories: 600,
};

const MAX_KEYS_PER_DELETE = 100;

function buildKey(namespace: CacheNamespace, parts: string[]): string {
  return `oem:${namespace}:${parts.join(":")}`;
}

export async function cacheGet<T>(namespace: CacheNamespace, parts: string[]): Promise<T | null> {
  try {
    const key = buildKey(namespace, parts);
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    logger.warn({ err, namespace }, "Cache get failed");
    return null;
  }
}

export async function cacheSet<T>(
  namespace: CacheNamespace,
  parts: string[],
  value: T
): Promise<void> {
  const key = buildKey(namespace, parts);
  const ttl = TTL_MAP[namespace];
  await redis.setex(key, ttl, JSON.stringify(value));
}

export async function cacheInvalidate(namespace: CacheNamespace, parts: string[]): Promise<void> {
  const key = buildKey(namespace, parts);
  await redis.del(key);
}

/**
 * Hash a query object into a short stable key fragment.
 * Lets callers cache arbitrary parameterized requests without inventing
 * a key scheme per route.
 */
export function hashQuery(params: Record<string, unknown>): string {
  const normalized = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k] ?? ""}`)
    .join("&");
  return crypto.createHash("sha1").update(normalized).digest("hex").slice(0, 16);
}

/**
 * get-or-compute helper — cached within the given namespace/parts.
 * Swallows Redis failures and falls through to the computation so a
 * broken cache never turns into a downed endpoint.
 */
export async function cacheWrap<T>(
  namespace: CacheNamespace,
  parts: string[],
  compute: () => Promise<T>
): Promise<T> {
  try {
    const hit = await cacheGet<T>(namespace, parts);
    if (hit !== null) return hit;
  } catch {
    /* fall through — Redis issue shouldn't block the request */
  }
  const value = await compute();
  try {
    await cacheSet(namespace, parts, value);
  } catch {
    /* best-effort write */
  }
  return value;
}

export async function cacheInvalidatePattern(namespace: CacheNamespace, pattern: string): Promise<void> {
  const fullPattern = `oem:${namespace}:${pattern}`;
  let cursor = "0";
  let totalDeleted = 0;

  do {
    const [nextCursor, keys] = await redis.scan(cursor, "MATCH", fullPattern, "COUNT", 200);
    cursor = nextCursor;

    // Delete in safe-sized batches to avoid exceeding command limits
    for (let i = 0; i < keys.length; i += MAX_KEYS_PER_DELETE) {
      const batch = keys.slice(i, i + MAX_KEYS_PER_DELETE);
      if (batch.length > 0) {
        await redis.del(...batch);
        totalDeleted += batch.length;
      }
    }
  } while (cursor !== "0");

  if (totalDeleted > 0) {
    logger.info({ namespace, pattern, deleted: totalDeleted }, "Cache pattern invalidated");
  }
}

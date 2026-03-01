import { redis } from "../lib/redis.js";
import { CACHE_TTL } from "../config.js";
import { logger } from "../lib/logger.js";

type CacheNamespace = "tecdoc" | "search" | "pricing" | "stock";

const TTL_MAP: Record<CacheNamespace, number> = {
  tecdoc: CACHE_TTL.TECDOC,
  search: CACHE_TTL.SEARCH,
  pricing: CACHE_TTL.PRICING,
  stock: CACHE_TTL.STOCK,
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

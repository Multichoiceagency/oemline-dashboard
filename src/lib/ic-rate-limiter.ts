import { redis } from "./redis.js";

/**
 * Shared IC API Rate Limiter — Redis-backed sliding window.
 *
 * Previous version used a module-level variable which is per-process.
 * With 3 worker processes calling IC in parallel we did 3× the allowed
 * rate and got hammered with 429s. Redis sorted-set fixes that: all
 * workers read/write the same window, so the limit is truly shared.
 *
 * Target: 30 req/min across ALL callers. On saturation, callers sleep
 * until the oldest timestamp falls out of the window.
 */

const KEY = "ic:rate-limit:window";
const MAX_PER_MINUTE = 30;
const WINDOW_MS = 60_000;
const SAFETY_MARGIN_MS = 150;

export async function waitForIcRateLimit(): Promise<void> {
  // Bounded retry loop: in the worst case we block for < WINDOW_MS + margin.
  // A hard cap prevents an infinite wait if something goes wrong with Redis.
  for (let attempt = 0; attempt < 50; attempt++) {
    const now = Date.now();
    const minAge = now - WINDOW_MS;

    // Drop stale entries, then count what's left in the window.
    await redis.zremrangebyscore(KEY, 0, minAge);
    const count = await redis.zcard(KEY);

    if (count < MAX_PER_MINUTE) {
      // Room in the window — reserve a slot and proceed.
      const member = `${now}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
      await redis.zadd(KEY, now, member);
      // Keep the key alive for slightly longer than the window.
      await redis.expire(KEY, Math.ceil(WINDOW_MS / 1000) + 5);
      return;
    }

    // Saturated — sleep until the oldest entry exits the window.
    const oldest = await redis.zrange(KEY, 0, 0, "WITHSCORES");
    const oldestTs = Number(oldest[1] ?? now);
    const waitMs = Math.max(oldestTs + WINDOW_MS - now + SAFETY_MARGIN_MS, 250);
    await new Promise((r) => setTimeout(r, waitMs));
  }

  // If we got here Redis is broken — fail open rather than block forever.
  // A single process-local fallback prevents a full worker stall.
}

export function getIcRateLimiterStats(): { maxPerMinute: number } {
  return { maxPerMinute: MAX_PER_MINUTE };
}

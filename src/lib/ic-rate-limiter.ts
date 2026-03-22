import { logger } from "./logger.js";

/**
 * Shared IC API Rate Limiter
 *
 * Target: 30 req/min = 1 request every 2 seconds.
 * Simple fixed interval — no bursts, no 429s.
 * All IC API calls across all workers MUST go through this limiter.
 */

const MIN_INTERVAL_MS = 2_000;     // 2s between requests = 30 req/min
const MAX_REQUESTS_PER_MINUTE = 30;

let lastRequestTime = 0;

/**
 * Wait until we can make an IC API request without exceeding the rate limit.
 * Call this BEFORE every IC API fetch.
 */
export async function waitForIcRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;

  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise(r => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }

  lastRequestTime = Date.now();
}

/**
 * Get current rate limiter stats (for monitoring/logging).
 */
export function getIcRateLimiterStats(): { maxPerMinute: number } {
  return {
    maxPerMinute: MAX_REQUESTS_PER_MINUTE,
  };
}

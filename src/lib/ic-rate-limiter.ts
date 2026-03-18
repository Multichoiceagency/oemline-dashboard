import { logger } from "./logger.js";

/**
 * Shared IC API Rate Limiter
 *
 * IC API limit: 600 requests per minute.
 * We use a simple sliding window token bucket in-memory.
 * All IC API calls across all workers in the same process
 * MUST go through this limiter.
 *
 * Target: 8 req/sec (480 req/min) — leaves 20% headroom.
 */

const MAX_REQUESTS_PER_MINUTE = 480; // 80% of 600 limit
const WINDOW_MS = 60_000;
const MIN_INTERVAL_MS = 125; // 1000ms / 8 = 125ms per request

const timestamps: number[] = [];
let waiters = 0;

/**
 * Wait until we can make an IC API request without exceeding the rate limit.
 * Call this BEFORE every IC API fetch.
 */
export async function waitForIcRateLimit(): Promise<void> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const now = Date.now();

    // Remove timestamps older than the window
    while (timestamps.length > 0 && timestamps[0] < now - WINDOW_MS) {
      timestamps.shift();
    }

    // Check if we're under the limit
    if (timestamps.length < MAX_REQUESTS_PER_MINUTE) {
      // Also enforce minimum interval between requests
      const lastTs = timestamps.length > 0 ? timestamps[timestamps.length - 1] : 0;
      const elapsed = now - lastTs;

      if (elapsed < MIN_INTERVAL_MS) {
        await new Promise(r => setTimeout(r, MIN_INTERVAL_MS - elapsed));
      }

      timestamps.push(Date.now());
      return;
    }

    // We're at the limit — wait until the oldest request falls out of the window
    const oldestTs = timestamps[0];
    const waitMs = oldestTs + WINDOW_MS - now + 100; // +100ms buffer
    waiters++;

    if (waiters <= 1) {
      // Only log once to avoid spam
      logger.info({ waitMs, queuedRequests: timestamps.length }, "IC rate limit: waiting for slot");
    }

    await new Promise(r => setTimeout(r, Math.max(waitMs, 500)));
    waiters--;
  }
}

/**
 * Get current rate limiter stats (for monitoring/logging).
 */
export function getIcRateLimiterStats(): { requestsInWindow: number; maxPerMinute: number } {
  const now = Date.now();
  while (timestamps.length > 0 && timestamps[0] < now - WINDOW_MS) {
    timestamps.shift();
  }
  return {
    requestsInWindow: timestamps.length,
    maxPerMinute: MAX_REQUESTS_PER_MINUTE,
  };
}

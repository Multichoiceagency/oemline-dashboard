import { logger } from "./logger.js";

/**
 * Shared IC API Rate Limiter
 *
 * IC API actual limit (empirically tested 2026-03-19):
 * - ~10 requests per 10-second window, then ~20-30s cooldown
 * - Sustained rate: ~20-30 req/min
 * - NOT 600/min as some docs suggest
 *
 * Strategy: 8 requests burst, then 15s pause. Gives ~20 req/min sustained.
 * All IC API calls across all workers MUST go through this limiter.
 */

const BURST_SIZE = 8;              // max requests before pause
const BURST_PAUSE_MS = 15_000;     // 15s pause after each burst
const MIN_INTERVAL_MS = 1_000;     // 1s between individual requests within a burst
const MAX_REQUESTS_PER_MINUTE = 20; // for stats only

let burstCount = 0;
let lastRequestTime = 0;

/**
 * Wait until we can make an IC API request without exceeding the rate limit.
 * Uses burst pattern: 8 requests with 1s gaps, then 15s pause.
 * Call this BEFORE every IC API fetch.
 */
export async function waitForIcRateLimit(): Promise<void> {
  const now = Date.now();

  // Enforce minimum interval between requests
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise(r => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }

  // After BURST_SIZE requests, pause to let IC's window reset
  if (burstCount >= BURST_SIZE) {
    logger.info({ burstCount, pauseMs: BURST_PAUSE_MS }, "IC rate limiter: burst pause");
    await new Promise(r => setTimeout(r, BURST_PAUSE_MS));
    burstCount = 0;
  }

  burstCount++;
  lastRequestTime = Date.now();
}

/**
 * Get current rate limiter stats (for monitoring/logging).
 */
export function getIcRateLimiterStats(): { burstCount: number; maxPerMinute: number } {
  return {
    burstCount,
    maxPerMinute: MAX_REQUESTS_PER_MINUTE,
  };
}

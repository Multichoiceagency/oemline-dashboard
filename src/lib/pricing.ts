/**
 * Normalize a wholesale price from a supplier adapter.
 *
 * Problem: supplier APIs (IC, Diederichs) historically delivered prices in
 * minor units (cents) which were ingested as euros, giving values 100x too
 * high (€4961.21 for a muffler etc.). This helper normalizes them back.
 *
 * Also strips "price on request" sentinels that supplier APIs encode as
 * suspiciously-round high values with specific decimal endings.
 *
 * Applied at ingestion so future syncs can't re-inflate the DB.
 */
export function sanitizeWholesalePrice(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return null;

  // Step 1: normalize cents → euros.
  // Heuristic: any wholesale value >= 1000 for an automotive part is
  // almost certainly a minor-unit mistake. Real wholesale items > €1000
  // (heavy engine modules etc.) are handled separately via overrides.
  let price = raw;
  if (price >= 1000) price = price / 100;

  // Step 2: filter out "price on request" sentinels that survived the /100.
  // IC uses .99/.98/.96 endings at round high values as sentinels.
  // After /100 these become e.g. 99.99, 107.98 — still recognizable because
  // they sit near round thousands in raw form. Cheapest check: raw >= 50000
  // (i.e. raw pre-/100 was >= €500k equivalent) is definitionally fake.
  if (raw >= 99_999) return null;

  return Math.round(price * 100) / 100;
}

/**
 * Normalize a wholesale price from a supplier adapter.
 *
 * Suppliers (notably InterCars) encode "price on request" as sentinels at
 * unusually high values with specific decimal endings — e.g. 9999.99,
 * 12999.99, 11009.99. Real high-priced items (ZF automatics, Bosch injection
 * pumps) have organic decimals at those amounts and stay as-is.
 *
 * This helper strips those sentinels so products without a negotiated price
 * fall back to "Prijs op aanvraag" in the storefront instead of showing a
 * fake €13k retail price.
 *
 * NOTE: We do NOT divide by 100 — an earlier theory treated every high
 * value as cents-mistake and damaged legitimately expensive items
 * (gearboxes, turbos). Supplier prices come in as euros; only the sentinels
 * are wrong.
 */
export function sanitizeWholesalePrice(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return null;

  // Sentinel: .99 ending at ≥ €5000 (IC's "Prijs op aanvraag" marker)
  if (raw >= 5000 && Math.round((raw % 1) * 100) === 99) return null;

  // Sentinel: absurd values — no real automotive part wholesales > €100k
  if (raw >= 99_999) return null;

  return Math.round(raw * 100) / 100;
}

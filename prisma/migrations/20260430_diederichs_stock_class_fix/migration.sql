-- Diederichs DVSE returns Quantity/Value as a *stock-class indicator*
-- not as an exact count: 1, 10, 100, 1000, 10000, 100000, 1000000 are
-- category buckets meaning "≥ that many in stock". A live sample of
-- 800 Diederichs rows showed 99.9% land on a pure power of 10 — which
-- is statistically impossible for real inventory.
--
-- Clamp every Diederichs row whose stock is a pure power of 10 (≥ 10)
-- down to 1 — a safe binary in-stock indicator. The downstream UI shows
-- "X op voorraad" only when X > 1, so a value of 1 reads as a generic
-- "Op voorraad" badge without misrepresenting the real count.
--
-- Real low-volume inventory values (4, 7, 23, etc.) fall through unchanged.

UPDATE product_maps
SET stock = 1
WHERE supplier_id IN (SELECT id FROM suppliers WHERE LOWER(code) = 'diederichs')
  AND stock IS NOT NULL
  AND stock >= 10
  AND stock = POWER(10, ROUND(LOG(stock)::numeric)::integer);

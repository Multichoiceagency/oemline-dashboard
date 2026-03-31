---
sidebar_position: 11
title: Pricing
description: How product pricing is calculated from supplier base prices, margin, and tax.
---

# Pricing

Product prices are sourced from suppliers and transformed using configurable margin and tax settings before being exposed on the storefront.

## Price Sources

| Source | Lookup Key | Products |
|--------|-----------|----------|
| InterCars | IC SKU (`tow_kod`) from CSV mapping | Majority of catalog |
| DIEDERICHS | Supplier-specific API | DIEDERICHS-branded parts |
| VAN WEZEL | Supplier-specific API | VAN WEZEL-branded parts |

The pricing worker continuously fetches base prices from the relevant supplier for every product that has been matched to an IC SKU or supplier identifier.

## Price Calculation

Prices are calculated using margin and tax values stored in the application settings (see [Settings](./settings.md)).

```
priceWithMargin = basePrice * (1 + margin_percentage / 100)
priceWithTax    = priceWithMargin * (1 + tax_rate / 100)
```

With the current defaults (margin 31%, tax 21%):

```
basePrice       = 10.00
priceWithMargin = 10.00 * 1.31 = 13.10
priceWithTax    = 13.10 * 1.21 = 15.85
```

## Retrieving Current Settings

```bash
curl -X GET \
  https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/settings \
  -H "X-API-Key: your-api-key-here"
```

The response includes `marginPercentage` and `taxRate` among other fields. See the [Settings](./settings.md) page for the full response schema.

## Preview Pricing

Use the price-preview endpoint to see how a hypothetical base price would be transformed with the current settings:

```bash
curl -X GET \
  "https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/settings/price-preview" \
  -H "X-API-Key: your-api-key-here"
```

## Pricing Worker

The pricing worker runs continuously as a dedicated BullMQ process. It:

1. Iterates over all products that have an IC SKU.
2. Fetches the current base price from the supplier.
3. Stores the base price and recalculates `priceWithMargin` and `priceWithTax`.

Worker status can be monitored via the [Jobs](./jobs.md) endpoint.

## Notes

- Products without an IC SKU or supplier match have no pricing and are excluded from the [Finalized](./finalized.md) product list.
- Changing `marginPercentage` or `taxRate` in settings takes effect on the next pricing worker cycle.
- All prices are stored in the currency defined in settings (default: EUR).

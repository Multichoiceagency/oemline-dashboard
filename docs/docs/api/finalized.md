---
sidebar_position: 13
title: Finalized Products
description: Retrieve storefront-ready products with calculated pricing.
---

# Finalized Products

The finalized products endpoint returns products that are fully resolved and ready for the storefront. Only products with an IC SKU (and therefore pricing) are included.

## List Finalized Products

```
GET /finalized
```

Returns a paginated list of finalized products with calculated prices.

```bash
curl -X GET \
  "https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/finalized?page=1&limit=20" \
  -H "X-API-Key: your-api-key-here"
```

### Query Parameters

| Parameter | Type    | Default | Description |
|-----------|---------|---------|-------------|
| `page`    | integer | `1`     | Page number (1-indexed). |
| `limit`   | integer | `20`    | Items per page (max 100). |

### Response

```json
{
  "data": [
    {
      "id": "clx1abc...",
      "articleNumber": "1234567",
      "brand": "DIEDERICHS",
      "description": "Headlight left",
      "icSku": "TOW12345",
      "basePrice": 45.00,
      "priceWithMargin": 58.95,
      "priceWithTax": 71.33,
      "stock": 12,
      "imageUrl": "https://...",
      "tecdocId": 98765
    }
  ],
  "total": 4200,
  "page": 1,
  "limit": 20,
  "pricing": {
    "taxRate": 21,
    "marginPercentage": 31
  }
}
```

### Price Fields

| Field | Description |
|-------|-------------|
| `basePrice` | Raw supplier price (from InterCars or other supplier). |
| `priceWithMargin` | `basePrice * (1 + marginPercentage / 100)` |
| `priceWithTax` | `priceWithMargin * (1 + taxRate / 100)` |

The `pricing` object in the response reflects the margin and tax settings that were used for calculation. See [Pricing](./pricing.md) for details on the formula.

## Get Single Finalized Product

```
GET /finalized/:id
```

Returns a single finalized product by ID.

```bash
curl -X GET \
  https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/finalized/clx1abc... \
  -H "X-API-Key: your-api-key-here"
```

### Response

Returns the same product object structure as the list endpoint, without pagination wrapper fields.

## Notes

- Products without an IC SKU are excluded. Use the [Matching](./matching.md) endpoints to resolve unmatched products.
- Prices update automatically as the pricing worker processes new supplier data.
- The `pricing` object always reflects the current settings at the time of the request.

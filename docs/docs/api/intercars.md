---
sidebar_position: 8
title: InterCars Integration
description: InterCars API integration — OAuth2 authentication, stock, pricing, and SKU mapping.
---

# InterCars Integration

InterCars is a major European auto parts distributor. OEMline connects to InterCars for real-time stock availability and pricing. Because InterCars uses its own internal SKU format (TOW_KOD), a CSV mapping layer translates TecDoc article numbers to InterCars SKUs.

## InterCars API Details

| Setting | Value |
|---------|-------|
| Token URL | `https://is.webapi.intercars.eu/oauth2/token` |
| API Base | `https://api.webapi.intercars.eu/ic` |
| Auth | OAuth2 `client_credentials` with Basic Auth header |
| Scope | `allinone` |
| Accept-Language | Must be `en` (Dutch `nl` is **not** supported) |

### Authentication Flow

1. Encode `clientId:clientSecret` as Base64
2. POST to the token URL with `grant_type=client_credentials&scope=allinone`
3. Use the returned `access_token` as a Bearer token on all subsequent calls

Additional headers required per request:

| Header | Description |
|--------|-------------|
| `X-Customer-Id` | InterCars customer account ID |
| `X-Payer-Id` | InterCars payer account ID |
| `X-Branch` | Warehouse branch code |

### Stock API

```
GET /ic/inventory/stock?sku={TOW_KOD}
```

Query stock availability for one or more SKUs (max 30 per request).

### Pricing API

```
POST /ic/inventory/quote
```

Request body:

```json
{
  "lines": [
    { "sku": "TOW_KOD_HERE", "quantity": 1 }
  ]
}
```

Returns combined stock and pricing information per line item.

### Pricing Quote (Alternative)

```
POST /ic/pricing/quote
```

Same request body format as inventory quote. Returns pricing-only data.

## IC CSV Mapping

InterCars does not use TecDoc article numbers directly. A CSV mapping file (~565,000 rows) provides the translation:

| CSV Field | Description |
|-----------|-------------|
| `TOW_KOD` | InterCars internal SKU |
| `articleNumber` | Manufacturer article number |
| `manufacturer` | Brand name in IC system |
| `tecdocProd` | TecDoc data supplier ID (when available) |
| `ean` | EAN barcode |

The matching engine normalizes both article numbers and brand names (stripping special characters, case-insensitive) and supports exact and prefix-based brand matching. There are **97 unique brands** in the IC CSV.

## Internal Endpoints

### IC SKU Stats

```
GET /api/intercars/ic-sku-stats
```

Returns a quick overview of how many active products have been matched to InterCars SKUs.

```bash
curl -H "X-API-Key: YOUR_KEY" \
  "https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/intercars/ic-sku-stats"
```

```json
{
  "icMappings": 565006,
  "matched": 98420,
  "unmatched": 20100,
  "total": 118520,
  "matchRate": "83.0%"
}
```

### Match Overview

```
GET /api/intercars/match-overview
```

Detailed breakdown of IC matching by brand, including match rates and sample unmatched products.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | `1` | Page number |
| `limit` | integer | `20` | Brands per page |

```bash
curl -H "X-API-Key: YOUR_KEY" \
  "https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/intercars/match-overview?limit=5"
```

### Unmatched Products

```
GET /api/intercars/unmatched-products
```

Lists products that have no InterCars SKU match.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | `1` | Page number |
| `limit` | integer | `50` | Items per page |
| `brand` | string | -- | Filter by brand name |

```bash
curl -H "X-API-Key: YOUR_KEY" \
  "https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/intercars/unmatched-products?brand=BOSCH&limit=10"
```

### Manual Match

```
POST /api/intercars/manual-match
```

Manually assign an InterCars SKU to a product.

```bash
curl -X POST \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "productMapId": 12345, "icSku": "ABR05200070" }' \
  "https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/intercars/manual-match"
```

### Bulk Manual Match

```
POST /api/intercars/manual-match-bulk
```

Assign InterCars SKUs to multiple products at once.

```bash
curl -X POST \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "matches": [
      { "productMapId": 12345, "icSku": "ABR05200070" },
      { "productMapId": 12346, "icSku": "ABR05200071" }
    ]
  }' \
  "https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/intercars/manual-match-bulk"
```

### Lookup IC Mapping

```
GET /api/intercars/lookup
```

Find InterCars CSV mapping entries for a given brand and article number.

| Parameter | Type | Description |
|-----------|------|-------------|
| `brand` | string | Brand name |
| `articleNo` | string | Manufacturer article number |

```bash
curl -H "X-API-Key: YOUR_KEY" \
  "https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/intercars/lookup?brand=BOSCH&articleNo=0986479331"
```

```json
{
  "items": [
    {
      "towKod": "BOS0986479331",
      "icIndex": "BOS",
      "articleNumber": "0986479331",
      "manufacturer": "BOSCH",
      "description": "Brake Disc",
      "ean": "4047024728301"
    }
  ]
}
```

### Unmatched Brands

```
GET /api/intercars/unmatched-brands
```

Lists all 97 IC CSV brands and shows which ones have no alias or match in the local brands table.

```bash
curl -H "X-API-Key: YOUR_KEY" \
  "https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/intercars/unmatched-brands"
```

### Brand Aliases

```
GET /api/intercars/brand-aliases
POST /api/intercars/brand-aliases
DELETE /api/intercars/brand-aliases/:id
POST /api/intercars/brand-aliases/seed
POST /api/intercars/brand-aliases/auto
```

Manage brand name mappings between IC CSV manufacturer names and local brand names. The `seed` endpoint populates common aliases, and `auto` attempts automatic fuzzy matching.

## Notes

- The IC match worker (`ic-match` queue) runs every 2 hours per supplier and handles Phases 0 through 1D of the matching pipeline.
- Pricing and stock are fetched by dedicated workers (`pricing` and `stock` queues) running at 6x concurrency.
- The IC CSV sync worker automatically downloads updated CSV files daily.

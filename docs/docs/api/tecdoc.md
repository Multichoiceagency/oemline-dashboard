---
sidebar_position: 7
title: TecDoc Integration
description: TecDoc Pegasus 3.0 API integration — product search, brand sync, and catalog import.
---

# TecDoc Integration

OEMline uses the TecDoc Pegasus 3.0 API as its primary product catalog source. TecDoc provides standardized auto parts data including article numbers, OEM cross-references, EAN codes, vehicle linkages, and assembly group categorization.

## TecDoc API Details

| Setting | Value |
|---------|-------|
| URL | `https://webservice.tecalliance.services/pegasus-3-0/services/TecdocToCatDLB.jsonEndpoint` |
| Auth | `X-Api-Key` header |
| Provider ID | `22691` |
| Protocol | JSON POST |

### Key TecDoc Methods

| Method | Purpose |
|--------|---------|
| `getArticles` | Search and retrieve product data |
| `dataSupplierFacetOptions` | List all brands (data suppliers) in catalog scope |
| `assemblyGroupFacetOptions` | Discover the category tree for partitioned syncing |

### Sync Strategy

The sync worker discovers categories via `assemblyGroupFacetOptions` (which returns a nested tree), then paginates each assembly group individually. TecDoc enforces a maximum of **100 pages per query** (10,000 items), so partitioning by assembly group is required to reach the full catalog.

## Internal Endpoints

### Search Products

```
GET /api/tecdoc/search
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `q` | string | *required* | Search query |
| `type` | string | `text` | Search mode: `article`, `oem`, `ean`, or `text` |
| `brandId` | integer | -- | Filter by TecDoc brand/data supplier ID |
| `page` | integer | `1` | Page number (text search only) |
| `limit` | integer | `25` | Results per page, max 100 (text search only) |

```bash
curl -H "X-API-Key: YOUR_KEY" \
  "https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/tecdoc/search?q=1J0615301&type=article"
```

```json
{
  "articles": [
    {
      "tecdocId": "10345678",
      "articleNumber": "1J0615301",
      "brand": "TRW",
      "description": "Brake Disc",
      "ean": "4006633356220",
      "oemNumbers": ["1J0615301", "1J0615301A"]
    }
  ],
  "total": 1
}
```

### Get Vehicle Linkages

```
GET /api/tecdoc/linkages
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `articleId` | integer | TecDoc article ID |
| `articleNumber` | string | TecDoc article number (alternative to articleId) |

One of `articleId` or `articleNumber` is required.

```bash
curl -H "X-API-Key: YOUR_KEY" \
  "https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/tecdoc/linkages?articleNumber=1J0615301"
```

### Get Article Details

```
GET /api/tecdoc/details
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `articleNumber` | string | *required* — TecDoc article number |

```bash
curl -H "X-API-Key: YOUR_KEY" \
  "https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/tecdoc/details?articleNumber=1J0615301"
```

Returns full article details including description, technical attributes, OEM numbers, and images. Returns `404` if the article is not found.

### Populate Products

```
POST /api/tecdoc/populate
```

Searches TecDoc for the given queries and upserts results into the local product database.

```bash
curl -X POST \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "queries": ["1J0615301", "DF4381"] }' \
  "https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/tecdoc/populate"
```

```json
{
  "imported": 3,
  "updated": 1,
  "total": 4
}
```

Accepts up to 100 queries per call. Each query is searched by both article number and OEM number.

### Sync Brands

```
POST /api/tecdoc/sync-brands
```

Fetches all data suppliers (brands) from TecDoc and upserts them into the local brands table. Brands not present in TecDoc and having no linked products are deleted.

```bash
curl -X POST \
  -H "X-API-Key: YOUR_KEY" \
  "https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/tecdoc/sync-brands"
```

```json
{
  "fetched": 342,
  "upserted": 342,
  "deleted": 5,
  "totalInDb": 342,
  "brands": [
    { "id": 54, "name": "BOSCH" },
    { "id": 82, "name": "TRW" }
  ]
}
```

The `brands` array in the response shows the first 20 fetched entries as a preview.

## Notes

- TecDoc Pegasus 3.0 does **not** have a `getBrands` endpoint. Brands are retrieved via `dataSupplierFacetOptions`.
- The `assemblyGroupFacets` response is a **nested tree**, not a flat array. The sync worker recursively flattens it.
- Article country is set to `NL` (Netherlands) for all requests.

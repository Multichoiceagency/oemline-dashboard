---
sidebar_position: 12
title: Matching
description: Product matching engine — IC SKU resolution, match phases, and manual override endpoints.
---

# Matching

The matching engine links TecDoc catalog products to InterCars (IC) SKUs so that pricing and stock can be retrieved. It uses a 5-priority strategy with multiple automated phases and manual override capabilities.

## Match Priority

Matches are resolved in descending priority order. The first successful match wins.

| Priority | Strategy | Description |
|----------|----------|-------------|
| 1 | **Override** | Manual match set by an operator via the dashboard or API. |
| 2 | **tecdocId** | Direct lookup by TecDoc article ID. |
| 3 | **EAN** | Match on European Article Number barcode. |
| 4 | **Brand + Article** | Normalized brand name combined with article number. |
| 5 | **OEM** | Original Equipment Manufacturer cross-reference number. |

## IC CSV Mapping

The primary data source for automated matching is a CSV file containing approximately 565,000 rows that map `brand + articleNumber` to IC's internal `TOW_KOD` (SKU). Article numbers are normalized (lowercased, whitespace and special characters stripped) before comparison.

## Match Phases

The `ic-match` worker runs every 2 hours and executes the following phases in order:

| Phase | Name | Description |
|-------|------|-------------|
| 0 | Direct | Exact match on `tecdocId` + `articleNumber`. |
| 1A | Brand alias | Resolves known brand aliases before matching. |
| 1B | Normalized | Strips hyphens, spaces, and casing differences. |
| 1C | Fuzzy | Applies Levenshtein-distance tolerance for near-matches. |
| 1D | Extended | Additional normalization heuristics. |
| 2A | OEM lookup | Cross-references OEM numbers from TecDoc data. |
| 2B | Leading-zero strip | Removes leading zeros from article numbers. |
| 2C | OEM extended | Combined OEM + normalization strategies. |

## Endpoints

### Match Overview

Returns aggregate statistics on matched vs. unmatched products.

```bash
curl -X GET \
  https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/intercars/match-overview \
  -H "X-API-Key: your-api-key-here"
```

### Unmatched Products

Paginated list of products that have not yet been matched to an IC SKU.

```bash
curl -X GET \
  "https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/intercars/unmatched-products?page=1&limit=20" \
  -H "X-API-Key: your-api-key-here"
```

### Manual Match (Single)

Manually assign an IC SKU to a specific product, creating a priority-1 override.

```bash
curl -X POST \
  https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/intercars/manual-match \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "productId": "clx1abc...",
    "icSku": "TOW12345"
  }'
```

### Manual Match (Bulk)

Assign IC SKUs to multiple products in a single request.

```bash
curl -X POST \
  https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/intercars/manual-match-bulk \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "matches": [
      { "productId": "clx1abc...", "icSku": "TOW12345" },
      { "productId": "clx2def...", "icSku": "TOW67890" }
    ]
  }'
```

### Match Logs

Query the trace log for match attempts. Use `matched=false` to find products that failed all phases.

```bash
curl -X GET \
  "https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/trace/logs?matched=false&page=1&limit=20" \
  -H "X-API-Key: your-api-key-here"
```

## Notes

- Manual overrides (priority 1) always take precedence over automated matches.
- The ic-match worker is isolated from TecDoc sync and runs on its own BullMQ queue.
- Match statistics are available in the dashboard and via the match-overview endpoint.

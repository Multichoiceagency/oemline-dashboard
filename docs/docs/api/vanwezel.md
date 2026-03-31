---
sidebar_position: 10
title: VAN WEZEL Integration
description: VAN WEZEL REST API integration — JWT authentication, stock, and pricing queries.
---

# VAN WEZEL Integration

VAN WEZEL is a European auto body parts supplier with its own REST API. OEMline connects directly to VAN WEZEL for real-time stock and pricing. Catalog data is imported separately.

## API Details

| Setting | Value |
|---------|-------|
| Base URL | `https://vwa.autopartscat.com/WcfVWAService/WcfVWAService/VWAService.svc` |
| Protocol | REST / JSON |
| Adapter Type | `vanwezel` |
| Products | 54,000+ |
| Concurrency | 10 parallel requests |
| Auth | Service Basic Auth + customer JWT |

## Authentication Flow

VAN WEZEL uses a two-layer authentication system:

1. **Service-level Basic Auth** -- a fixed credential included on the login request
2. **Customer JWT** -- obtained by posting customer credentials, valid for 24 hours (cached for 20 hours)

### Login

```
POST /Login
```

Headers:
- `Authorization: Basic {service_credentials}`
- `Content-Type: application/json`

Body:

```json
{
  "usname": "YOUR_USERNAME",
  "pwd": "YOUR_PASSWORD"
}
```

Returns a JWT token string used for all subsequent requests.

### Get Stock and Price

```
GET /getstock?productid={ARTICLE_ID}
```

Headers:
- `Authorization: {jwt_token}`

```json
{
  "Stock": {
    "ArticleId": "0620849",
    "Qty": "15",
    "Price": "42.50",
    "Success": 1,
    "ErrorMessage": null
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `ArticleId` | string | VAN WEZEL article number |
| `Qty` | string | Available quantity |
| `Price` | string | Unit price in EUR |
| `Success` | number | `1` = success, `0` = not found |

The `getstock` endpoint returns both stock and pricing in a single call.

## Batch Processing

The adapter processes stock/price queries in parallel batches of 10 with a 100ms delay between batches to respect rate limits.

```bash
# Check a single product via the supplier stock worker
curl -H "X-API-Key: YOUR_KEY" \
  "https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/suppliers/5/sync"
```

## Internal Usage

VAN WEZEL products are managed through the standard supplier endpoints:

```bash
# List VAN WEZEL as a supplier
curl -H "X-API-Key: YOUR_KEY" \
  "https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/suppliers?active=true"

# Trigger sync
curl -X POST \
  -H "X-API-Key: YOUR_KEY" \
  "https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/suppliers/5/sync"
```

The pricing and stock workers call `getstock` per article in parallel (10 concurrent) and store both price and quantity from the single response.

## Capabilities

| Feature | Available | Source |
|---------|-----------|--------|
| Stock | Yes | REST API (real-time) |
| Pricing | Yes | REST API (real-time, via getstock) |
| Product search | No | Separate catalog import |
| Catalog sync | No | Separate catalog import |

## Notes

- Credentials are stored encrypted in the supplier record as `username:password` format.
- VAN WEZEL has its own pricing independent of InterCars.
- The JWT token is valid for 24 hours but is refreshed proactively after 20 hours to avoid expiry during long-running batch jobs.
- Product catalog data is imported from a separate FTP/catalog file, not from the REST API.

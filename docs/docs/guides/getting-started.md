---
sidebar_position: 1
title: Getting Started
description: Quick start guide for the OEMline API — stack overview, first requests, and common workflows.
---

# Getting Started

This guide walks you through making your first requests to the OEMline API.

## Stack Overview

OEMline is built on the following technologies:

| Component | Technology | Purpose |
|-----------|-----------|---------|
| API Server | Fastify | REST API framework |
| Database | PostgreSQL + Prisma | Product data, settings, match records |
| Cache | Redis | Session cache, BullMQ job broker |
| Search | Meilisearch | Full-text product search and filtering |
| Workers | BullMQ | Background jobs for sync, matching, pricing, stock |

## Base URL

All API requests use:

```
https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api
```

## Authentication

All endpoints except `/health` require an `X-API-Key` header. See [Authentication](/docs/api/authentication) for details.

```
X-API-Key: your-api-key-here
```

## Quick Start

### 1. Verify the API is Running

The health endpoint does not require authentication:

```bash
curl https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/health
```

Expected response:

```json
{
  "status": "ok"
}
```

### 2. List Brands

Retrieve the first page of brands in the catalog:

```bash
curl -X GET \
  "https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/brands?page=1&limit=10" \
  -H "X-API-Key: your-api-key-here"
```

### 3. Browse Finalized Products

Retrieve storefront-ready products with calculated pricing:

```bash
curl -X GET \
  "https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/finalized?page=1&limit=10" \
  -H "X-API-Key: your-api-key-here"
```

### 4. Check Worker Status

See the state of all background job queues:

```bash
curl -X GET \
  https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/jobs/status \
  -H "X-API-Key: your-api-key-here"
```

## Common Workflows

### Viewing Unmatched Products

Products that have not been matched to an IC SKU will not appear in the finalized list. To find and resolve them:

1. Check the [match overview](/docs/api/matching#match-overview) for aggregate statistics.
2. List [unmatched products](/docs/api/matching#unmatched-products) to see specific items.
3. Use [manual match](/docs/api/matching#manual-match-single) to assign IC SKUs where automated matching fails.

### Adjusting Pricing

1. Review current settings via `GET /settings` ([Settings](/docs/api/settings)).
2. Update margin or tax with `PATCH /settings`.
3. Preview the effect with `GET /settings/price-preview`.
4. The pricing worker will apply the new values on its next cycle.

## Next Steps

- [API Overview](/docs/api/overview) -- response format, pagination, and error handling.
- [Authentication](/docs/api/authentication) -- obtaining and using API keys.
- [Pricing](/docs/api/pricing) -- how prices are calculated from supplier data.
- [Matching](/docs/api/matching) -- how products are linked to supplier SKUs.

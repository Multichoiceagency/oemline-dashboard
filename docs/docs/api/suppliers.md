---
sidebar_position: 6
title: Suppliers
description: Manage supplier integrations — list, create, update, and trigger sync jobs.
---

# Suppliers

Suppliers are the external data sources that feed products, pricing, and stock into OEMline. Each supplier has an adapter type that determines how the system communicates with it.

## Current Suppliers

| Name | Code | Adapter Type | Status |
|------|------|-------------|--------|
| TecDoc | `tecdoc` | `tecdoc` | Active |
| InterCars | `intercars` | `intercars` | Active |
| DIEDERICHS | `diederichs` | `diederichs` | Active |
| VAN WEZEL | `vanwezel` | `vanwezel` | Active |
| PartsPoint | `partspoint` | `partspoint` | Inactive |

## List Suppliers

```
GET /api/suppliers
```

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | `1` | Page number (1-indexed) |
| `limit` | integer | `50` | Items per page (max 100) |
| `active` | string | `all` | Filter by status: `true`, `false`, or `all` |

### Example

```bash
curl -H "X-API-Key: YOUR_KEY" \
  "https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/suppliers?active=true"
```

### Response

```json
{
  "items": [
    {
      "id": 1,
      "name": "TecDoc",
      "code": "tecdoc",
      "adapterType": "tecdoc",
      "baseUrl": "https://webservice.tecalliance.services/pegasus-3-0/services/TecdocToCatDLB.jsonEndpoint",
      "priority": 1,
      "active": true,
      "createdAt": "2025-01-15T10:00:00.000Z",
      "updatedAt": "2025-06-20T08:30:00.000Z",
      "_count": {
        "productMaps": 118420,
        "unmatched": 312,
        "overrides": 45
      }
    }
  ],
  "total": 5,
  "page": 1,
  "limit": 50,
  "totalPages": 1
}
```

Results are ordered by `priority` (ascending), then `name`.

## Create Supplier

```
POST /api/suppliers
```

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Display name (max 200 chars) |
| `code` | string | Yes | Unique identifier (`a-z`, `0-9`, `-`, `_`, max 50 chars) |
| `adapterType` | string | Yes | Adapter implementation to use |
| `baseUrl` | string | Yes | Supplier API base URL |
| `credentials` | object | No | Key-value pairs (stored encrypted) |
| `priority` | integer | No | Sort priority, 1-1000 (default: 100) |
| `active` | boolean | No | Enable immediately (default: true) |

### Example

```bash
curl -X POST \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "New Supplier",
    "code": "newsupplier",
    "adapterType": "generic",
    "baseUrl": "https://api.newsupplier.com/v1",
    "credentials": { "apiKey": "sk_live_xxx" },
    "priority": 50,
    "active": true
  }' \
  "https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/suppliers"
```

### Response (201)

```json
{
  "id": 6,
  "name": "New Supplier",
  "code": "newsupplier",
  "adapterType": "generic",
  "baseUrl": "https://api.newsupplier.com/v1",
  "priority": 50,
  "active": true,
  "message": "Supplier created successfully"
}
```

Returns `409` if a supplier with the same `code` already exists.

## Update Supplier

```
PATCH /api/suppliers/:id
```

All fields are optional. Only provided fields are updated.

### Request Body

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name |
| `adapterType` | string | Adapter implementation |
| `baseUrl` | string | API base URL |
| `credentials` | object | Key-value pairs (re-encrypted on save) |
| `priority` | integer | Sort priority, 1-1000 |
| `active` | boolean | Enable or disable the supplier |

### Example

```bash
curl -X PATCH \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "active": false }' \
  "https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/suppliers/3"
```

### Response

```json
{
  "id": 3,
  "name": "PartsPoint",
  "code": "partspoint",
  "adapterType": "partspoint",
  "baseUrl": "https://api.partspoint.com",
  "priority": 100,
  "active": false,
  "message": "Supplier updated successfully"
}
```

## Trigger Sync

```
POST /api/suppliers/:id/sync
```

Queues a background sync job for the supplier. The supplier must be active.

### Example

```bash
curl -X POST \
  -H "X-API-Key: YOUR_KEY" \
  "https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/suppliers/1/sync"
```

### Response (202)

```json
{
  "message": "Sync job queued",
  "jobId": "sync-tecdoc-1711800000000",
  "supplier": "tecdoc"
}
```

Returns `400` if the supplier is inactive.

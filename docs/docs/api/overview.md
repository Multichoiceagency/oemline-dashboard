---
sidebar_position: 1
title: API Overview
description: OEMline REST API base URL, response format, pagination, rate limiting, and error handling.
---

# API Overview

The OEMline API provides programmatic access to the auto parts platform. It exposes endpoints for product search, supplier data, pricing, stock, and administrative operations.

## Base URL

All API requests use the following base URL:

```
https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api
```

## Response Format

Every response is returned as **JSON** with the `Content-Type: application/json` header.

Successful responses typically follow this structure:

```json
{
  "data": [ ... ],
  "total": 128,
  "page": 1,
  "limit": 20
}
```

Singleton resources omit the pagination fields and return the object directly under `data`.

## Health Check

The health endpoint is the only route that does **not** require authentication.

```
GET /health
```

```bash
curl https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/health
```

```json
{
  "status": "ok"
}
```

Use this endpoint to verify the API is reachable before making authenticated requests.

## Authentication

All other endpoints require an `X-API-Key` header. See the [Authentication](./authentication.md) page for details.

## Rate Limiting

Requests are limited to **100 requests per minute** per API key. When the limit is exceeded the API responds with HTTP `429 Too Many Requests`:

```json
{
  "statusCode": 429,
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Try again in 60 seconds."
}
```

## Pagination

List endpoints accept the following query parameters:

| Parameter | Type    | Default | Description                          |
|-----------|---------|---------|--------------------------------------|
| `page`    | integer | `1`     | Page number (1-indexed).             |
| `limit`   | integer | `20`    | Number of items per page (max 100).  |

Example:

```
GET /api/storefront/products?page=2&limit=50
```

The response includes `total`, `page`, and `limit` fields so clients can calculate the total number of pages.

## Error Format

All error responses share a consistent structure:

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "\"limit\" must be a positive integer"
}
```

### Common Status Codes

| Code  | Meaning               |
|-------|-----------------------|
| `200` | Success               |
| `201` | Resource created      |
| `400` | Bad request           |
| `401` | Unauthorized          |
| `404` | Resource not found    |
| `429` | Rate limit exceeded   |
| `500` | Internal server error |

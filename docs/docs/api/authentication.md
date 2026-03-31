---
sidebar_position: 2
title: Authentication
description: How to authenticate with the OEMline API using the X-API-Key header.
---

# Authentication

All API endpoints (except [`/health`](./overview.md#health-check)) require authentication via an API key.

## X-API-Key Header

Include your API key in the `X-API-Key` request header with every call:

```
X-API-Key: your-api-key-here
```

## Example Request

```bash
curl -X GET \
  https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/storefront/products?page=1&limit=10 \
  -H "X-API-Key: your-api-key-here"
```

A successful response returns the requested data with HTTP `200`.

## Invalid or Missing Key

If the API key is missing, empty, or invalid, the API responds with HTTP `401 Unauthorized`:

```json
{
  "statusCode": 401,
  "error": "Unauthorized",
  "message": "Invalid or missing API key"
}
```

## Obtaining an API Key

API keys are provisioned through the OEMline dashboard. Contact your administrator if you do not have one.

## Security Best Practices

- **Never expose your API key in client-side code** or public repositories.
- Store the key in environment variables or a secrets manager.
- Rotate keys periodically and revoke any that may have been compromised.

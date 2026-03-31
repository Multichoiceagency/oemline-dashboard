---
sidebar_position: 14
title: Brands
description: Manage auto parts brands — list, update, control storefront visibility, and sync logos.
---

# Brands

Manage the brands (data suppliers / manufacturers) in the catalog. Only brands that have associated products are returned by default.

## List Brands

```
GET /brands
```

Returns a paginated list of brands that have at least one product.

```bash
curl -X GET \
  "https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/brands?page=1&limit=20" \
  -H "X-API-Key: your-api-key-here"
```

### Query Parameters

| Parameter | Type    | Default | Description |
|-----------|---------|---------|-------------|
| `page`    | integer | `1`     | Page number. |
| `limit`   | integer | `20`    | Items per page (max 100). |

### Response

```json
{
  "data": [
    {
      "id": "clx1abc...",
      "name": "DIEDERICHS",
      "logoUrl": "https://...",
      "showOnStorefront": true,
      "productCount": 1250
    }
  ],
  "total": 97,
  "page": 1,
  "limit": 20
}
```

## Get Single Brand

```
GET /brands/:id
```

Returns a single brand with its top products.

```bash
curl -X GET \
  https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/brands/clx1abc... \
  -H "X-API-Key: your-api-key-here"
```

## Update Brand

```
PATCH /brands/:id
```

Update brand properties such as name, logo, or storefront visibility.

```bash
curl -X PATCH \
  https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/brands/clx1abc... \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "DIEDERICHS",
    "logoUrl": "https://cdn.example.com/diederichs.png",
    "showOnStorefront": true
  }'
```

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | No | Brand display name. |
| `logoUrl` | string | No | URL to the brand logo image. |
| `showOnStorefront` | boolean | No | Whether the brand appears on the storefront. |

## Bulk Set Storefront Visibility

```
POST /brands/set-storefront
```

Set `showOnStorefront` for multiple brands at once by name.

```bash
curl -X POST \
  https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/brands/set-storefront \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "names": ["DIEDERICHS", "VAN WEZEL", "ABAKUS"],
    "showOnStorefront": true
  }'
```

## Fetch Logos from TecDoc

```
POST /brands/fetch-logos
```

Triggers a sync that downloads brand logos from the TecDoc API and stores them. This is an asynchronous operation.

```bash
curl -X POST \
  https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/brands/fetch-logos \
  -H "X-API-Key: your-api-key-here"
```

## Notes

- The brand list only includes brands that have at least one product in the catalog.
- The InterCars CSV contains 97 distinct manufacturer brands.
- Logo sync fetches images from TecDoc and uploads them to MinIO storage.

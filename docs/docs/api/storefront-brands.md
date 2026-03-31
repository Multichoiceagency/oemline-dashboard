---
sidebar_position: 4
title: Storefront Brands
description: Retrieve brands visible on the OEMline storefront.
---

# Storefront Brands

Base URL: `https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api`

All storefront endpoints require the `X-API-Key` header.

---

## List Brands

```
GET /storefront/brands
```

Returns all brands that have `showOnStorefront` enabled. Currently 100 brands: 98 from InterCars, plus DIEDERICHS and VAN WEZEL.

### Example Request

```bash
curl -X GET \
  'https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/storefront/brands' \
  -H 'X-API-Key: YOUR_API_KEY'
```

### Example Response

```json
{
  "items": [
    {
      "id": "clx1brand001...",
      "name": "BOSCH",
      "code": "BOSCH",
      "logoUrl": "https://minio-yosss0scgggwcco0cw4s0ck4.oemline.eu/oemline/brands/bosch.png",
      "showOnStorefront": true,
      "productCount": 12450
    },
    {
      "id": "clx1brand002...",
      "name": "DIEDERICHS",
      "code": "DIEDERICHS",
      "logoUrl": "https://minio-yosss0scgggwcco0cw4s0ck4.oemline.eu/oemline/brands/diederichs.png",
      "showOnStorefront": true,
      "productCount": 8230
    },
    {
      "id": "clx1brand003...",
      "name": "VAN WEZEL",
      "code": "VAN_WEZEL",
      "logoUrl": "https://minio-yosss0scgggwcco0cw4s0ck4.oemline.eu/oemline/brands/van-wezel.png",
      "showOnStorefront": true,
      "productCount": 6100
    }
  ],
  "total": 100
}
```

### Response Fields

| Field              | Type    | Description |
|-------------------|---------|-------------|
| `id`               | string  | Brand ID |
| `name`             | string  | Display name |
| `code`             | string  | Unique brand code (use for filtering products) |
| `logoUrl`          | string  | URL to the brand logo (may be `null`) |
| `showOnStorefront` | boolean | Always `true` in this endpoint |
| `productCount`     | integer | Number of products for this brand |

### Error Responses

| Status | Description |
|--------|-------------|
| `401`  | Missing or invalid API key |

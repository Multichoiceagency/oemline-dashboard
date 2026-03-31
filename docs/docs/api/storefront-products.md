---
sidebar_position: 3
title: Storefront Products
description: Product listing, detail, and lookup endpoints for the OEMline storefront.
---

# Storefront Products

Base URL: `https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api`

All storefront endpoints require the `X-API-Key` header.

---

## List Products

```
GET /storefront/products
```

Returns a paginated list of products available on the storefront.

### Query Parameters

| Parameter    | Type    | Default     | Description |
|-------------|---------|-------------|-------------|
| `page`       | integer | `1`         | Page number |
| `limit`      | integer | `25`        | Items per page (max 100) |
| `q`          | string  | -           | Full-text search across article number, EAN, OEM, and description |
| `brand`      | string  | -           | Filter by brand code |
| `category`   | string  | -           | Filter by category code |
| `categoryId` | string  | -           | Filter by category ID |
| `supplier`   | string  | -           | Filter by supplier code |
| `minPrice`   | number  | -           | Minimum price filter |
| `maxPrice`   | number  | -           | Maximum price filter |
| `inStock`    | boolean | -           | Only show products in stock (`true`) or out of stock (`false`) |
| `hasPrice`   | boolean | -           | Only show products with a price (`true`) or without (`false`) |
| `sort`       | string  | `newest`    | Sort order (see below) |

### Sort Options

| Value        | Description |
|-------------|-------------|
| `price_asc`  | Price low to high |
| `price_desc` | Price high to low |
| `name_asc`   | Name A-Z |
| `name_desc`  | Name Z-A |
| `newest`     | Newest first |
| `updated`    | Recently updated first |

### Example Request

```bash
curl -X GET \
  'https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/storefront/products?page=1&limit=10&brand=BOSCH&inStock=true&sort=price_asc' \
  -H 'X-API-Key: YOUR_API_KEY'
```

### Example Response

```json
{
  "items": [
    {
      "id": "clx1abc2d0001...",
      "articleNo": "0986479C30",
      "sku": "BOSCH-0986479C30",
      "ean": "4047025683975",
      "oem": "1K0615301AA",
      "description": "Brake Disc",
      "price": 42.50,
      "stock": 15,
      "brand": {
        "name": "BOSCH",
        "code": "BOSCH"
      },
      "category": {
        "name": "Brake Discs",
        "code": "brake-discs"
      },
      "supplier": {
        "name": "InterCars",
        "code": "intercars"
      },
      "images": [
        "https://minio-yosss0scgggwcco0cw4s0ck4.oemline.eu/oemline/products/0986479C30.jpg"
      ],
      "icSku": "BOS0986479C30"
    }
  ],
  "total": 1243,
  "page": 1,
  "limit": 10
}
```

---

## Get Product Detail

```
GET /storefront/products/:id
```

Returns the full detail for a single product.

### Path Parameters

| Parameter | Type   | Description |
|-----------|--------|-------------|
| `id`      | string | Product ID  |

### Example Request

```bash
curl -X GET \
  'https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/storefront/products/clx1abc2d0001' \
  -H 'X-API-Key: YOUR_API_KEY'
```

### Example Response

```json
{
  "id": "clx1abc2d0001...",
  "articleNo": "0986479C30",
  "sku": "BOSCH-0986479C30",
  "ean": "4047025683975",
  "oem": "1K0615301AA",
  "description": "Brake Disc",
  "price": 42.50,
  "stock": 15,
  "brand": {
    "name": "BOSCH",
    "code": "BOSCH"
  },
  "category": {
    "name": "Brake Discs",
    "code": "brake-discs"
  },
  "supplier": {
    "name": "InterCars",
    "code": "intercars"
  },
  "images": [
    "https://minio-yosss0scgggwcco0cw4s0ck4.oemline.eu/oemline/products/0986479C30.jpg"
  ],
  "icSku": "BOS0986479C30"
}
```

---

## Lookup Product

```
GET /storefront/lookup
```

Look up a product by one of several identifiers. Provide exactly one of the query parameters.

### Query Parameters

| Parameter   | Type   | Description |
|-------------|--------|-------------|
| `articleNo` | string | Manufacturer article number |
| `ean`       | string | EAN / barcode |
| `oem`       | string | OEM reference number |
| `tecdocId`  | string | TecDoc article ID |

### Example Request

```bash
curl -X GET \
  'https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/storefront/lookup?ean=4047025683975' \
  -H 'X-API-Key: YOUR_API_KEY'
```

### Example Response

```json
{
  "id": "clx1abc2d0001...",
  "articleNo": "0986479C30",
  "sku": "BOSCH-0986479C30",
  "ean": "4047025683975",
  "oem": "1K0615301AA",
  "description": "Brake Disc",
  "price": 42.50,
  "stock": 15,
  "brand": {
    "name": "BOSCH",
    "code": "BOSCH"
  },
  "category": {
    "name": "Brake Discs",
    "code": "brake-discs"
  },
  "supplier": {
    "name": "InterCars",
    "code": "intercars"
  },
  "images": [],
  "icSku": "BOS0986479C30"
}
```

### Error Responses

| Status | Description |
|--------|-------------|
| `400`  | No lookup parameter provided, or more than one provided |
| `401`  | Missing or invalid API key |
| `404`  | No product found for the given identifier |

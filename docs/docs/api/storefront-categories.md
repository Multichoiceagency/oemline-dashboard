---
sidebar_position: 5
title: Storefront Categories
description: Retrieve the hierarchical category tree for the OEMline storefront.
---

# Storefront Categories

Base URL: `https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api`

All storefront endpoints require the `X-API-Key` header.

---

## List Categories

```
GET /storefront/categories
```

Returns the category tree. Categories are hierarchical -- top-level categories contain nested `children` arrays.

### Query Parameters

| Parameter  | Type   | Default | Description |
|-----------|--------|---------|-------------|
| `parentId` | string | -       | Return only children of this parent category. Omit to get the full tree. |

### Example Request

Fetch the full category tree:

```bash
curl -X GET \
  'https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/storefront/categories' \
  -H 'X-API-Key: YOUR_API_KEY'
```

Fetch children of a specific category:

```bash
curl -X GET \
  'https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/storefront/categories?parentId=clx1cat001' \
  -H 'X-API-Key: YOUR_API_KEY'
```

### Example Response

```json
{
  "items": [
    {
      "id": "clx1cat001...",
      "name": "Braking System",
      "code": "braking-system",
      "parentId": null,
      "children": [
        {
          "id": "clx1cat010...",
          "name": "Brake Discs",
          "code": "brake-discs",
          "parentId": "clx1cat001...",
          "children": [],
          "productCount": 4520
        },
        {
          "id": "clx1cat011...",
          "name": "Brake Pads",
          "code": "brake-pads",
          "parentId": "clx1cat001...",
          "children": [],
          "productCount": 3870
        }
      ],
      "productCount": 8390
    },
    {
      "id": "clx1cat002...",
      "name": "Engine",
      "code": "engine",
      "parentId": null,
      "children": [
        {
          "id": "clx1cat020...",
          "name": "Oil Filters",
          "code": "oil-filters",
          "parentId": "clx1cat002...",
          "children": [],
          "productCount": 2100
        }
      ],
      "productCount": 15200
    }
  ],
  "total": 2
}
```

### Response Fields

| Field          | Type     | Description |
|---------------|----------|-------------|
| `id`           | string   | Category ID |
| `name`         | string   | Display name |
| `code`         | string   | Unique category code (use for filtering products) |
| `parentId`     | string   | Parent category ID, `null` for top-level categories |
| `children`     | array    | Nested child categories (same structure, recursive) |
| `productCount` | integer  | Number of products in this category (includes children) |

### Error Responses

| Status | Description |
|--------|-------------|
| `401`  | Missing or invalid API key |
| `404`  | `parentId` does not match any existing category |

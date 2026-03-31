---
sidebar_position: 15
title: Categories
description: Browse the hierarchical product category tree.
---

# Categories

Categories organize products into a hierarchical tree structure sourced from TecDoc assembly groups.

## List Categories

```
GET /categories
```

Returns a paginated list of categories.

```bash
curl -X GET \
  "https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/categories?page=1&limit=50" \
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
      "name": "Body Parts",
      "parentId": null,
      "children": [
        {
          "id": "clx2def...",
          "name": "Headlights",
          "parentId": "clx1abc...",
          "children": []
        }
      ],
      "productCount": 320
    }
  ],
  "total": 85,
  "page": 1,
  "limit": 50
}
```

## Hierarchical Structure

Categories form a tree via the `parentId` and `children` fields:

- **Root categories** have `parentId: null` and represent top-level groups (e.g., Body Parts, Engine Parts).
- **Child categories** reference their parent via `parentId` and can be nested to multiple levels.
- The `children` array is populated with direct child categories.

## Notes

- Categories are synced from TecDoc assembly groups during the sync worker cycle.
- The `productCount` field reflects the number of products directly assigned to that category.

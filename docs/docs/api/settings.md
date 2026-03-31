---
sidebar_position: 16
title: Settings
description: View and update application settings — margin, tax, currency, and output API configuration.
---

# Settings

Application-wide settings control pricing calculations, currency, and storefront output configuration.

## Get Settings

```
GET /settings
```

Returns the current application settings.

```bash
curl -X GET \
  https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/settings \
  -H "X-API-Key: your-api-key-here"
```

### Response

```json
{
  "taxRate": 21,
  "marginPercentage": 31,
  "currency": "EUR",
  "outputApiUrl": "https://storefront.example.com/api",
  "outputApiKey": "sf-key-...",
  "autoPushEnabled": false
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `taxRate` | number | Tax percentage applied on top of the margin price (e.g., 21 for 21%). |
| `marginPercentage` | number | Margin percentage applied to the supplier base price (e.g., 31 for 31%). |
| `currency` | string | Currency code for all prices (default: `EUR`). |
| `outputApiUrl` | string | Storefront API URL where finalized products are pushed. |
| `outputApiKey` | string | API key for authenticating with the output storefront API. |
| `autoPushEnabled` | boolean | Whether finalized products are automatically pushed to the storefront. |

## Update Settings

```
PATCH /settings
```

Update one or more settings. Only the fields included in the request body are modified.

```bash
curl -X PATCH \
  https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/settings \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "marginPercentage": 35,
    "taxRate": 21
  }'
```

## Price Preview

```
GET /settings/price-preview
```

Returns a preview of how pricing calculations work with the current margin and tax settings. Useful for verifying settings before committing changes.

```bash
curl -X GET \
  https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/settings/price-preview \
  -H "X-API-Key: your-api-key-here"
```

### Response

```json
{
  "marginPercentage": 31,
  "taxRate": 21,
  "example": {
    "basePrice": 100.00,
    "priceWithMargin": 131.00,
    "priceWithTax": 158.51
  }
}
```

## Notes

- Changes to `marginPercentage` or `taxRate` take effect on the next pricing worker cycle.
- The `outputApiUrl` and `outputApiKey` configure where finalized products are pushed when `autoPushEnabled` is `true`.
- See [Pricing](./pricing.md) for the full price calculation formula.

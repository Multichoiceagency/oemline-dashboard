---
sidebar_position: 4
title: Adding a Supplier
description: How to add a new supplier adapter to the OEMline platform.
---

# Adding a Supplier

This guide walks through the steps to integrate a new supplier into OEMline. Each supplier needs an adapter class, a database record, and credentials.

## Overview

A supplier adapter implements four operations:

| Method | Purpose |
|--------|---------|
| `search(params)` | Search the supplier's catalog |
| `getPrice(sku)` | Fetch current price for a SKU |
| `getStock(sku)` | Fetch current stock for a SKU |
| `syncCatalog(cursor?)` | Stream catalog items for bulk import |

Not all suppliers support every operation. For example, Diederichs only provides stock via its SOAP API -- prices and catalog come from FTP file imports.

## Step 1: Create the Adapter

Create a new file in `src/adapters/` that extends `BaseSupplierAdapter`:

```typescript
// src/adapters/acme.ts
import { BaseSupplierAdapter } from "./base.js";
import type {
  SupplierSearchParams,
  SupplierProduct,
  SupplierCatalogItem,
} from "../types/index.js";

export class AcmeAdapter extends BaseSupplierAdapter {
  readonly name = "Acme Parts";
  readonly code = "acme";

  async search(params: SupplierSearchParams): Promise<SupplierProduct[]> {
    const url = `${this.apiUrl}/search?q=${encodeURIComponent(params.query)}`;
    const res = await this.fetchWithTimeout(url, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    const data = await res.json();
    return data.items.map((item: any) => ({
      sku: item.id,
      name: item.name,
      brand: item.brand,
      price: item.price,
    }));
  }

  async getPrice(sku: string) {
    const res = await this.fetchWithTimeout(`${this.apiUrl}/price/${sku}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    const data = await res.json();
    return { price: data.price, currency: "EUR" };
  }

  async getStock(sku: string) {
    const res = await this.fetchWithTimeout(`${this.apiUrl}/stock/${sku}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    const data = await res.json();
    return { quantity: data.qty, available: data.qty > 0 };
  }

  async *syncCatalog(cursor?: string): AsyncGenerator<SupplierCatalogItem[]> {
    let page = cursor ? parseInt(cursor) : 0;
    while (true) {
      const res = await this.fetchWithTimeout(
        `${this.apiUrl}/catalog?page=${page}`,
        { headers: { Authorization: `Bearer ${this.apiKey}` } }
      );
      const data = await res.json();
      if (data.items.length === 0) break;
      yield data.items;
      page++;
    }
  }
}
```

The base class provides:
- `fetchWithTimeout()` -- HTTP fetch with configurable timeout and circuit breaker
- `circuitBreaker` -- Automatic failure tracking (5 failures triggers open state, 30s recovery)

### Credential Formats

The `apiKey` constructor parameter receives the decrypted `credentials` string from the database. The format is adapter-specific:

- **Simple API key**: Store the key directly (e.g., PartsPoint)
- **Username:password**: Parse in the constructor (e.g., Diederichs uses `customerId:password`, Van Wezel uses `username:password`)
- **OAuth2**: Store as `clientId:clientSecret` and handle token exchange in the adapter

## Step 2: Register the Adapter

Add the import and mapping in `src/adapters/registry.ts`:

```typescript
import { AcmeAdapter } from "./acme.js";

const ADAPTER_MAP: Record<string, AdapterConstructor> = {
  intercars: IntercarsAdapter,
  partspoint: PartsPointAdapter,
  tecdoc: TecDocAdapter,
  diederichs: DiederichsAdapter,
  vanwezel: VanWezelAdapter,
  acme: AcmeAdapter,  // <-- add here
};
```

The registry loads adapters dynamically from the database at startup. When a supplier record has `adapterType: "acme"`, the registry instantiates `AcmeAdapter` with the supplier's `baseUrl` and decrypted `credentials`.

## Step 3: Create the Supplier in the Database

Use the API to create the supplier record:

```bash
curl -X POST https://api.oemline.eu/api/suppliers \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Acme Parts",
    "code": "acme",
    "adapterType": "acme",
    "baseUrl": "https://api.acmeparts.com/v1",
    "priority": 50,
    "active": true
  }'
```

## Step 4: Set Credentials

Credentials are stored encrypted. Set them via the PATCH endpoint:

```bash
curl -X PATCH https://api.oemline.eu/api/suppliers/<supplier-id> \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "credentials": "your-api-key-here"
  }'
```

The API encrypts the credentials before storing them. The adapter receives the decrypted value at runtime.

## Supplier Record Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name |
| `code` | string | Unique identifier (used as adapter cache key) |
| `adapterType` | string | Key in `ADAPTER_MAP` (e.g., `acme`) |
| `baseUrl` | string | API base URL passed to adapter constructor |
| `priority` | number | Lower = higher priority in matching |
| `credentials` | string | Encrypted credentials (format depends on adapter) |
| `active` | boolean | Whether the adapter is loaded at startup |

## Real-World Examples

### Diederichs (SOAP API, stock only)

Diederichs uses a DVSE SOAP endpoint for stock queries. Prices and catalog data come from FTP file imports, not the API.

- **adapterType**: `diederichs`
- **baseUrl**: `http://diederichs.spdns.eu/dvse/v1.2`
- **credentials**: `customerId:password`
- **API operations**: `getStock` via SOAP `GetArticleInformation` (batch, up to 500 items)
- **Not supported via API**: `search`, `getPrice`, `syncCatalog` (all return empty / null)

### Van Wezel (REST API, stock + pricing)

Van Wezel provides a REST API with JWT authentication. A service-level Basic Auth header authenticates the application, then customer credentials obtain a JWT token.

- **adapterType**: `vanwezel`
- **baseUrl**: `https://vwa.autopartscat.com/WcfVWAService/WcfVWAService/VWAService.svc`
- **credentials**: `username:password`
- **API operations**: `getStock` and `getPrice` via `getstock?productid=xxx` (returns qty + price)
- **Batch support**: Parallel calls with 10 concurrent requests
- **Token caching**: JWT cached for 20 hours (valid 24h)

### InterCars (OAuth2 API + CSV mapping)

InterCars is the largest supplier. It uses OAuth2 for authentication and requires a separate SKU mapping step because InterCars uses its own SKU format (TOW_KOD), not TecDoc article numbers.

- **adapterType**: `intercars`
- **baseUrl**: `https://api.webapi.intercars.eu/ic`
- **credentials**: OAuth2 client credentials
- **SKU mapping**: 565K-row CSV maps brand + article number to InterCars TOW_KOD
- **Matching**: Multi-phase ic-match worker (Phase 0, 1A-1D, 2A-2C)

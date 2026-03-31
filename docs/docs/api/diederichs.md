---
sidebar_position: 9
title: DIEDERICHS Integration
description: DIEDERICHS DVSE SOAP API integration — stock queries and FTP-based catalog/pricing.
---

# DIEDERICHS Integration

DIEDERICHS is a German auto body parts manufacturer with its own DVSE SOAP API. OEMline connects directly to DIEDERICHS for real-time stock availability. Pricing and catalog data are imported separately via FTP.

## API Details

| Setting | Value |
|---------|-------|
| Base URL | `http://diederichs.spdns.eu/dvse/v1.2` |
| Protocol | SOAP 1.1 |
| Adapter Type | `diederichs` |
| Products | 117,000+ |
| Auth | Customer ID + password (same as teileshop.diederichs.com) |

## DVSE SOAP API

The DVSE API endpoint is at `/api.php` under the base URL. All requests use SOAP 1.1 with the `SOAPAction` header.

### GetArticleInformation

Batch stock query supporting up to 500 items per call (OEMline uses batches of 50).

**Request:**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope
  xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ns1="DVSE">
  <SOAP-ENV:Body>
    <ns1:GetArticleInformation>
      <User>
        <CustomerId>YOUR_CUSTOMER_ID</CustomerId>
        <Password>YOUR_PASSWORD</Password>
      </User>
      <Items>
        <Item>
          <WholesalerArticleNumber>6601045</WholesalerArticleNumber>
          <RequestedQuantity><Value>1</Value></RequestedQuantity>
        </Item>
      </Items>
      <ResponseLimit/>
    </ns1:GetArticleInformation>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>
```

**Response structure:**

```xml
<GetArticleInformationResult>
  <Items>
    <Item>
      <WholesalerArticleNumber>6601045</WholesalerArticleNumber>
      <Warehouses>
        <Warehouse>
          <Quantities>
            <Quantity><Value>12</Value></Quantity>
          </Quantities>
        </Warehouse>
      </Warehouses>
    </Item>
  </Items>
  <ErrorCode>0</ErrorCode>
</GetArticleInformationResult>
```

Stock values are summed across all warehouses for a given article number.

### Capabilities and Limitations

| Feature | Available | Source |
|---------|-----------|--------|
| Stock | Yes | DVSE API (real-time) |
| Pricing | No | FTP import (updated every ~3 months) |
| Product search | No | FTP catalog import |
| Catalog sync | No | FTP catalog import |

## Internal Usage

DIEDERICHS products are managed through the standard supplier endpoints:

```bash
# Trigger sync (processes FTP-imported data)
curl -X POST \
  -H "X-API-Key: YOUR_KEY" \
  "https://api-bsg4wgow80c8k4sc404ko00k.oemline.eu/api/suppliers/4/sync"
```

The pricing and stock workers handle DIEDERICHS alongside other suppliers. The pricing worker skips the DVSE API (prices come from FTP) while the stock worker calls `GetArticleInformation` in batches.

## Notes

- Credentials are stored encrypted in the supplier record as `customerId:password` format.
- DIEDERICHS has its own pricing independent of InterCars.
- The SOAP API only supports stock queries. All other data (catalog, prices) must be loaded from FTP files.

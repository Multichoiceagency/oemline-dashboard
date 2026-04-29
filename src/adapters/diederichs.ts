import { BaseSupplierAdapter } from "./base.js";
import type {
  SupplierSearchParams,
  SupplierProduct,
  SupplierCatalogItem,
} from "../types/index.js";
import { logger } from "../lib/logger.js";
import { sanitizeWholesalePrice } from "../lib/pricing.js";

/**
 * Diederichs DVSE SOAP adapter.
 *
 * Credentials format (stored in supplier.credentials): "customerId:password"
 *   - Same credentials as used on https://teileshop.diederichs.com
 *
 * API endpoint: http://diederichs.spdns.eu/dvse/v1.2/api.php
 * Protocol: SOAP 1.1 with SOAPAction header
 *
 * Supported operations:
 *   - GetArticleInformation: batch stock + price query (up to 500 items per call)
 *     Returns Warehouses (stock), Prices (Value, VAT, Rebate, PriceCode), AvailState
 *
 * NOT supported via API (requires FTP manual import):
 *   - Catalog sync (product list from FTP)
 */
export class DiederichsAdapter extends BaseSupplierAdapter {
  readonly name = "Diederichs";
  readonly code = "diederichs";

  private readonly customerId: string;
  private readonly password: string;

  // Max items per SOAP call (API supports up to 500)
  private static readonly BATCH_LIMIT = 50;

  constructor(apiUrl: string, credentials: string, timeout = 15_000) {
    super(apiUrl, credentials, timeout);
    const colonIdx = credentials.indexOf(":");
    if (colonIdx > 0) {
      this.customerId = credentials.slice(0, colonIdx);
      this.password = credentials.slice(colonIdx + 1);
    } else {
      this.customerId = credentials;
      this.password = "";
    }
  }

  /**
   * Fetch stock + price for a batch of Diederichs WholesalerArticleNumbers.
   * Returns a Map of articleNo → { price, currency, stock }.
   * Prices are parsed from the DVSE Prices array in the GetArticleInformation response.
   */
  async fetchQuoteBatch(
    articleNumbers: string[]
  ): Promise<Map<string, { price: number | null; currency: string; stock: number }>> {
    const result = new Map<string, { price: number | null; currency: string; stock: number }>();
    if (articleNumbers.length === 0) return result;

    // Process in chunks to stay within SOAP limits
    for (let i = 0; i < articleNumbers.length; i += DiederichsAdapter.BATCH_LIMIT) {
      const chunk = articleNumbers.slice(i, i + DiederichsAdapter.BATCH_LIMIT);
      try {
        await this.fetchChunk(chunk, result);
      } catch (err) {
        logger.warn({ err, supplier: this.code, chunkStart: i }, "DVSE batch chunk failed");
        throw err;
      }
    }

    return result;
  }

  private async fetchChunk(
    articleNumbers: string[],
    result: Map<string, { price: number | null; currency: string; stock: number }>
  ): Promise<void> {
    const itemsXml = articleNumbers
      .map(
        (no) =>
          `<Item><WholesalerArticleNumber>${escapeXml(no)}</WholesalerArticleNumber>` +
          `<RequestedQuantity><Value>1</Value></RequestedQuantity></Item>`
      )
      .join("");

    const envelope =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="DVSE">` +
      `<SOAP-ENV:Body>` +
      `<ns1:GetArticleInformation>` +
      `<User><CustomerId>${escapeXml(this.customerId)}</CustomerId>` +
      `<Password>${escapeXml(this.password)}</Password></User>` +
      `<Items>${itemsXml}</Items>` +
      `<ResponseLimit/>` +
      `</ns1:GetArticleInformation>` +
      `</SOAP-ENV:Body>` +
      `</SOAP-ENV:Envelope>`;

    const url = `${this.apiUrl}/api.php`;
    const response = await this.fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: '"DVSE#GetArticleInformation"',
      },
      body: envelope,
    });

    if (!response.ok) {
      throw new Error(`Diederichs SOAP returned ${response.status}`);
    }

    const xml = await response.text();
    parseArticleInformationResponse(xml, result);
  }

  async search(_params: SupplierSearchParams): Promise<SupplierProduct[]> {
    // DVSE has no search endpoint — products come from FTP catalog import
    return [];
  }

  async getPrice(sku: string): Promise<{ price: number; currency: string } | null> {
    try {
      const result = await this.fetchQuoteBatch([sku]);
      const item = result.get(sku);
      if (!item?.price) return null;
      return { price: item.price, currency: item.currency };
    } catch (err) {
      logger.error({ err, supplier: this.code, sku }, "Diederichs getPrice failed");
      return null;
    }
  }

  async getStock(sku: string): Promise<{ quantity: number; available: boolean } | null> {
    try {
      const result = await this.fetchQuoteBatch([sku]);
      const item = result.get(sku);
      if (!item) return null;
      return { quantity: item.stock, available: item.stock > 0 };
    } catch (err) {
      logger.error({ err, supplier: this.code, sku }, "Diederichs getStock failed");
      return null;
    }
  }

  // eslint-disable-next-line require-yield
  async *syncCatalog(
    _cursor?: string
  ): AsyncGenerator<SupplierCatalogItem[], void, unknown> {
    // Catalog comes from FTP price files, not the DVSE API
    // Products are imported via the /api/jobs/import-diederichs-ftp endpoint
  }
}

// ─── XML helpers ─────────────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function extractText(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, "s");
  return xml.match(re)?.[1]?.trim();
}

/**
 * Parse GetArticleInformation SOAP response and populate result map.
 *
 * Response structure:
 *   <GetArticleInformationResult>
 *     <Items>
 *       <Item>
 *         <WholesalerArticleNumber>...</WholesalerArticleNumber>
 *         <Warehouses>
 *           <Warehouse>
 *             <Quantities><Quantity><Value>N</Value></Quantity></Quantities>
 *           </Warehouse>
 *         </Warehouses>
 *         <Prices>
 *           <Price>
 *             <Value>12.34</Value>
 *             <VAT>19</VAT>
 *             <TaxIncluded>false</TaxIncluded>
 *             <CurrencyCode>EUR</CurrencyCode>
 *             <PriceCode>1</PriceCode>
 *           </Price>
 *         </Prices>
 *       </Item>
 *     </Items>
 *     <ErrorCode>0</ErrorCode>
 *   </GetArticleInformationResult>
 */
function parseArticleInformationResponse(
  xml: string,
  result: Map<string, { price: number | null; currency: string; stock: number }>
): void {
  // Check for SOAP fault
  if (xml.includes("<faultstring>") || xml.includes(":Fault>")) {
    const fault = extractText(xml, "faultstring") ?? "Unknown SOAP fault";
    throw new Error(`DVSE SOAP fault: ${fault}`);
  }

  // Extract Items section from result
  const itemsStart = xml.indexOf("<Items>");
  const itemsEnd = xml.indexOf("</Items>");
  if (itemsStart === -1 || itemsEnd === -1) return;

  const itemsXml = xml.slice(itemsStart + 7, itemsEnd);

  // Find all Item blocks
  let searchFrom = 0;
  while (true) {
    const itemStart = itemsXml.indexOf("<Item>", searchFrom);
    if (itemStart === -1) break;

    const itemEnd = itemsXml.indexOf("</Item>", itemStart);
    if (itemEnd === -1) break;

    const itemXml = itemsXml.slice(itemStart + 6, itemEnd);
    searchFrom = itemEnd + 7;

    const articleNo = extractText(itemXml, "WholesalerArticleNumber");
    if (!articleNo) continue;

    // Sum stock across all warehouses
    let totalStock = 0;
    const warehousesStart = itemXml.indexOf("<Warehouses>");
    const warehousesEnd = itemXml.indexOf("</Warehouses>");
    if (warehousesStart !== -1 && warehousesEnd !== -1) {
      const warehousesXml = itemXml.slice(warehousesStart + 12, warehousesEnd);
      let wSearch = 0;
      while (true) {
        const wStart = warehousesXml.indexOf("<Warehouse>", wSearch);
        if (wStart === -1) break;
        const wEnd = warehousesXml.indexOf("</Warehouse>", wStart);
        if (wEnd === -1) break;
        const whXml = warehousesXml.slice(wStart + 11, wEnd);
        wSearch = wEnd + 12;

        let qSearch = 0;
        while (true) {
          const qStart = whXml.indexOf("<Quantity>", qSearch);
          if (qStart === -1) break;
          const qEnd = whXml.indexOf("</Quantity>", qStart);
          if (qEnd === -1) break;
          const qXml = whXml.slice(qStart + 10, qEnd);
          qSearch = qEnd + 11;

          const val = extractText(qXml, "Value");
          if (val) totalStock += Math.max(0, parseFloat(val) || 0);
        }
      }
    }

    // Diederichs DVSE returns Quantity/Value as a *stock-class indicator*
    // not as an exact count: 1, 10, 100, 1000, 10000, 100000, 1000000 are
    // category buckets meaning "≥ that many in stock". A live sample of
    // 800 Diederichs rows showed 99.9% land on a pure power of 10 — which
    // is statistically impossible for real inventory.
    //
    // Treat the supplier feed as a binary in-stock signal:
    //   - totalStock === 0   → 0 (out of stock, trustworthy)
    //   - totalStock ≥ 10 and is a power of 10 → 1 (in stock, exact unknown)
    //   - any other value (e.g. 4, 7, 23) → keep as-is — those are the
    //     real warehouse quantities that occasionally slip through.
    // The downstream UI shows "X op voorraad" only when X > 1, so a
    // value of 1 reads as a generic "Op voorraad" badge without
    // misrepresenting the real count.
    const looksLikeStockClass =
      totalStock >= 10 &&
      Number.isInteger(totalStock) &&
      Math.pow(10, Math.round(Math.log10(totalStock))) === totalStock;
    if (looksLikeStockClass) {
      totalStock = 1;
    }

    // Extract best price from Prices array
    // PriceCode meanings vary per supplier; pick the first price with a positive Value
    let bestPrice: number | null = null;
    let currency = "EUR";
    const pricesStart = itemXml.indexOf("<Prices>");
    const pricesEnd = itemXml.indexOf("</Prices>");
    if (pricesStart !== -1 && pricesEnd !== -1) {
      const pricesXml = itemXml.slice(pricesStart + 8, pricesEnd);
      let pSearch = 0;
      while (true) {
        const pStart = pricesXml.indexOf("<Price>", pSearch);
        if (pStart === -1) break;
        const pEnd = pricesXml.indexOf("</Price>", pStart);
        if (pEnd === -1) break;
        const pXml = pricesXml.slice(pStart + 7, pEnd);
        pSearch = pEnd + 8;

        const valStr = extractText(pXml, "Value");
        const val = valStr ? parseFloat(valStr) : 0;
        if (val > 0) {
          const currCode = extractText(pXml, "CurrencyCode");
          if (currCode) currency = currCode;
          // Use the first valid price (typically the net/purchase price)
          if (bestPrice === null) bestPrice = Math.round(val * 100) / 100;
        }
      }
    }

    // Normalize cents → euros + strip sentinels (see lib/pricing.ts)
    const sanitized = sanitizeWholesalePrice(bestPrice);
    result.set(articleNo, { price: sanitized, currency, stock: Math.floor(totalStock) });
  }
}

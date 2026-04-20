import { BaseSupplierAdapter } from "./base.js";
import type {
  SupplierSearchParams,
  SupplierProduct,
  SupplierCatalogItem,
} from "../types/index.js";
import { logger } from "../lib/logger.js";
import { waitForIcRateLimit } from "../lib/ic-rate-limiter.js";

interface InterCarsCredentials {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  customerId?: string;
  payerId?: string;
  branch?: string;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface StockItem {
  sku?: string;
  index?: string;
  brand?: string;
  articleNumber?: string;
  tecdoc?: string;
  tecdocProd?: number;
  description?: string;
  ean?: string;
  availability?: number;
  warehouse?: string;
}

interface PricingItem {
  sku?: string;
  listPriceNet?: number;
  listPriceGross?: number;
  customerPrice?: number;
  taxRate?: number;
  refundableAmount?: number;
  currency?: string;
}

export class IntercarsAdapter extends BaseSupplierAdapter {
  readonly name = "InterCars";
  readonly code = "intercars";

  private credentials: InterCarsCredentials;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(apiUrl: string, apiKey: string, timeout = 30000) {
    super(apiUrl, apiKey, timeout);

    let creds: Partial<InterCarsCredentials> = {};
    try {
      creds = JSON.parse(apiKey);
    } catch {
      // Fallback: apiKey is the client_secret
    }

    this.credentials = {
      clientId: creds.clientId || process.env.INTERCARS_CLIENT_ID || "",
      clientSecret: creds.clientSecret || process.env.INTERCARS_CLIENT_SECRET || apiKey,
      tokenUrl: creds.tokenUrl || process.env.INTERCARS_TOKEN_URL || "https://is.webapi.intercars.eu/oauth2/token",
      customerId: creds.customerId || process.env.INTERCARS_CUSTOMER_ID || "",
      payerId: creds.payerId || process.env.INTERCARS_PAYER_ID || "",
      branch: creds.branch || process.env.INTERCARS_BRANCH || "",
    };
  }

  /**
   * OAuth2 client_credentials with Basic Auth header.
   * Retries up to 3 times with a 30s timeout per attempt and 5s/10s backoff.
   */
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 30_000) {
      return this.accessToken;
    }

    const basicAuth = Buffer.from(
      `${this.credentials.clientId}:${this.credentials.clientSecret}`
    ).toString("base64");

    let lastErr: Error | undefined;

    for (let attempt = 1; attempt <= 3; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000); // 30s timeout on auth

      try {
        const response = await fetch(this.credentials.tokenUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${basicAuth}`,
          },
          body: "grant_type=client_credentials&scope=allinone",
          signal: controller.signal,
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`InterCars OAuth2 token failed: ${response.status} ${text}`);
        }

        const data = (await response.json()) as TokenResponse;
        this.accessToken = data.access_token;
        this.tokenExpiresAt = Date.now() + data.expires_in * 1000;

        logger.info({ supplier: this.code }, "OAuth2 token refreshed");
        return this.accessToken;
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        if (attempt < 3) {
          const delay = 5000 * attempt; // 5s, 10s
          logger.warn(
            { supplier: this.code, attempt, delayMs: delay, err: lastErr.message },
            "IC OAuth2 token failed, retrying"
          );
          await new Promise((r) => setTimeout(r, delay));
        }
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastErr!;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.getAccessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Accept-Language": "en",
    };

    if (this.credentials.customerId) {
      headers["X-Customer-Id"] = this.credentials.customerId;
    }
    if (this.credentials.payerId) {
      headers["X-Payer-Id"] = this.credentials.payerId;
    }
    if (this.credentials.branch) {
      headers["X-Branch"] = this.credentials.branch;
    }

    return headers;
  }

  /**
   * Direct fetch with long timeout for sync operations.
   */
  private async syncFetch(url: string, headers: Record<string, string>, opts?: { method?: string; body?: string }): Promise<Response> {
    // Shared rate limiter: 480 req/min across all IC API calls
    await waitForIcRateLimit();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);

    try {
      return await fetch(url, {
        method: opts?.method ?? "GET",
        headers,
        body: opts?.body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Search: InterCars uses /inventory/stock for SKU-based lookups.
   */
  async search(params: SupplierSearchParams): Promise<SupplierProduct[]> {
    try {
      const sku = params.articleNo ?? params.query;
      if (!sku) return [];

      const headers = await this.authHeaders();

      const stockUrl = `${this.apiUrl}/inventory/stock?sku=${encodeURIComponent(sku)}`;
      const stockResponse = await this.fetchWithTimeout(stockUrl, { headers });

      if (!stockResponse.ok) {
        logger.warn({ status: stockResponse.status, supplier: this.code }, "InterCars stock lookup failed");
        return [];
      }

      const stockData = (await stockResponse.json()) as StockItem[] | { items?: StockItem[] };
      const items = Array.isArray(stockData) ? stockData : (stockData.items ?? []);

      if (items.length === 0) return [];

      // Deduplicate by SKU (stock API returns multiple warehouse entries)
      const skuMap = new Map<string, { item: StockItem; totalStock: number }>();
      for (const item of items) {
        const itemSku = item.sku ?? item.index ?? "";
        if (!itemSku) continue;
        const existing = skuMap.get(itemSku);
        if (existing) {
          existing.totalStock += item.availability ?? 0;
        } else {
          skuMap.set(itemSku, { item, totalStock: item.availability ?? 0 });
        }
      }

      // Fetch pricing via /pricing/quote for found SKUs
      const priceMap = new Map<string, { price: number; currency: string }>();
      const skuList = Array.from(skuMap.keys()).slice(0, 20);
      if (skuList.length > 0) {
        try {
          const priceUrl = `${this.apiUrl}/pricing/quote`;
          const priceResponse = await this.fetchWithTimeout(priceUrl, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ lines: skuList.map((s) => ({ sku: s, quantity: 1 })) }),
          });
          if (priceResponse.ok) {
            const priceData = (await priceResponse.json()) as { lines?: Array<{ sku: string; price?: { customerPriceNet?: number; listPriceNet?: number; currencyCode?: string } }> };
            for (const line of priceData.lines ?? []) {
              const p = line.price?.customerPriceNet ?? line.price?.listPriceNet;
              if (p != null) priceMap.set(line.sku, { price: p, currency: line.price?.currencyCode ?? "EUR" });
            }
          }
        } catch {
          // pricing is best-effort
        }
      }

      return Array.from(skuMap.values()).map(({ item, totalStock }) => {
        const itemSku = item.sku ?? item.index ?? "";
        const pricing = priceMap.get(itemSku);
        return {
          supplier: this.code,
          sku: itemSku,
          brand: item.brand ?? "",
          articleNo: item.articleNumber ?? itemSku,
          ean: item.ean ?? null,
          tecdocId: item.tecdoc ?? null,
          oem: null,
          description: item.description ?? "",
          price: pricing?.price ?? null,
          stock: totalStock,
          currency: pricing?.currency ?? "EUR",
        };
      });
    } catch (err) {
      logger.error({ err, supplier: this.code }, "InterCars search failed");
      return [];
    }
  }

  async getPrice(sku: string): Promise<{ price: number; currency: string } | null> {
    try {
      const headers = await this.authHeaders();
      const url = `${this.apiUrl}/pricing/quote`;
      const response = await this.fetchWithTimeout(url, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ lines: [{ sku, quantity: 1 }] }),
      });

      if (!response.ok) return null;

      const data = (await response.json()) as { lines?: Array<{ price?: { customerPriceNet?: number; listPriceNet?: number; currencyCode?: string } }> };
      const pricing = data.lines?.[0]?.price;
      const { sanitizeWholesalePrice } = await import("../lib/pricing.js");
      const price = sanitizeWholesalePrice(pricing?.customerPriceNet ?? pricing?.listPriceNet);
      if (price == null) return null;

      return { price, currency: pricing?.currencyCode ?? "EUR" };
    } catch (err) {
      logger.error({ err, supplier: this.code, sku }, "InterCars getPrice failed");
      return null;
    }
  }

  async getStock(sku: string): Promise<{ quantity: number; available: boolean } | null> {
    try {
      const headers = await this.authHeaders();
      const url = `${this.apiUrl}/inventory/stock?sku=${encodeURIComponent(sku)}`;

      const response = await this.fetchWithTimeout(url, { headers });

      if (!response.ok) return null;

      const data = (await response.json()) as StockItem[] | { items?: StockItem[] };
      const items = Array.isArray(data) ? data : (data.items ?? []);

      const item = items.find((i) => i.sku === sku || i.index === sku);
      const qty = item?.availability ?? 0;

      return { quantity: qty, available: qty > 0 };
    } catch (err) {
      logger.error({ err, supplier: this.code, sku }, "InterCars getStock failed");
      return null;
    }
  }

  /**
   * InterCars is a PRICING/STOCK enrichment source, not a product catalog.
   * Products come from TecDoc; IC provides prices and stock via CSV mapping.
   *
   * Flow:
   * 1. Match TecDoc products to IC CSV using 4 strategies:
   *    a. Already linked (icSku stored from previous run)
   *    b. Brand + article_number (flexible brand prefix matching)
   *    c. EAN code (exact match)
   *    d. TecDoc product ID (tecdoc_prod → tecdoc_id)
   * 2. Store matched icSku on product_maps for future fast lookup
   * 3. Fetch stock + pricing from IC API using TOW_KOD
   * 4. Directly UPDATE the TecDoc product_maps with price/stock
   */
  async *syncCatalog(_cursor?: string): AsyncGenerator<SupplierCatalogItem[], void, unknown> {
    try {
      const { prisma, refreshIcUniqueArticles } = await import("../lib/prisma.js");

      // Check if mapping table has data
      let totalMappings = 0;
      try {
        const mappingCount = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*) as count FROM intercars_mappings`
        );
        totalMappings = Number(mappingCount[0]?.count ?? 0);
      } catch {
        logger.warn(
          { supplier: this.code },
          "intercars_mappings table not found. Run CSV import first."
        );
        return;
      }

      if (totalMappings === 0) {
        logger.warn(
          { supplier: this.code },
          "No InterCars CSV mappings found. Run: npx tsx src/scripts/import-intercars-csv.ts"
        );
        return;
      }

      logger.info(
        { supplier: this.code, totalMappings },
        "InterCars pricing enrichment starting"
      );

      // Test OAuth2 token (non-fatal — matching phases don't need API, only pricing/stock do)
      try {
        const testHeaders = await this.authHeaders();
        logger.info({ supplier: this.code, hasToken: !!testHeaders.Authorization }, "InterCars OAuth2 token acquired");
      } catch (authErr) {
        logger.warn({ err: authErr, supplier: this.code }, "InterCars OAuth2 token failed — matching phases will still run (no API needed)");
      }

      let totalNewMatches = 0;
      const phaseResults: Record<string, number> = {};

      // =========== PHASE 1: Match unlinked products (no icSku yet) ===========

      // Refresh the materialized view so Phase 1D uses current IC data.
      await refreshIcUniqueArticles();

      // Helper: run a matching phase with statement timeout + error isolation
      // Each phase gets its own transaction with work_mem + statement_timeout
      // so one slow/failing phase doesn't kill the entire job.
      type MatchRow = { product_id: number; tow_kod: string; ic_ean: string | null; ic_weight: number | null };

      const runPhase = async (name: string, sql: string, timeoutMs = 300_000): Promise<number> => {
        const phaseStart = Date.now();
        try {
          const matches = await prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(`SET LOCAL work_mem = '64MB'`);
            await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${timeoutMs}'`);
            return tx.$queryRawUnsafe<MatchRow[]>(sql);
          }, { timeout: timeoutMs + 30_000 }); // Prisma timeout slightly longer than PG timeout

          if (matches.length > 0) {
            logger.info({ supplier: this.code, phase: name, count: matches.length }, "Matches found, storing icSku");
            for (let i = 0; i < matches.length; i += 500) {
              const batch = matches.slice(i, i + 500);
              const cases = batch.map((m) => `WHEN ${m.product_id} THEN '${m.tow_kod.replace(/'/g, "''")}'`).join(" ");
              const eanCases = batch.map((m) => `WHEN ${m.product_id} THEN ${m.ic_ean ? `'${m.ic_ean.replace(/'/g, "''")}'` : "NULL"}`).join(" ");
              const weightCases = batch.map((m) => `WHEN ${m.product_id} THEN ${m.ic_weight ?? "NULL"}`).join(" ");
              const ids = batch.map((m) => m.product_id).join(",");
              await prisma.$executeRawUnsafe(
                `UPDATE product_maps SET
                  ic_sku = CASE id ${cases} END,
                  ic_matched_at = NOW(),
                  ean = CASE id ${eanCases} ELSE ean END,
                  weight = CASE id ${weightCases} ELSE weight END
                WHERE id IN (${ids})`
              );
            }
          }

          const durationSec = ((Date.now() - phaseStart) / 1000).toFixed(1);
          logger.info({ supplier: this.code, phase: name, matches: matches.length, durationSec }, "Phase completed");
          return matches.length;
        } catch (err) {
          const durationSec = ((Date.now() - phaseStart) / 1000).toFixed(1);
          logger.warn({ supplier: this.code, phase: name, err, durationSec }, "Phase failed (non-fatal, continuing)");
          return 0;
        }
      };

      // ── Phase DIRECT: tecdoc_prod + article (numeric brand ID, no fuzzy match) ──
      // Uses Stock CSV's TEC_DOC_PROD (= brands.tecdoc_id) for exact brand match
      // combined with normalized article number. Fastest, highest-confidence phase.
      logger.info({ supplier: this.code }, "Phase DIRECT: Matching by tecdoc_prod + article...");
      phaseResults.direct = await runPhase("PhaseDIRECT-tecdocProd+article",
        `SELECT DISTINCT ON (pm.id)
          pm.id as product_id,
          im.tow_kod,
          im.ean as ic_ean,
          im.weight as ic_weight
        FROM product_maps pm
        JOIN brands b ON b.id = pm.brand_id
        JOIN intercars_mappings im ON
          im.tecdoc_prod IS NOT NULL
          AND b.tecdoc_id IS NOT NULL
          AND im.tecdoc_prod = b.tecdoc_id
          AND im.normalized_article_number = pm.normalized_article_no
        WHERE pm.status = 'active' AND pm.ic_sku IS NULL
        ORDER BY pm.id`, 300_000);
      totalNewMatches += phaseResults.direct;
      yield [];

      // ── Phase 0: Brand aliases ──────────────────────────────────────────────
      logger.info({ supplier: this.code }, "Phase 0: Matching via brand aliases...");
      phaseResults.aliases = await runPhase("Phase0-aliases",
        `SELECT DISTINCT ON (pm.id)
          pm.id as product_id,
          im.tow_kod,
          im.ean as ic_ean,
          im.weight as ic_weight
        FROM product_maps pm
        JOIN brands b ON b.id = pm.brand_id
        JOIN supplier_brand_rules sbr ON sbr.brand_id = b.id AND sbr.active = true
        JOIN intercars_mappings im ON
          im.normalized_article_number = pm.normalized_article_no
          AND UPPER(im.manufacturer) = sbr.supplier_brand
        WHERE pm.status = 'active' AND pm.ic_sku IS NULL
        ORDER BY pm.id`, 120_000);
      totalNewMatches += phaseResults.aliases;
      yield [];

      // ── Phase 1A: Brand + article number ────────────────────────────────────
      // Uses stored normalized columns for fast index join (no runtime regexp)
      logger.info({ supplier: this.code }, "Phase 1A: Matching by brand + article number...");
      phaseResults.brandArticle = await runPhase("Phase1A-brand+article",
        `SELECT DISTINCT ON (pm.id)
          pm.id as product_id,
          im.tow_kod,
          im.ean as ic_ean,
          im.weight as ic_weight
        FROM product_maps pm
        JOIN brands b ON b.id = pm.brand_id
        JOIN intercars_mappings im ON
          im.normalized_article_number = pm.normalized_article_no
          AND (
            im.normalized_manufacturer = b.normalized_name
            OR (
              LENGTH(im.normalized_manufacturer) >= 2
              AND b.normalized_name LIKE im.normalized_manufacturer || '%'
            )
            OR (
              LENGTH(b.normalized_name) >= 2
              AND im.normalized_manufacturer LIKE b.normalized_name || '%'
            )
          )
        WHERE pm.status = 'active' AND pm.ic_sku IS NULL
        ORDER BY pm.id`, 300_000);
      totalNewMatches += phaseResults.brandArticle;
      yield [];

      // ── Phase 1B: EAN match ─────────────────────────────────────────────────
      logger.info({ supplier: this.code }, "Phase 1B: Matching by EAN...");
      phaseResults.ean = await runPhase("Phase1B-ean",
        `SELECT DISTINCT ON (pm.id)
          pm.id as product_id,
          im.tow_kod,
          im.ean as ic_ean,
          im.weight as ic_weight
        FROM product_maps pm
        JOIN intercars_mappings im ON
          pm.ean IS NOT NULL
          AND im.ean IS NOT NULL
          AND LENGTH(pm.ean) >= 8
          AND UPPER(TRIM(pm.ean)) = UPPER(TRIM(im.ean))
        WHERE pm.status = 'active' AND pm.ic_sku IS NULL
        ORDER BY pm.id`, 300_000);
      totalNewMatches += phaseResults.ean;
      yield [];

      // ── Phase 1C: TecDoc product ID match ───────────────────────────────────
      logger.info({ supplier: this.code }, "Phase 1C: Matching by TecDoc product ID...");
      phaseResults.tecdocId = await runPhase("Phase1C-tecdocId",
        `SELECT DISTINCT ON (pm.id)
          pm.id as product_id,
          im.tow_kod,
          im.ean as ic_ean,
          im.weight as ic_weight
        FROM product_maps pm
        JOIN intercars_mappings im ON
          pm.tecdoc_id IS NOT NULL
          AND im.tecdoc_prod IS NOT NULL
          AND CAST(pm.tecdoc_id AS TEXT) = CAST(im.tecdoc_prod AS TEXT)
        WHERE pm.status = 'active' AND pm.ic_sku IS NULL
        ORDER BY pm.id`, 300_000);
      totalNewMatches += phaseResults.tecdocId;
      yield [];

      // ── Phase 1D: Unique article number (materialized view) ─────────────────
      logger.info({ supplier: this.code }, "Phase 1D: Matching by unique article number (mat-view)...");
      phaseResults.uniqueArticle = await runPhase("Phase1D-uniqueArticle",
        `SELECT
          pm.id AS product_id,
          ua.tow_kod,
          ua.ic_ean,
          ua.ic_weight
        FROM product_maps pm
        JOIN ic_unique_articles ua ON ua.norm_article = pm.normalized_article_no
        WHERE pm.status = 'active' AND pm.ic_sku IS NULL
        ORDER BY pm.id`, 120_000);
      totalNewMatches += phaseResults.uniqueArticle;
      yield [];

      // ── Phase 2A: OEM number → IC article matching ─────────────────────────
      // TecDoc products store OEM part numbers (e.g. VW '06A115561B').
      // IC articles may match these OEM numbers directly.
      logger.info({ supplier: this.code }, "Phase 2A: Matching by OEM number → IC article...");
      phaseResults.oem = await runPhase("Phase2A-oem",
        `SELECT DISTINCT ON (pm.id)
          pm.id as product_id,
          im.tow_kod,
          im.ean as ic_ean,
          im.weight as ic_weight
        FROM product_maps pm
        JOIN intercars_mappings im ON
          im.normalized_article_number = UPPER(regexp_replace(pm.oem, '[^a-zA-Z0-9]', '', 'g'))
        WHERE pm.status = 'active' AND pm.ic_sku IS NULL
          AND pm.oem IS NOT NULL AND LENGTH(pm.oem) >= 5
        ORDER BY pm.id`, 300_000);
      totalNewMatches += phaseResults.oem;
      yield [];

      // ── Phase 2B: OEM numbers JSON array → IC article matching ─────────────
      // product_maps.oem_numbers is a JSON array of OEM numbers per product
      logger.info({ supplier: this.code }, "Phase 2B: Matching by OEM numbers array → IC article...");
      phaseResults.oemArray = await runPhase("Phase2B-oemArray",
        `SELECT DISTINCT ON (pm.id)
          pm.id as product_id,
          im.tow_kod,
          im.ean as ic_ean,
          im.weight as ic_weight
        FROM product_maps pm
        CROSS JOIN LATERAL jsonb_array_elements_text(pm.oem_numbers::jsonb) AS oem_val
        JOIN intercars_mappings im ON
          im.normalized_article_number = UPPER(regexp_replace(oem_val, '[^a-zA-Z0-9]', '', 'g'))
        WHERE pm.status = 'active' AND pm.ic_sku IS NULL
          AND pm.oem_numbers IS NOT NULL AND pm.oem_numbers::text != '[]'
        ORDER BY pm.id`, 600_000);
      totalNewMatches += phaseResults.oemArray;
      yield [];

      // ── Phase 2C: Relaxed article (strip leading zeros) ────────────────────
      // Some TecDoc articles have leading zeros that IC strips, or vice versa
      logger.info({ supplier: this.code }, "Phase 2C: Matching by article with leading zeros stripped...");
      phaseResults.relaxedZeros = await runPhase("Phase2C-relaxedZeros",
        `SELECT DISTINCT ON (pm.id)
          pm.id as product_id,
          im.tow_kod,
          im.ean as ic_ean,
          im.weight as ic_weight
        FROM product_maps pm
        JOIN brands b ON b.id = pm.brand_id
        JOIN intercars_mappings im ON
          LTRIM(im.normalized_article_number, '0') = LTRIM(pm.normalized_article_no, '0')
          AND LENGTH(LTRIM(pm.normalized_article_no, '0')) >= 5
          AND (
            im.normalized_manufacturer = b.normalized_name
            OR im.tecdoc_prod = b.tecdoc_id
          )
        WHERE pm.status = 'active' AND pm.ic_sku IS NULL
        ORDER BY pm.id`, 300_000);
      totalNewMatches += phaseResults.relaxedZeros;
      yield [];

      // ── Phase 2D: Cross-brand article (multi-brand IC articles, pick best) ─
      // Phase 1D only matches unique articles (1 IC brand). This phase handles
      // articles that appear under multiple IC brands — safe when product's brand
      // has a known alias or tecdoc_prod match.
      logger.info({ supplier: this.code }, "Phase 2D: Cross-brand article matching...");
      phaseResults.crossBrand = await runPhase("Phase2D-crossBrand",
        `SELECT DISTINCT ON (pm.id)
          pm.id as product_id,
          im.tow_kod,
          im.ean as ic_ean,
          im.weight as ic_weight
        FROM product_maps pm
        JOIN brands b ON b.id = pm.brand_id
        JOIN intercars_mappings im ON
          im.normalized_article_number = pm.normalized_article_no
          AND (
            im.tecdoc_prod IS NOT NULL AND b.tecdoc_id IS NOT NULL
            AND im.tecdoc_prod = b.tecdoc_id
          )
        WHERE pm.status = 'active' AND pm.ic_sku IS NULL
        ORDER BY pm.id`, 300_000);
      totalNewMatches += phaseResults.crossBrand;
      yield [];

      // ── Phase 3A: OEM → IC "OE {brand}" articles ────────────────────────
      // IC has OE brand entries (OE BMW, OE VW, OE MERCEDES, etc.) where the
      // article_number IS the vehicle manufacturer's OEM part number.
      // This phase matches product OEM numbers against these OE brand articles.
      // Safe: OE articles are genuine OEM numbers, not aftermarket article numbers.
      logger.info({ supplier: this.code }, "Phase 3A: OEM number → IC OE brand articles...");
      phaseResults.oemToOE = await runPhase("Phase3A-oemToOE",
        `SELECT DISTINCT ON (pm.id)
          pm.id as product_id,
          im.tow_kod,
          im.ean as ic_ean,
          im.weight as ic_weight
        FROM product_maps pm
        JOIN intercars_mappings im ON
          im.normalized_article_number = UPPER(regexp_replace(pm.oem, '[^a-zA-Z0-9]', '', 'g'))
          AND im.manufacturer LIKE 'OE %'
        WHERE pm.status = 'active' AND pm.ic_sku IS NULL
          AND pm.oem IS NOT NULL AND LENGTH(pm.oem) >= 5
        ORDER BY pm.id`, 300_000);
      totalNewMatches += phaseResults.oemToOE;
      yield [];

      // ── Phase 3B: OEM numbers array → IC "OE {brand}" articles ──────────
      // Same as 3A but uses the full oem_numbers JSON array (populated by OEM enrichment worker)
      logger.info({ supplier: this.code }, "Phase 3B: OEM numbers array → IC OE brand articles...");
      phaseResults.oemArrayToOE = await runPhase("Phase3B-oemArrayToOE",
        `SELECT DISTINCT ON (pm.id)
          pm.id as product_id,
          im.tow_kod,
          im.ean as ic_ean,
          im.weight as ic_weight
        FROM product_maps pm
        CROSS JOIN LATERAL jsonb_array_elements_text(pm.oem_numbers::jsonb) AS oem_val
        JOIN intercars_mappings im ON
          im.normalized_article_number = UPPER(regexp_replace(oem_val, '[^a-zA-Z0-9]', '', 'g'))
          AND im.manufacturer LIKE 'OE %'
        WHERE pm.status = 'active' AND pm.ic_sku IS NULL
          AND pm.oem_numbers IS NOT NULL AND pm.oem_numbers::text != '[]'
          AND LENGTH(oem_val) >= 5
        ORDER BY pm.id`, 600_000);
      totalNewMatches += phaseResults.oemArrayToOE;
      yield [];

      // ── Phase 3C: OEM numbers array → ANY IC article (brand-validated) ──
      // Matches oem_numbers entries against IC aftermarket articles, but requires
      // brand validation via tecdoc_prod to prevent false cross-brand matches.
      logger.info({ supplier: this.code }, "Phase 3C: OEM numbers array → IC article (brand-validated)...");
      phaseResults.oemArrayBrandValidated = await runPhase("Phase3C-oemArrayBrandValidated",
        `SELECT DISTINCT ON (pm.id)
          pm.id as product_id,
          im.tow_kod,
          im.ean as ic_ean,
          im.weight as ic_weight
        FROM product_maps pm
        CROSS JOIN LATERAL jsonb_array_elements_text(pm.oem_numbers::jsonb) AS oem_val
        JOIN intercars_mappings im ON
          im.normalized_article_number = UPPER(regexp_replace(oem_val, '[^a-zA-Z0-9]', '', 'g'))
          AND im.manufacturer NOT LIKE 'OE %'
        JOIN brands b ON b.id = pm.brand_id
        WHERE pm.status = 'active' AND pm.ic_sku IS NULL
          AND pm.oem_numbers IS NOT NULL AND pm.oem_numbers::text != '[]'
          AND LENGTH(oem_val) >= 5
          AND im.tecdoc_prod IS NOT NULL AND b.tecdoc_id IS NOT NULL
          AND im.tecdoc_prod = b.tecdoc_id
        ORDER BY pm.id`, 600_000);
      totalNewMatches += phaseResults.oemArrayBrandValidated;
      yield [];

      logger.info(
        { supplier: this.code, totalNewMatches, byPhase: phaseResults },
        "IC matching complete — pricing/stock handled by dedicated workers"
      );
    } catch (err) {
      logger.error({ err, supplier: this.code }, "IC matching failed");
      throw err; // Re-throw so BullMQ can mark as failed and retry
    }
  }

  /**
   * Fetch price/stock for a batch of IC SKUs via /inventory/quote.
   * Retries up to 3 times: 429 rate-limit waits 30s before retry; other
   * transient errors (network, timeout, 5xx) wait 5s/10s before retry.
   */
  async fetchQuoteBatch(skus: string[]): Promise<Map<string, { price: number | null; currency: string; stock: number }>> {
    const lines = skus.map((sku) => ({ sku, quantity: 1 }));
    const quoteUrl = `${this.apiUrl}/inventory/quote`;

    let lastErr: Error | undefined;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const headers = await this.authHeaders();
        const quoteResp = await this.syncFetch(quoteUrl, {
          ...headers,
          "Content-Type": "application/json",
        }, {
          method: "POST",
          body: JSON.stringify({ lines }),
        });

        if (!quoteResp.ok) {
          if (quoteResp.status === 429) {
            const delay = 30_000 * attempt; // 30s, 60s, 90s
            logger.warn({ attempt, delayMs: delay, supplier: this.code }, "IC inventory/quote rate limited (429), backing off");
            await new Promise((r) => setTimeout(r, delay));
          }
          throw new Error(`IC inventory/quote returned ${quoteResp.status}`);
        }

        const quoteData = (await quoteResp.json()) as Array<{
          sku: string;
          quantity: number;
          price?: {
            currencyCode?: string;
            listPriceNet?: number;
            customerPriceNet?: number;
          };
          lines?: Array<{ availability?: number }>;
        }>;

        const quoteMap = new Map<string, { price: number | null; currency: string; stock: number }>();
        const quoteItems = Array.isArray(quoteData) ? quoteData : [];

        const { sanitizeWholesalePrice } = await import("../lib/pricing.js");
        for (const item of quoteItems) {
          const sku = item.sku;
          // IC returns customerPriceNet in minor units (cents). Normalize to
          // euros and strip price-on-request sentinels via the shared helper.
          const price = sanitizeWholesalePrice(
            item.price?.customerPriceNet ?? item.price?.listPriceNet ?? null
          );
          const currency = item.price?.currencyCode ?? "EUR";
          const stock = item.lines?.reduce((sum, l) => sum + (l.availability ?? 0), 0) ?? 0;
          const existing = quoteMap.get(sku);
          if (existing) {
            existing.stock += stock;
            if (!existing.price && price) {
              existing.price = price;
              existing.currency = currency;
            }
          } else {
            quoteMap.set(sku, { price, currency, stock });
          }
        }

        return quoteMap;
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        if (attempt < 3) {
          const delay = 5000 * attempt; // 5s, 10s
          logger.warn(
            { supplier: this.code, attempt, delayMs: delay, err: lastErr.message },
            "IC quote batch failed, retrying"
          );
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    throw lastErr!;
  }
}

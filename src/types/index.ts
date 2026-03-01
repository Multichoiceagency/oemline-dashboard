export type MatchMethod = "override" | "tecdocId" | "ean" | "brand_article" | "oem";

export interface MatchResult {
  supplier: string;
  sku: string;
  method: MatchMethod;
  confidence: number;
  timestamp: Date;
}

export interface SupplierProduct {
  supplier: string;
  sku: string;
  brand: string;
  articleNo: string;
  ean: string | null;
  tecdocId: string | null;
  oem: string | null;
  description: string;
  price: number | null;
  stock: number | null;
  currency: string;
}

export interface SearchResult {
  query: string;
  results: SupplierProduct[];
  matches: MatchResult[];
  errors: SupplierError[];
  totalResults: number;
  cachedAt: string | null;
}

export interface SupplierError {
  supplier: string;
  message: string;
  code: string;
}

export interface SupplierSearchParams {
  query: string;
  brand?: string;
  articleNo?: string;
  ean?: string;
  tecdocId?: string;
  oem?: string;
  limit?: number;
}

export interface SupplierPriceParams {
  sku: string;
}

export interface SupplierStockParams {
  sku: string;
}

export interface SupplierCatalogItem {
  sku: string;
  brand: string;
  articleNo: string;
  ean: string | null;
  tecdocId: string | null;
  oem: string | null;
  description: string;
}

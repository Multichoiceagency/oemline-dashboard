const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "";

async function apiFetch<T>(path: string, init?: RequestInit, _retries = 1): Promise<T> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = { "X-API-Key": API_KEY };
  if (init?.body) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { ...headers, ...init?.headers } });
  } catch (err) {
    throw new Error(`Network error: ${err instanceof Error ? err.message : "fetch failed"}`);
  }

  // Auto-retry once on 429 — wait for retry-after header (capped at 20s)
  if (res.status === 429 && _retries > 0) {
    const wait = Math.min(parseInt(res.headers.get("retry-after") ?? "5", 10), 20) * 1000;
    await new Promise((r) => setTimeout(r, wait));
    return apiFetch(path, init, 0);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(`API returned non-JSON (status ${res.status})`);
  }

  if (!res.ok) {
    const msg = (body as Record<string, unknown>)?.message ?? (body as Record<string, unknown>)?.error ?? `HTTP ${res.status}`;
    throw new Error(String(msg));
  }

  return body as T;
}

// Health
export interface HealthResponse {
  status: string;
  uptime: number;
  timestamp: string;
  checks: Record<string, string>;
  circuits: Record<string, { state: string; failures: number }>;
  queues: Record<string, { waiting: number; active: number; completed: number; failed: number }>;
}
export const getHealth = () => apiFetch<HealthResponse>("/health");

// Jobs Status
export interface QueueStatus {
  name: string;
  active: number;
  completed: number;
  delayed: number;
  failed: number;
  paused: number;
  waiting: number;
  prioritized: number;
  wait: number;
  repeatableJobs: number;
}

export interface JobsStatusResponse {
  sync: QueueStatus;
  match: QueueStatus;
  index: QueueStatus;
  pricing: QueueStatus;
  stock: QueueStatus;
  icMatch: QueueStatus;
  aiMatch: QueueStatus;
  push: QueueStatus;
}

export interface OllamaStatus {
  available: boolean;
  ollamaUrl: string;
  configuredModel: string;
  loadedModels: string[];
}

export const getJobsStatus = () => apiFetch<JobsStatusResponse>("/api/jobs/status");
export const getOllamaStatus = () => apiFetch<OllamaStatus>("/api/jobs/ai-match/ollama-status");
export const triggerAiMatch = (opts?: { autoApplyThreshold?: number; llmMinThreshold?: number; llmConfidenceThreshold?: number }) =>
  apiFetch<{ queued: boolean; jobId: string; message: string }>("/api/jobs/ai-match", { method: "POST", body: JSON.stringify(opts ?? {}) });

// Aggregated system status — replaces 3 separate calls (health + jobs + ollama)
export interface SystemAlert {
  type: "failed" | "service_error" | "circuit_open";
  queue?: string;
  service?: string;
  count?: number;
  message: string;
}

export interface SystemStatus {
  health: {
    status: string;
    uptime: number;
    checks: Record<string, string>;
    circuits: Record<string, { state: string; failures: number }>;
  };
  jobs: {
    sync: QueueStatus | null;
    match: QueueStatus | null;
    index: QueueStatus | null;
    pricing: QueueStatus | null;
    stock: QueueStatus | null;
    icMatch: QueueStatus | null;
    aiMatch: QueueStatus | null;
    push: QueueStatus | null;
  };
  ollama: OllamaStatus;
  alerts: SystemAlert[];
  timestamp: string;
  responseTimeMs: number;
}

export const getSystemStatus = () => apiFetch<SystemStatus>("/api/jobs/system-status");
export const retryFailedJobs = (queue: string) =>
  apiFetch<{ retried: number; total: number; queue: string }>(`/api/jobs/${queue}/retry-failed`, { method: "POST" });
export const runAllWorkers = () =>
  apiFetch<{ queued: number; jobs: unknown[] }>("/api/jobs/run-all", { method: "POST" });

// Suppliers
export interface Supplier {
  id: string;
  name: string;
  code: string;
  adapterType: string;
  baseUrl: string;
  priority: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: {
    productMaps: number;
    overrides: number;
    unmatched: number;
  };
}

export interface SuppliersResponse {
  items: Supplier[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const getSuppliers = (params?: { page?: number; limit?: number; active?: string }) => {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.active) qs.set("active", params.active);
  return apiFetch<SuppliersResponse>(`/api/suppliers?${qs}`);
};

export const createSupplier = (data: {
  name: string;
  code: string;
  adapterType: string;
  baseUrl: string;
  credentials: Record<string, string>;
  priority?: number;
  active?: boolean;
}) =>
  apiFetch<Supplier>("/api/suppliers", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const updateSupplier = (id: string, data: Record<string, unknown>) =>
  apiFetch<Supplier>(`/api/suppliers/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export const syncSupplier = (id: string) =>
  apiFetch<{ jobId: string }>(`/api/suppliers/${id}/sync`, {
    method: "POST",
  });

export const bootstrapVanWezel = () =>
  apiFetch<{ totalTecdoc: number; upserted: number; brand: string; message: string }>("/api/jobs/bootstrap-vanwezel-from-tecdoc", {
    method: "POST",
  });

export const syncTecDocBrands = (brandIds: number[]) =>
  apiFetch<{ queued: number; brandIds: number[]; jobIds: string[]; message: string }>("/api/jobs/sync-tecdoc-brands", {
    method: "POST",
    body: JSON.stringify({ brandIds }),
  });

// Search
export interface SearchProduct {
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
  currency: string | null;
}

export interface SearchResponse {
  query: string;
  results: SearchProduct[];
  matches: Array<{
    supplier: string;
    sku: string;
    method: string;
    confidence: number;
  }>;
  errors: Array<{ supplier: string; message: string; code: string }>;
  totalResults: number;
  cachedAt: string | null;
}

export const searchProducts = (params: {
  q: string;
  brand?: string;
  articleNo?: string;
  ean?: string;
  tecdocId?: string;
  oem?: string;
  limit?: number;
}) => {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  });
  return apiFetch<SearchResponse>(`/api/search?${qs}`);
};

// TecDoc
export interface TecDocProduct {
  articleNumber: string;
  brand: string;
  brandId: number;
  description: string;
  ean: string | null;
  oemNumbers: string[];
  tecdocId: string;
}

export interface TecDocResponse {
  articles: TecDocProduct[];
  total: number;
}

export const searchTecDoc = (params: {
  q: string;
  type?: string;
  brandId?: number;
  page?: number;
  limit?: number;
}) => {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  });
  return apiFetch<TecDocResponse>(`/api/tecdoc/search?${qs}`);
};

// Unmatched
export interface UnmatchedItem {
  id: string;
  query: string;
  articleNo: string | null;
  ean: string | null;
  tecdocId: string | null;
  oem: string | null;
  attempts: number;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
  supplier: { name: string; code: string } | null;
  brand: { name: string; code: string } | null;
}

export interface UnmatchedResponse {
  items: UnmatchedItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const getUnmatched = (params?: {
  page?: number;
  limit?: number;
  resolved?: string;
}) => {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.resolved) qs.set("resolved", params.resolved);
  return apiFetch<UnmatchedResponse>(`/api/unmatched?${qs}`);
};

export const getUnmatchedItem = (id: string) =>
  apiFetch<UnmatchedItem>(`/api/unmatched/${id}`);

export interface BulkOverrideItem {
  supplierCode: string;
  brandCode: string;
  articleNo: string;
  sku: string;
  ean?: string;
  tecdocId?: string;
  oem?: string;
  reason?: string;
  categoryId?: number | null;
}

export interface BulkOverrideResult {
  created: number;
  updated: number;
  errors: Array<{ articleNo: string; error: string }>;
}

export const bulkCreateOverrides = (items: BulkOverrideItem[], createdBy = "dashboard") =>
  apiFetch<BulkOverrideResult>("/api/override/bulk", {
    method: "POST",
    body: JSON.stringify({ items, createdBy }),
  });

// Overrides
export interface Override {
  id: string;
  articleNo: string;
  sku: string;
  ean: string | null;
  tecdocId: string | null;
  oem: string | null;
  reason: string | null;
  createdBy: string | null;
  active: boolean;
  createdAt: string;
  supplier: { name: string; code: string } | null;
  brand: { name: string; code: string } | null;
}

export interface OverridesResponse {
  items: Override[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const getOverrides = (params?: {
  page?: number;
  limit?: number;
  supplierCode?: string;
}) => {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.supplierCode) qs.set("supplierCode", params.supplierCode);
  return apiFetch<OverridesResponse>(`/api/overrides?${qs}`);
};

export const createOverride = (data: {
  supplierCode: string;
  brandCode: string;
  articleNo: string;
  sku: string;
  ean?: string;
  tecdocId?: string;
  oem?: string;
  reason?: string;
  createdBy?: string;
}) =>
  apiFetch<Override>("/api/override", {
    method: "POST",
    body: JSON.stringify(data),
  });

// Products
export interface Product {
  id: number;
  supplierId: number;
  brandId: number;
  categoryId: number | null;
  sku: string;
  articleNo: string;
  ean: string | null;
  tecdocId: string | null;
  oem: string | null;
  description: string;
  imageUrl: string | null;
  images: string[];
  price: number | null;
  currency: string | null;
  stock: number | null;
  weight: number | null;
  genericArticle: string | null;
  oemNumbers: string[];
  status: string;
  createdAt: string;
  updatedAt: string;
  supplier: { id: number; name: string; code: string };
  brand: { id: number; name: string; code: string };
  category?: { id: number; name: string; code: string } | null;
  icCode: string | null;
  icMapping?: IcMappingDetail[] | null;
}

export interface ProductsResponse {
  items: Product[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ProductStats {
  total: number;
  recentlyUpdated: number;
  bySupplier: Array<{
    supplier: { id: number; name: string; code: string };
    count: number;
  }>;
}

export const getProducts = (params?: {
  page?: number;
  limit?: number;
  q?: string;
  supplier?: string;
  brand?: string;
  hasImage?: string;
  hasPrice?: string;
}) => {
  const qs = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    });
  }
  return apiFetch<ProductsResponse>(`/api/products?${qs}`);
};

export const getProduct = (id: number) =>
  apiFetch<Product>(`/api/products/${id}`);

export const updateProduct = (id: number, data: Record<string, unknown>) =>
  apiFetch<Product>(`/api/products/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export const deleteProduct = (id: number) =>
  apiFetch<{ success: boolean }>(`/api/products/${id}`, {
    method: "DELETE",
  });

export const importProducts = (data: {
  supplierId: number;
  brandId?: number;
  items: Array<{
    sku: string;
    articleNo: string;
    ean?: string | null;
    tecdocId?: string | null;
    oem?: string | null;
    description?: string;
  }>;
}) =>
  apiFetch<{ imported: number; updated: number; total: number }>(
    "/api/products/import",
    {
      method: "POST",
      body: JSON.stringify(data),
    }
  );

export const getProductStats = () =>
  apiFetch<ProductStats>("/api/products/stats");

// TecDoc Vehicle Linkages
export interface VehicleLinkage {
  linkingTargetId: number;
  description: string;
  mfrName: string;
  vehicleModelSeriesName: string;
  beginYearMonth: string | null;
  endYearMonth: string | null;
  typeName: string;
  subTypeName: string;
  capacity: string | null;
  power: string | null;
  fuelType: string | null;
}

export interface VehicleLinkagesResponse {
  linkages: VehicleLinkage[];
  total: number;
}

export const getTecDocLinkages = (articleId: number) =>
  apiFetch<VehicleLinkagesResponse>(`/api/tecdoc/linkages?articleId=${articleId}`);

export const getTecDocLinkagesByNumber = (articleNumber: string) =>
  apiFetch<VehicleLinkagesResponse>(`/api/tecdoc/linkages?articleNumber=${encodeURIComponent(articleNumber)}`);

export interface ArticleDetailsResponse {
  description: string;
  genericArticle: string;
  articleText: string[];
  oemNumbers: string[];
  totalLinkages: number;
}

export const getTecDocDetails = (articleNumber: string) =>
  apiFetch<ArticleDetailsResponse>(`/api/tecdoc/details?articleNumber=${encodeURIComponent(articleNumber)}`);

export const populateTecDoc = (queries: string[]) =>
  apiFetch<{ imported: number; updated: number; total: number }>(
    "/api/tecdoc/populate",
    {
      method: "POST",
      body: JSON.stringify({ queries }),
    }
  );

// Match Logs / Trace
export interface MatchLog {
  id: string;
  query: string;
  sku: string | null;
  method: string;
  confidence: number;
  matched: boolean;
  durationMs: number;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  supplier: { name: string; code: string } | null;
  brand: { name: string; code: string } | null;
}

export interface MatchLogStat {
  method: string;
  count: number;
  avgDurationMs: number;
  avgConfidence: number | null;
}

export interface MatchLogsResponse {
  items: MatchLog[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  stats: MatchLogStat[];
}

// Brands
export interface Brand {
  id: number;
  name: string;
  code: string;
  tecdocId: number | null;
  logoUrl: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { productMaps: number };
}

export interface BrandsResponse {
  items: Brand[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const getBrands = (params?: { page?: number; limit?: number; q?: string }) => {
  const qs = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    });
  }
  return apiFetch<BrandsResponse>(`/api/brands?${qs}`);
};

export const getBrand = (id: number) =>
  apiFetch<Brand & { productMaps: Product[] }>(`/api/brands/${id}`);

export const updateBrand = (id: number, data: { name?: string; logoUrl?: string | null; tecdocId?: number | null }) =>
  apiFetch<Brand>(`/api/brands/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export interface BrandIcCoverage {
  brandId: number;
  name: string;
  code: string;
  tecdocId: number | null;
  total: number;
  coupled: number;
  uncoupled: number;
  pct: number;
}

export const getBrandIcCoverage = () =>
  apiFetch<BrandIcCoverage[]>("/api/brands/ic-coverage");

export const syncBrandsFromTecDoc = () =>
  apiFetch<{ fetched: number; upserted: number; totalInDb: number; brands: Array<{ id: number; name: string; articleCount?: number }> }>(
    "/api/tecdoc/sync-brands",
    { method: "POST" }
  );

// Categories
export interface Category {
  id: number;
  name: string;
  code: string;
  tecdocId: number | null;
  parentId: number | null;
  level: number;
  createdAt: string;
  updatedAt: string;
  _count?: { products: number; children: number };
  children?: Category[];
}

export interface CategoriesResponse {
  items: Category[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const getCategories = (params?: { page?: number; limit?: number; parentId?: number; q?: string; hideEmpty?: "true" | "false" }) => {
  const qs = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    });
  }
  return apiFetch<CategoriesResponse>(`/api/categories?${qs}`);
};

export const getCategory = (id: number) =>
  apiFetch<Category & { parent: { id: number; name: string; code: string } | null; products: Product[] }>(`/api/categories/${id}`);

export const createCategory = (data: { name: string; code?: string; parentId?: number | null }) =>
  apiFetch<Category>("/api/categories", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const deleteCategory = (id: number) =>
  apiFetch<{ success: boolean }>(`/api/categories/${id}`, { method: "DELETE" });

export const updateCategory = (id: number, data: { name?: string; code?: string; parentId?: number | null }) =>
  apiFetch<Category>(`/api/categories/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export const syncTecDocCategories = () =>
  apiFetch<{ created: number; updated: number; linked: number; total: number }>("/api/categories/sync-tecdoc", {
    method: "POST",
  });

export const mergeCategories = (data: {
  targetCategoryId?: number;
  newCategory?: { name: string; code?: string; parentId?: number | null };
  sourceCategoryIds: number[];
  deleteSource?: boolean;
}) =>
  apiFetch<{
    targetCategory: Category;
    productsMoved: number;
    sourceCategories: number;
    deleted: number;
  }>("/api/categories/merge", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const resetCategoryProducts = (data: {
  categoryIds?: number[];
  nameContains?: string;
}) =>
  apiFetch<{
    categoriesReset: Array<{ id: number; name: string }>;
    productsReset: number;
    message: string;
  }>("/api/categories/reset-products", {
    method: "POST",
    body: JSON.stringify(data),
  });

// File Uploads
export const uploadProductImage = async (productId: number, file: File): Promise<{ url: string; images: string[] }> => {
  const formData = new FormData();
  formData.append("file", file);

  const url = `${API_BASE}/api/uploads/product/${productId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "X-API-Key": API_KEY },
    body: formData,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as Record<string, string>).error || `Upload failed: ${res.status}`);
  }

  return res.json();
};

export const uploadBrandLogo = async (brandId: number, file: File): Promise<{ url: string }> => {
  const formData = new FormData();
  formData.append("file", file);

  const url = `${API_BASE}/api/uploads/brand/${brandId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "X-API-Key": API_KEY },
    body: formData,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as Record<string, string>).error || `Upload failed: ${res.status}`);
  }

  return res.json();
};

// Storage
export interface StorageFile {
  name: string;
  size: number;
  lastModified: string;
  url: string;
}

export interface StorageStats {
  totalFiles: number;
  totalSize: number;
  folders: Record<string, { count: number; size: number }>;
}

export const getStorageFiles = (prefix?: string) => {
  const qs = prefix ? `?prefix=${encodeURIComponent(prefix)}` : "";
  return apiFetch<{ items: StorageFile[]; total: number }>(`/api/uploads/list${qs}`);
};

export const getStorageStats = () =>
  apiFetch<StorageStats>("/api/uploads/stats");

export const uploadGenericFile = async (file: File, folder = "files"): Promise<{ url: string; objectName: string; filename: string; size: number }> => {
  const formData = new FormData();
  formData.append("file", file);

  // Use /uploads/general — preserves original filename and uses folder path directly
  // (avoids double images/ prefix that /uploads/file generates via generateObjectName)
  const url = `${API_BASE}/api/uploads/general?folder=${encodeURIComponent(folder)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "X-API-Key": API_KEY },
    body: formData,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as Record<string, string>).error || `Upload mislukt: HTTP ${res.status}`);
  }

  return res.json();
};

export const deleteStorageFile = (objectName: string) =>
  apiFetch<{ deleted: boolean; objectName: string }>(`/api/uploads/file?objectName=${encodeURIComponent(objectName)}`, {
    method: "DELETE",
  });

// Finalized Products
export interface IcMapping {
  towKod: string;
  icDescription: string;
  icManufacturer: string;
  icArticleNumber: string;
  icEan: string | null;
  icWeight: number | null;
}

export interface IcMappingDetail {
  towKod: string;
  icIndex: string;
  articleNumber: string;
  manufacturer: string;
  description: string;
  ean: string | null;
  weight: number | null;
  tecdocProd: number | null;
  blockedReturn: boolean;
}

export interface FinalizedProduct {
  id: number;
  articleNo: string;
  sku: string;
  description: string;
  imageUrl: string | null;
  images: string[];
  ean: string | null;
  tecdocId: string | null;
  oem: string | null;
  genericArticle: string | null;
  oemNumbers: string[];
  price: number | null;
  priceWithMargin: number | null;
  priceWithTax: number | null;
  currency: string | null;
  stock: number | null;
  weight: number | null;
  status: string;
  brand: { id: number; name: string; code: string; logoUrl: string | null };
  category: { id: number; name: string; code: string } | null;
  supplier: { id: number; name: string; code: string };
  icMapping: IcMapping | null;
  updatedAt: string;
  createdAt: string;
}

export interface FinalizedResponse {
  items: FinalizedProduct[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  pricing?: {
    taxRate: number;
    marginPercentage: number;
  };
}

export interface FinalizedStats {
  totalProducts: number;
  withPrice: number;
  withStock: number;
  withImage: number;
  withIcMapping: number;
  topBrands: Array<{
    brand: { id: number; name: string; code: string; logoUrl: string | null };
    count: number;
  }>;
  topCategories: Array<{
    category: { id: number; name: string; code: string } | null;
    count: number;
  }>;
  indexStats?: {
    numberOfDocuments: number;
    isIndexing: boolean;
    fieldDistribution: Record<string, number>;
  };
}

export interface FinalizedDetail extends Omit<FinalizedProduct, 'icMapping'> {
  icMapping: IcMappingDetail[] | null;
}

export const getFinalized = (params?: {
  page?: number;
  limit?: number;
  q?: string;
  brand?: string;
  category?: string;
  supplier?: string;
  hasStock?: string;
  hasPrice?: string;
  hasImage?: string;
}) => {
  const qs = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    });
  }
  return apiFetch<FinalizedResponse>(`/api/finalized?${qs}`);
};

export const getFinalizedStats = () =>
  apiFetch<FinalizedStats>("/api/finalized/stats");

export const getFinalizedProduct = (id: number) =>
  apiFetch<FinalizedDetail>(`/api/finalized/${id}`);

export const pushFinalizedProduct = (id: number) =>
  apiFetch<{ success: boolean }>(`/api/finalized/${id}/push`, { method: "POST" });

export const pushAllFinalized = (supplierCode?: string) =>
  apiFetch<{ jobId: string; queue: string; status: string; outputApiUrl: string }>(
    "/api/finalized/push-all",
    { method: "POST", body: JSON.stringify({ supplierCode }), headers: { "Content-Type": "application/json" } }
  );

// Settings
export interface PricingSettings {
  taxRate: number;
  marginPercentage: number;
  currency: string;
  outputApiUrl: string;
  outputApiKey: string;
  autoPushEnabled?: boolean;
}

export interface PricingPreview {
  settings: { taxRate: number; marginPercentage: number };
  preview: Array<{
    articleNo: string;
    brand: string;
    description: string;
    basePrice: number;
    withMargin: number;
    withTax: number;
    currency: string;
  }>;
}

export const getSettings = () => apiFetch<PricingSettings>("/api/settings");

export const updateSettings = (data: Partial<PricingSettings>) =>
  apiFetch<PricingSettings>("/api/settings", {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export const getPricingPreview = (limit?: number) => {
  const qs = limit ? `?limit=${limit}` : "";
  return apiFetch<PricingPreview>(`/api/settings/pricing-preview${qs}`);
};

// InterCars Mapping Stats
export interface MappingStats {
  totalMappings: number;
  topBrands: Array<{ brand: string; count: number }>;
}

export const getMappingStats = () =>
  apiFetch<MappingStats>("/api/intercars/mapping-stats");

export interface UnmatchedBrand {
  icBrand: string;
  count: number;
}

export interface MatchedBrand {
  icBrand: string;
  count: number;
  tecdocBrand: string;
  method: string;
}

export interface AliasedBrand {
  icBrand: string;
  count: number;
  tecdocBrand: string;
}

export interface InterCarsUnmatchedResponse {
  summary: {
    totalIcBrands: number;
    matched: number;
    matchedProducts: number;
    aliased: number;
    aliasedProducts: number;
    unmatched: number;
    unmatchedProducts: number;
  };
  matched: MatchedBrand[];
  aliased: AliasedBrand[];
  unmatched: UnmatchedBrand[];
}

export const getInterCarsUnmatchedBrands = () =>
  apiFetch<InterCarsUnmatchedResponse>("/api/intercars/unmatched-brands");

export const seedInterCarsAliases = () =>
  apiFetch<{ created: number; skipped: number; errors?: string[] }>("/api/intercars/brand-aliases/seed", {
    method: "POST",
  });

export const createInterCarsAlias = (data: { supplierBrand: string; tecdocBrandId?: number; tecdocBrandName?: string }) =>
  apiFetch<{ id: number; supplierBrand: string; tecdocBrand: string }>("/api/intercars/brand-aliases", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const getMatchLogs = (params?: {
  page?: number;
  limit?: number;
  matched?: string;
  method?: string;
  supplierId?: string;
  from?: string;
  to?: string;
}) => {
  const qs = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    });
  }
  return apiFetch<MatchLogsResponse>(`/api/trace/logs?${qs}`);
};

// Unmatched Products (product_maps WHERE ic_sku IS NULL — never attempted IC match)
export interface UnmatchedProductItem {
  id: number;
  sku: string;
  articleNo: string;
  description: string;
  price: number | null;
  stock: number | null;
  currency: string;
  imageUrl: string | null;
  ean: string | null;
  tecdocId: string | null;
  brand: { id: number; name: string; code: string };
  supplier: { id: number; name: string; code: string };
  updatedAt: string;
}

export interface UnmatchedProductsResponse {
  items: UnmatchedProductItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const getUnmatchedProducts = (params?: {
  page?: number;
  limit?: number;
  q?: string;
  brandId?: number;
  withPrice?: "true" | "false";
}) => {
  const qs = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    });
  }
  return apiFetch<UnmatchedProductsResponse>(`/api/unmatched-products?${qs}`);
};

export const updateUnmatchedProduct = (id: number, data: {
  price?: number | null;
  stock?: number | null;
  currency?: string;
  description?: string;
}) =>
  apiFetch<{ id: number; price: number | null; stock: number | null; currency: string | null; description: string }>(`/api/unmatched-products/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

// Tasks / Issues
export type TaskType = "BUG" | "FEATURE" | "TASK";
export type TaskStatus = "OPEN" | "IN_PROGRESS" | "BLOCKED" | "DONE";
export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface Task {
  id: number;
  title: string;
  description: string | null;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: string | null;
  reporter: string | null;
  labels: string[];
  relatedUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskStats {
  status: Record<TaskStatus, number>;
  type: Record<TaskType, number>;
  openBugs: number;
}

export const getTasks = (params?: {
  status?: TaskStatus;
  type?: TaskType;
  assignee?: string;
  q?: string;
  limit?: number;
}) => {
  const qs = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    });
  }
  return apiFetch<{ items: Task[]; total: number }>(`/api/tasks?${qs}`);
};

export const getTaskStats = () => apiFetch<TaskStats>("/api/tasks/stats");

export const createTask = (data: {
  title: string;
  description?: string;
  type?: TaskType;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignee?: string;
  reporter?: string;
  labels?: string[];
  relatedUrl?: string;
}) =>
  apiFetch<Task>("/api/tasks", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const updateTask = (id: number, data: Partial<{
  title: string;
  description: string | null;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: string | null;
  labels: string[];
  relatedUrl: string | null;
}>) =>
  apiFetch<Task>(`/api/tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export const deleteTask = (id: number) =>
  apiFetch<{ success: boolean }>(`/api/tasks/${id}`, { method: "DELETE" });

// Kenteken (RDW) lookup
export interface KentekenResponse {
  plate: string;
  vehicle: {
    merk: string;
    handelsbenaming: string;
    voertuigsoort: string;
    inrichting: string | null;
    variant: string | null;
    uitvoering: string | null;
    year: number | null;
    dateFirstRegistration: string | null;
    cilinderinhoud: number | null;
    aantalCilinders: number | null;
    massa: number | null;
    europeseCategorie: string | null;
  };
  fuel: {
    brandstof: string | null;
    verbruik: number | null;
    co2: number | null;
    emissiecode: string | null;
    euroklasse: string | null;
    nettoVermogen: number | null;
  } | null;
  brandMatch: { id: number; name: string; code: string; tecdocId: number | null } | null;
  searchHint: { brand: string | null; year: number | null };
}

export const lookupKenteken = (plate: string) =>
  apiFetch<KentekenResponse>(`/api/kenteken/${encodeURIComponent(plate)}`);

// Cart
export interface CartItem {
  id: string;
  articleNo: string;
  name: string;
  brand: string;
  price: number;
  quantity: number;
  image?: string;
  sku?: string;
}

export interface Cart {
  key: string;
  items: CartItem[];
  createdAt: string;
  updatedAt: string;
}

export const getCart = (key: string) =>
  apiFetch<Cart>(`/api/cart/${encodeURIComponent(key)}`);

// The cart/add route returns { cart_key, cart } — unwrap to Cart so callers
// get the same shape as GET /cart/:key.
export const addToCart = async (data: {
  cart_key?: string;
  articleNo: string;
  name: string;
  brand?: string;
  price: number;
  quantity?: number;
  image?: string;
  sku?: string;
}): Promise<Cart> => {
  const res = await apiFetch<{ cart_key: string; cart: Cart }>("/api/cart/add", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return res.cart;
};

export const updateCartItem = (cartKey: string, itemId: string, quantity: number) =>
  apiFetch<Cart>(`/api/cart/${encodeURIComponent(cartKey)}/items/${encodeURIComponent(itemId)}`, {
    method: "PUT",
    body: JSON.stringify({ quantity }),
  });

export const removeCartItem = (cartKey: string, itemId: string) =>
  apiFetch<Cart>(`/api/cart/${encodeURIComponent(cartKey)}/items/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
  });

export const clearCart = (cartKey: string) =>
  apiFetch<{ ok: boolean }>(`/api/cart/${encodeURIComponent(cartKey)}`, {
    method: "DELETE",
  });

// Orders (WooCommerce checkout)
export interface OrderCustomer {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  address: string;
  city: string;
  postcode: string;
  country: string;
}

export interface Order {
  id: number;
  cartKey: string | null;
  wcOrderId: number | null;
  wcOrderUrl: string | null;
  status: "pending" | "processing" | "completed" | "cancelled" | "failed";
  total: number;
  currency: string;
  customerEmail: string;
  customerName: string;
  customerPhone: string | null;
  shipping: { street: string; city: string; postcode: string; country: string };
  items: Array<{
    id: string; articleNo: string; name: string; brand: string;
    price: number; quantity: number; sku?: string; image?: string;
  }>;
  note: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export const checkoutOrder = (data: {
  cartKey: string;
  customer: OrderCustomer;
  note?: string;
}) =>
  apiFetch<{
    ok: boolean; orderId: number; wcOrderId: number;
    wcOrderNumber: string; wcOrderUrl: string | null; total: number;
  }>("/api/orders/checkout", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const getOrders = (params?: { status?: string; limit?: number; page?: number }) => {
  const qs = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    });
  }
  return apiFetch<{ items: Order[]; total: number; page: number; limit: number }>(
    `/api/orders?${qs}`
  );
};

export const getOrder = (id: number) => apiFetch<Order>(`/api/orders/${id}`);

export const retryOrder = (id: number) =>
  apiFetch<{ ok: boolean; wcOrderId: number; orderId: number }>(`/api/orders/${id}/retry`, {
    method: "POST",
  });

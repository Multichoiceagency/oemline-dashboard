const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    "X-API-Key": API_KEY,
  };
  // Only set Content-Type for requests with a body
  if (init?.body) {
    headers["Content-Type"] = "application/json";
  }
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        ...headers,
        ...init?.headers,
      },
    });
  } catch (err) {
    throw new Error(`Network error: ${err instanceof Error ? err.message : "fetch failed"}`);
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
}

export const getJobsStatus = () => apiFetch<JobsStatusResponse>("/api/jobs/status");

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

export const getCategories = (params?: { page?: number; limit?: number; parentId?: number; q?: string }) => {
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

export const updateCategory = (id: number, data: { name?: string; code?: string; parentId?: number | null }) =>
  apiFetch<Category>(`/api/categories/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export const syncTecDocCategories = () =>
  apiFetch<{ created: number; updated: number; linked: number; total: number }>("/api/categories/sync-tecdoc", {
    method: "POST",
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

export const uploadGenericFile = async (file: File, folder = "misc"): Promise<{ url: string; objectName: string }> => {
  const formData = new FormData();
  formData.append("file", file);

  const url = `${API_BASE}/api/uploads/file?folder=${encodeURIComponent(folder)}`;
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

// Settings
export interface PricingSettings {
  taxRate: number;
  marginPercentage: number;
  currency: string;
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

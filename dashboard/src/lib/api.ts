const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": API_KEY,
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || body.error || `API error ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// Health
export interface HealthResponse {
  status: string;
  uptime: number;
  timestamp: string;
  checks: Record<string, string>;
  circuits: Record<string, { state: string; failures: number }>;
  queues: Record<string, number>;
}
export const getHealth = () => apiFetch<HealthResponse>("/health");

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
  suppliers: Supplier[];
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
  overrides: Override[];
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

export interface MatchLogsResponse {
  logs: MatchLog[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  stats: Record<
    string,
    { count: number; avgDuration: number; avgConfidence: number }
  >;
}

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

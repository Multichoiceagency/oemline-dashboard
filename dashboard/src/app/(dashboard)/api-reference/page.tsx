"use client";

import { useState } from "react";
import { useApi } from "@/lib/hooks";
import { getHealth } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Copy, Check, ExternalLink, Code2 } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

interface EndpointDef {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  description: string;
  category: string;
  params?: { name: string; type: string; required: boolean; description: string }[];
  response?: string;
  example?: string;
}

const ENDPOINTS: EndpointDef[] = [
  // Health
  {
    method: "GET",
    path: "/health",
    description: "System health check — no authentication required",
    category: "System",
    response: '{ status, uptime, timestamp, checks: { postgres, redis, meilisearch }, queues: { sync, match, index }, circuits: { ... } }',
  },
  // Search
  {
    method: "GET",
    path: "/api/search",
    description: "Search products across all suppliers and TecDoc cross-reference",
    category: "Search",
    params: [
      { name: "q", type: "string", required: true, description: "Search query (article number, OEM, EAN, or free text)" },
      { name: "brand", type: "string", required: false, description: "Filter by brand name" },
      { name: "articleNo", type: "string", required: false, description: "Filter by article number" },
      { name: "ean", type: "string", required: false, description: "Filter by EAN barcode" },
      { name: "tecdocId", type: "string", required: false, description: "Filter by TecDoc ID" },
      { name: "oem", type: "string", required: false, description: "Filter by OEM number" },
      { name: "limit", type: "number", required: false, description: "Max results (default: 50, max: 200)" },
    ],
    response: '{ query, results: [{ supplier, sku, brand, articleNo, ean, tecdocId, oem, description, price, stock, currency }], matches, errors, totalResults, cachedAt }',
    example: "/api/search?q=04E115561H",
  },
  // TecDoc
  {
    method: "GET",
    path: "/api/tecdoc/search",
    description: "Search TecDoc catalog directly (article number, OEM, EAN)",
    category: "TecDoc",
    params: [
      { name: "q", type: "string", required: true, description: "Search query" },
      { name: "type", type: "string", required: false, description: "Search type: article, oem, ean, free (default: free)" },
      { name: "brandId", type: "number", required: false, description: "Filter by TecDoc brand ID" },
      { name: "page", type: "number", required: false, description: "Page number (default: 1)" },
      { name: "limit", type: "number", required: false, description: "Results per page (default: 25)" },
    ],
    response: '{ articles: [{ articleNumber, brand, brandId, description, ean, oemNumbers, tecdocId }], total }',
    example: "/api/tecdoc/search?q=04E115561H&type=oem",
  },
  // Suppliers
  {
    method: "GET",
    path: "/api/suppliers",
    description: "List all registered suppliers with product counts",
    category: "Suppliers",
    params: [
      { name: "page", type: "number", required: false, description: "Page number" },
      { name: "limit", type: "number", required: false, description: "Items per page (max: 100)" },
      { name: "active", type: "string", required: false, description: "Filter: true, false, or all" },
    ],
    response: '{ items: [{ id, name, code, adapterType, baseUrl, priority, active, _count: { productMaps, overrides, unmatched } }], total, page, limit, totalPages }',
  },
  {
    method: "POST",
    path: "/api/suppliers",
    description: "Register a new supplier",
    category: "Suppliers",
    params: [
      { name: "name", type: "string", required: true, description: "Supplier display name" },
      { name: "code", type: "string", required: true, description: "Unique code (lowercase, a-z0-9_-)" },
      { name: "adapterType", type: "string", required: true, description: "Adapter: intercars, tecdoc, partspoint" },
      { name: "baseUrl", type: "string", required: true, description: "API base URL" },
      { name: "credentials", type: "object", required: true, description: "Encrypted credentials (key-value pairs)" },
      { name: "priority", type: "number", required: false, description: "Sort order (lower = higher priority)" },
      { name: "active", type: "boolean", required: false, description: "Enable supplier (default: true)" },
    ],
    response: '{ id, name, code, adapterType, baseUrl, priority, active, message }',
  },
  {
    method: "PATCH",
    path: "/api/suppliers/:id",
    description: "Update supplier settings",
    category: "Suppliers",
    params: [
      { name: "name", type: "string", required: false, description: "Supplier name" },
      { name: "active", type: "boolean", required: false, description: "Enable/disable supplier" },
      { name: "priority", type: "number", required: false, description: "Sort priority" },
      { name: "credentials", type: "object", required: false, description: "Update credentials" },
    ],
    response: '{ id, name, code, active, priority, message }',
  },
  {
    method: "POST",
    path: "/api/suppliers/:id/sync",
    description: "Trigger catalog sync for a supplier (BullMQ job)",
    category: "Suppliers",
    response: '{ message, jobId, supplier }',
  },
  // Overrides
  {
    method: "GET",
    path: "/api/overrides",
    description: "List manual product matching overrides",
    category: "Overrides",
    params: [
      { name: "page", type: "number", required: false, description: "Page number" },
      { name: "limit", type: "number", required: false, description: "Items per page" },
      { name: "supplierCode", type: "string", required: false, description: "Filter by supplier code" },
    ],
    response: '{ items: [{ id, articleNo, sku, ean, tecdocId, oem, reason, createdBy, active, supplier, brand }], total, page, limit, totalPages }',
  },
  {
    method: "POST",
    path: "/api/override",
    description: "Create a manual product matching override",
    category: "Overrides",
    params: [
      { name: "supplierCode", type: "string", required: true, description: "Supplier code" },
      { name: "brandCode", type: "string", required: true, description: "Brand code" },
      { name: "articleNo", type: "string", required: true, description: "Article number" },
      { name: "sku", type: "string", required: true, description: "Supplier SKU" },
      { name: "ean", type: "string", required: false, description: "EAN barcode" },
      { name: "tecdocId", type: "string", required: false, description: "TecDoc ID" },
      { name: "oem", type: "string", required: false, description: "OEM number" },
      { name: "reason", type: "string", required: false, description: "Override reason" },
    ],
    response: '{ id, articleNo, sku, ean, tecdocId, oem, reason, active }',
  },
  // Unmatched
  {
    method: "GET",
    path: "/api/unmatched",
    description: "List items that could not be matched automatically",
    category: "Unmatched",
    params: [
      { name: "page", type: "number", required: false, description: "Page number" },
      { name: "limit", type: "number", required: false, description: "Items per page" },
      { name: "resolved", type: "string", required: false, description: "Filter: true, false, all (default: false)" },
    ],
    response: '{ items: [{ id, query, articleNo, ean, tecdocId, oem, attempts, resolvedAt, supplier, brand }], total, page, limit, totalPages }',
  },
  // Match Logs
  {
    method: "GET",
    path: "/api/trace/logs",
    description: "Match analytics and audit trail",
    category: "Analytics",
    params: [
      { name: "page", type: "number", required: false, description: "Page number" },
      { name: "limit", type: "number", required: false, description: "Items per page (max: 200)" },
      { name: "matched", type: "string", required: false, description: "Filter: true, false, all" },
      { name: "method", type: "string", required: false, description: "Match method: override, tecdocId, ean, brand_article, oem" },
      { name: "supplierId", type: "number", required: false, description: "Filter by supplier ID" },
      { name: "from", type: "string", required: false, description: "Date from (ISO 8601)" },
      { name: "to", type: "string", required: false, description: "Date to (ISO 8601)" },
    ],
    response: '{ items: [{ id, query, sku, method, confidence, matched, durationMs, createdAt, supplier, brand }], total, page, limit, totalPages, stats: [{ method, count, avgDurationMs, avgConfidence }] }',
  },
  // Finalized Products (Storefront API)
  {
    method: "GET",
    path: "/api/finalized",
    description: "Paginated finalized products with pricing (margin + tax applied), stock, and InterCars mapping",
    category: "Storefront",
    params: [
      { name: "page", type: "number", required: false, description: "Page number (default: 1)" },
      { name: "limit", type: "number", required: false, description: "Items per page (default: 50, max: 250)" },
      { name: "q", type: "string", required: false, description: "Search by article, SKU, EAN, OEM, description" },
      { name: "brand", type: "string", required: false, description: "Filter by brand code" },
      { name: "category", type: "string", required: false, description: "Filter by category code" },
      { name: "supplier", type: "string", required: false, description: "Filter by supplier code" },
      { name: "hasStock", type: "string", required: false, description: "Filter: true (in stock), false (out of stock)" },
      { name: "hasPrice", type: "string", required: false, description: "Filter: true (has price), false (no price)" },
      { name: "hasImage", type: "string", required: false, description: "Filter: true (has image), false (no image)" },
    ],
    response: '{ items: [{ id, articleNo, sku, description, imageUrl, images, ean, price, priceWithMargin, priceWithTax, currency, stock, weight, brand, category, supplier, icMapping }], total, page, limit, totalPages, pricing: { taxRate, marginPercentage } }',
    example: "/api/finalized?limit=10&hasStock=true&hasPrice=true",
  },
  {
    method: "GET",
    path: "/api/finalized/stats",
    description: "Summary statistics for all finalized products",
    category: "Storefront",
    response: '{ totalProducts, withPrice, withStock, withImage, withIcMapping, topBrands: [{ brand, count }], topCategories: [{ category, count }] }',
  },
  {
    method: "GET",
    path: "/api/finalized/:id",
    description: "Single product with full details including InterCars mapping and calculated prices",
    category: "Storefront",
    response: '{ id, articleNo, sku, description, imageUrl, images, ean, tecdocId, oem, oemNumbers, price, priceWithMargin, priceWithTax, currency, stock, weight, brand, category, supplier, icMapping: [{ towKod, icIndex, manufacturer, description, ean, weight }] }',
  },
  // Settings
  {
    method: "GET",
    path: "/api/settings",
    description: "Get current pricing settings (tax rate, margin, currency)",
    category: "Settings",
    response: '{ taxRate: number, marginPercentage: number, currency: string }',
  },
  {
    method: "PATCH",
    path: "/api/settings",
    description: "Update pricing settings",
    category: "Settings",
    params: [
      { name: "taxRate", type: "number", required: false, description: "Tax/BTW percentage (e.g. 21)" },
      { name: "marginPercentage", type: "number", required: false, description: "Margin markup percentage (e.g. 20)" },
      { name: "currency", type: "string", required: false, description: "Currency code (e.g. EUR)" },
    ],
    response: '{ taxRate, marginPercentage, currency }',
  },
  {
    method: "GET",
    path: "/api/settings/pricing-preview",
    description: "Preview how pricing settings affect real product prices",
    category: "Settings",
    params: [
      { name: "limit", type: "number", required: false, description: "Number of preview products (default: 5, max: 20)" },
    ],
    response: '{ settings: { taxRate, marginPercentage }, preview: [{ articleNo, brand, basePrice, withMargin, withTax, currency }] }',
  },
];

const CATEGORIES = ["System", "Search", "TecDoc", "Suppliers", "Storefront", "Settings", "Overrides", "Unmatched", "Analytics"];

const METHOD_COLORS: Record<string, string> = {
  GET: "bg-green-500/10 text-green-600 border-green-500/20",
  POST: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  PATCH: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
  DELETE: "bg-red-500/10 text-red-600 border-red-500/20",
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Button variant="ghost" size="sm" onClick={handleCopy} className="h-7 px-2">
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
}

export default function ApiReferencePage() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const health = useApi(() => getHealth(), []);

  const filtered = selectedCategory
    ? ENDPOINTS.filter((e) => e.category === selectedCategory)
    : ENDPOINTS;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">API Reference</h2>
        <p className="text-muted-foreground text-sm">
          Use these endpoints in your frontend to access the OEMline platform
        </p>
      </div>

      {/* Base URL */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Code2 className="h-5 w-5" /> Base URL & Authentication
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm font-medium mb-1">Base URL</p>
            <div className="flex items-center gap-2 bg-muted rounded-lg px-4 py-2 font-mono text-sm">
              <span className="flex-1">{API_BASE}</span>
              <CopyButton text={API_BASE} />
            </div>
          </div>
          <div>
            <p className="text-sm font-medium mb-1">Authentication</p>
            <p className="text-sm text-muted-foreground mb-2">
              All endpoints (except /health) require the <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">X-API-Key</code> header.
            </p>
            <div className="bg-muted rounded-lg px-4 py-2 font-mono text-sm">
              <span className="text-muted-foreground">Header: </span>
              <span>X-API-Key: your-api-key</span>
            </div>
          </div>
          <div>
            <p className="text-sm font-medium mb-1">Status</p>
            <div className="flex gap-2 flex-wrap">
              {health.data ? (
                <>
                  <Badge variant="success">API Online</Badge>
                  {Object.entries(health.data.checks).map(([name, status]) => (
                    <Badge key={name} variant={status === "ok" ? "secondary" : "destructive"}>
                      {name}: {status}
                    </Badge>
                  ))}
                </>
              ) : health.loading ? (
                <Badge variant="secondary">Checking...</Badge>
              ) : (
                <Badge variant="destructive">API Offline</Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Category filter */}
      <div className="flex gap-2 flex-wrap">
        <Button
          variant={selectedCategory === null ? "default" : "outline"}
          size="sm"
          onClick={() => setSelectedCategory(null)}
        >
          All ({ENDPOINTS.length})
        </Button>
        {CATEGORIES.map((cat) => {
          const count = ENDPOINTS.filter((e) => e.category === cat).length;
          return (
            <Button
              key={cat}
              variant={selectedCategory === cat ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedCategory(cat)}
            >
              {cat} ({count})
            </Button>
          );
        })}
      </div>

      {/* Endpoints */}
      <div className="space-y-4">
        {filtered.map((endpoint, i) => (
          <Card key={i}>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <Badge className={`${METHOD_COLORS[endpoint.method]} font-mono text-xs px-2 py-0.5`}>
                  {endpoint.method}
                </Badge>
                <code className="font-mono text-sm font-medium">{endpoint.path}</code>
                <div className="flex-1" />
                <Badge variant="outline" className="text-xs">{endpoint.category}</Badge>
                {endpoint.example && (
                  <CopyButton text={`${API_BASE}${endpoint.example}`} />
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1">{endpoint.description}</p>
            </CardHeader>

            {(endpoint.params || endpoint.response || endpoint.example) && (
              <CardContent className="space-y-3 pt-0">
                {endpoint.params && endpoint.params.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">PARAMETERS</p>
                    <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[140px]">Name</TableHead>
                          <TableHead className="w-[80px]">Type</TableHead>
                          <TableHead className="w-[80px]">Required</TableHead>
                          <TableHead>Description</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {endpoint.params.map((p) => (
                          <TableRow key={p.name}>
                            <TableCell className="font-mono text-xs">{p.name}</TableCell>
                            <TableCell className="text-xs">{p.type}</TableCell>
                            <TableCell>
                              {p.required ? (
                                <Badge variant="destructive" className="text-[10px] px-1.5">required</Badge>
                              ) : (
                                <Badge variant="secondary" className="text-[10px] px-1.5">optional</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">{p.description}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    </div>
                  </div>
                )}

                {endpoint.response && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">RESPONSE</p>
                    <div className="bg-muted rounded-lg px-3 py-2 font-mono text-xs overflow-x-auto">
                      {endpoint.response}
                    </div>
                  </div>
                )}

                {endpoint.example && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">EXAMPLE</p>
                    <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2 font-mono text-xs">
                      <span className="flex-1 overflow-x-auto">
                        curl -H &quot;X-API-Key: $API_KEY&quot; &quot;{API_BASE}{endpoint.example}&quot;
                      </span>
                      <CopyButton text={`curl -H "X-API-Key: YOUR_API_KEY" "${API_BASE}${endpoint.example}"`} />
                    </div>
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        ))}
      </div>

      {/* Quick integration guide */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Integration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Use these endpoints from your frontend to build a complete automotive parts e-commerce experience.
          </p>
          <div className="space-y-2">
            <div className="bg-muted rounded-lg px-4 py-3 font-mono text-xs">
              <p className="text-muted-foreground mb-1">// JavaScript / TypeScript</p>
              <p>{`const API_URL = "${API_BASE}";`}</p>
              <p>{`const API_KEY = "your-api-key";`}</p>
              <p className="mt-2">{`const response = await fetch(\`\${API_URL}/api/search?q=04E115561H\`, {`}</p>
              <p>{`  headers: { "X-API-Key": API_KEY }`}</p>
              <p>{`});`}</p>
              <p>{`const data = await response.json();`}</p>
              <p className="text-muted-foreground mt-1">{`// data.results → [{ supplier, brand, articleNo, description, price, stock }]`}</p>
            </div>
          </div>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 mt-4">
            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium">Finalized Products</p>
              <p className="text-xs text-muted-foreground mt-1">Complete product catalog with prices (margin + tax applied), stock, and IC mapping. Use this for the storefront.</p>
              <code className="text-xs font-mono text-primary mt-2 block">GET /api/finalized</code>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium">Product Search</p>
              <p className="text-xs text-muted-foreground mt-1">Search by OEM, article number, EAN, or free text across all active suppliers.</p>
              <code className="text-xs font-mono text-primary mt-2 block">GET /api/search?q=...</code>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium">TecDoc Catalog</p>
              <p className="text-xs text-muted-foreground mt-1">Direct TecDoc search for article numbers, OEM cross-reference, and EAN lookups.</p>
              <code className="text-xs font-mono text-primary mt-2 block">GET /api/tecdoc/search?q=...</code>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium">Pricing Settings</p>
              <p className="text-xs text-muted-foreground mt-1">Get/update tax rate, margin percentage, and currency settings.</p>
              <code className="text-xs font-mono text-primary mt-2 block">GET /api/settings</code>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

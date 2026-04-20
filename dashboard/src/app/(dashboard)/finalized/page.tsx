"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useApi, useInterval } from "@/lib/hooks";
import {
  getFinalized,
  getFinalizedStats,
  getBrands,
  getCategories,
  getSuppliers,
  getJobsStatus,
  pushFinalizedProduct,
  pushAllFinalized,
} from "@/lib/api";
import type { FinalizedProduct } from "@/lib/api";
import { useTranslation } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatNumber, formatDate } from "@/lib/utils";
import {
  ShoppingCart,
  Search,
  Package,
  DollarSign,
  Boxes,
  ImageIcon,
  Link2,
  X,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Tag,
  Eye,
  Car,
  Activity,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Clock,
  Zap,
  Send,
  ChevronDown,
} from "lucide-react";

export default function FinalizedPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [fieldDistOpen, setFieldDistOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [stockFilter, setStockFilter] = useState("");
  // Hide products without price by default — corrupt/uninitialized rows are
  // distracting on the default view. User can still opt-in via the filter.
  const [priceFilter, setPriceFilter] = useState("true");
  const [imageFilter, setImageFilter] = useState("");

  const { data, loading, refetch } = useApi(
    () =>
      getFinalized({
        page,
        limit: 50,
        q: searchQuery || undefined,
        brand: brandFilter || undefined,
        category: categoryFilter || undefined,
        supplier: supplierFilter || undefined,
        hasStock: stockFilter || undefined,
        hasPrice: priceFilter || undefined,
        hasImage: imageFilter || undefined,
      }),
    [page, searchQuery, brandFilter, categoryFilter, supplierFilter, stockFilter, priceFilter, imageFilter]
  );

  const { data: stats, refetch: refetchStats } = useApi(() => getFinalizedStats(), []);
  const { data: jobsStatus, refetch: refetchJobs } = useApi(() => getJobsStatus(), []);

  // Auto-refresh data and stats every 30 seconds
  useInterval(() => {
    refetch();
    refetchStats();
  }, 30_000);

  // Refresh worker status every 5 seconds for live feel
  useInterval(() => {
    refetchJobs();
  }, 5_000);

  const { data: brandsData } = useApi(() => getBrands({ limit: 250 }), []);
  const { data: categoriesData } = useApi(() => getCategories({ limit: 250 }), []);
  const { data: suppliersData } = useApi(() => getSuppliers({ limit: 50 }), []);

  const [bulkPushing, setBulkPushing] = useState(false);
  const [bulkPushResult, setBulkPushResult] = useState<"queued" | "error" | null>(null);

  const handleBulkPush = async () => {
    setBulkPushing(true);
    setBulkPushResult(null);
    try {
      await pushAllFinalized();
      setBulkPushResult("queued");
      setTimeout(() => setBulkPushResult(null), 5000);
    } catch {
      setBulkPushResult("error");
      setTimeout(() => setBulkPushResult(null), 5000);
    } finally {
      setBulkPushing(false);
    }
  };

  const handleSearch = useCallback(() => {
    setSearchQuery(searchInput);
    setPage(1);
  }, [searchInput]);

  const clearFilters = () => {
    setSearchInput("");
    setSearchQuery("");
    setBrandFilter("");
    setCategoryFilter("");
    setSupplierFilter("");
    setStockFilter("");
    setPriceFilter("");
    setImageFilter("");
    setPage(1);
  };

  const hasFilters = searchQuery || brandFilter || categoryFilter || supplierFilter || stockFilter || priceFilter || imageFilter;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">{t("finalized.title")}</h1>
        <p className="text-muted-foreground text-sm">{t("finalized.subtitle")}</p>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 sm:gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{t("finalized.total")}</span>
              </div>
              <p className="text-2xl font-bold mt-1">{formatNumber(stats.totalProducts)}</p>
            </CardContent>
          </Card>
          <Card className={stats.indexStats ? (stats.indexStats.numberOfDocuments === stats.totalProducts ? "border-emerald-500/50" : "border-amber-500/50") : ""}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Geindexeerd</span>
              </div>
              <p className="text-2xl font-bold mt-1">
                {stats.indexStats ? formatNumber(stats.indexStats.numberOfDocuments) : "—"}
              </p>
              {stats.indexStats && (
                <p className={`text-xs ${stats.indexStats.numberOfDocuments === stats.totalProducts ? "text-emerald-500" : "text-amber-500"}`}>
                  {stats.indexStats.isIndexing ? "Bezig met indexeren..." : (
                    stats.indexStats.numberOfDocuments === stats.totalProducts
                      ? "100% geindexeerd"
                      : `${stats.totalProducts > 0 ? Math.round((stats.indexStats.numberOfDocuments / stats.totalProducts) * 100) : 0}% van totaal`
                  )}
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{t("finalized.withPrice")}</span>
              </div>
              <p className="text-2xl font-bold mt-1">{formatNumber(stats.withPrice)}</p>
              <p className="text-xs text-muted-foreground">
                {stats.totalProducts > 0 ? Math.round((stats.withPrice / stats.totalProducts) * 100) : 0}%
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Boxes className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{t("finalized.inStock")}</span>
              </div>
              <p className="text-2xl font-bold mt-1">{formatNumber(stats.withStock)}</p>
              <p className="text-xs text-muted-foreground">
                {stats.totalProducts > 0 ? Math.round((stats.withStock / stats.totalProducts) * 100) : 0}%
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{t("finalized.withImage")}</span>
              </div>
              <p className="text-2xl font-bold mt-1">{formatNumber(stats.withImage)}</p>
              <p className="text-xs text-muted-foreground">
                {stats.totalProducts > 0 ? Math.round((stats.withImage / stats.totalProducts) * 100) : 0}%
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Link2 className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{t("finalized.icMapped")}</span>
              </div>
              <p className="text-2xl font-bold mt-1">{formatNumber(stats.withIcMapping)}</p>
              <p className="text-xs text-muted-foreground">
                {stats.totalProducts > 0 ? Math.round((stats.withIcMapping / stats.totalProducts) * 100) : 0}%
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Live Worker Status */}
      {jobsStatus && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Live Worker Status
              <span className="ml-auto flex items-center gap-1 text-xs font-normal text-muted-foreground">
                <RefreshCw className="h-3 w-3 animate-spin" style={{ animationDuration: "3s" }} />
                elke 5s
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {(
                [
                  { key: "icMatch" as const, label: "IC Match", icon: Link2, color: "violet" },
                  { key: "pricing" as const, label: "Prijzen", icon: DollarSign, color: "emerald" },
                  { key: "stock" as const, label: "Voorraad", icon: Boxes, color: "blue" },
                  { key: "sync" as const, label: "Sync", icon: RefreshCw, color: "amber" },
                  { key: "match" as const, label: "Match", icon: Zap, color: "orange" },
                  { key: "index" as const, label: "Index", icon: Search, color: "pink" },
                ] as const
              ).map(({ key, label, icon: Icon, color }) => {
                const q = jobsStatus[key];
                const isRunning = q.active > 0;
                const hasFailed = q.failed > 0;
                const isWaiting = q.waiting > 0 || q.prioritized > 0;

                return (
                  <div
                    key={key}
                    className={`rounded-lg border p-3 transition-colors ${
                      isRunning
                        ? "border-emerald-500/50 bg-emerald-500/5"
                        : hasFailed
                        ? "border-red-500/30 bg-red-500/5"
                        : "bg-muted/30"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        <Icon className={`h-3.5 w-3.5 ${isRunning ? "text-emerald-500" : "text-muted-foreground"}`} />
                        <span className="text-xs font-medium">{label}</span>
                      </div>
                      {isRunning ? (
                        <span className="flex items-center gap-1 text-xs text-emerald-500 font-medium">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                          </span>
                          Actief
                        </span>
                      ) : hasFailed ? (
                        <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                      ) : isWaiting ? (
                        <Clock className="h-3.5 w-3.5 text-amber-500" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground/50" />
                      )}
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Actief</span>
                        <span className={`font-medium ${isRunning ? "text-emerald-500" : ""}`}>{q.active}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Wachtend</span>
                        <span className="font-medium">{q.waiting + q.prioritized}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Klaar</span>
                        <span className="font-medium text-muted-foreground">{formatNumber(q.completed)}</span>
                      </div>
                      {q.failed > 0 && (
                        <div className="flex justify-between text-xs">
                          <span className="text-red-500">Mislukt</span>
                          <span className="font-medium text-red-500">{q.failed}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Index field distribution (collapsible) */}
      {stats?.indexStats && Object.keys(stats.indexStats.fieldDistribution).length > 0 && (
        <Card>
          <CardHeader
            className="cursor-pointer select-none"
            onClick={() => setFieldDistOpen((v) => !v)}
          >
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="h-4 w-4" />
              Meilisearch Index — Velden Verdeling
              <span className="text-xs font-normal text-muted-foreground ml-1">
                ({Object.keys(stats.indexStats.fieldDistribution).length} velden)
              </span>
              <ChevronDown
                className={`h-4 w-4 ml-auto transition-transform ${fieldDistOpen ? "rotate-180" : ""}`}
              />
            </CardTitle>
          </CardHeader>
          {fieldDistOpen && (
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {Object.entries(stats.indexStats.fieldDistribution)
                  .sort(([, a], [, b]) => b - a)
                  .map(([field, count]) => {
                    const pct = stats.indexStats!.numberOfDocuments > 0
                      ? Math.round((count / stats.indexStats!.numberOfDocuments) * 100)
                      : 0;
                    return (
                      <div key={field} className="rounded-lg border p-3">
                        <p className="text-xs font-mono text-muted-foreground truncate">{field}</p>
                        <p className="text-lg font-bold">{formatNumber(count)}</p>
                        <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full ${pct === 100 ? "bg-emerald-500" : pct > 50 ? "bg-blue-500" : "bg-amber-500"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{pct}%</p>
                      </div>
                    );
                  })}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Search and Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t("finalized.searchPlaceholder")}
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="pl-10"
                />
              </div>
              <Button onClick={handleSearch}>{t("common.search")}</Button>
              {hasFilters && (
                <Button variant="outline" onClick={clearFilters}>
                  <X className="h-4 w-4 mr-1" />
                  {t("common.clear")}
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Select value={brandFilter} onValueChange={(v) => { setBrandFilter(v === "all" ? "" : v); setPage(1); }}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder={t("filter.allBrands")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("filter.allBrands")}</SelectItem>
                  {brandsData?.items.map((b) => (
                    <SelectItem key={b.id} value={b.code}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={categoryFilter} onValueChange={(v) => { setCategoryFilter(v === "all" ? "" : v); setPage(1); }}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder={t("filter.allCategories")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("filter.allCategories")}</SelectItem>
                  {categoriesData?.items.map((c) => (
                    <SelectItem key={c.id} value={c.code}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={supplierFilter} onValueChange={(v) => { setSupplierFilter(v === "all" ? "" : v); setPage(1); }}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder={t("filter.allSuppliers")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("filter.allSuppliers")}</SelectItem>
                  {suppliersData?.items.map((s) => (
                    <SelectItem key={s.id} value={s.code}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={stockFilter} onValueChange={(v) => { setStockFilter(v === "all" ? "" : v); setPage(1); }}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder={t("filter.stock")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("filter.anyStock")}</SelectItem>
                  <SelectItem value="true">{t("filter.inStock")}</SelectItem>
                  <SelectItem value="false">{t("filter.outOfStock")}</SelectItem>
                </SelectContent>
              </Select>

              <Select value={priceFilter} onValueChange={(v) => { setPriceFilter(v === "all" ? "" : v); setPage(1); }}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder={t("filter.price")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("filter.anyPrice")}</SelectItem>
                  <SelectItem value="true">{t("filter.hasPrice")}</SelectItem>
                  <SelectItem value="false">{t("filter.noPrice")}</SelectItem>
                </SelectContent>
              </Select>

              <Select value={imageFilter} onValueChange={(v) => { setImageFilter(v === "all" ? "" : v); setPage(1); }}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder={t("filter.image")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("filter.anyImage")}</SelectItem>
                  <SelectItem value="true">{t("filter.hasImage")}</SelectItem>
                  <SelectItem value="false">{t("filter.noImage")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Products table */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            {t("finalized.products")}
            {data && (
              <Badge variant="secondary">{formatNumber(data.total)}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !data?.items.length ? (
            <div className="text-center py-12 text-muted-foreground">
              {t("common.noResults")}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[60px]">{t("filter.image")}</TableHead>
                      <TableHead>{t("finalized.articleNo")}</TableHead>
                      <TableHead>{t("finalized.brand")}</TableHead>
                      <TableHead>Product Title</TableHead>
                      <TableHead>{t("filter.price")}</TableHead>
                      <TableHead>{t("finalized.stock")}</TableHead>
                      <TableHead>{t("finalized.supplier")}</TableHead>
                      <TableHead className="w-[100px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((product) => (
                      <ProductRow
                        key={product.id}
                        product={product}
                        onNavigate={() => router.push(`/finalized/${product.id}`)}
                        onPush={pushFinalizedProduct}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mt-4 gap-3">
                <p className="text-sm text-muted-foreground">
                  {t("common.showing")} {(data.page - 1) * data.limit + 1}-
                  {Math.min(data.page * data.limit, data.total)} {t("common.of")}{" "}
                  {formatNumber(data.total)}
                </p>
                <div className="flex gap-2 items-center">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                    className="min-h-[44px] sm:min-h-0"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    <span className="hidden sm:inline">{t("common.previous")}</span>
                  </Button>
                  <span className="flex items-center text-sm px-2">
                    {data.page}/{data.totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= data.totalPages}
                    onClick={() => setPage(page + 1)}
                    className="min-h-[44px] sm:min-h-0"
                  >
                    <span className="hidden sm:inline">{t("common.next")}</span>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Top Brands */}
      {stats && stats.topBrands.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Tag className="h-5 w-5" />
              {t("finalized.topBrands")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {stats.topBrands.map((b) => (
                <Button
                  key={b.brand.id}
                  variant={brandFilter === b.brand.code ? "default" : "outline"}
                  size="sm"
                  className="gap-2"
                  onClick={() => {
                    setBrandFilter(brandFilter === b.brand.code ? "" : b.brand.code);
                    setPage(1);
                  }}
                >
                  {b.brand.logoUrl && (
                    <img src={b.brand.logoUrl} alt="" className="h-4 w-4 object-contain" />
                  )}
                  {b.brand.name}
                  <Badge variant="secondary" className="ml-1">{formatNumber(b.count)}</Badge>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

    </div>
  );
}

function ProductRow({
  product,
  onNavigate,
  onPush,
}: {
  product: FinalizedProduct;
  onNavigate: () => void;
  onPush: (id: number) => Promise<{ success: boolean }>;
}) {
  const [rowPushing, setRowPushing] = useState(false);
  const [rowPushDone, setRowPushDone] = useState(false);

  const handleRowPush = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setRowPushing(true);
    try {
      await onPush(product.id);
      setRowPushDone(true);
      setTimeout(() => setRowPushDone(false), 3000);
    } catch {
      // ignore — user can open detail for error feedback
    } finally {
      setRowPushing(false);
    }
  };

  return (
    <TableRow className="cursor-pointer hover:bg-accent/50" onClick={onNavigate}>
      <TableCell>
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt=""
            className="h-10 w-10 object-contain rounded"
          />
        ) : (
          <div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
            <ImageIcon className="h-4 w-4 text-muted-foreground" />
          </div>
        )}
      </TableCell>
      <TableCell className="font-mono text-sm">
        <div>{product.articleNo}</div>
        <div className="text-muted-foreground text-xs">SKU: {product.sku}</div>
        {product.icMapping && (
          <div className="text-blue-600 text-xs">IC: {product.icMapping.towKod}</div>
        )}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          {product.brand?.logoUrl && (
            <img src={product.brand.logoUrl} alt="" className="h-5 w-5 object-contain" />
          )}
          <span className="text-sm">{product.brand?.name}</span>
        </div>
      </TableCell>
      <TableCell className="max-w-[250px] text-sm">
        <div className="truncate font-medium">
          {[product.genericArticle, product.category?.name].filter(Boolean).join(" — ") || product.brand?.name || "-"}
        </div>
        {product.description && (
          <div className="truncate text-xs text-muted-foreground">{product.description}</div>
        )}
      </TableCell>
      <TableCell>
        {product.price != null ? (
          <div>
            <span className="font-medium">
              {product.currency === "EUR" ? "\u20AC" : product.currency}{" "}
              {(product.priceWithTax ?? product.price).toFixed(2)}
            </span>
            {product.priceWithTax != null && product.priceWithTax !== product.price && (
              <p className="text-[10px] text-muted-foreground line-through">
                {product.currency === "EUR" ? "\u20AC" : product.currency} {product.price.toFixed(2)}
              </p>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground text-sm">-</span>
        )}
      </TableCell>
      <TableCell>
        {product.stock != null && product.stock > 0 ? (
          <Badge variant="default" className="bg-green-600">{product.stock}</Badge>
        ) : (
          <Badge variant="secondary">0</Badge>
        )}
      </TableCell>
      <TableCell>
        <Badge variant="secondary" className="text-xs">
          {product.supplier?.name}
        </Badge>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); onNavigate(); }}>
            <Eye className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}


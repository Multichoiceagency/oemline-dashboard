"use client";

import { useState, useCallback } from "react";
import { useApi, useInterval } from "@/lib/hooks";
import {
  getFinalized,
  getFinalizedStats,
  getFinalizedProduct,
  getBrands,
  getCategories,
  getSuppliers,
} from "@/lib/api";
import type { FinalizedProduct, FinalizedDetail } from "@/lib/api";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
} from "lucide-react";

export default function FinalizedPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [stockFilter, setStockFilter] = useState("");
  const [priceFilter, setPriceFilter] = useState("");
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

  // Auto-refresh data and stats every 30 seconds
  useInterval(() => {
    refetch();
    refetchStats();
  }, 30_000);

  const { data: brandsData } = useApi(() => getBrands({ limit: 250 }), []);
  const { data: categoriesData } = useApi(() => getCategories({ limit: 250 }), []);
  const { data: suppliersData } = useApi(() => getSuppliers({ limit: 50 }), []);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { data: detail, loading: loadingDetail } = useApi(
    () => (selectedId ? getFinalizedProduct(selectedId) : Promise.resolve(null)),
    [selectedId]
  );

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
        <h1 className="text-3xl font-bold">{t("finalized.title")}</h1>
        <p className="text-muted-foreground">{t("finalized.subtitle")}</p>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{t("finalized.total")}</span>
              </div>
              <p className="text-2xl font-bold mt-1">{formatNumber(stats.totalProducts)}</p>
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
        <CardHeader className="flex flex-row items-center justify-between">
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
                      <TableHead>{t("finalized.description")}</TableHead>
                      <TableHead>{t("filter.price")}</TableHead>
                      <TableHead>{t("finalized.stock")}</TableHead>
                      <TableHead>{t("finalized.icCode")}</TableHead>
                      <TableHead>{t("finalized.supplier")}</TableHead>
                      <TableHead className="w-[60px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((product) => (
                      <ProductRow
                        key={product.id}
                        product={product}
                        onClick={() => setSelectedId(product.id)}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-muted-foreground">
                  {t("common.showing")} {(data.page - 1) * data.limit + 1}-
                  {Math.min(data.page * data.limit, data.total)} {t("common.of")}{" "}
                  {formatNumber(data.total)}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    {t("common.previous")}
                  </Button>
                  <span className="flex items-center text-sm px-2">
                    {t("common.page")} {data.page} {t("common.of")} {data.totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= data.totalPages}
                    onClick={() => setPage(page + 1)}
                  >
                    {t("common.next")}
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

      {/* Detail Dialog */}
      <Dialog open={selectedId !== null} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              {t("finalized.productDetails")}
            </DialogTitle>
          </DialogHeader>
          {loadingDetail ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : detail ? (
            <ProductDetail product={detail} />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProductRow({
  product,
  onClick,
}: {
  product: FinalizedProduct;
  onClick: () => void;
}) {
  return (
    <TableRow className="cursor-pointer hover:bg-accent/50" onClick={onClick}>
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
      <TableCell className="font-mono text-sm">{product.articleNo}</TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          {product.brand?.logoUrl && (
            <img src={product.brand.logoUrl} alt="" className="h-5 w-5 object-contain" />
          )}
          <span className="text-sm">{product.brand?.name}</span>
        </div>
      </TableCell>
      <TableCell className="max-w-[250px] truncate text-sm">
        {product.description}
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
        {product.icMapping ? (
          <Badge variant="outline" className="font-mono text-xs">
            {product.icMapping.towKod}
          </Badge>
        ) : (
          <span className="text-muted-foreground text-sm">-</span>
        )}
      </TableCell>
      <TableCell>
        <Badge variant="secondary" className="text-xs">
          {product.supplier?.name}
        </Badge>
      </TableCell>
      <TableCell>
        <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); onClick(); }}>
          <Eye className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

function ProductDetail({ product }: { product: FinalizedDetail }) {
  const { t } = useTranslation();
  const cur = product.currency === "EUR" ? "\u20AC" : product.currency ?? "";

  return (
    <div className="space-y-6">
      {/* Image + Basic Info */}
      <div className="flex gap-6">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.description}
            className="h-40 w-40 object-contain rounded-lg border"
          />
        ) : (
          <div className="h-40 w-40 rounded-lg border bg-muted flex items-center justify-center">
            <ImageIcon className="h-12 w-12 text-muted-foreground" />
          </div>
        )}
        <div className="flex-1 space-y-2">
          <h3 className="text-lg font-semibold">{product.description}</h3>
          <div className="flex items-center gap-2">
            {product.brand?.logoUrl && (
              <img src={product.brand.logoUrl} alt="" className="h-6 w-6 object-contain" />
            )}
            <span className="font-medium">{product.brand?.name}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-muted-foreground">{t("finalized.articleNo")}:</span>{" "}
              <span className="font-mono">{product.articleNo}</span>
            </div>
            <div>
              <span className="text-muted-foreground">{t("finalized.sku")}:</span>{" "}
              <span className="font-mono">{product.sku}</span>
            </div>
            {product.ean && (
              <div>
                <span className="text-muted-foreground">{t("finalized.ean")}:</span>{" "}
                <span className="font-mono">{product.ean}</span>
              </div>
            )}
            {product.tecdocId && (
              <div>
                <span className="text-muted-foreground">{t("finalized.tecdocId")}:</span>{" "}
                <span className="font-mono">{product.tecdocId}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Pricing & Stock */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">{t("settings.basePrice")}</p>
            <p className="text-lg font-bold">
              {product.price != null
                ? `${cur} ${product.price.toFixed(2)}`
                : t("finalized.notSet")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">{t("settings.withTax")}</p>
            <p className="text-lg font-bold text-green-600">
              {product.priceWithTax != null
                ? `${cur} ${product.priceWithTax.toFixed(2)}`
                : t("finalized.notSet")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">{t("finalized.stock")}</p>
            <p className="text-lg font-bold">{product.stock ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">{t("finalized.weight")}</p>
            <p className="text-lg font-bold">
              {product.weight != null ? `${product.weight} kg` : "-"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Metadata */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-muted-foreground">{t("finalized.category")}:</span>{" "}
          {product.category?.name ?? "-"}
        </div>
        <div>
          <span className="text-muted-foreground">{t("finalized.supplier")}:</span>{" "}
          {product.supplier?.name}
        </div>
        {product.genericArticle && (
          <div>
            <span className="text-muted-foreground">{t("finalized.genericArticle")}:</span>{" "}
            {product.genericArticle}
          </div>
        )}
        <div>
          <span className="text-muted-foreground">{t("finalized.status")}:</span>{" "}
          <Badge variant={product.status === "active" ? "default" : "secondary"}>
            {product.status}
          </Badge>
        </div>
        <div>
          <span className="text-muted-foreground">{t("finalized.updated")}:</span>{" "}
          {formatDate(product.updatedAt)}
        </div>
        <div>
          <span className="text-muted-foreground">{t("finalized.created")}:</span>{" "}
          {formatDate(product.createdAt)}
        </div>
      </div>

      {/* OEM Numbers */}
      {product.oemNumbers && product.oemNumbers.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2">{t("finalized.oemNumbers")}</h4>
          <div className="flex flex-wrap gap-1">
            {product.oemNumbers.map((oem, i) => (
              <Badge key={i} variant="outline" className="font-mono text-xs">
                {oem}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Additional Images */}
      {product.images && product.images.length > 1 && (
        <div>
          <h4 className="text-sm font-medium mb-2">{t("finalized.images")}</h4>
          <div className="flex gap-2 flex-wrap">
            {product.images.map((url, i) => (
              <img
                key={i}
                src={url}
                alt=""
                className="h-20 w-20 object-contain rounded border"
              />
            ))}
          </div>
        </div>
      )}

      {/* InterCars Mapping */}
      {product.icMapping && product.icMapping.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2">{t("finalized.icMapping")}</h4>
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("finalized.towCode")}</TableHead>
                  <TableHead>{t("finalized.icIndex")}</TableHead>
                  <TableHead>{t("finalized.manufacturer")}</TableHead>
                  <TableHead>{t("finalized.description")}</TableHead>
                  <TableHead>{t("finalized.ean")}</TableHead>
                  <TableHead>{t("finalized.weight")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {product.icMapping.map((ic, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-sm">{ic.towKod}</TableCell>
                    <TableCell className="font-mono text-sm">{ic.icIndex}</TableCell>
                    <TableCell>{ic.manufacturer}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{ic.description}</TableCell>
                    <TableCell className="font-mono text-xs">{ic.ean ?? "-"}</TableCell>
                    <TableCell>{ic.weight != null ? `${ic.weight} kg` : "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}

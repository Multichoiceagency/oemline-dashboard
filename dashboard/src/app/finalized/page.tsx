"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useApi, useInterval } from "@/lib/hooks";
import {
  getFinalized,
  getFinalizedStats,
  getFinalizedProduct,
  getBrands,
  getCategories,
  getSuppliers,
  updateProduct,
  uploadProductImage,
  getTecDocLinkages,
} from "@/lib/api";
import type { FinalizedProduct, FinalizedDetail, VehicleLinkage } from "@/lib/api";
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
  DialogFooter,
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
  Pencil,
  Upload,
  Trash2,
  Car,
  Star,
  Plus,
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
  const { data: detail, loading: loadingDetail, refetch: refetchDetail } = useApi(
    () => (selectedId ? getFinalizedProduct(selectedId) : Promise.resolve(null)),
    [selectedId]
  );

  // Edit mode state
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({
    description: "",
    imageUrl: "",
    images: [] as string[],
    price: "",
    currency: "EUR",
    stock: "",
    genericArticle: "",
    status: "active",
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const imageFileRef = useRef<HTMLInputElement>(null);

  const openEdit = (product: FinalizedDetail) => {
    setEditMode(true);
    setEditForm({
      description: product.description || "",
      imageUrl: product.imageUrl || "",
      images: product.images ?? [],
      price: product.price != null ? String(product.price) : "",
      currency: product.currency || "EUR",
      stock: product.stock != null ? String(product.stock) : "",
      genericArticle: product.genericArticle || "",
      status: product.status || "active",
    });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !selectedId) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const result = await uploadProductImage(selectedId, file);
        setEditForm((prev) => ({
          ...prev,
          images: [...prev.images, result.url],
          imageUrl: prev.imageUrl || result.url,
        }));
      }
      refetchDetail();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (imageFileRef.current) imageFileRef.current.value = "";
    }
  };

  const removeImage = (url: string) => {
    setEditForm((prev) => {
      const newImages = prev.images.filter((img) => img !== url);
      const newPrimary = prev.imageUrl === url
        ? (newImages[0] ?? "")
        : prev.imageUrl;
      return { ...prev, images: newImages, imageUrl: newPrimary };
    });
  };

  const setPrimaryImage = (url: string) => {
    setEditForm((prev) => ({ ...prev, imageUrl: url }));
  };

  const handleSave = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      await updateProduct(selectedId, {
        description: editForm.description,
        imageUrl: editForm.imageUrl || null,
        images: editForm.images,
        price: editForm.price ? parseFloat(editForm.price) : null,
        currency: editForm.currency || "EUR",
        stock: editForm.stock ? parseInt(editForm.stock, 10) : null,
        genericArticle: editForm.genericArticle || null,
        status: editForm.status,
      });
      setEditMode(false);
      refetchDetail();
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update product");
    } finally {
      setSaving(false);
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
      <Dialog open={selectedId !== null} onOpenChange={(open) => { if (!open) { setSelectedId(null); setEditMode(false); } }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              {editMode ? "Edit Product" : t("finalized.productDetails")}
            </DialogTitle>
          </DialogHeader>
          {loadingDetail ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : detail ? (
            editMode ? (
              <div className="space-y-4 py-4">
                {/* Image Gallery Management */}
                <div className="space-y-3">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <ImageIcon className="h-4 w-4" /> Product Images
                  </label>

                  {/* Existing images grid */}
                  {editForm.images.length > 0 ? (
                    <div className="grid grid-cols-4 gap-3">
                      {editForm.images.map((url, i) => (
                        <div
                          key={i}
                          className={`relative group rounded-lg border-2 overflow-hidden ${
                            url === editForm.imageUrl
                              ? "border-blue-500 ring-2 ring-blue-200"
                              : "border-muted hover:border-muted-foreground/30"
                          }`}
                        >
                          <img
                            src={url}
                            alt={`Product image ${i + 1}`}
                            className="h-24 w-full object-contain bg-white p-1"
                          />
                          {url === editForm.imageUrl && (
                            <div className="absolute top-1 left-1">
                              <Badge className="bg-blue-500 text-[10px] px-1 py-0">
                                <Star className="h-2.5 w-2.5 mr-0.5" /> Primary
                              </Badge>
                            </div>
                          )}
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100">
                            {url !== editForm.imageUrl && (
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                className="h-7 text-xs"
                                onClick={() => setPrimaryImage(url)}
                              >
                                <Star className="h-3 w-3" />
                              </Button>
                            )}
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              className="h-7 text-xs"
                              onClick={() => removeImage(url)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-24 rounded-lg border-2 border-dashed border-muted text-muted-foreground text-sm">
                      No images yet
                    </div>
                  )}

                  {/* Upload button */}
                  <div className="flex gap-2">
                    <input
                      ref={imageFileRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={handleImageUpload}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => imageFileRef.current?.click()}
                      disabled={uploading}
                      className="w-full"
                    >
                      {uploading ? (
                        <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Uploading...</>
                      ) : (
                        <><Plus className="h-4 w-4 mr-2" /> Upload Images</>
                      )}
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Click an image to set as primary. Supports multiple file upload.
                  </p>
                </div>

                {/* Description */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Description</label>
                  <Input
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  />
                </div>

                {/* Generic Article */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Generic Article</label>
                  <Input
                    value={editForm.genericArticle}
                    onChange={(e) => setEditForm({ ...editForm, genericArticle: e.target.value })}
                    placeholder="e.g. Brake Pad Set"
                  />
                </div>

                {/* Pricing & Stock */}
                <div className="rounded-lg border p-4 space-y-4">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <DollarSign className="h-4 w-4" /> Pricing & Stock
                  </h4>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Price</label>
                      <Input
                        type="number"
                        step="0.01"
                        value={editForm.price}
                        onChange={(e) => setEditForm({ ...editForm, price: e.target.value })}
                        placeholder="0.00"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Currency</label>
                      <Select
                        value={editForm.currency}
                        onValueChange={(v) => setEditForm({ ...editForm, currency: v })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="EUR">EUR</SelectItem>
                          <SelectItem value="USD">USD</SelectItem>
                          <SelectItem value="GBP">GBP</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Stock</label>
                      <Input
                        type="number"
                        value={editForm.stock}
                        onChange={(e) => setEditForm({ ...editForm, stock: e.target.value })}
                        placeholder="0"
                      />
                    </div>
                  </div>
                </div>

                {/* Status */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Status</label>
                  <Select
                    value={editForm.status}
                    onValueChange={(v) => setEditForm({ ...editForm, status: v })}
                  >
                    <SelectTrigger className="w-[200px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                      <SelectItem value="discontinued">Discontinued</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Read-only info */}
                <div className="grid grid-cols-2 gap-4 text-sm border-t pt-4">
                  <div>
                    <span className="text-muted-foreground">Article No.:</span>{" "}
                    <span className="font-mono">{detail.articleNo}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">SKU:</span>{" "}
                    <span className="font-mono">{detail.sku}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Brand:</span>{" "}
                    {detail.brand?.name}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Supplier:</span>{" "}
                    {detail.supplier?.name}
                  </div>
                  {detail.icMapping && detail.icMapping.length > 0 && (
                    <div>
                      <span className="text-muted-foreground">InterCars Code:</span>{" "}
                      <span className="font-mono text-blue-600">{detail.icMapping[0].towKod}</span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <ProductDetail product={detail} />
            )
          ) : null}

          {detail && !loadingDetail && (
            <DialogFooter>
              {editMode ? (
                <>
                  <Button variant="outline" onClick={() => setEditMode(false)} disabled={saving}>
                    Cancel
                  </Button>
                  <Button onClick={handleSave} disabled={saving}>
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save Changes
                  </Button>
                </>
              ) : (
                <Button onClick={() => openEdit(detail)}>
                  <Pencil className="mr-2 h-4 w-4" /> Edit Product
                </Button>
              )}
            </DialogFooter>
          )}
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

  // Vehicle applicability from TecDoc
  const [linkages, setLinkages] = useState<VehicleLinkage[]>([]);
  const [loadingLinkages, setLoadingLinkages] = useState(false);
  const [linkagesLoaded, setLinkagesLoaded] = useState(false);

  const loadLinkages = async () => {
    if (!product.tecdocId || linkagesLoaded) return;
    setLoadingLinkages(true);
    try {
      const result = await getTecDocLinkages(parseInt(product.tecdocId, 10));
      setLinkages(result.linkages);
    } catch {
      // TecDoc linkage lookup failed — not critical
    } finally {
      setLoadingLinkages(false);
      setLinkagesLoaded(true);
    }
  };

  // Auto-load linkages when product has tecdocId
  useEffect(() => {
    if (product.tecdocId) loadLinkages();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.tecdocId]);

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
            {product.icMapping && product.icMapping.length > 0 && (
              <div>
                <span className="text-muted-foreground">InterCars Code:</span>{" "}
                <span className="font-mono text-blue-600">{product.icMapping[0].towKod}</span>
              </div>
            )}
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

      {/* Vehicle Applicability */}
      {product.tecdocId && (
        <div>
          <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
            <Car className="h-4 w-4" /> Toepasbaarheid (Voertuigen)
          </h4>
          {!linkagesLoaded ? (
            <Button variant="outline" size="sm" onClick={loadLinkages} disabled={loadingLinkages}>
              {loadingLinkages ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Laden...</>
              ) : (
                <><Car className="h-4 w-4 mr-2" /> Toepasbaarheid laden</>
              )}
            </Button>
          ) : loadingLinkages ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : linkages.length === 0 ? (
            <p className="text-sm text-muted-foreground">Geen voertuigkoppelingen gevonden in TecDoc</p>
          ) : (
            <div className="rounded-lg border overflow-hidden max-h-[300px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Merk</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Bouwjaar</TableHead>
                    <TableHead>Motor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linkages.map((v, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium text-sm">{v.mfrName}</TableCell>
                      <TableCell className="text-sm">{v.vehicleModelSeriesName}</TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate">
                        {v.description || v.typeName}
                      </TableCell>
                      <TableCell className="text-xs font-mono">
                        {v.beginYearMonth && v.endYearMonth
                          ? `${v.beginYearMonth} - ${v.endYearMonth}`
                          : v.beginYearMonth
                          ? `${v.beginYearMonth} -`
                          : "-"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {[v.capacity, v.power, v.fuelType].filter(Boolean).join(" / ") || "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
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

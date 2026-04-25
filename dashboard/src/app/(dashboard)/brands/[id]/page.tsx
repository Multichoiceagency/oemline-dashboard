"use client";

import { useState, useRef, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { getBrand, getProducts, updateBrand, uploadBrandLogo } from "@/lib/api";
import type { Brand, Product } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  Package,
  ArrowLeft,
  Pencil,
  Save,
  X,
  Loader2,
  ImageIcon,
  Upload,
  Tag,
} from "lucide-react";

function BrandLogo({
  brand,
  size = "lg",
}: {
  brand: Brand;
  size?: "sm" | "lg";
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const sz = size === "lg" ? "h-20 w-20 text-3xl" : "h-10 w-10 text-lg";

  if (!brand.logoUrl || imgFailed) {
    return (
      <div
        className={`flex ${sz} items-center justify-center rounded-lg bg-primary/10 text-primary font-bold`}
      >
        {brand.name.charAt(0)}
      </div>
    );
  }

  return (
    <img
      src={brand.logoUrl}
      alt={brand.name}
      className={`${sz} object-contain rounded-lg`}
      onError={() => setImgFailed(true)}
    />
  );
}

export default function BrandDetailPage() {
  const params = useParams();
  const router = useRouter();
  const brandId = parseInt(params.id as string, 10);

  const [brand, setBrand] = useState<Brand | null>(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const logoFileRef = useRef<HTMLInputElement>(null);

  const [editForm, setEditForm] = useState({ name: "", logoUrl: "" });

  // Products for this brand
  const [products, setProducts] = useState<Product[]>([]);
  const [productsTotal, setProductsTotal] = useState(0);
  const [loadingProducts, setLoadingProducts] = useState(false);

  // Load brand
  useEffect(() => {
    if (isNaN(brandId)) return;
    setLoading(true);
    getBrand(brandId)
      .then((b) => {
        setBrand(b);
        populateForm(b);
      })
      .catch((err) => {
        console.error("Failed to load brand:", err);
        alert("Brand not found");
        router.push("/brands");
      })
      .finally(() => setLoading(false));
  }, [brandId]);

  // Load products when brand is available
  useEffect(() => {
    if (!brand) return;
    setLoadingProducts(true);
    getProducts({ brand: brand.code, limit: 20 })
      .then((res) => {
        setProducts(res.items);
        setProductsTotal(res.total);
      })
      .catch((err) => {
        console.error("Failed to load products:", err);
      })
      .finally(() => setLoadingProducts(false));
  }, [brand?.id]);

  const populateForm = (b: Brand) => {
    setEditForm({
      name: b.name,
      logoUrl: b.logoUrl ?? "",
    });
  };

  const handleSave = async () => {
    if (!brand) return;
    setSaving(true);
    try {
      const updated = await updateBrand(brand.id, {
        name: editForm.name,
        logoUrl: editForm.logoUrl || null,
      });
      setBrand({ ...brand, ...updated });
      setEditMode(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update brand");
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !brand) return;
    setUploading(true);
    try {
      const result = await uploadBrandLogo(brand.id, file);
      setEditForm({ ...editForm, logoUrl: result.url });
      setBrand({ ...brand, logoUrl: result.url });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (logoFileRef.current) logoFileRef.current.value = "";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-3 text-muted-foreground">Loading brand...</span>
      </div>
    );
  }

  if (!brand) return null;

  return (
    <div className="space-y-6 w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/brands")}
            className="shrink-0 min-h-[44px] sm:min-h-0"
          >
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <div className="flex items-center gap-3 min-w-0">
            <BrandLogo brand={brand} size="sm" />
            <div className="min-w-0">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2 truncate">
                <Tag className="h-5 w-5 shrink-0" />
                {brand.name}
              </h2>
              <p className="text-xs sm:text-sm text-muted-foreground truncate">
                Code: {brand.code} &middot; ID: {brand.id} &middot; Updated:{" "}
                {formatDate(brand.updatedAt)}
              </p>
            </div>
          </div>
        </div>
        <div className="flex gap-2 self-start sm:self-auto shrink-0">
          {editMode ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setEditMode(false);
                  populateForm(brand);
                }}
                className="min-h-[44px] sm:min-h-0"
              >
                <X className="h-4 w-4 mr-1" /> Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving} className="min-h-[44px] sm:min-h-0">
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Save className="h-4 w-4 mr-1" />
                )}
                Save
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => setEditMode(true)} className="min-h-[44px] sm:min-h-0">
              <Pencil className="h-4 w-4 mr-1" /> Edit
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Logo + Info */}
        <div className="space-y-4">
          {/* Logo card */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <ImageIcon className="h-4 w-4" /> Brand Logo
              </CardTitle>
            </CardHeader>
            <CardContent>
              {editMode ? (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <Input
                      value={editForm.logoUrl}
                      onChange={(e) =>
                        setEditForm({ ...editForm, logoUrl: e.target.value })
                      }
                      placeholder="https://example.com/logo.png"
                      className="flex-1 text-xs"
                    />
                    <input
                      ref={logoFileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleLogoUpload}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => logoFileRef.current?.click()}
                      disabled={uploading}
                    >
                      {uploading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  {editForm.logoUrl && (
                    <div className="flex items-center gap-4 p-3 rounded-lg border bg-muted/50">
                      <span className="text-xs text-muted-foreground">
                        Preview:
                      </span>
                      <img
                        src={editForm.logoUrl}
                        alt="Preview"
                        className="h-16 w-16 object-contain rounded"
                        onError={(e) => {
                          (e.target as HTMLImageElement).alt = "Invalid URL";
                        }}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  {brand.logoUrl ? (
                    <img
                      src={brand.logoUrl}
                      alt={brand.name}
                      className="w-full max-h-48 object-contain rounded border p-2"
                    />
                  ) : (
                    <div className="h-32 w-full bg-muted rounded flex items-center justify-center">
                      <Tag className="h-12 w-12 text-muted-foreground/30" />
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Stats card */}
          <Card>
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Products</span>
                <Badge variant="secondary">
                  {formatNumber(brand._count?.productMaps ?? productsTotal)}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">TecDoc ID</span>
                <span className="text-sm font-mono text-muted-foreground">
                  {brand.tecdocId ?? "-"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Code</span>
                <span className="text-sm font-mono text-muted-foreground">
                  {brand.code}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Timestamps */}
          <Card>
            <CardContent className="pt-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Created</p>
                  <p>{formatDate(brand.createdAt)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Last Updated</p>
                  <p>{formatDate(brand.updatedAt)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right column: Edit form or Details */}
        <div className="lg:col-span-2 space-y-4">
          {editMode && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Edit Brand</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Brand Name
                    </label>
                    <Input
                      value={editForm.name}
                      onChange={(e) =>
                        setEditForm({ ...editForm, name: e.target.value })
                      }
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recent Products */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Package className="h-4 w-4" /> Recent Products
                {productsTotal > 0 && (
                  <Badge variant="outline" className="ml-1">
                    {formatNumber(productsTotal)}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loadingProducts ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : !products.length ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No products found for this brand
                </p>
              ) : (
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Image</TableHead>
                      <TableHead>Article No.</TableHead>
                      <TableHead className="hidden md:table-cell">EAN</TableHead>
                      <TableHead className="hidden sm:table-cell">Product Title</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead className="hidden sm:table-cell">Supplier</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {products.map((p) => (
                      <TableRow
                        key={p.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => router.push(`/products/${p.id}`)}
                      >
                        <TableCell>
                          {p.imageUrl ? (
                            <img
                              src={p.imageUrl}
                              alt=""
                              className="h-8 w-8 object-contain rounded"
                            />
                          ) : (
                            <div className="h-8 w-8 bg-muted rounded flex items-center justify-center">
                              <Package className="h-3 w-3 text-muted-foreground" />
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          <div>{p.articleNo}</div>
                          <div className="text-muted-foreground">
                            SKU: {p.sku}
                          </div>
                          {p.icCode && (
                            <div className="text-blue-600">IC: {p.icCode}</div>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs hidden md:table-cell">
                          {p.ean ?? "-"}
                        </TableCell>
                        <TableCell className="max-w-[250px] text-sm hidden sm:table-cell">
                          <div className="truncate font-medium">
                            {[p.genericArticle, p.category?.name].filter(Boolean).join(" — ") || p.brand?.name || "-"}
                          </div>
                          {p.description && (
                            <div className="truncate text-xs text-muted-foreground">{p.description}</div>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {p.price != null
                            ? `${p.currency ?? "EUR"} ${p.price.toFixed(2)}`
                            : "-"}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <Badge variant="secondary">
                            {p.supplier?.name}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
              )}
              {productsTotal > 20 && (
                <div className="pt-3 text-center">
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() =>
                      router.push(`/products?brand=${brand.code}`)
                    }
                  >
                    View all {formatNumber(productsTotal)} products
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

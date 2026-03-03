"use client";

import { useState, useRef } from "react";
import { useApi, useInterval } from "@/lib/hooks";
import { getBrands, getProducts, updateBrand, uploadBrandLogo, getInterCarsUnmatchedBrands, seedInterCarsAliases, createInterCarsAlias } from "@/lib/api";
import type { Brand } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { formatNumber } from "@/lib/utils";
import { Search, Tag, Package, X, Loader2, Pencil, ImageIcon, Upload, Link2, AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";

export default function BrandsPage() {
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const { data, loading, refetch } = useApi(
    () => getBrands({ page, limit: 50, q: searchQuery || undefined }),
    [page, searchQuery]
  );

  // Auto-refresh brands every 30 seconds
  useInterval(() => { refetch(); }, 30_000);

  // Brand detail
  const [selectedBrand, setSelectedBrand] = useState<Brand | null>(null);
  const { data: brandProducts, loading: loadingProducts } = useApi(
    () =>
      selectedBrand
        ? getProducts({ limit: 20, brand: selectedBrand.code })
        : Promise.resolve(null),
    [selectedBrand?.id]
  );

  // Edit mode
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", logoUrl: "" });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  // InterCars brand mapping
  const { data: icBrandData, loading: icLoading, refetch: refetchIc } = useApi(
    () => getInterCarsUnmatchedBrands(),
    []
  );
  const [seedingAliases, setSeedingAliases] = useState(false);
  const [selectedUnmatched, setSelectedUnmatched] = useState<{ icBrand: string; count: number } | null>(null);
  const [aliasTecdocName, setAliasTecdocName] = useState("");
  const [creatingAlias, setCreatingAlias] = useState(false);

  const handleSearch = () => {
    setSearchQuery(searchInput);
    setPage(1);
  };

  const openBrand = (brand: Brand) => {
    setSelectedBrand(brand);
    setEditMode(false);
    setEditForm({
      name: brand.name,
      logoUrl: brand.logoUrl ?? "",
    });
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedBrand) return;
    setUploading(true);
    try {
      const result = await uploadBrandLogo(selectedBrand.id, file);
      setEditForm({ ...editForm, logoUrl: result.url });
      setSelectedBrand({ ...selectedBrand, logoUrl: result.url });
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (logoFileRef.current) logoFileRef.current.value = "";
    }
  };

  const handleSave = async () => {
    if (!selectedBrand) return;
    setSaving(true);
    try {
      const updated = await updateBrand(selectedBrand.id, {
        name: editForm.name,
        logoUrl: editForm.logoUrl || null,
      });
      setSelectedBrand({ ...selectedBrand, ...updated });
      setEditMode(false);
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update brand");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Brands</h2>
        <p className="text-muted-foreground">All product brands and manufacturers</p>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-2">
            <Input
              placeholder="Search brands..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="max-w-md"
            />
            <Button onClick={handleSearch}>
              <Search className="h-4 w-4" />
            </Button>
            {searchQuery && (
              <Button variant="ghost" size="sm" onClick={() => { setSearchInput(""); setSearchQuery(""); setPage(1); }}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Brands Grid */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5" />
            Brands ({data?.total ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !data?.items.length ? (
            <p className="text-muted-foreground text-center py-8">No brands found</p>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {data.items.map((brand) => (
                  <div
                    key={brand.id}
                    className="flex flex-col items-center gap-2 rounded-lg border p-4 cursor-pointer hover:bg-muted/50 transition-colors group relative"
                    onClick={() => openBrand(brand)}
                  >
                    {brand.logoUrl ? (
                      <img
                        src={brand.logoUrl}
                        alt={brand.name}
                        className="h-16 w-16 object-contain rounded"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                          (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
                        }}
                      />
                    ) : null}
                    <div className={`flex h-16 w-16 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold text-xl ${brand.logoUrl ? "hidden" : ""}`}>
                      {brand.name.charAt(0)}
                    </div>
                    <div className="text-center">
                      <p className="font-medium text-sm">{brand.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatNumber(brand._count?.productMaps ?? 0)} products
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7 p-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        openBrand(brand);
                        setEditMode(true);
                      }}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>

              {data.totalPages > 1 && (
                <div className="flex items-center justify-between pt-4">
                  <p className="text-sm text-muted-foreground">
                    Page {data.page} of {data.totalPages} ({data.total} total)
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                      Previous
                    </Button>
                    <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Brand Detail Dialog */}
      <Dialog open={!!selectedBrand} onOpenChange={(open) => { if (!open) { setSelectedBrand(null); setEditMode(false); } }}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              {selectedBrand?.logoUrl ? (
                <img src={selectedBrand.logoUrl} alt={selectedBrand.name} className="h-10 w-10 object-contain rounded" />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded bg-primary/10 text-primary font-bold text-lg">
                  {selectedBrand?.name.charAt(0)}
                </div>
              )}
              {editMode ? "Edit Brand" : selectedBrand?.name}
              <Badge variant="outline" className="ml-2">
                {formatNumber(selectedBrand?._count?.productMaps ?? 0)} products
              </Badge>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {editMode ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Brand Name</label>
                  <Input
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <ImageIcon className="h-4 w-4" /> Logo
                  </label>
                  <div className="flex gap-2">
                    <Input
                      value={editForm.logoUrl}
                      onChange={(e) => setEditForm({ ...editForm, logoUrl: e.target.value })}
                      placeholder="https://example.com/logo.png"
                      className="flex-1"
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
                      onClick={() => logoFileRef.current?.click()}
                      disabled={uploading}
                    >
                      {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    </Button>
                  </div>
                  {editForm.logoUrl && (
                    <div className="flex items-center gap-4 p-3 rounded-lg border bg-muted/50">
                      <span className="text-xs text-muted-foreground">Preview:</span>
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
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">Code</p>
                    <p className="font-mono">{selectedBrand?.code}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">TecDoc ID</p>
                    <p className="font-mono">{selectedBrand?.tecdocId ?? "-"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Products</p>
                    <p>{formatNumber(selectedBrand?._count?.productMaps ?? 0)}</p>
                  </div>
                </div>

                {selectedBrand?.logoUrl && (
                  <div>
                    <p className="text-muted-foreground text-xs mb-2">Logo</p>
                    <img src={selectedBrand.logoUrl} alt={selectedBrand.name} className="h-20 object-contain rounded border p-2" />
                  </div>
                )}

                <div>
                  <h4 className="font-medium mb-2 flex items-center gap-2">
                    <Package className="h-4 w-4" /> Recent Products
                  </h4>
                  {loadingProducts ? (
                    <div className="flex justify-center py-4">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : !brandProducts?.items.length ? (
                    <p className="text-sm text-muted-foreground">No products</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Image</TableHead>
                          <TableHead>Article No.</TableHead>
                          <TableHead>EAN</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead>Price</TableHead>
                          <TableHead>Supplier</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {brandProducts.items.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell>
                              {p.imageUrl ? (
                                <img src={p.imageUrl} alt="" className="h-8 w-8 object-contain rounded" />
                              ) : (
                                <div className="h-8 w-8 bg-muted rounded flex items-center justify-center">
                                  <Package className="h-3 w-3 text-muted-foreground" />
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              <div>{p.articleNo}</div>
                              <div className="text-muted-foreground">SKU: {p.sku}</div>
                              {p.icCode && (
                                <div className="text-blue-600">IC: {p.icCode}</div>
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-xs">{p.ean ?? "-"}</TableCell>
                            <TableCell className="max-w-[200px] truncate text-sm">{p.description || "-"}</TableCell>
                            <TableCell className="font-mono text-xs">
                              {p.price != null ? `${p.currency ?? "EUR"} ${p.price.toFixed(2)}` : "-"}
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary">{p.supplier?.name}</Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </>
            )}
          </div>

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
              <Button onClick={() => setEditMode(true)}>
                <Pencil className="mr-2 h-4 w-4" /> Edit Brand
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

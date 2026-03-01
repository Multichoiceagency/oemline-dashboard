"use client";

import { useState, useCallback } from "react";
import { useApi } from "@/lib/hooks";
import {
  getProducts,
  updateProduct,
  deleteProduct,
  getSuppliers,
  populateTecDoc,
  searchProducts,
  importProducts,
} from "@/lib/api";
import type { Product } from "@/lib/api";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/lib/utils";
import {
  Package,
  Search,
  Pencil,
  Trash2,
  Download,
  Database,
  Eye,
  X,
  Loader2,
} from "lucide-react";

// Common OEM numbers for auto parts to seed the database
const SEED_QUERIES = [
  "04E115561H", "1K0615301AC", "5Q0698151", "03L115466", "1K0615601AC",
  "04E115561T", "WHT005437", "JZW698151", "03C115561H", "1K0407366B",
  "5N0407764BX", "3C0907275B", "1K0199262CS", "03C115561D", "1K0615301AK",
  "04L906262B", "WHT003858", "1K0819031B", "5Q0121203M", "03L109244",
];

export default function ProductsPage() {
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [searchInput, setSearchInput] = useState("");

  const { data, loading, refetch } = useApi(
    () =>
      getProducts({
        page,
        limit: 50,
        q: searchQuery || undefined,
        supplier: supplierFilter !== "all" ? supplierFilter : undefined,
      }),
    [page, searchQuery, supplierFilter]
  );

  const { data: suppliersData } = useApi(
    () => getSuppliers({ limit: 100, active: "all" }),
    []
  );

  // Detail/Edit dialog
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({
    sku: "",
    articleNo: "",
    ean: "",
    tecdocId: "",
    oem: "",
    description: "",
  });
  const [saving, setSaving] = useState(false);

  // Populate dialog
  const [populateOpen, setPopulateOpen] = useState(false);
  const [populating, setPopulating] = useState(false);
  const [populateResult, setPopulateResult] = useState<{
    imported: number;
    updated: number;
    total: number;
  } | null>(null);
  const [customQueries, setCustomQueries] = useState("");

  // Import from search dialog
  const [importOpen, setImportOpen] = useState(false);
  const [importQuery, setImportQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const [importSearching, setImportSearching] = useState(false);
  const [importResults, setImportResults] = useState<
    Array<{
      supplier: string;
      sku: string;
      brand: string;
      articleNo: string;
      ean: string | null;
      tecdocId: string | null;
      oem: string | null;
      description: string;
    }>
  >([]);
  const [importResult, setImportResult] = useState<{
    imported: number;
    updated: number;
  } | null>(null);

  const handleSearch = useCallback(() => {
    setSearchQuery(searchInput);
    setPage(1);
  }, [searchInput]);

  const openDetail = (product: Product) => {
    setSelectedProduct(product);
    setEditMode(false);
    setEditForm({
      sku: product.sku,
      articleNo: product.articleNo,
      ean: product.ean ?? "",
      tecdocId: product.tecdocId ?? "",
      oem: product.oem ?? "",
      description: product.description,
    });
  };

  const handleSave = async () => {
    if (!selectedProduct) return;
    setSaving(true);
    try {
      const updated = await updateProduct(selectedProduct.id, {
        sku: editForm.sku,
        articleNo: editForm.articleNo,
        ean: editForm.ean || null,
        tecdocId: editForm.tecdocId || null,
        oem: editForm.oem || null,
        description: editForm.description,
      });
      setSelectedProduct(updated);
      setEditMode(false);
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update product");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (product: Product) => {
    if (!confirm(`Delete product ${product.articleNo} (${product.sku})?`)) return;
    try {
      await deleteProduct(product.id);
      setSelectedProduct(null);
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete product");
    }
  };

  const handlePopulate = async () => {
    setPopulating(true);
    setPopulateResult(null);
    try {
      const queries = customQueries
        ? customQueries.split("\n").map((q) => q.trim()).filter(Boolean)
        : SEED_QUERIES;
      const result = await populateTecDoc(queries);
      setPopulateResult(result);
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Populate failed");
    } finally {
      setPopulating(false);
    }
  };

  const handleImportSearch = async () => {
    if (!importQuery.trim()) return;
    setImportSearching(true);
    setImportResults([]);
    setImportResult(null);
    try {
      const result = await searchProducts({ q: importQuery.trim(), limit: 100 });
      setImportResults(result.results);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Search failed");
    } finally {
      setImportSearching(false);
    }
  };

  const handleImportSave = async () => {
    if (importResults.length === 0) return;
    setImporting(true);
    try {
      // Group by supplier
      const supplierMap = new Map<string, typeof importResults>();
      for (const r of importResults) {
        const existing = supplierMap.get(r.supplier) || [];
        existing.push(r);
        supplierMap.set(r.supplier, existing);
      }

      let totalImported = 0;
      let totalUpdated = 0;

      for (const [supplierCode, items] of supplierMap) {
        const supplier = suppliersData?.items.find((s) => s.code === supplierCode);
        if (!supplier) continue;

        const result = await importProducts({
          supplierId: parseInt(supplier.id),
          items: items.map((i) => ({
            sku: i.sku,
            articleNo: i.articleNo,
            ean: i.ean,
            tecdocId: i.tecdocId,
            oem: i.oem,
            description: i.description,
          })),
        });

        totalImported += result.imported;
        totalUpdated += result.updated;
      }

      setImportResult({ imported: totalImported, updated: totalUpdated });
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Products</h2>
          <p className="text-muted-foreground">
            All products in the database with full details
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Download className="mr-2 h-4 w-4" /> Import from Search
          </Button>
          <Button onClick={() => setPopulateOpen(true)}>
            <Database className="mr-2 h-4 w-4" /> Populate from TecDoc
          </Button>
        </div>
      </div>

      {/* Search & Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <div className="flex flex-1 gap-2">
              <Input
                placeholder="Search by SKU, article no, EAN, OEM, description..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
              <Button onClick={handleSearch}>
                <Search className="h-4 w-4" />
              </Button>
              {searchQuery && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchInput("");
                    setSearchQuery("");
                    setPage(1);
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            <Select
              value={supplierFilter}
              onValueChange={(v) => {
                setSupplierFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="All suppliers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All suppliers</SelectItem>
                {suppliersData?.items.map((s) => (
                  <SelectItem key={s.code} value={s.code}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Products Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Products ({data?.total ?? 0})
            {searchQuery && (
              <Badge variant="secondary" className="ml-2">
                Filtered: &ldquo;{searchQuery}&rdquo;
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">Loading products...</span>
            </div>
          ) : !data?.items.length ? (
            <div className="text-center py-12">
              <Package className="mx-auto h-12 w-12 text-muted-foreground/50" />
              <p className="mt-4 text-lg font-medium text-muted-foreground">
                No products found
              </p>
              <p className="text-sm text-muted-foreground">
                Click &ldquo;Populate from TecDoc&rdquo; to import products, or use &ldquo;Import from Search&rdquo;
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Article No.</TableHead>
                  <TableHead>Brand</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>EAN</TableHead>
                  <TableHead>TecDoc ID</TableHead>
                  <TableHead>OEM</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50">
                    <TableCell
                      className="font-mono text-xs"
                      onClick={() => openDetail(p)}
                    >
                      {p.sku}
                    </TableCell>
                    <TableCell
                      className="font-mono text-xs font-medium"
                      onClick={() => openDetail(p)}
                    >
                      {p.articleNo}
                    </TableCell>
                    <TableCell onClick={() => openDetail(p)}>
                      <Badge variant="outline">{p.brand?.name ?? "-"}</Badge>
                    </TableCell>
                    <TableCell onClick={() => openDetail(p)}>
                      <Badge variant="secondary">{p.supplier?.name ?? "-"}</Badge>
                    </TableCell>
                    <TableCell
                      className="font-mono text-xs"
                      onClick={() => openDetail(p)}
                    >
                      {p.ean ?? "-"}
                    </TableCell>
                    <TableCell
                      className="font-mono text-xs"
                      onClick={() => openDetail(p)}
                    >
                      {p.tecdocId ?? "-"}
                    </TableCell>
                    <TableCell
                      className="font-mono text-xs"
                      onClick={() => openDetail(p)}
                    >
                      {p.oem ?? "-"}
                    </TableCell>
                    <TableCell
                      className="max-w-[200px] truncate"
                      onClick={() => openDetail(p)}
                    >
                      {p.description || "-"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(p.updatedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openDetail(p)}
                        >
                          <Eye className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            openDetail(p);
                            setEditMode(true);
                          }}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(p)}
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* Pagination */}
          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-sm text-muted-foreground">
                Page {data.page} of {data.totalPages} ({data.total} total)
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= data.totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Product Detail / Edit Dialog */}
      <Dialog
        open={!!selectedProduct}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedProduct(null);
            setEditMode(false);
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              {editMode ? "Edit Product" : "Product Details"}
            </DialogTitle>
            <DialogDescription>
              {selectedProduct?.supplier?.name} - {selectedProduct?.articleNo}
            </DialogDescription>
          </DialogHeader>

          {selectedProduct && (
            <div className="space-y-4 py-4">
              {editMode ? (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">SKU</label>
                      <Input
                        value={editForm.sku}
                        onChange={(e) =>
                          setEditForm({ ...editForm, sku: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Article No.</label>
                      <Input
                        value={editForm.articleNo}
                        onChange={(e) =>
                          setEditForm({ ...editForm, articleNo: e.target.value })
                        }
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">EAN</label>
                      <Input
                        value={editForm.ean}
                        onChange={(e) =>
                          setEditForm({ ...editForm, ean: e.target.value })
                        }
                        placeholder="None"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">TecDoc ID</label>
                      <Input
                        value={editForm.tecdocId}
                        onChange={(e) =>
                          setEditForm({ ...editForm, tecdocId: e.target.value })
                        }
                        placeholder="None"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">OEM Number</label>
                      <Input
                        value={editForm.oem}
                        onChange={(e) =>
                          setEditForm({ ...editForm, oem: e.target.value })
                        }
                        placeholder="None"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Description</label>
                    <Input
                      value={editForm.description}
                      onChange={(e) =>
                        setEditForm({ ...editForm, description: e.target.value })
                      }
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <DetailField label="ID" value={String(selectedProduct.id)} />
                    <DetailField label="SKU" value={selectedProduct.sku} mono />
                    <DetailField
                      label="Article No."
                      value={selectedProduct.articleNo}
                      mono
                    />
                    <DetailField
                      label="Brand"
                      value={selectedProduct.brand?.name ?? "-"}
                    />
                    <DetailField
                      label="Supplier"
                      value={selectedProduct.supplier?.name ?? "-"}
                    />
                    <DetailField
                      label="EAN"
                      value={selectedProduct.ean ?? "-"}
                      mono
                    />
                    <DetailField
                      label="TecDoc ID"
                      value={selectedProduct.tecdocId ?? "-"}
                      mono
                    />
                    <DetailField
                      label="OEM Number"
                      value={selectedProduct.oem ?? "-"}
                      mono
                    />
                  </div>
                  <DetailField
                    label="Description"
                    value={selectedProduct.description || "-"}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <DetailField
                      label="Created"
                      value={formatDate(selectedProduct.createdAt)}
                    />
                    <DetailField
                      label="Updated"
                      value={formatDate(selectedProduct.updatedAt)}
                    />
                  </div>
                </>
              )}
            </div>
          )}

          <DialogFooter>
            {editMode ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => setEditMode(false)}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Changes
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() =>
                    selectedProduct && handleDelete(selectedProduct)
                  }
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                </Button>
                <Button onClick={() => setEditMode(true)}>
                  <Pencil className="mr-2 h-4 w-4" /> Edit
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Populate from TecDoc Dialog */}
      <Dialog open={populateOpen} onOpenChange={setPopulateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Populate from TecDoc</DialogTitle>
            <DialogDescription>
              Search TecDoc for common part numbers and save results to the
              database. Enter OEM numbers or article numbers (one per line), or
              use the default set of 20 common VW/Audi part numbers.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Custom queries (optional, one per line)
              </label>
              <textarea
                className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder={`Leave empty to use defaults:\n${SEED_QUERIES.slice(0, 5).join("\n")}...`}
                value={customQueries}
                onChange={(e) => setCustomQueries(e.target.value)}
              />
            </div>
            {populateResult && (
              <div className="rounded-lg bg-muted p-4">
                <p className="font-medium">
                  Done! Imported {populateResult.imported} new, updated{" "}
                  {populateResult.updated} existing ({populateResult.total}{" "}
                  total)
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPopulateOpen(false)}
              disabled={populating}
            >
              Close
            </Button>
            <Button onClick={handlePopulate} disabled={populating}>
              {populating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {populating ? "Populating..." : "Populate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import from Search Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import from Search</DialogTitle>
            <DialogDescription>
              Search for products across all suppliers, then save results to the
              database.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex gap-2">
              <Input
                placeholder="Search query (OEM, article number, EAN)..."
                value={importQuery}
                onChange={(e) => setImportQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleImportSearch()}
              />
              <Button onClick={handleImportSearch} disabled={importSearching}>
                {importSearching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
              </Button>
            </div>

            {importResults.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  Found {importResults.length} results
                </p>
                <div className="max-h-[300px] overflow-y-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Supplier</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead>Article No.</TableHead>
                        <TableHead>Brand</TableHead>
                        <TableHead>EAN</TableHead>
                        <TableHead>TecDoc ID</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {importResults.map((r, i) => (
                        <TableRow key={`${r.supplier}-${r.sku}-${i}`}>
                          <TableCell>
                            <Badge variant="outline">{r.supplier}</Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {r.sku}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {r.articleNo}
                          </TableCell>
                          <TableCell>{r.brand}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {r.ean ?? "-"}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {r.tecdocId ?? "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {importResult && (
              <div className="rounded-lg bg-muted p-4">
                <p className="font-medium">
                  Imported {importResult.imported} new, updated{" "}
                  {importResult.updated} existing
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setImportOpen(false);
                setImportResults([]);
                setImportResult(null);
              }}
            >
              Close
            </Button>
            {importResults.length > 0 && !importResult && (
              <Button onClick={handleImportSave} disabled={importing}>
                {importing && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Save {importResults.length} products to DB
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`text-sm ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useApi, useInterval } from "@/lib/hooks";
import {
  getProducts,
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

const SEED_QUERIES = [
  "04E115561H", "1K0615301AC", "5Q0698151", "03L115466", "1K0615601AC",
  "04E115561T", "WHT005437", "JZW698151", "03C115561H", "1K0407366B",
  "5N0407764BX", "3C0907275B", "1K0199262CS", "03C115561D", "1K0615301AK",
  "04L906262B", "WHT003858", "1K0819031B", "5Q0121203M", "03L109244",
];

export default function ProductsPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [imageFilter, setImageFilter] = useState("all");
  const [priceFilter, setPriceFilter] = useState("all");
  const [searchInput, setSearchInput] = useState("");

  const { data, loading, refetch } = useApi(
    () =>
      getProducts({
        page,
        limit: 50,
        q: searchQuery || undefined,
        supplier: supplierFilter !== "all" ? supplierFilter : undefined,
        hasImage: imageFilter !== "all" ? imageFilter : undefined,
        hasPrice: priceFilter !== "all" ? priceFilter : undefined,
      }),
    [page, searchQuery, supplierFilter, imageFilter, priceFilter]
  );

  const { data: suppliersData } = useApi(
    () => getSuppliers({ limit: 100, active: "all" }),
    []
  );

  // Auto-refresh products every 30 seconds
  useInterval(() => { refetch(); }, 30_000);

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

  const handleDelete = async (product: Product) => {
    if (!confirm(`Delete product ${product.articleNo} (${product.sku})?`)) return;
    try {
      await deleteProduct(product.id);
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
            All products with images, pricing, and stock information
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
            <Select
              value={imageFilter}
              onValueChange={(v) => {
                setImageFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Images" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All images</SelectItem>
                <SelectItem value="true">Has image</SelectItem>
                <SelectItem value="false">No image</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={priceFilter}
              onValueChange={(v) => {
                setPriceFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Price" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All prices</SelectItem>
                <SelectItem value="true">Has price</SelectItem>
                <SelectItem value="false">No price</SelectItem>
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
                  <TableHead className="w-[50px]">Image</TableHead>
                  <TableHead>Article No.</TableHead>
                  <TableHead>Brand</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => router.push(`/products/${p.id}`)}>
                    <TableCell>
                      {p.imageUrl ? (
                        <img src={p.imageUrl} alt="" className="h-10 w-10 object-contain rounded border" />
                      ) : (
                        <div className="h-10 w-10 bg-muted rounded flex items-center justify-center border">
                          <Package className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs font-medium">
                      <div>{p.articleNo}</div>
                      <div className="text-muted-foreground">SKU: {p.sku}</div>
                      {p.icCode && (
                        <div className="text-blue-600">IC: {p.icCode}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{p.brand?.name ?? "-"}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{p.supplier?.name ?? "-"}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-sm">
                      {p.description || "-"}
                    </TableCell>
                    <TableCell>
                      {p.price != null ? (
                        <span className="font-mono text-xs font-medium">
                          {p.currency ?? "EUR"} {p.price.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {p.stock != null ? (
                        <Badge variant={p.stock > 0 ? "success" : "destructive"}>
                          {p.stock}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(p.updatedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="sm" onClick={() => router.push(`/products/${p.id}`)}>
                          <Eye className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => router.push(`/products/${p.id}?edit=true`)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDelete(p)}>
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

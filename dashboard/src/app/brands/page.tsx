"use client";

import { useState } from "react";
import { useApi } from "@/lib/hooks";
import { getBrands, getProducts } from "@/lib/api";
import type { Brand } from "@/lib/api";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatNumber } from "@/lib/utils";
import { Search, Tag, Package, X, Loader2 } from "lucide-react";

export default function BrandsPage() {
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const { data, loading } = useApi(
    () => getBrands({ page, limit: 50, q: searchQuery || undefined }),
    [page, searchQuery]
  );

  // Brand detail
  const [selectedBrand, setSelectedBrand] = useState<Brand | null>(null);
  const { data: brandProducts, loading: loadingProducts } = useApi(
    () =>
      selectedBrand
        ? getProducts({ limit: 20, brand: selectedBrand.code })
        : Promise.resolve(null),
    [selectedBrand?.id]
  );

  const handleSearch = () => {
    setSearchQuery(searchInput);
    setPage(1);
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
                    className="flex flex-col items-center gap-2 rounded-lg border p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => setSelectedBrand(brand)}
                  >
                    {brand.logoUrl ? (
                      <img
                        src={brand.logoUrl}
                        alt={brand.name}
                        className="h-12 w-12 object-contain"
                      />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold text-lg">
                        {brand.name.charAt(0)}
                      </div>
                    )}
                    <div className="text-center">
                      <p className="font-medium text-sm">{brand.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatNumber(brand._count?.productMaps ?? 0)} products
                      </p>
                    </div>
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
      <Dialog open={!!selectedBrand} onOpenChange={(open) => !open && setSelectedBrand(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              {selectedBrand?.logoUrl ? (
                <img src={selectedBrand.logoUrl} alt={selectedBrand.name} className="h-8 w-8 object-contain" />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded bg-primary/10 text-primary font-bold">
                  {selectedBrand?.name.charAt(0)}
                </div>
              )}
              {selectedBrand?.name}
              <Badge variant="outline" className="ml-2">
                {formatNumber(selectedBrand?._count?.productMaps ?? 0)} products
              </Badge>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
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
                      <TableHead>Article No.</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>EAN</TableHead>
                      <TableHead>TecDoc ID</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Supplier</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {brandProducts.items.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-xs">{p.articleNo}</TableCell>
                        <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                        <TableCell className="font-mono text-xs">{p.ean ?? "-"}</TableCell>
                        <TableCell className="font-mono text-xs">{p.tecdocId ?? "-"}</TableCell>
                        <TableCell className="max-w-[200px] truncate text-sm">{p.description || "-"}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{p.supplier?.name}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

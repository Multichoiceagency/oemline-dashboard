"use client";

import { useState } from "react";
import { searchProducts } from "@/lib/api";
import type { SearchResponse } from "@/lib/api";
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
import { Search, Loader2, AlertCircle } from "lucide-react";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState({ brand: "", ean: "", oem: "" });
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await searchProducts({
        q: query.trim(),
        brand: filters.brand || undefined,
        ean: filters.ean || undefined,
        oem: filters.oem || undefined,
        limit: 100,
      });
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Product Search</h2>
        <p className="text-muted-foreground text-sm">
          Search across all suppliers and local index simultaneously
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-3">
            <Input
              placeholder="Search by article number, brand, description..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="flex-1"
            />
            <Button onClick={handleSearch} disabled={loading || !query.trim()}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Search
            </Button>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 mt-3">
            <Input
              placeholder="Filter brand..."
              value={filters.brand}
              onChange={(e) => setFilters({ ...filters, brand: e.target.value })}
              className="sm:max-w-[200px]"
            />
            <Input
              placeholder="Filter EAN..."
              value={filters.ean}
              onChange={(e) => setFilters({ ...filters, ean: e.target.value })}
              className="sm:max-w-[200px]"
            />
            <Input
              placeholder="Filter OEM..."
              value={filters.oem}
              onChange={(e) => setFilters({ ...filters, oem: e.target.value })}
              className="sm:max-w-[200px]"
            />
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6 flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4" />
            {error}
          </CardContent>
        </Card>
      )}

      {result && (
        <>
          <div className="flex items-center gap-4">
            <p className="text-sm text-muted-foreground">
              Found <span className="font-semibold text-foreground">{result.totalResults}</span> results for &quot;{result.query}&quot;
              {result.cachedAt && (
                <Badge variant="secondary" className="ml-2">cached</Badge>
              )}
            </p>
            {result.errors.length > 0 && (
              <Badge variant="warning">
                {result.errors.length} supplier error{result.errors.length > 1 ? "s" : ""}
              </Badge>
            )}
          </div>

          {result.errors.length > 0 && (
            <Card className="border-yellow-500/30">
              <CardContent className="pt-4">
                <p className="text-sm font-medium mb-2">Supplier Errors:</p>
                {result.errors.map((e, i) => (
                  <div key={i} className="text-sm text-muted-foreground">
                    <Badge variant="outline" className="mr-2">{e.supplier}</Badge>
                    {e.message}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Results</CardTitle>
            </CardHeader>
            <CardContent>
              {result.results.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No products found</p>
              ) : (
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Supplier</TableHead>
                      <TableHead className="hidden sm:table-cell">SKU</TableHead>
                      <TableHead>Brand</TableHead>
                      <TableHead>Article No.</TableHead>
                      <TableHead className="hidden md:table-cell">Product Title</TableHead>
                      <TableHead className="hidden lg:table-cell">EAN</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>Stock</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.results.map((p, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Badge variant="outline">{p.supplier}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs hidden sm:table-cell">{p.sku}</TableCell>
                        <TableCell className="font-medium">{p.brand}</TableCell>
                        <TableCell>{p.articleNo}</TableCell>
                        <TableCell className="max-w-[200px] truncate hidden md:table-cell">{p.description}</TableCell>
                        <TableCell className="font-mono text-xs hidden lg:table-cell">{p.ean || "-"}</TableCell>
                        <TableCell>
                          {p.price != null ? (
                            <span className="font-medium">{p.currency ?? "EUR"} {p.price.toFixed(2)}</span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {p.stock != null ? (
                            <Badge variant={p.stock > 0 ? "success" : "destructive"}>
                              {p.stock}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {result.matches.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Match Details</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Supplier</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Confidence</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.matches.map((m, i) => (
                      <TableRow key={i}>
                        <TableCell>{m.supplier}</TableCell>
                        <TableCell className="font-mono text-xs">{m.sku}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{m.method}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-16 sm:w-24 rounded-full bg-muted">
                              <div
                                className="h-2 rounded-full bg-primary"
                                style={{ width: `${m.confidence * 100}%` }}
                              />
                            </div>
                            <span className="text-sm">{(m.confidence * 100).toFixed(0)}%</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

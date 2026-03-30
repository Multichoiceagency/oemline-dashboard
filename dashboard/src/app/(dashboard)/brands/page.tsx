"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApi, useInterval } from "@/lib/hooks";
import { getBrands, syncBrandsFromTecDoc } from "@/lib/api";
import type { Brand } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/utils";
import { Search, Tag, X, Loader2, Pencil, CheckCircle2, RefreshCw } from "lucide-react";

function BrandLogo({ brand }: { brand: Brand }) {
  const [imgFailed, setImgFailed] = useState(false);
  const showLetter = !brand.logoUrl || imgFailed;

  return showLetter ? (
    <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold text-xl">
      {brand.name.charAt(0)}
    </div>
  ) : (
    <img
      src={brand.logoUrl!}
      alt={brand.name}
      className="h-16 w-16 object-contain rounded"
      onError={() => setImgFailed(true)}
    />
  );
}

export default function BrandsPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const { data, loading, refetch } = useApi(
    () => getBrands({ page, limit: 50, q: searchQuery || undefined }),
    [page, searchQuery]
  );

  // Auto-refresh brands every 30 seconds
  useInterval(() => { refetch(); }, 30_000);

  // TecDoc brand sync
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ fetched: number; totalInDb: number } | null>(null);

  const handleSyncBrands = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await syncBrandsFromTecDoc();
      setSyncResult({ fetched: result.fetched, totalInDb: result.totalInDb });
      refetch();
      setTimeout(() => setSyncResult(null), 8000);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

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
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5" />
            Brands ({data?.total ?? 0})
          </CardTitle>
          <div className="flex items-center gap-2">
            {syncResult && (
              <span className="text-xs text-green-600 flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {syncResult.fetched} fetched · {syncResult.totalInDb} in DB
              </span>
            )}
            <Button size="sm" variant="outline" disabled={syncing} onClick={handleSyncBrands}>
              {syncing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              {syncing ? "Syncing..." : "Sync Brands from TecDoc"}
            </Button>
          </div>
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
                    onClick={() => router.push(`/brands/${brand.id}`)}
                  >
                    <BrandLogo brand={brand} />
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
                        router.push(`/brands/${brand.id}`);
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

    </div>
  );
}

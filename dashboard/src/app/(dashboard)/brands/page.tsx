"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApi, useInterval } from "@/lib/hooks";
import { getBrands, syncBrandsFromTecDoc, getBrandIcCoverage, syncTecDocBrands } from "@/lib/api";
import type { Brand, BrandIcCoverage } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/utils";
import { Search, Tag, X, Loader2, Pencil, CheckCircle2, RefreshCw, Link2, ArrowUpDown, Download } from "lucide-react";

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

type SortKey = "name" | "total" | "coupled" | "uncoupled" | "pct";

export default function BrandsPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [coverageSortKey, setCoverageSortKey] = useState<SortKey>("total");
  const [coverageSortDir, setCoverageSortDir] = useState<"asc" | "desc">("desc");

  const [selectedBrandIds, setSelectedBrandIds] = useState<Set<number>>(new Set());
  const [syncingBrands, setSyncingBrands] = useState(false);
  const [syncBrandsResult, setSyncBrandsResult] = useState<string | null>(null);

  const { data: coverageData, loading: coverageLoading } = useApi(getBrandIcCoverage, []);

  const sortedCoverage = coverageData
    ? [...coverageData].sort((a, b) => {
        const v = (x: BrandIcCoverage) => coverageSortKey === "name" ? x.name : x[coverageSortKey];
        const av = v(a), bv = v(b);
        if (av < bv) return coverageSortDir === "asc" ? -1 : 1;
        if (av > bv) return coverageSortDir === "asc" ? 1 : -1;
        return 0;
      })
    : [];

  const toggleSort = (key: SortKey) => {
    if (coverageSortKey === key) {
      setCoverageSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setCoverageSortKey(key);
      setCoverageSortDir("desc");
    }
  };

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

  const toggleBrand = (brandId: number) => {
    setSelectedBrandIds((prev) => {
      const next = new Set(prev);
      if (next.has(brandId)) next.delete(brandId);
      else next.add(brandId);
      return next;
    });
  };

  const selectAllWithTecdoc = () => {
    const ids = (coverageData ?? []).filter((r) => r.tecdocId).map((r) => r.tecdocId!);
    setSelectedBrandIds(new Set(ids));
  };

  const handleSyncSelectedBrands = async () => {
    const tecdocIds = (coverageData ?? [])
      .filter((r) => r.tecdocId && selectedBrandIds.has(r.brandId))
      .map((r) => r.tecdocId!);
    if (tecdocIds.length === 0) {
      alert("Geen merken met TecDoc ID geselecteerd.");
      return;
    }
    if (!confirm(`${tecdocIds.length} merk(en) opnieuw syncing vanuit TecDoc? Dit kan enkele minuten per merk duren.`)) return;
    setSyncingBrands(true);
    setSyncBrandsResult(null);
    try {
      const result = await syncTecDocBrands(tecdocIds);
      setSyncBrandsResult(`${result.queued} sync job(s) aangemaakt voor ${tecdocIds.length} merk(en).`);
      setSelectedBrandIds(new Set());
      setTimeout(() => setSyncBrandsResult(null), 10000);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Sync mislukt");
    } finally {
      setSyncingBrands(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Brands</h2>
        <p className="text-muted-foreground text-sm">All product brands and manufacturers</p>
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
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5" />
            Brands ({data?.total ?? 0})
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            {syncResult && (
              <span className="text-xs text-green-600 flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {syncResult.fetched} fetched · {syncResult.totalInDb} in DB
              </span>
            )}
            <Button size="sm" variant="outline" disabled={syncing} onClick={handleSyncBrands} className="min-h-[44px] sm:min-h-0">
              {syncing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              {syncing ? "Syncing..." : "Sync from TecDoc"}
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

      {/* IC Coverage per brand */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5" />
              IC-koppeling per merk
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              {syncBrandsResult && (
                <span className="text-xs text-green-600 flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {syncBrandsResult}
                </span>
              )}
              {selectedBrandIds.size > 0 && (
                <Button size="sm" variant="default" disabled={syncingBrands} onClick={handleSyncSelectedBrands}>
                  {syncingBrands ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-2 h-3.5 w-3.5" />}
                  Sync {selectedBrandIds.size} merk{selectedBrandIds.size !== 1 ? "en" : ""}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={selectAllWithTecdoc}>
                Alles selecteren
              </Button>
              {selectedBrandIds.size > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setSelectedBrandIds(new Set())}>
                  Deselecteer
                </Button>
              )}
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Percentage producten met InterCars SKU. Selecteer merken en klik &quot;Sync&quot; om TecDoc opnieuw te synchroniseren.
          </p>
        </CardHeader>
        <CardContent>
          {coverageLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !sortedCoverage.length ? (
            <p className="text-muted-foreground text-center py-6">Geen data</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="pb-2 pr-2 w-8"></th>
                    {(["name", "total", "coupled", "uncoupled", "pct"] as SortKey[]).map((key) => (
                      <th
                        key={key}
                        className="pb-2 pr-4 text-left font-medium cursor-pointer hover:text-foreground select-none whitespace-nowrap"
                        onClick={() => toggleSort(key)}
                      >
                        <span className="flex items-center gap-1">
                          {key === "name" ? "Merk" : key === "total" ? "Totaal" : key === "coupled" ? "Gekoppeld" : key === "uncoupled" ? "Niet gekoppeld" : "Dekking"}
                          <ArrowUpDown className="h-3 w-3 opacity-50" />
                        </span>
                      </th>
                    ))}
                    <th className="pb-2 text-left font-medium w-32">Voortgang</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedCoverage.map((r) => (
                    <tr
                      key={r.brandId}
                      className={`border-b last:border-0 hover:bg-muted/30 ${selectedBrandIds.has(r.brandId) ? "bg-primary/5" : ""}`}
                    >
                      <td className="py-2 pr-2">
                        <input
                          type="checkbox"
                          checked={selectedBrandIds.has(r.brandId)}
                          onChange={() => toggleBrand(r.brandId)}
                          disabled={!r.tecdocId}
                          className="cursor-pointer"
                          title={r.tecdocId ? `TecDoc ID: ${r.tecdocId}` : "Geen TecDoc ID"}
                        />
                      </td>
                      <td className="py-2 pr-4 font-medium">
                        <button
                          className="hover:underline text-left"
                          onClick={() => router.push(`/brands/${r.brandId}`)}
                        >
                          {r.name}
                        </button>
                        {!r.tecdocId && <span className="text-xs text-muted-foreground ml-1">(geen TecDoc)</span>}
                      </td>
                      <td className="py-2 pr-4 tabular-nums">{formatNumber(r.total)}</td>
                      <td className="py-2 pr-4 tabular-nums text-green-600">{formatNumber(r.coupled)}</td>
                      <td className="py-2 pr-4 tabular-nums text-orange-500">{formatNumber(r.uncoupled)}</td>
                      <td className="py-2 pr-4">
                        <Badge variant={r.pct === 0 ? "destructive" : r.pct < 50 ? "secondary" : "default"}>
                          {r.pct}%
                        </Badge>
                      </td>
                      <td className="py-2 w-32">
                        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-green-500 transition-all"
                            style={{ width: `${r.pct}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}

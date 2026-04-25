"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  getStockManagement,
  bulkUpdateStock,
  type StockManagementRow,
} from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Boxes, Search, Save, Loader2, AlertTriangle, Package, RefreshCw, X,
  CheckCircle2, ImageOff,
} from "lucide-react";
import Link from "next/link";

type FilterValue = "all" | "low" | "out" | "in" | "unset";
type EditMap = Record<number, Record<number, number>>;

const PAGE_SIZE = 50;

export default function StockManagementPage() {
  // Server state
  const [data, setData] = useState<{
    items: StockManagementRow[];
    locations: Array<{ id: number; code: string; name: string; country: string }>;
    total: number;
    totalPages: number;
  }>({ items: [], locations: [], total: 0, totalPages: 0 });

  // Filters / paging
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [filter, setFilter] = useState<FilterValue>("all");
  const [page, setPage] = useState(1);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pending edits keyed by productId → locationId → new quantity
  const [edits, setEdits] = useState<EditMap>({});
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const reqId = useRef(0);

  const reload = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await getStockManagement({
        page, limit: PAGE_SIZE, q: search || undefined, filter,
      });
      if (id !== reqId.current) return; // newer request in flight
      setData({
        items: res.items,
        locations: res.locations,
        total: res.total,
        totalPages: res.totalPages,
      });
    } catch (e) {
      if (id !== reqId.current) return;
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [page, search, filter]);

  useEffect(() => { reload(); }, [reload]);

  // Helpers
  function getCellValue(row: StockManagementRow, locationId: number): number {
    return edits[row.id]?.[locationId]
      ?? row.locations.find((l) => l.locationId === locationId)?.quantity
      ?? 0;
  }

  function isCellDirty(row: StockManagementRow, locationId: number): boolean {
    const edited = edits[row.id]?.[locationId];
    if (edited === undefined) return false;
    const original = row.locations.find((l) => l.locationId === locationId)?.quantity ?? 0;
    return edited !== original;
  }

  function setCellValue(productId: number, locationId: number, value: number) {
    setEdits((prev) => ({
      ...prev,
      [productId]: {
        ...(prev[productId] ?? {}),
        [locationId]: Math.max(0, Math.floor(value || 0)),
      },
    }));
  }

  function rowTotal(row: StockManagementRow): number {
    return data.locations.reduce((s, loc) => s + getCellValue(row, loc.id), 0);
  }

  const dirtyUpdates = useMemo(() => {
    const list: Array<{ productMapId: number; locationId: number; quantity: number }> = [];
    for (const row of data.items) {
      for (const loc of data.locations) {
        if (isCellDirty(row, loc.id)) {
          list.push({
            productMapId: row.id,
            locationId: loc.id,
            quantity: edits[row.id][loc.id],
          });
        }
      }
    }
    return list;
  }, [data.items, data.locations, edits]);

  async function saveAll() {
    if (dirtyUpdates.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await bulkUpdateStock(dirtyUpdates);
      setEdits({});
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
      // Reload to pull canonical values + new aggregates
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  }

  function clearEdits() {
    setEdits({});
  }

  function handleSearch() {
    setPage(1);
    setSearch(searchInput.trim());
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Voorraadbeheer</h2>
          <p className="text-muted-foreground text-sm">
            Pas voorraad aan voor alle producten in één scherm. Wijzigingen verzamelen tot je op opslaan klikt.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/locations" className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm hover:bg-accent">
            Beheer locaties
          </Link>
          <Button variant="outline" onClick={reload} disabled={loading} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Herlaad
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <Card>
        <CardContent className="pt-4 flex flex-col sm:flex-row gap-2">
          <div className="flex-1 flex gap-2">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="Zoek op artikel, SKU, EAN, omschrijving…"
                className="pl-9"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => { setSearchInput(""); setSearch(""); setPage(1); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <Button onClick={handleSearch} variant="outline" disabled={loading}>
              <Search className="h-4 w-4" />
            </Button>
          </div>
          <Select value={filter} onValueChange={(v) => { setPage(1); setFilter(v as FilterValue); }}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle producten</SelectItem>
              <SelectItem value="in">Alleen op voorraad</SelectItem>
              <SelectItem value="low">Lage voorraad (1-5)</SelectItem>
              <SelectItem value="out">Niet op voorraad (0)</SelectItem>
              <SelectItem value="unset">Geen handmatige verdeling</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Save bar */}
      {dirtyUpdates.length > 0 && (
        <div className="sticky top-2 z-20 rounded-lg border bg-primary/5 border-primary/40 p-3 flex items-center gap-3 shadow-sm">
          <Badge variant="default">{dirtyUpdates.length}</Badge>
          <span className="text-sm">
            <strong>{dirtyUpdates.length}</strong> wijziging{dirtyUpdates.length === 1 ? "" : "en"} klaar voor opslaan
          </span>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={clearEdits} disabled={saving}>
              Annuleer
            </Button>
            <Button size="sm" onClick={saveAll} disabled={saving} className="gap-1">
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Opslaan
            </Button>
          </div>
        </div>
      )}

      {savedFlash && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200 inline-flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" /> Wijzigingen opgeslagen
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Boxes className="h-4 w-4" />
            Producten <Badge variant="outline" className="font-normal">{data.total}</Badge>
            {data.locations.length > 0 && (
              <span className="text-xs text-muted-foreground font-normal ml-2">
                {data.locations.length} locatie{data.locations.length === 1 ? "" : "s"}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading && data.items.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : data.items.length === 0 ? (
            <div className="text-center py-12">
              <Package className="mx-auto h-10 w-10 text-muted-foreground/50" />
              <p className="mt-3 text-sm text-muted-foreground">Geen producten voor dit filter</p>
            </div>
          ) : data.locations.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              Nog geen actieve locaties. Maak er minstens een aan via{" "}
              <Link href="/locations" className="underline">/locations</Link>.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12"></TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="hidden md:table-cell">Merk</TableHead>
                    {data.locations.map((loc) => (
                      <TableHead key={loc.id} className="text-right min-w-[100px]">
                        <div className="text-xs font-semibold">{loc.code}</div>
                        <div className="text-[10px] font-normal text-muted-foreground truncate" title={loc.name}>
                          {loc.country}
                        </div>
                      </TableHead>
                    ))}
                    <TableHead className="text-right">Totaal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <div className="h-10 w-10 rounded bg-muted flex items-center justify-center overflow-hidden">
                          {row.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={row.imageUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <ImageOff className="h-4 w-4 text-muted-foreground/60" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="min-w-[200px] max-w-sm">
                        <Link href={`/finalized/${row.id}`} className="block hover:underline">
                          <p className="font-mono text-xs truncate">{row.articleNo}</p>
                          <p className="text-sm line-clamp-1">{row.description || row.articleNo}</p>
                        </Link>
                        {!row.hasManualAllocation && (
                          <Badge variant="outline" className="text-[10px] font-normal mt-0.5" title="Geen handmatige verdeling — toont aggregaat op laagste-volgorde locatie">
                            auto
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {row.brand?.name ?? "—"}
                      </TableCell>
                      {data.locations.map((loc) => {
                        const value = getCellValue(row, loc.id);
                        const dirty = isCellDirty(row, loc.id);
                        return (
                          <TableCell key={loc.id} className="text-right">
                            <input
                              type="number"
                              min={0}
                              value={value}
                              onChange={(e) => setCellValue(row.id, loc.id, parseInt(e.target.value, 10) || 0)}
                              className={`w-20 rounded-md border bg-background px-2 py-1 text-right text-sm tabular-nums ${
                                dirty ? "border-primary ring-1 ring-primary/30" : ""
                              }`}
                            />
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-right font-semibold tabular-nums">
                        {rowTotal(row)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {data.totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-sm text-muted-foreground">
                Pagina {page} van {data.totalPages}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>
                  Vorige
                </Button>
                <Button variant="outline" size="sm" disabled={page >= data.totalPages || loading} onClick={() => setPage(page + 1)}>
                  Volgende
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

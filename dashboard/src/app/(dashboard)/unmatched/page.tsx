"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useApi } from "@/lib/hooks";
import { getUnmatched, bulkCreateOverrides } from "@/lib/api";
import type { UnmatchedItem, BulkOverrideItem } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatDate } from "@/lib/utils";
import { AlertTriangle, Link2, Link2Off, Loader2, CheckCheck, Save, X } from "lucide-react";

export default function UnmatchedPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("false");

  // Inline IC SKU edits per row: id → sku
  const [inlineSkus, setInlineSkus] = useState<Record<string, string>>({});
  const [savingRow, setSavingRow] = useState<string | null>(null);

  // Bulk select
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Bulk modal
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkSku, setBulkSku] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ created: number; updated: number; errors: number } | null>(null);

  const { data, loading, refetch } = useApi(
    () => getUnmatched({ page, limit: 50, resolved: filter }),
    [page, filter]
  );

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (!data?.items) return;
    const unresolved = data.items.filter((i) => !i.resolvedAt);
    if (selected.size === unresolved.length) setSelected(new Set());
    else setSelected(new Set(unresolved.map((i) => i.id)));
  };

  const saveRow = useCallback(async (item: UnmatchedItem) => {
    const sku = inlineSkus[item.id]?.trim();
    if (!sku) return;
    setSavingRow(item.id);
    try {
      await bulkCreateOverrides([{
        supplierCode: item.supplier?.code ?? "",
        brandCode: item.brand?.code ?? "",
        articleNo: item.articleNo ?? item.query,
        sku,
        reason: "Handmatige koppeling vanuit dashboard",
      }]);
      setInlineSkus((prev) => { const n = { ...prev }; delete n[item.id]; return n; });
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Opslaan mislukt");
    } finally {
      setSavingRow(null);
    }
  }, [inlineSkus, refetch]);

  const handleBulkSave = async () => {
    if (!data?.items || !bulkSku.trim()) return;
    setBulkSaving(true);
    setBulkResult(null);
    try {
      const items: BulkOverrideItem[] = data.items
        .filter((i) => selected.has(i.id))
        .map((i) => ({
          supplierCode: i.supplier?.code ?? "",
          brandCode: i.brand?.code ?? "",
          articleNo: i.articleNo ?? i.query,
          sku: bulkSku.trim(),
          reason: "Bulk koppeling vanuit dashboard",
        }));
      const result = await bulkCreateOverrides(items);
      setBulkResult({ created: result.created, updated: result.updated, errors: result.errors.length });
      setBulkModalOpen(false);
      setSelected(new Set());
      setBulkSku("");
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Bulk koppelen mislukt");
    } finally {
      setBulkSaving(false);
    }
  };

  const unresolvedCount = data?.items.filter((i) => !i.resolvedAt).length ?? 0;
  const allSelected = unresolvedCount > 0 && selected.size === unresolvedCount;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Link2Off className="h-6 w-6 text-orange-500" />
            Niet gekoppeld
          </h2>
          <p className="text-muted-foreground text-sm">
            Producten die niet automatisch aan een IC-artikel gekoppeld konden worden
          </p>
        </div>
        <Select value={filter} onValueChange={(v) => { setFilter(v); setPage(1); setSelected(new Set()); }}>
          <SelectTrigger className="w-full sm:w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="false">Onopgelost</SelectItem>
            <SelectItem value="true">Opgelost</SelectItem>
            <SelectItem value="all">Alles</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Success banner */}
      {bulkResult && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-800">
          <CheckCheck className="h-4 w-4 shrink-0 text-green-600" />
          <span>
            <strong>{bulkResult.created}</strong> nieuw gekoppeld,{" "}
            <strong>{bulkResult.updated}</strong> bijgewerkt
            {bulkResult.errors > 0 && <>, <strong>{bulkResult.errors}</strong> fouten</>}.
            {" "}Producten zijn direct beschikbaar in de Finalized API.
          </span>
          <button onClick={() => setBulkResult(null)} className="ml-auto text-green-600 hover:text-green-800">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-50 border border-blue-200">
          <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">{selected.size} geselecteerd</Badge>
          <Button size="sm" onClick={() => setBulkModalOpen(true)}>
            <Link2 className="h-3.5 w-3.5 mr-1.5" />
            Bulk koppelen
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            <X className="h-3.5 w-3.5 mr-1" />
            Deselecteren
          </Button>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-orange-500" />
            {filter === "false" ? "Onopgeloste" : filter === "true" ? "Opgeloste" : "Alle"} items
            <Badge variant="outline" className="ml-1 font-normal">{data?.total ?? 0}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !data?.items.length ? (
            <div className="flex flex-col items-center py-12 gap-2 text-muted-foreground">
              {filter === "false"
                ? <><CheckCheck className="h-8 w-8 text-green-500" /><p className="text-sm">Alles is gekoppeld!</p></>
                : <p className="text-sm">Geen items gevonden.</p>
              }
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {filter !== "true" && (
                      <TableHead className="w-10 pl-4">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleAll}
                          className="h-4 w-4 rounded border-gray-300 cursor-pointer"
                        />
                      </TableHead>
                    )}
                    <TableHead>Artikelnummer</TableHead>
                    <TableHead>Merk</TableHead>
                    <TableHead className="hidden sm:table-cell">Leverancier</TableHead>
                    <TableHead className="hidden lg:table-cell">Query</TableHead>
                    <TableHead className="hidden md:table-cell">Pogingen</TableHead>
                    <TableHead className="hidden xl:table-cell">Aangemaakt</TableHead>
                    <TableHead>Status</TableHead>
                    {filter !== "true" && <TableHead>IC SKU koppelen</TableHead>}
                    <TableHead className="text-right pr-4">Acties</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((item) => (
                    <TableRow key={item.id} className={selected.has(item.id) ? "bg-blue-50/60" : undefined}>
                      {filter !== "true" && (
                        <TableCell className="pl-4">
                          {!item.resolvedAt && (
                            <input
                              type="checkbox"
                              checked={selected.has(item.id)}
                              onChange={() => toggleSelect(item.id)}
                              className="h-4 w-4 rounded border-gray-300 cursor-pointer"
                            />
                          )}
                        </TableCell>
                      )}
                      <TableCell className="font-mono text-xs font-semibold">
                        {item.articleNo ?? item.query}
                      </TableCell>
                      <TableCell className="text-sm">{item.brand?.name ?? "—"}</TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Badge variant="outline" className="text-xs">{item.supplier?.name ?? "—"}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground hidden lg:table-cell">
                        {item.query}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Badge variant={item.attempts > 3 ? "destructive" : "secondary"} className="text-xs">
                          {item.attempts}×
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground hidden xl:table-cell">
                        {formatDate(item.createdAt)}
                      </TableCell>
                      <TableCell>
                        {item.resolvedAt
                          ? <Badge variant="success" className="text-xs">Gekoppeld</Badge>
                          : <Badge variant="destructive" className="text-xs">Wachtend</Badge>
                        }
                      </TableCell>

                      {/* Inline IC SKU input */}
                      {filter !== "true" && (
                        <TableCell>
                          {!item.resolvedAt && (
                            <div className="flex items-center gap-1.5 min-w-[180px]">
                              <Input
                                placeholder="IC SKU"
                                value={inlineSkus[item.id] ?? ""}
                                onChange={(e) => setInlineSkus((p) => ({ ...p, [item.id]: e.target.value }))}
                                className="h-7 text-xs font-mono"
                                onKeyDown={(e) => e.key === "Enter" && saveRow(item)}
                              />
                              {inlineSkus[item.id]?.trim() && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0 shrink-0"
                                  onClick={() => saveRow(item)}
                                  disabled={savingRow === item.id}
                                >
                                  {savingRow === item.id
                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    : <Save className="h-3.5 w-3.5 text-green-600" />
                                  }
                                </Button>
                              )}
                            </div>
                          )}
                        </TableCell>
                      )}

                      <TableCell className="text-right pr-4">
                        {!item.resolvedAt && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => router.push(`/unmatched/${item.id}`)}
                          >
                            <Link2 className="h-3 w-3 mr-1" />
                            Detail
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <p className="text-xs text-muted-foreground">
                Pagina {data.page} van {data.totalPages} &middot; {data.total} items
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Vorige
                </Button>
                <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>
                  Volgende
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bulk match modal */}
      <Dialog open={bulkModalOpen} onOpenChange={(open) => { setBulkModalOpen(open); if (!open) setBulkSku(""); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-4 w-4" />
              Bulk koppelen — {selected.size} {selected.size === 1 ? "item" : "items"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Vul één IC SKU (TOW_KOD) in die aan alle geselecteerde items wordt gekoppeld.
              Na opslaan zijn ze direct beschikbaar in de Finalized API.
            </p>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">IC SKU / TOW_KOD</label>
              <Input
                placeholder="bijv. H17R23"
                value={bulkSku}
                onChange={(e) => setBulkSku(e.target.value)}
                className="font-mono"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && !bulkSaving && bulkSku.trim() && handleBulkSave()}
              />
            </div>
            <div className="max-h-40 overflow-y-auto rounded border divide-y text-xs">
              {data?.items.filter((i) => selected.has(i.id)).map((i) => (
                <div key={i.id} className="flex items-center gap-2 px-3 py-1.5">
                  <span className="font-mono font-semibold">{i.articleNo ?? i.query}</span>
                  <span className="text-muted-foreground">{i.brand?.name}</span>
                  <Badge variant="outline" className="ml-auto text-xs">{i.supplier?.name}</Badge>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setBulkModalOpen(false); setBulkSku(""); }}>
              Annuleren
            </Button>
            <Button onClick={handleBulkSave} disabled={!bulkSku.trim() || bulkSaving}>
              {bulkSaving
                ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Bezig...</>
                : <><Link2 className="h-4 w-4 mr-2" />Koppelen</>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

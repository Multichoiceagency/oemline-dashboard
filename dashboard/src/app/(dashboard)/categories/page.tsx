"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApi } from "@/lib/hooks";
import { getCategories, syncTecDocCategories, mergeCategories } from "@/lib/api";
import type { Category } from "@/lib/api";
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
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatNumber } from "@/lib/utils";
import {
  FolderTree,
  Search,
  ChevronRight,
  FolderOpen,
  X,
  Loader2,
  ArrowLeft,
  Pencil,
  RefreshCw,
  Merge,
  CheckCheck,
  Trash2,
} from "lucide-react";

export default function CategoriesPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [parentId, setParentId] = useState<number | undefined>(undefined);
  const [breadcrumbs, setBreadcrumbs] = useState<Array<{ id: number; name: string }>>([]);

  // Multi-select
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Merge dialog
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeMode, setMergeMode] = useState<"new" | "existing">("new");
  const [mergeName, setMergeName] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState<string>("none");
  const [deleteSource, setDeleteSource] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeResult, setMergeResult] = useState<{ targetCategory: { name: string }; productsMoved: number; deleted: number } | null>(null);

  const { data, loading, refetch } = useApi(
    () => getCategories({ page, limit: 100, parentId, q: searchQuery || undefined }),
    [page, parentId, searchQuery]
  );

  // All categories for "existing" target dropdown
  const { data: allCats } = useApi(
    () => getCategories({ limit: 250, q: "" }),
    []
  );

  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ created: number; updated: number; linked: number; total: number } | null>(null);

  const handleSyncCategories = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await syncTecDocCategories();
      setSyncResult(result);
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Category sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleSearch = () => {
    setSearchQuery(searchInput);
    setPage(1);
    setParentId(undefined);
    setBreadcrumbs([]);
    setSelected(new Set());
  };

  const navigateToCategory = (cat: Category) => {
    if ((cat._count?.children ?? 0) > 0) {
      setBreadcrumbs([...breadcrumbs, { id: cat.id, name: cat.name }]);
      setParentId(cat.id);
      setPage(1);
      setSearchQuery("");
      setSearchInput("");
      setSelected(new Set());
    }
  };

  const navigateBack = () => {
    if (breadcrumbs.length > 1) {
      const newBreadcrumbs = breadcrumbs.slice(0, -1);
      setBreadcrumbs(newBreadcrumbs);
      setParentId(newBreadcrumbs[newBreadcrumbs.length - 1].id);
    } else {
      setBreadcrumbs([]);
      setParentId(undefined);
    }
    setPage(1);
    setSelected(new Set());
  };

  const navigateToBreadcrumb = (index: number) => {
    if (index < 0) {
      setBreadcrumbs([]);
      setParentId(undefined);
    } else {
      const newBreadcrumbs = breadcrumbs.slice(0, index + 1);
      setBreadcrumbs(newBreadcrumbs);
      setParentId(newBreadcrumbs[newBreadcrumbs.length - 1].id);
    }
    setPage(1);
    setSelected(new Set());
  };

  const toggleSelect = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (!data?.items) return;
    if (selected.size === data.items.length) setSelected(new Set());
    else setSelected(new Set(data.items.map((c) => c.id)));
  };

  const openMerge = () => {
    setMergeName("");
    setMergeTargetId("none");
    setMergeMode("new");
    setDeleteSource(false);
    setMergeResult(null);
    setMergeOpen(true);
  };

  const handleMerge = async () => {
    if (selected.size < 1) return;
    if (mergeMode === "new" && !mergeName.trim()) return;
    if (mergeMode === "existing" && mergeTargetId === "none") return;

    setMerging(true);
    try {
      const result = await mergeCategories({
        sourceCategoryIds: [...selected],
        ...(mergeMode === "new"
          ? { newCategory: { name: mergeName.trim() } }
          : { targetCategoryId: parseInt(mergeTargetId, 10) }),
        deleteSource,
      });
      setMergeResult(result);
      setSelected(new Set());
      refetch();
      setTimeout(() => setMergeOpen(false), 2000);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Samenvoegen mislukt");
    } finally {
      setMerging(false);
    }
  };

  const selectedCategories = data?.items.filter((c) => selected.has(c.id)) ?? [];
  const allSelected = (data?.items.length ?? 0) > 0 && selected.size === (data?.items.length ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Categorieën</h2>
          <p className="text-muted-foreground text-sm">
            Productcategorieën — eigen en TecDoc-categorieën samenvoegen
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap self-start sm:self-auto">
          {syncResult && (
            <Badge variant="secondary" className="text-xs">
              {syncResult.created} aangemaakt, {syncResult.updated} bijgewerkt
            </Badge>
          )}
          <Button variant="outline" onClick={() => router.push("/categories/new")}>
            + Nieuwe categorie
          </Button>
          <Button onClick={handleSyncCategories} disabled={syncing}>
            {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Sync TecDoc
          </Button>
        </div>
      </div>

      {/* Zoekbalk */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-2">
            <Input
              placeholder="Zoek categorieën..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="max-w-md"
            />
            <Button onClick={handleSearch}><Search className="h-4 w-4" /></Button>
            {searchQuery && (
              <Button variant="ghost" size="sm" onClick={() => { setSearchInput(""); setSearchQuery(""); setPage(1); }}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Selectie-actiebalk */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-50 border border-blue-200">
          <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">{selected.size} geselecteerd</Badge>
          <Button size="sm" onClick={openMerge}>
            <Merge className="h-3.5 w-3.5 mr-1.5" />
            Samenvoegen tot één categorie
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            <X className="h-3.5 w-3.5 mr-1" /> Deselecteer
          </Button>
          <span className="text-xs text-muted-foreground ml-auto hidden sm:block">
            {selectedCategories.map((c) => c.name).join(", ").slice(0, 80)}
          </span>
        </div>
      )}

      {/* Breadcrumbs */}
      {breadcrumbs.length > 0 && (
        <div className="flex items-center gap-1 text-sm">
          <Button variant="ghost" size="sm" onClick={() => navigateToBreadcrumb(-1)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Alle categorieën
          </Button>
          {breadcrumbs.map((crumb, i) => (
            <span key={crumb.id} className="flex items-center gap-1">
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigateToBreadcrumb(i)}
                className={i === breadcrumbs.length - 1 ? "font-bold" : ""}
              >
                {crumb.name}
              </Button>
            </span>
          ))}
        </div>
      )}

      {/* Categorielijst */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderTree className="h-5 w-5" />
            {breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1].name : "Alle categorieën"}{" "}
            <Badge variant="outline" className="font-normal">{data?.total ?? 0}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !data?.items.length ? (
            <div className="text-center py-12">
              <FolderOpen className="mx-auto h-12 w-12 text-muted-foreground/50" />
              <p className="mt-4 text-muted-foreground text-sm">Geen categorieën gevonden</p>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-6 px-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 pl-4">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        className="h-4 w-4 rounded border-gray-300 cursor-pointer"
                      />
                    </TableHead>
                    <TableHead>Categorie</TableHead>
                    <TableHead className="hidden sm:table-cell">Code</TableHead>
                    <TableHead className="hidden md:table-cell">TecDoc ID</TableHead>
                    <TableHead>Producten</TableHead>
                    <TableHead className="hidden sm:table-cell">Subcategorieën</TableHead>
                    <TableHead className="text-right">Acties</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((cat) => (
                    <TableRow
                      key={cat.id}
                      className={`cursor-pointer hover:bg-muted/50 ${selected.has(cat.id) ? "bg-blue-50/60" : ""}`}
                      onClick={() => navigateToCategory(cat)}
                    >
                      <TableCell className="pl-4" onClick={(e) => toggleSelect(cat.id, e)}>
                        <input
                          type="checkbox"
                          checked={selected.has(cat.id)}
                          onChange={() => {}}
                          className="h-4 w-4 rounded border-gray-300 cursor-pointer"
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <FolderTree className="h-4 w-4 text-muted-foreground shrink-0" />
                          {cat.name}
                          {!cat.tecdocId && (
                            <Badge variant="secondary" className="text-xs font-normal">eigen</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{cat.code}</code>
                      </TableCell>
                      <TableCell className="font-mono text-xs hidden md:table-cell">
                        {cat.tecdocId ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{formatNumber(cat._count?.products ?? 0)}</Badge>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {(cat._count?.children ?? 0) > 0 && (
                          <Badge variant="secondary">{cat._count?.children} sub</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); router.push(`/categories/${cat.id}`); }}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          {(cat._count?.children ?? 0) > 0 && (
                            <Button variant="ghost" size="sm" onClick={() => navigateToCategory(cat)}>
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-sm text-muted-foreground">Pagina {data.page} van {data.totalPages}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Vorige</Button>
                <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>Volgende</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Samenvoegen dialog */}
      <Dialog open={mergeOpen} onOpenChange={(o) => { setMergeOpen(o); if (!o) setMergeResult(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Merge className="h-4 w-4" />
              Categorieën samenvoegen — {selected.size} geselecteerd
            </DialogTitle>
          </DialogHeader>

          {mergeResult ? (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-green-50 border border-green-200">
              <CheckCheck className="h-5 w-5 text-green-600 shrink-0" />
              <div className="text-sm text-green-800">
                <strong>{mergeResult.productsMoved}</strong> producten verplaatst naar{" "}
                <strong>"{mergeResult.targetCategory.name}"</strong>.
                {mergeResult.deleted > 0 && <> {mergeResult.deleted} lege categorieën verwijderd.</>}
              </div>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              {/* Geselecteerde bronnen */}
              <div>
                <p className="text-sm font-medium mb-2">Samen te voegen categorieën:</p>
                <div className="max-h-32 overflow-y-auto rounded border divide-y text-xs">
                  {selectedCategories.map((c) => (
                    <div key={c.id} className="flex items-center justify-between px-3 py-1.5">
                      <span className="font-medium">{c.name}</span>
                      <Badge variant="outline" className="text-xs">{c._count?.products ?? 0} producten</Badge>
                    </div>
                  ))}
                </div>
              </div>

              {/* Doelcategorie kiezen */}
              <div className="space-y-3">
                <p className="text-sm font-medium">Doelcategorie:</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={mergeMode === "new" ? "default" : "outline"}
                    onClick={() => setMergeMode("new")}
                  >
                    Nieuwe categorie
                  </Button>
                  <Button
                    size="sm"
                    variant={mergeMode === "existing" ? "default" : "outline"}
                    onClick={() => setMergeMode("existing")}
                  >
                    Bestaande categorie
                  </Button>
                </div>

                {mergeMode === "new" ? (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Naam nieuwe categorie</label>
                    <Input
                      placeholder="bijv. Uitlaatsysteem & Ophangingen"
                      value={mergeName}
                      onChange={(e) => setMergeName(e.target.value)}
                      autoFocus
                    />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Kies bestaande categorie</label>
                    <Select value={mergeTargetId} onValueChange={setMergeTargetId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecteer categorie" />
                      </SelectTrigger>
                      <SelectContent className="max-h-64 overflow-y-auto">
                        <SelectItem value="none">— Kies een categorie</SelectItem>
                        {allCats?.items
                          .filter((c) => !selected.has(c.id))
                          .map((c) => (
                            <SelectItem key={c.id} value={String(c.id)}>
                              {c.name}
                              {c._count?.products ? ` (${c._count.products})` : ""}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {/* Lege bronnen verwijderen */}
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={deleteSource}
                  onChange={(e) => setDeleteSource(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                Verwijder lege broncategorieën na samenvoegen
              </label>

              <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
                Alle producten uit de geselecteerde categorieën worden verplaatst naar de doelcategorie.
                Subcategorieën worden ook verplaatst. Dit is direct zichtbaar in de storefront.
              </p>
            </div>
          )}

          {!mergeResult && (
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setMergeOpen(false)}>Annuleren</Button>
              <Button
                onClick={handleMerge}
                disabled={merging || (mergeMode === "new" ? !mergeName.trim() : mergeTargetId === "none")}
              >
                {merging
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Bezig...</>
                  : <><Merge className="h-4 w-4 mr-2" />Samenvoegen</>
                }
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

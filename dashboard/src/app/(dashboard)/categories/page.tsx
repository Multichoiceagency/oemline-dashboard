"use client";

import { useState } from "react";
import { useApi } from "@/lib/hooks";
import { getCategories, updateCategory, syncTecDocCategories } from "@/lib/api";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
} from "lucide-react";

export default function CategoriesPage() {
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [parentId, setParentId] = useState<number | undefined>(undefined);
  const [breadcrumbs, setBreadcrumbs] = useState<Array<{ id: number; name: string }>>([]);

  const { data, loading, refetch } = useApi(
    () =>
      getCategories({
        page,
        limit: 100,
        parentId,
        q: searchQuery || undefined,
      }),
    [page, parentId, searchQuery]
  );

  // Edit dialog
  const [editCategory, setEditCategory] = useState<Category | null>(null);
  const [editForm, setEditForm] = useState({ name: "", code: "" });
  const [saving, setSaving] = useState(false);
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
  };

  const navigateToCategory = (cat: Category) => {
    if ((cat._count?.children ?? 0) > 0) {
      setBreadcrumbs([...breadcrumbs, { id: cat.id, name: cat.name }]);
      setParentId(cat.id);
      setPage(1);
      setSearchQuery("");
      setSearchInput("");
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
  };

  const openEdit = (cat: Category, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditCategory(cat);
    setEditForm({ name: cat.name, code: cat.code });
  };

  const handleSave = async () => {
    if (!editCategory) return;
    setSaving(true);
    try {
      await updateCategory(editCategory.id, {
        name: editForm.name,
        code: editForm.code,
      });
      setEditCategory(null);
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update category");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Categories</h2>
          <p className="text-muted-foreground">
            Product categories and assembly groups from TecDoc
          </p>
        </div>
        <div className="flex items-center gap-2">
          {syncResult && (
            <Badge variant="secondary" className="text-xs">
              {syncResult.created} created, {syncResult.updated} updated, {syncResult.linked} linked
            </Badge>
          )}
          <Button onClick={handleSyncCategories} disabled={syncing}>
            {syncing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Sync from TecDoc
          </Button>
        </div>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-2">
            <Input
              placeholder="Search categories..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="max-w-md"
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
        </CardContent>
      </Card>

      {/* Breadcrumbs */}
      {breadcrumbs.length > 0 && (
        <div className="flex items-center gap-1 text-sm">
          <Button variant="ghost" size="sm" onClick={() => navigateToBreadcrumb(-1)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> All Categories
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

      {/* Categories */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderTree className="h-5 w-5" />
            {breadcrumbs.length > 0
              ? breadcrumbs[breadcrumbs.length - 1].name
              : "All Categories"}{" "}
            ({data?.total ?? 0})
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
              <p className="mt-4 text-lg font-medium text-muted-foreground">
                No categories found
              </p>
              <p className="text-sm text-muted-foreground">
                Categories will be populated when TecDoc catalog is synced
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>TecDoc ID</TableHead>
                  <TableHead>Products</TableHead>
                  <TableHead>Subcategories</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((cat) => (
                  <TableRow
                    key={cat.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigateToCategory(cat)}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <FolderTree className="h-4 w-4 text-muted-foreground" />
                        {cat.name}
                      </div>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                        {cat.code}
                      </code>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {cat.tecdocId ?? "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {formatNumber(cat._count?.products ?? 0)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {(cat._count?.children ?? 0) > 0 && (
                        <Badge variant="secondary">
                          {cat._count?.children} subcategories
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={(e) => openEdit(cat, e)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        {(cat._count?.children ?? 0) > 0 && (
                          <Button variant="ghost" size="sm">
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-sm text-muted-foreground">
                Page {data.page} of {data.totalPages}
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
        </CardContent>
      </Card>

      {/* Edit Category Dialog */}
      <Dialog open={!!editCategory} onOpenChange={(open) => { if (!open) setEditCategory(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5" /> Edit Category
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Name</label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Code</label>
              <Input
                value={editForm.code}
                onChange={(e) => setEditForm({ ...editForm, code: e.target.value })}
              />
            </div>
            <div className="text-sm text-muted-foreground">
              TecDoc ID: {editCategory?.tecdocId ?? "-"}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditCategory(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

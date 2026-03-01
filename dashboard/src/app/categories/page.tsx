"use client";

import { useState } from "react";
import { useApi } from "@/lib/hooks";
import { getCategories } from "@/lib/api";
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
import { formatNumber } from "@/lib/utils";
import {
  FolderTree,
  Search,
  ChevronRight,
  FolderOpen,
  X,
  Loader2,
  ArrowLeft,
} from "lucide-react";

export default function CategoriesPage() {
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [parentId, setParentId] = useState<number | undefined>(undefined);
  const [breadcrumbs, setBreadcrumbs] = useState<Array<{ id: number; name: string }>>([]);

  const { data, loading } = useApi(
    () =>
      getCategories({
        page,
        limit: 100,
        parentId,
        q: searchQuery || undefined,
      }),
    [page, parentId, searchQuery]
  );

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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Categories</h2>
        <p className="text-muted-foreground">
          Product categories and assembly groups from TecDoc
        </p>
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
                      {(cat._count?.children ?? 0) > 0 && (
                        <Button variant="ghost" size="sm">
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      )}
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
    </div>
  );
}

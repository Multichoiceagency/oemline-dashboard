"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApi } from "@/lib/hooks";
import { getSuppliers, updateSupplier, syncSupplier, bootstrapVanWezel } from "@/lib/api";
import type { Supplier } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { Plus, RefreshCw, Power, PowerOff, Download } from "lucide-react";

export default function SuppliersPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const { data, loading, refetch } = useApi(
    () => getSuppliers({ page, limit: 25 }),
    [page]
  );
  const [syncing, setSyncing] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(false);

  const handleSync = async (id: string) => {
    setSyncing(id);
    try {
      await syncSupplier(id);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(null);
    }
  };

  const handleBootstrapVanWezel = async () => {
    if (!confirm("Bootstrap Van Wezel vanuit TecDoc? Dit kopieert alle TecDoc Van Wezel producten naar de Van Wezel supplier. Bestaande producten worden bijgewerkt (upsert).")) return;
    setBootstrapping(true);
    try {
      const result = await bootstrapVanWezel();
      alert(`Bootstrap klaar! ${result.upserted.toLocaleString()} producten gekopieerd van TecDoc (${result.brand}).`);
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Bootstrap mislukt");
    } finally {
      setBootstrapping(false);
    }
  };

  const handleToggle = async (supplier: Supplier) => {
    try {
      await updateSupplier(supplier.id, { active: !supplier.active });
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Update failed");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Suppliers</h2>
          <p className="text-muted-foreground text-sm">Manage supplier connections and catalog syncing</p>
        </div>
        <Button onClick={() => router.push("/suppliers/new")} className="min-h-[44px] sm:min-h-0 self-start sm:self-auto">
          <Plus className="mr-2 h-4 w-4" /> Add Supplier
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Suppliers ({data?.total ?? 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground py-8 text-center">Loading suppliers...</p>
          ) : !data?.items.length ? (
            <p className="text-muted-foreground py-8 text-center">
              No suppliers registered yet. Click &quot;Add Supplier&quot; to get started.
            </p>
          ) : (
            <div className="overflow-x-auto -mx-6 px-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Code</TableHead>
                  <TableHead className="hidden md:table-cell">Adapter</TableHead>
                  <TableHead className="hidden lg:table-cell">Priority</TableHead>
                  <TableHead>Products</TableHead>
                  <TableHead className="hidden md:table-cell">Unmatched</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{s.code}</code>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{s.adapterType}</TableCell>
                    <TableCell className="hidden lg:table-cell">{s.priority}</TableCell>
                    <TableCell>{formatNumber(s._count?.productMaps ?? 0)}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      {(s._count?.unmatched ?? 0) > 0 ? (
                        <Badge variant="warning">{s._count?.unmatched}</Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={s.active ? "success" : "secondary"}>
                        {s.active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-1 sm:space-x-2">
                      {s.adapterType === "vanwezel" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleBootstrapVanWezel}
                          disabled={bootstrapping}
                          title="Kopieer alle Van Wezel producten vanuit TecDoc"
                          className="min-h-[44px] sm:min-h-0"
                        >
                          <Download className={`h-3 w-3 mr-1 ${bootstrapping ? "animate-pulse" : ""}`} />
                          <span className="hidden sm:inline">Bootstrap</span>
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSync(s.id)}
                        disabled={syncing === s.id}
                        className="min-h-[44px] sm:min-h-0"
                      >
                        <RefreshCw className={`h-3 w-3 mr-1 ${syncing === s.id ? "animate-spin" : ""}`} />
                        <span className="hidden sm:inline">Sync</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggle(s)}
                        className="min-h-[44px] sm:min-h-0"
                      >
                        {s.active ? <PowerOff className="h-3 w-3" /> : <Power className="h-3 w-3" />}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
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

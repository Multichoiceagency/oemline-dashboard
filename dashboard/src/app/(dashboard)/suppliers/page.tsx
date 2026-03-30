"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApi } from "@/lib/hooks";
import { getSuppliers, updateSupplier, syncSupplier } from "@/lib/api";
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
import { Plus, RefreshCw, Power, PowerOff } from "lucide-react";

export default function SuppliersPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const { data, loading, refetch } = useApi(
    () => getSuppliers({ page, limit: 25 }),
    [page]
  );
  const [syncing, setSyncing] = useState<string | null>(null);

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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Suppliers</h2>
          <p className="text-muted-foreground">Manage supplier connections and catalog syncing</p>
        </div>
        <Button onClick={() => router.push("/suppliers/new")}>
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Adapter</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Products</TableHead>
                  <TableHead>Unmatched</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{s.code}</code>
                    </TableCell>
                    <TableCell>{s.adapterType}</TableCell>
                    <TableCell>{s.priority}</TableCell>
                    <TableCell>{formatNumber(s._count?.productMaps ?? 0)}</TableCell>
                    <TableCell>
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
                    <TableCell className="text-right space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSync(s.id)}
                        disabled={syncing === s.id}
                      >
                        <RefreshCw className={`h-3 w-3 mr-1 ${syncing === s.id ? "animate-spin" : ""}`} />
                        Sync
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggle(s)}
                      >
                        {s.active ? <PowerOff className="h-3 w-3" /> : <Power className="h-3 w-3" />}
                      </Button>
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

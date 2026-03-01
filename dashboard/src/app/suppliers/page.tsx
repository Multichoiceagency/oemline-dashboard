"use client";

import { useState } from "react";
import { useApi } from "@/lib/hooks";
import { getSuppliers, createSupplier, updateSupplier, syncSupplier } from "@/lib/api";
import type { Supplier } from "@/lib/api";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatNumber, formatDate } from "@/lib/utils";
import { Plus, RefreshCw, Power, PowerOff } from "lucide-react";

export default function SuppliersPage() {
  const [page, setPage] = useState(1);
  const { data, loading, refetch } = useApi(
    () => getSuppliers({ page, limit: 25 }),
    [page]
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    code: "",
    adapterType: "intercars",
    baseUrl: "",
    credentials: "",
    priority: "10",
  });

  const handleCreate = async () => {
    try {
      let creds: Record<string, string> = {};
      try {
        creds = JSON.parse(form.credentials);
      } catch {
        creds = { apiKey: form.credentials };
      }
      await createSupplier({
        name: form.name,
        code: form.code,
        adapterType: form.adapterType,
        baseUrl: form.baseUrl,
        credentials: creds,
        priority: parseInt(form.priority),
      });
      setDialogOpen(false);
      setForm({ name: "", code: "", adapterType: "intercars", baseUrl: "", credentials: "", priority: "10" });
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create supplier");
    }
  };

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
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> Add Supplier
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Supplier</DialogTitle>
              <DialogDescription>Connect a new parts supplier to the platform</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Name</label>
                  <Input
                    placeholder="InterCars"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Code</label>
                  <Input
                    placeholder="intercars"
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Adapter Type</label>
                  <Select value={form.adapterType} onValueChange={(v) => setForm({ ...form, adapterType: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="intercars">InterCars</SelectItem>
                      <SelectItem value="partspoint">PartsPoint</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Priority</label>
                  <Input
                    type="number"
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Base URL</label>
                <Input
                  placeholder="https://api.supplier.com"
                  value={form.baseUrl}
                  onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Credentials (JSON)</label>
                <Input
                  placeholder='{"clientId":"...","clientSecret":"..."}'
                  value={form.credentials}
                  onChange={(e) => setForm({ ...form, credentials: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={!form.name || !form.code}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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

"use client";

import { useState } from "react";
import { useApi } from "@/lib/hooks";
import { getUnmatched, createOverride } from "@/lib/api";
import type { UnmatchedItem } from "@/lib/api";
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
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/lib/utils";
import { AlertTriangle, GitCompare } from "lucide-react";

export default function UnmatchedPage() {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("false");
  const { data, loading, refetch } = useApi(
    () => getUnmatched({ page, limit: 25, resolved: filter }),
    [page, filter]
  );
  const [resolveItem, setResolveItem] = useState<UnmatchedItem | null>(null);
  const [form, setForm] = useState({ sku: "", ean: "", tecdocId: "", oem: "", reason: "" });

  const handleResolve = async () => {
    if (!resolveItem) return;
    try {
      await createOverride({
        supplierCode: resolveItem.supplier?.code ?? "",
        brandCode: resolveItem.brand?.code ?? "",
        articleNo: resolveItem.articleNo ?? resolveItem.query,
        sku: form.sku,
        ean: form.ean || undefined,
        tecdocId: form.tecdocId || undefined,
        oem: form.oem || undefined,
        reason: form.reason || "Manual resolution from dashboard",
        createdBy: "dashboard",
      });
      setResolveItem(null);
      setForm({ sku: "", ean: "", tecdocId: "", oem: "", reason: "" });
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create override");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Unmatched Items</h2>
          <p className="text-muted-foreground">Products that failed to match across suppliers</p>
        </div>
        <Select value={filter} onValueChange={(v) => { setFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="false">Unresolved</SelectItem>
            <SelectItem value="true">Resolved</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            {filter === "false" ? "Unresolved" : filter === "true" ? "Resolved" : "All"} Items ({data?.total ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground text-center py-8">Loading...</p>
          ) : !data?.items.length ? (
            <p className="text-muted-foreground text-center py-8">
              {filter === "false" ? "No unresolved items. Everything is matched!" : "No items found."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Query</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Brand</TableHead>
                  <TableHead>Article No.</TableHead>
                  <TableHead>EAN</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs font-medium">{item.query}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{item.supplier?.name ?? "-"}</Badge>
                    </TableCell>
                    <TableCell>{item.brand?.name ?? "-"}</TableCell>
                    <TableCell className="font-mono text-xs">{item.articleNo ?? "-"}</TableCell>
                    <TableCell className="font-mono text-xs">{item.ean ?? "-"}</TableCell>
                    <TableCell>
                      <Badge variant={item.attempts > 3 ? "warning" : "secondary"}>{item.attempts}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(item.createdAt)}</TableCell>
                    <TableCell>
                      {item.resolvedAt ? (
                        <Badge variant="success">Resolved</Badge>
                      ) : (
                        <Badge variant="destructive">Pending</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {!item.resolvedAt && (
                        <Button variant="outline" size="sm" onClick={() => setResolveItem(item)}>
                          <GitCompare className="h-3 w-3 mr-1" /> Resolve
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
              <p className="text-sm text-muted-foreground">Page {data.page} of {data.totalPages}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!resolveItem} onOpenChange={(open) => !open && setResolveItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve Unmatched Item</DialogTitle>
            <DialogDescription>
              Create a manual override for: <strong>{resolveItem?.query}</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">SKU (Supplier Part Number)</label>
              <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="Supplier SKU" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">EAN</label>
                <Input value={form.ean} onChange={(e) => setForm({ ...form, ean: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">TecDoc ID</label>
                <Input value={form.tecdocId} onChange={(e) => setForm({ ...form, tecdocId: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">OEM Number</label>
              <Input value={form.oem} onChange={(e) => setForm({ ...form, oem: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Reason</label>
              <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Manual match from dashboard" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveItem(null)}>Cancel</Button>
            <Button onClick={handleResolve} disabled={!form.sku}>Create Override</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

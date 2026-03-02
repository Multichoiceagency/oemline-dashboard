"use client";

import { useState } from "react";
import { useApi } from "@/lib/hooks";
import { getOverrides, createOverride } from "@/lib/api";
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
import { formatDate } from "@/lib/utils";
import { GitCompare, Plus } from "lucide-react";

export default function OverridesPage() {
  const [page, setPage] = useState(1);
  const { data, loading, refetch } = useApi(
    () => getOverrides({ page, limit: 25 }),
    [page]
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    supplierCode: "",
    brandCode: "",
    articleNo: "",
    sku: "",
    ean: "",
    tecdocId: "",
    oem: "",
    reason: "",
  });

  const handleCreate = async () => {
    try {
      await createOverride({
        supplierCode: form.supplierCode,
        brandCode: form.brandCode,
        articleNo: form.articleNo,
        sku: form.sku,
        ean: form.ean || undefined,
        tecdocId: form.tecdocId || undefined,
        oem: form.oem || undefined,
        reason: form.reason || undefined,
        createdBy: "dashboard",
      });
      setDialogOpen(false);
      setForm({ supplierCode: "", brandCode: "", articleNo: "", sku: "", ean: "", tecdocId: "", oem: "", reason: "" });
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create override");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Overrides</h2>
          <p className="text-muted-foreground">Manual product mapping overrides</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" /> New Override</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Override</DialogTitle>
              <DialogDescription>Manually map a supplier product to article identifiers</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Supplier Code</label>
                  <Input value={form.supplierCode} onChange={(e) => setForm({ ...form, supplierCode: e.target.value })} placeholder="intercars" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Brand Code</label>
                  <Input value={form.brandCode} onChange={(e) => setForm({ ...form, brandCode: e.target.value })} placeholder="BOSCH" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Article No.</label>
                  <Input value={form.articleNo} onChange={(e) => setForm({ ...form, articleNo: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">SKU</label>
                  <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">EAN</label>
                  <Input value={form.ean} onChange={(e) => setForm({ ...form, ean: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">TecDoc ID</label>
                  <Input value={form.tecdocId} onChange={(e) => setForm({ ...form, tecdocId: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">OEM</label>
                  <Input value={form.oem} onChange={(e) => setForm({ ...form, oem: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Reason</label>
                <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Manual correction" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={!form.supplierCode || !form.brandCode || !form.articleNo || !form.sku}>
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitCompare className="h-5 w-5" /> Overrides ({data?.total ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground text-center py-8">Loading...</p>
          ) : !data?.items.length ? (
            <p className="text-muted-foreground text-center py-8">No overrides created yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Brand</TableHead>
                  <TableHead>Article No.</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>EAN</TableHead>
                  <TableHead>TecDoc ID</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell><Badge variant="outline">{o.supplier?.name ?? "-"}</Badge></TableCell>
                    <TableCell>{o.brand?.name ?? "-"}</TableCell>
                    <TableCell className="font-mono text-xs">{o.articleNo}</TableCell>
                    <TableCell className="font-mono text-xs">{o.sku}</TableCell>
                    <TableCell className="font-mono text-xs">{o.ean ?? "-"}</TableCell>
                    <TableCell className="font-mono text-xs">{o.tecdocId ?? "-"}</TableCell>
                    <TableCell className="max-w-[150px] truncate text-muted-foreground">{o.reason ?? "-"}</TableCell>
                    <TableCell>
                      <Badge variant={o.active ? "success" : "secondary"}>
                        {o.active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(o.createdAt)}</TableCell>
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
    </div>
  );
}

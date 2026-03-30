"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApi } from "@/lib/hooks";
import { getOverrides } from "@/lib/api";
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
import { formatDate } from "@/lib/utils";
import { GitCompare, Plus } from "lucide-react";

export default function OverridesPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const { data, loading } = useApi(
    () => getOverrides({ page, limit: 25 }),
    [page]
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Overrides</h2>
          <p className="text-muted-foreground">Manual product mapping overrides</p>
        </div>
        <Button onClick={() => router.push("/overrides/new")}>
          <Plus className="mr-2 h-4 w-4" /> New Override
        </Button>
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

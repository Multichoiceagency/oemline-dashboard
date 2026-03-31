"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { createOverride } from "@/lib/api";
import type { UnmatchedItem } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, GitCompare } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "";

async function fetchUnmatchedItem(id: string): Promise<UnmatchedItem> {
  const res = await fetch(`${API_BASE}/api/unmatched/${id}`, {
    headers: { "X-API-Key": API_KEY },
  });
  if (!res.ok) {
    throw new Error(`Failed to load unmatched item (${res.status})`);
  }
  return res.json();
}

export default function ResolveUnmatchedPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [item, setItem] = useState<UnmatchedItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    sku: "",
    ean: "",
    tecdocId: "",
    oem: "",
    reason: "",
  });

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchUnmatchedItem(id)
      .then(setItem)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load item"))
      .finally(() => setLoading(false));
  }, [id]);

  const handleResolve = async () => {
    if (!item) return;
    setSaving(true);
    try {
      await createOverride({
        supplierCode: item.supplier?.code ?? "",
        brandCode: item.brand?.code ?? "",
        articleNo: item.articleNo ?? item.query,
        sku: form.sku,
        ean: form.ean || undefined,
        tecdocId: form.tecdocId || undefined,
        oem: form.oem || undefined,
        reason: form.reason || "Manual resolution from dashboard",
        createdBy: "dashboard",
      });
      router.push("/unmatched");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create override");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => router.push("/unmatched")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
        </div>
        <Card>
          <CardContent className="py-8">
            <p className="text-center text-muted-foreground">
              {error ?? "Unmatched item not found"}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/unmatched")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
      </div>

      <div>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Resolve Unmatched Item</h2>
        <p className="text-muted-foreground">
          Create a manual override for this unmatched product
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Item Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Query</p>
              <p className="font-mono text-sm font-medium">{item.query}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Supplier</p>
              <Badge variant="outline">{item.supplier?.name ?? "-"}</Badge>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Brand</p>
              <p className="text-sm">{item.brand?.name ?? "-"}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Article No.</p>
              <p className="font-mono text-sm">{item.articleNo ?? "-"}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitCompare className="h-5 w-5" /> Resolve with Override
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 max-w-2xl">
            <div className="space-y-2">
              <label className="text-sm font-medium">SKU (Supplier Part Number)</label>
              <Input
                placeholder="Supplier SKU"
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">EAN</label>
                <Input
                  value={form.ean}
                  onChange={(e) => setForm({ ...form, ean: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">TecDoc ID</label>
                <Input
                  value={form.tecdocId}
                  onChange={(e) => setForm({ ...form, tecdocId: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">OEM Number</label>
              <Input
                value={form.oem}
                onChange={(e) => setForm({ ...form, oem: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Reason</label>
              <Input
                placeholder="Manual match from dashboard"
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Button variant="outline" onClick={() => router.push("/unmatched")}>
                Cancel
              </Button>
              <Button onClick={handleResolve} disabled={!form.sku.trim() || saving}>
                {saving ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <GitCompare className="h-4 w-4 mr-2" />
                )}
                Create Override
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createOverride } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Plus, Loader2, GitCompare } from "lucide-react";

export default function NewOverridePage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
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
    setSaving(true);
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
      router.push("/overrides");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create override");
    } finally {
      setSaving(false);
    }
  };

  const isValid =
    form.supplierCode.trim() !== "" &&
    form.brandCode.trim() !== "" &&
    form.articleNo.trim() !== "" &&
    form.sku.trim() !== "";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/overrides")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
      </div>

      <div>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Create Override</h2>
        <p className="text-muted-foreground">
          Manually map a supplier product to article identifiers
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitCompare className="h-5 w-5" /> Override Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 max-w-2xl">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Supplier Code</label>
                <Input
                  placeholder="intercars"
                  value={form.supplierCode}
                  onChange={(e) => setForm({ ...form, supplierCode: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Brand Code</label>
                <Input
                  placeholder="BOSCH"
                  value={form.brandCode}
                  onChange={(e) => setForm({ ...form, brandCode: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Article No.</label>
                <Input
                  value={form.articleNo}
                  onChange={(e) => setForm({ ...form, articleNo: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">SKU</label>
                <Input
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
              <div className="space-y-2">
                <label className="text-sm font-medium">OEM</label>
                <Input
                  value={form.oem}
                  onChange={(e) => setForm({ ...form, oem: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Reason</label>
              <Input
                placeholder="Manual correction"
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Button variant="outline" onClick={() => router.push("/overrides")}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={!isValid || saving}>
                {saving ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4 mr-2" />
                )}
                Create
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

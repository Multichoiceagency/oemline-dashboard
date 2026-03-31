"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupplier } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Plus, Loader2 } from "lucide-react";

export default function NewSupplierPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    code: "",
    adapterType: "intercars",
    baseUrl: "",
    credentials: "",
    priority: "10",
  });

  const handleCreate = async () => {
    setSaving(true);
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
      router.push("/suppliers");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create supplier");
    } finally {
      setSaving(false);
    }
  };

  const isValid = form.name.trim() !== "" && form.code.trim() !== "";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/suppliers")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
      </div>

      <div>
        <h2 className="text-3xl font-bold tracking-tight">Add Supplier</h2>
        <p className="text-muted-foreground">Connect a new parts supplier to the platform</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Supplier Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 max-w-2xl">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Adapter Type</label>
                <Select
                  value={form.adapterType}
                  onValueChange={(v) => setForm({ ...form, adapterType: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
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

            <div className="flex items-center gap-3 pt-2">
              <Button variant="outline" onClick={() => router.push("/suppliers")}>
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

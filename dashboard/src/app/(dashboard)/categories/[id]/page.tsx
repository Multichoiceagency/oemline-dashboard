"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getCategory, updateCategory } from "@/lib/api";
import type { Category } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/utils";
import { FolderTree, ArrowLeft, Save, Loader2 } from "lucide-react";

export default function EditCategoryPage() {
  const params = useParams();
  const router = useRouter();
  const id = Number(params.id);

  const [category, setCategory] = useState<Category | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", code: "" });

  useEffect(() => {
    if (!id || isNaN(id)) {
      setError("Invalid category ID");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    getCategory(id)
      .then((data) => {
        setCategory(data);
        setForm({ name: data.name, code: data.code });
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load category");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [id]);

  const handleSave = async () => {
    if (!category) return;

    setSaving(true);
    try {
      await updateCategory(category.id, {
        name: form.name,
        code: form.code,
      });
      router.push("/categories");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update category");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !category) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => router.push("/categories")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Categories
        </Button>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-lg font-medium text-destructive">
              {error ?? "Category not found"}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push("/categories")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Edit Category</h2>
          <p className="text-muted-foreground">{category.name}</p>
        </div>
      </div>

      {/* Form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderTree className="h-5 w-5" />
            Category Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6 max-w-lg">
            {/* Name */}
            <div className="space-y-2">
              <label htmlFor="name" className="text-sm font-medium">
                Name
              </label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Category name"
              />
            </div>

            {/* Code */}
            <div className="space-y-2">
              <label htmlFor="code" className="text-sm font-medium">
                Code
              </label>
              <Input
                id="code"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="Category code"
              />
            </div>

            {/* Read-only fields */}
            <div className="space-y-4 rounded-md border p-4 bg-muted/30">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">
                  TecDoc ID
                </span>
                <span className="font-mono text-sm">
                  {category.tecdocId ?? "-"}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">
                  Products
                </span>
                <Badge variant="outline">
                  {formatNumber(category._count?.products ?? 0)}
                </Badge>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">
                  Subcategories
                </span>
                <Badge variant="secondary">
                  {formatNumber(category._count?.children ?? 0)}
                </Badge>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save Changes
              </Button>
              <Button
                variant="outline"
                onClick={() => router.push("/categories")}
                disabled={saving}
              >
                Cancel
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

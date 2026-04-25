"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createCategory, getCategories } from "@/lib/api";
import type { Category } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, FolderPlus, Loader2 } from "lucide-react";

export default function NewCategoryPage() {
  const router = useRouter();
  const [allCategories, setAllCategories] = useState<Category[]>([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", parentId: "none", description: "", seoDescription: "" });

  useEffect(() => {
    getCategories({ limit: 250, hideEmpty: "false" })
      .then((r) => setAllCategories(r.items ?? []))
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const category = await createCategory({
        name: form.name.trim(),
        code: form.code.trim() || undefined,
        parentId: form.parentId === "none" ? null : Number(form.parentId),
        description: form.description.trim() || null,
        seoDescription: form.seoDescription.trim() || null,
      });
      router.push(`/categories/${category.id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Aanmaken mislukt");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push("/categories")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Terug
        </Button>
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Nieuwe categorie</h2>
          <p className="text-muted-foreground text-sm">Maak een handmatige categorie aan</p>
        </div>
      </div>

      <Card className="max-w-lg">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FolderPlus className="h-4 w-4" /> Categoriegegevens
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Naam <span className="text-red-500">*</span>
            </label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="bijv. Remonderdelen"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Code <span className="text-muted-foreground font-normal">(optioneel — wordt automatisch gegenereerd)</span></label>
            <Input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="bijv. remonderdelen"
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Bovenliggende categorie <span className="text-muted-foreground font-normal">(optioneel)</span></label>
            <Select value={form.parentId} onValueChange={(v) => setForm({ ...form, parentId: v })}>
              <SelectTrigger>
                <SelectValue placeholder="Geen (toplevel categorie)" />
              </SelectTrigger>
              <SelectContent className="max-h-64 overflow-y-auto">
                <SelectItem value="none">— Geen (toplevel)</SelectItem>
                {allCategories.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {"·".repeat(c.level ?? 0)}{c.level ? " " : ""}{c.name}
                    {c.tecdocId && <span className="text-muted-foreground ml-1 text-xs">(TecDoc)</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Beschrijving <span className="text-muted-foreground font-normal">(optioneel — boven productenlijst op storefront)</span>
            </label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Korte introductie boven de productenlijst (bijv. 'Onze remblokken passen op meer dan 5.000 modellen…')"
              rows={4}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              SEO-tekst (kenteken-zoeker) <span className="text-muted-foreground font-normal">(optioneel — onderaan de pagina bij kenteken-zoekresultaten)</span>
            </label>
            <textarea
              value={form.seoDescription}
              onChange={(e) => setForm({ ...form, seoDescription: e.target.value })}
              placeholder="SEO-tekst die getoond wordt onderaan de categoriepagina wanneer een bezoeker via kenteken zoekt. Markdown wordt als platte tekst gerenderd."
              rows={6}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button onClick={handleSave} disabled={saving || !form.name.trim()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FolderPlus className="h-4 w-4 mr-2" />}
              Aanmaken
            </Button>
            <Button variant="outline" onClick={() => router.push("/categories")}>Annuleren</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

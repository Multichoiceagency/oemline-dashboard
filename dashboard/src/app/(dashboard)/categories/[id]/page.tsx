"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getCategory, updateCategory, deleteCategory, getCategories } from "@/lib/api";
import type { Category } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatNumber } from "@/lib/utils";
import { FolderTree, ArrowLeft, Save, Loader2, Trash2, Info } from "lucide-react";

export default function EditCategoryPage() {
  const params = useParams();
  const router = useRouter();
  const id = Number(params.id);

  const [category, setCategory] = useState<Category | null>(null);
  const [allCategories, setAllCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", parentId: "none" });

  useEffect(() => {
    if (!id || isNaN(id)) { setError("Ongeldig categorie-ID"); setLoading(false); return; }
    setLoading(true);
    Promise.all([
      getCategory(id),
      getCategories({ limit: 250, hideEmpty: "false" }),
    ])
      .then(([cat, cats]) => {
        setCategory(cat);
        setForm({ name: cat.name, code: cat.code, parentId: cat.parentId ? String(cat.parentId) : "none" });
        setAllCategories((cats.items ?? []).filter((c: Category) => c.id !== id));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Ophalen mislukt"))
      .finally(() => setLoading(false));
  }, [id]);

  const handleSave = async () => {
    if (!category) return;
    setSaving(true);
    try {
      await updateCategory(category.id, {
        name: form.name,
        code: form.code,
        parentId: form.parentId === "none" ? null : Number(form.parentId),
      });
      router.push("/categories");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!category) return;
    if (!confirm(`Categorie "${category.name}" verwijderen?`)) return;
    setDeleting(true);
    try {
      await deleteCategory(category.id);
      router.push("/categories");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Verwijderen mislukt");
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  if (error || !category) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/categories")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Terug
        </Button>
        <Card><CardContent className="py-12 text-center text-destructive text-sm">{error ?? "Niet gevonden"}</CardContent></Card>
      </div>
    );
  }

  const isManual = !category.tecdocId;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="sm" onClick={() => router.push("/categories")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Terug
          </Button>
          <div className="min-w-0">
            <h2 className="text-2xl font-bold tracking-tight truncate">{category.name}</h2>
            <p className="text-muted-foreground text-sm">
              {category.tecdocId ? `TecDoc ID: ${category.tecdocId}` : "Handmatige categorie"}
              {category.parent && <> &middot; Onder: <strong>{(category as any).parent.name}</strong></>}
            </p>
          </div>
        </div>
        {isManual && (
          <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
            Verwijderen
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FolderTree className="h-4 w-4" /> Categoriegegevens
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Naam</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Categorienaam" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Code</label>
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="categorie-code" className="font-mono text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Bovenliggende categorie</label>
              <Select value={form.parentId} onValueChange={(v) => setForm({ ...form, parentId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Geen (toplevel)" />
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
            <div className="flex items-center gap-3 pt-2">
              <Button onClick={handleSave} disabled={saving || !form.name.trim()}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Opslaan
              </Button>
              <Button variant="outline" onClick={() => router.push("/categories")} disabled={saving}>Annuleren</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Info className="h-4 w-4" /> Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              ["TecDoc ID", category.tecdocId ? String(category.tecdocId) : null, true],
              ["Niveau", `Level ${category.level ?? 0}`, false],
            ].map(([label, val, mono]) => (
              <div key={label as string} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{label}</span>
                <span className={mono ? "font-mono" : ""}>{val ?? <span className="italic text-muted-foreground">Handmatig</span>}</span>
              </div>
            ))}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Producten</span>
              <Badge variant="secondary">{formatNumber(category._count?.products ?? 0)}</Badge>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subcategorieën</span>
              <Badge variant="outline">{formatNumber(category._count?.children ?? 0)}</Badge>
            </div>

            <div className="mt-3 p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-800">
              <p className="font-semibold mb-1">Automatisch bijgewerkt in de Finalized API</p>
              <p>Wijzigingen aan de categorienaam worden direct doorgevoerd. Alle gekoppelde producten tonen meteen de nieuwe naam via de API en storefront.</p>
            </div>

            {(category._count?.children ?? 0) > 0 && (
              <div className="p-3 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-800">
                Subcategorieën nemen de bovenliggende naam over — een naamswijziging hier geldt meteen voor alle {category._count?.children} subcategorieën en hun producten.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { getUnmatchedItem, bulkCreateOverrides } from "@/lib/api";
import type { UnmatchedItem } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, Link2, Info } from "lucide-react";
import { formatDate } from "@/lib/utils";

export default function ResolveUnmatchedPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [item, setItem] = useState<UnmatchedItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ sku: "", ean: "", tecdocId: "", oem: "", reason: "" });

  useEffect(() => {
    setLoading(true);
    setError(null);
    getUnmatchedItem(id)
      .then(setItem)
      .catch((err) => setError(err instanceof Error ? err.message : "Ophalen mislukt"))
      .finally(() => setLoading(false));
  }, [id]);

  const handleResolve = async () => {
    if (!item) return;
    setSaving(true);
    try {
      await bulkCreateOverrides([{
        supplierCode: item.supplier?.code ?? "",
        brandCode: item.brand?.code ?? "",
        articleNo: item.articleNo ?? item.query,
        sku: form.sku.trim(),
        ean: form.ean || undefined,
        tecdocId: form.tecdocId || undefined,
        oem: form.oem || undefined,
        reason: form.reason || "Handmatige koppeling vanuit dashboard",
      }]);
      router.push("/unmatched");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Opslaan mislukt");
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
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/unmatched")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Terug
        </Button>
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            {error ?? "Item niet gevonden"}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => router.push("/unmatched")}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Terug naar overzicht
      </Button>

      <div>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
          <Link2 className="h-6 w-6 text-blue-500" />
          Item koppelen
        </h2>
        <p className="text-muted-foreground text-sm">
          Maak een handmatige IC-koppeling aan voor dit niet-gekoppeld product
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Item info */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Info className="h-4 w-4" /> Productgegevens
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {([
              ["Query", item.query, true],
              ["Artikelnummer", item.articleNo, true],
              ["Merk", item.brand?.name, false],
              ["Leverancier", item.supplier?.name, false],
              ["EAN", item.ean, true],
              ["TecDoc ID", item.tecdocId, true],
              ["OEM", item.oem, true],
              ["Pogingen", String(item.attempts), false],
              ["Aangemaakt", formatDate(item.createdAt), false],
            ] as [string, string | null | undefined, boolean][]).filter(([, v]) => v).map(([label, value, mono]) => (
              <div key={label} className="flex justify-between items-start gap-4">
                <span className="text-sm text-muted-foreground shrink-0">{label}</span>
                <span className={`text-sm font-medium text-right ${mono ? "font-mono" : ""}`}>
                  {value}
                </span>
              </div>
            ))}
            <div className="pt-1">
              {item.resolvedAt
                ? <Badge variant="success">Gekoppeld op {formatDate(item.resolvedAt)}</Badge>
                : <Badge variant="destructive">Wachtend — nog niet gekoppeld</Badge>
              }
            </div>
          </CardContent>
        </Card>

        {/* Match form */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Link2 className="h-4 w-4" /> IC-koppeling instellen
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                IC SKU / TOW_KOD <span className="text-red-500">*</span>
              </label>
              <Input
                placeholder="bijv. H17R23"
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                className="font-mono"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                De InterCars product-code (TOW_KOD) uit de IC catalogus
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">EAN</label>
                <Input value={form.ean} onChange={(e) => setForm({ ...form, ean: e.target.value })} placeholder="Optioneel" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">TecDoc ID</label>
                <Input value={form.tecdocId} onChange={(e) => setForm({ ...form, tecdocId: e.target.value })} placeholder="Optioneel" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">OEM-nummer</label>
              <Input value={form.oem} onChange={(e) => setForm({ ...form, oem: e.target.value })} placeholder="Optioneel" />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Reden</label>
              <Input
                placeholder="Handmatige koppeling vanuit dashboard"
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Button variant="outline" onClick={() => router.push("/unmatched")}>
                Annuleren
              </Button>
              <Button onClick={handleResolve} disabled={!form.sku.trim() || saving}>
                {saving
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Opslaan...</>
                  : <><Link2 className="h-4 w-4 mr-2" />Koppeling opslaan</>
                }
              </Button>
            </div>

            {!item.resolvedAt && (
              <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
                Na het opslaan wordt dit product direct beschikbaar in de Finalized API
                en verschijnt het in de storefront.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

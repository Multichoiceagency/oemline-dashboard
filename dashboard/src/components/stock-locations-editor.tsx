"use client";

import { useEffect, useState } from "react";
import {
  getProductStockLocations,
  setProductStockLocations,
  type ProductStockBreakdown,
} from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Save, Warehouse, FileText, Plus, Minus, AlertTriangle } from "lucide-react";

/**
 * Edit per-location stock for a single product. Aggregates to product.stock
 * on save (handled server-side); the page can refetch the parent product to
 * see the new total.
 *
 * onSaved: called after a successful save with the new total quantity.
 */
export default function StockLocationsEditor({
  productId,
  apiUrl,
  onSaved,
}: {
  productId: number;
  /** Used to build the PDF URL — typically NEXT_PUBLIC_API_URL. */
  apiUrl: string;
  onSaved?: (totalQuantity: number) => void;
}) {
  const [data, setData] = useState<ProductStockBreakdown | null>(null);
  const [edits, setEdits] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getProductStockLocations(productId)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setEdits(Object.fromEntries(d.items.map((i) => [i.locationId, i.quantity])));
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Laden mislukt"))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [productId]);

  const total = Object.values(edits).reduce((s, q) => s + (q || 0), 0);
  const dirty = data
    ? data.items.some((i) => (edits[i.locationId] ?? 0) !== i.quantity)
    : false;

  function setQty(locationId: number, value: number) {
    setEdits((prev) => ({ ...prev, [locationId]: Math.max(0, Math.floor(value || 0)) }));
  }

  async function save() {
    if (!data || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      const items = Object.entries(edits).map(([locationId, quantity]) => ({
        locationId: Number(locationId),
        quantity,
      }));
      const res = await setProductStockLocations(productId, items);
      // Refetch to pick up canonical state (e.g. server-side normalization)
      const fresh = await getProductStockLocations(productId);
      setData(fresh);
      setEdits(Object.fromEntries(fresh.items.map((i) => [i.locationId, i.quantity])));
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
      onSaved?.(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Warehouse className="h-4 w-4" />
          Voorraad per locatie
        </CardTitle>
        <a
          href={`${apiUrl}/api/finalized/${productId}/stock.pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <FileText className="h-3.5 w-3.5" /> PDF
        </a>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
            {error}
          </div>
        ) : !data?.items.length ? (
          <p className="text-sm text-muted-foreground py-4">
            Geen actieve locaties. Maak eerst een locatie aan via{" "}
            <a href="/locations" className="underline hover:text-foreground">/locations</a>.
          </p>
        ) : (
          <>
            <div className="space-y-2">
              {data.items.map((loc) => {
                const qty = edits[loc.locationId] ?? 0;
                const changed = qty !== loc.quantity;
                return (
                  <div
                    key={loc.locationId}
                    className={`flex items-center gap-3 rounded-md border p-2 ${changed ? "border-primary/50 bg-primary/5" : ""}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{loc.name}</p>
                      <p className="text-xs text-muted-foreground">
                        <code>{loc.code}</code> · {loc.country}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setQty(loc.locationId, qty - 1)}
                        className="rounded border h-7 w-7 flex items-center justify-center hover:bg-accent"
                        aria-label={`Verlaag ${loc.name}`}
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <input
                        type="number"
                        min={0}
                        value={qty}
                        onChange={(e) => setQty(loc.locationId, parseInt(e.target.value, 10) || 0)}
                        className="w-20 rounded-md border bg-background px-2 py-1 text-right text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setQty(loc.locationId, qty + 1)}
                        className="rounded border h-7 w-7 flex items-center justify-center hover:bg-accent"
                        aria-label={`Verhoog ${loc.name}`}
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex items-center justify-between border-t pt-3">
              <span className="text-sm text-muted-foreground">
                Totaal: <strong className="text-foreground">{total}</strong>
                {dirty && <span className="text-primary ml-2">• niet opgeslagen</span>}
                {savedFlash && <span className="text-emerald-600 ml-2">• opgeslagen</span>}
              </span>
              <Button size="sm" onClick={save} disabled={!dirty || saving} className="gap-1">
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                Opslaan
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Het totaal wordt direct opgeslagen op het product en gebruikt door de storefront en zoekindex.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

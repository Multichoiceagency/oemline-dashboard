"use client";

import { useState, useEffect, useCallback, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowLeft, Search, Plus, Minus, Trash2, Package, Loader2,
  CheckCircle, AlertTriangle, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getFinalized, createManualOrder,
  type FinalizedProduct, type OrderCustomer, type ManualOrderItem,
} from "@/lib/api";

export default function ManualOrderPage() {
  const [query, setQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [results, setResults] = useState<FinalizedProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [items, setItems] = useState<ManualOrderItem[]>([]);
  const [customer, setCustomer] = useState<OrderCustomer>({
    firstName: "", lastName: "", email: "", phone: "",
    address: "", city: "", postcode: "", country: "NL",
  });
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    orderId: number; wcOrderId: number; wcOrderNumber: string;
    wcOrderUrl: string | null; total: number;
  } | null>(null);

  const runSearch = useCallback(async (q: string) => {
    if (!q || q.length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const res = await getFinalized({ q, hasPrice: "true", limit: 20 });
      setResults(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Zoeken mislukt");
    } finally {
      setSearching(false);
    }
  }, []);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => runSearch(query), 350);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  function onSearchSubmit(e: FormEvent) {
    e.preventDefault();
    setQuery(searchInput);
  }

  function addProduct(p: FinalizedProduct) {
    const price = p.priceWithTax ?? p.priceWithMargin ?? p.price;
    if (price == null) return;
    const existing = items.find((i) => i.articleNo === p.articleNo && i.sku === p.sku);
    if (existing) {
      setItems(items.map((i) => i === existing ? { ...i, quantity: i.quantity + 1 } : i));
    } else {
      setItems([
        ...items,
        {
          articleNo: p.articleNo,
          name: p.description || p.articleNo,
          brand: p.brand?.name ?? "",
          price,
          quantity: 1,
          sku: p.sku,
          image: p.imageUrl ?? undefined,
        },
      ]);
    }
  }

  function updateQty(idx: number, qty: number) {
    if (qty < 1) return;
    setItems(items.map((i, k) => k === idx ? { ...i, quantity: qty } : i));
  }

  function updatePrice(idx: number, price: number) {
    setItems(items.map((i, k) => k === idx ? { ...i, price } : i));
  }

  function removeItem(idx: number) {
    setItems(items.filter((_, k) => k !== idx));
  }

  const total = items.reduce((s, i) => s + i.price * i.quantity, 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (items.length === 0) { setError("Voeg minstens 1 product toe."); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await createManualOrder({ customer, items, note: note || undefined });
      setResult({
        orderId: res.orderId,
        wcOrderId: res.wcOrderId,
        wcOrderNumber: res.wcOrderNumber,
        wcOrderUrl: res.wcOrderUrl,
        total: res.total,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Aanmaken mislukt");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="max-w-xl mx-auto">
        <div className="rounded-lg border bg-card p-8 text-center">
          <CheckCircle className="h-16 w-16 mx-auto text-emerald-500 mb-4" />
          <h1 className="text-2xl font-bold mb-2">Bestelling aangemaakt</h1>
          <p className="text-muted-foreground mb-6">
            Order <strong>#{result.wcOrderNumber}</strong> in WooCommerce.
          </p>
          <div className="rounded-md border bg-muted/30 p-4 text-left text-sm space-y-1 mb-6">
            <p><span className="text-muted-foreground">Dashboard #:</span> <span className="font-mono">#{result.orderId}</span></p>
            <p><span className="text-muted-foreground">WC #:</span> <span className="font-mono">#{result.wcOrderId}</span></p>
            <p><span className="text-muted-foreground">Totaal:</span> <strong>€{result.total.toFixed(2)}</strong></p>
          </div>
          <div className="flex justify-center gap-2">
            {result.wcOrderUrl && (
              <a href={result.wcOrderUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                Bekijk in WC <ExternalLink className="h-3 w-3" />
              </a>
            )}
            <Link href="/orders" className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">
              Naar bestellingen
            </Link>
            <button
              onClick={() => {
                setResult(null); setItems([]); setNote(""); setQuery(""); setSearchInput(""); setResults([]);
                setCustomer({ firstName: "", lastName: "", email: "", phone: "", address: "", city: "", postcode: "", country: "NL" });
              }}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Nog een order
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/orders" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2">
          <ArrowLeft className="h-3 w-3" /> Terug naar bestellingen
        </Link>
        <h1 className="text-3xl font-bold">Nieuwe bestelling</h1>
        <p className="text-muted-foreground mt-1">Handmatig een order aanmaken en direct naar WooCommerce pushen.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
        {/* Left: product search + results */}
        <div className="space-y-4">
          <div className="rounded-lg border bg-card p-4">
            <form onSubmit={onSearchSubmit} className="flex gap-2">
              <div className="relative flex-1">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <input
                  type="search"
                  value={searchInput}
                  onChange={(e) => { setSearchInput(e.target.value); setQuery(e.target.value); }}
                  placeholder="Zoeken op artikel, SKU, EAN, merk, omschrijving..."
                  className="w-full pl-10 pr-3 py-2 rounded-md border bg-background text-sm"
                  autoFocus
                />
              </div>
              <Button type="submit" variant="outline" disabled={searching}>
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </form>
          </div>

          <div className="rounded-lg border bg-card divide-y">
            {query.length < 2 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Type minimaal 2 tekens om te zoeken.
              </div>
            ) : results.length === 0 && !searching ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Geen producten gevonden voor &quot;{query}&quot;.
              </div>
            ) : (
              results.map((p) => {
                const price = p.priceWithTax ?? p.priceWithMargin ?? p.price;
                return (
                  <div key={p.id} className="flex gap-3 p-3 hover:bg-accent/30 transition">
                    <div className="h-14 w-14 shrink-0 rounded bg-muted flex items-center justify-center overflow-hidden">
                      {p.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.imageUrl} alt={p.articleNo} className="h-full w-full object-cover" />
                      ) : <Package className="h-6 w-6 text-muted-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono truncate">{p.articleNo}</p>
                      <p className="text-sm font-medium line-clamp-2">{p.description || p.articleNo}</p>
                      <p className="text-xs text-muted-foreground">{p.brand?.name}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <p className="font-bold text-sm">{price != null ? `€${price.toFixed(2)}` : "—"}</p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1"
                        disabled={price == null}
                        onClick={() => addProduct(p)}
                      >
                        <Plus className="h-3 w-3" /> Toevoegen
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right: current order + customer form */}
        <form onSubmit={submit} className="space-y-4">
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <h3 className="font-semibold text-sm">Producten ({items.length})</h3>
            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground">Voeg producten toe via de zoeker.</p>
            ) : (
              <div className="space-y-2">
                {items.map((item, idx) => (
                  <div key={idx} className="flex gap-2 text-sm">
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-xs truncate">{item.articleNo}</p>
                      <p className="line-clamp-1 text-xs">{item.name}</p>
                      <div className="flex items-center gap-1 mt-1">
                        <button type="button" onClick={() => updateQty(idx, item.quantity - 1)} className="rounded border h-6 w-6 flex items-center justify-center hover:bg-accent">
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="w-8 text-center text-xs">{item.quantity}</span>
                        <button type="button" onClick={() => updateQty(idx, item.quantity + 1)} className="rounded border h-6 w-6 flex items-center justify-center hover:bg-accent">
                          <Plus className="h-3 w-3" />
                        </button>
                        <input
                          type="number" min={0} step={0.01}
                          value={item.price}
                          onChange={(e) => updatePrice(idx, parseFloat(e.target.value) || 0)}
                          className="ml-2 w-20 rounded border bg-background px-1 text-xs text-right"
                        />
                        <span className="text-xs">€</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end">
                      <p className="font-bold text-sm">€{(item.price * item.quantity).toFixed(2)}</p>
                      <button type="button" onClick={() => removeItem(idx)} className="text-destructive hover:underline text-xs">
                        <Trash2 className="h-3 w-3 inline" />
                      </button>
                    </div>
                  </div>
                ))}
                <div className="border-t pt-2 flex justify-between font-bold">
                  <span>Totaal</span>
                  <span>€{total.toFixed(2)}</span>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg border bg-card p-4 space-y-3">
            <h3 className="font-semibold text-sm">Klantgegevens</h3>
            <div className="grid grid-cols-2 gap-2">
              <Input label="Voornaam *" value={customer.firstName} onChange={(v) => setCustomer({ ...customer, firstName: v })} required />
              <Input label="Achternaam *" value={customer.lastName} onChange={(v) => setCustomer({ ...customer, lastName: v })} required />
            </div>
            <Input label="Email *" type="email" value={customer.email} onChange={(v) => setCustomer({ ...customer, email: v })} required />
            <Input label="Telefoon" type="tel" value={customer.phone ?? ""} onChange={(v) => setCustomer({ ...customer, phone: v })} />
            <Input label="Adres *" value={customer.address} onChange={(v) => setCustomer({ ...customer, address: v })} required />
            <div className="grid grid-cols-2 gap-2">
              <Input label="Postcode *" value={customer.postcode} onChange={(v) => setCustomer({ ...customer, postcode: v })} required />
              <Input label="Plaats *" value={customer.city} onChange={(v) => setCustomer({ ...customer, city: v })} required />
            </div>
            <div>
              <label className="text-xs font-medium">Land</label>
              <select value={customer.country} onChange={(e) => setCustomer({ ...customer, country: e.target.value })} className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="NL">Nederland</option>
                <option value="BE">België</option>
                <option value="DE">Duitsland</option>
                <option value="FR">Frankrijk</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium">Opmerking</label>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="Optioneel" />
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          <Button type="submit" disabled={submitting || items.length === 0} className="w-full gap-2">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? "Aanmaken..." : `Plaats bestelling (€${total.toFixed(2)})`}
          </Button>
        </form>
      </div>
    </div>
  );
}

function Input({
  label, value, onChange, type = "text", required,
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="text-xs font-medium">{label}</label>
      <input
        type={type} value={value} required={required}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
      />
    </div>
  );
}

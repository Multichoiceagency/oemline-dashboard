"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ShoppingCart, Minus, Plus, Trash2, Package, Loader2,
  CheckCircle, AlertTriangle, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCart } from "@/lib/cart";
import { checkoutOrder, type OrderCustomer } from "@/lib/api";

export default function CartPage() {
  const { cart, itemCount, total, loading, updateQty, remove, clear, refresh } = useCart();
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    wcOrderId: number; wcOrderNumber: string; wcOrderUrl: string | null; total: number; orderId: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<OrderCustomer & { note: string }>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    postcode: "",
    country: "NL",
    note: "",
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!cart) return;
    setSubmitting(true);
    setError(null);
    try {
      const { note, ...customer } = form;
      const res = await checkoutOrder({ cartKey: cart.key, customer, note: note || undefined });
      setResult({
        wcOrderId: res.wcOrderId,
        wcOrderNumber: res.wcOrderNumber,
        wcOrderUrl: res.wcOrderUrl,
        total: res.total,
        orderId: res.orderId,
      });
      await refresh(); // cart was deleted server-side
      setCheckoutOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout mislukt");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="max-w-xl mx-auto">
        <div className="rounded-lg border bg-card p-8 text-center">
          <CheckCircle className="h-16 w-16 mx-auto text-emerald-500 mb-4" />
          <h1 className="text-2xl font-bold mb-2">Bestelling geplaatst!</h1>
          <p className="text-muted-foreground mb-6">
            Order <strong>#{result.wcOrderNumber}</strong> aangemaakt in WooCommerce.
          </p>
          <div className="rounded-md border bg-muted/30 p-4 text-left text-sm space-y-1 mb-6">
            <p><span className="text-muted-foreground">Dashboard order-id:</span> <span className="font-mono">#{result.orderId}</span></p>
            <p><span className="text-muted-foreground">WooCommerce ID:</span> <span className="font-mono">#{result.wcOrderId}</span></p>
            <p><span className="text-muted-foreground">Totaal:</span> <strong>€{result.total.toFixed(2)}</strong></p>
          </div>
          <div className="flex justify-center gap-2">
            {result.wcOrderUrl && (
              <a href={result.wcOrderUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                Bekijk in WooCommerce <ExternalLink className="h-3 w-3" />
              </a>
            )}
            <Link href="/orders" className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">
              Alle bestellingen
            </Link>
            <Link href="/kenteken" className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">
              Nieuwe bestelling
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Winkelwagen</h1>
          <p className="text-muted-foreground mt-1">
            {itemCount === 0 ? "Leeg — voeg producten toe via Kenteken zoeker of Eindproducten." : `${itemCount} ${itemCount === 1 ? "product" : "producten"}`}
          </p>
        </div>
        {cart && itemCount > 0 && (
          <Button variant="ghost" onClick={() => clear()} disabled={loading} className="gap-2 text-destructive hover:text-destructive">
            <Trash2 className="h-4 w-4" /> Leegmaken
          </Button>
        )}
      </div>

      {!cart || cart.items.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <ShoppingCart className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground mb-4">Je winkelwagen is leeg.</p>
          <div className="flex justify-center gap-2">
            <Link href="/kenteken" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Ga naar Kenteken zoeker
            </Link>
            <Link href="/finalized" className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">
              Bekijk Eindproducten
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-3">
            {cart.items.map((item) => (
              <div key={item.id} className="flex gap-4 rounded-lg border bg-card p-4">
                <div className="h-20 w-20 shrink-0 rounded bg-muted flex items-center justify-center overflow-hidden">
                  {item.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.image} alt={item.articleNo} className="h-full w-full object-cover" />
                  ) : (
                    <Package className="h-8 w-8 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono text-muted-foreground truncate">{item.articleNo}</p>
                  <p className="font-medium line-clamp-2">{item.name}</p>
                  {item.brand && <p className="text-xs text-muted-foreground mt-0.5">{item.brand}</p>}
                </div>
                <div className="flex flex-col items-end justify-between gap-2">
                  <p className="font-bold">€{(item.price * item.quantity).toFixed(2)}</p>
                  <div className="flex items-center gap-1">
                    <Button size="icon" variant="outline" className="h-7 w-7" disabled={loading || item.quantity <= 1} onClick={() => updateQty(item.id, item.quantity - 1)}>
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                    <Button size="icon" variant="outline" className="h-7 w-7" disabled={loading} onClick={() => updateQty(item.id, item.quantity + 1)}>
                      <Plus className="h-3 w-3" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" disabled={loading} onClick={() => remove(item.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-lg border bg-card p-6 space-y-4 h-fit">
            <h2 className="font-semibold">Overzicht</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotaal ({itemCount} items)</span>
                <span>€{total.toFixed(2)}</span>
              </div>
              <div className="border-t pt-2 flex justify-between text-base font-bold">
                <span>Totaal</span>
                <span>€{total.toFixed(2)}</span>
              </div>
            </div>
            {!checkoutOpen ? (
              <Button className="w-full gap-2" onClick={() => setCheckoutOpen(true)}>
                Bestelling plaatsen
              </Button>
            ) : (
              <form onSubmit={submit} className="space-y-3 border-t pt-4">
                <h3 className="font-semibold text-sm">Klantgegevens</h3>
                <div className="grid grid-cols-2 gap-2">
                  <LabelInput label="Voornaam *" value={form.firstName} onChange={(v) => setForm({ ...form, firstName: v })} required />
                  <LabelInput label="Achternaam *" value={form.lastName} onChange={(v) => setForm({ ...form, lastName: v })} required />
                </div>
                <LabelInput label="Email *" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} required />
                <LabelInput label="Telefoon" type="tel" value={form.phone ?? ""} onChange={(v) => setForm({ ...form, phone: v })} />
                <LabelInput label="Straat + huisnummer *" value={form.address} onChange={(v) => setForm({ ...form, address: v })} required />
                <div className="grid grid-cols-2 gap-2">
                  <LabelInput label="Postcode *" value={form.postcode} onChange={(v) => setForm({ ...form, postcode: v })} required />
                  <LabelInput label="Plaats *" value={form.city} onChange={(v) => setForm({ ...form, city: v })} required />
                </div>
                <div>
                  <label className="text-xs font-medium">Land</label>
                  <select value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm">
                    <option value="NL">Nederland</option>
                    <option value="BE">België</option>
                    <option value="DE">Duitsland</option>
                    <option value="FR">Frankrijk</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium">Opmerking</label>
                  <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="Optioneel" />
                </div>
                {error && (
                  <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    {error}
                  </div>
                )}
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" onClick={() => setCheckoutOpen(false)} disabled={submitting} className="flex-1">
                    Annuleren
                  </Button>
                  <Button type="submit" disabled={submitting} className="flex-1 gap-2">
                    {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
                    Plaats bestelling
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function LabelInput({
  label, value, onChange, type = "text", required,
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="text-xs font-medium">{label}</label>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
      />
    </div>
  );
}

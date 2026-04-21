"use client";

import { ShoppingCart, Minus, Plus, Trash2, Package, Loader2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useCart } from "@/lib/cart";

export default function CartPage() {
  const { cart, itemCount, total, loading, updateQty, remove, clear } = useCart();

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
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
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
                    <Button
                      size="icon" variant="outline" className="h-7 w-7"
                      disabled={loading || item.quantity <= 1}
                      onClick={() => updateQty(item.id, item.quantity - 1)}
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                    <Button
                      size="icon" variant="outline" className="h-7 w-7"
                      disabled={loading}
                      onClick={() => updateQty(item.id, item.quantity + 1)}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                    <Button
                      size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                      disabled={loading}
                      onClick={() => remove(item.id)}
                    >
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
            <Button className="w-full gap-2" disabled title="WooCommerce-koppeling komt in Fase 2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Bestelling plaatsen"}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              WooCommerce-integratie nog niet geconfigureerd. Voeg `WC_URL`, `WC_CONSUMER_KEY`, `WC_CONSUMER_SECRET` toe aan de API-env om live te gaan.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Package, RefreshCw, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getOrder, retryOrder, type Order } from "@/lib/api";

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setOrder(await getOrder(parseInt(id, 10)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleRetry() {
    if (!order) return;
    setRetrying(true);
    try {
      await retryOrder(order.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retry mislukt");
    } finally {
      setRetrying(false);
    }
  }

  if (loading && !order) return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!order) return <div className="text-muted-foreground">Order niet gevonden.</div>;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/orders" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2">
            <ArrowLeft className="h-3 w-3" /> Terug
          </Link>
          <h1 className="text-3xl font-bold">Order #{order.id}</h1>
          <p className="text-muted-foreground mt-1">
            Aangemaakt {new Date(order.createdAt).toLocaleString("nl-NL")}
          </p>
        </div>
        <div className="flex gap-2">
          {order.wcOrderUrl && (
            <a href={order.wcOrderUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent">
              WC #{order.wcOrderId} <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {order.status === "failed" && (
            <Button onClick={handleRetry} disabled={retrying} className="gap-2">
              {retrying ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Opnieuw proberen
            </Button>
          )}
        </div>
      </div>

      {order.errorMessage && (
        <div className="flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div><strong>Error:</strong> {order.errorMessage}</div>
        </div>
      )}
      {error && <div className="text-sm text-destructive">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg border bg-card p-4">
          <h3 className="font-semibold mb-3">Klant</h3>
          <dl className="space-y-1 text-sm">
            <Row label="Naam" value={order.customerName} />
            <Row label="Email" value={order.customerEmail} />
            {order.customerPhone && <Row label="Telefoon" value={order.customerPhone} />}
          </dl>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <h3 className="font-semibold mb-3">Bezorgadres</h3>
          <dl className="space-y-1 text-sm">
            <Row label="Adres" value={order.shipping.street} />
            <Row label="Plaats" value={`${order.shipping.postcode} ${order.shipping.city}`} />
            <Row label="Land" value={order.shipping.country} />
          </dl>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h3 className="font-semibold mb-3">Producten</h3>
        <div className="space-y-2">
          {order.items.map((item) => (
            <div key={item.id} className="flex gap-3 border-t pt-2 first:border-0 first:pt-0">
              <div className="h-14 w-14 shrink-0 rounded bg-muted flex items-center justify-center overflow-hidden">
                {item.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.image} alt={item.articleNo} className="h-full w-full object-cover" />
                ) : (
                  <Package className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono text-muted-foreground">{item.articleNo}</p>
                <p className="font-medium line-clamp-1">{item.name}</p>
                <p className="text-xs text-muted-foreground">{item.brand} · {item.quantity}×</p>
              </div>
              <div className="text-right">
                <p className="font-bold">€{(item.price * item.quantity).toFixed(2)}</p>
                <p className="text-xs text-muted-foreground">€{item.price.toFixed(2)} p/st</p>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t mt-3 pt-3 flex justify-between font-bold">
          <span>Totaal</span>
          <span>€{order.total.toFixed(2)}</span>
        </div>
      </div>

      {order.note && (
        <div className="rounded-lg border bg-card p-4">
          <h3 className="font-semibold mb-2">Opmerking</h3>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{order.note}</p>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="text-muted-foreground w-24 shrink-0">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

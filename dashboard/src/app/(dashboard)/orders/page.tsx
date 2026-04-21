"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Package, RefreshCw, ExternalLink, AlertTriangle, CheckCircle2,
  Clock, XCircle, Loader2, Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getOrders, retryOrder, type Order } from "@/lib/api";
import { cn } from "@/lib/utils";

const STATUS_META: Record<Order["status"], { label: string; color: string; icon: typeof CheckCircle2 }> = {
  pending:    { label: "In afwachting", color: "text-slate-500 bg-slate-500/10", icon: Clock },
  processing: { label: "In behandeling", color: "text-blue-500 bg-blue-500/10", icon: Loader2 },
  completed:  { label: "Voltooid", color: "text-emerald-500 bg-emerald-500/10", icon: CheckCircle2 },
  cancelled:  { label: "Geannuleerd", color: "text-slate-400 bg-slate-400/10", icon: XCircle },
  failed:     { label: "Mislukt", color: "text-red-500 bg-red-500/10", icon: AlertTriangle },
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("");
  const [retryingId, setRetryingId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await getOrders({ status: filter || undefined, limit: 100 });
      setOrders(res.items);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function handleRetry(id: number) {
    setRetryingId(id);
    try {
      await retryOrder(id);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Retry mislukt");
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">Bestellingen</h1>
          <p className="text-muted-foreground mt-1">Alle orders die via het dashboard zijn aangemaakt en naar WooCommerce gepusht.</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/orders/new"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> Nieuwe bestelling
          </Link>
          <Button variant="outline" onClick={load} disabled={loading} className="gap-2">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Ververs
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["", "pending", "processing", "completed", "failed", "cancelled"] as const).map((s) => (
          <button
            key={s || "all"}
            type="button"
            onClick={() => setFilter(s)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm transition",
              filter === s ? "border-primary bg-primary/10" : "hover:bg-accent"
            )}
          >
            {s === "" ? "Alle" : STATUS_META[s].label}
          </button>
        ))}
      </div>

      {loading && orders.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">Geen bestellingen{filter ? ` met status "${STATUS_META[filter as Order["status"]]?.label}"` : ""}.</p>
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="px-4 py-3 font-medium">#</th>
                <th className="px-4 py-3 font-medium">WC</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Klant</th>
                <th className="px-4 py-3 font-medium">Items</th>
                <th className="px-4 py-3 font-medium text-right">Totaal</th>
                <th className="px-4 py-3 font-medium">Datum</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const meta = STATUS_META[o.status];
                const Icon = meta.icon;
                return (
                  <tr key={o.id} className="border-t">
                    <td className="px-4 py-3 font-mono text-xs">#{o.id}</td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {o.wcOrderId ? `#${o.wcOrderId}` : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium", meta.color)}>
                        <Icon className={cn("h-3 w-3", o.status === "processing" && "animate-spin")} />
                        {meta.label}
                      </span>
                      {o.errorMessage && (
                        <p className="text-xs text-destructive mt-1 max-w-[240px] truncate" title={o.errorMessage}>
                          {o.errorMessage}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{o.customerName}</p>
                      <p className="text-xs text-muted-foreground truncate max-w-[200px]">{o.customerEmail}</p>
                    </td>
                    <td className="px-4 py-3 text-xs">{o.items.length}</td>
                    <td className="px-4 py-3 text-right font-bold">€{o.total.toFixed(2)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(o.createdAt).toLocaleString("nl-NL", { dateStyle: "short", timeStyle: "short" })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {o.wcOrderUrl && (
                          <a href={o.wcOrderUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent" title="Open in WooCommerce">
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        {o.status === "failed" && (
                          <Button
                            size="sm" variant="outline" className="h-7 gap-1"
                            disabled={retryingId === o.id}
                            onClick={() => handleRetry(o.id)}
                          >
                            {retryingId === o.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                            Opnieuw
                          </Button>
                        )}
                        <Link href={`/orders/${o.id}`} className="rounded-md border px-2 py-1 text-xs hover:bg-accent">
                          Details
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

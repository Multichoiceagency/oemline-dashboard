"use client";

import { useEffect, useMemo, useState } from "react";
import { getStockAnalytics, type StockAnalytics } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  BarChart3, Package, Boxes, Coins, TrendingUp, Warehouse, Tag, FolderTree,
  Loader2, AlertTriangle, X,
} from "lucide-react";
import Link from "next/link";

type ScopeMode = "all" | "year" | "quarter" | "month";

const MONTHS_NL = [
  "Januari", "Februari", "Maart", "April", "Mei", "Juni",
  "Juli", "Augustus", "September", "Oktober", "November", "December",
];

function formatEuro(v: number): string {
  return `€ ${v.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatInt(v: number): string {
  return v.toLocaleString("nl-NL");
}

export default function AnalysesPage() {
  const now = new Date();
  const [scope, setScope] = useState<ScopeMode>("all");
  const [year, setYear] = useState<number>(now.getUTCFullYear());
  const [quarter, setQuarter] = useState<number>(Math.floor(now.getUTCMonth() / 3) + 1);
  const [month, setMonth] = useState<number>(now.getUTCMonth() + 1);

  const [data, setData] = useState<StockAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Years offered in the picker — last 5 years + current
  const yearOptions = useMemo(() => {
    const y = now.getUTCFullYear();
    return [y - 4, y - 3, y - 2, y - 1, y];
  }, [now]);

  useEffect(() => {
    const params: { year?: number; quarter?: number; month?: number } = {};
    if (scope === "year") params.year = year;
    else if (scope === "quarter") { params.year = year; params.quarter = quarter; }
    else if (scope === "month")  { params.year = year; params.month = month; }

    let cancelled = false;
    setLoading(true);
    setError(null);
    getStockAnalytics(params)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Laden mislukt"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope, year, quarter, month]);

  const scopeLabel =
    scope === "all" ? "Alle tijd" :
    scope === "year" ? `Jaar ${year}` :
    scope === "quarter" ? `Q${quarter} ${year}` :
    `${MONTHS_NL[month - 1]} ${year}`;

  return (
    <div className="space-y-6 w-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Voorraadanalyses</h2>
          <p className="text-muted-foreground text-sm">
            Inkoopwaarde en verdeling per merk, categorie en locatie. Filter per jaar, kwartaal of maand op basis van wanneer producten voor het laatst zijn bijgewerkt.
          </p>
        </div>
        <Link href="/voorraad" className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm hover:bg-accent self-start">
          <Boxes className="h-4 w-4" /> Naar voorraadbeheer
        </Link>
      </div>

      {/* Period filter */}
      <Card>
        <CardContent className="pt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground mr-2">Periode:</span>
          <div className="inline-flex rounded-md border overflow-hidden">
            {(["all", "year", "quarter", "month"] as ScopeMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setScope(m)}
                className={`px-3 py-1.5 text-sm border-r last:border-r-0 transition ${
                  scope === m ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                }`}
              >
                {m === "all" ? "Alle tijd" : m === "year" ? "Jaar" : m === "quarter" ? "Kwartaal" : "Maand"}
              </button>
            ))}
          </div>

          {scope !== "all" && (
            <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v, 10))}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {scope === "quarter" && (
            <div className="inline-flex rounded-md border overflow-hidden">
              {[1, 2, 3, 4].map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setQuarter(q)}
                  className={`px-3 py-1.5 text-sm border-r last:border-r-0 transition ${
                    quarter === q ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                  }`}
                >
                  Q{q}
                </button>
              ))}
            </div>
          )}

          {scope === "month" && (
            <Select value={String(month)} onValueChange={(v) => setMonth(parseInt(v, 10))}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS_NL.map((m, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {scope !== "all" && (
            <Button variant="ghost" size="sm" onClick={() => setScope("all")} className="text-xs gap-1">
              <X className="h-3 w-3" /> wissen
            </Button>
          )}

          <Badge variant="outline" className="ml-auto">{scopeLabel}</Badge>
        </CardContent>
      </Card>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !data ? null : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi
              icon={Package}
              label="Producten met voorraad"
              value={formatInt(data.totals.productsWithStock)}
              hint={`van ${formatInt(data.totals.productCount)} actief`}
            />
            <Kpi
              icon={Boxes}
              label="Stuks op voorraad"
              value={formatInt(data.totals.totalUnits)}
              hint="totaal in alle locaties"
            />
            <Kpi
              icon={Coins}
              label="Totale inkoopwaarde"
              value={formatEuro(data.totals.totalValue)}
              hint="prijs × voorraad (basisprijs)"
              accent
            />
            <Kpi
              icon={TrendingUp}
              label="Gemiddelde basisprijs"
              value={formatEuro(data.totals.avgPrice)}
              hint="over producten met prijs"
            />
          </div>

          {/* 12-month history */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-4 w-4" /> Activiteit afgelopen 12 maanden
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Inkoopwaarde van producten die in die maand zijn bijgewerkt — proxy voor "wat er bewogen heeft".
              </p>
            </CardHeader>
            <CardContent>
              <HistoryChart history={data.monthlyHistory} />
            </CardContent>
          </Card>

          {/* Per location */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Warehouse className="h-4 w-4" /> Per locatie
                <Badge variant="outline" className="font-normal">{data.perLocation.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.perLocation.length === 0 ? (
                <p className="text-sm text-muted-foreground">Geen actieve locaties.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Locatie</TableHead>
                      <TableHead>Land</TableHead>
                      <TableHead className="text-right">Producten</TableHead>
                      <TableHead className="text-right">Stuks</TableHead>
                      <TableHead className="text-right">Inkoopwaarde</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.perLocation.map((loc) => (
                      <TableRow key={loc.locationId}>
                        <TableCell className="font-medium">
                          {loc.name}
                          <code className="ml-2 text-xs text-muted-foreground">{loc.code}</code>
                        </TableCell>
                        <TableCell><Badge variant="outline">{loc.country}</Badge></TableCell>
                        <TableCell className="text-right tabular-nums">{formatInt(loc.productCount)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatInt(loc.totalUnits)}</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">{formatEuro(loc.totalValue)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Per brand + per category — side by side on lg */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Tag className="h-4 w-4" /> Top 20 merken
                </CardTitle>
              </CardHeader>
              <CardContent>
                <BreakdownTable
                  rows={data.perBrand.map((r) => ({
                    name: r.name,
                    products: r.productCount,
                    units: r.stockUnits,
                    value: r.stockValue,
                  }))}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <FolderTree className="h-4 w-4" /> Top 20 categorieën
                </CardTitle>
              </CardHeader>
              <CardContent>
                <BreakdownTable
                  rows={data.perCategory.map((r) => ({
                    name: r.name,
                    products: r.productCount,
                    units: r.stockUnits,
                    value: r.stockValue,
                  }))}
                />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({
  icon: Icon, label, value, hint, accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <Card className={accent ? "border-primary/40" : ""}>
      <CardContent className="pt-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          <Icon className="h-3.5 w-3.5" /> {label}
        </div>
        <p className={`text-2xl font-bold tabular-nums ${accent ? "text-primary" : ""}`}>{value}</p>
        {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function HistoryChart({ history }: { history: StockAnalytics["monthlyHistory"] }) {
  const max = Math.max(1, ...history.map((h) => h.stockValue));
  return (
    <div className="grid grid-cols-12 gap-1 h-40 items-end">
      {history.map((h) => {
        const pct = (h.stockValue / max) * 100;
        return (
          <div key={h.month} className="flex flex-col items-center justify-end gap-1 h-full" title={`${h.month} — ${formatEuro(h.stockValue)} (${formatInt(h.productCount)} prod.)`}>
            <div
              className="w-full rounded-t bg-primary/70 hover:bg-primary transition-colors"
              style={{ height: `${pct}%`, minHeight: h.stockValue > 0 ? 4 : 0 }}
            />
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {h.month.slice(5)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function BreakdownTable({
  rows,
}: {
  rows: Array<{ name: string; products: number; units: number; value: number }>;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">Geen data voor deze periode.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Naam</TableHead>
          <TableHead className="text-right">Prod.</TableHead>
          <TableHead className="text-right">Stuks</TableHead>
          <TableHead className="text-right">Waarde</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.name}>
            <TableCell className="font-medium">{r.name}</TableCell>
            <TableCell className="text-right text-sm tabular-nums">{formatInt(r.products)}</TableCell>
            <TableCell className="text-right text-sm tabular-nums">{formatInt(r.units)}</TableCell>
            <TableCell className="text-right text-sm tabular-nums font-semibold">{formatEuro(r.value)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

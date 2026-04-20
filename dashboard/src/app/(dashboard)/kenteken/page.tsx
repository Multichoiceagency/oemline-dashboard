"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Car, Search, AlertTriangle, Fuel, Calendar, Gauge, Weight, Tag, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { lookupKenteken, type KentekenResponse } from "@/lib/api";

function formatPlate(raw: string): string {
  // Rough NL plate display: group in chunks of 2-3 using typical patterns.
  // Good enough for display; user input is normalized server-side anyway.
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.length === 6) {
    return `${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}`;
  }
  return s;
}

export default function KentekenPage() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<KentekenResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const plate = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (plate.length < 4) {
      setError("Voer een geldig kenteken in (min. 4 tekens).");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await lookupKenteken(plate);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lookup mislukt");
    } finally {
      setLoading(false);
    }
  }

  const brandSearchUrl = result?.brandMatch
    ? `/finalized?brand=${encodeURIComponent(result.brandMatch.code)}`
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Kenteken zoeker</h1>
        <p className="text-muted-foreground mt-1">
          Voer een Nederlands kenteken in om voertuig-gegevens uit RDW op te halen en matching producten te vinden.
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="bv. XX-123-Y"
            maxLength={10}
            className="w-full rounded-md border bg-background px-4 py-3 text-lg font-mono uppercase tracking-wider"
            aria-label="Kenteken"
            autoFocus
          />
        </div>
        <Button type="submit" disabled={loading} className="gap-2">
          <Search className="h-4 w-4" />
          {loading ? "Zoeken..." : "Zoeken"}
        </Button>
      </form>

      {error && (
        <div className="flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="rounded-lg border bg-card p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-16 items-center justify-center rounded-md bg-yellow-400 text-black font-mono font-bold text-xl px-4 border-2 border-black">
                {formatPlate(result.plate)}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-2xl font-bold">
                  {result.vehicle.merk} {result.vehicle.handelsbenaming}
                </h2>
                <p className="text-muted-foreground text-sm mt-1">
                  {result.vehicle.voertuigsoort}
                  {result.vehicle.inrichting ? ` · ${result.vehicle.inrichting}` : ""}
                  {result.vehicle.variant ? ` · ${result.vehicle.variant}` : ""}
                </p>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Spec icon={Calendar} label="Eerste toelating" value={result.vehicle.year?.toString() ?? "—"} />
              <Spec
                icon={Gauge}
                label="Cilinderinhoud"
                value={result.vehicle.cilinderinhoud ? `${result.vehicle.cilinderinhoud} cc` : "—"}
              />
              <Spec
                icon={Fuel}
                label="Brandstof"
                value={result.fuel?.brandstof ?? "—"}
              />
              <Spec
                icon={Weight}
                label="Massa"
                value={result.vehicle.massa ? `${result.vehicle.massa} kg` : "—"}
              />
              <Spec
                icon={Tag}
                label="Categorie"
                value={result.vehicle.europeseCategorie ?? "—"}
              />
              <Spec
                icon={Gauge}
                label="Vermogen"
                value={result.fuel?.nettoVermogen ? `${result.fuel.nettoVermogen} kW` : "—"}
              />
              <Spec
                icon={Fuel}
                label="CO₂ (gecomb.)"
                value={result.fuel?.co2 != null ? `${result.fuel.co2} g/km` : "—"}
              />
              <Spec icon={Tag} label="Euroklasse" value={result.fuel?.euroklasse ?? "—"} />
            </div>
          </div>

          <div className="rounded-lg border bg-card p-6">
            <div className="flex items-center gap-3 mb-4">
              <Car className="h-5 w-5 text-muted-foreground" />
              <h3 className="font-semibold">Producten voor dit voertuig</h3>
            </div>

            {result.brandMatch ? (
              <div className="space-y-3">
                <p className="text-sm">
                  Merk <strong>{result.brandMatch.name}</strong> gevonden in de catalogus
                  {result.brandMatch.tecdocId ? ` (TecDoc ID ${result.brandMatch.tecdocId})` : ""}.
                </p>
                <div className="flex flex-wrap gap-2">
                  {brandSearchUrl && (
                    <Link
                      href={brandSearchUrl}
                      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      Alle {result.brandMatch.name} producten
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}
                  <Link
                    href={`/finalized?q=${encodeURIComponent(result.vehicle.handelsbenaming)}&brand=${encodeURIComponent(result.brandMatch.code)}`}
                    className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
                  >
                    Zoek op {result.vehicle.handelsbenaming}
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Merk <strong>{result.vehicle.merk}</strong> staat niet (of niet onder deze naam) in de
                catalogus. Synchroniseer het merk via TecDoc of zoek handmatig via de{" "}
                <Link href="/finalized" className="underline">
                  finalized pagina
                </Link>
                .
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Spec({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium truncate">{value}</p>
      </div>
    </div>
  );
}

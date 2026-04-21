"use client";

import { useState, useCallback, type FormEvent } from "react";
import Link from "next/link";
import {
  Car, Search, AlertTriangle, Fuel, Calendar, Gauge, Weight, Tag,
  FolderTree, ShoppingCart, Plus, Loader2, Package, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  lookupKenteken, getCategories, getFinalized,
  type KentekenResponse, type Category, type FinalizedProduct,
} from "@/lib/api";
import { useCart } from "@/lib/cart";
import { cn } from "@/lib/utils";

function formatPlate(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.length === 6) return `${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}`;
  return s;
}

export default function KentekenPage() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [vehicle, setVehicle] = useState<KentekenResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [catsLoading, setCatsLoading] = useState(false);
  const [selectedCat, setSelectedCat] = useState<Category | null>(null);

  const [products, setProducts] = useState<FinalizedProduct[]>([]);
  const [prodLoading, setProdLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const { add: addCart, itemCount, loading: cartLoading } = useCart();
  const [addedId, setAddedId] = useState<number | null>(null);

  const loadCategories = useCallback(async () => {
    setCatsLoading(true);
    try {
      const res = await getCategories({ hideEmpty: "true", limit: 80 });
      setCategories(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Categorieën laden mislukt");
    } finally {
      setCatsLoading(false);
    }
  }, []);

  const loadProducts = useCallback(
    async (cat: Category | null, q: string) => {
      if (!vehicle?.brandMatch) return;
      setProdLoading(true);
      try {
        const res = await getFinalized({
          brand: vehicle.brandMatch.code,
          category: cat?.code,
          q: q || undefined,
          hasPrice: "true",
          limit: 30,
        });
        setProducts(res.items);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Producten laden mislukt");
      } finally {
        setProdLoading(false);
      }
    },
    [vehicle?.brandMatch]
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const plate = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (plate.length < 4) { setError("Voer een geldig kenteken in."); return; }
    setLoading(true);
    setError(null);
    setVehicle(null);
    setCategories([]);
    setSelectedCat(null);
    setProducts([]);
    try {
      const data = await lookupKenteken(plate);
      setVehicle(data);
      if (data.brandMatch) {
        await loadCategories();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup mislukt");
    } finally {
      setLoading(false);
    }
  }

  async function handleCategoryPick(cat: Category | null) {
    setSelectedCat(cat);
    await loadProducts(cat, searchQuery);
  }

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    await loadProducts(selectedCat, searchQuery);
  }

  async function handleAddToCart(p: FinalizedProduct) {
    const price = p.priceWithTax ?? p.priceWithMargin ?? p.price ?? 0;
    if (!price) return;
    try {
      await addCart({
        articleNo: p.articleNo,
        name: p.description || p.articleNo,
        brand: p.brand?.name ?? "",
        price,
        image: p.imageUrl ?? undefined,
        sku: p.sku,
      });
      setAddedId(p.id);
      setTimeout(() => setAddedId((cur) => (cur === p.id ? null : cur)), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Toevoegen mislukt");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Kenteken zoeker</h1>
          <p className="text-muted-foreground mt-1">
            Voer een Nederlands kenteken in om voertuig-gegevens uit RDW op te halen en matching producten te vinden.
          </p>
        </div>
        <Link
          href="/cart"
          className="relative inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm hover:bg-accent"
        >
          <ShoppingCart className="h-4 w-4" />
          Winkelwagen
          {itemCount > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
              {itemCount}
            </span>
          )}
        </Link>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="bv. XX-123-Y"
          maxLength={10}
          className="flex-1 max-w-md rounded-md border bg-background px-4 py-3 text-lg font-mono uppercase tracking-wider"
          aria-label="Kenteken"
          autoFocus
        />
        <Button type="submit" disabled={loading} className="gap-2">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {loading ? "Zoeken..." : "Zoeken"}
        </Button>
      </form>

      {error && (
        <div className="flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {vehicle && (
        <div className="space-y-6">
          {/* Vehicle card */}
          <div className="rounded-lg border bg-card p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-16 items-center justify-center rounded-md bg-yellow-400 text-black font-mono font-bold text-xl px-4 border-2 border-black">
                {formatPlate(vehicle.plate)}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-2xl font-bold">
                  {vehicle.vehicle.merk} {vehicle.vehicle.handelsbenaming}
                </h2>
                <p className="text-muted-foreground text-sm mt-1">
                  {vehicle.vehicle.voertuigsoort}
                  {vehicle.vehicle.inrichting ? ` · ${vehicle.vehicle.inrichting}` : ""}
                  {vehicle.vehicle.variant ? ` · ${vehicle.vehicle.variant}` : ""}
                </p>
              </div>
            </div>
            <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Spec icon={Calendar} label="Eerste toelating" value={vehicle.vehicle.year?.toString() ?? "—"} />
              <Spec icon={Gauge} label="Cilinderinhoud" value={vehicle.vehicle.cilinderinhoud ? `${vehicle.vehicle.cilinderinhoud} cc` : "—"} />
              <Spec icon={Fuel} label="Brandstof" value={vehicle.fuel?.brandstof ?? "—"} />
              <Spec icon={Weight} label="Massa" value={vehicle.vehicle.massa ? `${vehicle.vehicle.massa} kg` : "—"} />
              <Spec icon={Tag} label="Categorie" value={vehicle.vehicle.europeseCategorie ?? "—"} />
              <Spec icon={Gauge} label="Vermogen" value={vehicle.fuel?.nettoVermogen ? `${vehicle.fuel.nettoVermogen} kW` : "—"} />
              <Spec icon={Fuel} label="CO₂" value={vehicle.fuel?.co2 != null ? `${vehicle.fuel.co2} g/km` : "—"} />
              <Spec icon={Tag} label="Euroklasse" value={vehicle.fuel?.euroklasse ?? "—"} />
            </div>
          </div>

          {vehicle.brandMatch ? (
            <>
              {/* Categories */}
              <div className="rounded-lg border bg-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <FolderTree className="h-5 w-5 text-muted-foreground" />
                    <h3 className="font-semibold">Categorieën voor {vehicle.brandMatch.name}</h3>
                  </div>
                  {catsLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleCategoryPick(null)}
                    className={cn(
                      "rounded-md border px-3 py-1.5 text-sm transition",
                      selectedCat === null && products.length > 0
                        ? "border-primary bg-primary/10"
                        : "hover:bg-accent"
                    )}
                  >
                    Alle
                  </button>
                  {categories.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleCategoryPick(c)}
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-sm transition",
                        selectedCat?.id === c.id ? "border-primary bg-primary/10" : "hover:bg-accent"
                      )}
                    >
                      {c.name}
                      {c._count?.products != null && (
                        <span className="ml-1.5 text-xs text-muted-foreground">({c._count.products})</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Product search + list */}
              {(selectedCat !== null || products.length > 0 || prodLoading) && (
                <div className="rounded-lg border bg-card p-6">
                  <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Package className="h-5 w-5 text-muted-foreground" />
                      <h3 className="font-semibold">
                        {selectedCat ? selectedCat.name : "Alle producten"}
                        <span className="ml-2 text-sm font-normal text-muted-foreground">
                          ({products.length} {products.length === 1 ? "product" : "producten"})
                        </span>
                      </h3>
                    </div>
                    <form onSubmit={handleSearch} className="flex gap-2">
                      <input
                        type="search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Zoeken in resultaten..."
                        className="rounded-md border bg-background px-3 py-2 text-sm w-64"
                      />
                      <Button type="submit" size="sm" variant="outline" disabled={prodLoading}>
                        {prodLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                      </Button>
                    </form>
                  </div>

                  {prodLoading && products.length === 0 ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : products.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      Geen producten gevonden{searchQuery ? ` voor "${searchQuery}"` : ""}.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {products.map((p) => {
                        const price = p.priceWithTax ?? p.priceWithMargin ?? p.price;
                        const just = addedId === p.id;
                        return (
                          <div key={p.id} className="flex gap-3 rounded-md border p-3 hover:border-primary/60 transition">
                            <div className="h-16 w-16 shrink-0 rounded bg-muted flex items-center justify-center overflow-hidden">
                              {p.imageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={p.imageUrl} alt={p.articleNo} className="h-full w-full object-cover" />
                              ) : (
                                <Package className="h-6 w-6 text-muted-foreground" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0 flex flex-col">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-xs font-mono truncate">{p.articleNo}</p>
                                  <p className="text-sm font-medium line-clamp-2">{p.description || p.articleNo}</p>
                                </div>
                                <Link
                                  href={`/finalized/${p.id}`}
                                  className="text-muted-foreground hover:text-foreground shrink-0"
                                  aria-label="Open product"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                </Link>
                              </div>
                              <div className="mt-auto flex items-center justify-between pt-2">
                                <span className="text-sm font-bold">
                                  {price != null ? `€${price.toFixed(2)}` : "—"}
                                </span>
                                <Button
                                  size="sm"
                                  variant={just ? "default" : "outline"}
                                  className="h-7 gap-1"
                                  disabled={!price || cartLoading}
                                  onClick={() => handleAddToCart(p)}
                                >
                                  {just ? "✓" : <Plus className="h-3 w-3" />}
                                  {just ? "Toegevoegd" : "Toevoegen"}
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="rounded-lg border bg-card p-6">
              <div className="flex items-center gap-3 text-muted-foreground">
                <AlertTriangle className="h-5 w-5" />
                <p className="text-sm">
                  Merk <strong>{vehicle.vehicle.merk}</strong> staat niet in de catalogus. Sync dit merk via TecDoc om producten te kunnen tonen.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Spec({
  icon: Icon, label, value,
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

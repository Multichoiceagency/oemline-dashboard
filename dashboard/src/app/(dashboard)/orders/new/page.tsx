"use client";

import {
  useState, useEffect, useCallback, useRef, useMemo,
  type FormEvent, type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import Link from "next/link";
import {
  ArrowLeft, Search, Plus, Minus, Trash2, Package, Loader2,
  CheckCircle, AlertTriangle, ExternalLink, Car, FolderTree,
  Calendar, Fuel, Gauge, Weight, Tag, Keyboard, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getFinalized, createManualOrder, lookupKenteken, getCategories,
  type FinalizedProduct, type OrderCustomer, type ManualOrderItem,
  type KentekenResponse, type Category,
} from "@/lib/api";
import { cn } from "@/lib/utils";

function formatPlate(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.length === 6) return `${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}`;
  return s;
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export default function ManualOrderPage() {
  // Kenteken state
  const [plateInput, setPlateInput] = useState("");
  const [plateLoading, setPlateLoading] = useState(false);
  const [vehicle, setVehicle] = useState<KentekenResponse | null>(null);

  // Category state
  const [categories, setCategories] = useState<Category[]>([]);
  const [catsLoading, setCatsLoading] = useState(false);
  const [selectedCat, setSelectedCat] = useState<Category | null>(null);

  // Product search
  const [query, setQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [results, setResults] = useState<FinalizedProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState(0);

  // Order draft
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
  const [showHelp, setShowHelp] = useState(false);

  // Refs for keyboard focus
  const plateRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const brandFilter = vehicle?.brandMatch?.code;

  // Run product search whenever query/category/brand/category changes.
  // Triggers when *any* of: a brand match, a category pick, or a 2+ char query.
  const runSearch = useCallback(async (q: string, cat: Category | null, brand?: string) => {
    const trimmed = q.trim();
    if (!brand && !cat && trimmed.length < 2) {
      setResults([]); setFocusedIdx(0); return;
    }
    setSearching(true);
    try {
      const res = await getFinalized({
        q: trimmed.length >= 2 ? trimmed : undefined,
        brand,
        category: cat?.code,
        hasPrice: "true",
        limit: 30,
      });
      setResults(res.items);
      setFocusedIdx(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Zoeken mislukt");
    } finally {
      setSearching(false);
    }
  }, []);

  // Debounced query → search
  useEffect(() => {
    const t = setTimeout(() => runSearch(query, selectedCat, brandFilter), 300);
    return () => clearTimeout(t);
  }, [query, selectedCat, brandFilter, runSearch]);

  async function onPlateSubmit(e: FormEvent) {
    e.preventDefault();
    const plate = plateInput.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (plate.length < 4) { setError("Voer een geldig kenteken in."); return; }
    setPlateLoading(true);
    setError(null);
    setVehicle(null);
    setCategories([]);
    setSelectedCat(null);
    try {
      const data = await lookupKenteken(plate);
      setVehicle(data);
      // Categories are universal TecDoc product groups (Brake System, Engine, …)
      // not brand-specific, so we load them on every successful plate lookup —
      // even when brandMatch is null (which is normal: our brands table only
      // holds parts manufacturers, not vehicle marques).
      setCatsLoading(true);
      try {
        const cats = await getCategories({ hideEmpty: "true", limit: 80 });
        setCategories(cats.items);
      } finally {
        setCatsLoading(false);
      }
      // After plate, jump focus to search
      setTimeout(() => searchRef.current?.focus(), 50);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kenteken lookup mislukt");
    } finally {
      setPlateLoading(false);
    }
  }

  function clearVehicle() {
    setVehicle(null);
    setCategories([]);
    setSelectedCat(null);
    setPlateInput("");
  }

  function pickCategory(cat: Category | null) {
    setSelectedCat(cat);
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

  const total = useMemo(
    () => items.reduce((s, i) => s + i.price * i.quantity, 0),
    [items],
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (items.length === 0) { setError("Voeg minstens 1 product toe."); return; }
    setSubmitting(true);
    setError(null);
    try {
      // Capture the kenteken snapshot when the operator looked one up,
      // so the WC order carries the plate + vehicle info both in the
      // customer note prefix and in meta_data.
      const vehiclePayload = vehicle
        ? {
            plate: vehicle.plate,
            brand: vehicle.vehicle.merk || null,
            model: vehicle.vehicle.handelsbenaming || null,
            year: vehicle.vehicle.year ?? null,
            fuel: vehicle.fuel?.brandstof ?? null,
            cc: vehicle.vehicle.cilinderinhoud ?? null,
          }
        : undefined;
      const res = await createManualOrder({
        customer,
        items,
        note: note || undefined,
        vehicle: vehiclePayload,
      });
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

  // ---- Keyboard shortcuts (global) ----
  useEffect(() => {
    function onKey(ev: globalThis.KeyboardEvent) {
      // Always handle Escape (closes help, blurs)
      if (ev.key === "Escape") {
        if (showHelp) { setShowHelp(false); return; }
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        return;
      }

      // Block all other shortcuts while typing in a field
      if (isTypingTarget(ev.target)) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;

      switch (ev.key) {
        case "/":
          ev.preventDefault();
          searchRef.current?.focus();
          searchRef.current?.select();
          break;
        case "k":
        case "K":
          ev.preventDefault();
          plateRef.current?.focus();
          plateRef.current?.select();
          break;
        case "?":
          ev.preventDefault();
          setShowHelp((h) => !h);
          break;
        case "ArrowDown":
          if (results.length > 0) {
            ev.preventDefault();
            setFocusedIdx((i) => Math.min(i + 1, results.length - 1));
          }
          break;
        case "ArrowUp":
          if (results.length > 0) {
            ev.preventDefault();
            setFocusedIdx((i) => Math.max(i - 1, 0));
          }
          break;
        case "Enter":
          if (results.length > 0 && results[focusedIdx]) {
            ev.preventDefault();
            addProduct(results[focusedIdx]);
          }
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, focusedIdx, showHelp]);

  // Keep focused result in view
  useEffect(() => {
    const list = resultsRef.current;
    if (!list) return;
    const node = list.querySelector<HTMLElement>(`[data-idx="${focusedIdx}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [focusedIdx]);

  // Result screen
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
                setResult(null); setItems([]); setNote(""); setQuery(""); setSearchInput("");
                setResults([]); clearVehicle();
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
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/orders" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2">
            <ArrowLeft className="h-3 w-3" /> Terug naar bestellingen
          </Link>
          <h1 className="text-3xl font-bold">Nieuwe bestelling</h1>
          <p className="text-muted-foreground mt-1">
            Kenteken &rarr; categorie &rarr; product. Of zoek vrij. Toetsenbord ondersteund (<kbd className="inline-flex items-center justify-center rounded border bg-muted px-1.5 py-0.5 text-[10px] font-mono shadow-sm">?</kbd> voor help).
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowHelp(true)}
          className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs hover:bg-accent"
          title="Toetsenbord-shortcuts"
        >
          <Keyboard className="h-3 w-3" /> Shortcuts
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
        {/* Left: kenteken → categories → products */}
        <div className="space-y-4">
          {/* Step 1: Kenteken */}
          <div className="rounded-lg border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Car className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">1. Kenteken (optioneel)</h3>
              </div>
              {vehicle && (
                <button type="button" onClick={clearVehicle} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                  <X className="h-3 w-3" /> Wissen
                </button>
              )}
            </div>
            <form onSubmit={onPlateSubmit} className="flex gap-2">
              <input
                ref={plateRef}
                type="text"
                value={plateInput}
                onChange={(e) => setPlateInput(e.target.value)}
                placeholder="bv. XX-123-Y  (k = focus)"
                maxLength={10}
                className="flex-1 rounded-md border bg-background px-3 py-2 font-mono uppercase tracking-wider"
                aria-label="Kenteken"
              />
              <Button type="submit" variant="outline" disabled={plateLoading}>
                {plateLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Opzoeken"}
              </Button>
            </form>

            {vehicle && (
              <div className="mt-4 rounded-md border bg-muted/30 p-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 items-center justify-center rounded bg-yellow-400 text-black font-mono font-bold px-3 border-2 border-black text-sm">
                    {formatPlate(vehicle.plate)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">
                      {vehicle.vehicle.merk} {vehicle.vehicle.handelsbenaming}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[vehicle.vehicle.year, vehicle.fuel?.brandstof, vehicle.vehicle.cilinderinhoud ? `${vehicle.vehicle.cilinderinhoud}cc` : null]
                        .filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <Spec icon={Calendar} label="Jaar" value={vehicle.vehicle.year?.toString() ?? "—"} />
                  <Spec icon={Fuel} label="Brandstof" value={vehicle.fuel?.brandstof ?? "—"} />
                  <Spec icon={Gauge} label="Vermogen" value={vehicle.fuel?.nettoVermogen ? `${vehicle.fuel.nettoVermogen} kW` : "—"} />
                  <Spec icon={Weight} label="Massa" value={vehicle.vehicle.massa ? `${vehicle.vehicle.massa} kg` : "—"} />
                  <Spec icon={Tag} label="Cat." value={vehicle.vehicle.europeseCategorie ?? "—"} />
                  <Spec icon={Fuel} label="CO₂" value={vehicle.fuel?.co2 != null ? `${vehicle.fuel.co2} g/km` : "—"} />
                  <Spec icon={Tag} label="Euroklasse" value={vehicle.fuel?.euroklasse ?? "—"} />
                  <Spec icon={Gauge} label="Cilinders" value={vehicle.vehicle.aantalCilinders?.toString() ?? "—"} />
                </div>
                {!vehicle.brandMatch && (
                  <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-300/50 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0 text-amber-600" />
                    <span>
                      Merk <strong>{vehicle.vehicle.merk}</strong> niet in catalogus. Gebruik vrij zoeken hieronder.
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Step 2: Categories — shown for any vehicle lookup, not gated on brandMatch */}
          {vehicle && (categories.length > 0 || catsLoading) && (
            <div className="rounded-lg border bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FolderTree className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">
                    2. Categorie{" "}
                    <span className="font-normal text-muted-foreground">
                      {vehicle.brandMatch
                        ? `voor ${vehicle.brandMatch.name}`
                        : `voor ${vehicle.vehicle.merk} ${vehicle.vehicle.handelsbenaming}`}
                    </span>
                  </h3>
                </div>
                {catsLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => pickCategory(null)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs transition",
                    selectedCat === null ? "border-primary bg-primary/10" : "hover:bg-accent",
                  )}
                >
                  Alle
                </button>
                {categories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => pickCategory(c)}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-xs transition",
                      selectedCat?.id === c.id ? "border-primary bg-primary/10" : "hover:bg-accent",
                    )}
                  >
                    {c.name}
                    {c._count?.products != null && (
                      <span className="ml-1 text-[10px] text-muted-foreground">({c._count.products})</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Search + product list */}
          <div className="rounded-lg border bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <Package className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">
                {vehicle ? "3. Producten" : "Zoek product"}
                {results.length > 0 && (
                  <span className="ml-2 font-normal text-muted-foreground">({results.length})</span>
                )}
              </h3>
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); setQuery(searchInput); }}
              className="flex gap-2"
            >
              <div className="relative flex-1">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <input
                  ref={searchRef}
                  type="search"
                  value={searchInput}
                  onChange={(e) => { setSearchInput(e.target.value); setQuery(e.target.value); }}
                  onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
                    if (e.key === "ArrowDown" && results.length > 0) {
                      e.preventDefault();
                      setFocusedIdx((i) => Math.min(i + 1, results.length - 1));
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  placeholder={selectedCat
                    ? `Filter binnen ${selectedCat.name}... (/ = focus, ↓ = navigeer)`
                    : vehicle
                    ? "Filter op artikel, omschrijving... (/ = focus, ↓ = navigeer)"
                    : "Artikel, SKU, EAN, merk... (/ = focus)"}
                  className="w-full pl-10 pr-3 py-2 rounded-md border bg-background text-sm"
                />
              </div>
              <Button type="submit" variant="outline" disabled={searching}>
                {searching ? <Loader2 className="h-4 w-4" /> : <Search className="h-4 w-4" />}
              </Button>
            </form>

            <div ref={resultsRef} className="mt-3 max-h-[60vh] overflow-y-auto rounded-md border divide-y">
              {(!brandFilter && !selectedCat && query.length < 2) ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Voer een kenteken in <em>of</em> type minimaal 2 tekens.
                </div>
              ) : results.length === 0 && !searching ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Geen producten gevonden{query ? ` voor "${query}"` : ""}.
                </div>
              ) : (
                results.map((p, idx) => {
                  const price = p.priceWithTax ?? p.priceWithMargin ?? p.price;
                  const focused = idx === focusedIdx;
                  return (
                    <div
                      key={p.id}
                      data-idx={idx}
                      onMouseEnter={() => setFocusedIdx(idx)}
                      onClick={() => addProduct(p)}
                      className={cn(
                        "flex gap-3 p-3 cursor-pointer transition",
                        focused ? "bg-primary/10" : "hover:bg-accent/30",
                      )}
                    >
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
                          onClick={(e) => { e.stopPropagation(); addProduct(p); }}
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
        </div>

        {/* Right: order draft + customer + submit */}
        <form onSubmit={submit} className="space-y-4">
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <h3 className="font-semibold text-sm">Producten ({items.length})</h3>
            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground">Voeg producten toe via de zoeker (Enter op gemarkeerd resultaat).</p>
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

      {showHelp && <ShortcutsModal onClose={() => setShowHelp(false)} />}
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
    <div className="flex items-start gap-1.5">
      <Icon className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-[10px] text-muted-foreground">{label}</p>
        <p className="text-xs font-medium truncate">{value}</p>
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

function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const rows: { keys: string[]; label: string }[] = [
    { keys: ["k"], label: "Focus kenteken" },
    { keys: ["/"], label: "Focus product-zoeker" },
    { keys: ["↑", "↓"], label: "Navigeer resultaten" },
    { keys: ["Enter"], label: "Voeg gemarkeerd product toe" },
    { keys: ["Esc"], label: "Sluit / blur veld" },
    { keys: ["?"], label: "Open / sluit deze help" },
  ];
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border bg-card p-5 shadow-lg"
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2"><Keyboard className="h-4 w-4" /> Toetsenbord-shortcuts</h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <ul className="space-y-2 text-sm">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center justify-between">
              <span className="text-muted-foreground">{r.label}</span>
              <span className="flex gap-1">
                {r.keys.map((k) => (
                  <kbd key={k} className="inline-flex items-center justify-center rounded border bg-muted px-1.5 py-0.5 text-[10px] font-mono shadow-sm">{k}</kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-muted-foreground">
          Shortcuts werken alleen wanneer geen invoerveld actief is (Esc om te blurren).
        </p>
      </div>
    </div>
  );
}

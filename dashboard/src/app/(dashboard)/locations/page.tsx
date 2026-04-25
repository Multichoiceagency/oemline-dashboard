"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  getStockLocations,
  createStockLocation,
  updateStockLocation,
  deleteStockLocation,
  type StockLocation,
} from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Warehouse, Plus, Pencil, Trash2, Loader2, AlertTriangle, Save,
} from "lucide-react";

type FormState = {
  code: string;
  name: string;
  country: string;
  address: string;
  sortOrder: string;
  active: boolean;
};

const blankForm: FormState = {
  code: "", name: "", country: "NL", address: "", sortOrder: "0", active: true,
};

export default function LocationsPage() {
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<StockLocation | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const [saving, setSaving] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const res = await getStockLocations();
      setLocations(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Locaties laden mislukt");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { reload(); }, []);

  function startCreate() {
    setEditing(null);
    setForm(blankForm);
    setError(null);
    setOpen(true);
  }
  function startEdit(loc: StockLocation) {
    setEditing(loc);
    setForm({
      code: loc.code,
      name: loc.name,
      country: loc.country,
      address: loc.address ?? "",
      sortOrder: String(loc.sortOrder),
      active: loc.active,
    });
    setError(null);
    setOpen(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        country: (form.country.trim() || "NL").toUpperCase(),
        address: form.address.trim() || null,
        sortOrder: parseInt(form.sortOrder, 10) || 0,
        active: form.active,
      };
      if (editing) await updateStockLocation(editing.id, payload);
      else await createStockLocation(payload);
      setOpen(false);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(loc: StockLocation) {
    if (!confirm(`Verwijder locatie "${loc.name}"? Bestaande voorraad-koppelingen voor deze locatie worden ook verwijderd.`)) return;
    try {
      await deleteStockLocation(loc.id);
      await reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Verwijderen mislukt");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Voorraadlocaties</h2>
          <p className="text-muted-foreground text-sm">
            Beheer magazijnen en dropship-bronnen. Per product kun je vanuit het product-detail aangeven hoeveel voorraad er per locatie ligt.
          </p>
        </div>
        <Button onClick={startCreate} className="gap-2">
          <Plus className="h-4 w-4" /> Nieuwe locatie
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Warehouse className="h-4 w-4" /> Locaties
            <Badge variant="outline" className="font-normal">{locations.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : locations.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              Geen locaties. Maak er een aan om voorraad per locatie bij te houden.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Volgorde</TableHead>
                    <TableHead>Naam</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Land</TableHead>
                    <TableHead className="hidden sm:table-cell">Adres</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Acties</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {locations.map((loc) => (
                    <TableRow key={loc.id}>
                      <TableCell className="text-muted-foreground text-sm">{loc.sortOrder}</TableCell>
                      <TableCell className="font-medium">{loc.name}</TableCell>
                      <TableCell>
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{loc.code}</code>
                      </TableCell>
                      <TableCell><Badge variant="outline">{loc.country}</Badge></TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground truncate max-w-xs">
                        {loc.address ?? "—"}
                      </TableCell>
                      <TableCell>
                        {loc.active
                          ? <Badge variant="success">Actief</Badge>
                          : <Badge variant="secondary">Inactief</Badge>}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => startEdit(loc)}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => handleDelete(loc)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? `Locatie bewerken — ${editing.name}` : "Nieuwe locatie"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Naam *</label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="bijv. Amsterdam Zuidoost"
                required
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Code *</label>
                <Input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })}
                  placeholder="amsterdam-zo"
                  className="font-mono text-sm"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Land</label>
                <Input
                  value={form.country}
                  onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase().slice(0, 2) })}
                  maxLength={2}
                  className="font-mono"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Adres (optioneel)</label>
              <Input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Straatnaam 1, 1000 AA Amsterdam"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Volgorde</label>
                <Input
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Actief</label>
                <label className="flex items-center gap-2 h-10 px-3 border rounded-md bg-background cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => setForm({ ...form, active: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  {form.active ? "Zichtbaar" : "Verborgen"}
                </label>
              </div>
            </div>
            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                {error}
              </div>
            )}
            <DialogFooter className="gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                Annuleren
              </Button>
              <Button type="submit" disabled={saving || !form.name.trim() || !form.code.trim()} className="gap-1">
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                {editing ? "Opslaan" : "Aanmaken"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

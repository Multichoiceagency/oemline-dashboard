"use client";

import { useState, useEffect } from "react";
import { useApi } from "@/lib/hooks";
import { getSettings, updateSettings, getPricingPreview } from "@/lib/api";
import { useTranslation } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Settings, DollarSign, Percent, Calculator, Check, Loader2, ArrowRight, Globe, KeyRound } from "lucide-react";

export default function SettingsPage() {
  const { t } = useTranslation();
  const { data: settings, loading, refetch } = useApi(() => getSettings(), []);
  const { data: preview, refetch: refetchPreview } = useApi(() => getPricingPreview(10), []);

  const [taxRate, setTaxRate] = useState("");
  const [marginPercentage, setMarginPercentage] = useState("");
  const [currency, setCurrency] = useState("");
  const [outputApiUrl, setOutputApiUrl] = useState("");
  const [outputApiKey, setOutputApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings) {
      setTaxRate(String(settings.taxRate));
      setMarginPercentage(String(settings.marginPercentage));
      setCurrency(settings.currency);
      setOutputApiUrl(settings.outputApiUrl ?? "");
      setOutputApiKey(settings.outputApiKey ?? "");
    }
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await updateSettings({
        taxRate: parseFloat(taxRate) || 0,
        marginPercentage: parseFloat(marginPercentage) || 0,
        currency: currency || "EUR",
        outputApiUrl,
        outputApiKey,
      });
      setSaved(true);
      refetch();
      refetchPreview();
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  // Live calculation preview
  const basePriceExample = 10;
  const marginPct = parseFloat(marginPercentage) || 0;
  const taxPct = parseFloat(taxRate) || 0;
  const withMargin = basePriceExample * (1 + marginPct / 100);
  const withTax = withMargin * (1 + taxPct / 100);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t("settings.title")}</h1>
        <p className="text-muted-foreground">{t("settings.subtitle")}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Settings Form */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              {t("settings.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Tax Rate */}
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <Percent className="h-4 w-4 text-muted-foreground" />
                {t("settings.taxRate")}
              </label>
              <p className="text-xs text-muted-foreground">{t("settings.taxRateDesc")}</p>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  value={taxRate}
                  onChange={(e) => setTaxRate(e.target.value)}
                  min={0}
                  max={100}
                  step={0.1}
                  className="w-32"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>

            {/* Margin Percentage */}
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                {t("settings.marginPercentage")}
              </label>
              <p className="text-xs text-muted-foreground">{t("settings.marginDesc")}</p>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  value={marginPercentage}
                  onChange={(e) => setMarginPercentage(e.target.value)}
                  min={0}
                  max={1000}
                  step={0.5}
                  className="w-32"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>

            {/* Currency */}
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("settings.currency")}</label>
              <Input
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                maxLength={5}
                className="w-32"
              />
            </div>

            <Button onClick={handleSave} disabled={saving} className="w-full">
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : saved ? (
                <Check className="h-4 w-4 mr-2 text-green-400" />
              ) : null}
              {saved ? t("settings.saved") : t("settings.saveSettings")}
            </Button>
          </CardContent>
        </Card>

        {/* Live Calculator */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              {t("settings.preview")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">{t("settings.formula")}</p>

            {/* Visual formula */}
            <div className="bg-muted rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="outline">{t("settings.basePrice")}</Badge>
                <span className="font-mono">{currency} {basePriceExample.toFixed(2)}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">+ {marginPct}% {t("settings.marginPercentage").toLowerCase()}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="secondary">{t("settings.withMargin")}</Badge>
                <span className="font-mono">{currency} {withMargin.toFixed(2)}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">+ {taxPct}% BTW</span>
              </div>
              <div className="flex items-center gap-2 text-sm font-bold">
                <Badge>{t("settings.withTax")}</Badge>
                <span className="font-mono text-lg">{currency} {withTax.toFixed(2)}</span>
              </div>
            </div>

            {/* Real product examples */}
            {preview && preview.preview.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-medium text-muted-foreground mb-2">{t("settings.previewDesc")}</p>
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Article</TableHead>
                        <TableHead>{t("settings.basePrice")}</TableHead>
                        <TableHead>{t("settings.withMargin")}</TableHead>
                        <TableHead>{t("settings.withTax")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.preview.map((p, i) => (
                        <TableRow key={i}>
                          <TableCell>
                            <div>
                              <span className="font-mono text-xs">{p.articleNo}</span>
                              <p className="text-xs text-muted-foreground">{p.brand}</p>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {p.currency} {p.basePrice.toFixed(2)}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {p.currency} {p.withMargin.toFixed(2)}
                          </TableCell>
                          <TableCell className="font-mono text-sm font-bold">
                            {p.currency} {p.withTax.toFixed(2)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Output API */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Output API
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            When you click <strong>Push to Output API</strong> on a product, the full product data (including calculated prices) will be POSTed to this URL.
          </p>
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground" />
              Output API URL
            </label>
            <Input
              value={outputApiUrl}
              onChange={(e) => setOutputApiUrl(e.target.value)}
              placeholder="https://your-api.example.com/products"
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              API Key <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <Input
              type="password"
              value={outputApiKey}
              onChange={(e) => setOutputApiKey(e.target.value)}
              placeholder="Sent as X-API-Key header"
              className="font-mono text-sm"
            />
          </div>
          <Button onClick={handleSave} disabled={saving} variant="outline">
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : saved ? (
              <Check className="h-4 w-4 mr-2 text-green-500" />
            ) : null}
            {saved ? "Saved" : "Save"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

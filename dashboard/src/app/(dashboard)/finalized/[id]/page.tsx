"use client";

import { useState, useRef, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  getFinalizedProduct,
  updateProduct,
  uploadProductImage,
  pushFinalizedProduct,
  getTecDocLinkagesByNumber,
} from "@/lib/api";
import type { FinalizedDetail, VehicleLinkage } from "@/lib/api";
import { useTranslation } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatNumber, formatDate } from "@/lib/utils";
import {
  Package,
  ArrowLeft,
  Pencil,
  Save,
  X,
  Loader2,
  ImageIcon,
  DollarSign,
  Upload,
  ExternalLink,
  Copy,
  Check,
  Car,
  Star,
  Plus,
  Trash2,
  Send,
  CheckCircle2,
  AlertCircle,
  Link2,
} from "lucide-react";

export default function FinalizedDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { t } = useTranslation();
  const productId = parseInt(params.id as string, 10);

  const [product, setProduct] = useState<FinalizedDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<"success" | "error" | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const imageFileRef = useRef<HTMLInputElement>(null);

  // Vehicle linkages
  const [linkages, setLinkages] = useState<VehicleLinkage[]>([]);
  const [loadingLinkages, setLoadingLinkages] = useState(false);
  const [linkagesLoaded, setLinkagesLoaded] = useState(false);

  const [editForm, setEditForm] = useState({
    description: "",
    imageUrl: "",
    images: [] as string[],
    price: "",
    currency: "EUR",
    stock: "",
    genericArticle: "",
    status: "active",
  });

  useEffect(() => {
    if (isNaN(productId)) return;
    setLoading(true);
    getFinalizedProduct(productId)
      .then((p) => {
        setProduct(p);
        populateForm(p);
      })
      .catch((err) => {
        console.error("Failed to load finalized product:", err);
        alert("Product not found");
        router.push("/finalized");
      })
      .finally(() => setLoading(false));
  }, [productId]);

  // Auto-load vehicle linkages when product loads
  useEffect(() => {
    if (!product?.articleNo || linkagesLoaded) return;
    setLoadingLinkages(true);
    getTecDocLinkagesByNumber(product.articleNo)
      .then((result) => setLinkages(result.linkages))
      .catch(() => {
        // TecDoc linkage lookup failed -- not critical
      })
      .finally(() => {
        setLoadingLinkages(false);
        setLinkagesLoaded(true);
      });
  }, [product?.articleNo]);

  const populateForm = (p: FinalizedDetail) => {
    setEditForm({
      description: p.description || "",
      imageUrl: p.imageUrl || "",
      images: p.images ?? [],
      price: p.price != null ? String(p.price) : "",
      currency: p.currency || "EUR",
      stock: p.stock != null ? String(p.stock) : "",
      genericArticle: p.genericArticle || "",
      status: p.status || "active",
    });
  };

  const handleSave = async () => {
    if (!product) return;
    setSaving(true);
    try {
      await updateProduct(product.id, {
        description: editForm.description,
        imageUrl: editForm.imageUrl || null,
        images: editForm.images,
        price: editForm.price ? parseFloat(editForm.price) : null,
        currency: editForm.currency || "EUR",
        stock: editForm.stock ? parseInt(editForm.stock, 10) : null,
        genericArticle: editForm.genericArticle || null,
        status: editForm.status,
      });
      setEditMode(false);
      // Refetch product to get updated data
      const updated = await getFinalizedProduct(product.id);
      setProduct(updated);
      populateForm(updated);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update product");
    } finally {
      setSaving(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !product) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const result = await uploadProductImage(product.id, file);
        setEditForm((prev) => ({
          ...prev,
          images: [...prev.images, result.url],
          imageUrl: prev.imageUrl || result.url,
        }));
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (imageFileRef.current) imageFileRef.current.value = "";
    }
  };

  const removeImage = (url: string) => {
    setEditForm((prev) => {
      const newImages = prev.images.filter((img) => img !== url);
      const newPrimary =
        prev.imageUrl === url ? newImages[0] ?? "" : prev.imageUrl;
      return { ...prev, images: newImages, imageUrl: newPrimary };
    });
  };

  const setPrimaryImage = (url: string) => {
    setEditForm((prev) => ({ ...prev, imageUrl: url }));
  };

  const handlePush = async () => {
    if (!product) return;
    setPushing(true);
    setPushResult(null);
    try {
      await pushFinalizedProduct(product.id);
      setPushResult("success");
      setTimeout(() => setPushResult(null), 4000);
    } catch {
      setPushResult("error");
      setTimeout(() => setPushResult(null), 5000);
    } finally {
      setPushing(false);
    }
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-3 text-muted-foreground">Loading product...</span>
      </div>
    );
  }

  if (!product) return null;

  const cur =
    product.currency === "EUR" ? "\u20AC" : product.currency ?? "";

  const CopyButton = ({ value, field }: { value: string; field: string }) =>
    value ? (
      <button
        onClick={() => copyToClipboard(value, field)}
        className="ml-1 text-muted-foreground hover:text-foreground transition-colors"
        title="Copy"
      >
        {copied === field ? (
          <Check className="h-3 w-3 text-green-500" />
        ) : (
          <Copy className="h-3 w-3" />
        )}
      </button>
    ) : null;

  // ── Edit Mode ──────────────────────────────────────────────────────
  if (editMode) {
    return (
      <div className="space-y-6 max-w-5xl">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditMode(false);
                populateForm(product);
              }}
              className="shrink-0 min-h-[44px] sm:min-h-0"
            >
              <X className="h-4 w-4 mr-1" /> Cancel
            </Button>
            <div className="min-w-0">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2 truncate">
                <Pencil className="h-5 w-5 shrink-0" />
                Edit: {product.brand?.name} {product.articleNo}
              </h2>
              <p className="text-xs sm:text-sm text-muted-foreground truncate">
                {product.supplier?.name} &middot; ID: {product.id}
              </p>
            </div>
          </div>
          <Button onClick={handleSave} disabled={saving} className="self-start sm:self-auto min-h-[44px] sm:min-h-0 shrink-0">
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            Save Changes
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column: Image gallery management */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <ImageIcon className="h-4 w-4" /> Product Images
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {editForm.images.length > 0 ? (
                  <div className="grid grid-cols-2 gap-3">
                    {editForm.images.map((url, i) => (
                      <div
                        key={i}
                        className={`relative group rounded-lg border-2 overflow-hidden ${
                          url === editForm.imageUrl
                            ? "border-blue-500 ring-2 ring-blue-200"
                            : "border-muted hover:border-muted-foreground/30"
                        }`}
                      >
                        <img
                          src={url}
                          alt={`Product image ${i + 1}`}
                          className="h-24 w-full object-contain bg-white p-1"
                        />
                        {url === editForm.imageUrl && (
                          <div className="absolute top-1 left-1">
                            <Badge className="bg-blue-500 text-[10px] px-1 py-0">
                              <Star className="h-2.5 w-2.5 mr-0.5" /> Primary
                            </Badge>
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100">
                          {url !== editForm.imageUrl && (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="h-7 text-xs"
                              onClick={() => setPrimaryImage(url)}
                            >
                              <Star className="h-3 w-3" />
                            </Button>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            className="h-7 text-xs"
                            onClick={() => removeImage(url)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-24 rounded-lg border-2 border-dashed border-muted text-muted-foreground text-sm">
                    No images yet
                  </div>
                )}

                <input
                  ref={imageFileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleImageUpload}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => imageFileRef.current?.click()}
                  disabled={uploading}
                  className="w-full"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />{" "}
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-2" /> Upload Images
                    </>
                  )}
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  Click an image to set as primary. Supports multiple file
                  upload.
                </p>
              </CardContent>
            </Card>

            {/* Status */}
            <Card>
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Status</span>
                  <Select
                    value={editForm.status}
                    onValueChange={(v) =>
                      setEditForm({ ...editForm, status: v })
                    }
                  >
                    <SelectTrigger className="w-[140px] h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                      <SelectItem value="discontinued">Discontinued</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Read-only info */}
            <Card>
              <CardContent className="pt-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Article No.</span>
                  <span className="font-mono">{product.articleNo}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">SKU</span>
                  <span className="font-mono">{product.sku}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Brand</span>
                  <span>{product.brand?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Supplier</span>
                  <span>{product.supplier?.name}</span>
                </div>
                {product.icMapping && product.icMapping.length > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">IC Code</span>
                    <span className="font-mono text-blue-600">
                      {product.icMapping[0].towKod}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right column: Edit fields */}
          <div className="lg:col-span-2 space-y-4">
            {/* Description */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Description</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Description
                  </label>
                  <textarea
                    value={editForm.description}
                    onChange={(e) =>
                      setEditForm({ ...editForm, description: e.target.value })
                    }
                    rows={3}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Generic Article
                  </label>
                  <Input
                    value={editForm.genericArticle}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        genericArticle: e.target.value,
                      })
                    }
                    placeholder="e.g. Brake Pad Set"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Pricing & Stock */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <DollarSign className="h-4 w-4" /> Pricing & Stock
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Price
                    </label>
                    <Input
                      type="number"
                      step="0.01"
                      value={editForm.price}
                      onChange={(e) =>
                        setEditForm({ ...editForm, price: e.target.value })
                      }
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Currency
                    </label>
                    <Select
                      value={editForm.currency}
                      onValueChange={(v) =>
                        setEditForm({ ...editForm, currency: v })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="EUR">EUR</SelectItem>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="GBP">GBP</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Stock
                    </label>
                    <Input
                      type="number"
                      value={editForm.stock}
                      onChange={(e) =>
                        setEditForm({ ...editForm, stock: e.target.value })
                      }
                      placeholder="0"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // ── Detail View (non-edit mode) ────────────────────────────────────
  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/finalized")}
            className="shrink-0 min-h-[44px] sm:min-h-0"
          >
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <div className="min-w-0">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2 truncate">
              <Package className="h-5 w-5 shrink-0" />
              {product.brand?.name} {product.articleNo}
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground truncate">
              {product.supplier?.name} &middot; ID: {product.id} &middot;
              Updated: {formatDate(product.updatedAt)}
            </p>
          </div>
        </div>
        <div className="flex gap-2 self-start sm:self-auto shrink-0">
          <Button
            variant="outline"
            onClick={() => {
              populateForm(product);
              setEditMode(true);
            }}
          >
            <Pencil className="h-4 w-4 mr-1" /> Edit
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Image + Status */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <ImageIcon className="h-4 w-4" /> Product Image
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center">
                {product.imageUrl ? (
                  <img
                    src={product.imageUrl}
                    alt={product.articleNo}
                    className="w-full max-h-48 object-contain rounded"
                  />
                ) : (
                  <div className="h-32 w-full bg-muted rounded flex items-center justify-center">
                    <Package className="h-12 w-12 text-muted-foreground/30" />
                  </div>
                )}
                {product.images && product.images.length > 1 && (
                  <div className="flex gap-1.5 flex-wrap mt-3">
                    {product.images.map((img, i) => (
                      <img
                        key={i}
                        src={img}
                        alt=""
                        className="h-10 w-10 object-contain rounded border p-0.5"
                      />
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Status Card */}
          <Card>
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{t("finalized.status")}</span>
                <Badge
                  variant={
                    product.status === "active"
                      ? "success"
                      : product.status === "inactive"
                      ? "secondary"
                      : "destructive"
                  }
                >
                  {product.status}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{t("finalized.supplier")}</span>
                <Badge variant="outline">{product.supplier?.name ?? "-"}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{t("finalized.brand")}</span>
                <div className="flex items-center gap-1.5">
                  {product.brand?.logoUrl && (
                    <img
                      src={product.brand.logoUrl}
                      alt=""
                      className="h-4 w-4 object-contain"
                    />
                  )}
                  <Badge variant="secondary">
                    {product.brand?.name ?? "-"}
                  </Badge>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{t("finalized.category")}</span>
                <span className="text-sm text-muted-foreground">
                  {product.category?.name ?? "-"}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Storefront link */}
          {product.status === "active" && (
            <Card>
              <CardContent className="pt-4">
                <a
                  href={
                    product.brand?.tecdocId
                      ? `https://oemline.eu/parts/tecdoc/${product.brand.tecdocId}/${encodeURIComponent(product.articleNo)}`
                      : `https://oemline.eu/shop?q=${encodeURIComponent(product.articleNo)}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 transition-colors"
                >
                  <ExternalLink className="h-4 w-4" /> Bekijk op storefront
                </a>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column: Product details */}
        <div className="lg:col-span-2 space-y-4">
          {/* Identifiers */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Product Identifiers</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-y-3 gap-x-6">
                {(
                  [
                    [t("finalized.articleNo"), product.articleNo],
                    [t("finalized.sku"), product.sku],
                    [
                      t("finalized.icCode"),
                      product.icMapping && product.icMapping.length > 0
                        ? product.icMapping[0].towKod
                        : null,
                    ],
                    [t("finalized.ean"), product.ean],
                    [t("finalized.tecdocId"), product.tecdocId],
                    ["OEM", product.oem],
                  ] as [string, string | null][]
                ).map(([label, value]) => (
                  <div key={label}>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-sm font-mono font-medium flex items-center">
                      {value ? (
                        <>
                          {label === t("finalized.icCode") ? (
                            <span className="text-blue-600">{value}</span>
                          ) : (
                            value
                          )}
                          <CopyButton value={value} field={label} />
                        </>
                      ) : (
                        <span className="text-muted-foreground italic">-</span>
                      )}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Description */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t("finalized.description")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <p className="text-sm">
                  {product.description || (
                    <span className="text-muted-foreground italic">
                      No description
                    </span>
                  )}
                </p>
                {product.genericArticle && (
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {t("finalized.genericArticle")}
                    </p>
                    <p className="text-sm font-medium">
                      {product.genericArticle}
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Pricing Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Base Price</p>
                <p className="text-lg font-mono font-bold">
                  {product.price != null
                    ? `${cur} ${product.price.toFixed(2)}`
                    : t("finalized.notSet")}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">With Tax</p>
                <p className="text-lg font-mono font-bold text-green-600">
                  {product.priceWithTax != null
                    ? `${cur} ${product.priceWithTax.toFixed(2)}`
                    : t("finalized.notSet")}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">{t("finalized.stock")}</p>
                <p className="text-lg font-bold">
                  {product.stock != null ? (
                    <Badge
                      variant={product.stock > 0 ? "success" : "destructive"}
                      className="text-base px-3 py-1"
                    >
                      {product.stock}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground text-sm">-</span>
                  )}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">{t("finalized.weight")}</p>
                <p className="text-lg font-bold">
                  {product.weight != null ? `${product.weight} kg` : "-"}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Metadata */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Metadata</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-y-3 gap-x-6 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">{t("finalized.category")}</p>
                  <p>{product.category?.name ?? "-"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("finalized.supplier")}</p>
                  <p>{product.supplier?.name}</p>
                </div>
                {product.genericArticle && (
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {t("finalized.genericArticle")}
                    </p>
                    <p>{product.genericArticle}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-muted-foreground">{t("finalized.status")}</p>
                  <Badge
                    variant={
                      product.status === "active" ? "default" : "secondary"
                    }
                  >
                    {product.status}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("finalized.updated")}</p>
                  <p>{formatDate(product.updatedAt)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("finalized.created")}</p>
                  <p>{formatDate(product.createdAt)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* OEM Numbers */}
          {product.oemNumbers && product.oemNumbers.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{t("finalized.oemNumbers")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {product.oemNumbers.map((oem, i) => (
                    <Badge
                      key={i}
                      variant="outline"
                      className="font-mono text-xs"
                    >
                      {oem}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Additional Images */}
          {product.images && product.images.length > 1 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{t("finalized.images")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2 flex-wrap">
                  {product.images.map((url, i) => (
                    <img
                      key={i}
                      src={url}
                      alt=""
                      className="h-20 w-20 object-contain rounded border"
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Vehicle Applicability */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Car className="h-4 w-4" /> Toepasbaarheid (Voertuigen)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loadingLinkages ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">
                    Laden...
                  </span>
                </div>
              ) : linkages.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  Geen voertuigkoppelingen gevonden in TecDoc
                </p>
              ) : (
                <div className="rounded-lg border overflow-hidden max-h-[400px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Merk</TableHead>
                        <TableHead>Model</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Bouwjaar</TableHead>
                        <TableHead>Motor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {linkages.map((v, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium text-sm">
                            {v.mfrName}
                          </TableCell>
                          <TableCell className="text-sm">
                            {v.vehicleModelSeriesName}
                          </TableCell>
                          <TableCell className="text-sm max-w-[200px] truncate">
                            {v.description || v.typeName}
                          </TableCell>
                          <TableCell className="text-xs font-mono">
                            {v.beginYearMonth && v.endYearMonth
                              ? `${v.beginYearMonth} - ${v.endYearMonth}`
                              : v.beginYearMonth
                              ? `${v.beginYearMonth} -`
                              : "-"}
                          </TableCell>
                          <TableCell className="text-xs">
                            {[v.capacity, v.power, v.fuelType]
                              .filter(Boolean)
                              .join(" / ") || "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* InterCars Mapping */}
          {product.icMapping && product.icMapping.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Link2 className="h-4 w-4" /> {t("finalized.icMapping")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("finalized.towCode")}</TableHead>
                        <TableHead>{t("finalized.icIndex")}</TableHead>
                        <TableHead>{t("finalized.manufacturer")}</TableHead>
                        <TableHead>{t("finalized.description")}</TableHead>
                        <TableHead>{t("finalized.ean")}</TableHead>
                        <TableHead>{t("finalized.weight")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {product.icMapping.map((ic, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-sm">
                            {ic.towKod}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {ic.icIndex}
                          </TableCell>
                          <TableCell>{ic.manufacturer}</TableCell>
                          <TableCell className="max-w-[200px] truncate">
                            {ic.description}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {ic.ean ?? "-"}
                          </TableCell>
                          <TableCell>
                            {ic.weight != null ? `${ic.weight} kg` : "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useRef, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { getProduct, updateProduct, deleteProduct, uploadProductImage } from "@/lib/api";
import type { Product } from "@/lib/api";
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
import { formatDate } from "@/lib/utils";
import {
  Package,
  ArrowLeft,
  Pencil,
  Trash2,
  Save,
  X,
  Loader2,
  ImageIcon,
  DollarSign,
  Upload,
  ExternalLink,
  Copy,
  Check,
} from "lucide-react";

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const productId = parseInt(params.id as string, 10);

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const imageFileRef = useRef<HTMLInputElement>(null);

  const [editForm, setEditForm] = useState({
    sku: "",
    articleNo: "",
    ean: "",
    tecdocId: "",
    oem: "",
    description: "",
    imageUrl: "",
    price: "",
    currency: "EUR",
    stock: "",
    genericArticle: "",
    status: "active",
  });

  useEffect(() => {
    if (isNaN(productId)) return;
    setLoading(true);
    getProduct(productId)
      .then((p) => {
        setProduct(p);
        populateForm(p);
      })
      .catch((err) => {
        console.error("Failed to load product:", err);
        alert("Product not found");
        router.push("/products");
      })
      .finally(() => setLoading(false));
  }, [productId]);

  const populateForm = (p: Product) => {
    setEditForm({
      sku: p.sku,
      articleNo: p.articleNo,
      ean: p.ean ?? "",
      tecdocId: p.tecdocId ?? "",
      oem: p.oem ?? "",
      description: p.description,
      imageUrl: p.imageUrl ?? "",
      price: p.price != null ? String(p.price) : "",
      currency: p.currency ?? "EUR",
      stock: p.stock != null ? String(p.stock) : "",
      genericArticle: p.genericArticle ?? "",
      status: p.status,
    });
  };

  const handleSave = async () => {
    if (!product) return;
    setSaving(true);
    try {
      const updated = await updateProduct(product.id, {
        sku: editForm.sku,
        articleNo: editForm.articleNo,
        ean: editForm.ean || null,
        tecdocId: editForm.tecdocId || null,
        oem: editForm.oem || null,
        description: editForm.description,
        imageUrl: editForm.imageUrl || null,
        price: editForm.price ? parseFloat(editForm.price) : null,
        currency: editForm.currency || "EUR",
        stock: editForm.stock ? parseInt(editForm.stock, 10) : null,
        genericArticle: editForm.genericArticle || null,
        status: editForm.status,
      });
      setProduct(updated);
      setEditMode(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update product");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!product) return;
    if (!confirm(`Delete product ${product.articleNo} (${product.sku})?`)) return;
    try {
      await deleteProduct(product.id);
      router.push("/products");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete product");
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !product) return;
    setUploading(true);
    try {
      const result = await uploadProductImage(product.id, file);
      setEditForm({ ...editForm, imageUrl: result.url });
      setProduct({ ...product, imageUrl: result.url, images: result.images });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (imageFileRef.current) imageFileRef.current.value = "";
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

  const CopyButton = ({ value, field }: { value: string; field: string }) =>
    value ? (
      <button
        onClick={() => copyToClipboard(value, field)}
        className="ml-1 text-muted-foreground hover:text-foreground transition-colors"
        title="Copy"
      >
        {copied === field ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
      </button>
    ) : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="sm" onClick={() => router.push("/products")} className="shrink-0 min-h-[44px] sm:min-h-0">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <div className="min-w-0">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2 truncate">
              <Package className="h-5 w-5 shrink-0" />
              {product.brand?.name} {product.articleNo}
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground truncate">
              {product.supplier?.name} &middot; ID: {product.id} &middot; Updated: {formatDate(product.updatedAt)}
            </p>
          </div>
        </div>
        <div className="flex gap-2 self-start sm:self-auto shrink-0">
          {editMode ? (
            <>
              <Button variant="outline" onClick={() => { setEditMode(false); populateForm(product); }} className="min-h-[44px] sm:min-h-0">
                <X className="h-4 w-4 mr-1" /> Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving} className="min-h-[44px] sm:min-h-0">
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                Save
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setEditMode(true)} className="min-h-[44px] sm:min-h-0">
                <Pencil className="h-4 w-4 mr-1" /> Edit
              </Button>
              <Button variant="destructive" size="sm" onClick={handleDelete} className="min-h-[44px] sm:min-h-0">
                <Trash2 className="h-4 w-4 mr-1" /> Delete
              </Button>
            </>
          )}
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
              {editMode ? (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <Input
                      value={editForm.imageUrl}
                      onChange={(e) => setEditForm({ ...editForm, imageUrl: e.target.value })}
                      placeholder="Image URL"
                      className="flex-1 text-xs"
                    />
                    <input ref={imageFileRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                    <Button type="button" variant="outline" size="sm" onClick={() => imageFileRef.current?.click()} disabled={uploading}>
                      {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    </Button>
                  </div>
                  {editForm.imageUrl && (
                    <img src={editForm.imageUrl} alt="Preview" className="w-full max-h-48 object-contain rounded border p-2" />
                  )}
                  {product.images && product.images.length > 1 && (
                    <div className="flex gap-1.5 flex-wrap">
                      {product.images.map((img, i) => (
                        <img
                          key={i}
                          src={img}
                          alt=""
                          className="h-10 w-10 object-contain rounded border p-0.5 cursor-pointer hover:ring-2 ring-primary"
                          onClick={() => setEditForm({ ...editForm, imageUrl: img })}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  {product.imageUrl ? (
                    <img src={product.imageUrl} alt={product.articleNo} className="w-full max-h-48 object-contain rounded" />
                  ) : (
                    <div className="h-32 w-full bg-muted rounded flex items-center justify-center">
                      <Package className="h-12 w-12 text-muted-foreground/30" />
                    </div>
                  )}
                  {product.images && product.images.length > 1 && (
                    <div className="flex gap-1.5 flex-wrap mt-3">
                      {product.images.map((img, i) => (
                        <img key={i} src={img} alt="" className="h-10 w-10 object-contain rounded border p-0.5" />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Status Card */}
          <Card>
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Status</span>
                {editMode ? (
                  <Select value={editForm.status} onValueChange={(v) => setEditForm({ ...editForm, status: v })}>
                    <SelectTrigger className="w-[140px] h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                      <SelectItem value="discontinued">Discontinued</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge variant={product.status === "active" ? "success" : product.status === "inactive" ? "secondary" : "destructive"}>
                    {product.status}
                  </Badge>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Supplier</span>
                <Badge variant="outline">{product.supplier?.name ?? "-"}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Brand</span>
                <Badge variant="secondary">{product.brand?.name ?? "-"}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Category</span>
                <span className="text-sm text-muted-foreground">{product.category?.name ?? "-"}</span>
              </div>
            </CardContent>
          </Card>

          {/* Storefront link */}
          {product.status === "active" && (
            <Card>
              <CardContent className="pt-4">
                <a
                  href={`https://oemline.eu/nl/producten/${encodeURIComponent(product.articleNo)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 transition-colors"
                >
                  <ExternalLink className="h-4 w-4" /> View on Storefront
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
              {editMode ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">SKU</label>
                    <Input value={editForm.sku} onChange={(e) => setEditForm({ ...editForm, sku: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Article No.</label>
                    <Input value={editForm.articleNo} onChange={(e) => setEditForm({ ...editForm, articleNo: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">EAN</label>
                    <Input value={editForm.ean} onChange={(e) => setEditForm({ ...editForm, ean: e.target.value })} placeholder="None" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">TecDoc ID</label>
                    <Input value={editForm.tecdocId} onChange={(e) => setEditForm({ ...editForm, tecdocId: e.target.value })} placeholder="None" />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="text-xs font-medium text-muted-foreground">OEM Number</label>
                    <Input value={editForm.oem} onChange={(e) => setEditForm({ ...editForm, oem: e.target.value })} placeholder="None" />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 gap-x-6">
                  {[
                    ["SKU", product.sku],
                    ["Article No.", product.articleNo],
                    ["EAN", product.ean],
                    ["TecDoc ID", product.tecdocId],
                    ["OEM", product.oem],
                    ["IC Code", product.icCode],
                  ].map(([label, value]) => (
                    <div key={label as string}>
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="text-sm font-mono font-medium flex items-center">
                        {(value as string) || <span className="text-muted-foreground italic">-</span>}
                        {value && <CopyButton value={value as string} field={label as string} />}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Description */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Description</CardTitle>
            </CardHeader>
            <CardContent>
              {editMode ? (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Description</label>
                    <textarea
                      value={editForm.description}
                      onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                      rows={3}
                      className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Generic Article</label>
                    <Input
                      value={editForm.genericArticle}
                      onChange={(e) => setEditForm({ ...editForm, genericArticle: e.target.value })}
                      placeholder="e.g. Brake Pad Set"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm">{product.description || <span className="text-muted-foreground italic">No description</span>}</p>
                  {product.genericArticle && (
                    <div>
                      <p className="text-xs text-muted-foreground">Generic Article</p>
                      <p className="text-sm font-medium">{product.genericArticle}</p>
                    </div>
                  )}
                </div>
              )}
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
              {editMode ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Price</label>
                    <Input type="number" step="0.01" value={editForm.price} onChange={(e) => setEditForm({ ...editForm, price: e.target.value })} placeholder="0.00" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Currency</label>
                    <Select value={editForm.currency} onValueChange={(v) => setEditForm({ ...editForm, currency: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="EUR">EUR</SelectItem>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="GBP">GBP</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Stock</label>
                    <Input type="number" value={editForm.stock} onChange={(e) => setEditForm({ ...editForm, stock: e.target.value })} placeholder="0" />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
                  <div>
                    <p className="text-xs text-muted-foreground">Price</p>
                    <p className="text-lg font-mono font-bold">
                      {product.price != null ? `${product.currency ?? "EUR"} ${product.price.toFixed(2)}` : <span className="text-muted-foreground text-sm">-</span>}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Stock</p>
                    <p className="text-lg font-bold">
                      {product.stock != null ? (
                        <Badge variant={product.stock > 0 ? "success" : "destructive"} className="text-base px-3 py-1">
                          {product.stock}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">-</span>
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Weight</p>
                    <p className="text-sm">{product.weight ? `${product.weight} g` : "-"}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* IC Mappings */}
          {product.icMapping && product.icMapping.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">InterCars Mappings</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {product.icMapping.map((m: any, i: number) => (
                    <div key={i} className="flex items-center gap-3 p-2 rounded border bg-muted/30 text-sm">
                      <Badge variant="outline" className="font-mono">{m.tow_kod}</Badge>
                      <span className="text-muted-foreground">{m.ic_manufacturer}</span>
                      <span className="font-medium">{m.ic_description}</span>
                      {m.ic_ean && <span className="text-xs text-muted-foreground">EAN: {m.ic_ean}</span>}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Timestamps */}
          <Card>
            <CardContent className="pt-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Created</p>
                  <p>{formatDate(product.createdAt)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Last Updated</p>
                  <p>{formatDate(product.updatedAt)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

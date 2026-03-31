"use client";

import { useState, useRef, useCallback } from "react";
import { useApi } from "@/lib/hooks";
import {
  getStorageFiles,
  getStorageStats,
  uploadGenericFile,
  deleteStorageFile,
} from "@/lib/api";
import type { StorageFile } from "@/lib/api";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  HardDrive,
  Upload,
  Trash2,
  FolderOpen,
  FileText,
  Image as ImageIcon,
  File,
  Download,
  Loader2,
  RefreshCw,
  Search,
  X,
  Copy,
  Check,
  ArrowLeft,
  FileSpreadsheet,
  FileArchive,
} from "lucide-react";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "webp", "gif", "svg"].includes(ext))
    return <ImageIcon className="h-4 w-4 text-blue-500" />;
  if (["csv", "xls", "xlsx"].includes(ext))
    return <FileSpreadsheet className="h-4 w-4 text-green-500" />;
  if (["zip", "gz", "tar"].includes(ext))
    return <FileArchive className="h-4 w-4 text-orange-500" />;
  if (["json", "txt", "md"].includes(ext))
    return <FileText className="h-4 w-4 text-yellow-500" />;
  return <File className="h-4 w-4 text-muted-foreground" />;
}

function isImageFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ["jpg", "jpeg", "png", "webp", "gif", "svg"].includes(ext);
}

export default function StoragePage() {
  const [prefix, setPrefix] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [uploadFolder, setUploadFolder] = useState("files");
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<StorageFile | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    data: filesData,
    loading: loadingFiles,
    refetch: refetchFiles,
  } = useApi(() => getStorageFiles(prefix || undefined), [prefix]);

  const {
    data: stats,
    loading: loadingStats,
    refetch: refetchStats,
  } = useApi(() => getStorageStats(), []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await uploadGenericFile(file, uploadFolder);
      refetchFiles();
      refetchStats();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (objectName: string) => {
    if (!confirm(`Delete ${objectName}?`)) return;
    setDeleting(objectName);
    try {
      await deleteStorageFile(objectName);
      refetchFiles();
      refetchStats();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(null);
    }
  };

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const navigateToFolder = (folder: string) => {
    setPrefix(folder.endsWith("/") ? folder : folder + "/");
    setSearchInput("");
  };

  const goUp = () => {
    const parts = prefix.replace(/\/$/, "").split("/");
    parts.pop();
    setPrefix(parts.length > 0 ? parts.join("/") + "/" : "");
  };

  // Get unique top-level folders from current view
  const folders = new Set<string>();
  const files: StorageFile[] = [];

  if (filesData?.items) {
    for (const item of filesData.items) {
      const relativePath = prefix ? item.name.slice(prefix.length) : item.name;
      const slashIdx = relativePath.indexOf("/");
      if (slashIdx > 0) {
        folders.add(relativePath.slice(0, slashIdx));
      } else {
        files.push(item);
      }
    }
  }

  // Filter by search
  const filteredFiles = searchInput
    ? files.filter((f) =>
        f.name.toLowerCase().includes(searchInput.toLowerCase())
      )
    : files;

  const sortedFolders = Array.from(folders).sort();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Storage</h2>
        <p className="text-muted-foreground text-sm">
          Manage files in MinIO object storage
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900">
                <HardDrive className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Files</p>
                <p className="text-2xl font-bold">
                  {loadingStats ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    stats?.totalFiles ?? 0
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900">
                <Download className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Size</p>
                <p className="text-2xl font-bold">
                  {loadingStats ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    formatBytes(stats?.totalSize ?? 0)
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900">
                <FolderOpen className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Folders</p>
                <p className="text-2xl font-bold">
                  {loadingStats ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    Object.keys(stats?.folders ?? {}).length
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Folder Stats */}
      {stats?.folders && Object.keys(stats.folders).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Folders Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {Object.entries(stats.folders)
                .sort(([, a], [, b]) => b.size - a.size)
                .map(([folder, info]) => (
                  <Badge
                    key={folder}
                    variant="secondary"
                    className="cursor-pointer hover:bg-accent"
                    onClick={() => navigateToFolder(folder)}
                  >
                    <FolderOpen className="h-3 w-3 mr-1" />
                    {folder} ({info.count} files, {formatBytes(info.size)})
                  </Badge>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upload + Search */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex gap-2 flex-1">
              <Input
                placeholder="Search files..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="max-w-sm"
              />
              {searchInput && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSearchInput("")}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <select
                value={uploadFolder}
                onChange={(e) => setUploadFolder(e.target.value)}
                className="rounded-md border px-3 py-2 text-sm bg-background"
              >
                <option value="files">files/</option>
                <option value="images/products">images/products/</option>
                <option value="images/brands">images/brands/</option>
                <option value="data">data/</option>
                <option value="backups">backups/</option>
              </select>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleUpload}
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                Upload
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  refetchFiles();
                  refetchStats();
                }}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* File Browser */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            {prefix ? (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1"
                  onClick={() => setPrefix("")}
                >
                  root
                </Button>
                {prefix
                  .split("/")
                  .filter(Boolean)
                  .map((part, i, arr) => (
                    <span key={i} className="flex items-center">
                      <span className="text-muted-foreground">/</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-1"
                        onClick={() =>
                          navigateToFolder(arr.slice(0, i + 1).join("/"))
                        }
                      >
                        {part}
                      </Button>
                    </span>
                  ))}
              </div>
            ) : (
              "All Files"
            )}
            <Badge variant="outline" className="ml-auto">
              {filesData?.total ?? 0} objects
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {prefix && (
            <Button
              variant="ghost"
              size="sm"
              className="mb-3"
              onClick={goUp}
            >
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
          )}

          {loadingFiles ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !filesData?.items.length ? (
            <p className="text-muted-foreground text-center py-8">
              No files found
            </p>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead className="hidden sm:table-cell">Modified</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Folders */}
                {sortedFolders.map((folder) => (
                  <TableRow
                    key={`folder-${folder}`}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigateToFolder(prefix + folder)}
                  >
                    <TableCell>
                      <FolderOpen className="h-4 w-4 text-yellow-500" />
                    </TableCell>
                    <TableCell className="font-medium">{folder}/</TableCell>
                    <TableCell className="text-muted-foreground">-</TableCell>
                    <TableCell className="text-muted-foreground hidden sm:table-cell">-</TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                ))}

                {/* Files */}
                {filteredFiles.map((file) => {
                  const displayName = prefix
                    ? file.name.slice(prefix.length)
                    : file.name;
                  return (
                    <TableRow key={file.name}>
                      <TableCell>{getFileIcon(file.name)}</TableCell>
                      <TableCell>
                        <button
                          className="font-mono text-xs hover:underline text-left"
                          onClick={() =>
                            isImageFile(file.name)
                              ? setPreviewFile(file)
                              : window.open(file.url, "_blank")
                          }
                        >
                          {displayName}
                        </button>
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatBytes(file.size)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground hidden sm:table-cell">
                        {formatDate(file.lastModified)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => copyUrl(file.url)}
                            title="Copy URL"
                          >
                            {copiedUrl === file.url ? (
                              <Check className="h-3 w-3 text-green-500" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => window.open(file.url, "_blank")}
                            title="Download"
                          >
                            <Download className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={() => handleDelete(file.name)}
                            disabled={deleting === file.name}
                            title="Delete"
                          >
                            {deleting === file.name ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Trash2 className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Image Preview Dialog */}
      <Dialog
        open={!!previewFile}
        onOpenChange={(open) => {
          if (!open) setPreviewFile(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm truncate">
              {previewFile?.name}
            </DialogTitle>
          </DialogHeader>
          {previewFile && (
            <div className="space-y-3">
              <div className="flex justify-center bg-muted/50 rounded-lg p-4">
                <img
                  src={previewFile.url}
                  alt={previewFile.name}
                  className="max-h-[400px] object-contain rounded"
                />
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Size</p>
                  <p>{formatBytes(previewFile.size)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Modified</p>
                  <p>{formatDate(previewFile.lastModified)}</p>
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">URL</p>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={previewFile.url}
                    className="font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyUrl(previewFile.url)}
                  >
                    {copiedUrl === previewFile.url ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => window.open(previewFile?.url, "_blank")}
            >
              <Download className="mr-2 h-4 w-4" /> Download
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (previewFile) {
                  handleDelete(previewFile.name);
                  setPreviewFile(null);
                }
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

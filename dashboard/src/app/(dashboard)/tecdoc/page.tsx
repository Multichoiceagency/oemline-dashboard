"use client";

import { useState } from "react";
import { searchTecDoc } from "@/lib/api";
import type { TecDocProduct } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, Loader2, BookOpen } from "lucide-react";

export default function TecDocPage() {
  const [query, setQuery] = useState("");
  const [searchType, setSearchType] = useState("text");
  const [articles, setArticles] = useState<TecDocProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await searchTecDoc({
        q: query.trim(),
        type: searchType,
        limit: 50,
      });
      setArticles(data.articles);
      setTotal(data.total);
      setSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "TecDoc search failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">TecDoc Search</h2>
        <p className="text-muted-foreground">
          Search the TecDoc database for article cross-references
        </p>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <Tabs value={searchType} onValueChange={setSearchType}>
            <TabsList>
              <TabsTrigger value="text">Free Text</TabsTrigger>
              <TabsTrigger value="article">Article No.</TabsTrigger>
              <TabsTrigger value="oem">OEM Number</TabsTrigger>
              <TabsTrigger value="ean">EAN</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex gap-3">
            <Input
              placeholder={
                searchType === "article"
                  ? "e.g. 1987302049, WK613..."
                  : searchType === "oem"
                  ? "e.g. 04E115561H..."
                  : searchType === "ean"
                  ? "e.g. 4009026508961..."
                  : "Search TecDoc articles..."
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="flex-1"
            />
            <Button onClick={handleSearch} disabled={loading || !query.trim()}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Search TecDoc
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-destructive">{error}</CardContent>
        </Card>
      )}

      {searched && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              Results ({total})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {articles.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                No articles found for &quot;{query}&quot; ({searchType} search)
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Article Number</TableHead>
                    <TableHead>Brand</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>TecDoc ID</TableHead>
                    <TableHead>Brand ID</TableHead>
                    <TableHead>EAN</TableHead>
                    <TableHead>OEM Numbers</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {articles.map((a, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono font-medium">{a.articleNumber}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{a.brand}</Badge>
                      </TableCell>
                      <TableCell>{a.description}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {a.tecdocId}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{a.brandId}</TableCell>
                      <TableCell className="font-mono text-xs">{a.ean || "-"}</TableCell>
                      <TableCell>
                        {a.oemNumbers.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {a.oemNumbers.slice(0, 3).map((oem, j) => (
                              <Badge key={j} variant="secondary" className="text-xs">
                                {oem}
                              </Badge>
                            ))}
                            {a.oemNumbers.length > 3 && (
                              <Badge variant="secondary" className="text-xs">
                                +{a.oemNumbers.length - 3}
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

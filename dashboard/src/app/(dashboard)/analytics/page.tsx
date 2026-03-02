"use client";

import { useState } from "react";
import { useApi } from "@/lib/hooks";
import { getMatchLogs } from "@/lib/api";
import type { MatchLogStat } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { formatDate, formatDuration, formatNumber } from "@/lib/utils";
import { BarChart3, CheckCircle2, XCircle, Clock } from "lucide-react";

const METHOD_COLORS: Record<string, string> = {
  override: "bg-purple-500",
  tecdocId: "bg-blue-500",
  ean: "bg-green-500",
  brand_article: "bg-orange-500",
  oem: "bg-yellow-500",
};

export default function AnalyticsPage() {
  const [page, setPage] = useState(1);
  const [matchFilter, setMatchFilter] = useState("all");
  const [methodFilter, setMethodFilter] = useState("all");
  const { data, loading } = useApi(
    () =>
      getMatchLogs({
        page,
        limit: 25,
        matched: matchFilter === "all" ? undefined : matchFilter,
        method: methodFilter === "all" ? undefined : methodFilter,
      }),
    [page, matchFilter, methodFilter]
  );

  const stats: MatchLogStat[] = data?.stats ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Match Analytics</h2>
        <p className="text-muted-foreground">Product matching performance and audit trail</p>
      </div>

      {/* Stats cards */}
      {stats.length > 0 && (
        <div className="grid gap-4 md:grid-cols-5">
          {stats.map((s) => (
            <Card key={s.method}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium capitalize flex items-center gap-2">
                  <div className={`h-2.5 w-2.5 rounded-full ${METHOD_COLORS[s.method] ?? "bg-gray-500"}`} />
                  {s.method.replace("_", " ")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatNumber(s.count)}</div>
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {s.avgDurationMs}ms
                  </span>
                  <span>{s.avgConfidence != null ? `${(s.avgConfidence * 100).toFixed(0)}%` : "-"} confidence</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Method Distribution */}
      {stats.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Method Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats.map((s) => {
                const totalCount = stats.reduce((sum, st) => sum + st.count, 0);
                const pct = totalCount > 0 ? (s.count / totalCount) * 100 : 0;
                return (
                  <div key={s.method} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium capitalize">{s.method.replace("_", " ")}</span>
                      <span className="text-muted-foreground">{pct.toFixed(1)}% ({formatNumber(s.count)})</span>
                    </div>
                    <div className="h-3 w-full rounded-full bg-muted">
                      <div
                        className={`h-3 rounded-full ${METHOD_COLORS[s.method] ?? "bg-gray-500"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Logs table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" /> Match Logs ({formatNumber(data?.total ?? 0)})
            </CardTitle>
            <div className="flex gap-2">
              <Select value={matchFilter} onValueChange={(v) => { setMatchFilter(v); setPage(1); }}>
                <SelectTrigger className="w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="true">Matched</SelectItem>
                  <SelectItem value="false">Unmatched</SelectItem>
                </SelectContent>
              </Select>
              <Select value={methodFilter} onValueChange={(v) => { setMethodFilter(v); setPage(1); }}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Methods</SelectItem>
                  <SelectItem value="override">Override</SelectItem>
                  <SelectItem value="tecdocId">TecDoc ID</SelectItem>
                  <SelectItem value="ean">EAN</SelectItem>
                  <SelectItem value="brand_article">Brand+Article</SelectItem>
                  <SelectItem value="oem">OEM</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground text-center py-8">Loading...</p>
          ) : !data?.items.length ? (
            <p className="text-muted-foreground text-center py-8">No match logs found</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Query</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="font-mono text-xs">{log.query}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{log.supplier?.name ?? "-"}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize">
                        {log.method.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {log.matched ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-16 rounded-full bg-muted">
                          <div
                            className="h-2 rounded-full bg-primary"
                            style={{ width: `${log.confidence * 100}%` }}
                          />
                        </div>
                        <span className="text-xs">{(log.confidence * 100).toFixed(0)}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {formatDuration(log.durationMs)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{formatDate(log.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-sm text-muted-foreground">Page {data.page} of {data.totalPages}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

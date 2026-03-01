"use client";

import { useApi, useInterval } from "@/lib/hooks";
import { getHealth, getSuppliers, getUnmatched, getMatchLogs } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/utils";
import {
  Truck,
  AlertTriangle,
  CheckCircle2,
  Database,
  Activity,
  Server,
  Search,
  Clock,
} from "lucide-react";

export default function DashboardPage() {
  const health = useApi(() => getHealth(), []);
  const suppliers = useApi(() => getSuppliers({ limit: 100 }), []);
  const unmatched = useApi(() => getUnmatched({ limit: 1, resolved: "false" }), []);
  const matchLogs = useApi(() => getMatchLogs({ limit: 1 }), []);

  useInterval(() => health.refetch(), 15000);

  const activeSuppliers = suppliers.data?.items.filter((s) => s.active).length ?? 0;
  const totalProducts = suppliers.data?.items.reduce((sum, s) => sum + (s._count?.productMaps ?? 0), 0) ?? 0;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-muted-foreground">OEMline multi-supplier parts platform overview</p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Suppliers</CardTitle>
            <Truck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeSuppliers}</div>
            <p className="text-xs text-muted-foreground">
              {suppliers.data?.total ?? 0} total registered
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Products Indexed</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(totalProducts)}</div>
            <p className="text-xs text-muted-foreground">Across all suppliers</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Unmatched Items</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(unmatched.data?.total ?? 0)}</div>
            <p className="text-xs text-muted-foreground">Pending resolution</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Match Operations</CardTitle>
            <Search className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(matchLogs.data?.total ?? 0)}</div>
            <p className="text-xs text-muted-foreground">Total match attempts</p>
          </CardContent>
        </Card>
      </div>

      {/* System Status */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5" /> Service Health
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {health.loading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : health.error ? (
              <p className="text-sm text-destructive">Failed to load: {health.error}</p>
            ) : health.data ? (
              <>
                {Object.entries(health.data.checks).map(([name, status]) => (
                  <div key={name} className="flex items-center justify-between">
                    <span className="text-sm font-medium capitalize">{name}</span>
                    <Badge variant={status === "ok" ? "success" : "destructive"}>
                      {status === "ok" ? (
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                      ) : (
                        <AlertTriangle className="mr-1 h-3 w-3" />
                      )}
                      {status}
                    </Badge>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-2 border-t">
                  <span className="text-sm font-medium">Uptime</span>
                  <span className="text-sm text-muted-foreground">
                    <Clock className="inline mr-1 h-3 w-3" />
                    {Math.floor(health.data.uptime / 3600)}h {Math.floor((health.data.uptime % 3600) / 60)}m
                  </span>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" /> Queue Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {health.loading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : health.error ? (
              <p className="text-sm text-destructive">Failed to load</p>
            ) : health.data ? (
              <>
                {Object.entries(health.data.queues).map(([queue, depth]) => (
                  <div key={queue} className="flex items-center justify-between">
                    <span className="text-sm font-medium capitalize">{queue} Queue</span>
                    <Badge variant={depth > 0 ? "warning" : "secondary"}>
                      {depth} pending
                    </Badge>
                  </div>
                ))}
                {health.data.circuits && Object.keys(health.data.circuits).length > 0 && (
                  <div className="pt-2 border-t">
                    <p className="text-sm font-medium mb-2">Circuit Breakers</p>
                    {Object.entries(health.data.circuits).map(([name, info]) => (
                      <div key={name} className="flex items-center justify-between">
                        <span className="text-sm">{name}</span>
                        <Badge
                          variant={
                            info.state === "closed"
                              ? "success"
                              : info.state === "open"
                              ? "destructive"
                              : "warning"
                          }
                        >
                          {info.state} ({info.failures} failures)
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Match Statistics */}
      {matchLogs.data?.stats && matchLogs.data.stats.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Match Performance by Method</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-5">
              {matchLogs.data.stats.map((stat) => (
                <div key={stat.method} className="space-y-1 rounded-lg border p-4">
                  <p className="text-sm font-medium capitalize">{stat.method.replace("_", " ")}</p>
                  <p className="text-2xl font-bold">{formatNumber(stat.count)}</p>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{stat.avgDurationMs}ms avg</span>
                    <span>{stat.avgConfidence != null ? `${(stat.avgConfidence * 100).toFixed(0)}%` : "-"} conf</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

"use client";

import { useApi, useInterval } from "@/lib/hooks";
import { getHealth, getSuppliers, getUnmatched, getMatchLogs, getJobsStatus } from "@/lib/api";
import type { QueueStatus } from "@/lib/api";
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
  Play,
  Pause,
  RotateCw,
} from "lucide-react";

function QueueCard({ name, status }: { name: string; status: QueueStatus }) {
  const isActive = status.active > 0;
  const hasScheduled = status.repeatableJobs > 0;
  const total = status.active + status.waiting + status.prioritized + status.wait + status.delayed;

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold capitalize">{name}</span>
        {isActive ? (
          <Badge variant="default" className="bg-green-600">
            <Play className="mr-1 h-3 w-3" /> Running
          </Badge>
        ) : hasScheduled ? (
          <Badge variant="secondary">
            <RotateCw className="mr-1 h-3 w-3" /> Scheduled
          </Badge>
        ) : (
          <Badge variant="outline">
            <Pause className="mr-1 h-3 w-3" /> Idle
          </Badge>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Active</span>
          <span className="font-mono font-medium">{status.active}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Pending</span>
          <span className="font-mono font-medium">{total - status.active}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Completed</span>
          <span className="font-mono font-medium text-green-600">{formatNumber(status.completed)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Failed</span>
          <span className={`font-mono font-medium ${status.failed > 0 ? "text-red-500" : ""}`}>{status.failed}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Delayed</span>
          <span className="font-mono font-medium">{status.delayed}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Repeatable</span>
          <span className="font-mono font-medium">{status.repeatableJobs}</span>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const health = useApi(() => getHealth(), []);
  const jobs = useApi(() => getJobsStatus(), []);
  const suppliers = useApi(() => getSuppliers({ limit: 100 }), []);
  const unmatched = useApi(() => getUnmatched({ limit: 1, resolved: "false" }), []);
  const matchLogs = useApi(() => getMatchLogs({ limit: 1 }), []);

  useInterval(() => {
    health.refetch();
    jobs.refetch();
    suppliers.refetch();
  }, 10000);

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

      {/* System Status + Queue Status */}
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
              <Activity className="h-5 w-5" /> Background Queues
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {jobs.loading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : jobs.error ? (
              <p className="text-sm text-destructive">Failed to load: {jobs.error}</p>
            ) : jobs.data ? (
              <div className="space-y-3">
                <QueueCard name="Sync" status={jobs.data.sync} />
                <QueueCard name="Match" status={jobs.data.match} />
                <QueueCard name="Index" status={jobs.data.index} />
              </div>
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

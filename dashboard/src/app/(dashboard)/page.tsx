"use client";

import { useApi, useInterval } from "@/lib/hooks";
import { getSystemStatus, getSuppliers, getUnmatched, getMatchLogs, triggerAiMatch, runAllWorkers } from "@/lib/api";
import type { QueueStatus } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WorkerAlerts } from "@/components/worker-alerts";
import { formatNumber } from "@/lib/utils";
import { useState } from "react";
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
  Brain,
  Cpu,
  Zap,
  Loader2,
  PlayCircle,
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
  // Single aggregated call replaces 3 separate calls (health + jobs + ollama)
  const status = useApi(() => getSystemStatus(), []);
  const suppliers = useApi(() => getSuppliers({ limit: 100 }), []);
  const unmatched = useApi(() => getUnmatched({ limit: 1, resolved: "false" }), []);
  const matchLogs = useApi(() => getMatchLogs({ limit: 1 }), []);

  const [aiTriggering, setAiTriggering] = useState(false);
  const [aiResult, setAiResult] = useState<"success" | "error" | null>(null);
  const [runningAll, setRunningAll] = useState(false);

  useInterval(() => {
    status.refetch();
    suppliers.refetch();
  }, 10000);

  async function handleTriggerAi() {
    setAiTriggering(true);
    setAiResult(null);
    try {
      await triggerAiMatch();
      setAiResult("success");
      setTimeout(() => setAiResult(null), 4000);
      status.refetch();
    } catch {
      setAiResult("error");
      setTimeout(() => setAiResult(null), 5000);
    } finally {
      setAiTriggering(false);
    }
  }

  async function handleRunAll() {
    setRunningAll(true);
    try {
      await runAllWorkers();
      setTimeout(() => status.refetch(), 1000);
    } finally {
      setTimeout(() => setRunningAll(false), 2000);
    }
  }

  const q = status.data?.jobs;
  const h = status.data?.health;
  const ollama = status.data?.ollama;
  const alerts = status.data?.alerts ?? [];

  const activeSuppliers = suppliers.data?.items.filter((s) => s.active).length ?? 0;
  const totalProducts = suppliers.data?.items.reduce((sum, s) => sum + (s._count?.productMaps ?? 0), 0) ?? 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-muted-foreground text-sm">OEMline multi-supplier parts platform overview</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRunAll}
          disabled={runningAll}
          className="gap-2 self-start sm:self-auto min-h-[44px] sm:min-h-0"
        >
          {runningAll ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Starting...</>
          ) : (
            <><PlayCircle className="h-3.5 w-3.5" /> Run All Workers</>
          )}
        </Button>
      </div>

      {/* Failure alerts — auto-detected from system status */}
      {alerts.length > 0 && (
        <WorkerAlerts alerts={alerts} onRetried={() => status.refetch()} />
      )}

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

      {/* Service Health */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" /> Service Health
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {status.loading && !h ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : status.error ? (
            <p className="text-sm text-destructive">Failed to load: {status.error}</p>
          ) : h ? (
            <div className="flex flex-wrap gap-4">
              {Object.entries(h.checks).map(([name, st]) => (
                <div key={name} className="flex items-center gap-2">
                  <span className="text-sm font-medium capitalize">{name}</span>
                  <Badge variant={st === "ok" ? "success" : "destructive"}>
                    {st === "ok" ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <AlertTriangle className="mr-1 h-3 w-3" />}
                    {st}
                  </Badge>
                </div>
              ))}
              <div className="flex items-center gap-2 ml-auto">
                <Clock className="h-3 w-3 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Uptime: {Math.floor(h.uptime / 3600)}h {Math.floor((h.uptime % 3600) / 60)}m
                </span>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Background Workers */}
      <div>
        <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <Activity className="h-5 w-5" /> Background Workers
        </h3>
        {status.loading && !q ? (
          <p className="text-sm text-muted-foreground">Loading workers...</p>
        ) : status.error ? (
          <p className="text-sm text-destructive">Failed to load workers: {status.error}</p>
        ) : q ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {q.sync    && <QueueCard name="Sync"     status={q.sync} />}
            {q.match   && <QueueCard name="Match"    status={q.match} />}
            {q.index   && <QueueCard name="Index"    status={q.index} />}
            {q.pricing && <QueueCard name="Pricing"  status={q.pricing} />}
            {q.stock   && <QueueCard name="Stock"    status={q.stock} />}
            {q.icMatch && <QueueCard name="IC Match" status={q.icMatch} />}
          </div>
        ) : null}
      </div>

      {/* AI Worker */}
      <Card className="border-purple-200 dark:border-purple-800">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-purple-600" /> AI Brand Alias Worker
            </CardTitle>
            <Button
              size="sm"
              variant={aiResult === "success" ? "default" : aiResult === "error" ? "destructive" : "outline"}
              onClick={handleTriggerAi}
              disabled={aiTriggering || (q?.aiMatch?.active ?? 0) > 0}
              className={aiResult === "success" ? "bg-green-600 hover:bg-green-700 border-0" : ""}
            >
              {aiTriggering ? (
                <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Queuing...</>
              ) : aiResult === "success" ? (
                <><CheckCircle2 className="mr-1 h-3 w-3" /> Queued!</>
              ) : (
                <><Zap className="mr-1 h-3 w-3" /> Run Now</>
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Discovers missing brand aliases via article number overlap + optional Ollama LLM confirmation (auto-runs every 6h)
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {q?.aiMatch && <QueueCard name="AI Match" status={q.aiMatch} />}

            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold flex items-center gap-1.5">
                  <Cpu className="h-4 w-4 text-purple-500" /> Ollama LLM
                </span>
                {status.loading && !ollama ? (
                  <Badge variant="outline"><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Checking</Badge>
                ) : ollama?.available ? (
                  <Badge variant="default" className="bg-green-600">
                    <CheckCircle2 className="mr-1 h-3 w-3" /> Online
                  </Badge>
                ) : (
                  <Badge variant="secondary">
                    <Pause className="mr-1 h-3 w-3" /> Offline
                  </Badge>
                )}
              </div>
              {ollama && (
                <div className="grid grid-cols-1 gap-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Model</span>
                    <span className="font-mono font-medium truncate max-w-[140px]">{ollama.configuredModel}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Loaded</span>
                    <span className="font-mono font-medium">
                      {ollama.loadedModels.length > 0 ? ollama.loadedModels.join(", ") : "none"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Mode</span>
                    <span className="font-medium">
                      {ollama.available ? "Phase A + B (LLM)" : "Phase A only"}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Match Statistics */}
      {matchLogs.data?.stats && matchLogs.data.stats.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Match Performance by Method</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
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

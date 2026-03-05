"use client";

import { useApi, useInterval } from "@/lib/hooks";
import { getHealth, getSuppliers, getUnmatched, getMatchLogs, getJobsStatus, getOllamaStatus, triggerAiMatch } from "@/lib/api";
import type { QueueStatus } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  const ollama = useApi(() => getOllamaStatus(), []);
  const suppliers = useApi(() => getSuppliers({ limit: 100 }), []);
  const unmatched = useApi(() => getUnmatched({ limit: 1, resolved: "false" }), []);
  const matchLogs = useApi(() => getMatchLogs({ limit: 1 }), []);
  const [aiTriggering, setAiTriggering] = useState(false);
  const [aiResult, setAiResult] = useState<"success" | "error" | null>(null);

  useInterval(() => {
    health.refetch();
    jobs.refetch();
    ollama.refetch();
    suppliers.refetch();
  }, 10000);

  async function handleTriggerAi() {
    setAiTriggering(true);
    setAiResult(null);
    try {
      await triggerAiMatch();
      setAiResult("success");
      setTimeout(() => setAiResult(null), 4000);
      jobs.refetch();
    } catch {
      setAiResult("error");
      setTimeout(() => setAiResult(null), 5000);
    } finally {
      setAiTriggering(false);
    }
  }

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

      {/* Service Health */}
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
            <div className="flex flex-wrap gap-4">
              {Object.entries(health.data.checks).map(([name, status]) => (
                <div key={name} className="flex items-center gap-2">
                  <span className="text-sm font-medium capitalize">{name}</span>
                  <Badge variant={status === "ok" ? "success" : "destructive"}>
                    {status === "ok" ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <AlertTriangle className="mr-1 h-3 w-3" />}
                    {status}
                  </Badge>
                </div>
              ))}
              <div className="flex items-center gap-2 ml-auto">
                <Clock className="h-3 w-3 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Uptime: {Math.floor(health.data.uptime / 3600)}h {Math.floor((health.data.uptime % 3600) / 60)}m
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
        {jobs.loading ? (
          <p className="text-sm text-muted-foreground">Loading workers...</p>
        ) : jobs.error ? (
          <p className="text-sm text-destructive">Failed to load workers: {jobs.error}</p>
        ) : jobs.data ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <QueueCard name="Sync" status={jobs.data.sync} />
            <QueueCard name="Match" status={jobs.data.match} />
            <QueueCard name="Index" status={jobs.data.index} />
            <QueueCard name="Pricing" status={jobs.data.pricing} />
            <QueueCard name="Stock" status={jobs.data.stock} />
            <QueueCard name="IC Match" status={jobs.data.icMatch} />
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
              disabled={aiTriggering || (jobs.data?.aiMatch.active ?? 0) > 0}
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
            Discovers missing brand aliases via article number overlap + optional Ollama LLM confirmation
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {/* Queue card */}
            {jobs.data && <QueueCard name="AI Match" status={jobs.data.aiMatch} />}

            {/* Ollama status */}
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold flex items-center gap-1.5">
                  <Cpu className="h-4 w-4 text-purple-500" /> Ollama LLM
                </span>
                {ollama.loading ? (
                  <Badge variant="outline"><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Checking</Badge>
                ) : ollama.data?.available ? (
                  <Badge variant="default" className="bg-green-600">
                    <CheckCircle2 className="mr-1 h-3 w-3" /> Online
                  </Badge>
                ) : (
                  <Badge variant="secondary">
                    <Pause className="mr-1 h-3 w-3" /> Offline
                  </Badge>
                )}
              </div>
              {ollama.data && (
                <div className="grid grid-cols-1 gap-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Model</span>
                    <span className="font-mono font-medium truncate max-w-[140px]">{ollama.data.configuredModel}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Loaded</span>
                    <span className="font-mono font-medium">
                      {ollama.data.loadedModels.length > 0 ? ollama.data.loadedModels.join(", ") : "none"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Mode</span>
                    <span className="font-medium">
                      {ollama.data.available ? "Phase A + B (LLM)" : "Phase A only"}
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

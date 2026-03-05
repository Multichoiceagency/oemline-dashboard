"use client";

import { useState } from "react";
import { useApi, useInterval } from "@/lib/hooks";
import { getHealth, getJobsStatus, getOllamaStatus, triggerAiMatch } from "@/lib/api";
import type { QueueStatus } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Database,
  Server,
  Wifi,
  Brain,
  Cpu,
  Play,
  Pause,
  RotateCw,
  Loader2,
  Zap,
} from "lucide-react";

const SERVICE_ICONS: Record<string, React.ReactNode> = {
  postgres: <Database className="h-4 w-4" />,
  redis: <Server className="h-4 w-4" />,
  meilisearch: <Wifi className="h-4 w-4" />,
};

const QUEUE_LABELS: Record<string, string> = {
  sync: "Sync",
  match: "Match",
  index: "Index",
  pricing: "Pricing",
  stock: "Stock",
  icMatch: "IC Match",
  aiMatch: "AI Match",
};

function WorkerCard({ name, status }: { name: string; status: QueueStatus }) {
  const isActive = status.active > 0;
  const hasScheduled = status.repeatableJobs > 0;
  const total = status.active + status.waiting + status.prioritized + status.wait + status.delayed;

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">{name}</span>
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
          <span className="font-mono font-medium text-green-600">{status.completed.toLocaleString()}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Failed</span>
          <span className={`font-mono font-medium ${status.failed > 0 ? "text-red-500" : ""}`}>{status.failed}</span>
        </div>
      </div>
    </div>
  );
}

export default function HealthPage() {
  const { data, error, loading, refetch } = useApi(() => getHealth(), []);
  const jobs = useApi(() => getJobsStatus(), []);
  const ollama = useApi(() => getOllamaStatus(), []);
  const [aiTriggering, setAiTriggering] = useState(false);
  const [aiResult, setAiResult] = useState<"success" | "error" | null>(null);

  useInterval(() => {
    refetch();
    jobs.refetch();
    ollama.refetch();
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

  const uptime = data?.uptime ?? 0;
  const days = Math.floor(uptime / 86400);
  const hours = Math.floor((uptime % 86400) / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = Math.floor(uptime % 60);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">System Health</h2>
        <p className="text-muted-foreground">Real-time monitoring of all platform services (auto-refreshes every 10s)</p>
      </div>

      {loading && !data ? (
        <p className="text-muted-foreground">Loading health status...</p>
      ) : error ? (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <XCircle className="h-5 w-5" />
              <span className="font-medium">API Unreachable:</span> {error}
            </div>
          </CardContent>
        </Card>
      ) : data ? (
        <>
          {/* Overall status */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Status</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  {data.status === "healthy" ? (
                    <CheckCircle2 className="h-6 w-6 text-green-500" />
                  ) : (
                    <AlertTriangle className="h-6 w-6 text-yellow-500" />
                  )}
                  <span className="text-2xl font-bold capitalize">{data.status}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Uptime</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {days > 0 && `${days}d `}{hours}h {minutes}m {seconds}s
                </div>
                <p className="text-xs text-muted-foreground">
                  Since {new Date(Date.now() - uptime * 1000).toLocaleString("nl-NL")}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Services</CardTitle>
                <Server className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {Object.values(data.checks).filter((s) => s === "ok").length}/
                  {Object.keys(data.checks).length}
                </div>
                <p className="text-xs text-muted-foreground">Services operational</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Queue Depth</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {Object.values(data.queues).reduce((sum, q) => sum + (typeof q === "number" ? q : (q.waiting + q.active)), 0)}
                </div>
                <p className="text-xs text-muted-foreground">Total active + pending jobs</p>
              </CardContent>
            </Card>
          </div>

          {/* Service details */}
          <Card>
            <CardHeader>
              <CardTitle>Service Status</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(data.checks).map(([name, status]) => (
                    <TableRow key={name}>
                      <TableCell className="font-medium flex items-center gap-2">
                        {SERVICE_ICONS[name] ?? <Server className="h-4 w-4" />}
                        <span className="capitalize">{name}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={status === "ok" ? "success" : "destructive"}>
                          {status === "ok" ? (
                            <CheckCircle2 className="mr-1 h-3 w-3" />
                          ) : (
                            <XCircle className="mr-1 h-3 w-3" />
                          )}
                          {status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {name === "postgres" && "PostgreSQL database"}
                        {name === "redis" && "Redis cache & queue broker"}
                        {name === "meilisearch" && "Meilisearch full-text search engine"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Worker cards */}
          <div>
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Activity className="h-5 w-5" /> Background Workers
            </h3>
            {jobs.loading ? (
              <p className="text-sm text-muted-foreground">Loading workers...</p>
            ) : jobs.error ? (
              <p className="text-sm text-destructive">Failed to load: {jobs.error}</p>
            ) : jobs.data ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {(Object.entries(QUEUE_LABELS) as [keyof typeof jobs.data, string][])
                  .filter(([key]) => key !== "aiMatch" && jobs.data![key])
                  .map(([key, label]) => (
                    <WorkerCard key={key} name={label} status={jobs.data![key]} />
                  ))}
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
                Discovers missing brand aliases via article number overlap + optional Ollama LLM confirmation (Phase A + B)
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                {jobs.data && <WorkerCard name="AI Match Queue" status={jobs.data.aiMatch} />}

                {/* Ollama status */}
                <div className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold flex items-center gap-1.5">
                      <Cpu className="h-4 w-4 text-purple-500" /> Ollama LLM Engine
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
                        <span className="text-muted-foreground">Ollama URL</span>
                        <span className="font-mono truncate max-w-[180px]">{ollama.data.ollamaUrl}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Configured Model</span>
                        <span className="font-mono font-medium">{ollama.data.configuredModel}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Loaded Models</span>
                        <span className="font-mono">
                          {ollama.data.loadedModels.length > 0 ? ollama.data.loadedModels.join(", ") : "none"}
                        </span>
                      </div>
                      <div className="flex justify-between pt-1 border-t">
                        <span className="text-muted-foreground">Active Mode</span>
                        <span className="font-medium text-purple-600">
                          {ollama.data.available ? "Phase A + B (with LLM)" : "Phase A only (code)"}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Circuit breakers */}
          {Object.keys(data.circuits).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Circuit Breakers</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Supplier</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead>Failures</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(data.circuits).map(([name, info]) => (
                      <TableRow key={name}>
                        <TableCell className="font-medium">{name}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              info.state === "closed"
                                ? "success"
                                : info.state === "open"
                                ? "destructive"
                                : "warning"
                            }
                          >
                            {info.state}
                          </Badge>
                        </TableCell>
                        <TableCell>{info.failures}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          <p className="text-xs text-muted-foreground text-center">
            Last updated: {new Date(data.timestamp).toLocaleString("nl-NL")}
          </p>
        </>
      ) : null}
    </div>
  );
}

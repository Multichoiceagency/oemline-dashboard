"use client";

import { useApi, useInterval } from "@/lib/hooks";
import { getJobsStatus, getOllamaStatus, getHealth } from "@/lib/api";
import type { QueueStatus } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  Brain,
  Database,
  Globe,
  Server,
  Wifi,
  HardDrive,
  Zap,
  RefreshCw,
  ArrowRight,
  CheckCircle2,
  Cpu,
  Package,
  DollarSign,
  BarChart2,
  Link2,
  ShoppingCart,
  Send,
} from "lucide-react";

/* ─── helpers ─── */
function queueBadge(q: QueueStatus | undefined) {
  if (!q) return <Badge variant="outline" className="text-[10px] h-4">–</Badge>;
  if (q.active > 0)
    return <Badge className="bg-green-600 text-[10px] h-4 animate-pulse">Running</Badge>;
  if ((q.waiting + q.prioritized) > 0)
    return <Badge variant="secondary" className="text-[10px] h-4">Queued</Badge>;
  if (q.failed > 0)
    return <Badge variant="destructive" className="text-[10px] h-4">{q.failed} failed</Badge>;
  return <Badge variant="outline" className="text-[10px] h-4">Idle</Badge>;
}

function queueDot(q: QueueStatus | undefined) {
  if (!q) return "bg-muted";
  if (q.active > 0) return "bg-green-500 animate-pulse";
  if ((q.waiting + q.prioritized) > 0) return "bg-yellow-400";
  if (q.failed > 0) return "bg-red-500";
  return "bg-gray-300 dark:bg-gray-600";
}

/* ─── building blocks ─── */
function FlowNode({
  icon: Icon,
  label,
  sublabel,
  color,
  badge,
  dot,
  small,
}: {
  icon: React.ElementType;
  label: string;
  sublabel?: string;
  color: string;
  badge?: React.ReactNode;
  dot?: string;
  small?: boolean;
}) {
  return (
    <div className={`relative flex flex-col items-center gap-1 rounded-xl border bg-card p-3 shadow-sm min-w-[120px] ${small ? "min-w-[100px] p-2" : ""}`}>
      {dot && (
        <span className={`absolute top-2 right-2 h-2 w-2 rounded-full ${dot}`} />
      )}
      <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${color}`}>
        <Icon className="h-5 w-5 text-white" />
      </div>
      <span className={`text-center font-semibold leading-tight ${small ? "text-[11px]" : "text-xs"}`}>{label}</span>
      {sublabel && <span className="text-[10px] text-muted-foreground text-center leading-tight">{sublabel}</span>}
      {badge}
    </div>
  );
}

function Arrow({ label, vertical, color = "text-muted-foreground" }: { label?: string; vertical?: boolean; color?: string }) {
  if (vertical) {
    return (
      <div className="flex flex-col items-center gap-0.5 py-1">
        <div className="h-4 w-px bg-border" />
        <ArrowRight className={`h-3 w-3 rotate-90 ${color}`} />
        {label && <span className="text-[9px] text-muted-foreground">{label}</span>}
      </div>
    );
  }
  return (
    <div className={`flex items-center gap-0.5 px-1 ${color}`}>
      {label && <span className="text-[9px] text-muted-foreground">{label}</span>}
      <ArrowRight className="h-4 w-4 shrink-0" />
    </div>
  );
}

function ColHeader({ label, color }: { label: string; color: string }) {
  return (
    <div className={`rounded-lg px-3 py-1 text-[11px] font-semibold text-white text-center ${color}`}>
      {label}
    </div>
  );
}

/* ─── main page ─── */
export default function WorkflowPage() {
  const jobs = useApi(() => getJobsStatus(), []);
  const ollama = useApi(() => getOllamaStatus(), []);
  const health = useApi(() => getHealth(), []);

  useInterval(() => {
    jobs.refetch();
    ollama.refetch();
    health.refetch();
  }, 8000);

  const q = jobs.data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Workflow Diagram</h2>
          <p className="text-muted-foreground">Live data flow — all services, workers, and storage layers</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <RefreshCw className="h-3 w-3" />
          Auto-refreshes every 8s
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        {[
          { dot: "bg-green-500 animate-pulse", label: "Running" },
          { dot: "bg-yellow-400", label: "Queued" },
          { dot: "bg-red-500", label: "Failed" },
          { dot: "bg-gray-300 dark:bg-gray-600", label: "Idle" },
        ].map(({ dot, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
            <span className="text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>

      {/* Diagram */}
      <div className="overflow-x-auto pb-4">
        <div className="min-w-[900px] space-y-6">

          {/* Column headers */}
          <div className="grid grid-cols-5 gap-3">
            <ColHeader label="External Sources" color="bg-slate-500" />
            <ColHeader label="API + Dispatcher" color="bg-blue-600" />
            <ColHeader label="Data Workers" color="bg-orange-500" />
            <ColHeader label="Enrichment Workers" color="bg-violet-600" />
            <ColHeader label="Output / Storage" color="bg-emerald-600" />
          </div>

          {/* Main flow */}
          <div className="grid grid-cols-5 gap-3 items-start">

            {/* Col 1: External Sources */}
            <div className="flex flex-col gap-3">
              <FlowNode icon={Database} label="TecDoc API" sublabel="Parts catalog" color="bg-slate-500" />
              <FlowNode icon={Zap} label="InterCars API" sublabel="OAuth2 + REST" color="bg-slate-500" />
              <FlowNode icon={HardDrive} label="Diederichs" sublabel="FTP + XLSX" color="bg-slate-500" />
            </div>

            {/* Col 1→2 arrows */}
            <div className="col-start-1 col-end-2 hidden" />
            <div className="flex flex-col gap-3 items-center pt-3">
              <Arrow />
              <Arrow />
              <Arrow />
            </div>

            {/* Re-layout: use a single grid with explicit column positions */}
            {/* We'll redo this as a proper 5-col layout below */}
          </div>

          {/* ── Better layout: proper flow diagram ── */}
          <div className="relative">
            {/* Row-based flow */}
            <div className="grid grid-cols-[1fr_24px_1fr_24px_1fr_24px_1fr_24px_1fr] gap-y-3 items-center">

              {/* ── Row: Catalog sync path ── */}
              <FlowNode icon={Database} label="TecDoc API" sublabel="Parts catalog" color="bg-slate-500" />
              <Arrow />
              <FlowNode icon={RefreshCw} label="Sync Worker" sublabel="Catalog pull" color="bg-orange-500"
                dot={queueDot(q?.sync)} badge={queueBadge(q?.sync)} />
              <Arrow />
              <FlowNode icon={Link2} label="Match Worker" sublabel="IC SKU link" color="bg-orange-600"
                dot={queueDot(q?.match)} badge={queueBadge(q?.match)} />
              <Arrow />
              <FlowNode icon={BarChart2} label="Index Worker" sublabel="Meilisearch" color="bg-orange-700"
                dot={queueDot(q?.index)} badge={queueBadge(q?.index)} />
              <Arrow />
              <FlowNode icon={Wifi} label="Meilisearch" sublabel="Search index"
                color={health.data?.checks.meilisearch === "ok" ? "bg-emerald-600" : "bg-red-500"} />

              {/* ── Row: IC pricing path ── */}
              <FlowNode icon={Zap} label="InterCars API" sublabel="OAuth2 + REST" color="bg-slate-500" />
              <Arrow />
              <FlowNode icon={Activity} label="IC Match" sublabel="Phase 0-1D" color="bg-violet-600"
                dot={queueDot(q?.icMatch)} badge={queueBadge(q?.icMatch)} />
              <Arrow />
              <FlowNode icon={DollarSign} label="Pricing Worker" sublabel="IC prices" color="bg-violet-600"
                dot={queueDot(q?.pricing)} badge={queueBadge(q?.pricing)} />
              <Arrow />
              <FlowNode icon={Package} label="Stock Worker" sublabel="IC inventory" color="bg-violet-600"
                dot={queueDot(q?.stock)} badge={queueBadge(q?.stock)} />
              <Arrow />
              <FlowNode icon={Database} label="PostgreSQL" sublabel="products + maps"
                color={health.data?.checks.postgres === "ok" ? "bg-emerald-600" : "bg-red-500"} />

              {/* ── Row: AI match path ── */}
              <FlowNode icon={Brain} label="AI Match" sublabel="Brand aliases" color="bg-purple-600"
                dot={queueDot(q?.aiMatch)} badge={queueBadge(q?.aiMatch)} />
              <Arrow label="auto" />
              <FlowNode icon={Cpu} label="Ollama LLM" sublabel={ollama.data?.configuredModel ?? "llm"} color="bg-purple-700"
                badge={
                  ollama.data?.available
                    ? <Badge className="bg-green-600 text-[10px] h-4">Online</Badge>
                    : <Badge variant="secondary" className="text-[10px] h-4">Offline</Badge>
                } />
              <Arrow />
              <FlowNode icon={Activity} label="IC Match" sublabel="re-trigger" color="bg-violet-500"
                small dot={queueDot(q?.icMatch)} />
              {/* empty cols to maintain grid alignment */}
              <div /><div /><div /><div />

              {/* ── Row: Diederichs path ── */}
              <FlowNode icon={HardDrive} label="Diederichs" sublabel="FTP + XLSX" color="bg-slate-500" />
              <Arrow />
              <FlowNode icon={RefreshCw} label="Sync Worker" sublabel="XLSX import" color="bg-orange-500"
                dot={queueDot(q?.sync)} badge={queueBadge(q?.sync)} />
              <Arrow />
              <FlowNode icon={Server} label="Redis" sublabel="Queues + cache"
                color={health.data?.checks.redis === "ok" ? "bg-emerald-600" : "bg-red-500"} />
              {/* Fillers */}
              <div /><div /><div /><div />

              {/* ── Row: Output path ── */}
              {/* Empty cols to push to right */}
              <div /><div /><div /><div />
              <FlowNode icon={ShoppingCart} label="Storefront" sublabel="oemline.eu" color="bg-emerald-600" />
              <Arrow />
              <FlowNode icon={Globe} label="Output API" sublabel="Push finalized" color="bg-blue-600" />
              <Arrow />
              <FlowNode icon={Send} label="Webhook / ERP" sublabel="Configured URL" color="bg-blue-700" />
            </div>
          </div>

          {/* Storage tier summary */}
          <div className="rounded-xl border bg-muted/40 p-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Database className="h-4 w-4" /> Shared Storage Layer
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg border bg-card p-3 flex items-center gap-3">
                <div className={`h-8 w-8 rounded flex items-center justify-center ${health.data?.checks.postgres === "ok" ? "bg-emerald-600" : "bg-red-500"}`}>
                  <Database className="h-4 w-4 text-white" />
                </div>
                <div>
                  <p className="text-xs font-semibold">PostgreSQL</p>
                  <p className="text-[10px] text-muted-foreground">Products, brands, maps, matches</p>
                </div>
              </div>
              <div className="rounded-lg border bg-card p-3 flex items-center gap-3">
                <div className={`h-8 w-8 rounded flex items-center justify-center ${health.data?.checks.redis === "ok" ? "bg-emerald-600" : "bg-red-500"}`}>
                  <Server className="h-4 w-4 text-white" />
                </div>
                <div>
                  <p className="text-xs font-semibold">Redis</p>
                  <p className="text-[10px] text-muted-foreground">BullMQ queues, sessions, cache</p>
                </div>
              </div>
              <div className="rounded-lg border bg-card p-3 flex items-center gap-3">
                <div className={`h-8 w-8 rounded flex items-center justify-center ${health.data?.checks.meilisearch === "ok" ? "bg-emerald-600" : "bg-red-500"}`}>
                  <Wifi className="h-4 w-4 text-white" />
                </div>
                <div>
                  <p className="text-xs font-semibold">Meilisearch</p>
                  <p className="text-[10px] text-muted-foreground">Full-text product search index</p>
                </div>
              </div>
              <div className="rounded-lg border bg-card p-3 flex items-center gap-3">
                <div className="h-8 w-8 rounded flex items-center justify-center bg-orange-500">
                  <HardDrive className="h-4 w-4 text-white" />
                </div>
                <div>
                  <p className="text-xs font-semibold">MinIO / S3</p>
                  <p className="text-[10px] text-muted-foreground">Images, CSVs, product assets</p>
                </div>
              </div>
            </div>
          </div>

          {/* Worker status summary bar */}
          <div className="rounded-xl border p-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Activity className="h-4 w-4" /> Live Worker Status
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              {q && (
                [
                  { key: "sync", label: "Sync", icon: RefreshCw, color: "bg-orange-500" },
                  { key: "match", label: "Match", icon: Link2, color: "bg-orange-600" },
                  { key: "icMatch", label: "IC Match", icon: Activity, color: "bg-violet-600" },
                  { key: "aiMatch", label: "AI Match", icon: Brain, color: "bg-purple-600" },
                  { key: "pricing", label: "Pricing", icon: DollarSign, color: "bg-violet-600" },
                  { key: "stock", label: "Stock", icon: Package, color: "bg-violet-600" },
                  { key: "index", label: "Index", icon: BarChart2, color: "bg-orange-700" },
                ] as const
              )?.map(({ key, label, icon: Icon, color }) => {
                const status = q[key as keyof typeof q] as QueueStatus;
                return (
                  <div key={key} className="flex flex-col items-center gap-1.5 rounded-lg border p-3">
                    <div className={`relative h-8 w-8 rounded-lg flex items-center justify-center ${color}`}>
                      <Icon className="h-4 w-4 text-white" />
                      <span className={`absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full border-2 border-background ${queueDot(status)}`} />
                    </div>
                    <span className="text-[11px] font-medium">{label}</span>
                    <div className="text-[10px] text-muted-foreground text-center">
                      <span className="text-green-600 font-mono">{status.active}</span> active
                      {" · "}
                      <span className="font-mono">{status.completed.toLocaleString()}</span> done
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

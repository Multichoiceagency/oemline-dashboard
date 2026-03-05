"use client";

import { useState } from "react";
import { AlertTriangle, XCircle, RefreshCw, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { retryFailedJobs } from "@/lib/api";
import type { SystemAlert } from "@/lib/api";

const QUEUE_LABELS: Record<string, string> = {
  sync: "Sync",
  match: "Match",
  index: "Index",
  pricing: "Pricing",
  stock: "Stock",
  icMatch: "IC Match",
  aiMatch: "AI Match",
};

export function WorkerAlerts({
  alerts,
  onRetried,
}: {
  alerts: SystemAlert[];
  onRetried?: () => void;
}) {
  const [retrying, setRetrying] = useState<Record<string, boolean>>({});
  const [collapsed, setCollapsed] = useState(false);

  if (alerts.length === 0) return null;

  const failedAlerts = alerts.filter((a) => a.type === "failed");
  const serviceAlerts = alerts.filter((a) => a.type !== "failed");

  async function handleRetry(queue: string) {
    setRetrying((r) => ({ ...r, [queue]: true }));
    try {
      await retryFailedJobs(queue);
      onRetried?.();
    } finally {
      setRetrying((r) => ({ ...r, [queue]: false }));
    }
  }

  return (
    <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 overflow-hidden">
      <div
        className="flex items-center justify-between px-4 py-2.5 cursor-pointer select-none"
        onClick={() => setCollapsed((c) => !c)}
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
          <span className="text-sm font-semibold text-red-700 dark:text-red-400">
            {alerts.length} issue{alerts.length > 1 ? "s" : ""} detected
          </span>
        </div>
        <div className="flex items-center gap-2 text-red-400">
          <span className="text-xs">{collapsed ? "show" : "hide"}</span>
          {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </div>
      </div>

      {!collapsed && (
        <div className="border-t border-red-200 dark:border-red-900 px-4 py-3 space-y-2">
          {serviceAlerts.map((a, i) => (
            <div key={i} className="flex items-center gap-2 text-sm text-red-700 dark:text-red-400">
              <XCircle className="h-3.5 w-3.5 shrink-0" />
              {a.message}
            </div>
          ))}

          {failedAlerts.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {failedAlerts.map((a) => {
                const queue = a.queue!;
                const isRetrying = retrying[queue];
                return (
                  <div
                    key={queue}
                    className="flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-800 bg-white dark:bg-red-950/50 px-2.5 py-1.5"
                  >
                    <span className="text-xs font-medium text-red-700 dark:text-red-300">
                      {QUEUE_LABELS[queue] ?? queue}: {a.count} failed
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 px-1.5 text-[10px] text-red-600 hover:text-red-700 hover:bg-red-100 dark:hover:bg-red-900"
                      onClick={() => handleRetry(queue)}
                      disabled={isRetrying}
                    >
                      {isRetrying ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <><RefreshCw className="h-3 w-3 mr-0.5" />Retry</>
                      )}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

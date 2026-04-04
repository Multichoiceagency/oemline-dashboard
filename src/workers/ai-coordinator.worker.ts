import { Job } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { llmIsAvailable, llmGenerate } from "../lib/llm.js";
import { sendWorkerNotification } from "../lib/notify.js";
import {
  syncQueue, matchQueue, indexQueue, pricingQueue, stockQueue,
  icMatchQueue, aiMatchQueue, oemEnrichQueue, icCatalogQueue,
  icEnrichQueue, icCsvSyncQueue,
} from "./queues.js";

/**
 * AI Coordinator Worker — Ollama-powered orchestration + error recovery.
 *
 * Every 30 minutes this worker:
 * 1. Collects state: queue depths, DB stats, failed jobs + their error messages
 * 2. Sends full context to Ollama (llama3.2:3b)
 * 3. Ollama recommends which workers to trigger and which errors to recover
 * 4. Auto-retries transient errors (429, timeout, network)
 * 5. Alerts via email for persistent/unrecoverable errors
 */

export interface AiCoordinatorJobData {
  dryRun?: boolean;
}

interface QueueState {
  name: string;
  active: number;
  waiting: number;
  completed: number;
  failed: number;
  delayed: number;
}

interface FailedJobInfo {
  queue: string;
  jobId: string;
  jobName: string;
  failedAt: string;
  attemptsMade: number;
  errorMessage: string;
  errorType: "rate_limit" | "auth" | "timeout" | "network" | "data" | "unknown";
}

interface PlatformState {
  queues: QueueState[];
  failedJobs: FailedJobInfo[];
  db: {
    totalProducts: number;
    productsWithIcSku: number;
    productsWithoutIcSku: number;
    productsWithPrice: number;
    productsWithoutPrice: number;
    totalIntercarsMappings: number;
    suppliersActive: number;
  };
  lastRuns: Record<string, string | null>;
}

const COORDINATOR_SYSTEM = `\
You are the OEMline platform AI coordinator. You manage a European automotive parts catalog system.

PLATFORM ARCHITECTURE:
- TecDoc adapter: syncs 1M+ automotive parts from TecDoc API
- IC CSV sync: downloads daily price/stock CSV from IC (~2 min, covers ~600K products)
- IC catalog: crawls ALL 3M+ IC products into mapping table (slow, 2-4h)
- IC match: maps TecDoc articles to IC SKUs via brand+articleNumber matching
- Match worker: rematch unmatched TecDoc products
- Pricing worker: real-time IC API price quotes
- AI match: Ollama brand alias discovery (e.g. KAYABA=KYB)
- OEM enrich: fetches OEM cross-references from TecDoc API
- Index worker: rebuilds Meilisearch search index

ORCHESTRATION RULES:
1. products_without_price > 100000 AND ic_csv_sync.active = 0 → trigger ic-csv-sync (URGENT)
2. products_without_ic_sku > 50000 AND ic_match.active = 0 → trigger ic-match
3. ic_catalog.completed = 0 AND ic_catalog.active = 0 → trigger ic-catalog
4. sync.active = 0 AND no recent sync → trigger sync
5. index.active = 0 AND sync or match recently finished → trigger index

ERROR RECOVERY RULES:
- error_type=rate_limit → retry with lower priority (IC API 429 = temporary)
- error_type=timeout → retry once (network hiccup)
- error_type=network → retry once
- error_type=data → retry with priceStockOnly=true (skip broken CSV file)
- error_type=auth → DO NOT retry, add to alerts (needs human fix)
- error_type=unknown AND attemptsMade < 2 → retry once
- error_type=unknown AND attemptsMade >= 2 → add to alerts

Respond ONLY with valid JSON (no markdown, no explanation):
{
  "actions": [
    { "worker": "ic-csv-sync", "priority": 1, "reason": "...", "params": {} }
  ],
  "retries": [
    { "queue": "ic-catalog", "jobId": "123", "reason": "...", "params": { "skipDetails": true } }
  ],
  "alerts": [
    { "queue": "pricing", "error": "...", "message": "Handmatige interventie nodig: ..." }
  ],
  "summary": "One line summary of state, actions and errors"
}

Available worker names: sync, match, index, pricing, stock, ic-match, ai-match, oem-enrich, ic-catalog, ic-enrich, ic-csv-sync`;

export async function processAiCoordinatorJob(job: Job<AiCoordinatorJobData>): Promise<void> {
  const dryRun = job.data.dryRun ?? false;
  logger.info({ dryRun }, "AI Coordinator starting");

  const state = await collectPlatformState();

  logger.info({
    failedJobs: state.failedJobs.length,
    productsWithoutPrice: state.db.productsWithoutPrice,
  }, "AI Coordinator: state collected");

  const available = await llmIsAvailable();
  if (!available) {
    logger.warn("AI Coordinator: LLM unavailable, running rule-based fallback");
    await runRuleBasedCoordinator(state, dryRun);
    return;
  }

  const statePrompt = buildStatePrompt(state);
  let response: string;
  try {
    response = await llmGenerate(statePrompt, { system: COORDINATOR_SYSTEM, temperature: 0.1 });
  } catch (err) {
    logger.warn({ err }, "AI Coordinator: LLM call failed, running fallback");
    await runRuleBasedCoordinator(state, dryRun);
    return;
  }

  let recommendations: {
    actions: Array<{ worker: string; priority: number; reason: string; params?: Record<string, unknown> }>;
    retries: Array<{ queue: string; jobId: string; reason: string; params?: Record<string, unknown> }>;
    alerts: Array<{ queue: string; error: string; message: string }>;
    summary: string;
  };

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");
    recommendations = JSON.parse(jsonMatch[0]);
  } catch (err) {
    logger.warn({ err, response: response.slice(0, 300) }, "AI Coordinator: failed to parse LLM response, fallback");
    await runRuleBasedCoordinator(state, dryRun);
    return;
  }

  logger.info({ summary: recommendations.summary, actions: recommendations.actions?.length, retries: recommendations.retries?.length, alerts: recommendations.alerts?.length }, "AI Coordinator: LLM recommendations");

  if (dryRun) {
    logger.info({ recommendations }, "AI Coordinator: dry run — skipping execution");
    return;
  }

  // Execute worker triggers
  const sorted = (recommendations.actions ?? []).slice().sort((a, b) => a.priority - b.priority);
  for (const action of sorted) {
    await triggerWorker(action.worker, action.reason, action.params);
  }

  // Execute retries
  for (const retry of recommendations.retries ?? []) {
    await retryFailedJob(retry.queue, retry.reason, retry.params);
  }

  // Send alert emails for unrecoverable errors
  for (const alert of recommendations.alerts ?? []) {
    await sendWorkerNotification({
      worker: `AI Coordinator → ${alert.queue}`,
      status: "failed",
      errorMessage: `${alert.message}\n\nOriginele fout: ${alert.error}`,
    });
    logger.warn({ queue: alert.queue, error: alert.error }, "AI Coordinator: sent error alert email");
  }

  logger.info({ actionsTriggered: sorted.length, retriesTriggered: recommendations.retries?.length ?? 0, alertsSent: recommendations.alerts?.length ?? 0 }, "AI Coordinator: completed");
}

// ── State collection ──────────────────────────────────────────────────────────

const ALL_QUEUES = [
  { name: "sync",         q: syncQueue },
  { name: "match",        q: matchQueue },
  { name: "index",        q: indexQueue },
  { name: "pricing",      q: pricingQueue },
  { name: "stock",        q: stockQueue },
  { name: "ic-match",     q: icMatchQueue },
  { name: "ai-match",     q: aiMatchQueue },
  { name: "oem-enrich",   q: oemEnrichQueue },
  { name: "ic-catalog",   q: icCatalogQueue },
  { name: "ic-enrich",    q: icEnrichQueue },
  { name: "ic-csv-sync",  q: icCsvSyncQueue },
];

async function collectPlatformState(): Promise<PlatformState> {
  const [queueStates, failedJobs, dbStats] = await Promise.all([
    Promise.all(ALL_QUEUES.map(async ({ name, q }) => {
      const counts = await q.getJobCounts("active", "waiting", "completed", "failed", "delayed").catch(() => ({
        active: 0, waiting: 0, completed: 0, failed: 0, delayed: 0,
      }));
      return { name, ...counts } as QueueState;
    })),
    collectFailedJobs(),
    collectDbStats(),
  ]);

  // Last run times
  const lastRuns: Record<string, string | null> = {};
  for (const { name, q } of ALL_QUEUES) {
    try {
      const completed = await q.getJobs(["completed"], 0, 0, false);
      lastRuns[name] = completed[0]?.finishedOn ? new Date(completed[0].finishedOn).toISOString() : null;
    } catch {
      lastRuns[name] = null;
    }
  }

  return { queues: queueStates, failedJobs, db: dbStats, lastRuns };
}

async function collectFailedJobs(): Promise<FailedJobInfo[]> {
  const results: FailedJobInfo[] = [];

  for (const { name, q } of ALL_QUEUES) {
    try {
      const failed = await q.getJobs(["failed"], 0, 20, false); // max 20 per queue
      for (const j of failed) {
        const msg = j.failedReason ?? "unknown error";
        results.push({
          queue: name,
          jobId: String(j.id),
          jobName: j.name,
          failedAt: j.finishedOn ? new Date(j.finishedOn).toISOString() : "unknown",
          attemptsMade: j.attemptsMade ?? 1,
          errorMessage: msg.slice(0, 300),
          errorType: categorizeError(msg),
        });
      }
    } catch { /* skip queue if unavailable */ }
  }

  return results;
}

function categorizeError(msg: string): FailedJobInfo["errorType"] {
  const m = msg.toLowerCase();
  if (m.includes("429") || m.includes("rate limit") || m.includes("too many requests")) return "rate_limit";
  if (m.includes("401") || m.includes("403") || m.includes("unauthorized") || m.includes("oauth") || m.includes("token")) return "auth";
  if (m.includes("timeout") || m.includes("etimedout") || m.includes("timed out")) return "timeout";
  if (m.includes("econnrefused") || m.includes("enotfound") || m.includes("network") || m.includes("fetch failed") || m.includes("econnreset")) return "network";
  if (m.includes("parse") || m.includes("csv") || m.includes("json") || m.includes("zip") || m.includes("not a zip") || m.includes("404")) return "data";
  return "unknown";
}

async function collectDbStats() {
  const [totalProducts, productsWithIcSku, productsWithPrice, totalMappings, suppliersActive] = await Promise.all([
    prisma.productMap.count(),
    prisma.productMap.count({ where: { icSku: { not: null } } }),
    prisma.productMap.count({ where: { price: { not: null }, status: "active" } }),
    prisma.$queryRawUnsafe<[{ count: bigint }]>(`SELECT COUNT(*) as count FROM intercars_mappings`).then(r => Number(r[0].count)).catch(() => 0),
    prisma.supplier.count({ where: { active: true } }),
  ]).catch(() => [0, 0, 0, 0, 0]);

  const tp = Number(totalProducts);
  const withIc = Number(productsWithIcSku);
  const withPrice = Number(productsWithPrice);
  return {
    totalProducts: tp,
    productsWithIcSku: withIc,
    productsWithoutIcSku: tp - withIc,
    productsWithPrice: withPrice,
    productsWithoutPrice: tp - withPrice,
    totalIntercarsMappings: Number(totalMappings),
    suppliersActive: Number(suppliersActive),
  };
}

function buildStatePrompt(state: PlatformState): string {
  const queueSummary = state.queues
    .map(q => `  ${q.name}: active=${q.active} waiting=${q.waiting} completed=${q.completed} failed=${q.failed}`)
    .join("\n");

  const errorSummary = state.failedJobs.length === 0
    ? "  (geen fouten)"
    : state.failedJobs.map(f =>
        `  [${f.queue}] job="${f.jobName}" type=${f.errorType} attempts=${f.attemptsMade} error="${f.errorMessage}"`
      ).join("\n");

  return `Current OEMline platform state (${new Date().toISOString()}):

QUEUE STATUS:
${queueSummary}

FAILED JOBS:
${errorSummary}

DATABASE:
  total_products: ${state.db.totalProducts.toLocaleString()}
  products_with_ic_sku: ${state.db.productsWithIcSku.toLocaleString()} (${Math.round(state.db.productsWithIcSku / Math.max(state.db.totalProducts, 1) * 100)}%)
  products_without_ic_sku: ${state.db.productsWithoutIcSku.toLocaleString()}
  products_with_price: ${state.db.productsWithPrice.toLocaleString()} (${Math.round(state.db.productsWithPrice / Math.max(state.db.totalProducts, 1) * 100)}%)
  products_without_price: ${state.db.productsWithoutPrice.toLocaleString()}
  intercars_mappings: ${state.db.totalIntercarsMappings.toLocaleString()}
  active_suppliers: ${state.db.suppliersActive}

LAST COMPLETED RUN TIMES:
${Object.entries(state.lastRuns).map(([k, v]) => `  ${k}: ${v ?? "never"}`).join("\n")}

Analyze failed jobs, recommend worker triggers AND error recovery. Respond with JSON only.`;
}

// ── Rule-based fallback ───────────────────────────────────────────────────────

async function runRuleBasedCoordinator(state: PlatformState, dryRun: boolean): Promise<void> {
  const actions: Array<{ worker: string; reason: string; params?: Record<string, unknown> }> = [];
  const alerts: Array<{ queue: string; error: string }> = [];
  const db = state.db;
  const qMap = Object.fromEntries(state.queues.map(q => [q.name, q]));

  // ── Error recovery ──────────────────────────────────────────────────────
  for (const failed of state.failedJobs) {
    logger.warn({ queue: failed.queue, errorType: failed.errorType, attempts: failed.attemptsMade, error: failed.errorMessage }, "AI Coordinator: processing failed job");

    if (failed.errorType === "auth") {
      alerts.push({ queue: failed.queue, error: failed.errorMessage });
      continue;
    }

    if (failed.attemptsMade >= 3 && failed.errorType === "unknown") {
      alerts.push({ queue: failed.queue, error: failed.errorMessage });
      continue;
    }

    // Transient errors: retry
    if (["rate_limit", "timeout", "network"].includes(failed.errorType)) {
      await retryFailedJob(failed.queue, `Auto-retry (${failed.errorType})`, {});
    }

    // Data errors: retry with safe params
    if (failed.errorType === "data") {
      const safeParams: Record<string, unknown> = failed.queue === "ic-csv-sync" ? { priceStockOnly: true } : { skipDetails: true };
      await retryFailedJob(failed.queue, `Auto-retry with safe params (${failed.errorType})`, safeParams);
    }
  }

  // ── Worker orchestration ────────────────────────────────────────────────
  if (db.productsWithoutPrice > 100_000 && qMap["ic-csv-sync"]?.active === 0 && qMap["ic-csv-sync"]?.waiting === 0) {
    actions.push({ worker: "ic-csv-sync", reason: `${db.productsWithoutPrice.toLocaleString()} producten zonder prijs` });
  }

  if (db.productsWithoutIcSku > 10_000 && qMap["ic-match"]?.active === 0 && qMap["ic-match"]?.waiting === 0) {
    actions.push({ worker: "ic-match", reason: `${db.productsWithoutIcSku.toLocaleString()} producten zonder IC SKU` });
  }

  if (qMap["ic-catalog"]?.completed === 0 && qMap["ic-catalog"]?.active === 0 && qMap["ic-catalog"]?.waiting === 0) {
    actions.push({ worker: "ic-catalog", reason: "IC catalog nooit gecrawld", params: { skipDetails: true } });
  }

  if (db.productsWithoutPrice > 50_000 && qMap["pricing"]?.active === 0 && qMap["pricing"]?.waiting === 0) {
    actions.push({ worker: "pricing", reason: `${db.productsWithoutPrice.toLocaleString()} IC-producten hebben nog geen prijs` });
  }

  logger.info({ actions: actions.length, alerts: alerts.length, dryRun }, "AI Coordinator: rule-based recommendations");
  if (dryRun) return;

  for (const action of actions) {
    await triggerWorker(action.worker, action.reason, action.params);
  }

  for (const alert of alerts) {
    await sendWorkerNotification({
      worker: `AI Coordinator → ${alert.queue}`,
      status: "failed",
      errorMessage: `Automatisch herstel niet mogelijk.\n\nFout: ${alert.error}\n\nControleer de omgevingsvariabelen en API-credentials voor de ${alert.queue} worker.`,
    });
  }
}

// ── Worker trigger ────────────────────────────────────────────────────────────

async function triggerWorker(workerName: string, reason: string, params: Record<string, unknown> = {}): Promise<void> {
  logger.info({ worker: workerName, reason }, "AI Coordinator: triggering worker");
  try {
    switch (workerName) {
      case "ic-csv-sync":
        await icCsvSyncQueue.add("ai-coord-ic-csv-sync", { priceStockOnly: params.priceStockOnly ?? false }, { priority: 1 });
        break;
      case "ic-match":
        await icMatchQueue.add("ai-coord-ic-match", {}, { priority: 2 });
        break;
      case "ic-catalog":
        await icCatalogQueue.add("ai-coord-ic-catalog", { skipDetails: params.skipDetails ?? true, ...params }, { priority: 3 });
        break;
      case "pricing":
        await pricingQueue.add("ai-coord-pricing", {}, { priority: 2 });
        break;
      case "match":
        await matchQueue.add("ai-coord-match", {}, { priority: 2 });
        break;
      case "ai-match":
        await aiMatchQueue.add("ai-coord-ai-match", {}, { priority: 3 });
        break;
      case "oem-enrich":
        await oemEnrichQueue.add("ai-coord-oem-enrich", { batchSize: 100, maxProducts: 50_000 }, { priority: 3 });
        break;
      case "ic-enrich":
        await icEnrichQueue.add("ai-coord-ic-enrich", { mode: "full", maxEnrich: 10_000, parallelism: 5 }, { priority: 3 });
        break;
      case "index":
        await indexQueue.add("ai-coord-index", {}, { priority: 4 });
        break;
      case "sync":
        await syncQueue.add("ai-coord-sync", {}, { priority: 2 });
        break;
      case "stock":
        await stockQueue.add("ai-coord-stock", {}, { priority: 2 });
        break;
      default:
        logger.warn({ worker: workerName }, "AI Coordinator: unknown worker, skipping");
    }
  } catch (err) {
    logger.error({ err, worker: workerName }, "AI Coordinator: failed to trigger worker");
  }
}

async function retryFailedJob(queueName: string, reason: string, params: Record<string, unknown> = {}): Promise<void> {
  logger.info({ queue: queueName, reason }, "AI Coordinator: retrying failed job");
  // Re-trigger by adding a fresh job — BullMQ failed jobs aren't auto-moved back
  await triggerWorker(queueName, reason, params);
}

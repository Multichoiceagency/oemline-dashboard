import { Job } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { llmIsAvailable, llmGenerate } from "../lib/llm.js";
import {
  syncQueue, matchQueue, indexQueue, pricingQueue, stockQueue,
  icMatchQueue, aiMatchQueue, oemEnrichQueue, icCatalogQueue,
  icEnrichQueue, icCsvSyncQueue,
} from "./queues.js";

/**
 * AI Coordinator Worker — Ollama-powered orchestration of all workers.
 *
 * Every 30 minutes this worker:
 * 1. Collects real-time state: queue depths, DB stats, last-run times
 * 2. Sends the full context to Ollama (llama3.2:3b)
 * 3. Ollama recommends which workers to trigger and why
 * 4. The coordinator executes those recommendations
 *
 * This replaces manual scheduling decisions with intelligent prioritization.
 */

export interface AiCoordinatorJobData {
  dryRun?: boolean; // if true: log recommendations but don't execute
}

interface QueueState {
  name: string;
  active: number;
  waiting: number;
  completed: number;
  failed: number;
  delayed: number;
}

interface PlatformState {
  queues: QueueState[];
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
- TecDoc adapter: syncs 1M+ automotive parts from TecDoc API into our DB
- IC (InterCars) matching: maps TecDoc article numbers to IC SKUs via CSV (565K rows) + API catalog (3M+ products)
- IC CSV sync: downloads daily price/stock CSV from IC (fast, ~2 min, covers all IC products)
- Pricing worker: real-time IC API price quotes (slower, covers active IC products)
- Match worker: rematch TecDoc products against IC catalog
- AI match worker: Ollama-powered brand alias discovery (e.g. KAYABA=KYB)
- OEM enrich: fetches OEM cross-references from TecDoc API
- IC catalog: crawls ALL 3M+ IC products into our mapping table (slow, 2-4h)
- IC enrich: deep enrichment of IC SKU details via IC API
- Index worker: rebuilds Meilisearch search index

DECISION RULES:
1. If products_without_price > 100000 AND ic_csv_sync.completed < 1 → trigger ic-csv-sync (URGENT)
2. If products_without_price > 100000 AND ic_csv_sync.completed >= 1 → trigger pricing
3. If products_without_ic_sku > 50000 AND ic_match.active = 0 → trigger ic-match
4. If ic_catalog.completed = 0 AND ic_catalog.active = 0 → trigger ic-catalog (important for growing coverage)
5. If any_queue.failed > 0 → note it but don't re-trigger (humans should check)
6. If sync.active = 0 AND last_sync > 4h ago → trigger sync
7. If index.active = 0 AND (sync or match recently completed) → trigger index

Respond ONLY with valid JSON in this format (no markdown, no explanation):
{
  "actions": [
    { "worker": "ic-csv-sync", "priority": 1, "reason": "835K products missing price, CSV not run yet" },
    { "worker": "ic-match", "priority": 2, "reason": "50K products still need IC SKU assignment" }
  ],
  "summary": "One line summary of current state and actions taken"
}

Available worker names: sync, match, index, pricing, stock, ic-match, ai-match, oem-enrich, ic-catalog, ic-enrich, ic-csv-sync`;

export async function processAiCoordinatorJob(job: Job<AiCoordinatorJobData>): Promise<void> {
  const dryRun = job.data.dryRun ?? false;

  logger.info({ dryRun }, "AI Coordinator starting");

  // ── Step 1: Collect state ─────────────────────────────────────────────
  const state = await collectPlatformState();
  logger.info({ state }, "AI Coordinator: platform state collected");

  // ── Step 2: Ask Ollama ────────────────────────────────────────────────
  const available = await llmIsAvailable();
  if (!available) {
    logger.warn("AI Coordinator: LLM unavailable, running rule-based fallback");
    await runRuleBasedCoordinator(state, dryRun);
    return;
  }

  const statePrompt = buildStatePrompt(state);
  let response: string;
  try {
    response = await llmGenerate(statePrompt, {
      system: COORDINATOR_SYSTEM,
      temperature: 0.1,
    });
  } catch (err) {
    logger.warn({ err }, "AI Coordinator: LLM call failed, running fallback");
    await runRuleBasedCoordinator(state, dryRun);
    return;
  }

  // ── Step 3: Parse & execute recommendations ───────────────────────────
  let recommendations: { actions: Array<{ worker: string; priority: number; reason: string }>; summary: string };
  try {
    // Extract JSON from response (model may add preamble)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");
    recommendations = JSON.parse(jsonMatch[0]);
  } catch (err) {
    logger.warn({ err, response: response.slice(0, 300) }, "AI Coordinator: failed to parse LLM response, running fallback");
    await runRuleBasedCoordinator(state, dryRun);
    return;
  }

  logger.info({ summary: recommendations.summary, actions: recommendations.actions }, "AI Coordinator: LLM recommendations");

  if (dryRun) {
    logger.info("AI Coordinator: dry run — skipping execution");
    return;
  }

  // Execute recommendations sorted by priority
  const sorted = recommendations.actions.slice().sort((a, b) => a.priority - b.priority);
  for (const action of sorted) {
    await triggerWorker(action.worker, action.reason);
  }

  logger.info({ actionsTriggered: sorted.length }, "AI Coordinator: completed");
}

// ── State collection ──────────────────────────────────────────────────────

async function collectPlatformState(): Promise<PlatformState> {
  const queues = [
    { name: "sync",       q: syncQueue },
    { name: "match",      q: matchQueue },
    { name: "index",      q: indexQueue },
    { name: "pricing",    q: pricingQueue },
    { name: "stock",      q: stockQueue },
    { name: "ic-match",   q: icMatchQueue },
    { name: "ai-match",   q: aiMatchQueue },
    { name: "oem-enrich", q: oemEnrichQueue },
    { name: "ic-catalog", q: icCatalogQueue },
    { name: "ic-enrich",  q: icEnrichQueue },
    { name: "ic-csv-sync",q: icCsvSyncQueue },
  ];

  const queueStates = await Promise.all(
    queues.map(async ({ name, q }) => {
      const counts = await q.getJobCounts("active", "waiting", "completed", "failed", "delayed").catch(() => ({
        active: 0, waiting: 0, completed: 0, failed: 0, delayed: 0,
      }));
      return { name, ...counts } as QueueState;
    })
  );

  // DB stats
  const [
    totalProducts,
    productsWithIcSku,
    productsWithPrice,
    totalMappings,
    suppliersActive,
  ] = await Promise.all([
    prisma.productMap.count(),
    prisma.productMap.count({ where: { icSku: { not: null } } }),
    prisma.productMap.count({ where: { price: { not: null }, status: "active" } }),
    prisma.$queryRawUnsafe<[{ count: bigint }]>(`SELECT COUNT(*) as count FROM intercars_mappings`).then(r => Number(r[0].count)).catch(() => 0),
    prisma.supplier.count({ where: { active: true } }),
  ]).catch(() => [0, 0, 0, 0, 0]);

  const tp = Number(totalProducts);
  const withIc = Number(productsWithIcSku);
  const withPrice = Number(productsWithPrice);

  // Last run times from BullMQ completed jobs (approximate)
  const lastRuns: Record<string, string | null> = {};
  for (const { name, q } of queues) {
    try {
      const completed = await q.getJobs(["completed"], 0, 0, false);
      const latest = completed[0];
      lastRuns[name] = latest?.finishedOn ? new Date(latest.finishedOn).toISOString() : null;
    } catch {
      lastRuns[name] = null;
    }
  }

  return {
    queues: queueStates,
    db: {
      totalProducts: tp,
      productsWithIcSku: withIc,
      productsWithoutIcSku: tp - withIc,
      productsWithPrice: withPrice,
      productsWithoutPrice: tp - withPrice,
      totalIntercarsMappings: Number(totalMappings),
      suppliersActive: Number(suppliersActive),
    },
    lastRuns,
  };
}

function buildStatePrompt(state: PlatformState): string {
  const queueSummary = state.queues
    .map(q => `  ${q.name}: active=${q.active} waiting=${q.waiting} completed=${q.completed} failed=${q.failed}`)
    .join("\n");

  return `Current OEMline platform state (${new Date().toISOString()}):

QUEUE STATUS:
${queueSummary}

DATABASE:
  total_products: ${state.db.totalProducts.toLocaleString()}
  products_with_ic_sku: ${state.db.productsWithIcSku.toLocaleString()} (${Math.round(state.db.productsWithIcSku / state.db.totalProducts * 100)}%)
  products_without_ic_sku: ${state.db.productsWithoutIcSku.toLocaleString()}
  products_with_price: ${state.db.productsWithPrice.toLocaleString()} (${Math.round(state.db.productsWithPrice / state.db.totalProducts * 100)}%)
  products_without_price: ${state.db.productsWithoutPrice.toLocaleString()}
  intercars_mappings: ${state.db.totalIntercarsMappings.toLocaleString()}
  active_suppliers: ${state.db.suppliersActive}

LAST COMPLETED RUN TIMES:
${Object.entries(state.lastRuns).map(([k, v]) => `  ${k}: ${v ?? "never"}`).join("\n")}

What workers should be triggered now? Respond with JSON only.`;
}

// ── Rule-based fallback (when Ollama unavailable) ─────────────────────────

async function runRuleBasedCoordinator(state: PlatformState, dryRun: boolean): Promise<void> {
  const actions: Array<{ worker: string; reason: string }> = [];
  const db = state.db;
  const qMap = Object.fromEntries(state.queues.map(q => [q.name, q]));

  // IC CSV sync — fastest way to get prices, run if >100K products need pricing
  if (db.productsWithoutPrice > 100_000 && qMap["ic-csv-sync"]?.active === 0 && qMap["ic-csv-sync"]?.waiting === 0) {
    actions.push({ worker: "ic-csv-sync", reason: `${db.productsWithoutPrice.toLocaleString()} products without price` });
  }

  // IC Match — if many products missing IC SKU
  if (db.productsWithoutIcSku > 10_000 && qMap["ic-match"]?.active === 0 && qMap["ic-match"]?.waiting === 0) {
    actions.push({ worker: "ic-match", reason: `${db.productsWithoutIcSku.toLocaleString()} products without IC SKU` });
  }

  // IC Catalog — if never run
  if (qMap["ic-catalog"]?.completed === 0 && qMap["ic-catalog"]?.active === 0 && qMap["ic-catalog"]?.waiting === 0) {
    actions.push({ worker: "ic-catalog", reason: "IC catalog never crawled — needed to expand from 565K to 3M+ mappings" });
  }

  // Pricing — if we have many IC-matched products but no price
  if (db.productsWithIcSku > 0 && db.productsWithoutPrice > 50_000 && qMap["pricing"]?.active === 0) {
    actions.push({ worker: "pricing", reason: `${db.productsWithIcSku.toLocaleString()} products have IC SKU but need pricing update` });
  }

  logger.info({ actions, dryRun }, "AI Coordinator: rule-based recommendations");
  if (dryRun) return;

  for (const action of actions) {
    await triggerWorker(action.worker, action.reason);
  }
}

// ── Worker trigger ────────────────────────────────────────────────────────

async function triggerWorker(workerName: string, reason: string): Promise<void> {
  logger.info({ worker: workerName, reason }, "AI Coordinator: triggering worker");

  try {
    switch (workerName) {
      case "ic-csv-sync":
        await icCsvSyncQueue.add("ai-coord-ic-csv-sync", { priceStockOnly: false }, { priority: 1 });
        break;
      case "ic-match":
        // Trigger for all active suppliers
        await icMatchQueue.add("ai-coord-ic-match", {}, { priority: 2 });
        break;
      case "ic-catalog":
        await icCatalogQueue.add("ai-coord-ic-catalog", { skipDetails: true }, { priority: 3 });
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
        await icEnrichQueue.add("ai-coord-ic-enrich", { mode: "full", maxEnrich: 10_000, parallelism: 10 }, { priority: 3 });
        break;
      case "index":
        await indexQueue.add("ai-coord-index", {}, { priority: 4 });
        break;
      case "sync":
        await syncQueue.add("ai-coord-sync", {}, { priority: 2 });
        break;
      default:
        logger.warn({ worker: workerName }, "AI Coordinator: unknown worker name, skipping");
    }
  } catch (err) {
    logger.error({ err, worker: workerName }, "AI Coordinator: failed to trigger worker");
  }
}

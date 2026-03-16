import { Job } from "bullmq";
import { logger } from "../../lib/logger.js";
import { runParallelMatching } from "./parallel-matcher.js";
import { runParallelPricing } from "./parallel-pricing.js";
import { runPipelineSync } from "./pipeline-sync.js";

interface SwarmJobData {
  type: "full-sync" | "matching-only" | "pricing-only" | "sync-and-match";
  supplierCode?: string;
  cursor?: string;
}

interface SwarmResult {
  type: string;
  phases: {
    sync?: { totalProcessed: number; durationMs: number };
    matching?: { totalMatches: number; durationMs: number };
    pricing?: { totalUpdated: number; durationMs: number };
  };
  totalDurationMs: number;
  speedup: string;
}

/**
 * Full swarm orchestration: runs sync → matching → pricing in optimized order.
 * Uses parallel execution within each phase for maximum throughput.
 */
export async function runFullSwarm(
  supplierCode = "intercars",
  cursor?: string,
  onProgress?: (phase: string, progress: number) => void
): Promise<SwarmResult> {
  const startTime = Date.now();
  
  logger.info({ supplierCode }, "Starting full swarm orchestration");

  const result: SwarmResult = {
    type: "full-sync",
    phases: {},
    totalDurationMs: 0,
    speedup: "",
  };

  // Phase 1: Pipeline Sync (for non-IC suppliers)
  if (supplierCode !== "intercars") {
    const syncStart = Date.now();
    const syncResult = await runPipelineSync(supplierCode, cursor, (processed) => {
      if (onProgress) onProgress("sync", processed);
    });
    result.phases.sync = {
      totalProcessed: syncResult.totalProcessed,
      durationMs: Date.now() - syncStart,
    };
  }

  // Phase 2: Parallel IC Matching (all phases run concurrently)
  if (supplierCode === "intercars") {
    const matchResult = await runParallelMatching();
    result.phases.matching = {
      totalMatches: matchResult.totalMatches,
      durationMs: matchResult.totalDurationMs,
    };
    if (onProgress) onProgress("matching", matchResult.totalMatches);
  }

  // Phase 3: Parallel Pricing (5 concurrent API batches)
  const pricingResult = await runParallelPricing(supplierCode);
  result.phases.pricing = {
    totalUpdated: pricingResult.totalUpdated,
    durationMs: pricingResult.durationMs,
  };
  if (onProgress) onProgress("pricing", pricingResult.totalUpdated);

  result.totalDurationMs = Date.now() - startTime;

  // Calculate estimated speedup based on parallelization
  const matchingSpeedup = result.phases.matching ? "4x" : "1x";
  const pricingSpeedup = `${pricingResult.parallelWorkers}x`;
  result.speedup = `Matching: ${matchingSpeedup}, Pricing: ${pricingSpeedup}`;

  logger.info({
    supplierCode,
    result,
    throughput: {
      matching: result.phases.matching 
        ? Math.round((result.phases.matching.totalMatches / (result.phases.matching.durationMs / 1000)) * 60) + " matches/min"
        : "N/A",
      pricing: result.phases.pricing
        ? Math.round((result.phases.pricing.totalUpdated / (result.phases.pricing.durationMs / 1000)) * 60) + " updates/min"
        : "N/A",
    },
  }, "Full swarm completed");

  return result;
}

/**
 * Matching-only swarm: runs parallel IC matching without sync or pricing.
 */
export async function runMatchingSwarm(): Promise<SwarmResult> {
  const startTime = Date.now();
  
  logger.info("Starting matching-only swarm");

  const matchResult = await runParallelMatching();

  const result: SwarmResult = {
    type: "matching-only",
    phases: {
      matching: {
        totalMatches: matchResult.totalMatches,
        durationMs: matchResult.totalDurationMs,
      },
    },
    totalDurationMs: Date.now() - startTime,
    speedup: "4x (parallel phases)",
  };

  logger.info({ result }, "Matching swarm completed");
  return result;
}

/**
 * Pricing-only swarm: runs parallel pricing without sync or matching.
 */
export async function runPricingSwarm(supplierCode = "intercars"): Promise<SwarmResult> {
  const startTime = Date.now();
  
  logger.info({ supplierCode }, "Starting pricing-only swarm");

  const pricingResult = await runParallelPricing(supplierCode);

  const result: SwarmResult = {
    type: "pricing-only",
    phases: {
      pricing: {
        totalUpdated: pricingResult.totalUpdated,
        durationMs: pricingResult.durationMs,
      },
    },
    totalDurationMs: Date.now() - startTime,
    speedup: `${pricingResult.parallelWorkers}x (parallel API batches)`,
  };

  logger.info({ result }, "Pricing swarm completed");
  return result;
}

/**
 * Combined sync+match for non-IC suppliers that need both.
 */
export async function runSyncAndMatchSwarm(
  supplierCode: string,
  cursor?: string
): Promise<SwarmResult> {
  const startTime = Date.now();
  
  logger.info({ supplierCode }, "Starting sync+match swarm");

  const result: SwarmResult = {
    type: "sync-and-match",
    phases: {},
    totalDurationMs: 0,
    speedup: "",
  };

  // Run sync and matching in parallel (for different data sets)
  const [syncResult, matchResult] = await Promise.all([
    runPipelineSync(supplierCode, cursor),
    supplierCode === "intercars" ? runParallelMatching() : Promise.resolve(null),
  ]);

  result.phases.sync = {
    totalProcessed: syncResult.totalProcessed,
    durationMs: syncResult.durationMs,
  };

  if (matchResult) {
    result.phases.matching = {
      totalMatches: matchResult.totalMatches,
      durationMs: matchResult.totalDurationMs,
    };
  }

  result.totalDurationMs = Date.now() - startTime;
  result.speedup = "2x (parallel sync+match)";

  logger.info({ result }, "Sync+match swarm completed");
  return result;
}

/**
 * BullMQ job processor for swarm orchestration.
 */
export async function processSwarmJob(job: Job<SwarmJobData>): Promise<SwarmResult> {
  const { type, supplierCode = "intercars", cursor } = job.data;

  const onProgress = async (phase: string, progress: number) => {
    await job.updateProgress({ phase, progress });
    try { await job.extendLock(job.token!, 600_000); } catch { /* ok */ }
  };

  switch (type) {
    case "full-sync":
      return runFullSwarm(supplierCode, cursor, onProgress);
    case "matching-only":
      return runMatchingSwarm();
    case "pricing-only":
      return runPricingSwarm(supplierCode);
    case "sync-and-match":
      return runSyncAndMatchSwarm(supplierCode, cursor);
    default:
      throw new Error(`Unknown swarm type: ${type}`);
  }
}

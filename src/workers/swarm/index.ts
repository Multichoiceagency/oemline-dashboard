// Swarm-based parallel workers for optimized product sync and enrichment
export { runParallelMatching, runPhase0, runPhase1A, runPhase1B, runPhase1C, runPhase1D } from "./parallel-matcher.js";
export { runParallelPricing, runParallelStock } from "./parallel-pricing.js";
export { runPipelineSync, processPipelineSyncJob } from "./pipeline-sync.js";
export { 
  runFullSwarm, 
  runMatchingSwarm, 
  runPricingSwarm, 
  runSyncAndMatchSwarm,
  processSwarmJob 
} from "./orchestrator.js";

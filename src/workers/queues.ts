import { Queue } from "bullmq";
import { redisConfig } from "../lib/redis.js";

const connection = {
  host: redisConfig.host,
  port: redisConfig.port,
  password: redisConfig.password,
  db: redisConfig.db,
  maxRetriesPerRequest: null,
};

export const syncQueue = new Queue("sync", {
  connection,
  defaultJobOptions: {
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
  },
});

export const matchQueue = new Queue("match", {
  connection,
  defaultJobOptions: {
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 1000 },
    attempts: 2,
    backoff: { type: "fixed", delay: 2000 },
  },
});

export const pricingQueue = new Queue("pricing", {
  connection,
  defaultJobOptions: {
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
    attempts: 2,
    backoff: { type: "fixed", delay: 3000 },
  },
});

export const stockQueue = new Queue("stock", {
  connection,
  defaultJobOptions: {
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
    attempts: 2,
    backoff: { type: "fixed", delay: 3000 },
  },
});

export const indexQueue = new Queue("index", {
  connection,
  defaultJobOptions: {
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 200 },
    attempts: 3,
    backoff: { type: "exponential", delay: 3000 },
  },
});

// Dedicated queue for IC product matching (Phase 0-1D only, fast ~2 min jobs)
// Completely separate from TecDoc sync to avoid resource contention
export const icMatchQueue = new Queue("ic-match", {
  connection,
  defaultJobOptions: {
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 100 },
    attempts: 3,
    backoff: { type: "exponential", delay: 10000 },
  },
});

// AI-assisted brand alias discovery (article overlap analysis + optional Ollama LLM)
// Runs every 12h — discovers new supplier_brand_rules entries → more IC matches
export const aiMatchQueue = new Queue("ai-match", {
  connection,
  defaultJobOptions: {
    removeOnComplete: { count: 20 },
    removeOnFail: { count: 50 },
    attempts: 1,
  },
});

// Brand sync: TecDoc getBrands + logo fetch + cleanup (every 24h)
export const brandQueue = new Queue("brand", {
  connection,
  defaultJobOptions: {
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 20 },
    attempts: 3,
    backoff: { type: "exponential", delay: 10_000 },
  },
});

// Push finalized products to configured output API (manual or auto after index)
export const pushQueue = new Queue("push", {
  connection,
  defaultJobOptions: {
    removeOnComplete: { count: 20 },
    removeOnFail: { count: 50 },
    attempts: 2,
    backoff: { type: "exponential", delay: 10_000 },
  },
});

// OEM enrichment: fetch OEM cross-references from TecDoc API for unmatched products
export const oemEnrichQueue = new Queue("oem-enrich", {
  connection,
  defaultJobOptions: {
    removeOnComplete: { count: 20 },
    removeOnFail: { count: 50 },
    attempts: 2,
    backoff: { type: "exponential", delay: 30_000 },
  },
});

// IC catalog sync: crawl all 3M+ products from IC API into intercars_mappings
// Replaces the 565K CSV with full API coverage for maximum IC matching
export const icCatalogQueue = new Queue("ic-catalog", {
  connection,
  defaultJobOptions: {
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 20 },
    attempts: 2,
    backoff: { type: "exponential", delay: 60_000 },
  },
});

// IC enrichment: fix article numbers, SKU detail lookups, brand aliases, aggressive matching
// Runs after IC catalog sync to maximize match rate toward 100%
export const icEnrichQueue = new Queue("ic-enrich", {
  connection,
  defaultJobOptions: {
    removeOnComplete: { count: 20 },
    removeOnFail: { count: 50 },
    attempts: 2,
    backoff: { type: "exponential", delay: 30_000 },
  },
});

// IC CSV sync: download daily CSVs (ProductInfo, Pricing, Stock) from IC HTTPS endpoint
// Replaces API-based pricing/stock for IC — zero rate limiting, complete data in ~2 minutes
export const icCsvSyncQueue = new Queue("ic-csv-sync", {
  connection,
  defaultJobOptions: {
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 20 },
    attempts: 3,
    backoff: { type: "exponential", delay: 60_000 },
  },
});

// Swarm orchestration queue: parallel sync, matching, and pricing
// Replaces sequential workers with 4-5x faster parallel execution
export const swarmQueue = new Queue("swarm", {
  connection,
  defaultJobOptions: {
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 100 },
    attempts: 2,
    backoff: { type: "exponential", delay: 30_000 },
  },
});

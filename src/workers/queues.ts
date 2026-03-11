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

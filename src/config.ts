import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  API_KEY: z.string().min(1),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default("redis://localhost:6379"),

  MEILI_URL: z.string().default("http://localhost:7700"),
  MEILI_MASTER_KEY: z.string().min(1),

  // Supplier credentials are now stored encrypted in DB
  // These are only used as fallback for initial setup
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;

export const CACHE_TTL = {
  TECDOC: 86400,
  SEARCH: 600,
  PRICING: 120,
  STOCK: 60,
} as const;

export const MATCH_TIMEOUT_MS = 1500;

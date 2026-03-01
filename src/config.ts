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

  // TecDoc
  TECDOC_API_KEY: z.string().default(""),
  TECDOC_API_URL: z.string().default("https://webservice.tecalliance.services/pegasus-3-0/services/TecdocToCatDLB.jsonEndpoint"),

  // InterCars OAuth2 (used for initial setup, then stored encrypted in DB)
  INTERCARS_TOKEN_URL: z.string().default("https://is.webapi.intercars.eu/oauth2/token"),
  INTERCARS_API_URL: z.string().default("https://api.webapi.intercars.eu/ic"),
  INTERCARS_CLIENT_ID: z.string().default(""),
  INTERCARS_CLIENT_SECRET: z.string().default(""),
  INTERCARS_CUSTOMER_ID: z.string().default(""),
  INTERCARS_PAYER_ID: z.string().default(""),
  INTERCARS_BRANCH: z.string().default(""),

  // MinIO / S3
  MINIO_ENDPOINT: z.string().default("minio.oemline.eu"),
  MINIO_PORT: z.coerce.number().default(443),
  MINIO_USE_SSL: z.string().default("true"),
  MINIO_ACCESS_KEY: z.string().default(""),
  MINIO_SECRET_KEY: z.string().default(""),
  MINIO_BUCKET: z.string().default("oemline"),
  MINIO_PUBLIC_URL: z.string().default("https://minio.oemline.eu"),
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

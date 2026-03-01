import Fastify from "fastify";
import crypto from "node:crypto";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import { config } from "./config.js";
import { logger } from "./lib/logger.js";
import { disconnectPrisma, validateConnection } from "./lib/prisma.js";
import { disconnectRedis, redis } from "./lib/redis.js";
import { ensureProductsIndex } from "./lib/meilisearch.js";
import { healthRoutes } from "./routes/health.js";
import { searchRoutes } from "./routes/search.js";
import { overrideRoutes } from "./routes/override.js";
import { logsRoutes } from "./routes/logs.js";
import { supplierRoutes } from "./routes/suppliers.js";
import { tecdocRoutes } from "./routes/tecdoc.js";
import { productRoutes } from "./routes/products.js";
import { brandRoutes } from "./routes/brands.js";
import { categoryRoutes } from "./routes/categories.js";
import { loadAdaptersFromDb } from "./adapters/registry.js";

const app = Fastify({
  logger: {
    level: config.NODE_ENV === "development" ? "debug" : "info",
    transport:
      config.NODE_ENV === "development"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  },
  genReqId: () => crypto.randomUUID(),
  trustProxy: true,
  requestTimeout: 15_000,
  bodyLimit: 1_048_576,
});

await app.register(cors, { origin: true });
await app.register(helmet, { contentSecurityPolicy: false });
await app.register(sensible);
await app.register(rateLimit, {
  max: 100,
  timeWindow: "1 minute",
  redis,
  keyGenerator: (req) => {
    return (req.headers["x-api-key"] as string) || req.ip;
  },
});

app.addHook("onRequest", async (request, reply) => {
  const path = request.url;
  if (path === "/health") return;

  const apiKey = request.headers["x-api-key"];
  if (!apiKey || apiKey !== config.API_KEY) {
    return reply.code(401).send({ error: "Unauthorized", message: "Invalid or missing API key" });
  }
});

app.addHook("onResponse", (request, reply, done) => {
  request.log.info(
    {
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      responseTime: reply.elapsedTime,
      reqId: request.id,
    },
    "request completed"
  );
  done();
});

await app.register(healthRoutes);
await app.register(supplierRoutes, { prefix: "/api" });
await app.register(searchRoutes, { prefix: "/api" });
await app.register(overrideRoutes, { prefix: "/api" });
await app.register(logsRoutes, { prefix: "/api" });
await app.register(tecdocRoutes, { prefix: "/api" });
await app.register(productRoutes, { prefix: "/api" });
await app.register(brandRoutes, { prefix: "/api" });
await app.register(categoryRoutes, { prefix: "/api" });

app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
  request.log.error({ err: error, reqId: request.id }, "Request error");
  const statusCode = error.statusCode ?? 500;
  reply.code(statusCode).send({
    error: statusCode >= 500 ? "Internal Server Error" : error.message,
    statusCode,
    reqId: request.id,
  });
});

async function shutdown() {
  logger.info("Shutting down...");
  await app.close();
  await disconnectRedis();
  await disconnectPrisma();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

try {
  await validateConnection();

  await Promise.race([
    ensureProductsIndex(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Meilisearch init timeout")), 10_000)
    ),
  ]).catch((err) => {
    logger.warn({ err }, "Meilisearch init failed — starting without search index");
  });

  await loadAdaptersFromDb().catch((err) => {
    logger.warn({ err }, "Failed to load adapters from DB — no suppliers active");
  });

  await app.listen({ port: config.PORT, host: config.HOST });
  logger.info(`Server running on ${config.HOST}:${config.PORT}`);
} catch (err) {
  logger.error(err);
  process.exit(1);
}

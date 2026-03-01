import IORedis from "ioredis";
import { config } from "../config.js";

function parseRedisUrl(url: string): { host: string; port: number; password?: string; db?: number } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname || "localhost",
    port: parseInt(parsed.port || "6379", 10),
    password: parsed.password || undefined,
    db: parsed.pathname ? parseInt(parsed.pathname.slice(1), 10) || 0 : 0,
  };
}

export const redisConfig = parseRedisUrl(config.REDIS_URL);

export const redis = new IORedis.default(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy(times: number) {
    if (times > 10) return null;
    return Math.min(times * 200, 2000);
  },
});

redis.on("error", (err: Error) => {
  console.error("[Redis] Connection error:", err.message);
});

export async function disconnectRedis(): Promise<void> {
  await redis.quit();
}

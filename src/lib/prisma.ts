import { PrismaClient } from "@prisma/client";
import { config } from "../config.js";
import { logger } from "./logger.js";

const url = new URL(config.DATABASE_URL);
url.searchParams.set("connection_limit", "20");
url.searchParams.set("pool_timeout", "10");

export const prisma = new PrismaClient({
  datasourceUrl: url.toString(),
  log: config.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});

export async function validateConnection(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info("Database connection validated");
  } catch (err) {
    logger.error({ err }, "Database connection failed");
    throw err;
  }
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import crypto from "node:crypto";
import { redis } from "../lib/redis.js";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { sendVerificationCode } from "../lib/email.js";
import { createToken, verifyToken } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";

const RATE_LIMIT_PREFIX = "auth:rate:";
const CODE_PREFIX = "auth:code:";
const GLOBAL_RATE_PREFIX = "auth:global:";
const MAX_CODE_ATTEMPTS = 5;
const RATE_LIMIT_SECONDS = 60;
const GLOBAL_RATE_LIMIT = 20; // max 20 code requests per minute globally

/**
 * Resolve the set of allowed emails.
 * 1. Check AUTH_ALLOWED_EMAILS env var
 * 2. Fallback to settings table key "auth_allowed_emails"
 * 3. If both empty → no one can log in (secure default)
 */
async function getAllowedEmails(): Promise<Set<string>> {
  if (config.AUTH_ALLOWED_EMAILS) {
    return new Set(
      config.AUTH_ALLOWED_EMAILS.split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
    );
  }

  try {
    const row = await prisma.setting.findUnique({
      where: { key: "auth_allowed_emails" },
    });
    if (row?.value) {
      return new Set(
        row.value
          .split(",")
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean)
      );
    }
  } catch {
    // Settings table may not exist yet
  }

  return new Set();
}

/**
 * Normalize email: lowercase, trim, validate structure.
 * Security: prevents case-based bypass and whitespace injection.
 */
function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export async function authRoutes(app: FastifyInstance) {
  // ─── POST /auth/send-code ─── Request a verification code
  app.post("/auth/send-code", async (request, reply) => {
    const bodySchema = z.object({
      email: z
        .string()
        .email()
        .max(254) // RFC 5321 max email length
        .transform(normalizeEmail),
    });

    const parseResult = bodySchema.safeParse(request.body);
    if (!parseResult.success) {
      // Don't leak validation details
      return { message: "If this email is authorized, a code has been sent." };
    }

    const { email } = parseResult.data;

    // Global rate limit: prevent mass enumeration / abuse
    const globalKey = `${GLOBAL_RATE_PREFIX}${Math.floor(Date.now() / 60000)}`;
    const globalCount = await redis.incr(globalKey);
    if (globalCount === 1) await redis.expire(globalKey, 120);
    if (globalCount > GLOBAL_RATE_LIMIT) {
      logger.warn({ ip: request.ip }, "Global auth rate limit hit");
      return reply
        .code(429)
        .send({ error: "Too many requests. Please try again later." });
    }

    // Per-email rate limit: 1 code per 60 seconds
    const rateKey = `${RATE_LIMIT_PREFIX}${email}`;
    const existing = await redis.get(rateKey);
    if (existing) {
      return reply
        .code(429)
        .send({ error: "Please wait before requesting a new code." });
    }

    // Check whitelist (after rate limiting to prevent timing-based enumeration)
    const allowed = await getAllowedEmails();
    if (allowed.size === 0) {
      // No whitelist configured → deny all (fail secure)
      logger.warn("No AUTH_ALLOWED_EMAILS configured — login disabled");
      return { message: "If this email is authorized, a code has been sent." };
    }

    if (!allowed.has(email)) {
      // Return same response + set rate limit (prevents enumeration via timing)
      await redis.set(rateKey, "1", "EX", RATE_LIMIT_SECONDS);
      return { message: "If this email is authorized, a code has been sent." };
    }

    // Generate cryptographically secure 6-digit code
    const code = String(crypto.randomInt(100000, 999999));

    // Store code in Redis with TTL
    const codeKey = `${CODE_PREFIX}${email}`;
    await redis.set(
      codeKey,
      JSON.stringify({ code, attempts: 0 }),
      "EX",
      config.AUTH_CODE_TTL
    );
    await redis.set(rateKey, "1", "EX", RATE_LIMIT_SECONDS);

    // Send verification email
    try {
      await sendVerificationCode(email, code);
    } catch (err) {
      logger.error({ err, email }, "Failed to send verification email");
      // Clean up code on send failure
      await redis.del(codeKey);
      return reply.code(500).send({ error: "Failed to send verification email." });
    }

    return { message: "If this email is authorized, a code has been sent." };
  });

  // ─── POST /auth/verify-code ─── Verify the code and get a session token
  app.post("/auth/verify-code", async (request, reply) => {
    const bodySchema = z.object({
      email: z
        .string()
        .email()
        .max(254)
        .transform(normalizeEmail),
      code: z
        .string()
        .regex(/^\d{6}$/, "Code must be exactly 6 digits"),
    });

    const parseResult = bodySchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({ error: "Invalid request." });
    }

    const { email, code } = parseResult.data;
    const codeKey = `${CODE_PREFIX}${email}`;

    const stored = await redis.get(codeKey);
    if (!stored) {
      // Deliberate: no distinction between "no code" and "expired"
      return reply.code(401).send({ error: "Invalid or expired code." });
    }

    let parsed: { code: string; attempts: number };
    try {
      parsed = JSON.parse(stored);
    } catch {
      await redis.del(codeKey);
      return reply.code(401).send({ error: "Invalid or expired code." });
    }

    // Brute-force protection: max attempts before code is invalidated
    if (parsed.attempts >= MAX_CODE_ATTEMPTS) {
      await redis.del(codeKey);
      logger.warn({ email }, "Auth code invalidated after too many attempts");
      return reply
        .code(401)
        .send({ error: "Too many attempts. Please request a new code." });
    }

    // Constant-time comparison to prevent timing attacks on code verification
    const codeMatch =
      code.length === parsed.code.length &&
      crypto.timingSafeEqual(
        Buffer.from(code, "utf8"),
        Buffer.from(parsed.code, "utf8")
      );

    if (!codeMatch) {
      // Increment attempts
      await redis.set(
        codeKey,
        JSON.stringify({ code: parsed.code, attempts: parsed.attempts + 1 }),
        "EX",
        config.AUTH_CODE_TTL
      );
      const remaining = MAX_CODE_ATTEMPTS - parsed.attempts - 1;
      return reply.code(401).send({
        error:
          remaining > 0
            ? `Invalid code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
            : "Too many attempts. Please request a new code.",
      });
    }

    // Code is valid — clean up and issue token
    await redis.del(codeKey);

    const token = createToken(email);

    logger.info({ email }, "User authenticated successfully");

    return {
      token,
      email,
      expiresIn: config.AUTH_SESSION_TTL,
    };
  });

  // ─── GET /auth/session ─── Validate current session token
  app.get("/auth/session", async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "No token provided." });
    }

    const token = authHeader.slice(7);

    // Length sanity check: tokens should be < 1KB
    if (token.length > 1024) {
      return reply.code(401).send({ error: "Invalid token." });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return reply.code(401).send({ error: "Invalid or expired session." });
    }

    return {
      email: payload.email,
      valid: true,
      exp: payload.exp,
    };
  });
}

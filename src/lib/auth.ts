import crypto from "node:crypto";
import { config } from "../config.js";

/**
 * Derives a signing key from API_KEY using HKDF-like approach.
 * This ensures the auth secret is distinct from the API key itself.
 */
function getSigningKey(): Buffer {
  return crypto
    .createHmac("sha256", "oemline-dashboard-auth-v1")
    .update(config.API_KEY)
    .digest();
}

export interface TokenPayload {
  email: string;
  iat: number;
  exp: number;
}

/**
 * Creates an HMAC-SHA256 signed token containing email and expiry.
 * Format: base64url(payload).base64url(signature)
 *
 * Security properties:
 * - HMAC-SHA256 prevents tampering (forgery requires server secret)
 * - Expiry timestamp prevents indefinite token reuse
 * - iat (issued-at) enables future revocation by timestamp
 */
export function createToken(email: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = {
    email: email.toLowerCase(),
    iat: now,
    exp: now + config.AUTH_SESSION_TTL,
  };

  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", getSigningKey())
    .update(data)
    .digest("base64url");

  return `${data}.${signature}`;
}

/**
 * Verifies an HMAC-SHA256 signed token.
 *
 * Security:
 * - Uses timingSafeEqual to prevent timing side-channel attacks
 * - Validates expiry before returning payload
 * - Returns null on ANY failure (no error type leakage)
 */
export function verifyToken(token: string): TokenPayload | null {
  if (typeof token !== "string") return null;

  const dotIndex = token.indexOf(".");
  if (dotIndex === -1 || dotIndex === 0 || dotIndex === token.length - 1) {
    return null;
  }

  const data = token.slice(0, dotIndex);
  const signature = token.slice(dotIndex + 1);

  // Validate signature format (must be base64url)
  if (!/^[A-Za-z0-9_-]+$/.test(data) || !/^[A-Za-z0-9_-]+$/.test(signature)) {
    return null;
  }

  const expectedSig = crypto
    .createHmac("sha256", getSigningKey())
    .update(data)
    .digest("base64url");

  // Constant-time comparison to prevent timing attacks
  const sigBuf = Buffer.from(signature, "utf8");
  const expectedBuf = Buffer.from(expectedSig, "utf8");

  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const decoded = Buffer.from(data, "base64url").toString("utf8");
    const payload = JSON.parse(decoded) as TokenPayload;

    // Validate required fields
    if (
      typeof payload.email !== "string" ||
      typeof payload.exp !== "number" ||
      typeof payload.iat !== "number"
    ) {
      return null;
    }

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) return null;

    // Sanity: iat should not be in the future (clock skew tolerance: 60s)
    if (payload.iat > now + 60) return null;

    return payload;
  } catch {
    return null;
  }
}

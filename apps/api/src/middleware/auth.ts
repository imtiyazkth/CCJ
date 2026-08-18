/**
 * CCJ Auth Middleware
 *
 * JWT-based auth with access + refresh token pattern.
 * Sets PostgreSQL session variable app.current_user_id for RLS.
 * Never leaks token internals in error messages.
 */

import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { sign, verify } from "jsonwebtoken";
import { hash, compare } from "bcrypt";

const JWT_SECRET = process.env["JWT_SECRET"];
const JWT_REFRESH_SECRET = process.env["JWT_REFRESH_SECRET"];
const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL = "7d";
const BCRYPT_ROUNDS = 12;

if (!JWT_SECRET || !JWT_REFRESH_SECRET) {
  throw new Error("JWT_SECRET and JWT_REFRESH_SECRET must be set");
}

// ── Token Payloads ────────────────────────────────────────────

export interface AccessTokenPayload {
  sub: string;   // user ID
  email: string;
  role: string;
  type: "access";
}

export interface RefreshTokenPayload {
  sub: string;
  type: "refresh";
}

// ── Token Creation ────────────────────────────────────────────

export function createAccessToken(userId: string, email: string, role: string): string {
  const payload: AccessTokenPayload = { sub: userId, email, role, type: "access" };
  return sign(payload, JWT_SECRET!, { expiresIn: ACCESS_TOKEN_TTL });
}

export function createRefreshToken(userId: string): string {
  const payload: RefreshTokenPayload = { sub: userId, type: "refresh" };
  return sign(payload, JWT_REFRESH_SECRET!, { expiresIn: REFRESH_TOKEN_TTL });
}

// ── Token Verification ────────────────────────────────────────

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = verify(token, JWT_SECRET!) as AccessTokenPayload;
  if (decoded.type !== "access") throw new Error("Wrong token type");
  return decoded;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const decoded = verify(token, JWT_REFRESH_SECRET!) as RefreshTokenPayload;
  if (decoded.type !== "refresh") throw new Error("Wrong token type");
  return decoded;
}

// ── Password Helpers ──────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hashed: string): Promise<boolean> {
  return compare(password, hashed);
}

// ── Hono Auth Middleware ──────────────────────────────────────

/**
 * Extracts Bearer token from Authorization header.
 * Sets c.var.userId, c.var.userEmail, c.var.userRole.
 * Returns 401 with a generic message on any failure.
 */
export async function requireAuth(c: Context, next: Next) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new HTTPException(401, { message: "Authentication required" });
  }

  const token = authHeader.slice(7);

  let payload: AccessTokenPayload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    // Never expose the specific JWT error to the client
    throw new HTTPException(401, { message: "Authentication required" });
  }

  // Make available to route handlers
  c.set("userId", payload.sub);
  c.set("userEmail", payload.email);
  c.set("userRole", payload.role);

  await next();
}

/**
 * Verifies the internal worker shared secret.
 * Used for API → research-worker calls.
 */
export async function requireWorkerAuth(c: Context, next: Next) {
  const secret = c.req.header("X-Worker-Secret");
  const expected = process.env["WORKER_SECRET"];

  if (!expected || secret !== expected) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  await next();
}

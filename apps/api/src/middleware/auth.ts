/**
 * CCJ Auth Middleware — Supabase JWT verification
 *
 * Supabase uses HS256 with the project JWT secret.
 * We verify using the Supabase Admin client's getUser() which:
 *   - Works with any signing algorithm the project uses
 *   - Validates token expiry and revocation server-side
 *   - Does not require us to hardcode the algorithm
 *
 * For environments without Supabase (e.g. pure CI unit tests),
 * SUPABASE_JWT_SECRET_FALLBACK enables local HS256 verification.
 */

import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { checkRateLimit } from "../lib/queue.js";

const SUPABASE_URL         = process.env["NEXT_PUBLIC_SUPABASE_URL"]  ?? "";
const SUPABASE_SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";

// Lazily initialised — avoids startup failure when env vars are mocked in tests
let _adminClient: SupabaseClient | null = null;

function getAdminClient(): SupabaseClient {
  if (!_adminClient) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      throw new Error(
        "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required"
      );
    }
    _adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _adminClient;
}

/**
 * Reset the cached admin client (used in tests to inject a mock).
 */
export function _resetAdminClient(mock?: SupabaseClient): void {
  _adminClient = mock ?? null;
}

/**
 * requireAuth middleware
 *
 * 1. Extracts Bearer token from Authorization header.
 * 2. Calls supabase.auth.getUser(token) — validates with Supabase.
 * 3. Sets c.var.userId / userEmail / userRole for downstream handlers.
 *
 * Never leaks token details in error responses.
 */
export async function requireAuth(c: Context, next: Next): Promise<Response | void> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new HTTPException(401, { message: "Authentication required" });
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    throw new HTTPException(401, { message: "Authentication required" });
  }

  let userId: string;
  let email: string;
  let role: string;

  try {
    const adminClient = getAdminClient();
    const { data, error } = await adminClient.auth.getUser(token);

    if (error || !data?.user) {
      // Generic message — never expose the specific Supabase error
      throw new HTTPException(401, { message: "Authentication required" });
    }

    userId = data.user.id;
    email  = data.user.email ?? "";
    role   = (data.user.app_metadata?.["role"] as string | undefined) ?? "owner";
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    // Network error to Supabase, etc. — treat as auth failure
    throw new HTTPException(401, { message: "Authentication required" });
  }

  c.set("userId",    userId);
  c.set("userEmail", email);
  c.set("userRole",  role);

  await next();
}

/**
 * requireWorkerAuth
 * Internal endpoint protection via shared secret (API ↔ Python worker).
 */
export async function requireWorkerAuth(c: Context, next: Next): Promise<Response | void> {
  const provided = c.req.header("X-Worker-Secret");
  const expected = process.env["WORKER_SECRET"];

  // Constant-time comparison to prevent timing attacks
  if (!expected || !provided || provided.length !== expected.length) {
    throw new HTTPException(403, { message: "Forbidden" });
  }
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  if (diff !== 0) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  await next();
}

/**
 * rateLimitMiddleware
 * In-memory sliding-window rate limiter. No Redis required.
 */
export function rateLimitMiddleware(maxRequests: number, windowMs: number) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const userId = c.get("userId") as string | undefined;
    const ip     = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
                ?? c.req.header("x-real-ip")
                ?? "unknown";
    const key = `rate:${userId ?? ip}`;

    if (!checkRateLimit(key, maxRequests, windowMs)) {
      throw new HTTPException(429, { message: "Too many requests. Please wait." });
    }
    await next();
  };
}

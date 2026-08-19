/**
 * CCJ Auth Routes — Supabase Auth only
 *
 * POST /api/auth/logout  — client-side signout confirmation
 * GET  /api/auth/me      — return verified user from token
 *
 * Login and token refresh are handled entirely client-side by
 * the Supabase JS SDK. The API only verifies tokens it receives.
 * No password handling here.
 */

import { Hono } from "hono";
import { requireAuth } from "../middleware/auth.js";

export function authRouter() {
  const router = new Hono<{
    Variables: { userId: string; userEmail: string; userRole: string };
  }>();

  /**
   * GET /api/auth/me
   * Returns the authenticated user's identity from the verified JWT.
   * Useful for the web app to confirm a token is still valid.
   */
  router.get("/me", requireAuth, (c) =>
    c.json({
      success: true,
      data: {
        id:    c.get("userId"),
        email: c.get("userEmail"),
        role:  c.get("userRole"),
      },
    })
  );

  /**
   * POST /api/auth/logout
   * Supabase sessions are invalidated client-side via supabase.auth.signOut().
   * This endpoint exists for audit logging or server-side session tracking.
   * Returns 200 regardless — the client should already have cleared its token.
   */
  router.post("/logout", requireAuth, (c) =>
    c.json({ success: true, data: { loggedOut: true } })
  );

  return router;
}

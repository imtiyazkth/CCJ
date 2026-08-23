import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";
import { getDb } from "./db.server";
import { users } from "@ccj/db/schema";

let _admin: ReturnType<typeof createClient> | null = null;

function getAdmin() {
  if (_admin) return _admin;
  _admin = createClient(
    process.env["NEXT_PUBLIC_SUPABASE_URL"]!,
    process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  return _admin;
}

/**
 * Verify JWT and ensure public.users row exists.
 * The auth trigger may not fire for users created before it was installed.
 * This is the safety net — idempotent, runs on every protected request.
 */
export async function requireUser(req: NextRequest): Promise<User> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    throw new Response(
      JSON.stringify({ success: false, error: { message: "Authentication required" } }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const token = auth.slice(7);
  const { data, error } = await getAdmin().auth.getUser(token);

  if (error || !data.user) {
    throw new Response(
      JSON.stringify({ success: false, error: { message: "Authentication required" } }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const user = data.user;

  // Ensure public.users row exists — FK guard
  // ON CONFLICT DO NOTHING = safe to call on every request
  try {
    const db = getDb();
    await db.insert(users).values({
      id:            user.id,
      email:         user.email ?? "",
      name:          (user.user_metadata?.["name"] as string | undefined)
                     ?? user.email?.split("@")[0]
                     ?? "User",
      role:          "owner",
      uiLocale:      "en",
      emailVerified: user.email_confirmed_at != null,
    }).onConflictDoNothing();
  } catch {
    // Non-fatal — if users table insert fails, let the main query fail with a clear error
  }

  return user;
}

export function ok<T>(data: T, status = 200) {
  return Response.json({ success: true, data }, { status });
}

export function err(message: string, status = 400) {
  return Response.json({ success: false, error: { message } }, { status });
}

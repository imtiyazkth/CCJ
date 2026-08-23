import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";

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
  return data.user;
}

export function ok<T>(data: T, status = 200) {
  return Response.json({ success: true, data }, { status });
}

export function err(message: string, status = 400) {
  return Response.json({ success: false, error: { message } }, { status });
}

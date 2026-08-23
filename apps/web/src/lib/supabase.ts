"use client";

import { createBrowserClient } from "@supabase/ssr";

const SUPABASE_URL   = process.env["NEXT_PUBLIC_SUPABASE_URL"]   ?? "";
const SUPABASE_ANON  = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] ?? "";

export const supabaseConfigured =
  SUPABASE_URL.startsWith("https://") && SUPABASE_ANON.length > 20;

export function createSupabaseBrowserClient() {
  if (!supabaseConfigured) return null as any;
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON);
}

  process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";

/**
 * Gets a fresh Supabase access token on every call.
 * Never reads from React state — avoids race conditions and stale tokens.
 */
async function getFreshToken(): Promise<string | undefined> {
  if (!supabaseConfigured) return undefined;
  try {
    const sb = createSupabaseBrowserClient();
    // refreshSession() renews an expired token automatically
    const { data } = await sb.auth.getSession();
    if (data.session?.expires_at) {
      const expiresIn = data.session.expires_at - Math.floor(Date.now() / 1000);
      if (expiresIn < 60) {
        const { data: refreshed } = await sb.auth.refreshSession();
        return refreshed.session?.access_token;
      }
    }
    return data.session?.access_token;
  } catch {
    return undefined;
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { token?: string } = {}
): Promise<{ data: T | null; error: string | null }> {
  const { token: providedToken, ...rest } = options;

  // Always use fresh token — fall back to provided token if fetch fails
  const token = providedToken ?? (await getFreshToken());

  if (!token) {
    return { data: null, error: "Not authenticated. Please sign in." };
  }

  try {
    const res = await fetch(path, {
      ...rest,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(rest.headers as Record<string, string> | undefined),
      },
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      return {
        data: null,
        error: json.error?.message ?? `Request failed (${res.status})`,
      };
    }
    return { data: json.data as T, error: null };
  } catch (err) {
    return { data: null, error: `Network error: ${String(err)}` };
  }
}

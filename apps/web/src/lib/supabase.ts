"use client";

import { createBrowserClient } from "@supabase/ssr";

const SUPABASE_URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "";
const SUPABASE_ANON_KEY = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] ?? "";

export const supabaseConfigured =
  SUPABASE_URL.startsWith("https://") && SUPABASE_ANON_KEY.length > 20;

/** Browser-side Supabase client (use in Client Components) */
export function createSupabaseBrowserClient() {
  if (!supabaseConfigured) {
    // Return a no-op stub — app will show setup page instead of crashing
    return null as any;
  }
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

/** API base URL */
export const API_URL =
  process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";

/** Fetch wrapper that attaches the Supabase access token */
export async function apiFetch<T>(
  path: string,
  options: RequestInit & { token?: string } = {}
): Promise<{ data: T | null; error: string | null }> {
  const { token, ...fetchOptions } = options;
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...fetchOptions,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...fetchOptions.headers,
      },
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      return { data: null, error: json.error?.message ?? `HTTP ${res.status}` };
    }
    return { data: json.data as T, error: null };
  } catch (err) {
    return { data: null, error: String(err) };
  }
}

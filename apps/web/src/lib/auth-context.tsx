"use client";

import {
  createContext, useContext, useEffect, useState, useCallback,
} from "react";
import type { User, Session, AuthChangeEvent } from "@supabase/supabase-js";
import { createSupabaseBrowserClient, supabaseConfigured } from "./supabase";

interface AuthContextValue {
  user:       User | null;
  session:    Session | null;
  loading:    boolean;
  configured: boolean;
  token:      string | null;
  signIn:  (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,    setUser]    = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabaseConfigured) { setLoading(false); return; }
    const sb = createSupabaseBrowserClient();

    void sb.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = sb.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      }
    );
    return () => subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<string | null> => {
    if (!supabaseConfigured) return "Supabase not configured";
    const sb = createSupabaseBrowserClient();
    const { error } = await sb.auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  }, []);

  const signOut = useCallback(async () => {
    if (!supabaseConfigured) return;
    const sb = createSupabaseBrowserClient();
    await sb.auth.signOut();
    setUser(null);
    setSession(null);
  }, []);

  return (
    <AuthContext.Provider value={{
      user, session, loading,
      configured: supabaseConfigured,
      token: session?.access_token ?? null,
      signIn, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

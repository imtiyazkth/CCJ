"use client";
import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/lib/i18n";
import { Spinner } from "@/components/ui";

export default function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  // Unwrap the params promise using React's use() hook
  const { locale } = use(params);
  
  const { signIn, user, loading } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace(`/${locale}/dashboard`);
  }, [user, loading, router, locale]);

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner size="lg" />
    </div>
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const err = await signIn(email, password);
    if (err) { 
      setError(t("auth.errors.invalidCredentials")); 
      setSubmitting(false);
    } else {
      router.push(`/${locale}/dashboard`);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center">
             {/* Logo placeholder */}
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{t("app.name")}</h1>
          <p className="text-sm text-gray-500">{t("app.tagline")}</p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">{t("auth.signIn")}</h2>

          {error && (
            <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
               {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
                placeholder="you@example.com" autoComplete="email" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Password</label>
              <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
                placeholder="••••••••" autoComplete="current-password" />
            </div>
            <button type="submit" disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">
              {submitting && <Spinner size="sm" />}
              {submitting ? t("common.loading") : t("auth.signInButton")}
            </button>
          </form>

          <p className="mt-4 text-center text-sm text-gray-500">
            Don&apos;t have an account?{" "}
            <a href={`/${locale}/auth/signup`}
              className="font-medium text-blue-600 hover:underline">
              Sign up
            </a>
          </p>

          <div className="mt-4 rounded-md bg-amber-50 border border-amber-200 p-3">
            <p className="text-xs font-semibold text-amber-800">{t("project.demoNotice")}</p>
            <p className="text-xs text-amber-700 font-mono mt-0.5">demo@ccj.app</p>
            <p className="text-xs text-amber-700 font-mono">Demo@CCJ2026!</p>
          </div>
        </div>
      </div>
    </div>
  );
}


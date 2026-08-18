"use client";
import { use, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth-context";
import { Spinner } from "../../components/ui";

export default function LocaleRootPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (user) router.replace(`/${locale}/dashboard`);
    else router.replace(`/${locale}/auth/login`);
  }, [user, loading, router, locale]);

  return <div className="flex min-h-screen items-center justify-center"><Spinner size="lg" /></div>;
}

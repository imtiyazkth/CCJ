"use client";
import { use } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Spinner } from "@/components/ui";

export default function LocaleRootPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = use(params);
  const { user, loading, configured } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!configured) {
      router.replace(`/${locale}/setup`);
    } else if (user) {
      router.replace(`/${locale}/dashboard`);
    } else {
      router.replace(`/${locale}/auth/login`);
    }
  }, [user, loading, configured, router, locale]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner size="lg" />
    </div>
  );
}

"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth-context";
import { Spinner } from "../../components/ui";

export default function LocaleRootPage({ params }: { params: { locale: string } }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (user) router.replace(`/${params.locale}/dashboard`);
    else router.replace(`/${params.locale}/auth/login`);
  }, [user, loading, router, params.locale]);

  return <div className="flex min-h-screen items-center justify-center"><Spinner size="lg" /></div>;
}

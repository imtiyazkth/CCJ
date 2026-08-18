"use client";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../../lib/auth-context";
import { useTranslation } from "../../../lib/i18n";
import { apiFetch } from "../../../lib/supabase";
import { Spinner, EmptyState, ErrorBanner } from "../../../components/ui";
import type { Project } from "@ccj/types";

export default function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const { user, token, loading, signOut } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace(`/${locale}/auth/login`);
  }, [user, loading]);

  useEffect(() => {
    if (!token) return;
    apiFetch<Project[]>("/api/projects", { token }).then(({ data, error: e }) => {
      if (e) setError(e); else setProjects(data ?? []);
      setFetching(false);
    });
  }, [token]);

  if (loading || fetching) return (
    <div className="flex min-h-screen items-center justify-center"><Spinner size="lg" /></div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white text-sm font-bold">C</div>
            <span className="font-semibold text-gray-900">{t("app.name")}</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-gray-500 sm:block">{user?.email}</span>
            <button onClick={() => signOut()} className="text-sm text-gray-500 hover:text-gray-800">
              {t("auth.signOut")}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t("nav.projects")}</h1>
            <p className="text-sm text-gray-500 mt-1">{t("app.description")}</p>
          </div>
          <Link href={`/${locale}/projects/new`}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            + {t("project.create")}
          </Link>
        </div>

        {error && <ErrorBanner message={error} />}

        {projects.length === 0 && !error ? (
          <EmptyState icon="📂" title={t("project.noProjects")} body={t("app.description")} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => <ProjectCard key={p.id} project={p} locale={locale} t={t} />)}
          </div>
        )}
      </main>
    </div>
  );
}

function ProjectCard({ project, locale, t }: {
  project: Project; locale: string; t: (k: string) => string;
}) {
  const statusColor = {
    draft: "bg-gray-100 text-gray-600",
    active: "bg-green-100 text-green-700",
    archived: "bg-gray-200 text-gray-500",
  }[project.status];

  return (
    <Link href={`/${locale}/projects/${project.id}`}
      className="group block rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow-md">
      <div className="mb-3 flex items-start justify-between gap-2">
        <h2 className="font-semibold text-gray-900 line-clamp-2 group-hover:text-blue-700">{project.title}</h2>
        <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${statusColor}`}>
          {t(`project.status.${project.status}`)}
        </span>
      </div>
      {project.description && (
        <p className="text-sm text-gray-500 line-clamp-2">{project.description}</p>
      )}
      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs text-gray-400 uppercase">{project.locales?.projectLocale ?? "en"}</span>
        <time className="text-xs text-gray-400">{new Date(project.updatedAt).toLocaleDateString()}</time>
      </div>
    </Link>
  );
}

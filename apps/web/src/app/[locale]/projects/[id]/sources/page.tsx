"use client";
/**
 * Sources page — /projects/[id]/sources
 */
import { useEffect, useState } from "react";
import { useAuth } from "../../../../../lib/auth-context";
import { apiFetch } from "../../../../../lib/supabase";
import { ProjectLayout } from "../../../../../components/layout/ProjectLayout";
import { CredibilityBadge, DemoBadge, EmptyState, ErrorBanner, Spinner } from "../../../../../components/ui";
import type { Project, SourceExtended as Source } from "@ccj/types";

interface PageProps { params: { locale: string; id: string } }

const SOURCE_TYPE_ICON: Record<string, string> = {
  webpage: "🌐", pdf: "📄", video: "🎥", news: "📰", social: "💬",
  legal_document: "⚖️", official_statement: "🏛️", academic: "🎓", user_upload: "📁",
};

export default function SourcesPage({ params }: PageProps) {
  const { token } = useAuth();
  const { locale, id } = params;
  const [project, setProject] = useState<Project | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    Promise.all([
      apiFetch<Project>(`/api/projects/${id}`, { token }),
      apiFetch<Source[]>(`/api/projects/${id}/sources`, { token }),
    ]).then(([p, s]) => {
      if (p.data) setProject(p.data);
      if (s.data) setSources(s.data);
      if (s.error) setError(s.error);
      setLoading(false);
    });
  }, [token, id]);

  if (loading) return <div className="flex min-h-screen items-center justify-center"><Spinner size="lg" /></div>;
  if (!project) return null;

  const hasDemoSources = sources.some((s) => s.isDemo);

  return (
    <ProjectLayout projectId={id} projectTitle={project.title} locale={locale}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Sources <span className="text-gray-400">({sources.length})</span></h2>
          {hasDemoSources && <DemoBadge />}
        </div>

        {error && <ErrorBanner message={error} />}

        {sources.length === 0 ? (
          <EmptyState icon="📚" title="No sources yet" body="Run research to discover and import sources." />
        ) : (
          <div className="space-y-3">
            {sources.map((source) => (
              <div key={source.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 text-xl">{SOURCE_TYPE_ICON[source.sourceType] ?? "🌐"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-blue-700 hover:underline line-clamp-1"
                      >
                        {source.title}
                      </a>
                      {source.isDemo && <DemoBadge />}
                    </div>
                    <div className="mt-1 flex items-center gap-2 flex-wrap text-xs text-gray-500">
                      <span>{source.domain}</span>
                      <span>·</span>
                      <CredibilityBadge tier={source.credibilityTier} />
                      <span>·</span>
                      <span className="capitalize">{source.sourceType.replace("_", " ")}</span>
                      {source.publishedAt && (
                        <>
                          <span>·</span>
                          <span>{new Date(source.publishedAt).toLocaleDateString()}</span>
                        </>
                      )}
                    </div>
                    {source.author && (
                      <p className="mt-1 text-xs text-gray-400">By {source.author}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </ProjectLayout>
  );
}

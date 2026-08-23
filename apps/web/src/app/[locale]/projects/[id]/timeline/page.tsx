"use client";
/**
 * Timeline page — chronological evidence display
 */

import { use, useEffect, useState } from "react";
import { useAuth } from "../../../../../lib/auth-context";
import { apiFetch } from "../../../../../lib/supabase";
import { ProjectLayout } from "../../../../../components/layout/ProjectLayout";
import { DemoBadge, EmptyState, ErrorBanner, Spinner } from "../../../../../components/ui";
import type { Evidence, Project, Source } from "@ccj/types";

interface PageProps { params: Promise<{ locale: string; id: string }> }

interface EvidenceWithSource extends Evidence {
  isDemo?: boolean;
}

export default function TimelinePage({ params }: PageProps) {
  const {} = useAuth();
  const { locale, id } = use(params);
  const [project, setProject] = useState<Project | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [evidence, setEvidence] = useState<EvidenceWithSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!) return;
    Promise.all([
      apiFetch<Project>(`/api/projects/${id}`),
      apiFetch<Source[]>(`/api/projects/${id}/sources`),
      apiFetch<EvidenceWithSource[]>(`/api/projects/${id}/evidence`),
    ]).then(([p, s, e]) => {
      if (p.data) setProject(p.data);
      if (s.data) setSources(s.data);
      if (e.data) {
        // Sort by source published date
        const sourceMap = new Map((s.data ?? []).map((src) => [src.id, src]));
        const sorted = [...(e.data)].sort((a, b) => {
          const aDate = sourceMap.get(a.sourceId)?.publishedAt ?? a.capturedAt;
          const bDate = sourceMap.get(b.sourceId)?.publishedAt ?? b.capturedAt;
          return new Date(aDate ?? 0).getTime() - new Date(bDate ?? 0).getTime();
        });
        setEvidence(sorted);
      }
      if (e.error) setError(e.error);
      setLoading(false);
    });
  }, [ id]);

  if (loading) return <div className="flex min-h-screen items-center justify-center"><Spinner size="lg" /></div>;
  if (!project) return null;

  const sourceMap = new Map(sources.map((s) => [s.id, s]));
  const hasDemoItems = evidence.some((e) => e.isDemo);

  // Group evidence by month/year
  const groups: Record<string, EvidenceWithSource[]> = {};
  for (const ev of evidence) {
    const src = sourceMap.get(ev.sourceId);
    const dateStr = src?.publishedAt ?? ev.capturedAt;
    const label = dateStr
      ? new Date(dateStr).toLocaleDateString("en", { year: "numeric", month: "long" })
      : "Unknown date";
    if (!groups[label]) groups[label] = [];
    groups[label].push(ev);
  }

  return (
    <ProjectLayout projectId={id} projectTitle={project.title} locale={locale}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Timeline</h2>
          {hasDemoItems && <DemoBadge />}
        </div>

        {error && <ErrorBanner message={error} />}

        {evidence.length === 0 ? (
          <EmptyState icon="🕐" title="No timeline data" body="Evidence items will appear here ordered by publication date once research is complete." />
        ) : (
          <div className="relative border-l-2 border-gray-200 pl-6 space-y-6">
            {Object.entries(groups).map(([label, items]) => (
              <div key={label}>
                <div className="absolute -left-2 mt-1.5 h-4 w-4 rounded-full border-2 border-blue-500 bg-white" />
                <p className="text-xs font-semibold uppercase text-gray-500 mb-2">{label}</p>
                <div className="space-y-2">
                  {items.map((ev) => {
                    const src = sourceMap.get(ev.sourceId);
                    return (
                      <div key={ev.id} className="rounded-lg border border-gray-200 bg-white p-3">
                        {src && (
                          <p className="text-xs text-blue-600 font-medium mb-1 line-clamp-1">
                            {src.title}
                          </p>
                        )}
                        <blockquote className="text-sm text-gray-700 italic line-clamp-3">
                          "{ev.quote}"
                        </blockquote>
                        {ev.isDemo && <DemoBadge className="mt-1" />}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </ProjectLayout>
  );
}

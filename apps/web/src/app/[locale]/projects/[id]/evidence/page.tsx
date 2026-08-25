"use client";
import { use } from "react";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/supabase";
import { ProjectLayout } from "@/components/layout/ProjectLayout";
import { EmptyState, ErrorBanner, Spinner } from "@/components/ui";
import type { Project, Evidence } from "@ccj/types";

interface PageProps { params: Promise<{ locale: string; id: string }> }

function decodeHtml(raw: string): string {
  return raw
    .replace(/&lt;/g,  "<").replace(/&gt;/g,  ">")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function confidenceColor(c: number): string {
  if (c >= 0.80) return "#065f46";
  if (c >= 0.60) return "#92400e";
  return "#991b1b";
}
function confidenceBg(c: number): string {
  if (c >= 0.80) return "#d1fae5";
  if (c >= 0.60) return "#fef3c7";
  return "#fee2e2";
}

export default function EvidencePage({ params }: PageProps) {
  const { locale, id } = use(params);
  const { user } = useAuth();
  const [project, setProject]   = useState<Project | null>(null);
  const [items,   setItems]     = useState<Evidence[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error,   setError]     = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;
    Promise.all([
      apiFetch<Project>(`/api/projects/${id}`),
      apiFetch<Evidence[]>(`/api/projects/${id}/evidence`),
    ]).then(([p, e]) => {
      if (p.data)  setProject(p.data);
      if (e.data)  setItems(e.data);
      if (e.error) setError(e.error);
      setLoading(false);
    });
  }, [user, id]);

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center"><Spinner size="lg" /></div>
  );
  if (!project) return null;

  const toggle = (evId: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(evId) ? next.delete(evId) : next.add(evId);
      return next;
    });

  return (
    <ProjectLayout projectId={id} projectTitle={project.title} locale={locale}>
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">
            Evidence Vault
            <span className="ml-2 text-sm font-normal text-gray-400">
              ({items.length} items)
            </span>
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Exact quotes from sources. Click any item to expand the full text.
          </p>
        </div>

        {error && <ErrorBanner message={error} />}

        {items.length === 0 && !error ? (
          <EmptyState icon="🔍" title="No evidence yet"
            body="Start a research run to extract evidence from sources." />
        ) : (
          <div className="space-y-3">
            {items.map((ev, idx) => {
              const clean       = decodeHtml(ev.quote ?? "");
              const isExpanded  = expanded.has(ev.id);
              const preview     = clean.slice(0, 180);
              const hasMore     = clean.length > 180;
              const confPct     = Math.round((ev.confidence ?? 0) * 100);
              const confColor   = confidenceColor(ev.confidence ?? 0);
              const confBg      = confidenceBg(ev.confidence ?? 0);
              const warnings    = ev.extractionWarnings ?? [];

              return (
                <div key={ev.id}
                  className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                  {/* Header */}
                  <div className="flex items-center justify-between gap-3 px-4 py-3
                    border-b border-gray-100 bg-gray-50">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-gray-500">
                        #{idx + 1}
                      </span>
                      <span
                        className="rounded-full px-2 py-0.5 text-xs font-semibold"
                        style={{ color: confColor, background: confBg }}>
                        {confPct}% confidence
                      </span>
                      {warnings.map((w, i) => (
                        <span key={i}
                          className="rounded-full bg-amber-50 text-amber-700
                            border border-amber-200 px-2 py-0.5 text-xs">
                          ⚠ {w}
                        </span>
                      ))}
                    </div>
                    {hasMore && (
                      <button onClick={() => toggle(ev.id)}
                        className="text-xs text-blue-600 font-medium shrink-0 hover:underline">
                        {isExpanded ? "Show less ▲" : "Read more ▼"}
                      </button>
                    )}
                  </div>

                  {/* Quote */}
                  <div className="px-4 py-3">
                    <p className="text-sm text-gray-800 leading-relaxed">
                      {isExpanded ? clean : preview}
                      {!isExpanded && hasMore && (
                        <span className="text-gray-400">…</span>
                      )}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </ProjectLayout>
  );
}

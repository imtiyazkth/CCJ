"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../../../../lib/auth-context";
import { apiFetch } from "../../../../../lib/supabase";
import { ProjectLayout } from "../../../../../components/layout/ProjectLayout";
import { DemoBadge, EmptyState, ErrorBanner, Spinner } from "../../../../../components/ui";
import type { Evidence, Project } from "@ccj/types";

interface PageProps { params: { locale: string; id: string } }

export default function EvidencePage({ params }: PageProps) {
  const { token } = useAuth();
  const { locale, id } = params;
  const [project, setProject] = useState<Project | null>(null);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    Promise.all([
      apiFetch<Project>(`/api/projects/${id}`, { token }),
      apiFetch<Evidence[]>(`/api/projects/${id}/evidence`, { token }),
    ]).then(([p, e]) => {
      if (p.data) setProject(p.data);
      if (e.data) setEvidence(e.data);
      if (e.error) setError(e.error);
      setLoading(false);
    });
  }, [token, id]);

  if (loading) return <div className="flex min-h-screen items-center justify-center"><Spinner size="lg" /></div>;
  if (!project) return null;

  const hasDemoEvidence = evidence.some((e: any) => e.isDemo);

  return (
    <ProjectLayout projectId={id} projectTitle={project.title} locale={locale}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">
            Evidence Vault <span className="text-gray-400">({evidence.length})</span>
          </h2>
          {hasDemoEvidence && <DemoBadge />}
        </div>

        {error && <ErrorBanner message={error} />}

        {evidence.length === 0 ? (
          <EmptyState
            icon="🔍"
            title="No evidence extracted"
            body="Evidence is extracted from sources during a research run. Every quote is exact — never paraphrased."
          />
        ) : (
          <div className="space-y-3">
            {evidence.map((ev) => (
              <EvidenceCard key={ev.id} evidence={ev} />
            ))}
          </div>
        )}
      </div>
    </ProjectLayout>
  );
}

function EvidenceCard({ evidence: ev }: { evidence: Evidence & { isDemo?: boolean } }) {
  const confidence = Math.round(ev.confidence * 100);
  const confColor = confidence >= 80 ? "text-green-600" : confidence >= 50 ? "text-yellow-600" : "text-red-500";

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        {/* Quote */}
        <div className="flex-1 min-w-0">
          <blockquote className="border-l-4 border-blue-200 pl-3 text-sm text-gray-800 italic">
            "{ev.quote}"
          </blockquote>
          <div className="mt-2 flex items-center gap-3 flex-wrap text-xs text-gray-500">
            {ev.section && <span>§ {ev.section}</span>}
            {ev.pageNumber && <span>p.{ev.pageNumber}</span>}
            <span className={`font-medium ${confColor}`}>{confidence}% confidence</span>
            {(ev as any).isDemo && <DemoBadge />}
          </div>
          {ev.extractionWarnings.length > 0 && (
            <div className="mt-2 space-y-0.5">
              {ev.extractionWarnings.map((w, i) => (
                <p key={i} className="text-xs text-amber-600">⚠ {w}</p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

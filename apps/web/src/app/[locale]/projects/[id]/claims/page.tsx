"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../../../../lib/auth-context";
import { apiFetch } from "../../../../../lib/supabase";
import { ProjectLayout } from "../../../../../components/layout/ProjectLayout";
import { ClaimStatusBadge, DemoBadge, EmptyState, ErrorBanner, Spinner } from "../../../../../components/ui";
import type { Claim, Project } from "@ccj/types";

interface PageProps { params: { locale: string; id: string } }

const CLAIM_TYPE_LABEL: Record<string, string> = {
  fact: "Fact", reported: "Reported", opinion: "Opinion",
  analysis: "Analysis", legal_interpretation: "Legal", inference: "Inference", statistic: "Statistic",
};

export default function ClaimsPage({ params }: PageProps) {
  const { token } = useAuth();
  const { locale, id } = params;
  const [project, setProject] = useState<Project | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    if (!token) return;
    Promise.all([
      apiFetch<Project>(`/api/projects/${id}`, { token }),
      apiFetch<Claim[]>(`/api/projects/${id}/claims`, { token }),
    ]).then(([p, c]) => {
      if (p.data) setProject(p.data);
      if (c.data) setClaims(c.data);
      if (c.error) setError(c.error);
      setLoading(false);
    });
  }, [token, id]);

  if (loading) return <div className="flex min-h-screen items-center justify-center"><Spinner size="lg" /></div>;
  if (!project) return null;

  const statuses = ["all", "verified", "strongly_correlated", "reported", "disputed", "unverified", "opinion", "inference", "outdated"];
  const filtered = filter === "all" ? claims : claims.filter((c) => c.status === filter);
  const hasDemoClaims = claims.some((c: any) => c.isDemo);

  return (
    <ProjectLayout projectId={id} projectTitle={project.title} locale={locale}>
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="font-semibold text-gray-900">
            Claims <span className="text-gray-400">({filtered.length}/{claims.length})</span>
          </h2>
          {hasDemoClaims && <DemoBadge />}
        </div>

        {/* Status filter */}
        <div className="flex gap-1.5 flex-wrap">
          {statuses.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition ${
                filter === s
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {s.replace("_", " ")}
            </button>
          ))}
        </div>

        {error && <ErrorBanner message={error} />}

        {/* Verified requires evidence notice */}
        <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-xs text-blue-700">
          ℹ Claims start as <strong>unverified</strong>. Only set to <strong>verified</strong> after manually reviewing evidence. Status upgrades are logged in Audit History.
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon="📋" title="No claims yet" body="Claims are generated during a research run from extracted evidence." />
        ) : (
          <div className="space-y-3">
            {filtered.map((claim) => (
              <ClaimCard key={claim.id} claim={claim} />
            ))}
          </div>
        )}
      </div>
    </ProjectLayout>
  );
}

function ClaimCard({ claim }: { claim: Claim & { isDemo?: boolean } }) {
  const [expanded, setExpanded] = useState(false);
  const confidence = Math.round(claim.confidence * 100);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <ClaimStatusBadge status={claim.status} />
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600 capitalize">
              {CLAIM_TYPE_LABEL[claim.claimType] ?? claim.claimType}
            </span>
            <span className="text-xs text-gray-400">{confidence}% confidence</span>
            {(claim as any).isDemo && <DemoBadge />}
          </div>
          <p className="text-sm text-gray-800">{claim.claimText}</p>

          {(claim.reasoningSummary || claim.whatIsMissing) && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-2 text-xs text-blue-600 hover:underline"
            >
              {expanded ? "Less ▲" : "Details ▼"}
            </button>
          )}

          {expanded && (
            <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
              {claim.reasoningSummary && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase">Reasoning</p>
                  <p className="text-xs text-gray-600 mt-0.5">{claim.reasoningSummary}</p>
                </div>
              )}
              {claim.whatIsMissing && (
                <div>
                  <p className="text-xs font-semibold text-amber-600 uppercase">What Is Missing</p>
                  <p className="text-xs text-amber-700 mt-0.5">{claim.whatIsMissing}</p>
                </div>
              )}
              <div className="flex gap-3 text-xs text-gray-500">
                <span>✅ {claim.supportingEvidenceIds.length} supporting</span>
                <span>❌ {claim.contradictingEvidenceIds.length} contradicting</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

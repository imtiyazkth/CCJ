"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../../../../lib/auth-context";
import { apiFetch } from "../../../../../lib/supabase";
import { ProjectLayout } from "../../../../../components/layout/ProjectLayout";
import { EmptyState, ErrorBanner, Spinner } from "../../../../../components/ui";
import type { Claim, Project } from "@ccj/types";

interface PageProps { params: { locale: string; id: string } }

export default function GapsPage({ params }: PageProps) {
  const { token } = useAuth();
  const { locale, id } = params;
  const [project, setProject] = useState<Project | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  // Gaps = claims with whatIsMissing, or unverified claims
  const gapClaims = claims.filter((c) => c.whatIsMissing || c.status === "unverified");
  const disputedClaims = claims.filter((c) => c.status === "disputed");
  const unverifiedClaims = claims.filter((c) => c.status === "unverified");

  return (
    <ProjectLayout projectId={id} projectTitle={project.title} locale={locale}>
      <div className="space-y-6">
        <div>
          <h2 className="font-semibold text-gray-900">Research Gaps</h2>
          <p className="text-sm text-gray-500 mt-1">
            Areas where evidence is insufficient, missing, or contradictory.
          </p>
        </div>

        {error && <ErrorBanner message={error} />}

        {/* Stats */}
        {claims.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Unverified" count={unverifiedClaims.length} color="text-gray-700" bg="bg-gray-50" />
            <StatCard label="Disputed" count={disputedClaims.length} color="text-red-700" bg="bg-red-50" />
            <StatCard label="Missing info" count={gapClaims.length} color="text-amber-700" bg="bg-amber-50" />
          </div>
        )}

        {gapClaims.length === 0 ? (
          <EmptyState
            icon="⚠️"
            title="No gaps identified yet"
            body="Research gaps appear here once claims have been analysed. Missing evidence and contradictions are flagged automatically."
          />
        ) : (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">Claims with missing information</h3>
            {gapClaims.map((claim) => (
              <div key={claim.id} className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm text-gray-800">{claim.claimText}</p>
                {claim.whatIsMissing && (
                  <div className="mt-2 rounded bg-white border border-amber-200 p-2">
                    <p className="text-xs font-semibold text-amber-700">What is missing</p>
                    <p className="text-xs text-amber-800 mt-0.5">{claim.whatIsMissing}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {disputedClaims.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-red-700">Disputed claims</h3>
            {disputedClaims.map((claim) => (
              <div key={claim.id} className="rounded-xl border border-red-200 bg-red-50 p-4">
                <p className="text-sm text-gray-800">{claim.claimText}</p>
                {claim.reasoningSummary && (
                  <p className="mt-1 text-xs text-red-700">{claim.reasoningSummary}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </ProjectLayout>
  );
}

function StatCard({ label, count, color, bg }: { label: string; count: number; color: string; bg: string }) {
  return (
    <div className={`rounded-lg border border-gray-200 ${bg} p-4 text-center`}>
      <p className={`text-2xl font-bold ${color}`}>{count}</p>
      <p className="text-xs text-gray-600 mt-1">{label}</p>
    </div>
  );
}

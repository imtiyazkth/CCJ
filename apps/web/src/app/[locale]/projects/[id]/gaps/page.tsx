"use client";
import { use } from "react";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/supabase";
import { ProjectLayout } from "@/components/layout/ProjectLayout";
import { EmptyState, ErrorBanner, Spinner } from "@/components/ui";
import type { Project, Claim } from "@ccj/types";

interface PageProps { params: Promise<{ locale: string; id: string }> }

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  unverified:          { label: "Unverified",         color: "#92400e", bg: "#fef3c7", icon: "❓" },
  disputed:            { label: "Disputed",           color: "#991b1b", bg: "#fee2e2", icon: "⚡" },
  reported:            { label: "Reported",           color: "#1e40af", bg: "#dbeafe", icon: "📢" },
  strongly_correlated: { label: "Corroborated",       color: "#065f46", bg: "#d1fae5", icon: "✅" },
  opinion:             { label: "Opinion",            color: "#6b21a8", bg: "#f3e8ff", icon: "💭" },
  inference:           { label: "Inference",          color: "#374151", bg: "#f3f4f6", icon: "🔎" },
  insufficient_data:   { label: "Insufficient Data",  color: "#374151", bg: "#f3f4f6", icon: "📭" },
};

export default function GapsPage({ params }: PageProps) {
  const { locale, id } = use(params);
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [claims,  setClaims]  = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [filter,  setFilter]  = useState<string>("all");

  useEffect(() => {
    if (!user) return;
    Promise.all([
      apiFetch<Project>(`/api/projects/${id}`),
      apiFetch<Claim[]>(`/api/projects/${id}/claims`),
    ]).then(([p, c]) => {
      if (p.data) setProject(p.data);
      if (c.data) {
        // Deduplicate by claim text (first 100 chars)
        const seen = new Set<string>();
        const unique = c.data.filter(claim => {
          const key = claim.claimText.slice(0, 100).toLowerCase().trim();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        setClaims(unique);
      }
      if (c.error) setError(c.error);
      setLoading(false);
    });
  }, [user, id]);

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center"><Spinner size="lg" /></div>
  );
  if (!project) return null;

  const unverified  = claims.filter(c => c.status === "unverified");
  const disputed    = claims.filter(c => c.status === "disputed");
  const missingInfo = claims.filter(c => c.whatIsMissing &&
    !c.whatIsMissing.includes("failed"));

  const filtered = filter === "all"   ? claims
    : filter === "disputed"           ? disputed
    : filter === "unverified"         ? unverified
    : missingInfo;

  return (
    <ProjectLayout projectId={id} projectTitle={project.title} locale={locale}>
      <div className="space-y-5">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Research Gaps</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Areas where evidence is insufficient, missing, or contradictory.
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Unverified", count: unverified.length,  color: "#92400e", bg: "#fef3c7" },
            { label: "Disputed",   count: disputed.length,    color: "#991b1b", bg: "#fee2e2" },
            { label: "Need Info",  count: missingInfo.length, color: "#1e40af", bg: "#dbeafe" },
          ].map(s => (
            <div key={s.label}
              className="rounded-xl border p-3 text-center"
              style={{ borderColor: s.color + "40", background: s.bg }}>
              <div className="text-2xl font-bold" style={{ color: s.color }}>
                {s.count}
              </div>
              <div className="text-xs font-medium mt-0.5" style={{ color: s.color }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>

        {/* Filter */}
        <div className="flex gap-2 flex-wrap">
          {[
            { key: "all",        label: `All (${claims.length})` },
            { key: "unverified", label: `Unverified (${unverified.length})` },
            { key: "disputed",   label: `Disputed (${disputed.length})` },
            { key: "missing",    label: `Need Info (${missingInfo.length})` },
          ].map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                filter === f.key
                  ? "bg-blue-600 text-white"
                  : "bg-white border border-gray-200 text-gray-600 hover:border-blue-300"
              }`}>
              {f.label}
            </button>
          ))}
        </div>

        {error && <ErrorBanner message={error} />}

        {filtered.length === 0 ? (
          <EmptyState icon="✅" title="No gaps found in this category"
            body="All claims in this filter have sufficient evidence." />
        ) : (
          <div className="space-y-3">
            {filtered.map(claim => {
              const cfg = STATUS_CONFIG[claim.status] ?? STATUS_CONFIG.unverified;
              const missingText = claim.whatIsMissing?.includes("failed")
                ? null
                : claim.whatIsMissing;
              const confPct = Math.round((claim.confidence ?? 0) * 100);

              return (
                <div key={claim.id}
                  className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                  {/* Status + confidence */}
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full
                        px-2.5 py-1 text-xs font-semibold shrink-0"
                      style={{ color: cfg.color, background: cfg.bg }}>
                      {cfg.icon} {cfg.label}
                    </span>
                    <span className="text-xs text-gray-400">{confPct}% confidence</span>
                  </div>

                  {/* Claim text */}
                  <p className="text-sm text-gray-800 leading-relaxed mb-3">
                    {claim.claimText}
                  </p>

                  {/* Reasoning */}
                  {claim.reasoningSummary && !claim.reasoningSummary.includes("failed") && (
                    <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 mb-2">
                      <p className="text-xs text-gray-500 font-medium mb-0.5">Reasoning</p>
                      <p className="text-xs text-gray-700">{claim.reasoningSummary}</p>
                    </div>
                  )}

                  {/* What is missing */}
                  {missingText && (
                    <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                      <p className="text-xs font-semibold text-amber-700 mb-0.5">
                        ⚠ What is missing
                      </p>
                      <p className="text-xs text-amber-800">{missingText}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </ProjectLayout>
  );
}

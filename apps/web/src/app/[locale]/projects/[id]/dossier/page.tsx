"use client";

import { use, useEffect, useState } from "react";
import { useAuth } from "../../../../../lib/auth-context";
import { apiFetch } from "../../../../../lib/supabase";
import { ProjectLayout } from "../../../../../components/layout/ProjectLayout";
import { DemoBadge, EmptyState, ErrorBanner, Spinner } from "../../../../../components/ui";
import type { DossierCard, Project } from "@ccj/types";

interface PageProps { params: Promise<{ locale: string; id: string }> }

const CARD_TYPE_ICON: Record<string, string> = {
  summary: "📋", timeline: "🕐", contradiction: "⚡", gap: "⚠️",
  legal: "⚖️", source_analysis: "📚", key_claim: "🔑",
};

const CARD_TYPE_COLOR: Record<string, string> = {
  summary: "border-blue-200 bg-blue-50",
  timeline: "border-purple-200 bg-purple-50",
  contradiction: "border-red-200 bg-red-50",
  gap: "border-amber-200 bg-amber-50",
  legal: "border-gray-200 bg-gray-50",
  source_analysis: "border-green-200 bg-green-50",
  key_claim: "border-indigo-200 bg-indigo-50",
};

export default function DossierPage({ params }: PageProps) {
  const {user, } = useAuth();
  const { locale, id } = use(params);
  const [project, setProject] = useState<Project | null>(null);
  const [cards, setCards] = useState<DossierCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      apiFetch<Project>(`/api/projects/${id}`),
      apiFetch<DossierCard[]>(`/api/projects/${id}/dossier`),
    ]).then(([p, d]) => {
      if (p.data) setProject(p.data);
      if (d.data) setCards(d.data);
      if (d.error) setError(d.error);
      setLoading(false);
    });
  }, [ id]);

  if (loading) return <div className="flex min-h-screen items-center justify-center"><Spinner size="lg" /></div>;
  if (!project) return null;

  const hasDemoCards = cards.some((c: any) => c.isDemo);

  return (
    <ProjectLayout projectId={id} projectTitle={project.title} locale={locale}>
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-semibold text-gray-900">Research Dossier</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Living document — every card links to its evidence chain.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {hasDemoCards && <DemoBadge />}
            {cards.length > 0 && (
              <span className="text-xs text-gray-400">{cards.length} cards</span>
            )}
          </div>
        </div>

        {error && <ErrorBanner message={error} />}

        {hasDemoCards && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            ⚠ This dossier contains <strong>DEMO data</strong>. All demo records are illustrative placeholders
            and are clearly labeled. Trigger a real research run to replace them with actual sources and evidence.
          </div>
        )}

        {cards.length === 0 ? (
          <EmptyState
            icon="📁"
            title="Dossier is empty"
            body="Run research on the Research tab. The dossier is built automatically from sources, evidence, and claims."
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {cards.map((card) => (
              <DossierCardView key={card.id} card={card} />
            ))}
          </div>
        )}
      </div>
    </ProjectLayout>
  );
}

function DossierCardView({ card }: { card: DossierCard & { isDemo?: boolean } }) {
  const [expanded, setExpanded] = useState(card.cardType === "summary");
  const borderColor = CARD_TYPE_COLOR[card.cardType] ?? "border-gray-200 bg-gray-50";

  return (
    <div className={`rounded-xl border p-4 ${borderColor}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{CARD_TYPE_ICON[card.cardType] ?? "📋"}</span>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-900">{card.title}</h3>
              {(card as any).isDemo && <DemoBadge />}
            </div>
            <p className="text-xs capitalize text-gray-500">
              {card.cardType.replace("_", " ")}
            </p>
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="shrink-0 text-xs text-gray-500 hover:text-gray-800"
        >
          {expanded ? "▲" : "▼"}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 border-t border-black/5 pt-3">
          <p className="whitespace-pre-wrap text-sm text-gray-700">{card.body}</p>

          {/* Provenance counts */}
          <div className="mt-3 flex gap-3 text-xs text-gray-500">
            {card.claimIds.length > 0 && (
              <span>📋 {card.claimIds.length} claims</span>
            )}
            {card.sourceIds.length > 0 && (
              <span>📚 {card.sourceIds.length} sources</span>
            )}
            {card.evidenceIds.length > 0 && (
              <span>🔍 {card.evidenceIds.length} evidence</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

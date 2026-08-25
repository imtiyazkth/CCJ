"use client";
import { use } from "react";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/supabase";
import { ProjectLayout } from "@/components/layout/ProjectLayout";
import { EmptyState, ErrorBanner, Spinner } from "@/components/ui";
import type { Project, DossierCard, Source } from "@ccj/types";

interface PageProps { params: Promise<{ locale: string; id: string }> }

// Parse the structured dossier body into sections
function parseDossierBody(body: string) {
  const lines = body.split("\n").map(l => l.trim()).filter(Boolean);
  const sections: { heading?: string; lines: string[] }[] = [];
  let current: { heading?: string; lines: string[] } = { lines: [] };

  for (const line of lines) {
    // Detect section headers (emoji + colon patterns)
    if (/^[📌🕐✅🔍📊🌐📱📰📝⚡🤖📚🆕⚠️🚩🎯]/.test(line) && line.includes(":")) {
      if (current.lines.length > 0 || current.heading) sections.push(current);
      current = { heading: line, lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.length > 0 || current.heading) sections.push(current);
  return sections;
}

export default function DossierPage({ params }: PageProps) {
  const { locale, id } = use(params);
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [cards,   setCards]   = useState<DossierCard[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [open,    setOpen]    = useState<Set<string>>(new Set(["0"]));

  useEffect(() => {
    if (!user) return;
    Promise.all([
      apiFetch<Project>(`/api/projects/${id}`),
      apiFetch<DossierCard[]>(`/api/projects/${id}/dossier`),
      apiFetch<Source[]>(`/api/projects/${id}/sources`),
    ]).then(([p, d, s]) => {
      if (p.data) setProject(p.data);
      if (d.data) {
        // Show only the latest dossier card (deduplicate by run)
        const seen = new Set<string>();
        const unique = d.data.filter(card => {
          const key = card.researchRunId;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        setCards(unique);
      }
      if (s.data) setSources(s.data);
      if (d.error) setError(d.error);
      setLoading(false);
    });
  }, [user, id]);

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center"><Spinner size="lg" /></div>
  );
  if (!project) return null;

  const toggle = (idx: string) =>
    setOpen(prev => { const n = new Set(prev); n.has(idx) ? n.delete(idx) : n.add(idx); return n; });

  // Deduplicate sources by domain for the source panel
  const topSources = sources.filter((v, i, a) =>
    a.findIndex(s => s.domain === v.domain) === i
  ).slice(0, 12);

  return (
    <ProjectLayout projectId={id} projectTitle={project.title} locale={locale}>
      <div className="space-y-5">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Research Dossier</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Living document — every card links to its evidence chain.
          </p>
          <span className="text-xs text-gray-400">
            {cards.length} {cards.length === 1 ? "card" : "cards"}
          </span>
        </div>

        {error && <ErrorBanner message={error} />}

        {/* Source reference panel */}
        {topSources.length > 0 && (
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
            <h3 className="text-xs font-bold text-blue-800 uppercase tracking-wider mb-3">
              📚 Referenced Sources ({sources.length} total)
            </h3>
            <div className="flex flex-wrap gap-2">
              {topSources.map(src => (
                <a key={src.id} href={src.url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full
                    bg-white border border-blue-200 px-3 py-1
                    text-xs text-blue-700 font-medium hover:bg-blue-100 hover:border-blue-400
                    transition-colors">
                  🔗 {src.domain}
                </a>
              ))}
            </div>
          </div>
        )}

        {cards.length === 0 && !error ? (
          <EmptyState icon="📁" title="No dossier yet"
            body="Complete a research run to build your dossier." />
        ) : (
          <div className="space-y-4">
            {cards.map((card, idx) => {
              const isOpen   = open.has(String(idx));
              const sections = parseDossierBody(card.body);

              // Extract key metadata from body
              const bodyLines = card.body.split("\n");
              const entityLine   = bodyLines.find(l => l.includes("Entity:"));
              const intentLine   = bodyLines.find(l => l.includes("Intent:"));
              const resultsLine  = bodyLines.find(l => l.includes("Sources:"));
              const summaryLine  = bodyLines.find(l => l.startsWith("📝 Summary:"));
              const summaryText  = summaryLine?.replace("📝 Summary:", "").trim();

              // Source links from body
              const sourceLines = bodyLines.filter(l =>
                l.trim().startsWith("[Google News]") ||
                l.trim().startsWith("[YouTube]") ||
                l.trim().startsWith("[Wikipedia]") ||
                l.trim().startsWith("[GDELT") ||
                l.trim().startsWith("[Guardian") ||
                l.trim().startsWith("[Reddit")
              );

              return (
                <div key={card.id}
                  className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                  {/* Card header */}
                  <button onClick={() => toggle(String(idx))}
                    className="w-full flex items-start justify-between gap-3 p-4 text-left
                      hover:bg-gray-50 transition-colors">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-base">📋</span>
                        <span className="font-bold text-gray-900 text-sm">
                          {card.title}
                        </span>
                        <span className="text-xs bg-gray-100 text-gray-500
                          rounded-full px-2 py-0.5 capitalize">
                          {card.cardType}
                        </span>
                      </div>
                      {/* Quick stats */}
                      <div className="mt-1.5 flex items-center gap-3 text-xs text-gray-500">
                        {card.claimIds?.length > 0 && (
                          <span>📋 {card.claimIds.length} claims</span>
                        )}
                        {card.sourceIds?.length > 0 && (
                          <span>📚 {card.sourceIds.length} sources</span>
                        )}
                        {card.evidenceIds?.length > 0 && (
                          <span>🔍 {card.evidenceIds.length} evidence</span>
                        )}
                      </div>
                    </div>
                    <span className="text-gray-400 text-sm mt-1">
                      {isOpen ? "▲" : "▼"}
                    </span>
                  </button>

                  {isOpen && (
                    <div className="border-t border-gray-100 divide-y divide-gray-50">

                      {/* AI Summary box - most important */}
                      {summaryText && (
                        <div className="p-4 bg-gradient-to-br from-blue-50 to-indigo-50">
                          <h4 className="text-xs font-bold text-blue-800 uppercase
                            tracking-wider mb-2">
                            🤖 AI Research Summary
                          </h4>
                          <p className="text-sm text-gray-800 leading-relaxed">
                            {summaryText}
                          </p>
                        </div>
                      )}

                      {/* Entity + Intent */}
                      {(entityLine || intentLine) && (
                        <div className="p-4 flex flex-wrap gap-3">
                          {entityLine && (
                            <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
                              <p className="text-xs text-gray-500 font-medium">Entity</p>
                              <p className="text-sm font-semibold text-gray-900">
                                {entityLine.replace(/📌\s*Entity:/, "").trim()}
                              </p>
                            </div>
                          )}
                          {intentLine && (
                            <div className="rounded-lg bg-purple-50 border border-purple-200 px-3 py-2">
                              <p className="text-xs text-purple-600 font-medium">Intent</p>
                              <p className="text-sm font-semibold text-purple-900 capitalize">
                                {intentLine.replace(/🎯\s*Intent:/, "").trim()}
                              </p>
                            </div>
                          )}
                          {resultsLine && (
                            <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2">
                              <p className="text-xs text-green-600 font-medium">Results</p>
                              <p className="text-sm font-semibold text-green-900">
                                {resultsLine.replace(/📊\s*Results:/, "").trim()}
                              </p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* News sources with links */}
                      {sourceLines.length > 0 && (
                        <div className="p-4">
                          <h4 className="text-xs font-bold text-gray-700 uppercase
                            tracking-wider mb-3">
                            📰 News Coverage
                          </h4>
                          <div className="space-y-2">
                            {sourceLines.map((line, i) => {
                              // Match source to actual URL from sources list
                              const lineText = line.trim().replace(/^\[.*?\]\s*/, "");
                              const matchedSrc = sources.find(s =>
                                s.title?.toLowerCase().includes(lineText.toLowerCase().slice(0, 30))
                              );
                              return (
                                <div key={i}
                                  className="flex items-start gap-2 rounded-lg
                                    bg-gray-50 border border-gray-100 px-3 py-2">
                                  <span className="text-sm shrink-0">
                                    {line.includes("[YouTube]") ? "▶️" :
                                     line.includes("[Wikipedia]") ? "📖" :
                                     line.includes("[Reddit]") ? "🔴" : "🗞️"}
                                  </span>
                                  <div className="flex-1 min-w-0">
                                    {matchedSrc ? (
                                      <a href={matchedSrc.url} target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-sm text-blue-700 hover:underline
                                          font-medium line-clamp-1">
                                        {lineText}
                                      </a>
                                    ) : (
                                      <p className="text-sm text-gray-700 line-clamp-1">
                                        {lineText}
                                      </p>
                                    )}
                                    {matchedSrc && (
                                      <span className="text-xs text-gray-500">
                                        {matchedSrc.domain}
                                      </span>
                                    )}
                                  </div>
                                  {matchedSrc && (
                                    <a href={matchedSrc.url} target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-xs text-blue-600 shrink-0 hover:underline">
                                      ↗
                                    </a>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Full raw body (collapsible) */}
                      <details className="p-4">
                        <summary className="text-xs text-gray-500 cursor-pointer
                          font-medium hover:text-gray-700">
                          View raw research data ▼
                        </summary>
                        <pre className="mt-3 text-xs text-gray-600 whitespace-pre-wrap
                          bg-gray-50 rounded-lg p-3 border border-gray-100 overflow-x-auto
                          max-h-64 overflow-y-auto">
                          {card.body}
                        </pre>
                      </details>
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

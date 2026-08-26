"use client";
import { use } from "react";
import { useEffect, useState } from "react";
import { useAuth }       from "@/lib/auth-context";
import { apiFetch }      from "@/lib/supabase";
import { ProjectLayout } from "@/components/layout/ProjectLayout";
import { EmptyState, ErrorBanner, Spinner } from "@/components/ui";
import type { Project, DossierCard, Source } from "@ccj/types";

interface PageProps { params: Promise<{ locale: string; id: string }> }

// ── Types ────────────────────────────────────────────────────
interface DossierMeta {
  entity: string; entityType: string; intent: string;
  searchedAt: string; completedAt: string; aiEngine: string; runNumber: number;
  stats: { sources: number; evidence: number; claims: number;
           verified: number; disputed: number; reliability: string };
  social: { sentiment: string; botRisk: string };
  news:   { officialStatements: number };
}

interface ExtractedClaim {
  claim: string; source_name: string;
  verdict: "Supported" | "Contradicted" | "Unverified" | "Disputed";
}

interface TimelineEvent { date: string; event: string; source: string }
interface KeyEntity     { name: string; role: string; type: string }

interface DashboardResult {
  definition: string; core_conclusion: string; summary_narrative: string;
}

interface StructuredDossier {
  meta?:         DossierMeta;
  analysis?: {
    dashboard_result?:  DashboardResult;
    extracted_claims?:  ExtractedClaim[];
    timeline_events?:   TimelineEvent[];
    key_entities?:      KeyEntity[];
  };
  sourceTitles?: Array<{ source: string; title: string }>;
  factCheck?: {
    overallReliability: string;
    contradictions:     string[];
    missingEvidence:    string[];
  };
}

// ── Helpers ───────────────────────────────────────────────────
function decode(s: string): string {
  return s
    .replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">")
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g," ");
}

function fmtTime(iso: string): string {
  try { return new Date(iso).toLocaleString("en-IN",
    { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" });
  } catch { return iso; }
}

function reliabilityColor(r: string) {
  return r === "high"   ? { color:"#065f46", bg:"#d1fae5" }
       : r === "medium" ? { color:"#92400e", bg:"#fef3c7" }
       :                  { color:"#991b1b", bg:"#fee2e2" };
}

function verdictConfig(v: string) {
  return v === "Supported"    ? { color:"#065f46", bg:"#d1fae5", icon:"✅" }
       : v === "Contradicted" ? { color:"#991b1b", bg:"#fee2e2", icon:"❌" }
       : v === "Disputed"     ? { color:"#92400e", bg:"#fef3c7", icon:"⚡" }
       :                        { color:"#374151", bg:"#f3f4f6", icon:"❓" };
}
function parseDossier(body: string): StructuredDossier {
  try { return JSON.parse(body) as StructuredDossier; }
  catch { return {}; }
}

// ── Main component ────────────────────────────────────────────
export default function DossierPage({ params }: PageProps) {
  const { locale, id } = use(params);
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [cards,   setCards]   = useState<DossierCard[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      apiFetch<Project>(`/api/projects/${id}`),
      apiFetch<DossierCard[]>(`/api/projects/${id}/dossier`),
      apiFetch<Source[]>(`/api/projects/${id}/sources`),
    ]).then(([p, d, s]) => {
      if (p.data) setProject(p.data);
      if (d.data) {
        // Show only latest card per research run
        const seen = new Set<string>();
        setCards(d.data.filter(c => {
          if (seen.has(c.researchRunId)) return false;
          seen.add(c.researchRunId);
          return true;
        }));
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

  // Deduplicate sources by domain
  const uniqueSources = sources.filter((v, i, a) =>
    a.findIndex(s => s.domain === v.domain) === i).slice(0, 15);

  return (
    <ProjectLayout projectId={id} projectTitle={project.title} locale={locale}>
      <div className="space-y-5">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Research Dossier</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Structured intelligence report — every claim links to its evidence chain.
          </p>
        </div>

        {/* Source reference chips */}
        {uniqueSources.length > 0 && (
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
            <h3 className="text-xs font-bold text-blue-800 uppercase tracking-wider mb-3">
              📚 Referenced Sources ({sources.length} total)
            </h3>
            <div className="flex flex-wrap gap-2">
              {uniqueSources.map(src => (
                <a key={src.id} href={src.url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full bg-white
                    border border-blue-200 px-3 py-1 text-xs text-blue-700 font-medium
                    hover:bg-blue-100 hover:border-blue-400 transition-colors">
                  🔗 {src.domain}
                </a>
              ))}
            </div>
          </div>
        )}

        {error && <ErrorBanner message={error} />}
        ) : (
          <div className="space-y-6">
            {cards.map((card, idx) => {
              const d = parseDossier(card.body);
              const meta     = d.meta;
              const analysis = d.analysis;
              const result   = analysis?.dashboard_result;
              const claims   = analysis?.extracted_claims ?? [];
              const timeline = analysis?.timeline_events  ?? [];
              const entities = analysis?.key_entities     ?? [];
              const fc       = d.factCheck;
              const rel      = reliabilityColor(meta?.stats?.reliability ?? "low");

              return (
                <div key={card.id} className="space-y-4">

                  {/* ── HERO CARD ─────────────────────────── */}
                  {result && (
                    <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br
                      from-indigo-50 to-purple-50 shadow-sm overflow-hidden">
                      <div className="px-5 py-4 border-b border-indigo-200 flex items-center
                        justify-between flex-wrap gap-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xl">🤖</span>
                          <span className="font-bold text-indigo-900 text-sm">
                            AI Research Summary
                          </span>
                          <span className="text-xs text-indigo-600 bg-indigo-100
                            rounded-full px-2 py-0.5">
                            {meta?.aiEngine ?? "AI"}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-indigo-600">
                          {meta?.searchedAt && (
                            <span>🕐 {fmtTime(meta.searchedAt)}</span>
                          )}
                        </div>
                      </div>

                      <div className="p-5 space-y-4">
                        {/* Definition */}
                        {result.definition && (
                          <div>
                            <p className="text-xs font-bold text-indigo-700 uppercase
                              tracking-wider mb-1.5">
                              📌 What is this?
                            </p>
                            <p className="text-sm text-gray-800 leading-relaxed">
                              {decode(result.definition)}
                            </p>
                          </div>
                        )}

                        {/* Core conclusion */}
                        {result.core_conclusion && (
                          <div className="rounded-xl bg-white border border-indigo-200 p-4">
                            <p className="text-xs font-bold text-purple-700 uppercase
                              tracking-wider mb-1.5">
                              💡 Key Conclusion
                            </p>
                            <p className="text-sm font-medium text-gray-900 leading-relaxed">
                              {decode(result.core_conclusion)}
                            </p>
                          </div>
                        )}

                        {/* Summary narrative */}
                        {result.summary_narrative && (
                          <div>
                            <p className="text-xs font-bold text-indigo-700 uppercase
                              tracking-wider mb-1.5">
                              📝 Detailed Analysis
                            </p>
                            <p className="text-sm text-gray-700 leading-relaxed">
                              {decode(result.summary_narrative)}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
             {/* ── STATS ROW ────────────────────────── */}
                  {meta && (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {[
                        { label: "Sources",  value: meta.stats.sources,  icon: "📚", color: "#1e40af", bg: "#dbeafe" },
                        { label: "Evidence", value: meta.stats.evidence, icon: "🔍", color: "#065f46", bg: "#d1fae5" },
                        { label: "Claims",   value: meta.stats.claims,   icon: "📋", color: "#6b21a8", bg: "#f3e8ff" },
                        { label: "Reliability", value: meta.stats.reliability.toUpperCase(),
                          icon: "🎯", color: rel.color, bg: rel.bg },
                      ].map(s => (
                        <div key={s.label}
                          className="rounded-xl border p-3 text-center"
                          style={{ borderColor: s.color + "30", background: s.bg }}>
                          <div className="text-lg">{s.icon}</div>
                          <div className="text-lg font-bold" style={{ color: s.color }}>
                            {s.value}
                          </div>
                          <div className="text-xs font-medium" style={{ color: s.color }}>
                            {s.label}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ── KEY ENTITIES ─────────────────────── */}
                  {entities.length > 0 && (
                    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                      <h3 className="text-xs font-bold text-gray-700 uppercase
                        tracking-wider mb-3">
                        👥 Key Entities Identified
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {entities.map((e, i) => (
                          <div key={i}
                            className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                            <p className="text-xs font-bold text-gray-900">{decode(e.name)}</p>
                            <p className="text-xs text-gray-500 capitalize">
                              {e.type} · {decode(e.role)}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
               {/* ── EXTRACTED CLAIMS ─────────────────── */}
                  {claims.length > 0 && (
                    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                        <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                          📋 Extracted Claims ({claims.length})
                        </h3>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Arguments and positions found in the sources
                        </p>
                      </div>
                      <div className="divide-y divide-gray-100">
                        {claims.map((claim, i) => {
                          const vc = verdictConfig(claim.verdict);
                          return (
                            <div key={i} className="px-4 py-3">
                              <div className="flex items-start gap-3">
                                <span className="text-base shrink-0 mt-0.5">{vc.icon}</span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm text-gray-800 leading-relaxed">
                                    {decode(claim.claim)}
                                  </p>
                                  <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                                    <span className="text-xs text-gray-500 italic">
                                      — {decode(claim.source_name)}
                                    </span>
                                    <span
                                      className="rounded-full px-2 py-0.5 text-xs font-semibold"
                                      style={{ color: vc.color, background: vc.bg }}>
                                      {claim.verdict}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
{/* ── NEWS COVERAGE WITH LINKS ──────────── */}
                  {(d.sourceTitles ?? []).length > 0 && (
                    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                        <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                          📰 News Coverage & Sources
                        </h3>
                      </div>
                      <div className="divide-y divide-gray-100">
                        {(d.sourceTitles ?? []).map((item, i) => {
                          const matchedSrc = sources.find(s =>
                            s.title?.slice(0, 40).toLowerCase() ===
                            item.title.slice(0, 40).toLowerCase()
                          ) ?? sources.find(s => s.domain?.includes(
                            item.source.toLowerCase().replace(/[^a-z]/g, "")
                          ));
                          const srcIcon = item.source === "YouTube"    ? "▶️"
                                        : item.source === "Wikipedia"  ? "📖"
                                        : item.source === "Reddit"     ? "🔴"
                                        : item.source.includes("Academic") ? "🎓"
                                        : "🗞️";
                          return (
                            <div key={i}
                              className="px-4 py-3 flex items-start gap-3
                                hover:bg-gray-50 transition-colors">
                              <span className="text-base shrink-0">{srcIcon}</span>
                              <div className="flex-1 min-w-0">
                                {matchedSrc ? (
                                  <a href={matchedSrc.url} target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-sm text-blue-700 hover:underline
                                      font-medium line-clamp-2">
                                    {decode(item.title)}
                                  </a>
                                ) : (
                                  <p className="text-sm text-gray-700 line-clamp-2">
                                    {decode(item.title)}
                                  </p>
                                )}
                                <p className="text-xs text-gray-500 mt-0.5">
                                  {item.source}
                                  {matchedSrc?.publishedAt && (
                                    <span> · {new Date(matchedSrc.publishedAt)
                                      .toLocaleDateString("en-IN",
                                      { day:"2-digit", month:"short", year:"numeric" })
                                    }</span>
                                  )}
                                </p>
                              </div>
                              {matchedSrc && (
                                <a href={matchedSrc.url} target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-500 hover:text-blue-700 shrink-0
                                    text-lg leading-none mt-0.5">
                                  ↗
                                </a>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* ── TIMELINE FROM AI ──────────────────── */}
                  {timeline.length > 0 && (
                    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                        <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                          🕐 Chronological Timeline
                        </h3>
                      </div>
                      <div className="p-4 relative">
                        <div className="absolute left-7 top-4 bottom-4 w-0.5 bg-gray-200" />
                        <div className="space-y-4">
                          {timeline.map((ev, i) => (
                            <div key={i} className="flex items-start gap-4 pl-2">
                              <div className="relative z-10 flex-shrink-0 w-6 h-6
                                rounded-full bg-blue-600 border-2 border-white shadow
                                flex items-center justify-center">
                                <div className="w-2 h-2 rounded-full bg-white" />
                              </div>
                              <div className="flex-1 min-w-0 pb-1">
                                <p className="text-xs font-bold text-blue-700">
                                  📅 {decode(ev.date)}
                                </p>
                                <p className="text-sm text-gray-800 mt-0.5 leading-relaxed">
                                  {decode(ev.event)}
                                </p>
                                <p className="text-xs text-gray-500 mt-0.5 italic">
                                  {decode(ev.source)}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
{/* ── CONTRADICTIONS ────────────────────── */}
                  {(fc?.contradictions ?? []).length > 0 && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                      <h3 className="text-xs font-bold text-amber-800 uppercase
                        tracking-wider mb-3">
                        ⚡ Contradictions Found
                      </h3>
                      <div className="space-y-2">
                        {fc!.contradictions.map((c, i) => (
                          <p key={i} className="text-sm text-amber-900">• {decode(c)}</p>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── META FOOTER ──────────────────────── */}
                  {meta && (
                    <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                      <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
                        <span>🤖 Engine: {meta.aiEngine}</span>
                        <span>📊 Run #{meta.runNumber}</span>
                        <span>😊 Sentiment: {meta.social?.sentiment}</span>
                        <span>🤖 Bot Risk: {meta.social?.botRisk}</span>
                        {meta.searchedAt && <span>🔍 {fmtTime(meta.searchedAt)}</span>}
                        {meta.completedAt && <span>✅ {fmtTime(meta.completedAt)}</span>}
                      </div>
                      <p className="text-xs text-red-600 mt-3 border-t border-gray-200 pt-3">
                        ⚠️ All claims are unverified. Click source links to verify before citing.
                      </p>
                    </div>
                  )}

                  {idx < cards.length - 1 && (
                    <hr className="border-gray-200" />
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

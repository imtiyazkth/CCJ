"use client";
import { use } from "react";
import { useEffect, useState } from "react";
import { useAuth }       from "@/lib/auth-context";
import { apiFetch }      from "@/lib/supabase";
import { ProjectLayout } from "@/components/layout/ProjectLayout";
import { EmptyState, ErrorBanner, Spinner } from "@/components/ui";
import type { Project, DossierCard, Source } from "@ccj/types";

interface PageProps { params: Promise<{ locale: string; id: string }> }

interface DossierMeta {
  entity: string; entityType: string; intent: string;
  searchedAt: string; completedAt: string; aiEngine: string; runNumber: number;
  stats: { sources: number; evidence: number; claims: number;
           verified: number; disputed: number; reliability: string };
  social: { sentiment: string; botRisk: string };
  news: { officialStatements: number };
}
interface ExtractedClaim {
  claim: string; source_name: string;
  verdict: "Supported"|"Contradicted"|"Unverified"|"Disputed";
}
interface TimelineEvent { date: string; event: string; source: string }
interface KeyEntity     { name: string; role: string; type: string }
interface DashboardResult {
  definition: string; core_conclusion: string; summary_narrative: string;
}
interface QuestionSynthesis {
  dimensionCoverage: Array<{ dimension: string; addressed: boolean; summary: string }>;
  keyFindings: string[];
  verifiedFacts: string[];
  disputedPoints: string[];
  unknowns: string[];
  qualityCheck: {
    passed: boolean; relevanceScore: number; issues: string[];
    hallucinationRisk: string; recommendation: string;
  } | null;
}

interface StructuredDossier {
  meta?:     DossierMeta;
  analysis?: {
    dashboard_result?: DashboardResult;
    extracted_claims?: ExtractedClaim[];
    timeline_events?:  TimelineEvent[];
    key_entities?:     KeyEntity[];
    question_synthesis?: QuestionSynthesis;
  };
  sourceTitles?: Array<{ source: string; title: string }>;
  factCheck?: { overallReliability: string; contradictions: string[]; missingEvidence: string[] };
}

// ── Creator Script types (mirrors apps/web/src/lib/providers/ai.ts) ──
type ScriptMode = "short" | "explainer" | "deep_research" | "documentary" | "social_thread";
type ScriptLanguage = "en" | "hi" | "hinglish";
interface CreatorScriptSection { heading: string; narration: string; sourceRefs: string[] }
interface CreatorScript {
  title: string; hook: string; sections: CreatorScriptSection[];
  ending: string; disclaimer: string;
}
interface ScriptApiResponse { runId: string; mode: ScriptMode; language: ScriptLanguage; script: CreatorScript }

const SCRIPT_MODE_LABELS: Record<ScriptMode, string> = {
  short: "60-Second Short",
  explainer: "3–5 Min Explainer",
  deep_research: "8–15 Min Deep Research",
  documentary: "15–30 Min Documentary",
  social_thread: "Social Media Thread",
};
const SCRIPT_LANGUAGE_LABELS: Record<ScriptLanguage, string> = {
  en: "English", hi: "Hindi", hinglish: "Hinglish",
};

function decode(s: string): string {
  return s.replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">")
          .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g," ");
}
function fmtTime(iso: string): string {
  try { return new Date(iso).toLocaleString("en-IN",
    { day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit" });
  } catch { return iso; }
}
function relColor(r: string) {
  return r==="high"  ? {color:"#065f46",bg:"#d1fae5"}
       : r==="medium"? {color:"#92400e",bg:"#fef3c7"}
       :               {color:"#991b1b",bg:"#fee2e2"};
}
function verdictCfg(v: string) {
  return v==="Supported"    ? {color:"#065f46",bg:"#d1fae5",icon:"✅"}
       : v==="Contradicted" ? {color:"#991b1b",bg:"#fee2e2",icon:"❌"}
       : v==="Disputed"     ? {color:"#92400e",bg:"#fef3c7",icon:"⚡"}
       :                      {color:"#374151",bg:"#f3f4f6",icon:"❓"};
}
function parseDossier(body: string): StructuredDossier {
  try { return JSON.parse(body) as StructuredDossier; }
  catch { return {}; }
}

export default function DossierPage({ params }: PageProps) {
  const { locale, id } = use(params);
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [cards,   setCards]   = useState<DossierCard[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  // ── Creator Script state ──────────────────────────────────
  const [scriptMode,     setScriptMode]     = useState<ScriptMode>("explainer");
  const [scriptLanguage, setScriptLanguage] = useState<ScriptLanguage>("en");
  const [scriptLoading,  setScriptLoading]  = useState(false);
  const [scriptError,    setScriptError]    = useState<string | null>(null);
  const [script,         setScript]         = useState<CreatorScript | null>(null);

  async function handleGenerateScript() {
    setScriptLoading(true);
    setScriptError(null);
    setScript(null);
    const res = await apiFetch<ScriptApiResponse>(`/api/projects/${id}/script`, {
      method: "POST",
      body: JSON.stringify({ mode: scriptMode, language: scriptLanguage }),
    });
    if (res.data) {
      setScript(res.data.script);
    } else {
      setScriptError(res.error ?? "Failed to generate script.");
    }
    setScriptLoading(false);
  }

  useEffect(() => {
    if (!user) return;
    Promise.all([
      apiFetch<Project>(`/api/projects/${id}`),
      apiFetch<DossierCard[]>(`/api/projects/${id}/dossier`),
      apiFetch<Source[]>(`/api/projects/${id}/sources`),
    ]).then(([p, d, s]) => {
      if (p.data) setProject(p.data);
      if (d.data) {
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
    <div className="flex min-h-screen items-center justify-center">
      <Spinner size="lg" />
    </div>
  );
  if (!project) return null;

  const uniqueSources = sources
    .filter((v,i,a) => a.findIndex(s => s.domain===v.domain)===i)
    .slice(0,15);

  return (
    <ProjectLayout projectId={id} projectTitle={project.title} locale={locale}>
      <div className="space-y-5">
        <div>
          <h2 className="ui-heading-lg text-gray-900">Research Dossier</h2>
          <p className="ui-body text-xs text-gray-500 mt-0.5">
            Structured intelligence report — every claim links to its evidence chain.
          </p>
        </div>

        {uniqueSources.length > 0 && (
          // §12 Materials & depth: a bigger surface should read as thicker —
          // a soft shadow gives this box weight instead of a flat fill+border
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 shadow-sm">
            <h3 className="text-xs font-bold text-blue-800 uppercase tracking-wider mb-3">
              Referenced Sources ({sources.length} total)
            </h3>
            <div className="flex flex-wrap gap-2">
              {uniqueSources.map(src => (
                // §1 Response: feedback on press, not just hover — matters
                // on touch devices where hover never fires at all
                <a key={src.id} href={src.url} target="_blank" rel="noopener noreferrer"
                  className="ui-pressable inline-flex items-center gap-1 rounded-full bg-white
                    border border-blue-200 px-3 py-1 text-xs text-blue-700 font-medium
                    shadow-sm hover:bg-blue-100 hover:border-blue-300 hover:shadow
                    transition-colors">
                  {src.domain}
                </a>
              ))}
            </div>
          </div>
        )}

        {error && <ErrorBanner message={error} />}

        {/* ── Creator Script Generator ─────────────────────── */}
        {cards.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
              <h3 className="ui-heading-sm text-xs text-gray-700 uppercase tracking-wider">
                Create Content
              </h3>
              <p className="ui-body text-xs text-gray-500 mt-0.5">
                Generate a creator-style script from this research. Unverified and
                disputed claims stay clearly attributed — never presented as settled fact.
              </p>
            </div>
            <div className="p-4 space-y-3">
              <div className="flex flex-wrap gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Format
                  </label>
                  {/* §1 Response: focus/active states must be instant, not the
                      browser's bare default outline — and touch targets need
                      real height (44px+) so tap doesn't feel imprecise */}
                  <select
                    value={scriptMode}
                    onChange={(e) => setScriptMode(e.target.value as ScriptMode)}
                    className="ui-pressable rounded-lg border border-gray-300 px-3 py-2 text-sm
                      text-gray-800 bg-white min-h-[44px]
                      focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  >
                    {(Object.keys(SCRIPT_MODE_LABELS) as ScriptMode[]).map((m) => (
                      <option key={m} value={m}>{SCRIPT_MODE_LABELS[m]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Language
                  </label>
                  <select
                    value={scriptLanguage}
                    onChange={(e) => setScriptLanguage(e.target.value as ScriptLanguage)}
                    className="ui-pressable rounded-lg border border-gray-300 px-3 py-2 text-sm
                      text-gray-800 bg-white min-h-[44px]
                      focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  >
                    {(Object.keys(SCRIPT_LANGUAGE_LABELS) as ScriptLanguage[]).map((l) => (
                      <option key={l} value={l}>{SCRIPT_LANGUAGE_LABELS[l]}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  {/* §1 Response + §4 Behavior over animation: press feedback
                      via ui-pressable's scale(0.97), not just a color swap */}
                  <button
                    onClick={handleGenerateScript}
                    disabled={scriptLoading}
                    className="ui-pressable rounded-lg bg-indigo-600 px-4 py-2 min-h-[44px] text-sm font-semibold
                      text-white hover:bg-indigo-700 disabled:opacity-50
                      disabled:cursor-not-allowed disabled:active:scale-100 transition-colors"
                  >
                    {scriptLoading ? "Generating…" : "Generate Script"}
                  </button>
                </div>
              </div>

              {scriptError && <ErrorBanner message={scriptError} />}

              {script && (
                <div className="mt-4 rounded-xl border border-indigo-200
                  bg-gradient-to-br from-indigo-50 to-purple-50 p-4 space-y-3">
                  <h4 className="font-bold text-indigo-900 text-base">
                    {decode(script.title)}
                  </h4>
                  <p className="text-sm text-indigo-800 italic leading-relaxed">
                    {decode(script.hook)}
                  </p>
                  <div className="space-y-3">
                    {script.sections.map((s, i) => (
                      <div key={i} className="bg-white rounded-lg border
                        border-indigo-100 p-3">
                        <p className="text-xs font-bold text-indigo-700
                          uppercase tracking-wide mb-1">
                          {decode(s.heading)}
                        </p>
                        <p className="text-sm text-gray-800 leading-relaxed
                          whitespace-pre-wrap">
                          {decode(s.narration)}
                        </p>
                      </div>
                    ))}
                  </div>
                  <p className="text-sm text-gray-700 italic border-t
                    border-indigo-200 pt-3">
                    {decode(script.ending)}
                  </p>
                  {script.disclaimer && (
                    <p className="text-xs text-amber-700 bg-amber-50
                      border border-amber-200 rounded-lg px-3 py-2">
                      ⚠️ {decode(script.disclaimer)}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {cards.length === 0 ? (
          <EmptyState icon="📁" title="No dossier yet"
            body="Complete a research run to build your structured intelligence report." />
        ) : (
          <div className="space-y-6">
            {cards.map((card, idx) => {
              const d        = parseDossier(card.body);
              const meta     = d.meta;
              const result   = d.analysis?.dashboard_result;
              const claims   = d.analysis?.extracted_claims ?? [];
              const timeline = d.analysis?.timeline_events  ?? [];
              const entities = d.analysis?.key_entities     ?? [];
              const qs       = d.analysis?.question_synthesis;
              const fc       = d.factCheck;
              const rel      = relColor(meta?.stats?.reliability ?? "low");

              return (
                <div key={card.id} className="space-y-4">

                  {result && (
                    <div className="rounded-2xl border border-indigo-200
                      bg-gradient-to-br from-indigo-50 to-purple-50 shadow-sm">
                      <div className="px-5 py-3 border-b border-indigo-200
                        flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-indigo-900 text-sm">
                            AI Research Summary
                          </span>
                          <span className="text-xs text-indigo-600 bg-indigo-100
                            rounded-full px-2 py-0.5">
                            {meta?.aiEngine ?? "AI"}
                          </span>
                        </div>
                        {meta?.searchedAt && (
                          <span className="text-xs text-indigo-600">
                            {fmtTime(meta.searchedAt)}
                          </span>
                        )}
                      </div>
                      <div className="p-5 space-y-4">
                        {result.definition && (
                          <div>
                            <p className="text-xs font-bold text-indigo-700
                              uppercase tracking-wider mb-1">What is this?</p>
                            <p className="text-sm text-gray-800 leading-relaxed">
                              {decode(result.definition)}
                            </p>
                          </div>
                        )}
                        {result.core_conclusion && (
                          <div className="rounded-xl bg-white border border-indigo-200 p-4">
                            <p className="text-xs font-bold text-purple-700
                              uppercase tracking-wider mb-1">Key Conclusion</p>
                            <p className="text-sm font-medium text-gray-900 leading-relaxed">
                              {decode(result.core_conclusion)}
                            </p>
                          </div>
                        )}
                        {result.summary_narrative && (
                          <div>
                            <p className="text-xs font-bold text-indigo-700
                              uppercase tracking-wider mb-1">Detailed Analysis</p>
                            <p className="text-sm text-gray-700 leading-relaxed">
                              {decode(result.summary_narrative)}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {meta && (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {[
                        {label:"Sources", value:meta.stats.sources,
                          color:"#1e40af",bg:"#dbeafe"},
                        {label:"Evidence",value:meta.stats.evidence,
                          color:"#065f46",bg:"#d1fae5"},
                        {label:"Claims",  value:meta.stats.claims,
                          color:"#6b21a8",bg:"#f3e8ff"},
                        {label:"Reliability",
                          value:meta.stats.reliability.toUpperCase(),
                          color:rel.color,bg:rel.bg},
                      ].map(s => (
                        <div key={s.label}
                          className="rounded-xl border p-3 text-center"
                          style={{borderColor:s.color+"30",background:s.bg}}>
                          <div className="text-xl font-bold"
                            style={{color:s.color}}>{s.value}</div>
                          <div className="text-xs font-medium mt-0.5"
                            style={{color:s.color}}>{s.label}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {entities.length > 0 && (
                    <div className="rounded-xl border border-gray-200
                      bg-white p-4 shadow-sm">
                      <h3 className="text-xs font-bold text-gray-700
                        uppercase tracking-wider mb-3">Key Entities</h3>
                      <div className="flex flex-wrap gap-2">
                        {entities.map((e,i) => (
                          <div key={i}
                            className="rounded-lg border border-gray-200
                              bg-gray-50 px-3 py-2">
                            <p className="text-xs font-bold text-gray-900">
                              {decode(e.name)}
                            </p>
                            <p className="text-xs text-gray-500 capitalize">
                              {e.type} · {decode(e.role)}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {claims.length > 0 && (
                    <div className="rounded-xl border border-gray-200
                      bg-white shadow-sm overflow-hidden">
                      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                        <h3 className="text-xs font-bold text-gray-700
                          uppercase tracking-wider">
                          Extracted Claims ({claims.length})
                        </h3>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Arguments and positions found in the sources
                        </p>
                      </div>
                      <div className="divide-y divide-gray-100">
                        {claims.map((claim, i) => {
                          const vc = verdictCfg(claim.verdict);
                          return (
                            <div key={i} className="px-4 py-3">
                              <div className="flex items-start gap-3">
                                <span className="text-base shrink-0 mt-0.5">
                                  {vc.icon}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm text-gray-800 leading-relaxed">
                                    {decode(claim.claim)}
                                  </p>
                                  <div className="mt-1 flex items-center gap-2 flex-wrap">
                                    <span className="text-xs text-gray-500 italic">
                                      — {decode(claim.source_name)}
                                    </span>
                                    <span className="rounded-full px-2 py-0.5
                                      text-xs font-semibold"
                                      style={{color:vc.color,background:vc.bg}}>
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

                  {(d.sourceTitles ?? []).length > 0 && (
                    <div className="rounded-xl border border-gray-200
                      bg-white shadow-sm overflow-hidden">
                      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                        <h3 className="text-xs font-bold text-gray-700
                          uppercase tracking-wider">News Coverage</h3>
                      </div>
                      <div className="divide-y divide-gray-100">
                        {(d.sourceTitles ?? []).map((item, i) => {
                          const matchedSrc = sources.find(s =>
                            s.title?.slice(0,40).toLowerCase() ===
                            item.title.slice(0,40).toLowerCase()
                          ) ?? sources.find(s =>
                            item.source.toLowerCase().includes(
                              (s.domain ?? "").split(".")[0] ?? "")
                          );
                          const icon =
                            item.source==="YouTube"  ? "▶️" :
                            item.source==="Wikipedia"? "📖" :
                            item.source==="Reddit"   ? "🔴" :
                            item.source.includes("Academic") ? "🎓" : "🗞️";
                          return (
                            <div key={i}
                              className="px-4 py-3 flex items-start gap-3
                                hover:bg-gray-50 transition-colors">
                              <span className="text-base shrink-0">{icon}</span>
                              <div className="flex-1 min-w-0">
                                {matchedSrc ? (
                                  <a href={matchedSrc.url} target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-sm text-blue-700
                                      hover:underline font-medium line-clamp-2">
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
                                      {day:"2-digit",month:"short",year:"numeric"})
                                    }</span>
                                  )}
                                </p>
                              </div>
                              {matchedSrc && (
                                <a href={matchedSrc.url} target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-500 hover:text-blue-700
                                    shrink-0 text-lg leading-none mt-0.5">
                                  ↗
                                </a>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {timeline.length > 0 && (
                    <div className="rounded-xl border border-gray-200
                      bg-white shadow-sm overflow-hidden">
                      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                        <h3 className="text-xs font-bold text-gray-700
                          uppercase tracking-wider">Chronological Timeline</h3>
                      </div>
                      <div className="p-4 relative">
                        <div className="absolute left-7 top-4 bottom-4
                          w-0.5 bg-gray-200" />
                        <div className="space-y-4">
                          {timeline.map((ev, i) => (
                            <div key={i}
                              className="flex items-start gap-4 pl-2">
                              <div className="relative z-10 flex-shrink-0
                                w-6 h-6 rounded-full bg-blue-600
                                border-2 border-white shadow
                                flex items-center justify-center">
                                <div className="w-2 h-2 rounded-full bg-white" />
                              </div>
                              <div className="flex-1 min-w-0 pb-1">
                                <p className="text-xs font-bold text-blue-700">
                                  {decode(ev.date)}
                                </p>
                                <p className="text-sm text-gray-800 mt-0.5
                                  leading-relaxed">
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

                  {(fc?.contradictions ?? []).length > 0 && (
                    <div className="rounded-xl border border-amber-200
                      bg-amber-50 p-4">
                      <h3 className="text-xs font-bold text-amber-800
                        uppercase tracking-wider mb-3">
                        Contradictions Found
                      </h3>
                      {fc!.contradictions.map((c,i) => (
                        <p key={i} className="text-sm text-amber-900">
                          • {decode(c)}
                        </p>
                      ))}
                    </div>
                  )}

                  {meta && (
                    <div className="rounded-xl border border-gray-100
                      bg-gray-50 p-4">
                      <div className="grid grid-cols-2 gap-2 text-xs
                        text-gray-500">
                        <span>Engine: {meta.aiEngine}</span>
                        <span>Run #{meta.runNumber}</span>
                        <span>Sentiment: {meta.social?.sentiment}</span>
                        <span>Bot Risk: {meta.social?.botRisk}</span>
                      </div>
                      <p className="text-xs text-red-600 mt-3 border-t
                        border-gray-200 pt-3">
                        All claims are unverified. Verify before citing.
                      </p>
                    </div>
                  )}

                  {idx < cards.length - 1 && <hr className="border-gray-200" />}
                  {qs && (
                    <div className="rounded-2xl border border-teal-200 bg-teal-50/50 shadow-sm">
                      <div className="px-5 py-3 border-b border-teal-200">
                        <span className="font-bold text-teal-900 text-sm">
                          Question Coverage
                        </span>
                        <p className="text-xs text-teal-700 mt-0.5">
                          Whether this research actually addressed every part of what you asked.
                        </p>
                      </div>
                      <div className="p-5 space-y-4">
                        {qs.qualityCheck && qs.qualityCheck.recommendation !== "accept" && (
                          <div className={`rounded-lg px-3 py-2 text-xs border ${
                            qs.qualityCheck.recommendation === "regenerate"
                              ? "bg-red-50 border-red-200 text-red-700"
                              : "bg-amber-50 border-amber-200 text-amber-700"
                          }`}>
                            ⚠ Relevance score: {qs.qualityCheck.relevanceScore}/100.{" "}
                            {qs.qualityCheck.recommendation === "regenerate"
                              ? "This answer may not adequately address your question — consider rephrasing or re-running research."
                              : "This answer may only partially address your question."}
                            {qs.qualityCheck.issues.length > 0 && (
                              <ul className="mt-1 list-disc list-inside">
                                {qs.qualityCheck.issues.slice(0, 3).map((issue, i) => (
                                  <li key={i}>{decode(issue)}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}

                        {qs.dimensionCoverage.length > 0 && (
                          <div>
                            <p className="text-xs font-bold text-teal-700 uppercase tracking-wider mb-2">
                              Dimensions of your question
                            </p>
                            <div className="space-y-1.5">
                              {qs.dimensionCoverage.map((dim, i) => (
                                <div key={i} className="flex items-start gap-2 text-sm">
                                  <span>{dim.addressed ? "✅" : "❌"}</span>
                                  <div>
                                    <span className="font-medium text-gray-800">{decode(dim.dimension)}</span>
                                    {dim.summary && (
                                      <span className="text-gray-600"> — {decode(dim.summary)}</span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {qs.unknowns.length > 0 && (
                          <div className="rounded-lg bg-white border border-teal-100 p-3">
                            <p className="text-xs font-bold text-teal-700 uppercase tracking-wider mb-1">
                              What remains unanswered
                            </p>
                            <ul className="text-sm text-gray-700 space-y-1 list-disc list-inside">
                              {qs.unknowns.map((u, i) => <li key={i}>{decode(u)}</li>)}
                            </ul>
                          </div>
                        )}
                      </div>
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

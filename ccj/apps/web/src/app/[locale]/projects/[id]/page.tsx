"use client";
import { use } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../../../lib/auth-context";
import { apiFetch } from "../../../../lib/supabase";
import { useTranslation } from "../../../../lib/i18n";
import { ProjectLayout } from "../../../../components/layout/ProjectLayout";
import { EmptyState, ErrorBanner, RunStatusBadge, Spinner, Card } from "../../../../components/ui";
import type { Project, ResearchPlan } from "@ccj/types";
import type { ResearchRunExtended } from "@ccj/types";

interface PageProps { params: Promise<{ locale: string; id: string }> }

export default function ResearchPage({ params }: PageProps) {
  const { locale, id } = use(params);
  const { token } = useAuth();
  const { t } = useTranslation();
  const [project, setProject] = useState<Project | null>(null);
  const [runs, setRuns] = useState<ResearchRunExtended[]>([]);
  const [topic, setTopic] = useState("");
  const [depth, setDepth] = useState<"quick"|"standard"|"deep">("standard");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchRuns = useCallback(async () => {
    if (!token) return;
    const { data } = await apiFetch<ResearchRunExtended[]>(`/api/projects/${id}/research`, { token });
    if (data) setRuns(data);
  }, [token, id]);

  useEffect(() => {
    if (!token) return;
    Promise.all([
      apiFetch<Project>(`/api/projects/${id}`, { token }),
      apiFetch<ResearchRunExtended[]>(`/api/projects/${id}/research`, { token }),
    ]).then(([p, r]) => {
      if (p.data) { setProject(p.data); setTopic(p.data.title); }
      if (r.data) setRuns(r.data);
      setLoading(false);
    });
  }, [token, id]);

  useEffect(() => {
    const active = runs.some((r) =>
      ["pending","planning","searching","fetching","extracting","analysing"].includes(r.status)
    );
    if (active && !pollRef.current) pollRef.current = setInterval(fetchRuns, 2500);
    else if (!active && pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [runs, fetchRuns]);

  async function handleTrigger(e: React.FormEvent) {
    e.preventDefault();
    if (!topic.trim() || !token) return;
    setSubmitting(true); setError(null);
    const { error: err } = await apiFetch(`/api/projects/${id}/research`, {
      method: "POST", token, body: JSON.stringify({ topic, depth, requestedLanguage: locale }),
    });
    if (err) setError(err); else fetchRuns();
    setSubmitting(false);
  }

  if (loading) return <div className="flex min-h-screen items-center justify-center"><Spinner size="lg" /></div>;
  if (!project) return null;

  return (
    <ProjectLayout projectId={id} projectTitle={project.title} locale={locale}>
      <div className="space-y-6">
        <Card className="p-5">
          <h2 className="mb-4 font-semibold text-gray-900">{t("research.triggerButton")}</h2>
          {error && <ErrorBanner message={error} />}
          <form onSubmit={handleTrigger} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">{t("research.topic")}</label>
              <textarea value={topic} onChange={(e) => setTopic(e.target.value)} rows={3} required
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder={t("research.topicPlaceholder")} />
            </div>
            <div className="flex items-center gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">{t("research.depth.label")}</label>
                <select value={depth} onChange={(e) => setDepth(e.target.value as typeof depth)}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  <option value="quick">{t("research.depth.quick")}</option>
                  <option value="standard">{t("research.depth.standard")}</option>
                  <option value="deep">{t("research.depth.deep")}</option>
                </select>
              </div>
              <button type="submit" disabled={submitting || !topic.trim()}
                className="mt-5 flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                {submitting && <Spinner size="sm" />}
                {submitting ? t("common.loading") : t("research.triggerButton")}
              </button>
            </div>
          </form>
        </Card>

        {runs.length > 0 ? (
          <div>
            <h2 className="mb-3 font-semibold text-gray-900">Research Runs</h2>
            <div className="space-y-3">{runs.map((run) => <RunCard key={run.id} run={run} t={t} />)}</div>
          </div>
        ) : (
          <EmptyState icon="🔬" title="No research runs yet"
            body="Start a research run above. The agent will search, fetch sources, extract evidence and build your dossier." />
        )}
      </div>
    </ProjectLayout>
  );
}

function RunCard({ run, t }: { run: ResearchRunExtended; t: (k: string, v?: Record<string,string>) => string }) {
  const plan = run.researchPlan as ResearchPlan | null;
  const [expanded, setExpanded] = useState(false);
  const pct = run.progressPct ?? 0;

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <RunStatusBadge status={run.status} />
            <span className="text-xs text-gray-500">{t("research.version", { version: String(run.version) })}</span>
            <span className="text-xs text-gray-500 capitalize">{run.depth}</span>
            {pct > 0 && run.status !== "complete" && (
              <span className="text-xs text-blue-600 font-medium">{t("research.progress", { pct: String(pct) })}</span>
            )}
          </div>
          <p className="mt-1 text-sm text-gray-700 line-clamp-1">{run.topic}</p>
          {run.status === "failed" && run.error && (
            <p className="mt-1 text-xs text-red-600">{run.error}</p>
          )}
        </div>
        {plan && (
          <button onClick={() => setExpanded(!expanded)} className="shrink-0 text-xs text-blue-600 hover:underline">
            {expanded ? "Hide ▲" : "Plan ▼"}
          </button>
        )}
      </div>
      {pct > 0 && run.status !== "complete" && run.status !== "failed" && (
        <div className="mt-3 h-1.5 w-full rounded-full bg-gray-100">
          <div className="h-1.5 rounded-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
      {expanded && plan && (
        <div className="mt-4 border-t border-gray-100 pt-4 space-y-3">
          {plan.researchQuestions.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Questions</p>
              {plan.researchQuestions.map((q, i) => <p key={i} className="text-sm text-gray-700">• {q}</p>)}
            </div>
          )}
          {plan.riskFlags.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-amber-600 uppercase mb-1">Risk Flags</p>
              {plan.riskFlags.map((f, i) => <p key={i} className="text-sm text-amber-700">⚠ {f}</p>)}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

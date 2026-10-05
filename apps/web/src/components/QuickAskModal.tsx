"use client";
import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { X, Sparkles, Search, ExternalLink } from "lucide-react";

interface QuickAskSource { title: string; url: string; source: string }

export function QuickAskModal({ onClose }: { onClose: () => void }) {
  const { token } = useAuth();
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) ?? "en";

  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<QuickAskSource[]>([]);
  const [fromGeneralKnowledge, setFromGeneralKnowledge] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askedQuestion, setAskedQuestion] = useState("");

  async function handleAsk(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || loading) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    setAskedQuestion(question.trim());
    setFromGeneralKnowledge(false);
    try {
      const res = await fetch("/api/quick-ask", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ question: question.trim(), language: locale }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Something went wrong");
      setAnswer(json.data.answer);
      setSources(json.data.sources ?? []);
      setFromGeneralKnowledge(json.data.fromGeneralKnowledge === true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  // The purpose this whole feature serves: a quick answer is the fast
  // path, but the same question can become a full research project
  // without retyping it — one tap escalates straight into the existing
  // 20-agent pipeline.
  async function handleResearchFurther() {
    if (!askedQuestion || escalating) return;
    setEscalating(true);
    try {
      const projRes = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: askedQuestion }),
      });
      const projJson = await projRes.json();
      if (!projJson.success) throw new Error(projJson.error?.message ?? "Could not create project");
      const projectId = projJson.data.id;

      await fetch(`/api/projects/${projectId}/research`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ topic: askedQuestion, depth: "standard" }),
      });

      router.push(`/${locale}/projects/${projectId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start research");
      setEscalating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Scrim — §12 Materials & depth: dim to focus */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* §7 Spatial consistency: sheet rises from the bottom (mobile) —
          the same direction it will dismiss to. */}
      <div className="relative z-10 w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl
        shadow-xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            {/* A flat small icon read as dull/blurry on its own — giving
                it a filled gradient badge (same family as the orb) gives
                it real contrast and presence instead of thin gray-on-white. */}
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full
              bg-gradient-to-br from-fuchsia-500 via-indigo-500 to-cyan-400 shadow-sm">
              <Sparkles className="h-3.5 w-3.5 text-white" aria-hidden="true" />
            </span>
            <h2 className="ui-heading-sm text-sm text-gray-900">Ask CCJ</h2>
          </div>
          <button onClick={onClose} className="ui-pressable p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-400 hover:text-gray-700">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <form onSubmit={handleAsk} className="flex gap-2">
            <input
              autoFocus
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask anything…"
              className="flex-1 rounded-lg border border-gray-300 px-3 min-h-[44px] text-sm
                focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
            <button type="submit" disabled={loading || !question.trim()}
              className="ui-pressable rounded-lg bg-indigo-600 px-4 min-h-[44px] text-sm font-semibold
                text-white hover:bg-indigo-700 disabled:opacity-50 disabled:active:scale-100">
              {loading ? "…" : "Ask"}
            </button>
          </form>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          {answer && (
            <div className="space-y-3">
              <p className="ui-body text-sm text-gray-800">{answer}</p>

              {fromGeneralKnowledge ? (
                // Labeled plainly so a general-knowledge answer is never
                // mistaken for one backed by the (irrelevant) search results.
                <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                  ⚡ General knowledge — not cross-checked against live sources for this question.
                </p>
              ) : sources.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Sources</p>
                  {sources.map((s) => (
                    <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer"
                      className="ui-pressable flex items-center gap-1.5 text-xs text-indigo-600 hover:underline">
                      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span className="truncate">{s.title} — {s.source}</span>
                    </a>
                  ))}
                </div>
              )}

              <button onClick={handleResearchFurther} disabled={escalating}
                className="ui-pressable w-full flex items-center justify-center gap-2 rounded-lg
                  border border-indigo-200 bg-indigo-50 px-4 min-h-[44px] text-sm font-semibold
                  text-indigo-700 hover:bg-indigo-100 disabled:opacity-60">
                <Search className="h-4 w-4" aria-hidden="true" />
                {escalating ? "Starting full research…" : "Research this further"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

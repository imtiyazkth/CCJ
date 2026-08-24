"use client";
import { use } from "react";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/supabase";
import { ProjectLayout } from "@/components/layout/ProjectLayout";
import { EmptyState, ErrorBanner, Spinner } from "@/components/ui";
import type { Project, Source, CredibilityTier, SourceType } from "@ccj/types";

interface PageProps { params: Promise<{ locale: string; id: string }> }

// Platform icons
const PLATFORM_ICON: Record<string, string> = {
  "en.wikipedia.org": "📖",
  "youtube.com": "▶️",
  "x.com": "𝕏",
  "twitter.com": "𝕏",
  "instagram.com": "📸",
  "linkedin.com": "💼",
  "reddit.com": "🔴",
  "facebook.com": "📘",
  "threads.net": "🧵",
  "github.com": "🐙",
  "theguardian.com": "🗞️",
  "ndtv.com": "📺",
  "bbc.co.uk": "🎙️",
  "bbc.com": "🎙️",
};

const SOURCE_ICON: Record<SourceType, string> = {
  webpage: "🌐", pdf: "📄", video: "▶️", news: "📰", social: "💬",
  legal_document: "⚖️", official_statement: "🏛️", academic: "🎓", user_upload: "📁",
};

const CRED_CONFIG: Record<CredibilityTier, { label: string; color: string; bg: string }> = {
  primary:  { label: "Primary",  color: "#166534", bg: "#dcfce7" },
  verified: { label: "Verified", color: "#14532d", bg: "#bbf7d0" },
  credible: { label: "Credible", color: "#1e40af", bg: "#dbeafe" },
  reported: { label: "Reported", color: "#92400e", bg: "#fef3c7" },
  unknown:  { label: "Unknown",  color: "#374151", bg: "#f3f4f6" },
  disputed: { label: "Disputed", color: "#991b1b", bg: "#fee2e2" },
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true,
    });
  } catch { return ""; }
}

function getPlatformIcon(domain: string): string {
  for (const [key, icon] of Object.entries(PLATFORM_ICON)) {
    if (domain.includes(key)) return icon;
  }
  return "🌐";
}

export default function SourcesPage({ params }: PageProps) {
  const { locale, id } = use(params);
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [srcs,    setSrcs]    = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [filter,  setFilter]  = useState<"all"|"web"|"social"|"academic"|"news">("all");

  useEffect(() => {
    if (!user) return;
    Promise.all([
      apiFetch<Project>(`/api/projects/${id}`),
      apiFetch<Source[]>(`/api/projects/${id}/sources`),
    ]).then(([p, s]) => {
      if (p.data)  setProject(p.data);
      if (s.data)  setSrcs(s.data);
      if (s.error) setError(s.error);
      setLoading(false);
    });
  }, [user, id]);

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center"><Spinner size="lg" /></div>
  );
  if (!project) return null;

  const filters: Array<{ key: typeof filter; label: string; icon: string }> = [
    { key: "all",      label: "All",      icon: "🔍" },
    { key: "web",      label: "Web",      icon: "🌐" },
    { key: "news",     label: "News",     icon: "📰" },
    { key: "academic", label: "Academic", icon: "🎓" },
    { key: "social",   label: "Social",   icon: "💬" },
  ];

  const filtered = filter === "all"
    ? srcs
    : srcs.filter(s => s.sourceType === filter);

  // Group by date for timeline view
  const byDate: Record<string, Source[]> = {};
  for (const src of filtered) {
    const d = src.retrievedAt
      ? new Date(src.retrievedAt).toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" })
      : "Unknown date";
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(src);
  }

  return (
    <ProjectLayout projectId={id} projectTitle={project.title} locale={locale}>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              Sources
              <span className="ml-2 text-sm font-normal text-gray-400">
                ({filtered.length} of {srcs.length})
              </span>
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Click any source title to open original — verify before citing
            </p>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 flex-wrap">
          {filters.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                filter === f.key
                  ? "bg-blue-600 text-white shadow-sm"
                  : "bg-white border border-gray-200 text-gray-600 hover:border-blue-300"
              }`}>
              {f.icon} {f.label}
              {f.key !== "all" && (
                <span className="ml-1 rounded-full bg-black/10 px-1.5 py-0.5 text-xs">
                  {srcs.filter(s => f.key === "all" || s.sourceType === f.key).length}
                </span>
              )}
            </button>
          ))}
        </div>

        {error && <ErrorBanner message={error} />}

        {filtered.length === 0 ? (
          <EmptyState icon="📚" title="No sources yet"
            body="Run research to discover sources across web, news, academic, and social platforms." />
        ) : (
          /* Timeline-grouped source cards */
          <div className="space-y-6">
            {Object.entries(byDate).map(([date, dateSrcs]) => (
              <div key={date}>
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    📅 {date}
                  </span>
                  <div className="flex-1 h-px bg-gray-200" />
                  <span className="text-xs text-gray-400">{dateSrcs.length} sources</span>
                </div>

                <div className="space-y-3">
                  {dateSrcs.map(src => {
                    const cred = CRED_CONFIG[src.credibilityTier] ?? CRED_CONFIG.unknown;
                    const icon = getPlatformIcon(src.domain);
                    const typeIcon = SOURCE_ICON[src.sourceType] ?? "🌐";
                    const pubDate = src.publishedAt ? formatDate(src.publishedAt) : null;
                    const retDate = src.retrievedAt ? formatDate(src.retrievedAt) : null;

                    return (
                      <div key={src.id}
                        className="group rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:shadow-md hover:border-blue-200 transition-all">
                        <div className="flex items-start gap-3">
                          {/* Platform icon */}
                          <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-center text-xl">
                            {icon}
                          </div>

                          <div className="flex-1 min-w-0">
                            {/* Title — clickable link */}
                            <a href={src.url} target="_blank" rel="noopener noreferrer"
                              className="font-semibold text-blue-700 hover:text-blue-900 hover:underline line-clamp-2 text-sm leading-snug">
                              {src.title || src.domain}
                            </a>

                            {/* Domain + type + credibility */}
                            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                              <span className="text-xs text-gray-500">{src.domain}</span>
                              <span className="text-gray-300">·</span>
                              <span
                                className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold"
                                style={{ color: cred.color, background: cred.bg }}>
                                {cred.label}
                              </span>
                              <span className="text-gray-300">·</span>
                              <span className="text-xs text-gray-500">
                                {typeIcon} {src.sourceType.replace("_"," ")}
                              </span>
                            </div>

                            {/* Timestamps */}
                            <div className="mt-2 flex items-center gap-3 flex-wrap text-xs text-gray-400">
                              {pubDate && (
                                <span title="Published date">
                                  📝 Published: {pubDate}
                                </span>
                              )}
                              {retDate && (
                                <span title="When CCJ retrieved this source">
                                  🔍 Retrieved: {retDate}
                                </span>
                              )}
                              {src.author && (
                                <span>✍️ {src.author}</span>
                              )}
                            </div>

                            {/* Verify link */}
                            <div className="mt-2">
                              <a href={src.url} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium">
                                🔗 Open original source ↗
                              </a>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </ProjectLayout>
  );
}

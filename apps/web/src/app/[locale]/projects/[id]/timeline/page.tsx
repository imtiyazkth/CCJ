"use client";
import { use } from "react";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/supabase";
import { ProjectLayout } from "@/components/layout/ProjectLayout";
import { EmptyState, ErrorBanner, Spinner } from "@/components/ui";
import type { Project, Source } from "@ccj/types";

interface PageProps { params: Promise<{ locale: string; id: string }> }

function decodeHtml(raw: string): string {
  return raw
    .replace(/&lt;/g,"<").replace(/&gt;/g,">")
    .replace(/&amp;/g,"&").replace(/&quot;/g,'"')
    .replace(/&#39;/g,"'").replace(/&nbsp;/g," ")
    .replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
}

function formatMonthYear(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-IN", { month:"long", year:"numeric" });
  } catch { return "Unknown date"; }
}

function formatFull(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" });
  } catch { return dateStr; }
}

const PLATFORM_ICON: Record<string, string> = {
  "en.wikipedia.org":"📖", "youtube.com":"▶️", "x.com":"𝕏",
  "instagram.com":"📸", "linkedin.com":"💼", "reddit.com":"🔴",
  "facebook.com":"📘", "github.com":"🐙",
};

function getIcon(domain: string): string {
  for (const [k, v] of Object.entries(PLATFORM_ICON)) {
    if (domain.includes(k)) return v;
  }
  return "🌐";
}

export default function TimelinePage({ params }: PageProps) {
  const { locale, id } = use(params);
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      apiFetch<Project>(`/api/projects/${id}`),
      apiFetch<Source[]>(`/api/projects/${id}/sources`),
    ]).then(([p, s]) => {
      if (p.data) setProject(p.data);
      if (s.data) setSources(s.data);
      if (s.error) setError(s.error);
      setLoading(false);
    });
  }, [user, id]);

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center"><Spinner size="lg" /></div>
  );
  if (!project) return null;

  // Group sources by month/year of publishedAt or retrievedAt
  const withDate = sources
    .map(s => ({ ...s, date: s.publishedAt ?? s.retrievedAt ?? null }))
    .filter(s => s.date)
    .sort((a, b) => new Date(b.date!).getTime() - new Date(a.date!).getTime());

  const grouped: Record<string, typeof withDate> = {};
  for (const src of withDate) {
    const key = formatMonthYear(src.date!);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(src);
  }

  return (
    <ProjectLayout projectId={id} projectTitle={project.title} locale={locale}>
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Timeline</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Sources ordered chronologically by publication date
          </p>
        </div>

        {error && <ErrorBanner message={error} />}

        {withDate.length === 0 ? (
          <EmptyState icon="🕐" title="No dated sources"
            body="Sources with publication dates will appear here." />
        ) : (
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200" />

            <div className="space-y-8 pl-10">
              {Object.entries(grouped).map(([monthYear, srcs]) => (
                <div key={monthYear}>
                  {/* Month header */}
                  <div className="absolute left-0 flex items-center justify-center
                    w-8 h-8 rounded-full bg-blue-600 -ml-0 mt-0">
                    <div className="w-3 h-3 rounded-full bg-white" />
                  </div>
                  <h3 className="font-bold text-blue-700 text-sm uppercase
                    tracking-wider mb-3 -mt-1">
                    📅 {monthYear}
                  </h3>

                  <div className="space-y-3">
                    {srcs.map(src => {
                      const title = decodeHtml(src.title ?? "Untitled");
                      const icon  = getIcon(src.domain ?? "");

                      return (
                        <div key={src.id}
                          className="rounded-xl border border-gray-200 bg-white
                            p-3 shadow-sm hover:shadow-md hover:border-blue-200 transition-all">
                          <div className="flex items-start gap-3">
                            <span className="text-xl shrink-0">{icon}</span>
                            <div className="flex-1 min-w-0">
                              {/* Clickable title */}
                              <a href={src.url} target="_blank" rel="noopener noreferrer"
                                className="font-semibold text-blue-700 hover:underline
                                  text-sm leading-snug line-clamp-2">
                                {title}
                              </a>
                              <div className="mt-1 flex items-center gap-2 flex-wrap text-xs text-gray-500">
                                <span>{src.domain}</span>
                                {src.publishedAt && (
                                  <>
                                    <span className="text-gray-300">·</span>
                                    <span>📝 {formatFull(src.publishedAt)}</span>
                                  </>
                                )}
                                <span className="text-gray-300">·</span>
                                <span className="capitalize">{src.sourceType}</span>
                              </div>
                              <a href={src.url} target="_blank" rel="noopener noreferrer"
                                className="mt-1.5 inline-flex items-center gap-1
                                  text-xs text-blue-600 hover:text-blue-800 font-medium">
                                🔗 Open article ↗
                              </a>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ProjectLayout>
  );
}

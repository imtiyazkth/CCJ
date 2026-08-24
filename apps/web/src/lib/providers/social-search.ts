/**
 * CCJ Social Media & Platform Search
 * Searches: X/Twitter, YouTube, Instagram, LinkedIn, Reddit,
 *           Facebook, Threads, GitHub — all via public/free APIs
 */

import type { SearchResult } from "./free-search";

const H = {
  "User-Agent": "CCJ-Research/1.0",
  "Accept": "application/json",
};
const T = (ms: number) => AbortSignal.timeout(ms);

// ── YouTube Data API v3 (free: 10,000 units/day) ──────────────
// Get key: console.cloud.google.com → YouTube Data API v3
export async function searchYouTube(q: string, n = 6): Promise<SearchResult[]> {
  const key = process.env["YOUTUBE_API_KEY"];
  if (!key) return [];
  try {
    const p = new URLSearchParams({
      part: "snippet", q, type: "video,channel",
      maxResults: String(n), key, order: "relevance",
    });
    const r = await fetch(
      `https://www.googleapis.com/youtube/v3/search?${p}`,
      { headers: H, signal: T(5000) }
    );
    if (!r.ok) return [];
    const d = await r.json() as {
      items?: Array<{
        id: { kind: string; videoId?: string; channelId?: string };
        snippet: {
          title: string; description: string;
          publishedAt: string; channelTitle: string;
          thumbnails?: { default?: { url: string } };
        };
      }>;
    };
    return (d.items ?? []).map(item => {
      const isVideo   = item.id.kind === "youtube#video";
      const isChannel = item.id.kind === "youtube#channel";
      const url = isVideo
        ? `https://www.youtube.com/watch?v=${item.id.videoId}`
        : isChannel
        ? `https://www.youtube.com/channel/${item.id.channelId}`
        : "";
      return {
        url,
        title:       item.snippet.title,
        snippet:     item.snippet.description.slice(0, 300) || `By ${item.snippet.channelTitle}`,
        source:      "YouTube",
        publishedAt: item.snippet.publishedAt,
        language:    "en",
        thumbnail:   item.snippet.thumbnails?.default?.url,
        platform:    "youtube",
      } as SearchResult & { thumbnail?: string; platform: string };
    }).filter(r => r.url);
  } catch { return []; }
}

// ── Social profile search via Brave (site: operators) ────────
// Uses existing BRAVE_SEARCH_KEY. Falls back to DDG site: search.
async function searchSiteViaBrave(
  query: string,
  site: string,
  label: string,
  n = 4
): Promise<SearchResult[]> {
  const key = process.env["BRAVE_SEARCH_KEY"];
  if (!key) return searchSiteViaDDG(query, site, label, n);
  try {
    const q = `site:${site} ${query}`;
    const p = new URLSearchParams({ q, count: String(n) });
    const r = await fetch(
      `https://api.search.brave.com/res/v1/web/search?${p}`,
      {
        headers: { ...H, "Accept-Encoding": "gzip", "X-Subscription-Token": key },
        signal: T(5000),
      }
    );
    if (!r.ok) return [];
    const d = await r.json() as {
      web?: { results?: Array<{ url: string; title: string; description: string; age?: string }> };
    };
    return (d.web?.results ?? []).map(w => ({
      url: w.url, title: w.title, snippet: w.description,
      source: label, publishedAt: w.age ?? null, language: "en",
      platform: site.split(".")[0],
    })) as SearchResult[];
  } catch { return []; }
}

async function searchSiteViaDDG(
  query: string,
  site: string,
  label: string,
  n = 4
): Promise<SearchResult[]> {
  // DDG HTML search — basic snippet extraction
  try {
    const p = new URLSearchParams({ q: `site:${site} ${query}`, format: "json" });
    const r = await fetch(`https://api.duckduckgo.com/?${p}`,
      { headers: H, signal: T(5000) });
    if (!r.ok) return [];
    const d = await r.json() as {
      RelatedTopics?: Array<{ FirstURL?: string; Text?: string }>;
    };
    return (d.RelatedTopics ?? [])
      .filter(t => t.FirstURL?.includes(site))
      .slice(0, n)
      .map(t => ({
        url: t.FirstURL ?? "", title: t.Text?.slice(0, 80) ?? "",
        snippet: t.Text?.slice(0, 200) ?? "", source: label,
        publishedAt: null, language: "en",
        platform: site.split(".")[0],
      })) as SearchResult[];
  } catch { return []; }
}

// ── GitHub (free, no key required) ───────────────────────────
export async function searchGitHub(q: string, n = 4): Promise<SearchResult[]> {
  try {
    const p = new URLSearchParams({ q, per_page: String(n), sort: "best-match" });
    const r = await fetch(
      `https://api.github.com/search/repositories?${p}`,
      { headers: { ...H, "Accept": "application/vnd.github+json" }, signal: T(5000) }
    );
    if (!r.ok) return [];
    const d = await r.json() as {
      items?: Array<{ html_url: string; full_name: string; description: string; updated_at: string; stargazers_count: number }>;
    };
    return (d.items ?? []).map(repo => ({
      url: repo.html_url,
      title: repo.full_name,
      snippet: `${repo.description ?? ""} ⭐ ${repo.stargazers_count}`,
      source: "GitHub", publishedAt: repo.updated_at, language: "en",
      platform: "github",
    }));
  } catch { return []; }
}

// ── Master social search — all platforms in parallel ─────────
export interface SocialSearchResult extends SearchResult {
  platform: string;
  thumbnail?: string;
}

export async function searchAllSocialMedia(
  query: string,
  n = 4
): Promise<SocialSearchResult[]> {
  const [yt, twitter, instagram, linkedin, reddit, facebook, threads, github] =
    await Promise.allSettled([
      searchYouTube(query, n),
      searchSiteViaBrave(query, "x.com", "X (Twitter)", n),
      searchSiteViaBrave(query, "instagram.com", "Instagram", n),
      searchSiteViaBrave(query, "linkedin.com", "LinkedIn", n),
      searchSiteViaBrave(query, "reddit.com", "Reddit", n),
      searchSiteViaBrave(query, "facebook.com", "Facebook", n),
      searchSiteViaBrave(query, "threads.net", "Threads", n),
      searchGitHub(query, Math.min(n, 3)),
    ]);

  const all: SocialSearchResult[] = [];
  for (const r of [yt, twitter, instagram, linkedin, reddit, facebook, threads, github]) {
    if (r.status === "fulfilled") {
      for (const item of r.value) {
        all.push({
          ...item,
          platform: (item as any).platform ?? "web",
        } as SocialSearchResult);
      }
    }
  }
  return all;
}

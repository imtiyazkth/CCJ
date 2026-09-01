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

// ── YouTube Data API v3: metadata for a SPECIFIC known video ──
// Used by the YouTube ingestion pipeline (apps/web/src/lib/youtube/ingest.ts)
// to fill in channel/publishedAt/thumbnail/duration once a video has
// already been identified by URL — distinct from searchYouTube() above,
// which discovers videos by keyword search.
export interface YoutubeVideoMetadata {
  title:           string | null;
  channel:         string | null;
  publishedAt:     string | null; // ISO-8601
  thumbnailUrl:    string | null;
  durationSeconds: number | null;
}

/** Parses an ISO-8601 duration (e.g. "PT4M13S") into seconds. */
function parseIso8601Duration(iso: string): number | null {
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const h = parseInt(m[1] ?? "0", 10);
  const min = parseInt(m[2] ?? "0", 10);
  const s = parseInt(m[3] ?? "0", 10);
  return h * 3600 + min * 60 + s;
}

export async function fetchYoutubeVideoMetadata(videoId: string): Promise<YoutubeVideoMetadata> {
  const empty: YoutubeVideoMetadata = {
    title: null, channel: null, publishedAt: null, thumbnailUrl: null, durationSeconds: null,
  };
  const key = process.env["YOUTUBE_API_KEY"];
  if (!key) return empty; // no key configured — never invent metadata

  try {
    const p = new URLSearchParams({ part: "snippet,contentDetails", id: videoId, key });
    const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?${p}`, {
      headers: H, signal: T(5000),
    });
    if (!r.ok) return empty;
    const d = await r.json() as {
      items?: Array<{
        snippet?: {
          title?: string; channelTitle?: string; publishedAt?: string;
          thumbnails?: { high?: { url?: string }; default?: { url?: string } };
        };
        contentDetails?: { duration?: string };
      }>;
    };
    const item = d.items?.[0];
    if (!item) return empty; // video not found/unlisted/deleted — never invent

    return {
      title:           item.snippet?.title ?? null,
      channel:         item.snippet?.channelTitle ?? null,
      publishedAt:     item.snippet?.publishedAt ?? null,
      thumbnailUrl:    item.snippet?.thumbnails?.high?.url ?? item.snippet?.thumbnails?.default?.url ?? null,
      durationSeconds: item.contentDetails?.duration ? parseIso8601Duration(item.contentDetails.duration) : null,
    };
  } catch {
    return empty;
  }
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
export interface SocialSearchResult {
  url:         string;
  title:       string;
  snippet:     string;
  source:      string;
  publishedAt: string | null;
  language:    string;
  // FetchResult-compatible fields
  timestamp:   string | null;   // alias for publishedAt
  credibility: number;          // default 0.55 for social
  platform:    string;
  thumbnail?:  string;
}

function normaliseSocial(items: unknown[], platform: string, credibility: number): SocialSearchResult[] {
  return (items as Array<Record<string, unknown>>).map(item => ({
    url:         String(item["url"] ?? ""),
    title:       String(item["title"] ?? ""),
    snippet:     String(item["snippet"] ?? ""),
    source:      String(item["source"] ?? platform),
    publishedAt: (item["publishedAt"] as string | null) ?? (item["timestamp"] as string | null) ?? null,
    language:    String(item["language"] ?? "en"),
    timestamp:   (item["publishedAt"] as string | null) ?? (item["timestamp"] as string | null) ?? null,
    credibility: typeof item["credibility"] === "number" ? item["credibility"] : credibility,
    platform:    String(item["platform"] ?? platform),
    thumbnail:   item["thumbnail"] as string | undefined,
  })).filter(r => r.url);
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
  const sources = [
    { result: yt,        platform: "youtube",   cred: 0.60 },
    { result: twitter,   platform: "twitter",   cred: 0.50 },
    { result: instagram, platform: "instagram", cred: 0.45 },
    { result: linkedin,  platform: "linkedin",  cred: 0.55 },
    { result: reddit,    platform: "reddit",    cred: 0.50 },
    { result: facebook,  platform: "facebook",  cred: 0.45 },
    { result: threads,   platform: "threads",   cred: 0.45 },
    { result: github,    platform: "github",    cred: 0.70 },
  ];
  for (const { result, platform, cred } of sources) {
    if (result.status === "fulfilled") {
      all.push(...normaliseSocial(result.value, platform, cred));
    }
  }
  // Deduplicate by URL
  const seen = new Set<string>();
  return all.filter(r => r.url && !seen.has(r.url) && seen.add(r.url));
}

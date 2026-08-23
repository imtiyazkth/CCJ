/**
 * CCJ Free Search Providers
 * Zero API keys required. All run in Vercel serverless.
 */

export interface SearchResult {
  url:         string;
  title:       string;
  snippet:     string;
  source:      string;
  publishedAt: string | null;
}

const HEADERS = {
  "User-Agent": "CCJ-Research/1.0 (content creation research tool)",
  "Accept": "application/json",
};

// ── Wikipedia ────────────────────────────────────────────────
// 500 requests/second, no key, full article content
export async function searchWikipedia(
  query: string,
  language = "en",
  limit = 5
): Promise<SearchResult[]> {
  const base = `https://${language}.wikipedia.org/w/api.php`;
  const params = new URLSearchParams({
    action:   "query",
    list:     "search",
    srsearch: query,
    srlimit:  String(limit),
    format:   "json",
    origin:   "*",
  });

  const res = await fetch(`${base}?${params}`, { headers: HEADERS });
  if (!res.ok) return [];
  const data = await res.json() as {
    query?: { search?: Array<{ title: string; snippet: string; pageid: number }> }
  };

  return (data.query?.search ?? []).map((item) => ({
    url:         `https://${language}.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, "_"))}`,
    title:       item.title,
    snippet:     item.snippet.replace(/<[^>]+>/g, ""),
    source:      "Wikipedia",
    publishedAt: null,
  }));
}

// ── Wikipedia full article extract ───────────────────────────
export async function getWikipediaArticle(
  title: string,
  language = "en"
): Promise<string> {
  const base = `https://${language}.wikipedia.org/w/api.php`;
  const params = new URLSearchParams({
    action:      "query",
    titles:      title,
    prop:        "extracts",
    exintro:     "1",
    explaintext: "1",
    format:      "json",
    origin:      "*",
  });
  const res = await fetch(`${base}?${params}`, { headers: HEADERS });
  if (!res.ok) return "";
  const data = await res.json() as {
    query?: { pages?: Record<string, { extract?: string }> }
  };
  const pages = data.query?.pages ?? {};
  const page = Object.values(pages)[0];
  return page?.extract ?? "";
}

// ── GDELT — Global news database ─────────────────────────────
// Completely free, no key, covers 100+ languages
export async function searchGDELT(
  query: string,
  maxRecords = 10,
  language = "English"
): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    query:      `${query} sourcelang:${language}`,
    mode:       "artlist",
    maxrecords: String(maxRecords),
    format:     "json",
    sort:       "datedesc",
  });

  try {
    const res = await fetch(
      `https://api.gdeltproject.org/api/v2/doc/doc?${params}`,
      { headers: HEADERS, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return [];
    const data = await res.json() as {
      articles?: Array<{
        url: string; title: string; seendate: string; domain: string; socialimage?: string;
      }>
    };
    return (data.articles ?? []).map((a) => ({
      url:         a.url,
      title:       a.title,
      snippet:     `News from ${a.domain}`,
      source:      "GDELT",
      publishedAt: a.seendate ?? null,
    }));
  } catch {
    return [];
  }
}

// ── HackerNews — Tech/legal/public interest ──────────────────
export async function searchHackerNews(query: string, limit = 5): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    query,
    hitsPerPage: String(limit),
    tags:        "story",
  });
  try {
    const res = await fetch(
      `https://hn.algolia.com/api/v1/search?${params}`,
      { headers: HEADERS, signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return [];
    const data = await res.json() as {
      hits?: Array<{ url?: string; title?: string; story_text?: string; created_at?: string }>
    };
    return (data.hits ?? [])
      .filter((h) => h.url)
      .map((h) => ({
        url:         h.url!,
        title:       h.title ?? "",
        snippet:     h.story_text?.slice(0, 200) ?? "",
        source:      "HackerNews",
        publishedAt: h.created_at ?? null,
      }));
  } catch {
    return [];
  }
}

// ── DuckDuckGo Instant Answers ───────────────────────────────
export async function duckDuckGoInstant(query: string): Promise<string> {
  const params = new URLSearchParams({
    q:              query,
    format:         "json",
    no_redirect:    "1",
    no_html:        "1",
    skip_disambig:  "1",
  });
  try {
    const res = await fetch(
      `https://api.duckduckgo.com/?${params}`,
      { headers: HEADERS, signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return "";
    const data = await res.json() as { AbstractText?: string; Answer?: string };
    return data.AbstractText ?? data.Answer ?? "";
  } catch {
    return "";
  }
}

// ── Aggregate: run all free searches in parallel ─────────────
export async function runFreeSearch(
  query: string,
  language = "en",
  maxPerSource = 5
): Promise<{ results: SearchResult[]; instantAnswer: string }> {
  const [wiki, gdelt, hn, instant] = await Promise.allSettled([
    searchWikipedia(query, language, maxPerSource),
    searchGDELT(query, maxPerSource),
    searchHackerNews(query, maxPerSource),
    duckDuckGoInstant(query),
  ]);

  const results: SearchResult[] = [
    ...(wiki.status    === "fulfilled" ? wiki.value    : []),
    ...(gdelt.status   === "fulfilled" ? gdelt.value   : []),
    ...(hn.status      === "fulfilled" ? hn.value      : []),
  ];

  // Deduplicate by URL
  const seen = new Set<string>();
  const unique = results.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  return {
    results:       unique,
    instantAnswer: instant.status === "fulfilled" ? instant.value : "",
  };
}

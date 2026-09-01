/**
 * CCJ Module 2 — Multi-Platform OSINT Data Fetcher
 *
 * Fetches real-time data from 8 sources concurrently.
 * All zero-cost. Falls back gracefully on timeout/error.
 */

import { runAllSources } from "./free-search";

export interface FetchResult {
  title:        string;
  source:       string;
  platform:     string;
  url:          string;
  snippet:      string;
  timestamp:    string | null;
  credibility:  number;      // 0.0–1.0
  language:     string;
  publishedAt?: string | null;
  thumbnail?:   string;
  raw?:         unknown;
}


// ── HTML entity decoder ───────────────────────────────────────
function cleanSnippet(raw: string): string {
  return raw
    .replace(/&lt;/g,  "<").replace(/&gt;/g,  ">")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ").trim();
}

const H = { "User-Agent": "CCJ-OSINT/2.0 (research platform)", "Accept": "application/json" };
const T = (ms: number) => AbortSignal.timeout(ms);

// ── 1. Wikipedia full summary ─────────────────────────────────
async function fetchWikipedia(entity: string, lang = "en"): Promise<FetchResult[]> {
  try {
    // Search
    const sp = new URLSearchParams({ action:"query", list:"search", srsearch:entity,
      srlimit:"6", format:"json", origin:"*" });
    const sr = await fetch(`https://${lang}.wikipedia.org/w/api.php?${sp}`,
      { headers: H, signal: T(6000) });
    if (!sr.ok) return [];
    const sd = await sr.json() as {
      query?: { search?: Array<{ title: string; snippet: string }> }
    };
    const results: FetchResult[] = [];

    // Get extract for top result
    for (const item of (sd.query?.search ?? []).slice(0, 4)) {
      const ep = new URLSearchParams({ action:"query", titles: item.title,
        prop:"extracts|info", exintro:"1", explaintext:"1", exchars:"2000",
        inprop:"url", format:"json", origin:"*" });
      const er = await fetch(`https://${lang}.wikipedia.org/w/api.php?${ep}`,
        { headers: H, signal: T(5000) });
      if (!er.ok) continue;
      const ed = await er.json() as {
        query?: { pages?: Record<string, { extract?: string; fullurl?: string }> }
      };
      const page = Object.values(ed.query?.pages ?? {})[0];
      results.push({
        title:       item.title,
        source:      "Wikipedia",
        platform:    "wikipedia",
        url:         page?.fullurl ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(item.title)}`,
        snippet:     page?.extract?.slice(0, 800) ?? item.snippet.replace(/<[^>]+>/g, ""),
        timestamp:   null,
        credibility: 0.88,
        language:    lang,
      });
    }
    return results;
  } catch { return []; }
}

// ── 2. X/Twitter via Sotwe (public, no auth) ─────────────────
// Sotwe provides public Twitter data without API keys
async function fetchSotweTwitter(entity: string): Promise<FetchResult[]> {
  try {
    // Sotwe's search endpoint for public tweets
    const searchHandle = entity.replace(/\s+/g, "").toLowerCase();
    const endpoints = [
      `https://api.sotwe.com/v3/user/${searchHandle}`,
    ];

    const results: FetchResult[] = [];

    for (const ep of endpoints) {
      try {
        const r = await fetch(ep, {
          headers: { ...H, "Referer": "https://www.sotwe.com" },
          signal: T(5000),
        });
        if (!r.ok) continue;
        const d = await r.json() as {
          data?: {
            user?: { name?: string; description?: string; location?: string };
            tweets?: Array<{ text?: string; created_at?: string; url?: string }>;
          }
        };

        const user = d.data?.user;
        if (user?.name) {
          results.push({
            title:       `${user.name} (@${searchHandle}) — X Profile`,
            source:      "X (Twitter) via Sotwe",
            platform:    "twitter",
            url:         `https://x.com/${searchHandle}`,
            snippet:     user.description ?? "Public X profile",
            timestamp:   null,
            credibility: 0.55,
            language:    "en",
          });
        }

        for (const tweet of (d.data?.tweets ?? []).slice(0, 5)) {
          if (tweet.text) {
            results.push({
              title:       `Post by @${searchHandle}`,
              source:      "X (Twitter) via Sotwe",
              platform:    "twitter",
              url:         tweet.url ?? `https://x.com/${searchHandle}`,
              snippet:     tweet.text.slice(0, 500),
              timestamp:   tweet.created_at ?? null,
              credibility: 0.50,
              language:    "en",
            });
          }
        }
      } catch { continue; }
    }

    // Fallback: DuckDuckGo site:x.com search
    if (results.length === 0) {
      const ddg = await fetchDDGSiteSearch(entity, "x.com", "X (Twitter)", 4);
      results.push(...ddg);
    }

    return results;
  } catch { return []; }
}

// ── 3. DuckDuckGo Knowledge Base + News ───────────────────────
async function fetchDuckDuckGo(entity: string): Promise<FetchResult[]> {
  const results: FetchResult[] = [];
  try {
    // Instant answer / Knowledge Graph
    const ap = new URLSearchParams({ q: entity, format: "json",
      no_redirect: "1", no_html: "1", skip_disambig: "1" });
    const ar = await fetch(`https://api.duckduckgo.com/?${ap}`,
      { headers: H, signal: T(5000) });
    if (ar.ok) {
      const ad = await ar.json() as {
        AbstractText?: string; AbstractURL?: string; AbstractSource?: string;
        Answer?: string; AnswerType?: string;
        RelatedTopics?: Array<{ FirstURL?: string; Text?: string }>;
        Results?: Array<{ FirstURL?: string; Text?: string }>;
      };

      if (ad.AbstractText) {
        results.push({
          title:       `${entity} — Knowledge Summary`,
          source:      `DuckDuckGo (${ad.AbstractSource ?? "KB"})`,
          platform:    "duckduckgo",
          url:         ad.AbstractURL ?? `https://duckduckgo.com/?q=${encodeURIComponent(entity)}`,
          snippet:     ad.AbstractText.slice(0, 1000),
          timestamp:   null,
          credibility: 0.78,
          language:    "en",
        });
      }

      if (ad.Answer) {
        results.push({
          title:       `Direct Answer: ${entity}`,
          source:      "DuckDuckGo Instant",
          platform:    "duckduckgo",
          url:         `https://duckduckgo.com/?q=${encodeURIComponent(entity)}`,
          snippet:     ad.Answer,
          timestamp:   null,
          credibility: 0.80,
          language:    "en",
        });
      }

      for (const topic of (ad.RelatedTopics ?? []).slice(0, 3)) {
        if (topic.FirstURL && topic.Text) {
          results.push({
            title:       topic.Text.slice(0, 80),
            source:      "DuckDuckGo Related",
            platform:    "duckduckgo",
            url:         topic.FirstURL,
            snippet:     topic.Text.slice(0, 400),
            timestamp:   null,
            credibility: 0.65,
            language:    "en",
          });
        }
      }
    }
  } catch { /* continue */ }
  return results;
}

// ── 4. RSSHub — standardised RSS aggregation ─────────────────
// RSSHub converts 200+ sources to unified JSON feeds
// Public instance: rsshub.app (no key required)
async function fetchRSSHub(entity: string, intent: string): Promise<FetchResult[]> {
  const results: FetchResult[] = [];
  const encoded = encodeURIComponent(entity);

  // Choose RSS feeds based on intent
  const feeds: Array<{ url: string; label: string; credibility: number }> = [
    // Google News RSS (no key)
    {
      url:         `https://news.google.com/rss/search?q=${encoded}&hl=en-IN&gl=IN&ceid=IN:en`,
      label:       "Google News",
      credibility: 0.72,
    },
    // Reddit via RSSHub
    {
      url:         `https://rsshub.app/reddit/search/${encoded}`,
      label:       "Reddit (RSSHub)",
      credibility: 0.50,
    },
  ];

  if (intent === "legal" || intent === "political") {
    feeds.push({
      url:         `https://news.google.com/rss/search?q=${encoded}+site:ndtv.com+OR+site:thehindu.com&hl=en-IN`,
      label:       "Indian News (Legal/Political)",
      credibility: 0.78,
    });
  }

  for (const feed of feeds) {
    try {
      const r = await fetch(feed.url, {
        headers: { ...H, "Accept": "application/rss+xml, application/xml, text/xml" },
        signal: T(6000),
      });
      if (!r.ok) continue;

      const xml = await r.text();
      // Parse RSS items without a library
      const items = parseRSSXML(xml, feed.label, feed.credibility);
      results.push(...items.slice(0, 6));
    } catch { continue; }
  }

  return results;
}

function parseRSSXML(xml: string, label: string, credibility: number): FetchResult[] {
  const items: FetchResult[] = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null && items.length < 8) {
    const block = match[1] ?? "";
    const title   = stripCDATA(extractTag(block, "title"));
    const link    = extractTag(block, "link") || extractTag(block, "guid");
    const desc    = stripCDATA(stripHTML(extractTag(block, "description")));
    const pubDate = extractTag(block, "pubDate");

    if (title && link) {
      items.push({
        title:       title.slice(0, 200),
        source:      label,
        platform:    "rss",
        url:         link.trim(),
        snippet: cleanSnippet(desc).slice(0, 400),
        timestamp:   pubDate || null,
        credibility,
        language:    "en",
      });
    }
  }
  return items;
}

function extractTag(xml: string, tag: string): string {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, "i").exec(xml);
  return m?.[1]?.trim() ?? "";
}

function stripCDATA(text: string): string {
  return text.replace(/<!\[CDATA\[|\]\]>/g, "").trim();
}

function stripHTML(text: string): string {
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// ── 5. DuckDuckGo site: operator search (helper) ─────────────
async function fetchDDGSiteSearch(
  entity: string, site: string, label: string, n = 5
): Promise<FetchResult[]> {
  try {
    const p = new URLSearchParams({
      q: `site:${site} "${entity}"`, format: "json",
      no_redirect: "1", no_html: "1",
    });
    const r = await fetch(`https://api.duckduckgo.com/?${p}`,
      { headers: H, signal: T(5000) });
    if (!r.ok) return [];
    const d = await r.json() as {
      RelatedTopics?: Array<{ FirstURL?: string; Text?: string }>
    };
    return (d.RelatedTopics ?? [])
      .filter(t => t.FirstURL?.includes(site))
      .slice(0, n)
      .map(t => ({
        title:       t.Text?.slice(0, 100) ?? label,
        source:      label,
        platform:    site.split(".")[0] ?? "web",
        url:         t.FirstURL ?? "",
        snippet: cleanSnippet(t.Text ?? "").slice(0, 300) ?? "",
        timestamp:   null,
        credibility: 0.55,
        language:    "en",
      }));
  } catch { return []; }
}

// ── 6. GDELT Global News Database ────────────────────────────
async function fetchGDELT(entity: string, n = 8): Promise<FetchResult[]> {
  try {
    const p = new URLSearchParams({
      query: entity, mode: "artlist", maxrecords: String(n),
      format: "json", sort: "datedesc",
    });
    const r = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?${p}`,
      { headers: H, signal: T(6000) });
    if (!r.ok) return [];
    const d = await r.json() as {
      articles?: Array<{ url: string; title: string; seendate: string; domain: string }>
    };
    return (d.articles ?? []).map(a => ({
      title:       a.title,
      source:      `GDELT (${a.domain})`,
      platform:    "gdelt",
      url:         a.url,
      snippet:     `News from ${a.domain} indexed by GDELT`,
      timestamp:   a.seendate,
      credibility: 0.68,
      language:    "en",
    }));
  } catch { return []; }
}

// ── 7. OpenAlex Academic ──────────────────────────────────────
async function fetchOpenAlex(entity: string, n = 4): Promise<FetchResult[]> {
  try {
    const p = new URLSearchParams({
      search: entity, "per-page": String(n),
      select: "title,doi,publication_date,primary_location,abstract_inverted_index",
    });
    const r = await fetch(`https://api.openalex.org/works?${p}`, {
      headers: { ...H, "User-Agent": "CCJ-Research/2.0 (mailto:research@ccj.app)" },
      signal: T(5000),
    });
    if (!r.ok) return [];
    const d = await r.json() as {
      results?: Array<{
        title: string; doi?: string; publication_date?: string;
        primary_location?: { landing_page_url?: string };
        abstract_inverted_index?: Record<string, number[]>;
      }>
    };
    return (d.results ?? []).map(w => {
      let abstract = "";
      if (w.abstract_inverted_index) {
        const words: string[] = [];
        for (const [word, positions] of Object.entries(w.abstract_inverted_index)) {
          for (const pos of positions) words[pos] = word;
        }
        abstract = words.join(" ").slice(0, 500);
      }
      return {
        title:       w.title ?? "Academic Paper",
        source:      "OpenAlex (Academic)",
        platform:    "academic",
        url:         w.primary_location?.landing_page_url ?? w.doi ?? "",
        snippet:     abstract,
        timestamp:   w.publication_date ?? null,
        credibility: 0.90,
        language:    "en",
      };
    }).filter(r => r.url);
  } catch { return []; }
}

// ── Master Fetcher — all sources in parallel ──────────────────
export async function fetchMultiPlatformData(
  entity: string,
  intent  = "general",
  language = "en",
  depth: "quick"|"standard"|"deep" = "standard"
): Promise<FetchResult[]> {
  const n = depth === "quick" ? 4 : depth === "deep" ? 10 : 6;

  const [wiki, twitter, ddg, rss, gdelt, academic, freeSources] = await Promise.allSettled([
    fetchWikipedia(entity, language),
    fetchSotweTwitter(entity),
    fetchDuckDuckGo(entity),
    fetchRSSHub(entity, intent),
    fetchGDELT(entity, n),
    fetchOpenAlex(entity, Math.min(n, 4)),
    // Additional free/keyed sources: Brave Search, Guardian, NewsAPI,
    // Reddit, HackerNews — previously implemented in free-search.ts but
    // never actually wired into the research pipeline. Adding them here
    // gives the pipeline real independent web/news sources beyond the
    // narrower RSS/GDELT/Wikipedia set above, which matters especially
    // for verifying YouTube-derived claims against independent evidence.
    runAllSources(entity, language, depth),
  ]);

  const all: FetchResult[] = [];
  for (const r of [wiki, twitter, ddg, rss, gdelt, academic]) {
    if (r.status === "fulfilled") all.push(...r.value);
  }

  if (freeSources.status === "fulfilled") {
    const SOURCE_CREDIBILITY: Record<string, number> = {
      "Brave Search": 0.60,
      "HackerNews":   0.55,
      "Reddit":       0.45,
    };
    const creditFor = (source: string): number => {
      if (source.startsWith("NewsAPI")) return 0.72;
      if (source.startsWith("The Guardian") || source.includes("Guardian")) return 0.85;
      return SOURCE_CREDIBILITY[source] ?? 0.55;
    };
    all.push(...freeSources.value.results.map((r): FetchResult => ({
      title:       r.title,
      source:      r.source,
      platform:    r.source.toLowerCase().includes("news") || r.source.includes("Guardian") ? "news" : "web",
      url:         r.url,
      snippet:     r.snippet,
      timestamp:   r.publishedAt,
      credibility: creditFor(r.source),
      language:    r.language,
      publishedAt: r.publishedAt,
    })));
  }

  // Deduplicate by URL
  const seen = new Set<string>();
  return all.filter(r => r.url && !seen.has(r.url) && seen.add(r.url));
}

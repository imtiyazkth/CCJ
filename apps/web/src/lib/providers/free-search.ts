/**
 * CCJ Free Search Providers — 8 sources, all parallel
 * Zero mandatory API keys. Optional keys unlock more results.
 */

export interface SearchResult {
  url:         string;
  title:       string;
  snippet:     string;
  source:      string;
  publishedAt: string | null;
  language:    string;
}

const T = (ms: number) => AbortSignal.timeout(ms);



const H = { "User-Agent": "CCJ-Research/1.0", "Accept": "application/json" };

// ── 1. Wikipedia ──────────────────────────────────────────────
export async function searchWikipedia(q: string, lang = "en", n = 6): Promise<SearchResult[]> {
  try {
    const p = new URLSearchParams({ action:"query", list:"search", srsearch:q,
      srlimit:String(n), format:"json", origin:"*" });
    const r = await fetch(`https://${lang}.wikipedia.org/w/api.php?${p}`, { headers:H, signal:T(5000) });
    if (!r.ok) return [];
    const d = await r.json() as { query?:{ search?:Array<{title:string;snippet:string}> } };
    return (d.query?.search ?? []).map(i => ({
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(i.title.replace(/ /g,"_"))}`,
      title: i.title, snippet: i.snippet.replace(/<[^>]+>/g,""),
      source:"Wikipedia", publishedAt:null, language:lang,
    }));
  } catch { return []; }
}

export async function getWikipediaArticle(title: string, lang = "en"): Promise<string> {
  try {
    const p = new URLSearchParams({ action:"query", titles:title,
      prop:"extracts", exintro:"1", explaintext:"1", exchars:"3000",
      format:"json", origin:"*" });
    const r = await fetch(`https://${lang}.wikipedia.org/w/api.php?${p}`, { headers:H, signal:T(4000) });
    if (!r.ok) return "";
    const d = await r.json() as { query?:{ pages?:Record<string,{ extract?:string }> } };
    const page = Object.values(d.query?.pages ?? {})[0];
    return page?.extract ?? "";
  } catch { return ""; }
}

// ── 2. GDELT Global News ──────────────────────────────────────
export async function searchGDELT(q: string, n = 8): Promise<SearchResult[]> {
  try {
    const p = new URLSearchParams({ query:q, mode:"artlist",
      maxrecords:String(n), format:"json", sort:"datedesc" });
    const r = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?${p}`,
      { headers:H, signal:T(6000) });
    if (!r.ok) return [];
    const d = await r.json() as { articles?:Array<{url:string;title:string;seendate:string;domain:string}> };
    return (d.articles ?? []).map(a => ({
      url:a.url, title:a.title, snippet:`News from ${a.domain}`,
      source:"GDELT News", publishedAt:a.seendate, language:"en",
    }));
  } catch { return []; }
}

// ── 3. The Guardian ───────────────────────────────────────────
// Free key: https://open-platform.theguardian.com/access/ (instant approval)
export async function searchGuardian(q: string, n = 5): Promise<SearchResult[]> {
  const key = process.env["GUARDIAN_API_KEY"] ?? "test"; // "test" = demo mode, limited
  try {
    const p = new URLSearchParams({ q, "show-fields":"trailText",
      "page-size":String(n), format:"json", "api-key":key });
    const r = await fetch(`https://content.guardianapis.com/search?${p}`,
      { headers:H, signal:T(5000) });
    if (!r.ok) return [];
    const d = await r.json() as {
      response?:{ results?:Array<{webUrl:string;webTitle:string;webPublicationDate:string;fields?:{trailText?:string}}> }
    };
    return (d.response?.results ?? []).map(a => ({
      url:a.webUrl, title:a.webTitle,
      snippet:a.fields?.trailText?.replace(/<[^>]+>/g,"") ?? "",
      source:"The Guardian", publishedAt:a.webPublicationDate, language:"en",
    }));
  } catch { return []; }
}

// ── 4. Reddit (public posts, no key) ─────────────────────────
export async function searchReddit(q: string, n = 5): Promise<SearchResult[]> {
  try {
    const p = new URLSearchParams({ q, sort:"relevance", limit:String(n), type:"link" });
    const r = await fetch(`https://www.reddit.com/search.json?${p}`,
      { headers:{ ...H, "User-Agent":"CCJ-Research/1.0 (research tool)" }, signal:T(5000) });
    if (!r.ok) return [];
    const d = await r.json() as {
      data?:{ children?:Array<{ data:{ url:string;title:string;selftext:string;created_utc:number;subreddit:string} }> }
    };
    return (d.data?.children ?? [])
      .filter(c => !c.data.url.includes("reddit.com"))
      .map(c => ({
        url:c.data.url, title:c.data.title,
        snippet:c.data.selftext.slice(0,200) || `r/${c.data.subreddit}`,
        source:"Reddit", publishedAt:new Date(c.data.created_utc*1000).toISOString(), language:"en",
      }));
  } catch { return []; }
}

// ── 5. OpenAlex — Academic Papers (free, no key) ─────────────
export async function searchOpenAlex(q: string, n = 4): Promise<SearchResult[]> {
  try {
    const p = new URLSearchParams({ search:q, "per-page":String(n),
      select:"title,doi,publication_date,primary_location,abstract_inverted_index" });
    const r = await fetch(`https://api.openalex.org/works?${p}`,
      { headers:{ ...H, "User-Agent":"CCJ-Research/1.0 (mailto:research@ccj.local)" }, signal:T(5000) });
    if (!r.ok) return [];
    const d = await r.json() as {
      results?:Array<{
        title:string; doi?:string; publication_date?:string;
        primary_location?:{ landing_page_url?:string };
        abstract_inverted_index?: Record<string,number[]>;
      }>
    };
    return (d.results ?? []).map(w => {
      // Reconstruct abstract from inverted index
      let abstract = "";
      if (w.abstract_inverted_index) {
        const words: string[] = [];
        for (const [word, positions] of Object.entries(w.abstract_inverted_index)) {
          for (const pos of positions) words[pos] = word;
        }
        abstract = words.join(" ").slice(0, 300);
      }
      return {
        url: w.primary_location?.landing_page_url ?? w.doi ?? "",
        title: w.title ?? "", snippet: abstract,
        source:"Academic (OpenAlex)", publishedAt:w.publication_date ?? null, language:"en",
      };
    }).filter(r => r.url);
  } catch { return []; }
}

// ── 6. Brave Search (2000 req/month free) ────────────────────
// Free key: https://brave.com/search/api/
export async function searchBrave(q: string, n = 6): Promise<SearchResult[]> {
  const key = process.env["BRAVE_SEARCH_KEY"];
  if (!key) return [];
  try {
    const p = new URLSearchParams({ q, count:String(n), safesearch:"moderate" });
    const r = await fetch(`https://api.search.brave.com/res/v1/web/search?${p}`, {
      headers:{ ...H, "Accept-Encoding":"gzip", "X-Subscription-Token":key }, signal:T(5000),
    });
    if (!r.ok) return [];
    const d = await r.json() as {
      web?:{ results?:Array<{url:string;title:string;description:string;age?:string}> }
    };
    return (d.web?.results ?? []).map(w => ({
      url:w.url, title:w.title, snippet:w.description,
      source:"Brave Search", publishedAt:w.age ?? null, language:"en",
    }));
  } catch { return []; }
}

// ── 7. NewsAPI (100 req/day free) ────────────────────────────
// Free key: https://newsapi.org
export async function searchNewsAPI(q: string, n = 5): Promise<SearchResult[]> {
  const key = process.env["NEWSAPI_KEY"];
  if (!key) return [];
  try {
    const p = new URLSearchParams({ q, pageSize:String(n), sortBy:"relevancy", language:"en" });
    const r = await fetch(`https://newsapi.org/v2/everything?${p}`,
      { headers:{ ...H, "X-Api-Key":key }, signal:T(5000) });
    if (!r.ok) return [];
    const d = await r.json() as {
      articles?:Array<{url:string;title:string;description:string;publishedAt:string;source:{name:string}}>
    };
    return (d.articles ?? []).map(a => ({
      url:a.url, title:a.title, snippet:a.description ?? "",
      source:`NewsAPI — ${a.source.name}`, publishedAt:a.publishedAt, language:"en",
    }));
  } catch { return []; }
}

// ── 8. HackerNews ─────────────────────────────────────────────
export async function searchHackerNews(q: string, n = 4): Promise<SearchResult[]> {
  try {
    const p = new URLSearchParams({ query:q, hitsPerPage:String(n), tags:"story" });
    const r = await fetch(`https://hn.algolia.com/api/v1/search?${p}`,
      { headers:H, signal:T(4000) });
    if (!r.ok) return [];
    const d = await r.json() as {
      hits?:Array<{url?:string;title?:string;story_text?:string;created_at?:string}>
    };
    return (d.hits ?? []).filter(h => h.url).map(h => ({
      url:h.url!, title:h.title ?? "", snippet:h.story_text?.slice(0,200) ?? "",
      source:"HackerNews", publishedAt:h.created_at ?? null, language:"en",
    }));
  } catch { return []; }
}

// ── DuckDuckGo Instant Answer ─────────────────────────────────
export async function duckDuckGoInstant(q: string): Promise<string> {
  try {
    const p = new URLSearchParams({ q, format:"json", no_redirect:"1", no_html:"1" });
    const r = await fetch(`https://api.duckduckgo.com/?${p}`,
      { headers:H, signal:T(4000) });
    if (!r.ok) return "";
    const d = await r.json() as { AbstractText?:string; Answer?:string };
    return d.AbstractText ?? d.Answer ?? "";
  } catch { return ""; }
}

// ── Master: run all 8 sources in PARALLEL ─────────────────────
export async function runAllSources(
  query: string,
  language = "en",
  depth: "quick"|"standard"|"deep" = "standard"
): Promise<{ results: SearchResult[]; instantAnswer: string }> {
  const n = depth === "quick" ? 4 : depth === "deep" ? 10 : 6;

  // All sources fire simultaneously — fastest wins, slow ones still contribute
  const [wiki, gdelt, guardian, reddit, openalex, brave, newsapi, hn, instant] =
    await Promise.allSettled([
      searchWikipedia(query, language, n),
      searchGDELT(query, n),
      searchGuardian(query, Math.min(n, 5)),
      searchReddit(query, Math.min(n, 5)),
      searchOpenAlex(query, Math.min(n, 4)),
      searchBrave(query, n),
      searchNewsAPI(query, Math.min(n, 5)),
      searchHackerNews(query, Math.min(n, 4)),
      duckDuckGoInstant(query),
    ]);

  const all: SearchResult[] = [
    ...(wiki.status      === "fulfilled" ? wiki.value      : []),
    ...(gdelt.status     === "fulfilled" ? gdelt.value     : []),
    ...(guardian.status  === "fulfilled" ? guardian.value  : []),
    ...(reddit.status    === "fulfilled" ? reddit.value    : []),
    ...(openalex.status  === "fulfilled" ? openalex.value  : []),
    ...(brave.status     === "fulfilled" ? brave.value     : []),
    ...(newsapi.status   === "fulfilled" ? newsapi.value   : []),
    ...(hn.status        === "fulfilled" ? hn.value        : []),
  ];

  // Deduplicate
  const seen = new Set<string>();
  const unique = all.filter(r => r.url && !seen.has(r.url) && seen.add(r.url));

  return {
    results: unique,
    instantAnswer: instant.status === "fulfilled" ? instant.value : "",
  };
}

/**
 * SearXNG Search Provider
 * Implements ISearchProvider from @ccj/providers.
 * Registered only in PROVIDER_MODE=live.
 */
import type { ISearchProvider, SearchOptions, SearchResult } from "@ccj/providers";
import { validateFetchUrl } from "../middleware/security.js";

const SEARXNG_URL = process.env["SEARXNG_URL"] ?? "http://localhost:8888";

export class SearXNGProvider implements ISearchProvider {
  readonly name = "searxng";

  async isAvailable(): Promise<boolean> {
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 5_000);
      const res = await fetch(`${SEARXNG_URL}/healthz`, { signal: ctrl.signal });
      return res.ok;
    } catch { return false; }
  }

  async search(options: SearchOptions): Promise<SearchResult[]> {
    const { query, language = "en", maxResults = 10 } = options;
    if (!query.trim()) return [];

    const params = new URLSearchParams({
      q: query, format: "json", language, pageno: "1",
    });
    const searchUrl = `${SEARXNG_URL}/search?${params}`;
    await validateFetchUrl(searchUrl);

    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 15_000);
    const res = await fetch(searchUrl, {
      headers: { Accept: "application/json", "User-Agent": "CCJ-Research/1.0" },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`SearXNG ${res.status}`);
    const data = await res.json() as { results?: Array<{ url: string; title: string; content?: string; publishedDate?: string; language?: string; score?: number }> };

    return (data.results ?? []).slice(0, maxResults).map((r) => ({
      url: r.url, title: r.title, snippet: r.content ?? "",
      domain: (() => { try { return new URL(r.url).hostname; } catch { return ""; } })(),
      publishedAt: r.publishedDate ?? null, language: r.language ?? null,
      score: r.score ?? 0, sourceType: "web" as const,
    }));
  }
}

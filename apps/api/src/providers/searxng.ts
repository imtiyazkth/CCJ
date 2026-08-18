/**
 * SearXNG Search Provider
 *
 * Self-hosted meta-search. Primary search provider for CCJ.
 * No API key required for self-hosted instance.
 */

import type { ISearchProvider, SearchOptions, SearchResult } from "./interfaces.js";
import { validateFetchUrl } from "../middleware/security.js";

const SEARXNG_URL = process.env["SEARXNG_URL"] ?? "http://localhost:8888";
const FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESULTS = 10;

interface SearXNGResult {
  url: string;
  title: string;
  content?: string;
  parsed_url?: string[];
  publishedDate?: string;
  language?: string;
  score?: number;
  engine?: string;
}

interface SearXNGResponse {
  query: string;
  results: SearXNGResult[];
  suggestions?: string[];
  answers?: string[];
  infoboxes?: unknown[];
  number_of_results?: number;
}

export class SearXNGProvider implements ISearchProvider {
  readonly name = "searxng";

  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      const res = await fetch(`${SEARXNG_URL}/healthz`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }

  async search(options: SearchOptions): Promise<SearchResult[]> {
    const {
      query,
      language = "en",
      maxResults = DEFAULT_MAX_RESULTS,
      dateAfter,
      dateBefore,
    } = options;

    if (!query.trim()) return [];

    const params = new URLSearchParams({
      q: query,
      format: "json",
      language: language,
      pageno: "1",
      engines: "google,bing,duckduckgo,wikipedia",
    });

    // SearXNG time range format
    if (dateAfter) params.set("time_range", "month"); // coarse — fine filter after fetch

    const searchUrl = `${SEARXNG_URL}/search?${params.toString()}`;

    // SSRF check on our own configured URL
    await validateFetchUrl(searchUrl);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(searchUrl, {
        headers: {
          Accept: "application/json",
          // Identify ourselves to our own SearXNG instance
          "User-Agent": "CCJ-Research/1.0",
        },
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      throw new Error(`SearXNG fetch failed: ${String(err)}`);
    }
    clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`SearXNG returned ${response.status}`);
    }

    const data = (await response.json()) as SearXNGResponse;

    return data.results
      .slice(0, maxResults)
      .map((r): SearchResult => ({
        url: r.url,
        title: r.title,
        snippet: r.content ?? "",
        domain: extractDomain(r.url),
        publishedAt: r.publishedDate ?? null,
        language: r.language ?? null,
        score: r.score ?? 0,
      }))
      .filter((r) => {
        // Post-filter by date if requested
        if (dateAfter && r.publishedAt) {
          return new Date(r.publishedAt) >= dateAfter;
        }
        if (dateBefore && r.publishedAt) {
          return new Date(r.publishedAt) <= dateBefore;
        }
        return true;
      });
  }
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

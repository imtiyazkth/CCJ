/**
 * CCJ Demo Providers — all 8 implementations, zero external dependencies.
 * Default for PROVIDER_MODE=demo (Android/Termux dev, no API keys needed).
 */

import {
  type ISearchProvider, type SearchOptions, type SearchResult,
  type INewsProvider, type NewsOptions, type NewsArticle,
  type ITranslationProvider, type TranslationResult,
  type IAIProvider, type AICompletionOptions, type AICompletionResult,
  type IDocumentProvider, type ParsedDocument,
  type IStorageProvider, type StorageObject,
  type IVectorSearchProvider, type VectorPoint, type VectorSearchResult,
  type ITranscriptProvider, type VideoTranscript,
  ProviderRegistry,
} from "../index.js";

// ── Demo Search ───────────────────────────────────────────────

export class DemoSearchProvider implements ISearchProvider {
  readonly name = "demo-search";
  async isAvailable(): Promise<boolean> { return true; }
  async search(options: SearchOptions): Promise<SearchResult[]> {
    await delay(150);
    return [{
      url: "https://demo.ccj.local/result-1",
      title: `[DEMO] Result for: ${options.query.slice(0, 60)}`,
      snippet: "Demo result. Configure SEARXNG_URL or BRAVE_SEARCH_API_KEY for live search.",
      domain: "demo.ccj.local",
      publishedAt: null, language: options.language ?? "en",
      score: 0.9, sourceType: "web" as const,
    }].slice(0, options.maxResults ?? 10);
  }
}

// ── Demo News ─────────────────────────────────────────────────

export class DemoNewsProvider implements INewsProvider {
  readonly name = "demo-news";
  async isAvailable(): Promise<boolean> { return true; }
  async search(options: NewsOptions): Promise<NewsArticle[]> {
    await delay(100);
    return [{
      url: "https://demo.ccj.local/news/1",
      title: `[DEMO] News for: ${options.query.slice(0, 40)}`,
      description: "Demo news article. Configure RSS/GDELT for live news.",
      content: null, source: "Demo Reporter", author: null,
      publishedAt: new Date().toISOString(),
      language: options.language ?? "en", categories: [],
    }].slice(0, options.maxResults ?? 10);
  }
}

// ── Demo Translation ──────────────────────────────────────────

export class DemoTranslationProvider implements ITranslationProvider {
  readonly name = "demo-translation";
  async isAvailable(): Promise<boolean> { return true; }

  async translate(text: string, targetLanguage: string, sourceLanguage?: string): Promise<TranslationResult> {
    await delay(80);
    const src = sourceLanguage ?? await this.detectLanguage(text);
    if (src === targetLanguage) {
      return { sourceText: text, translatedText: text, sourceLanguage: src, targetLanguage, confidence: 1.0, wasTranslated: false };
    }
    return {
      sourceText: text,
      translatedText: `[DEMO → ${targetLanguage}] ${text}`,
      sourceLanguage: src, targetLanguage, confidence: null, wasTranslated: true,
    };
  }

  async detectLanguage(text: string): Promise<string> {
    if (/[\u0900-\u097F]/.test(text)) return "hi";
    if (/[\u0600-\u06FF]/.test(text)) return "ar";
    return "en";
  }

  async supportedLanguages(): Promise<string[]> { return ["en", "hi", "ar"]; }
}

// ── Demo AI ───────────────────────────────────────────────────

export class DemoAIProvider implements IAIProvider {
  readonly name = "demo-ai";
  async isAvailable(): Promise<boolean> { return true; }

  async complete(options: AICompletionOptions): Promise<AICompletionResult> {
    await delay(300);
    const userMsg = [...options.messages].reverse().find((m) => m.role === "user")?.content ?? "";

    let content: string;
    let parsed: unknown;

    if (options.jsonMode) {
      const obj = {
        research_questions: [
          `What are the primary facts about: ${userMsg.slice(0, 60)}?`,
          "Who are the key stakeholders?", "What primary sources exist?",
          "Are there contradictory accounts?", "What is the legal context?",
        ],
        queries: [{ query: userMsg.slice(0, 100), language: "en", provider: "demo", priority: 1 }],
        primary_source_targets: [], secondary_source_targets: [], social_source_targets: [],
        legal_questions: [], expected_entities: [], date_range: { start: null, end: null },
        risk_flags: ["[DEMO] Set OPENAI_API_KEY / ANTHROPIC_API_KEY / OLLAMA_URL for live AI."],
      };
      content = JSON.stringify(obj);
      parsed = obj;
    } else {
      content = `[DEMO AI] ${userMsg.slice(0, 80)}\n\nConfigure a live AI provider for real research planning.`;
    }

    return { content, model: "demo-v1", inputTokens: userMsg.length, outputTokens: content.length, finishReason: "stop", parsed };
  }
}

// ── Demo Document ─────────────────────────────────────────────

export class DemoDocumentProvider implements IDocumentProvider {
  readonly name = "demo-document";
  async isAvailable(): Promise<boolean> { return true; }

  async parsePDF(_buffer: ArrayBuffer): Promise<ParsedDocument> {
    return {
      text: "[DEMO] PDF parsing not available in demo mode. Configure Docling provider.",
      pages: [{ number: 1, text: "[DEMO PAGE]" }],
      metadata: { title: "Demo Document", author: null, pageCount: 1, language: "en" },
      contentHash: "demo".padEnd(64, "0"),
    };
  }

  async parseHTML(html: string, _url: string): Promise<{ text: string; title: string }> {
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 5000);
    const m = /<title[^>]*>(.*?)<\/title>/i.exec(html);
    return { text, title: m?.[1]?.trim() ?? "Untitled" };
  }
}

// ── Demo Storage (in-memory) ──────────────────────────────────

export class DemoStorageProvider implements IStorageProvider {
  readonly name = "demo-storage";
  private store = new Map<string, { data: Buffer; type: string; createdAt: string }>();

  async isAvailable(): Promise<boolean> { return true; }

  async upload(key: string, data: Buffer | Uint8Array, contentType: string): Promise<StorageObject> {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    this.store.set(key, { data: buf, type: contentType, createdAt: new Date().toISOString() });
    return { key, url: `demo://storage/${key}`, size: buf.length, contentType, createdAt: new Date().toISOString() };
  }

  async download(key: string): Promise<Buffer> {
    const obj = this.store.get(key);
    if (!obj) throw new Error(`Key not found: ${key}`);
    return obj.data;
  }

  async getSignedUrl(key: string, _expiresIn?: number): Promise<string> {
    return `demo://storage/${key}?signed=1`;
  }

  async delete(key: string): Promise<void> { this.store.delete(key); }
  async exists(key: string): Promise<boolean> { return this.store.has(key); }
}

// ── Demo Vector (in-memory cosine) ────────────────────────────

export class DemoVectorProvider implements IVectorSearchProvider {
  readonly name = "demo-vector";
  private collections = new Map<string, VectorPoint[]>();

  async isAvailable(): Promise<boolean> { return true; }

  async createCollection(name: string, _size: number): Promise<void> {
    if (!this.collections.has(name)) this.collections.set(name, []);
  }

  async upsert(col: string, points: VectorPoint[]): Promise<void> {
    const existing = this.collections.get(col) ?? [];
    for (const p of points) {
      const idx = existing.findIndex((e) => e.id === p.id);
      if (idx >= 0) existing[idx] = p; else existing.push(p);
    }
    this.collections.set(col, existing);
  }

  async search(col: string, vector: number[], limit = 10): Promise<VectorSearchResult[]> {
    return (this.collections.get(col) ?? [])
      .map((p) => ({ id: p.id, score: cosine(vector, p.vector), payload: p.payload }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async delete(col: string, ids: string[]): Promise<void> {
    const pts = this.collections.get(col) ?? [];
    this.collections.set(col, pts.filter((p) => !ids.includes(p.id)));
  }
}

// ── Demo Transcript ───────────────────────────────────────────

export class DemoTranscriptProvider implements ITranscriptProvider {
  readonly name = "demo-transcript";
  async isAvailable(): Promise<boolean> { return true; }

  async getTranscript(videoUrl: string): Promise<VideoTranscript> {
    return {
      videoId: "demo", url: videoUrl,
      title: "[DEMO] Configure YouTube Data API for real transcripts.",
      channel: null, publishedAt: null, durationSeconds: 0,
      segments: [], fullText: "[DEMO] No transcript available in demo mode.", language: "en",
    };
  }

  async getSupportedLanguages(_url: string): Promise<string[]> { return ["en"]; }
}

// ── Helpers ───────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    na  += (a[i] ?? 0) ** 2;
    nb  += (b[i] ?? 0) ** 2;
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

// ── Factory ───────────────────────────────────────────────────

export function buildDemoRegistry(): ProviderRegistry {
  return new ProviderRegistry("demo")
    .registerSearch(new DemoSearchProvider())
    .registerNews(new DemoNewsProvider())
    .registerTranslation(new DemoTranslationProvider())
    .registerAI(new DemoAIProvider())
    .registerDocument(new DemoDocumentProvider())
    .registerStorage(new DemoStorageProvider())
    .registerVector(new DemoVectorProvider())
    .registerTranscript(new DemoTranscriptProvider());
}

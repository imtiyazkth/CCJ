/**
 * @ccj/providers — Provider Interfaces + Registry
 *
 * Every external integration implements one of these interfaces.
 * No provider is mandatory. PROVIDER_MODE=demo works on Android
 * with zero external services.
 *
 * Adding a new provider = new adapter class, no business-logic edits.
 */

// ══════════════════════════════════════════════════════════════
// 1. SEARCH PROVIDER
// ══════════════════════════════════════════════════════════════

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  domain: string;
  publishedAt: string | null;
  language: string | null;
  score: number;
  sourceType: "web" | "news" | "academic" | "social";
}

export interface SearchOptions {
  query: string;
  language?: string;
  maxResults?: number;
  dateAfter?: Date;
  dateBefore?: Date;
  domains?: string[];
}

export interface ISearchProvider {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  search(options: SearchOptions): Promise<SearchResult[]>;
}

// ══════════════════════════════════════════════════════════════
// 2. NEWS PROVIDER
// ══════════════════════════════════════════════════════════════

export interface NewsArticle {
  url: string;
  title: string;
  description: string;
  content: string | null;
  source: string;
  author: string | null;
  publishedAt: string;
  language: string;
  categories: string[];
}

export interface NewsOptions {
  query: string;
  language?: string;
  maxResults?: number;
  dateAfter?: Date;
  sources?: string[];
}

export interface INewsProvider {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  search(options: NewsOptions): Promise<NewsArticle[]>;
  /** Subscribe to real-time news updates */
  watch?(query: string, callback: (article: NewsArticle) => void): () => void;
}

// ══════════════════════════════════════════════════════════════
// 3. TRANSLATION PROVIDER
// ══════════════════════════════════════════════════════════════

export interface TranslationResult {
  sourceText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  confidence: number | null;
  /** true = translated by provider; false = passthrough (same language) */
  wasTranslated: boolean;
}

export interface ITranslationProvider {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  translate(text: string, targetLanguage: string, sourceLanguage?: string): Promise<TranslationResult>;
  detectLanguage(text: string): Promise<string>;
  /** Supported language codes */
  supportedLanguages(): Promise<string[]>;
}

// ══════════════════════════════════════════════════════════════
// 4. AI / LLM PROVIDER
// ══════════════════════════════════════════════════════════════

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AICompletionOptions {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** If true, expect and return valid JSON */
  jsonMode?: boolean;
}

export interface AICompletionResult {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  finishReason: "stop" | "length" | "error";
  /** Parsed JSON when jsonMode=true */
  parsed?: unknown;
}

export interface IAIProvider {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  complete(options: AICompletionOptions): Promise<AICompletionResult>;
  /** Embed text for vector similarity */
  embed?(text: string): Promise<number[]>;
}

// ══════════════════════════════════════════════════════════════
// 5. DOCUMENT PROVIDER
// ══════════════════════════════════════════════════════════════

export interface ParsedDocument {
  text: string;
  pages: Array<{
    number: number;
    text: string;
    tables?: string[][];
  }>;
  metadata: {
    title: string | null;
    author: string | null;
    pageCount: number;
    language: string | null;
  };
  contentHash: string;
}

export interface IDocumentProvider {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  parsePDF(buffer: ArrayBuffer): Promise<ParsedDocument>;
  parseHTML(html: string, url: string): Promise<{ text: string; title: string }>;
}

// ══════════════════════════════════════════════════════════════
// 6. STORAGE PROVIDER
// ══════════════════════════════════════════════════════════════

export interface StorageObject {
  key: string;
  url: string;
  size: number;
  contentType: string;
  createdAt: string;
}

export interface IStorageProvider {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  upload(key: string, data: Buffer | Uint8Array, contentType: string): Promise<StorageObject>;
  download(key: string): Promise<Buffer>;
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

// ══════════════════════════════════════════════════════════════
// 7. VECTOR SEARCH PROVIDER
// ══════════════════════════════════════════════════════════════

export interface VectorPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

export interface VectorSearchResult {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}

export interface IVectorSearchProvider {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  upsert(collectionName: string, points: VectorPoint[]): Promise<void>;
  search(collectionName: string, vector: number[], limit?: number): Promise<VectorSearchResult[]>;
  delete(collectionName: string, ids: string[]): Promise<void>;
  createCollection(name: string, vectorSize: number): Promise<void>;
}

// ══════════════════════════════════════════════════════════════
// 8. TRANSCRIPT PROVIDER
// ══════════════════════════════════════════════════════════════

export interface TranscriptSegment {
  start: number;  // seconds
  end: number;
  text: string;
  language: string;
}

export interface VideoTranscript {
  videoId: string;
  url: string;
  title: string;
  channel: string | null;
  publishedAt: string | null;
  durationSeconds: number;
  segments: TranscriptSegment[];
  fullText: string;
  language: string;
}

export interface ITranscriptProvider {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  getTranscript(videoUrl: string, language?: string): Promise<VideoTranscript>;
  getSupportedLanguages(videoUrl: string): Promise<string[]>;
}

// ══════════════════════════════════════════════════════════════
// PROVIDER REGISTRY
// ══════════════════════════════════════════════════════════════

export type ProviderMode = "demo" | "live";

export class ProviderRegistry {
  private _mode: ProviderMode;
  private _search: ISearchProvider[] = [];
  private _news: INewsProvider[] = [];
  private _translation: ITranslationProvider[] = [];
  private _ai: IAIProvider[] = [];
  private _document: IDocumentProvider[] = [];
  private _storage: IStorageProvider[] = [];
  private _vector: IVectorSearchProvider[] = [];
  private _transcript: ITranscriptProvider[] = [];

  constructor(mode: ProviderMode = "demo") {
    this._mode = mode;
  }

  get mode(): ProviderMode { return this._mode; }

  registerSearch(p: ISearchProvider): this { this._search.push(p); return this; }
  registerNews(p: INewsProvider): this { this._news.push(p); return this; }
  registerTranslation(p: ITranslationProvider): this { this._translation.push(p); return this; }
  registerAI(p: IAIProvider): this { this._ai.push(p); return this; }
  registerDocument(p: IDocumentProvider): this { this._document.push(p); return this; }
  registerStorage(p: IStorageProvider): this { this._storage.push(p); return this; }
  registerVector(p: IVectorSearchProvider): this { this._vector.push(p); return this; }
  registerTranscript(p: ITranscriptProvider): this { this._transcript.push(p); return this; }

  private async first<T extends { isAvailable(): Promise<boolean>; name: string }>(
    providers: T[],
    type: string
  ): Promise<T> {
    for (const p of providers) {
      if (await p.isAvailable()) return p;
    }
    throw new Error(`No ${type} provider available. In demo mode, ensure DemoProvider is registered.`);
  }

  getSearch() { return this.first(this._search, "search"); }
  getNews() { return this.first(this._news, "news"); }
  getTranslation() { return this.first(this._translation, "translation"); }
  getAI() { return this.first(this._ai, "AI"); }
  getDocument() { return this.first(this._document, "document"); }
  getStorage() { return this.first(this._storage, "storage"); }
  getVector() { return this.first(this._vector, "vector search"); }
  getTranscript() { return this.first(this._transcript, "transcript"); }

  /** Return list of all registered providers and their availability */
  async status(): Promise<Record<string, { providers: string[]; mode: string }>> {
    const check = async (list: { name: string; isAvailable(): Promise<boolean> }[]) =>
      Promise.all(list.map(async (p) => `${p.name}:${(await p.isAvailable()) ? "✅" : "❌"}`));

    return {
      search: { providers: await check(this._search), mode: this._mode },
      news: { providers: await check(this._news), mode: this._mode },
      translation: { providers: await check(this._translation), mode: this._mode },
      ai: { providers: await check(this._ai), mode: this._mode },
      document: { providers: await check(this._document), mode: this._mode },
      storage: { providers: await check(this._storage), mode: this._mode },
      vector: { providers: await check(this._vector), mode: this._mode },
      transcript: { providers: await check(this._transcript), mode: this._mode },
    };
  }
}

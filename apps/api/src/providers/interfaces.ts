/**
 * CCJ Provider Interfaces
 *
 * All external integrations implement these interfaces.
 * No provider is mandatory — the abstraction supports multiple providers.
 * Switching a provider requires only a new adapter, not business-logic edits.
 */

import type { SupportedLocale } from "@ccj/types";

// ══════════════════════════════════════════════════════════════
// SEARCH PROVIDER
// ══════════════════════════════════════════════════════════════

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  domain: string;
  publishedAt: string | null;
  language: string | null;
  score: number;
}

export interface SearchOptions {
  query: string;
  language?: SupportedLocale | string;
  maxResults?: number;
  dateAfter?: Date;
  dateBefore?: Date;
  domains?: string[];
}

/** All search providers must implement this interface */
export interface ISearchProvider {
  readonly name: string;
  readonly isAvailable: () => Promise<boolean>;
  search(options: SearchOptions): Promise<SearchResult[]>;
}

// ══════════════════════════════════════════════════════════════
// WEB FETCH PROVIDER
// ══════════════════════════════════════════════════════════════

export interface FetchedPage {
  url: string;
  canonicalUrl: string;
  title: string;
  author: string | null;
  publishedAt: string | null;
  language: string;
  textContent: string;
  htmlContent: string;
  contentHash: string;
  fetchedAt: string;
  wordCount: number;
}

export interface FetchOptions {
  url: string;
  timeout?: number;
  /** Use headless browser for JS-heavy pages */
  usePlaywright?: boolean;
}

export interface IWebFetchProvider {
  readonly name: string;
  fetch(options: FetchOptions): Promise<FetchedPage>;
}

// ══════════════════════════════════════════════════════════════
// TRANSLATION PROVIDER
// ══════════════════════════════════════════════════════════════

export interface TranslationResult {
  sourceText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  confidence: number | null;
}

export interface TranslationOptions {
  text: string;
  sourceLanguage?: string;
  targetLanguage: string;
}

export interface ITranslationProvider {
  readonly name: string;
  readonly isAvailable: () => Promise<boolean>;
  translate(options: TranslationOptions): Promise<TranslationResult>;
  detectLanguage(text: string): Promise<string>;
}

// ══════════════════════════════════════════════════════════════
// AI / LLM PROVIDER
// ══════════════════════════════════════════════════════════════

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionOptions {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  responseFormat?: "text" | "json";
}

export interface CompletionResult {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  finishReason: "stop" | "length" | "error";
}

export interface ILlmProvider {
  readonly name: string;
  readonly isAvailable: () => Promise<boolean>;
  complete(options: CompletionOptions): Promise<CompletionResult>;
}

// ══════════════════════════════════════════════════════════════
// PROVIDER REGISTRY
// ══════════════════════════════════════════════════════════════

/**
 * Registry that returns the first available provider for each type.
 * Providers are tried in priority order.
 */
export class ProviderRegistry {
  private searchProviders: ISearchProvider[] = [];
  private translationProviders: ITranslationProvider[] = [];
  private llmProviders: ILlmProvider[] = [];

  registerSearch(provider: ISearchProvider): this {
    this.searchProviders.push(provider);
    return this;
  }

  registerTranslation(provider: ITranslationProvider): this {
    this.translationProviders.push(provider);
    return this;
  }

  registerLlm(provider: ILlmProvider): this {
    this.llmProviders.push(provider);
    return this;
  }

  async getSearch(): Promise<ISearchProvider> {
    for (const p of this.searchProviders) {
      if (await p.isAvailable()) return p;
    }
    throw new Error("No search providers available");
  }

  async getTranslation(): Promise<ITranslationProvider> {
    for (const p of this.translationProviders) {
      if (await p.isAvailable()) return p;
    }
    throw new Error("No translation providers available");
  }

  async getLlm(): Promise<ILlmProvider> {
    for (const p of this.llmProviders) {
      if (await p.isAvailable()) return p;
    }
    throw new Error("No LLM providers available");
  }
}

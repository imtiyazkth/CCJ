"use client";

/**
 * CCJ i18n — Real translation provider
 *
 * Rules:
 * - Every user-visible string comes from a locale key
 * - Keys are dot-notation: "nav.dashboard", "claim.status.verified"
 * - Interpolation: t("research.progress", { pct: "75" }) → "75% complete"
 * - Missing key → returns the key itself (visible in dev, never crashes)
 * - Adding a 4th language = new locale JSON file + entry in LOCALE_META
 * - No business-logic edits required to add a locale
 */

import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import { SUPPORTED_LOCALES } from "@ccj/types";
import type { SupportedLocale } from "@ccj/types";

// ── Locale metadata ───────────────────────────────────────────
// Add new locales here only — zero other code changes needed.

export interface LocaleMeta {
  code: SupportedLocale;
  nativeName: string;
  direction: "ltr" | "rtl";
  bcp47: string;
}

export const LOCALE_META: Record<SupportedLocale, LocaleMeta> = {
  en: { code: "en", nativeName: "English",  direction: "ltr", bcp47: "en-US" },
  hi: { code: "hi", nativeName: "हिंदी",    direction: "ltr", bcp47: "hi-IN" },
  ar: { code: "ar", nativeName: "العربية",  direction: "rtl", bcp47: "ar-SA" },
};

// ── Types ─────────────────────────────────────────────────────

type Messages = Record<string, unknown>;

export interface I18nContextValue {
  locale: SupportedLocale;
  direction: "ltr" | "rtl";
  messages: Messages;
  /**
   * Translate a dot-notation key with optional variable interpolation.
   * t("research.progress", { pct: "75" }) → "75% complete"
   * Missing key → returns the key string (never throws).
   */
  t: (key: string, vars?: Record<string, string>) => string;
  /**
   * Returns all options for a language selector.
   */
  localeOptions: LocaleMeta[];
}

// ── Context ───────────────────────────────────────────────────

const I18nContext = createContext<I18nContextValue | null>(null);

// ── Hook ─────────────────────────────────────────────────────

export function useTranslation(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error(
      "useTranslation() must be used inside <I18nProvider>. " +
      "Ensure the [locale]/layout.tsx wraps children with <I18nProvider>."
    );
  }
  return ctx;
}

// ── Translation function ──────────────────────────────────────

export function createTranslator(messages: Messages) {
  return function t(key: string, vars?: Record<string, string>): string {
    // Walk dot-notation path
    const parts = key.split(".");
    let node: unknown = messages;
    for (const part of parts) {
      if (node !== null && typeof node === "object") {
        node = (node as Messages)[part];
      } else {
        node = undefined;
        break;
      }
    }

    if (typeof node !== "string") {
      // Key missing: return key so it's visible in dev
      if (process.env["NODE_ENV"] === "development") {
        console.warn(`[i18n] Missing key: "${key}" for locale in context`);
      }
      return key;
    }

    // Variable interpolation: {{varName}}
    if (!vars) return node;
    return node.replace(/\{\{(\w+)\}\}/g, (_, name) => vars[name] ?? `{{${name}}}`);
  };
}

// ── Provider ──────────────────────────────────────────────────

interface I18nProviderProps {
  locale: SupportedLocale;
  messages: Messages;
  children: ReactNode;
}

export function I18nProvider({ locale, messages, children }: I18nProviderProps) {
  const meta = LOCALE_META[locale];
  const direction = meta?.direction ?? "ltr";
  const t = createTranslator(messages);
  const localeOptions = SUPPORTED_LOCALES.map((c) => LOCALE_META[c]);

  return (
    <I18nContext.Provider value={{ locale, direction, messages, t, localeOptions }}>
      {children}
    </I18nContext.Provider>
  );
}

// ── Server-side loader ────────────────────────────────────────

/**
 * Load locale messages at the server component / layout level.
 * Called once per request in layout.tsx.
 */
// ── Utility: detect locale from Accept-Language header ────────

export function detectLocaleFromHeader(header: string): SupportedLocale {
  const tags = header
    .split(",")
    .map((tag) => tag.split(";")[0]?.trim().toLowerCase().slice(0, 2))
    .filter(Boolean);

  for (const tag of tags) {
    if ((SUPPORTED_LOCALES as readonly string[]).includes(tag)) {
      return tag as SupportedLocale;
    }
  }
  return "en";
}

/**
 * CCJ i18n — Server-side message loader (Server Components only).
 * No "use client" directive — this runs on the server.
 * Import from "@/lib/i18n.server" in layout.tsx.
 */



type Messages = Record<string, unknown>;

// Static import map — Next.js bundler traces these at build time.
// Add new locale here + JSON file in packages/i18n/locales/.
const LOCALE_LOADERS: Record<string, () => Promise<{ default: Messages }>> = {
  en: () => import("../../../../packages/i18n/locales/en.json"),
  hi: () => import("../../../../packages/i18n/locales/hi.json"),
  ar: () => import("../../../../packages/i18n/locales/ar.json"),
};

export async function loadMessages(locale: string): Promise<Messages> {
  const loader = LOCALE_LOADERS[locale] ?? LOCALE_LOADERS["en"];
  try {
    const mod = await loader!();
    return mod.default;
  } catch {
    console.error(`[i18n] Failed to load locale "${locale}" — falling back to "en"`);
    const en = await LOCALE_LOADERS["en"]!();
    return en.default;
  }
}

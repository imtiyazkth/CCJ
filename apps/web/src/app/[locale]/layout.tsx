import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Inter, Noto_Sans_Arabic, Noto_Sans_Devanagari } from "next/font/google";
import { SUPPORTED_LOCALES, RTL_LOCALES } from "@ccj/types";
import type { SupportedLocale } from "@ccj/types";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const notoArabic = Noto_Sans_Arabic({ subsets: ["arabic"], variable: "--font-arabic" });
const notoDevanagari = Noto_Sans_Devanagari({ subsets: ["devanagari"], variable: "--font-devanagari" });

export const metadata: Metadata = {
  title: {
    default: "CCJ — Content Creation Journey",
    template: "%s | CCJ",
  },
  description: "Research-to-content operating system",
  manifest: "/manifest.json",
};

interface LayoutProps {
  children: React.ReactNode;
  params: { locale: string };
}

export default async function RootLayout({ children, params }: LayoutProps) {
  const { locale } = params;

  // Validate locale
  if (!(SUPPORTED_LOCALES as readonly string[]).includes(locale)) {
    notFound();
  }

  const typedLocale = locale as SupportedLocale;
  const dir = (RTL_LOCALES as readonly string[]).includes(typedLocale) ? "rtl" : "ltr";

  // Load locale messages
  let messages: Record<string, unknown>;
  try {
    const mod = await import(`../../../packages/i18n/locales/${locale}.json`);
    messages = mod.default as Record<string, unknown>;
  } catch {
    notFound();
  }

  return (
    <html
      lang={locale}
      dir={dir}
      className={[inter.variable, notoArabic.variable, notoDevanagari.variable].join(" ")}
    >
      <body className="bg-background text-foreground antialiased">
        <I18nProvider locale={typedLocale} messages={messages}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}

// Simple context provider — replace with next-intl in full implementation
import { createContext, useContext } from "react";

const I18nContext = createContext<{
  locale: SupportedLocale;
  messages: Record<string, unknown>;
  t: (key: string, vars?: Record<string, string>) => string;
} | null>(null);

function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: SupportedLocale;
  messages: Record<string, unknown>;
  children: React.ReactNode;
}) {
  function t(key: string, vars?: Record<string, string>): string {
    const parts = key.split(".");
    let val: unknown = messages;
    for (const part of parts) {
      if (val && typeof val === "object") {
        val = (val as Record<string, unknown>)[part];
      } else {
        return key; // fallback to key
      }
    }
    let str = typeof val === "string" ? val : key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replace(`{{${k}}}`, v);
      }
    }
    return str;
  }

  return (
    // Server component compatibility: pass via HTML data attribute
    // Real implementation: use next-intl <NextIntlClientProvider>
    <I18nContext.Provider value={{ locale, messages, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function generateStaticParams() {
  return SUPPORTED_LOCALES.map((locale) => ({ locale }));
}

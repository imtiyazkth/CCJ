import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SUPPORTED_LOCALES, RTL_LOCALES } from "@ccj/types";
import type { SupportedLocale } from "@ccj/types";
import { AuthProvider } from "../../lib/auth-context";
import { I18nProvider } from "../../lib/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CCJ — Content Creation Journey", template: "%s | CCJ" },
  description: "Research-to-content operating system",
};

type Messages = Record<string, unknown>;

// Inline server-side loader — lives in a Server Component file,
// so Next.js never confuses it with "use client" exports.
// 5 levels up: [locale]/ -> app/ -> src/ -> apps/web/ -> apps/ -> ccj/ (root)
async function getLocaleMessages(locale: string): Promise<Messages> {
  switch (locale) {
    case "hi":
      return (await import("../../../../../packages/i18n/locales/hi.json"))
        .default as Messages;
    case "ar":
      return (await import("../../../../../packages/i18n/locales/ar.json"))
        .default as Messages;
    default:
      return (await import("../../../../../packages/i18n/locales/en.json"))
        .default as Messages;
  }
}

interface Props {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;

  if (!(SUPPORTED_LOCALES as readonly string[]).includes(locale)) {
    notFound();
  }

  const typedLocale = locale as SupportedLocale;
  const dir = (RTL_LOCALES as readonly string[]).includes(typedLocale)
    ? "rtl"
    : "ltr";
  const messages = await getLocaleMessages(typedLocale);

  return (
    <html lang={locale} dir={dir}>
      <body className="bg-gray-50 text-gray-900 antialiased">
        <I18nProvider locale={typedLocale} messages={messages}>
          <AuthProvider>{children}</AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}

export function generateStaticParams() {
  return SUPPORTED_LOCALES.map((locale) => ({ locale }));
}

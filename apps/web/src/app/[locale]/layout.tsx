import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SUPPORTED_LOCALES, RTL_LOCALES } from "@ccj/types";
import type { SupportedLocale } from "@ccj/types";
import { AuthProvider } from "../../lib/auth-context";
import { I18nProvider, loadMessages } from "../../lib/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CCJ — Content Creation Journey", template: "%s | CCJ" },
  description: "Research-to-content operating system",
};

interface Props {
  children: React.ReactNode;
  params: { locale: string };
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = params;

  if (!(SUPPORTED_LOCALES as readonly string[]).includes(locale)) {
    notFound();
  }

  const typedLocale = locale as SupportedLocale;
  const dir = (RTL_LOCALES as readonly string[]).includes(typedLocale) ? "rtl" : "ltr";
  const messages = await loadMessages(typedLocale);

  return (
    <html lang={locale} dir={dir}>
      <body className="bg-gray-50 text-gray-900 antialiased">
        <I18nProvider locale={typedLocale} messages={messages}>
          <AuthProvider>
            {children}
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}

export function generateStaticParams() {
  return SUPPORTED_LOCALES.map((locale) => ({ locale }));
}

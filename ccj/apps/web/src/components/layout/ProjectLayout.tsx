"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../../lib/auth-context";
import { useTranslation } from "../../lib/i18n";

export function ProjectLayout({
  children, projectId, projectTitle, locale, isDemo,
}: {
  children: React.ReactNode; projectId: string; projectTitle: string;
  locale: string; isDemo?: boolean;
}) {
  const { t } = useTranslation();
  const { signOut, user } = useAuth();
  const pathname = usePathname();
  const base = `/${locale}/projects/${projectId}`;

  const NAV_TABS = [
    { href: "",           labelKey: "nav.researchWorkspace", icon: "🔬" },
    { href: "/sources",   labelKey: "nav.sources",           icon: "📚" },
    { href: "/evidence",  labelKey: "nav.evidenceVault",     icon: "🔍" },
    { href: "/claims",    labelKey: "nav.claims",            icon: "📋" },
    { href: "/timeline",  labelKey: "nav.timeline",          icon: "🕐" },
    { href: "/gaps",      labelKey: "nav.researchGaps",      icon: "⚠️" },
    { href: "/dossier",   labelKey: "nav.dashboard",         icon: "📁" },
  ] as const;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href={`/${locale}/dashboard`} className="text-sm text-gray-500 hover:text-gray-800">
              ← {t("nav.dashboard")}
            </Link>
            <span className="text-gray-300">/</span>
            <span className="font-semibold text-gray-900 line-clamp-1 max-w-xs">{projectTitle}</span>
            {isDemo && (
              <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                ⚠ {t("project.demo.badge")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-gray-500 sm:block">{user?.email}</span>
            <button onClick={() => signOut()} className="text-xs text-gray-500 hover:text-gray-800">
              {t("auth.signOut")}
            </button>
          </div>
        </div>
        <div className="mx-auto max-w-7xl overflow-x-auto px-4">
          <nav className="flex gap-1">
            {NAV_TABS.map((tab) => {
              const href = `${base}${tab.href}`;
              const isActive = tab.href === ""
                ? pathname === base || pathname === `${base}/`
                : pathname.startsWith(href);
              return (
                <Link key={tab.href} href={href}
                  className={`flex shrink-0 items-center gap-1 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                  }`}>
                  <span className="hidden sm:inline">{tab.icon}</span>
                  {t(tab.labelKey)}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}

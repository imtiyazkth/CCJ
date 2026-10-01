"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../../lib/auth-context";
import { useTranslation } from "../../lib/i18n";
import { Microscope, BookOpen, ShieldCheck, ClipboardList, Clock, AlertTriangle, FileStack } from "lucide-react";

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

  // Priority 4 (Style Selection) of the ui-ux-pro-max checklist flags
  // emoji-as-icons as an anti-pattern — inconsistent rendering across
  // platforms and no real semantic meaning for screen readers. Real SVG
  // icons (lucide-react) replace the emoji used here previously.
  const NAV_TABS = [
    { href: "",           labelKey: "nav.researchWorkspace", Icon: Microscope },
    { href: "/sources",   labelKey: "nav.sources",           Icon: BookOpen },
    { href: "/evidence",  labelKey: "nav.evidenceVault",     Icon: ShieldCheck },
    { href: "/claims",    labelKey: "nav.claims",            Icon: ClipboardList },
    { href: "/timeline",  labelKey: "nav.timeline",          Icon: Clock },
    { href: "/gaps",      labelKey: "nav.researchGaps",      Icon: AlertTriangle },
    { href: "/dossier",   labelKey: "nav.dashboard",         Icon: FileStack },
  ] as const;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* §12 Materials & depth: translucent sticky toolbar, content
          scrolls underneath — not an opaque bar consuming a fixed strip */}
      <header className="ui-material-toolbar border-b border-gray-200">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href={`/${locale}/dashboard`}
              className="ui-pressable text-sm text-gray-500 hover:text-gray-800">
              ← {t("nav.dashboard")}
            </Link>
            <span className="text-gray-300">/</span>
            {/* §15 Typography: tightened tracking on the identifying title */}
            <span className="ui-heading-sm text-gray-900 line-clamp-1 max-w-xs">{projectTitle}</span>
            {isDemo && (
              <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 inline-flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" /> {t("project.demo.badge")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-gray-500 sm:block">{user?.email}</span>
            <button onClick={() => signOut()} className="ui-pressable text-xs text-gray-500 hover:text-gray-800">
              {t("auth.signOut")}
            </button>
          </div>
        </div>
        <div className="mx-auto max-w-7xl overflow-x-auto px-4 pb-2">
          <nav className="flex gap-1">
            {NAV_TABS.map((tab) => {
              const href = `${base}${tab.href}`;
              const isActive = tab.href === ""
                ? pathname === base || pathname === `${base}/`
                : pathname.startsWith(href);
              return (
                // §7 Spatial consistency + active-state-as-material: the
                // active tab is a real chip (background + color), not just
                // a color flip — a state change should read as a state
                // change, not a text-color coincidence.
                // Priority 2 (Touch & Interaction): min 44px height so the
                // tap target isn't undersized on mobile.
                <Link key={tab.href} href={href}
                  data-active={isActive}
                  className="ui-tab ui-pressable flex shrink-0 items-center gap-1.5 px-3 min-h-[44px] text-sm font-medium text-gray-500 hover:text-gray-700">
                  <tab.Icon className="h-4 w-4" aria-hidden="true" />
                  {t(tab.labelKey)}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="ui-scroll-fade-top mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}

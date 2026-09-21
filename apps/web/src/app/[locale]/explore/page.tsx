"use client";
import { use } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import explore from "@/data/explore.json";

interface Entry {
  name: string; url: string; description: string;
  official?: boolean; tag?: string;
}
interface CountryGroup { label: string; entries: Entry[] }
interface Category {
  label: string;
  entries?: Entry[];
  countries?: Record<string, CountryGroup>;
}

const DATA = explore as unknown as Record<string, Category>;

function EntryCard({ entry }: { entry: Entry }) {
  return (
    <a href={entry.url} target="_blank" rel="noopener noreferrer"
      // §1 Response: press feedback on the whole card, not just a link
      className="ui-pressable block rounded-xl border border-gray-200 bg-white p-4
        shadow-sm hover:shadow hover:border-gray-300 transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <h3 className="ui-heading-sm text-sm text-gray-900">{entry.name}</h3>
        <div className="flex shrink-0 gap-1">
          {entry.official && (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
              Official
            </span>
          )}
          {entry.tag && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
              {entry.tag}
            </span>
          )}
        </div>
      </div>
      <p className="ui-body mt-1 text-xs text-gray-500">{entry.description}</p>
    </a>
  );
}

export default function ExplorePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="ui-material-toolbar border-b border-gray-200">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white text-sm font-bold">C</div>
            <span className="ui-heading-sm text-gray-900">CCJ</span>
          </div>
          <span className="hidden text-sm text-gray-500 sm:block">{user?.email}</span>
        </div>
        {/* §7 Wayfinding: Profile / Explore / My Projects — the three
            places a person can go from here, always visible */}
        <div className="mx-auto max-w-7xl overflow-x-auto px-4 pb-2">
          <nav className="flex gap-1">
            <Link href={`/${locale}/profile`}
              className="ui-tab ui-pressable px-3 py-1.5 text-sm font-medium text-gray-500 hover:text-gray-700">
              Profile
            </Link>
            <Link href={`/${locale}/explore`} data-active="true"
              className="ui-tab ui-pressable px-3 py-1.5 text-sm font-medium text-gray-500 hover:text-gray-700">
              Explore
            </Link>
            <Link href={`/${locale}/dashboard`}
              className="ui-tab ui-pressable px-3 py-1.5 text-sm font-medium text-gray-500 hover:text-gray-700">
              My Projects
            </Link>
          </nav>
        </div>
      </header>

      <main className="ui-scroll-fade-top mx-auto max-w-7xl px-4 py-6 space-y-8">
        <div>
          <h1 className="ui-heading-lg text-gray-900">Explore</h1>
          <p className="ui-body text-sm text-gray-500 mt-1">
            Curated links — government portals, laws, and creator tools. CCJ doesn't host or
            verify third-party content; use the link to reach the source directly.
          </p>
        </div>

        {Object.entries(DATA).map(([key, category]) => {
          if (key.startsWith("_")) return null;
          return (
            <section key={key}>
              <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">
                {category.label}
              </h2>

              {/* Flat category (AI Tools, Video, etc.) */}
              {category.entries && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {category.entries.map((entry) => <EntryCard key={entry.url} entry={entry} />)}
                </div>
              )}

              {/* Country-grouped category (Government, Law) */}
              {category.countries && (
                <div className="space-y-5">
                  {Object.entries(category.countries).map(([countryKey, group]) => (
                    <div key={countryKey}>
                      <h3 className="text-xs font-semibold text-gray-400 mb-2">{group.label}</h3>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {group.entries.map((entry) => <EntryCard key={entry.url} entry={entry} />)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </main>
    </div>
  );
}

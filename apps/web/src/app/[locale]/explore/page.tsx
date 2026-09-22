"use client";
import { use, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import explore from "@/data/explore.json";

interface Entry {
  name: string; url: string; description: string;
  official?: boolean; tag?: string;
}
interface Section { label: string; entries: Entry[] }
interface CountryDirectory { flag: string; label: string; sections: Record<string, Section> }
interface FlatCategory { label: string; entries: Entry[] }

const COUNTRIES = (explore as unknown as { countryDirectories: Record<string, CountryDirectory> }).countryDirectories;
const FLAT_CATEGORIES: Record<string, FlatCategory> = {
  "ai-tools": (explore as unknown as { "ai-tools": FlatCategory })["ai-tools"],
  "video-tools": (explore as unknown as { "video-tools": FlatCategory })["video-tools"],
  "image-tools": (explore as unknown as { "image-tools": FlatCategory })["image-tools"],
  "website-builders": (explore as unknown as { "website-builders": FlatCategory })["website-builders"],
  "my-projects": (explore as unknown as { "my-projects": FlatCategory })["my-projects"],
};

function EntryCard({ entry }: { entry: Entry }) {
  return (
    <a href={entry.url} target="_blank" rel="noopener noreferrer"
      className="ui-pressable block rounded-xl border border-gray-200 bg-white p-4
        shadow-sm hover:shadow hover:border-gray-300 transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <h3 className="ui-heading-sm text-sm text-gray-900">{entry.name}</h3>
        <div className="flex shrink-0 gap-1">
          {entry.official && (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
              🏛 Official
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

function CountryDirectoryView({ country }: { country: CountryDirectory }) {
  const sectionKeys = Object.keys(country.sections);
  const [active, setActive] = useState(sectionKeys[0]);

  return (
    <div>
      <h2 className="ui-heading-sm text-base text-gray-900 mb-3">
        {country.flag} {country.label}
      </h2>
      {/* §7 Wayfinding: a sub-tab per section (Government, Constitution,
          Laws, Courts...) so 17 categories don't turn into one huge scroll */}
      <div className="mb-4 overflow-x-auto">
        <nav className="flex gap-1 pb-1">
          {sectionKeys.map((key) => (
            <button key={key} onClick={() => setActive(key)}
              data-active={active === key}
              className="ui-tab ui-pressable shrink-0 px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700">
              {country.sections[key].label}
            </button>
          ))}
        </nav>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {country.sections[active].entries.map((entry) => (
          <EntryCard key={entry.url} entry={entry} />
        ))}
      </div>
    </div>
  );
}

export default function ExplorePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const { user } = useAuth();
  const countryKeys = Object.keys(COUNTRIES);
  const [activeCountry, setActiveCountry] = useState(countryKeys[0]);

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
            Curated links — government portals, laws, and creator tools. CCJ doesn&apos;t host or
            verify third-party content; use the link to reach the source directly.
          </p>
        </div>

        {/* ── Country directories ─────────────────────────── */}
        <section>
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">
            Government &amp; Public Information
          </h2>
          <div className="mb-4 flex gap-2">
            {countryKeys.map((key) => (
              <button key={key} onClick={() => setActiveCountry(key)}
                data-active={activeCountry === key}
                className="ui-tab ui-pressable rounded-lg px-3 py-1.5 text-sm font-medium text-gray-500 hover:text-gray-700 border border-gray-200">
                {COUNTRIES[key].flag} {COUNTRIES[key].label}
              </button>
            ))}
          </div>
          <CountryDirectoryView country={COUNTRIES[activeCountry]} />
        </section>

        {/* ── Flat tool categories ────────────────────────── */}
        {Object.entries(FLAT_CATEGORIES).map(([key, category]) => (
          <section key={key}>
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">
              {category.label}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {category.entries.map((entry) => <EntryCard key={entry.url} entry={entry} />)}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}

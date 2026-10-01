"use client";
import { use } from "react";
import Link from "next/link";

const SECTIONS = [
  { h: "What data we collect", body: "Your account email, the research topics and questions you submit, and any documents or links you upload for a research project." },
  { h: "Why we collect it", body: "To run your research (searching, verifying, and organizing sources into a dossier) and to let you return to your past projects." },
  { h: "How research documents are stored", body: "Project data — questions, sources, evidence, and claims — is stored in our database (Supabase) tied to your account." },
  { h: "How uploaded files are handled", body: "Files you upload (e.g. PDFs, transcripts) are processed to extract text for research and are stored alongside your project." },
  { h: "AI processing", body: "Research questions and source content are sent to third-party AI providers (currently Groq and Google Gemini) to generate summaries, verify claims, and identify contradictions. These providers process the content to return a response; review their own privacy terms for how they handle that data." },
  { h: "Third-party services", body: "CCJ queries external search and news providers (e.g. Brave Search, Guardian, NewsAPI, Bluesky) to gather sources. These requests include your search terms but not your account identity." },
  { h: "Analytics", body: "We do not currently run third-party analytics or advertising trackers." },
  { h: "Cookies", body: "CCJ uses only the session cookie needed to keep you signed in." },
  { h: "Data retention", body: "Your projects are retained until you delete them or close your account." },
  { h: "Data deletion", body: "You can delete individual projects from your dashboard. To delete your account and all associated data, contact us using the details below." },
  { h: "User rights", body: "You can request a copy of your data or its deletion at any time." },
  { h: "Contact", body: "For any privacy question, reach out via the contact details on the CCJ GitHub repository." },
];

export default function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="ui-material-toolbar border-b border-gray-200">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Link href={`/${locale}/profile`} className="ui-pressable text-sm text-gray-500 hover:text-gray-800">
            ← Profile
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6 space-y-6">
        <div>
          <h1 className="ui-heading-lg text-gray-900">Privacy Policy</h1>
          <p className="ui-body text-xs text-gray-400 mt-1">Last updated: September 2026</p>
        </div>
        <div className="space-y-5">
          {SECTIONS.map((s) => (
            <div key={s.h}>
              <h2 className="ui-heading-sm text-sm text-gray-900 mb-1">{s.h}</h2>
              <p className="ui-body text-sm text-gray-600">{s.body}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

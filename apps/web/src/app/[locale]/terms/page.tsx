"use client";
import { use } from "react";
import Link from "next/link";

const SECTIONS = [
  { h: "1. Acceptance", body: "By using CCJ, you agree to these terms. If you don't agree, please don't use the service." },
  { h: "2. Account", body: "You're responsible for keeping your account credentials secure and for activity under your account." },
  { h: "3. Acceptable Use", body: "Don't use CCJ to generate or spread deliberately false information, harass individuals, or attempt to break the service." },
  { h: "4. Research Disclaimer", body: "CCJ is a research and information tool, not a substitute for professional legal, medical, financial, or governmental advice." },
  { h: "5. AI-generated Content", body: "Dossiers, scripts, and summaries are generated with AI assistance. AI can make mistakes — review generated content before relying on or publishing it." },
  { h: "6. Accuracy & Verification", body: "Claims are labeled by confidence and verification status (verified, unverified, disputed). An unverified or low-confidence label means CCJ could not independently confirm the claim — treat it accordingly." },
  { h: "7. Third-party Sources", body: "CCJ surfaces content from external websites, news outlets, and APIs. We don't control or vouch for their accuracy, availability, or content." },
  { h: "8. User Content", body: "You retain ownership of documents and links you upload. You're responsible for having the right to upload and use that content." },
  { h: "9. Intellectual Property", body: "The CCJ platform, its design, and its underlying code are the property of their respective owners. Research output you generate is yours to use." },
  { h: "10. External Links", body: "The Explore directory links to third-party and government websites. CCJ does not host, control, or verify the current accuracy of external sites — always confirm with the official source." },
  { h: "11. API Services", body: "CCJ relies on third-party APIs (search, news, AI) to function. Availability and behavior of this service depend on those providers." },
  { h: "12. Government Information Disclaimer", body: "Government and legal links in Explore are provided for convenience only. CCJ does not provide legal advice and does not guarantee that linked information reflects the current, official, or complete legal position — always verify against the official government source." },
  { h: "13. Availability", body: "CCJ is provided on a best-effort basis. We don't guarantee uninterrupted or error-free service." },
  { h: "14. Limitation of Liability", body: "CCJ is provided \"as is,\" without warranties of any kind. To the extent permitted by law, we are not liable for decisions made based on content generated or linked by CCJ." },
  { h: "15. Account Termination", body: "We may suspend or terminate accounts that violate these terms." },
  { h: "16. Changes", body: "We may update these terms from time to time. Continued use after a change means you accept the update." },
  { h: "17. Governing Law", body: "The governing law and jurisdiction for these terms will be specified here as the operator finalizes its legal entity." },
  { h: "18. Contact", body: "For any question about these terms, reach out via the contact details on the CCJ GitHub repository." },
];

export default function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
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
          <h1 className="ui-heading-lg text-gray-900">Terms &amp; Conditions</h1>
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

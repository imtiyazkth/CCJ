"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/supabase";
import { Spinner, ErrorBanner } from "@/components/ui";
import { SUPPORTED_LOCALES } from "@ccj/types";
import type { Project } from "@ccj/types";

const LOCALE_LABELS: Record<string, string> = { en: "English", hi: "हिंदी", ar: "العربية" };

export default function NewProjectPage({ params }: { params: { locale: string } }) {
  const { token } = useAuth();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [outputLocale, setOutputLocale] = useState(params.locale);
  const [sourceLanguage, setSourceLanguage] = useState("en");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    setError(null);

    const { data, error } = await apiFetch<Project>("/api/projects", {
      method: "POST",
      token: token ?? undefined,
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim() || undefined,
        locales: {
          uiLocale: params.locale,
          promptLocale: params.locale,
          projectLocale: params.locale,
          outputLocale,
          sourceLanguage,
        },
      }),
    });

    if (error || !data) {
      setError(error ?? "Failed to create project");
      setSubmitting(false);
      return;
    }

    router.push(`/${params.locale}/projects/${data.id}`);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-4 py-4">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <Link href={`/${params.locale}/dashboard`} className="text-sm text-gray-500 hover:text-gray-800">
            ← Dashboard
          </Link>
          <span className="text-gray-300">/</span>
          <span className="font-semibold text-gray-900">New Project</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">New Research Project</h1>
          <p className="mt-1 text-sm text-gray-500">
            A project holds your research dossier — sources, evidence, and traceable claims.
          </p>
        </div>

        {error && <ErrorBanner message={error} />}

        <form onSubmit={handleSubmit} className="space-y-5 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          {/* Title */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Project title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={500}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="e.g. BCI Chairman Letter vs NALSAR Students — 2026"
            />
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Description <span className="text-gray-400">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={5000}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Briefly describe the research topic…"
            />
          </div>

          {/* Locale settings */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Output language
              </label>
              <select
                value={outputLocale}
                onChange={(e) => setOutputLocale(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                {SUPPORTED_LOCALES.map((l) => (
                  <option key={l} value={l}>{LOCALE_LABELS[l] ?? l}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-400">Language for generated content</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Source language
              </label>
              <select
                value={sourceLanguage}
                onChange={(e) => setSourceLanguage(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                {SUPPORTED_LOCALES.map((l) => (
                  <option key={l} value={l}>{LOCALE_LABELS[l] ?? l}</option>
                ))}
                <option value="mixed">Mixed / Multiple</option>
              </select>
              <p className="mt-1 text-xs text-gray-400">Primary language of source material</p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-4">
            <Link
              href={`/${params.locale}/dashboard`}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={submitting || !title.trim()}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {submitting && <Spinner size="sm" />}
              {submitting ? "Creating…" : "Create Project"}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}

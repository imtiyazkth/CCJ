"use client";

import type { ClaimStatus, ResearchRunStatus, CredibilityTier } from "@ccj/types";

/** Orange banner shown on any demo record */
export function DemoBadge({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 ${className}`}>
      ⚠ DEMO
    </span>
  );
}

/** Colour-coded claim status pill */
export function ClaimStatusBadge({ status }: { status: ClaimStatus }) {
  const styles: Record<ClaimStatus, string> = {
    verified: "bg-green-100 text-green-800",
    strongly_correlated: "bg-blue-100 text-blue-800",
    reported: "bg-yellow-100 text-yellow-800",
    disputed: "bg-red-100 text-red-800",
    unverified: "bg-gray-100 text-gray-700",
    opinion: "bg-purple-100 text-purple-700",
    inference: "bg-indigo-100 text-indigo-700",
    outdated: "bg-gray-200 text-gray-500 line-through",
  };
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold capitalize ${styles[status]}`}>
      {status.replace("_", " ")}
    </span>
  );
}

/** Research run status badge */
export function RunStatusBadge({ status }: { status: ResearchRunStatus }) {
  const done = status === "complete";
  const failed = status === "failed";
  const active = ["planning","searching","fetching","extracting","analysing"].includes(status);
  const cls = done ? "bg-green-100 text-green-800"
    : failed ? "bg-red-100 text-red-800"
    : active ? "bg-blue-100 text-blue-800"
    : "bg-gray-100 text-gray-600";
  const label = status.replace(/_/g, " ");
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {active && <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />}
      {label}
    </span>
  );
}

/** Credibility tier badge */
export function CredibilityBadge({ tier }: { tier: CredibilityTier }) {
  const styles: Record<CredibilityTier, string> = {
    primary: "bg-green-100 text-green-800",
    verified: "bg-green-100 text-green-700",
    credible: "bg-blue-100 text-blue-700",
    reported: "bg-yellow-100 text-yellow-700",
    unknown: "bg-gray-100 text-gray-600",
    disputed: "bg-red-100 text-red-700",
  };
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium capitalize ${styles[tier]}`}>
      {tier}
    </span>
  );
}

export function Spinner({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const s = size === "sm" ? "h-4 w-4" : size === "lg" ? "h-8 w-8" : "h-6 w-6";
  return (
    <div className={`${s} animate-spin rounded-full border-2 border-gray-200 border-t-blue-600`} />
  );
}

export function EmptyState({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 p-12 text-center">
      <span className="text-4xl">{icon}</span>
      <p className="mt-3 font-semibold text-gray-700">{title}</p>
      <p className="mt-1 text-sm text-gray-500">{body}</p>
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700">
      ⚠ {message}
    </div>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-gray-200 bg-white shadow-sm ${className}`}>
      {children}
    </div>
  );
}

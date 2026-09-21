"use client";
import { use } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";

export default function ProfilePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const { user, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="ui-material-toolbar border-b border-gray-200">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white text-sm font-bold">C</div>
            <span className="ui-heading-sm text-gray-900">CCJ</span>
          </div>
        </div>
        <div className="mx-auto max-w-7xl overflow-x-auto px-4 pb-2">
          <nav className="flex gap-1">
            <Link href={`/${locale}/profile`} data-active="true"
              className="ui-tab ui-pressable px-3 py-1.5 text-sm font-medium text-gray-500 hover:text-gray-700">
              Profile
            </Link>
            <Link href={`/${locale}/explore`}
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

      <main className="mx-auto max-w-2xl px-4 py-6 space-y-4">
        <h1 className="ui-heading-lg text-gray-900">My Profile</h1>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
          <div>
            <span className="text-xs font-medium text-gray-500">Email</span>
            <p className="text-sm text-gray-900">{user?.email}</p>
          </div>
        </div>
        <button onClick={() => signOut()}
          className="ui-pressable rounded-lg border border-red-200 bg-red-50 px-4 py-2 min-h-[44px]
            text-sm font-semibold text-red-700 hover:bg-red-100">
          Sign Out
        </button>
      </main>
    </div>
  );
}

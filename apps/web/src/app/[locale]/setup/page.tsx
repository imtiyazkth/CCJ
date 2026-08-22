export default function SetupPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-lg rounded-xl border border-amber-200 bg-amber-50 p-8 shadow-sm">
        <h1 className="mb-2 text-xl font-bold text-amber-900">
          ⚙️ Supabase not configured
        </h1>
        <p className="mb-4 text-sm text-amber-800">
          Add these two variables to your <code className="rounded bg-amber-100 px-1">~/CCJ/ccj/.env</code> file,
          then restart the web server.
        </p>
        <pre className="mb-4 overflow-x-auto rounded-lg bg-white p-4 text-xs text-gray-800 border border-amber-200">
{`NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhb...`}
        </pre>
        <ol className="space-y-2 text-sm text-amber-800">
          <li>1. Go to <strong>supabase.com</strong> → your project</li>
          <li>2. Open <strong>Settings → API</strong></li>
          <li>3. Copy <strong>Project URL</strong> and <strong>anon public</strong> key</li>
          <li>4. Paste into <code className="rounded bg-amber-100 px-1">.env</code></li>
          <li>5. Stop web server → <code className="rounded bg-amber-100 px-1">pnpm --filter @ccj/web dev</code></li>
        </ol>
      </div>
    </div>
  );
}

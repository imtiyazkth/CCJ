/**
 * CCJ Database Seed — Idempotent, Supabase Auth-first
 * Never stores passwords in public.users.
 * Safe to re-run — all operations are upserts.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import * as schema from "./schema.js";

const DEMO_EMAIL    = "demo@ccj.local";
const DEMO_PASSWORD = "Demo@CCJ2026!";
const DEMO_NAME     = "CCJ Demo User";

async function ensureDemoAuthUser(
  adminClient: ReturnType<typeof createClient>
): Promise<string> {
  const { data: list } = await adminClient.auth.admin.listUsers();
  const existing = list?.users?.find((u) => u.email === DEMO_EMAIL);
  if (existing) {
    console.log(`ℹ️  Auth user exists: ${existing.id}`);
    return existing.id;
  }
  const { data, error } = await adminClient.auth.admin.createUser({
    email: DEMO_EMAIL, password: DEMO_PASSWORD,
    email_confirm: true, user_metadata: { name: DEMO_NAME },
  });
  if (error || !data?.user) throw new Error(`Auth user creation failed: ${error?.message}`);
  console.log(`✅ Auth user created: ${data.user.id}`);
  return data.user.id;
}

async function ensurePublicUser(
  db: ReturnType<typeof drizzle>,
  userId: string
): Promise<void> {
  await new Promise((r) => setTimeout(r, 400)); // allow trigger to fire
  await (db as any).insert(schema.users).values({
    id: userId, email: DEMO_EMAIL, name: DEMO_NAME,
    role: "owner", uiLocale: "en", emailVerified: true,
  }).onConflictDoNothing();
  console.log("✅ public.users profile ensured");
}

async function ensureProject(db: any, userId: string): Promise<string> {
  const [existing] = await db.select({ id: schema.projects.id })
    .from(schema.projects).where(eq(schema.projects.userId, userId)).limit(1);
  if (existing) { console.log(`ℹ️  Project exists: ${existing.id}`); return existing.id; }
  const [p] = await db.insert(schema.projects).values({
    userId, status: "active",
    title: "BCI Chairman Letter vs NALSAR Students — 2026",
    description: "[DEMO PROJECT] Research dossier — all sources are illustrative placeholders.",
    uiLocale: "en", promptLocale: "en", projectLocale: "en",
    outputLocale: "en", sourceLanguage: "en",
  }).returning({ id: schema.projects.id });
  if (!p) throw new Error("Project insert failed");
  console.log(`✅ Project created: ${p.id}`); return p.id;
}

async function ensureRun(db: any, projectId: string): Promise<string> {
  const [existing] = await db.select({ id: schema.researchRuns.id })
    .from(schema.researchRuns).where(eq(schema.researchRuns.projectId, projectId)).limit(1);
  if (existing) { console.log(`ℹ️  Run exists: ${existing.id}`); return existing.id; }
  const [run] = await db.insert(schema.researchRuns).values({
    projectId, version: 1, status: "complete", depth: "standard",
    topic: "BCI Chairman Letter vs NALSAR Students 2026",
    requestedLanguage: "en", progressPct: 100, completedAt: new Date(),
    researchPlan: {
      researchQuestions: ["What did the BCI letter contain?", "What was the student response?", "What legal authority does BCI have?"],
      queries: [{ query: "BCI chairman NALSAR 2026", provider: "demo", priority: 1 }],
      primarySourceTargets: ["bci.org.in", "nalsar.ac.in"],
      secondarySourceTargets: ["barandbench.com", "livelaw.in"],
      socialSourceTargets: [], legalQuestions: [], expectedEntities: [],
      dateRange: { start: "2026-01-01", end: "2026-08-17" },
      riskFlags: ["[DEMO] Primary document may not be publicly available"],
    },
  }).returning({ id: schema.researchRuns.id });
  if (!run) throw new Error("Run insert failed");
  console.log(`✅ Run created: ${run.id}`); return run.id;
}

async function ensureSource(
  db: any, runId: string,
  hash: string, title: string, author: string | null
): Promise<string> {
  const [existing] = await db.select({ id: schema.sources.id })
    .from(schema.sources).where(eq(schema.sources.contentHash, hash)).limit(1);
  if (existing) return existing.id;
  const [s] = await db.insert(schema.sources).values({
    researchRunId: runId,
    url: `https://example.com/DEMO-${hash.slice(-6)}`,
    canonicalUrl: `https://example.com/DEMO-${hash.slice(-6)}`,
    domain: "example.com", title, author,
    language: "en", sourceType: "official_statement",
    credibilityTier: "primary", accessMethod: "user_upload",
    contentHash: hash, isDemo: true,
  }).returning({ id: schema.sources.id });
  if (!s) throw new Error("Source insert failed");
  return s.id;
}

async function seed() {
  const DATABASE_URL         = process.env["DATABASE_URL"];
  const SUPABASE_URL         = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const SUPABASE_SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!DATABASE_URL)         throw new Error("DATABASE_URL required");
  if (!SUPABASE_URL)         throw new Error("NEXT_PUBLIC_SUPABASE_URL required");
  if (!SUPABASE_SERVICE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY required");

  const client = postgres(DATABASE_URL, {
    ssl: DATABASE_URL.includes("supabase.co") ? "require" : false, max: 1,
  });
  const db = drizzle(client, { schema }) as any;
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("🌱 CCJ seed starting…");

  const userId    = await ensureDemoAuthUser(admin);
  await ensurePublicUser(db, userId);
  const projectId = await ensureProject(db, userId);
  const runId     = await ensureRun(db, projectId);

  const hash1 = "demo" + "0".repeat(56) + "001a";
  const hash2 = "demo" + "0".repeat(56) + "002b";

  const src1Id = await ensureSource(db, runId, hash1,
    "[DEMO PLACEHOLDER] BCI Chairman Letter to NALSAR — 2026", null);
  const src2Id = await ensureSource(db, runId, hash2,
    "[DEMO PLACEHOLDER] NALSAR Student Open Letter — 2026", "NALSAR Student Council");

  await db.insert(schema.evidence).values({
    sourceId: src1Id,
    quote: "[DEMO] Placeholder quote from BCI Chairman letter. Replace with actual source text.",
    confidence: 1.0, language: "en",
    extractionWarnings: ["DEMO RECORD — not a real source"],
    isDemo: true,
  }).onConflictDoNothing();

  await db.insert(schema.evidence).values({
    sourceId: src2Id,
    quote: "[DEMO] Placeholder quote from student response. Replace with actual source text.",
    confidence: 1.0, language: "en",
    extractionWarnings: ["DEMO RECORD — not a real source"],
    isDemo: true,
  }).onConflictDoNothing();

  console.log("✅ Evidence ensured");

  await db.insert(schema.claims).values([
    { projectId, claimText: "[DEMO] BCI issued a letter to NALSAR students in 2026.",
      claimType: "reported", status: "reported", confidence: 0.5,
      reasoningSummary: "DEMO — placeholder", whatIsMissing: "Primary document text.", isDemo: true },
    { projectId, claimText: "[DEMO] NALSAR students published a response to the BCI letter.",
      claimType: "reported", status: "unverified", confidence: 0.3,
      reasoningSummary: "DEMO — unverified", whatIsMissing: "Media coverage.", isDemo: true },
  ]).onConflictDoNothing();

  console.log("✅ Claims ensured");

  await db.insert(schema.dossierCards).values({
    projectId, researchRunId: runId, cardType: "summary",
    title: "Research Summary (DEMO)",
    body: "⚠️ DEMO PROJECT. All data is illustrative.\n\nTrigger a real research run from the Research tab to replace demo data.",
    claimIds: [], sourceIds: [], evidenceIds: [], locale: "en", sortOrder: 0,
  }).onConflictDoNothing();

  console.log("✅ Dossier card ensured");
  console.log("\n🎉 Seed complete — " + DEMO_EMAIL + " / " + DEMO_PASSWORD);
  await client.end();
}

seed().catch((err) => { console.error("❌ Seed failed:", err); process.exit(1); });

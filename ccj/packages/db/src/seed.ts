/**
 * CCJ Database Seed — Fully idempotent, deterministic UUIDs.
 *
 * All demo records use fixed UUIDs so ON CONFLICT (id) DO NOTHING
 * makes every run after the first a clean no-op.
 *
 * Demo password comes from CCJ_DEMO_PASSWORD env var.
 * Never hard-coded in source.
 *
 * Usage:
 *   CCJ_DEMO_PASSWORD=<password> pnpm db:seed
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import * as schema from "./schema.js";

// ── Deterministic demo UUIDs ──────────────────────────────────
// Fixed across all environments so ON CONFLICT (id) DO NOTHING
// makes repeated seed runs idempotent.

const DEMO_PROJECT_ID  = "10000000-0000-0000-0000-000000000001";
const DEMO_RUN_ID      = "10000000-0000-0000-0000-000000000002";
const DEMO_SOURCE_1_ID = "10000000-0000-0000-0000-000000000003";
const DEMO_SOURCE_2_ID = "10000000-0000-0000-0000-000000000004";
const DEMO_EVID_1_ID   = "10000000-0000-0000-0000-000000000005";
const DEMO_EVID_2_ID   = "10000000-0000-0000-0000-000000000006";
const DEMO_CLAIM_1_ID  = "10000000-0000-0000-0000-000000000007";
const DEMO_CLAIM_2_ID  = "10000000-0000-0000-0000-000000000008";
const DEMO_DOSSIER_ID  = "10000000-0000-0000-0000-000000000009";
const DEMO_HASH_1      = "demo" + "0".repeat(56) + "001a";
const DEMO_HASH_2      = "demo" + "0".repeat(56) + "002b";
const DEMO_EMAIL       = "demo@ccj.local";
const DEMO_NAME        = "CCJ Demo User";

async function seed() {
  // ── Validate environment ────────────────────────────────────
  const DATABASE_URL         = process.env["DATABASE_URL"];
  const SUPABASE_URL         = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const SUPABASE_SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  const DEMO_PASSWORD        = process.env["CCJ_DEMO_PASSWORD"];

  if (!DATABASE_URL)         throw new Error("DATABASE_URL is required");
  if (!SUPABASE_URL)         throw new Error("NEXT_PUBLIC_SUPABASE_URL is required");
  if (!SUPABASE_SERVICE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  if (!DEMO_PASSWORD)        throw new Error("CCJ_DEMO_PASSWORD is required — set in .env");

  const client = postgres(DATABASE_URL, {
    ssl: DATABASE_URL.includes("supabase.co") ? "require" : false,
    max: 1,
  });
  const db = drizzle(client, { schema }) as any;

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("🌱 CCJ seed starting…");

  // ── 1. Supabase Auth user ────────────────────────────────────
  // Only creates the auth user if it doesn't exist.
  let demoUserId: string;

  const { data: list } = await admin.auth.admin.listUsers();
  const existing = list?.users?.find(
    (u: { email: string; id: string }) => u.email === DEMO_EMAIL
  );

  if (existing) {
    demoUserId = existing.id;
    console.log(`ℹ️  Auth user exists: ${demoUserId}`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { name: DEMO_NAME },
    });
    if (error ?? !data?.user) {
      throw new Error(`Auth user creation failed: ${error?.message ?? "unknown"}`);
    }
    demoUserId = data.user.id;
    console.log(`✅ Auth user created: ${demoUserId}`);
  }

  // Wait for auth sync trigger to fire (Supabase)
  await new Promise((r) => setTimeout(r, 500));

  // ── 2. public.users profile ──────────────────────────────────
  await db.insert(schema.users).values({
    id:            demoUserId,
    email:         DEMO_EMAIL,
    name:          DEMO_NAME,
    role:          "owner",
    uiLocale:      "en",
    emailVerified: true,
  }).onConflictDoNothing();
  console.log("✅ public.users ensured");

  // ── 3. Demo project ──────────────────────────────────────────
  await db.insert(schema.projects).values({
    id:            DEMO_PROJECT_ID,
    userId:        demoUserId,
    title:         "BCI Chairman Letter vs NALSAR Students — 2026",
    description:   "[DEMO PROJECT] Research dossier — all sources are illustrative placeholders.",
    status:        "active",
    uiLocale:      "en",
    promptLocale:  "en",
    projectLocale: "en",
    outputLocale:  "en",
    sourceLanguage:"en",
  }).onConflictDoNothing();
  console.log("✅ Demo project ensured");

  // ── 4. Demo research run ─────────────────────────────────────
  await db.insert(schema.researchRuns).values({
    id:                DEMO_RUN_ID,
    projectId:         DEMO_PROJECT_ID,
    version:           1,
    status:            "complete",
    depth:             "standard",
    topic:             "BCI Chairman Letter vs NALSAR Students 2026",
    requestedLanguage: "en",
    progressPct:       100,
    completedAt:       new Date(),
    researchPlan: {
      researchQuestions: [
        "What did the BCI Chairman's letter contain?",
        "What was the student response?",
        "What legal authority does BCI have over NALSAR?",
      ],
      queries: [
        { query: "BCI chairman NALSAR 2026", provider: "demo", priority: 1 },
      ],
      primarySourceTargets: ["bci.org.in", "nalsar.ac.in"],
      secondarySourceTargets: ["barandbench.com", "livelaw.in"],
      socialSourceTargets: [],
      legalQuestions: [],
      expectedEntities: [],
      dateRange: { start: "2026-01-01", end: "2026-08-17" },
      riskFlags: ["[DEMO] Primary document may not be publicly available"],
    },
  }).onConflictDoNothing();
  console.log("✅ Demo research run ensured");

  // ── 5. Demo sources ──────────────────────────────────────────
  await db.insert(schema.sources).values({
    id:              DEMO_SOURCE_1_ID,
    researchRunId:   DEMO_RUN_ID,
    url:             "https://example.com/DEMO-bci-nalsar-letter-2026",
    canonicalUrl:    "https://example.com/DEMO-bci-nalsar-letter-2026",
    domain:          "example.com",
    title:           "[DEMO PLACEHOLDER] BCI Chairman Letter to NALSAR — 2026",
    language:        "en",
    sourceType:      "official_statement",
    credibilityTier: "primary",
    accessMethod:    "user_upload",
    contentHash:     DEMO_HASH_1,
    isDemo:          true,
  }).onConflictDoNothing();

  await db.insert(schema.sources).values({
    id:              DEMO_SOURCE_2_ID,
    researchRunId:   DEMO_RUN_ID,
    url:             "https://example.com/DEMO-nalsar-student-response-2026",
    canonicalUrl:    "https://example.com/DEMO-nalsar-student-response-2026",
    domain:          "example.com",
    title:           "[DEMO PLACEHOLDER] NALSAR Student Open Letter — 2026",
    author:          "NALSAR Student Council",
    language:        "en",
    sourceType:      "official_statement",
    credibilityTier: "primary",
    accessMethod:    "user_upload",
    contentHash:     DEMO_HASH_2,
    isDemo:          true,
  }).onConflictDoNothing();
  console.log("✅ Demo sources ensured");

  // ── 6. Demo evidence ─────────────────────────────────────────
  await db.insert(schema.evidence).values({
    id:                 DEMO_EVID_1_ID,
    sourceId:           DEMO_SOURCE_1_ID,
    quote:              "[DEMO] Placeholder quote from BCI Chairman letter. Replace with actual source text when document is obtained.",
    confidence:         1.0,
    language:           "en",
    extractionWarnings: ["DEMO RECORD — not a real source; do not cite"],
    isDemo:             true,
  }).onConflictDoNothing();

  await db.insert(schema.evidence).values({
    id:                 DEMO_EVID_2_ID,
    sourceId:           DEMO_SOURCE_2_ID,
    quote:              "[DEMO] Placeholder quote from student response. Replace with actual source text.",
    confidence:         1.0,
    language:           "en",
    extractionWarnings: ["DEMO RECORD — not a real source; do not cite"],
    isDemo:             true,
  }).onConflictDoNothing();
  console.log("✅ Demo evidence ensured");

  // ── 7. Demo claims ────────────────────────────────────────────
  await db.insert(schema.claims).values({
    id:               DEMO_CLAIM_1_ID,
    projectId:        DEMO_PROJECT_ID,
    claimText:        "[DEMO] BCI issued a letter to NALSAR students in 2026.",
    claimType:        "reported",
    status:           "reported",
    confidence:       0.5,
    reasoningSummary: "DEMO — placeholder, based on demo data only.",
    whatIsMissing:    "Primary BCI document text. Independent news verification.",
    isDemo:           true,
  }).onConflictDoNothing();

  await db.insert(schema.claims).values({
    id:               DEMO_CLAIM_2_ID,
    projectId:        DEMO_PROJECT_ID,
    claimText:        "[DEMO] NALSAR students published a response to the BCI letter.",
    claimType:        "reported",
    status:           "unverified",
    confidence:       0.3,
    reasoningSummary: "DEMO — unverified placeholder.",
    whatIsMissing:    "Student council statement. Media coverage.",
    isDemo:           true,
  }).onConflictDoNothing();
  console.log("✅ Demo claims ensured");

  // ── 8. Demo dossier card ──────────────────────────────────────
  await db.insert(schema.dossierCards).values({
    id:            DEMO_DOSSIER_ID,
    projectId:     DEMO_PROJECT_ID,
    researchRunId: DEMO_RUN_ID,
    cardType:      "summary",
    title:         "Research Summary (DEMO)",
    body:          "⚠️ DEMO PROJECT. All data is illustrative.\n\nTrigger a real research run from the Research tab to replace demo data with real sources.",
    claimIds:      [DEMO_CLAIM_1_ID, DEMO_CLAIM_2_ID],
    sourceIds:     [DEMO_SOURCE_1_ID, DEMO_SOURCE_2_ID],
    evidenceIds:   [DEMO_EVID_1_ID, DEMO_EVID_2_ID],
    locale:        "en",
    sortOrder:     0,
  }).onConflictDoNothing();
  console.log("✅ Demo dossier card ensured");

  console.log(`\n🎉 Seed complete.`);
  console.log(`   Login: ${DEMO_EMAIL}`);
  console.log(`   Project ID: ${DEMO_PROJECT_ID}`);

  await client.end();
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});

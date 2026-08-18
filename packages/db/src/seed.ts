/**
 * CCJ Database Seed
 *
 * Creates:
 *  1. A demo admin user
 *  2. Demo project: "BCI Chairman Letter vs NALSAR Students — 2026"
 *  3. Demo research run with clearly-labeled DEMO sources and evidence
 *
 * IMPORTANT: All demo records have is_demo=true.
 * Demo source content is fictional/illustrative — NEVER presented as real.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { hash } from "bcrypt";
import * as schema from "./schema.js";

async function seed() {
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) throw new Error("DATABASE_URL is required");

  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

  console.log("🌱 Seeding CCJ database...");

  // ── 1. Demo user ───────────────────────────────────────────
  const passwordHash = await hash("Demo@CCJ2026!", 12);

  const [demoUser] = await db
    .insert(schema.users)
    .values({
      email: "demo@ccj.local",
      name: "CCJ Demo User",
      passwordHash,
      role: "owner",
      uiLocale: "en",
      emailVerified: true,
    })
    .onConflictDoNothing()
    .returning();

  if (!demoUser) {
    console.log("ℹ️  Demo user already exists, skipping.");
    await client.end();
    return;
  }

  console.log(`✅ Demo user: ${demoUser.email}`);

  // ── 2. Demo project ────────────────────────────────────────
  const [project] = await db
    .insert(schema.projects)
    .values({
      userId: demoUser.id,
      title: "BCI Chairman Letter vs NALSAR Students — 2026",
      description:
        "Research dossier examining the public dispute between the Bar Council of India and NALSAR University students regarding [DEMO PROJECT — sources are illustrative placeholders].",
      status: "active",
      uiLocale: "en",
      promptLocale: "en",
      projectLocale: "en",
      outputLocale: "en",
      sourceLanguage: "en",
    })
    .returning();

  if (!project) throw new Error("Failed to create demo project");
  console.log(`✅ Demo project: ${project.title}`);

  // ── 3. Demo research run ───────────────────────────────────
  const [run] = await db
    .insert(schema.researchRuns)
    .values({
      projectId: project.id,
      version: 1,
      status: "complete",
      depth: "standard",
      topic: "BCI Chairman Letter vs NALSAR Students 2026",
      requestedLanguage: "en",
      progressPct: 100,
      researchPlan: {
        researchQuestions: [
          "What did the BCI Chairman's letter to NALSAR contain?",
          "What was the nature of student grievances at NALSAR in 2026?",
          "What is the Bar Council of India's authority over law school students?",
          "How did NALSAR administration respond?",
          "What legal or regulatory basis exists for BCI oversight of student conduct?",
        ],
        queries: [
          { query: "BCI chairman letter NALSAR students 2026", provider: "searxng", priority: 1 },
          { query: "Bar Council India NALSAR dispute site:barandbench.com", provider: "searxng", priority: 2 },
        ],
        primarySourceTargets: ["bci.org.in", "nalsar.ac.in"],
        secondarySourceTargets: ["barandbench.com", "livelaw.in", "thehindu.com"],
        socialSourceTargets: [],
        legalQuestions: [
          "Does BCI have jurisdiction over student conduct at affiliated law schools?",
          "What provisions of the Advocates Act 1961 apply?",
        ],
        expectedEntities: ["Bar Council of India", "NALSAR University of Law", "Manan Kumar Mishra"],
        dateRange: { start: "2026-01-01", end: "2026-08-16" },
        riskFlags: ["Primary BCI document may not be publicly available"],
      },
      completedAt: new Date().toISOString(),
    })
    .returning();

  if (!run) throw new Error("Failed to create demo research run");

  // ── 4. Demo sources (clearly labeled) ─────────────────────
  const [source1] = await db
    .insert(schema.sources)
    .values({
      researchRunId: run.id,
      url: "https://example.com/DEMO-bci-nalsar-letter-2026",
      canonicalUrl: "https://example.com/DEMO-bci-nalsar-letter-2026",
      domain: "example.com",
      title: "[DEMO PLACEHOLDER] BCI Chairman Letter to NALSAR — 2026",
      author: null,
      language: "en",
      sourceType: "official_statement",
      credibilityTier: "primary",
      accessMethod: "user_upload",
      contentHash: "demo0000000000000000000000000000000000000000000000000000000000001",
      isDemo: true,
    })
  .returning();

  const [source2] = await db
    .insert(schema.sources)
    .values({
      researchRunId: run.id,
      url: "https://example.com/DEMO-nalsar-student-response-2026",
      canonicalUrl: "https://example.com/DEMO-nalsar-student-response-2026",
      domain: "example.com",
      title: "[DEMO PLACEHOLDER] NALSAR Student Open Letter — 2026",
      author: "NALSAR Student Council",
      language: "en",
      sourceType: "official_statement",
      credibilityTier: "primary",
      accessMethod: "user_upload",
      contentHash: "demo0000000000000000000000000000000000000000000000000000000000002",
      isDemo: true,
    })
    .returning();

  console.log("✅ Demo sources created");

  // ── 5. Demo evidence ───────────────────────────────────────
  if (source1?.[0]) {
    await db.insert(schema.evidence).values({
      sourceId: source1[0].id,
      quote: "[DEMO] This is a placeholder quote from the BCI Chairman letter. Replace with actual source text.",
      confidence: 1.0,
      language: "en",
      extractionWarnings: ["DEMO RECORD — not a real source"],
      isDemo: true,
    });
  }

  if (source2?.[0]) {
    await db.insert(schema.evidence).values({
      sourceId: source2[0].id,
      quote: "[DEMO] This is a placeholder quote from the student response. Replace with actual source text.",
      confidence: 1.0,
      language: "en",
      extractionWarnings: ["DEMO RECORD — not a real source"],
      isDemo: true,
    });
  }

  console.log("✅ Demo evidence created");

  // ── 6. Demo claims ─────────────────────────────────────────
  await db.insert(schema.claims).values([
    {
      projectId: project.id,
      claimText: "[DEMO] BCI issued a letter addressing student conduct at NALSAR in 2026.",
      claimType: "reported",
      status: "reported",
      confidence: 0.5,
      reasoningSummary: "DEMO RECORD — claim status based on placeholder data only.",
      whatIsMissing: "Primary BCI document text. Independent news verification.",
      isDemo: true,
    },
    {
      projectId: project.id,
      claimText: "[DEMO] NALSAR students published a public response to the BCI letter.",
      claimType: "reported",
      status: "unverified",
      confidence: 0.3,
      reasoningSummary: "DEMO RECORD — unverified placeholder.",
      whatIsMissing: "Student council statement. Media coverage.",
      isDemo: true,
    },
  ]);

  console.log("✅ Demo claims created");

  // ── 7. Demo dossier card ───────────────────────────────────
  await db.insert(schema.dossierCards).values({
    projectId: project.id,
    researchRunId: run.id,
    cardType: "summary",
    title: "Research Summary (DEMO)",
    body: "⚠️ This is a DEMO project. All sources, evidence and claims are labeled [DEMO] and are illustrative placeholders only. Begin real research by triggering a new research run with your actual sources.",
    claimIds: [],
    sourceIds: [],
    evidenceIds: [],
    locale: "en",
    sortOrder: 0,
  });

  console.log("✅ Demo dossier card created");
  console.log("\n🎉 Seed complete.");
  console.log("   Demo login: demo@ccj.local / Demo@CCJ2026!");

  await client.end();
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});

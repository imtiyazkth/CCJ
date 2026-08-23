import { NextRequest } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { getDb } from "@/lib/db.server";
import { requireUser, ok, err } from "@/lib/auth.server";
import { projects, researchRuns, sources, evidence, claims, dossierCards } from "@ccj/db/schema";
import { runFreeSearch, getWikipediaArticle } from "@/lib/providers/free-search";
import { generateResearchPlan, extractClaims } from "@/lib/providers/ai";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const db = getDb();
    const [p] = await db.select().from(projects)
      .where(and(eq(projects.id, id), eq(projects.userId, user.id))).limit(1);
    if (!p) return err("Not found", 404);
    const runs = await db.select().from(researchRuns)
      .where(eq(researchRuns.projectId, id))
      .orderBy(desc(researchRuns.version));
    return ok(runs);
  } catch (r) {
    if (r instanceof Response) return r;
    return err(String(r), 500);
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser(req);
    const { id: projectId } = await params;
    const body = await req.json() as {
      topic: string;
      depth?: string;
      requestedLanguage?: string;
    };

    if (!body.topic?.trim()) return err("Topic required", 400);
    const topic    = body.topic.trim();
    const depth    = (body.depth ?? "standard") as "quick" | "standard" | "deep";
    const language = body.requestedLanguage ?? "en";
    const db       = getDb();

    // Verify project ownership
    const [p] = await db.select().from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id))).limit(1);
    if (!p) return err("Not found", 404);

    // Next version number
    const [latest] = await db.select({ v: researchRuns.version })
      .from(researchRuns).where(eq(researchRuns.projectId, projectId))
      .orderBy(desc(researchRuns.version)).limit(1);

    // Create run record
    const [run] = await db.insert(researchRuns).values({
      projectId,
      version:           (latest?.v ?? 0) + 1,
      status:            "searching",
      depth,
      topic,
      requestedLanguage: language,
      progressPct:       10,
    }).returning();

    if (!run) return err("Failed to create run", 500);

    // ── Run research asynchronously ──────────────────────────
    // Vercel functions have a 10s limit on free plan, 60s on Pro.
    // We do the work synchronously within the request for reliability.

    try {
      // 1. Generate research plan
      const plan = await generateResearchPlan(topic);

      await db.update(researchRuns).set({
        status:       "fetching",
        progressPct:  30,
        researchPlan: {
          researchQuestions:     plan.researchQuestions,
          queries:               plan.queries.map((q, i) => ({ query: q, provider: "free", priority: i + 1 })),
          primarySourceTargets:  [],
          secondarySourceTargets:[],
          socialSourceTargets:   [],
          legalQuestions:        plan.legalQuestions,
          expectedEntities:      plan.keyEntities,
          dateRange:             { start: null, end: null },
          riskFlags:             plan.riskFlags,
        },
      }).where(eq(researchRuns.id, run.id));

      // 2. Search all free sources
      const maxPerSource = depth === "quick" ? 3 : depth === "deep" ? 8 : 5;
      const { results, instantAnswer } = await runFreeSearch(topic, language, maxPerSource);

      await db.update(researchRuns).set({
        status: "extracting", progressPct: 60,
      }).where(eq(researchRuns.id, run.id));

      // 3. Save sources and extract evidence + claims
      const savedSourceIds:   string[] = [];
      const savedEvidenceIds: string[] = [];
      const savedClaimIds:    string[] = [];

      for (const result of results.slice(0, 15)) {
        // Save source
        const [src] = await db.insert(sources).values({
          researchRunId:   run.id,
          url:             result.url,
          canonicalUrl:    result.url,
          domain:          new URL(result.url).hostname,
          title:           result.title,
          language:        language,
          sourceType:      result.source === "Wikipedia" ? "academic" : "news",
          credibilityTier: result.source === "Wikipedia" ? "credible" : "reported",
          accessMethod:    "public_web",
          contentHash:     Buffer.from(result.url).toString("hex").slice(0, 64).padEnd(64, "0"),
          isDemo:          false,
        }).returning({ id: sources.id }).catch(() => []);

        if (!src) continue;
        savedSourceIds.push(src.id);

        // Get full Wikipedia article text if available
        let articleText = result.snippet;
        if (result.source === "Wikipedia") {
          const full = await getWikipediaArticle(result.title, language).catch(() => "");
          if (full) articleText = full.slice(0, 3000);
        }

        // Save evidence
        if (articleText.length > 50) {
          const [ev] = await db.insert(evidence).values({
            sourceId:           src.id,
            quote:              articleText.slice(0, 2000),
            confidence:         result.source === "Wikipedia" ? 0.85 : 0.65,
            language:           language,
            extractionWarnings: result.source === "Wikipedia"
              ? []
              : ["Snippet only — full article not fetched"],
            isDemo:             false,
          }).returning({ id: evidence.id }).catch(() => []);

          if (ev) savedEvidenceIds.push(ev.id);

          // Extract claims using AI
          const claimTexts = await extractClaims(articleText, result.title, topic);
          for (const claimText of claimTexts) {
            const [c] = await db.insert(claims).values({
              projectId:        projectId,
              claimText:        claimText.trim(),
              claimType:        "reported",
              status:           "unverified",
              confidence:       result.source === "Wikipedia" ? 0.7 : 0.5,
              reasoningSummary: `Extracted from: ${result.title} (${result.source})`,
              whatIsMissing:    "Primary source verification. Cross-reference with official documents.",
              isDemo:           false,
            }).returning({ id: claims.id }).catch(() => []);
            if (c) savedClaimIds.push(c.id);
          }
        }
      }

      // 4. Add instant answer as a top evidence if available
      if (instantAnswer && instantAnswer.length > 30) {
        const topSrc = savedSourceIds[0];
        if (topSrc) {
          await db.insert(evidence).values({
            sourceId:           topSrc,
            quote:              instantAnswer.slice(0, 1000),
            confidence:         0.75,
            language:           language,
            extractionWarnings: ["DuckDuckGo Instant Answer — verify with primary source"],
            isDemo:             false,
          }).catch(() => {});
        }
      }

      // 5. Build dossier summary card
      const aiMode = process.env["GROQ_API_KEY"] ? "Groq AI"
        : process.env["GEMINI_API_KEY"]          ? "Gemini AI"
        : "Rule-based";

      const dossierBody = [
        `Research Topic: ${topic}`,
        `Depth: ${depth} | Language: ${language}`,
        `AI Planning: ${aiMode}`,
        "",
        `Sources found: ${savedSourceIds.length}`,
        `Evidence extracted: ${savedEvidenceIds.length}`,
        `Claims identified: ${savedClaimIds.length}`,
        "",
        "Sources used:",
        ...results.slice(0, 8).map((r) => `  [${r.source}] ${r.title}`),
        "",
        instantAnswer ? `Quick answer: ${instantAnswer.slice(0, 300)}` : "",
        "",
        "⚠️ All claims are 'unverified'. Review evidence before publishing.",
        plan.riskFlags.length ? `Risk flags: ${plan.riskFlags.join("; ")}` : "",
      ].filter(Boolean).join("\n");

      await db.insert(dossierCards).values({
        projectId,
        researchRunId: run.id,
        cardType:      "summary",
        title:         `Research Summary: ${topic.slice(0, 80)}`,
        body:          dossierBody,
        claimIds:      savedClaimIds,
        sourceIds:     savedSourceIds,
        evidenceIds:   savedEvidenceIds,
        locale:        language,
        sortOrder:     0,
      }).catch(() => {});

      // 6. Mark complete
      await db.update(researchRuns).set({
        status:      "complete",
        progressPct: 100,
        completedAt: new Date(),
      }).where(eq(researchRuns.id, run.id));

    } catch (researchError) {
      // Mark failed but don't crash the response
      await db.update(researchRuns).set({
        status: "failed",
        error:  String(researchError),
      }).where(eq(researchRuns.id, run.id)).catch(() => {});
    }

    // Return the completed run
    const [finalRun] = await db.select().from(researchRuns)
      .where(eq(researchRuns.id, run.id)).limit(1);

    return ok(finalRun, 202);
  } catch (r) {
    if (r instanceof Response) return r;
    return err(String(r), 500);
  }
}

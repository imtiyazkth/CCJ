import { NextRequest } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { after } from "next/server";
import { getDb } from "@/lib/db.server";
import { requireUser, ok, err } from "@/lib/auth.server";
import { projects, researchRuns, sources, evidence, claims, dossierCards } from "@ccj/db/schema";
import { runAllSources, getWikipediaArticle } from "@/lib/providers/free-search";
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
    const body = await req.json() as { topic:string; depth?:string; requestedLanguage?:string };
    if (!body.topic?.trim()) return err("Topic required", 400);

    const topic    = body.topic.trim();
    const depth    = (body.depth ?? "standard") as "quick"|"standard"|"deep";
    const language = body.requestedLanguage ?? "en";
    const db       = getDb();

    const [p] = await db.select().from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id))).limit(1);
    if (!p) return err("Not found", 404);

    const [latest] = await db.select({ v: researchRuns.version })
      .from(researchRuns).where(eq(researchRuns.projectId, projectId))
      .orderBy(desc(researchRuns.version)).limit(1);

    // ── Create run record and return IMMEDIATELY ──────────────
    const [run] = await db.insert(researchRuns).values({
      projectId,
      version:           (latest?.v ?? 0) + 1,
      status:            "planning",
      depth,
      topic,
      requestedLanguage: language,
      progressPct:       5,
    }).returning();

    if (!run) return err("Failed to create run", 500);

    // ── Process in background — response already sent ─────────
    after(async () => {
      const runId = run.id;
      const update = (status: string, pct: number) =>
        db.update(researchRuns).set({ status: status as any, progressPct: pct })
          .where(eq(researchRuns.id, runId)).catch(() => {});

      try {
        // 1. Plan (parallel with search)
        const [plan, searchData] = await Promise.all([
          generateResearchPlan(topic),
          runAllSources(topic, language, depth),
        ]);

        await update("fetching", 40);

        await db.update(researchRuns).set({
          researchPlan: {
            researchQuestions:      plan.researchQuestions,
            queries:                plan.queries.map((q,i) => ({ query:q, provider:"multi", priority:i+1 })),
            primarySourceTargets:   [],
            secondarySourceTargets: [],
            socialSourceTargets:    [],
            legalQuestions:         plan.legalQuestions,
            expectedEntities:       plan.keyEntities,
            dateRange:              { start:null, end:null },
            riskFlags:              plan.riskFlags,
          },
        }).where(eq(researchRuns.id, runId)).catch(() => {});

        const { results, instantAnswer } = searchData;

        await update("extracting", 60);

        // 2. Save sources + extract evidence + claims (parallel per source)
        const savedSourceIds:   string[] = [];
        const savedEvidenceIds: string[] = [];
        const savedClaimIds:    string[] = [];

        // Limit total sources by depth
        const maxSources = depth === "quick" ? 6 : depth === "deep" ? 20 : 12;

        await Promise.all(
          results.slice(0, maxSources).map(async (result) => {
            if (!result.url) return;

            const [src] = await db.insert(sources).values({
              researchRunId:   runId,
              url:             result.url,
              canonicalUrl:    result.url,
              domain:          (() => { try { return new URL(result.url).hostname; } catch { return result.source; } })(),
              title:           result.title,
              publishedAt:     result.publishedAt ? new Date(result.publishedAt) : null,
              language:        result.language ?? language,
              sourceType:      result.source.includes("Academic") ? "academic"
                             : result.source === "Wikipedia"       ? "academic"
                             : result.source === "Reddit"          ? "social"
                             : "news",
              credibilityTier: result.source === "Wikipedia" || result.source.includes("Academic") ? "credible"
                             : result.source === "The Guardian" || result.source.includes("NewsAPI") ? "credible"
                             : "reported",
              accessMethod:    "public_web",
              contentHash:     Buffer.from(result.url).toString("base64").replace(/[^a-f0-9]/gi,"0").slice(0,64).padEnd(64,"0"),
              isDemo:          false,
            }).returning({ id: sources.id }).catch(() => [] as {id:string}[]);

            if (!src?.id) return;
            savedSourceIds.push(src.id);

            // Get full text for Wikipedia
            let text = result.snippet;
            if (result.source === "Wikipedia" && result.title) {
              const full = await getWikipediaArticle(result.title, language).catch(() => "");
              if (full.length > 100) text = full;
            }

            if (text.length < 30) return;

            // Save evidence
            const [ev] = await db.insert(evidence).values({
              sourceId:           src.id,
              quote:              text.slice(0, 2000),
              confidence:         result.source === "Wikipedia" || result.source.includes("Academic") ? 0.85
                                : result.source === "The Guardian" ? 0.80 : 0.60,
              language:           result.language ?? language,
              extractionWarnings: text.length < 200 ? ["Snippet only — full article not fetched"] : [],
              isDemo:             false,
            }).returning({ id: evidence.id }).catch(() => [] as {id:string}[]);

            if (ev?.id) savedEvidenceIds.push(ev.id);

            // Extract claims via AI
            const claimTexts = await extractClaims(text, result.title, topic).catch(() => [] as string[]);
            for (const claimText of claimTexts.slice(0, 3)) {
              const [c] = await db.insert(claims).values({
                projectId,
                claimText:        claimText.trim().slice(0, 1000),
                claimType:        "reported",
                status:           "unverified",
                confidence:       result.source === "Wikipedia" ? 0.70 : 0.50,
                reasoningSummary: `Extracted from: ${result.title} via ${result.source}`,
                whatIsMissing:    "Cross-reference with primary documents.",
                isDemo:           false,
              }).returning({ id: claims.id }).catch(() => [] as {id:string}[]);
              if (c?.id) savedClaimIds.push(c.id);
            }
          })
        );

        await update("analysing", 85);

        // 3. Build dossier
        const aiMode = process.env["GROQ_API_KEY"] ? "Groq (Llama 3.3)"
          : process.env["GEMINI_API_KEY"]           ? "Gemini 1.5 Flash"
          : "Rule-based";

        const sourceList = results.slice(0, 10)
          .map(r => `  [${r.source}] ${r.title}`)
          .join("\n");

        await db.insert(dossierCards).values({
          projectId,
          researchRunId: runId,
          cardType:      "summary",
          title:         `Research: ${topic.slice(0, 80)}`,
          body:          [
            `Topic: ${topic}`,
            `Depth: ${depth} | Language: ${language} | AI: ${aiMode}`,
            `Sources: ${savedSourceIds.length} | Evidence: ${savedEvidenceIds.length} | Claims: ${savedClaimIds.length}`,
            "",
            "Sources used:",
            sourceList,
            instantAnswer ? `\nInstant answer: ${instantAnswer.slice(0, 400)}` : "",
            "",
            "⚠️ Claims are unverified. Review evidence before publishing.",
          ].filter(Boolean).join("\n"),
          claimIds:  savedClaimIds,
          sourceIds: savedSourceIds,
          evidenceIds: savedEvidenceIds,
          locale:    language,
          sortOrder: 0,
        }).catch(() => {});

        // 4. Done
        await db.update(researchRuns).set({
          status:      "complete",
          progressPct: 100,
          completedAt: new Date(),
        }).where(eq(researchRuns.id, runId)).catch(() => {});

      } catch (e) {
        await db.update(researchRuns).set({
          status: "failed",
          error:  String(e).slice(0, 500),
        }).where(eq(researchRuns.id, runId)).catch(() => {});
      }
    });

    // Return immediately — frontend polls for completion
    return ok(run, 202);

  } catch (r) {
    if (r instanceof Response) return r;
    return err(String(r), 500);
  }
}

import { NextRequest } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { after } from "next/server";
import { getDb } from "@/lib/db.server";
import { requireUser, ok, err } from "@/lib/auth.server";
import {
  projects, researchRuns, sources,
  evidence, claims, dossierCards,
} from "@ccj/db/schema";
import { runAllSources, getWikipediaArticle } from "@/lib/providers/free-search";
import { searchAllSocialMedia } from "@/lib/providers/social-search";
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

function safeHostname(url: string, fallback: string): string {
  try { return new URL(url).hostname; } catch { return fallback; }
}

function safeHash(url: string): string {
  return Buffer.from(url).toString("base64")
    .replace(/[^a-zA-Z0-9]/g, "0").slice(0, 64).padEnd(64, "0");
}

function credTier(source: string): "primary"|"verified"|"credible"|"reported"|"unknown" {
  if (["Wikipedia","Academic (OpenAlex)"].includes(source)) return "credible";
  if (["The Guardian","NewsAPI"].some(s => source.includes(s)))    return "credible";
  if (["YouTube","GitHub"].includes(source))                        return "reported";
  return "reported";
}

function srcType(source: string): "webpage"|"video"|"social"|"academic"|"news" {
  if (source === "YouTube")                   return "video";
  if (source === "Academic (OpenAlex)")       return "academic";
  if (source === "Wikipedia")                 return "academic";
  if (["X (Twitter)","Instagram","LinkedIn",
       "Reddit","Facebook","Threads"].includes(source)) return "social";
  return "news";
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser(req);
    const { id: projectId } = await params;
    const body = await req.json() as {
      topic: string; depth?: string; requestedLanguage?: string;
    };
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

    const searchStartedAt = new Date().toISOString();

    const [run] = await db.insert(researchRuns).values({
      projectId,
      version:           (latest?.v ?? 0) + 1,
      status:            "planning",
      depth, topic,
      requestedLanguage: language,
      progressPct:       5,
    }).returning();

    if (!run) return err("Failed to create run", 500);

    after(async () => {
      const runId = run.id;
      const upd = (s: string, pct: number) =>
        db.update(researchRuns).set({ status: s as any, progressPct: pct })
          .where(eq(researchRuns.id, runId)).catch(() => {});

      try {
        // Plan + all sources fire simultaneously
        const [plan, webData, socialData] = await Promise.all([
          generateResearchPlan(topic),
          runAllSources(topic, language, depth),
          searchAllSocialMedia(topic, depth === "quick" ? 3 : depth === "deep" ? 6 : 4),
        ]);

        await upd("fetching", 35);

        await db.update(researchRuns).set({
          researchPlan: {
            researchQuestions:      plan.researchQuestions,
            queries:                plan.queries.map((q, i) => ({
              query: q, provider: "multi", priority: i + 1,
            })),
            primarySourceTargets:   [],
            secondarySourceTargets: [],
            socialSourceTargets:    socialData.slice(0, 5).map(s => s.url),
            legalQuestions:         plan.legalQuestions,
            expectedEntities:       plan.keyEntities,
            dateRange:              { start: null, end: null },
            riskFlags:              plan.riskFlags,
            searchedAt:             searchStartedAt,
          },
        }).where(eq(researchRuns.id, runId)).catch(() => {});

        await upd("extracting", 55);

        const { results: webResults, instantAnswer } = webData;
        const allResults = [...webResults, ...socialData];

        const maxSrc = depth === "quick" ? 8 : depth === "deep" ? 25 : 15;
        const savedSrcIds: string[] = [];
        const savedEvIds:  string[] = [];
        const savedClIds:  string[] = [];

        await Promise.all(
          allResults.slice(0, maxSrc).map(async (result) => {
            if (!result.url) return;

            const retrievedAt = new Date();
            const pub = result.publishedAt ? new Date(result.publishedAt) : null;

            const [src] = await db.insert(sources).values({
              researchRunId:   runId,
              url:             result.url,
              canonicalUrl:    result.url,
              domain:          safeHostname(result.url, result.source),
              title:           result.title || "Untitled",
              publishedAt:     pub,
              retrievedAt,
              language:        result.language ?? language,
              sourceType:      srcType(result.source),
              credibilityTier: credTier(result.source),
              accessMethod:    "public_web",
              contentHash:     safeHash(result.url),
              isDemo:          false,
            }).returning({ id: sources.id }).catch(() => [] as {id:string}[]);

            if (!src?.id) return;
            savedSrcIds.push(src.id);

            let text = result.snippet ?? "";
            if (result.source === "Wikipedia" && result.title) {
              const full = await getWikipediaArticle(result.title, language).catch(() => "");
              if (full.length > 100) text = full;
            }
            if (text.length < 20) return;

            const [ev] = await db.insert(evidence).values({
              sourceId:  src.id,
              quote:     text.slice(0, 2000),
              confidence: credTier(result.source) === "credible" ? 0.85 : 0.60,
              language:   result.language ?? language,
              capturedAt: retrievedAt,
              extractionWarnings: text.length < 150
                ? ["Short snippet only — visit source for full content"] : [],
              isDemo: false,
            }).returning({ id: evidence.id }).catch(() => [] as {id:string}[]);

            if (ev?.id) savedEvIds.push(ev.id);

            const claimTexts = await extractClaims(text, result.title, topic)
              .catch(() => [] as string[]);
            for (const ct of claimTexts.slice(0, 3)) {
              const [c] = await db.insert(claims).values({
                projectId,
                claimText:        ct.trim().slice(0, 1000),
                claimType:        "reported",
                status:           "unverified",
                confidence:       credTier(result.source) === "credible" ? 0.70 : 0.45,
                reasoningSummary: `Source: ${result.title} (${result.source}) — retrieved ${retrievedAt.toISOString()}`,
                whatIsMissing:    "Cross-reference with primary documents. See source link.",
                isDemo: false,
              }).returning({ id: claims.id }).catch(() => [] as {id:string}[]);
              if (c?.id) savedClIds.push(c.id);
            }
          })
        );

        await upd("analysing", 85);

        const aiMode = process.env["GROQ_API_KEY"] ? "Groq (Llama 3.3)"
          : process.env["GEMINI_API_KEY"]           ? "Gemini 1.5 Flash"
          : "Rule-based";

        const completedAt = new Date();

        const groupBySrc = (label: string) =>
          allResults.filter(r => r.source.includes(label)).map(r => `  → ${r.title}`).join("\n");

        await db.insert(dossierCards).values({
          projectId,
          researchRunId: runId,
          cardType:      "summary",
          title:         `Research: ${topic.slice(0, 80)}`,
          body: [
            `📌 Topic: ${topic}`,
            `🕐 Searched: ${searchStartedAt}`,
            `✅ Completed: ${completedAt.toISOString()}`,
            `🔍 Depth: ${depth} | Language: ${language} | AI: ${aiMode}`,
            `📊 Sources: ${savedSrcIds.length} | Evidence: ${savedEvIds.length} | Claims: ${savedClIds.length}`,
            "",
            "🌐 Web Sources:",
            ...webResults.slice(0, 6).map(r => `  [${r.source}] ${r.title}`),
            "",
            "📱 Social Media:",
            ...socialData.slice(0, 6).map(r => `  [${r.source}] ${r.title} — ${r.url}`),
            instantAnswer ? `\n💡 Quick Answer: ${instantAnswer.slice(0, 500)}` : "",
            "",
            "⚠️ All claims are unverified. Click source links to verify.",
            plan.riskFlags.length ? `\n🚩 Risk Flags: ${plan.riskFlags.join("; ")}` : "",
          ].filter(Boolean).join("\n"),
          claimIds:    savedClIds,
          sourceIds:   savedSrcIds,
          evidenceIds: savedEvIds,
          locale:      language,
          sortOrder:   0,
        }).catch(() => {});

        await db.update(researchRuns).set({
          status: "complete", progressPct: 100,
          completedAt,
        }).where(eq(researchRuns.id, runId)).catch(() => {});

      } catch (e) {
        await db.update(researchRuns).set({
          status: "failed",
          error: String(e).slice(0, 500),
        }).where(eq(researchRuns.id, runId)).catch(() => {});
      }
    });

    return ok(run, 202);
  } catch (r) {
    if (r instanceof Response) return r;
    return err(String(r), 500);
  }
}

/**
 * CCJ Research Route — OSINT Multi-Agent Pipeline
 *
 * Flow (async, returns 202 immediately):
 *   1. AI query cleaner → extract entity + intent
 *   2. Load memory (persistent context from prior runs)
 *   3. Multi-platform data fetch (8 sources parallel)
 *   4. Social Media Agent
 *   5. News & Govt Agent
 *   6. Fact-Checker Agent (cross-references 3+4)
 *   7. Save all artefacts to DB
 *   8. Update persistent memory
 */

import { NextRequest } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { after } from "next/server";

import { getDb }         from "@/lib/db.server";
import { requireUser, ok, err } from "@/lib/auth.server";
import { extractSearchEntities } from "@/lib/query-cleaner";
import { fetchMultiPlatformData } from "@/lib/providers/fetcher";
import type { FetchResult } from "@/lib/providers/fetcher";
import { searchAllSocialMedia }   from "@/lib/providers/social-search";
import { SocialMediaAgent }       from "@/lib/agents/social-media-agent";
import { NewsGovtAgent }          from "@/lib/agents/news-govt-agent";
import { FactCheckerAgent }       from "@/lib/agents/fact-checker-agent";
import { loadMemory, saveMemory, buildMemoryPrompt } from "@/lib/memory-engine";
import type { SocialMediaAnalysis } from "@/lib/agents/social-media-agent";
import type { NewsGovtAnalysis }    from "@/lib/agents/news-govt-agent";
import type { FactCheckResult }     from "@/lib/agents/fact-checker-agent";
import { generateTopicSummary, verifyClaimsAgainstSources } from "@/lib/providers/ai";
import { ingestAllYoutubeVideos } from "@/lib/youtube/ingest";
import type { YoutubeIngestResult } from "@/lib/youtube/ingest";


import {
  projects, researchRuns, sources,
  evidence, claims, dossierCards,
} from "@ccj/db/schema";

type Params = { params: Promise<{ id: string }> };

// ── Status streaming helper ───────────────────────────────────
async function updateStatus(
  runId: string,
  status: string,
  pct: number,
  extra?: Record<string, unknown>
) {
  const db = getDb();
  await db.update(researchRuns)
    .set({ status: status as any, progressPct: pct, ...extra })
    .where(eq(researchRuns.id, runId))
    .catch(() => {});
}

function safeHost(url: string, fb: string): string {
  try { return new URL(url).hostname; } catch { return fb; }
}

function safeHash(url: string): string {
  return Buffer.from(url).toString("base64")
    .replace(/[^a-zA-Z0-9]/g, "0").slice(0, 64).padEnd(64, "0");
}

// ── GET: list runs ────────────────────────────────────────────
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

// ── POST: trigger new research run ────────────────────────────
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser(req);
    const { id: projectId } = await params;
    const body = await req.json() as {
      topic: string; depth?: string; requestedLanguage?: string;
    };
    if (!body.topic?.trim()) return err("Topic required", 400);

    const rawTopic  = body.topic.trim();
    const depth     = (body.depth ?? "standard") as "quick"|"standard"|"deep";
    const db        = getDb();

    // Verify project ownership
    const [p] = await db.select().from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id))).limit(1);
    if (!p) return err("Not found", 404);

    // ── Module 1: Clean query BEFORE creating the run ────────
    const cleanedQuery = await extractSearchEntities(rawTopic);

    const [latest] = await db.select({ v: researchRuns.version })
      .from(researchRuns).where(eq(researchRuns.projectId, projectId))
      .orderBy(desc(researchRuns.version)).limit(1);

    // Create run record — return 202 immediately
    const [run] = await db.insert(researchRuns).values({
      projectId,
      version:           (latest?.v ?? 0) + 1,
      status:            "planning",
      depth,
      topic:             cleanedQuery.cleanEntity || rawTopic,
      requestedLanguage: cleanedQuery.language,
      progressPct:       5,
    }).returning();

    if (!run) return err("Failed to create run", 500);

    // ── Background pipeline (Modules 2–5) ────────────────────
    after(async () => {
      const runId = run.id;
      const language = cleanedQuery.language;
      const entity   = cleanedQuery.cleanEntity;

      try {
        // ── Module 4: Load memory ────────────────────────────
        await updateStatus(runId, "planning", 10);
        const priorMemory = await loadMemory(projectId, cleanedQuery.entitySlug);
        const memoryPrompt = buildMemoryPrompt(priorMemory);

        if (priorMemory && !priorMemory.isNew) {
          console.log(`[Memory] Loaded ${priorMemory.runCount} prior runs for "${entity}"`);
        }

        // ── Module 2a: YouTube ingestion (additive) ──────────
        // If the topic contains one or more YouTube URLs, ingest their
        // transcripts as first-class sources/evidence/claims BEFORE the
        // rest of the pipeline runs, so independent web/news sources
        // gathered next can be used to verify the YouTube-derived claims.
        // This never blocks or replaces the existing OSINT fetch below —
        // if no YouTube URL is present, youtubeResults is simply [].
        let youtubeResults: YoutubeIngestResult[] = [];
        try {
          youtubeResults = await ingestAllYoutubeVideos(projectId, runId, rawTopic, language);
          if (youtubeResults.length > 0) {
            console.log(`[YouTube] Ingested ${youtubeResults.length} video(s), `
              + `${youtubeResults.reduce((n, r) => n + r.evidenceIds.length, 0)} evidence, `
              + `${youtubeResults.reduce((n, r) => n + r.claimIds.length, 0)} claims`);
          }
        } catch (e) {
          console.error("[YouTube] Ingestion step failed (continuing without it):", e);
        }

        // ── Module 2: Fetch all platforms ────────────────────
        await updateStatus(runId, "searching", 20);
        const startTime = new Date().toISOString();

        const [webData, socialData] = await Promise.all([
          fetchMultiPlatformData(entity, cleanedQuery.intent, language, depth),
          searchAllSocialMedia(entity, depth === "quick" ? 3 : depth === "deep" ? 6 : 4),
        ]);

        // Normalise social results to FetchResult shape
        const normalisedSocial: FetchResult[] = socialData.map(s => ({
          title:       s.title,
          source:      s.source,
          platform:    s.platform,
          url:         s.url,
          snippet:     s.snippet,
          timestamp:   s.timestamp ?? s.publishedAt ?? null,
          credibility: s.credibility,
          language:    s.language,
          publishedAt: s.publishedAt ?? s.timestamp ?? null,
          thumbnail:   s.thumbnail,
        }));
        const allDataRaw: FetchResult[] = [...webData, ...normalisedSocial];

        // ── Relevance filter ──────────────────────────────────
        // Search APIs (Wikipedia, GDELT, RSS, etc.) can return items that
        // technically matched a keyword but are topically unrelated to the
        // actual research subject (e.g. a cricket scorecard matching
        // "Qatar" because a team name overlapped, or generic health
        // studies matching a broad thematic keyword). Since every fetched
        // item was previously saved as a source unconditionally, keep only
        // items whose title/snippet mention the core entity — OR mention
        // a specific, distinctive (capitalized, proper-noun-like) term
        // drawn from the generated keywords, such as "Hamad", "Tamim",
        // "Jazeera". Generic lowercase thematic words from keywords
        // (e.g. "policy", "history") are deliberately excluded from this
        // secondary check so the filter doesn't collapse back into
        // accepting near-everything.
        const entityWords = cleanedQuery.cleanEntity
          .toLowerCase()
          .split(/\s+/)
          .filter(w => w.length > 2);
        const distinctiveKeywordTerms = cleanedQuery.keywords
          .flatMap(k => k.split(/\s+/))
          .filter(w => w.length > 3 && /^[A-Z]/.test(w)) // capitalized = likely proper noun
          .map(w => w.toLowerCase());
        const relevanceTerms = [...new Set([...entityWords, ...distinctiveKeywordTerms])];
        const isRelevant = (item: FetchResult): boolean => {
          if (relevanceTerms.length === 0) return true; // nothing to check against
          const haystack = `${item.title} ${item.snippet}`.toLowerCase();
          return relevanceTerms.some(w => haystack.includes(w));
        };
        const allData: FetchResult[] = allDataRaw.filter(isRelevant);
        const filteredOutCount = allDataRaw.length - allData.length;

        console.log(`[Fetch] ${allData.length} items from ${
          [...new Set(allData.map(d => d.platform))].join(", ")
        }${filteredOutCount > 0 ? ` (${filteredOutCount} filtered as off-topic)` : ""}`);

        await updateStatus(runId, "fetching", 40, {
          researchPlan: {
            researchQuestions:     cleanedQuery.keywords.map(k => `What is known about: ${k}?`),
            queries:               cleanedQuery.keywords.map((k, i) => ({ query: k, provider: "multi", priority: i + 1 })),
            primarySourceTargets:  [],
            secondarySourceTargets:[],
            socialSourceTargets:   socialData.slice(0, 5).map(s => s.url),
            legalQuestions:        cleanedQuery.intent === "legal" ? [`Legal context for ${entity}`] : [],
            expectedEntities:      [entity],
            dateRange:             { start: null, end: null },
            riskFlags:             priorMemory ? [`Prior research loaded (Run #${priorMemory.runCount})`] : [],
            cleanedQuery:          { entity, intent: cleanedQuery.intent, entityType: cleanedQuery.entityType },
            memoryContext:         priorMemory?.summary?.slice(0, 300) ?? null,
            searchedAt:            startTime,
            memoryPrompt,
          },
        });

        // ── Module 3: Multi-agent pipeline ───────────────────
        await updateStatus(runId, "extracting", 55);

        const socialAgent  = new SocialMediaAgent();
        const newsAgent    = new NewsGovtAgent();

        const [socialResult, newsResult] = await Promise.all([
          socialAgent.run(allData),
          newsAgent.run(allData),
        ]);

        const socialAnalysis = socialResult.output as SocialMediaAnalysis;
        const newsAnalysis   = newsResult.output as NewsGovtAnalysis;

        await updateStatus(runId, "analysing", 72);

        // Fact-checker runs after both agents complete
        const factAgent = new FactCheckerAgent();
        const factResult = await factAgent.run({
          social: socialAnalysis,
          news:   newsAnalysis,
          entity,
        });
        const factCheck = factResult.output as FactCheckResult;

        console.log(`[Agents] Social(${Math.round(socialResult.confidence*100)}%) | `
          + `News(${Math.round(newsResult.confidence*100)}%) | `
          + `Fact(${Math.round(factResult.confidence*100)}%)`);

        await updateStatus(runId, "analysing", 82);

        // ── Module 3a: Independently verify YouTube-derived claims ──
        // A YouTube transcript claim must never be marked "Supported"
        // merely for existing — it needs comparison against the
        // independent web/news sources gathered in Module 2 above.
        if (youtubeResults.length > 0) {
          const allYoutubeClaimTexts = youtubeResults.flatMap(r => r.claimTexts);
          if (allYoutubeClaimTexts.length > 0) {
            const independentExcerpts = allData
              .filter(d => d.platform !== "video") // exclude other YouTube results as "independent"
              .slice(0, 12)
              .map(d => ({ sourceName: `${d.source} — ${d.title}`, excerpt: d.snippet ?? "" }))
              .filter(s => s.excerpt.length > 20);

            const verifications = await verifyClaimsAgainstSources(
              allYoutubeClaimTexts,
              independentExcerpts
            ).catch(() => []);

            const verdictToStatus = (v: string) =>
              v === "Supported"            ? "strongly_correlated" as const :
              v === "Contradicted"         ? "disputed" as const :
              v === "Disputed"             ? "disputed" as const :
              v === "Partially Supported"  ? "strongly_correlated" as const :
              v === "Opinion"              ? "opinion" as const :
              "unverified" as const;

            const claimIdByText = new Map<string, string>();
            for (const r of youtubeResults) {
              r.claimTexts.forEach((text, i) => {
                const id = r.claimIds[i];
                if (id) claimIdByText.set(text, id);
              });
            }

            await Promise.all(
              verifications.map(async (v) => {
                const claimId = claimIdByText.get(v.claim);
                if (!claimId) return;
                await db.update(claims).set({
                  status: verdictToStatus(v.verdict),
                  confidence: v.confidence,
                  reasoningSummary: v.reasoning.slice(0, 500),
                  whatIsMissing: v.supportingSources.length === 0 && v.contradictingSources.length === 0
                    ? "No independent source addressed this claim."
                    : null,
                  updatedAt: new Date(),
                }).where(eq(claims.id, claimId)).catch(() => {});
              })
            );
          }
        }

        // ── Save sources, evidence, claims ───────────────────
        // Seed with anything already ingested from YouTube above, so
        // YouTube-derived sources/evidence/claims appear in the same
        // dossier stats and card as the rest of this run's research.
        const savedSrcIds: string[] = youtubeResults.map(r => r.sourceId);
        const savedEvIds:  string[] = youtubeResults.flatMap(r => r.evidenceIds);
        const savedClIds:  string[] = youtubeResults.flatMap(r => r.claimIds);

        const maxSrc = depth === "quick" ? 8 : depth === "deep" ? 25 : 15;

        await Promise.all(
          allData.slice(0, maxSrc).map(async (item) => {
            if (!item.url) return;
            const retrievedAt = new Date();

            const [src] = await db.insert(sources).values({
              researchRunId:   runId,
              url:             item.url,
              canonicalUrl:    item.url,
              domain:          safeHost(item.url, item.source),
              title:           item.title || "Untitled",
              publishedAt:     item.timestamp ? new Date(item.timestamp) : null,
              retrievedAt,
              language:        item.language ?? language,
              sourceType:      item.platform === "academic" ? "academic"
                             : item.platform === "video"    ? "video"
                             : ["twitter","instagram","reddit","facebook","threads"].includes(item.platform)
                               ? "social" : "news",
              credibilityTier: item.credibility >= 0.85 ? "credible"
                             : item.credibility >= 0.65 ? "reported" : "unknown",
              accessMethod:    "public_web",
              contentHash:     safeHash(item.url),
              isDemo:          false,
            }).returning({ id: sources.id }).catch(() => [] as {id:string}[]);

            if (!src?.id) return;
            savedSrcIds.push(src.id);

            if (item.snippet?.length > 20) {
              const [ev] = await db.insert(evidence).values({
                sourceId:           src.id,
                quote:              item.snippet.slice(0, 2000),
                confidence:         item.credibility,
                language:           item.language ?? language,
                capturedAt:         retrievedAt,
                extractionWarnings: item.snippet.length < 100
                  ? ["Short snippet — visit source for full content"] : [],
                isDemo: false,
              }).returning({ id: evidence.id }).catch(() => [] as {id:string}[]);
              if (ev?.id) savedEvIds.push(ev.id);
            }
          })
        );

        // Save fact-checked claims
        for (const fc of factCheck.claims) {
          const [c] = await db.insert(claims).values({
            projectId,
            claimText:        fc.claim.slice(0, 1000),
            claimType:        fc.status === "opinion" ? "opinion" : "reported",
            status:           fc.status === "verified"  ? "strongly_correlated"
                            : fc.status === "disputed"  ? "disputed"
                            : fc.status === "opinion"   ? "opinion"
                            : "unverified",
            confidence:       fc.confidence,
            // fc.supportingEvidence/factCheck.missingEvidence are expected
            // arrays from FactCheckResult, but a malformed/partial AI or
            // fallback response could omit them — default to [] rather
            // than crashing the whole pipeline on a missing field.
            reasoningSummary: `${fc.verdict} | Supporting: ${(fc.supportingEvidence ?? []).join("; ").slice(0, 200)}`,
            whatIsMissing:    `${(factCheck.missingEvidence ?? []).join("; ").slice(0, 200)}`,
            isDemo:           false,
          }).returning({ id: claims.id }).catch(() => [] as {id:string}[]);
          if (c?.id) savedClIds.push(c.id);
        }

        const completedAt  = new Date();
        const aiMode       = process.env["GROQ_API_KEY"] ? "Groq Llama 3.3" : "Gemini 1.5 Flash";
        const verifiedCt   = factCheck.claims.filter(c => c.status === "verified").length;
        const disputedCt   = factCheck.claims.filter(c => c.status === "disputed").length;

        // Generate proper topic summary
        const topicSummary = await generateTopicSummary(
          entity,
          newsAnalysis.keyFacts,
          allData.slice(0, 8).map(r => r.title).filter(Boolean),
          cleanedQuery.intent
        ).catch(() => newsAnalysis.summary);

        // ── Dossier card ──────────────────────────────────────
        // Build structured dossier for UI rendering
        let parsedAnalysis: Record<string, unknown> = {};
        try { parsedAnalysis = JSON.parse(topicSummary) as Record<string, unknown>; }
        catch { parsedAnalysis = {}; }

        const structuredDossier = JSON.stringify({
          meta: {
            entity,
            entityType:  cleanedQuery.entityType,
            intent:      cleanedQuery.intent,
            searchedAt:  startTime,
            completedAt: completedAt.toISOString(),
            aiEngine:    aiMode,
            runNumber:   priorMemory ? priorMemory.runCount + 1 : 1,
            stats: {
              sources:  savedSrcIds.length,
              evidence: savedEvIds.length,
              claims:   savedClIds.length,
              verified: factCheck.claims.filter((c: { status: string }) => c.status === "verified").length,
              disputed: factCheck.claims.filter((c: { status: string }) => c.status === "disputed").length,
              reliability: factCheck.overallReliability,
            },
            social: { sentiment: socialAnalysis.sentiment, botRisk: socialAnalysis.botRisk },
            news:   { officialStatements: newsAnalysis.officialStatements.length },
          },
          analysis: parsedAnalysis,
          sourceTitles: allData.slice(0, 10).map((r: { source: string; title: string }) => ({
            source: r.source, title: r.title,
          })),
          factCheck: {
            overallReliability: factCheck.overallReliability,
            contradictions:     factCheck.contradictions,
            missingEvidence:    factCheck.missingEvidence,
          },
        });

        await db.insert(dossierCards).values({
          projectId,
          researchRunId: runId,
          cardType:      "summary",
          title:         `OSINT Report: ${entity.slice(0, 80)}`,
          body: structuredDossier + "\n\n" + [
            `📌 Entity: ${entity} (${cleanedQuery.entityType})`,
            `🎯 Intent: ${cleanedQuery.intent}`,
            `🕐 Searched: ${startTime}`,
            `✅ Completed: ${completedAt.toISOString()}`,
            `🤖 AI Engine: ${aiMode}`,
            priorMemory ? `📚 Memory: Research run #${priorMemory.runCount + 1} for this entity` : "🆕 First research run",
            "",
            `📊 Results:`,
            `  Sources: ${savedSrcIds.length} | Evidence: ${savedEvIds.length} | Claims: ${savedClIds.length}`,
            `  Verified: ${verifiedCt} | Disputed: ${disputedCt} | Reliability: ${factCheck.overallReliability.toUpperCase()}`,
            "",
            `🌐 Data Sources:`,
            ...allData.slice(0, 8).map(r => `  [${r.source}] ${r.title.slice(0, 80)}`),
            "",
            `📱 Social Media Analysis:`,
            `  Sentiment: ${socialAnalysis.sentiment} | Bot Risk: ${socialAnalysis.botRisk}`,
            socialAnalysis.viralClaims.length > 0
              ? `  Viral Claims: ${socialAnalysis.viralClaims.length} found`
              : "  No viral claims detected",
            "",
            `📰 News & Government:`,
            `  Official Statements: ${newsAnalysis.officialStatements.length}`,
            `  Government Sources: ${newsAnalysis.govtDomainHits.length}`,
            newsAnalysis.keyFacts.length > 0
              ? `  Key Facts:\n${newsAnalysis.keyFacts.slice(0, 3).map(f => `    • ${f}`).join("\n")}` : "",
            "",
            factCheck.contradictions.length > 0
              ? `⚡ Contradictions:\n${factCheck.contradictions.slice(0, 3).map(c => `  • ${c}`).join("\n")}` : "",
            "",
            `📝 Summary: ${topicSummary}`,
            "",
            "⚠️ Unverified claims require human review. Click source links to verify.",
          ].filter(Boolean).join("\n"),
          claimIds:    savedClIds,
          sourceIds:   savedSrcIds,
          evidenceIds: savedEvIds,
          locale:      language,
          sortOrder:   0,
        }).catch(() => {});

        // ── Module 4: Save memory ─────────────────────────────
        await saveMemory(
          projectId,
          cleanedQuery,
          newsAnalysis.summary,
          newsAnalysis.keyFacts.slice(0, 15),
          savedClIds,
          savedSrcIds,
          priorMemory
        );

        await updateStatus(runId, "complete", 100, { completedAt });

        console.log(`[Pipeline] Run ${runId} complete — ${savedSrcIds.length} sources, `
          + `${savedClIds.length} claims, memory updated`);

      } catch (e) {
        console.error(`[Pipeline] Run ${runId} failed:`, e);
        await updateStatus(runId, "failed", 0, { error: String(e).slice(0, 500) });
      }
    });

    // Return 202 immediately — frontend polls /api/research/worker?runId=
    return ok({
      ...run,
      cleanedQuery: {
        entity:     cleanedQuery.cleanEntity,
        intent:     cleanedQuery.intent,
        entityType: cleanedQuery.entityType,
        keywords:   cleanedQuery.keywords,
      },
    }, 202);

  } catch (r) {
    if (r instanceof Response) return r;
    return err(String(r), 500);
  }
}

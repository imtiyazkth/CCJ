import { NextRequest } from "next/server";
import { eq, and, desc, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db.server";
import { requireUser, ok, err } from "@/lib/auth.server";
import { projects, researchRuns, claims, dossierCards } from "@ccj/db/schema";
import {
  generateCreatorScript,
  type CreatorScriptMode,
  type CreatorScriptLanguage,
  type ScriptResearchInput,
} from "@/lib/providers/ai";

type Params = { params: Promise<{ id: string }> };

const VALID_MODES: CreatorScriptMode[] =
  ["short", "explainer", "deep_research", "documentary", "social_thread"];
const VALID_LANGUAGES: CreatorScriptLanguage[] = ["en", "hi", "hinglish"];

/**
 * POST /api/projects/[id]/script
 * Body: { runId?: string; mode: CreatorScriptMode; language: CreatorScriptLanguage }
 *
 * Generates a creator script FROM AN ALREADY-COMPLETED research run's
 * claims/dossier — never directly from a raw topic string. If runId is
 * omitted, uses the project's most recent completed run.
 *
 * This does not modify the research pipeline; it only reads what the
 * pipeline already produced.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser(req);
    const { id: projectId } = await params;
    const body = await req.json() as {
      runId?: string;
      mode?: string;
      language?: string;
    };

    const mode = (body.mode ?? "explainer") as CreatorScriptMode;
    const language = (body.language ?? "en") as CreatorScriptLanguage;
    if (!VALID_MODES.includes(mode)) return err(`Invalid mode. Expected one of: ${VALID_MODES.join(", ")}`, 400);
    if (!VALID_LANGUAGES.includes(language)) return err(`Invalid language. Expected one of: ${VALID_LANGUAGES.join(", ")}`, 400);

    const db = getDb();

    const [p] = await db.select().from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id))).limit(1);
    if (!p) return err("Not found", 404);

    // Resolve the target run: explicit runId, or latest completed run.
    let runId = body.runId;
    if (!runId) {
      const [latestRun] = await db.select({ id: researchRuns.id, status: researchRuns.status })
        .from(researchRuns)
        .where(eq(researchRuns.projectId, projectId))
        .orderBy(desc(researchRuns.version))
        .limit(1);
      if (!latestRun) return err("No research runs found for this project", 404);
      if (latestRun.status !== "complete") {
        return err("The most recent research run has not completed yet", 409);
      }
      runId = latestRun.id;
    }

    const [card] = await db.select().from(dossierCards)
      .where(and(eq(dossierCards.projectId, projectId), eq(dossierCards.researchRunId, runId)))
      .orderBy(desc(dossierCards.createdAt))
      .limit(1);

    if (!card) {
      return err("No completed research dossier found for this run — generate research first", 404);
    }

    // Pull the actual claim rows this run produced, to build the script
    // strictly from real, already-verified/unverified claim data.
    const runClaims = card.claimIds.length > 0
      ? await db.select().from(claims).where(inArray(claims.id, card.claimIds))
      : [];

    const verifiedClaims = runClaims
      .filter(c => c.status === "strongly_correlated" || c.status === "verified")
      .map(c => ({ id: c.id, claim: c.claimText, verdict: c.status }));

    const disputedClaims = runClaims
      .filter(c => c.status === "disputed")
      .map(c => ({ id: c.id, claim: c.claimText, sides: c.reasoningSummary ?? "Sources disagree; see claim reasoning for details." }));

    const unverifiedClaims = runClaims
      .filter(c => c.status === "unverified" || c.status === "inference")
      .map(c => ({ id: c.id, claim: c.claimText }));

    // Parse the dossier body's structured JSON (written by the research
    // route) for core conclusion / research gaps, without re-deriving or
    // guessing at values the pipeline already computed.
    let coreConclusion = "";
    let researchGaps: Array<{ description: string }> = [];
    let timelineEvents: Array<{ date: string; event: string }> = [];
    try {
      const jsonPart = card.body.split("\n\n")[0] ?? card.body;
      const parsed = JSON.parse(jsonPart) as {
        analysis?: {
          dashboard_result?: { core_conclusion?: string };
          timeline_events?: Array<{ date?: string; event?: string }>;
        };
        factCheck?: { missingEvidence?: string[] };
      };
      coreConclusion = parsed.analysis?.dashboard_result?.core_conclusion ?? "";
      // Filter out internal pipeline-error placeholders (e.g. when an
      // upstream agent's AI call failed) — these are not real research
      // gaps and should never be presented to the user as findings.
      const INTERNAL_ERROR_MARKERS = [
        "AI fact-check parsing failed",
        "No claims identified to fact-check",
      ];
      researchGaps = (parsed.factCheck?.missingEvidence ?? [])
        .filter(d => !INTERNAL_ERROR_MARKERS.some(marker => d.includes(marker)))
        .map(d => ({ description: d }));
      timelineEvents = (parsed.analysis?.timeline_events ?? [])
        .filter((t): t is { date: string; event: string } => !!t.date && !!t.event)
        .map(t => ({ date: t.date, event: t.event }));
    } catch {
      // Dossier body didn't parse as expected JSON — proceed with empty
      // conclusion/gaps/timeline rather than guessing at content.
    }

    const scriptInput: ScriptResearchInput = {
      topic: card.title.replace(/^OSINT Report: /, ""),
      coreConclusion,
      verifiedClaims,
      unverifiedClaims,
      disputedClaims,
      timelineEvents,
      researchGaps,
    };

    let script;
    try {
      script = await generateCreatorScript(scriptInput, mode, language);
    } catch (scriptError) {
      const message = scriptError instanceof Error ? scriptError.message : String(scriptError);
      if (message.startsWith("CREATOR_SCRIPT_GENERATION_FAILED")) {
        // Explicit, honest failure — never substitute a fake/raw-dump script.
        return err(
          "Script generation unavailable: all configured AI narrative providers " +
          "(Groq, Gemini) failed to respond. Check your API keys and try again.",
          502
        );
      }
      throw scriptError;
    }

    return ok({ runId, mode, language, script });
  } catch (r) {
    if (r instanceof Response) return r;
    return err(String(r), 500);
  }
}

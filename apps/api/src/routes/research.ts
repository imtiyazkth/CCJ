/**
 * CCJ Research Routes
 *
 * POST  /projects/:id/research        — trigger a new research run
 * GET   /projects/:id/research        — list research runs for project
 * GET   /projects/:id/research/:runId — get run status + plan
 * GET   /projects/:id/sources         — list sources for latest run
 * GET   /projects/:id/evidence        — list evidence for project
 * GET   /projects/:id/claims          — list claims for project
 * GET   /projects/:id/dossier         — get dossier cards
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import type { DrizzleClient } from "../lib/db.js";
import {
  projects,
  researchRuns,
  sources,
  evidence,
  claims,
  dossierCards,
} from "@ccj/db/schema";
import { SUPPORTED_LOCALES } from "@ccj/types";

const WORKER_URL = process.env["RESEARCH_WORKER_URL"] ?? "http://localhost:8001";
const WORKER_SECRET = process.env["WORKER_SECRET"] ?? "";

// ── Validators ────────────────────────────────────────────────

const triggerResearchSchema = z.object({
  topic: z.string().min(3, "Topic too short").max(2000).trim(),
  depth: z.enum(["quick", "standard", "deep"]).optional().default("standard"),
  dateRangeStart: z.string().datetime().optional(),
  dateRangeEnd: z.string().datetime().optional(),
  requestedLanguage: z
    .enum(SUPPORTED_LOCALES as [string, ...string[]])
    .optional()
    .default("en"),
});

// ── Helpers ───────────────────────────────────────────────────

async function getProjectOrFail(
  db: DrizzleClient,
  projectId: string,
  userId: string
) {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project || project.userId !== userId) return null;
  return project;
}

// ── Router ────────────────────────────────────────────────────

export function researchRouter(db: DrizzleClient) {
  const router = new Hono<{ Variables: { userId: string } }>();

  // POST /projects/:id/research — trigger research run
  router.post(
    "/:id/research",
    zValidator("json", triggerResearchSchema),
    async (c) => {
      const userId = c.get("userId");
      const { id: projectId } = c.req.param();
      const body = c.req.valid("json");

      const project = await getProjectOrFail(db, projectId, userId);
      if (!project) {
        return c.json({ success: false, error: { code: "NOT_FOUND", message: "Project not found" } }, 404);
      }

      // Determine next version number
      const [latestRun] = await db
        .select({ version: researchRuns.version })
        .from(researchRuns)
        .where(eq(researchRuns.projectId, projectId))
        .orderBy(desc(researchRuns.version))
        .limit(1);

      const nextVersion = (latestRun?.version ?? 0) + 1;

      // Create run record in pending state
      const [run] = await db
        .insert(researchRuns)
        .values({
          projectId,
          version: nextVersion,
          status: "pending",
          depth: body.depth,
          topic: body.topic,
          requestedLanguage: body.requestedLanguage,
          dateRangeStart: body.dateRangeStart ? new Date(body.dateRangeStart) : null,
          dateRangeEnd: body.dateRangeEnd ? new Date(body.dateRangeEnd) : null,
        })
        .returning();

      if (!run) {
        return c.json({ success: false, error: { code: "CREATE_FAILED", message: "Failed to create run" } }, 500);
      }

      // Dispatch to research worker (fire-and-forget pattern)
      // Worker updates the run record directly via its own DB connection
      void dispatchToWorker(run.id, projectId, body);

      return c.json({ success: true, data: run }, 202);
    }
  );

  // GET /projects/:id/research — list runs
  router.get("/:id/research", async (c) => {
    const userId = c.get("userId");
    const { id: projectId } = c.req.param();

    const project = await getProjectOrFail(db, projectId, userId);
    if (!project) {
      return c.json({ success: false, error: { code: "NOT_FOUND", message: "Project not found" } }, 404);
    }

    const runs = await db
      .select()
      .from(researchRuns)
      .where(eq(researchRuns.projectId, projectId))
      .orderBy(desc(researchRuns.version));

    return c.json({ success: true, data: runs });
  });

  // GET /projects/:id/research/:runId — poll run status
  router.get("/:id/research/:runId", async (c) => {
    const userId = c.get("userId");
    const { id: projectId, runId } = c.req.param();

    const project = await getProjectOrFail(db, projectId, userId);
    if (!project) {
      return c.json({ success: false, error: { code: "NOT_FOUND", message: "Project not found" } }, 404);
    }

    const [run] = await db
      .select()
      .from(researchRuns)
      .where(and(eq(researchRuns.id, runId), eq(researchRuns.projectId, projectId)))
      .limit(1);

    if (!run) {
      return c.json({ success: false, error: { code: "NOT_FOUND", message: "Research run not found" } }, 404);
    }

    return c.json({ success: true, data: run });
  });

  // GET /projects/:id/sources
  router.get("/:id/sources", async (c) => {
    const userId = c.get("userId");
    const { id: projectId } = c.req.param();

    const project = await getProjectOrFail(db, projectId, userId);
    if (!project) {
      return c.json({ success: false, error: { code: "NOT_FOUND", message: "Project not found" } }, 404);
    }

    // Get sources for the latest completed run
    const [latestRun] = await db
      .select({ id: researchRuns.id })
      .from(researchRuns)
      .where(
        and(
          eq(researchRuns.projectId, projectId),
          eq(researchRuns.status, "complete")
        )
      )
      .orderBy(desc(researchRuns.version))
      .limit(1);

    if (!latestRun) {
      return c.json({ success: true, data: [] });
    }

    const sourcesData = await db
      .select()
      .from(sources)
      .where(eq(sources.researchRunId, latestRun.id))
      .orderBy(sources.credibilityTier, sources.retrievedAt);

    return c.json({ success: true, data: sourcesData });
  });

  // GET /projects/:id/evidence
  router.get("/:id/evidence", async (c) => {
    const userId = c.get("userId");
    const { id: projectId } = c.req.param();

    const project = await getProjectOrFail(db, projectId, userId);
    if (!project) {
      return c.json({ success: false, error: { code: "NOT_FOUND", message: "Project not found" } }, 404);
    }

    // Evidence through sources → run → project
    const evidenceData = await db
      .select({ evidence: evidence })
      .from(evidence)
      .innerJoin(sources, eq(evidence.sourceId, sources.id))
      .innerJoin(researchRuns, eq(sources.researchRunId, researchRuns.id))
      .where(eq(researchRuns.projectId, projectId))
      .orderBy(evidence.capturedAt);

    return c.json({ success: true, data: evidenceData.map((r) => r.evidence) });
  });

  // GET /projects/:id/claims
  router.get("/:id/claims", async (c) => {
    const userId = c.get("userId");
    const { id: projectId } = c.req.param();

    const project = await getProjectOrFail(db, projectId, userId);
    if (!project) {
      return c.json({ success: false, error: { code: "NOT_FOUND", message: "Project not found" } }, 404);
    }

    const claimsData = await db
      .select()
      .from(claims)
      .where(eq(claims.projectId, projectId))
      .orderBy(claims.confidence);

    return c.json({ success: true, data: claimsData });
  });

  // GET /projects/:id/dossier
  router.get("/:id/dossier", async (c) => {
    const userId = c.get("userId");
    const { id: projectId } = c.req.param();

    const project = await getProjectOrFail(db, projectId, userId);
    if (!project) {
      return c.json({ success: false, error: { code: "NOT_FOUND", message: "Project not found" } }, 404);
    }

    const cards = await db
      .select()
      .from(dossierCards)
      .where(eq(dossierCards.projectId, projectId))
      .orderBy(dossierCards.sortOrder, dossierCards.createdAt);

    return c.json({ success: true, data: cards });
  });

  return router;
}

// ── Worker Dispatch ───────────────────────────────────────────

async function dispatchToWorker(
  runId: string,
  projectId: string,
  body: z.infer<typeof triggerResearchSchema>
) {
  try {
    await fetch(`${WORKER_URL}/research/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Worker-Secret": WORKER_SECRET,
      },
      body: JSON.stringify({
        run_id: runId,
        project_id: projectId,
        topic: body.topic,
        depth: body.depth,
        date_range_start: body.dateRangeStart ?? null,
        date_range_end: body.dateRangeEnd ?? null,
        requested_language: body.requestedLanguage,
      }),
    });
  } catch (err) {
    // Log but don't throw — the run status will reflect failure
    console.error(`[research-dispatch] Failed to dispatch run ${runId}:`, err);
  }
}

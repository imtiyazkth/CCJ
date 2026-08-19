/**
 * CCJ Research Routes — updated to use in-memory queue
 */
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import type { DrizzleClient } from "../lib/db.js";
import type { getResearchQueue } from "../lib/queue.js";
import { projects, researchRuns, sources, evidence, claims, dossierCards } from "@ccj/db/schema";
import { SUPPORTED_LOCALES } from "@ccj/types";

type ResearchQueue = ReturnType<typeof getResearchQueue>;

const triggerSchema = z.object({
  topic: z.string().min(3).max(2000).trim(),
  depth: z.enum(["quick","standard","deep"]).default("standard"),
  dateRangeStart: z.string().datetime().optional(),
  dateRangeEnd: z.string().datetime().optional(),
  requestedLanguage: z.enum([...SUPPORTED_LOCALES] as [string, ...string[]]).default("en"),
});

async function getProject(db: DrizzleClient, id: string, userId: string) {
  const [p] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return p?.userId === userId ? p : null;
}

export function researchRouter(db: DrizzleClient, queue: ResearchQueue) {
  const router = new Hono<{ Variables: { userId: string } }>();

  // POST /projects/:id/research
  router.post("/:id/research", zValidator("json", triggerSchema), async (c) => {
    const userId = c.get("userId");
    const { id: projectId } = c.req.param();
    const body = c.req.valid("json");
    const project = await getProject(db, projectId, userId);
    if (!project) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Project not found" } }, 404);

    const [latest] = await db.select({ v: researchRuns.version }).from(researchRuns)
      .where(eq(researchRuns.projectId, projectId)).orderBy(desc(researchRuns.version)).limit(1);
    const nextVersion = (latest?.v ?? 0) + 1;

    const [run] = await db.insert(researchRuns).values({
      projectId, version: nextVersion, status: "pending",
      depth: body.depth, topic: body.topic,
      requestedLanguage: body.requestedLanguage,
      dateRangeStart: body.dateRangeStart ? new Date(body.dateRangeStart) : null,
      dateRangeEnd: body.dateRangeEnd ? new Date(body.dateRangeEnd) : null,
    }).returning();
    if (!run) return c.json({ success: false, error: { code: "CREATE_FAILED", message: "Failed" } }, 500);

    // Enqueue (non-blocking)
    await queue.add(run.id, {
      runId: run.id, projectId, topic: body.topic,
      depth: body.depth, requestedLanguage: body.requestedLanguage,
      dateRangeStart: body.dateRangeStart ?? null,
      dateRangeEnd: body.dateRangeEnd ?? null,
    });

    return c.json({ success: true, data: run }, 202);
  });

  // GET /projects/:id/research
  router.get("/:id/research", async (c) => {
    const userId = c.get("userId");
    const { id: projectId } = c.req.param();
    const project = await getProject(db, projectId, userId);
    if (!project) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Not found" } }, 404);
    const runs = await db.select().from(researchRuns)
      .where(eq(researchRuns.projectId, projectId)).orderBy(desc(researchRuns.version));
    return c.json({ success: true, data: runs });
  });

  // GET /projects/:id/research/:runId
  router.get("/:id/research/:runId", async (c) => {
    const userId = c.get("userId");
    const { id: projectId, runId } = c.req.param();
    const project = await getProject(db, projectId, userId);
    if (!project) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Not found" } }, 404);
    const [run] = await db.select().from(researchRuns)
      .where(and(eq(researchRuns.id, runId), eq(researchRuns.projectId, projectId))).limit(1);
    if (!run) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Run not found" } }, 404);
    return c.json({ success: true, data: run });
  });

  // GET /projects/:id/sources
  router.get("/:id/sources", async (c) => {
    const userId = c.get("userId");
    const { id: projectId } = c.req.param();
    const project = await getProject(db, projectId, userId);
    if (!project) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Not found" } }, 404);
    const [latest] = await db.select({ id: researchRuns.id }).from(researchRuns)
      .where(and(eq(researchRuns.projectId, projectId), eq(researchRuns.status, "complete")))
      .orderBy(desc(researchRuns.version)).limit(1);
    if (!latest) return c.json({ success: true, data: [] });
    const data = await db.select().from(sources).where(eq(sources.researchRunId, latest.id));
    return c.json({ success: true, data });
  });

  // GET /projects/:id/evidence
  router.get("/:id/evidence", async (c) => {
    const userId = c.get("userId");
    const { id: projectId } = c.req.param();
    const project = await getProject(db, projectId, userId);
    if (!project) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Not found" } }, 404);
    const rows = await db.select({ ev: evidence }).from(evidence)
      .innerJoin(sources, eq(evidence.sourceId, sources.id))
      .innerJoin(researchRuns, eq(sources.researchRunId, researchRuns.id))
      .where(eq(researchRuns.projectId, projectId))
      .orderBy(evidence.capturedAt);
    return c.json({ success: true, data: rows.map((r: { ev: typeof import("@ccj/db/schema").evidence.$inferSelect }) => r.ev) });
  });

  // GET /projects/:id/claims
  router.get("/:id/claims", async (c) => {
    const userId = c.get("userId");
    const { id: projectId } = c.req.param();
    const project = await getProject(db, projectId, userId);
    if (!project) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Not found" } }, 404);
    const data = await db.select().from(claims).where(eq(claims.projectId, projectId)).orderBy(claims.confidence);
    return c.json({ success: true, data });
  });

  // GET /projects/:id/dossier
  router.get("/:id/dossier", async (c) => {
    const userId = c.get("userId");
    const { id: projectId } = c.req.param();
    const project = await getProject(db, projectId, userId);
    if (!project) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Not found" } }, 404);
    const data = await db.select().from(dossierCards).where(eq(dossierCards.projectId, projectId))
      .orderBy(dossierCards.sortOrder, dossierCards.createdAt);
    return c.json({ success: true, data });
  });

  return router;
}

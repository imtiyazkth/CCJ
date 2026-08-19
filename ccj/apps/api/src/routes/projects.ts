/**
 * CCJ Projects API Routes
 *
 * POST   /projects         — create project
 * GET    /projects         — list user's projects
 * GET    /projects/:id     — get project
 * PATCH  /projects/:id     — update project
 * DELETE /projects/:id     — archive project
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { DrizzleClient } from "../lib/db.js";
import { projects } from "@ccj/db/schema";
import { SUPPORTED_LOCALES } from "@ccj/types";

// ── Validators ────────────────────────────────────────────────

const localeSchema = z.enum([...SUPPORTED_LOCALES] as unknown as [string, ...string[]]);

const createProjectSchema = z.object({
  title: z
    .string()
    .min(1, "Title is required")
    .max(500, "Title must be under 500 characters")
    .trim(),
  description: z.string().max(5000).trim().optional(),
  locales: z
    .object({
      uiLocale: localeSchema.optional(),
      promptLocale: localeSchema.optional(),
      projectLocale: localeSchema.optional(),
      outputLocale: localeSchema.optional(),
      sourceLanguage: z.string().max(20).optional(),
    })
    .optional(),
});

const updateProjectSchema = createProjectSchema.partial().extend({
  status: z.enum(["draft", "active", "archived"]).optional(),
});

// ── Router ────────────────────────────────────────────────────

export function projectsRouter(db: DrizzleClient) {
  const router = new Hono<{ Variables: { userId: string } }>();

  // POST /projects
  router.post("/", zValidator("json", createProjectSchema), async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");

    const [project] = await db
      .insert(projects)
      .values({
        userId,
        title: body.title,
        description: body.description ?? null,
        uiLocale: body.locales?.uiLocale ?? "en",
        promptLocale: body.locales?.promptLocale ?? "en",
        projectLocale: body.locales?.projectLocale ?? "en",
        outputLocale: body.locales?.outputLocale ?? "en",
        sourceLanguage: body.locales?.sourceLanguage ?? "en",
      })
      .returning();

    if (!project) {
      return c.json({ success: false, error: { code: "CREATE_FAILED", message: "Failed to create project" } }, 500);
    }

    return c.json({ success: true, data: project }, 201);
  });

  // GET /projects
  router.get("/", async (c) => {
    const userId = c.get("userId");

    const userProjects = await db
      .select()
      .from(projects)
      .where(eq(projects.userId, userId))
      .orderBy(projects.updatedAt);

    return c.json({ success: true, data: userProjects });
  });

  // GET /projects/:id
  router.get("/:id", async (c) => {
    const userId = c.get("userId");
    const { id } = c.req.param();

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);

    if (!project) {
      return c.json({ success: false, error: { code: "NOT_FOUND", message: "Project not found" } }, 404);
    }

    // RLS enforces this at DB level too — belt-and-suspenders
    if (project.userId !== userId) {
      return c.json({ success: false, error: { code: "FORBIDDEN", message: "Access denied" } }, 403);
    }

    return c.json({ success: true, data: project });
  });

  // PATCH /projects/:id
  router.patch("/:id", zValidator("json", updateProjectSchema), async (c) => {
    const userId = c.get("userId");
    const { id } = c.req.param();
    const body = c.req.valid("json");

    const [existing] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!existing || existing.userId !== userId) {
      return c.json({ success: false, error: { code: "NOT_FOUND", message: "Project not found" } }, 404);
    }

    const [updated] = await db
      .update(projects)
      .set({
        ...(body.title !== undefined && { title: body.title }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.status !== undefined && { status: body.status }),
        ...(body.locales?.uiLocale !== undefined && { uiLocale: body.locales.uiLocale }),
        ...(body.locales?.outputLocale !== undefined && { outputLocale: body.locales.outputLocale }),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id))
      .returning();

    return c.json({ success: true, data: updated });
  });

  // DELETE /projects/:id (soft delete → archived)
  router.delete("/:id", async (c) => {
    const userId = c.get("userId");
    const { id } = c.req.param();

    const [existing] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!existing || existing.userId !== userId) {
      return c.json({ success: false, error: { code: "NOT_FOUND", message: "Project not found" } }, 404);
    }

    await db.update(projects).set({ status: "archived", updatedAt: new Date() }).where(eq(projects.id, id));

    return c.json({ success: true, data: { archived: true } });
  });

  return router;
}

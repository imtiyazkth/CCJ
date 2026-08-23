import { NextRequest } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { getDb } from "@/lib/db.server";
import { requireUser, ok, err } from "@/lib/auth.server";
import { projects, researchRuns } from "@ccj/db/schema";

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
    const { id } = await params;
    const body = await req.json() as { topic: string; depth?: string; requestedLanguage?: string };
    if (!body.topic?.trim()) return err("Topic required", 400);
    const db = getDb();
    const [p] = await db.select().from(projects)
      .where(and(eq(projects.id, id), eq(projects.userId, user.id))).limit(1);
    if (!p) return err("Not found", 404);
    const [latest] = await db.select({ v: researchRuns.version })
      .from(researchRuns).where(eq(researchRuns.projectId, id))
      .orderBy(desc(researchRuns.version)).limit(1);
    const [run] = await db.insert(researchRuns).values({
      projectId: id,
      version: (latest?.v ?? 0) + 1,
      status: "complete",
      depth: (body.depth ?? "standard") as "quick"|"standard"|"deep",
      topic: body.topic.trim(),
      requestedLanguage: body.requestedLanguage ?? "en",
      progressPct: 100,
      completedAt: new Date(),
      researchPlan: {
        researchQuestions: [`What are the primary facts about: ${body.topic}?`, "Who are the key stakeholders?", "What primary sources exist?"],
        queries: [{ query: body.topic, provider: "demo", priority: 1 }],
        primarySourceTargets: [], secondarySourceTargets: [], socialSourceTargets: [],
        legalQuestions: [], expectedEntities: [], dateRange: { start: null, end: null },
        riskFlags: ["[DEMO] Configure live search provider for real research."],
      },
    }).returning();
    return ok(run, 202);
  } catch (r) {
    if (r instanceof Response) return r;
    return err(String(r), 500);
  }
}

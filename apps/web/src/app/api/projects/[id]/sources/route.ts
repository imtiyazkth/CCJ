import { NextRequest } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { getDb } from "@/lib/db.server";
import { requireUser, ok, err } from "@/lib/auth.server";
import { projects, researchRuns, sources } from "@ccj/db/schema";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const db = getDb();
    const [p] = await db.select().from(projects)
      .where(and(eq(projects.id, id), eq(projects.userId, user.id))).limit(1);
    if (!p) return err("Not found", 404);
    const [run] = await db.select({ id: researchRuns.id }).from(researchRuns)
      .where(and(eq(researchRuns.projectId, id), eq(researchRuns.status, "complete")))
      .orderBy(desc(researchRuns.version)).limit(1);
    if (!run) return ok([]);
    const data = await db.select().from(sources).where(eq(sources.researchRunId, run.id));
    return ok(data);
  } catch (r) {
    if (r instanceof Response) return r;
    return err(String(r), 500);
  }
}

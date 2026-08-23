import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/lib/db.server";
import { requireUser, ok, err } from "@/lib/auth.server";
import { projects, evidence, sources, researchRuns } from "@ccj/db/schema";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const db = getDb();
    const [p] = await db.select().from(projects)
      .where(and(eq(projects.id, id), eq(projects.userId, user.id))).limit(1);
    if (!p) return err("Not found", 404);
    const rows = await db.select({ ev: evidence }).from(evidence)
      .innerJoin(sources, eq(evidence.sourceId, sources.id))
      .innerJoin(researchRuns, eq(sources.researchRunId, researchRuns.id))
      .where(eq(researchRuns.projectId, id));
    return ok(rows.map(r => r.ev));
  } catch (r) {
    if (r instanceof Response) return r;
    return err(String(r), 500);
  }
}

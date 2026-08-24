/**
 * CCJ Module 5 — Async Workflow Status Endpoint
 * GET /api/research/worker?runId=xxx
 * Returns current status + progress for a research run.
 * Frontend polls this every 2s to update UI.
 */
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db.server";
import { researchRuns } from "@ccj/db/schema";

export async function GET(req: NextRequest) {
  const runId = req.nextUrl.searchParams.get("runId");
  if (!runId) {
    return Response.json({ error: "runId required" }, { status: 400 });
  }
  try {
    const db = getDb();
    const [run] = await db.select({
      id:          researchRuns.id,
      status:      researchRuns.status,
      progressPct: researchRuns.progressPct,
      error:       researchRuns.error,
      completedAt: researchRuns.completedAt,
      researchPlan:researchRuns.researchPlan,
    }).from(researchRuns).where(eq(researchRuns.id, runId)).limit(1);

    if (!run) return Response.json({ error: "Run not found" }, { status: 404 });
    return Response.json({ success: true, data: run });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/lib/db.server";
import { requireUser, ok, err } from "@/lib/auth.server";
import { projects, claims } from "@ccj/db/schema";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const db = getDb();
    const [p] = await db.select().from(projects)
      .where(and(eq(projects.id, id), eq(projects.userId, user.id))).limit(1);
    if (!p) return err("Not found", 404);
    const data = await db.select().from(claims).where(eq(claims.projectId, id));
    return ok(data);
  } catch (r) {
    if (r instanceof Response) return r;
    return err(String(r), 500);
  }
}

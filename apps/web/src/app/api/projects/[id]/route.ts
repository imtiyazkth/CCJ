import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/lib/db.server";
import { requireUser, ok, err } from "@/lib/auth.server";
import { projects } from "@ccj/db/schema";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const db = getDb();
    const [project] = await db.select().from(projects)
      .where(and(eq(projects.id, id), eq(projects.userId, user.id)))
      .limit(1);
    if (!project) return err("Project not found", 404);
    return ok(project);
  } catch (r) {
    if (r instanceof Response) return r;
    return err(String(r), 500);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const body = await req.json() as Record<string, unknown>;
    const db = getDb();
    const [existing] = await db.select().from(projects)
      .where(and(eq(projects.id, id), eq(projects.userId, user.id))).limit(1);
    if (!existing) return err("Not found", 404);
    const [updated] = await db.update(projects).set({
      ...(body["title"]       ? { title: String(body["title"]) }             : {}),
      ...(body["description"] !== undefined ? { description: body["description"] as string | null } : {}),
      ...(body["status"]      ? { status: body["status"] as "draft" | "active" | "archived" } : {}),
      updatedAt: new Date(),
    }).where(eq(projects.id, id)).returning();
    return ok(updated);
  } catch (r) {
    if (r instanceof Response) return r;
    return err(String(r), 500);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const db = getDb();
    await db.update(projects)
      .set({ status: "archived", updatedAt: new Date() })
      .where(and(eq(projects.id, id), eq(projects.userId, user.id)));
    return ok({ archived: true });
  } catch (r) {
    if (r instanceof Response) return r;
    return err(String(r), 500);
  }
}

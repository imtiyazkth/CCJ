import { NextRequest } from "next/server";
import { eq, desc } from "drizzle-orm";
import { getDb } from "@/lib/db.server";
import { requireUser, ok, err } from "@/lib/auth.server";
import { projects } from "@ccj/db/schema";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const db = getDb();
    const data = await db.select().from(projects)
      .where(eq(projects.userId, user.id))
      .orderBy(desc(projects.updatedAt));
    return ok(data);
  } catch (r) {
    if (r instanceof Response) return r;
    return err(String(r), 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = await req.json() as {
      title: string; description?: string;
      locales?: { uiLocale?: string; promptLocale?: string; projectLocale?: string; outputLocale?: string; sourceLanguage?: string };
    };
    if (!body.title?.trim()) return err("Title is required", 400);
    const db = getDb();
    const [project] = await db.insert(projects).values({
      userId:        user.id,
      title:         body.title.trim(),
      description:   body.description ?? null,
      status:        "active",
      uiLocale:      body.locales?.uiLocale      ?? "en",
      promptLocale:  body.locales?.promptLocale  ?? "en",
      projectLocale: body.locales?.projectLocale ?? "en",
      outputLocale:  body.locales?.outputLocale  ?? "en",
      sourceLanguage:body.locales?.sourceLanguage ?? "en",
    }).returning();
    return ok(project, 201);
  } catch (r) {
    if (r instanceof Response) return r;
    return err(String(r), 500);
  }
}

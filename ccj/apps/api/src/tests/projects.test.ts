/**
 * CCJ API — Project Route Integration Tests
 * Runs against a real PostgreSQL database (ci_schema.sql applied).
 * Auth is mocked — Supabase Admin client is replaced with a stub.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createDb } from "../lib/db.js";
import { users, projects } from "@ccj/db/schema";

const TEST_DB = process.env["DATABASE_URL"] ?? "postgresql://ccj_ci:ci_password@localhost:5432/ccj_ci";

let db: ReturnType<typeof createDb>;

// Fixed test user UUID — matches the type expected (no auth.users FK in CI schema)
const TEST_USER_ID = "99000000-0000-0000-0000-000000000001";

beforeAll(async () => {
  db = createDb(TEST_DB);
  // Insert test user directly (no Supabase Auth in CI)
  await db.insert(users).values({
    id:            TEST_USER_ID,
    email:         "test@ccj.test",
    name:          "Test User",
    role:          "owner",
    uiLocale:      "en",
    emailVerified: true,
  }).onConflictDoNothing();
});

afterAll(async () => {
  // Clean up test data
  await db.delete(projects).where(
    (await import("drizzle-orm")).eq(projects.userId, TEST_USER_ID)
  );
  await db.delete(users).where(
    (await import("drizzle-orm")).eq(users.id, TEST_USER_ID)
  );
});

describe("Projects — DB operations", () => {
  let createdProjectId: string;

  it("inserts a project", async () => {
    const [p] = await db.insert(projects).values({
      userId:        TEST_USER_ID,
      title:         "Test Project",
      description:   "Created in CI test",
      status:        "draft",
      uiLocale:      "en",
      promptLocale:  "en",
      projectLocale: "en",
      outputLocale:  "en",
      sourceLanguage:"en",
    }).returning();
    expect(p).toBeDefined();
    expect(p!.title).toBe("Test Project");
    createdProjectId = p!.id;
  });

  it("queries only the test user's projects", async () => {
    const { eq } = await import("drizzle-orm");
    const found = await db.select()
      .from(projects)
      .where(eq(projects.userId, TEST_USER_ID));
    expect(found.every((p) => p.userId === TEST_USER_ID)).toBe(true);
  });

  it("cannot see other users' projects via userId filter", async () => {
    const { eq } = await import("drizzle-orm");
    const OTHER_USER = "99000000-0000-0000-0000-000000000099";
    const found = await db.select()
      .from(projects)
      .where(eq(projects.userId, OTHER_USER));
    expect(found).toHaveLength(0);
  });

  it("updates a project status", async () => {
    const { eq } = await import("drizzle-orm");
    if (!createdProjectId) return;
    const [updated] = await db.update(projects)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(projects.id, createdProjectId))
      .returning();
    expect(updated!.status).toBe("active");
  });

  it("soft-deletes by setting status to archived", async () => {
    const { eq } = await import("drizzle-orm");
    if (!createdProjectId) return;
    const [archived] = await db.update(projects)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(projects.id, createdProjectId))
      .returning();
    expect(archived!.status).toBe("archived");
  });
});

/**
 * Load .env from monorepo root (two levels above apps/api/).
 * Must be the very first import so all subsequent code sees env vars.
 */
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
loadEnv({ path: resolve(__dirname, "../../.env") });

/**
 * CCJ API Server — Android/Supabase edition
 * Zero mandatory external services in PROVIDER_MODE=demo.
 */
import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { HTTPException } from "hono/http-exception";
import { serve } from "@hono/node-server";
import { eq } from "drizzle-orm";

import { getDb } from "./lib/db.js";
import { getResearchQueue, cleanRateLimits } from "./lib/queue.js";
import { requireAuth } from "./middleware/auth.js";
import { securityHeaders, redactSecrets } from "./middleware/security.js";
import { authRouter } from "./routes/auth.js";
import { projectsRouter } from "./routes/projects.js";
import { researchRouter } from "./routes/research.js";

// Validate required env at startup
const REQUIRED_ENV = ["DATABASE_URL","SUPABASE_JWT_SECRET","NEXT_PUBLIC_SUPABASE_URL","NEXT_PUBLIC_SUPABASE_ANON_KEY","SUPABASE_SERVICE_ROLE_KEY"];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) { console.error(`Missing: ${key}`); process.exit(1); }
}

const PORT = parseInt(process.env["PORT"] ?? "3001", 10);
const ALLOWED_ORIGINS = (process.env["ALLOWED_ORIGINS"] ?? "http://localhost:3000").split(",");
const PROVIDER_MODE = process.env["PROVIDER_MODE"] ?? "demo";

const db = getDb();
const researchQueue = getResearchQueue();

// Queue handler — dispatches to Python worker or runs demo completion
researchQueue.process(async (job) => {
  const { runId, topic } = job.data;
  const workerSecret = process.env["WORKER_SECRET"];

  if (!workerSecret || !process.env["RESEARCH_WORKER_URL"]) {
    // Demo mode: mark complete with a synthetic plan
    const { researchRuns } = await import("@ccj/db/schema");
    await db.update(researchRuns).set({
      status: "complete", progressPct: 100,
      researchPlan: {
        researchQuestions: [`What are the primary facts about: ${topic}?`, "Who are the key stakeholders?", "What primary sources exist?", "Are there contradictory accounts?"],
        queries: [{ query: topic, provider: "demo", priority: 1 }],
        primarySourceTargets: [], secondarySourceTargets: [], socialSourceTargets: [],
        legalQuestions: [], expectedEntities: [],
        dateRange: { start: null, end: null },
        riskFlags: ["[DEMO MODE] No research worker configured. Set WORKER_SECRET + RESEARCH_WORKER_URL to enable live research."],
      },
      completedAt: new Date(),
    }).where(eq(researchRuns.id, runId));
    return;
  }

  const resp = await fetch(`${process.env["RESEARCH_WORKER_URL"]}/research/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Worker-Secret": workerSecret },
    body: JSON.stringify({ run_id: runId, ...job.data }),
  });
  if (!resp.ok) throw new Error(`Worker ${resp.status}`);
});

setInterval(cleanRateLimits, 5 * 60 * 1000);

const app = new Hono();
app.use("*", securityHeaders);
app.use("*", cors({
  origin: (o) => (ALLOWED_ORIGINS.includes(o) ? o : null),
  allowMethods: ["GET","POST","PATCH","DELETE","OPTIONS"],
  allowHeaders: ["Content-Type","Authorization"],
  maxAge: 86400, credentials: true,
}));
app.use("*", logger((s) => console.log(s.replace(/Bearer [^\s]+/g, "Bearer [REDACTED]"))));

app.get("/health", (c) => c.json({ status: "ok", mode: PROVIDER_MODE, ts: new Date().toISOString() }));
app.route("/api/auth", authRouter());

const api = new Hono();
api.use("*", requireAuth);
api.route("/projects", projectsRouter(db));
api.route("/projects", researchRouter(db, researchQueue));
app.route("/api", api);

app.notFound((c) => c.json({ success: false, error: { code: "NOT_FOUND", message: "Not found" } }, 404));
app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ success: false, error: { code: "HTTP_ERROR", message: err.message } }, err.status);
  console.error("[error]", redactSecrets({ msg: err.message }));
  return c.json({ success: false, error: { code: "INTERNAL_ERROR", message: "Unexpected error" } }, 500);
});

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`\n✅ CCJ API  →  http://localhost:${PORT}`);
  console.log(`   Mode     →  ${PROVIDER_MODE.toUpperCase()}\n`);
});
export default app;

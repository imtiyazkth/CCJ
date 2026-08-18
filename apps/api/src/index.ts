/**
 * CCJ API Server
 * Hono + TypeScript
 *
 * Security checklist:
 * ✅ No API keys in responses
 * ✅ JWT auth on all non-public routes
 * ✅ CORS restricted to allowed origins
 * ✅ Security headers on all responses
 * ✅ Rate limiting on auth + expensive routes
 * ✅ Request body size limit
 * ✅ RLS via PostgreSQL SET LOCAL
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { HTTPException } from "hono/http-exception";
import { serve } from "@hono/node-server";

import { createDb } from "./lib/db.js";
import { requireAuth } from "./middleware/auth.js";
import { securityHeaders, redactSecrets } from "./middleware/security.js";
import { authRouter } from "./routes/auth.js";
import { projectsRouter } from "./routes/projects.js";
import { researchRouter } from "./routes/research.js";
import { ProviderRegistry } from "./providers/interfaces.js";
import { SearXNGProvider } from "./providers/searxng.js";

// ── Validate required environment at startup ──────────────────

const REQUIRED_ENV = ["DATABASE_URL", "JWT_SECRET", "JWT_REFRESH_SECRET", "WORKER_SECRET"];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`❌ Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const PORT = parseInt(process.env["PORT"] ?? "3001", 10);
const ALLOWED_ORIGINS = (process.env["ALLOWED_ORIGINS"] ?? "http://localhost:3000").split(",");

// ── Database ──────────────────────────────────────────────────

const db = createDb(process.env["DATABASE_URL"]!);

// ── Provider Registry ─────────────────────────────────────────

const providers = new ProviderRegistry()
  .registerSearch(new SearXNGProvider());

// ── App ───────────────────────────────────────────────────────

const app = new Hono();

// Security headers on all responses
app.use("*", securityHeaders);

// CORS — explicit allowlist
app.use(
  "*",
  cors({
    origin: (origin) => (ALLOWED_ORIGINS.includes(origin) ? origin : null),
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86_400,
    credentials: true,
  })
);

// Structured request logging (secrets redacted at log layer)
app.use("*", logger((str, ...rest) => {
  // Redact Authorization header from logs
  const cleaned = str.replace(/Authorization: Bearer [^\s]+/g, "Authorization: Bearer [REDACTED]");
  console.log(cleaned, ...rest);
}));

// ── Health check (public) ─────────────────────────────────────

app.get("/health", (c) =>
  c.json({
    status: "ok",
    service: "ccj-api",
    timestamp: new Date().toISOString(),
  })
);

// ── Auth routes (public) ──────────────────────────────────────

app.route("/api/auth", authRouter(db));

// ── Protected routes ──────────────────────────────────────────

const api = new Hono<{ Variables: { userId: string; userEmail: string; userRole: string } }>();

api.use("*", requireAuth);

api.route("/projects", projectsRouter(db));
api.route("/projects", researchRouter(db));

app.route("/api", api);

// ── 404 ───────────────────────────────────────────────────────

app.notFound((c) =>
  c.json({ success: false, error: { code: "NOT_FOUND", message: "Endpoint not found" } }, 404)
);

// ── Error handler ─────────────────────────────────────────────

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json(
      { success: false, error: { code: "HTTP_ERROR", message: err.message } },
      err.status
    );
  }

  // Log full error server-side; return generic message to client
  console.error("[unhandled-error]", redactSecrets({ message: err.message, stack: err.stack ?? "" }));
  return c.json(
    { success: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } },
    500
  );
});

// ── Start ─────────────────────────────────────────────────────

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`✅ CCJ API running on http://localhost:${PORT}`);
});

export default app;

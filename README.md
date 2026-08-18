# CCJ — Content Creation Journey

> **Research-to-content operating system.** One idea → living research dossier → traceable content.

---

## What CCJ Is

CCJ takes a creator topic and produces a **living research dossier** — a structured, versioned, source-linked knowledge base. Every factual claim is traceable to its evidence chain. Content generated from the dossier inherits that provenance.

CCJ is **not a chatbot**. It is a research system with provenance, contradiction handling, source ranking, claim versioning, and multilingual support.

---

## Quick Start (Local Dev)

### Prerequisites
- Docker + Docker Compose
- Node.js ≥ 20 + pnpm ≥ 9
- Python ≥ 3.12

### 1. Clone and configure

```bash
git clone https://github.com/your-org/ccj.git
cd ccj
cp .env.example .env
# Edit .env and fill in all required values
```

### 2. Generate secrets

```bash
# JWT secrets
openssl rand -hex 64   # → JWT_SECRET
openssl rand -hex 64   # → JWT_REFRESH_SECRET
openssl rand -hex 32   # → WORKER_SECRET
```

### 3. Start infrastructure

```bash
docker compose up -d postgres redis qdrant searxng libretranslate
```

### 4. Run migrations + seed

```bash
pnpm install
pnpm db:migrate
pnpm db:seed
```

### 5. Start development servers

```bash
pnpm dev
```

- Web UI: http://localhost:3000
- API: http://localhost:3001
- Research Worker: http://localhost:8001
- SearXNG: http://localhost:8888

**Demo credentials:** `demo@ccj.local` / `Demo@CCJ2026!`

---

## Architecture

```
apps/
  web/          Next.js + React + TypeScript (UI)
  api/          Hono + TypeScript (BFF / API gateway)

packages/
  types/        Shared TypeScript domain types
  db/           Drizzle ORM schema + migrations
  i18n/         Locale bundles (en, hi, ar)

workers/
  research/     Python FastAPI (research agent)

docker/
  postgres/     Init SQL
  searxng/      Settings

.github/
  workflows/    CI (typecheck → lint → test → security scan → docker build)
```

## Vertical Slice (Implemented)

```
Idea → Research Plan → Search (SearXNG) → Fetch → Parse
     → Source Record → Evidence Extraction → Claim Generation
     → Dossier Card
```

## Next Increments (in order)

1. **Auth routes** — `/api/auth/login`, `/api/auth/refresh`
2. **Web UI** — Dashboard, New Project, Research Workspace pages
3. **LLM provider** — Ollama adapter for local AI planning + extraction
4. **PDF/document support** — Docling + OCRmyPDF worker
5. **YouTube adapter** — transcript extraction
6. **Translation** — LibreTranslate adapter
7. **Content Studio** — script, thread, carousel generation from dossier
8. **Contradiction analysis** — cross-claim comparison
9. **Timeline view** — chronological evidence display
10. **Live update agent** — re-research + diff against previous version

---

## Security Principles

- ✅ No API keys in browser/client code
- ✅ SSRF protection on all outbound URL fetches (both TS + Python)
- ✅ PostgreSQL Row-Level Security on all user data
- ✅ JWT auth with short-lived access tokens (15m) + refresh tokens (7d)
- ✅ Internal worker auth via shared secret
- ✅ Claims cannot be silently upgraded to `verified`
- ✅ Audit log for all source/evidence/claim changes
- ✅ IP anonymisation in audit log (first two octets only)
- ✅ Security headers (CSP, X-Frame-Options, etc.)
- ✅ Upload MIME validation + magic byte checking
- ✅ No execution of fetched/extracted content
- ✅ Secret redaction from logs

---

## Multilingual

CCJ is locale-driven from day one. Five locale dimensions are stored separately:

| Dimension | Purpose |
|-----------|---------|
| `uiLocale` | Application interface language |
| `promptLocale` | Language the user typed in (auto-detected) |
| `projectLocale` | Canonical project language |
| `outputLocale` | Language for generated content |
| `sourceLanguage` | Primary language of source material |

Supported: English (`en`), Hindi (`hi`), Arabic (`ar` — RTL).  
Adding a new language requires only a new locale JSON bundle.

---

## Architecture Decision Records

See [`docs/adr/`](./docs/adr/) for design rationale.

---

## License

Private — all rights reserved.

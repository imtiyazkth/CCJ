# CCJ on Android — Termux Setup Guide

> Zero-budget, zero-Docker local development on a single Android phone.

---

## What works locally on Android

| Feature | Status | Notes |
|---------|--------|-------|
| `pnpm dev` (API + Web) | ✅ | Node.js in Termux |
| Supabase Auth | ✅ | Free hosted |
| Supabase PostgreSQL | ✅ | Free hosted, via DATABASE_URL |
| Supabase Storage | ✅ | Free hosted, ccj-artifacts bucket |
| Demo search/AI/translation | ✅ | No external service |
| i18n (en/hi/ar) | ✅ | Bundled locale JSON |
| DB migrations (Drizzle) | ✅ | Against Supabase |
| DB seed (BCI/NALSAR demo) | ✅ | Runs once |
| GitHub Actions CI | ✅ | Runs on push |
| Python research worker | ⚠️ | Optional; runs in Termux with `pip` |
| Docker stack | ⏭️ | Deferred — for future VPS deployment |
| SearXNG / Brave / Tavily | ⏭️ | Deferred — add API key when ready |
| Qdrant vector DB | ⏭️ | Deferred — in-memory fallback active |
| LibreTranslate | ⏭️ | Deferred — demo translation active |
| Ollama (local LLM) | ⏭️ | Deferred — demo AI active |

---

## Step 1: Install Termux packages

```bash
# Update package list
pkg update -y && pkg upgrade -y

# Install Node.js (LTS), Python, Git, and build tools
pkg install -y nodejs-lts python git curl wget openssh

# Verify versions
node -v      # should be ≥ 20
python --version  # should be 3.11+
git --version
```

---

## Step 2: Install pnpm

```bash
# Install pnpm globally
npm install -g pnpm@9.15.0

# Verify
pnpm -v
```

---

## Step 3: Clone the repository

```bash
# Go to your working directory
cd ~

# Clone CCJ
git clone https://github.com/imtiyazkth/CCJ.git
cd CCJ
```

---

## Step 4: Create Supabase project (free)

1. Go to https://supabase.com → New project (free tier)
2. Note your project URL: `https://xxxx.supabase.co`
3. Go to **Settings → API**:
   - Copy `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - Copy `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`
   - Copy `JWT Secret` (under JWT Settings) → `SUPABASE_JWT_SECRET`
4. Go to **Settings → Database → Connection string → URI**:
   - Copy → `DATABASE_URL`

---

## Step 5: Configure environment

```bash
# In CCJ root directory
cp .env.example .env

# Edit with nano (Termux) — fill in only the required vars
nano .env
```

**Minimum required `.env` for Android dev:**
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhb...
SUPABASE_SERVICE_ROLE_KEY=eyJhb...
SUPABASE_JWT_SECRET=your-jwt-secret
DATABASE_URL=postgresql://postgres:[password]@db.your-project.supabase.co:5432/postgres
NEXT_PUBLIC_API_URL=http://localhost:3001
ALLOWED_ORIGINS=http://localhost:3000
PROVIDER_MODE=demo
NODE_ENV=development
```

---

## Step 6: Install dependencies

```bash
# From CCJ root
pnpm install
```

> First run takes ~3–5 minutes on mobile data. Subsequent installs use cache.

---

## Step 7: Run database migrations

```bash
pnpm db:migrate
```

This creates all tables in your Supabase PostgreSQL instance and applies RLS policies.

---

## Step 8: Seed demo data

```bash
CCJ_DEMO_PASSWORD=YourPassword123! pnpm db:seed
```

Creates:
- Demo user: `demo@ccj.local` / `Demo@CCJ2026!`
- Demo project: **BCI Chairman Letter vs NALSAR Students — 2026**
- Demo sources, evidence, claims, dossier card (all `is_demo=true`)

> ⚠ In Supabase, the demo user must also be created in Supabase Auth.
> Go to Supabase Dashboard → Authentication → Users → Add user:
> Email: `demo@ccj.local`, Password: `Demo@CCJ2026!`

---

## Step 9: Start development servers

Open **two Termux sessions** (swipe right in Termux to open a new session):

**Session 1 — API server:**
```bash
cd ~/CCJ
pnpm --filter @ccj/api dev
# → API running on http://localhost:3001
```

**Session 2 — Web server:**
```bash
cd ~/CCJ
pnpm --filter @ccj/web dev
# → Web running on http://localhost:3000
```

> Access the app at **http://localhost:3000** in your Android browser.
> Use Chrome or Firefox — avoid WebView-only browsers.

---

## Step 10: Run i18n check

```bash
node scripts/check-i18n.mjs
# ✅ i18n check passed — all 3 locales consistent.
```

---

## Git workflow

```bash
# Check status
git status

# Stage all changes
git add -A

# Commit
git commit -m "feat: your message here"

# Push — triggers GitHub Actions CI automatically
git push origin main
```

---

## Running tests

```bash
# TypeScript type-check
pnpm typecheck

# API unit tests
pnpm --filter @ccj/api test

# Python worker (if installed)
cd workers/research
pip install pytest pytest-asyncio
pytest tests/ -v
```

---

## Optional: Python research worker in Termux

```bash
# Install Python deps
pkg install -y python-pip
cd ~/CCJ/workers/research
pip install -r requirements.txt

# Run worker (separate Termux session)
uvicorn app.main:app --host 0.0.0.0 --port 8001

# Set WORKER_SECRET in .env and add to session:
export WORKER_SECRET=your_secret
```

---

## Termux tips for Android development

```bash
# Keep Termux running when phone sleeps (acquire wake lock)
termux-wake-lock

# Check available RAM
free -h

# Check storage
df -h

# If Node.js runs out of memory, set limit
export NODE_OPTIONS="--max-old-space-size=512"

# Open a browser from Termux (Android)
termux-open-url http://localhost:3000

# Share localhost with another device on same WiFi
# (find your phone's IP first)
ip addr show wlan0 | grep 'inet '
# Then visit http://YOUR_PHONE_IP:3000 on another device
```

---

## Environment variables — full reference

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | — | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | — | Supabase anon key (browser-safe) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | — | Supabase service role (API only) |
| `SUPABASE_JWT_SECRET` | ✅ | — | JWT verification in API middleware |
| `DATABASE_URL` | ✅ | — | Supabase PostgreSQL connection string |
| `PROVIDER_MODE` | ✅ | `demo` | `demo` or `live` |
| `NEXT_PUBLIC_API_URL` | ✅ | `http://localhost:3001` | API URL for web app |
| `ALLOWED_ORIGINS` | ✅ | `http://localhost:3000` | CORS allowed origins |
| `CCJ_DEMO_PASSWORD` | ✅ seed | — | Password for demo@ccj.local (min 8 chars) |
| `WORKER_SECRET` | ⚪ | — | Only needed if running Python worker |
| `OPENAI_API_KEY` | ⚪ | — | Live AI — never in browser |
| `ANTHROPIC_API_KEY` | ⚪ | — | Live AI — never in browser |
| `BRAVE_SEARCH_API_KEY` | ⚪ | — | Live search |
| `SEARXNG_URL` | ⚪ | — | Self-hosted SearXNG |
| `LIBRETRANSLATE_URL` | ⚪ | — | Self-hosted translation |
| `QDRANT_URL` | ⚪ | — | Vector DB (in-memory fallback active) |

---

## What is intentionally deferred

| Feature | Reason | When to add |
|---------|--------|-------------|
| Docker Compose stack | Not available in Termux | VPS deployment |
| SearXNG self-hosted | Needs Docker / VPS | When deploying full stack |
| Qdrant vector DB | Needs persistent process | When needed for semantic search |
| LibreTranslate | Needs Docker / 1GB+ RAM | When translation quality matters |
| Ollama local LLM | Needs 4GB+ RAM | Not viable on most phones |
| Redis | In-memory fallback covers dev | VPS deployment |
| Deployment | No VPS budget yet | Future increment |
| Content Studio | Depends on LLM provider | Next increment after live AI |
| YouTube transcript | Needs API key | When ready to add |
| GDELT / NewsAPI | Needs API keys | When ready to add |

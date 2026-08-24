-- ═══════════════════════════════════════════════════════════════
-- CCJ — Complete Initial Migration
-- Target: Supabase PostgreSQL (public schema)
--
-- Assumes:
--   • auth schema exists (Supabase managed)
--   • auth.users table exists (Supabase Auth)
--   • Running as a role with CREATE privilege on public schema
--
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE throughout.
--
-- Order:
--   1. Extensions
--   2. Enums
--   3. Tables (dependency order)
--   4. Indexes
--   5. Functions
--   6. Triggers
--   7. RLS enable
--   8. RLS policies
--   9. Auth sync trigger (Supabase only)
-- ═══════════════════════════════════════════════════════════════

-- ── 1. EXTENSIONS ────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── 2. ENUMS ─────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.user_role AS ENUM ('owner', 'editor', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.project_status AS ENUM ('draft', 'active', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.research_depth AS ENUM ('quick', 'standard', 'deep');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.research_run_status AS ENUM (
    'pending', 'planning', 'searching', 'fetching',
    'extracting', 'analysing', 'complete', 'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.source_type AS ENUM (
    'webpage', 'pdf', 'video', 'news', 'social',
    'legal_document', 'official_statement', 'academic', 'user_upload'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.credibility_tier AS ENUM (
    'primary', 'verified', 'credible', 'reported', 'unknown', 'disputed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.access_method AS ENUM (
    'public_web', 'rss', 'user_upload', 'api', 'youtube'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.claim_type AS ENUM (
    'fact', 'reported', 'opinion', 'analysis',
    'legal_interpretation', 'inference', 'statistic'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.claim_status AS ENUM (
    'verified', 'strongly_correlated', 'reported',
    'disputed', 'unverified', 'opinion', 'inference', 'outdated'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.dossier_card_type AS ENUM (
    'summary', 'timeline', 'contradiction', 'gap',
    'legal', 'source_analysis', 'key_claim'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.audit_action AS ENUM (
    'create', 'update', 'delete', 'import', 'export',
    'translate', 'verify', 'dispute'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3. TABLES ────────────────────────────────────────────────

-- users
-- id is the Supabase Auth UUID — NOT generated here.
-- Populated by the auth sync trigger (section 9).
CREATE TABLE IF NOT EXISTS public.users (
  id             UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email          VARCHAR(320)   NOT NULL UNIQUE,
  name           VARCHAR(255)   NOT NULL,
  role           public.user_role NOT NULL DEFAULT 'owner',
  ui_locale      VARCHAR(10)    NOT NULL DEFAULT 'en',
  email_verified BOOLEAN        NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.users IS
  'User profiles. id == auth.users.id. No passwords stored here.';

-- projects
CREATE TABLE IF NOT EXISTS public.projects (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title          VARCHAR(500) NOT NULL,
  description    TEXT,
  status         public.project_status NOT NULL DEFAULT 'draft',
  ui_locale      VARCHAR(10) NOT NULL DEFAULT 'en',
  prompt_locale  VARCHAR(10) NOT NULL DEFAULT 'en',
  project_locale VARCHAR(10) NOT NULL DEFAULT 'en',
  output_locale  VARCHAR(10) NOT NULL DEFAULT 'en',
  source_language VARCHAR(20) NOT NULL DEFAULT 'en',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- research_runs
CREATE TABLE IF NOT EXISTS public.research_runs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  version            INTEGER NOT NULL DEFAULT 1,
  status             public.research_run_status NOT NULL DEFAULT 'pending',
  depth              public.research_depth NOT NULL DEFAULT 'standard',
  topic              TEXT NOT NULL,
  date_range_start   TIMESTAMPTZ,
  date_range_end     TIMESTAMPTZ,
  requested_language VARCHAR(10) NOT NULL DEFAULT 'en',
  research_plan      JSONB,
  progress_pct       SMALLINT NOT NULL DEFAULT 0
                       CONSTRAINT progress_pct_range CHECK (progress_pct BETWEEN 0 AND 100),
  error              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at       TIMESTAMPTZ
);

-- sources
CREATE TABLE IF NOT EXISTS public.sources (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  research_run_id      UUID NOT NULL REFERENCES public.research_runs(id) ON DELETE CASCADE,
  url                  TEXT NOT NULL,
  canonical_url        TEXT NOT NULL,
  domain               VARCHAR(255) NOT NULL,
  title                TEXT NOT NULL,
  author               TEXT,
  published_at         TIMESTAMPTZ,
  retrieved_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  language             VARCHAR(10) NOT NULL DEFAULT 'en',
  source_type          public.source_type NOT NULL,
  credibility_tier     public.credibility_tier NOT NULL DEFAULT 'unknown',
  access_method        public.access_method NOT NULL,
  content_hash         VARCHAR(64) NOT NULL,
  raw_artifact_id      TEXT,
  extracted_artifact_id TEXT,
  is_demo              BOOLEAN NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- evidence
CREATE TABLE IF NOT EXISTS public.evidence (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id           UUID NOT NULL REFERENCES public.sources(id) ON DELETE CASCADE,
  page_number         INTEGER,
  section             TEXT,
  quote               TEXT NOT NULL,
  coordinates         JSONB,
  captured_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confidence          REAL NOT NULL DEFAULT 1.0
                        CONSTRAINT confidence_range CHECK (confidence BETWEEN 0 AND 1),
  language            VARCHAR(10) NOT NULL DEFAULT 'en',
  extraction_warnings TEXT[] NOT NULL DEFAULT '{}',
  is_demo             BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- claims
CREATE TABLE IF NOT EXISTS public.claims (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  claim_text        TEXT NOT NULL,
  claim_type        public.claim_type NOT NULL,
  status            public.claim_status NOT NULL DEFAULT 'unverified',
  confidence        REAL NOT NULL DEFAULT 0.0
                      CONSTRAINT claim_confidence_range CHECK (confidence BETWEEN 0 AND 1),
  reasoning_summary TEXT,
  what_is_missing   TEXT,
  is_demo           BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- claim_evidence (junction)
CREATE TABLE IF NOT EXISTS public.claim_evidence (
  claim_id          UUID NOT NULL REFERENCES public.claims(id) ON DELETE CASCADE,
  evidence_id       UUID NOT NULL REFERENCES public.evidence(id) ON DELETE CASCADE,
  relationship_type VARCHAR(20) NOT NULL DEFAULT 'supports',
  PRIMARY KEY (claim_id, evidence_id)
);

-- dossier_cards
CREATE TABLE IF NOT EXISTS public.dossier_cards (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  research_run_id UUID NOT NULL REFERENCES public.research_runs(id) ON DELETE CASCADE,
  card_type       public.dossier_card_type NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  claim_ids       UUID[] NOT NULL DEFAULT '{}',
  source_ids      UUID[] NOT NULL DEFAULT '{}',
  evidence_ids    UUID[] NOT NULL DEFAULT '{}',
  locale          VARCHAR(10) NOT NULL DEFAULT 'en',
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- audit_log
CREATE TABLE IF NOT EXISTS public.audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES public.users(id) ON DELETE SET NULL,
  resource_type VARCHAR(100) NOT NULL,
  resource_id   UUID NOT NULL,
  action        public.audit_action NOT NULL,
  diff          JSONB,
  ip_address    VARCHAR(50),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 4. INDEXES ───────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx         ON public.users(email);
CREATE        INDEX IF NOT EXISTS projects_user_id_idx    ON public.projects(user_id);
CREATE        INDEX IF NOT EXISTS runs_project_id_idx     ON public.research_runs(project_id);
CREATE        INDEX IF NOT EXISTS sources_run_id_idx      ON public.sources(research_run_id);
CREATE        INDEX IF NOT EXISTS sources_hash_idx        ON public.sources(content_hash);
CREATE        INDEX IF NOT EXISTS evidence_source_id_idx  ON public.evidence(source_id);
CREATE        INDEX IF NOT EXISTS claims_project_id_idx   ON public.claims(project_id);
CREATE        INDEX IF NOT EXISTS dossier_project_id_idx  ON public.dossier_cards(project_id);
CREATE        INDEX IF NOT EXISTS audit_resource_idx      ON public.audit_log(resource_type, resource_id);
CREATE        INDEX IF NOT EXISTS audit_user_idx          ON public.audit_log(user_id);
CREATE        INDEX IF NOT EXISTS audit_created_at_idx    ON public.audit_log(created_at);

-- ── 5. FUNCTIONS ─────────────────────────────────────────────

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- RLS helper: returns current app user ID from session variable
CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_user_id', TRUE), '')::uuid
$$;

-- ── 6. TRIGGERS ──────────────────────────────────────────────

DROP TRIGGER IF EXISTS users_updated_at    ON public.users;
DROP TRIGGER IF EXISTS projects_updated_at ON public.projects;
DROP TRIGGER IF EXISTS claims_updated_at   ON public.claims;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER claims_updated_at
  BEFORE UPDATE ON public.claims
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 7. ROW-LEVEL SECURITY ────────────────────────────────────

ALTER TABLE public.users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_runs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sources         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claims          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claim_evidence  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dossier_cards   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log       ENABLE ROW LEVEL SECURITY;

-- ── 8. RLS POLICIES ──────────────────────────────────────────
-- Two supported auth paths:
--   A. Supabase JWT → auth.uid() is set automatically
--   B. Direct Drizzle → SET LOCAL app.current_user_id = '<uuid>'
-- Policies accept either.

CREATE OR REPLACE FUNCTION public.ccj_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    auth.uid(),                                                -- Supabase JWT path
    NULLIF(current_setting('app.current_user_id', TRUE), '')::uuid  -- Direct path
  )
$$;

-- Drop and recreate policies (safe: CREATE OR REPLACE not available for policies)
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- users: own profile only
CREATE POLICY users_self ON public.users
  FOR ALL USING (id = public.ccj_user_id());

-- projects: owner only
CREATE POLICY projects_owner ON public.projects
  FOR ALL USING (user_id = public.ccj_user_id());

-- research_runs: via project ownership
CREATE POLICY runs_owner ON public.research_runs
  FOR ALL USING (
    project_id IN (
      SELECT id FROM public.projects WHERE user_id = public.ccj_user_id()
    )
  );

-- sources: via run → project
CREATE POLICY sources_owner ON public.sources
  FOR ALL USING (
    research_run_id IN (
      SELECT id FROM public.research_runs
      WHERE project_id IN (
        SELECT id FROM public.projects WHERE user_id = public.ccj_user_id()
      )
    )
  );

-- evidence: via source → run → project
CREATE POLICY evidence_owner ON public.evidence
  FOR ALL USING (
    source_id IN (
      SELECT id FROM public.sources
      WHERE research_run_id IN (
        SELECT id FROM public.research_runs
        WHERE project_id IN (
          SELECT id FROM public.projects WHERE user_id = public.ccj_user_id()
        )
      )
    )
  );

-- claims: via project
CREATE POLICY claims_owner ON public.claims
  FOR ALL USING (
    project_id IN (SELECT id FROM public.projects WHERE user_id = public.ccj_user_id())
  );

-- claim_evidence: via claim → project
CREATE POLICY claim_evidence_owner ON public.claim_evidence
  FOR ALL USING (
    claim_id IN (
      SELECT id FROM public.claims
      WHERE project_id IN (
        SELECT id FROM public.projects WHERE user_id = public.ccj_user_id()
      )
    )
  );

-- dossier_cards: via project
CREATE POLICY dossier_owner ON public.dossier_cards
  FOR ALL USING (
    project_id IN (SELECT id FROM public.projects WHERE user_id = public.ccj_user_id())
  );

-- audit_log: read own entries; writes are service-role only
CREATE POLICY audit_log_read ON public.audit_log
  FOR SELECT USING (user_id = public.ccj_user_id());

-- ── 9. AUTH SYNC TRIGGER (Supabase only) ─────────────────────
-- Fires when a new user signs up via Supabase Auth.
-- Creates (or updates) the public.users profile automatically.
-- This means the seed/API never need to insert into public.users directly.

CREATE OR REPLACE FUNCTION public.handle_auth_user_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER           -- runs as the function owner, not the caller
SET search_path = public   -- prevent search_path injection
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    INSERT INTO public.users (id, email, name, email_verified, updated_at)
    VALUES (
      NEW.id,
      NEW.email,
      COALESCE(
        NEW.raw_user_meta_data->>'name',
        split_part(NEW.email, '@', 1)
      ),
      NEW.email_confirmed_at IS NOT NULL,
      NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      email          = EXCLUDED.email,
      name           = COALESCE(
                         NEW.raw_user_meta_data->>'name',
                         EXCLUDED.name
                       ),
      email_verified = NEW.email_confirmed_at IS NOT NULL,
      updated_at     = NOW();
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    -- Cascade is handled by FK ON DELETE CASCADE
    RETURN OLD;
  END IF;
END;
$$;

-- Trigger on auth.users (Supabase managed table)
-- Safe: CREATE OR REPLACE TRIGGER requires PG 14+; use DROP+CREATE
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_change();

-- ── VERIFICATION QUERY ────────────────────────────────────────
-- Run after migration to confirm all tables exist:
--
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' ORDER BY table_name;
--
-- Expected: audit_log, claim_evidence, claims, dossier_cards,
--           evidence, projects, research_runs, sources, users

-- ── Research Memory Table (Module 4) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.research_memories (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  entity_id      TEXT NOT NULL,
  entity_name    TEXT NOT NULL,
  intent         TEXT,
  summary        TEXT NOT NULL,
  key_facts      JSONB,
  query_history  TEXT[] NOT NULL DEFAULT '{}',
  claim_ids      UUID[] NOT NULL DEFAULT '{}',
  source_ids     UUID[] NOT NULL DEFAULT '{}',
  run_count      INTEGER NOT NULL DEFAULT 1,
  last_updated   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS memory_project_entity_idx
  ON public.research_memories(project_id, entity_id);

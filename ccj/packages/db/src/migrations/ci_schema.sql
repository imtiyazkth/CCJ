-- ═══════════════════════════════════════════════════════════════
-- CCJ CI Schema — Vanilla PostgreSQL 16
-- Used by GitHub Actions for API unit/integration tests.
-- NO reference to auth.users or the Supabase auth schema.
-- public.users.id is a self-contained UUID here.
--
-- Production migration: packages/db/src/migrations/0000_initial.sql
-- ═══════════════════════════════════════════════════════════════

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. ENUMS

DO $$ BEGIN CREATE TYPE public.user_role AS ENUM ('owner','editor','viewer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.project_status AS ENUM ('draft','active','archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.research_depth AS ENUM ('quick','standard','deep');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.research_run_status AS ENUM (
  'pending','planning','searching','fetching','extracting','analysing','complete','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.source_type AS ENUM (
  'webpage','pdf','video','news','social','legal_document',
  'official_statement','academic','user_upload');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.credibility_tier AS ENUM (
  'primary','verified','credible','reported','unknown','disputed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.access_method AS ENUM (
  'public_web','rss','user_upload','api','youtube');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.claim_type AS ENUM (
  'fact','reported','opinion','analysis','legal_interpretation','inference','statistic');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.claim_status AS ENUM (
  'verified','strongly_correlated','reported','disputed',
  'unverified','opinion','inference','outdated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.dossier_card_type AS ENUM (
  'summary','timeline','contradiction','gap','legal','source_analysis','key_claim');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.audit_action AS ENUM (
  'create','update','delete','import','export','translate','verify','dispute');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. TABLES (dependency order)

-- users: standalone in CI — no auth.users FK
CREATE TABLE IF NOT EXISTS public.users (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email          VARCHAR(320) NOT NULL UNIQUE,
  name           VARCHAR(255) NOT NULL,
  role           public.user_role NOT NULL DEFAULT 'owner',
  ui_locale      VARCHAR(10)  NOT NULL DEFAULT 'en',
  email_verified BOOLEAN      NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.projects (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title          VARCHAR(500) NOT NULL,
  description    TEXT,
  status         public.project_status NOT NULL DEFAULT 'draft',
  ui_locale      VARCHAR(10)  NOT NULL DEFAULT 'en',
  prompt_locale  VARCHAR(10)  NOT NULL DEFAULT 'en',
  project_locale VARCHAR(10)  NOT NULL DEFAULT 'en',
  output_locale  VARCHAR(10)  NOT NULL DEFAULT 'en',
  source_language VARCHAR(20) NOT NULL DEFAULT 'en',
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.research_runs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  version            INTEGER     NOT NULL DEFAULT 1,
  status             public.research_run_status NOT NULL DEFAULT 'pending',
  depth              public.research_depth NOT NULL DEFAULT 'standard',
  topic              TEXT        NOT NULL,
  date_range_start   TIMESTAMPTZ,
  date_range_end     TIMESTAMPTZ,
  requested_language VARCHAR(10) NOT NULL DEFAULT 'en',
  research_plan      JSONB,
  progress_pct       SMALLINT    NOT NULL DEFAULT 0
                       CONSTRAINT progress_range CHECK (progress_pct BETWEEN 0 AND 100),
  error              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at       TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.sources (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  research_run_id       UUID NOT NULL REFERENCES public.research_runs(id) ON DELETE CASCADE,
  url                   TEXT NOT NULL,
  canonical_url         TEXT NOT NULL,
  domain                VARCHAR(255) NOT NULL,
  title                 TEXT NOT NULL,
  author                TEXT,
  published_at          TIMESTAMPTZ,
  retrieved_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  language              VARCHAR(10) NOT NULL DEFAULT 'en',
  source_type           public.source_type NOT NULL,
  credibility_tier      public.credibility_tier NOT NULL DEFAULT 'unknown',
  access_method         public.access_method NOT NULL,
  content_hash          VARCHAR(64) NOT NULL,
  raw_artifact_id       TEXT,
  extracted_artifact_id TEXT,
  is_demo               BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS public.claims (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  claim_text        TEXT NOT NULL,
  claim_type        public.claim_type NOT NULL,
  status            public.claim_status NOT NULL DEFAULT 'unverified',
  confidence        REAL NOT NULL DEFAULT 0.0
                      CONSTRAINT claim_confidence CHECK (confidence BETWEEN 0 AND 1),
  reasoning_summary TEXT,
  what_is_missing   TEXT,
  is_demo           BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.claim_evidence (
  claim_id          UUID NOT NULL REFERENCES public.claims(id) ON DELETE CASCADE,
  evidence_id       UUID NOT NULL REFERENCES public.evidence(id) ON DELETE CASCADE,
  relationship_type VARCHAR(20) NOT NULL DEFAULT 'supports',
  PRIMARY KEY (claim_id, evidence_id)
);

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

-- 4. INDEXES

CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx        ON public.users(email);
CREATE        INDEX IF NOT EXISTS projects_user_id_idx   ON public.projects(user_id);
CREATE        INDEX IF NOT EXISTS runs_project_id_idx    ON public.research_runs(project_id);
CREATE        INDEX IF NOT EXISTS sources_run_id_idx     ON public.sources(research_run_id);
CREATE        INDEX IF NOT EXISTS sources_hash_idx       ON public.sources(content_hash);
CREATE        INDEX IF NOT EXISTS evidence_source_id_idx ON public.evidence(source_id);
CREATE        INDEX IF NOT EXISTS claims_project_id_idx  ON public.claims(project_id);
CREATE        INDEX IF NOT EXISTS dossier_project_id_idx ON public.dossier_cards(project_id);
CREATE        INDEX IF NOT EXISTS audit_resource_idx     ON public.audit_log(resource_type, resource_id);
CREATE        INDEX IF NOT EXISTS audit_user_idx         ON public.audit_log(user_id);
CREATE        INDEX IF NOT EXISTS audit_ts_idx           ON public.audit_log(created_at);

-- 5. FUNCTIONS AND TRIGGERS

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

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

-- 6. RLS — DISABLED in CI
-- In CI, tests run as a superuser with no JWT context.
-- Application-level authorization (userId checks in WHERE clauses)
-- is tested instead. RLS is only enforced in production (Supabase).
--
-- See docs/architecture/rls-vs-app-auth.md for the full design decision.

-- 7. VERIFICATION
-- Run after applying: SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' ORDER BY table_name;
-- Expected: audit_log, claim_evidence, claims, dossier_cards,
--           evidence, projects, research_runs, sources, users

-- CCJ Initial Migration
-- Drizzle ORM generates the CREATE TABLE statements.
-- This file adds: RLS policies, triggers, and indexes beyond Drizzle.

-- ── Enable Row-Level Security on all user-data tables ─────────

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE dossier_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- ── RLS Policies ──────────────────────────────────────────────
-- App connects as role "ccj_app" (least privilege).
-- Users can only see their own projects.

-- Set app_user_id at the start of each request:
--   SET LOCAL app.current_user_id = '<uuid>';

CREATE OR REPLACE FUNCTION current_app_user_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_user_id', TRUE), '')::uuid
$$;

-- projects: owner only
CREATE POLICY projects_owner ON projects
  FOR ALL USING (user_id = current_app_user_id());

-- research_runs: through project ownership
CREATE POLICY research_runs_owner ON research_runs
  FOR ALL USING (
    project_id IN (SELECT id FROM projects WHERE user_id = current_app_user_id())
  );

-- sources: through research_run → project ownership
CREATE POLICY sources_owner ON sources
  FOR ALL USING (
    research_run_id IN (
      SELECT id FROM research_runs
      WHERE project_id IN (SELECT id FROM projects WHERE user_id = current_app_user_id())
    )
  );

-- evidence: through source → run → project
CREATE POLICY evidence_owner ON evidence
  FOR ALL USING (
    source_id IN (
      SELECT id FROM sources
      WHERE research_run_id IN (
        SELECT id FROM research_runs
        WHERE project_id IN (SELECT id FROM projects WHERE user_id = current_app_user_id())
      )
    )
  );

-- claims: through project
CREATE POLICY claims_owner ON claims
  FOR ALL USING (
    project_id IN (SELECT id FROM projects WHERE user_id = current_app_user_id())
  );

-- claim_evidence: through claims
CREATE POLICY claim_evidence_owner ON claim_evidence
  FOR ALL USING (
    claim_id IN (
      SELECT id FROM claims
      WHERE project_id IN (SELECT id FROM projects WHERE user_id = current_app_user_id())
    )
  );

-- dossier_cards: through project
CREATE POLICY dossier_cards_owner ON dossier_cards
  FOR ALL USING (
    project_id IN (SELECT id FROM projects WHERE user_id = current_app_user_id())
  );

-- audit_log: users can read their own entries; write is superuser/app only
CREATE POLICY audit_log_read ON audit_log
  FOR SELECT USING (user_id = current_app_user_id());

-- ── updated_at triggers ───────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER claims_updated_at
  BEFORE UPDATE ON claims
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── App role (least privilege) ────────────────────────────────
-- Run once as superuser:
-- CREATE ROLE ccj_app LOGIN PASSWORD '<strong>';
-- GRANT CONNECT ON DATABASE ccj_dev TO ccj_app;
-- GRANT USAGE ON SCHEMA public TO ccj_app;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ccj_app;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ccj_app;
-- Note: ccj_app cannot ALTER TABLE or DROP — migrations run as superuser.

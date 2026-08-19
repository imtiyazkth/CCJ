-- CCJ PostgreSQL Initialization
-- Runs once when the container is first created.
-- Creates the least-privilege application role.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ccj_app') THEN
    CREATE ROLE ccj_app LOGIN PASSWORD 'change_me_app_role_password';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE ccj_dev TO ccj_app;
GRANT USAGE ON SCHEMA public TO ccj_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ccj_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ccj_app;

-- Future tables will also need this grant
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ccj_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO ccj_app;

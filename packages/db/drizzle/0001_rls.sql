-- Row-level security: the second line of defense for tenant isolation (ADR 003).
-- The web app connects as fieldops_app, which is subject to these policies. Migrations, the seed and the
-- worker connect as the table owner, which bypasses them. Each request sets app.org_id inside its transaction.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fieldops_app') THEN
    CREATE ROLE fieldops_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO fieldops_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fieldops_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fieldops_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fieldops_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO fieldops_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_current_org() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;
--> statement-breakpoint
ALTER TABLE "org_counter" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "org_counter" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "service_type" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "service_type" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "customer" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "customer" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "contact" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "contact" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "site" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "site" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "equipment" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "equipment" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "job" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "job" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "job_assignment" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "job_assignment" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "checklist_item" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "checklist_item" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "job_event" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "job_event" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "note" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "note" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "attachment" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "attachment" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "idempotency_key" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "idempotency_key" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());

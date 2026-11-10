CREATE TABLE "ai_interaction" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"job_id" uuid,
	"feature" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"stop_reason" text,
	"outcome" text NOT NULL,
	"output" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preference" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"event" text NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	"email" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preference_organization_id_user_id_event_pk" PRIMARY KEY("organization_id","user_id","event")
);
--> statement-breakpoint
CREATE TABLE "portal_session" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "portal_token" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limit_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "sla_alert" (
	"organization_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"target" text NOT NULL,
	"kind" text NOT NULL,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sla_alert_organization_id_job_id_target_kind_pk" PRIMARY KEY("organization_id","job_id","target","kind")
);
--> statement-breakpoint
CREATE TABLE "sla_policy" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"priority" text NOT NULL,
	"response_min" integer NOT NULL,
	"resolution_min" integer NOT NULL,
	"business_hours" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "ai_status" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "sla_policy_id" uuid;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "response_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "resolution_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "response_at_risk_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "resolution_at_risk_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "sla_response_state" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "sla_resolution_state" text;--> statement-breakpoint
ALTER TABLE "ai_interaction" ADD CONSTRAINT "ai_interaction_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_interaction" ADD CONSTRAINT "ai_interaction_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_interaction" ADD CONSTRAINT "ai_interaction_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_session" ADD CONSTRAINT "portal_session_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_session" ADD CONSTRAINT "portal_session_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_session" ADD CONSTRAINT "portal_session_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_token" ADD CONSTRAINT "portal_token_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_token" ADD CONSTRAINT "portal_token_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_alert" ADD CONSTRAINT "sla_alert_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_alert" ADD CONSTRAINT "sla_alert_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_policy" ADD CONSTRAINT "sla_policy_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_interaction_org_created_idx" ON "ai_interaction" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_interaction_org_job_idx" ON "ai_interaction" USING btree ("organization_id","job_id");--> statement-breakpoint
CREATE INDEX "audit_log_org_created_idx" ON "audit_log" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_org_entity_idx" ON "audit_log" USING btree ("organization_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_org_actor_idx" ON "audit_log" USING btree ("organization_id","actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_org_user_idx" ON "notification" USING btree ("organization_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_org_user_unread_idx" ON "notification" USING btree ("organization_id","user_id") WHERE read_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "portal_session_org_hash_uq" ON "portal_session" USING btree ("organization_id","token_hash");--> statement-breakpoint
CREATE INDEX "portal_session_org_contact_idx" ON "portal_session" USING btree ("organization_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_token_org_hash_uq" ON "portal_token" USING btree ("organization_id","token_hash");--> statement-breakpoint
CREATE INDEX "portal_token_org_contact_idx" ON "portal_token" USING btree ("organization_id","contact_id");--> statement-breakpoint
CREATE INDEX "sla_alert_org_raised_idx" ON "sla_alert" USING btree ("organization_id","raised_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sla_policy_org_priority_uq" ON "sla_policy" USING btree ("organization_id","priority");--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_sla_policy_id_sla_policy_id_fk" FOREIGN KEY ("sla_policy_id") REFERENCES "public"."sla_policy"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_org_resolution_due_idx" ON "job" USING btree ("organization_id","resolution_due_at");--> statement-breakpoint
CREATE INDEX "job_org_ai_status_idx" ON "job" USING btree ("organization_id","ai_status") WHERE ai_status = 'pending';--> statement-breakpoint
-- Row-level security for the 0.3 tenant tables (same policy as migrations 0001 and 0002, ADR 003).
ALTER TABLE "sla_policy" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "sla_policy" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "sla_alert" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "sla_alert" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "notification" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "notification" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "notification_preference" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "notification_preference" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "portal_token" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "portal_token" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "portal_session" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "portal_session" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "ai_interaction" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "ai_interaction" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
-- Audit log (AUD-01, AUD-02, ADR 016). The runtime role can only read it, scoped to its organization. Rows are
-- written by SECURITY DEFINER functions: the audit_row() trigger and audit_event() for things that aren't a row
-- change (sign-ins).
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "audit_log" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "audit_log" FROM fieldops_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_row() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  -- TG_ARGV[0]: the column holding the organization id; the rest: columns left out of the log.
  ignored text[] := ARRAY['updated_at', 'version'] || TG_ARGV[1:];
  old_row jsonb;
  new_row jsonb;
  row_data jsonb;
  op text := lower(TG_OP);
  org uuid;
  b jsonb;
  a jsonb;
BEGIN
  -- The seed, the nightly reset and data migrations write in bulk and turn the log off for their transaction.
  IF current_setting('app.quiet', true) = 'on' THEN
    RETURN NULL;
  END IF;
  IF TG_OP <> 'INSERT' THEN old_row := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_row := to_jsonb(NEW); END IF;
  row_data := coalesce(new_row, old_row);
  org := (row_data ->> TG_ARGV[0])::uuid;
  IF org IS NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT jsonb_object_agg(e.key, old_row -> e.key), jsonb_object_agg(e.key, e.value)
      INTO b, a
      FROM jsonb_each(new_row) AS e(key, value)
      WHERE NOT (e.key = ANY (ignored)) AND (old_row -> e.key) IS DISTINCT FROM e.value;
    IF b IS NULL THEN
      RETURN NULL; -- only ignored columns changed
    END IF;
    IF old_row ? 'deleted_at' AND old_row ->> 'deleted_at' IS NULL AND new_row ->> 'deleted_at' IS NOT NULL THEN
      op := 'delete'; -- soft delete
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    a := new_row - ignored;
  ELSE
    -- A delete cascading from the organization itself leaves nothing to log against.
    IF NOT EXISTS (SELECT 1 FROM organization WHERE id = org) THEN
      RETURN NULL;
    END IF;
    b := old_row - ignored;
  END IF;
  INSERT INTO audit_log (organization_id, actor_user_id, action, entity_type, entity_id, before, after, ip, user_agent)
  VALUES (
    org,
    nullif(current_setting('app.user_id', true), '')::uuid,
    TG_TABLE_NAME || '.' || op,
    TG_TABLE_NAME,
    row_data ->> 'id',
    b,
    a,
    nullif(current_setting('app.ip', true), ''),
    left(nullif(current_setting('app.ua', true), ''), 512)
  );
  RETURN NULL;
END $$;
--> statement-breakpoint
-- For audited events that aren't a row change, e.g. "auth.sign_in". The organization, actor, IP address and user
-- agent come from the transaction settings, like the trigger's.
CREATE OR REPLACE FUNCTION audit_event(p_action text, p_entity_type text, p_entity_id text, p_after jsonb)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
BEGIN
  IF app_current_org() IS NULL THEN
    RAISE EXCEPTION 'audit_event needs app.org_id';
  END IF;
  INSERT INTO audit_log (organization_id, actor_user_id, action, entity_type, entity_id, after, ip, user_agent)
  VALUES (
    app_current_org(),
    nullif(current_setting('app.user_id', true), '')::uuid,
    p_action,
    p_entity_type,
    p_entity_id,
    p_after,
    nullif(current_setting('app.ip', true), ''),
    left(nullif(current_setting('app.ua', true), ''), 512)
  );
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION audit_row() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION audit_event(text, text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION audit_event(text, text, text, jsonb) TO fieldops_app;
--> statement-breakpoint
-- SLA deadlines for jobs created before 0.3, from the default targets in calendar time (SLA-02). Organizations
-- get explicit policies when an owner saves the SLA settings.
WITH d(priority, response_min, resolution_min) AS (
  VALUES ('urgent', 120, 1440), ('high', 480, 4320), ('normal', 1440, 10080), ('low', 4320, 20160)
)
UPDATE "job" j SET
  response_due_at = j.created_at + make_interval(mins => d.response_min),
  resolution_due_at = j.created_at + make_interval(mins => d.resolution_min),
  response_at_risk_at = j.created_at + make_interval(mins => (d.response_min * 3) / 4),
  resolution_at_risk_at = j.created_at + make_interval(mins => (d.resolution_min * 3) / 4)
FROM d
WHERE d.priority = j.priority AND j.response_due_at IS NULL;
--> statement-breakpoint
UPDATE "job" SET
  sla_response_state = CASE
    WHEN status = 'canceled' THEN NULL
    WHEN first_scheduled_at IS NOT NULL THEN CASE WHEN first_scheduled_at <= response_due_at THEN 'met' ELSE 'breached' END
    WHEN now() > response_due_at THEN 'breached'
    WHEN now() >= response_at_risk_at THEN 'at_risk'
    ELSE 'on_track' END,
  sla_resolution_state = CASE
    WHEN status = 'canceled' THEN NULL
    WHEN completed_at IS NOT NULL THEN CASE WHEN completed_at <= resolution_due_at THEN 'met' ELSE 'breached' END
    WHEN now() > resolution_due_at THEN 'breached'
    WHEN now() >= resolution_at_risk_at THEN 'at_risk'
    ELSE 'on_track' END
WHERE response_due_at IS NOT NULL;
--> statement-breakpoint
-- Live events (NOT-05, SCH-06, ADR 011): a change to the board or a new notification publishes a small message on
-- the "fieldops_live" channel when the transaction commits. The web app listens on one connection and forwards
-- each message to the signed-in users it concerns over server-sent events.
CREATE OR REPLACE FUNCTION live_notify() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  r jsonb;
BEGIN
  IF current_setting('app.quiet', true) = 'on' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN r := to_jsonb(OLD); ELSE r := to_jsonb(NEW); END IF;
  -- TG_ARGV[0]: event kind; TG_ARGV[1]: the column with the id to send.
  PERFORM pg_notify('fieldops_live', json_build_object(
    'org', r ->> 'organization_id',
    'kind', TG_ARGV[0],
    'id', r ->> TG_ARGV[1],
    'user', r ->> 'user_id'
  )::text);
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER live AFTER INSERT OR UPDATE OR DELETE ON "job" FOR EACH ROW EXECUTE FUNCTION live_notify('job', 'id');
--> statement-breakpoint
CREATE TRIGGER live AFTER INSERT OR UPDATE OR DELETE ON "job_assignment" FOR EACH ROW EXECUTE FUNCTION live_notify('job', 'job_id');
--> statement-breakpoint
CREATE TRIGGER live AFTER INSERT OR UPDATE OR DELETE ON "time_off" FOR EACH ROW EXECUTE FUNCTION live_notify('time_off', 'member_id');
--> statement-breakpoint
CREATE TRIGGER live AFTER INSERT OR UPDATE ON "expense_request" FOR EACH ROW EXECUTE FUNCTION live_notify('expense', 'id');
--> statement-breakpoint
CREATE TRIGGER live AFTER INSERT OR UPDATE ON "notification" FOR EACH ROW EXECUTE FUNCTION live_notify('notification', 'id');
--> statement-breakpoint
-- Audited tables. The trigger runs after each row change, in the same transaction (AUD-02).
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON "organization" FOR EACH ROW EXECUTE FUNCTION audit_row('id');
--> statement-breakpoint
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON "member" FOR EACH ROW EXECUTE FUNCTION audit_row('organization_id');
--> statement-breakpoint
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON "invitation" FOR EACH ROW EXECUTE FUNCTION audit_row('organization_id');
--> statement-breakpoint
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON "service_type" FOR EACH ROW EXECUTE FUNCTION audit_row('organization_id');
--> statement-breakpoint
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON "sla_policy" FOR EACH ROW EXECUTE FUNCTION audit_row('organization_id');
--> statement-breakpoint
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON "customer" FOR EACH ROW EXECUTE FUNCTION audit_row('organization_id');
--> statement-breakpoint
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON "contact" FOR EACH ROW EXECUTE FUNCTION audit_row('organization_id');
--> statement-breakpoint
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON "site" FOR EACH ROW EXECUTE FUNCTION audit_row('organization_id');
--> statement-breakpoint
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON "equipment" FOR EACH ROW EXECUTE FUNCTION audit_row('organization_id');
--> statement-breakpoint
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON "job" FOR EACH ROW EXECUTE FUNCTION audit_row('organization_id', 'sla_response_state', 'sla_resolution_state', 'ai_status');
--> statement-breakpoint
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON "job_assignment" FOR EACH ROW EXECUTE FUNCTION audit_row('organization_id');
--> statement-breakpoint
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON "checklist_item" FOR EACH ROW EXECUTE FUNCTION audit_row('organization_id');
--> statement-breakpoint
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON "note" FOR EACH ROW EXECUTE FUNCTION audit_row('organization_id');
--> statement-breakpoint
CREATE TRIGGER audit AFTER INSERT OR DELETE ON "attachment" FOR EACH ROW EXECUTE FUNCTION audit_row('organization_id');
--> statement-breakpoint
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON "time_off" FOR EACH ROW EXECUTE FUNCTION audit_row('organization_id');
--> statement-breakpoint
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON "time_entry" FOR EACH ROW EXECUTE FUNCTION audit_row('organization_id');
--> statement-breakpoint
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON "expense_request" FOR EACH ROW EXECUTE FUNCTION audit_row('organization_id');

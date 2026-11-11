CREATE TABLE "api_key" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" text[] DEFAULT '{read}'::text[] NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"relay_event_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "webhooks_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_event" ADD CONSTRAINT "outbox_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_token_hash_uq" ON "api_key" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "api_key_org_created_idx" ON "api_key" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "outbox_event_pending_idx" ON "outbox_event" USING btree ("next_attempt_at") WHERE status in ('pending', 'sending');--> statement-breakpoint
CREATE INDEX "outbox_event_org_created_idx" ON "outbox_event" USING btree ("organization_id","created_at");--> statement-breakpoint
-- Tenant isolation for the 0.5 tables (ADR 003).
ALTER TABLE "api_key" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "api_key" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "outbox_event" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "outbox_event" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
-- The web role reads the outbox for an organization's own event list but never writes it: rows come from the
-- triggers below (SECURITY DEFINER) and the worker, which connects as the owner.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "outbox_event" FROM fieldops_app;
--> statement-breakpoint
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON "api_key" FOR EACH ROW EXECUTE FUNCTION audit_row('organization_id', 'last_used_at', 'token_hash');
--> statement-breakpoint
-- API key authentication (PLT-02). Runs before the organization is known, so it can't go through the RLS policy:
-- it returns the key's organization, member and scopes for a SHA-256 hash, and records the last use at most once a
-- minute so a busy key doesn't write on every request.
CREATE OR REPLACE FUNCTION api_key_authenticate(p_hash text)
  RETURNS TABLE (key_id uuid, organization_id uuid, member_id uuid, user_id uuid, scopes text[])
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  k api_key%ROWTYPE;
BEGIN
  SELECT * INTO k FROM api_key a
   WHERE a.token_hash = p_hash AND a.revoked_at IS NULL AND (a.expires_at IS NULL OR a.expires_at > now());
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF k.last_used_at IS NULL OR k.last_used_at < now() - interval '1 minute' THEN
    UPDATE api_key SET last_used_at = now() WHERE id = k.id;
  END IF;
  RETURN QUERY SELECT k.id, k.organization_id, k.member_id, m.user_id, k.scopes
    FROM member m WHERE m.id = k.member_id AND m.organization_id = k.organization_id;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api_key_authenticate(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api_key_authenticate(text) TO fieldops_app;
--> statement-breakpoint
-- Integration events (PLT-03, §17.3, ADR 022). Triggers write thin events into outbox_event in the transaction
-- that made the change, only for organizations with webhooks turned on, and never for the seed or the nightly
-- reset (app.quiet). The worker posts them to Relay.
CREATE OR REPLACE FUNCTION outbox_ts(t timestamptz) RETURNS text
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT to_char(t AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION outbox_enqueue(p_org uuid, p_type text, p_data jsonb) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
BEGIN
  IF current_setting('app.quiet', true) = 'on' THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM organization WHERE id = p_org AND webhooks_enabled_at IS NOT NULL) THEN
    RETURN;
  END IF;
  INSERT INTO outbox_event (organization_id, type, payload) VALUES (p_org, p_type, p_data);
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION outbox_job_json(j job) RETURNS jsonb
  LANGUAGE sql STABLE
  AS $$ SELECT jsonb_build_object(
    'id', j.id,
    'number', 'JOB-' || lpad(j.number::text, 6, '0'),
    'title', j.title,
    'status', j.status,
    'priority', j.priority,
    'source', j.source,
    'customer_id', j.customer_id,
    'site_id', j.site_id,
    'service_type_id', j.service_type_id,
    'scheduled_start', outbox_ts(j.scheduled_start),
    'scheduled_end', outbox_ts(j.scheduled_end),
    'completed_at', outbox_ts(j.completed_at),
    'updated_at', outbox_ts(j.updated_at)
  ) $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION outbox_job() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  changed text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.deleted_at IS NULL THEN
      PERFORM outbox_enqueue(NEW.organization_id, 'job.created', jsonb_build_object('job', outbox_job_json(NEW)));
    END IF;
    RETURN NULL;
  END IF;
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NULL;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM outbox_enqueue(NEW.organization_id, 'job.status_changed',
      jsonb_build_object('job', outbox_job_json(NEW), 'previous_status', OLD.status));
    IF NEW.status = 'completed' THEN
      PERFORM outbox_enqueue(NEW.organization_id, 'job.completed', jsonb_build_object('job', outbox_job_json(NEW)));
    END IF;
    RETURN NULL;
  END IF;
  -- Fields people change; SLA bookkeeping, AI status and versions don't make an event.
  SELECT coalesce(array_agg(f), '{}') INTO changed FROM unnest(ARRAY[
    CASE WHEN NEW.title IS DISTINCT FROM OLD.title THEN 'title' END,
    CASE WHEN NEW.description IS DISTINCT FROM OLD.description THEN 'description' END,
    CASE WHEN NEW.priority IS DISTINCT FROM OLD.priority THEN 'priority' END,
    CASE WHEN NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN 'customer_id' END,
    CASE WHEN NEW.site_id IS DISTINCT FROM OLD.site_id THEN 'site_id' END,
    CASE WHEN NEW.equipment_id IS DISTINCT FROM OLD.equipment_id THEN 'equipment_id' END,
    CASE WHEN NEW.service_type_id IS DISTINCT FROM OLD.service_type_id THEN 'service_type_id' END,
    CASE WHEN NEW.preferred_start IS DISTINCT FROM OLD.preferred_start THEN 'preferred_start' END,
    CASE WHEN NEW.preferred_end IS DISTINCT FROM OLD.preferred_end THEN 'preferred_end' END,
    CASE WHEN NEW.scheduled_start IS DISTINCT FROM OLD.scheduled_start THEN 'scheduled_start' END,
    CASE WHEN NEW.scheduled_end IS DISTINCT FROM OLD.scheduled_end THEN 'scheduled_end' END,
    CASE WHEN NEW.estimated_duration_min IS DISTINCT FROM OLD.estimated_duration_min THEN 'estimated_duration_min' END,
    CASE WHEN NEW.hold_reason IS DISTINCT FROM OLD.hold_reason THEN 'hold_reason' END
  ]) AS f WHERE f IS NOT NULL;
  IF cardinality(changed) > 0 THEN
    PERFORM outbox_enqueue(NEW.organization_id, 'job.updated',
      jsonb_build_object('job', outbox_job_json(NEW), 'changed', to_jsonb(changed)));
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER outbox AFTER INSERT OR UPDATE ON "job" FOR EACH ROW EXECUTE FUNCTION outbox_job();
--> statement-breakpoint
-- Assignments are replaced as a set (delete, then insert), so one event per job and statement carries the job's
-- whole team. Clearing every assignment inserts nothing and makes no event.
CREATE OR REPLACE FUNCTION outbox_job_assigned() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT DISTINCT n.organization_id, n.job_id FROM new_rows n LOOP
    PERFORM outbox_enqueue(r.organization_id, 'job.assigned', jsonb_build_object(
      'job', (SELECT outbox_job_json(j) FROM job j WHERE j.id = r.job_id),
      'assignees', (SELECT coalesce(jsonb_agg(jsonb_build_object('member_id', a.member_id, 'is_lead', a.is_lead)
                      ORDER BY a.is_lead DESC, a.created_at), '[]'::jsonb)
                    FROM job_assignment a WHERE a.job_id = r.job_id AND a.organization_id = r.organization_id)
    ));
  END LOOP;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER outbox AFTER INSERT ON "job_assignment" REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION outbox_job_assigned();
--> statement-breakpoint
-- SLA alerts are raised once per job, clock and kind (the primary key), so they make the SLA events.
CREATE OR REPLACE FUNCTION outbox_sla_alert() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
BEGIN
  PERFORM outbox_enqueue(NEW.organization_id, 'sla.' || NEW.kind, jsonb_build_object(
    'job', (SELECT outbox_job_json(j) FROM job j WHERE j.id = NEW.job_id),
    'clock', NEW.target,
    'due_at', (SELECT outbox_ts(CASE NEW.target WHEN 'response' THEN j.response_due_at ELSE j.resolution_due_at END)
               FROM job j WHERE j.id = NEW.job_id)
  ));
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER outbox AFTER INSERT ON "sla_alert" FOR EACH ROW EXECUTE FUNCTION outbox_sla_alert();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION outbox_quote() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
BEGIN
  IF NEW.status NOT IN ('sent', 'approved', 'declined') OR NEW.deleted_at IS NOT NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;
  PERFORM outbox_enqueue(NEW.organization_id, 'quote.' || NEW.status, jsonb_build_object('quote', jsonb_build_object(
    'id', NEW.id,
    'number', NEW.number,
    'title', NEW.title,
    'status', NEW.status,
    'customer_id', NEW.customer_id,
    'job_id', NEW.job_id,
    'total_minor', NEW.total_minor,
    'currency', NEW.currency,
    'valid_until', NEW.valid_until,
    'decline_reason', NEW.decline_reason
  )));
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER outbox AFTER INSERT OR UPDATE ON "quote" FOR EACH ROW EXECUTE FUNCTION outbox_quote();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION outbox_invoice() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
BEGIN
  IF NEW.status NOT IN ('sent', 'paid') OR NEW.deleted_at IS NOT NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;
  -- An overdue invoice that is paid is still "paid"; one moving from overdue back to sent isn't a new send.
  IF NEW.status = 'sent' AND TG_OP = 'UPDATE' AND OLD.status <> 'draft' THEN
    RETURN NULL;
  END IF;
  PERFORM outbox_enqueue(NEW.organization_id, 'invoice.' || NEW.status, jsonb_build_object('invoice', jsonb_build_object(
    'id', NEW.id,
    'number', NEW.number,
    'status', NEW.status,
    'customer_id', NEW.customer_id,
    'job_id', NEW.job_id,
    'total_minor', NEW.total_minor,
    'amount_paid_minor', NEW.amount_paid_minor,
    'currency', NEW.currency,
    'issue_date', NEW.issue_date,
    'due_date', NEW.due_date,
    'paid_at', outbox_ts(NEW.paid_at)
  )));
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER outbox AFTER INSERT OR UPDATE ON "invoice" FOR EACH ROW EXECUTE FUNCTION outbox_invoice();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION outbox_expense() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;
  PERFORM outbox_enqueue(NEW.organization_id, 'expense.decided', jsonb_build_object('expense', jsonb_build_object(
    'id', NEW.id,
    'job_id', NEW.job_id,
    'status', NEW.status,
    'kind', NEW.kind,
    'item', NEW.item,
    'total_minor', NEW.total_minor,
    'currency', NEW.currency,
    'auto_approved', NEW.auto_approved,
    'decided_at', outbox_ts(NEW.decided_at)
  )));
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER outbox AFTER INSERT OR UPDATE ON "expense_request" FOR EACH ROW EXECUTE FUNCTION outbox_expense();
--> statement-breakpoint
REVOKE ALL ON FUNCTION outbox_enqueue(uuid, text, jsonb) FROM PUBLIC;

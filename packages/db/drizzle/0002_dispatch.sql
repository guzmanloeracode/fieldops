CREATE TABLE "expense_request" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"requester_member_id" uuid,
	"kind" text DEFAULT 'part' NOT NULL,
	"item" text NOT NULL,
	"quantity" numeric(10, 2) NOT NULL,
	"unit_cost_minor" bigint NOT NULL,
	"total_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"supplier" text,
	"reason" text NOT NULL,
	"receipt_attachment_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"auto_approved" boolean DEFAULT false NOT NULL,
	"decided_by_member_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_comment" text,
	"used_at" timestamp with time zone,
	"billable" boolean DEFAULT true NOT NULL,
	"markup_bps" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_view" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"resource" text DEFAULT 'jobs' NOT NULL,
	"name" text NOT NULL,
	"query" text NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entry" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"source" text DEFAULT 'status' NOT NULL,
	"edited_reason" text,
	"edited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_off" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "working_hours" jsonb;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "caption" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "first_scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "revisit" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "expense_request" ADD CONSTRAINT "expense_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_request" ADD CONSTRAINT "expense_request_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_request" ADD CONSTRAINT "expense_request_requester_member_id_member_id_fk" FOREIGN KEY ("requester_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_request" ADD CONSTRAINT "expense_request_receipt_attachment_id_attachment_id_fk" FOREIGN KEY ("receipt_attachment_id") REFERENCES "public"."attachment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_request" ADD CONSTRAINT "expense_request_decided_by_member_id_member_id_fk" FOREIGN KEY ("decided_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_edited_by_user_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_request_org_job_idx" ON "expense_request" USING btree ("organization_id","job_id");--> statement-breakpoint
CREATE INDEX "expense_request_org_status_idx" ON "expense_request" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "saved_view_org_resource_idx" ON "saved_view" USING btree ("organization_id","resource","member_id");--> statement-breakpoint
CREATE INDEX "time_entry_org_job_idx" ON "time_entry" USING btree ("organization_id","job_id");--> statement-breakpoint
CREATE INDEX "time_entry_org_member_idx" ON "time_entry" USING btree ("organization_id","member_id","started_at");--> statement-breakpoint
CREATE INDEX "time_off_org_member_idx" ON "time_off" USING btree ("organization_id","member_id","starts_at");--> statement-breakpoint
CREATE INDEX "job_org_completed_idx" ON "job" USING btree ("organization_id","completed_at");--> statement-breakpoint
CREATE INDEX "job_org_service_type_idx" ON "job" USING btree ("organization_id","service_type_id","created_at");--> statement-breakpoint
-- Row-level security for the 0.2 tables (same policy as migration 0001, ADR 003).
ALTER TABLE "time_off" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "time_off" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "time_entry" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "time_entry" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "expense_request" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "expense_request" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "saved_view" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "saved_view" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
-- Backfill the KPI columns from the timeline for jobs created before 0.2.
UPDATE "job" j SET "first_scheduled_at" = e.first_at
FROM (
  SELECT job_id, min(created_at) AS first_at FROM "job_event"
  WHERE to_status = 'scheduled' GROUP BY job_id
) e
WHERE e.job_id = j.id AND j.first_scheduled_at IS NULL;
--> statement-breakpoint
UPDATE "job" j SET "revisit" = true
WHERE EXISTS (
  SELECT 1 FROM "job_event" e
  WHERE e.job_id = j.id AND e.type = 'status_changed'
    AND ((e.from_status = 'on_hold' AND e.to_status = 'scheduled') OR (e.from_status = 'completed' AND e.to_status = 'in_progress'))
);

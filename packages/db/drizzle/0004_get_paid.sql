CREATE TABLE "assistant_conversation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_message" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_interaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_item" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text DEFAULT 'part' NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sku" text,
	"unit" text DEFAULT 'each' NOT NULL,
	"unit_price_minor" bigint DEFAULT 0 NOT NULL,
	"unit_cost_minor" bigint,
	"currency" text NOT NULL,
	"tax_rate_bps" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_digest" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"digest_date" date NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_digest_organization_id_user_id_digest_date_pk" PRIMARY KEY("organization_id","user_id","digest_date")
);
--> statement-breakpoint
CREATE TABLE "invoice" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" text,
	"customer_id" uuid NOT NULL,
	"site_id" uuid,
	"job_id" uuid,
	"quote_id" uuid,
	"contact_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"currency" text NOT NULL,
	"discount_type" text,
	"discount_value" bigint DEFAULT 0 NOT NULL,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"amount_paid_minor" bigint DEFAULT 0 NOT NULL,
	"issue_date" date,
	"due_date" date,
	"notes" text,
	"sent_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"checkout_session_id" text,
	"checkout_url" text,
	"checkout_expires_at" timestamp with time zone,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invoice_line" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"kind" text NOT NULL,
	"catalog_item_id" uuid,
	"service_type_id" uuid,
	"expense_request_id" uuid,
	"description" text NOT NULL,
	"quantity" numeric(10, 2) NOT NULL,
	"unit" text,
	"unit_cost_minor" bigint,
	"markup_bps" integer DEFAULT 0 NOT NULL,
	"unit_price_minor" bigint DEFAULT 0 NOT NULL,
	"tax_rate_bps" integer DEFAULT 0 NOT NULL,
	"net_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_reminder" (
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"stage" integer NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_reminder_organization_id_invoice_id_stage_pk" PRIMARY KEY("organization_id","invoice_id","stage")
);
--> statement-breakpoint
CREATE TABLE "job_recurrence" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"equipment_id" uuid,
	"service_type_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"priority" text DEFAULT 'normal' NOT NULL,
	"interval_unit" text NOT NULL,
	"interval_count" integer DEFAULT 1 NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"window_start" text,
	"window_minutes" integer,
	"lead_days" integer DEFAULT 14 NOT NULL,
	"next_on" date NOT NULL,
	"lead_member_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"method" text NOT NULL,
	"provider" text DEFAULT 'manual' NOT NULL,
	"provider_ref" text,
	"reference" text,
	"note" text,
	"paid_at" timestamp with time zone NOT NULL,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"site_id" uuid,
	"contact_id" uuid,
	"service_type_id" uuid,
	"job_id" uuid,
	"title" text NOT NULL,
	"notes" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"currency" text NOT NULL,
	"discount_type" text,
	"discount_value" bigint DEFAULT 0 NOT NULL,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"valid_until" date,
	"sent_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_by_contact_id" uuid,
	"decided_by_user_id" uuid,
	"decline_reason" text,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "quote_line" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"kind" text NOT NULL,
	"catalog_item_id" uuid,
	"service_type_id" uuid,
	"description" text NOT NULL,
	"quantity" numeric(10, 2) NOT NULL,
	"unit" text,
	"unit_price_minor" bigint DEFAULT 0 NOT NULL,
	"tax_rate_bps" integer DEFAULT 0 NOT NULL,
	"net_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_report" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"work_performed" text,
	"findings" text,
	"recommendations" text,
	"next_service_date" date,
	"ai_status" text,
	"ai_interaction_id" uuid,
	"ai_drafted" boolean DEFAULT false NOT NULL,
	"edited_by" uuid,
	"sent_at" timestamp with time zone,
	"sent_to" text,
	"sent_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "locale" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "sla_paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "sla_paused_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "recurrence_id" uuid;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "occurrence_date" date;--> statement-breakpoint
ALTER TABLE "service_type" ADD COLUMN "tax_rate_bps" integer;--> statement-breakpoint
ALTER TABLE "assistant_conversation" ADD CONSTRAINT "assistant_conversation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_conversation" ADD CONSTRAINT "assistant_conversation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_message" ADD CONSTRAINT "assistant_message_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_message" ADD CONSTRAINT "assistant_message_conversation_id_assistant_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."assistant_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_message" ADD CONSTRAINT "assistant_message_ai_interaction_id_ai_interaction_id_fk" FOREIGN KEY ("ai_interaction_id") REFERENCES "public"."ai_interaction"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_item" ADD CONSTRAINT "catalog_item_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_digest" ADD CONSTRAINT "daily_digest_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_digest" ADD CONSTRAINT "daily_digest_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_catalog_item_id_catalog_item_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_service_type_id_service_type_id_fk" FOREIGN KEY ("service_type_id") REFERENCES "public"."service_type"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_expense_request_id_expense_request_id_fk" FOREIGN KEY ("expense_request_id") REFERENCES "public"."expense_request"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_reminder" ADD CONSTRAINT "invoice_reminder_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_reminder" ADD CONSTRAINT "invoice_reminder_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_recurrence" ADD CONSTRAINT "job_recurrence_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_recurrence" ADD CONSTRAINT "job_recurrence_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_recurrence" ADD CONSTRAINT "job_recurrence_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_recurrence" ADD CONSTRAINT "job_recurrence_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_recurrence" ADD CONSTRAINT "job_recurrence_service_type_id_service_type_id_fk" FOREIGN KEY ("service_type_id") REFERENCES "public"."service_type"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_recurrence" ADD CONSTRAINT "job_recurrence_lead_member_id_member_id_fk" FOREIGN KEY ("lead_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_recurrence" ADD CONSTRAINT "job_recurrence_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_service_type_id_service_type_id_fk" FOREIGN KEY ("service_type_id") REFERENCES "public"."service_type"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_decided_by_contact_id_contact_id_fk" FOREIGN KEY ("decided_by_contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_line" ADD CONSTRAINT "quote_line_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_line" ADD CONSTRAINT "quote_line_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_line" ADD CONSTRAINT "quote_line_catalog_item_id_catalog_item_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_line" ADD CONSTRAINT "quote_line_service_type_id_service_type_id_fk" FOREIGN KEY ("service_type_id") REFERENCES "public"."service_type"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_report" ADD CONSTRAINT "service_report_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_report" ADD CONSTRAINT "service_report_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_report" ADD CONSTRAINT "service_report_ai_interaction_id_ai_interaction_id_fk" FOREIGN KEY ("ai_interaction_id") REFERENCES "public"."ai_interaction"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_report" ADD CONSTRAINT "service_report_edited_by_user_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_report" ADD CONSTRAINT "service_report_sent_by_user_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_conversation_org_user_idx" ON "assistant_conversation" USING btree ("organization_id","user_id","updated_at");--> statement-breakpoint
CREATE INDEX "assistant_message_org_conversation_idx" ON "assistant_message" USING btree ("organization_id","conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "catalog_item_org_kind_name_idx" ON "catalog_item" USING btree ("organization_id","kind","name");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_item_org_sku_uq" ON "catalog_item" USING btree ("organization_id","sku") WHERE sku is not null;--> statement-breakpoint
CREATE INDEX "catalog_item_name_trgm_idx" ON "catalog_item" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_org_number_uq" ON "invoice" USING btree ("organization_id","number") WHERE number is not null;--> statement-breakpoint
CREATE INDEX "invoice_org_status_due_idx" ON "invoice" USING btree ("organization_id","status","due_date");--> statement-breakpoint
CREATE INDEX "invoice_org_customer_idx" ON "invoice" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "invoice_org_job_idx" ON "invoice" USING btree ("organization_id","job_id");--> statement-breakpoint
CREATE INDEX "invoice_org_issue_idx" ON "invoice" USING btree ("organization_id","issue_date");--> statement-breakpoint
CREATE INDEX "invoice_line_org_invoice_idx" ON "invoice_line" USING btree ("organization_id","invoice_id","position");--> statement-breakpoint
CREATE INDEX "invoice_line_org_expense_idx" ON "invoice_line" USING btree ("organization_id","expense_request_id");--> statement-breakpoint
CREATE INDEX "job_recurrence_org_next_idx" ON "job_recurrence" USING btree ("organization_id","active","next_on");--> statement-breakpoint
CREATE INDEX "job_recurrence_org_customer_idx" ON "job_recurrence" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "payment_org_invoice_idx" ON "payment" USING btree ("organization_id","invoice_id");--> statement-breakpoint
CREATE INDEX "payment_org_paid_idx" ON "payment" USING btree ("organization_id","paid_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_org_provider_ref_uq" ON "payment" USING btree ("organization_id","provider","provider_ref") WHERE provider_ref is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "quote_org_number_uq" ON "quote" USING btree ("organization_id","number");--> statement-breakpoint
CREATE INDEX "quote_org_status_idx" ON "quote" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "quote_org_customer_idx" ON "quote" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "quote_org_job_idx" ON "quote" USING btree ("organization_id","job_id");--> statement-breakpoint
CREATE INDEX "quote_line_org_quote_idx" ON "quote_line" USING btree ("organization_id","quote_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "service_report_org_job_uq" ON "service_report" USING btree ("organization_id","job_id");--> statement-breakpoint
CREATE INDEX "service_report_org_ai_status_idx" ON "service_report" USING btree ("organization_id","ai_status") WHERE ai_status = 'pending';--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_recurrence_id_job_recurrence_id_fk" FOREIGN KEY ("recurrence_id") REFERENCES "public"."job_recurrence"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_org_recurrence_occurrence_uq" ON "job" USING btree ("organization_id","recurrence_id","occurrence_date") WHERE recurrence_id is not null;--> statement-breakpoint
-- Row-level security for the 0.4 tenant tables (same policy as migrations 0001–0003, ADR 003).
ALTER TABLE "catalog_item" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "catalog_item" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "quote" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "quote" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "quote_line" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "quote_line" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "invoice" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "invoice" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "invoice_line" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "invoice_line" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "payment" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "payment" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "invoice_reminder" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "invoice_reminder" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "service_report" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "service_report" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "job_recurrence" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "job_recurrence" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "assistant_conversation" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "assistant_conversation" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "assistant_message" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "assistant_message" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
ALTER TABLE "daily_digest" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "daily_digest" USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint
-- Live events (ADR 011): quote and invoice changes, and payments, publish on the fieldops_live channel.
CREATE TRIGGER live AFTER INSERT OR UPDATE ON "quote" FOR EACH ROW EXECUTE FUNCTION live_notify('quote', 'id');
--> statement-breakpoint
CREATE TRIGGER live AFTER INSERT OR UPDATE ON "invoice" FOR EACH ROW EXECUTE FUNCTION live_notify('invoice', 'id');
--> statement-breakpoint
CREATE TRIGGER live AFTER INSERT ON "payment" FOR EACH ROW EXECUTE FUNCTION live_notify('invoice', 'invoice_id');
--> statement-breakpoint
-- Audited 0.4 tables (AUD-02). Conversations, reminders and digests are logs of their own and aren't audited.
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON "catalog_item" FOR EACH ROW EXECUTE FUNCTION audit_row('organization_id');
--> statement-breakpoint
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON "quote" FOR EACH ROW EXECUTE FUNCTION audit_row('organization_id', 'viewed_at');
--> statement-breakpoint
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON "quote_line" FOR EACH ROW EXECUTE FUNCTION audit_row('organization_id');
--> statement-breakpoint
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON "invoice" FOR EACH ROW EXECUTE FUNCTION audit_row('organization_id', 'checkout_url', 'checkout_expires_at', 'viewed_at');
--> statement-breakpoint
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON "invoice_line" FOR EACH ROW EXECUTE FUNCTION audit_row('organization_id');
--> statement-breakpoint
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON "payment" FOR EACH ROW EXECUTE FUNCTION audit_row('organization_id');
--> statement-breakpoint
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON "service_report" FOR EACH ROW EXECUTE FUNCTION audit_row('organization_id', 'ai_status');
--> statement-breakpoint
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON "job_recurrence" FOR EACH ROW EXECUTE FUNCTION audit_row('organization_id');

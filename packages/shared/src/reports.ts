import { z } from "zod";
import { AI_STATUSES, LOCALES, REPORT_STATUSES } from "./constants";
import { optionalText, ts } from "./fields";

// Service reports (AI-03, FIN-04, POR-04). When a job is completed FieldOps creates a draft report; the AI drafts
// its text (or it is prefilled from the checklist and notes), a person edits it, then sends it to the customer as
// a PDF link. The model's output is constrained to `reportModelOutputSchema` and validated again on the server.

/** Longest text per report section. */
export const MAX_REPORT_TEXT = 5000;
/** Before and after photos sent to the model, as small thumbnails. */
export const MAX_REPORT_AI_PHOTOS = 4;
/** How long the download link in the customer's email works. */
export const REPORT_LINK_DAYS = 30;

/** What the model must return. Loose on purpose (no length bounds): the server clips instead of failing. */
export const reportModelOutputSchema = z.object({
  work_performed: z
    .string()
    .describe("What the technician did on site, as a short paragraph or a few sentences, for the customer"),
  findings: z
    .string()
    .nullable()
    .describe("What the technician found: the cause of the problem and the condition of the equipment"),
  recommendations: z
    .string()
    .nullable()
    .describe("What the customer should do or have done next; null when there is nothing to recommend"),
  next_service_date: z
    .string()
    .nullable()
    .describe("Suggested date for the next visit as YYYY-MM-DD, after the completion date; null if none"),
});
export type ReportModelOutput = z.infer<typeof reportModelOutputSchema>;

const reportText = optionalText(MAX_REPORT_TEXT);

/** Editing a report (PATCH /jobs/{id}/report). Only the fields sent change. */
export const reportUpdateSchema = z
  .object({
    work_performed: reportText,
    findings: reportText,
    recommendations: reportText,
    next_service_date: z.iso.date().nullable().optional(),
    locale: z.enum(LOCALES).optional().meta({ description: "Language of the PDF and the email" }),
  })
  .meta({ id: "ServiceReportUpdate" });
export type ReportUpdateInput = z.input<typeof reportUpdateSchema>;

/** Sending a report (POST /jobs/{id}/report/send): one of the customer's contact emails. */
export const reportSendSchema = z
  .object({
    to: z
      .string()
      .trim()
      .toLowerCase()
      .max(200)
      .pipe(z.email("Enter a valid email address"))
      .meta({ description: "Email address of one of the customer's contacts" }),
  })
  .meta({ id: "ServiceReportSend" });
export type ReportSendInput = z.input<typeof reportSendSchema>;

export const serviceReportSchema = z
  .object({
    id: z.uuid(),
    job_id: z.uuid(),
    status: z.enum(REPORT_STATUSES),
    locale: z.enum(LOCALES),
    work_performed: z.string().nullable(),
    findings: z.string().nullable(),
    recommendations: z.string().nullable(),
    next_service_date: z.string().nullable().meta({ format: "date" }),
    ai_status: z.enum(AI_STATUSES).nullable().meta({
      description:
        "pending or drafting while the AI writes the draft; drafted, failed or skipped (prefilled without AI) after",
    }),
    ai_drafted: z.boolean().meta({ description: "The text came from an AI draft (labeled in the app)" }),
    edited: z.boolean().meta({ description: "A person changed the text after it was drafted" }),
    sent_at: ts.nullable(),
    sent_to: z.string().nullable(),
    version: z.number().int(),
    created_at: ts,
    updated_at: ts,
  })
  .meta({ id: "ServiceReport" });
export type ServiceReportDto = z.infer<typeof serviceReportSchema>;

export const reportDraftResponseSchema = z
  .object({
    status: z.enum(["drafted", "refused", "failed"]),
    model: z.string(),
    report: serviceReportSchema,
  })
  .meta({ id: "ServiceReportDraft" });

export const reportSendResponseSchema = z
  .object({
    report: serviceReportSchema,
    link_expires_at: ts.meta({ description: "When the download link in the email stops working" }),
  })
  .meta({ id: "ServiceReportSent" });

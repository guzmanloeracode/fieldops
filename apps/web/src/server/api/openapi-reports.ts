import "server-only";
import {
  reportDraftResponseSchema,
  reportSendResponseSchema,
  reportSendSchema,
  reportUpdateSchema,
  serviceReportSchema,
} from "@fieldops/shared";
import { z } from "zod";
import type {
  ZodOpenApiOperationObject,
  ZodOpenApiPathsObject,
  ZodOpenApiResponsesObject,
} from "zod-openapi";

// Service report endpoints (AI-03, §17.2) for the OpenAPI document. openapi.ts passes in its helpers.

type Helpers = {
  op: (
    tag: string,
    summary: string,
    rest: Omit<ZodOpenApiOperationObject, "tags" | "summary">,
  ) => ZodOpenApiOperationObject;
  json: <T extends z.ZodType>(
    schema: T,
    description: string,
    headers?: z.ZodObject,
  ) => { description: string; content: { "application/json": { schema: T } }; headers?: z.ZodObject };
  body: <T extends z.ZodType>(
    schema: T,
  ) => { required: boolean; content: { "application/json": { schema: T } } };
  errors: (
    ...codes: (400 | 401 | 403 | 404 | 409 | 412 | 415 | 422 | 429 | 503)[]
  ) => ZodOpenApiResponsesObject;
  jobId: z.ZodObject;
  idempotencyHeader: z.ZodObject;
};

const reportEtag = z.object({
  ETag: z.string().meta({ description: 'Current version of the report, e.g. "r3"', example: '"r3"' }),
});
const reportIfMatch = z.object({
  "If-Match": z.string().optional().meta({
    description: "ETag from a previous read; the change fails with 412 if the report changed since",
    example: '"r3"',
  }),
});
const rateLimitHeaders = z.object({
  "RateLimit-Limit": z.string().meta({ description: "Requests allowed in the tightest window" }),
  "RateLimit-Remaining": z.string(),
  "RateLimit-Reset": z.string().meta({ description: "Seconds until that window resets" }),
});

export function reportPaths({
  op,
  json,
  body,
  errors,
  jobId,
  idempotencyHeader,
}: Helpers): ZodOpenApiPathsObject {
  return {
    "/jobs/{id}/report": {
      get: op("Jobs", "Get a job's service report", {
        operationId: "getServiceReport",
        description:
          "The customer-facing report created when the job was completed (AI-03), in the customer's language. Visible to office roles and the job's technicians; 404 before the job is completed.",
        requestParams: { path: jobId },
        responses: { "200": json(serviceReportSchema, "The report", reportEtag), ...errors(404) },
      }),
      patch: op("Jobs", "Edit a job's service report", {
        operationId: "updateServiceReport",
        description:
          "Office roles and the job's technicians. Only the fields sent change; text changes record the editor (the AI draft counts as edited when sent). Editing a sent report takes it back to `draft`: the customer's link and the portal stop serving it until it is sent again. A completed job without a report gets one.",
        requestParams: { path: jobId, header: reportIfMatch },
        requestBody: body(reportUpdateSchema),
        responses: {
          "200": json(serviceReportSchema, "The updated report", reportEtag),
          ...errors(404, 409, 412, 415, 422),
        },
      }),
    },
    "/jobs/{id}/report-draft": {
      post: op("AI", "Draft a job's service report with AI", {
        operationId: "draftServiceReport",
        description:
          "Service report writer (AI-03): drafts work performed, findings, recommendations and a suggested next service date from the checklist results and readings, the notes for the customer (never internal notes), the parts used and up to 4 before and after photos, in the customer's language, and replaces the report's text. Office roles and the job's technicians, completed jobs only. Counts against the monthly AI quota and the per-user rate limits, with `RateLimit-*` headers. When the model refuses or fails, `status` says so and the text is unchanged. Completing a job also queues a draft in the background. `Idempotency-Key` is ignored.",
        requestParams: { path: jobId },
        responses: {
          "200": json(
            reportDraftResponseSchema,
            "The report after the draft, or why there is none",
            rateLimitHeaders,
          ),
          ...errors(404, 409, 429, 503),
        },
      }),
    },
    "/jobs/{id}/report/send": {
      post: op("Jobs", "Send a service report to the customer", {
        operationId: "sendServiceReport",
        description:
          "Emails one of the customer's contacts (`to` must be a contact's address) the \"Job completed\" message with a link to the PDF that works for 30 days without signing in (`/share/reports/<token>`, signed and expiring). Marks the report `sent`, records a `report_sent` job event and whether the AI draft was sent as drafted or edited. Sending again is allowed.",
        requestParams: { path: jobId, header: idempotencyHeader },
        requestBody: body(reportSendSchema),
        responses: {
          "200": json(reportSendResponseSchema, "The sent report", reportEtag),
          ...errors(400, 404, 412, 415, 422),
        },
      }),
    },
    "/jobs/{id}/report/pdf": {
      get: op("Jobs", "Download a service report as PDF", {
        operationId: "getServiceReportPdf",
        description:
          "The branded PDF in the report's language, in any status (a preview while it is a draft). `?download=1` sets `Content-Disposition: attachment`.",
        requestParams: {
          path: jobId,
          query: z.object({ download: z.enum(["1"]).optional() }),
        },
        responses: {
          "200": {
            description: "The PDF",
            content: { "application/pdf": { schema: z.string().meta({ format: "binary" }) } },
          },
          ...errors(404),
        },
      }),
    },
  };
}

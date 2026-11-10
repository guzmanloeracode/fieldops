import "server-only";
import {
  agendaSchema,
  aiIntakeRequestSchema,
  aiIntakeResponseSchema,
  jobReviewSchema,
  attachmentSchema,
  attachmentUploadResponseSchema,
  attachmentUploadSchema,
  checklistListSchema,
  checklistUpdateSchema,
  customerCreateSchema,
  customerCreatedSchema,
  customerListQuerySchema,
  customerSchema,
  customerSummarySchema,
  customerUpdateSchema,
  equipmentCreateSchema,
  equipmentSchema,
  expenseCreateSchema,
  expenseDecisionSchema,
  expenseListQuerySchema,
  expenseSchema,
  equipmentUpdateSchema,
  jobAssignmentSchema,
  jobCreateSchema,
  jobDetailSchema,
  jobEventSchema,
  jobListQuerySchema,
  jobSchema,
  jobTransitionSchema,
  jobUpdateSchema,
  meSchema,
  memberSchema,
  noteCreateSchema,
  noteSchema,
  notificationListQuerySchema,
  notificationPreferenceSchema,
  notificationPreferencesUpdateSchema,
  notificationReadSchema,
  notificationSchema,
  pageOf,
  problemSchema,
  scheduleSchema,
  serviceTypeSchema,
  siteCreateSchema,
  siteSchema,
  siteUpdateSchema,
  signatureCaptureSchema,
  slaPoliciesUpdateSchema,
  slaPolicyListSchema,
  timeEntryCreateSchema,
  timeEntryListSchema,
  timeEntrySchema,
  timeEntryUpdateSchema,
} from "@fieldops/shared";
import { z } from "zod";
import { createDocument, type ZodOpenApiOperationObject, type ZodOpenApiResponsesObject } from "zod-openapi";
import { env } from "@/env";
import { billingPaths, billingTags } from "./openapi-billing";

const DESCRIPTION = `
The FieldOps REST API covers the same resources the web and mobile apps use. Every endpoint calls the same
domain services as the web app, so permissions and business rules are identical.

## Authentication
Send the session cookie from the web app, or a session token as \`Authorization: Bearer <token>\`
(returned by \`POST /api/auth/sign-in/email\`). Organization-scoped API keys (\`fo_…\`) arrive in release 0.5.
Requests act inside the signed-in member's active organization and role. Records from other organizations
are reported as \`404 Not found\`.

## Errors
Errors use RFC 9457 problem details (\`application/problem+json\`) with \`type\`, \`title\`, \`status\`,
\`detail\` and, for validation failures, \`errors[]\` listing each field. Extra members such as \`missing\`
or \`conflicts\` explain rejected status changes and scheduling conflicts.

## Pagination
List endpoints use cursor pagination: \`?limit=50&cursor=…\`. Pass the \`next_cursor\` from a response to
get the next page; it is \`null\` on the last page. A cursor only works with the \`sort\` it was made for.

## Idempotency
\`POST\` requests accept an \`Idempotency-Key\` header (1–255 visible ASCII characters). Retrying with the
same key and body within 24 hours returns the stored response with \`Idempotent-Replayed: true\` and does
not repeat the change. Reusing a key with a different body returns \`422\`.

## Concurrency
\`GET /jobs/{id}\` returns an \`ETag\` (\`"v<version>"\`). Send it back as \`If-Match\` on \`PATCH\` or a
status transition; if the job changed in the meantime the API answers \`412 Precondition failed\`.
Customers use a weak ETag the same way.

## Versioning
Breaking changes only ship under a new major path (\`/api/v2\`).
`.trim();

const problem = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: problemSchema } },
});

const errors = (
  ...codes: (400 | 401 | 403 | 404 | 409 | 412 | 415 | 422 | 429 | 503)[]
): ZodOpenApiResponsesObject => {
  const text: Record<number, string> = {
    400: "Malformed request (invalid JSON or header)",
    401: "Not signed in, or the token is invalid",
    403: "Signed in, but the role doesn't allow this",
    404: "Not found, or belongs to another organization",
    409: "Conflict, such as an invalid status transition or a scheduling overlap",
    412: "If-Match doesn't match the current version",
    415: "The body isn't JSON",
    422: "Validation failed; see errors[]",
    429: "A rate limit or quota is used up; see Retry-After and the RateLimit-* headers",
    503: "The feature isn't available: file storage or AI isn't configured, or AI is turned off",
  };
  const all = new Set([401, 403, ...codes]);
  return Object.fromEntries([...all].sort().map((c) => [String(c), problem(text[c]!)]));
};

const json = <T extends z.ZodType>(schema: T, description: string, headers?: z.ZodObject) => ({
  description,
  content: { "application/json": { schema } },
  ...(headers ? { headers } : {}),
});

const body = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { "application/json": { schema } },
});

const etagHeader = z.object({
  ETag: z.string().meta({ description: 'Current version, e.g. "v3"', example: '"v3"' }),
});
const idempotencyHeader = z.object({
  "Idempotency-Key": z.string().max(255).optional().meta({
    description: "Makes the POST safe to retry for 24 hours",
    example: "3f1c9a6e-5d4b-4b5e-9b7a-1c2d3e4f5a6b",
  }),
});
const ifMatchHeader = z.object({
  "If-Match": z.string().optional().meta({
    description: "ETag from a previous read; the change fails with 412 if it is stale",
    example: '"v3"',
  }),
});

const jobId = z.object({
  id: z.string().meta({ description: "Job UUID or number such as JOB-000123", example: "JOB-000123" }),
});
const uuidParam = (what: string) => z.object({ id: z.uuid().meta({ description: `${what} ID` }) });

const jobPage = pageOf(jobSchema, "JobPage");
const notificationPage = z
  .object({
    data: z.array(notificationSchema),
    next_cursor: z.string().nullable(),
    unread_count: z.number().int().meta({ description: "Unread notifications in total" }),
  })
  .meta({ id: "NotificationPage" });
const notificationPreferences = z
  .object({ data: z.array(notificationPreferenceSchema) })
  .meta({ id: "NotificationPreferences" });
const customerPage = pageOf(customerSummarySchema, "CustomerPage");
const list = <T extends z.ZodType>(item: T, id: string) => pageOf(item, id);

function op(
  tag: string,
  summary: string,
  rest: Omit<ZodOpenApiOperationObject, "tags" | "summary">,
): ZodOpenApiOperationObject {
  return { tags: [tag], summary, ...rest };
}

let cached: ReturnType<typeof createDocument> | null = null;

/** The OpenAPI 3.1 description of /api/v1, generated from the shared Zod schemas (one source of truth). */
export function openApiDocument() {
  cached ??= createDocument({
    openapi: "3.1.0",
    info: {
      title: "FieldOps API",
      version: env.APP_VERSION,
      description: DESCRIPTION,
      license: { name: "MIT", identifier: "MIT" },
    },
    servers: [
      {
        url: `${env.APP_URL}/api/v1`,
        description: env.DEMO_MODE ? "Public demo (fictional data, resets daily)" : "This server",
      },
    ],
    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
    tags: [
      { name: "Jobs", description: "Work orders and their lifecycle" },
      { name: "Customers", description: "Customers, contacts, sites and equipment" },
      { name: "Expenses", description: "Parts and expenses requested on jobs, and their approval" },
      { name: "Schedule", description: "The dispatch board's data and each member's agenda" },
      {
        name: "Notifications",
        description: "The signed-in user's notifications, their settings, and the live event stream",
      },
      { name: "Organization", description: "The current user, members and service types" },
      ...billingTags,
      { name: "AI", description: "AI drafts. A person confirms every change the AI suggests." },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Session token from POST /api/auth/sign-in/email",
        },
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "fieldops.session_token",
          description: "Web session cookie (prefixed with __Secure- over HTTPS)",
        },
      },
    },
    paths: {
      "/jobs": {
        get: op("Jobs", "List jobs", {
          operationId: "listJobs",
          description: "Technicians only see jobs assigned to them.",
          requestParams: { query: jobListQuerySchema.omit({ page: true }) },
          responses: { "200": json(jobPage, "A page of jobs"), ...errors(422) },
        }),
        post: op("Jobs", "Create a job", {
          operationId: "createJob",
          requestParams: { header: idempotencyHeader },
          requestBody: body(jobCreateSchema),
          responses: { "201": json(jobSchema, "The new job", etagHeader), ...errors(400, 415, 422) },
        }),
      },
      "/jobs/{id}": {
        get: op("Jobs", "Get a job", {
          operationId: "getJob",
          requestParams: { path: jobId },
          responses: {
            "200": json(jobDetailSchema, "The job and the status changes you may make", etagHeader),
            "304": { description: "Not modified (If-None-Match)" },
            ...errors(404),
          },
        }),
        patch: op("Jobs", "Update a job", {
          operationId: "updateJob",
          description: "Status, assignments and schedule have their own endpoints.",
          requestParams: { path: jobId, header: ifMatchHeader },
          requestBody: body(jobUpdateSchema),
          responses: {
            "200": json(jobDetailSchema, "The updated job", etagHeader),
            ...errors(404, 412, 415, 422),
          },
        }),
        delete: op("Jobs", "Delete a job", {
          operationId: "deleteJob",
          description: "Soft delete. Owners and admins only.",
          requestParams: { path: jobId },
          responses: { "204": { description: "Deleted" }, ...errors(404) },
        }),
      },
      "/jobs/{id}/transitions": {
        post: op("Jobs", "Change a job's status", {
          operationId: "transitionJob",
          description:
            "Moves the job along its lifecycle: new → scheduled → en_route → in_progress → completed, with on_hold and canceled. Cancel, hold and reopen need a `reason`; hold also needs `hold_reason`.",
          requestParams: { path: jobId, header: idempotencyHeader.extend(ifMatchHeader.shape) },
          requestBody: body(jobTransitionSchema),
          responses: {
            "200": json(jobDetailSchema, "The job after the change", etagHeader),
            ...errors(404, 409, 412, 415, 422),
          },
        }),
      },
      "/jobs/{id}/review": {
        post: op("Jobs", "Review a portal request", {
          operationId: "reviewJob",
          description:
            "Office roles, jobs that need review only (409 otherwise). Copies the chosen fields of the job's AI draft (`apply`) through an ordinary job update, then clears `needs_review` unless `confirm` is false. The customer's original request stays in the description.",
          requestParams: { path: jobId, header: idempotencyHeader },
          requestBody: body(jobReviewSchema),
          responses: {
            "200": json(jobDetailSchema, "The job after the review", etagHeader),
            ...errors(404, 409, 415, 422),
          },
        }),
      },
      "/jobs/{id}/assignments": {
        put: op("Jobs", "Assign technicians and schedule", {
          operationId: "assignJob",
          description:
            "Replaces the assignees and visit window. A new job with both becomes scheduled. Scheduling conflicts (an overlapping visit, outside working hours, time off, missing required skills) return 409 with `conflicts` unless `override_reason` is set; the reason and the overridden conflicts are kept in the timeline.",
          requestParams: { path: jobId },
          requestBody: body(jobAssignmentSchema),
          responses: {
            "200": json(jobDetailSchema, "The job after assignment", etagHeader),
            ...errors(404, 409, 415, 422),
          },
        }),
      },
      "/jobs/{id}/notes": {
        get: op("Jobs", "List notes", {
          operationId: "listNotes",
          requestParams: { path: jobId },
          responses: { "200": json(list(noteSchema, "NotePage"), "Notes, newest first"), ...errors(404) },
        }),
        post: op("Jobs", "Add a note", {
          operationId: "addNote",
          requestParams: { path: jobId, header: idempotencyHeader },
          requestBody: body(noteCreateSchema),
          responses: { "201": json(noteSchema, "The new note"), ...errors(404, 415, 422) },
        }),
      },
      "/jobs/{id}/events": {
        get: op("Jobs", "Job timeline", {
          operationId: "listJobEvents",
          requestParams: { path: jobId },
          responses: {
            "200": json(list(jobEventSchema, "JobEventPage"), "Events, newest first"),
            ...errors(404),
          },
        }),
      },
      "/jobs/{id}/checklist": {
        get: op("Jobs", "Get the checklist", {
          operationId: "getChecklist",
          description: "Items come from the service type's template when the job is created (JOB-08).",
          requestParams: { path: jobId },
          responses: { "200": json(checklistListSchema, "Items and progress"), ...errors(404) },
        }),
        patch: op("Jobs", "Answer checklist items", {
          operationId: "updateChecklist",
          description:
            "Values by kind: checkbox → boolean, number → number, text → string, photo → id of a ready photo attachment of the job; `null` clears an item. A job can't be completed while required items are open (409 with `missing`).",
          requestParams: { path: jobId },
          requestBody: body(checklistUpdateSchema),
          responses: {
            "200": json(checklistListSchema, "The checklist after the change"),
            ...errors(404, 409, 415, 422),
          },
        }),
      },
      "/jobs/{id}/time-entries": {
        get: op("Jobs", "List time entries", {
          operationId: "listTimeEntries",
          description:
            "Travel and work time recorded from status changes (en route, start, hold, resume, complete), with totals per technician (TEC-04).",
          requestParams: { path: jobId },
          responses: { "200": json(timeEntryListSchema, "Entries in time order and totals"), ...errors(404) },
        }),
        post: op("Jobs", "Add a time entry", {
          operationId: "addTimeEntry",
          description: "For time no status change recorded. Technicians can only add their own time.",
          requestParams: { path: jobId, header: idempotencyHeader },
          requestBody: body(timeEntryCreateSchema),
          responses: { "201": json(timeEntrySchema, "The new entry"), ...errors(404, 415, 422) },
        }),
      },
      "/time-entries/{id}": {
        patch: op("Jobs", "Correct a time entry", {
          operationId: "updateTimeEntry",
          description:
            "Needs a reason, which appears in the job timeline. Technicians can only correct their own entries.",
          requestParams: { path: uuidParam("Time entry") },
          requestBody: body(timeEntryUpdateSchema),
          responses: { "200": json(timeEntrySchema, "The corrected entry"), ...errors(404, 415, 422) },
        }),
      },
      "/jobs/{id}/signature": {
        post: op("Jobs", "Capture the customer's signature", {
          operationId: "captureSignature",
          description:
            'Upload the signature image with `POST /jobs/{id}/attachments` (`kind: "signature"`, `caption`: signer\'s name), PUT the file, then call this. When the organization requires a signature, completing the job without one returns 409 with `missing: ["signature"]` (JOB-10).',
          requestParams: { path: jobId, header: idempotencyHeader },
          requestBody: body(signatureCaptureSchema),
          responses: { "201": json(attachmentSchema, "The signature"), ...errors(404, 409, 415, 422) },
        }),
      },
      "/jobs/{id}/attachments": {
        get: op("Jobs", "List attachments", {
          operationId: "listAttachments",
          requestParams: { path: jobId },
          responses: {
            "200": json(list(attachmentSchema, "AttachmentPage"), "Uploaded attachments with signed URLs"),
            ...errors(404, 503),
          },
        }),
        post: op("Jobs", "Start an attachment upload", {
          operationId: "requestAttachmentUpload",
          description:
            "Returns a presigned URL. PUT the file to `upload_url` with the returned headers, then call `POST /attachments/{id}/confirm`.",
          requestParams: { path: jobId, header: idempotencyHeader },
          requestBody: body(attachmentUploadSchema),
          responses: {
            "201": json(attachmentUploadResponseSchema, "Upload instructions"),
            ...errors(404, 415, 422, 503),
          },
        }),
      },
      "/attachments/{id}/confirm": {
        post: op("Jobs", "Confirm an upload", {
          operationId: "confirmAttachmentUpload",
          requestParams: { path: uuidParam("Attachment"), header: idempotencyHeader },
          responses: { "200": json(attachmentSchema, "The ready attachment"), ...errors(404, 409, 503) },
        }),
      },
      "/jobs/{id}/expenses": {
        get: op("Expenses", "List a job's parts and expenses", {
          operationId: "listJobExpenses",
          requestParams: { path: jobId },
          responses: {
            "200": json(list(expenseSchema, "JobExpensePage"), "Requests, newest first"),
            ...errors(404),
          },
        }),
        post: op("Expenses", "Request a part or expense", {
          operationId: "requestExpense",
          description:
            "Open jobs only. Requests below the organization's auto-approve threshold are approved at once; the rest wait for an approver. Attach a receipt by uploading it to the job first and passing its `receipt_attachment_id`.",
          requestParams: { path: jobId, header: idempotencyHeader },
          requestBody: body(expenseCreateSchema),
          responses: { "201": json(expenseSchema, "The new request"), ...errors(404, 409, 415, 422) },
        }),
      },
      "/expenses": {
        get: op("Expenses", "List parts and expense requests", {
          operationId: "listExpenses",
          description: "The approvals inbox. Technicians only see requests on jobs assigned to them.",
          requestParams: { query: expenseListQuerySchema.omit({ page: true }) },
          responses: {
            "200": json(list(expenseSchema, "ExpensePage"), "Requests, newest first"),
            ...errors(422),
          },
        }),
      },
      "/expenses/{id}/decision": {
        post: op("Expenses", "Approve or reject a request", {
          operationId: "decideExpense",
          description:
            "Owners and admins decide any amount; dispatchers only below the organization's dispatcher limit. A rejection needs a `comment`. Only pending requests can be decided (409 otherwise).",
          requestParams: { path: uuidParam("Expense"), header: idempotencyHeader },
          requestBody: body(expenseDecisionSchema),
          responses: { "200": json(expenseSchema, "The decided request"), ...errors(404, 409, 415, 422) },
        }),
      },
      "/expenses/{id}/used": {
        post: op("Expenses", "Record a part as used", {
          operationId: "markExpenseUsed",
          description: "Approved parts only. Repeating the call keeps the first time.",
          requestParams: { path: uuidParam("Expense"), header: idempotencyHeader },
          responses: { "200": json(expenseSchema, "The request with `used_at` set"), ...errors(404, 409) },
        }),
      },
      "/ai/intake": {
        post: op("AI", "Draft a job from a customer's message", {
          operationId: "draftIntake",
          description:
            "Smart intake (AI-01): turns a message (English or Bahasa Indonesia) and up to 3 base64 photos into a draft job: title, service type, priority with a reason, summary, checklist suggestions, duration, equipment, contact details, questions to ask and a confidence per field. Nothing is saved: create the job with `POST /jobs` (`source: ai_intake`). Office roles. Counts against the organization's monthly AI quota and per-user rate limits; responses carry `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`. When the model refuses or fails, `status` says so, `draft` is null and the job can be entered by hand. `Idempotency-Key` is ignored: a draft changes nothing.",
          requestBody: body(aiIntakeRequestSchema),
          responses: {
            "200": json(
              aiIntakeResponseSchema,
              "The draft, or why there is none",
              z.object({
                "RateLimit-Limit": z
                  .string()
                  .meta({ description: "Requests allowed in the tightest window" }),
                "RateLimit-Remaining": z.string(),
                "RateLimit-Reset": z.string().meta({ description: "Seconds until that window resets" }),
              }),
            ),
            ...errors(400, 415, 422, 429, 503),
          },
        }),
      },
      "/notifications": {
        get: op("Notifications", "List my notifications", {
          operationId: "listNotifications",
          description:
            "The signed-in user's notifications in the active organization, newest first. `href` is the page in the web app the notification links to.",
          requestParams: { query: notificationListQuerySchema.omit({ page: true }) },
          responses: { "200": json(notificationPage, "A page of notifications"), ...errors(422) },
        }),
      },
      "/notifications/read": {
        post: op("Notifications", "Mark notifications as read", {
          operationId: "markNotificationsRead",
          description: "Send `ids` to mark some, or `all: true` to mark every unread notification.",
          requestParams: { header: idempotencyHeader },
          requestBody: body(notificationReadSchema),
          responses: {
            "200": json(
              z.object({ updated: z.number().int(), unread_count: z.number().int() }),
              "How many changed, and the unread count left",
            ),
            ...errors(415, 422),
          },
        }),
      },
      "/notifications/preferences": {
        get: op("Notifications", "Get my notification settings", {
          operationId: "getNotificationPreferences",
          description:
            "One row per event the user's role can receive. `email` is null for events that have no email.",
          responses: { "200": json(notificationPreferences, "Settings per event") },
        }),
        put: op("Notifications", "Change my notification settings", {
          operationId: "updateNotificationPreferences",
          description: "Events not listed keep their settings. Events of other roles are rejected (422).",
          requestBody: body(notificationPreferencesUpdateSchema),
          responses: { "200": json(notificationPreferences, "The saved settings"), ...errors(415, 422) },
        }),
      },
      "/stream": {
        get: op("Notifications", "Live events (server-sent events)", {
          operationId: "streamEvents",
          description:
            'A `text/event-stream` that stays open. Events: `notification` (a new notification for you, with its `id`), `job` (a job in your organization changed, with its `id`), `time_off` and `expense`. Each `data` is JSON `{ "kind", "id" }`; fetch the record to see the change. A comment line is sent every 25 seconds to keep the connection open; reconnect after an error.',
          responses: {
            "200": {
              description: "The event stream",
              content: { "text/event-stream": { schema: z.string() } },
            },
          },
        }),
      },
      "/customers": {
        get: op("Customers", "List customers", {
          operationId: "listCustomers",
          requestParams: { query: customerListQuerySchema.omit({ page: true }) },
          responses: { "200": json(customerPage, "A page of customers"), ...errors(422) },
        }),
        post: op("Customers", "Create a customer", {
          operationId: "createCustomer",
          description:
            "Contacts are created with the customer. Possible duplicates (same email or phone) are reported, not blocked.",
          requestParams: { header: idempotencyHeader },
          requestBody: body(customerCreateSchema),
          responses: { "201": json(customerCreatedSchema, "The new customer"), ...errors(400, 415, 422) },
        }),
      },
      "/customers/{id}": {
        get: op("Customers", "Get a customer", {
          operationId: "getCustomer",
          requestParams: { path: uuidParam("Customer") },
          responses: {
            "200": json(customerSchema, "The customer", etagHeader),
            "304": { description: "Not modified (If-None-Match)" },
            ...errors(404),
          },
        }),
        patch: op("Customers", "Update a customer", {
          operationId: "updateCustomer",
          requestParams: { path: uuidParam("Customer"), header: ifMatchHeader },
          requestBody: body(customerUpdateSchema),
          responses: {
            "200": json(customerSchema, "The updated customer", etagHeader),
            ...errors(404, 412, 415, 422),
          },
        }),
        delete: op("Customers", "Delete a customer", {
          operationId: "deleteCustomer",
          description: "Soft delete. Owners and admins only.",
          requestParams: { path: uuidParam("Customer") },
          responses: { "204": { description: "Deleted" }, ...errors(404) },
        }),
      },
      "/customers/{id}/sites": {
        get: op("Customers", "List a customer's sites", {
          operationId: "listSites",
          requestParams: { path: uuidParam("Customer") },
          responses: { "200": json(list(siteSchema, "SitePage"), "Sites"), ...errors(404) },
        }),
        post: op("Customers", "Add a site", {
          operationId: "createSite",
          requestParams: { path: uuidParam("Customer"), header: idempotencyHeader },
          requestBody: body(siteCreateSchema),
          responses: { "201": json(siteSchema, "The new site"), ...errors(404, 415, 422) },
        }),
      },
      "/sites/{id}": {
        get: op("Customers", "Get a site", {
          operationId: "getSite",
          requestParams: { path: uuidParam("Site") },
          responses: { "200": json(siteSchema, "The site"), ...errors(404) },
        }),
        patch: op("Customers", "Update a site", {
          operationId: "updateSite",
          requestParams: { path: uuidParam("Site") },
          requestBody: body(siteUpdateSchema),
          responses: { "200": json(siteSchema, "The updated site"), ...errors(404, 415, 422) },
        }),
      },
      "/sites/{id}/equipment": {
        get: op("Customers", "List equipment at a site", {
          operationId: "listSiteEquipment",
          requestParams: { path: uuidParam("Site") },
          responses: { "200": json(list(equipmentSchema, "EquipmentPage"), "Equipment"), ...errors(404) },
        }),
        post: op("Customers", "Add equipment to a site", {
          operationId: "createEquipment",
          description: "Owners, admins and dispatchers.",
          requestParams: { path: uuidParam("Site"), header: idempotencyHeader },
          requestBody: body(equipmentCreateSchema),
          responses: { "201": json(equipmentSchema, "The new unit"), ...errors(404, 415, 422) },
        }),
      },
      "/equipment/{id}": {
        get: op("Customers", "Get a unit of equipment", {
          operationId: "getEquipment",
          requestParams: { path: uuidParam("Equipment") },
          responses: { "200": json(equipmentSchema, "The unit"), ...errors(404) },
        }),
        patch: op("Customers", "Update a unit of equipment", {
          operationId: "updateEquipment",
          requestParams: { path: uuidParam("Equipment") },
          requestBody: body(equipmentUpdateSchema),
          responses: { "200": json(equipmentSchema, "The updated unit"), ...errors(404, 415, 422) },
        }),
      },
      "/schedule": {
        get: op("Schedule", "Visits and availability in a date range", {
          operationId: "getSchedule",
          description:
            "Scheduled visits overlapping the range (dates in the organization's time zone, at most 31 days), " +
            "with every technician's working hours and time off. Office roles only.",
          requestParams: {
            query: z.object({
              from: z.iso.date().meta({ example: "2026-11-10" }),
              to: z.iso.date().meta({ example: "2026-11-16" }),
              member: z.uuid().optional().meta({ description: "Only this member's lane and visits" }),
            }),
          },
          responses: { "200": json(scheduleSchema, "The schedule"), ...errors(404, 422) },
        }),
      },
      "/me/agenda": {
        get: op("Schedule", "My agenda", {
          operationId: "getMyAgenda",
          description: "The caller's assigned visits from today through the next seven days.",
          responses: { "200": json(agendaSchema, "The agenda"), ...errors() },
        }),
      },
      "/me": {
        get: op("Organization", "Current user", {
          operationId: "getMe",
          responses: { "200": json(meSchema, "The signed-in user, organization and role"), ...errors() },
        }),
      },
      "/members": {
        get: op("Organization", "List members", {
          operationId: "listMembers",
          description: "Owners, admins and dispatchers.",
          responses: {
            "200": json(list(memberSchema, "MemberPage"), "Members of the organization"),
            ...errors(),
          },
        }),
      },
      "/sla-policies": {
        get: op("Organization", "List SLA policies", {
          operationId: "listSlaPolicies",
          description:
            "Response (scheduled with a technician) and resolution (completed) targets per priority, in minutes. Priorities without a saved policy show the defaults (`is_default`).",
          responses: { "200": json(slaPolicyListSchema, "One policy per priority"), ...errors() },
        }),
        put: op("Organization", "Replace the SLA policies", {
          operationId: "updateSlaPolicies",
          description:
            "Owners and admins. Send all four priorities. New jobs and jobs whose priority changes get deadlines from these targets; existing deadlines stay. With `business_hours`, only the organization's business hours count.",
          requestBody: body(slaPoliciesUpdateSchema),
          responses: { "200": json(slaPolicyListSchema, "The saved policies"), ...errors(415, 422) },
        }),
      },
      "/service-types": {
        get: op("Organization", "List service types", {
          operationId: "listServiceTypes",
          requestParams: { query: z.object({ include_inactive: z.enum(["true", "false"]).optional() }) },
          responses: {
            "200": json(list(serviceTypeSchema, "ServiceTypePage"), "Service types"),
            ...errors(),
          },
        }),
      },
      ...billingPaths({
        op,
        json,
        body,
        errors,
        list,
        etagHeader,
        idempotencyHeader,
        ifMatchHeader,
        uuidParam,
      }),
    },
  });
  return cached;
}

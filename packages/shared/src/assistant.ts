import { z } from "zod";
import { ASSISTANT_ROLES, JOB_PRIORITIES, JOB_STATUSES } from "./constants";
import { trimmed, ts } from "./fields";

// Ask FieldOps (AI-02, PRD §9.3): a chat that answers questions about the organization's own data through
// read-only tools. The tools run on the server with the organization and role from the session; the model only
// picks a tool and its filters. Tool inputs below are what the model fills in: strict schemas (every field
// required, null for "not set") without numeric or length bounds, because the server clamps instead of failing.

export const ASSISTANT_TOOL_NAMES = [
  "search_jobs",
  "get_job",
  "list_sla_risks",
  "technician_workload",
  "revenue_summary",
  "customer_history",
  "pending_approvals",
] as const;
export type AssistantToolName = (typeof ASSISTANT_TOOL_NAMES)[number];

/** Tool calls allowed per question; later calls get an error result asking the model to answer. */
export const ASSISTANT_MAX_TOOL_CALLS = 8;
/** Rows a tool returns at most. */
export const ASSISTANT_MAX_ROWS = 50;
/** Conversations are deleted this many days after their last message. */
export const ASSISTANT_RETENTION_DAYS = 30;
export const ASSISTANT_MAX_QUESTION = 2000;
/** Earlier messages of a conversation sent with a new question. */
export const ASSISTANT_HISTORY_MESSAGES = 20;

export const ASSISTANT_RECORD_TYPES = ["job", "customer", "invoice", "expense"] as const;
export type AssistantRecordType = (typeof ASSISTANT_RECORD_TYPES)[number];

/** The PRD's example questions, offered as starters in the panel. */
export const ASSISTANT_STARTERS = ["slaRisks", "acJobs", "capacity"] as const;

// ---------------------------------------------------------------- tool inputs (model-facing)

const PART_OF_DAY = ["morning", "afternoon", "evening", "all_day"] as const;
export type PartOfDay = (typeof PART_OF_DAY)[number];

const localDate = (what: string) =>
  z.iso.date().nullable().describe(`${what} as YYYY-MM-DD in the organization's time zone, or null`);

export const assistantToolInputs = {
  search_jobs: z.strictObject({
    text: z.string().nullable().describe("Words to find in the job title or number, or null"),
    status: z.array(z.enum(JOB_STATUSES)).nullable().describe("Only these statuses, or null for any"),
    priority: z.array(z.enum(JOB_PRIORITIES)).nullable().describe("Only these priorities, or null for any"),
    technician: z.string().nullable().describe("A technician's name (or part of it), or null"),
    customer: z.string().nullable().describe("A customer's name (or part of it), or null"),
    service_type: z.string().nullable().describe("A service type's name (or part of it), e.g. 'AC repair'"),
    date_field: z
      .enum(["scheduled", "created", "completed"])
      .nullable()
      .describe("Which date `from` and `to` filter on; null means scheduled"),
    from: localDate("First day"),
    to: localDate("Last day (inclusive)"),
    sla: z
      .array(z.enum(["on_track", "at_risk", "breached", "met"]))
      .nullable()
      .describe("Only jobs whose current SLA state is one of these, or null"),
    unassigned: z.boolean().nullable().describe("true for jobs without a technician only"),
  }),
  get_job: z.strictObject({
    number: z.string().describe("The job number, e.g. JOB-000123 or 123"),
  }),
  list_sla_risks: z.strictObject({
    states: z
      .array(z.enum(["at_risk", "breached"]))
      .nullable()
      .describe("null for both at risk and breached"),
    due_by: localDate("Only targets due on or before the end of this day"),
  }),
  technician_workload: z.strictObject({
    from: localDate("First day; null means today"),
    to: localDate("Last day (inclusive); null means the same as from. At most 14 days"),
    part_of_day: z
      .enum(PART_OF_DAY)
      .nullable()
      .describe("morning is before 12:00, afternoon 12:00 to 17:00, evening after 17:00; null for all day"),
    technician: z.string().nullable().describe("One technician's name, or null for everyone"),
  }),
  revenue_summary: z.strictObject({
    from: localDate("First day; null means the first day of this month"),
    to: localDate("Last day (inclusive); null means today"),
    group_by: z
      .enum(["month", "service_type"])
      .nullable()
      .describe("Break the totals down by month or by service type; null for totals only"),
  }),
  customer_history: z.strictObject({
    customer: z.string().describe("The customer's name (or part of it)"),
  }),
  pending_approvals: z.strictObject({
    job: z.string().nullable().describe("Only requests on this job number, or null for all"),
  }),
} satisfies Record<AssistantToolName, z.ZodObject>;

export type AssistantToolInput<N extends AssistantToolName> = z.output<(typeof assistantToolInputs)[N]>;

// ---------------------------------------------------------------- records, tool runs and messages

/** A record a tool looked at, linked in the answer. */
export const assistantRecordRefSchema = z
  .object({
    type: z.enum(ASSISTANT_RECORD_TYPES),
    id: z.string(),
    label: z.string().meta({ description: "How the record is named in answers", example: "JOB-000123" }),
    href: z.string().meta({ description: "Its page in the web app", example: "/jobs/JOB-000123" }),
  })
  .meta({ id: "AssistantRecordRef" });
export type AssistantRecordRef = z.infer<typeof assistantRecordRefSchema>;

/** One tool call of an answer: what ran, a short summary and the records it returned. */
export const assistantToolRunSchema = z
  .object({
    name: z.enum(ASSISTANT_TOOL_NAMES),
    summary: z.string().meta({ example: "Looked up 12 jobs" }),
    count: z.number().int().meta({ description: "Records found (lists can show fewer)" }),
    ok: z.boolean().meta({ description: "False when the tool failed or wasn't allowed" }),
    refs: z.array(assistantRecordRefSchema),
  })
  .meta({ id: "AssistantToolRun" });
export type AssistantToolRun = z.infer<typeof assistantToolRunSchema>;

export const assistantAskSchema = z
  .object({
    conversation_id: z
      .uuid()
      .optional()
      .meta({ description: "Continue this conversation; omit to start one" }),
    message: trimmed(ASSISTANT_MAX_QUESTION).min(1),
  })
  .meta({ id: "AssistantQuestion" });
export type AssistantAskInput = z.output<typeof assistantAskSchema>;

export const assistantMessageSchema = z
  .object({
    id: z.uuid(),
    role: z.enum(ASSISTANT_ROLES),
    content: z.string(),
    tools: z.array(assistantToolRunSchema),
    created_at: ts,
  })
  .meta({ id: "AssistantMessage" });
export type AssistantMessageDto = z.infer<typeof assistantMessageSchema>;

export const assistantConversationSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    created_at: ts,
    updated_at: ts,
  })
  .meta({ id: "AssistantConversation" });
export type AssistantConversationDto = z.infer<typeof assistantConversationSchema>;

export const assistantConversationDetailSchema = assistantConversationSchema
  .extend({ messages: z.array(assistantMessageSchema) })
  .meta({ id: "AssistantConversationDetail" });
export type AssistantConversationDetailDto = z.infer<typeof assistantConversationDetailSchema>;

// ---------------------------------------------------------------- the answer stream

/**
 * Events of `POST /ai/assistant`, sent as server-sent events (`event: <type>`, `data: <json>`): the conversation,
 * text deltas, each tool starting and finishing, then `done` or `error`.
 */
export const assistantStreamEventSchema = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("conversation"),
      conversation_id: z.uuid(),
      title: z.string(),
    }),
    z.object({ type: z.literal("text"), delta: z.string() }),
    z.object({
      type: z.literal("tool_started"),
      call_id: z.string(),
      name: z.enum(ASSISTANT_TOOL_NAMES),
    }),
    z.object({
      type: z.literal("tool_finished"),
      call_id: z.string(),
      ...assistantToolRunSchema.shape,
    }),
    z.object({
      type: z.literal("done"),
      message_id: z.uuid(),
      refs: z.array(assistantRecordRefSchema).meta({ description: "Every record the tools returned" }),
    }),
    z.object({
      type: z.literal("error"),
      code: z.enum(["refused", "failed"]),
      message: z.string(),
    }),
  ])
  .meta({ id: "AssistantStreamEvent" });
export type AssistantStreamEvent = z.infer<typeof assistantStreamEventSchema>;

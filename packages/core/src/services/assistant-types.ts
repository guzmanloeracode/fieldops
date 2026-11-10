import type {
  AssistantRole,
  AssistantToolName,
  AssistantToolRun,
  InvoiceStatus,
  Role,
} from "@fieldops/shared";
import type { z } from "zod";
import type { AiProvider, AiUsage } from "./ai-types";

// Ask FieldOps (AI-02, PRD §9.3): conversations, the repository queries behind the read-only tools that other
// repositories don't already answer, and the model port. The Anthropic implementation and the deterministic fixture
// live in packages/ai; the core binds the tools to the signed-in member, so the model never chooses the
// organization or the role.

export interface AssistantConversationRecord {
  id: string;
  userId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AssistantMessageRecord {
  id: string;
  conversationId: string;
  role: AssistantRole;
  content: string;
  tools: AssistantToolRun[];
  aiInteractionId: string | null;
  createdAt: Date;
}

/** Revenue for a period in local dates (FIN, DSH-01 definitions): issued invoices, payments, open balances. */
export interface RevenueQuery {
  from: string;
  to: string;
  timeZone: string;
  /** Today in the organization's time zone: open invoices due before it are overdue. */
  today: string;
  groupBy: "month" | "service_type" | null;
}

export interface RevenueTotals {
  /** Invoices issued in the period that aren't void. */
  invoicedMinor: number;
  invoiceCount: number;
  /** Payments received in the period. */
  collectedMinor: number;
  paymentCount: number;
  /** Open balance of sent and overdue invoices now, and the part of it past due. */
  outstandingMinor: number;
  overdueMinor: number;
  openInvoiceCount: number;
}

export interface RevenueBreakdownRow {
  /** "2026-10" for months, the service type id (or "none") for service types. */
  key: string;
  label: string;
  invoicedMinor: number;
  collectedMinor: number;
}

export interface OpenInvoiceRow {
  id: string;
  number: string;
  status: InvoiceStatus;
  totalMinor: number;
  balanceMinor: number;
  currency: string;
  issueDate: string | null;
  dueDate: string | null;
}

export interface AssistantRepo {
  createConversation(data: { userId: string; title: string }): Promise<AssistantConversationRecord>;
  /** The user's own conversation; null for anyone else's. */
  getConversation(id: string, userId: string): Promise<AssistantConversationRecord | null>;
  /** The user's conversations with a message since `since`, most recent first. */
  listConversations(
    userId: string,
    opts: { since: Date; limit: number },
  ): Promise<AssistantConversationRecord[]>;
  deleteConversation(id: string, userId: string): Promise<boolean>;
  /** Marks the conversation as just used (its retention starts again). */
  touchConversation(id: string): Promise<void>;
  addMessage(data: {
    conversationId: string;
    role: AssistantRole;
    content: string;
    tools: AssistantToolRun[];
    aiInteractionId: string | null;
  }): Promise<AssistantMessageRecord>;
  /** Messages oldest first; with `last`, only the newest `last` of them (still oldest first). */
  listMessages(conversationId: string, opts?: { last?: number }): Promise<AssistantMessageRecord[]>;
  revenue(
    q: RevenueQuery,
  ): Promise<{ currency: string | null; totals: RevenueTotals; rows: RevenueBreakdownRow[] }>;
  /** A customer's sent and overdue invoices with a balance, oldest due first. */
  openInvoices(customerId: string, limit: number): Promise<OpenInvoiceRow[]>;
}

// ------------------------------------------------------------------ the model port

/** Facts the model needs about who is asking and when; sent after the cached prompt. */
export interface AssistantContext {
  organizationName: string;
  timeZone: string;
  currency: string;
  /** Local date and time in the organization's time zone: "2026-11-10", "14:05", "Tuesday". */
  today: string;
  time: string;
  weekday: string;
  userName: string;
  role: Role;
}

/** A tool bound to the signed-in member. `execute` validates the input again and never throws. */
export interface AssistantTool {
  name: AssistantToolName;
  description: string;
  input: z.ZodObject;
  /** Returns the result for the model: compact JSON wrapped as data. */
  execute(input: unknown): Promise<string>;
}

export interface AssistantModelInput {
  context: AssistantContext;
  /** Earlier questions and answers of the conversation, oldest first. */
  history: { role: AssistantRole; content: string }[];
  question: string;
  tools: AssistantTool[];
  onText(delta: string): void;
  signal?: AbortSignal;
}

interface AssistantCallInfo {
  model: string;
  usage: AiUsage;
  stopReason: string | null;
  latencyMs: number;
  /** Everything streamed so far (part of an answer when it was cut short). */
  text: string;
}

/** A model call never throws: refusals and errors come back as results. */
export type AssistantModelResult =
  | (AssistantCallInfo & { kind: "answer" })
  | (AssistantCallInfo & { kind: "refused"; error: string | null })
  | (AssistantCallInfo & { kind: "failed"; error: string });

export interface AssistantModel {
  readonly provider: AiProvider;
  readonly model: string;
  answer(input: AssistantModelInput): Promise<AssistantModelResult>;
}

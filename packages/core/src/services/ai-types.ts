import type { AiFeature, AiImageType, AiOutcome, AiStatus, Currency } from "@fieldops/shared";
import type { ServiceContext, Store } from "./types";

// AI usage logging (§9.7) and smart intake (AI-01). The model sits behind the `IntakeModel` port: the
// Anthropic implementation and the deterministic fixture live in packages/ai, so the core stays framework-free
// and every rule here is tested without calling a model.

export interface AiInteractionInput {
  userId: string | null;
  jobId: string | null;
  feature: AiFeature;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  latencyMs: number;
  stopReason: string | null;
  outcome: AiOutcome;
  output: unknown;
  error: string | null;
}

export interface AiInteractionRecord {
  id: string;
  userId: string | null;
  jobId: string | null;
  feature: AiFeature;
  model: string;
  outcome: AiOutcome;
  output: unknown;
  createdAt: Date;
}

/** This month's AI use for the settings page (SET-04). */
export interface AiUsageSummary {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  avgLatencyMs: number;
  outcomes: Record<AiOutcome, number>;
}

export interface AiRepo {
  logInteraction(row: AiInteractionInput): Promise<{ id: string }>;
  getInteraction(id: string): Promise<AiInteractionRecord | null>;
  /** Changes a "drafted" interaction's outcome once; returns false when it was already decided. */
  setOutcome(id: string, outcome: AiOutcome, jobId?: string | null): Promise<boolean>;
  /** Calls since a time, for the monthly quota. */
  countSince(since: Date): Promise<number>;
  usageSince(since: Date): Promise<AiUsageSummary>;
  /** The newest intake interaction with a draft for a job (portal requests). */
  latestDraft(jobId: string): Promise<AiInteractionRecord | null>;
  /** Sets a job's AI drafting status without counting as an edit (no version bump). */
  setJobStatus(jobId: string, status: AiStatus): Promise<void>;
  /**
   * Counts one hit in a fixed window (PLT-04). Keys name their own scope ("ai:user:<id>"); the counter is shared
   * by every organization, which is what a per-visitor or global limit needs.
   */
  hitRateLimit(key: string, windowSeconds: number, now: Date): Promise<{ count: number; resetAt: Date }>;
}

// ------------------------------------------------------------------ the model port

export type AiProvider = "anthropic" | "fixture" | "unavailable";

/** What the model knows about the organization. Stable per organization, so it is cached (§9.7). */
export interface IntakeCatalog {
  organizationName: string;
  country: string;
  currency: Currency;
  serviceTypes: {
    id: string;
    name: string;
    description: string | null;
    defaultDurationMin: number;
    requiredSkills: string[];
  }[];
  skills: string[];
}

export interface IntakePhoto {
  mediaType: AiImageType;
  /** Base64, no data: prefix. */
  data: string;
}

export interface IntakeModelInput {
  message: string;
  photos: IntakePhoto[];
  catalog: IntakeCatalog;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

interface ModelCallInfo {
  model: string;
  usage: AiUsage;
  stopReason: string | null;
  latencyMs: number;
}

/** A model call never throws: errors and refusals come back as results, and the UI falls back to the form. */
export type IntakeModelResult =
  | (ModelCallInfo & { kind: "draft"; output: unknown })
  | (ModelCallInfo & { kind: "refused"; error: string | null })
  | (ModelCallInfo & { kind: "failed"; error: string });

export interface IntakeModel {
  readonly provider: AiProvider;
  readonly model: string;
  draft(input: IntakeModelInput): Promise<IntakeModelResult>;
}

/** Rate limits for AI routes (PLT-04, DEM-05). Zero or null turns a limit off. */
export interface AiLimits {
  perUserPerHour: number;
  /** Per visitor (IP address) per day; the public demo only. */
  perVisitorPerDay: number | null;
  /** Every organization together, per day: the global budget switch (§9.7). */
  globalPerDay: number;
}

export interface RateLimitStatus {
  limit: number;
  remaining: number;
  resetAt: Date;
}

/** Runs a function in its own tenant transaction, as the signed-in member. */
export type TxRunner = <T>(fn: (ctx: ServiceContext) => Promise<T>) => Promise<T>;
/** Runs a function in its own tenant transaction without a member (the worker). */
export type StoreRunner = <T>(fn: (store: Store) => Promise<T>) => Promise<T>;

import type { HoldReason, JobStatus } from "@fieldops/shared";
import { can, type Actor } from "./permissions";
import { DomainError, ForbiddenError } from "./errors";

/**
 * The job lifecycle from PRD §8.3. Every allowed move is listed here; anything else is rejected.
 * `by: "office"` moves need jobs.update (or jobs.reopen); `by: "work"` moves are open to the assigned
 * technician as well (jobs.work).
 */
export interface TransitionRule {
  from: JobStatus;
  to: JobStatus;
  name: TransitionName;
  by: "office" | "work" | "reopen";
  requiresReason?: boolean;
}

export type TransitionName =
  | "schedule"
  | "unschedule"
  | "cancel"
  | "depart"
  | "start"
  | "hold"
  | "resume"
  | "reschedule"
  | "complete"
  | "reopen";

export const TRANSITIONS: readonly TransitionRule[] = [
  { from: "new", to: "scheduled", name: "schedule", by: "office" },
  { from: "new", to: "canceled", name: "cancel", by: "office", requiresReason: true },
  { from: "scheduled", to: "new", name: "unschedule", by: "office" },
  { from: "scheduled", to: "en_route", name: "depart", by: "work" },
  { from: "scheduled", to: "in_progress", name: "start", by: "work" },
  { from: "scheduled", to: "canceled", name: "cancel", by: "office", requiresReason: true },
  { from: "en_route", to: "in_progress", name: "start", by: "work" },
  { from: "in_progress", to: "on_hold", name: "hold", by: "work", requiresReason: true },
  { from: "on_hold", to: "in_progress", name: "resume", by: "work" },
  { from: "on_hold", to: "scheduled", name: "reschedule", by: "office" },
  { from: "in_progress", to: "completed", name: "complete", by: "work" },
  { from: "completed", to: "in_progress", name: "reopen", by: "reopen", requiresReason: true },
];

export const STATUS_LABELS: Record<JobStatus, string> = {
  new: "New",
  scheduled: "Scheduled",
  en_route: "En route",
  in_progress: "In progress",
  on_hold: "On hold",
  completed: "Completed",
  canceled: "Canceled",
};

export const TERMINAL_STATUSES: readonly JobStatus[] = ["completed", "canceled"];
export const OPEN_STATUSES: readonly JobStatus[] = ["new", "scheduled", "en_route", "in_progress", "on_hold"];

export interface TransitionFacts {
  /** The actor is assigned to this job. */
  assigned: boolean;
  /** At least one technician is assigned. */
  hasAssignee: boolean;
  /** Scheduled start and end are set. */
  hasSchedule: boolean;
  /** Labels of required checklist items that are not done (JOB-08). */
  missingRequiredItems: readonly string[];
  /** The organization requires a customer signature and none has been captured (JOB-10). */
  signatureMissing?: boolean;
}

export interface TransitionRequest {
  to: JobStatus;
  reason?: string | null;
  holdReason?: HoldReason | null;
}

export class InvalidTransitionError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("invalid_transition", message, details);
  }
}

export function findTransition(from: JobStatus, to: JobStatus): TransitionRule | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.to === to);
}

function actorMayRun(actor: Pick<Actor, "role">, rule: TransitionRule, assigned: boolean): boolean {
  switch (rule.by) {
    case "office":
      return can(actor, "jobs.update");
    case "reopen":
      return can(actor, "jobs.reopen");
    case "work":
      return can(actor, "jobs.work", { assigned });
  }
}

/**
 * Validates a status change and returns the matching rule. Throws ForbiddenError when the actor may not
 * make the move and InvalidTransitionError when the move or its preconditions are not met.
 */
export function assertTransition(
  actor: Pick<Actor, "role">,
  from: JobStatus,
  request: TransitionRequest,
  facts: TransitionFacts,
): TransitionRule {
  const rule = findTransition(from, request.to);
  if (!rule) {
    throw new InvalidTransitionError(
      `A job can't move from ${STATUS_LABELS[from]} to ${STATUS_LABELS[request.to]}`,
      {
        from,
        to: request.to,
      },
    );
  }
  if (!actorMayRun(actor, rule, facts.assigned)) throw new ForbiddenError();

  if (rule.requiresReason && !request.reason?.trim()) {
    throw new InvalidTransitionError("A reason is required for this change", { field: "reason" });
  }
  if (rule.name === "hold" && !request.holdReason) {
    throw new InvalidTransitionError("Choose what the job is waiting for", { field: "hold_reason" });
  }
  if ((rule.to === "scheduled" || rule.name === "depart" || rule.name === "start") && !facts.hasAssignee) {
    throw new InvalidTransitionError("Assign a technician first", { missing: ["assignee"] });
  }
  if (rule.to === "scheduled" && !facts.hasSchedule) {
    throw new InvalidTransitionError("Set a scheduled time first", { missing: ["schedule"] });
  }
  if (rule.name === "complete" && facts.missingRequiredItems.length > 0) {
    throw new InvalidTransitionError("Finish the required checklist items first", {
      missing: [...facts.missingRequiredItems],
    });
  }
  if (rule.name === "complete" && facts.signatureMissing) {
    throw new InvalidTransitionError("Capture the customer's signature first", { missing: ["signature"] });
  }
  return rule;
}

/** The moves this actor could attempt from the current status, for rendering action buttons. */
export function availableTransitions(
  actor: Pick<Actor, "role">,
  from: JobStatus,
  facts: Pick<TransitionFacts, "assigned">,
): TransitionRule[] {
  return TRANSITIONS.filter((t) => t.from === from && actorMayRun(actor, t, facts.assigned));
}

export function isOpen(status: JobStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

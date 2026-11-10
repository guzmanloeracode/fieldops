import {
  DEFAULT_SLA_TARGETS,
  SLA_AT_RISK_SHARE,
  type JobPriority,
  type JobStatus,
  type SlaState,
  type SlaTarget,
} from "@fieldops/shared";
import {
  hhmmToMinutes,
  localDateOf,
  shiftDate,
  workingWindows,
  zonedInstant,
  type WorkingHoursEntry,
} from "./availability";

// SLA deadlines and states (SLA-01, SLA-02). Pure functions: the services store the results on each job,
// and the monitor (SLA-03) moves open jobs along as time passes.

const MINUTE = 60_000;
/** A business-hours window can't need more than ten years of calendar to fit. */
const MAX_DAYS = 3660;

/** The targets that apply to a priority: a stored policy or the defaults. */
export interface SlaTargets {
  responseMin: number;
  resolutionMin: number;
  /** Count only business hours instead of calendar time. */
  businessHours: boolean;
}

export interface SlaDeadlines {
  responseDueAt: Date;
  resolutionDueAt: Date;
  /** When SLA_AT_RISK_SHARE of each window is used, in the same time basis. */
  responseAtRiskAt: Date;
  resolutionAtRiskAt: Date;
}

/** Calendar-time defaults for a priority, used when the organization has no policy for it. */
export function defaultTargets(priority: JobPriority): SlaTargets {
  const d = DEFAULT_SLA_TARGETS[priority];
  return { responseMin: d.responseMin, resolutionMin: d.resolutionMin, businessHours: false };
}

/** True when the hours contain at least one usable window (close after open). */
function hasWindows(hours: readonly WorkingHoursEntry[]): boolean {
  return hours.some((h) => hhmmToMinutes(h.close) > hhmmToMinutes(h.open));
}

/**
 * The instants after each of `minutes` of business time from `start`: time only runs inside the working
 * windows, in the organization's time zone. A start outside business hours begins at the next opening. Without
 * any usable hours, every minute counts (calendar time). One walk over the calendar serves every offset.
 */
export function addBusinessMinutesEach(
  start: Date,
  minutes: readonly number[],
  hours: readonly WorkingHoursEntry[],
  timeZone: string,
): Date[] {
  if (!hasWindows(hours)) return minutes.map((m) => new Date(start.getTime() + Math.max(0, m) * MINUTE));
  const out: Date[] = new Array<Date>(minutes.length);
  const order = minutes.map((m, i) => ({ ms: Math.max(0, m) * MINUTE, i })).sort((a, b) => a.ms - b.ms);
  let k = 0;
  while (k < order.length && order[k]!.ms === 0) out[order[k++]!.i] = new Date(start);
  let used = 0;
  let cursor = start.getTime();
  let date = localDateOf(start, timeZone);
  for (let day = 0; k < order.length; day++, date = shiftDate(date, 1)) {
    if (day >= MAX_DAYS) throw new RangeError("The SLA window doesn't fit in the business hours");
    for (const w of workingWindows(hours, date, timeZone)) {
      const end = w.end.getTime();
      if (end <= cursor) continue;
      const from = Math.max(w.start.getTime(), cursor);
      while (k < order.length && order[k]!.ms - used <= end - from) {
        out[order[k]!.i] = new Date(from + order[k]!.ms - used);
        k += 1;
      }
      used += end - from;
      cursor = end;
      if (k === order.length) break;
    }
  }
  return out;
}

/** The instant after `minutes` of business time from `start` (see addBusinessMinutesEach). */
export function addBusinessMinutes(
  start: Date,
  minutes: number,
  hours: readonly WorkingHoursEntry[],
  timeZone: string,
): Date {
  return addBusinessMinutesEach(start, [minutes], hours, timeZone)[0]!;
}

/** Deadlines for a job created at `createdAt` under a policy (SLA-02). */
export function slaDeadlines(input: {
  createdAt: Date;
  policy: SlaTargets;
  businessHours: readonly WorkingHoursEntry[];
  timeZone: string;
}): SlaDeadlines {
  const { createdAt, policy, timeZone } = input;
  const [responseDueAt, resolutionDueAt, responseAtRiskAt, resolutionAtRiskAt] = addBusinessMinutesEach(
    createdAt,
    [
      policy.responseMin,
      policy.resolutionMin,
      policy.responseMin * SLA_AT_RISK_SHARE,
      policy.resolutionMin * SLA_AT_RISK_SHARE,
    ],
    policy.businessHours ? input.businessHours : [],
    timeZone,
  );
  return {
    responseDueAt: responseDueAt!,
    resolutionDueAt: resolutionDueAt!,
    responseAtRiskAt: responseAtRiskAt!,
    resolutionAtRiskAt: resolutionAtRiskAt!,
  };
}

/**
 * The state of one target. Done on time is "met", done late or not done past the deadline is "breached",
 * not done after the at-risk point is "at risk". Without a deadline there is no state.
 */
export function slaState(input: {
  dueAt: Date | null;
  atRiskAt: Date | null;
  doneAt: Date | null;
  now: Date;
}): SlaState | null {
  const { dueAt, atRiskAt, doneAt, now } = input;
  if (!dueAt) return null;
  if (doneAt) return doneAt <= dueAt ? "met" : "breached";
  if (now > dueAt) return "breached";
  if (atRiskAt && now >= atRiskAt) return "at_risk";
  return "on_track";
}

/** Severity order: breached is the worst, met the best. */
export const SLA_RANK: Record<SlaState, number> = { met: 0, on_track: 1, at_risk: 2, breached: 3 };

export interface SlaFacts {
  status: JobStatus;
  firstScheduledAt: Date | null;
  responseDueAt: Date | null;
  resolutionDueAt: Date | null;
  slaResponseState: SlaState | null;
  slaResolutionState: SlaState | null;
}

export interface CurrentSla {
  target: SlaTarget;
  state: SlaState;
  dueAt: Date | null;
}

/**
 * The job's current SLA: the worse of its open targets (response until first scheduled, resolution until
 * completed). Completed jobs report the resolution outcome; canceled jobs have none. Same rule as the jobs
 * list filter `sla` and the dashboard's at-risk list.
 */
export function currentSla(job: SlaFacts): CurrentSla | null {
  if (job.status === "canceled") return null;
  const resolution = job.slaResolutionState
    ? { target: "resolution" as const, state: job.slaResolutionState, dueAt: job.resolutionDueAt }
    : null;
  if (job.status === "completed" || job.firstScheduledAt || !job.slaResponseState) return resolution;
  const response = { target: "response" as const, state: job.slaResponseState, dueAt: job.responseDueAt };
  if (!resolution) return response;
  return SLA_RANK[response.state] >= SLA_RANK[resolution.state] ? response : resolution;
}

/** True for the states that need a dispatcher's attention. */
export function needsAttention(state: SlaState | null | undefined): state is "at_risk" | "breached" {
  return state === "at_risk" || state === "breached";
}

// ---------------------------------------------------------------- pause (SLA-04)

/** On hold waiting for the customer pauses the resolution clock (SLA-04); other holds don't. */
export function pausesResolution(status: JobStatus, holdReason: string | null | undefined): boolean {
  return status === "on_hold" && holdReason === "customer";
}

/**
 * Minutes between two instants in a time basis: with working hours, only the minutes inside the windows (in the
 * organization's time zone) count; without any usable hours, every minute counts. Rounded to whole minutes.
 */
export function elapsedMinutes(
  from: Date,
  to: Date,
  hours: readonly WorkingHoursEntry[],
  timeZone: string,
): number {
  if (to <= from) return 0;
  if (!hasWindows(hours)) return Math.round((to.getTime() - from.getTime()) / MINUTE);
  let ms = 0;
  const last = localDateOf(to, timeZone);
  let date = localDateOf(from, timeZone);
  for (let day = 0; date <= last; day++, date = shiftDate(date, 1)) {
    if (day >= MAX_DAYS) throw new RangeError("The span is too long to count in business hours");
    for (const w of workingWindows(hours, date, timeZone)) {
      const start = Math.max(w.start.getTime(), from.getTime());
      const end = Math.min(w.end.getTime(), to.getTime());
      if (end > start) ms += end - start;
    }
  }
  return Math.round(ms / MINUTE);
}

export interface SlaPauseEnd {
  /** Length of this pause in the policy's time basis. */
  minutes: number;
  /** The job's total paused minutes after this pause. */
  slaPausedMinutes: number;
  resolutionDueAt: Date | null;
  resolutionAtRiskAt: Date | null;
}

/**
 * Ends a pause of the resolution clock: measures it in the policy's basis (business minutes for business-hours
 * policies, calendar minutes otherwise) and moves the resolution deadline and its at-risk point by the same
 * amount in the same basis, so a job that waited for the customer gets that time back.
 */
export function endSlaPause(input: {
  pausedAt: Date;
  now: Date;
  pausedMinutes: number;
  resolutionDueAt: Date | null;
  resolutionAtRiskAt: Date | null;
  businessHours: boolean;
  hours: readonly WorkingHoursEntry[];
  timeZone: string;
}): SlaPauseEnd {
  const hours = input.businessHours ? input.hours : [];
  const minutes = elapsedMinutes(input.pausedAt, input.now, hours, input.timeZone);
  const shift = (d: Date | null) =>
    d && minutes > 0 ? addBusinessMinutes(d, minutes, hours, input.timeZone) : d;
  return {
    minutes,
    slaPausedMinutes: input.pausedMinutes + minutes,
    resolutionDueAt: shift(input.resolutionDueAt),
    resolutionAtRiskAt: shift(input.resolutionAtRiskAt),
  };
}

/**
 * Deadlines shifted by the minutes a job has already been paused, for a recomputation from the clock start (a
 * priority change) that must keep the time the job waited for the customer.
 */
export function withPausedMinutes(
  deadlines: SlaDeadlines,
  pausedMinutes: number,
  basis: { businessHours: boolean; hours: readonly WorkingHoursEntry[]; timeZone: string },
): SlaDeadlines {
  if (pausedMinutes <= 0) return deadlines;
  const hours = basis.businessHours ? basis.hours : [];
  const [resolutionDueAt, resolutionAtRiskAt] = [deadlines.resolutionDueAt, deadlines.resolutionAtRiskAt].map(
    (d) => addBusinessMinutes(d, pausedMinutes, hours, basis.timeZone),
  );
  return { ...deadlines, resolutionDueAt: resolutionDueAt!, resolutionAtRiskAt: resolutionAtRiskAt! };
}

/**
 * When a job's SLA clock starts: when it was created, or for a job a maintenance plan generated ahead of time
 * (JOB-13), the start of its visit date in the organization's time zone. A job generated weeks ahead isn't late
 * before its visit is due.
 */
export function slaClockStart(
  job: { createdAt: Date; occurrenceDate: string | null },
  timeZone: string,
): Date {
  if (!job.occurrenceDate) return job.createdAt;
  const visitDay = zonedInstant(job.occurrenceDate, 0, timeZone);
  return visitDay > job.createdAt ? visitDay : job.createdAt;
}

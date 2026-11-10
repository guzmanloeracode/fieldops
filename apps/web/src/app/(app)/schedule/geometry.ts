import { fromLocalInput } from "@/lib/format";
import type { BoardJob, BoardLane } from "./board-data";

// Layout math for the dispatch board. Times are wall-clock minutes in the organization's time zone.

/** Pixels per minute in the day view: one hour is 96 px, a 15-minute step 24 px. */
export const PX_PER_MIN = 1.6;
export const STEP_MIN = 15;
export const STEP_PX = STEP_MIN * PX_PER_MIN;
export const ROW_PX = 52;
export const BLOCK_PX = 46;
export const DEFAULT_RANGE: [number, number] = [6 * 60, 20 * 60];

export const snap = (minutes: number) => Math.round(minutes / STEP_MIN) * STEP_MIN;

export function hhmm(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** ISO instant of `minutes` after local midnight of `date` (minutes may pass midnight). */
export function toIso(date: string, minutes: number, timeZone: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.floor(minutes / 1440));
  return fromLocalInput(`${d.toISOString().slice(0, 10)}T${hhmm(minutes)}`, timeZone)!;
}

/** Minutes of the job relative to midnight of another date. */
export function relativeTo(job: BoardJob, date: string): { start: number; end: number } {
  const offset = job.date
    ? (Date.parse(`${job.date}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 60_000
    : 0;
  return { start: job.startMin + offset, end: job.endMin + offset };
}

/** The visible time range of a day: 06:00–20:00, widened to whole hours to fit visits and working hours. */
export function dayRange(lanes: BoardLane[], jobs: BoardJob[], date: string): [number, number] {
  let [from, to] = DEFAULT_RANGE;
  for (const l of lanes) {
    for (const [a, b] of l.days.find((d) => d.date === date)?.hours ?? []) {
      from = Math.min(from, a);
      to = Math.max(to, b);
    }
  }
  for (const j of jobs) {
    const r = relativeTo(j, date);
    if (r.end <= 0 || r.start >= 1440) continue;
    from = Math.min(from, Math.max(0, r.start));
    to = Math.max(to, Math.min(1440, r.end));
  }
  return [Math.floor(from / 60) * 60, Math.ceil(to / 60) * 60];
}

/** Stacks overlapping blocks into rows: returns the row of each job and the number of rows. */
export function stackRows<T extends { id: string; start: number; end: number }>(
  items: T[],
): { rows: Map<string, number>; count: number } {
  const ends: number[] = [];
  const rows = new Map<string, number>();
  for (const it of [...items].sort((a, b) => a.start - b.start || a.end - b.end)) {
    let row = ends.findIndex((e) => e <= it.start);
    if (row < 0) row = ends.length;
    ends[row] = it.end;
    rows.set(it.id, row);
  }
  return { rows, count: Math.max(1, ends.length) };
}

/** Earliest free start (snapped) in a lane's day for the week view, after the working day opens. */
export function firstFreeStart(lane: BoardLane, date: string, jobs: BoardJob[], durationMin: number): number {
  const day = lane.days.find((d) => d.date === date);
  const open = day?.hours[0]?.[0] ?? 8 * 60;
  const taken = jobs
    .filter((j) => j.date === date && j.assignees.some((a) => a.memberId === lane.id))
    .map((j) => [j.startMin, j.endMin] as const)
    .sort((a, b) => a[0] - b[0]);
  let start = open;
  for (const [a, b] of taken) {
    if (a >= start + durationMin) break;
    if (b > start) start = b;
  }
  return Math.ceil(start / STEP_MIN) * STEP_MIN;
}

/** Replaces the member of the source lane with the target lane's member; the lead stays the lead. */
export function moveAssignees(
  assignees: BoardJob["assignees"],
  from: string,
  to: { id: string; name: string },
): BoardJob["assignees"] {
  if (from === to.id) return assignees;
  return assignees
    .filter((a) => a.memberId !== to.id || a.memberId === from)
    .map((a) => (a.memberId === from ? { ...a, memberId: to.id, name: to.name } : a))
    .map((a, _i, all) => (all.some((x) => x.isLead) ? a : { ...a, isLead: a.memberId === to.id }));
}

import { availability, formatJobNumber, type JobView, type schedule } from "@fieldops/core";
import type { JobPriority, JobStatus } from "@fieldops/shared";

// Turns the core Board into plain, serializable props for the client board. Positions are wall-clock
// minutes in the organization's time zone, so the client never does time zone math for layout.

export type BoardView = "day" | "week";

export interface BoardJob {
  id: string;
  number: string;
  title: string;
  status: JobStatus;
  priority: JobPriority;
  customer: string;
  site: string;
  serviceType: string | null;
  /** Local date of the start ("YYYY-MM-DD"); null in the queue. */
  date: string | null;
  /** Minutes after local midnight of `date`. The end can pass 1440 for a visit that runs past midnight. */
  startMin: number;
  endMin: number;
  durationMin: number;
  assignees: { memberId: string; name: string; isLead: boolean }[];
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
}

export interface LaneDay {
  date: string;
  /** Working windows in local minutes. Empty on a day off. */
  hours: [number, number][];
  /** Time off on this day, clipped to it, in local minutes. */
  off: { startMin: number; endMin: number; reason: string | null }[];
}

export interface BoardLane {
  id: string;
  name: string;
  role: string;
  skills: string[];
  customHours: boolean;
  days: LaneDay[];
}

export interface BoardProps {
  view: BoardView;
  date: string;
  dates: string[];
  today: string;
  timeZone: string;
  lanes: BoardLane[];
  jobs: BoardJob[];
  queue: BoardJob[];
  technician: string | null;
}

const minutesOn = (instant: Date, date: string, timeZone: string) =>
  (Date.parse(`${availability.localDateOf(instant, timeZone)}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) /
    60_000 +
  availability.localMinutesOf(instant, timeZone);

export function toBoardJob(j: JobView, timeZone: string): BoardJob {
  const date = j.scheduledStart ? availability.localDateOf(j.scheduledStart, timeZone) : null;
  const startMin = j.scheduledStart && date ? minutesOn(j.scheduledStart, date, timeZone) : 0;
  const endMin = j.scheduledEnd && date ? minutesOn(j.scheduledEnd, date, timeZone) : 0;
  const planned = j.estimatedDurationMin ?? 60;
  return {
    id: j.id,
    number: formatJobNumber(j.number),
    title: j.title,
    status: j.status,
    priority: j.priority,
    customer: j.customer.name,
    site: [j.site.address.line1, j.site.address.city].filter(Boolean).join(", "),
    serviceType: j.serviceType?.name ?? null,
    date,
    startMin,
    endMin,
    durationMin: date ? Math.max(15, endMin - startMin) : Math.max(15, Math.round(planned / 15) * 15),
    assignees: j.assignees.map((a) => ({ memberId: a.memberId, name: a.name, isLead: a.isLead })),
    latitude: j.site.latitude,
    longitude: j.site.longitude,
    createdAt: j.createdAt.toISOString(),
  };
}

function laneDays(lane: schedule.Board["lanes"][number], dates: string[], timeZone: string): LaneDay[] {
  return dates.map((date) => {
    const dayStart = availability.zonedInstant(date, 0, timeZone);
    const dayEnd = availability.zonedInstant(availability.shiftDate(date, 1), 0, timeZone);
    const dow = availability.dayOfWeek(date);
    const hours = lane.workingHours
      .filter((h) => h.day === dow)
      .map(
        (h) => [availability.hhmmToMinutes(h.open), availability.hhmmToMinutes(h.close)] as [number, number],
      )
      .filter(([a, b]) => b > a)
      .sort((a, b) => a[0] - b[0]);
    const off = lane.timeOff
      .filter((t) => t.startsAt < dayEnd && t.endsAt > dayStart)
      .map((t) => ({
        startMin: t.startsAt <= dayStart ? 0 : minutesOn(t.startsAt, date, timeZone),
        endMin: t.endsAt >= dayEnd ? 24 * 60 : minutesOn(t.endsAt, date, timeZone),
        reason: t.reason,
      }));
    return { date, hours, off };
  });
}

export function toBoardProps(
  board: schedule.Board,
  opts: { view: BoardView; date: string; dates: string[]; today: string; technician: string | null },
): BoardProps {
  return {
    ...opts,
    timeZone: board.timeZone,
    lanes: board.lanes.map((l) => ({
      id: l.member.id,
      name: l.member.name,
      role: l.member.role,
      skills: l.member.skills,
      customHours: l.customHours,
      days: laneDays(l, opts.dates, board.timeZone),
    })),
    jobs: board.jobs.map((j) => toBoardJob(j, board.timeZone)),
    queue: board.unscheduled.map((j) => toBoardJob(j, board.timeZone)),
  };
}

/** Monday of the week containing the date. */
export function weekStart(date: string): string {
  const dow = availability.dayOfWeek(date);
  return availability.shiftDate(date, -((dow + 6) % 7));
}

import type { JobView, WorkingHours } from "./types";

// Repository contracts for scheduling and availability (SCH-01–05).

export interface TimeOffRecord {
  id: string;
  memberId: string;
  startsAt: Date;
  endsAt: Date;
  reason: string | null;
  createdAt: Date;
}

export interface AvailabilityRepo {
  /** Sets a member's working hours (null = business hours) and/or skills. False when the member isn't found. */
  updateMember(
    memberId: string,
    patch: { workingHours?: WorkingHours[] | null; skills?: string[] },
  ): Promise<boolean>;
  /** Time off overlapping [from, to), optionally for some members only, ordered by start. */
  listTimeOff(opts: { from: Date; to: Date; memberIds?: string[] }): Promise<TimeOffRecord[]>;
  getTimeOff(id: string): Promise<TimeOffRecord | null>;
  createTimeOff(data: {
    memberId: string;
    startsAt: Date;
    endsAt: Date;
    reason: string | null;
    createdBy: string;
  }): Promise<TimeOffRecord>;
  removeTimeOff(id: string): Promise<boolean>;
}

export interface ScheduleRepo {
  /** Jobs (except canceled) whose visit overlaps [from, to), ordered by start; optionally one member's only. */
  scheduled(opts: { from: Date; to: Date; memberId?: string }): Promise<JobView[]>;
  /** The unscheduled queue: new jobs without a visit window, urgent first, then oldest. */
  unscheduled(limit: number): Promise<JobView[]>;
}

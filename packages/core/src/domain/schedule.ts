import { ValidationError } from "./errors";

export const MAX_JOB_DURATION_MS = 24 * 60 * 60 * 1000;

/** A scheduled visit must end after it starts and last at most 24 hours. */
export function assertValidWindow(start: Date, end: Date): void {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new ValidationError("Invalid date", [{ path: "scheduled_start", message: "Invalid date" }]);
  }
  if (end <= start) {
    throw new ValidationError("End must be after start", [
      { path: "scheduled_end", message: "End must be after start" },
    ]);
  }
  if (end.getTime() - start.getTime() > MAX_JOB_DURATION_MS) {
    throw new ValidationError("A visit can last at most 24 hours", [
      { path: "scheduled_end", message: "A visit can last at most 24 hours" },
    ]);
  }
}

export function overlaps(a: { start: Date; end: Date }, b: { start: Date; end: Date }): boolean {
  return a.start < b.end && b.start < a.end;
}

export function minutesBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 60_000);
}

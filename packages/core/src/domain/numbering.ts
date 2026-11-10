/** Human-readable per-organization numbers such as JOB-000123 and INV-2026-0042. */
export function formatJobNumber(n: number, prefix = "JOB"): string {
  if (!Number.isInteger(n) || n < 1) throw new RangeError("Job number must be a positive integer");
  return `${prefix}-${String(n).padStart(6, "0")}`;
}

export function formatYearlyNumber(prefix: string, year: number, n: number): string {
  if (!Number.isInteger(n) || n < 1) throw new RangeError("Number must be a positive integer");
  return `${prefix}-${year}-${String(n).padStart(4, "0")}`;
}

/** Accepts "JOB-000123", "job-123" or "123" and returns 123, or null when it isn't a job number. */
export function parseJobNumber(input: string, prefix = "JOB"): number | null {
  const m = new RegExp(`^(?:${prefix}-?)?0*(\\d{1,9})$`, "i").exec(input.trim());
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return n >= 1 ? n : null;
}

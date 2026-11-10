import { ValidationError } from "./errors";

/**
 * Opaque cursors for keyset pagination in the API (ADR 010). A cursor holds the sort values of the
 * last row plus its id as a tie-breaker.
 */
export interface CursorPayload {
  s: string; // sort expression the cursor was made for
  v: (string | number | null)[];
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string, expectedSort: string): CursorPayload {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "s" in parsed &&
      "v" in parsed &&
      Array.isArray((parsed as CursorPayload).v) &&
      (parsed as CursorPayload).s === expectedSort
    ) {
      return parsed as CursorPayload;
    }
  } catch {
    // fall through
  }
  throw new ValidationError("Invalid cursor", [{ path: "cursor", message: "Invalid or expired cursor" }]);
}

/** Parses "-scheduled_start,number" into [{ field, desc }]. */
export function parseSort<F extends string>(
  sort: string,
  allowed: readonly F[],
): { field: F; desc: boolean }[] {
  return sort
    .split(",")
    .filter(Boolean)
    .map((part) => {
      const desc = part.startsWith("-");
      const field = (desc ? part.slice(1) : part) as F;
      if (!allowed.includes(field)) throw new ValidationError(`Can't sort by ${field}`);
      return { field, desc };
    });
}

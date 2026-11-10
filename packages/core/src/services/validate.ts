import type { z } from "zod";
import { ValidationError } from "../domain/errors";

/** Validates untrusted input with a shared Zod schema and throws a ValidationError listing each field. */
export function parseInput<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const fields = result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  throw new ValidationError(fields[0]?.message ?? "Invalid input", fields);
}

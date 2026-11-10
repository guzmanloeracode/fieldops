import { z } from "zod";

// Field helpers shared by every schema module.

export const trimmed = (max: number) => z.string().trim().max(max);

/** Optional free text: "" becomes null. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

export const isoDateTime = z.iso.datetime({ offset: true });

export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

/** Timestamps in API responses. */
export const ts = z.string().meta({ format: "date-time" });

/** A list filter given as repeated params or one comma-separated value. */
export const csvEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.array(z.enum(values)), z.string()])
    .transform((v) => (Array.isArray(v) ? v : v.split(",").filter(Boolean)))
    .pipe(z.array(z.enum(values)));

/** Query-string booleans ("true", "1"). */
export const queryBool = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .transform((v) => v === true || v === "true" || v === "1");

import "server-only";
import { DomainError, HTTP_STATUS, type DomainErrorCode } from "@fieldops/core";

/** RFC 9457 problem details. `type` is a stable URN per error kind; extension members carry details. */
export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: { path: string; message: string }[];
  [extension: string]: unknown;
}

export type ProblemCode =
  | DomainErrorCode
  | "bad_request"
  | "unauthorized"
  | "insufficient_scope"
  | "session_required"
  | "unsupported_media_type"
  | "method_not_allowed"
  | "idempotency_mismatch"
  | "idempotency_in_progress"
  | "not_implemented"
  | "unavailable"
  | "internal";

const TITLES: Record<ProblemCode, string> = {
  not_found: "Not found",
  forbidden: "Forbidden",
  validation: "Validation failed",
  conflict: "Conflict",
  invalid_transition: "Invalid status transition",
  precondition_failed: "Precondition failed",
  demo_restricted: "Disabled in the public demo",
  rate_limited: "Too many requests",
  bad_request: "Bad request",
  unauthorized: "Unauthorized",
  insufficient_scope: "Insufficient scope",
  session_required: "Session required",
  unsupported_media_type: "Unsupported media type",
  method_not_allowed: "Method not allowed",
  idempotency_mismatch: "Idempotency key reused",
  idempotency_in_progress: "Request still in progress",
  not_implemented: "Not implemented",
  unavailable: "Service unavailable",
  internal: "Internal server error",
};

export const problemType = (code: ProblemCode) => `urn:fieldops:problem:${code.replaceAll("_", "-")}`;

/** An HTTP-level error raised by the API layer itself (authentication, parsing, idempotency…). */
export class ApiProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: ProblemCode,
    detail?: string,
    readonly extra: {
      errors?: ProblemBody["errors"];
      headers?: Record<string, string>;
      members?: Record<string, unknown>;
    } = {},
  ) {
    super(detail ?? TITLES[code]);
  }
}

export function problemFromError(
  err: unknown,
  instance: string,
): { body: ProblemBody; headers?: Record<string, string> } | null {
  if (err instanceof ApiProblem) {
    return {
      body: {
        type: problemType(err.code),
        title: TITLES[err.code],
        status: err.status,
        detail: err.message,
        instance,
        ...(err.extra.errors ? { errors: err.extra.errors } : {}),
        ...err.extra.members,
      },
      headers: err.extra.headers,
    };
  }
  if (err instanceof DomainError) {
    const { fields, ...rest } = (err.details ?? {}) as {
      fields?: { path: string; message: string }[];
    } & Record<string, unknown>;
    return {
      body: {
        type: problemType(err.code),
        title: TITLES[err.code],
        status: HTTP_STATUS[err.code],
        detail: err.message,
        instance,
        ...(fields?.length ? { errors: fields } : {}),
        ...extensionMembers(rest),
      },
    };
  }
  return null;
}

const RESERVED = new Set(["type", "title", "status", "detail", "instance", "errors"]);
const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

function snakeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snakeKeys);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [snake(k), snakeKeys(v)]));
  }
  return value;
}

/** Domain error details become RFC 9457 extension members, in the API's snake_case. */
function extensionMembers(details: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(snakeKeys(details) as Record<string, unknown>).filter(([k]) => !RESERVED.has(k)),
  );
}

export function internalProblem(instance: string): ProblemBody {
  return {
    type: problemType("internal"),
    title: TITLES.internal,
    status: 500,
    detail: "Something went wrong. The error was logged.",
    instance,
  };
}

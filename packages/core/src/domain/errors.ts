// Domain errors. The web layer maps them to HTTP status codes and RFC 9457 problem details.

export type DomainErrorCode =
  | "not_found"
  | "forbidden"
  | "validation"
  | "conflict"
  | "invalid_transition"
  | "precondition_failed"
  | "demo_restricted"
  | "rate_limited"
  | "unavailable";

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string) {
    super("not_found", `${entity} not found`, { entity });
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = "You don't have permission to do that") {
    super("forbidden", message);
  }
}

export class ValidationError extends DomainError {
  constructor(
    message: string,
    readonly fields: { path: string; message: string }[] = [],
  ) {
    super("validation", message, { fields });
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("conflict", message, details);
  }
}

export class PreconditionFailedError extends DomainError {
  constructor(message = "The record changed since you loaded it. Reload and try again.") {
    super("precondition_failed", message);
  }
}

export class DemoRestrictedError extends DomainError {
  constructor(message = "This action is disabled in the public demo") {
    super("demo_restricted", message);
  }
}

/** Too many requests in a window, or a quota used up (PLT-04). `retryAfterSeconds` feeds the Retry-After header. */
export class RateLimitedError extends DomainError {
  constructor(
    message: string,
    readonly limit: { scope: string; limit: number; resetAt: Date },
  ) {
    super("rate_limited", message, {
      scope: limit.scope,
      limit: limit.limit,
      resetAt: limit.resetAt.toISOString(),
    });
  }
}

/** A feature that is turned off or not configured, such as AI without an API key. */
export class UnavailableError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("unavailable", message, details);
  }
}

export const HTTP_STATUS: Record<DomainErrorCode, number> = {
  not_found: 404,
  forbidden: 403,
  validation: 422,
  conflict: 409,
  invalid_transition: 409,
  precondition_failed: 412,
  demo_restricted: 403,
  rate_limited: 429,
  unavailable: 503,
};

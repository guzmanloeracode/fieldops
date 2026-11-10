import "server-only";
import type { ServiceContext } from "@fieldops/core";
import { withStore, type Tx } from "@fieldops/db";
import { env } from "@/env";
import { auth } from "@/server/auth";
import { resolveActor, type ResolvedActor } from "@/server/context";
import { db } from "@/server/db";
import { files } from "@/server/files";
import { logger } from "@/server/logger";
import { notificationMailer } from "@/server/notification-mailer";
import { metaFromHeaders } from "@/server/request-meta";
import { claimIdempotencyKey, hashBody, readIdempotencyKey, storeIdempotentResponse } from "./idempotency";
import { ApiProblem, internalProblem, problemFromError, type ProblemBody } from "./problem";

export interface ApiArgs<P> {
  req: Request;
  url: URL;
  params: P;
  /** Parsed JSON body for POST, PUT and PATCH (undefined when empty). */
  body: unknown;
  ctx: ServiceContext;
  actor: ResolvedActor;
  tx: Tx;
  requestId: string;
}

export interface ApiResult {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

type RouteContext<P> = { params: Promise<P> };

const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);
const REQUEST_ID = /^[\w.-]{8,128}$/;

function respond(status: number, body: unknown, headers: Record<string, string>, problem = false): Response {
  const h = new Headers(headers);
  h.set("Cache-Control", "no-store");
  if (body !== undefined && status !== 204 && status !== 304) {
    h.set("Content-Type", problem ? "application/problem+json" : "application/json; charset=utf-8");
    return new Response(JSON.stringify(body), { status, headers: h });
  }
  return new Response(null, { status, headers: h });
}

export function problemResponse(
  body: ProblemBody,
  requestId: string,
  headers: Record<string, string> = {},
): Response {
  return respond(body.status, body, { ...headers, "X-Request-Id": requestId }, true);
}

async function authenticate(req: Request): Promise<ResolvedActor> {
  const authorization = req.headers.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer fo_")) {
    throw new ApiProblem(
      401,
      "unauthorized",
      "API keys are not available yet. They arrive in release 0.5; use a session token for now.",
      {
        headers: { "WWW-Authenticate": 'Bearer realm="fieldops", error="invalid_token"' },
      },
    );
  }
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    throw new ApiProblem(
      401,
      "unauthorized",
      "Sign in, or send a session token as `Authorization: Bearer <token>`.",
      {
        headers: { "WWW-Authenticate": 'Bearer realm="fieldops"' },
      },
    );
  }
  const actor = await resolveActor(session.user.id, session.session.activeOrganizationId);
  if (!actor) throw new ApiProblem(403, "forbidden", "You don't belong to an organization yet");
  return actor;
}

async function readBody(req: Request): Promise<{ text: string; json: unknown }> {
  const text = await req.text();
  if (!text.trim()) return { text: "", json: undefined };
  const type = req.headers.get("content-type") ?? "";
  if (!/^application\/([\w.+-]*\+)?json\b/i.test(type)) {
    throw new ApiProblem(415, "unsupported_media_type", "Send JSON with `Content-Type: application/json`");
  }
  try {
    return { text, json: JSON.parse(text) };
  } catch {
    throw new ApiProblem(400, "bad_request", "The request body is not valid JSON");
  }
}

/**
 * Wraps a /api/v1 route handler: authentication (session cookie or bearer session token), one
 * tenant-scoped transaction per request, Idempotency-Key handling for POST, and RFC 9457 errors.
 */
export function apiRoute<P extends Record<string, string> = Record<string, never>>(
  handler: (args: ApiArgs<P>) => Promise<ApiResult>,
) {
  return async (req: Request, route: RouteContext<P>): Promise<Response> => {
    const incoming = req.headers.get("x-request-id");
    const requestId = incoming && REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
    const url = new URL(req.url);
    const log = logger.child({ requestId, method: req.method, path: url.pathname });
    try {
      const actor = await authenticate(req);
      const params = (await route.params) ?? ({} as P);
      const { text, json } = BODY_METHODS.has(req.method)
        ? await readBody(req)
        : { text: "", json: undefined };
      const key = req.method === "POST" ? readIdempotencyKey(req) : null;
      const requestHash = key ? await hashBody(text) : "";

      const result = await withStore(
        db,
        actor.organizationId,
        async (store, tx) => {
          const scope = key
            ? {
                organizationId: actor.organizationId,
                userId: actor.userId,
                key,
                method: req.method,
                path: url.pathname,
                requestHash,
              }
            : null;
          if (scope) {
            const replay = await claimIdempotencyKey(tx, scope);
            if (replay)
              return {
                status: replay.status,
                body: replay.body ?? undefined,
                headers: { "Idempotent-Replayed": "true" },
              };
          }
          const ctx: ServiceContext = {
            actor,
            store,
            now: new Date(),
            demo: env.DEMO_MODE,
            files,
            mailer: notificationMailer(tx, actor.organizationId),
          };
          const out = await handler({ req, url, params, body: json, ctx, actor, tx, requestId });
          const status = out.status ?? 200;
          if (scope) await storeIdempotentResponse(tx, scope, status, out.body);
          return { ...out, status };
        },
        { userId: actor.userId, ...metaFromHeaders(req.headers) },
      );
      log.info({ status: result.status, orgId: actor.organizationId, userId: actor.userId }, "api request");
      return respond(result.status ?? 200, result.body, { ...result.headers, "X-Request-Id": requestId });
    } catch (err) {
      const problem = problemFromError(err, url.pathname);
      if (problem) {
        if (problem.body.status >= 500) log.error({ err }, "api request failed");
        return problemResponse(problem.body, requestId, problem.headers);
      }
      log.error({ err }, "api request failed");
      return problemResponse(internalProblem(url.pathname), requestId);
    }
  };
}

/** Reads list query parameters: repeated keys become arrays; `page` is UI-only and ignored here. */
export function queryObject(url: URL): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    if (key === "page") continue;
    const values = url.searchParams.getAll(key);
    out[key] = values.length > 1 ? values : values[0]!;
  }
  return out;
}

/** Parses `If-Match: "v12"` (or W/"v12") into a version number. */
export function ifMatchVersion(req: Request): number | undefined {
  const header = req.headers.get("if-match");
  if (header === null) return undefined;
  const m = /^(?:W\/)?"v(\d+)"$/.exec(header.trim());
  if (!m)
    throw new ApiProblem(412, "precondition_failed", 'If-Match must be an ETag from this API, such as "v3"');
  return Number(m[1]);
}

export const jobEtag = (version: number) => `"v${version}"`;
export const weakEtag = (date: Date) => `W/"${date.getTime().toString(36)}"`;

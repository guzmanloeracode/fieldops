import "server-only";
import { apiKeys, type RateLimitStatus, type ServiceContext } from "@fieldops/core";
import { authenticateApiKey, hitRateWindow, withStore, type Tx } from "@fieldops/db";
import { API_KEY_VISIBLE_CHARS, type ApiKeyScope } from "@fieldops/shared";
import { env } from "@/env";
import { auth } from "@/server/auth";
import { resolveActor, type ResolvedActor } from "@/server/context";
import { db } from "@/server/db";
import { files } from "@/server/files";
import { logger } from "@/server/logger";
import { notificationMailer } from "@/server/notification-mailer";
import { auditMeta, auditMetaFor, metaFromHeaders } from "@/server/request-meta";
import { claimIdempotencyKey, hashBody, readIdempotencyKey, storeIdempotentResponse } from "./idempotency";
import { ApiProblem, internalProblem, problemFromError, type ProblemBody } from "./problem";

export interface ApiArgs<P> {
  req: Request;
  url: URL;
  params: P;
  /** Parsed JSON body for POST, PUT and PATCH (undefined when empty). */
  body: unknown;
  ctx: ServiceContext;
  actor: ApiActor;
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

/** The API key a request came with (PLT-02): which key, the characters lists show, and its scopes. */
export interface ApiKeyAuth {
  id: string;
  prefix: string;
  scopes: ApiKeyScope[];
}

/** The member a /api/v1 request acts as, how it authenticated, and where it stands against its rate limit. */
export interface ApiActor extends ResolvedActor {
  apiKey: ApiKeyAuth | null;
  rateLimit: RateLimitStatus | null;
}

export interface AuthOptions {
  /** The scope an API key needs. By default `read` for GET and HEAD and `write` for everything else. */
  scope?: ApiKeyScope;
  /** Only a signed-in session (managing API keys): a key gets 403 `session_required`. */
  sessionOnly?: boolean;
  /** Only an API key (the MCP server): a session cookie or token isn't accepted. */
  keyOnly?: boolean;
}

const REALM = 'Bearer realm="fieldops"';

/** IETF RateLimit header fields for a status: the limit, what is left, and seconds until the window resets. */
export function rateLimitHeaders(s: RateLimitStatus | null, now = Date.now()): Record<string, string> {
  if (!s) return {};
  return {
    "RateLimit-Limit": String(s.limit),
    "RateLimit-Remaining": String(Math.max(0, s.remaining)),
    "RateLimit-Reset": String(Math.max(0, Math.ceil((s.resetAt.getTime() - now) / 1000))),
  };
}

/** Of two limits that apply to one request (an AI route's and the API's), the one with fewer requests left. */
export function tighterLimit(a: RateLimitStatus | null, b: RateLimitStatus | null): RateLimitStatus | null {
  if (!a || !b) return a ?? b;
  if (a.remaining !== b.remaining) return a.remaining < b.remaining ? a : b;
  return a.resetAt >= b.resetAt ? a : b;
}

/**
 * Counts the request against its per-minute limit (PLT-04): `api:key:<id>` for API keys, `api:user:<id>` for
 * sessions. Demo accounts are shared by every visitor, so in the demo a session's limit is per user and IP
 * address. One statement outside the tenant transaction; 0 turns a limit off.
 */
async function countRequest(req: Request, actor: ResolvedActor, key: ApiKeyAuth | null) {
  const limit = key ? env.API_KEY_RATE_LIMIT : env.API_USER_RATE_LIMIT;
  if (limit === 0) return null;
  let bucket = key ? `api:key:${key.id}` : `api:user:${actor.userId}`;
  if (!key && env.DEMO_MODE && actor.isDemoUser) bucket += `:ip:${metaFromHeaders(req.headers).ip ?? "-"}`;
  const now = new Date();
  const { count, resetAt } = await hitRateWindow(db, bucket, 60, now);
  const status: RateLimitStatus = { limit, remaining: limit - count, resetAt };
  if (count > limit) {
    const retry = Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000));
    throw new ApiProblem(
      429,
      "rate_limited",
      `Too many requests: ${limit} a minute ${key ? "per API key" : "per user"}. Try again in ${retry} s.`,
      {
        headers: { "Retry-After": String(retry), ...rateLimitHeaders(status, now.getTime()) },
        members: { scope: key ? "api_key" : "user", limit, reset_at: resetAt.toISOString() },
      },
    );
  }
  return status;
}

async function authenticateKey(req: Request, token: string, opts: AuthOptions): Promise<ApiActor> {
  if (opts.sessionOnly) {
    throw new ApiProblem(403, "session_required", "API keys can't manage API keys. Sign in to the web app.");
  }
  const invalid = () =>
    new ApiProblem(401, "unauthorized", "The API key is invalid, revoked or expired.", {
      headers: { "WWW-Authenticate": `${REALM}, error="invalid_token"` },
    });
  if (!apiKeys.looksLikeApiKey(token)) throw invalid();
  const found = await authenticateApiKey(db, await apiKeys.hashApiKey(token));
  if (!found) throw invalid();
  const needed = opts.scope ?? apiKeys.scopeForMethod(req.method);
  if (!apiKeys.hasScope(found.scopes, needed)) {
    throw new ApiProblem(403, "insufficient_scope", `This API key needs the \`${needed}\` scope.`, {
      headers: { "WWW-Authenticate": `${REALM}, error="insufficient_scope", scope="${needed}"` },
      members: { required_scope: needed },
    });
  }
  const actor = await resolveActor(found.userId, found.organizationId);
  if (!actor || actor.organizationId !== found.organizationId || actor.memberId !== found.memberId) {
    throw invalid();
  }
  const key: ApiKeyAuth = {
    id: found.keyId,
    prefix: token.slice(0, API_KEY_VISIBLE_CHARS),
    scopes: found.scopes,
  };
  return { ...actor, apiKey: key, rateLimit: await countRequest(req, actor, key) };
}

/**
 * Who a /api/v1 request acts as: an API key (`Authorization: Bearer fo_…`, PLT-02), the session cookie, or a
 * bearer session token. Every authenticated request also counts against its rate limit (PLT-04); a request over it
 * fails here with 429.
 */
export async function authenticate(req: Request, opts: AuthOptions = {}): Promise<ApiActor> {
  const authorization = req.headers.get("authorization");
  const bearer = /^bearer\s+(\S+)\s*$/i.exec(authorization ?? "")?.[1];
  if (bearer?.startsWith("fo_")) return authenticateKey(req, bearer, opts);
  if (opts.keyOnly) {
    throw new ApiProblem(401, "unauthorized", "Send an API key as `Authorization: Bearer fo_…`.", {
      headers: { "WWW-Authenticate": REALM },
    });
  }
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    throw new ApiProblem(
      401,
      "unauthorized",
      "Sign in, or send a session token or an API key as `Authorization: Bearer <token>`.",
      { headers: { "WWW-Authenticate": REALM } },
    );
  }
  const actor = await resolveActor(session.user.id, session.session.activeOrganizationId);
  if (!actor) throw new ApiProblem(403, "forbidden", "You don't belong to an organization yet");
  return { ...actor, apiKey: null, rateLimit: await countRequest(req, actor, null) };
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
 * Wraps a /api/v1 route handler: authentication (API key, session cookie or bearer session token) and the rate
 * limit, one tenant-scoped transaction per request, Idempotency-Key handling for POST, and RFC 9457 errors.
 */
export function apiRoute<P extends Record<string, string> = Record<string, never>>(
  handler: (args: ApiArgs<P>) => Promise<ApiResult>,
  options: AuthOptions = {},
) {
  return async (req: Request, route: RouteContext<P>): Promise<Response> => {
    const incoming = req.headers.get("x-request-id");
    const requestId = incoming && REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
    const url = new URL(req.url);
    const log = logger.child({ requestId, method: req.method, path: url.pathname });
    let limitHeaders: Record<string, string> = {};
    try {
      const actor = await authenticate(req, options);
      limitHeaders = rateLimitHeaders(actor.rateLimit);
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
        { userId: actor.userId, ...auditMetaFor(actor, auditMeta(metaFromHeaders(req.headers))) },
      );
      log.info(
        {
          status: result.status,
          orgId: actor.organizationId,
          userId: actor.userId,
          apiKeyId: actor.apiKey?.id,
        },
        "api request",
      );
      return respond(result.status ?? 200, result.body, {
        ...limitHeaders,
        ...result.headers,
        "X-Request-Id": requestId,
      });
    } catch (err) {
      const problem = problemFromError(err, url.pathname);
      if (problem) {
        if (problem.body.status >= 500) log.error({ err }, "api request failed");
        return problemResponse(problem.body, requestId, { ...limitHeaders, ...problem.headers });
      }
      log.error({ err }, "api request failed");
      return problemResponse(internalProblem(url.pathname), requestId, limitHeaders);
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

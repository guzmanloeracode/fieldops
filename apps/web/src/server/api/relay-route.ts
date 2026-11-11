import "server-only";
import type { webhooks } from "@fieldops/core";
import { schema, withTenant } from "@fieldops/db";
import { and, eq } from "drizzle-orm";
import type { ResolvedActor } from "@/server/context";
import { db } from "@/server/db";
import { logger } from "@/server/logger";
import { webhookDeps } from "@/server/relay";
import { auditMeta, metaFromHeaders } from "@/server/request-meta";
import { authenticate, problemResponse, type ApiResult } from "./handler";
import {
  claimIdempotencyKey,
  hashBody,
  readIdempotencyKey,
  storeIdempotentResponse,
  type IdempotencyScope,
} from "./idempotency";
import { ApiProblem, internalProblem, problemFromError } from "./problem";

// /api/v1 routes that call Relay (PLT-03, ADR 022). apiRoute() holds one transaction for the whole request, and a
// Relay call must not keep a database connection busy, so these routes authenticate the same way and let the
// webhooks service open its own short transactions. An Idempotency-Key is claimed in one short transaction and its
// response stored in another; if the request fails, the claim is released so a retry can run.

export interface RelayArgs<P> {
  req: Request;
  url: URL;
  params: P;
  body: unknown;
  actor: ResolvedActor;
  deps: webhooks.WebhookDeps;
  requestId: string;
}

type RouteContext<P> = { params: Promise<P> };

const REQUEST_ID = /^[\w.-]{8,128}$/;

function respond(status: number, body: unknown, headers: Record<string, string>): Response {
  const h = new Headers(headers);
  h.set("Cache-Control", "no-store");
  if (body !== undefined && status !== 204) {
    h.set("Content-Type", "application/json; charset=utf-8");
    return new Response(JSON.stringify(body), { status, headers: h });
  }
  return new Response(null, { status, headers: h });
}

async function readJson(req: Request): Promise<{ text: string; json: unknown }> {
  if (!["POST", "PUT", "PATCH"].includes(req.method)) return { text: "", json: undefined };
  const text = await req.text();
  if (!text.trim()) return { text: "", json: undefined };
  if (!/^application\/([\w.+-]*\+)?json\b/i.test(req.headers.get("content-type") ?? "")) {
    throw new ApiProblem(415, "unsupported_media_type", "Send JSON with `Content-Type: application/json`");
  }
  try {
    return { text, json: JSON.parse(text) };
  } catch {
    throw new ApiProblem(400, "bad_request", "The request body is not valid JSON");
  }
}

export function relayRoute<P extends Record<string, string> = Record<string, never>>(
  handler: (args: RelayArgs<P>) => Promise<ApiResult>,
) {
  return async (req: Request, route: RouteContext<P>): Promise<Response> => {
    const incoming = req.headers.get("x-request-id");
    const requestId = incoming && REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
    const url = new URL(req.url);
    const log = logger.child({ requestId, method: req.method, path: url.pathname });
    try {
      const actor = await authenticate(req);
      const params = (await route.params) ?? ({} as P);
      const { text, json } = await readJson(req);
      const key = req.method === "POST" ? readIdempotencyKey(req) : null;
      const meta = { userId: actor.userId, ...auditMeta(metaFromHeaders(req.headers)) };
      const scope: IdempotencyScope | null = key
        ? {
            organizationId: actor.organizationId,
            userId: actor.userId,
            key,
            method: req.method,
            path: url.pathname,
            requestHash: await hashBody(text),
          }
        : null;
      if (scope) {
        const replay = await withTenant(
          db,
          actor.organizationId,
          (tx) => claimIdempotencyKey(tx, scope),
          meta,
        );
        if (replay) {
          return respond(replay.status, replay.body ?? undefined, {
            "Idempotent-Replayed": "true",
            "X-Request-Id": requestId,
          });
        }
      }
      let out: ApiResult;
      try {
        out = await handler({ req, url, params, body: json, actor, deps: webhookDeps(actor), requestId });
      } catch (err) {
        if (scope) {
          await withTenant(db, actor.organizationId, (tx) =>
            tx
              .delete(schema.idempotencyKey)
              .where(
                and(
                  eq(schema.idempotencyKey.organizationId, scope.organizationId),
                  eq(schema.idempotencyKey.key, scope.key),
                  eq(schema.idempotencyKey.responseStatus, 0),
                ),
              ),
          ).catch((e: unknown) => log.warn({ err: e }, "couldn't release an idempotency key"));
        }
        throw err;
      }
      const status = out.status ?? 200;
      if (scope) {
        await withTenant(db, actor.organizationId, (tx) =>
          storeIdempotentResponse(tx, scope, status, out.body),
        );
      }
      log.info({ status, orgId: actor.organizationId, userId: actor.userId }, "api request");
      return respond(status, out.body, { ...out.headers, "X-Request-Id": requestId });
    } catch (err) {
      const problem = problemFromError(err, url.pathname);
      if (problem) {
        if (problem.body.status >= 500 && problem.body.status !== 503)
          log.error({ err }, "api request failed");
        if (problem.body.status === 503) log.warn({ err: (err as Error).message }, "webhooks unavailable");
        return problemResponse(problem.body, requestId, problem.headers);
      }
      log.error({ err }, "api request failed");
      return problemResponse(internalProblem(url.pathname), requestId);
    }
  };
}

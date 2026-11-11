import "server-only";
import { apiKeyCreatedSchema, apiKeyCreateSchema, apiKeySchema } from "@fieldops/shared";
import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import type { OpenApiHelpers } from "./openapi-recurrences";

// Release 0.5 in the OpenAPI document: API keys (PLT-02) as a security scheme and a resource, and the rate limits
// (PLT-04) every operation answers with. openapi.ts passes its helpers so errors and descriptions match.

export const API_KEYS_TAG = {
  name: "API keys",
  description:
    "Keys for integrations and MCP clients. Managed by a signed-in owner or admin, never by a key.",
};

export const apiKeySecurityScheme = {
  apiKeyAuth: {
    type: "http" as const,
    scheme: "bearer",
    bearerFormat: "fo_…",
    description:
      "An organization API key (`fo_` + 40 characters) from Settings → API keys. It acts as the member who created it; scope `read` allows GET, `write` everything else.",
  },
};

const keyList = z.object({ data: z.array(apiKeySchema) }).meta({ id: "ApiKeyList" });

export function apiKeyPaths(h: Pick<OpenApiHelpers, "op" | "json" | "body" | "errors" | "uuidParam">) {
  const tag = API_KEYS_TAG.name;
  const session =
    "Owners and admins, with a session cookie or session token. A request with an API key gets `403 session_required`.";
  const paths: ZodOpenApiPathsObject = {
    "/api-keys": {
      get: h.op(tag, "List API keys", {
        operationId: "listApiKeys",
        description: `${session} Newest first, revoked and expired keys included.`,
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        responses: { "200": h.json(keyList, "The organization's keys"), ...h.errors() },
      }),
      post: h.op(tag, "Create an API key", {
        operationId: "createApiKey",
        description: `${session} The key acts as you. Its secret is only in this response; FieldOps stores a SHA-256 hash. An organization has at most 20 active keys.`,
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        requestBody: h.body(apiKeyCreateSchema),
        responses: {
          "201": h.json(apiKeyCreatedSchema, "The new key, with its secret"),
          ...h.errors(400, 415, 422),
        },
      }),
    },
    "/api-keys/{id}": {
      delete: h.op(tag, "Revoke an API key", {
        operationId: "revokeApiKey",
        description: `${session} The key stops working at once and stays in the list as revoked. Revoking it again changes nothing.`,
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        requestParams: { path: h.uuidParam("API key") },
        responses: { "200": h.json(apiKeySchema, "The revoked key"), ...h.errors(404) },
      }),
    },
  };
  return paths;
}

type Doc = {
  components?: { headers?: Record<string, unknown>; responses?: Record<string, unknown> };
  paths?: Record<
    string,
    Record<string, { responses?: Record<string, { headers?: Record<string, unknown> }> }>
  >;
};

const header = (description: string, example: number) => ({
  description,
  schema: { type: "integer", minimum: 0 },
  example,
});

/**
 * Every operation counts against a per-minute limit (PLT-04): each response carries the RateLimit headers, and any
 * operation can answer 429. Added to the generated document so no path can forget them.
 */
export function withRateLimits<T>(document: T): T {
  const doc = document as Doc;
  doc.components ??= {};
  doc.components.headers = {
    ...doc.components.headers,
    "RateLimit-Limit": header("Requests allowed in the current window", 300),
    "RateLimit-Remaining": header("Requests left in the current window", 299),
    "RateLimit-Reset": header("Seconds until the window resets", 42),
    "Retry-After": header("Seconds to wait before trying again", 42),
  };
  const limitHeaders = {
    "RateLimit-Limit": { $ref: "#/components/headers/RateLimit-Limit" },
    "RateLimit-Remaining": { $ref: "#/components/headers/RateLimit-Remaining" },
    "RateLimit-Reset": { $ref: "#/components/headers/RateLimit-Reset" },
  };
  const methods = ["get", "put", "post", "patch", "delete"];
  for (const item of Object.values(doc.paths ?? {})) {
    for (const [method, operation] of Object.entries(item)) {
      if (!methods.includes(method) || !operation.responses) continue;
      for (const [status, response] of Object.entries(operation.responses)) {
        if (status === "401" || "$ref" in response) continue;
        response.headers = { ...limitHeaders, ...response.headers };
      }
      operation.responses["429"] ??= {
        description: "Too many requests: a rate limit or quota is used up",
        headers: { ...limitHeaders, "Retry-After": { $ref: "#/components/headers/Retry-After" } },
        content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } },
      } as never;
    }
  }
  return document;
}

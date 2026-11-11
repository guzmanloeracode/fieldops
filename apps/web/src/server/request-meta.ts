import "server-only";
import { headers } from "next/headers";
import { env } from "@/env";

/** The client's IP address and user agent, for the audit log (AUD-01) and rate limits. */
export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

/** nginx sets X-Real-IP to the visitor's address (it trusts Cloudflare's CF-Connecting-IP, infra/proxy). */
export function metaFromHeaders(h: Headers): RequestMeta {
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ip: h.get("x-real-ip") || forwarded || null,
    userAgent: h.get("user-agent")?.slice(0, 512) || null,
  };
}

/**
 * What the audit log keeps about a request. Visitors to the public demo share its accounts, so anyone signed in
 * as the owner could read every other visitor's address: in demo mode the IP address isn't recorded. Rate limits
 * still use it (`requestMeta`).
 */
export function auditMeta(meta: RequestMeta): RequestMeta {
  return env.DEMO_MODE ? { ip: null, userAgent: meta.userAgent } : meta;
}

/**
 * Requests made with an API key (PLT-02) say so in the audit log: the user agent becomes
 * "API key fo_xxxx · <client's user agent>", so a change made by an integration can be told from one made in the app.
 */
export function auditMetaFor(actor: object, meta: RequestMeta): RequestMeta {
  const key = (actor as { apiKey?: { prefix: string } | null }).apiKey;
  if (!key) return meta;
  const ua = `API key ${key.prefix}…${meta.userAgent ? ` · ${meta.userAgent}` : ""}`;
  return { ...meta, userAgent: ua.slice(0, 512) };
}

/** Outside a request (scripts, tests) there are no headers; the audit log records nothing then. */
export async function requestMeta(): Promise<RequestMeta> {
  try {
    return metaFromHeaders(await headers());
  } catch {
    return { ip: null, userAgent: null };
  }
}

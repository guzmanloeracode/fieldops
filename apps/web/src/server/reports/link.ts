import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/env";

// The download link in the "Job completed" email (AI-03): /share/reports/<token>. Customers open it without
// signing in to the portal, so the token itself grants access: an HMAC-SHA256 over the organization, the report
// and the expiry (REPORT_LINK_DAYS days), with the app secret. Nothing is stored; the report must still be "sent"
// when the link is opened.

interface LinkPayload {
  o: string;
  r: string;
  /** Unix seconds. */
  e: number;
}

function sign(payload: string): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(`fieldops-report-link\n${payload}`)
    .digest("base64url");
}

export function reportLinkToken(
  report: { organizationId: string; reportId: string },
  expiresAt: Date,
): string {
  const payload = Buffer.from(
    JSON.stringify({
      o: report.organizationId,
      r: report.reportId,
      e: Math.floor(expiresAt.getTime() / 1000),
    }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function reportLinkUrl(report: { organizationId: string; reportId: string }, expiresAt: Date): string {
  return new URL(`/share/reports/${reportLinkToken(report, expiresAt)}`, env.APP_URL).toString();
}

export type LinkCheck =
  { ok: true; organizationId: string; reportId: string } | { ok: false; reason: "invalid" | "expired" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function verifyReportLink(token: string, now = Date.now()): LinkCheck {
  const [payload, sig] = token.split(".");
  if (!payload || !sig || token.length > 400) return { ok: false, reason: "invalid" };
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return { ok: false, reason: "invalid" };
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as LinkPayload;
    if (!UUID.test(data.o) || !UUID.test(data.r) || typeof data.e !== "number")
      return { ok: false, reason: "invalid" };
    if (data.e * 1000 < now) return { ok: false, reason: "expired" };
    return { ok: true, organizationId: data.o, reportId: data.r };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { PortalPhoto } from "@fieldops/core";
import { env } from "@/env";

// A request photo is uploaded before the request exists. The server hands the browser a signed description of
// the upload (key, name, type, size, contact) and accepts only that back, so a visitor can't attach files
// under someone else's key or change the recorded type.

const TTL_S = 60 * 60;

function sign(payload: string): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(`fieldops-portal-photo\n${payload}`)
    .digest("base64url");
}

export function signPhoto(photo: PortalPhoto, contactId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ photo, contactId, exp: Math.floor(Date.now() / 1000) + TTL_S }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyPhoto(token: string, contactId: string): PortalPhoto | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      photo: PortalPhoto;
      contactId: string;
      exp: number;
    };
    return data.contactId === contactId && data.exp > Date.now() / 1000 ? data.photo : null;
  } catch {
    return null;
  }
}

import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "@/env";

// In the public demo, emails are captured instead of sent. A visitor may read the emails sent to the
// addresses they used in this browser; the list lives in a signed cookie so it can't be edited.
const COOKIE = "fieldops_demo_inbox";

function sign(value: string): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET).update(value).digest("base64url");
}

export async function demoInboxAddresses(): Promise<string[]> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return [];
  const [payload, sig] = raw.split(".");
  if (!payload || !sig) return [];
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return [];
  try {
    return (JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as string[]).slice(0, 5);
  } catch {
    return [];
  }
}

export async function rememberDemoInbox(email: string) {
  if (!env.DEMO_MODE) return;
  const list = [email.toLowerCase(), ...(await demoInboxAddresses()).filter((e) => e !== email.toLowerCase())].slice(0, 5);
  const payload = Buffer.from(JSON.stringify(list)).toString("base64url");
  (await cookies()).set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.APP_URL.startsWith("https"),
    maxAge: 60 * 60 * 24,
    path: "/",
  });
}

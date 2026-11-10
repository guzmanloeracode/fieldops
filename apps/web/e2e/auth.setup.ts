import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test as setup } from "@playwright/test";
import { AUTH_DIR, DEMO_PASSWORD, USERS, storageState, type UserKey } from "./fixtures";

// Signs in each demo user once through the auth API and saves both the browser session (storage state) and the
// session token (used as a bearer token for the REST API). Keeps sign-ins well under the auth rate limit.
setup("sign in demo users", async ({ playwright, baseURL }) => {
  mkdirSync(AUTH_DIR, { recursive: true });
  const tokens: Partial<Record<UserKey, string>> = {};
  for (const [key, email] of Object.entries(USERS) as [UserKey, string][]) {
    const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL! } });
    const res = await ctx.post("/api/auth/sign-in/email", { data: { email, password: DEMO_PASSWORD } });
    expect(res.ok(), `${email}: ${res.status()} ${await res.text()}`).toBeTruthy();
    tokens[key] = ((await res.json()) as { token: string }).token;
    await ctx.storageState({ path: storageState(key) });
    await ctx.dispose();
  }
  writeFileSync(path.join(AUTH_DIR, "tokens.json"), JSON.stringify(tokens));
});

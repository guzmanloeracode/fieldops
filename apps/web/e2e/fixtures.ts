import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";

// Outside the repository locally, for the same reason as the Playwright output folder.
export const AUTH_DIR = process.env.CI
  ? path.join(import.meta.dirname, ".auth")
  : path.join(tmpdir(), "fieldops-e2e", ".auth");
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "demo-dev-password";

export const USERS = {
  owner: "olivia@acme-air.example",
  dispatcher: "dan@acme-air.example",
  technician: "tom@acme-air.example",
  otherOrgOwner: "siti@acme-teknik.example",
} as const;
export type UserKey = keyof typeof USERS;

export const storageState = (user: UserKey) => path.join(AUTH_DIR, `${user}.json`);
export const tokenOf = (user: UserKey): string =>
  (JSON.parse(readFileSync(path.join(AUTH_DIR, "tokens.json"), "utf8")) as Record<UserKey, string>)[user];

/** A REST API client authenticated with the user's session token (bearer). */
export async function api(user: UserKey): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL:
      process.env.PLAYWRIGHT_BASE_URL ?? (process.env.CI ? "http://127.0.0.1:3000" : "http://localhost:3100"),
    extraHTTPHeaders: { Authorization: `Bearer ${tokenOf(user)}` },
  });
}

export async function json<T>(res: Awaited<ReturnType<APIRequestContext["get"]>>): Promise<T> {
  expect(res.ok(), `${res.url()} → ${res.status()} ${await res.text().catch(() => "")}`).toBeTruthy();
  return (await res.json()) as T;
}

/**
 * A visit window on a random weekday up to ~80 years ahead (08:00, 11:00 or 14:00 Chicago), so re-runs against
 * the same database practically never overlap visits created by earlier runs.
 */
export function futureWindow(hours = 2): { start: Date; end: Date } {
  const base = Date.UTC(2031, 0, 6, 14); // Monday 2031-01-06, 08:00 in Chicago
  const week = Math.floor(Math.random() * 4_000);
  const weekday = Math.floor(Math.random() * 5);
  const block = Math.floor(Math.random() * 3);
  const start = new Date(base + (week * 7 + weekday) * 86_400_000 + block * 3 * 3_600_000);
  return { start, end: new Date(start.getTime() + hours * 3_600_000) };
}

/** Value for a datetime-local input in America/Chicago (the demo org's time zone). */
export function toChicagoInput(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export interface JobDto {
  id: string;
  number: string;
  status: string;
  title: string;
}

export interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
}

/** Creates a job through the API for the first customer that has a site. */
export async function createJob(
  client: APIRequestContext,
  title: string,
): Promise<JobDto & { customerId: string; customerName: string }> {
  const customers = await json<{ data: { id: string; name: string }[] }>(
    await client.get("/api/v1/customers?limit=5&sort=name"),
  );
  for (const c of customers.data) {
    const sites = await json<{ data: { id: string }[] }>(await client.get(`/api/v1/customers/${c.id}/sites`));
    if (!sites.data[0]) continue;
    const res = await client.post("/api/v1/jobs", {
      data: {
        customer_id: c.id,
        site_id: sites.data[0].id,
        title,
        priority: "normal",
        estimated_duration_min: 60,
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    const job = (await res.json()) as JobDto;
    return { ...job, customerId: c.id, customerName: c.name };
  }
  throw new Error("No customer with a site");
}

export async function memberByEmail(client: APIRequestContext, email: string): Promise<Member> {
  const members = await json<{ data: Member[] }>(await client.get("/api/v1/members"));
  const m = members.data.find((x) => x.email === email);
  if (!m) throw new Error(`member ${email} not found`);
  return m;
}

export async function assign(
  client: APIRequestContext,
  jobId: string,
  memberId: string,
  w: { start: Date; end: Date },
) {
  const res = await client.put(`/api/v1/jobs/${jobId}/assignments`, {
    data: {
      member_ids: [memberId],
      lead_member_id: memberId,
      scheduled_start: w.start.toISOString(),
      scheduled_end: w.end.toISOString(),
    },
  });
  expect(res.status(), await res.text()).toBe(200);
}

export const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export async function expectStatus(page: Page, label: string) {
  await expect(page.getByTestId("job-status")).toHaveText(label);
}

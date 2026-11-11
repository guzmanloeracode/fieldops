import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { api, json, storageState } from "./fixtures";
import { completedJobForJamie, sendReportToJamie } from "./report-helpers";

// WCAG 2.2 AA checks on the key pages (PRD §13, §18.1): no serious or critical violations.
async function audit(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    // Next.js dev overlay and third-party map canvas are not part of the product UI.
    .exclude("nextjs-portal")
    .exclude(".maplibregl-canvas")
    .analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const summary = blocking.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(" "))
        .join("\n  ")}`,
  );
  expect(summary, `${path}\n${summary.join("\n")}`).toEqual([]);
}

// The live event stream (NOT-05) keeps a request open, which would keep "networkidle" from ever settling. A 204
// tells EventSource not to reconnect.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/stream", (route) => route.fulfill({ status: 204 }));
});

test.describe("public pages", () => {
  for (const path of ["/", "/sign-in", "/sign-up", "/forgot-password", "/portal/acme-air/sign-in"]) {
    test(`axe: ${path}`, async ({ page }) => audit(page, path));
  }
});

// The same checks in Bahasa Indonesia (SET-05): Siti's organization reads Indonesian; signed-out pages follow the browser.
test.describe("pages in Bahasa Indonesia", () => {
  test.describe("signed out", () => {
    test.use({ locale: "id-ID" });
    for (const path of ["/", "/sign-in", "/portal/acme-teknik/sign-in"]) {
      test(`axe (id): ${path}`, async ({ page }) => audit(page, path));
    }
  });
  test.describe("as Acme Teknik's owner", () => {
    test.use({ storageState: storageState("otherOrgOwner") });
    for (const path of [
      "/dashboard",
      "/jobs",
      "/customers",
      "/settings/organization",
      "/schedule",
      "/approvals",
      "/quotes",
      "/invoices",
      "/settings/catalog",
      "/settings/api-keys",
    ]) {
      test(`axe (id): ${path}`, async ({ page }) => audit(page, path));
    }
  });
});

test.describe("app pages as owner", () => {
  test.use({ storageState: storageState("owner") });
  let jobNumber = "";
  let customerId = "";

  test.beforeAll(async () => {
    const client = await api("owner");
    const jobs = await json<{ data: { number: string; customer: { id: string } }[] }>(
      await client.get("/api/v1/jobs?limit=1&status=completed"),
    );
    jobNumber = jobs.data[0]!.number;
    customerId = jobs.data[0]!.customer.id;
    await client.dispose();
  });

  for (const path of [
    "/dashboard",
    "/dashboard?tab=today",
    "/jobs",
    "/jobs/new",
    "/customers",
    "/customers/new",
    "/settings/organization",
    "/settings/members",
    "/settings/service-types",
    "/settings/operations",
    "/settings/ai",
    "/jobs?needs_review=true",
    "/settings/sla",
    "/settings/demo-outbox",
    "/settings/audit",
    "/settings/api-keys",
    "/settings/webhooks",
    "/approvals",
    "/schedule",
    "/schedule?view=week",
    "/schedule/team",
    "/notifications",
    "/notifications?filter=unread",
    "/notifications/preferences",
  ]) {
    test(`axe: ${path}`, async ({ page }) => audit(page, path));
  }
  test("axe: job detail", async ({ page }) => audit(page, `/jobs/${jobNumber}`));
  test("axe: job detail with its service report (AI-03)", async ({ page }) => {
    const job = await completedJobForJamie(`E2E a11y report ${Date.now()}`);
    await audit(page, `/jobs/${job.number}`);
    await expect(page.getByTestId("service-report")).toBeVisible();
  });
  test("axe: webhook endpoint with a failed delivery (PLT-03)", async ({ page }) => {
    const client = await api("owner");
    await json(await client.put("/api/v1/webhook-settings", { data: { enabled: true } }));
    const ep = await json<{ id: string }>(
      await client.post("/api/v1/webhook-endpoints", {
        data: { url: `https://a11y-${Date.now()}.example.com/fail`, event_types: ["job.created"] },
      }),
    );
    try {
      await client.post(`/api/v1/webhook-endpoints/${ep.id}/test`);
      await audit(page, `/settings/webhooks/${ep.id}`);
      await expect(page.getByTestId("webhook-delivery").first()).toBeVisible();
    } finally {
      await client.delete(`/api/v1/webhook-endpoints/${ep.id}`);
      await client.dispose();
    }
  });
  test("axe: customer detail", async ({ page }) => audit(page, `/customers/${customerId}`));
  test("axe: equipment detail", async ({ page }) => {
    const client = await api("owner");
    const jobs = await json<{ data: { equipment_id: string | null }[] }>(
      await client.get("/api/v1/jobs?limit=50&status=completed"),
    );
    await client.dispose();
    await audit(page, `/equipment/${jobs.data.find((j) => j.equipment_id)!.equipment_id}`);
  });
  test("axe: command palette", async ({ page }) => {
    await page.goto("/jobs");
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByTestId("palette-input").fill("ac");
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .include("[role=dialog]")
      .analyze();
    const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(blocking.map((v) => v.id)).toEqual([]);
  });
  test("axe: Ask FieldOps panel", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("ControlOrMeta+j");
    const panel = page.getByTestId("assistant-panel");
    await expect(panel).toBeVisible();
    await expect(
      panel.getByTestId("assistant-starter").first().or(panel.getByTestId("assistant-unavailable")),
    ).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .include("[data-testid=assistant-panel]")
      .analyze();
    const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(blocking.map((v) => v.id)).toEqual([]);
  });
});

test.describe("billing pages as owner (FIN)", () => {
  test.use({ storageState: storageState("owner") });
  for (const path of [
    "/quotes",
    "/quotes/new",
    "/invoices",
    "/invoices?status=overdue",
    "/invoices/new",
    "/settings/catalog",
    "/settings/billing",
  ]) {
    test(`axe: ${path}`, async ({ page }) => audit(page, path));
  }
  const first = async <T>(path: string) => {
    const client = await api("owner");
    const page = await json<{ data: T[] }>(await client.get(path));
    await client.dispose();
    return page.data[0];
  };
  test("axe: sent quote", async ({ page }) => {
    const q = await first<{ number: string }>("/api/v1/quotes?limit=1&status=sent");
    await audit(page, `/quotes/${q!.number}`);
  });
  test("axe: draft quote with the line editor", async ({ page }) => {
    const q = await first<{ number: string }>("/api/v1/quotes?limit=1&status=draft");
    await audit(page, `/quotes/${q!.number}`);
  });
  test("axe: overdue invoice", async ({ page }) => {
    const i = await first<{ id: string }>("/api/v1/invoices?limit=1&status=overdue");
    await audit(page, `/invoices/${i!.id}`);
  });
  test("axe: new invoice for a completed job", async ({ page }) => {
    const j = await first<{ number: string }>("/api/v1/jobs?limit=1&status=completed");
    await audit(page, `/invoices/new?job=${j!.number}`);
  });
});

test.describe("customer portal", () => {
  // Three pages that compile on first use under `next dev`; the home page also lists quotes and invoices.
  test.slow();
  test("axe: portal home, request form and job", async ({ page }) => {
    await page.goto("/portal/acme-air/sign-in");
    await page.getByTestId("portal-demo-sign-in").click();
    await expect(page).toHaveURL(/\/portal\/acme-air$/);
    await audit(page, "/portal/acme-air");
    const href = await page.getByTestId("portal-job").first().getAttribute("href");
    await audit(page, "/portal/acme-air/request");
    await audit(page, href!);
  });
});

test.describe("service report for customers (POR-04)", () => {
  test("axe: portal job with a service report", async ({ page }) => {
    const job = await completedJobForJamie(`E2E a11y portal report ${Date.now()}`);
    await sendReportToJamie(job.id);
    await page.goto("/portal/acme-air/sign-in");
    await page.getByTestId("portal-demo-sign-in").click();
    await expect(page).toHaveURL(/\/portal\/acme-air$/);
    await audit(page, `/portal/acme-air/jobs/${job.number}`);
    await expect(page.getByTestId("portal-report")).toBeVisible();
  });
  test("axe: an invalid report link", async ({ page }) => audit(page, "/share/reports/not.valid"));
});

test.describe("portal quotes, invoices and the test checkout (POR-04, FIN-05)", () => {
  // Each test opens pages that compile on first use under `next dev`.
  test.slow();
  test.beforeEach(async ({ page }) => {
    await page.goto("/portal/acme-air/sign-in");
    await page.getByTestId("portal-demo-sign-in").click();
    await expect(page).toHaveURL(/\/portal\/acme-air$/);
  });

  test("axe: quotes and a quote", async ({ page }) => {
    await audit(page, "/portal/acme-air/quotes");
    const quote = await page.getByTestId("portal-quote").first().getAttribute("href");
    await audit(page, quote!);
  });

  test("axe: invoices, an invoice and the test checkout", async ({ page }) => {
    await audit(page, "/portal/acme-air/invoices");
    const invoice = await page.getByTestId("portal-invoice").first().getAttribute("href");
    await audit(page, invoice!);

    const client = await api("owner");
    const open = await json<{ data: { id: string }[] }>(
      await client.get("/api/v1/invoices?limit=1&status=sent,overdue"),
    );
    const link = await json<{ url: string }>(
      await client.post(`/api/v1/invoices/${open.data[0]!.id}/checkout`),
    );
    await client.dispose();
    await audit(page, new URL(link.url).pathname);
    await expect(page.getByTestId("test-checkout-pay")).toBeVisible();
  });
});

test.describe("technician home", () => {
  test.use({ storageState: storageState("technician") });
  test("axe: dashboard", async ({ page }) => audit(page, "/dashboard"));
});

test.describe("technician view", () => {
  test.use({ storageState: storageState("technician") });
  test("axe: my day", async ({ page }) => audit(page, "/jobs?view=my-day"));
  test("axe: notification settings", async ({ page }) => audit(page, "/notifications/preferences"));
  test("axe: notification popover", async ({ page }) => {
    await page.goto("/jobs?view=my-day");
    await page.getByTestId("notification-bell").locator("visible=true").click();
    await expect(page.getByTestId("notification-popover")).toBeVisible();
    await expect(page.getByTestId("notification-popover").getByRole("status")).toHaveCount(0);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .include("[data-testid=notification-popover]")
      .analyze();
    const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(blocking.map((v) => v.id)).toEqual([]);
  });
});

test.describe("loading skeletons", () => {
  test.use({ storageState: storageState("owner") });

  test("a page shows an accessible skeleton while it loads, then the page", async ({ page }) => {
    await page.goto("/dashboard");
    // Hold the navigation request (not prefetches) so the route's loading state stays on screen.
    let release = () => {};
    const released = new Promise<void>((resolve) => (release = resolve));
    await page.route(
      (url) => url.searchParams.has("_rsc"),
      async (route) => {
        if (!route.request().headers()["next-router-prefetch"]) await released;
        await route.continue();
      },
    );
    const link = page
      .getByRole("navigation")
      .getByRole("link", { name: /^Customers/ })
      .first();
    await link.hover(); // prefetches the route's loading state
    await page.waitForLoadState("networkidle");
    await link.click();

    const skeleton = page.getByTestId("page-skeleton");
    await expect(skeleton).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Loading…" })).toBeAttached();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .include("[data-testid=page-skeleton]")
      .analyze();
    const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(blocking.map((v) => v.id)).toEqual([]);

    release();
    await expect(page.getByRole("heading", { name: "Customers", level: 1 })).toBeVisible();
    await expect(skeleton).toHaveCount(0);
  });
});

test.describe("maintenance plans and the SLA pause (JOB-13, SLA-04)", () => {
  test.use({ storageState: storageState("owner") });

  test("axe: customer with plans, and the plan dialog", async ({ page }) => {
    const client = await api("owner");
    const plans = await json<{ data: { customer: { id: string } }[] }>(
      await client.get("/api/v1/recurrences?limit=1&active=true"),
    );
    await client.dispose();
    await audit(page, `/customers/${plans.data[0]!.customer.id}`);
    await page.getByTestId("plan-add").click();
    await expect(page.getByTestId("plan-preview")).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .include("[role=dialog]")
      .analyze();
    const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(blocking.map((v) => v.id)).toEqual([]);
  });

  test("axe: a recurring job and a paused SLA", async ({ page }) => {
    const client = await api("owner");
    type Row = { number: string; recurrence_id: string | null; sla_paused_at: string | null };
    const fresh = await json<{ data: Row[] }>(
      await client.get("/api/v1/jobs?limit=100&status=new&sort=-created_at"),
    );
    const held = await json<{ data: Row[] }>(await client.get("/api/v1/jobs?limit=100&status=on_hold"));
    await client.dispose();
    await audit(page, `/jobs/${fresh.data.find((j) => j.recurrence_id)!.number}`);
    const paused = held.data.find((j) => j.sla_paused_at);
    if (paused) await audit(page, `/jobs/${paused.number}`);
  });
});

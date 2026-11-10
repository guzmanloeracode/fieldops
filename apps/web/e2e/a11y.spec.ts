import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { api, json, storageState } from "./fixtures";

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

test.describe("public pages", () => {
  for (const path of ["/", "/sign-in", "/sign-up", "/forgot-password"]) {
    test(`axe: ${path}`, async ({ page }) => audit(page, path));
  }
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
    "/settings/demo-outbox",
    "/approvals",
    "/schedule",
    "/schedule?view=week",
    "/schedule/team",
  ]) {
    test(`axe: ${path}`, async ({ page }) => audit(page, path));
  }
  test("axe: job detail", async ({ page }) => audit(page, `/jobs/${jobNumber}`));
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
});

test.describe("technician home", () => {
  test.use({ storageState: storageState("technician") });
  test("axe: dashboard", async ({ page }) => audit(page, "/dashboard"));
});

test.describe("technician view", () => {
  test.use({ storageState: storageState("technician") });
  test("axe: my day", async ({ page }) => audit(page, "/jobs?view=my-day"));
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

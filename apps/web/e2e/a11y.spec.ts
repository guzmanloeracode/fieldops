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
  ]) {
    test(`axe: ${path}`, async ({ page }) => audit(page, path));
  }
  test("axe: job detail", async ({ page }) => audit(page, `/jobs/${jobNumber}`));
  test("axe: customer detail", async ({ page }) => audit(page, `/customers/${customerId}`));
});

test.describe("technician view", () => {
  test.use({ storageState: storageState("technician") });
  test("axe: my day", async ({ page }) => audit(page, "/jobs?view=my-day"));
});

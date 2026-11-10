import { expect, test } from "@playwright/test";
import { uniq } from "./fixtures";

test.describe("demo sign-in (AUTH-09)", () => {
  for (const [role, landing] of [
    ["owner", /\/dashboard$/],
    ["dispatcher", /\/dashboard$/],
    ["technician", /\/jobs\?view=my-day$/],
  ] as const) {
    test(`${role} lands on the right page with the right navigation`, async ({ page }) => {
      await page.goto("/sign-in");
      await page.getByTestId(`demo-${role}`).click();
      await expect(page).toHaveURL(landing);
      const nav = page.getByRole("navigation", { name: "Main" }).first();
      await expect(nav.getByRole("link", { name: "Jobs" })).toBeVisible();
      if (role === "owner") {
        await expect(nav.getByRole("link", { name: "Members" })).toBeVisible();
        await expect(nav.getByRole("link", { name: "Organization" })).toBeVisible();
      } else {
        await expect(nav.getByRole("link", { name: "Members" })).toHaveCount(0);
        await expect(nav.getByRole("link", { name: "Organization" })).toHaveCount(0);
      }
      if (role === "technician") {
        await expect(page.getByRole("heading", { name: "My day" })).toBeVisible();
        await expect(nav.getByText("Dispatch board")).toHaveCount(0);
        // Settings are not reachable by URL either.
        const res = await page.goto("/settings/members");
        expect(res?.status()).toBe(404);
      } else {
        await expect(page.getByRole("heading", { name: /^Good day, / })).toBeVisible();
      }
    });
  }
});

test("sign-up, confirm through the demo inbox, create an organization (AUTH-01, AUTH-03)", async ({
  page,
}) => {
  const id = uniq();
  const email = `e2e+${id}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill("E2E Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();

  // An unconfirmed account can't sign in yet.
  await page.getByRole("link", { name: "Open demo inbox" }).click();
  await expect(page).toHaveURL(/\/demo-inbox$/);
  await expect(page.getByText(`To ${email}`)).toBeVisible();
  const mail = page.frameLocator("iframe").first();
  await mail.getByRole("link", { name: "Confirm email" }).click();

  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Business name").fill(`E2E Services ${id}`);
  await expect(page.getByLabel("Organization URL")).toHaveValue(`e2e-services-${id}`);
  await page.getByRole("button", { name: "Create organization" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Good day, E2E" })).toBeVisible();
  // A brand-new organization starts empty, with starter service types.
  await page.goto("/jobs");
  await expect(page.getByText("No jobs yet")).toBeVisible();
  await page.goto("/settings/service-types");
  await expect(page.getByText("Inspection", { exact: true })).toBeVisible();
});

test("signed-out visitors are sent to sign-in", async ({ page }) => {
  await page.goto("/jobs?status=new");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fjobs%3Fstatus%3Dnew$/);
});

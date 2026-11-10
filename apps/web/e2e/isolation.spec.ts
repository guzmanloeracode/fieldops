import { expect, test } from "@playwright/test";
import { api, json, storageState } from "./fixtures";

// AUTH-05 through the UI: a member of Acme Teknik can't open Acme Air records, even with their exact ids.
test.use({ storageState: storageState("otherOrgOwner") });

test("another organization's job, customer and equipment are not found", async ({ page }) => {
  const client = await api("dispatcher");
  const jobs = await json<{ data: { id: string; number: string; customer: { id: string } }[] }>(
    await client.get("/api/v1/jobs?limit=1"),
  );
  const job = jobs.data[0]!;
  const completed = await json<{ data: { equipment_id: string | null }[] }>(
    await client.get("/api/v1/jobs?limit=50&status=completed"),
  );
  const unitId = completed.data.find((j) => j.equipment_id)!.equipment_id!;
  await client.dispose();

  const jobRes = await page.goto(`/jobs/${job.id}`);
  expect(jobRes?.status()).toBe(404);
  await expect(page.getByText("This page could not be found")).toBeVisible();

  const customerRes = await page.goto(`/customers/${job.customer.id}`);
  expect(customerRes?.status()).toBe(404);

  const unitRes = await page.goto(`/equipment/${unitId}`);
  expect(unitRes?.status()).toBe(404);

  // Their own organization still works.
  await page.goto("/dashboard");
  await expect(page.getByText("Acme Teknik Nusantara").first()).toBeVisible();
});

// Pages with a loading skeleton check access in their layout, so the status is still a real 404 (server/guards.ts).
test.describe("pages a technician can't use", () => {
  test.use({ storageState: storageState("technician") });

  test("answer with a 404 status", async ({ page }) => {
    for (const path of [
      "/jobs/new",
      "/customers/new",
      "/schedule",
      "/schedule/team",
      "/approvals",
      "/settings/members",
    ]) {
      expect((await page.goto(path))?.status(), path).toBe(404);
    }
  });
});

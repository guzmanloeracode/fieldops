import { expect, test } from "@playwright/test";
import { api, json, storageState } from "./fixtures";

// AUTH-05 through the UI: a member of Acme Teknik can't open Acme Air records, even with their exact ids.
test.use({ storageState: storageState("otherOrgOwner") });

test("another organization's job and customer are not found", async ({ page }) => {
  const client = await api("dispatcher");
  const jobs = await json<{ data: { id: string; number: string; customer: { id: string } }[] }>(
    await client.get("/api/v1/jobs?limit=1"),
  );
  const job = jobs.data[0]!;
  await client.dispose();

  const jobRes = await page.goto(`/jobs/${job.id}`);
  expect(jobRes?.status()).toBe(404);
  await expect(page.getByText("This page could not be found")).toBeVisible();

  const customerRes = await page.goto(`/customers/${job.customer.id}`);
  expect(customerRes?.status()).toBe(404);

  // Their own organization still works.
  await page.goto("/dashboard");
  await expect(page.getByText("Acme Teknik Nusantara").first()).toBeVisible();
});

import { expect, test } from "@playwright/test";
import { api, json, storageState } from "./fixtures";

// Audit log (AUD-01–03): a change made through the API appears at the top with its before and after values, the
// viewer filters and pages, and the CSV export follows the filters. Owners and admins only.

test.describe("as the owner", () => {
  test.use({ storageState: storageState("owner") });

  test("a change shows who made it and what changed, but no visitor IP in the demo", async ({ page }) => {
    const client = await api("owner");
    const customers = await json<{ data: { id: string; name: string }[] }>(
      await client.get("/api/v1/customers?limit=1"),
    );
    const customer = customers.data[0]!;
    const note = `Audit check ${Date.now()}`;
    // The E2E stack has no proxy in front, so the app takes this header as the client's address.
    await json(
      await client.patch(`/api/v1/customers/${customer.id}`, {
        data: { notes: note },
        headers: { "X-Real-IP": "203.0.113.9" },
      }),
    );
    await client.dispose();

    await page.goto(`/settings/audit?entity_type=customer&entity_id=${customer.id}`);
    const entry = page.getByTestId("audit-entry").first();
    await expect(entry).toContainText("Olivia");
    await expect(entry).toContainText("updated customer");
    await expect(entry.getByRole("row", { name: /notes/ })).toContainText(note);
    // The demo shares accounts between visitors, so it never records their IP addresses.
    await expect(entry).not.toContainText("203.0.113.9");
    await expect(entry.getByRole("link", { name: "Open customer" })).toHaveAttribute(
      "href",
      `/customers/${customer.id}`,
    );
  });

  test("filters by action, pages through older entries and exports CSV", async ({ page }) => {
    await page.goto("/settings/audit");
    await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
    await expect(page.getByTestId("audit-entry").first()).toBeVisible();

    await page.getByLabel("Action").selectOption("sign_in");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/operation=sign_in/);
    const entries = page.getByTestId("audit-entry");
    await expect(entries.first()).toContainText("signed in");
    for (const text of await entries.allInnerTexts()) expect(text).toContain("signed in");

    await page.getByRole("link", { name: "Clear filters" }).click();
    await page.getByTestId("audit-older").click();
    await expect(page).toHaveURL(/cursor=/);
    await expect(page.getByRole("link", { name: "Newest entries" })).toBeVisible();

    const href = await page.getByTestId("audit-export").getAttribute("href");
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    const csv = await res.text();
    expect(csv.replace(/^\uFEFF/, "").split("\r\n")[0]).toBe(
      "Time,Actor,Action,Record type,Record ID,Job,Changes,IP address,User agent",
    );
    expect(csv.split("\r\n").length).toBeGreaterThan(3);
  });
});

test.describe("as a dispatcher", () => {
  test.use({ storageState: storageState("dispatcher") });

  test("the audit log and its export are for owners and admins", async ({ page }) => {
    const res = await page.goto("/settings/audit");
    expect(res?.status()).toBe(404);
    const csv = await page.request.get("/settings/audit/export");
    expect(csv.status()).toBe(403);
  });
});

import { expect, test } from "@playwright/test";
import { api, json, storageState, uniq } from "./fixtures";

test.use({ storageState: storageState("dispatcher") });

test("create a customer with a contact and first site, warn on a duplicate email, start a job (CUS-01/02/05)", async ({
  page,
}) => {
  // An email that already belongs to a seeded customer.
  const client = await api("dispatcher");
  const list = await json<{ data: { id: string; name: string }[] }>(
    await client.get("/api/v1/customers?limit=1&sort=name"),
  );
  const existing = await json<{ name: string; contacts: { email: string | null }[] }>(
    await client.get(`/api/v1/customers/${list.data[0]!.id}`),
  );
  const seededEmail = existing.contacts.find((c) => c.email)?.email;
  expect(seededEmail).toBeTruthy();
  await client.dispose();

  const name = `E2E Dental Group ${uniq()}`;
  await page.goto("/customers/new");
  await page.getByLabel("Commercial").check();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Tags").fill("E2E, Net 30");
  await page.getByLabel("Contact name").fill("Jamie Rivera");
  await page.getByLabel("Email", { exact: true }).fill(seededEmail!);
  await page.getByLabel("Phone", { exact: true }).fill("(512) 555-0199");
  await page.getByLabel("Phone", { exact: true }).blur();
  await expect(page.getByText(existing.name)).toBeVisible();

  await page.getByLabel("Site label").fill("Main office");
  await page.getByLabel("Street address").fill("500 Example Blvd");
  await page.getByLabel("City").fill("Austin");
  await page.getByLabel("State or province").fill("TX");
  await page.getByRole("button", { name: "Create customer" }).click();

  await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByText("Main office").first()).toBeVisible();
  await expect(page.getByText("Jamie Rivera").first()).toBeVisible();

  // "New job" from the customer pre-fills the customer and its only site.
  await page.getByRole("link", { name: "New job" }).click();
  await expect(page).toHaveURL(/\/jobs\/new\?customer=/);
  await expect(page.getByTestId("customer-picker")).toHaveText(new RegExp(name));
  await expect(page.getByLabel("Site", { exact: true })).toContainText("Main office");
});

test("customer list search and filters live in the URL", async ({ page }) => {
  await page.goto("/customers");
  await page.getByRole("searchbox").first().fill("LLC");
  await page.getByRole("searchbox").first().press("Enter");
  await expect(page).toHaveURL(/[?&]q=LLC/);
  await expect(page.getByRole("row").nth(1)).toContainText("LLC");
  await page.reload();
  await expect(page.getByRole("searchbox").first()).toHaveValue("LLC");
});

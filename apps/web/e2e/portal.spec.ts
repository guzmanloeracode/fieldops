import { expect, test, type Page } from "@playwright/test";
import { api, json } from "./fixtures";

// Customer portal (POR-01–03): sign-in by email link, the demo customer's one-click sign-in, requests with a photo,
// tracking, and the customer-only scope.

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PORTAL = "/portal/acme-air";

async function demoSignIn(page: Page) {
  await page.goto(`${PORTAL}/sign-in`);
  await page.getByTestId("portal-demo-sign-in").click();
  await expect(page).toHaveURL(new RegExp(`${PORTAL}$`));
  await expect(page.getByRole("heading", { name: "Hello, Jamie Rivera", level: 1 })).toBeVisible();
}

test("a customer signs in with a one-time email link (POR-01)", async ({ page }) => {
  await page.goto(PORTAL);
  await expect(page).toHaveURL(new RegExp(`${PORTAL}/sign-in$`));
  await expect(page.getByText("Acme Air & Clean").first()).toBeVisible();

  await page.getByLabel("Email").fill("Jamie.Rivera@example.com");
  await page.getByTestId("portal-request-link").click();
  await expect(page.getByText("Check your email")).toBeVisible();
  await page.getByRole("link", { name: "Open the demo inbox" }).click();
  await expect(page).toHaveURL(/\/demo-inbox$/);
  await expect(page.getByText("Your sign-in link for Acme Air & Clean").first()).toBeVisible();
  const link = page.getByRole("link", { name: "Open the customer portal" }).first();
  const href = (await link.getAttribute("href"))!;
  await link.click();

  await expect(page).toHaveURL(/\/portal\/acme-air\/auth\?token=/);
  await page.getByTestId("portal-continue").click();
  await expect(page.getByRole("heading", { name: "Hello, Jamie Rivera", level: 1 })).toBeVisible();
  await expect(page.getByText("Signed in as Jamie Rivera")).toBeVisible();

  // The link works once.
  await page.getByTestId("portal-sign-out").click();
  await expect(page).toHaveURL(new RegExp(`${PORTAL}/sign-in$`));
  await page.goto(new URL(href).pathname + new URL(href).search);
  await page.getByTestId("portal-continue").click();
  await expect(page.getByRole("alert")).toHaveText("This link has expired or was already used");
});

test("an unknown email gets the same answer and no email (no enumeration)", async ({ page }) => {
  const email = `nobody-${Date.now()}@example.com`;
  await page.goto(`${PORTAL}/sign-in`);
  await page.getByLabel("Email").fill(email);
  await page.getByTestId("portal-request-link").click();
  await expect(page.getByText(`If ${email} is on file with Acme Air & Clean`)).toBeVisible();
  await page.goto("/demo-inbox");
  await expect(page.getByText("Your sign-in link for")).toHaveCount(0);
});

test("a customer requests service with a photo and follows it; the office sees it for review (POR-02, POR-03)", async ({
  page,
}) => {
  await demoSignIn(page);
  await page.getByTestId("portal-new-request").click();
  await expect(page.getByRole("heading", { name: "Request service", level: 1 })).toBeVisible();
  const text = `Thermostat display is blank ${Date.now()}`;
  await page.getByLabel("What's wrong?").fill(`${text}\nThe breaker looks fine.`);
  await page.getByLabel(/^Time of day/).selectOption("afternoon");
  await page.getByRole("button", { name: "Add another time" }).click();
  await page
    .getByTestId("portal-photo-input")
    .setInputFiles({ name: "display.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByText("display.png")).toBeVisible();
  await page.getByTestId("portal-submit").click();

  await expect(page.getByTestId("portal-request-sent")).toContainText("Request sent. Your reference is JOB-");
  await expect(page.getByRole("heading", { name: text, level: 1 })).toBeVisible();
  await expect(page.getByText("Received").first()).toBeVisible();
  await expect(page.getByText("Times that suit you")).toBeVisible();
  await expect(page.getByRole("img", { name: "Photo display.png" })).toBeVisible();
  await expect(page.getByTestId("portal-history")).toContainText("Request received");
  const number = /JOB-\d+/.exec((await page.getByTestId("portal-request-sent").textContent())!)![0];

  await page.getByRole("link", { name: "All jobs" }).click();
  await expect(page.getByTestId("portal-job").filter({ hasText: text })).toBeVisible();

  // The office sees a portal job waiting for review.
  const client = await api("dispatcher");
  const job = await json<{ source: string; status: string; needs_review: boolean; title: string }>(
    await client.get(`/api/v1/jobs/${number}`),
  );
  expect(job).toMatchObject({ source: "portal", status: "new", needs_review: true, title: text });
  await client.dispose();
});

test("tracking shows the technician's first name only, and never another customer's job", async ({
  page,
}) => {
  await demoSignIn(page);
  const open = page.getByTestId("portal-job").filter({ hasText: "Technician:" }).first();
  await expect(open).toBeVisible();
  // "Technician: Tom", never a full name.
  const tech = /^Technician: (\S+)$/m.exec(await open.innerText())?.[1];
  expect(tech).toBeTruthy();
  await open.click();
  await expect(page.getByTestId("portal-history")).toContainText("Visit scheduled for");

  // A job of another customer is a 404, even by its number.
  const client = await api("owner");
  const jobs = await json<{ data: { number: string; customer: { name: string } }[] }>(
    await client.get("/api/v1/jobs?limit=20&sort=number"),
  );
  await client.dispose();
  const other = jobs.data.find((j) => j.customer.name !== "Jamie Rivera")!;
  const res = await page.goto(`${PORTAL}/jobs/${other.number.replace(/^JOB-0*/, "")}`);
  expect(res?.status()).toBe(404);

  // The session is scoped to this portal: another organization's portal asks to sign in.
  await page.goto("/portal/acme-teknik");
  await expect(page).toHaveURL(/\/portal\/acme-teknik\/sign-in$/);
});

test("unknown portals are 404s", async ({ page }) => {
  const res = await page.goto("/portal/no-such-business");
  expect(res?.status()).toBe(404);
});

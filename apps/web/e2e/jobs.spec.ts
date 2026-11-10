import { expect, test } from "@playwright/test";
import {
  api,
  assign,
  createJob,
  expectStatus,
  futureWindow,
  memberByEmail,
  storageState,
  toChicagoInput,
  uniq,
  USERS,
} from "./fixtures";
import { signViaApi } from "./fieldwork-helpers";

test.describe("dispatcher (J1 for 0.1)", () => {
  test.use({ storageState: storageState("dispatcher") });

  test("creates a job, schedules it, and handles an overlapping visit", async ({ page }) => {
    const client = await api("dispatcher");
    const customers = (await (await client.get("/api/v1/customers?limit=1&sort=name")).json()) as {
      data: { id: string; name: string }[];
    };
    const customer = customers.data[0]!;
    const title = `E2E leaking unit ${uniq()}`;

    await page.goto("/jobs/new");
    await page.getByTestId("customer-picker").click();
    await page.getByPlaceholder("Search customers…").fill(customer.name);
    await page
      .getByRole("option", { name: new RegExp(customer.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })
      .first()
      .click();
    await expect(page.getByTestId("customer-picker")).toHaveText(
      new RegExp(customer.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );

    // Choose the first site if more than one exists.
    const site = page.getByLabel("Site", { exact: true });
    await expect(site).toBeEnabled();
    if ((await site.textContent())?.includes("Choose a site")) {
      await site.click();
      await page.getByRole("option").first().click();
    }
    await page.getByLabel("Service type", { exact: true }).click();
    await page.getByRole("option", { name: "AC repair" }).click();
    await page.getByLabel("Title", { exact: true }).fill(title);
    await page.getByLabel("Description", { exact: true }).fill("Water dripping from the bedroom unit.");
    await page.getByText("High", { exact: true }).click();
    await page.getByTestId("create-job").click();

    await expect(page).toHaveURL(/\/jobs\/JOB-\d{6}$/);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expectStatus(page, "New");
    const firstJobUrl = page.url();

    // Assign Tom for a free window: a new job with a technician and a time becomes Scheduled.
    const w = futureWindow(2);
    await page.getByTestId("assign-open").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText("Tom Reyes", { exact: true }).click();
    await dialog.getByLabel("Start", { exact: true }).fill(toChicagoInput(w.start));
    await dialog.getByLabel("End", { exact: true }).fill(toChicagoInput(w.end));
    await dialog.getByTestId("assign-save").click();
    await expect(dialog).toBeHidden();
    await expectStatus(page, "Scheduled");
    await expect(page.getByText("Tom Reyes").first()).toBeVisible();

    // A second job in the same window for Tom triggers the conflict warning (SCH-03).
    const second = await createJob(client, `E2E overlap ${uniq()}`);
    await page.goto(`/jobs/${second.number}`);
    await page.getByTestId("assign-open").click();
    await dialog.getByText("Tom Reyes", { exact: true }).click();
    await dialog
      .getByLabel("Start", { exact: true })
      .fill(toChicagoInput(new Date(w.start.getTime() + 30 * 60_000)));
    await dialog
      .getByLabel("End", { exact: true })
      .fill(toChicagoInput(new Date(w.end.getTime() + 30 * 60_000)));
    await dialog.getByTestId("assign-save").click();
    await expect(dialog.getByText("This overlaps another visit")).toBeVisible();
    await expect(dialog.getByTestId("assign-save")).toBeDisabled();
    await dialog
      .getByLabel("Reason for overriding")
      .fill("Customer asked for the same slot; Tom will bring a helper.");
    await dialog.getByTestId("assign-save").click();
    await expect(dialog).toBeHidden();
    await expectStatus(page, "Scheduled");
    await expect(page.getByText(/Override: Customer asked for the same slot/)).toBeVisible();

    // The first job is still fine.
    await page.goto(firstJobUrl);
    await expectStatus(page, "Scheduled");
    await client.dispose();
  });
});

test.describe("technician and dispatcher (J2 for 0.1)", () => {
  let jobNumber = "";

  test.beforeAll(async () => {
    const client = await api("dispatcher");
    const job = await createJob(client, `E2E on-site work ${uniq()}`);
    const tom = await memberByEmail(client, USERS.technician);
    await assign(client, job.id, tom.id, futureWindow(1));
    jobNumber = job.number;
    await client.dispose();
  });

  test("technician works the job from En route to Complete", async ({ browser }) => {
    const page = await browser.newPage({ storageState: storageState("technician") });
    await page.goto(`/jobs/${jobNumber}`);
    await expectStatus(page, "Scheduled");
    // Technicians can't reassign or edit the job.
    await expect(page.getByTestId("assign-open")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "More actions" })).toHaveCount(0);

    await page.getByTestId("transition-depart").click();
    await expectStatus(page, "En route");
    await page.getByTestId("transition-start").click();
    await expectStatus(page, "In progress");

    // Hold needs what the job is waiting for and a reason.
    await page.getByTestId("transition-hold").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Confirm" })).toBeDisabled();
    await dialog.getByText("Waiting for parts").click();
    await dialog.getByLabel("Reason").fill("Fan motor on order");
    await dialog.getByRole("button", { name: "Confirm" }).click();
    await expect(dialog).toBeHidden();
    await expectStatus(page, "On hold");
    await expect(page.getByText("Waiting for parts").first()).toBeVisible();

    await page.getByTestId("transition-resume").click();
    await expectStatus(page, "In progress");

    // Notes: one internal, one for the customer.
    await page.getByLabel("Add note").fill("Replaced the fan motor.");
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page.getByText("Replaced the fan motor.")).toBeVisible();
    await page.getByLabel("Add note").fill("Your unit is cooling normally again.");
    await page.getByRole("switch").click();
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page.getByText("Your unit is cooling normally again.")).toBeVisible();
    await expect(page.getByText("Customer can see")).toBeVisible();

    // Acme Air asks for the customer's signature on completion (JOB-10).
    await page.getByTestId("transition-complete").click();
    const complete = page.getByRole("dialog");
    await complete.getByLabel("Signer's name").fill("Cara Example");
    await complete.getByText("Type name").click();
    await complete.getByTestId("complete-confirm").click();
    await expectStatus(page, "Completed");

    const timeline = page.locator("ol").filter({ hasText: "created the job" });
    for (const text of [
      "changed the status from Scheduled to En route",
      "changed the status from En route to In progress",
      "changed the status from In progress to On hold",
      "changed the status from On hold to In progress",
      "changed the status from In progress to Completed",
      "added a note for the customer",
      "captured the customer's signature (Cara Example)",
    ]) {
      await expect(timeline.getByText(text)).toBeVisible();
    }
    await expect(timeline.getByText("“Fan motor on order”")).toBeVisible();
    // Reopening is for the office, not the technician.
    await expect(page.getByTestId("transition-reopen")).toHaveCount(0);
    await page.close();
  });

  test("dispatcher reopens the completed job with a reason", async ({ browser }) => {
    test.skip(!jobNumber, "needs the job from beforeAll");
    const tech = await api("technician");
    // Make sure the job is completed even if this test runs on its own.
    const job = (await (await tech.get(`/api/v1/jobs/${jobNumber}`)).json()) as {
      id: string;
      status: string;
    };
    if (job.status !== "completed") await signViaApi(tech, job.id);
    for (const to of ["en_route", "in_progress", "completed"]) {
      if (job.status === "completed") break;
      const order = ["scheduled", "en_route", "in_progress", "completed"];
      if (order.indexOf(job.status) < order.indexOf(to)) {
        const r = await tech.post(`/api/v1/jobs/${job.id}/transitions`, { data: { to } });
        expect(r.ok(), await r.text()).toBeTruthy();
        job.status = to;
      }
    }
    await tech.dispose();

    const page = await browser.newPage({ storageState: storageState("dispatcher") });
    await page.goto(`/jobs/${jobNumber}`);
    await expectStatus(page, "Completed");
    await page.getByTestId("transition-reopen").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Confirm" })).toBeDisabled();
    await dialog.getByLabel("Reason").fill("Customer reports the unit is leaking again");
    await dialog.getByRole("button", { name: "Confirm" }).click();
    await expectStatus(page, "In progress");
    await expect(page.getByText("“Customer reports the unit is leaking again”")).toBeVisible();
    await page.close();
  });
});

test.describe("jobs list (JOB-03)", () => {
  test.use({ storageState: storageState("dispatcher") });

  test("filters and sort live in the URL and survive a reload", async ({ page }) => {
    await page.goto("/jobs");
    await expect(page.getByTestId("job-row").first()).toBeVisible();

    await page
      .getByRole("button", { name: /^Status/ })
      .first()
      .click();
    await page.getByRole("checkbox", { name: "Scheduled" }).click();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/[?&]status=scheduled(&|$)/);

    await page
      .getByRole("button", { name: /^Priority/ })
      .first()
      .click();
    await page.getByRole("checkbox", { name: "High" }).click();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/[?&]priority=high(&|$)/);

    await page.getByRole("button", { name: "Scheduled", exact: true }).click();
    await expect(page).toHaveURL(/[?&]sort=scheduled_start(&|$)/);

    await page.reload();
    await expect(page).toHaveURL(/status=scheduled/);
    await expect(page.getByRole("button", { name: /^Status\s*1/ })).toBeVisible();
    const rows = page.getByTestId("job-row");
    await expect(rows.first()).toBeVisible();
    const count = await rows.count();
    for (let i = 0; i < Math.min(count, 10); i++) {
      await expect(rows.nth(i)).toContainText("Scheduled");
      await expect(rows.nth(i)).toContainText("High");
    }

    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/\/jobs$/);
  });

  test("search by job number finds the job", async ({ page }) => {
    const client = await api("dispatcher");
    const job = await createJob(client, `E2E searchable ${uniq()}`);
    await client.dispose();
    await page.goto("/jobs");
    await page.getByRole("searchbox", { name: "Search jobs" }).fill(job.number);
    await expect(page).toHaveURL(new RegExp(`[?&]q=${job.number}`));
    await expect(page.getByTestId("job-row")).toHaveCount(1);
    await expect(page.getByTestId("job-row")).toContainText(job.number);
    await page.getByRole("link", { name: job.title }).click();
    await expect(page).toHaveURL(new RegExp(`/jobs/${job.number}$`));
  });
});

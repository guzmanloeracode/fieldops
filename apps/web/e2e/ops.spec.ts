import { expect, test } from "@playwright/test";
import {
  api,
  assign,
  createJob,
  expectStatus,
  futureWindow,
  json,
  memberByEmail,
  storageState,
  uniq,
  USERS,
} from "./fixtures";

// 0.4 operations: maintenance plans that create recurring jobs (JOB-13) and the SLA pause while waiting for the
// customer (SLA-04).

type Plan = {
  id: string;
  title: string;
  status: string;
  job_count: number;
  upcoming_dates: string[];
  lead_member: { name: string } | null;
};
type Job = {
  id: string;
  number: string;
  status: string;
  source: string;
  recurrence_id: string | null;
  occurrence_date: string | null;
  resolution_due_at: string | null;
  sla_paused_at: string | null;
};

/** Today's date in the demo organization's time zone. */
const chicagoDate = (offsetDays = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(
    new Date(Date.now() + offsetDays * 86_400_000),
  );

test.describe("maintenance plans (JOB-13)", () => {
  test.use({ storageState: storageState("dispatcher") });

  test("a plan creates its jobs ahead of time, and they link back to it", async ({ page }) => {
    test.slow();
    const client = await api("dispatcher");
    const owner = await api("owner");
    const customers = await json<{ data: { id: string; name: string }[] }>(
      await client.get("/api/v1/customers?type=commercial&limit=10&sort=name"),
    );
    let customerId = "";
    for (const c of customers.data) {
      const sites = await json<{ data: unknown[] }>(await client.get(`/api/v1/customers/${c.id}/sites`));
      if (sites.data.length) {
        customerId = c.id;
        break;
      }
    }
    expect(customerId).not.toBe("");
    const title = `E2E weekly check ${uniq()}`;
    let planId = "";
    let jobs: Job[] = [];
    try {
      await page.goto(`/customers/${customerId}`);
      const section = page.getByTestId("maintenance-plans");
      await expect(section.getByRole("heading", { name: "Maintenance plans" })).toBeVisible();
      await section.getByTestId("plan-add").click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("heading", { name: "New maintenance plan" })).toBeVisible();
      await dialog.getByLabel("Title").fill(title);
      await dialog.getByLabel("Repeat every").fill("1");
      await dialog.getByLabel("Unit").selectOption("week");
      await dialog.getByLabel("Create jobs this many days ahead").fill("14");
      await dialog.getByLabel("Preferred technician").selectOption({ label: "Tom Reyes" });
      // The preview lists the next five visits from today.
      await expect(dialog.getByTestId("plan-preview").getByRole("listitem")).toHaveCount(5);
      await expect(dialog.getByTestId("plan-preview").locator("time").first()).toHaveAttribute(
        "datetime",
        chicagoDate(),
      );
      await dialog.getByTestId("plan-save").click();
      // Today, in a week and in two weeks are within the 14 days.
      await expect(page.getByText("Plan created. 3 jobs are ready on the schedule.")).toBeVisible();
      await expect(dialog).toBeHidden();

      const row = section.getByTestId("plan-row").filter({ hasText: title });
      await expect(row).toContainText("Every week");
      await expect(row.getByTestId("plan-status")).toHaveText("Active");
      await expect(row).toContainText("Preferred technician: Tom Reyes");

      const plans = await json<{ data: Plan[] }>(
        await client.get(`/api/v1/recurrences?customer=${customerId}`),
      );
      const plan = plans.data.find((p) => p.title === title)!;
      planId = plan.id;
      expect(plan).toMatchObject({ status: "active", job_count: 3, lead_member: { name: "Tom Reyes" } });
      expect(plan.upcoming_dates[0]).toBe(chicagoDate());

      const list = await json<{ data: Job[] }>(
        await client.get(`/api/v1/jobs?customer=${customerId}&limit=100&sort=-created_at`),
      );
      jobs = list.data
        .filter((j) => j.recurrence_id === planId)
        .sort((a, b) => a.number.localeCompare(b.number));
      expect(jobs.map((j) => [j.source, j.status, j.occurrence_date])).toEqual([
        ["recurring", "new", chicagoDate()],
        ["recurring", "new", chicagoDate(7)],
        ["recurring", "new", chicagoDate(14)],
      ]);

      // The job shows where it came from and the plan's preferred technician, not assigned.
      await page.goto(`/jobs/${jobs[0]!.number}`);
      await expectStatus(page, "New");
      await expect(page.getByTestId("suggested-technician")).toHaveText("Suggested: Tom Reyes");
      const badge = page.getByTestId("recurring-badge");
      await expect(badge).toHaveAttribute("href", `/customers/${customerId}#plan-${planId}`);
      await expect(page.getByText("created the job from the maintenance plan")).toBeVisible();
      await badge.click();
      await expect(page).toHaveURL(new RegExp(`/customers/${customerId}#plan-${planId}$`));
      await expect(page.getByTestId("plan-row").filter({ hasText: title })).toBeVisible();

      // The jobs list badges them too.
      await page.goto(`/jobs?customer=${customerId}&sort=-created_at`);
      await expect(page.getByTestId("recurring-badge").first()).toBeVisible();

      // Pause and resume.
      await page.goto(`/customers/${customerId}`);
      const again = page.getByTestId("plan-row").filter({ hasText: title });
      await again.getByTestId("plan-pause").click();
      await expect(page.getByText("Plan paused. No new jobs until you resume it.")).toBeVisible();
      await expect(again.getByTestId("plan-status")).toHaveText("Paused");
      await again.getByTestId("plan-resume").click();
      await expect(again.getByTestId("plan-status")).toHaveText("Active");
      // Resuming creates nothing twice.
      const after = await json<Plan>(await client.get(`/api/v1/recurrences/${planId}`));
      expect(after.job_count).toBe(3);
    } finally {
      if (planId) expect((await client.delete(`/api/v1/recurrences/${planId}`)).status()).toBe(204);
      for (const j of jobs) expect((await owner.delete(`/api/v1/jobs/${j.id}`)).status()).toBe(204);
      await client.dispose();
      await owner.dispose();
    }
  });

  test("the API validates plans and keeps them to the office", async () => {
    const client = await api("dispatcher");
    const tech = await api("technician");
    try {
      expect((await tech.get("/api/v1/recurrences")).status()).toBe(403);
      const bad = await client.post("/api/v1/recurrences", {
        data: {
          customer_id: "00000000-0000-4000-8000-000000000000",
          site_id: "00000000-0000-4000-8000-000000000000",
          title: "x",
          interval_unit: "month",
          interval_count: 1,
          starts_on: chicagoDate(),
          window_start: "09:00",
        },
      });
      expect(bad.status()).toBe(422);
      expect((await client.get("/api/v1/recurrences/not-a-uuid")).status()).toBe(404);
    } finally {
      await client.dispose();
      await tech.dispose();
    }
  });
});

test.describe("SLA pause (SLA-04)", () => {
  test.use({ storageState: storageState("technician") });

  test("on hold for the customer pauses the clock, and resuming moves the deadline", async ({ page }) => {
    const dispatcher = await api("dispatcher");
    try {
      const job = await createJob(dispatcher, `E2E waiting on customer ${uniq()}`);
      const tom = await memberByEmail(dispatcher, USERS.technician);
      await assign(dispatcher, job.id, tom.id, futureWindow(1));
      const before = await json<Job>(await dispatcher.get(`/api/v1/jobs/${job.id}`));

      await page.goto(`/jobs/${job.number}`);
      await page.getByTestId("transition-start").click();
      await expectStatus(page, "In progress");
      await page.getByTestId("transition-hold").click();
      const dialog = page.getByRole("dialog");
      await dialog.getByText("Waiting for the customer").click();
      await dialog.getByLabel("Reason").fill("Tenant is away until tomorrow");
      await dialog.getByRole("button", { name: "Confirm" }).click();
      await expect(dialog).toBeHidden();
      await expectStatus(page, "On hold");

      const resolution = page.getByTestId("sla-resolution");
      await expect(resolution.locator("[data-sla=paused]")).toHaveText(/Paused/);
      await expect(resolution).toContainText("while waiting for the customer");
      const held = await json<Job>(await dispatcher.get(`/api/v1/jobs/${job.id}`));
      expect(held.sla_paused_at).not.toBeNull();
      expect(held.resolution_due_at).toBe(before.resolution_due_at);

      await page.getByTestId("transition-resume").click();
      await expectStatus(page, "In progress");
      const resumed = await json<Job>(await dispatcher.get(`/api/v1/jobs/${job.id}`));
      expect(resumed.sla_paused_at).toBeNull();
      // A started minute counts: the deadline moved by the whole minutes paused.
      const moved = Date.parse(resumed.resolution_due_at!) - Date.parse(before.resolution_due_at!);
      expect(moved).toBeGreaterThanOrEqual(60_000);
      expect(moved % 60_000).toBe(0);
      await expect(resolution.locator("[data-sla=paused]")).toHaveCount(0);
      await expect(page.getByTestId("sla-paused-total")).toContainText("Paused");
      await expect(
        page.getByText("The resolution clock stopped while waiting for the customer."),
      ).toBeVisible();
      await expect(page.getByTestId("timeline-sla-resumed")).toContainText(
        "The resolution clock was paused for",
      );
    } finally {
      await dispatcher.dispose();
    }
  });
});

test.describe("daily digest settings (NOT-04)", () => {
  test.use({ storageState: storageState("owner") });

  test("owners get the digest by email unless they turn it off; it has no in-app switch", async ({
    page,
  }) => {
    await page.goto("/notifications/preferences");
    const row = page.getByTestId("pref-daily_digest");
    await expect(row).toContainText("Daily summary at 7:00");
    await expect(row).toContainText("Email only");
    await expect(page.getByTestId("pref-daily_digest-in_app")).toHaveCount(0);
    await expect(page.getByTestId("pref-daily_digest-email")).toBeChecked();
    const dispatcher = await api("dispatcher");
    try {
      const prefs = await json<{ data: { event: string }[] }>(
        await dispatcher.get("/api/v1/notifications/preferences"),
      );
      expect(prefs.data.some((p) => p.event === "daily_digest")).toBe(false);
    } finally {
      await dispatcher.dispose();
    }
  });
});

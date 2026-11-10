import { expect, test } from "@playwright/test";
import { api, createJob, DEMO_PASSWORD, json, memberByEmail, storageState, uniq, USERS } from "./fixtures";

// 0.2 insights: dashboards and drill-down (DSH-01 – DSH-04), saved views, bulk actions and CSV export
// (JOB-04), the command palette (JOB-11), equipment (CUS-03) and organization switching (AUTH-06).

test.describe("owner dashboard (DSH-01 – DSH-03)", () => {
  test.use({ storageState: storageState("owner") });

  test("shows KPIs against the previous period and drills down into the jobs table", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByTestId("dashboard-tab-overview")).toHaveAttribute("aria-current", "page");
    for (const key of ["created", "completed", "sla", "response", "resolution", "first-visit"]) {
      await expect(page.getByTestId(`kpi-${key}`)).toBeVisible();
    }
    await expect(page.getByTestId("kpi-sla")).toContainText("Resolution targets met");
    await expect(page.getByTestId("dashboard-period")).toContainText("compared with");

    // Period presets live in the URL.
    await page.getByLabel("Period").click();
    await page.getByRole("option", { name: "Last 7 days" }).click();
    await expect(page).toHaveURL(/range=7d/);

    // A KPI opens the matching jobs.
    await page.getByTestId("kpi-completed").click();
    await expect(page).toHaveURL(/\/jobs\?.*status=completed/);
    await expect(page).toHaveURL(/date_field=completed/);
    await expect(page.getByTestId("extra-filters")).toContainText("Dates: completed");
    await expect(page.getByTestId("job-row").first()).toContainText("Completed");
  });

  test("every chart has a data table with drill-down links", async ({ page }) => {
    await page.goto("/dashboard?tab=overview&range=30d");
    for (const id of ["chart-status", "chart-sla", "chart-types", "chart-workload"]) {
      await expect(page.locator(`#${id}-title`)).toBeVisible();
    }
    const table = page.getByTestId("chart-types-data");
    await table.locator("summary").click();
    const link = table.getByRole("link").first();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/jobs\?.*service_type=/);
    await expect(page.getByTestId("job-row").first()).toBeVisible();
  });
});

test.describe("dispatcher home (DSH-04)", () => {
  test.use({ storageState: storageState("dispatcher") });

  test("dispatchers start on today's operations", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByTestId("dashboard-tab-today")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("today-scheduled")).toBeVisible();
    await expect(page.getByText("Technicians today")).toBeVisible();
    await expect(page.getByText("At-risk jobs")).toBeVisible();
    await page.getByTestId("today-unassigned").click();
    await expect(page).toHaveURL(/unassigned=true/);
    await expect(page.getByTestId("extra-filters")).toContainText("Unassigned only");
  });
});

test.describe("technician home", () => {
  test.use({ storageState: storageState("technician") });

  test("technicians see their own numbers and no office dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Your numbers" })).toBeVisible();
    await expect(page.getByTestId("own-week-completed")).toBeVisible();
    await expect(page.getByTestId("dashboard-tab-overview")).toHaveCount(0);
    await page.getByRole("link", { name: "Open my day" }).click();
    await expect(page).toHaveURL(/view=my-day/);
  });

  test("technicians can't export jobs or bulk-select", async ({ page }) => {
    const res = await page.request.get("/jobs/export", { timeout: 60_000 });
    expect(res.status()).toBe(403);
    await page.goto("/jobs");
    await expect(page.getByTestId("select-all")).toHaveCount(0);
  });
});

test.describe("saved views, bulk actions and export (JOB-04)", () => {
  test.use({ storageState: storageState("dispatcher") });

  test("saves, applies and deletes a view; seeded shared views are listed", async ({ page }) => {
    const name = `E2E holds ${uniq()}`;
    await page.goto("/jobs?status=on_hold&sort=-created_at");
    await page.getByTestId("views-menu").click();
    await expect(page.getByRole("menuitem", { name: "Waiting for parts" })).toBeVisible();
    await page.getByTestId("views-save").click();
    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Share with the office team").click();
    await page.getByTestId("view-save-submit").click();
    await expect(page.getByText("View saved")).toBeVisible();
    await expect(page.getByTestId("views-menu")).toContainText(name);

    await page.goto("/jobs");
    await page.getByTestId("views-menu").click();
    await page.getByRole("menuitem", { name }).click();
    await expect(page).toHaveURL(/status=on_hold/);

    await page.getByTestId("views-menu").click();
    await page.getByRole("menuitem", { name: "Manage views…" }).click();
    await page.getByRole("button", { name: `Delete view ${name}` }).click();
    await expect(page.getByText("View deleted")).toBeVisible();
  });

  test("assigns and cancels selected jobs, reports skipped ones, and exports CSV", async ({ page }) => {
    const client = await api("dispatcher");
    const tag = `E2E bulk ${uniq()}`;
    const a = await createJob(client, `${tag} A`);
    const b = await createJob(client, `${tag} B`);
    const tom = await memberByEmail(client, USERS.technician);

    await page.goto(`/jobs?q=${encodeURIComponent(tag)}`);
    await expect(page.getByTestId("job-row")).toHaveCount(2);
    await page.getByTestId("select-all").click();
    await expect(page.getByTestId("bulk-bar")).toContainText("2 jobs selected");

    await page.getByTestId("bulk-assign").click();
    await page.getByRole("dialog").getByRole("combobox", { name: "Technician" }).click();
    await page.getByRole("option", { name: tom.name }).click();
    await page.getByTestId("bulk-assign-apply").click();
    await expect(page.getByText("2 jobs updated").first()).toBeVisible();
    await expect(page.getByTestId("job-row").first()).toContainText(tom.name);

    // Assigning the same lead again is skipped, with the reason per job.
    await page.getByTestId("select-all").click();
    await page.getByTestId("bulk-assign").click();
    await page.getByRole("dialog").getByRole("combobox", { name: "Technician" }).click();
    await page.getByRole("option", { name: tom.name }).click();
    await page.getByTestId("bulk-assign-apply").click();
    await expect(page.getByTestId("bulk-skipped")).toContainText("Already assigned");

    // The CSV holds exactly the filtered jobs.
    const csv = await page.request.get(`/jobs/export?q=${encodeURIComponent(tag)}`, { timeout: 60_000 });
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    const text = await csv.text();
    expect(text).toContain("Number,Title,Status");
    expect(text).toContain(a.number);
    expect(text).toContain(b.number);
    expect(text.trim().split("\r\n")).toHaveLength(3);

    await page.getByTestId("select-all").click();
    await page.getByTestId("bulk-status").click();
    await page.getByRole("dialog").getByRole("combobox", { name: "New status" }).click();
    await page.getByRole("option", { name: "Canceled" }).click();
    await page
      .getByRole("dialog")
      .getByLabel("Reason", { exact: true })
      .fill("Customer called to cancel both visits");
    await page.getByTestId("bulk-status-apply").click();
    await expect(page.getByText("2 jobs updated").first()).toBeVisible();
    await expect(page.getByTestId("job-row").first()).toContainText("Canceled");
    await client.dispose();
  });
});

test.describe("command palette (JOB-11)", () => {
  test.use({ storageState: storageState("dispatcher") });

  test("finds a job by number and jumps to pages", async ({ page }) => {
    const client = await api("dispatcher");
    const job = await createJob(client, `E2E palette ${uniq()}`);
    await client.dispose();
    await page.goto("/jobs");
    await page.keyboard.press("ControlOrMeta+k");
    const input = page.getByTestId("palette-input");
    await expect(input).toBeVisible();
    await input.fill(job.number);
    await expect(page.getByTestId("palette-job").first()).toContainText(job.title);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/jobs/${job.number}$`));

    await page.getByTestId("palette-open").click();
    await page.getByTestId("palette-input").fill("dispatch");
    await page.getByRole("option", { name: "Dispatch board" }).click();
    await expect(page).toHaveURL(/\/schedule/);
  });
});

test.describe("command palette for technicians (TEC-05)", () => {
  test.use({ storageState: storageState("technician") });

  test("only finds assigned work", async ({ page }) => {
    const client = await api("dispatcher");
    const job = await createJob(client, `E2E not yours ${uniq()}`);
    await client.dispose();
    await page.goto("/jobs?view=my-day");
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByTestId("palette-input").fill(job.number);
    await expect(page.getByText("No results.")).toBeVisible();
  });
});

test.describe("equipment (CUS-03)", () => {
  test.use({ storageState: storageState("owner") });

  test("adds a unit to a site, edits it through the API and shows its history", async ({ page }) => {
    const client = await api("owner");
    const customers = await json<{ data: { id: string }[] }>(
      await client.get("/api/v1/customers?limit=1&sort=name"),
    );
    const customerId = customers.data[0]!.id;
    const type = `E2E heat pump ${uniq()}`;

    await page.goto(`/customers/${customerId}`);
    await page.getByTestId("equipment-add").first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Type").fill(type);
    await dialog.getByLabel("Brand").fill("Daikin");
    await dialog.getByLabel("Install date").fill("2024-05-01");
    await dialog.getByLabel("Warranty end").fill("2023-01-01");
    await dialog.getByTestId("equipment-save").click();
    await expect(dialog.getByText("Must be on or after the install date")).toBeVisible();
    await dialog.getByLabel("Warranty end").fill("2034-05-01");
    await dialog.getByTestId("equipment-save").click();
    await expect(dialog).toBeHidden();

    await page.getByRole("link", { name: type }).click();
    await expect(page).toHaveURL(/\/equipment\//);
    await expect(page.getByRole("heading", { name: `Daikin ${type}` })).toBeVisible();
    await expect(page.getByText("Under warranty")).toBeVisible();
    await expect(page.getByText("No jobs for this unit yet.")).toBeVisible();

    const id = page.url().split("/equipment/")[1]!;
    const patched = await client.patch(`/api/v1/equipment/${id}`, { data: { model: "FTX-25" } });
    expect(patched.status(), await patched.text()).toBe(200);
    expect(((await patched.json()) as { model: string }).model).toBe("FTX-25");
    await client.dispose();
  });

  test("seeded units list their service history", async ({ page }) => {
    const client = await api("owner");
    const jobs = await json<{ data: { equipment_id: string | null }[] }>(
      await client.get("/api/v1/jobs?limit=50&status=completed"),
    );
    await client.dispose();
    const unit = jobs.data.find((j) => j.equipment_id)?.equipment_id;
    expect(unit).toBeTruthy();
    await page.goto(`/equipment/${unit}`);
    await expect(page.getByTestId("equipment-history")).toBeVisible();
    await expect(page.getByTestId("equipment-history").getByRole("link").first()).toContainText("JOB-");
  });
});

test.describe("organization switching (AUTH-06)", () => {
  test("Olivia switches between Acme Air and Acme Teknik in her own session", async ({
    browser,
    baseURL,
  }) => {
    // A fresh session, so the shared owner session used by other tests keeps its active organization.
    const context = await browser.newContext({ baseURL });
    const res = await context.request.post("/api/auth/sign-in/email", {
      data: { email: USERS.owner, password: DEMO_PASSWORD },
      headers: { Origin: baseURL! },
    });
    expect(res.ok()).toBeTruthy();
    const page = await context.newPage();
    await page.goto("/dashboard");
    const sidebar = page.locator("aside");
    await expect(sidebar.getByText("Acme Air & Clean").first()).toBeVisible();

    await page.getByTestId("user-menu").click();
    await expect(page.getByTestId("org-option")).toHaveCount(2);
    await page.getByTestId("org-option").filter({ hasText: "Acme Teknik Nusantara" }).click();
    await expect(sidebar.getByText("Acme Teknik Nusantara").first()).toBeVisible();
    await expect(page.getByText("Admin · Acme Teknik Nusantara")).toBeVisible();

    await page.getByTestId("user-menu").click();
    await page.getByTestId("org-option").filter({ hasText: "Acme Air & Clean" }).click();
    await expect(sidebar.getByText("Acme Air & Clean").first()).toBeVisible();
    await context.close();
  });
});

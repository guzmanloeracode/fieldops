import { expect, test } from "@playwright/test";
import { api, json, storageState, uniq } from "./fixtures";

// 0.3 SLA (SLA-01 – SLA-03) and the dashboard CSV export (DSH-05).

type Policy = { priority: string; response_min: number; resolution_min: number; business_hours: boolean };
type Job = {
  id: string;
  number: string;
  created_at: string;
  response_due_at: string | null;
  resolution_due_at: string | null;
  sla_response_state: string | null;
  sla_resolution_state: string | null;
};

test.describe("SLA policies (SLA-01)", () => {
  test.use({ storageState: storageState("owner") });

  test("owner changes a target and new jobs get deadlines from it", async ({ page }) => {
    const client = await api("owner");
    const before = await json<{ data: (Policy & { is_default: boolean })[] }>(
      await client.get("/api/v1/sla-policies"),
    );
    expect(before.data).toHaveLength(4);
    try {
      await page.goto("/settings/sla");
      await expect(page.getByTestId("sla-row-urgent")).toBeVisible();
      await page.getByTestId("sla-urgent-response").fill("45");
      await page.getByLabel("Urgent response target, unit").selectOption("minutes");
      await page.getByTestId("sla-save").click();
      await expect(page.getByText("SLA policies saved")).toBeVisible();

      const after = await json<{ data: Policy[] }>(await client.get("/api/v1/sla-policies"));
      expect(after.data.find((p) => p.priority === "urgent")).toMatchObject({ response_min: 45 });

      // A new urgent job is due for scheduling 45 minutes after it was created.
      const customers = await json<{ data: { id: string }[] }>(await client.get("/api/v1/customers?limit=5"));
      let job: Job | null = null;
      for (const c of customers.data) {
        const sites = await json<{ data: { id: string }[] }>(
          await client.get(`/api/v1/customers/${c.id}/sites`),
        );
        if (!sites.data[0]) continue;
        const res = await client.post("/api/v1/jobs", {
          data: {
            customer_id: c.id,
            site_id: sites.data[0].id,
            title: `SLA E2E ${uniq()}`,
            priority: "urgent",
          },
        });
        expect(res.status(), await res.text()).toBe(201);
        job = (await res.json()) as Job;
        break;
      }
      expect(job).not.toBeNull();
      const minutes = (Date.parse(job!.response_due_at!) - Date.parse(job!.created_at)) / 60_000;
      expect(Math.round(minutes)).toBe(45);
      expect([job!.sla_response_state, job!.sla_resolution_state]).toEqual(["on_track", "on_track"]);

      // Validation: response must be shorter than resolution.
      const bad = await client.put("/api/v1/sla-policies", {
        data: {
          policies: after.data.map((p) =>
            p.priority === "low" ? { ...p, response_min: p.resolution_min } : p,
          ),
        },
      });
      expect(bad.status()).toBe(422);
    } finally {
      const restore = await client.put("/api/v1/sla-policies", {
        data: {
          policies: before.data.map(({ is_default: _d, ...p }) => p),
        },
      });
      expect(restore.status(), await restore.text()).toBe(200);
      await client.dispose();
    }
  });

  test("technicians can read the targets but not change them", async () => {
    const client = await api("technician");
    const list = await json<{ data: Policy[] }>(await client.get("/api/v1/sla-policies"));
    const res = await client.put("/api/v1/sla-policies", { data: { policies: list.data } });
    expect(res.status()).toBe(403);
    await client.dispose();
  });
});

test.describe("SLA on jobs (SLA-02)", () => {
  test.use({ storageState: storageState("dispatcher") });

  test("the jobs list filters by SLA state and the job page shows both targets", async ({ page }) => {
    await page.goto("/jobs?sla=at_risk%2Cbreached&status=new%2Cscheduled%2Cen_route%2Cin_progress%2Con_hold");
    const rows = page.getByTestId("job-row");
    await expect(rows.first()).toBeVisible();
    await expect(rows.first().locator("[data-sla]")).toHaveText(/SLA (at risk|breached)/);
    await expect(page.getByRole("button", { name: /^SLA/ })).toContainText("2");

    await rows.first().getByRole("link").first().click();
    const card = page.getByTestId("sla-card");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("sla-response")).toContainText("Response: scheduled with a technician");
    await expect(card.getByTestId("sla-resolution")).toContainText("Deadline");
    await expect(card.locator("[data-sla]").first()).toBeVisible();
  });

  test("the board marks jobs that need attention", async ({ page }) => {
    await page.goto("/schedule");
    await expect(page.getByTestId("queue-item").first()).toBeVisible();
    await expect(page.locator("[data-sla]").first()).toBeAttached();
  });
});

test.describe("dashboards (SLA-02, DSH-05)", () => {
  test.use({ storageState: storageState("dispatcher") });

  test("Today lists at-risk jobs from the stored SLA and links to the filtered list", async ({ page }) => {
    await page.goto("/dashboard?tab=today");
    const list = page.getByTestId("at-risk-list");
    await expect(list).toBeVisible();
    await expect(list.locator("[data-sla]").first()).toHaveText(/SLA (at risk|breached)/);
    await page.getByRole("link", { name: "View in jobs" }).click();
    await expect(page).toHaveURL(/sla=at_risk%2Cbreached/);
  });

  test("every report downloads as CSV with the page's filters", async ({ page }) => {
    await page.goto("/dashboard?tab=overview&range=7d");
    await expect(page.getByTestId("kpi-sla")).toContainText("Resolution targets met");
    const download = page.waitForEvent("download");
    await page.getByTestId("chart-status-csv").click();
    expect((await download).suggestedFilename()).toMatch(/^status-acme-air-\d{4}-\d{2}-\d{2}\.csv$/);
    await expect(page.getByTestId("chart-sla-csv")).toHaveAttribute("href", /report=sla&range=7d/);

    const kpis = await page.request.get("/dashboard/export?report=kpis&range=30d");
    expect(kpis.headers()["content-type"]).toContain("text/csv");
    const text = await kpis.text();
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain("SLA compliance (resolution)");

    for (const report of [
      "sla",
      "service_types",
      "workload",
      "technicians_today",
      "unassigned",
      "at_risk",
      "approvals",
    ]) {
      const res = await page.request.get(`/dashboard/export?report=${report}`);
      expect(res.status(), report).toBe(200);
      expect((await res.text()).split("\r\n").length, report).toBeGreaterThan(1);
    }
    const atRisk = await (await page.request.get("/dashboard/export?report=at_risk")).text();
    expect(atRisk).toContain("SLA target,SLA state,Due");
    expect((await page.request.get("/dashboard/export?report=nope")).status()).toBe(400);
  });

  test("technicians can't export reports", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: storageState("technician") });
    const res = await ctx.request.get("/dashboard/export?report=kpis");
    expect(res.status()).toBe(403);
    await ctx.close();
  });
});

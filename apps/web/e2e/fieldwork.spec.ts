import AxeBuilder from "@axe-core/playwright";
import { devices, expect, test, type Page } from "@playwright/test";
import { jobForTom, PNG, signViaApi, uploadToJob } from "./fieldwork-helpers";
import { api, expectStatus, json, storageState, uniq } from "./fixtures";

// 0.2 field work: checklists (JOB-08), the technician workspace on a phone (TEC-01–05), time entries
// (TEC-04) and the customer signature (JOB-10).

const PHONE = { ...devices["Pixel 7"], storageState: storageState("technician") };

async function axe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude("nextjs-portal")
    .exclude(".maplibregl-canvas")
    .analyze();
  const blocking = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.help} — ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  expect(blocking).toEqual([]);
}

test.describe("technician on a phone (J2)", () => {
  let jobNumber = "";

  test.beforeAll(async () => {
    const client = await api("dispatcher");
    const job = await jobForTom(client, `E2E tune-up ${uniq()}`, "AC tune-up");
    jobNumber = job.number;
    await client.dispose();
  });

  test("works the checklist, records time, signs and completes", async ({ browser }) => {
    const context = await browser.newContext(PHONE);
    const page = await context.newPage();
    await page.goto(`/jobs/${jobNumber}`);
    await expectStatus(page, "Scheduled");

    // The status buttons sit in a bar at the bottom of the phone screen (TEC-02).
    const bar = page.getByTestId("action-bar");
    const box = await bar.boundingBox();
    expect(box!.y + box!.height).toBeGreaterThan(page.viewportSize()!.height - 4);
    await bar.getByTestId("transition-depart").click();
    await expectStatus(page, "En route");
    await bar.getByTestId("transition-start").click();
    await expectStatus(page, "In progress");

    // Completing too early lists the required checklist items.
    await bar.getByTestId("transition-complete").click();
    let dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Finish the required checklist items first:")).toBeVisible();
    await expect(dialog.getByText("Suction pressure")).toBeVisible();
    await expect(dialog.getByTestId("complete-confirm")).toBeDisabled();
    await dialog.getByRole("button", { name: "Cancel" }).click();

    const checklist = page.getByTestId("checklist");
    await checklist.getByText("Filters inspected and cleaned").click();
    await expect(checklist.getByTestId("checklist-progress")).toContainText("1 of 7 done");
    await checklist.getByText("Condenser coil cleaned").click();
    await expect(checklist.getByTestId("checklist-progress")).toContainText("2 of 7 done");
    await checklist.getByLabel("Suction pressure").fill("121");
    await checklist.getByLabel("Suction pressure").press("Enter");
    await expect(checklist.getByTestId("checklist-progress")).toContainText("3 of 7 done");
    await checklist.getByLabel("Supply air temperature").fill("54.5");
    await checklist.getByRole("button", { name: "Save" }).click();
    await expect(checklist.getByTestId("checklist-progress")).toContainText("4 of 7 done");
    const photoItem = checklist
      .getByTestId("checklist-item")
      .filter({ hasText: "Photo of the unit after service" });
    await photoItem.locator('input[type="file"]').setInputFiles({
      name: "after.png",
      mimeType: "image/png",
      buffer: PNG,
    });
    await expect(photoItem.getByRole("img", { name: /Photo for/ })).toBeVisible();
    await expect(checklist.getByTestId("checklist-progress")).not.toContainText("required");

    // Time: travel from En route to Start, work since Start (TEC-04).
    const time = page.getByTestId("time-entries");
    await expect(time.getByTestId("time-entry")).toHaveCount(2);
    await expect(time.getByText("Work clock running")).toBeVisible();

    // Complete with the customer's typed signature (JOB-10).
    await bar.getByTestId("transition-complete").click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Signer's name").fill("Cara Example");
    await dialog.getByText("Type name").click();
    await dialog.getByTestId("complete-confirm").click();
    await expectStatus(page, "Completed");
    await expect(page.getByTestId("signature")).toContainText("Cara Example");
    await expect(page.getByTestId("signature").getByRole("img")).toBeVisible();
    await expect(time.getByText("Work clock running")).toHaveCount(0);

    const timeline = page.locator("ol").filter({ hasText: "created the job" });
    await expect(timeline.getByText("captured the customer's signature (Cara Example)")).toBeVisible();
    await expect(timeline.getByText(/updated the checklist: Photo of the unit after service/)).toBeVisible();
    await axe(page);
    await context.close();
  });

  test("corrects recorded time with a reason", async ({ browser }) => {
    const dispatcher = await api("dispatcher");
    const job = await jobForTom(dispatcher, `E2E time ${uniq()}`, "Filter replacement");
    await dispatcher.dispose();
    const tech = await api("technician");
    for (const to of ["en_route", "in_progress"]) {
      const r = await tech.post(`/api/v1/jobs/${job.id}/transitions`, { data: { to } });
      expect(r.ok(), await r.text()).toBeTruthy();
    }
    await tech.dispose();

    const context = await browser.newContext(PHONE);
    const page = await context.newPage();
    await page.goto(`/jobs/${job.number}`);
    const time = page.getByTestId("time-entries");
    await time.getByRole("button", { name: /Correct travel time of Tom Reyes/i }).click();
    const dialog = page.getByRole("dialog");
    const start = dialog.getByLabel("Start");
    const value = await start.inputValue();
    // Move the start 10 minutes earlier.
    const [d, hm] = value.split("T");
    const [h, m] = hm!.split(":").map(Number);
    const minutes = h! * 60 + m! - 10;
    if (minutes >= 0) {
      await start.fill(
        `${d}T${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`,
      );
    }
    await dialog.getByLabel("Reason").fill("Left the shop before tapping En route");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(time.getByText("Corrected: Left the shop before tapping En route")).toBeVisible();
    await expect(
      page
        .locator("ol")
        .filter({ hasText: "created the job" })
        .getByText("corrected travel time for Tom Reyes"),
    ).toBeVisible();
    await context.close();
  });

  test("My day highlights the next visit with one-tap actions", async ({ browser }) => {
    const context = await browser.newContext(PHONE);
    const page = await context.newPage();
    await page.goto("/jobs?view=my-day");
    await expect(page.getByRole("heading", { name: "My day" })).toBeVisible();
    const next = page.getByTestId("next-visit");
    if (await next.count()) {
      await expect(next.getByRole("link", { name: /Directions/ })).toHaveAttribute(
        "href",
        /google\.com\/maps/,
      );
      await expect(next.getByRole("link", { name: /Open job/ })).toBeVisible();
    }
    await axe(page);
    await context.close();
  });
});

test.describe("checklist API and rules (JOB-08)", () => {
  test("completion is rejected with the missing items, then allowed", async () => {
    const dispatcher = await api("dispatcher");
    const job = await jobForTom(dispatcher, `E2E checklist API ${uniq()}`, "Refrigerant recharge");
    await dispatcher.dispose();
    const tech = await api("technician");
    const r = await tech.post(`/api/v1/jobs/${job.id}/transitions`, { data: { to: "in_progress" } });
    expect(r.ok(), await r.text()).toBeTruthy();

    const early = await tech.post(`/api/v1/jobs/${job.id}/transitions`, { data: { to: "completed" } });
    expect(early.status()).toBe(409);
    const problem = (await early.json()) as { missing: string[] };
    expect(problem.missing).toEqual([
      "Leak search performed",
      "Refrigerant added",
      "Suction pressure",
      "Photo of the gauges",
    ]);

    const list = await json<{ data: { id: string; label: string; kind: string }[]; required_left: number }>(
      await tech.get(`/api/v1/jobs/${job.id}/checklist`),
    );
    expect(list.required_left).toBe(4);
    const id = (label: string) => list.data.find((i) => i.label === label)!.id;
    const bad = await tech.patch(`/api/v1/jobs/${job.id}/checklist`, {
      data: { items: [{ id: id("Refrigerant added"), value: "two" }] },
    });
    expect(bad.status()).toBe(422);
    const photo = await uploadToJob(tech, job.id, { kind: "photo" });
    const saved = await json<{ required_left: number; done: number }>(
      await tech.patch(`/api/v1/jobs/${job.id}/checklist`, {
        data: {
          items: [
            { id: id("Leak search performed"), value: true },
            { id: id("Refrigerant added"), value: 1.5 },
            { id: id("Suction pressure"), value: 124 },
            { id: id("Photo of the gauges"), value: photo },
          ],
        },
      }),
    );
    expect(saved).toMatchObject({ required_left: 0, done: 4 });
    await signViaApi(tech, job.id);
    const done = await tech.post(`/api/v1/jobs/${job.id}/transitions`, { data: { to: "completed" } });
    expect(done.ok(), await done.text()).toBeTruthy();

    const time = await json<{ data: unknown[]; totals: { running: string | null }[] }>(
      await tech.get(`/api/v1/jobs/${job.id}/time-entries`),
    );
    expect(time.data).toHaveLength(1);
    expect(time.totals[0]!.running).toBeNull();
    await tech.dispose();
  });
});

test.describe("service type template editor", () => {
  test.use({ storageState: storageState("owner") });

  test("shows the checklist template and required skills", async ({ page }) => {
    await page.goto("/settings/service-types");
    await page.getByRole("button", { name: "Edit AC tune-up" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Checklist template")).toBeVisible();
    await expect(dialog.getByTestId("template-item")).toHaveCount(7);
    await expect(dialog.getByRole("list", { name: "Required skills" })).toContainText("ac");
    await axe(page);
  });
});

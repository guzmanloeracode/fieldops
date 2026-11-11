import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { api, createJob, json, memberByEmail, storageState, toChicagoInput, uniq, USERS } from "./fixtures";

// 0.2 dispatch: the board (SCH-01), keyboard equivalents of every drag (SCH-02), conflicts with an override
// (SCH-03), availability (SCH-04), the map tab (SCH-05) and the schedule API.

/** A random Monday far in the future, so reruns against the same database don't collide. */
function futureMonday(): string {
  const base = Date.UTC(2032, 0, 5); // Monday 5 Jan 2032
  const week = Math.floor(Math.random() * 3_000);
  return new Date(base + week * 7 * 86_400_000).toISOString().slice(0, 10);
}
const chicago = (date: string, hhmm: string) => `${date}T${hhmm}`;

async function jobById(client: APIRequestContext, id: string) {
  return json<{ status: string; scheduled_start: string | null; scheduled_end: string | null }>(
    await client.get(`/api/v1/jobs/${id}`),
  );
}

async function liveRegion(page: Page) {
  return page.locator('[id^="DndLiveRegion"]');
}

test.describe("dispatch board as dispatcher", () => {
  test.use({ storageState: storageState("dispatcher") });

  test("schedules, moves and resizes a job with the keyboard, then overrides a conflict", async ({
    page,
  }) => {
    test.slow();
    const client = await api("dispatcher");
    const tom = await memberByEmail(client, USERS.technician);
    const date = futureMonday();
    const first = await createJob(client, `E2E board ${uniq()}`);
    const res = await client.patch(`/api/v1/jobs/${first.id}`, { data: { priority: "urgent" } });
    expect(res.ok(), await res.text()).toBeTruthy();

    await page.goto(`/schedule?date=${date}&tech=${tom.id}`);
    await expect(page.getByTestId("board-day")).toBeVisible();
    const queued = page.locator(`[data-testid="queue-item"][data-job="${first.number}"]`);
    await expect(queued).toBeVisible();

    // Space picks up, an arrow key jumps onto Tom's lane at 08:00, Space drops.
    await queued.focus();
    await page.keyboard.press("Space");
    // On a slow machine the "picked up" announcement can already be replaced by the first "is over" one.
    await expect(await liveRegion(page)).toHaveText(
      new RegExp(`^(Picked up ${first.number}|${first.number} is over )`),
    );
    await page.waitForTimeout(250);
    await page.keyboard.press("ArrowRight");
    await expect(await liveRegion(page)).toContainText("Tom Reyes");
    await page.keyboard.press("Space");
    await expect(page.getByText(`Scheduled ${first.number} for Tom Reyes, 08:00–09:00`)).toBeVisible();
    await expect.poll(async () => (await jobById(client, first.id)).status).toBe("scheduled");
    const saved = await jobById(client, first.id);
    expect(toChicagoInput(new Date(saved.scheduled_start!))).toBe(chicago(date, "08:00"));

    // Move it 30 minutes later: two steps of 15 minutes.
    const block = page
      .locator(`[data-testid="board-block"][data-job="${first.number}"] [role="button"]`)
      .first();
    await expect(block).toBeVisible();
    await block.focus();
    await page.keyboard.press("Space");
    // Picking up a block on its lane announces "picked up", then at once "is over Tom Reyes".
    await expect(await liveRegion(page)).toHaveText(
      new RegExp(`^(Picked up ${first.number}|${first.number} is over Tom Reyes)`),
    );
    // The sensor starts listening for arrow keys a tick after the pick-up.
    await page.waitForTimeout(250);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(100);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(100);
    await page.keyboard.press("Space");
    await expect(page.getByText(`Moved ${first.number} to Tom Reyes, 08:30–09:30`)).toBeVisible();
    await expect
      .poll(async () => toChicagoInput(new Date((await jobById(client, first.id)).scheduled_start!)))
      .toBe(chicago(date, "08:30"));

    // Shift+→ makes it 15 minutes longer (the resize handle's keyboard equivalent).
    await block.focus();
    await page.keyboard.press("Shift+ArrowRight");
    await expect(page.getByText(`${first.number} now ends at 09:45`)).toBeVisible();
    await expect
      .poll(async () => toChicagoInput(new Date((await jobById(client, first.id)).scheduled_end!)))
      .toBe(chicago(date, "09:45"));

    // Enter opens the details dialog.
    await block.focus();
    await page.keyboard.press("Enter");
    const details = page.getByRole("dialog");
    await expect(details.getByRole("heading", { name: `Reschedule ${first.number}` })).toBeVisible();
    await expect(details.getByRole("link", { name: "Open job" })).toHaveAttribute(
      "href",
      `/jobs/${first.number}`,
    );
    await page.keyboard.press("Escape");
    await expect(details).toBeHidden();

    // A second urgent job dropped on 08:00 overlaps the first: the board asks for a reason.
    const second = await createJob(client, `E2E board overlap ${uniq()}`);
    await client.patch(`/api/v1/jobs/${second.id}`, { data: { priority: "urgent" } });
    await page.reload();
    const queued2 = page.locator(`[data-testid="queue-item"][data-job="${second.number}"]`);
    await queued2.focus();
    await page.keyboard.press("Space");
    await expect(await liveRegion(page)).toContainText(`Picked up ${second.number}`);
    await page.waitForTimeout(250);
    await page.keyboard.press("ArrowRight");
    await expect(await liveRegion(page)).toContainText("Tom Reyes");
    await page.keyboard.press("Space");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("This overlaps another visit")).toBeVisible();
    await expect(dialog.getByRole("link", { name: first.number })).toBeVisible();
    await expect(dialog.getByTestId("board-override-save")).toBeDisabled();
    await dialog.getByLabel("Reason for overriding").fill("Two-person job, Tom starts both.");
    await dialog.getByTestId("board-override-save").click();
    await expect(dialog).toBeHidden();
    await expect.poll(async () => (await jobById(client, second.id)).status).toBe("scheduled");
    const events = await json<{ data: { type: string; payload: Record<string, unknown> }[] }>(
      await client.get(`/api/v1/jobs/${second.id}/events`),
    );
    expect(events.data.find((e) => e.type === "assigned")?.payload).toMatchObject({
      override_reason: "Two-person job, Tom starts both.",
      overridden: [{ kind: "overlap", member_id: tom.id }],
    });

    // The week view shows both visits in Monday's cell for Tom.
    await page.goto(`/schedule?view=week&date=${date}&tech=${tom.id}`);
    await expect(page.getByTestId("board-week")).toBeVisible();
    await expect(page.locator(`[data-testid="board-block"][data-job="${first.number}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="board-block"][data-job="${second.number}"]`)).toBeVisible();
    await client.dispose();
  });

  test("lists today's visits on the map tab", async ({ page }) => {
    await page.goto("/schedule?tab=map");
    await expect(page.getByRole("heading", { name: /^Visits on / })).toBeVisible();
    // Late in the evening the seeded busy day may be tomorrow; either way the list renders.
    await expect(
      page.getByTestId("map-list-item").first().or(page.getByText("No visits on this day.").first()),
    ).toBeVisible();
  });

  test("manages time off, which the conflict check then reports", async ({ page }) => {
    test.slow();
    const client = await api("dispatcher");
    const tom = await memberByEmail(client, USERS.technician);
    const date = futureMonday();
    const reason = `E2E leave ${uniq()}`;

    await page.goto("/schedule/team");
    const card = page.locator('[data-testid="team-member"][data-member="Tom Reyes"]');
    await expect(card).toBeVisible();
    // Fill again until the page has hydrated and the button reacts.
    const add = card.getByRole("button", { name: "Add time off" });
    await expect(async () => {
      await card.getByLabel("From", { exact: true }).fill(date);
      await card.getByLabel("To (inclusive)").fill(date);
      await card.getByLabel("Reason (optional)").fill(reason);
      await expect(add).toBeEnabled({ timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    await add.click();
    await expect(card.getByText(reason)).toBeVisible();

    const job = await createJob(client, `E2E time off ${uniq()}`);
    const window = {
      member_ids: [tom.id],
      scheduled_start: new Date(`${date}T15:00:00Z`).toISOString(),
      scheduled_end: new Date(`${date}T16:00:00Z`).toISOString(),
    };
    const refused = await client.put(`/api/v1/jobs/${job.id}/assignments`, { data: window });
    expect(refused.status()).toBe(409);
    const problem = (await refused.json()) as { conflicts: { kind: string; member_id: string }[] };
    expect(problem.conflicts).toEqual([expect.objectContaining({ kind: "time_off", member_id: tom.id })]);

    // Saturday is outside Tom's working hours; a reason saves it anyway.
    const saturday = new Date(Date.parse(`${date}T15:00:00Z`) + 5 * 86_400_000);
    const weekend = {
      member_ids: [tom.id],
      scheduled_start: saturday.toISOString(),
      scheduled_end: new Date(saturday.getTime() + 3_600_000).toISOString(),
    };
    const outside = await client.put(`/api/v1/jobs/${job.id}/assignments`, { data: weekend });
    expect(outside.status()).toBe(409);
    expect(
      ((await outside.json()) as { conflicts: { kind: string }[] }).conflicts.map((c) => c.kind),
    ).toEqual(["outside_hours"]);
    const forced = await client.put(`/api/v1/jobs/${job.id}/assignments`, {
      data: { ...weekend, override_reason: "Customer only home on Saturday" },
    });
    expect(forced.status(), await forced.text()).toBe(200);

    // The schedule API shows the time off and the visit.
    const schedule = await json<{
      technicians: { member: { id: string }; time_off: { reason: string | null }[] }[];
      jobs: { id: string }[];
    }>(
      await client.get(
        `/api/v1/schedule?from=${date}&to=${saturday.toISOString().slice(0, 10)}&member=${tom.id}`,
      ),
    );
    expect(schedule.technicians[0]!.time_off.map((o) => o.reason)).toContain(reason);
    expect(schedule.jobs.map((j) => j.id)).toContain(job.id);

    // Clean up the time off.
    await card
      .locator("li", { hasText: reason })
      .getByRole("button", { name: /^Remove time off/ })
      .click();
    await expect(card.getByText(reason)).toBeHidden();
    await client.dispose();
  });
});

test.describe("schedule API as technician", () => {
  test("a technician gets an agenda but not the board", async () => {
    const client = await api("technician");
    const agenda = await json<{ from: string; to: string; jobs: { assignees: { name: string }[] }[] }>(
      await client.get("/api/v1/me/agenda"),
    );
    expect(agenda.jobs.every((j) => j.assignees.some((a) => a.name === "Tom Reyes"))).toBe(true);
    const board = await client.get(`/api/v1/schedule?from=${agenda.from}&to=${agenda.to}`);
    expect(board.status()).toBe(403);
    await client.dispose();
  });
});

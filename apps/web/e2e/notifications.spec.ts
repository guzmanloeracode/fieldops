import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  api,
  assign,
  createJob,
  futureWindow,
  json,
  memberByEmail,
  storageState,
  toChicagoInput,
  uniq,
  USERS,
} from "./fixtures";

// 0.3 notifications: the notification center and its live badge (NOT-01, NOT-05), notification emails in the
// demo outbox (NOT-02), preferences (NOT-03), the live dispatch board (SCH-06) and the notifications API.

interface NotificationPage {
  data: { id: string; type: string; href: string; read_at: string | null; payload: { job_number?: number } }[];
  next_cursor: string | null;
  unread_count: number;
}

const bell = (page: Page) => page.getByTestId("notification-bell").locator("visible=true");

async function unreadOf(client: APIRequestContext) {
  return (await json<NotificationPage>(await client.get("/api/v1/notifications?limit=1"))).unread_count;
}

test.describe("notification center", () => {
  test.use({ storageState: storageState("technician") });

  test("an assignment reaches the technician live and links to the job", async ({ page, browser }) => {
    test.slow();
    const dispatcher = await api("dispatcher");
    const tech = await api("technician");
    const tom = await memberByEmail(dispatcher, USERS.technician);
    await page.goto("/jobs?view=my-day");
    await expect(bell(page)).toBeVisible();
    const before = await unreadOf(tech);

    const job = await createJob(dispatcher, `E2E notify ${uniq()}`);
    await assign(dispatcher, job.id, tom.id, futureWindow());

    // The badge and an announcement arrive without a reload.
    await expect(bell(page)).toHaveAccessibleName(`Notifications, ${before + 1} unread`, { timeout: 10_000 });
    await expect(page.getByText(`assigned you to ${job.number}`).first()).toBeVisible();

    await bell(page).click();
    const item = page.getByTestId("notification-item").filter({ hasText: job.number }).first();
    await expect(item).toHaveAttribute("data-unread", "true");
    await item.click();
    await expect(page).toHaveURL(new RegExp(`/jobs/${job.number}$`));
    await expect.poll(() => unreadOf(tech)).toBe(before);

    // The email is captured in the demo outbox (NOT-02, DEM-05).
    const owner = await browser.newContext({ storageState: storageState("owner") });
    const outbox = await owner.newPage();
    await outbox.goto("/settings/demo-outbox");
    await expect(outbox.getByText(`New job ${job.number}`).first()).toBeVisible();
    await owner.close();
    await dispatcher.dispose();
    await tech.dispose();
  });

  test("the notifications page filters unread ones and marks them all read", async ({ page }) => {
    const dispatcher = await api("dispatcher");
    const tom = await memberByEmail(dispatcher, USERS.technician);
    const job = await createJob(dispatcher, `E2E notify page ${uniq()}`);
    await assign(dispatcher, job.id, tom.id, futureWindow());

    await page.goto("/notifications?filter=unread");
    await expect(page.getByRole("link", { name: /^Unread/ })).toHaveAttribute("aria-current", "page");
    const row = page.getByTestId("notification-row").filter({ hasText: job.number });
    await expect(row).toHaveAttribute("data-unread", "true");
    await page.getByTestId("notifications-mark-all").click();
    await expect(page.getByText("No unread notifications.")).toBeVisible();
    await page.goto("/notifications");
    await expect(page.getByTestId("notification-row").filter({ hasText: job.number })).not.toHaveAttribute(
      "data-unread",
      "true",
    );
    await dispatcher.dispose();
  });

  test("turning off in-app notifications for assignments stops them", async ({ page }) => {
    const dispatcher = await api("dispatcher");
    const tech = await api("technician");
    const tom = await memberByEmail(dispatcher, USERS.technician);

    await page.goto("/notifications/preferences");
    await expect(page.getByTestId("pref-expense_decided")).toContainText("Not sent by email");
    await expect(page.getByTestId("pref-portal_request")).toHaveCount(0);
    const inApp = page.getByTestId("pref-job_assigned-in_app");
    await expect(inApp).toBeChecked();
    await inApp.click();
    await page.getByTestId("pref-save").click();
    await expect(page.getByText("Notification settings saved")).toBeVisible();

    try {
      const before = (await json<NotificationPage>(await tech.get("/api/v1/notifications?limit=1"))).data[0]?.id;
      const job = await createJob(dispatcher, `E2E muted ${uniq()}`);
      await assign(dispatcher, job.id, tom.id, futureWindow());
      const latest = (await json<NotificationPage>(await tech.get("/api/v1/notifications?limit=1"))).data[0]?.id;
      expect(latest).toBe(before);
    } finally {
      const res = await tech.put("/api/v1/notifications/preferences", {
        data: { preferences: [{ event: "job_assigned", in_app: true, email: true }] },
      });
      expect(res.status(), await res.text()).toBe(200);
      await dispatcher.dispose();
      await tech.dispose();
    }
  });
});

test.describe("live dispatch board", () => {
  test.use({ storageState: storageState("dispatcher") });

  test("another dispatcher's change appears on the board without a reload (SCH-06)", async ({ page }) => {
    test.slow();
    const owner = await api("owner");
    const tom = await memberByEmail(owner, USERS.technician);
    const w = futureWindow();
    const date = toChicagoInput(w.start).slice(0, 10);
    await page.goto(`/schedule?date=${date}&tech=${tom.id}`);
    await expect(page.getByTestId("board-day")).toBeVisible();
    await page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true));

    const job = await createJob(owner, `E2E live ${uniq()}`);
    await assign(owner, job.id, tom.id, w);

    await expect(page.locator(`[data-testid="board-block"][data-job="${job.number}"]`)).toBeVisible({
      timeout: 10_000,
    });
    expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
    await owner.dispose();
  });
});

test.describe("notifications API", () => {
  test("lists, marks read and keeps settings per user", async () => {
    const tech = await api("technician");
    const dispatcher = await api("dispatcher");
    const tom = await memberByEmail(dispatcher, USERS.technician);
    const job = await createJob(dispatcher, `E2E api ${uniq()}`);
    await assign(dispatcher, job.id, tom.id, futureWindow());

    const page = await json<NotificationPage>(await tech.get("/api/v1/notifications?limit=5&unread=true"));
    const mine = page.data.find((n) => n.href === `/jobs/${job.number}`);
    expect(mine).toMatchObject({ type: "job_assigned", read_at: null });

    const read = await tech.post("/api/v1/notifications/read", { data: { ids: [mine!.id] } });
    expect(await read.json()).toMatchObject({ updated: 1 });
    // The dispatcher can't mark Tom's notification: it isn't theirs.
    const other = await dispatcher.post("/api/v1/notifications/read", { data: { ids: [mine!.id] } });
    expect(await other.json()).toMatchObject({ updated: 0 });

    const prefs = await json<{ data: { event: string; email: boolean | null }[] }>(
      await tech.get("/api/v1/notifications/preferences"),
    );
    expect(prefs.data.map((p) => p.event)).toEqual(["job_assigned", "job_rescheduled", "expense_decided"]);
    const bad = await tech.put("/api/v1/notifications/preferences", {
      data: { preferences: [{ event: "sla_breached", in_app: false, email: false }] },
    });
    expect(bad.status()).toBe(422);
    await tech.dispose();
    await dispatcher.dispose();
  });

  test("the event stream needs a session", async ({ request }) => {
    const res = await request.get("/api/v1/stream");
    expect(res.status()).toBe(401);
    expect(res.headers()["content-type"]).toContain("application/problem+json");
  });
});

test.describe("sign-in", () => {
  test("hides Google sign-in when no OAuth client is configured (AUTH-02)", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await expect(page.getByTestId("google-sign-in")).toHaveCount(0);
  });
});

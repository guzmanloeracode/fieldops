import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { api, json, storageState, type UserKey } from "./fixtures";

// Ask FieldOps (AI-02). The E2E stack runs the deterministic fixture model (AI_PROVIDER=fixture): it picks tools from
// keywords in the question, runs the real tools as the signed-in member and writes a templated answer, so these
// checks exercise the tools, role filtering and links. Each question counts against the AI rate limits, so the
// spec asks only four.

const OPEN = "new,scheduled,en_route,in_progress,on_hold";
const SLA_QUESTION = "Which jobs are at risk of breaching SLA today?";

async function pageAs(browser: Browser, user: UserKey): Promise<Page> {
  const context = await browser.newContext({ storageState: storageState(user) });
  const page = await context.newPage();
  // The live event stream keeps a request open; the panel doesn't need it.
  await page.route("**/api/v1/stream", (route) => route.fulfill({ status: 204 }));
  return page;
}

async function done(page: Page) {
  await page.context().close();
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .include("[data-testid=assistant-panel]")
    .analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

/** Opens the panel and waits until it knows whether AI is on; skips without an AI provider. */
async function openPanel(page: Page, how: "keyboard" | "button") {
  if (how === "keyboard") await page.keyboard.press("ControlOrMeta+j");
  else await page.getByTestId("assistant-open").locator("visible=true").click();
  await expect(page.getByTestId("assistant-panel")).toBeVisible();
  await expect(
    page.getByTestId("assistant-starter").first().or(page.getByTestId("assistant-unavailable")),
  ).toBeVisible();
  const unavailable = await page.getByTestId("assistant-unavailable").isVisible();
  test.skip(unavailable, "AI isn't configured on this server");
  await expect(page.getByTestId("assistant-starter").first()).toBeEnabled();
}

async function riskyJobs(user: UserKey): Promise<string[]> {
  const client = await api(user);
  const page = await json<{ data: { number: string }[] }>(
    await client.get(`/api/v1/jobs?sla=at_risk,breached&status=${OPEN}&limit=100`),
  );
  await client.dispose();
  return page.data.map((j) => j.number);
}

test.describe.serial("Ask FieldOps", () => {
  test.describe.configure({ timeout: 150_000 });

  test("a dispatcher opens it with the keyboard, asks about SLA risks and follows a linked job", async ({
    browser,
  }) => {
    const page = await pageAs(browser, "dispatcher");
    await page.goto("/jobs");
    await openPanel(page, "keyboard");
    await expect(page.getByTestId("assistant-input")).toBeFocused();
    await axe(page);

    await page.getByTestId("assistant-input").fill(SLA_QUESTION);
    await page.keyboard.press("Enter");
    const answer = page.getByTestId("assistant-answer").last();
    await expect(answer).toHaveAttribute("data-state", "done", { timeout: 60_000 });
    await expect(answer.getByTestId("assistant-tool")).toHaveText(/Checked SLAs: (none|\d+ jobs?) at risk/);
    await expect(page.getByTestId("assistant-live")).not.toBeEmpty();
    await axe(page);

    const risky = await riskyJobs("dispatcher");
    const links = answer.locator("[data-testid=assistant-record-link][data-record-type=job]");
    if (risky.length === 0) {
      await expect(answer).toContainText("No open jobs are at risk");
    } else {
      await expect(links.first()).toBeVisible();
      const labels = await links.allTextContents();
      for (const label of labels) expect(risky).toContain(label);
      await links.first().click();
      await expect(page).toHaveURL(new RegExp(`/jobs/${labels[0]}$`), { timeout: 60_000 });
    }
    await done(page);
  });

  test("a technician only sees their own jobs", async ({ browser }) => {
    const page = await pageAs(browser, "technician");
    await page.goto("/jobs?view=my-day");
    await openPanel(page, "button");
    await page.getByTestId("assistant-starter").filter({ hasText: SLA_QUESTION }).click();
    const answer = page.getByTestId("assistant-answer").last();
    await expect(answer).toHaveAttribute("data-state", "done", { timeout: 60_000 });

    const own = await riskyJobs("technician");
    const everyone = await riskyJobs("dispatcher");
    const labels = await answer
      .locator("[data-testid=assistant-record-link][data-record-type=job]")
      .allTextContents();
    for (const label of labels) expect(own).toContain(label);
    const text = (await answer.textContent()) ?? "";
    for (const other of everyone.filter((n) => !own.includes(n))) expect(text).not.toContain(other);
    const client = await api("technician");
    for (const label of labels) expect((await client.get(`/api/v1/jobs/${label}`)).status()).toBe(200);
    await client.dispose();
    await done(page);
  });

  test("a conversation continues from the history, then is deleted", async ({ browser }) => {
    const page = await pageAs(browser, "dispatcher");
    await page.goto("/dashboard");
    await openPanel(page, "button");
    await page.getByTestId("assistant-history-toggle").click();
    const history = page.getByTestId("assistant-history");
    await expect(history.getByRole("button", { name: SLA_QUESTION }).first()).toBeVisible();
    await history.getByRole("button", { name: SLA_QUESTION }).first().click();
    await expect(page.getByTestId("assistant-answer").first()).toHaveAttribute("data-state", "done");

    await page.getByTestId("assistant-input").fill("Who has capacity tomorrow afternoon?");
    await page.getByTestId("assistant-send").click();
    const answer = page.getByTestId("assistant-answer").last();
    await expect(answer).toHaveAttribute("data-state", "done", { timeout: 60_000 });
    await expect(answer.getByTestId("assistant-tool")).toHaveText(/Checked \d+ schedules?/);
    await expect(page.getByTestId("assistant-answer")).toHaveCount(2);

    await page.getByTestId("assistant-history-toggle").click();
    const before = await history.getByRole("button", { name: `Delete “${SLA_QUESTION}”` }).count();
    await history
      .getByRole("button", { name: `Delete “${SLA_QUESTION}”` })
      .first()
      .click();
    await expect(history.getByRole("button", { name: `Delete “${SLA_QUESTION}”` })).toHaveCount(before - 1);
    await done(page);
  });

  test("the API streams an answer, and conversations stay private", async () => {
    const dispatcher = await api("dispatcher");
    const res = await dispatcher.post("/api/v1/ai/assistant", {
      data: { message: "How many urgent jobs are scheduled?" },
    });
    expect(res.status(), await res.text()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/event-stream");
    const events = (await res.text())
      .split("\n\n")
      .map((block) => block.split("\n").find((l) => l.startsWith("data: ")))
      .filter((l): l is string => Boolean(l))
      .map((l) => JSON.parse(l.slice(6)) as { type: string; [k: string]: unknown });
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["conversation", "tool_started", "tool_finished", "text", "done"]),
    );
    expect(events.at(-1)?.type).toBe("done");
    const finished = events.find((e) => e.type === "tool_finished")!;
    expect(finished).toMatchObject({ name: "search_jobs", ok: true });
    expect(finished.summary).toMatch(/^Looked up \d+ jobs?$/);
    const id = events[0]!.conversation_id as string;

    const list = await json<{ data: { id: string }[] }>(await dispatcher.get("/api/v1/ai/conversations"));
    expect(list.data[0]?.id).toBe(id);
    const detail = await json<{ messages: { role: string; tools: unknown[] }[] }>(
      await dispatcher.get(`/api/v1/ai/conversations/${id}`),
    );
    expect(detail.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(detail.messages[1]!.tools).toHaveLength(1);

    // Someone else's conversation is a 404, even in the same organization.
    const owner = await api("owner");
    expect((await owner.get(`/api/v1/ai/conversations/${id}`)).status()).toBe(404);
    expect((await owner.delete(`/api/v1/ai/conversations/${id}`)).status()).toBe(404);
    const invalid = await owner.post("/api/v1/ai/assistant", { data: { message: "   " } });
    expect(invalid.status()).toBe(422);
    expect(invalid.headers()["content-type"]).toContain("application/problem+json");
    await owner.dispose();

    expect((await dispatcher.delete(`/api/v1/ai/conversations/${id}`)).status()).toBe(204);
    expect((await dispatcher.get(`/api/v1/ai/conversations/${id}`)).status()).toBe(404);
    await dispatcher.dispose();
  });
});

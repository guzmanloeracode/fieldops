import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { api, json, storageState, type JobDto, type UserKey } from "./fixtures";

// AI smart intake (AI-01), AI settings (SET-04) and rate-limited AI routes (PLT-04). The E2E stack runs the
// deterministic fixture model (AI_PROVIDER=fixture): it never calls Claude, and "[[fail]]" in a message makes it
// fail on purpose. The seed gives portal requests that still need review an AI draft.

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function axe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude("nextjs-portal")
    .analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

/** A page in its own context (axe needs pages created through a context). Closing the page closes both. */
async function pageAs(browser: Browser, user: UserKey): Promise<Page> {
  const context = await browser.newContext({ storageState: storageState(user) });
  const page = await context.newPage();
  page.on("close", () => void context.close());
  return page;
}

/** Skips when the server under test has no AI provider (a dev server without AI_PROVIDER=fixture). */
async function requireAi(page: Page) {
  const unavailable = await page.getByTestId("ai-unavailable").isVisible();
  test.skip(unavailable, "AI isn't configured on this server");
}

interface DraftResponse {
  status: string;
  interaction_id: string;
  draft: {
    title: string;
    priority: string;
    service_type_id: string | null;
    confidence: Record<string, number>;
  } | null;
  quota: { used: number; limit: number };
}

test.describe.serial("AI intake", () => {
  // Each journey drafts, saves and reloads pages; leave room for a busy machine.
  test.describe.configure({ timeout: 150_000 });

  test("a dispatcher drafts a job from a customer's message, checks it and saves it", async ({ browser }) => {
    const page = await pageAs(browser, "dispatcher");
    await page.goto("/jobs/new");
    await requireAi(page);

    await page
      .getByTestId("ai-message")
      .fill(
        "Hi, the AC in our bedroom is leaking water onto the floor since this morning. My name is Maria Lopez, 512-555-0187.",
      );
    await page.getByTestId("ai-draft").click();
    await expect(page.getByTestId("ai-result")).toBeVisible();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
      "Hi, the AC in our bedroom is leaking water onto the floor since this morning",
    );
    await expect(page.getByRole("radio", { name: "High" })).toBeChecked();
    await expect(page.getByLabel("Service type", { exact: true })).toHaveText(/AC repair/);
    await expect(page.getByText("Filled by AI").first()).toBeVisible();
    // The fixture isn't sure about the equipment brand; the panel lists what to ask the customer.
    await expect(page.getByTestId("ai-questions")).toContainText("brand or model");
    await axe(page);

    // The dispatcher edits the title (the draft counts as "edited") and picks the customer.
    await page.getByLabel("Title", { exact: true }).fill("Bedroom AC leaking water");
    const client = await api("dispatcher");
    const customers = await json<{ data: { id: string; name: string }[] }>(
      await client.get("/api/v1/customers?limit=1&sort=name"),
    );
    const customer = customers.data[0]!;
    await page.getByTestId("customer-picker").click();
    await page.getByPlaceholder("Search customers…").fill(customer.name);
    await page
      .getByRole("option", { name: new RegExp(escape(customer.name)) })
      .first()
      .click();
    const site = page.getByLabel("Site", { exact: true });
    await expect(site).toBeEnabled();
    if ((await site.textContent())?.includes("Choose a site")) {
      await site.click();
      await page.getByRole("option").first().click();
    }
    await page.getByTestId("create-job").click();
    await page.waitForURL(/\/jobs\/JOB-\d+$/, { timeout: 90_000 });
    await expect(page.getByText("AI intake").first()).toBeVisible();
    await expect(page.getByText("Needs review")).toHaveCount(0);

    const number = page.url().split("/").pop()!;
    const job = await json<JobDto & { source: string; ai_drafted: boolean; needs_review: boolean }>(
      await client.get(`/api/v1/jobs/${number}`),
    );
    expect(job).toMatchObject({
      source: "ai_intake",
      ai_drafted: true,
      needs_review: false,
      title: "Bedroom AC leaking water",
    });
    await client.dispose();
    await page.close();
  });

  test("when the model fails, the form stays usable", async ({ browser }) => {
    const page = await pageAs(browser, "dispatcher");
    await page.goto("/jobs/new");
    await requireAi(page);
    await page.getByTestId("ai-message").fill("Please help with my unit [[fail]] it makes a noise");
    await page.getByTestId("ai-draft").click();
    await expect(page.getByTestId("ai-failure")).toContainText("couldn't draft this message");
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue("");
    await expect(page.getByTestId("create-job")).toBeEnabled();
    await page.close();
  });

  test("the API drafts with rate-limit headers and guards roles and input", async () => {
    const dispatcher = await api("dispatcher");
    const res = await dispatcher.post("/api/v1/ai/intake", {
      data: { message: "Tolong pasang AC baru di kamar saya. Nama saya Budi, 0812-3456-7890." },
    });
    if (res.status() === 503) test.skip(true, "AI isn't configured on this server");
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as DraftResponse;
    expect(body.status).toBe("drafted");
    expect(body.draft).toMatchObject({ priority: expect.any(String) });
    expect(body.quota.used).toBeGreaterThan(0);
    expect(Number(res.headers()["ratelimit-limit"])).toBeGreaterThan(0);
    expect(Number(res.headers()["ratelimit-remaining"])).toBeGreaterThanOrEqual(0);

    const invalid = await dispatcher.post("/api/v1/ai/intake", { data: { message: "short" } });
    expect(invalid.status()).toBe(422);
    expect((await invalid.json()) as { errors: { path: string }[] }).toMatchObject({
      errors: [{ path: "message" }],
    });

    const technician = await api("technician");
    const forbidden = await technician.post("/api/v1/ai/intake", {
      data: { message: "My AC is leaking water onto the floor" },
    });
    expect(forbidden.status()).toBe(403);
    await Promise.all([dispatcher.dispose(), technician.dispose()]);
  });

  test("a dispatcher reviews a portal request with its AI draft", async ({ browser }) => {
    const client = await api("dispatcher");
    const waiting = await json<{ data: (JobDto & { ai_status: string | null })[] }>(
      await client.get("/api/v1/jobs?needs_review=true&limit=20&sort=-created_at"),
    );
    const job = waiting.data.find((j) => j.ai_status === "drafted") ?? waiting.data[0];
    test.skip(!job, "No portal request waiting for review");

    const page = await pageAs(browser, "dispatcher");
    await page.goto("/jobs?needs_review=true");
    await expect(page.getByTestId("filter-needs-review")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("job-row").first()).toBeVisible();

    await page.goto(`/jobs/${job!.number}`);
    const review = page.getByTestId("ai-review");
    await expect(review).toBeVisible();
    await axe(page);
    const apply = page.getByTestId("review-apply");
    if (await apply.isVisible()) {
      // Tick every suggestion, apply them, then confirm the request.
      for (const box of await review.getByRole("checkbox").all()) await box.check();
      await apply.click();
      await expect(page.getByText(/applied/).first()).toBeVisible();
    }
    await page.getByTestId("review-confirm").click();
    await expect(page.getByTestId("ai-review")).toHaveCount(0);
    await expect(page.getByText("confirmed the request").first()).toBeVisible();

    const after = await json<{ needs_review: boolean }>(await client.get(`/api/v1/jobs/${job!.id}`));
    expect(after.needs_review).toBe(false);
    const again = await client.post(`/api/v1/jobs/${job!.id}/review`, { data: { confirm: true } });
    expect(again.status()).toBe(409);
    await client.dispose();
    await page.close();
  });

  test("an owner sees AI usage and can turn AI off and on", async ({ browser }) => {
    const owner = await pageAs(browser, "owner");
    await owner.goto("/settings/ai");
    await expect(owner.getByTestId("ai-usage")).toBeVisible();
    await expect(owner.getByTestId("ai-provider")).toBeVisible();
    await axe(owner);
    const toggle = owner.getByTestId("ai-enabled");
    await expect(toggle).toBeChecked();
    try {
      await toggle.click();
      await owner.getByTestId("ai-save").click();
      await expect(owner.getByText("AI settings saved")).toBeVisible();

      const dispatcher = await pageAs(browser, "dispatcher");
      await dispatcher.goto("/jobs/new");
      await expect(dispatcher.getByTestId("ai-unavailable")).toContainText("turned off");
      await dispatcher.close();
    } finally {
      await owner.reload();
      if (!(await owner.getByTestId("ai-enabled").isChecked())) {
        await owner.getByTestId("ai-enabled").click();
        await owner.getByTestId("ai-save").click();
        await expect(owner.getByText("AI settings saved")).toBeVisible();
      }
    }
    // Dispatchers don't reach AI settings.
    const dispatcher = await pageAs(browser, "dispatcher");
    const res = await dispatcher.goto("/settings/ai");
    expect(res?.status()).toBe(404);
    await dispatcher.close();
    await owner.close();
  });
});

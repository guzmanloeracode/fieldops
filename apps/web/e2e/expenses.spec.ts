import { expect, test } from "@playwright/test";
import {
  api,
  assign,
  createJob,
  futureWindow,
  json,
  memberByEmail,
  storageState,
  uniq,
  USERS,
} from "./fixtures";

// Parts and expenses (EXP-01–03, TEC-03). The demo organization approves requests under $50 automatically;
// dispatchers approve under $250; owners and admins approve anything.

// 1×1 PNG, enough for a receipt photo.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

interface ExpenseDto {
  id: string;
  status: string;
  total_minor: number;
  auto_approved: boolean;
  used_at: string | null;
}

test.describe.serial("parts and expenses", () => {
  const tag = uniq();
  let jobId = "";
  let jobNumber = "";

  test.beforeAll(async () => {
    const dispatcher = await api("dispatcher");
    const job = await createJob(dispatcher, `E2E parts ${tag}`);
    const tom = await memberByEmail(dispatcher, USERS.technician);
    await assign(dispatcher, job.id, tom.id, futureWindow(2));
    jobId = job.id;
    jobNumber = job.number;
    await dispatcher.dispose();
  });

  test("technician requests parts on a phone, with a receipt, and records one as used", async ({
    browser,
  }) => {
    const page = await browser.newPage({
      storageState: storageState("technician"),
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    await page.goto(`/jobs/${jobNumber}`);
    const section = page.getByTestId("job-expenses");
    await expect(section.getByText("No parts or expenses requested yet.")).toBeVisible();

    // Under the $50 threshold: approved on the spot.
    await section.getByTestId("expense-request-open").click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByText("Requests under $50.00 are approved automatically.", { exact: false }),
    ).toBeVisible();
    await dialog.getByLabel("Item").fill(`Run capacitor ${tag}`);
    await dialog.getByLabel("Quantity").fill("2");
    await dialog.getByLabel("Unit cost (USD)").fill("18.50");
    await expect(dialog.getByTestId("expense-form-total")).toHaveText("$37.00");
    await dialog.getByLabel("Supplier").fill("Johnstone Supply");
    await dialog.getByLabel("Why is it needed?").fill("Capacitor tested 30% under rating");
    await dialog
      .getByTestId("expense-receipt-input")
      .setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: PNG });
    await expect(dialog.getByText("receipt.png")).toBeVisible();
    await dialog.getByTestId("expense-request-submit").click();
    await expect(dialog).toBeHidden();

    const capacitor = section.getByTestId("expense-row").filter({ hasText: `Run capacitor ${tag}` });
    await expect(capacitor.getByText("Approved", { exact: true })).toBeVisible();
    await expect(capacitor.getByText("Auto-approved")).toBeVisible();
    await expect(capacitor.getByRole("link", { name: "View receipt" })).toBeVisible();

    // Above the threshold: waits for an approver. Technicians can't approve.
    await section.getByTestId("expense-request-open").click();
    await dialog.getByLabel("Item").fill(`Blower motor ${tag}`);
    await dialog.getByLabel("Unit cost (USD)").fill("289");
    await dialog.getByLabel("Why is it needed?").fill("Motor bearings worn, overheating");
    await dialog.getByTestId("expense-request-submit").click();
    await expect(dialog).toBeHidden();
    const motor = section.getByTestId("expense-row").filter({ hasText: `Blower motor ${tag}` });
    await expect(motor.getByText("Pending", { exact: true })).toBeVisible();
    await expect(motor.getByTestId("expense-approve")).toHaveCount(0);
    await expect(section.getByText("Pending $289.00")).toBeVisible();

    // TEC-03: the approved part is recorded as used.
    await capacitor.getByTestId("expense-mark-used").click();
    await expect(capacitor.getByText("Used", { exact: true })).toBeVisible();
    await expect(capacitor.getByTestId("expense-mark-used")).toHaveCount(0);

    // Validation happens before anything is sent.
    await section.getByTestId("expense-request-open").click();
    await dialog.getByLabel("Quantity").fill("1.234");
    await dialog.getByTestId("expense-request-submit").click();
    await expect(dialog.getByText("Name the part or expense")).toBeVisible();
    await expect(dialog.getByText("Enter a quantity above 0 with at most two decimals")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.close();
  });

  test("dispatcher approves within the limit from the inbox and can't approve above it", async ({
    browser,
  }) => {
    const tech = await api("technician");
    const pump = await json<ExpenseDto>(
      await tech.post(`/api/v1/jobs/${jobId}/expenses`, {
        data: { item: `Condensate pump ${tag}`, quantity: 1, unit_cost_minor: 12900, reason: "Pump failed" },
      }),
    );
    expect(pump).toMatchObject({ status: "pending", total_minor: 12900, auto_approved: false });
    await tech.dispose();

    const page = await browser.newPage({ storageState: storageState("dispatcher") });
    await page.goto("/approvals");
    await expect(page.getByTestId("limit-note")).toContainText("under $250.00");
    const pumpRow = page.getByTestId("approval-row").filter({ hasText: `Condensate pump ${tag}` });
    const motorRow = page.getByTestId("approval-row").filter({ hasText: `Blower motor ${tag}` });
    await expect(motorRow.getByTestId("above-limit")).toHaveText("Above your approval limit");
    await expect(motorRow.getByRole("checkbox")).toBeDisabled();
    await expect(pumpRow.getByRole("link", { name: jobNumber })).toBeVisible();

    await pumpRow.getByRole("checkbox").check();
    await page.getByTestId("bulk-approve").click();
    await expect(page.getByText("1 request approved")).toBeVisible();
    await expect(pumpRow).toHaveCount(0);

    // The decided request is listed under Approved.
    await page.goto("/approvals?status=approved");
    await expect(
      page
        .getByTestId("approval-row")
        .filter({ hasText: `Condensate pump ${tag}` })
        .getByText("Approved by Dan Brooks"),
    ).toBeVisible();
    await page.close();
  });

  test("owner approves the large request on the job and the timeline records it", async ({ browser }) => {
    const page = await browser.newPage({ storageState: storageState("owner") });
    await page.goto(`/jobs/${jobNumber}`);
    const motor = page.getByTestId("expense-row").filter({ hasText: `Blower motor ${tag}` });
    await motor.getByTestId("expense-approve").click();
    await expect(motor.getByText("Approved", { exact: true })).toBeVisible();
    await expect(motor.getByText("Approved by Olivia Carter")).toBeVisible();
    const timeline = page.locator("ol").filter({ hasText: "created the job" });
    await expect(timeline.getByText(`approved Blower motor ${tag} ($289.00)`)).toBeVisible();
    await expect(timeline.getByText(`recorded Run capacitor ${tag} as used`)).toBeVisible();
    await expect(
      timeline.getByText(`requested Run capacitor ${tag} ($37.00), approved automatically`),
    ).toBeVisible();
    await page.close();
  });

  test("API: rejections need a comment, limits apply and decisions happen once", async () => {
    const tech = await api("technician");
    const dispatcher = await api("dispatcher");
    const owner = await api("owner");
    const big = await json<ExpenseDto>(
      await tech.post(`/api/v1/jobs/${jobId}/expenses`, {
        data: {
          kind: "part",
          item: `TXV valve ${tag}`,
          quantity: 1,
          unit_cost_minor: 31000,
          reason: "Stuck closed",
        },
      }),
    );
    expect(
      (await tech.post(`/api/v1/expenses/${big.id}/decision`, { data: { decision: "approve" } })).status(),
    ).toBe(403);
    const overLimit = await dispatcher.post(`/api/v1/expenses/${big.id}/decision`, {
      data: { decision: "approve" },
    });
    expect(overLimit.status()).toBe(403);
    expect(((await overLimit.json()) as { detail: string }).detail).toContain("above your approval limit");
    const noComment = await owner.post(`/api/v1/expenses/${big.id}/decision`, {
      data: { decision: "reject" },
    });
    expect(noComment.status()).toBe(422);
    const rejected = await json<ExpenseDto>(
      await owner.post(`/api/v1/expenses/${big.id}/decision`, {
        data: { decision: "reject", comment: "Use the spare from the warehouse" },
      }),
    );
    expect(rejected.status).toBe("rejected");
    expect(
      (await owner.post(`/api/v1/expenses/${big.id}/decision`, { data: { decision: "approve" } })).status(),
    ).toBe(409);
    // Rejected parts can't be recorded as used.
    expect((await tech.post(`/api/v1/expenses/${big.id}/used`)).status()).toBe(409);

    const listed = await json<{ data: { id: string }[]; next_cursor: string | null }>(
      await tech.get(`/api/v1/expenses?job=${jobId}&status=rejected`),
    );
    expect(listed.data.map((e) => e.id)).toEqual([big.id]);
    // Other organizations can't see the request.
    const other = await api("otherOrgOwner");
    expect((await other.get(`/api/v1/jobs/${jobId}/expenses`)).status()).toBe(404);
    expect(
      (await other.post(`/api/v1/expenses/${big.id}/decision`, { data: { decision: "approve" } })).status(),
    ).toBe(404);
    await Promise.all([tech.dispose(), dispatcher.dispose(), owner.dispose(), other.dispose()]);
  });
});

test.describe("operations settings", () => {
  test.use({ storageState: storageState("owner") });

  test("shows the approval thresholds and validates them", async ({ page }) => {
    await page.goto("/settings/operations");
    const auto = page.getByLabel("Approve automatically below (USD)");
    const limit = page.getByLabel("Dispatchers can approve below (USD)");
    await expect(auto).toHaveValue("50.00");
    await expect(limit).toHaveValue("250.00");
    await limit.fill("10");
    await page.getByTestId("operations-save").click();
    await expect(
      page.getByText("The dispatcher limit can't be lower than the auto-approve threshold"),
    ).toBeVisible();
    await limit.fill("abc");
    await page.getByTestId("operations-save").click();
    await expect(page.getByText("Enter an amount like 50.00")).toBeVisible();
    // Saving the original values changes nothing for other tests.
    await limit.fill("250.00");
    await page.getByTestId("operations-save").click();
    await expect(page.getByText("Operations settings saved")).toBeVisible();
  });

  test("is hidden from dispatchers, and technicians can't open the inbox", async ({ browser }) => {
    for (const user of ["dispatcher", "technician"] as const) {
      const page = await browser.newPage({ storageState: storageState(user) });
      const res = await page.goto("/settings/operations");
      expect(res?.status()).toBe(404);
      if (user === "technician") expect((await page.goto("/approvals"))?.status()).toBe(404);
      await page.close();
    }
  });
});

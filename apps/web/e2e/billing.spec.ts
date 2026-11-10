import { expect, test, type APIRequestContext } from "@playwright/test";
import { signViaApi } from "./fieldwork-helpers";
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

// Quotes, invoices and payments (FIN-01–07, EXP-04): the office builds a quote from the catalog, sends it and records
// the customer's approval (a job appears); a completed job becomes an invoice with labor and parts, is issued and
// paid; an invoice is voided; PDFs download; technicians never reach billing.

interface CustomerDetail {
  id: string;
  name: string;
  contacts: { id: string; email: string | null }[];
  site_count: number;
}

/** A customer with a site and a contact with an email, to send documents to. */
async function billableCustomer(client: APIRequestContext): Promise<CustomerDetail> {
  const list = await json<{ data: { id: string }[] }>(
    await client.get("/api/v1/customers?limit=25&sort=name"),
  );
  for (const c of list.data) {
    const detail = await json<CustomerDetail>(await client.get(`/api/v1/customers/${c.id}`));
    if (detail.site_count > 0 && detail.contacts.some((x) => x.email)) return detail;
  }
  throw new Error("No customer with a site and an email contact");
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/stream", (route) => route.fulfill({ status: 204 }));
});

test.describe.serial("billing", () => {
  // Pages compile on first use under `next dev`; give the journeys room.
  test.slow();
  const tag = uniq();
  let quoteId = "";

  test("a quote built from the catalog is sent and approved, and becomes a job", async ({ browser }) => {
    const client = await api("dispatcher");
    const customer = await billableCustomer(client);
    await client.dispose();

    const context = await browser.newContext({ storageState: storageState("dispatcher") });
    const page = await context.newPage();
    await page.route("**/api/v1/stream", (route) => route.fulfill({ status: 204 }));
    await page.goto("/quotes/new");
    await page.getByTestId("customer-picker").click();
    await page.getByPlaceholder("Search customers…").fill(customer.name);
    await page.getByRole("option", { name: customer.name }).first().click();
    await expect(page.getByLabel("Site", { exact: true })).not.toHaveValue("");
    await page.getByLabel("Title", { exact: true }).fill(`E2E quote ${tag}`);

    await page.getByTestId("add-catalog").click();
    await page.getByPlaceholder("Search parts and fees").fill("filter");
    await page
      .getByRole("option", { name: /Air filter/ })
      .first()
      .click();
    await page.getByTestId("add-line").click();
    const free = page.getByTestId("line").nth(1);
    await free.getByLabel("Description", { exact: true }).fill("Labor estimate");
    await free.getByLabel("Qty", { exact: true }).fill("2");
    await free.getByLabel("Unit price (USD)").fill("95");
    // $14.50 + 2 × $95.00 = $204.50, plus 8.25% Texas sales tax per line ($1.20 + $15.68).
    await expect(page.getByTestId("line-editor").getByTestId("total")).toHaveText("$221.38");
    await page.getByTestId("save-quote").click();
    await expect(page).toHaveURL(/\/quotes\/QUO-\d{4}-\d{4}$/, { timeout: 60_000 });
    const number = page.url().split("/").pop()!;
    await expect(page.getByTestId("quote-status")).toHaveText("Draft");

    await page.getByTestId("send-quote").click();
    await page.getByTestId("confirm-send").click();
    await expect(page.getByTestId("quote-status")).toHaveText("Sent");

    await page.getByTestId("decide-quote").click();
    await expect(page.getByRole("dialog").getByText("Approving creates a new job")).toBeVisible();
    await page.getByTestId("confirm-decision").click();
    await expect(page.getByTestId("quote-status")).toHaveText("Approved");
    await expect(page.getByTestId("totals").getByTestId("total")).toHaveText("$221.38");
    await page.getByTestId("quote-job-link").click();
    await expect(page).toHaveURL(/\/jobs\/JOB-\d{6}$/, { timeout: 60_000 });
    await expect(page.getByRole("heading", { name: `E2E quote ${tag}`, level: 1 })).toBeVisible();
    await expect(page.getByTestId("job-status")).toHaveText("New");
    await expect(page.getByTestId("job-quote").getByRole("link", { name: number })).toBeVisible();

    const owner = await api("owner");
    const quote = await json<{ id: string; status: string; job: { number: string } | null }>(
      await owner.get(`/api/v1/quotes/${number}`),
    );
    expect(quote.status).toBe("approved");
    quoteId = quote.id;
    await owner.dispose();
    await context.close();
  });

  test("a completed job is invoiced with labor and parts, issued and paid", async ({ browser }) => {
    const dispatcher = await api("dispatcher");
    const job = await createJob(dispatcher, `E2E invoice ${tag}`);
    const tom = await memberByEmail(dispatcher, USERS.technician);
    await assign(dispatcher, job.id, tom.id, futureWindow(2));
    await dispatcher.dispose();
    const tech = await api("technician");
    const started = await tech.post(`/api/v1/jobs/${job.id}/transitions`, { data: { to: "in_progress" } });
    expect(started.ok(), await started.text()).toBeTruthy();
    const part = await tech.post(`/api/v1/jobs/${job.id}/expenses`, {
      data: { item: `Capacitor ${tag}`, quantity: 1, unit_cost_minor: 1850, reason: "Weak capacitor" },
    });
    expect(part.status(), await part.text()).toBe(201);
    await signViaApi(tech, job.id);
    const done = await tech.post(`/api/v1/jobs/${job.id}/transitions`, { data: { to: "completed" } });
    expect(done.ok(), await done.text()).toBeTruthy();
    // 1 h 05 min of recorded work bills 1.25 h.
    const now = Date.now();
    const entry = await tech.post(`/api/v1/jobs/${job.id}/time-entries`, {
      data: {
        kind: "work",
        started_at: new Date(now - 2 * 3_600_000).toISOString(),
        ended_at: new Date(now - 2 * 3_600_000 + 65 * 60_000).toISOString(),
        reason: "Forgot to start the clock",
      },
    });
    expect(entry.status(), await entry.text()).toBe(201);
    await tech.dispose();

    const context = await browser.newContext({ storageState: storageState("owner") });
    const page = await context.newPage();
    await page.route("**/api/v1/stream", (route) => route.fulfill({ status: 204 }));
    await page.goto(`/jobs/${job.number}`);
    await page.getByTestId("job-billing").getByTestId("create-invoice").click();
    await expect(page).toHaveURL(/\/invoices\/new\?job=/, { timeout: 60_000 });
    // No service type on this job: the labor line, then the approved part.
    const lines = page.getByTestId("line");
    await expect(lines).toHaveCount(2);
    const labor = lines.nth(0);
    await expect(labor.getByLabel("Description", { exact: true })).toHaveValue("Labor: Tom Reyes");
    await expect(labor.getByLabel("Qty", { exact: true })).toHaveValue("1.25");
    const capacitor = lines.nth(1);
    await expect(capacitor.getByLabel("Description", { exact: true })).toHaveValue(`Capacitor ${tag}`);
    await capacitor.getByLabel(/Markup %/).fill("20");
    await expect(capacitor.getByTestId("line-net")).toHaveText("$22.20");
    await page.getByTestId("save-invoice").click();
    await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await expect(page.getByTestId("invoice-status")).toHaveText("Draft");
    const invoiceId = page.url().split("/").pop()!;

    await page.getByTestId("send-invoice").click();
    await page.getByTestId("confirm-send").click();
    await expect(page.getByTestId("invoice-status")).toHaveText("Sent");
    await expect(page.getByTestId("invoice-number")).toHaveText(/^INV-\d{4}-\d{4}$/);

    await page.getByTestId("record-payment").click();
    await page.getByLabel("Method", { exact: true }).selectOption("cash");
    await page.getByTestId("confirm-payment").click();
    await expect(page.getByTestId("invoice-status")).toHaveText("Paid");
    await expect(page.getByTestId("balance")).toHaveText("$0.00");
    await expect(page.getByTestId("payments").getByText("Cash")).toBeVisible();

    // The job shows the invoice; the part can't be billed again.
    await page.goto(`/jobs/${job.number}`);
    await expect(page.getByTestId("job-billing").getByText("Paid", { exact: true })).toBeVisible();
    const owner = await api("owner");
    const again = await owner.post("/api/v1/invoices", { data: { job_id: job.id } });
    expect(again.status()).toBe(201);
    const second = (await again.json()) as { lines: { expense_request_id: string | null }[] };
    expect(second.lines.some((l) => l.expense_request_id)).toBe(false);

    // PDFs.
    for (const path of [`/api/v1/invoices/${invoiceId}/pdf`, `/api/v1/quotes/${quoteId}/pdf`]) {
      const pdf = await owner.get(path);
      expect(pdf.status()).toBe(200);
      expect(pdf.headers()["content-type"]).toBe("application/pdf");
      expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
    }
    await owner.dispose();
    await context.close();
  });

  test("an unpaid invoice is voided with a reason", async ({ browser }) => {
    const owner = await api("owner");
    const customer = await billableCustomer(owner);
    const created = await json<{ id: string }>(
      await owner.post("/api/v1/invoices", {
        data: {
          customer_id: customer.id,
          lines: [
            {
              kind: "fee",
              description: `Call-out ${tag}`,
              quantity: 1,
              unit_price_minor: 9500,
              tax_rate_bps: 0,
            },
          ],
        },
      }),
    );
    await json(await owner.post(`/api/v1/invoices/${created.id}/send`, { data: {} }));
    await owner.dispose();

    const context = await browser.newContext({ storageState: storageState("owner") });
    const page = await context.newPage();
    await page.route("**/api/v1/stream", (route) => route.fulfill({ status: 204 }));
    await page.goto(`/invoices/${created.id}`);
    await expect(page.getByTestId("invoice-status")).toHaveText("Sent");
    await page.getByTestId("void-invoice").click();
    await page.getByLabel("Reason", { exact: true }).fill("Billed twice by mistake");
    await page.getByTestId("confirm-void").click();
    await expect(page.getByTestId("invoice-status")).toHaveText("Void");
    await expect(page.getByText("Billed twice by mistake")).toBeVisible();
    await context.close();
  });

  test("the API reference describes the billing endpoints", async () => {
    const client = await api("owner");
    const doc = await json<{ paths: Record<string, Record<string, unknown>> }>(
      await client.get("/api/v1/openapi.json"),
    );
    for (const path of [
      "/quotes",
      "/quotes/{id}/decision",
      "/quotes/{id}/pdf",
      "/invoices/{id}/payments",
      "/invoices/{id}/void",
      "/catalog-items",
    ]) {
      expect(doc.paths[path], path).toBeDefined();
    }
    const catalog = await json<{ data: { sku: string | null }[] }>(
      await client.get("/api/v1/catalog-items?q=CAP"),
    );
    expect(catalog.data.map((c) => c.sku)).toContain("CAP-455");
    await client.dispose();
  });

  test("technicians can't reach quotes, invoices or the billing API", async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageState("technician") });
    const page = await context.newPage();
    for (const path of ["/invoices", "/quotes", `/quotes/new`]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
    }
    await context.close();
    const tech = await api("technician");
    expect((await tech.get("/api/v1/invoices")).status()).toBe(403);
    expect((await tech.get(`/api/v1/quotes/${quoteId}/pdf`)).status()).toBe(403);
    await tech.dispose();
  });
});

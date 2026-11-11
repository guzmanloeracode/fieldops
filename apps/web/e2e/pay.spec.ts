import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { api, json, storageState, uniq } from "./fixtures";
import { JAMIE } from "./report-helpers";

// Quotes and invoices in the customer portal and online payments (POR-04, FIN-05): the demo customer approves a
// quote (a job appears) and declines another, pays an invoice through the simulated test checkout (the invoice is
// paid and the owner notified), comes back from a canceled checkout, and never sees another customer's invoice.
// Staff copy a payment link, which is reused while it is open. The documents are created through the API so the
// spec can run again against the same database.

const PORTAL = "/portal/acme-air";
/** Routes compile on first use under `next dev`; the first visit to each may take a while. */
const FIRST = { timeout: 60_000 };

interface Party {
  customerId: string;
  siteId: string;
  contactId: string;
}

async function party(client: APIRequestContext, customerId: string, email?: string): Promise<Party | null> {
  const detail = await json<{ contacts: { id: string; email: string | null }[] }>(
    await client.get(`/api/v1/customers/${customerId}`, FIRST),
  );
  const sites = await json<{ data: { id: string }[] }>(
    await client.get(`/api/v1/customers/${customerId}/sites`, FIRST),
  );
  const contact = detail.contacts.find((c) => (email ? c.email === email : c.email));
  return contact && sites.data[0] ? { customerId, siteId: sites.data[0].id, contactId: contact.id } : null;
}

/** The demo portal customer (Jamie Rivera's customer). */
async function jamie(client: APIRequestContext): Promise<Party> {
  const list = await json<{ data: { id: string }[] }>(
    await client.get(`/api/v1/customers?q=${encodeURIComponent(JAMIE)}&limit=1`, FIRST),
  );
  return (await party(client, list.data[0]!.id, JAMIE))!;
}

/** Another customer of the same organization, with a site and an email contact. */
async function someoneElse(client: APIRequestContext, not: string): Promise<Party> {
  const list = await json<{ data: { id: string }[] }>(
    await client.get("/api/v1/customers?limit=25&sort=name", FIRST),
  );
  for (const c of list.data) {
    if (c.id === not) continue;
    const p = await party(client, c.id);
    if (p) return p;
  }
  throw new Error("No other customer with a site and an email contact");
}

async function sentQuote(client: APIRequestContext, title: string) {
  const p = await jamie(client);
  const created = await json<{ id: string; number: string }>(
    await client.post("/api/v1/quotes", {
      ...FIRST,
      data: {
        customer_id: p.customerId,
        site_id: p.siteId,
        contact_id: p.contactId,
        title,
        notes: "Includes disposal of the old unit.",
        lines: [
          {
            kind: "service",
            description: "Condenser fan replacement",
            quantity: 1,
            unit_price_minor: 32_000,
            tax_rate_bps: 0,
          },
          {
            kind: "part",
            description: "Condenser fan motor",
            quantity: 1,
            unit_price_minor: 18_500,
            tax_rate_bps: 0,
          },
        ],
      },
    }),
  );
  await json(await client.post(`/api/v1/quotes/${created.id}/send`, { data: {}, ...FIRST }));
  return created;
}

async function sentInvoice(client: APIRequestContext, description: string, to?: Party) {
  const p = to ?? (await jamie(client));
  const created = await json<{ id: string }>(
    await client.post("/api/v1/invoices", {
      ...FIRST,
      data: {
        customer_id: p.customerId,
        contact_id: p.contactId,
        lines: [{ kind: "fee", description, quantity: 1, unit_price_minor: 12_345, tax_rate_bps: 0 }],
      },
    }),
  );
  return json<{ id: string; number: string; total_minor: number }>(
    await client.post(`/api/v1/invoices/${created.id}/send`, { data: {}, ...FIRST }),
  );
}

async function demoSignIn(page: Page) {
  await page.goto(`${PORTAL}/sign-in`);
  await page.getByTestId("portal-demo-sign-in").click();
  await expect(page).toHaveURL(new RegExp(`${PORTAL}$`));
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/stream", (route) => route.fulfill({ status: 204 }));
});

test.describe.serial("pay", () => {
  // Pages compile on first use under `next dev`; give the journeys room.
  test.slow();
  const tag = uniq();

  test("a customer approves a quote in the portal and a job is created (POR-04)", async ({ page }) => {
    const client = await api("dispatcher");
    const title = `E2E portal quote ${tag}`;
    const quote = await sentQuote(client, title);

    await demoSignIn(page);
    await expect(page.getByTestId("portal-quote-todo").filter({ hasText: quote.number })).toBeVisible();
    await page.getByTestId("portal-nav").getByRole("link", { name: "Quotes" }).click();
    await expect(page.getByRole("heading", { name: "Quotes", level: 1 })).toBeVisible(FIRST);
    await page.getByTestId("portal-quote").filter({ hasText: quote.number }).click();
    await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible(FIRST);
    await expect(page.getByTestId("portal-quote-status")).toHaveText("Waiting for you");
    await expect(page.getByTestId("total")).toHaveText("$505.00");
    await expect(page.getByText("Includes disposal of the old unit.")).toBeVisible();

    const pdf = await page.request.get(`${PORTAL}/quotes/${quote.id}/pdf`, FIRST);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");

    await page.getByTestId("portal-approve-quote").click();
    await page.getByTestId("portal-approve-confirm").click(FIRST);
    const outcome = page.getByTestId("portal-quote-outcome");
    await expect(outcome).toContainText("You approved this quote on", FIRST);
    await expect(page.getByTestId("portal-quote-status")).toHaveText("Approved");
    const jobNumber = /JOB-\d+/.exec((await outcome.textContent())!)![0];

    // The office sees the approval by the contact, the first view, and a New job from the quote.
    const staff = await json<{ status: string; viewed_at: string | null; job: { number: string } | null }>(
      await client.get(`/api/v1/quotes/${quote.id}`, FIRST),
    );
    expect(staff.status).toBe("approved");
    expect(staff.viewed_at).not.toBeNull();
    expect(staff.job?.number).toBe(jobNumber);
    const job = await json<{ source: string; status: string; title: string }>(
      await client.get(`/api/v1/jobs/${jobNumber}`, FIRST),
    );
    expect(job).toMatchObject({ source: "quote", status: "new", title });

    // The customer follows the new job from the quote.
    await page.getByRole("link", { name: `View ${jobNumber}` }).click();
    await expect(page.getByTestId("portal-history")).toBeVisible(FIRST);
    await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
    await client.dispose();
  });

  test("a customer declines a quote with a reason", async ({ page }) => {
    const client = await api("dispatcher");
    const quote = await sentQuote(client, `E2E portal decline ${tag}`);
    await demoSignIn(page);
    await page.goto(`${PORTAL}/quotes/${quote.id}`);
    await page.getByTestId("portal-decline-quote").click();
    await page.getByTestId("portal-decline-confirm").click();
    await expect(page.getByText("Say why you're declining")).toBeVisible();
    await page.getByLabel("Reason").fill("We'll wait until spring");
    await page.getByTestId("portal-decline-confirm").click();
    await expect(page.getByTestId("portal-quote-outcome")).toContainText(
      "Your reason: We'll wait until spring",
    );
    const staff = await json<{ status: string; decline_reason: string }>(
      await client.get(`/api/v1/quotes/${quote.id}`, FIRST),
    );
    expect(staff).toMatchObject({ status: "declined", decline_reason: "We'll wait until spring" });
    await client.dispose();
  });

  test("a customer pays an invoice through the test checkout; the owner is notified (FIN-05)", async ({
    page,
  }) => {
    const client = await api("dispatcher");
    const invoice = await sentInvoice(client, `E2E portal payment ${tag}`);
    await client.dispose();

    await demoSignIn(page);
    await expect(page.getByTestId("portal-invoice-todo").filter({ hasText: invoice.number })).toBeVisible();
    await page.getByTestId("portal-nav").getByRole("link", { name: "Invoices" }).click();
    await expect(page.getByRole("heading", { name: "Invoices", level: 1 })).toBeVisible(FIRST);
    await page.getByTestId("portal-invoice").filter({ hasText: invoice.number }).click();
    await expect(page.getByTestId("portal-invoice-number")).toHaveText(`Invoice ${invoice.number}`, FIRST);
    await expect(page.getByTestId("portal-invoice-status")).toHaveText("Due");
    await expect(page.getByTestId("portal-invoice-balance")).toHaveText("$123.45");
    await expect(page.getByText("Test mode: no real card is charged.")).toBeVisible();

    await page.getByTestId("portal-pay-now").click(FIRST);
    await expect(page).toHaveURL(/\/checkout\/[\w-]+\.[\w-]+$/, FIRST);
    const checkoutUrl = page.url();
    await expect(page.getByRole("heading", { name: "Test checkout", level: 1 })).toBeVisible(FIRST);
    await expect(page.getByText("Test mode", { exact: true })).toBeVisible();
    await expect(page.getByTestId("test-checkout-amount")).toHaveText("$123.45");
    // Nothing that looks like a card form: no fields at all (the form only carries the server action).
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(page.locator("input:not([type=hidden]), select, textarea")).toHaveCount(0);
    await page.getByTestId("test-checkout-pay").click(FIRST);

    await expect(page).toHaveURL(new RegExp(`${PORTAL}/invoices/${invoice.id}\\?payment=success$`), FIRST);
    await expect(page.getByTestId("portal-payment-banner")).toHaveText(
      "Thank you! Your payment was received.",
    );
    await expect(page.getByTestId("portal-invoice-status")).toHaveText("Paid");
    await expect(page.getByTestId("portal-payments")).toContainText("$123.45 · Card");
    await expect(page.getByTestId("portal-pay-now")).toHaveCount(0);

    // The office sees a card payment through the test checkout; the owner was notified.
    const owner = await api("owner");
    const paid = await json<{
      status: string;
      payments: { provider: string; method: string; amount_minor: number }[];
    }>(await owner.get(`/api/v1/invoices/${invoice.id}`, FIRST));
    expect(paid.status).toBe("paid");
    expect(paid.payments).toEqual([
      expect.objectContaining({ provider: "simulated", method: "card", amount_minor: 12_345 }),
    ]);
    const notes = await json<{ data: { type: string; payload: { invoice_number?: string } }[] }>(
      await owner.get("/api/v1/notifications?limit=50"),
    );
    expect(
      notes.data.some((n) => n.type === "payment_received" && n.payload.invoice_number === invoice.number),
    ).toBe(true);
    await owner.dispose();

    // The same checkout can't pay twice.
    await page.goto(checkoutUrl);
    await expect(page.getByTestId("test-checkout-state")).toHaveText("This invoice is paid.");
    await expect(page.getByTestId("test-checkout-pay")).toHaveCount(0);
  });

  test("staff copy a payment link that is reused; a canceled checkout charges nothing", async ({
    page,
    browser,
  }) => {
    const client = await api("dispatcher");
    const invoice = await sentInvoice(client, `E2E payment link ${tag}`);

    const context = await browser.newContext({ storageState: storageState("dispatcher") });
    const staff = await context.newPage();
    await staff.route("**/api/v1/stream", (route) => route.fulfill({ status: 204 }));
    await staff.goto(`/invoices/${invoice.id}`);
    await staff.getByTestId("copy-payment-link").click(FIRST);
    const field = staff.getByTestId("payment-link-url");
    await expect(field).toHaveValue(/\/checkout\//, FIRST);
    const link = await field.inputValue();
    await expect(staff.getByText("Test mode: the link opens the test checkout")).toBeVisible();
    await context.close();

    // The API hands out the same open session.
    const again = await client.post(`/api/v1/invoices/${invoice.id}/checkout`, FIRST);
    expect(again.status()).toBe(200);
    expect(await again.json()).toMatchObject({ url: link, provider: "simulated", reused: true });
    const doc = await json<{ paths: Record<string, unknown> }>(
      await client.get("/api/v1/openapi.json", FIRST),
    );
    expect(Object.keys(doc.paths)).toContain("/invoices/{id}/checkout");

    await demoSignIn(page);
    await page.goto(new URL(link).pathname);
    await page.getByTestId("test-checkout-cancel").click(FIRST);
    await expect(page).toHaveURL(new RegExp(`${PORTAL}/invoices/${invoice.id}\\?payment=canceled$`));
    await expect(page.getByTestId("portal-payment-banner")).toHaveText(
      "Payment canceled. Nothing was charged.",
    );
    await expect(page.getByTestId("portal-invoice-status")).toHaveText("Due");

    // Another customer's invoice is a 404, and so is its PDF.
    const mine = await jamie(client);
    const other = await sentInvoice(
      client,
      `E2E other customer ${tag}`,
      await someoneElse(client, mine.customerId),
    );
    const res = await page.goto(`${PORTAL}/invoices/${other.id}`);
    expect(res?.status()).toBe(404);
    expect((await page.request.get(`${PORTAL}/invoices/${other.id}/pdf`)).status()).toBe(404);
    await client.dispose();
  });
});

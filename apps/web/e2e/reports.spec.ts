import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { api, json, storageState, uniq } from "./fixtures";
import { completedJobForJamie, JAMIE } from "./report-helpers";

// Service reports (AI-03, FIN-04, POR-04, §8.7): completing a job creates a draft report; the office drafts it with
// AI (the deterministic fixture model in the E2E stack), edits it, previews and downloads the PDF and sends it; the
// customer's "Job completed" email lands in the demo outbox with a signed link that works without signing in; the
// portal customer downloads the report from their job page.

async function expectPdf(res: Awaited<ReturnType<APIRequestContext["get"]>>) {
  expect(res.status(), await res.text().catch(() => "")).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/pdf");
  expect((await res.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
}

async function noStream(page: Page) {
  await page.route("**/api/v1/stream", (route) => route.fulfill({ status: 204 }));
}

test.describe("service reports", () => {
  test.use({ storageState: storageState("owner") });

  test("complete → AI draft → edit → send → email with a link → PDF; the portal customer downloads it", async ({
    page,
    browser,
  }) => {
    const title = `E2E report ${uniq()}`;
    const job = await completedJobForJamie(title);

    await page.goto(`/jobs/${job.number}`);
    const card = page.getByTestId("service-report");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("report-status")).toHaveText("Draft");
    // Prefilled from the job until the AI draft arrives.
    await expect(card.getByTestId("report-work")).toHaveValue(`Completed: ${title}.`);

    await card.getByTestId("report-draft-ai").click();
    await expect(page.getByText("AI draft ready")).toBeVisible();
    await expect(card.getByText("AI draft", { exact: true })).toBeVisible();
    await expect(card.getByTestId("report-work")).toHaveValue(
      `The technician completed the work for "${title}".`,
    );
    await expect(card.getByTestId("report-recommendations")).toHaveValue(
      "Keep the equipment on a regular maintenance schedule.",
    );

    await card.getByTestId("report-findings").fill("The condensate drain line was clogged; it is clear now.");
    await expect(card.getByText("Save your changes before sending")).toBeVisible();
    await card.getByTestId("report-save").click();
    await expect(page.getByText("Report saved")).toBeVisible();
    await expect(card.getByText("AI draft, edited")).toBeVisible();

    // Preview and download the PDF.
    await expectPdf(await page.request.get(`/api/v1/jobs/${job.id}/report/pdf`));
    const downloading = page.waitForEvent("download");
    await card.getByTestId("report-download").click();
    expect((await downloading).suggestedFilename()).toBe(`${job.number}-service-report.pdf`);

    // Send it to the customer's contact.
    await card.getByTestId("report-send").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: new RegExp(JAMIE) }).check();
    await dialog.getByTestId("report-send-confirm").click();
    await expect(page.getByText(`Report sent to ${JAMIE}`)).toBeVisible();
    await expect(card.getByTestId("report-status")).toHaveText("Sent");
    await expect(page.getByText(`sent the service report to ${JAMIE}`)).toBeVisible();

    // The "Job completed" email is captured in the demo outbox, with a link that works without a sign-in.
    await page.goto("/settings/demo-outbox");
    await page.getByText(`Your service report for ${job.number} from Acme Air & Clean`).first().click();
    const href = await page
      .getByRole("link", { name: "Download the service report (PDF)" })
      .first()
      .getAttribute("href");
    expect(href).toMatch(/\/share\/reports\/[\w-]+\.[\w-]+$/);
    const anonymous = await browser.newContext();
    await expectPdf(await anonymous.request.get(new URL(href!).pathname));
    // A tampered link doesn't open anything.
    const tampered = await anonymous.request.get(`${new URL(href!).pathname}x`);
    expect(tampered.status()).toBe(404);
    await anonymous.close();

    // The portal customer downloads it from their job page (POR-04).
    const portal = await browser.newContext();
    const customer = await portal.newPage();
    await noStream(customer);
    await customer.goto("/portal/acme-air/sign-in");
    await customer.getByTestId("portal-demo-sign-in").click();
    await expect(customer).toHaveURL(/\/portal\/acme-air$/);
    await customer.goto(`/portal/acme-air/jobs/${job.number}`);
    const report = customer.getByTestId("portal-report");
    await expect(report.getByRole("heading", { name: "Service report" })).toBeVisible();
    const portalDownload = customer.waitForEvent("download");
    await report.getByRole("link", { name: "Download PDF" }).click();
    expect((await portalDownload).suggestedFilename()).toBe(`${job.number}-service-report.pdf`);
    await portal.close();
  });

  test("the API edits with optimistic locking, drafts, refuses other recipients, and editing a sent report unpublishes it", async () => {
    const job = await completedJobForJamie(`E2E report API ${uniq()}`);
    const client = await api("dispatcher");
    const first = await client.get(`/api/v1/jobs/${job.id}/report`);
    const report = await json<{ status: string; version: number; locale: string; ai_status: string }>(first);
    expect(report).toMatchObject({ status: "draft", locale: "en" });
    expect(["pending", "drafting", "drafted", "skipped"]).toContain(report.ai_status);

    const stale = await client.patch(`/api/v1/jobs/${job.id}/report`, {
      data: { findings: "x" },
      headers: { "If-Match": `"r${report.version - 1}"` },
    });
    expect(stale.status()).toBe(412);
    const patched = await client.patch(`/api/v1/jobs/${job.id}/report`, {
      data: { work_performed: "Cleaned the coil and the drain line.", next_service_date: "2031-05-01" },
      headers: { "If-Match": first.headers()["etag"]! },
    });
    expect(patched.status(), await patched.text()).toBe(200);
    expect(await patched.json()).toMatchObject({ edited: true, next_service_date: "2031-05-01" });

    const drafted = await json<{ status: string; report: { ai_drafted: boolean; edited: boolean } }>(
      await client.post(`/api/v1/jobs/${job.id}/report-draft`),
    );
    expect(drafted).toMatchObject({ status: "drafted", report: { ai_drafted: true, edited: false } });

    const wrong = await client.post(`/api/v1/jobs/${job.id}/report/send`, {
      data: { to: "someone@else.example" },
    });
    expect(wrong.status()).toBe(422);
    const sent = await json<{ report: { status: string; sent_to: string }; link_expires_at: string }>(
      await client.post(`/api/v1/jobs/${job.id}/report/send`, { data: { to: JAMIE } }),
    );
    expect(sent.report).toMatchObject({ status: "sent", sent_to: JAMIE });
    expect(new Date(sent.link_expires_at).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);

    const edited = await json<{ status: string }>(
      await client.patch(`/api/v1/jobs/${job.id}/report`, {
        data: { recommendations: "Replace the filter." },
      }),
    );
    expect(edited.status).toBe("draft");
    const events = await json<{ data: { type: string }[] }>(
      await client.get(`/api/v1/jobs/${job.id}/events`),
    );
    expect(events.data.some((e) => e.type === "report_sent")).toBe(true);

    // The endpoints are documented (the release checks that the document builds).
    const doc = await json<{ paths: Record<string, unknown> }>(await client.get("/api/v1/openapi.json"));
    for (const path of [
      "/jobs/{id}/report",
      "/jobs/{id}/report-draft",
      "/jobs/{id}/report/send",
      "/jobs/{id}/report/pdf",
    ])
      expect(doc.paths[path], path).toBeDefined();
    await client.dispose();

    // Another organization doesn't see it.
    const other = await api("otherOrgOwner");
    expect((await other.get(`/api/v1/jobs/${job.id}/report`)).status()).toBe(404);
    await other.dispose();
  });
});

import { expect, test, type APIRequestContext } from "@playwright/test";
import { api, json, storageState } from "./fixtures";

// 0.5 outgoing webhooks (PLT-03) against the fake Relay the image E2E runs next to the web app (packages/relay):
// it records deliveries without calling anyone, failing the ones whose URL path contains /fail.

interface Endpoint {
  id: string;
  url: string;
  enabled: boolean;
  event_types: string[];
  secret?: string;
}
interface Delivery {
  id: string;
  status: string;
  event_type: string | null;
  last_status_code: number | null;
  replay_of: string | null;
}

const host = () =>
  `hooks-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}.example.com`;

async function turnOn(client: APIRequestContext) {
  const res = await client.put("/api/v1/webhook-settings", { data: { enabled: true } });
  expect((await json<{ enabled: boolean }>(res)).enabled).toBe(true);
}

async function deleteEndpoint(client: APIRequestContext, id: string) {
  await client.delete(`/api/v1/webhook-endpoints/${id}`);
}

test.describe("webhooks (PLT-03)", () => {
  test.use({ storageState: storageState("owner") });

  test("owner turns webhooks on, adds an endpoint, sees its secret once and a delivered test event", async ({
    page,
  }) => {
    const client = await api("owner");
    let endpointId = "";
    try {
      await page.goto("/settings/webhooks");
      const toggle = page.getByRole("switch", { name: "Send events" });
      await expect(toggle).toBeVisible();
      if ((await toggle.getAttribute("aria-checked")) !== "true") {
        await toggle.click();
        await expect(page.getByText("Webhooks are on")).toBeVisible();
      }
      await expect(toggle).toHaveAttribute("aria-checked", "true");

      await page.getByRole("button", { name: "Add endpoint" }).click();
      const dialog = page.getByRole("dialog");
      const url = `https://${host()}/fieldops`;
      await dialog.getByLabel("Endpoint URL").fill(url);
      await dialog.getByLabel("Description").fill("E2E receiver");
      await dialog.getByLabel("Only the events I choose").check();
      await dialog.getByRole("checkbox", { name: /job\.completed/ }).click();
      await dialog.getByRole("button", { name: "Add endpoint" }).click();

      const secret = page.getByTestId("webhook-secret");
      await expect(secret).toHaveValue(/^whsec_/);
      await page.getByRole("button", { name: "I've stored it" }).click();
      await page.waitForURL(/\/settings\/webhooks\/ep_/);
      endpointId = page.url().split("/").pop()!;

      await expect(page.getByText(url)).toBeVisible();
      await expect(page.getByText("job.completed", { exact: true })).toBeVisible();
      // The secret isn't shown again anywhere.
      const shown = await json<Endpoint>(await client.get(`/api/v1/webhook-endpoints/${endpointId}`));
      expect(shown.secret).toBeUndefined();

      await page.getByRole("button", { name: "Send test event" }).click();
      await expect(page.getByText("Test event sent")).toBeVisible();
      const row = page.getByTestId("webhook-delivery").first();
      await expect(row).toContainText("webhook.test");
      await expect(row).toContainText("Delivered");
      await row.getByRole("button", { name: /Details/ }).click();
      await expect(page.getByRole("dialog").getByText("Attempt 1")).toBeVisible();
      await expect(page.getByRole("dialog").getByText("200", { exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toBeHidden();

      // Delete from the page: back to the list, and the API no longer knows it.
      await page.getByRole("button", { name: "Delete" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
      await page.waitForURL(/\/settings\/webhooks$/);
      await expect(page.getByText("Endpoint deleted")).toBeVisible();
      expect((await client.get(`/api/v1/webhook-endpoints/${endpointId}`)).status()).toBe(404);
      endpointId = "";
    } finally {
      if (endpointId) await deleteEndpoint(client, endpointId);
      await client.dispose();
    }
  });

  test("a failing endpoint shows the failed attempt, and redelivers once fixed", async ({ page }) => {
    const client = await api("owner");
    await turnOn(client);
    const created = await json<Endpoint>(
      await client.post("/api/v1/webhook-endpoints", {
        data: { url: `https://${host()}/fail`, event_types: ["*"] },
        headers: { "Idempotency-Key": `e2e-hook-${Date.now()}` },
      }),
    );
    expect(created.secret).toMatch(/^whsec_/);
    try {
      expect((await client.post(`/api/v1/webhook-endpoints/${created.id}/test`)).status()).toBe(202);
      const page1 = await json<{ data: Delivery[] }>(
        await client.get(`/api/v1/webhook-endpoints/${created.id}/deliveries?status=dead`),
      );
      expect(page1.data[0]).toMatchObject({
        status: "dead",
        event_type: "webhook.test",
        last_status_code: 500,
      });
      const deadId = page1.data[0]!.id;
      // Delivered and pending ones can't be redelivered; a dead one can, once.
      const detail = await json<{ attempt_log: { status_code: number }[] }>(
        await client.get(`/api/v1/webhook-deliveries/${deadId}`),
      );
      expect(detail.attempt_log[0]?.status_code).toBe(500);

      await page.goto(`/settings/webhooks/${created.id}`);
      const row = page.getByTestId("webhook-delivery").first();
      await expect(row).toContainText("Failed");
      await expect(page.getByText(/1 failed attempt in a row/)).toBeVisible();

      // Fix the URL, then redeliver from the page.
      await json(
        await client.patch(`/api/v1/webhook-endpoints/${created.id}`, {
          data: { url: `https://${host()}/fixed` },
        }),
      );
      await page.reload();
      await page
        .getByTestId("webhook-delivery")
        .filter({ hasText: "Failed" })
        .getByRole("button", {
          name: "Redeliver",
        })
        .click();
      await expect(page.getByText("Redelivery queued")).toBeVisible();
      await expect(page.getByTestId("webhook-delivery").first()).toContainText("Delivered");

      const again = await client.post(`/api/v1/webhook-deliveries/${deadId}/redeliver`);
      expect(again.status()).toBe(409);
    } finally {
      await deleteEndpoint(client, created.id);
      await client.dispose();
    }
  });

  test("the API validates endpoints and keeps webhooks for owners and admins", async () => {
    const owner = await api("owner");
    const dispatcher = await api("dispatcher");
    try {
      await turnOn(owner);
      const http = await owner.post("/api/v1/webhook-endpoints", {
        data: { url: "http://hooks.example.com/x", event_types: ["*"] },
      });
      expect(http.status()).toBe(422);
      const none = await owner.post("/api/v1/webhook-endpoints", {
        data: { url: `https://${host()}/x`, event_types: [] },
      });
      expect(none.status()).toBe(422);
      const unknown = await owner.post("/api/v1/webhook-endpoints", {
        data: { url: `https://${host()}/x`, event_types: ["job.exploded"] },
      });
      expect(unknown.status()).toBe(422);
      expect((await owner.get("/api/v1/webhook-endpoints/ep_doesnotexist")).status()).toBe(404);
      expect((await owner.get("/api/v1/webhook-deliveries/dlv_doesnotexist")).status()).toBe(404);
      expect((await dispatcher.get("/api/v1/webhook-endpoints")).status()).toBe(403);
      expect((await dispatcher.get("/api/v1/webhook-settings")).status()).toBe(403);

      // The OpenAPI document lists the routes and every event.
      const doc = await json<{ paths: Record<string, unknown>; webhooks: Record<string, unknown> }>(
        await owner.get("/api/v1/openapi.json"),
      );
      expect(Object.keys(doc.paths)).toContain("/webhook-endpoints/{id}/deliveries");
      expect(Object.keys(doc.webhooks)).toEqual(expect.arrayContaining(["job.completed", "invoice.paid"]));
    } finally {
      await owner.dispose();
      await dispatcher.dispose();
    }
  });

  test("a dispatcher can't open the webhook settings", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: storageState("dispatcher") });
    const page = await ctx.newPage();
    const res = await page.goto("/settings/webhooks");
    expect(res?.status()).toBe(404);
    await ctx.close();
  });

  test("an unknown endpoint page is a 404", async ({ page }) => {
    expect((await page.goto("/settings/webhooks/ep_doesnotexist"))?.status()).toBe(404);
    expect((await page.goto("/settings/webhooks/not-an-id"))?.status()).toBe(404);
  });
});

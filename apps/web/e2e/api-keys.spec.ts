import { expect, request as playwrightRequest, test, type APIRequestContext } from "@playwright/test";
import { api, json, storageState, tokenOf } from "./fixtures";

// API keys (PLT-02), rate limits (PLT-04) and the MCP server (PLT-05, AI-05) end to end: a key is shown once, works as
// a bearer token within its scope, can't manage keys, drives the MCP tools, and stops working when revoked.

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? (process.env.CI ? "http://127.0.0.1:3000" : "http://localhost:3100");
const KEY = /^fo_[0-9A-Za-z]{40}$/;

const withKey = (key: string): Promise<APIRequestContext> =>
  playwrightRequest.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${key}` } });

const MCP_HEADERS = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };

async function mcp(client: APIRequestContext, id: number, method: string, params?: unknown) {
  const res = await client.post("/api/mcp", {
    headers: MCP_HEADERS,
    data: { jsonrpc: "2.0", id, method, params },
  });
  expect(res.status(), await res.text()).toBe(200);
  expect(res.headers()["ratelimit-limit"]).toBeTruthy();
  return (await res.json()) as { result?: Record<string, unknown>; error?: { message: string } };
}

type KeyDto = {
  id: string;
  name: string;
  prefix: string;
  key?: string;
  revoked_at: string | null;
  scopes: string[];
};

test.describe("API keys and the MCP server", () => {
  test.use({ storageState: storageState("owner") });

  // Earlier local runs may have left keys behind; an organization has at most 20 active ones.
  test.beforeAll(async () => {
    const owner = await api("owner");
    const keys = await json<{ data: KeyDto[] }>(await owner.get("/api/v1/api-keys"));
    for (const k of keys.data.filter((k) => k.name.startsWith("E2E") && !k.revoked_at)) {
      await owner.delete(`/api/v1/api-keys/${k.id}`);
    }
    await owner.dispose();
  });

  test("a read key is shown once, reads within its scope, drives MCP and stops working when revoked", async ({
    page,
  }) => {
    const name = `E2E read key ${Date.now()}`;
    await page.goto("/settings/api-keys");
    await page.getByRole("button", { name: "New API key" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill(name);
    await expect(dialog.getByRole("radio", { name: "Read only" })).toBeChecked();
    await dialog.getByRole("button", { name: "Create key" }).click();
    await expect(dialog.getByRole("heading", { name: "Copy your new key" })).toBeVisible();
    const key = await dialog.getByTestId("new-api-key").inputValue();
    expect(key).toMatch(KEY);
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();

    // The list shows the key by name and prefix only; the secret is gone for good.
    const row = page.getByTestId("api-key-row").filter({ hasText: name });
    await expect(row).toContainText(`${key.slice(0, 7)}…`);
    await expect(row).toContainText("Active");
    await expect(row).toContainText("Read");
    expect(await page.content()).not.toContain(key);
    await expect(page.getByTestId("mcp-url")).toContainText("/api/mcp");

    const client = await withKey(key);
    // Reads work, with the rate-limit headers.
    const jobs = await client.get("/api/v1/jobs?limit=1");
    expect(jobs.status()).toBe(200);
    const limit = Number(jobs.headers()["ratelimit-limit"]);
    expect(limit).toBeGreaterThan(0);
    expect(Number(jobs.headers()["ratelimit-remaining"])).toBeLessThan(limit);
    expect(Number(jobs.headers()["ratelimit-reset"])).toBeLessThanOrEqual(60);

    // Writes need the write scope.
    const write = await client.post("/api/v1/customers", { data: { name: "Should not exist" } });
    expect(write.status()).toBe(403);
    expect(write.headers()["www-authenticate"]).toContain('error="insufficient_scope"');
    expect((await write.json()).type).toBe("urn:fieldops:problem:insufficient-scope");

    // Keys never manage keys.
    const manage = await client.get("/api/v1/api-keys");
    expect(manage.status()).toBe(403);
    expect((await manage.json()).type).toBe("urn:fieldops:problem:session-required");

    // The MCP server: initialize, list the tools, call one.
    const init = await mcp(client, 1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "fieldops-e2e", version: "1.0.0" },
    });
    expect(init.result?.serverInfo).toMatchObject({ name: "fieldops" });
    const list = await mcp(client, 2, "tools/list");
    const tools = (list.result?.tools as { name: string; annotations?: { readOnlyHint?: boolean } }[]) ?? [];
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["search_jobs", "get_job", "list_sla_risks", "revenue_summary"]),
    );
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
    const call = await mcp(client, 3, "tools/call", {
      name: "search_jobs",
      arguments: { status: ["completed"] },
    });
    const content = (call.result?.content as { type: string; text: string }[])[0]!;
    const data = JSON.parse(content.text) as { count: number; jobs: { number: string; status: string }[] };
    expect(data.count).toBeGreaterThan(0);
    expect(data.jobs.every((j) => j.status === "completed")).toBe(true);
    const missing = await mcp(client, 4, "tools/call", {
      name: "get_job",
      arguments: { number: "JOB-999999" },
    });
    expect(missing.result?.isError).toBe(true);

    // The MCP server takes API keys only, not sessions.
    const session = await playwrightRequest.newContext({
      baseURL,
      extraHTTPHeaders: { Authorization: `Bearer ${tokenOf("owner")}` },
    });
    const bySession = await session.post("/api/mcp", {
      headers: MCP_HEADERS,
      data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(bySession.status()).toBe(401);
    await session.dispose();

    // Revoke in the UI: the key stops working at once.
    await row.getByRole("button", { name: `Revoke ${name}` }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Revoke key" }).click();
    await expect(page.getByRole("alertdialog")).toBeHidden();
    await expect(row).toContainText("Revoked");
    const after = await client.get("/api/v1/jobs?limit=1");
    expect(after.status()).toBe(401);
    expect(after.headers()["www-authenticate"]).toContain('error="invalid_token"');
    await client.dispose();
  });

  test("a write key creates records, and its changes are attributed to the key in the audit log", async ({
    page,
  }) => {
    const owner = await api("owner");
    const created = await owner.post("/api/v1/api-keys", {
      data: { name: `E2E write key ${Date.now()}`, scopes: ["write"], expires_in_days: 30 },
    });
    expect(created.status()).toBe(201);
    const key = (await created.json()) as KeyDto;
    expect(key.key).toMatch(KEY);
    expect(key.scopes).toEqual(["read", "write"]);

    const client = await withKey(key.key!);
    const customerName = `E2E API customer ${Date.now()}`;
    const customer = await client.post("/api/v1/customers", {
      data: { name: customerName },
      headers: { "User-Agent": "fieldops-e2e-integration" },
    });
    expect(customer.status(), await customer.text()).toBe(201);
    expect(customer.headers()["ratelimit-remaining"]).toBeTruthy();
    const customerId = ((await customer.json()) as { id: string }).id;
    await page.goto(`/settings/audit?entity_type=customer&entity_id=${customerId}`);
    await expect(page.getByText(`API key ${key.prefix}… · fieldops-e2e-integration`).first()).toBeVisible();

    // Revoking through the API (a session) works too and is immediate.
    const revoked = await owner.delete(`/api/v1/api-keys/${key.id}`);
    expect(((await json<KeyDto>(revoked)) as KeyDto).revoked_at).not.toBeNull();
    expect((await client.get("/api/v1/jobs?limit=1")).status()).toBe(401);
    await client.dispose();
    await owner.dispose();
  });

  test("dispatchers can't reach API keys", async () => {
    const dispatcher = await api("dispatcher");
    expect((await dispatcher.get("/api/v1/api-keys")).status()).toBe(403);
    await dispatcher.dispose();
  });
});

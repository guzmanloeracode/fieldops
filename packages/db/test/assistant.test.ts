import {
  assistant,
  assistantTools,
  type Actor,
  type ServiceContext,
  type TxRunner,
} from "@fieldops/core";
import type { AssistantToolName, AssistantToolRun } from "@fieldops/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteExpiredConversations } from "../src/repos/assistant";
import * as s from "../src/schema";
import { withStore } from "../src/store";
import { createOrgWithData, freshDatabase, type OrgData, type TestDb } from "./helpers";

// Ask FieldOps (AI-02) against PostgreSQL as the RLS role: conversations private to their user, the billing reads
// behind the revenue and customer tools, the 30-day retention, and the tools themselves through the real store
// (role filtering, the 50-row cap, tenant isolation).

let t: TestDb;
let a: OrgData;
let b: OrgData;
const NOW = new Date("2026-11-13T18:00:00Z");

type Who = "owner" | "dispatcher" | "tech" | "tech2";

function actor(org: OrgData, who: Who): Actor {
  return {
    userId: org.users[who],
    memberId: org.members[who],
    organizationId: org.orgId,
    role: who.startsWith("tech") ? "technician" : (who as "owner" | "dispatcher"),
    name: `${org.orgId.slice(0, 4)} ${who}`,
  };
}

const runFor =
  (org: OrgData, who: Who): TxRunner =>
  (fn) =>
    withStore(t.app, org.orgId, (store) =>
      fn({ actor: actor(org, who), store, now: NOW, demo: false } satisfies ServiceContext),
    );

/** Runs one tool through the binding as a member; returns the parsed result and the run. */
async function tool(org: OrgData, who: Who, name: AssistantToolName, input: unknown) {
  const runs: AssistantToolRun[] = [];
  const tools = assistantTools.bindAssistantTools(
    runFor(org, who),
    actor(org, who),
    { started: () => {}, finished: (_, r) => runs.push(r) },
    8,
  );
  const found = tools.find((x) => x.name === name);
  if (!found) return null;
  const data = assistantTools.unwrapToolResult(await found.execute(input))!;
  return { data, run: runs[0]! };
}

const nulls = {
  text: null,
  status: null,
  priority: null,
  technician: null,
  customer: null,
  service_type: null,
  date_field: null,
  from: null,
  to: null,
  sla: null,
  unassigned: null,
};

beforeAll(async () => {
  t = await freshDatabase();
  a = await createOrgWithData(t.owner, "a");
  b = await createOrgWithData(t.owner, "b");
  // Org a: more invoices around the one the helper made (sent, $25.00, issued 2026-11-10, $10.00 paid on 11-12).
  const inv = (
    number: string | null,
    status: string,
    total: number,
    paid: number,
    issue: string,
    due: string,
  ) => ({
    organizationId: a.orgId,
    number,
    customerId: a.ids.customer,
    jobId: a.ids.job,
    status,
    currency: "USD",
    totalMinor: total,
    amountPaidMinor: paid,
    issueDate: issue,
    dueDate: due,
  });
  await t.owner
    .update(s.invoice)
    .set({ amountPaidMinor: 1000 })
    .where(sql`organization_id = ${a.orgId}`);
  const [overdue] = await t.owner
    .insert(s.invoice)
    .values([
      inv("INV-2026-0002", "overdue", 9900, 0, "2026-10-01", "2026-10-15"),
      inv("INV-2026-0003", "void", 5000, 0, "2026-11-11", "2026-11-25"),
      inv(null, "draft", 7000, 0, "2026-11-11", "2026-11-25"),
      inv("INV-2026-0004", "paid", 4000, 4000, "2026-10-20", "2026-11-03"),
    ])
    .returning({ id: s.invoice.id });
  await t.owner.insert(s.payment).values({
    organizationId: a.orgId,
    invoiceId: overdue!.id,
    amountMinor: 300,
    currency: "USD",
    method: "cash",
    paidAt: new Date("2026-10-31T23:30:00Z"), // still October in Chicago, 1 November in UTC
  });
  // The job is at risk (resolution) and assigned to tech; 60 more open jobs make a search exceed the cap.
  await t.owner
    .update(s.job)
    .set({ slaResolutionState: "at_risk", resolutionDueAt: new Date("2026-11-13T22:00:00Z") })
    .where(sql`organization_id = ${a.orgId}`);
  await t.owner.insert(s.job).values(
    Array.from({ length: 60 }, (_, i) => ({
      organizationId: a.orgId,
      number: 100 + i,
      customerId: a.ids.customer,
      siteId: a.ids.site,
      title: `Filter swap ${i}`,
      status: "new",
    })),
  );
}, 120_000);
afterAll(async () => t?.close());

describe("conversations", () => {
  it("are private to their user and organization, newest first, and go with their messages", async () => {
    const c = await withStore(t.app, a.orgId, async (store) => {
      const c = await store.assistant.createConversation({ userId: a.users.owner, title: "Revenue" });
      await store.assistant.addMessage({
        conversationId: c.id,
        role: "user",
        content: "q1",
        tools: [],
        aiInteractionId: null,
      });
      await store.assistant.addMessage({
        conversationId: c.id,
        role: "assistant",
        content: "a1",
        tools: [{ name: "revenue_summary", summary: "Summed", count: 2, ok: true, refs: [] }],
        aiInteractionId: null,
      });
      await store.assistant.addMessage({
        conversationId: c.id,
        role: "user",
        content: "q2",
        tools: [],
        aiInteractionId: null,
      });
      return c;
    });
    await withStore(t.app, a.orgId, async (store) => {
      expect(await store.assistant.getConversation(c.id, a.users.dispatcher)).toBeNull();
      expect((await store.assistant.getConversation(c.id, a.users.owner))?.title).toBe("Revenue");
      const all = await store.assistant.listMessages(c.id);
      expect(all.map((m) => m.content)).toEqual(["q1", "a1", "q2"]);
      expect(all[1]!.tools).toEqual([expect.objectContaining({ name: "revenue_summary", count: 2 })]);
      expect((await store.assistant.listMessages(c.id, { last: 2 })).map((m) => m.content)).toEqual([
        "a1",
        "q2",
      ]);
      const before = (await store.assistant.getConversation(c.id, a.users.owner))!.updatedAt;
      await new Promise((r) => setTimeout(r, 5));
      await store.assistant.touchConversation(c.id);
      expect(
        (await store.assistant.getConversation(c.id, a.users.owner))!.updatedAt.getTime(),
      ).toBeGreaterThanOrEqual(before.getTime());
      const mine = await store.assistant.listConversations(a.users.owner, { since: new Date(0), limit: 10 });
      expect(mine.map((x) => x.id)).toEqual([c.id]);
      // The helper's conversation belongs to the dispatcher.
      expect(
        await store.assistant.listConversations(a.users.dispatcher, { since: new Date(0), limit: 10 }),
      ).toHaveLength(1);
      expect(
        await store.assistant.listConversations(a.users.owner, {
          since: new Date(Date.now() + 60_000),
          limit: 10,
        }),
      ).toEqual([]);
    });
    // Another organization sees nothing, even with the right user id.
    await withStore(t.app, b.orgId, async (store) => {
      expect(await store.assistant.getConversation(c.id, a.users.owner)).toBeNull();
      expect(await store.assistant.listMessages(c.id)).toEqual([]);
      expect(await store.assistant.deleteConversation(c.id, a.users.owner)).toBe(false);
    });
    await withStore(t.app, a.orgId, async (store) => {
      expect(await store.assistant.deleteConversation(c.id, a.users.dispatcher)).toBe(false);
      expect(await store.assistant.deleteConversation(c.id, a.users.owner)).toBe(true);
      expect(await store.assistant.listMessages(c.id)).toEqual([]);
    });
  });

  it("are deleted 30 days after their last use, in every organization", async () => {
    const old = new Date(Date.now() - 31 * 86_400_000);
    const [stale] = await t.owner
      .insert(s.assistantConversation)
      .values({
        organizationId: b.orgId,
        userId: b.users.owner,
        title: "Old",
        createdAt: old,
        updatedAt: old,
      })
      .returning();
    const [active] = await t.owner
      .insert(s.assistantConversation)
      .values({ organizationId: b.orgId, userId: b.users.owner, title: "Active" })
      .returning();
    await t.owner.insert(s.assistantMessage).values([
      { organizationId: b.orgId, conversationId: stale!.id, role: "user", content: "old", createdAt: old },
      {
        organizationId: b.orgId,
        conversationId: active!.id,
        role: "user",
        content: "old in active",
        createdAt: old,
      },
      { organizationId: b.orgId, conversationId: active!.id, role: "user", content: "new" },
    ]);
    const removed = await deleteExpiredConversations(t.owner);
    expect(removed.conversations).toBeGreaterThanOrEqual(1);
    expect(removed.messages).toBeGreaterThanOrEqual(2);
    await withStore(t.app, b.orgId, async (store) => {
      expect(await store.assistant.getConversation(stale!.id, b.users.owner)).toBeNull();
      expect((await store.assistant.listMessages(active!.id)).map((m) => m.content)).toEqual(["new"]);
    });
  });

  it("run a whole question through the services: saved, listed and private", async () => {
    const run = runFor(a, "dispatcher");
    const model = {
      provider: "fixture" as const,
      model: "test",
      async answer(input: {
        onText: (d: string) => void;
        tools: { name: string; execute: (i: unknown) => Promise<string> }[];
      }) {
        await input.tools.find((x) => x.name === "list_sla_risks")!.execute({ states: null, due_by: null });
        input.onText("One job is at risk.");
        const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };
        return {
          kind: "answer" as const,
          model: "test",
          usage,
          stopReason: "end_turn",
          latencyMs: 5,
          text: "One job is at risk.",
        };
      },
    };
    const session = await assistant.startAsk(
      run,
      model,
      { message: "At risk?" },
      { ip: null, limits: { perUserPerHour: 5, perVisitorPerDay: null, globalPerDay: 0 } },
    );
    const events: { type: string }[] = [];
    const result = await assistant.streamAnswer(run, model, session, (e) => events.push(e));
    expect(result.ok).toBe(true);
    expect(events.map((e) => e.type)).toEqual([
      "conversation",
      "tool_started",
      "tool_finished",
      "text",
      "done",
    ]);
    const detail = await run((ctx) => assistant.getConversation(ctx, session.conversationId));
    expect(detail.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(detail.messages[1]!.tools[0]).toMatchObject({ name: "list_sla_risks", count: 1 });
    const [logged] = (
      await t.owner.execute(
        sql`select feature, outcome from ai_interaction where id = ${result.interactionId}`,
      )
    ).rows;
    expect(logged).toEqual({ feature: "assistant", outcome: "drafted" });
    await expect(
      runFor(a, "owner")((ctx) => assistant.getConversation(ctx, session.conversationId)),
    ).rejects.toThrow("Conversation not found");
  });
});

describe("billing reads", () => {
  it("sums revenue the dashboard's way: issued and not void, payments by local date, open balances now", async () => {
    const r = await withStore(t.app, a.orgId, (store) =>
      store.assistant.revenue({
        from: "2026-10-01",
        to: "2026-11-30",
        timeZone: "America/Chicago",
        today: "2026-11-13",
        groupBy: null,
      }),
    );
    expect(r.currency).toBe("USD");
    expect(r.totals).toEqual({
      invoicedMinor: 2500 + 9900 + 4000,
      invoiceCount: 3,
      collectedMinor: 1000 + 300,
      paymentCount: 2,
      outstandingMinor: 1500 + 9900,
      overdueMinor: 9900,
      openInvoiceCount: 2,
    });
    expect(r.rows).toEqual([]);
  });

  it("breaks revenue down by month in the organization's time zone and by service type", async () => {
    const byMonth = await withStore(t.app, a.orgId, (store) =>
      store.assistant.revenue({
        from: "2026-10-01",
        to: "2026-11-30",
        timeZone: "America/Chicago",
        today: "2026-11-13",
        groupBy: "month",
      }),
    );
    expect(byMonth.rows).toEqual([
      { key: "2026-10", label: "2026-10", invoicedMinor: 13900, collectedMinor: 300 },
      { key: "2026-11", label: "2026-11", invoicedMinor: 2500, collectedMinor: 1000 },
    ]);
    const byType = await withStore(t.app, a.orgId, (store) =>
      store.assistant.revenue({
        from: "2026-10-01",
        to: "2026-11-30",
        timeZone: "America/Chicago",
        today: "2026-11-13",
        groupBy: "service_type",
      }),
    );
    expect(byType.rows).toEqual([
      { key: a.ids.serviceType, label: "AC repair", invoicedMinor: 16400, collectedMinor: 1300 },
    ]);
    // Another organization's revenue doesn't include these invoices.
    const other = await withStore(t.app, b.orgId, (store) =>
      store.assistant.revenue({
        from: "2026-10-01",
        to: "2026-11-30",
        timeZone: "America/Chicago",
        today: "2026-11-13",
        groupBy: null,
      }),
    );
    expect(other.totals.invoicedMinor).toBe(2500);
  });

  it("lists a customer's open invoices with their balance, oldest due first", async () => {
    const rows = await withStore(t.app, a.orgId, (store) => store.assistant.openInvoices(a.ids.customer, 10));
    expect(rows.map((r) => [r.number, r.status, r.balanceMinor, r.dueDate])).toEqual([
      ["INV-2026-0002", "overdue", 9900, "2026-10-15"],
      ["INV-2026-0001", "sent", 1500, "2026-11-24"],
    ]);
    expect(
      await withStore(t.app, b.orgId, (store) => store.assistant.openInvoices(a.ids.customer, 10)),
    ).toEqual([]);
  });
});

describe("tools on the real store", () => {
  it("cap results at 50 rows and report the total", async () => {
    const r = (await tool(a, "dispatcher", "search_jobs", nulls))!;
    expect(r.data.total).toBe(61);
    expect(r.data.shown).toBe(50);
    expect(r.run).toMatchObject({ count: 61, summary: "Looked up 61 jobs" });
    expect(r.run.refs).toHaveLength(50);
  });

  it("keep technicians to their own jobs", async () => {
    const mine = (await tool(a, "tech", "search_jobs", nulls))!;
    expect((mine.data.jobs as { number: string }[]).map((j) => j.number)).toEqual(["JOB-000001"]);
    const other = (await tool(a, "tech2", "search_jobs", nulls))!;
    expect(other.data.total).toBe(0);
    const risks = (await tool(a, "tech2", "list_sla_risks", { states: null, due_by: null }))!;
    expect(risks.data.total).toBe(0);
    const job = (await tool(a, "tech2", "get_job", { number: "JOB-000001" }))!;
    expect(job.data).toEqual({ error: "Job not found" });
    const customer = (await tool(a, "tech", "customer_history", { customer: "Customer a" }))!;
    expect(customer.data).toMatchObject({ stats: null, open_invoices: null });
    expect(await tool(a, "tech", "revenue_summary", { from: null, to: null, group_by: null })).toBeNull();
    expect(await tool(a, "tech", "pending_approvals", { job: null })).toBeNull();
  });

  it("find SLA risks, workloads, customer history and approvals for the office", async () => {
    const risks = (await tool(a, "dispatcher", "list_sla_risks", {
      states: ["at_risk"],
      due_by: "2026-11-13",
    }))!;
    expect(risks.data.jobs).toEqual([
      expect.objectContaining({
        number: "JOB-000001",
        target: "resolution",
        state: "at_risk",
        due: "2026-11-13 16:00",
      }),
    ]);
    const workload = (await tool(a, "dispatcher", "technician_workload", {
      from: "2026-11-11",
      to: null,
      part_of_day: null,
      technician: null,
    }))!;
    const rows = workload.data.technicians as { name: string; scheduled_min: number }[];
    expect(rows.map((r) => r.scheduled_min).sort()).toEqual([0, 120]);
    const history = (await tool(a, "dispatcher", "customer_history", { customer: "customer a" }))!;
    expect(history.data).toMatchObject({
      customer: { name: "Customer a" },
      equipment: [expect.objectContaining({ type: "Split AC" })],
      open_invoices: [
        expect.objectContaining({ number: "INV-2026-0002", balance: "$99.00" }),
        expect.objectContaining({ number: "INV-2026-0001", balance: "$15.00" }),
      ],
    });
    const approvals = (await tool(a, "dispatcher", "pending_approvals", { job: null }))!;
    expect(approvals.data).toMatchObject({
      total: 1,
      requests: [expect.objectContaining({ item: "Drain pump", amount: "$45.00", job: "JOB-000001" })],
    });
    const revenue = (await tool(a, "owner", "revenue_summary", {
      from: "2026-11-01",
      to: "2026-11-30",
      group_by: null,
    }))!;
    expect(revenue.data).toMatchObject({
      invoiced: "$25.00",
      collected: "$10.00",
      outstanding_now: "$114.00",
    });
  });

  it("never reach another organization's records", async () => {
    const r = (await tool(b, "dispatcher", "search_jobs", { ...nulls, text: "Filter swap" }))!;
    expect(r.data.total).toBe(0);
    const c = (await tool(b, "dispatcher", "customer_history", { customer: "Customer a" }))!;
    expect(c.data.notes).toEqual(['No customer matches "Customer a"']);
  });
});

import { sla, type Store } from "@fieldops/core";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "../src/schema";
import { withStore } from "../src/store";
import { createOrgWithData, freshDatabase, type OrgData, type TestDb } from "./helpers";

// SLA policies and the monitor against PostgreSQL (SLA-01, SLA-03).

let t: TestDb;
let a: OrgData;
let b: OrgData;
const at = (iso: string) => new Date(iso);
const runIn = <T>(org: OrgData, fn: (store: Store) => Promise<T>) => withStore(t.app, org.orgId, fn);

async function job(org: OrgData, values: Partial<typeof s.job.$inferInsert>) {
  const id = randomUUID();
  const n = await t.owner.execute<{ n: number }>(
    sql`select coalesce(max(number), 0)::int + 1 as n from job where organization_id = ${org.orgId}`,
  );
  await t.owner.insert(s.job).values({
    id,
    organizationId: org.orgId,
    number: n.rows[0]!.n,
    customerId: org.ids.customer,
    siteId: org.ids.site,
    title: `SLA ${n.rows[0]!.n}`,
    status: "new",
    ...values,
  });
  return id;
}

async function states(id: string) {
  const r = await t.owner.execute<{ response: string | null; resolution: string | null }>(
    sql`select sla_response_state as response, sla_resolution_state as resolution from job where id = ${id}`,
  );
  return r.rows[0];
}

beforeAll(async () => {
  t = await freshDatabase();
  a = await createOrgWithData(t.owner, "a");
  b = await createOrgWithData(t.owner, "b");
  // The helper's own jobs have no deadlines; keep them out of the way.
  await t.owner.execute(sql`delete from sla_alert`);
});
afterAll(async () => t?.close());

describe("SLA policies", () => {
  it("inserts and then replaces the policy of each priority", async () => {
    const first = await runIn(a, (st) =>
      st.sla.savePolicies([
        { priority: "urgent", responseMin: 60, resolutionMin: 240, businessHours: false },
        { priority: "low", responseMin: 600, resolutionMin: 6000, businessHours: true },
      ]),
    );
    expect(first).toHaveLength(2);
    await runIn(a, (st) =>
      st.sla.savePolicies([{ priority: "urgent", responseMin: 30, resolutionMin: 120, businessHours: true }]),
    );
    const list = await runIn(a, (st) => st.sla.listPolicies());
    expect(list.map((p) => [p.priority, p.responseMin, p.resolutionMin, p.businessHours]).sort()).toEqual([
      ["low", 600, 6000, true],
      ["normal", 1440, 10080, false], // from the helper
      ["urgent", 30, 120, true],
    ]);
    expect(list.find((p) => p.priority === "urgent")!.id).toBe(
      first.find((p) => p.priority === "urgent")!.id,
    );
    expect(await runIn(a, (st) => st.sla.savePolicies([]))).toEqual([]);
    expect((await runIn(b, (st) => st.sla.listPolicies())).map((p) => p.priority)).toEqual(["normal"]);
  });
});

describe("SLA monitor", () => {
  let early: string;
  let late: string;
  let scheduled: string;
  let done: string;
  let other: string;

  beforeAll(async () => {
    const deadlines = {
      responseAtRiskAt: at("2026-03-01T09:00:00Z"),
      responseDueAt: at("2026-03-01T10:00:00Z"),
      resolutionAtRiskAt: at("2026-03-02T09:00:00Z"),
      resolutionDueAt: at("2026-03-02T10:00:00Z"),
      slaResponseState: "on_track",
      slaResolutionState: "on_track",
    } as const;
    early = await job(a, { ...deadlines, title: "Early" });
    late = await job(a, {
      ...deadlines,
      title: "Late",
      responseAtRiskAt: at("2026-03-01T11:00:00Z"),
      responseDueAt: at("2026-03-01T12:00:00Z"),
    });
    scheduled = await job(a, {
      ...deadlines,
      title: "Scheduled",
      status: "scheduled",
      firstScheduledAt: at("2026-03-01T08:00:00Z"),
      slaResponseState: "met",
    });
    done = await job(a, { ...deadlines, title: "Done", status: "completed", slaResolutionState: "met" });
    other = await job(b, { ...deadlines, title: "Other org" });
  });

  it("moves open targets along their deadlines and leaves decided ones alone", async () => {
    expect(await runIn(a, (st) => st.sla.advanceStates(at("2026-03-01T08:00:00Z")))).toBe(0);
    expect(await runIn(a, (st) => st.sla.advanceStates(at("2026-03-01T09:30:00Z")))).toBe(1);
    expect(await states(early)).toEqual({ response: "at_risk", resolution: "on_track" });
    expect(await states(late)).toEqual({ response: "on_track", resolution: "on_track" });
    expect(await runIn(a, (st) => st.sla.advanceStates(at("2026-03-01T10:30:00Z")))).toBe(1);
    expect(await states(early)).toEqual({ response: "breached", resolution: "on_track" });
    expect(await states(scheduled)).toEqual({ response: "met", resolution: "on_track" });
    expect(await states(done)).toEqual({ response: "on_track", resolution: "met" });
    expect(await states(other)).toEqual({ response: "on_track", resolution: "on_track" });
  });

  it("raises each alert once and notifies through the core monitor", async () => {
    const run = (now: string) =>
      withStore(t.app, a.orgId, (store) => sla.monitorSla({ store, now: at(now) }));
    // early: response breached; scheduled: no response alert (decided); resolution still on track everywhere.
    expect(await run("2026-03-01T10:30:00Z")).toEqual({ updated: 0, alerts: 1 });
    expect(await run("2026-03-01T10:30:00Z")).toEqual({ updated: 0, alerts: 0 });
    // Late turns at risk, then everything's resolution goes past due.
    expect(await run("2026-03-01T11:30:00Z")).toEqual({ updated: 1, alerts: 1 });
    expect(await run("2026-03-02T10:30:00Z")).toEqual({ updated: 3, alerts: 4 });
    const alerts = await t.owner.execute<{ title: string; target: string; kind: string }>(sql`
      select j.title, a.target, a.kind from sla_alert a join job j on j.id = a.job_id
       order by j.title, a.target, a.kind`);
    expect(alerts.rows.map((r) => `${r.title}:${r.target}:${r.kind}`)).toEqual([
      "Early:resolution:breached",
      "Early:response:breached",
      "Late:resolution:breached",
      "Late:response:at_risk",
      "Late:response:breached",
      "Scheduled:resolution:breached",
    ]);
    const notes = await t.owner.execute<{ type: string; n: number }>(sql`
      select type, count(*)::int as n from notification
       where organization_id = ${a.orgId} and type like 'sla_%' group by type order by type`);
    // At risk → the dispatcher; breached → the dispatcher and the owner.
    expect(notes.rows).toEqual([
      { type: "sla_at_risk", n: 1 },
      { type: "sla_breached", n: 10 },
    ]);
    const payload = await t.owner.execute<{ payload: Record<string, unknown> }>(sql`
      select payload from notification where type = 'sla_at_risk' and organization_id = ${a.orgId}`);
    expect(payload.rows[0]!.payload).toMatchObject({
      job_id: late,
      job_title: "Late",
      customer_name: "Customer a",
      target: "response",
      due_at: "2026-03-01T12:00:00.000Z",
    });
    expect(
      (await t.owner.execute(sql`select 1 from sla_alert where organization_id = ${b.orgId}`)).rows,
    ).toHaveLength(0);
  });
});

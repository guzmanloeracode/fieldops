import pg from "pg";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { quiet, withTenant } from "../src/client";
import { withStore } from "../src/store";
import { createOrgWithData, freshDatabase, pgErrorOf, type OrgData, type TestDb } from "./helpers";

// Release 0.3 foundation: the audit trigger (AUD-01, AUD-02, ADR 016) and live events (NOT-05, ADR 011).

let t: TestDb;
let a: OrgData;

const ctx = () => ({ userId: a.users.dispatcher, ip: "203.0.113.7", userAgent: "vitest" });

beforeAll(async () => {
  t = await freshDatabase();
  a = await createOrgWithData(t.owner, "a");
});
afterAll(async () => t?.close());

async function auditRows(entityId: string) {
  const r = await t.owner.execute<{
    action: string;
    actor_user_id: string | null;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    ip: string | null;
    user_agent: string | null;
  }>(
    sql`select action, actor_user_id, before, after, ip, user_agent from audit_log
        where entity_id = ${entityId} order by created_at, id`,
  );
  return r.rows;
}

describe("audit trigger", () => {
  it("logs inserts from the seed-like owner writes as system changes", async () => {
    const rows = await auditRows(a.ids.customer);
    expect(rows[0]).toMatchObject({ action: "customer.insert", actor_user_id: null, before: null });
    expect(rows[0]!.after).toMatchObject({ name: "Customer a" });
  });

  it("logs an update with only the changed columns, the actor, IP and user agent", async () => {
    await withTenant(
      t.app,
      a.orgId,
      (tx) =>
        tx.execute(
          sql`update customer set name = 'Renamed', updated_at = now() where id = ${a.ids.customer}`,
        ),
      ctx(),
    );
    const last = (await auditRows(a.ids.customer)).at(-1);
    expect(last).toEqual({
      action: "customer.update",
      actor_user_id: a.users.dispatcher,
      before: { name: "Customer a" },
      after: { name: "Renamed" },
      ip: "203.0.113.7",
      user_agent: "vitest",
    });
  });

  it("writes nothing when the change rolls back (same transaction, AUD-02)", async () => {
    const before = (await auditRows(a.ids.site)).length;
    await expect(
      withTenant(
        t.app,
        a.orgId,
        async (tx) => {
          await tx.execute(sql`update site set label = 'Rolled back' where id = ${a.ids.site}`);
          throw new Error("boom");
        },
        ctx(),
      ),
    ).rejects.toThrow("boom");
    expect(await auditRows(a.ids.site)).toHaveLength(before);
  });

  it("skips updates that only touch ignored columns, and logs soft deletes as deletes", async () => {
    const before = (await auditRows(a.ids.job)).length;
    await withTenant(
      t.app,
      a.orgId,
      (tx) =>
        tx.execute(
          sql`update job set version = version + 1, updated_at = now(), sla_response_state = 'at_risk' where id = ${a.ids.job}`,
        ),
      ctx(),
    );
    expect(await auditRows(a.ids.job)).toHaveLength(before);
    await withTenant(
      t.app,
      a.orgId,
      (tx) => tx.execute(sql`update equipment set deleted_at = now() where id = ${a.ids.equipment}`),
      ctx(),
    );
    expect((await auditRows(a.ids.equipment)).at(-1)?.action).toBe("equipment.delete");
  });

  it("is off in quiet transactions (seed, reset)", async () => {
    const before = (await auditRows(a.ids.note)).length;
    await withTenant(t.app, a.orgId, async (tx) => {
      await quiet(tx);
      await tx.execute(sql`update note set body = 'quiet' where id = ${a.ids.note}`);
    });
    expect(await auditRows(a.ids.note)).toHaveLength(before);
  });

  it("records events that aren't row changes through audit_event()", async () => {
    await withStore(
      t.app,
      a.orgId,
      (store) => store.audit.record({ action: "auth.sign_in", entityType: "user", entityId: a.users.owner }),
      { userId: a.users.owner, ip: "198.51.100.1", userAgent: "Firefox" },
    );
    expect(await auditRows(a.users.owner)).toEqual([
      {
        action: "auth.sign_in",
        actor_user_id: a.users.owner,
        before: null,
        after: null,
        ip: "198.51.100.1",
        user_agent: "Firefox",
      },
    ]);
    expect(await pgErrorOf(t.app.execute(sql`select audit_event('x', 'user', null, null)`))).toMatch(
      /audit_event needs app.org_id/,
    );
  });

  it("is append-only for the runtime role", async () => {
    const write = (q: ReturnType<typeof sql>) => pgErrorOf(withTenant(t.app, a.orgId, (tx) => tx.execute(q)));
    expect(await write(sql`update audit_log set action = 'forged'`)).toMatch(/permission denied/);
    expect(await write(sql`delete from audit_log`)).toMatch(/permission denied/);
    expect(
      await write(
        sql`insert into audit_log (organization_id, action, entity_type) values (${a.orgId}, 'forged', 'x')`,
      ),
    ).toMatch(/permission denied/);
    const n = await withTenant(t.app, a.orgId, (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from audit_log`),
    );
    expect(n.rows[0]!.n).toBeGreaterThan(0);
  });
});

describe("live events", () => {
  async function listen() {
    const client = new pg.Client({ connectionString: t.ownerUrl });
    await client.connect();
    const messages: Record<string, string | null>[] = [];
    client.on("notification", (m) => messages.push(JSON.parse(m.payload ?? "{}")));
    await client.query("listen fieldops_live");
    return { messages, close: () => client.end() };
  }
  const settle = () => new Promise((r) => setTimeout(r, 200));

  it("publishes job changes and new notifications on commit, not on rollback", async () => {
    const l = await listen();
    try {
      await withTenant(t.app, a.orgId, (tx) =>
        tx.execute(sql`update job set title = 'Live' where id = ${a.ids.job}`),
      );
      await withTenant(t.app, a.orgId, async (tx) => {
        await tx.execute(sql`update job set title = 'Never' where id = ${a.ids.job}`);
        throw new Error("roll back");
      }).catch(() => undefined);
      await withTenant(t.app, a.orgId, (tx) =>
        tx.execute(
          sql`insert into notification (organization_id, user_id, type) values (${a.orgId}, ${a.users.tech}, 'job_assigned')`,
        ),
      );
      await settle();
      expect(l.messages).toEqual([
        { org: a.orgId, kind: "job", id: a.ids.job, user: null },
        expect.objectContaining({ org: a.orgId, kind: "notification", user: a.users.tech }),
      ]);
    } finally {
      await l.close();
    }
  });
});

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/client";
import { TENANT_TABLES } from "../src/schema";
import { withStore } from "../src/store";
import { createOrgWithData, freshDatabase, pgErrorOf, type OrgData, type TestDb } from "./helpers";

// AUTH-05 acceptance: a user in organization B can never reach organization A's records, through the
// application's tenant-scoped repositories (first line) or through row-level security (second line).

let t: TestDb;
let a: OrgData;
let b: OrgData;

beforeAll(async () => {
  t = await freshDatabase();
  a = await createOrgWithData(t.owner, "a");
  b = await createOrgWithData(t.owner, "b");
});
afterAll(async () => t?.close());

describe("repositories scoped to organization B", () => {
  it("can't read any of organization A's records by id", async () => {
    await withStore(t.app, b.orgId, async (store) => {
      expect(await store.customers.get(a.ids.customer)).toBeNull();
      expect(await store.customers.contacts(a.ids.customer)).toEqual([]);
      expect(await store.customers.isLinkedToMember(a.ids.customer, a.members.tech)).toBe(false);
      expect(await store.customers.stats(a.ids.customer)).toMatchObject({ jobCount: 0 });
      expect(await store.customers.findDuplicates({ emails: ["c-a@example.com"], phones: [] })).toEqual([]);
      expect(await store.sites.get(a.ids.site)).toBeNull();
      expect(await store.sites.listByCustomer(a.ids.customer)).toEqual([]);
      expect(await store.sites.isLinkedToMember(a.ids.site, a.members.tech)).toBe(false);
      expect(await store.equipment.get(a.ids.equipment)).toBeNull();
      expect(await store.equipment.listBySite(a.ids.site)).toEqual([]);
      expect(await store.serviceTypes.get(a.ids.serviceType)).toBeNull();
      expect(await store.jobs.get(a.ids.job)).toBeNull();
      expect(await store.jobs.events(a.ids.job)).toEqual([]);
      expect(await store.jobs.missingRequiredChecklistItems(a.ids.job)).toEqual([]);
      expect(
        await store.jobs.overlapping(
          a.members.tech,
          new Date("2026-11-11T00:00:00Z"),
          new Date("2026-11-12T00:00:00Z"),
          b.ids.job,
        ),
      ).toEqual([]);
      expect(await store.notes.list(a.ids.job)).toEqual([]);
      expect(await store.attachments.get(a.ids.attachment)).toBeNull();
      expect(await store.attachments.list(a.ids.job)).toEqual([]);
      expect(await store.members.get(a.members.owner)).toBeNull();
    });
  });

  it("lists only organization B's records", async () => {
    await withStore(t.app, b.orgId, async (store) => {
      const jobs = await store.jobs.list({ sort: "-created_at", limit: 50, page: 1 });
      expect(jobs.rows.map((j) => j.id)).toEqual([b.ids.job]);
      expect(jobs.total).toBe(1);
      expect((await store.jobs.list({ sort: "-created_at", limit: 50, q: "Job a" })).rows).toEqual([]);
      const customers = await store.customers.list({ sort: "name", limit: 50 });
      expect(customers.rows.map((c) => c.id)).toEqual([b.ids.customer]);
      expect((await store.serviceTypes.list()).map((s) => s.id)).toEqual([b.ids.serviceType]);
      expect((await store.members.list()).every((m) => Object.values(b.members).includes(m.id))).toBe(true);
      expect((await store.organization.get()).id).toBe(b.orgId);
    });
  });

  it("can't change organization A's records", async () => {
    await withStore(t.app, b.orgId, async (store) => {
      expect(await store.customers.update(a.ids.customer, { name: "hijacked" })).toBeNull();
      expect(await store.customers.softDelete(a.ids.customer)).toBe(false);
      expect(await store.sites.update(a.ids.site, { label: "hijacked" })).toBeNull();
      expect(await store.serviceTypes.update(a.ids.serviceType, { name: "hijacked" })).toBeNull();
      expect(await store.jobs.update(a.ids.job, { title: "hijacked" })).toBeNull();
      expect(await store.jobs.softDelete(a.ids.job)).toBe(false);
      expect(await store.attachments.markReady(a.ids.attachment)).toBeNull();
      expect(await store.attachments.remove(a.ids.attachment)).toBe(false);
      await store.members.updateRole(a.members.tech, "owner");
      await store.members.remove(a.members.dispatcher);
    });
    const [job] = await t.owner
      .execute<{ title: string; deleted_at: Date | null }>(
        sql`select title, deleted_at from job where id = ${a.ids.job}`,
      )
      .then((r) => r.rows);
    expect(job).toEqual({ title: "Job a", deleted_at: null });
    const roles = await t.owner.execute<{ role: string }>(
      sql`select role from member where organization_id = ${a.orgId} order by role`,
    );
    expect(roles.rows.map((r) => r.role)).toEqual(["dispatcher", "owner", "technician", "technician"]);
  });
});

describe("row-level security for fieldops_app", () => {
  for (const table of TENANT_TABLES) {
    it(`${table}: only the organization in app.org_id is visible`, async () => {
      const rows = await withTenant(t.app, a.orgId, (tx) =>
        tx.execute<{ organization_id: string }>(sql`select organization_id from ${sql.identifier(table)}`),
      );
      expect(rows.rows.length).toBeGreaterThan(0);
      expect(new Set(rows.rows.map((r) => r.organization_id))).toEqual(new Set([a.orgId]));
    });

    it(`${table}: nothing is visible without app.org_id`, async () => {
      const rows = await t.app.execute(sql`select 1 from ${sql.identifier(table)}`);
      expect(rows.rows).toHaveLength(0);
    });
  }

  it("rejects writing a row for another organization (WITH CHECK)", async () => {
    expect(
      await pgErrorOf(
        withTenant(t.app, a.orgId, (tx) =>
          tx.execute(sql`insert into customer (organization_id, name) values (${b.orgId}, 'sneaky')`),
        ),
      ),
    ).toMatch(/42501 new row violates row-level security policy/);
    expect(
      await pgErrorOf(
        withTenant(t.app, a.orgId, (tx) =>
          tx.execute(sql`update customer set organization_id = ${b.orgId} where id = ${a.ids.customer}`),
        ),
      ),
    ).toMatch(/row-level security/);
    expect(
      await pgErrorOf(
        t.app.execute(sql`insert into customer (organization_id, name) values (${a.orgId}, 'no tenant')`),
      ),
    ).toMatch(/row-level security/);
  });

  it("can't update or delete another organization's rows even by id", async () => {
    const res = await withTenant(t.app, a.orgId, async (tx) => {
      const u = await tx.execute(sql`update job set title = 'x' where id = ${b.ids.job}`);
      const d = await tx.execute(sql`delete from note where id = ${b.ids.note}`);
      return [u.rowCount, d.rowCount];
    });
    expect(res).toEqual([0, 0]);
  });

  it("scopes app.org_id to the transaction", async () => {
    await withTenant(t.app, a.orgId, async () => undefined);
    const client = await t.appPool.connect();
    try {
      // A pooled connection reused after the transaction must not keep the previous tenant.
      const r = await client.query("select count(*)::int as n from customer");
      expect(r.rows[0].n).toBe(0);
    } finally {
      client.release();
    }
  });

  it("does not let fieldops_app bypass RLS", async () => {
    const r = await t.app.execute<{ rolbypassrls: boolean; rolsuper: boolean }>(
      sql`select rolbypassrls, rolsuper from pg_roles where rolname = current_user`,
    );
    expect(r.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
  });
});

describe("schema guard", () => {
  it("every table with organization_id is a tenant table with RLS and the tenant_isolation policy", async () => {
    const withOrgColumn = await t.owner.execute<{ table_name: string }>(sql`
      select c.table_name from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and c.column_name = 'organization_id' and t.table_type = 'BASE TABLE'
      order by 1`);
    // Tables whose organization_id is intentionally not tenant-isolated by RLS.
    const exempt = new Set([
      "member", // Better Auth reads memberships across organizations to resolve the active one
      "invitation", // read by email before the invitee belongs to the organization
      "email_outbox", // system table written before an organization exists (sign-up, password reset)
    ]);
    const tenantTables = withOrgColumn.rows.map((r) => r.table_name).filter((n) => !exempt.has(n));
    expect(tenantTables.sort()).toEqual([...TENANT_TABLES].sort());

    const rls = await t.owner.execute<{ relname: string; relrowsecurity: boolean; policies: string[] }>(sql`
      select c.relname, c.relrowsecurity,
        coalesce(array_agg(p.polname) filter (where p.polname is not null), '{}') as policies
      from pg_class c
      left join pg_policy p on p.polrelid = c.oid
      where c.relnamespace = 'public'::regnamespace and c.relname = any(${sql.raw(`array[${TENANT_TABLES.map((n) => `'${n}'`).join(",")}]`)})
      group by c.relname, c.relrowsecurity order by 1`);
    for (const row of rls.rows) {
      expect(row, row.relname).toMatchObject({ relrowsecurity: true });
      expect(row.policies, row.relname).toContain("tenant_isolation");
    }
    expect(rls.rows).toHaveLength(TENANT_TABLES.length);
  });

  it("every tenant table's indexes lead with organization_id", async () => {
    const idx = await t.owner.execute<{ table: string; index: string; first_col: string }>(sql`
      select t.relname as table, i.relname as index, a.attname as first_col
      from pg_index x
      join pg_class i on i.oid = x.indexrelid
      join pg_class t on t.oid = x.indrelid
      join pg_attribute a on a.attrelid = t.oid and a.attnum = x.indkey[0]
      where t.relnamespace = 'public'::regnamespace and not x.indisprimary`);
    const tenant = new Set<string>(TENANT_TABLES);
    // Trigram search indexes cover one text column and can't lead with organization_id. Two 0.5 indexes serve
    // lookups made before an organization is known: an API key by its hash, and the worker's queue of pending
    // outbox events across organizations.
    const global = new Set(["api_key_token_hash_uq", "outbox_event_pending_idx"]);
    const offenders = idx.rows.filter(
      (r) =>
        tenant.has(r.table) &&
        r.first_col !== "organization_id" &&
        !r.index.endsWith("_trgm_idx") &&
        !global.has(r.index),
    );
    expect(offenders).toEqual([]);
  });
});

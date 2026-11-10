import { randomUUID } from "node:crypto";
import pg from "pg";
import { inject } from "vitest";
import { createDb, type Database } from "../src/client";
import * as s from "../src/schema";

/** A fresh database copied from the migrated template, with owner and fieldops_app connections. */
export async function freshDatabase() {
  const cfg = inject("pg");
  const name = `t_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const admin = new pg.Client({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: "postgres",
  });
  await admin.connect();
  for (let attempt = 0; ; attempt++) {
    try {
      await admin.query(`CREATE DATABASE ${name} TEMPLATE ${cfg.template}`);
      break;
    } catch (err) {
      // Parallel CREATE DATABASE from the same template can collide; retry briefly.
      if (attempt > 20 || !String(err).includes("being accessed by other users")) throw err;
      await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));
    }
  }
  await admin.end();
  const base = `postgres://%s@${cfg.host}:${cfg.port}/${name}`;
  const ownerUrl = base.replace("%s", `${cfg.user}:${cfg.password}`);
  const appUrl = base.replace("%s", `fieldops_app:${cfg.appPassword}`);
  const owner = createDb(ownerUrl, { max: 5, application: "test-owner" });
  const app = createDb(appUrl, { max: 5, application: "test-app" });
  return {
    name,
    ownerUrl,
    appUrl,
    owner: owner.db,
    ownerPool: owner.pool,
    app: app.db,
    appPool: app.pool,
    async close() {
      await Promise.all([owner.pool.end(), app.pool.end()]);
    },
  };
}

export type TestDb = Awaited<ReturnType<typeof freshDatabase>>;

const id = (): string => randomUUID();

/**
 * Creates an organization with members and one row in every tenant table, written as the owner (bypassing
 * RLS). Returns the ids so tests can try to reach them from another organization.
 */
export async function createOrgWithData(db: Database, label: string) {
  const orgId = id();
  await db.insert(s.organization).values({
    id: orgId,
    name: `Org ${label}`,
    slug: `org-${label}-${orgId.slice(0, 6)}`,
    timezone: "America/Chicago",
  });
  const users = { owner: id(), dispatcher: id(), tech: id(), tech2: id() };
  const members = { owner: id(), dispatcher: id(), tech: id(), tech2: id() };
  for (const role of ["owner", "dispatcher", "tech", "tech2"] as const) {
    await db.insert(s.user).values({
      id: users[role],
      name: `${label} ${role}`,
      email: `${role}.${orgId}@example.com`,
      emailVerified: true,
    });
    await db.insert(s.member).values({
      id: members[role],
      organizationId: orgId,
      userId: users[role],
      role: role.startsWith("tech") ? "technician" : role,
    });
  }
  const ids = {
    serviceType: id(),
    customer: id(),
    contact: id(),
    site: id(),
    equipment: id(),
    job: id(),
    assignment: id(),
    checklist: id(),
    event: id(),
    note: id(),
    attachment: id(),
  };
  await db.insert(s.orgCounter).values({ organizationId: orgId, name: "job", value: 1 });
  await db
    .insert(s.serviceType)
    .values({ id: ids.serviceType, organizationId: orgId, name: "AC repair", currency: "USD" });
  await db.insert(s.customer).values({ id: ids.customer, organizationId: orgId, name: `Customer ${label}` });
  await db.insert(s.contact).values({
    id: ids.contact,
    organizationId: orgId,
    customerId: ids.customer,
    name: "Contact",
    email: `c-${label}@example.com`,
    emailNorm: `c-${label}@example.com`,
    phone: "(512) 555-0100",
    phoneNorm: "15125550100",
    isPrimary: true,
  });
  await db.insert(s.site).values({
    id: ids.site,
    organizationId: orgId,
    customerId: ids.customer,
    label: "Home",
    line1: "1 Main",
    city: "Austin",
    country: "US",
  });
  await db
    .insert(s.equipment)
    .values({ id: ids.equipment, organizationId: orgId, siteId: ids.site, type: "Split AC" });
  await db.insert(s.job).values({
    id: ids.job,
    organizationId: orgId,
    number: 1,
    customerId: ids.customer,
    siteId: ids.site,
    equipmentId: ids.equipment,
    serviceTypeId: ids.serviceType,
    title: `Job ${label}`,
    status: "scheduled",
    scheduledStart: new Date("2026-11-11T15:00:00Z"),
    scheduledEnd: new Date("2026-11-11T17:00:00Z"),
  });
  await db.insert(s.jobAssignment).values({
    id: ids.assignment,
    organizationId: orgId,
    jobId: ids.job,
    memberId: members.tech,
    isLead: true,
  });
  await db
    .insert(s.checklistItem)
    .values({ id: ids.checklist, organizationId: orgId, jobId: ids.job, label: "Photo", required: true });
  await db
    .insert(s.jobEvent)
    .values({ id: ids.event, organizationId: orgId, jobId: ids.job, type: "created", toStatus: "new" });
  await db.insert(s.note).values({
    id: ids.note,
    organizationId: orgId,
    jobId: ids.job,
    body: "note",
    authorUserId: users.dispatcher,
  });
  await db.insert(s.attachment).values({
    id: ids.attachment,
    organizationId: orgId,
    jobId: ids.job,
    storageKey: `org/${orgId}/x.jpg`,
    fileName: "x.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 10,
    status: "ready",
  });
  await db.insert(s.idempotencyKey).values({
    organizationId: orgId,
    key: `key-${label}`,
    userId: users.owner,
    method: "POST",
    path: "/api/v1/jobs",
    requestHash: "h",
    responseStatus: 201,
  });
  // 0.2 tables: one row each so the RLS checks have something to hide.
  await db.insert(s.timeOff).values({
    organizationId: orgId,
    memberId: members.tech,
    startsAt: new Date("2026-11-20T00:00:00Z"),
    endsAt: new Date("2026-11-21T00:00:00Z"),
    reason: "Vacation",
  });
  await db.insert(s.timeEntry).values({
    organizationId: orgId,
    jobId: ids.job,
    memberId: members.tech,
    kind: "work",
    startedAt: new Date("2026-11-11T09:00:00Z"),
    endedAt: new Date("2026-11-11T10:00:00Z"),
  });
  await db.insert(s.expenseRequest).values({
    organizationId: orgId,
    jobId: ids.job,
    requesterMemberId: members.tech,
    item: "Drain pump",
    quantity: 1,
    unitCostMinor: 4500,
    totalMinor: 4500,
    currency: "USD",
    reason: "Pump failed",
  });
  await db.insert(s.savedView).values({
    organizationId: orgId,
    memberId: members.dispatcher,
    name: "Urgent",
    query: "priority=urgent",
  });
  return { orgId, users, members, ids };
}

export type OrgData = Awaited<ReturnType<typeof createOrgWithData>>;

/** Resolves to the underlying Postgres error message (Drizzle wraps it in "Failed query: …"). */
export async function pgErrorOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    const e = err as { message?: string; cause?: { message?: string; code?: string } };
    return `${e.cause?.code ?? ""} ${e.cause?.message ?? e.message ?? String(err)}`;
  }
  throw new Error("expected the query to fail");
}

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
  // 0.3 tables. audit_log fills itself: the inserts above went through the audit trigger.
  const policyId = id();
  await db.insert(s.slaPolicy).values({
    id: policyId,
    organizationId: orgId,
    priority: "normal",
    responseMin: 24 * 60,
    resolutionMin: 7 * 24 * 60,
  });
  await db
    .insert(s.slaAlert)
    .values({ organizationId: orgId, jobId: ids.job, target: "response", kind: "at_risk" });
  await db.insert(s.notification).values({
    organizationId: orgId,
    userId: users.tech,
    type: "job_assigned",
    payload: { job_id: ids.job, job_number: 1 },
  });
  await db
    .insert(s.notificationPreference)
    .values({ organizationId: orgId, userId: users.tech, event: "job_assigned", email: false });
  await db.insert(s.portalToken).values({
    organizationId: orgId,
    contactId: ids.contact,
    tokenHash: `token-${label}`,
    expiresAt: new Date("2026-11-11T00:15:00Z"),
  });
  await db.insert(s.portalSession).values({
    organizationId: orgId,
    contactId: ids.contact,
    customerId: ids.customer,
    tokenHash: `session-${label}`,
    expiresAt: new Date("2026-12-11T00:00:00Z"),
  });
  await db.insert(s.aiInteraction).values({
    organizationId: orgId,
    userId: users.dispatcher,
    jobId: ids.job,
    feature: "intake",
    model: "claude-opus-5-5",
    outcome: "accepted",
  });
  await db.insert(s.savedView).values({
    organizationId: orgId,
    memberId: members.dispatcher,
    name: "Urgent",
    query: "priority=urgent",
  });
  // 0.4 tables.
  const catalogItemId = id();
  await db.insert(s.catalogItem).values({
    id: catalogItemId,
    organizationId: orgId,
    name: `Capacitor ${label}`,
    unitPriceMinor: 2500,
    currency: "USD",
  });
  const quoteId = id();
  await db.insert(s.quote).values({
    id: quoteId,
    organizationId: orgId,
    number: "QUO-2026-0001",
    customerId: ids.customer,
    siteId: ids.site,
    contactId: ids.contact,
    title: "Replace condenser fan",
    currency: "USD",
  });
  await db.insert(s.quoteLine).values({
    organizationId: orgId,
    quoteId,
    kind: "part",
    catalogItemId,
    description: "Capacitor",
    quantity: 1,
    unitPriceMinor: 2500,
    netMinor: 2500,
  });
  const invoiceId = id();
  await db.insert(s.invoice).values({
    id: invoiceId,
    organizationId: orgId,
    number: "INV-2026-0001",
    customerId: ids.customer,
    jobId: ids.job,
    contactId: ids.contact,
    status: "sent",
    currency: "USD",
    totalMinor: 2500,
    issueDate: "2026-11-10",
    dueDate: "2026-11-24",
  });
  await db.insert(s.invoiceLine).values({
    organizationId: orgId,
    invoiceId,
    kind: "part",
    description: "Capacitor",
    quantity: 1,
    unitPriceMinor: 2500,
    netMinor: 2500,
  });
  await db.insert(s.payment).values({
    organizationId: orgId,
    invoiceId,
    amountMinor: 1000,
    currency: "USD",
    method: "cash",
    paidAt: new Date("2026-11-12T10:00:00Z"),
  });
  await db.insert(s.invoiceReminder).values({ organizationId: orgId, invoiceId, stage: 3 });
  await db
    .insert(s.serviceReport)
    .values({ organizationId: orgId, jobId: ids.job, workPerformed: "Cleaned coils" });
  await db.insert(s.jobRecurrence).values({
    organizationId: orgId,
    customerId: ids.customer,
    siteId: ids.site,
    title: "Quarterly AC service",
    intervalUnit: "month",
    intervalCount: 3,
    startsOn: "2026-11-01",
    nextOn: "2027-02-01",
  });
  const conversationId = id();
  await db
    .insert(s.assistantConversation)
    .values({ id: conversationId, organizationId: orgId, userId: users.dispatcher, title: "SLA risks" });
  await db.insert(s.assistantMessage).values({
    organizationId: orgId,
    conversationId,
    role: "user",
    content: "Which jobs are at risk today?",
  });
  await db
    .insert(s.dailyDigest)
    .values({ organizationId: orgId, userId: users.owner, digestDate: "2026-11-10" });
  // 0.5 platform. The token hash is unique across organizations, so it carries the organization id.
  await db.insert(s.apiKey).values({
    organizationId: orgId,
    memberId: members.owner,
    name: "Integration",
    prefix: "fo_test",
    tokenHash: `test-${orgId}`,
    scopes: ["read"],
  });
  await db.insert(s.outboxEvent).values({ organizationId: orgId, type: "job.created", payload: { job: {} } });
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

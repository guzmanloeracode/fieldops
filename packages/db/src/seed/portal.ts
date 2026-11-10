import { portal } from "@fieldops/core";
import { and, eq, sql } from "drizzle-orm";
import * as s from "../schema";
import type { SeedContext } from "./context";
import { extensionFaker } from "./context";
import { localDate, zoned } from "./time";

/** The fictional customer each demo organization's portal signs in as with one click (POR-01, DEM-01). */
export const DEMO_PORTAL_LOGINS = {
  "acme-air": { email: "jamie.rivera@example.com", name: "Jamie Rivera" },
  "acme-teknik": { email: "dewi.lestari@example.com", name: "Dewi Lestari" },
} as const;

const DEMO_REQUEST = {
  "acme-air":
    "The AC in our upstairs bedroom is blowing warm air since last night\n" +
    "The outdoor unit also makes a clicking sound when it starts. Could someone come by this week? Mornings work best for us.",
  "acme-teknik":
    "AC kamar tidur utama netes air dan kurang dingin sejak kemarin\n" +
    "Unit outdoor juga bunyi agak keras. Mohon dicek minggu ini, sore hari lebih cocok. Terima kasih.",
} as const;

const OPEN = new Set(["scheduled", "en_route", "in_progress", "on_hold"]);
const SLOTS = [
  { start: 8 * 60, end: 12 * 60 },
  { start: 12 * 60, end: 17 * 60 },
  { start: 8 * 60, end: 17 * 60 },
];

/**
 * Portal contacts and requests (POR-01–03). One residential customer per organization becomes the demo portal
 * customer (the one with the most history and an upcoming visit). The open portal requests from the core seed get
 * preferred windows, the requesting contact and an AI status of "pending" (the AI seed drafts them); the newest one
 * is the demo customer's. Older portal jobs keep their normal lifecycle. Offset 5.
 */
export async function seedPortal(ctx: SeedContext): Promise<void> {
  const f = extensionFaker(ctx, 5);
  const { tx, orgId, spec, now } = ctx;

  // ------------------------------------------------------------ the demo portal customer
  const stats = new Map<string, { total: number; upcoming: number; done: number }>();
  for (const j of ctx.jobs) {
    const st = stats.get(j.customerId) ?? { total: 0, upcoming: 0, done: 0 };
    st.total += 1;
    if (OPEN.has(String(j.status)) && j.scheduledStart && j.scheduledStart > now) st.upcoming += 1;
    if (j.status === "completed") st.done += 1;
    stats.set(j.customerId, st);
  }
  const score = (id: string) => {
    const st = stats.get(id);
    return st && st.upcoming > 0 && st.done > 0 ? st.total : -1;
  };
  const demoCustomer = ctx.customers
    .filter((c) => !c.commercial)
    .reduce(
      (best, c) => (score(c.id) > score(best.id) ? c : best),
      ctx.customers.find((c) => !c.commercial)!,
    );
  const login = DEMO_PORTAL_LOGINS[spec.key];
  await tx
    .update(s.customer)
    .set({ name: login.name })
    .where(and(eq(s.customer.organizationId, orgId), eq(s.customer.id, demoCustomer.id)));
  await tx
    .update(s.contact)
    .set({ name: login.name, email: login.email, emailNorm: login.email })
    .where(
      and(
        eq(s.contact.organizationId, orgId),
        eq(s.contact.customerId, demoCustomer.id),
        eq(s.contact.isPrimary, true),
      ),
    );
  // No other contact may share the demo address.
  await tx.execute(sql`
    update contact set email = 'x.' || email, email_norm = 'x.' || email_norm
    where organization_id = ${orgId} and email_norm = ${login.email} and customer_id <> ${demoCustomer.id}`);

  // ------------------------------------------------------------ open portal requests
  // At least three per organization: recent manual requests in the queue become portal requests if needed.
  const queue = ctx.jobs
    .filter((j) => j.status === "new")
    .sort((a, b) => b.createdAt!.getTime() - a.createdAt!.getTime());
  for (const j of queue
    .filter((x) => x.source !== "portal")
    .slice(0, Math.max(0, 3 - queue.filter((x) => x.source === "portal").length))) {
    j.source = "portal";
    j.needsReview = true;
    j.createdBy = null;
    await tx
      .update(s.job)
      .set({ source: "portal", needsReview: true, createdBy: null })
      .where(and(eq(s.job.organizationId, orgId), eq(s.job.id, j.id)));
    await tx.execute(sql`
      update job_event set actor_user_id = null, payload = payload || '{"source":"portal"}'::jsonb
      where organization_id = ${orgId} and job_id = ${j.id} and type = 'created'`);
  }
  const requests = queue.filter((j) => j.source === "portal");
  const demoSite = ctx.sites.find((x) => x.customerId === demoCustomer.id)!;
  const today = localDate(now, ctx.timeZone);
  for (const [i, j] of requests.entries()) {
    const windows = Array.from({ length: f.number.int({ min: 1, max: 3 }) }, (_, k) => {
      const slot = f.helpers.arrayElement(SLOTS);
      const offset = 1 + k * f.number.int({ min: 1, max: 2 }) + (i % 3);
      const day = new Date(Date.UTC(today.y, today.m, today.d + offset));
      return {
        start: zoned(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), slot.start, ctx.timeZone),
        end: zoned(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), slot.end, ctx.timeZone),
      };
    });
    // The newest request is the demo customer's, so the portal shows it waiting for review.
    const patch = {
      aiStatus: "pending",
      preferredStart: windows[0]!.start,
      preferredEnd: windows[0]!.end,
      ...(i === 0
        ? {
            customerId: demoCustomer.id,
            siteId: demoSite.id,
            equipmentId: null,
            description: DEMO_REQUEST[spec.key],
            title: portal.titleFromDescription(DEMO_REQUEST[spec.key]),
          }
        : {}),
    };
    Object.assign(j, patch);
    await tx
      .update(s.job)
      .set(patch)
      .where(and(eq(s.job.organizationId, orgId), eq(s.job.id, j.id)));
    await tx.execute(sql`
      update job_event set payload = payload || ${JSON.stringify({
        preferred_windows: windows.map((w) => ({ start: w.start.toISOString(), end: w.end.toISOString() })),
      })}::jsonb
      where organization_id = ${orgId} and job_id = ${j.id} and type = 'created'`);
  }

  // Every portal job names the contact who asked (the customer's primary contact).
  await tx.execute(sql`
    update job_event e set payload = e.payload || jsonb_build_object('contact_id', c.id, 'contact_name', c.name)
    from job j
    join contact c on c.organization_id = j.organization_id and c.customer_id = j.customer_id and c.is_primary
    where e.organization_id = ${orgId} and j.organization_id = ${orgId} and e.job_id = j.id
      and e.type = 'created' and j.source = 'portal'`);
}

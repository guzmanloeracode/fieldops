import type { PortalContactRecord, PortalJobRow, PortalRepo } from "@fieldops/core";
import type { JobEventType, JobStatus } from "@fieldops/shared";
import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { contact, customer, job, jobEvent, note, portalSession, portalToken, site } from "../schema";

// Customer portal (POR-01–03). Every query is scoped to the organization (and RLS enforces it again); job queries
// are also scoped to one customer. Rows expose only what a customer may see.

const OPEN = ["new", "scheduled", "en_route", "in_progress", "on_hold"];

// The lead technician's name. Column names are written out because the subquery refers to the outer job row.
const leadName = sql<string | null>`(
  select u.name from job_assignment ja
  join member m on m.id = ja.member_id
  join "user" u on u.id = m.user_id
  where ja.organization_id = "job"."organization_id" and ja.job_id = "job"."id" and ja.is_lead
  order by ja.created_at limit 1)`;

export function portalRepo(tx: Tx, orgId: string): PortalRepo {
  const contactRow = {
    id: contact.id,
    customerId: contact.customerId,
    customerName: customer.name,
    name: contact.name,
    email: contact.email,
  };
  const toContact = (r: {
    id: string;
    customerId: string;
    customerName: string;
    name: string;
    email: string | null;
  }): PortalContactRecord => ({ ...r, email: r.email ?? "" });

  const contactQuery = () =>
    tx
      .select(contactRow)
      .from(contact)
      .innerJoin(
        customer,
        and(
          eq(customer.organizationId, orgId),
          eq(customer.id, contact.customerId),
          isNull(customer.deletedAt),
        ),
      );

  const jobQuery = () =>
    tx
      .select({
        id: job.id,
        number: job.number,
        title: job.title,
        description: job.description,
        status: job.status,
        source: job.source,
        scheduledStart: job.scheduledStart,
        scheduledEnd: job.scheduledEnd,
        completedAt: job.completedAt,
        createdAt: job.createdAt,
        siteLabel: site.label,
        siteLine1: site.line1,
        siteCity: site.city,
        leadTechnicianName: leadName,
      })
      .from(job)
      .innerJoin(site, and(eq(site.organizationId, orgId), eq(site.id, job.siteId)));
  type JobRow = Awaited<ReturnType<typeof jobQuery>>[number];
  const toJob = (r: JobRow): PortalJobRow => ({
    id: r.id,
    number: r.number,
    title: r.title,
    description: r.description,
    status: r.status as JobStatus,
    source: r.source,
    scheduledStart: r.scheduledStart,
    scheduledEnd: r.scheduledEnd,
    completedAt: r.completedAt,
    createdAt: r.createdAt,
    site: { label: r.siteLabel, line1: r.siteLine1, city: r.siteCity },
    leadTechnicianName: r.leadTechnicianName,
  });
  const customerJobs = (customerId: string) =>
    and(eq(job.organizationId, orgId), eq(job.customerId, customerId), isNull(job.deletedAt));

  return {
    async findContactByEmail(emailNorm) {
      const [r] = await contactQuery()
        .where(and(eq(contact.organizationId, orgId), eq(contact.emailNorm, emailNorm)))
        .orderBy(desc(contact.isPrimary), asc(contact.createdAt))
        .limit(1);
      return r ? toContact(r) : null;
    },

    async getContact(contactId) {
      const [r] = await contactQuery().where(
        and(eq(contact.organizationId, orgId), eq(contact.id, contactId)),
      );
      return r ? toContact(r) : null;
    },

    async createToken(input) {
      await tx.insert(portalToken).values({ organizationId: orgId, ...input });
    },

    async consumeToken(tokenHash, now) {
      const [r] = await tx
        .update(portalToken)
        .set({ usedAt: now })
        .where(
          and(
            eq(portalToken.organizationId, orgId),
            eq(portalToken.tokenHash, tokenHash),
            isNull(portalToken.usedAt),
            gt(portalToken.expiresAt, now),
          ),
        )
        .returning({ contactId: portalToken.contactId });
      return r ?? null;
    },

    async createSession(input) {
      await tx.insert(portalSession).values({ organizationId: orgId, ...input });
    },

    async findSession(tokenHash, now) {
      const [r] = await tx
        .select({
          id: portalSession.id,
          contactId: portalSession.contactId,
          contactName: contact.name,
          customerId: portalSession.customerId,
          customerName: customer.name,
          expiresAt: portalSession.expiresAt,
          lastSeenAt: portalSession.lastSeenAt,
        })
        .from(portalSession)
        .innerJoin(
          contact,
          and(
            eq(contact.organizationId, orgId),
            eq(contact.id, portalSession.contactId),
            eq(contact.customerId, portalSession.customerId),
          ),
        )
        .innerJoin(
          customer,
          and(
            eq(customer.organizationId, orgId),
            eq(customer.id, portalSession.customerId),
            isNull(customer.deletedAt),
          ),
        )
        .where(
          and(
            eq(portalSession.organizationId, orgId),
            eq(portalSession.tokenHash, tokenHash),
            gt(portalSession.expiresAt, now),
          ),
        );
      return r ?? null;
    },

    async touchSession(id, now) {
      await tx
        .update(portalSession)
        .set({ lastSeenAt: now })
        .where(and(eq(portalSession.organizationId, orgId), eq(portalSession.id, id)));
    },

    async deleteSession(tokenHash) {
      await tx
        .delete(portalSession)
        .where(and(eq(portalSession.organizationId, orgId), eq(portalSession.tokenHash, tokenHash)));
    },

    async listJobs(customerId, limit) {
      const rows = await jobQuery()
        .where(customerJobs(customerId))
        .orderBy(
          desc(
            sql`${job.status} in (${sql.join(
              OPEN.map((s) => sql`${s}`),
              sql`, `,
            )})`,
          ),
          desc(job.createdAt),
        )
        .limit(limit);
      return rows.map(toJob);
    },

    async getJobByNumber(customerId, number) {
      const [r] = await jobQuery().where(and(customerJobs(customerId), eq(job.number, number)));
      return r ? toJob(r) : null;
    },

    async jobEvents(jobId) {
      const rows = await tx
        .select({
          type: jobEvent.type,
          toStatus: jobEvent.toStatus,
          payload: jobEvent.payload,
          createdAt: jobEvent.createdAt,
        })
        .from(jobEvent)
        .where(
          and(
            eq(jobEvent.organizationId, orgId),
            eq(jobEvent.jobId, jobId),
            inArray(jobEvent.type, ["created", "assigned", "status_changed"]),
          ),
        )
        .orderBy(asc(jobEvent.createdAt), asc(jobEvent.id));
      return rows.map((r) => ({
        type: r.type as JobEventType,
        toStatus: (r.toStatus as JobStatus | null) ?? null,
        payload: (r.payload ?? {}) as Record<string, unknown>,
        createdAt: r.createdAt,
      }));
    },

    async customerNotes(jobId) {
      return tx
        .select({ body: note.body, createdAt: note.createdAt })
        .from(note)
        .where(and(eq(note.organizationId, orgId), eq(note.jobId, jobId), eq(note.visibility, "customer")))
        .orderBy(asc(note.createdAt));
    },
  };
}

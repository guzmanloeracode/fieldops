import type {
  DigestOverdueJob,
  DigestRepo,
  DigestSummary,
  RecurrenceRecord,
  RecurrenceRepo,
  RecurrenceView,
} from "@fieldops/core";
import { decodeCursor, encodeCursor } from "@fieldops/core";
import type { Currency, JobPriority, RecurrenceUnit, Role } from "@fieldops/shared";
import { and, eq, gt, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Tx } from "../client";
import { customer, dailyDigest, jobRecurrence, member, serviceType, site, user } from "../schema";
import { definedOnly } from "./util";
import { currentSlaDue, currentSlaState } from "./sla";

// Maintenance plans (JOB-13) and the owner's daily digest (NOT-04).

const CURSOR_SORT = "next_on";
const PLAN_ID = sql.raw(`"job_recurrence"."id"`);

type PlanRow = typeof jobRecurrence.$inferSelect;

function toRecord(r: PlanRow): RecurrenceRecord {
  return {
    id: r.id,
    customerId: r.customerId,
    siteId: r.siteId,
    equipmentId: r.equipmentId,
    serviceTypeId: r.serviceTypeId,
    title: r.title,
    description: r.description,
    priority: r.priority as JobPriority,
    intervalUnit: r.intervalUnit as RecurrenceUnit,
    intervalCount: r.intervalCount,
    startsOn: r.startsOn,
    endsOn: r.endsOn,
    windowStart: r.windowStart,
    windowMinutes: r.windowMinutes,
    leadDays: r.leadDays,
    nextOn: r.nextOn,
    leadMemberId: r.leadMemberId,
    active: r.active,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function recurrenceRepo(tx: Tx, orgId: string): RecurrenceRepo {
  const scope = and(eq(jobRecurrence.organizationId, orgId), isNull(jobRecurrence.deletedAt));

  const views = (where: SQL | undefined) =>
    tx
      .select({
        p: jobRecurrence,
        customerName: customer.name,
        siteLabel: site.label,
        siteCity: site.city,
        serviceTypeName: serviceType.name,
        leadName: user.name,
        // Qualified by hand: an unqualified column would bind to the subquery's own table.
        jobCount: sql<number>`(select count(*)::int from job j
          where j.organization_id = ${orgId} and j.recurrence_id = ${PLAN_ID} and j.deleted_at is null)`,
        lastOccurrence: sql<string | null>`(select max(j.occurrence_date)::text from job j
          where j.organization_id = ${orgId} and j.recurrence_id = ${PLAN_ID})`,
      })
      .from(jobRecurrence)
      .innerJoin(customer, and(eq(customer.id, jobRecurrence.customerId), eq(customer.organizationId, orgId)))
      .innerJoin(site, and(eq(site.id, jobRecurrence.siteId), eq(site.organizationId, orgId)))
      .leftJoin(
        serviceType,
        and(eq(serviceType.id, jobRecurrence.serviceTypeId), eq(serviceType.organizationId, orgId)),
      )
      .leftJoin(member, and(eq(member.id, jobRecurrence.leadMemberId), eq(member.organizationId, orgId)))
      .leftJoin(user, eq(user.id, member.userId))
      .where(and(scope, where));

  type ViewRow = Awaited<ReturnType<typeof views>>[number];
  const toView = (r: ViewRow): RecurrenceView => ({
    ...toRecord(r.p),
    customer: { id: r.p.customerId, name: r.customerName },
    site: { id: r.p.siteId, label: r.siteLabel, city: r.siteCity },
    serviceType:
      r.p.serviceTypeId && r.serviceTypeName ? { id: r.p.serviceTypeId, name: r.serviceTypeName } : null,
    leadMember: r.p.leadMemberId && r.leadName ? { memberId: r.p.leadMemberId, name: r.leadName } : null,
    jobCount: Number(r.jobCount),
    lastOccurrence: r.lastOccurrence,
  });

  return {
    async list(f) {
      const where: (SQL | undefined)[] = [];
      if (f.customerId) where.push(eq(jobRecurrence.customerId, f.customerId));
      if (f.active !== undefined) where.push(eq(jobRecurrence.active, f.active));
      if (f.cursor) {
        const [nextOn, id] = decodeCursor(f.cursor, CURSOR_SORT).v as [string, string];
        where.push(
          or(
            gt(jobRecurrence.nextOn, nextOn),
            and(eq(jobRecurrence.nextOn, nextOn), gt(jobRecurrence.id, id)),
          ),
        );
      }
      const rows = await views(and(...where))
        .orderBy(jobRecurrence.nextOn, jobRecurrence.id)
        .limit(f.limit + 1);
      const page = rows.slice(0, f.limit).map(toView);
      const last = page.at(-1);
      return {
        rows: page,
        nextCursor:
          rows.length > f.limit && last ? encodeCursor({ s: CURSOR_SORT, v: [last.nextOn, last.id] }) : null,
        total: null,
      };
    },

    async get(id) {
      const [r] = await views(eq(jobRecurrence.id, id));
      return r ? toView(r) : null;
    },

    async create(data) {
      const [r] = await tx
        .insert(jobRecurrence)
        .values({ organizationId: orgId, ...data })
        .returning();
      return toRecord(r!);
    },

    async update(id, patch) {
      const [r] = await tx
        .update(jobRecurrence)
        .set(definedOnly({ ...patch, updatedAt: new Date() }))
        .where(and(scope, eq(jobRecurrence.id, id)))
        .returning();
      return r ? toRecord(r) : null;
    },

    async softDelete(id) {
      const r = await tx
        .update(jobRecurrence)
        .set({ deletedAt: new Date(), active: false })
        .where(and(scope, eq(jobRecurrence.id, id)))
        .returning({ id: jobRecurrence.id });
      return r.length > 0;
    },

    async due(today) {
      const rows = await tx
        .select({ p: jobRecurrence })
        .from(jobRecurrence)
        .innerJoin(
          customer,
          and(
            eq(customer.id, jobRecurrence.customerId),
            eq(customer.organizationId, orgId),
            isNull(customer.deletedAt),
          ),
        )
        .innerJoin(
          site,
          and(eq(site.id, jobRecurrence.siteId), eq(site.organizationId, orgId), isNull(site.deletedAt)),
        )
        .where(
          and(
            scope,
            eq(jobRecurrence.active, true),
            sql`${jobRecurrence.nextOn} <= ${today}::date + ${jobRecurrence.leadDays}`,
            or(isNull(jobRecurrence.endsOn), sql`${jobRecurrence.nextOn} <= ${jobRecurrence.endsOn}`),
          ),
        )
        .orderBy(jobRecurrence.nextOn, jobRecurrence.id)
        .for("update", { of: jobRecurrence, skipLocked: true });
      return rows.map((r) => toRecord(r.p));
    },

    async advance(id, nextOn) {
      await tx
        .update(jobRecurrence)
        .set({ nextOn })
        .where(and(scope, eq(jobRecurrence.id, id)));
    },

    async occurrencesWithJobs(id, from) {
      const res = await tx.execute<{ d: string }>(sql`
        select occurrence_date::text as d from job
         where organization_id = ${orgId} and recurrence_id = ${id} and occurrence_date >= ${from}::date
         order by occurrence_date`);
      return res.rows.map((r) => r.d);
    },
  };
}

export function digestRepo(tx: Tx, orgId: string): DigestRepo {
  return {
    async recipients(date) {
      const res = await tx.execute<{ user_id: string; name: string; email: string; role: Role }>(sql`
        select u.id as user_id, u.name, u.email, m.role
          from member m
          join "user" u on u.id = m.user_id
          left join notification_preference np
            on np.organization_id = m.organization_id and np.user_id = m.user_id and np.event = 'daily_digest'
         where m.organization_id = ${orgId} and m.role in ('owner', 'admin')
           and coalesce(np.email, m.role = 'owner')
           and not exists (select 1 from daily_digest d
                            where d.organization_id = ${orgId} and d.user_id = m.user_id and d.digest_date = ${date}::date)
         order by m.role desc, u.name`);
      return res.rows.map((r) => ({ userId: r.user_id, name: r.name, email: r.email, role: r.role }));
    },

    async summary(date, overdueLimit): Promise<DigestSummary> {
      const tz = sql`(select o.timezone from organization o where o.id = ${orgId})`;
      const start = sql`((${date}::date)::timestamp at time zone ${tz})`;
      const end = sql`(((${date}::date) + 1)::timestamp at time zone ${tz})`;
      const res = await tx.execute<Record<string, unknown>>(sql`
        select
          (select o.currency from organization o where o.id = ${orgId}) as currency,
          (select count(*)::int from job j
            where j.organization_id = ${orgId} and j.deleted_at is null
              and j.created_at >= ${start} and j.created_at < ${end}) as created,
          c.completed, c.met, c.measured, c.first_visit,
          (select coalesce(sum(i.total_minor), 0)::bigint from invoice i
            where i.organization_id = ${orgId} and i.deleted_at is null and i.status not in ('draft', 'void')
              and i.issue_date = ${date}::date
              and i.currency = (select o.currency from organization o where o.id = ${orgId})) as invoiced,
          (select coalesce(sum(p.amount_minor), 0)::bigint from payment p
            join invoice i on i.id = p.invoice_id and i.organization_id = p.organization_id and i.deleted_at is null
            where p.organization_id = ${orgId} and p.paid_at >= ${start} and p.paid_at < ${end}
              and p.currency = (select o.currency from organization o where o.id = ${orgId})) as collected,
          (select count(*)::int from expense_request e
            join job j on j.id = e.job_id and j.organization_id = e.organization_id and j.deleted_at is null
            where e.organization_id = ${orgId} and e.status = 'pending') as pending
        from (
          select count(*)::int as completed,
                 (count(*) filter (where j.sla_resolution_state = 'met'))::int as met,
                 (count(*) filter (where j.sla_resolution_state in ('met', 'breached')))::int as measured,
                 (count(*) filter (where not j.revisit))::int as first_visit
            from job j
           where j.organization_id = ${orgId} and j.deleted_at is null and j.status = 'completed'
             and j.completed_at >= ${start} and j.completed_at < ${end}
        ) c`);
      const overdue = await tx.execute<{
        id: string;
        number: number;
        title: string;
        customer_name: string;
        due_at: Date | string | null;
        total: number;
      }>(sql`
        select j.id, j.number, j.title, c.name as customer_name, ${currentSlaDue("j")} as due_at,
               (count(*) over ())::int as total
          from job j
          join customer c on c.id = j.customer_id and c.organization_id = j.organization_id
         where j.organization_id = ${orgId} and j.deleted_at is null
           and j.status not in ('completed', 'canceled')
           and ${currentSlaState("j")} = 'breached'
         order by due_at nulls last, j.number
         limit ${overdueLimit}`);
      const r = res.rows[0]!;
      return {
        date,
        jobsCreated: Number(r.created),
        jobsCompleted: Number(r.completed),
        slaMet: Number(r.met),
        slaMeasured: Number(r.measured),
        firstVisit: Number(r.first_visit),
        currency: r.currency as Currency,
        invoicedMinor: Number(r.invoiced),
        collectedMinor: Number(r.collected),
        overdueCount: Number(overdue.rows[0]?.total ?? 0),
        overdue: overdue.rows.map((o): DigestOverdueJob => ({
          id: o.id,
          number: Number(o.number),
          title: o.title,
          customerName: o.customer_name,
          dueAt: o.due_at ? new Date(o.due_at) : null,
        })),
        pendingApprovals: Number(r.pending),
      };
    },

    async record(userId, date, sentAt) {
      const r = await tx
        .insert(dailyDigest)
        .values({ organizationId: orgId, userId, digestDate: date, sentAt })
        .onConflictDoNothing()
        .returning({ userId: dailyDigest.userId });
      return r.length > 0;
    },
  };
}

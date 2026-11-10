import type { ExpenseListFilters, ExpenseRecord, ExpenseRepo, ExpenseView } from "@fieldops/core";
import { decodeCursor, encodeCursor } from "@fieldops/core";
import type { Currency, ExpenseKind, ExpenseStatus, JobStatus } from "@fieldops/shared";
import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Tx } from "../client";
import { expenseRequest, job, jobAssignment, member, user } from "../schema";

const SORT = "-created_at";

export function toExpense(r: typeof expenseRequest.$inferSelect): ExpenseRecord {
  return {
    id: r.id,
    jobId: r.jobId,
    requesterMemberId: r.requesterMemberId,
    kind: r.kind as ExpenseKind,
    item: r.item,
    quantity: Number(r.quantity),
    unitCostMinor: r.unitCostMinor,
    totalMinor: r.totalMinor,
    currency: r.currency as Currency,
    supplier: r.supplier,
    reason: r.reason,
    receiptAttachmentId: r.receiptAttachmentId,
    status: r.status as ExpenseStatus,
    autoApproved: r.autoApproved,
    decidedByMemberId: r.decidedByMemberId,
    decidedAt: r.decidedAt,
    decisionComment: r.decisionComment,
    usedAt: r.usedAt,
    billable: r.billable,
    markupBps: r.markupBps,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** Parts and expense requests (EXP-01–03), always joined to a live job of the organization. */
export function expenseRepo(tx: Tx, orgId: string): ExpenseRepo {
  const requester = alias(member, "requester");
  const requesterUser = alias(user, "requester_user");
  const decider = alias(member, "decider");
  const deciderUser = alias(user, "decider_user");
  const scope = and(eq(expenseRequest.organizationId, orgId), isNull(job.deletedAt));

  const base = () =>
    tx
      .select({
        e: expenseRequest,
        job: { id: job.id, number: job.number, title: job.title, status: job.status },
        requesterName: requesterUser.name,
        deciderName: deciderUser.name,
      })
      .from(expenseRequest)
      .innerJoin(job, and(eq(job.id, expenseRequest.jobId), eq(job.organizationId, orgId)))
      .leftJoin(
        requester,
        and(eq(requester.id, expenseRequest.requesterMemberId), eq(requester.organizationId, orgId)),
      )
      .leftJoin(requesterUser, eq(requesterUser.id, requester.userId))
      .leftJoin(
        decider,
        and(eq(decider.id, expenseRequest.decidedByMemberId), eq(decider.organizationId, orgId)),
      )
      .leftJoin(deciderUser, eq(deciderUser.id, decider.userId));

  type Row = Awaited<ReturnType<ReturnType<typeof base>["execute"]>>[number];
  const toView = (r: Row): ExpenseView => {
    const e = toExpense(r.e);
    return {
      ...e,
      job: { ...r.job, status: r.job.status as JobStatus },
      requester:
        e.requesterMemberId && r.requesterName ? { id: e.requesterMemberId, name: r.requesterName } : null,
      decidedBy:
        e.decidedByMemberId && r.deciderName ? { id: e.decidedByMemberId, name: r.deciderName } : null,
    };
  };

  return {
    async list(f: ExpenseListFilters) {
      const where: (SQL | undefined)[] = [scope];
      if (f.status?.length) where.push(inArray(expenseRequest.status, f.status));
      if (f.kind) where.push(eq(expenseRequest.kind, f.kind));
      if (f.technician) where.push(eq(expenseRequest.requesterMemberId, f.technician));
      if (f.job) where.push(eq(expenseRequest.jobId, f.job));
      if (f.assignedMemberId) {
        where.push(
          sql`exists (select 1 from ${jobAssignment} ja where ja.organization_id = ${orgId} and ja.job_id = ${expenseRequest.jobId} and ja.member_id = ${f.assignedMemberId})`,
        );
      }
      const tz = sql`(select o.timezone from organization o where o.id = ${orgId})`;
      if (f.from)
        where.push(sql`${expenseRequest.createdAt} >= (${f.from}::date)::timestamp at time zone ${tz}`);
      if (f.to)
        where.push(sql`${expenseRequest.createdAt} < ((${f.to}::date) + 1)::timestamp at time zone ${tz}`);
      if (f.cursor && !f.page) {
        const [at, id] = decodeCursor(f.cursor, SORT).v as [string, string];
        where.push(sql`(${expenseRequest.createdAt}, ${expenseRequest.id}) < (${new Date(at)}, ${id})`);
      }
      const condition = and(...where);
      const offset = f.page ? (f.page - 1) * f.limit : 0;
      const rows = await base()
        .where(condition)
        .orderBy(desc(expenseRequest.createdAt), desc(expenseRequest.id))
        .limit(f.limit + 1)
        .offset(offset);
      const hasMore = rows.length > f.limit;
      const page = rows.slice(0, f.limit);
      const last = page.at(-1);
      let total: number | null = null;
      if (f.page) {
        const [t] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(expenseRequest)
          .innerJoin(job, and(eq(job.id, expenseRequest.jobId), eq(job.organizationId, orgId)))
          .where(condition);
        total = t?.n ?? 0;
      }
      return {
        rows: page.map(toView),
        nextCursor:
          hasMore && last && !f.page
            ? encodeCursor({ s: SORT, v: [last.e.createdAt.toISOString(), last.e.id] })
            : null,
        total,
      };
    },

    async listByJob(jobId) {
      const rows = await base()
        .where(and(scope, eq(expenseRequest.jobId, jobId)))
        .orderBy(desc(expenseRequest.createdAt), desc(expenseRequest.id));
      return rows.map(toView);
    },

    async get(id) {
      const [r] = await base().where(and(scope, eq(expenseRequest.id, id)));
      return r ? toView(r) : null;
    },

    async create(data) {
      const [r] = await tx
        .insert(expenseRequest)
        .values({ organizationId: orgId, ...data })
        .returning();
      return toExpense(r!);
    },

    async decide(id, d) {
      const [r] = await tx
        .update(expenseRequest)
        .set({
          status: d.status,
          decidedByMemberId: d.decidedByMemberId,
          decidedAt: d.decidedAt,
          decisionComment: d.comment,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(expenseRequest.organizationId, orgId),
            eq(expenseRequest.id, id),
            eq(expenseRequest.status, "pending"),
          ),
        )
        .returning();
      return r ? toExpense(r) : null;
    },

    async markUsed(id, at) {
      const [r] = await tx
        .update(expenseRequest)
        .set({ usedAt: at, updatedAt: new Date() })
        .where(and(eq(expenseRequest.organizationId, orgId), eq(expenseRequest.id, id)))
        .returning();
      return r ? toExpense(r) : null;
    },

    async countPending() {
      const [r] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(expenseRequest)
        .innerJoin(job, and(eq(job.id, expenseRequest.jobId), eq(job.organizationId, orgId)))
        .where(and(scope, eq(expenseRequest.status, "pending")));
      return r?.n ?? 0;
    },
  };
}

import { digestByDefault, type Role } from "@fieldops/shared";
import { localDateOf } from "../domain/availability";
import { currentSla } from "../domain/sla";
import type { DigestSummary, RecurrenceRecord, RecurrenceView } from "../services/recurrence-types";
import type { Store } from "../services/types";
import type { MemoryData } from "./memory-store";

/** In-memory state of the ops slice, kept next to (not inside) the shared MemoryData. */
export interface MemoryOpsState {
  plans: (RecurrenceRecord & { deleted?: boolean })[];
  digests: { userId: string; date: string; sentAt: Date }[];
  /** Pending part and expense requests the digest counts (the SQL version reads expense_request). */
  pendingApprovals: number;
  /** Plans another transaction is generating: `due` skips them like FOR UPDATE SKIP LOCKED. */
  locked: Set<string>;
}

const states = new WeakMap<MemoryData, MemoryOpsState>();

/** The ops state of a memory store, for tests that inspect or arrange it. */
export function opsState(data: MemoryData): MemoryOpsState {
  let s = states.get(data);
  if (!s) {
    s = { plans: [], digests: [], pendingApprovals: 0, locked: new Set() };
    states.set(data, s);
  }
  return s;
}

/** In-memory maintenance plans (JOB-13) and digests (NOT-04). SQL behaviour is covered by packages/db tests. */
export function memoryOps(data: MemoryData, uuid: () => string): Pick<Store, "recurrences" | "digest"> {
  const s = opsState(data);
  const live = () => s.plans.filter((p) => !p.deleted);
  const planJobs = (id: string) => data.jobs.filter((j) => j.recurrenceId === id);
  const view = (p: RecurrenceRecord): RecurrenceView => {
    const site = data.sites.find((x) => x.id === p.siteId);
    const st = p.serviceTypeId ? data.serviceTypes.find((x) => x.id === p.serviceTypeId) : undefined;
    const lead = p.leadMemberId ? data.members.find((m) => m.id === p.leadMemberId) : undefined;
    const dates = planJobs(p.id)
      .map((j) => j.occurrenceDate)
      .filter((d): d is string => d !== null)
      .sort();
    return {
      ...p,
      customer: { id: p.customerId, name: data.customers.find((c) => c.id === p.customerId)?.name ?? "" },
      site: { id: p.siteId, label: site?.label ?? "", city: site?.address.city ?? "" },
      serviceType: st ? { id: st.id, name: st.name } : null,
      leadMember: lead ? { memberId: lead.id, name: lead.name } : null,
      jobCount: planJobs(p.id).filter((j) => !j.deleted).length,
      lastOccurrence: dates.at(-1) ?? null,
    };
  };
  const key = (p: RecurrenceRecord) => `${p.nextOn}|${p.id}`;

  return {
    recurrences: {
      async list(f) {
        const rows = live()
          .filter((p) => (f.customerId ? p.customerId === f.customerId : true))
          .filter((p) => (f.active === undefined ? true : p.active === f.active))
          .sort((a, b) => key(a).localeCompare(key(b)))
          .filter((p) => (f.cursor ? key(p) > f.cursor : true));
        const page = rows.slice(0, f.limit);
        return {
          rows: page.map(view),
          nextCursor: rows.length > f.limit ? key(page.at(-1)!) : null,
          total: null,
        };
      },
      async get(id) {
        const p = live().find((x) => x.id === id);
        return p ? view(p) : null;
      },
      async create(input) {
        const p = { ...input, id: uuid(), createdAt: new Date(), updatedAt: new Date() };
        s.plans.push(p);
        return { ...p };
      },
      async update(id, patch) {
        const p = live().find((x) => x.id === id);
        if (!p) return null;
        Object.assign(p, patch, { updatedAt: new Date() });
        return { ...p };
      },
      async softDelete(id) {
        const p = live().find((x) => x.id === id);
        if (!p) return false;
        Object.assign(p, { deleted: true, active: false });
        return true;
      },
      async due(today) {
        const plus = (days: number) =>
          new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
        return live()
          .filter((p) => p.active && !s.locked.has(p.id))
          .filter((p) => p.nextOn <= plus(p.leadDays) && (p.endsOn === null || p.nextOn <= p.endsOn))
          .filter((p) => data.customers.some((c) => c.id === p.customerId && !c.deleted))
          .filter((p) => data.sites.some((x) => x.id === p.siteId))
          .map((p) => ({ ...p }));
      },
      async advance(id, nextOn) {
        const p = s.plans.find((x) => x.id === id);
        if (p) p.nextOn = nextOn;
      },
      async occurrencesWithJobs(id, from) {
        return planJobs(id)
          .map((j) => j.occurrenceDate)
          .filter((d): d is string => d !== null && d >= from)
          .sort();
      },
    },
    digest: {
      async recipients(date) {
        const prefs = data.automate?.notificationPreferences ?? [];
        return data.members
          .filter((m) => m.role === "owner" || m.role === "admin")
          .filter((m) => {
            const p = prefs.find((x) => x.userId === m.userId && x.event === "daily_digest");
            return p ? p.email : digestByDefault(m.role as Role);
          })
          .filter((m) => !s.digests.some((d) => d.userId === m.userId && d.date === date))
          .map((m) => ({ userId: m.userId, name: m.name, email: m.email, role: m.role }));
      },
      async summary(date, overdueLimit): Promise<DigestSummary> {
        const tz = data.org.timezone;
        const on = (d: Date | null) => d !== null && localDateOf(d, tz) === date;
        const jobs = data.jobs.filter((j) => !j.deleted);
        const completed = jobs.filter((j) => j.status === "completed" && on(j.completedAt));
        const overdue = jobs
          .filter((j) => j.status !== "completed" && j.status !== "canceled")
          .map((j) => ({ j, sla: currentSla(j) }))
          .filter((x) => x.sla?.state === "breached")
          .sort((a, b) => (a.sla!.dueAt?.getTime() ?? 0) - (b.sla!.dueAt?.getTime() ?? 0));
        return {
          date,
          jobsCreated: jobs.filter((j) => on(j.createdAt)).length,
          jobsCompleted: completed.length,
          slaMet: completed.filter((j) => j.slaResolutionState === "met").length,
          slaMeasured: completed.filter(
            (j) => j.slaResolutionState === "met" || j.slaResolutionState === "breached",
          ).length,
          firstVisit: completed.filter((j) => !j.revisit).length,
          currency: data.org.currency,
          invoicedMinor: 0,
          collectedMinor: 0,
          overdueCount: overdue.length,
          overdue: overdue.slice(0, overdueLimit).map(({ j, sla }) => ({
            id: j.id,
            number: j.number,
            title: j.title,
            customerName: data.customers.find((c) => c.id === j.customerId)?.name ?? "",
            dueAt: sla!.dueAt,
          })),
          pendingApprovals: s.pendingApprovals,
        };
      },
      async record(userId, date, sentAt) {
        if (s.digests.some((d) => d.userId === userId && d.date === date)) return false;
        s.digests.push({ userId, date, sentAt });
        return true;
      },
    },
  };
}

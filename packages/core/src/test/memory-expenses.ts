import type { ExpenseRecord, ExpenseRepo, ExpenseView } from "../services/expense-types";
import type { MemoryData } from "./memory-store";

export interface MemoryExpenseRepo extends ExpenseRepo {
  rows: ExpenseRecord[];
}

/** In-memory parts and expenses for unit tests (the SQL version is covered by packages/db tests). */
export function memoryExpenses(data: MemoryData, uuid: () => string): MemoryExpenseRepo {
  const rows: ExpenseRecord[] = [];
  const name = (memberId: string | null) => {
    const m = memberId ? data.members.find((x) => x.id === memberId) : undefined;
    return m ? { id: m.id, name: m.name } : null;
  };
  const view = (e: ExpenseRecord): ExpenseView | null => {
    const j = data.jobs.find((x) => x.id === e.jobId && !x.deleted);
    if (!j) return null;
    return {
      ...e,
      job: { id: j.id, number: j.number, title: j.title, status: j.status },
      requester: name(e.requesterMemberId),
      decidedBy: name(e.decidedByMemberId),
    };
  };
  const views = (list: ExpenseRecord[]) => list.map(view).filter((v): v is ExpenseView => v !== null);
  const newestFirst = (a: ExpenseRecord, b: ExpenseRecord) => b.createdAt.getTime() - a.createdAt.getTime();

  return {
    rows,
    async list(f) {
      let out = views(rows);
      if (f.status?.length) out = out.filter((e) => f.status!.includes(e.status));
      if (f.kind) out = out.filter((e) => e.kind === f.kind);
      if (f.technician) out = out.filter((e) => e.requesterMemberId === f.technician);
      if (f.job) out = out.filter((e) => e.jobId === f.job);
      if (f.from) out = out.filter((e) => e.createdAt.toISOString().slice(0, 10) >= f.from!);
      if (f.to) out = out.filter((e) => e.createdAt.toISOString().slice(0, 10) <= f.to!);
      if (f.assignedMemberId) {
        out = out.filter((e) =>
          data.assignments.some((a) => a.jobId === e.jobId && a.memberId === f.assignedMemberId),
        );
      }
      out.sort(newestFirst);
      const offset = f.page ? (f.page - 1) * f.limit : 0;
      return {
        rows: out.slice(offset, offset + f.limit),
        nextCursor: null,
        total: f.page ? out.length : null,
      };
    },
    async listByJob(jobId) {
      return views(rows.filter((e) => e.jobId === jobId).sort(newestFirst));
    },
    async get(id) {
      const e = rows.find((x) => x.id === id);
      return e ? view(e) : null;
    },
    async create(input) {
      const now = new Date(Date.now() + rows.length);
      const e: ExpenseRecord = {
        ...input,
        id: uuid(),
        usedAt: null,
        billable: true,
        markupBps: 0,
        createdAt: now,
        updatedAt: now,
      };
      rows.push(e);
      return e;
    },
    async decide(id, d) {
      const e = rows.find((x) => x.id === id && x.status === "pending");
      if (!e) return null;
      Object.assign(e, {
        status: d.status,
        decidedByMemberId: d.decidedByMemberId,
        decidedAt: d.decidedAt,
        decisionComment: d.comment,
        updatedAt: new Date(),
      });
      return e;
    },
    async markUsed(id, at) {
      const e = rows.find((x) => x.id === id);
      if (!e) return null;
      e.usedAt = at;
      return e;
    },
    async countPending() {
      return views(rows).filter((e) => e.status === "pending").length;
    },
  };
}

import { parseJobNumber } from "../domain/numbering";
import type {
  DashboardRepo,
  EquipmentHistoryRow,
  SavedViewRecord,
  SavedViewRepo,
  SearchRepo,
} from "../services/insights-types";
import type { EquipmentRepo } from "../services/types";
import type { MemoryData } from "./memory-store";

// In-memory versions of the 0.2 insights repositories. The dashboard repository is a fake with canned
// answers: its SQL is covered by the packages/db integration tests.

export function fakeDashboard(overrides: Partial<DashboardRepo> = {}): DashboardRepo {
  return {
    async kpis() {
      return {
        created: 0,
        completed: 0,
        completedWithinTarget: 0,
        completedFirstVisit: 0,
        avgResponseMin: null,
        avgResolutionMin: null,
      };
    },
    async statusSeries() {
      return [];
    },
    async slaTrend() {
      return [];
    },
    async byServiceType() {
      return [];
    },
    async workload() {
      return [];
    },
    async dayStatusCounts() {
      return [];
    },
    async atRisk() {
      return { total: 0, rows: [] };
    },
    async pendingApprovals() {
      return { total: 0, rows: [] };
    },
    async ownStats() {
      return { completed: 0, workMin: 0 };
    },
    ...overrides,
  };
}

let viewSeq = 0;

export function insightsMemory(data: MemoryData) {
  const views: SavedViewRecord[] = [];
  const liveJobs = () => data.jobs.filter((j) => !j.deleted);
  const assignedTo = (jobId: string, memberId?: string) =>
    !memberId || data.assignments.some((a) => a.jobId === jobId && a.memberId === memberId);

  const equipment: Pick<EquipmentRepo, "create" | "update" | "softDelete" | "history"> = {
    async create(siteId, values) {
      const unit = { id: `eq-${data.equipment.length + 1}-${siteId.slice(-4)}`, siteId, ...values };
      data.equipment.push(unit);
      return unit;
    },
    async update(id, patch) {
      const unit = data.equipment.find((e) => e.id === id);
      if (!unit) return null;
      Object.assign(unit, patch);
      return unit;
    },
    async softDelete(id) {
      const i = data.equipment.findIndex((e) => e.id === id);
      if (i < 0) return false;
      data.equipment.splice(i, 1);
      return true;
    },
    async history(id, opts) {
      return liveJobs()
        .filter((j) => j.equipmentId === id && assignedTo(j.id, opts.assignedMemberId))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, opts.limit)
        .map((j): EquipmentHistoryRow => ({
          id: j.id,
          number: j.number,
          title: j.title,
          status: j.status,
          priority: j.priority,
          serviceTypeName: data.serviceTypes.find((s) => s.id === j.serviceTypeId)?.name ?? null,
          scheduledStart: j.scheduledStart,
          completedAt: j.completedAt,
          createdAt: j.createdAt,
          technicians: data.assignments
            .filter((a) => a.jobId === j.id)
            .map((a) => data.members.find((m) => m.id === a.memberId)?.name ?? ""),
        }));
    },
  };

  const savedViews: SavedViewRepo = {
    async list(resource, memberId) {
      return views.filter((v) => v.resource === resource && (v.shared || v.memberId === memberId));
    },
    async get(id) {
      return views.find((v) => v.id === id) ?? null;
    },
    async create(values) {
      viewSeq += 1;
      const v: SavedViewRecord = {
        ...values,
        id: `view-${viewSeq}`,
        ownerName: data.members.find((m) => m.id === values.memberId)?.name ?? "",
        createdAt: new Date(),
      };
      views.push(v);
      return v;
    },
    async remove(id) {
      const i = views.findIndex((v) => v.id === id);
      if (i < 0) return false;
      views.splice(i, 1);
      return true;
    },
    async countByMember(memberId, resource) {
      return views.filter((v) => v.memberId === memberId && v.resource === resource).length;
    },
  };

  const search: SearchRepo = {
    async search(q, opts) {
      const needle = q.toLowerCase();
      const number = parseJobNumber(q);
      const jobs = liveJobs().filter(
        (j) =>
          assignedTo(j.id, opts.assignedMemberId) &&
          (j.title.toLowerCase().includes(needle) || j.number === number),
      );
      const mine = liveJobs().filter((j) => assignedTo(j.id, opts.assignedMemberId));
      const visibleCustomers = new Set(
        opts.assignedMemberId ? mine.map((j) => j.customerId) : data.customers.map((c) => c.id),
      );
      const linkedSites = new Set(mine.map((j) => j.siteId));
      const customerName = (id: string) => data.customers.find((c) => c.id === id)?.name ?? "";
      return {
        jobs: jobs.slice(0, opts.limit).map((j) => ({
          id: j.id,
          number: j.number,
          title: j.title,
          status: j.status,
          customerName: customerName(j.customerId),
        })),
        customers: data.customers
          .filter((c) => !c.deleted && visibleCustomers.has(c.id) && c.name.toLowerCase().includes(needle))
          .slice(0, opts.limit)
          .map((c) => ({ id: c.id, name: c.name, type: c.type, city: null })),
        sites: data.sites
          .filter(
            (s) =>
              (!opts.assignedMemberId || linkedSites.has(s.id)) &&
              [s.label, s.address.line1, s.address.city].some((v) => v.toLowerCase().includes(needle)),
          )
          .slice(0, opts.limit)
          .map((s) => ({
            id: s.id,
            customerId: s.customerId,
            customerName: customerName(s.customerId),
            label: s.label,
            line1: s.address.line1,
            city: s.address.city,
          })),
      };
    },
  };

  return { equipment, repos: { dashboard: fakeDashboard(), savedViews, search } };
}

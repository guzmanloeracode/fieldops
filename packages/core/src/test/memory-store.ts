import type { Role } from "@fieldops/shared";
import type { Actor } from "../domain/permissions";
import type {
  AssigneeRef,
  AttachmentRecord,
  ContactRecord,
  CustomerListRow,
  CustomerRecord,
  EquipmentRecord,
  FileStorage,
  JobEventRecord,
  JobRecord,
  JobView,
  MemberRecord,
  NoteRecord,
  OrganizationRecord,
  ServiceContext,
  ServiceTypeRecord,
  SiteRecord,
  Store,
} from "../services/types";

// An in-memory Store for unit-testing services without a database. It mirrors the repository contracts
// closely enough for the services' rules; SQL behaviour is covered by packages/db integration tests.

let seq = 0;
export const uuid = () => {
  seq += 1;
  return `00000000-0000-4000-8000-${seq.toString(16).padStart(12, "0")}`;
};

export interface MemoryData {
  org: OrganizationRecord;
  customers: (CustomerRecord & { deleted?: boolean })[];
  contacts: (ContactRecord & { emailNorm: string | null; phoneNorm: string | null })[];
  sites: SiteRecord[];
  equipment: EquipmentRecord[];
  serviceTypes: ServiceTypeRecord[];
  jobs: (JobRecord & { deleted?: boolean })[];
  assignments: { jobId: string; memberId: string; isLead: boolean }[];
  events: (JobEventRecord & { actorUserId: string | null })[];
  notes: NoteRecord[];
  attachments: AttachmentRecord[];
  members: MemberRecord[];
  checklist: { jobId: string; label: string; required: boolean; done: boolean }[];
  counter: number;
}

export function createMemoryStore(seed?: Partial<MemoryData>): { store: Store; data: MemoryData } {
  const now = () => new Date();
  const data: MemoryData = {
    org: {
      id: "org-1",
      name: "Acme",
      slug: "acme",
      logo: null,
      timezone: "UTC",
      currency: "USD",
      country: "US",
      brandColor: null,
      address: null,
      businessHours: [],
      taxRates: [],
      isDemo: false,
    },
    customers: [],
    contacts: [],
    sites: [],
    equipment: [],
    serviceTypes: [],
    jobs: [],
    assignments: [],
    events: [],
    notes: [],
    attachments: [],
    members: [],
    checklist: [],
    counter: 0,
    ...seed,
  };

  const memberName = (memberId: string) => data.members.find((m) => m.id === memberId);
  const userName = (userId: string | null) => data.members.find((m) => m.userId === userId)?.name;

  const view = (j: JobRecord): JobView => {
    const site = data.sites.find((s) => s.id === j.siteId)!;
    const st = j.serviceTypeId ? data.serviceTypes.find((s) => s.id === j.serviceTypeId) : undefined;
    const assignees: AssigneeRef[] = data.assignments
      .filter((a) => a.jobId === j.id)
      .map((a) => {
        const m = memberName(a.memberId);
        return { memberId: a.memberId, userId: m?.userId ?? "", name: m?.name ?? "", isLead: a.isLead };
      });
    return {
      ...j,
      customer: { id: j.customerId, name: data.customers.find((c) => c.id === j.customerId)?.name ?? "" },
      site: {
        id: site.id,
        label: site.label,
        address: site.address,
        latitude: site.latitude,
        longitude: site.longitude,
        accessNotes: site.accessNotes,
      },
      serviceType: st ? { id: st.id, name: st.name } : null,
      assignees,
    };
  };
  const liveJobs = () => data.jobs.filter((j) => !j.deleted);
  const memberLinkedJobs = (memberId: string) =>
    liveJobs().filter((j) => data.assignments.some((a) => a.jobId === j.id && a.memberId === memberId));

  const store: Store = {
    organizationId: data.org.id,
    customers: {
      async list(f) {
        let rows = data.customers.filter((c) => !c.deleted);
        if (f.assignedMemberId) {
          const linked = new Set(memberLinkedJobs(f.assignedMemberId).map((j) => j.customerId));
          rows = rows.filter((c) => linked.has(c.id));
        }
        if (f.q) rows = rows.filter((c) => c.name.toLowerCase().includes(f.q!.toLowerCase()));
        const out: CustomerListRow[] = rows.map((c) => ({
          ...c,
          primaryContact: null,
          siteCount: data.sites.filter((s) => s.customerId === c.id).length,
          openJobCount: 0,
          lastJobAt: null,
        }));
        return { rows: out, nextCursor: null, total: f.page ? out.length : null };
      },
      async get(id) {
        return data.customers.find((c) => c.id === id && !c.deleted) ?? null;
      },
      async create(input) {
        const c = { ...input, id: uuid(), createdAt: now(), updatedAt: now() };
        data.customers.push(c);
        return c;
      },
      async update(id, patch) {
        const c = data.customers.find((x) => x.id === id && !x.deleted);
        if (!c) return null;
        Object.assign(c, patch, { updatedAt: now() });
        return c;
      },
      async softDelete(id) {
        const c = data.customers.find((x) => x.id === id && !x.deleted);
        if (!c) return false;
        c.deleted = true;
        return true;
      },
      async contacts(customerId) {
        return data.contacts.filter((c) => c.customerId === customerId);
      },
      async addContact(customerId, input) {
        const c = { ...input, id: uuid(), customerId };
        data.contacts.push(c);
        return c;
      },
      async findDuplicates({ emails, phones, excludeCustomerId }) {
        const out = new Map<string, { id: string; name: string; matchedOn: "email" | "phone" }>();
        for (const c of data.contacts) {
          const cust = data.customers.find((x) => x.id === c.customerId && !x.deleted);
          if (!cust || cust.id === excludeCustomerId || out.has(cust.id)) continue;
          if (c.emailNorm && emails.includes(c.emailNorm))
            out.set(cust.id, { id: cust.id, name: cust.name, matchedOn: "email" });
          else if (c.phoneNorm && phones.includes(c.phoneNorm))
            out.set(cust.id, { id: cust.id, name: cust.name, matchedOn: "phone" });
        }
        return [...out.values()];
      },
      async isLinkedToMember(customerId, memberId) {
        return memberLinkedJobs(memberId).some((j) => j.customerId === customerId);
      },
      async stats(customerId) {
        const jobs = liveJobs().filter((j) => j.customerId === customerId);
        return {
          jobCount: jobs.length,
          openJobCount: jobs.filter((j) => !["completed", "canceled"].includes(j.status)).length,
          completedJobCount: jobs.filter((j) => j.status === "completed").length,
          lastJobAt: null,
        };
      },
    },
    sites: {
      async listByCustomer(customerId) {
        return data.sites.filter((s) => s.customerId === customerId);
      },
      async get(id) {
        return data.sites.find((s) => s.id === id) ?? null;
      },
      async create(customerId, input) {
        const s = { ...input, id: uuid(), customerId, createdAt: now(), updatedAt: now() };
        data.sites.push(s);
        return s;
      },
      async update(id, patch) {
        const s = data.sites.find((x) => x.id === id);
        if (!s) return null;
        Object.assign(s, patch, { updatedAt: now() });
        return s;
      },
      async isLinkedToMember(siteId, memberId) {
        return memberLinkedJobs(memberId).some((j) => j.siteId === siteId);
      },
    },
    equipment: {
      async get(id) {
        return data.equipment.find((e) => e.id === id) ?? null;
      },
      async listBySite(siteId) {
        return data.equipment.filter((e) => e.siteId === siteId);
      },
    },
    serviceTypes: {
      async list(opts) {
        return data.serviceTypes.filter((s) => opts?.includeInactive || s.active);
      },
      async get(id) {
        return data.serviceTypes.find((s) => s.id === id) ?? null;
      },
      async create(input) {
        const s = { ...input, id: uuid() };
        data.serviceTypes.push(s);
        return s;
      },
      async update(id, patch) {
        const s = data.serviceTypes.find((x) => x.id === id);
        if (!s) return null;
        Object.assign(s, patch);
        return s;
      },
    },
    jobs: {
      async list(f) {
        let rows = liveJobs();
        if (f.assignedMemberId) rows = memberLinkedJobs(f.assignedMemberId);
        if (f.status?.length) rows = rows.filter((j) => f.status!.includes(j.status));
        return { rows: rows.map(view), nextCursor: null, total: f.page ? rows.length : null };
      },
      async get(id) {
        const j = liveJobs().find((x) => x.id === id);
        return j ? view(j) : null;
      },
      async getByNumber(number) {
        const j = liveJobs().find((x) => x.number === number);
        return j ? view(j) : null;
      },
      async nextNumber() {
        data.counter += 1;
        return data.counter;
      },
      async create(input) {
        const j: JobRecord = {
          ...input,
          id: uuid(),
          status: "new",
          holdReason: null,
          scheduledStart: null,
          scheduledEnd: null,
          completedAt: null,
          canceledAt: null,
          createdAt: now(),
          updatedAt: now(),
          version: 1,
        };
        data.jobs.push(j);
        return j;
      },
      async update(id, patch, expectedVersion) {
        const j = liveJobs().find((x) => x.id === id);
        if (!j || (expectedVersion !== undefined && j.version !== expectedVersion)) return null;
        Object.assign(j, patch, { version: j.version + 1, updatedAt: now() });
        return j;
      },
      async softDelete(id) {
        const j = liveJobs().find((x) => x.id === id);
        if (!j) return false;
        j.deleted = true;
        return true;
      },
      async setAssignments(jobId, assignments) {
        data.assignments = data.assignments
          .filter((a) => a.jobId !== jobId)
          .concat(assignments.map((a) => ({ jobId, ...a })));
      },
      async addEvent(e) {
        const name = userName(e.actorUserId);
        data.events.push({
          ...e,
          id: uuid(),
          createdAt: now(),
          actor: e.actorUserId && name ? { id: e.actorUserId, name } : null,
        });
      },
      async events(jobId) {
        return data.events.filter((e) => e.jobId === jobId).reverse();
      },
      async overlapping(memberId, start, end, excludeJobId) {
        return memberLinkedJobs(memberId)
          .filter(
            (j) =>
              j.id !== excludeJobId &&
              !["completed", "canceled"].includes(j.status) &&
              j.scheduledStart &&
              j.scheduledEnd &&
              j.scheduledStart < end &&
              j.scheduledEnd > start,
          )
          .map((j) => ({ id: j.id, number: j.number }));
      },
      async missingRequiredChecklistItems(jobId) {
        return data.checklist.filter((c) => c.jobId === jobId && c.required && !c.done).map((c) => c.label);
      },
    },
    notes: {
      async list(jobId, opts) {
        return data.notes.filter(
          (n) => n.jobId === jobId && (!opts?.visibility || n.visibility === opts.visibility),
        );
      },
      async create(jobId, input) {
        const name = userName(input.authorUserId);
        const n: NoteRecord = {
          id: uuid(),
          jobId,
          body: input.body,
          visibility: input.visibility,
          author: name ? { id: input.authorUserId, name } : null,
          createdAt: now(),
        };
        data.notes.push(n);
        return n;
      },
    },
    attachments: {
      async list(jobId) {
        return data.attachments.filter((a) => a.jobId === jobId);
      },
      async get(id) {
        return data.attachments.find((a) => a.id === id) ?? null;
      },
      async create(input) {
        const a = { ...input, id: uuid(), createdAt: now() };
        data.attachments.push(a);
        return a;
      },
      async markReady(id) {
        const a = data.attachments.find((x) => x.id === id);
        if (!a) return null;
        a.status = "ready";
        return a;
      },
      async remove(id) {
        const before = data.attachments.length;
        data.attachments = data.attachments.filter((a) => a.id !== id);
        return data.attachments.length < before;
      },
    },
    members: {
      async list() {
        return data.members;
      },
      async get(memberId) {
        return data.members.find((m) => m.id === memberId) ?? null;
      },
      async updateRole(memberId, role) {
        const m = data.members.find((x) => x.id === memberId);
        if (m) m.role = role;
      },
      async remove(memberId) {
        data.members = data.members.filter((m) => m.id !== memberId);
      },
      async countByRole(role) {
        return data.members.filter((m) => m.role === role).length;
      },
    },
    organization: {
      async get() {
        return data.org;
      },
      async update(patch) {
        Object.assign(data.org, patch);
        return data.org;
      },
    },
  };
  return { store, data };
}

export function member(role: Role, name = `${role} person`, extra: Partial<MemberRecord> = {}): MemberRecord {
  const id = uuid();
  return {
    id,
    userId: uuid(),
    name,
    email: `${role}${id.slice(-4)}@example.com`,
    role,
    isDemo: false,
    createdAt: new Date(),
    ...extra,
  };
}

export function actorFor(m: MemberRecord, organizationId = "org-1"): Actor {
  return { userId: m.userId, memberId: m.id, organizationId, role: m.role, name: m.name };
}

export function fakeFiles(
  existing = new Set<string>(),
): FileStorage & { removed: string[]; existing: Set<string> } {
  const removed: string[] = [];
  return {
    existing,
    removed,
    async presignPut(key) {
      return { url: `https://files.example/put/${key}`, headers: { "Content-Type": "x" }, expiresIn: 600 };
    },
    async presignGet(key) {
      return `https://files.example/get/${key}`;
    },
    async exists(key) {
      return existing.has(key);
    },
    async remove(keys) {
      removed.push(...keys);
    },
  };
}

export function ctxFor(store: Store, actor: Actor, extra: Partial<ServiceContext> = {}): ServiceContext {
  return { actor, store, now: new Date("2026-11-10T09:00:00Z"), demo: false, ...extra };
}

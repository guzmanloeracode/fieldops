import type { JobStatus } from "@fieldops/shared";
import { OPEN_STATUSES } from "../domain/job-status";
import type { AuditEntryRecord, AuditRepo } from "../services/audit-types";
import type { PortalJobRow, PortalRepo } from "../services/portal-types";
import type { MemoryData } from "./memory-store";

// In-memory portal (POR-01–03) and audit viewer (AUD-03) repositories for unit tests.

export interface PortalMemoryState {
  tokens: { contactId: string; tokenHash: string; expiresAt: Date; usedAt: Date | null }[];
  sessions: {
    id: string;
    contactId: string;
    customerId: string;
    tokenHash: string;
    expiresAt: Date;
    ip: string | null;
    userAgent: string | null;
    lastSeenAt: Date | null;
  }[];
  /** Audit rows the viewer reads; tests push them directly. */
  auditEntries: AuditEntryRecord[];
  auditEvents: { action: string; entityType: string; entityId: string | null; after: unknown }[];
}

const states = new WeakMap<MemoryData, PortalMemoryState>();

export function portalMemoryOf(data: MemoryData): PortalMemoryState {
  let s = states.get(data);
  if (!s) {
    s = { tokens: [], sessions: [], auditEntries: [], auditEvents: [] };
    states.set(data, s);
  }
  return s;
}

export function memoryPortal(data: MemoryData, uuid: () => string): PortalRepo {
  const s = portalMemoryOf(data);
  const liveCustomer = (id: string) => data.customers.find((c) => c.id === id && !c.deleted);
  const contact = (id: string) => {
    const c = data.contacts.find((x) => x.id === id);
    const customer = c ? liveCustomer(c.customerId) : undefined;
    return c && customer
      ? {
          id: c.id,
          customerId: c.customerId,
          customerName: customer.name,
          name: c.name,
          email: c.email ?? "",
        }
      : null;
  };
  const row = (j: MemoryData["jobs"][number]): PortalJobRow => {
    const site = data.sites.find((x) => x.id === j.siteId)!;
    const lead = data.assignments.find((a) => a.jobId === j.id && a.isLead);
    return {
      id: j.id,
      number: j.number,
      title: j.title,
      description: j.description,
      status: j.status,
      source: j.source,
      scheduledStart: j.scheduledStart,
      scheduledEnd: j.scheduledEnd,
      completedAt: j.completedAt,
      createdAt: j.createdAt,
      site: { label: site.label, line1: site.address.line1, city: site.address.city },
      leadTechnicianName: lead ? (data.members.find((m) => m.id === lead.memberId)?.name ?? null) : null,
    };
  };
  const open = (status: JobStatus) => (OPEN_STATUSES as readonly JobStatus[]).includes(status);
  return {
    async findContactByEmail(emailNorm) {
      const c = data.contacts.find((x) => x.emailNorm === emailNorm && liveCustomer(x.customerId));
      return c ? contact(c.id) : null;
    },
    async getContact(id) {
      return contact(id);
    },
    async createToken(input) {
      s.tokens.push({ ...input, usedAt: null });
    },
    async consumeToken(tokenHash, now) {
      const t = s.tokens.find((x) => x.tokenHash === tokenHash && !x.usedAt && x.expiresAt > now);
      if (!t) return null;
      t.usedAt = now;
      return { contactId: t.contactId };
    },
    async createSession(input) {
      s.sessions.push({ ...input, id: uuid(), lastSeenAt: null });
    },
    async findSession(tokenHash, now) {
      const x = s.sessions.find((v) => v.tokenHash === tokenHash && v.expiresAt > now);
      const c = x ? contact(x.contactId) : null;
      return x && c
        ? {
            id: x.id,
            contactId: c.id,
            contactName: c.name,
            customerId: x.customerId,
            customerName: c.customerName,
            expiresAt: x.expiresAt,
            lastSeenAt: x.lastSeenAt,
          }
        : null;
    },
    async touchSession(id, now) {
      const x = s.sessions.find((v) => v.id === id);
      if (x) x.lastSeenAt = now;
    },
    async deleteSession(tokenHash) {
      s.sessions = s.sessions.filter((v) => v.tokenHash !== tokenHash);
    },
    async listJobs(customerId, limit) {
      return data.jobs
        .filter((j) => !j.deleted && j.customerId === customerId)
        .sort(
          (a, b) =>
            Number(open(b.status)) - Number(open(a.status)) || b.createdAt.getTime() - a.createdAt.getTime(),
        )
        .slice(0, limit)
        .map(row);
    },
    async getJobByNumber(customerId, number) {
      const j = data.jobs.find((x) => !x.deleted && x.customerId === customerId && x.number === number);
      return j ? row(j) : null;
    },
    async jobEvents(jobId) {
      return data.events
        .filter((e) => e.jobId === jobId && ["created", "assigned", "status_changed"].includes(e.type))
        .map((e) => ({ type: e.type, toStatus: e.toStatus, payload: e.payload, createdAt: e.createdAt }));
    },
    async customerNotes(jobId) {
      return data.notes
        .filter((n) => n.jobId === jobId && n.visibility === "customer")
        .map((n) => ({ body: n.body, createdAt: n.createdAt }));
    },
  };
}

export function memoryAudit(data: MemoryData): AuditRepo {
  const s = portalMemoryOf(data);
  return {
    async record(entry) {
      s.auditEvents.push({ ...entry, after: entry.after ?? null });
    },
    async list(f) {
      return s.auditEntries
        .filter(
          (e) =>
            (!f.actor || (f.actor === "system" ? e.actorUserId === null : e.actorUserId === f.actor)) &&
            (!f.entityType || e.entityType === f.entityType) &&
            (!f.operation || e.action.endsWith(`.${f.operation}`)) &&
            (!f.entityId || e.entityId === f.entityId) &&
            (!f.from || e.createdAt >= f.from) &&
            (!f.to || e.createdAt < f.to) &&
            (!f.before ||
              e.createdAt < f.before.createdAt ||
              (e.createdAt.getTime() === f.before.createdAt.getTime() && e.id < f.before.id)),
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
        .slice(0, f.limit);
    },
    async actors() {
      const seen = new Map<string, string>();
      for (const e of s.auditEntries) if (e.actorUserId && e.actorName) seen.set(e.actorUserId, e.actorName);
      return [...seen].map(([userId, name]) => ({ userId, name }));
    },
  };
}

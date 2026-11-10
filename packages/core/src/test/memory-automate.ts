import { type MemoryData } from "./memory-store";
import type { NotificationRecord, NotificationPreferenceRecord } from "../services/notification-types";
import type { SlaPolicyRecord } from "../services/sla-types";
import { memoryAi, type MemoryAiInteraction } from "./memory-ai";
import { slaState } from "../domain/sla";
import type { Store } from "../services/types";
import { memoryAudit, memoryPortal } from "./memory-portal";

/** In-memory 0.3 repositories. Each 0.3 slice extends its own part. */
export interface MemoryAutomate {
  slaPolicies: SlaPolicyRecord[];
  slaAlerts: {
    jobId: string;
    target: "response" | "resolution";
    kind: "at_risk" | "breached";
    raisedAt: Date;
  }[];
  notifications: NotificationRecord[];
  notificationPreferences: NotificationPreferenceRecord[];
  auditEvents: { action: string; entityType: string; entityId: string | null; after: unknown }[];
  aiInteractions: MemoryAiInteraction[];
  aiRateLimits?: Map<string, number>;
}

export function memoryAutomate(
  data: MemoryData,
  uuid: () => string,
): Pick<Store, "sla" | "notifications" | "audit" | "portal" | "ai"> {
  const a: MemoryAutomate = (data.automate ??= {
    slaPolicies: [],
    slaAlerts: [],
    notifications: [],
    notificationPreferences: [],
    auditEvents: [],
    aiInteractions: [],
  });
  const openJobs = () =>
    data.jobs.filter((j) => !j.deleted && j.status !== "completed" && j.status !== "canceled");
  return {
    sla: {
      async listPolicies() {
        return a.slaPolicies;
      },
      async savePolicies(rows) {
        for (const r of rows) {
          const existing = a.slaPolicies.find((p) => p.priority === r.priority);
          if (existing) Object.assign(existing, r);
          else a.slaPolicies.push({ id: uuid(), ...r });
        }
        return a.slaPolicies;
      },
      async advanceStates(now) {
        let n = 0;
        for (const j of openJobs()) {
          // Like the SQL: only targets that are still open and have a deadline move.
          const response =
            j.firstScheduledAt || !j.responseDueAt
              ? j.slaResponseState
              : slaState({ dueAt: j.responseDueAt, atRiskAt: j.responseAtRiskAt, doneAt: null, now });
          const resolution = j.resolutionDueAt
            ? slaState({ dueAt: j.resolutionDueAt, atRiskAt: j.resolutionAtRiskAt, doneAt: null, now })
            : j.slaResolutionState;
          if (response !== j.slaResponseState || resolution !== j.slaResolutionState) {
            Object.assign(j, { slaResponseState: response, slaResolutionState: resolution });
            n += 1;
          }
        }
        return n;
      },
      async raiseAlerts(now) {
        const raised = [];
        for (const j of openJobs()) {
          const targets = [
            ...(j.firstScheduledAt
              ? []
              : [{ target: "response" as const, state: j.slaResponseState, dueAt: j.responseDueAt }]),
            { target: "resolution" as const, state: j.slaResolutionState, dueAt: j.resolutionDueAt },
          ];
          for (const t of targets) {
            if (t.state !== "at_risk" && t.state !== "breached") continue;
            if (a.slaAlerts.some((x) => x.jobId === j.id && x.target === t.target && x.kind === t.state))
              continue;
            a.slaAlerts.push({ jobId: j.id, target: t.target, kind: t.state, raisedAt: now });
            raised.push({
              jobId: j.id,
              number: j.number,
              title: j.title,
              customerName: data.customers.find((c) => c.id === j.customerId)?.name ?? "",
              target: t.target,
              kind: t.state,
              dueAt: t.dueAt,
            });
          }
        }
        return raised;
      },
    },
    notifications: {
      async create(rows) {
        for (const r of rows) {
          a.notifications.push({ id: uuid(), ...r, readAt: null, createdAt: new Date() });
        }
      },
      async preferences(userIds, event) {
        return a.notificationPreferences.filter((p) => userIds.includes(p.userId) && p.event === event);
      },
      async list(f) {
        const all = a.notifications
          .filter((n) => n.userId === f.userId && (!f.unreadOnly || n.readAt === null))
          .slice()
          .reverse();
        const start = f.page ? (f.page - 1) * f.limit : f.cursor ? Number(f.cursor) : 0;
        const rows = all.slice(start, start + f.limit);
        const more = all.length > start + f.limit;
        return {
          rows,
          nextCursor: more && !f.page ? String(start + f.limit) : null,
          total: f.page ? all.length : null,
        };
      },
      async unreadCount(userId) {
        return a.notifications.filter((n) => n.userId === userId && n.readAt === null).length;
      },
      async markRead(userId, ids, at) {
        let n = 0;
        for (const x of a.notifications) {
          if (x.userId === userId && x.readAt === null && (ids === "all" || ids.includes(x.id))) {
            x.readAt = at;
            n += 1;
          }
        }
        return n;
      },
      async userPreferences(userId) {
        return a.notificationPreferences.filter((p) => p.userId === userId);
      },
      async savePreferences(userId, prefs) {
        for (const p of prefs) {
          const existing = a.notificationPreferences.find((x) => x.userId === userId && x.event === p.event);
          if (existing) Object.assign(existing, p);
          else a.notificationPreferences.push({ userId, ...p });
        }
      },
    },
    audit: memoryAudit(data),
    portal: memoryPortal(data, uuid),
    ai: memoryAi(a.aiInteractions, (a.aiRateLimits ??= new Map()), data, uuid),
  };
}

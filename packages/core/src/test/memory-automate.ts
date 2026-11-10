import { type MemoryData } from "./memory-store";
import type { NotificationRecord, NotificationPreferenceRecord } from "../services/notification-types";
import type { SlaPolicyRecord } from "../services/sla-types";
import type { AiInteractionInput } from "../services/ai-types";
import type { Store } from "../services/types";

/** In-memory 0.3 repositories. Each 0.3 slice extends its own part. */
export interface MemoryAutomate {
  slaPolicies: SlaPolicyRecord[];
  notifications: NotificationRecord[];
  notificationPreferences: NotificationPreferenceRecord[];
  auditEvents: { action: string; entityType: string; entityId: string | null; after: unknown }[];
  aiInteractions: (AiInteractionInput & { id: string })[];
}

export function memoryAutomate(
  data: MemoryData,
  uuid: () => string,
): Pick<Store, "sla" | "notifications" | "audit" | "portal" | "ai"> {
  const a: MemoryAutomate = (data.automate ??= {
    slaPolicies: [],
    notifications: [],
    notificationPreferences: [],
    auditEvents: [],
    aiInteractions: [],
  });
  return {
    sla: {
      async listPolicies() {
        return a.slaPolicies;
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
    audit: {
      async record(entry) {
        a.auditEvents.push({ ...entry, after: entry.after ?? null });
      },
    },
    portal: {},
    ai: {
      async logInteraction(row) {
        const id = uuid();
        a.aiInteractions.push({ ...row, id });
        return { id };
      },
    },
  };
}

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

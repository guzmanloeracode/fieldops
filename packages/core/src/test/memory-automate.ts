import { type MemoryData } from "./memory-store";
import type { NotificationRecord, NotificationPreferenceRecord } from "../services/notification-types";
import type { SlaPolicyRecord } from "../services/sla-types";
import { memoryAi, type MemoryAiInteraction } from "./memory-ai";
import type { Store } from "../services/types";
import { memoryAudit, memoryPortal } from "./memory-portal";

/** In-memory 0.3 repositories. Each 0.3 slice extends its own part. */
export interface MemoryAutomate {
  slaPolicies: SlaPolicyRecord[];
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
    audit: memoryAudit(data),
    portal: memoryPortal(data, uuid),
    ai: memoryAi(a.aiInteractions, (a.aiRateLimits ??= new Map()), data, uuid),
  };
}

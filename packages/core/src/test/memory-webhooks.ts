import type { MemoryData } from "./memory-store";
import type { Store } from "../services/types";

/** Webhook state in a memory store: whether webhooks are on, and the outbox's Relay event ids and types. */
export interface MemoryWebhooks {
  enabledAt: Date | null;
  sentEvents: { relayEventId: string; type: string }[];
}

export function webhooksData(data: MemoryData): MemoryWebhooks {
  data.webhooks ??= { enabledAt: null, sentEvents: [] };
  return data.webhooks;
}

export function memoryWebhooks(data: MemoryData): Pick<Store, "webhooks"> {
  return {
    webhooks: {
      async state() {
        return { enabledAt: webhooksData(data).enabledAt, name: data.org.name };
      },
      async setEnabled(at) {
        webhooksData(data).enabledAt = at;
      },
      async eventTypes(ids) {
        const want = new Set(ids);
        return Object.fromEntries(
          webhooksData(data)
            .sentEvents.filter((e) => want.has(e.relayEventId))
            .map((e) => [e.relayEventId, e.type]),
        );
      },
    },
  };
}

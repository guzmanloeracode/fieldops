import type { ApiKeyRecord, ApiKeyRepo } from "../services/api-key-types";
import type { Store } from "../services/types";
import type { MemoryData } from "./memory-store";

/** API keys in memory (PLT-02). `hashes` maps token hashes to key ids, like the unique index. */
export interface MemoryPlatform {
  apiKeys: (ApiKeyRecord & { tokenHash: string })[];
}

export function memoryPlatform(data: MemoryData, uuid: () => string): Pick<Store, "apiKeys"> {
  const state: MemoryPlatform = (data.platform ??= { apiKeys: [] });
  const strip = ({ tokenHash: _hash, ...k }: ApiKeyRecord & { tokenHash: string }): ApiKeyRecord => ({
    ...k,
  });
  const memberName = (id: string) => data.members.find((m) => m.id === id)?.name ?? "";
  const apiKeys: ApiKeyRepo = {
    async list() {
      return [...state.apiKeys].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map(strip);
    },
    async get(id) {
      const k = state.apiKeys.find((x) => x.id === id);
      return k ? strip(k) : null;
    },
    async countActive(now) {
      return state.apiKeys.filter((k) => !k.revokedAt && (!k.expiresAt || k.expiresAt > now)).length;
    },
    async create(d) {
      if (state.apiKeys.some((k) => k.tokenHash === d.tokenHash)) throw new Error("duplicate token hash");
      const k = {
        id: uuid(),
        memberId: d.memberId,
        memberName: memberName(d.memberId),
        name: d.name,
        prefix: d.prefix,
        tokenHash: d.tokenHash,
        scopes: [...d.scopes],
        createdAt: new Date(),
        lastUsedAt: null,
        expiresAt: d.expiresAt,
        revokedAt: null,
      };
      state.apiKeys.push(k);
      return strip(k);
    },
    async revoke(id, now) {
      const k = state.apiKeys.find((x) => x.id === id);
      if (!k || k.revokedAt) return false;
      k.revokedAt = now;
      return true;
    },
  };
  return { apiKeys };
}

import "server-only";
import type { ApiKeyRecord } from "@fieldops/core";
import type { ApiKeyRepr } from "@fieldops/shared";

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export const toApiKeyDto = (k: ApiKeyRecord): ApiKeyRepr => ({
  id: k.id,
  name: k.name,
  prefix: k.prefix,
  scopes: k.scopes,
  created_by: { member_id: k.memberId, name: k.memberName },
  created_at: k.createdAt.toISOString(),
  last_used_at: iso(k.lastUsedAt),
  expires_at: iso(k.expiresAt),
  revoked_at: iso(k.revokedAt),
});

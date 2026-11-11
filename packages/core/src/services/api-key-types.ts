import type { ApiKeyScope } from "@fieldops/shared";

// API keys (PLT-02): the repository contract. The secret itself never reaches a repository: only its SHA-256 hash
// and the first characters for lists. Authentication by hash happens outside the tenant (api_key_authenticate()).

export interface ApiKeyRecord {
  id: string;
  /** The member the key acts as. */
  memberId: string;
  /** That member's name, for lists. */
  memberName: string;
  name: string;
  prefix: string;
  scopes: ApiKeyScope[];
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export interface ApiKeyCreateData {
  memberId: string;
  name: string;
  prefix: string;
  tokenHash: string;
  scopes: ApiKeyScope[];
  expiresAt: Date | null;
}

export interface ApiKeyRepo {
  /** Every key of the organization, newest first, revoked and expired ones included. */
  list(): Promise<ApiKeyRecord[]>;
  get(id: string): Promise<ApiKeyRecord | null>;
  /** Keys that are neither revoked nor expired at `now`. */
  countActive(now: Date): Promise<number>;
  create(data: ApiKeyCreateData): Promise<ApiKeyRecord>;
  /** Sets `revoked_at` unless it is already set; returns whether a key was changed. */
  revoke(id: string, now: Date): Promise<boolean>;
}

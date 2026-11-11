# ADR 023: API keys act as their creator, narrowed by scopes, with per-minute limits

**Status:** accepted · 2026-11-11 · implemented in 0.5

**Context.** Release 0.5 opens the REST API to integrations (PLT-02) and the MCP server (PLT-05). Until now every
request came from a signed-in member, whose role decided what it could do. A key needs an answer to "who is this?"
for permissions, row filtering and the audit log, must be revocable at once, must not be recoverable from a
database dump, and must not let a busy script crowd out everyone else (PLT-04).

**Decision.**

- **Who a key is.** A key belongs to an organization and acts as the member who created it, within that member's
  role, re-read on every request. Changing the member's role changes what the key can do; removing the member
  deletes their keys (foreign key cascade). Only owners and admins (`apiKeys.manage`) create and revoke keys, so
  a key never acts as a technician.
- **Scopes narrow, never widen.** `read` allows `GET` and `HEAD` (and the MCP server); `write` also allows
  `POST`, `PUT`, `PATCH` and `DELETE` and implies `read`. The method decides the scope, so a new route needs no
  scope declaration. AI endpoints are `POST` and so need `write`, which matches that they spend quota. A key never
  manages keys: `/api-keys` answers `403 session_required`, so a leaked key can't mint more.
- **Storage.** `fo_` + 40 base62 characters from the platform CSPRNG (about 238 bits). The database keeps the
  SHA-256 hex and the first 7 characters for lists; the secret is shown once. Keys may expire after 30, 90 or 365
  days; at most 20 are active per organization.
- **Lookup outside the tenant.** Authentication happens before the organization is known, so it can't go through
  the RLS policy. `api_key_authenticate(hash)` is a `SECURITY DEFINER` function that returns only the key's
  organization, member, user and scopes for an exact hash of a key that isn't revoked or expired, and records the
  last use at most once a minute. The web role keeps RLS on `api_key` for everything else; the unique index on the
  hash is one of two indexes that don't lead with `organization_id`.
- **Audit and logs.** Requests with a key run as the member, and the audit log's user agent reads
  `API key fo_xxxx… · <client>` so integration changes can be told apart. Request logs carry the key id.
- **Rate limits.** A fixed one-minute window in the existing `rate_limit` table, one upsert per authenticated
  request outside the tenant transaction: `api:key:<id>` (300 a minute) or `api:user:<id>` (600) for sessions,
  set by `API_KEY_RATE_LIMIT` and `API_USER_RATE_LIMIT` (0 turns one off). Demo accounts are shared by every
  visitor, so in the demo a session's window is per user and IP address. Every response carries
  `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`; past the limit, `429` with `Retry-After`. AI
  routes keep their own hourly and daily limits and send whichever of the two has fewer requests left.
  Unauthenticated requests aren't counted.

**Consequences.** Permissions, row-level security and the audit log work for keys without new code paths, since
a key is just another way to become a member. A key can't outlive its creator's membership, which is the safe
default but means an integration breaks when its creator leaves; organizations should create integration keys
from a long-lived admin account. Fixed windows allow a burst of up to twice the limit across a window boundary,
acceptable at these numbers; the cost is one small write per request, which the shared demo absorbs easily.
Service accounts, per-resource scopes and OAuth for third-party apps are later options.

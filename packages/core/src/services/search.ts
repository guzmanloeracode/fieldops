import { assertCan, seesOnlyAssigned } from "../domain/permissions";
import type { SearchHits } from "./insights-types";
import type { ServiceContext } from "./types";

// Command palette search (JOB-11). Technicians only find their assigned jobs and those jobs' customers and
// sites (TEC-05); the repository applies the same filter in SQL.

export const EMPTY_SEARCH: SearchHits = { jobs: [], customers: [], sites: [] };

export async function searchAll(ctx: ServiceContext, raw: string): Promise<SearchHits> {
  assertCan(ctx.actor, "jobs.view", { assigned: true });
  const q = raw.trim().replace(/\s+/g, " ").slice(0, 100);
  if (q.length < 2) return EMPTY_SEARCH;
  return ctx.store.search.search(q, {
    limit: 6,
    ...(seesOnlyAssigned(ctx.actor) ? { assignedMemberId: ctx.actor.memberId } : {}),
  });
}

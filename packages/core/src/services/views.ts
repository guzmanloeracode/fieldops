import { jobListQuerySchema, savedViewCreateSchema } from "@fieldops/shared";
import { NotFoundError, ValidationError } from "../domain/errors";
import { assertCan, can } from "../domain/permissions";
import type { SavedViewRecord } from "./insights-types";
import { parseInput } from "./validate";
import type { ServiceContext } from "./types";

// Saved views of the jobs table (JOB-04): a name for a set of URL filters, personal or shared with the office.

export const MAX_VIEWS_PER_MEMBER = 50;

/** Filters a view may store, in the order they are written back. Paging and cursors are left out. */
const VIEW_KEYS = [
  "q",
  "status",
  "priority",
  "technician",
  "service_type",
  "customer",
  "from",
  "to",
  "date_field",
  "unassigned",
  "revisit",
  "sort",
  "limit",
] as const;

/** Keeps only known, valid job filters from a query string and returns them normalized. */
export function normalizeViewQuery(query: string): string {
  const input = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  const kept = new URLSearchParams();
  for (const key of VIEW_KEYS) {
    const value = input.get(key)?.trim();
    if (value) kept.set(key, value);
  }
  const check = jobListQuerySchema.safeParse(Object.fromEntries(kept));
  if (!check.success) {
    throw new ValidationError("These filters can't be saved", [
      { path: "query", message: check.error.issues[0]?.message ?? "Invalid filters" },
    ]);
  }
  return kept.toString();
}

const visibleTo = (v: SavedViewRecord, memberId: string) => v.shared || v.memberId === memberId;

export async function listViews(ctx: ServiceContext, resource = "jobs") {
  assertCan(ctx.actor, "jobs.view", { assigned: true });
  return ctx.store.savedViews.list(resource, ctx.actor.memberId);
}

export async function createView(ctx: ServiceContext, raw: unknown) {
  assertCan(ctx.actor, "jobs.view", { assigned: true });
  const input = parseInput(savedViewCreateSchema, raw);
  if (input.shared) assertCan(ctx.actor, "views.share");
  const query = normalizeViewQuery(input.query);
  if ((await ctx.store.savedViews.countByMember(ctx.actor.memberId, "jobs")) >= MAX_VIEWS_PER_MEMBER) {
    throw new ValidationError(`You can keep up to ${MAX_VIEWS_PER_MEMBER} views`, [
      { path: "name", message: "Delete a view first" },
    ]);
  }
  return ctx.store.savedViews.create({
    memberId: ctx.actor.memberId,
    resource: "jobs",
    name: input.name,
    query,
    shared: input.shared,
  });
}

/** Members delete their own views; owners and admins can also remove shared views of others. */
export async function deleteView(ctx: ServiceContext, id: string) {
  const view = await ctx.store.savedViews.get(id);
  if (!view || !visibleTo(view, ctx.actor.memberId)) throw new NotFoundError("View");
  if (view.memberId !== ctx.actor.memberId) assertCan(ctx.actor, "org.update");
  await ctx.store.savedViews.remove(view.id);
}

/** Whether the actor may delete this view (for showing the delete button). */
export function canDeleteView(ctx: Pick<ServiceContext, "actor">, view: SavedViewRecord): boolean {
  return view.memberId === ctx.actor.memberId || (view.shared && can(ctx.actor, "org.update"));
}

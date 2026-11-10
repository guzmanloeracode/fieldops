import { organizationUpdateSchema, serviceTypeInputSchema, serviceTypeUpdateSchema, type Role } from "@fieldops/shared";
import { ConflictError, DemoRestrictedError, NotFoundError } from "../domain/errors";
import { assertCan, canChangeRole } from "../domain/permissions";
import { ForbiddenError } from "../domain/errors";
import { parseInput } from "./validate";
import type { ServiceContext } from "./types";

export async function getOrganization(ctx: ServiceContext) {
  return ctx.store.organization.get();
}

export async function updateOrganization(ctx: ServiceContext, raw: unknown) {
  assertCan(ctx.actor, "org.update");
  const input = parseInput(organizationUpdateSchema, raw);
  return ctx.store.organization.update({
    ...(input.name !== undefined && { name: input.name }),
    ...(input.timezone !== undefined && { timezone: input.timezone }),
    ...(input.currency !== undefined && { currency: input.currency }),
    ...(input.country !== undefined && { country: input.country }),
    ...(input.brand_color !== undefined && { brandColor: input.brand_color ?? null }),
    ...(input.address !== undefined && { address: input.address ?? null }),
    ...(input.business_hours !== undefined && { businessHours: input.business_hours }),
    ...(input.tax_rates !== undefined && { taxRates: input.tax_rates }),
  });
}

// ------------------------------------------------------------------ members (SET-02)

export async function listMembers(ctx: ServiceContext) {
  assertCan(ctx.actor, "members.view");
  return ctx.store.members.list();
}

/** Technicians and office staff who can be assigned to jobs. Open to everyone who can assign. */
export async function listAssignableMembers(ctx: ServiceContext) {
  assertCan(ctx.actor, "jobs.assign");
  return (await ctx.store.members.list()).filter((m) => m.role === "technician" || m.role === "dispatcher" || m.role === "owner" || m.role === "admin");
}

export async function changeMemberRole(ctx: ServiceContext, memberId: string, role: Role) {
  const member = await ctx.store.members.get(memberId);
  if (!member) throw new NotFoundError("Member");
  if (!canChangeRole(ctx.actor, member.role, role)) throw new ForbiddenError();
  if (ctx.demo && member.isDemo) throw new DemoRestrictedError("Demo accounts keep their roles");
  if (member.role === "owner" && role !== "owner" && (await ctx.store.members.countByRole("owner")) <= 1) {
    throw new ConflictError("An organization needs at least one owner");
  }
  await ctx.store.members.updateRole(memberId, role);
}

export async function removeMember(ctx: ServiceContext, memberId: string) {
  assertCan(ctx.actor, "members.remove");
  const member = await ctx.store.members.get(memberId);
  if (!member) throw new NotFoundError("Member");
  if (member.role === "owner" && ctx.actor.role !== "owner") throw new ForbiddenError();
  if (member.id === ctx.actor.memberId) throw new ConflictError("You can't remove yourself");
  if (ctx.demo && member.isDemo) throw new DemoRestrictedError("Demo accounts can't be removed");
  if (member.role === "owner" && (await ctx.store.members.countByRole("owner")) <= 1) {
    throw new ConflictError("An organization needs at least one owner");
  }
  await ctx.store.members.remove(memberId);
}

// ------------------------------------------------------------------ service types (FIN-01, minimal)

export async function listServiceTypes(ctx: ServiceContext, opts?: { includeInactive?: boolean }) {
  assertCan(ctx.actor, "serviceTypes.view");
  return ctx.store.serviceTypes.list(opts);
}

export async function createServiceType(ctx: ServiceContext, raw: unknown) {
  assertCan(ctx.actor, "serviceTypes.manage");
  const input = parseInput(serviceTypeInputSchema, raw);
  const org = await ctx.store.organization.get();
  return ctx.store.serviceTypes.create({
    name: input.name,
    description: input.description ?? null,
    defaultDurationMin: input.default_duration_min,
    defaultPriceMinor: input.default_price_minor,
    currency: org.currency,
    color: input.color ?? null,
    active: input.active,
  });
}

export async function updateServiceType(ctx: ServiceContext, id: string, raw: unknown) {
  assertCan(ctx.actor, "serviceTypes.manage");
  const input = parseInput(serviceTypeUpdateSchema, raw);
  const updated = await ctx.store.serviceTypes.update(id, {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.description !== undefined && { description: input.description ?? null }),
    ...(input.default_duration_min !== undefined && { defaultDurationMin: input.default_duration_min }),
    ...(input.default_price_minor !== undefined && { defaultPriceMinor: input.default_price_minor }),
    ...(input.color !== undefined && { color: input.color ?? null }),
    ...(input.active !== undefined && { active: input.active }),
  });
  if (!updated) throw new NotFoundError("Service type");
  return updated;
}

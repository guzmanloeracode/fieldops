import {
  operationsSettingsSchema,
  organizationUpdateSchema,
  serviceTypeInputSchema,
  serviceTypeUpdateSchema,
  type Role,
} from "@fieldops/shared";
import { ConflictError, DemoRestrictedError, NotFoundError } from "../domain/errors";
import { assertCan, canChangeRole } from "../domain/permissions";
import { ForbiddenError } from "../domain/errors";
import { checkTaxRate } from "./billing-common";
import { parseInput } from "./validate";
import type { OrganizationRecord, ServiceContext } from "./types";

export async function getOrganization(ctx: ServiceContext) {
  return ctx.store.organization.get();
}

export async function updateOrganization(ctx: ServiceContext, raw: unknown) {
  assertCan(ctx.actor, "org.update");
  const input = parseInput(organizationUpdateSchema, raw);
  // The customers' language lives in the settings JSON next to the other organization settings.
  const settings =
    input.locale !== undefined
      ? { ...(await ctx.store.organization.get()).settings, locale: input.locale }
      : undefined;
  return ctx.store.organization.update({
    ...(input.name !== undefined && { name: input.name }),
    ...(input.timezone !== undefined && { timezone: input.timezone }),
    ...(input.currency !== undefined && { currency: input.currency }),
    ...(input.country !== undefined && { country: input.country }),
    ...(input.brand_color !== undefined && { brandColor: input.brand_color ?? null }),
    ...(input.address !== undefined && { address: input.address ?? null }),
    ...(input.business_hours !== undefined && { businessHours: input.business_hours }),
    ...(input.tax_rates !== undefined && { taxRates: input.tax_rates }),
    ...(settings && { settings }),
  });
}

// ------------------------------------------------------------------ operations (EXP-02, JOB-10)

/** Approval thresholds and the signature rule, in the organization's currency. Owners and admins. */
export async function getOperationsSettings(ctx: ServiceContext) {
  assertCan(ctx.actor, "settings.operations");
  const org = await ctx.store.organization.get();
  return operationsOf(org);
}

function operationsOf(org: OrganizationRecord) {
  return {
    currency: org.currency,
    approval: org.settings.approval,
    requireSignature: org.settings.requireSignature,
  };
}

export async function updateOperationsSettings(ctx: ServiceContext, raw: unknown) {
  assertCan(ctx.actor, "settings.operations");
  const input = parseInput(operationsSettingsSchema, raw);
  const current = await ctx.store.organization.get();
  const org = await ctx.store.organization.update({
    settings: {
      ...current.settings,
      approval: {
        autoApproveBelowMinor: input.auto_approve_below_minor,
        dispatcherLimitMinor: input.dispatcher_limit_minor,
      },
      requireSignature: input.require_signature,
    },
  });
  return operationsOf(org);
}

// ------------------------------------------------------------------ members (SET-02)

export async function listMembers(ctx: ServiceContext) {
  assertCan(ctx.actor, "members.view");
  return ctx.store.members.list();
}

/** Technicians and office staff who can be assigned to jobs. Open to everyone who can assign. */
export async function listAssignableMembers(ctx: ServiceContext) {
  assertCan(ctx.actor, "jobs.assign");
  return (await ctx.store.members.list()).filter(
    (m) => m.role === "technician" || m.role === "dispatcher" || m.role === "owner" || m.role === "admin",
  );
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
  checkTaxRate(org, input.tax_rate_bps);
  return ctx.store.serviceTypes.create({
    name: input.name,
    description: input.description ?? null,
    defaultDurationMin: input.default_duration_min,
    defaultPriceMinor: input.default_price_minor,
    currency: org.currency,
    color: input.color ?? null,
    active: input.active,
    requiredSkills: [...new Set(input.required_skills)],
    checklistTemplate: input.checklist_template,
    taxRateBps: input.tax_rate_bps ?? null,
  });
}

export async function updateServiceType(ctx: ServiceContext, id: string, raw: unknown) {
  assertCan(ctx.actor, "serviceTypes.manage");
  const input = parseInput(serviceTypeUpdateSchema, raw);
  if (input.tax_rate_bps !== undefined) checkTaxRate(await ctx.store.organization.get(), input.tax_rate_bps);
  const updated = await ctx.store.serviceTypes.update(id, {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.description !== undefined && { description: input.description ?? null }),
    ...(input.default_duration_min !== undefined && { defaultDurationMin: input.default_duration_min }),
    ...(input.default_price_minor !== undefined && { defaultPriceMinor: input.default_price_minor }),
    ...(input.required_skills !== undefined && { requiredSkills: [...new Set(input.required_skills)] }),
    ...(input.checklist_template !== undefined && { checklistTemplate: input.checklist_template }),
    ...(input.color !== undefined && { color: input.color ?? null }),
    ...(input.active !== undefined && { active: input.active }),
    ...(input.tax_rate_bps !== undefined && { taxRateBps: input.tax_rate_bps }),
  });
  if (!updated) throw new NotFoundError("Service type");
  return updated;
}

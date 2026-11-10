import type {
  MemberRecord,
  MemberRepo,
  OrganizationRecord,
  OrganizationSettings,
  OrganizationRepo,
  ServiceTypeRecord,
  ServiceTypeRepo,
} from "@fieldops/core";
import {
  DEFAULT_AI_SETTINGS,
  DEFAULT_APPROVAL_THRESHOLDS,
  DEFAULT_BILLING_SETTINGS,
  DEFAULT_LOCALE,
  LOCALES,
  type Locale,
  type Address,
  type ChecklistTemplateItem,
  type Currency,
  type Role,
} from "@fieldops/shared";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { member, organization, serviceType, user } from "../schema";
import { definedOnly } from "./util";

interface StoredSettings {
  approval?: { auto_approve_below_minor?: number; dispatcher_limit_minor?: number };
  require_signature?: boolean;
  ai?: { enabled?: boolean; monthly_quota?: number };
  billing?: {
    payment_terms_days?: number;
    quote_validity_days?: number;
    labor_rate_minor?: number;
    invoice_prefix?: string;
    quote_prefix?: string;
    reminders_enabled?: boolean;
    payment_instructions?: string | null;
  };
  locale?: string;
  [key: string]: unknown;
}

/** Reads the settings JSON (snake_case) and fills in defaults. */
export function toSettings(raw: unknown, currency: Currency): OrganizationSettings {
  const s = (raw ?? {}) as StoredSettings;
  const d = DEFAULT_APPROVAL_THRESHOLDS[currency] ?? DEFAULT_APPROVAL_THRESHOLDS.USD;
  const b = DEFAULT_BILLING_SETTINGS[currency] ?? DEFAULT_BILLING_SETTINGS.USD;
  return {
    approval: {
      autoApproveBelowMinor: s.approval?.auto_approve_below_minor ?? d.autoApproveBelowMinor,
      dispatcherLimitMinor: s.approval?.dispatcher_limit_minor ?? d.dispatcherLimitMinor,
    },
    requireSignature: s.require_signature ?? false,
    ai: {
      enabled: s.ai?.enabled ?? DEFAULT_AI_SETTINGS.enabled,
      monthlyQuota: s.ai?.monthly_quota ?? DEFAULT_AI_SETTINGS.monthlyQuota,
    },
    billing: {
      paymentTermsDays: s.billing?.payment_terms_days ?? b.paymentTermsDays,
      quoteValidityDays: s.billing?.quote_validity_days ?? b.quoteValidityDays,
      laborRateMinor: s.billing?.labor_rate_minor ?? b.laborRateMinor,
      invoicePrefix: s.billing?.invoice_prefix ?? b.invoicePrefix,
      quotePrefix: s.billing?.quote_prefix ?? b.quotePrefix,
      remindersEnabled: s.billing?.reminders_enabled ?? b.remindersEnabled,
      paymentInstructions: s.billing?.payment_instructions ?? null,
    },
    locale: LOCALES.includes(s.locale as Locale) ? (s.locale as Locale) : DEFAULT_LOCALE,
  };
}

function fromSettings(settings: OrganizationSettings, existing: unknown): StoredSettings {
  return {
    ...((existing ?? {}) as StoredSettings),
    approval: {
      auto_approve_below_minor: settings.approval.autoApproveBelowMinor,
      dispatcher_limit_minor: settings.approval.dispatcherLimitMinor,
    },
    require_signature: settings.requireSignature,
    ai: { enabled: settings.ai.enabled, monthly_quota: settings.ai.monthlyQuota },
    billing: {
      payment_terms_days: settings.billing.paymentTermsDays,
      quote_validity_days: settings.billing.quoteValidityDays,
      labor_rate_minor: settings.billing.laborRateMinor,
      invoice_prefix: settings.billing.invoicePrefix,
      quote_prefix: settings.billing.quotePrefix,
      reminders_enabled: settings.billing.remindersEnabled,
      payment_instructions: settings.billing.paymentInstructions,
    },
    locale: settings.locale,
  };
}

export function toOrganization(r: typeof organization.$inferSelect): OrganizationRecord {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    logo: r.logo,
    timezone: r.timezone,
    currency: r.currency as Currency,
    country: r.country,
    brandColor: r.brandColor,
    address: (r.address as Address | null) ?? null,
    businessHours: r.businessHours as OrganizationRecord["businessHours"],
    taxRates: r.taxRates as OrganizationRecord["taxRates"],
    settings: toSettings(r.settings, r.currency as Currency),
    isDemo: r.isDemo,
  };
}

export function organizationRepo(tx: Tx, orgId: string): OrganizationRepo {
  return {
    async get() {
      const [r] = await tx.select().from(organization).where(eq(organization.id, orgId));
      if (!r) throw new Error("Organization not found");
      return toOrganization(r);
    },
    async update(patch) {
      const { settings, ...rest } = patch;
      let storedSettings: StoredSettings | undefined;
      if (settings) {
        const [cur] = await tx
          .select({ settings: organization.settings })
          .from(organization)
          .where(eq(organization.id, orgId));
        storedSettings = fromSettings(settings, cur?.settings);
      }
      const [r] = await tx
        .update(organization)
        .set(definedOnly({ ...rest, settings: storedSettings, updatedAt: new Date() }))
        .where(eq(organization.id, orgId))
        .returning();
      return toOrganization(r!);
    },
  };
}

export function memberRepo(tx: Tx, orgId: string): MemberRepo {
  const select = () =>
    tx
      .select({
        id: member.id,
        userId: member.userId,
        name: user.name,
        email: user.email,
        role: member.role,
        isDemo: user.isDemo,
        skills: member.skills,
        workingHours: member.workingHours,
        phone: member.phone,
        createdAt: member.createdAt,
      })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId));
  const map = (r: Awaited<ReturnType<ReturnType<typeof select>["execute"]>>[number]) => ({
    ...r,
    role: r.role as Role,
    workingHours: (r.workingHours as MemberRecord["workingHours"]) ?? null,
  });
  return {
    async list() {
      const rows = await select()
        .where(eq(member.organizationId, orgId))
        .orderBy(
          sql`case ${member.role} when 'owner' then 0 when 'admin' then 1 when 'dispatcher' then 2 else 3 end`,
          asc(user.name),
        );
      return rows.map(map);
    },
    async get(memberId) {
      const [r] = await select().where(and(eq(member.organizationId, orgId), eq(member.id, memberId)));
      return r ? map(r) : null;
    },
    async updateRole(memberId, role) {
      await tx
        .update(member)
        .set({ role })
        .where(and(eq(member.organizationId, orgId), eq(member.id, memberId)));
    },
    async remove(memberId) {
      await tx.delete(member).where(and(eq(member.organizationId, orgId), eq(member.id, memberId)));
    },
    async countByRole(role) {
      const [r] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(member)
        .where(and(eq(member.organizationId, orgId), eq(member.role, role)));
      return r?.n ?? 0;
    },
  };
}

function toServiceType(r: typeof serviceType.$inferSelect): ServiceTypeRecord {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    defaultDurationMin: r.defaultDurationMin,
    defaultPriceMinor: r.defaultPriceMinor,
    currency: r.currency as Currency,
    color: r.color,
    active: r.active,
    requiredSkills: r.requiredSkills,
    checklistTemplate: (r.checklistTemplate as ChecklistTemplateItem[]) ?? [],
    taxRateBps: r.taxRateBps,
  };
}

export function serviceTypeRepo(tx: Tx, orgId: string): ServiceTypeRepo {
  const scope = eq(serviceType.organizationId, orgId);
  return {
    async list(opts) {
      const rows = await tx
        .select()
        .from(serviceType)
        .where(and(scope, opts?.includeInactive ? undefined : eq(serviceType.active, true)))
        .orderBy(asc(serviceType.name));
      return rows.map(toServiceType);
    },
    async get(id) {
      const [r] = await tx
        .select()
        .from(serviceType)
        .where(and(scope, eq(serviceType.id, id)));
      return r ? toServiceType(r) : null;
    },
    async create(data) {
      const [r] = await tx
        .insert(serviceType)
        .values({ organizationId: orgId, ...data })
        .returning();
      return toServiceType(r!);
    },
    async update(id, patch) {
      const [r] = await tx
        .update(serviceType)
        .set(definedOnly({ ...patch, updatedAt: new Date() }))
        .where(and(scope, eq(serviceType.id, id)))
        .returning();
      return r ? toServiceType(r) : null;
    },
  };
}

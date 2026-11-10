import "server-only";
import { audit, formatJobNumber, formatMoney, type AuditEntryRecord } from "@fieldops/core";
import { AUDIT_ENTITY_TYPES, type Currency } from "@fieldops/shared";
import { formatDateTime, intlLocale } from "@/lib/format";

// Plain-language rendering of audit entries, shared by the viewer and the CSV export (AUD-03).

type T = (key: string, values?: Record<string, string>) => string;

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const MAX_VALUE = 160;

export function entityName(t: T, type: string): string {
  return (AUDIT_ENTITY_TYPES as readonly string[]).includes(type) ? t(`entities.${type}`) : type;
}

/** "updated job", "signed in", … */
export function describeAction(t: T, e: Pick<AuditEntryRecord, "action" | "entityType">): string {
  const op = audit.auditOperation(e.action);
  if (["insert", "update", "delete", "sign_in", "sign_out"].includes(op)) {
    return t(`action.${op}`, { entity: entityName(t, e.entityType) });
  }
  return t("action.other", { action: e.action });
}

/** The person, the customer portal (requests customers sent) or "System". */
export function actorLabel(t: T, e: AuditEntryRecord): string {
  if (e.actorName) return e.actorName;
  if (e.entityType === "job" && e.after?.source === "portal" && e.action.endsWith(".insert")) {
    return t("customerPortal");
  }
  return t("system");
}

export function formatValue(
  t: T,
  field: string,
  value: unknown,
  ctx: { timeZone: string; currency: Currency; locale?: string },
): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? t("yes") : t("no");
  if (typeof value === "number" && field.endsWith("_minor")) {
    return formatMoney({ amountMinor: value, currency: ctx.currency }, ctx.locale && intlLocale(ctx.locale));
  }
  if (typeof value === "string" && ISO.test(value)) return formatDateTime(value, ctx.timeZone, ctx.locale);
  if (Array.isArray(value) && value.every((v) => typeof v !== "object")) {
    return value.length ? value.join(", ") : "—";
  }
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE - 1)}…` : text;
}

/** Where an entry's record lives in the app, when it has a page. */
export function entityHref(e: AuditEntryRecord): string | null {
  const ref = (k: string) => {
    const v = e.after?.[k] ?? e.before?.[k];
    return typeof v === "string" ? v : null;
  };
  if (e.job) return `/jobs/${formatJobNumber(e.job.number)}`;
  switch (e.entityType) {
    case "customer":
      return e.entityId ? `/customers/${e.entityId}` : null;
    case "contact":
    case "site":
      return ref("customer_id") ? `/customers/${ref("customer_id")}` : null;
    case "equipment":
      return e.entityId ? `/equipment/${e.entityId}` : null;
    case "member":
    case "invitation":
      return "/settings/members";
    case "service_type":
      return "/settings/service-types";
    case "sla_policy":
      return "/settings/sla";
    case "organization":
      return "/settings/organization";
    case "time_off":
      return "/schedule/team";
    default:
      return null;
  }
}

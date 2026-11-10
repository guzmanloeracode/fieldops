import {
  documentSendSchema,
  quoteCreateSchema,
  quoteDecisionSchema,
  quoteUpdateSchema,
  type QuoteDecision,
  type QuoteLineInput,
  type QuoteListQuery,
} from "@fieldops/shared";
import { isQuoteEditable, isQuoteExpired } from "../domain/billing";
import { addDays } from "../domain/date-range";
import { ConflictError, NotFoundError, PreconditionFailedError, ValidationError } from "../domain/errors";
import { formatYearlyNumber } from "../domain/numbering";
import { assertCan } from "../domain/permissions";
import {
  UUID,
  checkContact,
  checkLineRefs,
  checkSite,
  customerLocale,
  dateText,
  moneyText,
  portalPath,
  priceLines,
  recipientFor,
  requireCustomer,
  todayIn,
  totalsPatch,
  type BillingDeps,
} from "./billing-common";
import type { BillingContext, NewQuoteLine, QuoteLineRecord, QuotePatch, QuoteView } from "./billing-types";
import { itemsFromTemplate } from "./checklist";
import { notify, usersWithRoles } from "./notify";
import { slaForNewJob } from "./sla";
import { parseInput } from "./validate";
import type { ServiceContext } from "./types";

// Quotes (FIN-02): drafted by the office, sent to a contact, approved or declined by the customer (in the portal,
// or recorded by staff on their behalf). An approval creates a New job like createJob.

function toLines(lines: readonly QuoteLineInput[]) {
  return lines.map((l) => ({
    kind: l.kind,
    catalogItemId: l.catalog_item_id ?? null,
    serviceTypeId: l.service_type_id ?? null,
    description: l.description,
    quantity: l.quantity,
    unit: l.unit ?? null,
    unitPriceMinor: l.unit_price_minor,
    taxRateBps: l.tax_rate_bps,
  }));
}

/** Stored lines → the amounts needed to price them again (after a discount change). */
function storedToLines(lines: readonly QuoteLineRecord[]) {
  return lines.map(({ id: _id, position: _p, netMinor: _n, taxMinor: _t, ...rest }) => rest);
}

export async function listQuotes(ctx: ServiceContext, query: QuoteListQuery) {
  assertCan(ctx.actor, "billing.manage");
  return ctx.store.billing.listQuotes(query);
}

/** Loads a quote by id or number ("QUO-2026-0042"). */
export async function getQuote(ctx: ServiceContext, idOrNumber: string): Promise<QuoteView> {
  assertCan(ctx.actor, "billing.manage");
  const quote = UUID.test(idOrNumber)
    ? await ctx.store.billing.getQuote(idOrNumber)
    : await ctx.store.billing.getQuoteByNumber(idOrNumber.trim().toUpperCase());
  if (!quote) throw new NotFoundError("Quote");
  return quote;
}

export async function createQuote(ctx: ServiceContext, raw: unknown): Promise<QuoteView> {
  assertCan(ctx.actor, "billing.manage");
  const input = parseInput(quoteCreateSchema, raw);
  const store = ctx.store;
  await requireCustomer(store, input.customer_id);
  await checkSite(store, input.customer_id, input.site_id);
  await checkContact(store, input.customer_id, input.contact_id);
  if (input.service_type_id && !(await store.serviceTypes.get(input.service_type_id))) {
    throw new ValidationError("Unknown service type", [
      { path: "service_type_id", message: "Unknown service type" },
    ]);
  }
  await checkLineRefs(store, input.lines);
  const org = await store.organization.get();
  const today = todayIn(org, ctx.now);
  const discount = {
    type: input.discount_type ?? null,
    value: input.discount_type ? input.discount_value : 0,
  };
  const priced = priceLines(toLines(input.lines), discount);
  const year = Number(today.slice(0, 4));
  const n = await store.billing.nextCounter(`quote:${year}`);
  const created = await store.billing.createQuote(
    {
      number: formatYearlyNumber(org.settings.billing.quotePrefix, year, n),
      customerId: input.customer_id,
      siteId: input.site_id,
      contactId: input.contact_id ?? null,
      serviceTypeId: input.service_type_id ?? null,
      title: input.title,
      notes: input.notes ?? null,
      status: "draft",
      currency: org.currency,
      discountType: discount.type,
      discountValue: discount.value,
      ...totalsPatch(priced.totals),
      validUntil: input.valid_until ?? addDays(today, org.settings.billing.quoteValidityDays),
      createdBy: ctx.actor.userId,
    },
    priced.lines,
  );
  return (await store.billing.getQuote(created.id))!;
}

/** Edits a draft. Lines, when given, replace every line; totals are computed again. */
export async function updateQuote(
  ctx: ServiceContext,
  id: string,
  raw: unknown,
  expectedVersion?: number,
): Promise<QuoteView> {
  const input = parseInput(quoteUpdateSchema, raw);
  const quote = await getQuote(ctx, id);
  if (expectedVersion !== undefined && quote.version !== expectedVersion) throw new PreconditionFailedError();
  if (!isQuoteEditable(quote.status)) {
    throw new ConflictError("Only draft quotes can be edited. Revise the quote first.");
  }
  const store = ctx.store;
  if (input.site_id !== undefined) await checkSite(store, quote.customerId, input.site_id);
  if (input.contact_id !== undefined) await checkContact(store, quote.customerId, input.contact_id);
  if (input.service_type_id && !(await store.serviceTypes.get(input.service_type_id))) {
    throw new ValidationError("Unknown service type", [
      { path: "service_type_id", message: "Unknown service type" },
    ]);
  }
  if (input.lines) await checkLineRefs(store, input.lines);

  const patch: QuotePatch = {};
  if (input.site_id !== undefined) patch.siteId = input.site_id;
  if (input.contact_id !== undefined) patch.contactId = input.contact_id;
  if (input.service_type_id !== undefined) patch.serviceTypeId = input.service_type_id;
  if (input.title !== undefined) patch.title = input.title;
  if (input.notes !== undefined) patch.notes = input.notes ?? null;
  if (input.valid_until !== undefined) patch.validUntil = input.valid_until;
  const repriced =
    input.lines !== undefined || input.discount_type !== undefined || input.discount_value !== undefined;
  let lines: NewQuoteLine[] | null = null;
  if (repriced) {
    const type = input.discount_type !== undefined ? input.discount_type : quote.discountType;
    const value = type ? (input.discount_value ?? quote.discountValue) : 0;
    const priced = priceLines(input.lines ? toLines(input.lines) : storedToLines(quote.lines), {
      type,
      value,
    });
    Object.assign(patch, { discountType: type, discountValue: value, ...totalsPatch(priced.totals) });
    if (input.lines) lines = priced.lines;
  }
  const updated = await store.billing.updateQuote(quote.id, patch, {
    expectedVersion: quote.version,
    fromStatuses: ["draft"],
  });
  if (!updated) throw new PreconditionFailedError();
  if (lines) await store.billing.replaceQuoteLines(quote.id, lines);
  return (await store.billing.getQuote(quote.id))!;
}

/**
 * Sends a draft quote to its contact (or the one given) with a link to the customer portal, or sends a sent quote
 * again. The quote needs at least one line and a validity date that hasn't passed.
 */
export async function sendQuote(ctx: BillingContext, id: string, raw: unknown = {}): Promise<QuoteView> {
  const input = parseInput(documentSendSchema, raw ?? {});
  const quote = await getQuote(ctx, id);
  if (quote.status !== "draft" && quote.status !== "sent") {
    throw new ConflictError(`A ${quote.status} quote can't be sent. Duplicate it to send a new one.`);
  }
  if (quote.lines.length === 0) {
    throw new ValidationError("Add at least one line before sending the quote", [
      { path: "lines", message: "Add at least one line" },
    ]);
  }
  const org = await ctx.store.organization.get();
  const today = todayIn(org, ctx.now);
  if (quote.validUntil && quote.validUntil < today) {
    throw new ValidationError("The quote's validity date has passed", [
      { path: "valid_until", message: "Choose a date from today on" },
    ]);
  }
  const to = await recipientFor(ctx.store, quote.customerId, input.contact_id ?? quote.contactId);
  if (!to) {
    throw new ValidationError("Choose a contact with an email address", [
      { path: "contact_id", message: "Choose a contact with an email address" },
    ]);
  }
  const updated = await ctx.store.billing.updateQuote(
    quote.id,
    { status: "sent", sentAt: ctx.now, contactId: to.id },
    { expectedVersion: quote.version, fromStatuses: ["draft", "sent"] },
  );
  if (!updated) throw new PreconditionFailedError();
  const customer = await ctx.store.customers.get(quote.customerId);
  const locale = customerLocale(customer, org);
  await ctx.customerMailer?.send({
    kind: "quote_sent",
    to: to.email,
    contactName: to.name,
    organizationName: org.name,
    locale,
    path: portalPath(org, "quotes", quote.id),
    number: quote.number,
    title: quote.title,
    total: moneyText(quote.totalMinor, quote.currency, locale),
    validUntil: dateText(quote.validUntil, locale),
  });
  return (await ctx.store.billing.getQuote(quote.id))!;
}

/** Takes a sent or expired quote back to draft so it can be edited; it must be sent again before a decision. */
export async function reviseQuote(ctx: ServiceContext, id: string): Promise<QuoteView> {
  const quote = await getQuote(ctx, id);
  if (quote.status !== "sent" && quote.status !== "expired") {
    throw new ConflictError(`A ${quote.status} quote can't be revised`);
  }
  const updated = await ctx.store.billing.updateQuote(
    quote.id,
    { status: "draft" },
    { expectedVersion: quote.version, fromStatuses: ["sent", "expired"] },
  );
  if (!updated) throw new PreconditionFailedError();
  return (await ctx.store.billing.getQuote(quote.id))!;
}

/** A new draft with the same customer, site, lines and discount, valid for the usual period from today. */
export async function duplicateQuote(ctx: ServiceContext, id: string): Promise<QuoteView> {
  const quote = await getQuote(ctx, id);
  return createQuote(ctx, {
    customer_id: quote.customerId,
    site_id: quote.siteId ?? undefined,
    contact_id: quote.contactId,
    service_type_id: quote.serviceTypeId,
    title: quote.title,
    notes: quote.notes ?? "",
    discount_type: quote.discountType,
    discount_value: quote.discountValue,
    lines: quote.lines.map((l) => ({
      kind: l.kind,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit ?? "",
      unit_price_minor: l.unitPriceMinor,
      tax_rate_bps: l.taxRateBps,
      catalog_item_id: l.catalogItemId,
      service_type_id: l.serviceTypeId,
    })),
  });
}

/** Who decided: the customer's contact in the portal, or a staff member recording it on their behalf. */
export type QuoteDecider =
  { kind: "staff"; userId: string; name: string } | { kind: "contact"; contactId: string; name: string };

/** Staff record the customer's decision (given by phone or in person). */
export async function decideQuote(ctx: ServiceContext, id: string, raw: unknown): Promise<QuoteView> {
  const input = parseInput(quoteDecisionSchema, raw);
  const quote = await getQuote(ctx, id);
  return applyQuoteDecision(ctx, quote, input, {
    kind: "staff",
    userId: ctx.actor.userId,
    name: ctx.actor.name,
  });
}

/** Lines as a plain-text job description: "2 × Filter (each)". */
export function describeQuoteLines(quote: Pick<QuoteView, "number" | "notes" | "lines">): string {
  const lines = quote.lines.map((l) => `- ${l.quantity} × ${l.description}${l.unit ? ` (${l.unit})` : ""}`);
  return [`Quoted work (${quote.number}):`, ...lines, ...(quote.notes ? ["", quote.notes] : [])].join("\n");
}

/**
 * Records a decision on a sent quote, once (race-safe): an approval creates a New job (source "quote") with the
 * quote's customer, site, service type and title, its lines as the description, and SLA deadlines and checklist
 * like createJob; a decline keeps the reason. Office roles are notified (never the person who recorded it). The
 * customer portal calls this with a contact as the decider.
 */
export async function applyQuoteDecision(
  deps: BillingDeps,
  quote: QuoteView,
  input: QuoteDecision,
  by: QuoteDecider,
): Promise<QuoteView> {
  const { store, now } = deps;
  const org = await store.organization.get();
  if (isQuoteExpired(quote, todayIn(org, now))) {
    throw new ConflictError("This quote has expired. Revise it and send it again.");
  }
  if (quote.status !== "sent") {
    throw new ConflictError(
      quote.status === "draft"
        ? "Send the quote before recording a decision"
        : `This quote is already ${quote.status}`,
    );
  }
  const approve = input.decision === "approve";
  const decided = await store.billing.updateQuote(
    quote.id,
    {
      status: approve ? "approved" : "declined",
      decidedAt: now,
      decidedByUserId: by.kind === "staff" ? by.userId : null,
      decidedByContactId: by.kind === "contact" ? by.contactId : null,
      declineReason: approve ? null : (input.reason ?? null),
    },
    { fromStatuses: ["sent"] },
  );
  if (!decided) throw new ConflictError("This quote has already been decided");

  let job: { id: string; number: number } | null = null;
  if (approve) {
    job = await createJobFromQuote(deps, quote, by.kind === "staff" ? by.userId : null);
    await store.billing.updateQuote(quote.id, { jobId: job.id });
  }
  const recipients = await usersWithRoles(store, ["owner", "admin", "dispatcher"]);
  await notify(
    { store, mailer: deps.mailer },
    {
      event: "quote_decided",
      userIds: recipients,
      exceptUserId: by.kind === "staff" ? by.userId : null,
      payload: {
        quote_id: quote.id,
        quote_number: quote.number,
        customer_name: quote.customer.name,
        actor_name: by.name,
        decision: approve ? "approved" : "declined",
        ...(job ? { job_id: job.id, job_number: job.number } : {}),
      },
    },
  );
  return (await store.billing.getQuote(quote.id))!;
}

/** The job an approved quote creates: the same rules as createJob (SLA deadlines, checklist from the template). */
async function createJobFromQuote(
  deps: BillingDeps,
  quote: QuoteView,
  createdBy: string | null,
): Promise<{ id: string; number: number }> {
  const { store } = deps;
  const serviceTypeId =
    quote.serviceTypeId ?? quote.lines.find((l) => l.serviceTypeId)?.serviceTypeId ?? null;
  const st = serviceTypeId ? await store.serviceTypes.get(serviceTypeId) : null;
  const siteId = quote.siteId ?? (await store.sites.listByCustomer(quote.customerId))[0]?.id;
  if (!siteId) throw new ConflictError("The customer needs a site before the quote can become a job");
  const number = await store.jobs.nextNumber();
  const job = await store.jobs.create({
    number,
    customerId: quote.customerId,
    siteId,
    equipmentId: null,
    serviceTypeId: st?.id ?? null,
    title: quote.title,
    description: describeQuoteLines(quote),
    priority: "normal",
    source: "quote",
    preferredStart: null,
    preferredEnd: null,
    estimatedDurationMin: st?.defaultDurationMin ?? null,
    aiDrafted: false,
    needsReview: false,
    createdBy,
    ...(await slaForNewJob(deps, "normal")),
  });
  await store.jobs.addEvent({
    jobId: job.id,
    type: "created",
    fromStatus: null,
    toStatus: "new",
    actorUserId: createdBy,
    payload: { source: "quote", quote_id: quote.id, quote_number: quote.number },
  });
  if (st) await store.checklist.replace(job.id, itemsFromTemplate(st.checklistTemplate));
  return { id: job.id, number };
}

/** The quote a job came from (job page). */
export async function quoteForJob(ctx: ServiceContext, jobId: string) {
  assertCan(ctx.actor, "billing.manage");
  return ctx.store.billing.quoteForJob(jobId);
}

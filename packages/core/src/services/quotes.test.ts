import { describe, expect, it } from "vitest";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from "../domain/errors";
import { billingWorld, type BillingWorld } from "../test/billing-world";
import * as catalog from "./catalog";
import * as quotes from "./quotes";

const line = (over: Record<string, unknown> = {}) => ({
  kind: "service",
  description: "AC repair",
  quantity: 1,
  unit_price_minor: 18900,
  tax_rate_bps: 825,
  ...over,
});

async function draft(w: BillingWorld, over: Record<string, unknown> = {}) {
  return quotes.createQuote(w.ctx(w.dispatcher), {
    customer_id: w.customerId,
    site_id: w.siteId,
    contact_id: w.caraContactId,
    service_type_id: w.serviceTypeId,
    title: "Replace the condenser fan",
    lines: [
      line(),
      line({ kind: "part", description: "Fan motor", quantity: 2, unit: "each", unit_price_minor: 4550 }),
    ],
    ...over,
  });
}

async function sent(w: BillingWorld) {
  const q = await draft(w);
  return quotes.sendQuote(w.bctx(w.dispatcher), q.id);
}

describe("createQuote", () => {
  it("numbers quotes per year, prices the lines and defaults the validity", async () => {
    const w = billingWorld();
    const q = await draft(w);
    expect(q.number).toBe("QUO-2026-0001");
    expect(q.status).toBe("draft");
    expect(q.subtotalMinor).toBe(18900 + 9100);
    expect(q.taxMinor).toBe(1559 + 751);
    expect(q.totalMinor).toBe(28000 + 2310);
    expect(q.lines.map((l) => [l.position, l.netMinor])).toEqual([
      [0, 18900],
      [1, 9100],
    ]);
    expect(q.validUntil).toBe("2026-12-10");
    expect(q.createdBy).toBe(w.dispatcher.userId);
    expect(q.customer.name).toBe("Cara Customer");
    expect(q.contact?.email).toBe("cara@example.com");
    expect((await draft(w)).number).toBe("QUO-2026-0002");
  });

  it("uses the organization's prefix and applies a discount", async () => {
    const w = billingWorld();
    w.data.org.settings.billing.quotePrefix = "EST";
    const q = await draft(w, { discount_type: "percent", discount_value: 1000, valid_until: "2026-11-30" });
    expect(q.number).toBe("EST-2026-0001");
    expect(q.discountMinor).toBe(2800);
    expect(q.validUntil).toBe("2026-11-30");
    expect(q.totalMinor).toBe(28000 - 2800 + q.taxMinor);
  });

  it("ignores a discount value without a type", async () => {
    const w = billingWorld();
    const q = await draft(w, { discount_type: null, discount_value: 500 });
    expect(q.discountValue).toBe(0);
    expect(q.discountMinor).toBe(0);
  });

  it("is for office roles only", async () => {
    const w = billingWorld();
    await expect(
      quotes.createQuote(w.ctx(w.tom), { customer_id: w.customerId, site_id: w.siteId, title: "x" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(quotes.listQuotes(w.ctx(w.tom), { limit: 10 })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("checks the customer, site, contact, service type and line references", async () => {
    const w = billingWorld();
    await expect(draft(w, { customer_id: "00000000-0000-4000-8000-00000000ffff" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(draft(w, { site_id: w.otherSiteId })).rejects.toThrow(/site/);
    await expect(draft(w, { contact_id: w.otherContactId })).rejects.toThrow(/contact/);
    await expect(draft(w, { service_type_id: "00000000-0000-4000-8000-00000000ffff" })).rejects.toThrow(
      /service type/,
    );
    await expect(
      draft(w, { lines: [line({ catalog_item_id: "00000000-0000-4000-8000-00000000ffff" })] }),
    ).rejects.toThrow(/catalog item/);
    await expect(
      draft(w, { lines: [line({ service_type_id: "00000000-0000-4000-8000-00000000ffff" })] }),
    ).rejects.toThrow(/service type/);
  });

  it("accepts lines that name a catalog item and a service type", async () => {
    const w = billingWorld();
    const item = await catalog.createCatalogItem(w.ctx(w.owner), {
      name: "Capacitor",
      unit_price_minor: 3900,
    });
    const q = await draft(w, {
      lines: [line({ service_type_id: w.serviceTypeId }), line({ kind: "part", catalog_item_id: item.id })],
    });
    expect(q.lines[1]!.catalogItemId).toBe(item.id);
  });
});

describe("getQuote and listQuotes", () => {
  it("finds a quote by id or number and lists with filters", async () => {
    const w = billingWorld();
    const q = await draft(w);
    expect((await quotes.getQuote(w.ctx(w.admin), q.id)).id).toBe(q.id);
    expect((await quotes.getQuote(w.ctx(w.admin), " quo-2026-0001 ")).id).toBe(q.id);
    await expect(quotes.getQuote(w.ctx(w.admin), "QUO-2026-0099")).rejects.toBeInstanceOf(NotFoundError);
    const list = await quotes.listQuotes(w.ctx(w.admin), { limit: 10, page: 1, status: ["draft"], q: "fan" });
    expect(list.total).toBe(1);
    const none = await quotes.listQuotes(w.ctx(w.admin), { limit: 10, status: ["approved"] });
    expect(none.rows).toHaveLength(0);
  });
});

describe("updateQuote", () => {
  it("edits a draft and prices new lines", async () => {
    const w = billingWorld();
    const q = await draft(w);
    const u = await quotes.updateQuote(
      w.ctx(w.dispatcher),
      q.id,
      {
        title: "New title",
        notes: "Includes a 1-year warranty",
        valid_until: "2026-12-31",
        site_id: w.siteId,
        contact_id: null,
        service_type_id: null,
        lines: [line({ unit_price_minor: 10000, tax_rate_bps: 0 })],
      },
      q.version,
    );
    expect(u.title).toBe("New title");
    expect(u.notes).toBe("Includes a 1-year warranty");
    expect(u.contactId).toBeNull();
    expect(u.serviceTypeId).toBeNull();
    expect(u.lines).toHaveLength(1);
    expect(u.totalMinor).toBe(10000);
    expect(u.version).toBe(q.version + 1);
  });

  it("prices the stored lines again when only the discount changes", async () => {
    const w = billingWorld();
    const q = await draft(w);
    const u = await quotes.updateQuote(w.ctx(w.dispatcher), q.id, {
      discount_type: "amount",
      discount_value: 1000,
    });
    expect(u.discountMinor).toBe(1000);
    expect(u.lines).toHaveLength(2);
    const v = await quotes.updateQuote(w.ctx(w.dispatcher), q.id, { discount_value: 2000 });
    expect(v.discountMinor).toBe(2000);
    const none = await quotes.updateQuote(w.ctx(w.dispatcher), q.id, { discount_type: null });
    expect(none.discountMinor).toBe(0);
    expect(none.discountValue).toBe(0);
  });

  it("rejects stale versions, non-drafts and bad references", async () => {
    const w = billingWorld();
    const q = await draft(w);
    await expect(quotes.updateQuote(w.ctx(w.dispatcher), q.id, { title: "x" }, 99)).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
    await expect(
      quotes.updateQuote(w.ctx(w.dispatcher), q.id, {
        service_type_id: "00000000-0000-4000-8000-00000000ffff",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      quotes.updateQuote(w.ctx(w.dispatcher), q.id, { contact_id: w.otherContactId }),
    ).rejects.toBeInstanceOf(ValidationError);
    await quotes.sendQuote(w.bctx(w.dispatcher), q.id);
    await expect(quotes.updateQuote(w.ctx(w.dispatcher), q.id, { title: "x" })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("reports a concurrent change as a failed precondition", async () => {
    const w = billingWorld();
    const q = await draft(w);
    const original = w.store.billing.updateQuote;
    w.store.billing.updateQuote = async () => null;
    await expect(quotes.updateQuote(w.ctx(w.dispatcher), q.id, { title: "x" })).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
    w.store.billing.updateQuote = original;
  });
});

describe("sendQuote", () => {
  it("sends a draft to its contact with a portal link", async () => {
    const w = billingWorld();
    const q = await sent(w);
    expect(q.status).toBe("sent");
    expect(q.sentAt).toEqual(new Date("2026-11-10T09:00:00Z"));
    expect(w.emails).toHaveLength(1);
    expect(w.emails[0]).toMatchObject({
      kind: "quote_sent",
      to: "cara@example.com",
      contactName: "Cara",
      organizationName: "Acme",
      locale: "en",
      path: `/portal/acme/quotes/${q.id}`,
      number: "QUO-2026-0001",
      total: "$303.10",
      validUntil: "Dec 10, 2026",
    });
  });

  it("can be sent again, to another contact, in the customer's language", async () => {
    const w = billingWorld();
    w.data.customers[0]!.locale = "id";
    const q = await sent(w);
    w.data.contacts.push({
      id: "00000000-0000-4000-8000-0000000000c2",
      customerId: w.customerId,
      name: "Budi",
      role: null,
      email: "budi@example.com",
      phone: null,
      isPrimary: false,
      emailNorm: "budi@example.com",
      phoneNorm: null,
    });
    const again = await quotes.sendQuote(w.bctx(w.dispatcher), q.id, {
      contact_id: "00000000-0000-4000-8000-0000000000c2",
    });
    expect(again.contactId).toBe("00000000-0000-4000-8000-0000000000c2");
    expect(w.emails[1]).toMatchObject({ to: "budi@example.com", locale: "id" });
    expect(w.emails[1]!.kind === "quote_sent" && w.emails[1]!.total).toBe("US$303,10");
  });

  it("falls back to the primary contact and works without a mailer", async () => {
    const w = billingWorld();
    const q = await draft(w, { contact_id: null });
    const s = await quotes.sendQuote(w.ctx(w.dispatcher), q.id, undefined);
    expect(s.contactId).toBe(w.caraContactId);
  });

  it("needs lines, a contact with an email and a validity date that hasn't passed", async () => {
    const w = billingWorld();
    const empty = await draft(w, { lines: [] });
    await expect(quotes.sendQuote(w.bctx(w.dispatcher), empty.id)).rejects.toThrow(/at least one line/);
    const noEmail = await draft(w, { contact_id: w.noEmailContactId });
    await expect(quotes.sendQuote(w.bctx(w.dispatcher), noEmail.id)).rejects.toThrow(/email/);
    const old = await draft(w, { valid_until: "2026-11-01" });
    await expect(quotes.sendQuote(w.bctx(w.dispatcher), old.id)).rejects.toThrow(/validity/);
    await expect(
      quotes.sendQuote(w.bctx(w.dispatcher), old.id, { contact_id: w.otherContactId }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("doesn't send decided quotes or stale versions", async () => {
    const w = billingWorld();
    const q = await sent(w);
    await quotes.decideQuote(w.ctx(w.dispatcher), q.id, { decision: "decline", reason: "Too expensive" });
    await expect(quotes.sendQuote(w.bctx(w.dispatcher), q.id)).rejects.toBeInstanceOf(ConflictError);
    const d = await draft(w);
    const original = w.store.billing.updateQuote;
    w.store.billing.updateQuote = async () => null;
    await expect(quotes.sendQuote(w.bctx(w.dispatcher), d.id)).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
    w.store.billing.updateQuote = original;
  });
});

describe("reviseQuote and duplicateQuote", () => {
  it("takes a sent or expired quote back to draft", async () => {
    const w = billingWorld();
    const q = await sent(w);
    const r = await quotes.reviseQuote(w.ctx(w.dispatcher), q.id);
    expect(r.status).toBe("draft");
    await expect(quotes.reviseQuote(w.ctx(w.dispatcher), q.id)).rejects.toBeInstanceOf(ConflictError);
    await quotes.sendQuote(w.bctx(w.dispatcher), q.id);
    w.billing().quotes[0]!.status = "expired";
    expect((await quotes.reviseQuote(w.ctx(w.dispatcher), q.id)).status).toBe("draft");
    const original = w.store.billing.updateQuote;
    await quotes.sendQuote(w.bctx(w.dispatcher), q.id);
    w.store.billing.updateQuote = async () => null;
    await expect(quotes.reviseQuote(w.ctx(w.dispatcher), q.id)).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
    w.store.billing.updateQuote = original;
  });

  it("duplicates a quote as a new draft", async () => {
    const w = billingWorld();
    const q = await draft(w, { notes: "Note", discount_type: "amount", discount_value: 500 });
    await quotes.sendQuote(w.bctx(w.dispatcher), q.id);
    await quotes.decideQuote(w.ctx(w.dispatcher), q.id, { decision: "decline", reason: "Later" });
    const copy = await quotes.duplicateQuote(w.ctx(w.dispatcher), q.id);
    expect(copy.number).toBe("QUO-2026-0002");
    expect(copy.status).toBe("draft");
    expect(copy.lines).toHaveLength(2);
    expect(copy.totalMinor).toBe(q.totalMinor);
    expect(copy.notes).toBe("Note");
  });
});

describe("decideQuote", () => {
  it("creates a New job from an approved quote, like createJob", async () => {
    const w = billingWorld();
    const q = await sent(w);
    const approved = await quotes.decideQuote(w.ctx(w.dispatcher), q.id, { decision: "approve" });
    expect(approved.status).toBe("approved");
    expect(approved.decidedByUserId).toBe(w.dispatcher.userId);
    expect(approved.decidedByName).toBe("Dan Dispatcher");
    expect(approved.job).not.toBeNull();
    const job = (await w.store.jobs.get(approved.jobId!))!;
    expect(job).toMatchObject({
      status: "new",
      source: "quote",
      customerId: w.customerId,
      siteId: w.siteId,
      serviceTypeId: w.serviceTypeId,
      title: "Replace the condenser fan",
      estimatedDurationMin: 120,
      priority: "normal",
    });
    expect(job.description).toContain("Quoted work (QUO-2026-0001):");
    expect(job.description).toContain("- 2 × Fan motor (each)");
    expect(job.resolutionDueAt).not.toBeNull();
    expect((await w.store.checklist.list(job.id)).map((i) => i.label)).toEqual(["Check filters"]);
    const events = await w.store.jobs.events(job.id);
    expect(events[0]!.payload).toMatchObject({ source: "quote", quote_number: "QUO-2026-0001" });
    expect((await quotes.quoteForJob(w.ctx(w.admin), job.id))?.id).toBe(q.id);

    const notified = w.notifications().filter((n) => n.type === "quote_decided");
    expect(notified.map((n) => n.userId).sort()).toEqual([w.owner.userId, w.admin.userId].sort());
    expect(notified[0]!.payload).toMatchObject({ decision: "approved", quote_number: "QUO-2026-0001" });
  });

  it("uses a line's service type, and needs a site for the job", async () => {
    const w = billingWorld();
    const q = await draft(w, { service_type_id: null, lines: [line({ service_type_id: w.serviceTypeId })] });
    await quotes.sendQuote(w.bctx(w.dispatcher), q.id);
    const a = await quotes.decideQuote(w.ctx(w.dispatcher), q.id, { decision: "approve" });
    expect((await w.store.jobs.get(a.jobId!))!.serviceTypeId).toBe(w.serviceTypeId);

    const plain = await draft(w, { service_type_id: null, lines: [line()], notes: "Thanks!" });
    await quotes.sendQuote(w.bctx(w.dispatcher), plain.id);
    w.billing().quotes.find((x) => x.id === plain.id)!.siteId = null;
    const b = await quotes.decideQuote(w.ctx(w.dispatcher), plain.id, { decision: "approve" });
    const job = (await w.store.jobs.get(b.jobId!))!;
    expect(job.siteId).toBe(w.siteId);
    expect(job.serviceTypeId).toBeNull();
    expect(job.description).toContain("Thanks!");

    const noSite = await draft(w);
    await quotes.sendQuote(w.bctx(w.dispatcher), noSite.id);
    const row = w.billing().quotes.find((x) => x.id === noSite.id)!;
    row.siteId = null;
    row.customerId = w.otherCustomerId;
    w.data.sites = w.data.sites.filter((s) => s.customerId !== w.otherCustomerId);
    await expect(quotes.decideQuote(w.ctx(w.dispatcher), noSite.id, { decision: "approve" })).rejects.toThrow(
      /needs a site/,
    );
  });

  it("keeps the reason of a decline and decides only once", async () => {
    const w = billingWorld();
    const q = await sent(w);
    await expect(
      quotes.decideQuote(w.ctx(w.dispatcher), q.id, { decision: "decline" }),
    ).rejects.toBeInstanceOf(ValidationError);
    const d = await quotes.decideQuote(w.ctx(w.dispatcher), q.id, {
      decision: "decline",
      reason: "Too expensive",
    });
    expect(d.status).toBe("declined");
    expect(d.declineReason).toBe("Too expensive");
    expect(d.jobId).toBeNull();
    await expect(quotes.decideQuote(w.ctx(w.dispatcher), q.id, { decision: "approve" })).rejects.toThrow(
      /already declined/,
    );
  });

  it("refuses drafts, expired quotes and lost races", async () => {
    const w = billingWorld();
    const d = await draft(w);
    await expect(quotes.decideQuote(w.ctx(w.dispatcher), d.id, { decision: "approve" })).rejects.toThrow(
      /Send the quote/,
    );
    await quotes.sendQuote(w.bctx(w.dispatcher), d.id);
    w.billing().quotes[0]!.validUntil = "2026-11-09";
    await expect(quotes.decideQuote(w.ctx(w.dispatcher), d.id, { decision: "approve" })).rejects.toThrow(
      /expired/,
    );
    w.billing().quotes[0]!.validUntil = "2026-11-10";
    const original = w.store.billing.updateQuote;
    w.store.billing.updateQuote = async () => null;
    await expect(quotes.decideQuote(w.ctx(w.dispatcher), d.id, { decision: "approve" })).rejects.toThrow(
      /already been decided/,
    );
    w.store.billing.updateQuote = original;
  });

  it("records a portal customer's decision and notifies every office role", async () => {
    const w = billingWorld();
    const q = await sent(w);
    const decided = await quotes.applyQuoteDecision(
      { store: w.store, now: new Date("2026-11-10T10:00:00Z") },
      await quotes.getQuote(w.ctx(w.owner), q.id),
      { decision: "approve", reason: null },
      { kind: "contact", contactId: w.caraContactId, name: "Cara" },
    );
    expect(decided.decidedByContactId).toBe(w.caraContactId);
    expect(decided.decidedByName).toBe("Cara");
    const job = (await w.store.jobs.get(decided.jobId!))!;
    expect(job.createdBy).toBeNull();
    const notified = w.notifications().filter((n) => n.type === "quote_decided");
    expect(notified).toHaveLength(3);
  });

  it("is for office roles", async () => {
    const w = billingWorld();
    const q = await sent(w);
    await expect(quotes.decideQuote(w.ctx(w.tom), q.id, { decision: "approve" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("describeQuoteLines", () => {
  it("lists the lines with their quantities and units", () => {
    expect(
      quotes.describeQuoteLines({
        number: "QUO-2026-0001",
        notes: null,
        lines: [
          { quantity: 1, description: "Service", unit: null } as never,
          { quantity: 2.5, description: "Pipe", unit: "m" } as never,
        ],
      }),
    ).toBe("Quoted work (QUO-2026-0001):\n- 1 × Service\n- 2.5 × Pipe (m)");
  });
});

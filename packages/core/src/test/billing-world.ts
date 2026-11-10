import type { CustomerEmail, CustomerMailer } from "../services/billing-types";
import type { NotificationMailer } from "../services/notification-types";
import * as jobs from "../services/jobs";
import { world } from "./fixtures";
import type { MemoryBilling } from "./memory-billing";
import { uuid } from "./memory-store";

/** The fixture world with tax rates, a second contact, a catalog part and mailers that record what they send. */
export function billingWorld() {
  const w = world();
  w.data.org.taxRates = [
    { name: "Sales tax", rate_bps: 825, default: true },
    { name: "Reduced", rate_bps: 500, default: false },
  ];
  w.data.serviceTypes[0]!.checklistTemplate = [
    { label: "Check filters", kind: "checkbox", unit: null, required: true },
  ];
  const noEmailContactId = uuid();
  w.data.contacts.push({
    id: noEmailContactId,
    customerId: w.customerId,
    name: "No Email",
    role: null,
    email: null,
    phone: null,
    isPrimary: false,
    emailNorm: null,
    phoneNorm: null,
  });
  const otherContactId = uuid();
  w.data.contacts.push({
    id: otherContactId,
    customerId: w.otherCustomerId,
    name: "Olga Other",
    role: null,
    email: "olga@example.com",
    phone: null,
    isPrimary: true,
    emailNorm: "olga@example.com",
    phoneNorm: null,
  });
  const caraContactId = w.data.contacts[0]!.id;

  const emails: CustomerEmail[] = [];
  const customerMailer: CustomerMailer = {
    async send(e) {
      emails.push(e);
    },
  };
  const staffEmails: Parameters<NotificationMailer["send"]>[0][] = [];
  const mailer: NotificationMailer = {
    async send(e) {
      staffEmails.push(e);
    },
  };
  const bctx = (m: typeof w.owner) => ({ ...w.ctx(m, { mailer }), customerMailer });
  const billing = () => (w.data as typeof w.data & { billing: MemoryBilling }).billing;
  const notifications = () => w.data.automate?.notifications ?? [];

  /** A completed job for the customer with work time and approved parts. */
  async function completedJob(opts: { serviceType?: boolean } = {}) {
    const job = await jobs.createJob(w.ctx(w.dispatcher), {
      customer_id: w.customerId,
      site_id: w.siteId,
      title: "AC not cooling",
      ...(opts.serviceType === false ? {} : { service_type_id: w.serviceTypeId }),
    });
    const row = w.data.jobs.find((j) => j.id === job.id)!;
    row.status = "completed";
    row.completedAt = new Date("2026-11-09T15:00:00Z");
    w.data.assignments.push({ jobId: job.id, memberId: w.tom.id, isLead: true });
    w.data.assignments.push({ jobId: job.id, memberId: w.rina.id, isLead: false });
    const at = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 9, h, m));
    await w.store.timeEntries.create({
      jobId: job.id,
      memberId: w.tom.id,
      kind: "work",
      startedAt: at(9),
      endedAt: at(10, 5),
      source: "status",
    });
    await w.store.timeEntries.create({
      jobId: job.id,
      memberId: w.tom.id,
      kind: "travel",
      startedAt: at(8),
      endedAt: at(9),
      source: "status",
    });
    await w.store.timeEntries.create({
      jobId: job.id,
      memberId: w.rina.id,
      kind: "work",
      startedAt: at(9),
      endedAt: at(9, 30),
      source: "status",
    });
    const part = await w.store.expenses.create({
      jobId: job.id,
      requesterMemberId: w.tom.id,
      kind: "part",
      item: "Capacitor 35/5 µF",
      quantity: 1,
      unitCostMinor: 2400,
      totalMinor: 2400,
      currency: "USD",
      supplier: null,
      reason: "Failed capacitor",
      receiptAttachmentId: null,
      status: "approved",
      autoApproved: true,
      decidedByMemberId: null,
      decidedAt: at(10),
      decisionComment: null,
    });
    const parking = await w.store.expenses.create({
      jobId: job.id,
      requesterMemberId: w.tom.id,
      kind: "expense",
      item: "Parking",
      quantity: 2,
      unitCostMinor: 500,
      totalMinor: 1000,
      currency: "USD",
      supplier: null,
      reason: "Downtown",
      receiptAttachmentId: null,
      status: "approved",
      autoApproved: true,
      decidedByMemberId: null,
      decidedAt: at(10),
      decisionComment: null,
    });
    const rejected = await w.store.expenses.create({
      jobId: job.id,
      requesterMemberId: w.tom.id,
      kind: "part",
      item: "Gold-plated fan",
      quantity: 1,
      unitCostMinor: 99_900,
      totalMinor: 99_900,
      currency: "USD",
      supplier: null,
      reason: "Shiny",
      receiptAttachmentId: null,
      status: "rejected",
      autoApproved: false,
      decidedByMemberId: w.owner.id,
      decidedAt: at(10),
      decisionComment: "No",
    });
    return { job: (await w.store.jobs.get(job.id))!, part, parking, rejected };
  }

  return {
    ...w,
    caraContactId,
    noEmailContactId,
    otherContactId,
    emails,
    staffEmails,
    mailer,
    customerMailer,
    bctx,
    billing,
    notifications,
    completedJob,
  };
}

export type BillingWorld = ReturnType<typeof billingWorld>;

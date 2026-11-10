import { describe, expect, it } from "vitest";
import { world } from "../test/fixtures";
import { opsState } from "../test/memory-ops";
import * as digest from "./digest";
import * as jobs from "./jobs";
import * as notifications from "./notifications";
import { notify } from "./notify";
import type { DigestMailer } from "./recurrence-types";

// The owner's daily digest (NOT-04). The memory organization is in UTC.

function mailer() {
  const sent: Parameters<DigestMailer["send"]>[0][] = [];
  return { sent, send: async (m: Parameters<DigestMailer["send"]>[0]) => void sent.push(m) };
}
const SEVEN = new Date("2026-11-10T07:20:00Z");

describe("daily digest (NOT-04)", () => {
  it("emails owners at 07:00 local time, once per day", async () => {
    const w = world();
    const m = mailer();
    expect(await digest.sendDailyDigests({ store: w.store, mailer: m, now: SEVEN })).toBe(1);
    expect(m.sent.map((s) => [s.recipient.userId, s.date, s.summary.date])).toEqual([
      [w.owner.userId, "2026-11-10", "2026-11-09"],
    ]);
    expect(await digest.sendDailyDigests({ store: w.store, mailer: m, now: SEVEN })).toBe(0);
    expect(opsState(w.data).digests).toEqual([{ userId: w.owner.userId, date: "2026-11-10", sentAt: SEVEN }]);
  });

  it("waits for 07:00 in the organization's time zone", async () => {
    const w = world();
    const m = mailer();
    w.data.org.timezone = "Asia/Jakarta";
    expect(await digest.sendDailyDigests({ store: w.store, mailer: m, now: SEVEN })).toBe(0);
    // 07:20 in Jakarta is 00:20 UTC.
    expect(
      await digest.sendDailyDigests({ store: w.store, mailer: m, now: new Date("2026-11-10T00:20:00Z") }),
    ).toBe(1);
    expect(await digest.sendDailyDigests({ store: w.store, now: SEVEN })).toBe(0);
  });

  it("follows the notification settings: admins opt in, owners may opt out", async () => {
    const w = world();
    const m = mailer();
    await notifications.updatePreferences(w.ctx(w.admin), {
      preferences: [{ event: "daily_digest", in_app: null, email: true }],
    });
    await notifications.updatePreferences(w.ctx(w.owner), {
      preferences: [{ event: "daily_digest", in_app: true, email: false }],
    });
    expect(await digest.sendDailyDigests({ store: w.store, mailer: m, now: SEVEN })).toBe(1);
    expect(m.sent[0]!.recipient).toMatchObject({ userId: w.admin.userId, role: "admin" });
    // Nobody left: no summary is computed.
    expect(await digest.sendDailyDigests({ store: w.store, mailer: m, now: SEVEN })).toBe(0);
  });

  it("summarizes yesterday and lists overdue jobs", async () => {
    const w = world();
    const m = mailer();
    const job = await jobs.createJob(w.ctx(w.dispatcher), {
      customer_id: w.customerId,
      site_id: w.siteId,
      title: "Leaking unit",
    });
    const record = w.data.jobs.find((j) => j.id === job.id)!;
    Object.assign(record, { createdAt: new Date("2026-11-09T10:00:00Z"), slaResolutionState: "breached" });
    opsState(w.data).pendingApprovals = 2;
    await digest.sendDailyDigests({ store: w.store, mailer: m, now: SEVEN });
    expect(m.sent[0]!.summary).toMatchObject({
      date: "2026-11-09",
      jobsCreated: 1,
      jobsCompleted: 0,
      overdueCount: 1,
      overdue: [{ id: job.id, number: job.number, title: "Leaking unit", customerName: "Cara Customer" }],
      pendingApprovals: 2,
      currency: "USD",
      invoicedMinor: 0,
    });
  });
});

describe("digest preferences (NOT-04)", () => {
  it("offers the digest by email only, on for owners and off for admins", async () => {
    const w = world();
    const owner = await notifications.getPreferences(w.ctx(w.owner));
    expect(owner.find((p) => p.event === "daily_digest")).toEqual({
      event: "daily_digest",
      inApp: null,
      email: true,
    });
    const admin = await notifications.getPreferences(w.ctx(w.admin));
    expect(admin.find((p) => p.event === "daily_digest")).toMatchObject({ inApp: null, email: false });
    const dispatcher = await notifications.getPreferences(w.ctx(w.dispatcher));
    expect(dispatcher.some((p) => p.event === "daily_digest")).toBe(false);
    // Saving stores false for the channel the event doesn't have.
    await notifications.updatePreferences(w.ctx(w.admin), {
      preferences: [{ event: "daily_digest", in_app: true, email: true }],
    });
    expect(w.data.automate!.notificationPreferences).toEqual([
      { userId: w.admin.userId, event: "daily_digest", inApp: false, email: true },
    ]);
  });

  it("never creates an in-app notification for an email-only event", async () => {
    const w = world();
    const n = await notify(
      { store: w.store },
      {
        event: "daily_digest",
        userIds: [w.owner.userId],
        payload: {},
      },
    );
    expect(n).toBe(0);
    expect(w.data.automate!.notifications).toEqual([]);
  });
});

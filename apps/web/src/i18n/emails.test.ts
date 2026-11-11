import { emailLocale, notificationCopy, renderEmail } from "@fieldops/email";
import { describe, expect, it } from "vitest";

// SET-05: emails read in the recipient's language; the email package keeps a dictionary per template.

describe("emails in the recipient's language", () => {
  it("renders the portal sign-in link in Indonesian, and in English by default", async () => {
    const props = { name: "Budi", organizationName: "Acme Teknik", url: "https://x.test/l", minutes: 15 };
    const id = await renderEmail({ kind: "portal.magic_link", to: "b@x.test", locale: "id", props });
    expect(id.subject).toBe("Tautan masuk Anda untuk Acme Teknik");
    expect(id.html).toContain('lang="id"');
    expect(id.text).toContain("Buka portal pelanggan");
    expect(id.text).toContain("selama 15 menit");
    const en = await renderEmail({ kind: "portal.magic_link", to: "b@x.test", props });
    expect(en.subject).toBe("Your sign-in link for Acme Teknik");
    expect(en.html).toContain('lang="en"');
  });

  it("renders account emails and invitations in Indonesian", async () => {
    const verify = await renderEmail({
      kind: "verify_email",
      to: "s@x.test",
      locale: "id",
      props: { name: "Siti", url: "https://x.test/v" },
    });
    expect(verify.subject).toBe("Konfirmasi email Anda untuk FieldOps");
    expect(verify.text).toContain("Halo Siti,");
    const reset = await renderEmail({
      kind: "reset_password",
      to: "s@x.test",
      locale: "id",
      props: { name: "Siti", url: "https://x.test/r" },
    });
    expect(reset.subject).toBe("Atur ulang kata sandi FieldOps Anda");
    const invite = await renderEmail({
      kind: "invitation",
      to: "a@x.test",
      locale: "id",
      props: {
        inviterName: "Siti",
        organizationName: "Acme Teknik",
        role: "technician",
        url: "https://x.test/i",
      },
    });
    expect(invite.subject).toBe("Siti mengundang Anda ke Acme Teknik di FieldOps");
    expect(invite.text).toContain("sebagai teknisi");
  });

  it("writes notifications in Indonesian with 24-hour times", async () => {
    const props = {
      event: "job_assigned" as const,
      payload: {
        job_number: 42,
        job_title: "Cuci AC",
        customer_name: "Ibu Rina",
        actor_name: "Budi",
        scheduled_start: "2026-05-07T07:30:00Z",
      },
      recipientName: "Agus",
      organizationName: "Acme Teknik",
      url: "https://x.test/jobs/JOB-000042",
      preferencesUrl: "https://x.test/notifications/preferences",
      timeZone: "Asia/Jakarta",
    };
    const id = await renderEmail({ kind: "notification", to: "agus@x.test", locale: "id", props });
    expect(id.subject).toBe("Pekerjaan baru JOB-000042: Cuci AC");
    expect(id.text).toContain("Budi menugaskan Anda ke Cuci AC untuk Ibu Rina pada Kam, 7 Mei");
    expect(id.text).toMatch(/14[.:]30/);
    expect(id.text).toContain("Atur email yang Anda terima");
    const en = await renderEmail({ kind: "notification", to: "agus@x.test", props });
    expect(en.subject).toBe("New job JOB-000042: Cuci AC");
  });

  it("has Indonesian copy for every notification event", () => {
    const events = [
      "job_assigned",
      "job_rescheduled",
      "portal_request",
      "sla_at_risk",
      "sla_breached",
      "expense_requested",
      "expense_decided",
      "quote_decided",
      "payment_received",
      "daily_digest",
    ] as const;
    for (const event of events) {
      for (const payload of [
        {},
        { decision: "rejected" as const, quote_number: "Q-1", target: "response" as const },
      ]) {
        const en = notificationCopy({ event, payload, timeZone: "UTC" });
        const id = notificationCopy({ event, payload, timeZone: "UTC", locale: "id" });
        expect(id.subject, event).toBeTruthy();
        expect(id.heading, event).not.toBe(en.heading);
        expect(id.cta, event).not.toBe(en.cta);
      }
    }
  });

  it("sends the owner's daily digest in their language", async () => {
    const props = {
      recipientName: "Siti",
      organizationName: "Acme Teknik",
      date: "2026-05-07",
      figures: {
        jobsCreated: 12,
        jobsCompleted: 9,
        slaMet: 8,
        slaMeasured: 9,
        firstVisit: 8,
        invoiced: "Rp1.250.000",
        collected: "Rp850.000",
      },
      overdue: [],
      overdueCount: 0,
      pendingApprovals: 1,
      urls: {
        dashboard: "https://x.test/d",
        overdue: "https://x.test/o",
        approvals: "https://x.test/a",
        preferences: "https://x.test/p",
      },
    };
    const id = await renderEmail({ kind: "daily_digest", to: "siti@x.test", locale: "id", props });
    expect(id.subject).toBe("Acme Teknik: ringkasan Anda untuk Kamis, 7 Mei");
    expect(id.text).toContain("Pekerjaan selesai");
    expect(id.text).toContain("(8 dari 9)");
    expect(id.text).toContain("1 pengajuan menunggu keputusan");
    const en = await renderEmail({ kind: "daily_digest", to: "siti@x.test", props });
    expect(en.subject).toBe("Acme Teknik: your summary for Thursday, May 7");
  });

  it("writes the billing notifications in Indonesian", () => {
    const approved = notificationCopy({
      event: "quote_decided",
      payload: { quote_number: "QUO-2026-0001", decision: "approved", job_number: 7, customer_name: "Budi" },
      timeZone: "UTC",
      locale: "id",
    });
    expect(approved.subject).toBe("Disetujui: QUO-2026-0001 untuk Budi");
    expect(approved.body).toContain("Sekarang menjadi JOB-000007");
    const paid = notificationCopy({
      event: "payment_received",
      payload: {
        amount: "Rp500.000",
        invoice_number: "INV-2026-0003",
        customer_name: "Budi",
        actor_name: "Siti",
      },
      timeZone: "UTC",
      locale: "id",
    });
    expect(paid.body).toBe("Budi membayar Rp500.000 untuk faktur INV-2026-0003. Dicatat oleh Siti.");
  });

  it("reads unknown locales as English", () => {
    expect(emailLocale("id")).toBe("id");
    expect(emailLocale("fr")).toBe("en");
    expect(emailLocale(null)).toBe("en");
  });
});

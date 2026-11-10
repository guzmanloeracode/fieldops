import { DEFAULT_APPROVAL_THRESHOLDS } from "@fieldops/shared";
import { and, eq, inArray } from "drizzle-orm";
import * as s from "../schema";
import type { SeedContext } from "./context";
import { extensionFaker } from "./context";
import { DAY, insertBatches } from "./time";

type AuditRow = typeof s.auditLog.$inferInsert;

/** Documentation address ranges (RFC 5737), so no seeded IP belongs to anyone. */
const IP_RANGES = ["192.0.2.", "198.51.100.", "203.0.113."];
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0",
];

/**
 * A plausible audit history for the last 7 days (AUD-01). The seed writes with the audit trigger off, so the log
 * would start empty after every reset; these rows mirror the seeded timeline (job changes and assignments by
 * dispatchers and technicians) and add customer and site edits, a role change, an operations-settings change
 * and staff sign-ins. Offset 8.
 */
export async function seedAudit(ctx: SeedContext): Promise<void> {
  const f = extensionFaker(ctx, 8);
  const { orgId, now, spec } = ctx;
  const since = new Date(now.getTime() - 7 * DAY);
  const rows: AuditRow[] = [];
  // Each person works from one or two devices.
  const devices = new Map<string, { ip: string; ua: string }[]>();
  const device = (userId: string, mobile = false) => {
    let list = devices.get(userId);
    if (!list) {
      list = [
        {
          ip: f.helpers.arrayElement(IP_RANGES) + f.number.int({ min: 2, max: 254 }),
          ua: mobile ? USER_AGENTS[f.number.int({ min: 2, max: 3 })]! : f.helpers.arrayElement(USER_AGENTS),
        },
      ];
      devices.set(userId, list);
    }
    return list[0]!;
  };
  const technicianUsers = new Set(ctx.members.filter((m) => m.role === "technician").map((m) => m.userId));
  const add = (r: Omit<AuditRow, "organizationId" | "ip" | "userAgent">) => {
    const d = r.actorUserId ? device(r.actorUserId, technicianUsers.has(r.actorUserId)) : null;
    rows.push({ organizationId: orgId, ip: d?.ip ?? null, userAgent: d?.ua ?? null, ...r });
  };

  // ------------------------------------------------------------ the timeline of recent jobs
  for (const j of ctx.jobs) {
    for (const e of j.events) {
      const at = e.createdAt!;
      if (at < since || at > now) continue;
      const actor = e.actorUserId ?? null;
      if (e.type === "created") {
        add({
          actorUserId: actor,
          action: "job.insert",
          entityType: "job",
          entityId: j.id,
          after: {
            number: j.number,
            title: j.title,
            status: "new",
            priority: j.priority,
            source: j.source,
            customer_id: j.customerId,
            site_id: j.siteId,
          },
          createdAt: at,
        });
      } else if (e.type === "assigned") {
        const p = e.payload as {
          member_ids?: string[];
          lead_member_id?: string;
          scheduled_start?: string;
          scheduled_end?: string;
        };
        for (const memberId of p.member_ids ?? []) {
          add({
            actorUserId: actor,
            action: "job_assignment.insert",
            entityType: "job_assignment",
            entityId: null,
            after: { job_id: j.id, member_id: memberId, is_lead: memberId === p.lead_member_id },
            createdAt: at,
          });
        }
        add({
          actorUserId: actor,
          action: "job.update",
          entityType: "job",
          entityId: j.id,
          before: { status: e.fromStatus ?? j.status, scheduled_start: null, scheduled_end: null },
          after: {
            status: e.toStatus ?? j.status,
            scheduled_start: p.scheduled_start ?? null,
            scheduled_end: p.scheduled_end ?? null,
          },
          createdAt: at,
        });
      } else if (e.type === "status_changed") {
        add({
          actorUserId: actor,
          action: "job.update",
          entityType: "job",
          entityId: j.id,
          before: { status: e.fromStatus, ...(e.toStatus === "completed" ? { completed_at: null } : {}) },
          after: {
            status: e.toStatus,
            ...(e.toStatus === "completed" ? { completed_at: at.toISOString() } : {}),
          },
          createdAt: at,
        });
      } else if (e.type === "note_added") {
        add({
          actorUserId: actor,
          action: "note.insert",
          entityType: "note",
          entityId: null,
          after: {
            job_id: j.id,
            visibility: (e.payload as { visibility?: string }).visibility ?? "internal",
          },
          createdAt: at,
        });
      }
    }
  }

  // ------------------------------------------------------------ office edits
  const office = ctx.members.filter((m) => m.role !== "technician");
  const owner = ctx.members.find((m) => m.role === "owner") ?? office[0]!;
  const recent = () => new Date(since.getTime() + f.number.int({ min: 1, max: 7 * 24 - 2 }) * 3600_000);
  const customers = f.helpers.arrayElements(ctx.customers, 6);
  const tags =
    spec.key === "acme-air" ? ["VIP", "Maintenance plan", "Commercial"] : ["Pelanggan tetap", "Kontrak"];
  for (const c of customers) {
    const tag = f.helpers.arrayElement(tags);
    add({
      actorUserId: f.helpers.arrayElement(office).userId,
      action: "customer.update",
      entityType: "customer",
      entityId: c.id,
      before: { tags: [] },
      after: { tags: [tag] },
      createdAt: recent(),
    });
  }
  const notes =
    spec.key === "acme-air"
      ? ["Gate code changed to 7314", "Call 15 minutes before arriving", "Use the loading dock entrance"]
      : ["Kode gerbang baru 7314", "Telepon 15 menit sebelum datang", "Masuk lewat pintu samping"];
  for (const site of f.helpers.arrayElements(ctx.sites, 4)) {
    add({
      actorUserId: f.helpers.arrayElement(office).userId,
      action: "site.update",
      entityType: "site",
      entityId: site.id,
      before: { access_notes: site.accessNotes ?? null },
      after: { access_notes: f.helpers.arrayElement(notes) },
      createdAt: recent(),
    });
  }

  // A technician promoted to dispatcher, and new skills for another, both by the owner.
  const dispatcher = ctx.members.find((m) => m.role === "dispatcher");
  if (dispatcher) {
    add({
      actorUserId: owner.userId,
      action: "member.update",
      entityType: "member",
      entityId: dispatcher.id,
      before: { role: "technician" },
      after: { role: "dispatcher" },
      createdAt: new Date(now.getTime() - 6 * DAY + 3 * 3600_000),
    });
  }
  const skilled = ctx.members.find((m) => m.role === "technician" && m.skills.length > 1);
  if (skilled) {
    add({
      actorUserId: owner.userId,
      action: "member.update",
      entityType: "member",
      entityId: skilled.id,
      before: { skills: skilled.skills.slice(0, -1) },
      after: { skills: skilled.skills },
      createdAt: new Date(now.getTime() - 4 * DAY + 2 * 3600_000),
    });
  }

  // The operations settings as they are now, after the owner raised the dispatcher limit.
  const t = DEFAULT_APPROVAL_THRESHOLDS[spec.currency];
  add({
    actorUserId: owner.userId,
    action: "organization.update",
    entityType: "organization",
    entityId: orgId,
    before: {
      settings: {
        approval: {
          auto_approve_below_minor: t.autoApproveBelowMinor,
          dispatcher_limit_minor: t.dispatcherLimitMinor / 2,
        },
      },
    },
    after: {
      settings: {
        approval: {
          auto_approve_below_minor: t.autoApproveBelowMinor,
          dispatcher_limit_minor: t.dispatcherLimitMinor,
        },
      },
    },
    createdAt: new Date(now.getTime() - 5 * DAY + 4 * 3600_000),
  });

  // ------------------------------------------------------------ sign-ins
  for (let day = 6; day >= 0; day--) {
    for (const m of ctx.members) {
      if (m.role === "technician" ? !f.datatype.boolean(0.8) : !f.datatype.boolean(0.9)) continue;
      const at = new Date(now.getTime() - day * DAY - f.number.int({ min: 1, max: 10 }) * 3600_000);
      if (at < since) continue;
      add({
        actorUserId: m.userId,
        action: "auth.sign_in",
        entityType: "user",
        entityId: m.userId,
        createdAt: at,
      });
    }
  }

  // Assignment rows carry their real ids where the assignment still exists.
  const assignedJobs = [
    ...new Set(
      rows
        .filter((r) => r.entityType === "job_assignment")
        .map((r) => (r.after as { job_id: string }).job_id),
    ),
  ];
  const assignmentIds = !assignedJobs.length
    ? []
    : await ctx.tx
        .select({ id: s.jobAssignment.id, jobId: s.jobAssignment.jobId, memberId: s.jobAssignment.memberId })
        .from(s.jobAssignment)
        .where(and(eq(s.jobAssignment.organizationId, orgId), inArray(s.jobAssignment.jobId, assignedJobs)));
  const byKey = new Map(assignmentIds.map((a) => [`${a.jobId}|${a.memberId}`, a.id]));
  for (const r of rows) {
    if (r.entityType !== "job_assignment") continue;
    const a = r.after as { job_id: string; member_id: string };
    r.entityId = byKey.get(`${a.job_id}|${a.member_id}`) ?? null;
  }

  rows.sort((a, b) => a.createdAt!.getTime() - b.createdAt!.getTime());
  await insertBatches(ctx.tx, s.auditLog, rows);
}

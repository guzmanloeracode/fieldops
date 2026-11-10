import {
  availability,
  recurrenceRules,
  slaClockStart,
  slaDeadlines,
  slaState,
  type WorkingHours,
} from "@fieldops/core";
import type { ChecklistTemplateItem, JobPriority, RecurrenceUnit } from "@fieldops/shared";
import { and, eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import * as s from "../schema";
import { extensionFaker, type SeedContext } from "./context";
import { DAY, insertBatches } from "./time";

// Maintenance plans (JOB-13), the SLA pause (SLA-04) and the digest log (NOT-04). Offset 11.
//
// One to three plans per commercial customer: quarterly AC service and the like. Most have run for a while, a
// few are paused or have ended, and each active plan has created the jobs of its visits within its lead days,
// as the generator would: unassigned, with the preferred window, the checklist and SLA deadlines that start on
// the visit date. Those jobs are numbered after the others and created by the latest generator run, so numbers
// keep following creation order. Jobs on hold for the customer get a paused resolution clock.

interface Template {
  title: string;
  description: string;
  serviceType: string;
  unit: RecurrenceUnit;
  count: number;
  window: [string, number];
  leadDays: number;
  priority: JobPriority;
}

const TEMPLATES: Record<SeedContext["spec"]["key"], Template[]> = {
  "acme-air": [
    {
      title: "Quarterly AC maintenance",
      description:
        "Maintenance contract visit: clean the coils, check refrigerant and drain lines, replace filters.",
      serviceType: "AC tune-up",
      unit: "month",
      count: 3,
      window: ["09:00", 120],
      leadDays: 14,
      priority: "normal",
    },
    {
      title: "Monthly filter replacement",
      description: "Replace the filters on every unit under the contract and note their condition.",
      serviceType: "Filter replacement",
      unit: "month",
      count: 1,
      window: ["08:00", 60],
      leadDays: 7,
      priority: "low",
    },
    {
      title: "Office cleaning every two weeks",
      description: "Recurring office cleaning after business hours. Keys are with building security.",
      serviceType: "Commercial cleaning",
      unit: "week",
      count: 2,
      window: ["18:00", 180],
      leadDays: 7,
      priority: "normal",
    },
    {
      title: "Annual duct cleaning",
      description: "Yearly duct cleaning under the service agreement.",
      serviceType: "Duct cleaning",
      unit: "year",
      count: 1,
      window: ["09:00", 240],
      leadDays: 30,
      priority: "low",
    },
    {
      title: "Spring and fall AC tune-up",
      description: "Twice-yearly tune-up before the cooling and heating seasons.",
      serviceType: "AC tune-up",
      unit: "month",
      count: 6,
      window: ["10:00", 90],
      leadDays: 21,
      priority: "normal",
    },
  ],
  "acme-teknik": [
    {
      title: "Cuci AC rutin 3 bulanan",
      description:
        "Kunjungan kontrak perawatan: cuci unit indoor dan outdoor, cek tekanan freon dan saluran pembuangan.",
      serviceType: "Cuci AC",
      unit: "month",
      count: 3,
      window: ["09:00", 120],
      leadDays: 14,
      priority: "normal",
    },
    {
      title: "Perawatan gedung bulanan",
      description: "Pemeriksaan bulanan semua unit AC gedung sesuai kontrak.",
      serviceType: "Perawatan gedung",
      unit: "month",
      count: 1,
      window: ["08:00", 240],
      leadDays: 10,
      priority: "normal",
    },
    {
      title: "Cuci AC bulanan",
      description: "Cuci AC rutin setiap bulan untuk area dengan debu tinggi.",
      serviceType: "Cuci AC",
      unit: "month",
      count: 1,
      window: ["10:00", 90],
      leadDays: 7,
      priority: "low",
    },
    {
      title: "Pengecekan freon 6 bulanan",
      description: "Cek tekanan freon dan kebocoran setiap enam bulan.",
      serviceType: "Isi freon",
      unit: "month",
      count: 6,
      window: ["13:00", 60],
      leadDays: 21,
      priority: "low",
    },
  ],
};

export async function seedRecurrences(ctx: SeedContext): Promise<void> {
  const f = extensionFaker(ctx, 11);
  const { tx, orgId, now } = ctx;
  const tz = ctx.timeZone;
  const today = availability.localDateOf(now, tz);
  const shift = (date: string, days: number) => availability.shiftDate(date, days);

  const [org] = await tx
    .select({ businessHours: s.organization.businessHours })
    .from(s.organization)
    .where(eq(s.organization.id, orgId));
  const businessHours = (org?.businessHours ?? []) as WorkingHours[];
  const policies = await tx.select().from(s.slaPolicy).where(eq(s.slaPolicy.organizationId, orgId));
  const templates = await tx
    .select({ id: s.serviceType.id, checklist: s.serviceType.checklistTemplate })
    .from(s.serviceType)
    .where(eq(s.serviceType.organizationId, orgId));
  const checklistOf = new Map(templates.map((t) => [t.id, (t.checklist ?? []) as ChecklistTemplateItem[]]));
  const stByName = new Map(ctx.serviceTypes.map((st) => [st.name, st]));
  const office = ctx.members.filter((m) => m.role === "owner" || m.role === "dispatcher");
  const technicians = ctx.members.filter((m) => m.role === "technician");

  // ------------------------------------------------------------ plans
  const plans: (typeof s.jobRecurrence.$inferInsert & { id: string; nextOn: string })[] = [];
  const due: { plan: (typeof plans)[number]; dates: string[] }[] = [];
  for (const customer of ctx.customers.filter((c) => c.commercial)) {
    const sites = ctx.sites.filter((x) => x.customerId === customer.id);
    const chosen = f.helpers.arrayElements(TEMPLATES[ctx.spec.key], f.number.int({ min: 1, max: 3 }));
    for (const tpl of chosen) {
      const st = stByName.get(tpl.serviceType)!;
      const site = f.helpers.arrayElement(sites);
      const units = ctx.equipment.filter((e) => e.siteId === site.id);
      const withEquipment = f.number.float({ min: 0, max: 1 }) < 0.5;
      const lead = f.number.float({ min: 0, max: 1 }) < 0.6;
      const startOffset = f.number.int({ min: -400, max: 45 });
      const roll = f.number.float({ min: 0, max: 1 });
      const qualified = technicians.filter((m) => st.requiredSkills.every((k) => m.skills.includes(k)));
      const leadMember = lead && qualified.length ? f.helpers.arrayElement(qualified) : null;
      const creator = f.helpers.arrayElement(office);
      const startsOn = shift(today, startOffset);
      const rule = { unit: tpl.unit, count: tpl.count, startsOn, endsOn: null as string | null };
      // About 6% ended (their last visit has passed), 8% paused, a few with an end date ahead.
      if (roll < 0.06 && startOffset < -120) rule.endsOn = shift(today, -f.number.int({ min: 1, max: 60 }));
      else if (roll > 0.85) rule.endsOn = shift(today, f.number.int({ min: 180, max: 720 }));
      const paused = roll >= 0.06 && roll < 0.14;
      const id = uuidv7();
      const nextFromToday = recurrenceRules.occurrenceAt(rule, recurrenceRules.indexOnOrAfter(rule, today));
      const horizon = shift(today, tpl.leadDays);
      const dates = paused ? [] : recurrenceRules.occurrencesBetween(rule, today, horizon);
      const nextOn = dates.length ? recurrenceRules.occurrenceAfter(rule, dates.at(-1)!) : nextFromToday;
      const createdAt = new Date(
        Math.min(now.getTime() - DAY, availability.zonedInstant(startsOn, 9 * 60, tz).getTime() - 7 * DAY),
      );
      const plan = {
        id,
        organizationId: orgId,
        customerId: customer.id,
        siteId: site.id,
        equipmentId: withEquipment && units.length ? units[0]!.id : null,
        serviceTypeId: st.id,
        title: tpl.title,
        description: tpl.description,
        priority: tpl.priority,
        intervalUnit: tpl.unit,
        intervalCount: tpl.count,
        startsOn,
        endsOn: rule.endsOn,
        windowStart: tpl.window[0],
        windowMinutes: tpl.window[1],
        leadDays: tpl.leadDays,
        nextOn,
        leadMemberId: leadMember?.id ?? null,
        active: !paused,
        createdBy: creator.userId,
        createdAt,
        updatedAt: createdAt,
      };
      plans.push(plan);
      if (dates.length) due.push({ plan, dates });
    }
  }
  await insertBatches(tx, s.jobRecurrence, plans);

  // ------------------------------------------------------------ the jobs the plans created
  const occurrences = due
    .flatMap(({ plan, dates }) => dates.map((date) => ({ plan, date })))
    .sort((a, b) => a.date.localeCompare(b.date) || a.plan.id.localeCompare(b.plan.id));
  const latest = Math.max(...ctx.jobs.map((j) => j.createdAt!.getTime()));
  let number = ctx.jobs.length;
  const items: (typeof s.checklistItem.$inferInsert)[] = [];
  const added: SeedContext["jobs"] = [];
  for (const [k, { plan, date }] of occurrences.entries()) {
    const createdAt = new Date(Math.min(latest + (k + 1) * 1000, now.getTime()));
    const policy = policies.find((p) => p.priority === plan.priority)!;
    const deadlines = slaDeadlines({
      createdAt: slaClockStart({ createdAt, occurrenceDate: date }, tz),
      policy,
      businessHours,
      timeZone: tz,
    });
    const start = availability.zonedInstant(date, availability.hhmmToMinutes(plan.windowStart!), tz);
    const st = ctx.serviceTypes.find((x) => x.id === plan.serviceTypeId)!;
    const id = uuidv7();
    number += 1;
    added.push({
      id,
      organizationId: orgId,
      number,
      customerId: plan.customerId,
      siteId: plan.siteId,
      equipmentId: plan.equipmentId,
      serviceTypeId: st.id,
      title: plan.title,
      description: plan.description,
      priority: plan.priority,
      status: "new",
      source: "recurring",
      preferredStart: start,
      preferredEnd: new Date(start.getTime() + plan.windowMinutes! * 60_000),
      estimatedDurationMin: st.defaultDurationMin,
      recurrenceId: plan.id,
      occurrenceDate: date,
      slaPolicyId: policy.id,
      ...deadlines,
      slaResponseState: slaState({
        dueAt: deadlines.responseDueAt,
        atRiskAt: deadlines.responseAtRiskAt,
        doneAt: null,
        now,
      }),
      slaResolutionState: slaState({
        dueAt: deadlines.resolutionDueAt,
        atRiskAt: deadlines.resolutionAtRiskAt,
        doneAt: null,
        now,
      }),
      createdBy: null,
      createdAt,
      updatedAt: createdAt,
      version: 1,
      events: [
        {
          organizationId: orgId,
          jobId: id,
          type: "created",
          fromStatus: null,
          toStatus: "new",
          actorUserId: null,
          payload: {
            source: "recurring",
            recurrence_id: plan.id,
            plan_title: plan.title,
            occurrence_date: date,
          },
          createdAt,
        },
      ],
      assignees: [],
    });
    for (const [position, t] of (checklistOf.get(st.id) ?? []).entries()) {
      items.push({
        organizationId: orgId,
        jobId: id,
        position,
        label: t.label,
        kind: t.kind,
        unit: t.unit ?? null,
        required: t.required,
        createdAt,
      });
    }
  }
  if (added.length) {
    await insertBatches(
      tx,
      s.job,
      added.map(({ events: _e, assignees: _a, ...row }) => row),
    );
    await insertBatches(
      tx,
      s.jobEvent,
      added.flatMap((j) => j.events),
    );
    await insertBatches(tx, s.checklistItem, items);
    await tx
      .update(s.orgCounter)
      .set({ value: number })
      .where(and(eq(s.orgCounter.organizationId, orgId), eq(s.orgCounter.name, "job")));
    ctx.jobs.push(...added);
  }

  // ------------------------------------------------------------ SLA-04: on hold for the customer
  // Every job waiting for the customer has its resolution clock paused since it went on hold, with the state it
  // had then and no alert raised after it. At least one per organization.
  const held = ctx.jobs.filter((j) => j.status === "on_hold");
  if (held.length && !held.some((j) => j.holdReason === "customer")) {
    const j = held[0]!;
    j.holdReason = "customer";
    const hold = j.events.find((e) => e.toStatus === "on_hold");
    if (hold) hold.payload = { ...(hold.payload as Record<string, unknown>), hold_reason: "customer" };
    await tx.execute(
      sql`update job set hold_reason = 'customer' where organization_id = ${orgId} and id = ${j.id}`,
    );
    await tx.execute(sql`
      update job_event set payload = payload || '{"hold_reason":"customer"}'::jsonb
       where organization_id = ${orgId} and job_id = ${j.id} and to_status = 'on_hold'`);
  }
  for (const j of ctx.jobs.filter((x) => x.status === "on_hold" && x.holdReason === "customer")) {
    const hold = j.events
      .filter((e) => e.toStatus === "on_hold")
      .sort((a, b) => b.createdAt!.getTime() - a.createdAt!.getTime())[0];
    const pausedAt = hold?.createdAt ?? now;
    await tx.execute(sql`
      update job set sla_paused_at = ${pausedAt}::timestamptz,
             sla_resolution_state = case when resolution_due_at is null then sla_resolution_state
               when ${pausedAt}::timestamptz > resolution_due_at then 'breached'
               when ${pausedAt}::timestamptz >= resolution_at_risk_at then 'at_risk' else 'on_track' end
       where organization_id = ${orgId} and id = ${j.id}`);
    await tx.execute(sql`
      delete from sla_alert where organization_id = ${orgId} and job_id = ${j.id} and target = 'resolution'
         and raised_at > ${pausedAt}::timestamptz`);
    // The timeline says the clock stopped (as the service records it).
    await tx.execute(sql`
      update job_event set payload = payload || '{"sla_paused":true}'::jsonb
       where organization_id = ${orgId} and job_id = ${j.id} and to_status = 'on_hold'
         and created_at = ${pausedAt}::timestamptz`);
  }

  // ------------------------------------------------------------ NOT-04: yesterday's digest
  const yesterday = shift(today, -1);
  const owners = ctx.members.filter((m) => m.role === "owner");
  if (owners.length) {
    await tx.insert(s.dailyDigest).values(
      owners.map((m) => ({
        organizationId: orgId,
        userId: m.userId,
        digestDate: yesterday,
        sentAt: availability.zonedInstant(yesterday, 7 * 60 + 2, tz),
      })),
    );
  }
}

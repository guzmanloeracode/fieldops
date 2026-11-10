import { availability, formatJobNumber } from "@fieldops/core";
import type { AssistantRecordRef, AssistantToolRun } from "@fieldops/shared";
import { v7 as uuidv7 } from "uuid";
import * as s from "../schema";
import { extensionFaker, type SeedContext } from "./context";
import { DAY } from "./time";

// Example Ask FieldOps conversations (AI-02): a few questions the demo dispatcher and owner asked in the past
// weeks, answered from the seeded data as it stood then, with the tools that ran and the records they returned.
// Offset 12. Everything is derived from the core seed, so the same reset time gives the same conversations.

type Lang = "en" | "id";

const jobRef = (j: { id: string; number: number }): AssistantRecordRef => {
  const label = formatJobNumber(j.number);
  return { type: "job", id: j.id, label, href: `/jobs/${label}` };
};

const T = {
  en: {
    unassignedQ: "Which new jobs don't have a technician yet?",
    unassignedNone: "Every new job has a technician.",
    unassigned: (n: number, lines: string[]) =>
      `**${n} new ${n === 1 ? "job has" : "jobs have"}** no technician yet:\n\n${lines.join("\n")}`,
    weekQ: "And how many jobs did we complete last week?",
    week: (n: number, from: string, to: string) =>
      `We completed **${n} ${n === 1 ? "job" : "jobs"}** last week (${from} to ${to}).`,
    monthsQ: "How many jobs did we complete last month compared with the month before?",
    months: (a: number, b: number, month: string) =>
      `Last month (${month}): **${a} completed jobs**. The month before: **${b}**. That's ${
        a === b ? "the same" : `${Math.abs(a - b)} ${a > b ? "more" : "fewer"}`
      }.`,
    historyQ: (name: string) => `What's the history of ${name}?`,
    history: (name: string, jobs: number, last: string | null, lines: string[]) =>
      `**${name}** has had ${jobs} jobs with us. Last visit: ${last ?? "none yet"}.\n\nRecent jobs:\n${lines.join("\n")}`,
  },
  id: {
    unassignedQ: "Pekerjaan baru mana yang belum punya teknisi?",
    unassignedNone: "Semua pekerjaan baru sudah punya teknisi.",
    unassigned: (n: number, lines: string[]) =>
      `**${n} pekerjaan baru** belum punya teknisi:\n\n${lines.join("\n")}`,
    weekQ: "Berapa pekerjaan yang selesai minggu lalu?",
    week: (n: number, from: string, to: string) =>
      `Minggu lalu (${from} sampai ${to}) ada **${n} pekerjaan selesai**.`,
    monthsQ: "Berapa pekerjaan yang selesai bulan lalu dibanding bulan sebelumnya?",
    months: (a: number, b: number, month: string) =>
      `Bulan lalu (${month}): **${a} pekerjaan selesai**. Bulan sebelumnya: **${b}**.`,
    historyQ: (name: string) => `Bagaimana riwayat pelanggan ${name}?`,
    history: (name: string, jobs: number, last: string | null, lines: string[]) =>
      `**${name}** sudah ${jobs} kali kami layani. Kunjungan terakhir: ${last ?? "belum ada"}.\n\nPekerjaan terakhir:\n${lines.join("\n")}`,
  },
} satisfies Record<Lang, unknown>;

export async function seedAssistant(ctx: SeedContext): Promise<void> {
  const f = extensionFaker(ctx, 12);
  const lang: Lang = ctx.spec.fakerLocale === "en_US" ? "en" : "id";
  const t = T[lang];
  const tz = ctx.timeZone;
  const day = (instant: Date) => availability.localDateOf(instant, tz);
  const customers = new Map(ctx.customers.map((c) => [c.id, c]));
  const dispatcher = ctx.members.find((m) => m.role === "dispatcher");
  const owner = ctx.members.find((m) => m.role === "owner");
  if (!dispatcher || !owner) return;

  const conversations: (typeof s.assistantConversation.$inferInsert)[] = [];
  const messages: (typeof s.assistantMessage.$inferInsert)[] = [];
  const conversation = (
    userId: string,
    at: Date,
    turns: { q: string; a: string; tools: AssistantToolRun[] }[],
  ) => {
    const id = uuidv7();
    const end = new Date(at.getTime() + turns.length * 3 * 60_000);
    conversations.push({
      id,
      organizationId: ctx.orgId,
      userId,
      title: turns[0]!.q,
      createdAt: at,
      updatedAt: end,
    });
    turns.forEach((turn, i) => {
      const asked = new Date(at.getTime() + i * 3 * 60_000);
      messages.push(
        { organizationId: ctx.orgId, conversationId: id, role: "user", content: turn.q, createdAt: asked },
        {
          organizationId: ctx.orgId,
          conversationId: id,
          role: "assistant",
          content: turn.a,
          tools: turn.tools,
          createdAt: new Date(asked.getTime() + f.number.int({ min: 4, max: 12 }) * 1000),
        },
      );
    });
  };
  const completedBetween = (from: string, to: string) =>
    ctx.jobs.filter((j) => j.completedAt && day(j.completedAt) >= from && day(j.completedAt) <= to);

  // The dispatcher, two days ago: the unassigned queue, then last week's completed jobs.
  const askedA = new Date(ctx.now.getTime() - 2 * DAY - 3 * 3_600_000);
  const queue = ctx.jobs
    .filter((j) => j.status === "new" && j.assignees.length === 0 && (j.createdAt ?? ctx.now) < askedA)
    .sort((a, b) => b.number - a.number);
  const shown = queue.slice(0, 5);
  const today = day(askedA);
  const lastWeekEnd = availability.shiftDate(today, -((availability.dayOfWeek(today) + 6) % 7) - 1);
  const lastWeekStart = availability.shiftDate(lastWeekEnd, -6);
  const lastWeek = completedBetween(lastWeekStart, lastWeekEnd);
  conversation(dispatcher.userId, askedA, [
    {
      q: t.unassignedQ,
      a: queue.length
        ? t.unassigned(
            queue.length,
            shown.map(
              (j) =>
                `- **${formatJobNumber(j.number)}** ${j.title} (${customers.get(j.customerId)?.name ?? ""})`,
            ),
          )
        : t.unassignedNone,
      tools: [
        {
          name: "search_jobs",
          summary: `Looked up ${queue.length} jobs`,
          count: queue.length,
          ok: true,
          refs: shown.map(jobRef),
        },
      ],
    },
    {
      q: t.weekQ,
      a: t.week(lastWeek.length, lastWeekStart, lastWeekEnd),
      tools: [
        {
          name: "search_jobs",
          summary: `Looked up ${lastWeek.length} jobs`,
          count: lastWeek.length,
          ok: true,
          refs: lastWeek.slice(0, 50).map(jobRef),
        },
      ],
    },
  ]);

  // The owner, six days ago: completed jobs last month against the month before.
  const askedB = new Date(ctx.now.getTime() - 6 * DAY - 5 * 3_600_000);
  const month = day(askedB).slice(0, 7);
  const monthBounds = (offset: number) => {
    const [y, m] = month.split("-").map(Number) as [number, number];
    const first = new Date(Date.UTC(y, m - 1 + offset, 1)).toISOString().slice(0, 10);
    const last = new Date(Date.UTC(y, m + offset, 0)).toISOString().slice(0, 10);
    return [first, last] as const;
  };
  const [aFrom, aTo] = monthBounds(-1);
  const [bFrom, bTo] = monthBounds(-2);
  const a = completedBetween(aFrom, aTo);
  const b = completedBetween(bFrom, bTo);
  conversation(owner.userId, askedB, [
    {
      q: t.monthsQ,
      a: t.months(a.length, b.length, aFrom.slice(0, 7)),
      tools: [
        {
          name: "search_jobs",
          summary: `Looked up ${a.length} jobs`,
          count: a.length,
          ok: true,
          refs: a.slice(0, 50).map(jobRef),
        },
        {
          name: "search_jobs",
          summary: `Looked up ${b.length} jobs`,
          count: b.length,
          ok: true,
          refs: b.slice(0, 50).map(jobRef),
        },
      ],
    },
  ]);

  // The owner, twelve days ago: the history of the busiest customer.
  const askedC = new Date(ctx.now.getTime() - 12 * DAY - 2 * 3_600_000);
  const before = ctx.jobs.filter((j) => (j.createdAt ?? ctx.now) < askedC);
  const perCustomer = new Map<string, number>();
  for (const j of before) perCustomer.set(j.customerId, (perCustomer.get(j.customerId) ?? 0) + 1);
  const [busiest] = [...perCustomer.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
  const customer = busiest ? customers.get(busiest[0]) : undefined;
  if (customer && busiest) {
    const theirs = before.filter((j) => j.customerId === customer.id).sort((x, y) => y.number - x.number);
    const lastVisit = theirs
      .filter((j) => j.completedAt && j.completedAt < askedC)
      .sort((x, y) => y.completedAt!.getTime() - x.completedAt!.getTime())[0];
    const recent = theirs.slice(0, 5);
    conversation(owner.userId, askedC, [
      {
        q: t.historyQ(customer.name),
        a: t.history(
          customer.name,
          busiest[1],
          lastVisit ? `${day(lastVisit.completedAt!)} (**${formatJobNumber(lastVisit.number)}**)` : null,
          recent.map((j) => `- **${formatJobNumber(j.number)}** ${j.title}`),
        ),
        tools: [
          {
            name: "customer_history",
            summary: `Opened ${customer.name}'s history`,
            count: 1,
            ok: true,
            refs: [
              { type: "customer", id: customer.id, label: customer.name, href: `/customers/${customer.id}` },
              ...recent.map(jobRef),
            ],
          },
        ],
      },
    ]);
  }

  await ctx.tx.insert(s.assistantConversation).values(conversations);
  await ctx.tx.insert(s.assistantMessage).values(messages);
}

import { availability, can, organization, schedule } from "@fieldops/core";
import { CalendarRange } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { requireActor, runService } from "@/server/context";
import { DispatchBoard } from "./board";
import { toBoardJob, toBoardProps, weekStart, type BoardView } from "./board-data";
import { BoardMap } from "./board-map";
import { BoardToolbar } from "./toolbar";

export const metadata: Metadata = { title: "Dispatch board" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The dispatch board (SCH-01, SCH-02) and the day map (SCH-05). Office roles only. */
export default async function SchedulePage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireActor();
  if (!can(actor, "schedule.view")) notFound();
  const t = await getTranslations("dispatch");
  const sp = await searchParams;
  const tz = actor.organization.timezone;
  const today = availability.localDateOf(new Date(), tz);
  const view: BoardView = one(sp.view) === "week" ? "week" : "day";
  const tab = one(sp.tab) === "map" ? "map" : "board";
  const rawDate = one(sp.date);
  const date = rawDate && DATE.test(rawDate) && !Number.isNaN(Date.parse(rawDate)) ? rawDate : today;
  const rawTech = one(sp.tech);
  const technician = rawTech && UUID.test(rawTech) ? rawTech : null;
  const first = view === "week" && tab === "board" ? weekStart(date) : date;
  const dates = Array.from({ length: view === "week" && tab === "board" ? 7 : 1 }, (_, i) =>
    availability.shiftDate(first, i),
  );

  const { board, members, tech } = await runService(async (ctx) => {
    const members = await organization.listAssignableMembers(ctx);
    // An unknown technician in the URL shows everyone instead of an error page.
    const tech = technician && members.some((m) => m.id === technician) ? technician : null;
    const board = await schedule.getBoard(ctx, {
      from: dates[0],
      to: dates.at(-1),
      ...(tech ? { member: tech } : {}),
    });
    return { board, members, tech };
  }, actor);

  const props = toBoardProps(board, { view, date, dates, today, technician: tech });
  const technicians = members.filter((m) => m.role === "technician").map((m) => ({ id: m.id, name: m.name }));

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/schedule/team">
              <CalendarRange aria-hidden /> {t("team.link")}
            </Link>
          </Button>
        }
      />
      <BoardToolbar
        view={view}
        tab={tab}
        date={date}
        today={today}
        technician={tech}
        technicians={technicians}
      />
      {tab === "map" ? (
        <BoardMap
          date={date}
          timeZone={tz}
          jobs={board.jobs.map((j) => toBoardJob(j, tz)).filter((j) => j.date === date)}
        />
      ) : (
        <DispatchBoard {...props} members={members.map((m) => ({ id: m.id, name: m.name, role: m.role }))} />
      )}
    </div>
  );
}

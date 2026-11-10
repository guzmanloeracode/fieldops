import { availability, can, schedule } from "@fieldops/core";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { requireActor, runService } from "@/server/context";
import { TeamAvailability, type TeamMember } from "./team-availability";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.pageTitle");
  return { title: t("team") };
}

/** SCH-04: working hours, skills and time off per member. Office roles manage it. */
export default async function TeamPage() {
  const actor = await requireActor();
  if (!can(actor, "availability.manage")) notFound();
  const t = await getTranslations("dispatch.team");
  const team = await runService((ctx) => schedule.getTeamAvailability(ctx), actor);
  const tz = team.timeZone;
  const now = Date.now();
  const members: TeamMember[] = team.members
    .filter((m) => m.role === "technician" || m.workingHours || m.skills.length || m.timeOff.length)
    .map((m) => ({
      id: m.id,
      name: m.name,
      role: m.role,
      skills: m.skills,
      workingHours: m.workingHours,
      timeOff: m.timeOff.map((o) => ({
        id: o.id,
        from: availability.localDateOf(o.startsAt, tz),
        to: availability.localDateOf(new Date(o.endsAt.getTime() - 1), tz),
        reason: o.reason,
        past: o.endsAt.getTime() < now,
      })),
    }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/schedule">
              <ArrowLeft aria-hidden /> {t("back")}
            </Link>
          </Button>
        }
      />
      <TeamAvailability timeZone={tz} businessHours={team.businessHours} members={members} />
    </div>
  );
}

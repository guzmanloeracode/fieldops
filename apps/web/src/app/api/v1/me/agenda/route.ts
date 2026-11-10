import { schedule } from "@fieldops/core";
import type { AgendaDto } from "@fieldops/shared";
import { apiRoute } from "@/server/api/handler";
import { toJobDto } from "@/server/api/serialize";

/** The caller's assigned visits from today through the next seven days (TEC-01). */
export const GET = apiRoute(async ({ ctx }) => {
  const agenda = await schedule.getAgenda(ctx);
  const body: AgendaDto = {
    time_zone: agenda.timeZone,
    from: agenda.from,
    to: agenda.to,
    jobs: agenda.jobs.map(toJobDto),
  };
  return { body };
});

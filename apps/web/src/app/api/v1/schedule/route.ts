import { schedule } from "@fieldops/core";
import { apiRoute } from "@/server/api/handler";
import { toScheduleDto } from "@/server/api/serialize";

/** Visits in a date range (organization time zone) with each technician's hours and time off (SCH-01). */
export const GET = apiRoute(async ({ url, ctx }) => {
  const q = Object.fromEntries(url.searchParams);
  const board = await schedule.getBoard(ctx, q, { unscheduledLimit: 0 });
  return { body: toScheduleDto(board) };
});

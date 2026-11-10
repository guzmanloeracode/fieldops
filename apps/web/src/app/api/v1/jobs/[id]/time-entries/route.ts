import { timeEntries } from "@fieldops/core";
import { apiRoute } from "@/server/api/handler";
import { toTimeEntryDto, toTimeTotalsDto } from "@/server/api/serialize-fieldwork";

type Params = { id: string };

/** Travel and work time on the job, with totals per technician (TEC-04). */
export const GET = apiRoute<Params>(async ({ params, ctx }) => {
  const { entries, totals } = await timeEntries.listTimeEntries(ctx, params.id);
  return {
    body: {
      data: entries.map((e) => toTimeEntryDto(e, ctx.now)),
      totals: totals.map(toTimeTotalsDto),
      next_cursor: null,
    },
  };
});

/** Adds time that no status change recorded. A reason is required. */
export const POST = apiRoute<Params>(async ({ params, body, ctx }) => ({
  status: 201,
  body: toTimeEntryDto(await timeEntries.addTimeEntry(ctx, params.id, body), ctx.now),
}));

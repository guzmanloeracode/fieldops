import { timeEntries } from "@fieldops/core";
import { apiRoute } from "@/server/api/handler";
import { toTimeEntryDto } from "@/server/api/serialize-fieldwork";

/** Corrects a time entry with a reason (TEC-04). Technicians may only correct their own entries. */
export const PATCH = apiRoute<{ id: string }>(async ({ params, body, ctx }) => ({
  body: toTimeEntryDto(await timeEntries.updateTimeEntry(ctx, params.id, body), ctx.now),
}));

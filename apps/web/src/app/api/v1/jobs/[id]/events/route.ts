import { jobs } from "@fieldops/core";
import { apiRoute } from "@/server/api/handler";
import { toJobEventDto } from "@/server/api/serialize";

/** The job timeline, newest first. */
export const GET = apiRoute<{ id: string }>(async ({ params, ctx }) => {
  const events = await jobs.listJobEvents(ctx, params.id);
  return { body: { data: events.map(toJobEventDto), next_cursor: null } };
});

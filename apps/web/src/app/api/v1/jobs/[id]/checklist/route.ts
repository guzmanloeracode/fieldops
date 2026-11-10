import { checklists } from "@fieldops/core";
import { apiRoute } from "@/server/api/handler";
import { toChecklistDto } from "@/server/api/serialize-fieldwork";

type Params = { id: string };

/** The job's checklist with progress (JOB-08). */
export const GET = apiRoute<Params>(async ({ params, ctx }) => ({
  body: toChecklistDto(await checklists.getChecklist(ctx, params.id)),
}));

/** Saves answers for one or more items. Required items must be done before the job can be completed. */
export const PATCH = apiRoute<Params>(async ({ params, body, ctx }) => ({
  body: toChecklistDto(await checklists.updateChecklist(ctx, params.id, body)),
}));

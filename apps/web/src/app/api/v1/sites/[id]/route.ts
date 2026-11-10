import { customers } from "@fieldops/core";
import { apiRoute } from "@/server/api/handler";
import { toSiteDto } from "@/server/api/serialize";

type Params = { id: string };

export const GET = apiRoute<Params>(async ({ params, ctx }) => {
  return { body: toSiteDto(await customers.getSite(ctx, params.id)) };
});

export const PATCH = apiRoute<Params>(async ({ params, body, ctx }) => {
  return { body: toSiteDto(await customers.updateSite(ctx, params.id, body ?? {})) };
});

import { customers } from "@fieldops/core";
import { apiRoute } from "@/server/api/handler";
import { toSiteDto } from "@/server/api/serialize";

type Params = { id: string };

export const GET = apiRoute<Params>(async ({ params, ctx }) => {
  const sites = await customers.listSites(ctx, params.id);
  return { body: { data: sites.map(toSiteDto), next_cursor: null } };
});

export const POST = apiRoute<Params>(async ({ params, body, ctx }) => {
  const site = await customers.createSite(ctx, params.id, body);
  return { status: 201, body: toSiteDto(site), headers: { Location: `/api/v1/sites/${site.id}` } };
});

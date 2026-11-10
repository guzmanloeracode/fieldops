import { organization } from "@fieldops/core";
import { apiRoute } from "@/server/api/handler";
import { toServiceTypeDto } from "@/server/api/serialize";

export const GET = apiRoute(async ({ url, ctx }) => {
  const includeInactive = url.searchParams.get("include_inactive") === "true";
  const rows = await organization.listServiceTypes(ctx, { includeInactive });
  return { body: { data: rows.map(toServiceTypeDto), next_cursor: null } };
});

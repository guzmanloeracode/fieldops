import { customers } from "@fieldops/core";
import { apiRoute } from "@/server/api/handler";
import { toEquipmentDto } from "@/server/api/serialize";

/** Equipment at a site. Access follows the site: technicians only reach sites of their assigned jobs. */
export const GET = apiRoute<{ id: string }>(async ({ params, ctx }) => {
  const rows = await customers.listSiteEquipment(ctx, params.id);
  return { body: { data: rows.map(toEquipmentDto), next_cursor: null } };
});

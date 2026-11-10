import { customers } from "@fieldops/core";
import { apiRoute } from "@/server/api/handler";
import { toEquipmentDto } from "@/server/api/serialize";

/** Equipment at a site. Access follows the site: technicians only reach sites of their assigned jobs. */
export const GET = apiRoute<{ id: string }>(async ({ params, ctx }) => {
  const rows = await customers.listSiteEquipment(ctx, params.id);
  return { body: { data: rows.map(toEquipmentDto), next_cursor: null } };
});

/** Adds a unit to a site (CUS-03). Owners, admins and dispatchers. */
export const POST = apiRoute<{ id: string }>(async ({ params, body, ctx }) => {
  const unit = await customers.createEquipment(ctx, params.id, body ?? {});
  return { status: 201, body: toEquipmentDto(unit), headers: { Location: `/api/v1/equipment/${unit.id}` } };
});

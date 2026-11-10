import { customers } from "@fieldops/core";
import { apiRoute } from "@/server/api/handler";
import { toEquipmentDto } from "@/server/api/serialize";

type Params = { id: string };

/** One unit (CUS-03). Technicians only reach units at sites of their assigned jobs. */
export const GET = apiRoute<Params>(async ({ params, ctx }) => {
  return { body: toEquipmentDto(await customers.getEquipment(ctx, params.id)) };
});

export const PATCH = apiRoute<Params>(async ({ params, body, ctx }) => {
  return { body: toEquipmentDto(await customers.updateEquipment(ctx, params.id, body ?? {})) };
});

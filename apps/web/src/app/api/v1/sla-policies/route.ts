import { sla } from "@fieldops/core";
import { apiRoute } from "@/server/api/handler";
import { toSlaPolicyDto } from "@/server/api/serialize-sla";

// SLA policies (SLA-01): one per priority. GET for every member, PUT (all four at once) for owners and admins.

export const GET = apiRoute(async ({ ctx }) => {
  const rows = await sla.listPolicies(ctx);
  return { body: { data: rows.map(toSlaPolicyDto) } };
});

export const PUT = apiRoute(async ({ ctx, body }) => {
  const rows = await sla.updatePolicies(ctx, body);
  return { body: { data: rows.map(toSlaPolicyDto) } };
});

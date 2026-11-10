import { organization } from "@fieldops/core";
import { apiRoute } from "@/server/api/handler";
import { toMemberDto } from "@/server/api/serialize";

export const GET = apiRoute(async ({ ctx }) => {
  const members = await organization.listMembers(ctx);
  return { body: { data: members.map(toMemberDto), next_cursor: null } };
});
